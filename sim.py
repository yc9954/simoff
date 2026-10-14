"""Agent-based offline store simulator, calibrated to people.

Agents are real households from the dunnhumby Complete Journey data. Each one carries a state
computed only from its own receipts in weeks 1-26 (visit count, basket size, how often it buys
cereal, discount share, private-label share, how often it bought this product). Every visit it
makes, it meets the cereal products under whatever the plan puts in the store that week, and
decides product by product: bought on this visit or not.

The decision is a draw against a probability from a decision engine. The default engine is the
calibrated model: gradient boosting on household state + product + store condition, trained on
weeks 27-44 and isotonic-calibrated on weeks 45-47. Weeks 48-53 are never used to fit anything.

Same customers, same luck (the rule gs2500 uses for its candidates): every plan in a run reuses the
same visits and the same random number for each (visit, product, draw). A difference between plans
therefore comes from the plan alone, not from which shoppers happened to show up.

What this is not: there is no shelf position, inventory or walking path in this data, so there is
no stock-out, replenishment or route in the ledger. Units are "visits in which the product was
bought" (the decision table's target), not item quantities.
"""
import argparse
import hashlib
import json
import pickle
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression

HERE = Path(__file__).parent
HH = ['visits', 'avg_spend', 'cereal_visit_rate', 'disc_share', 'cereal_spend_share', 'private_share', 'hp_count', 'prod_base', 'prod_private']
COND = ['front_endcap', 'other_display', 'mailer', 'mailer_front']
CONDS = {'none': (0, 0, 0, 0), 'A_front_endcap': (1, 0, 0, 0), 'B_mailer_only': (0, 0, 1, 1), 'C_other_display': (0, 1, 0, 0)}
LABEL = {'none': '평소대로', 'A_front_endcap': '앞쪽 엔드캡', 'B_mailer_only': '전단', 'C_other_display': '기타 진열', 'actual': '실제 진열 그대로'}
STATE_FIELDS = ['visits', 'avg_spend', 'cereal_visit_rate', 'disc_share', 'private_share', 'hp_count']


def load(data_dir=HERE / 'data'):
    rows = pd.read_parquet(Path(data_dir) / 'rows.parquet')
    products = pd.read_parquet(Path(data_dir) / 'products.parquet').set_index('product_id')
    return rows, products


def condition_name(frame):
    """Map the four condition flags back to a plan condition, with the precedence build.py uses."""
    return np.select([frame.front_endcap == 1, frame.other_display == 1, frame.mailer == 1],
                     ['A_front_endcap', 'C_other_display', 'B_mailer_only'], 'none')


# ---------------------------------------------------------------- engines

@dataclass
class Engine:
    name: str
    label: str
    note: str
    predict: object = field(repr=False)


def _fit(train, calib, feats, seed=0):
    m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200,
                                       l2_regularization=1.0, random_state=seed).fit(train[feats], train.y)
    iso = IsotonicRegression(out_of_bounds='clip', y_min=1e-6, y_max=1 - 1e-6).fit(m.predict_proba(calib[feats])[:, 1], calib.y)
    return m, iso


def train_engines(rows, cache=HERE / 'data' / 'engines.pkl'):
    """Same models and hyperparameters as offline-api-eval/scripts/model_eval.py."""
    key = hashlib.sha256(f'{len(rows)}|{int(rows.y.sum())}|{sklearn.__version__}|v1'.encode()).hexdigest()[:16]
    if Path(cache).exists():
        saved = pickle.loads(Path(cache).read_bytes())
        if saved.get('key') == key:
            fitted = saved['fitted']
        else:
            fitted = None
    else:
        fitted = None
    if fitted is None:
        tr, ca = rows[rows.split == 'train'], rows[rows.split == 'calib']
        lift = tr.groupby('condition').y.mean() / tr[tr.condition == 'none'].y.mean()
        fitted = {'calibrated': _fit(tr, ca, HH + COND), 'no_promo': _fit(tr, ca, HH), 'avg_lift': lift.to_dict()}
        Path(cache).write_bytes(pickle.dumps({'key': key, 'fitted': fitted}))

    def gbm(models, feats):
        m, iso = models
        return lambda X: iso.predict(m.predict_proba(X[feats])[:, 1])

    lift = fitted['avg_lift']
    return {
        'calibrated': Engine('calibrated', '보정 모델',
                             '가구 상태 + 상품 + 매장 조건으로 학습(27–44주), 45–47주 실제 구매로 등위 보정', gbm(fitted['calibrated'], HH + COND)),
        'no_promo': Engine('no_promo', '평소대로 예측', '같은 모델에서 매장 조건을 뺀 것. 진열 효과를 0으로 보는 기준선', gbm(fitted['no_promo'], HH)),
        'avg_lift': Engine('avg_lift', '평균 효과', '상품 기본 구매율 × 조건별 전체 평균 효과. 가구 차이를 무시하는 기준선',
                           lambda X: np.clip(X.prod_base.values * pd.Series(condition_name(X)).map(lift).values, 1e-6, 1 - 1e-6)),
    }


# ---------------------------------------------------------------- plans

@dataclass
class Plan:
    """What the store does. `condition` is applied to `products` on the rows in `scope`;
    every other row keeps the condition it actually had."""
    id: str
    condition: str                 # 'actual', 'layout', or a key of CONDS
    products: object = 'all'       # 'all' or a list of product ids
    scope: str = 'all'             # 'all', or 'where:<condition>' = only rows that actually had that condition
    label: str = ''
    layout: dict = None            # condition 'layout': {product_id: 'none' | 'A_front_endcap' | 'C_other_display'}

    def __post_init__(self):
        if self.condition not in ('actual', 'layout') and self.condition not in CONDS:
            raise ValueError(f'unknown condition {self.condition}')
        if self.condition == 'layout' and not self.layout:
            raise ValueError('a layout plan needs a layout')
        self.label = self.label or LABEL.get(self.condition, self.id)

    def apply(self, frame):
        out = frame.copy()
        if self.condition == 'actual':
            out['plan_condition'] = condition_name(out)
            return out
        if self.condition == 'layout':
            # A floor plan moves products between shelf and displays. The flyer is not floor space,
            # so each row keeps the mailer flags it actually had.
            for cond in ('none', 'A_front_endcap', 'C_other_display'):
                hit = out.product_id.isin([p for p, c in self.layout.items() if c == cond]).values
                out.loc[hit, ['front_endcap', 'other_display']] = CONDS[cond][:2]
            out['plan_condition'] = condition_name(out)
            return out
        hit = np.ones(len(out), bool) if self.products == 'all' else out.product_id.isin(self.products).values
        if self.scope.startswith('where:'):
            hit &= (condition_name(frame) == self.scope.split(':', 1)[1])
        elif self.scope != 'all':
            raise ValueError(f'unknown scope {self.scope}')
        out.loc[hit, COND] = CONDS[self.condition]
        out['plan_condition'] = condition_name(out)
        return out


# ---------------------------------------------------------------- schedule

def replay_schedule(rows, weeks, products='all'):
    """The visits that really happened in `weeks`, one row per visit x product."""
    s = rows[rows.week.between(*weeks)]
    if products != 'all':
        s = s[s.product_id.isin(products)]
    return s.reset_index(drop=True)


def poisson_schedule(rows, horizon_weeks, products='all', seed=42, start_week=54, rate_weeks=(27, 47)):
    """Future visits: each household visits Poisson(its weekly rate in `rate_weeks`) times a week,
    at its usual store, on a weekday and hour drawn from its own past visits. State is unchanged."""
    past = rows[rows.week.between(*rate_weeks)]
    visits = past.drop_duplicates('basket_id')[['basket_id', 'household_id', 'store_id', 'date', 'hour']]
    visits = visits.assign(weekday=pd.to_datetime(visits.date).dt.weekday)
    rate = visits.groupby('household_id').size() / (rate_weeks[1] - rate_weeks[0] + 1)
    home = visits.groupby('household_id').store_id.agg(lambda s: s.mode().iloc[0])
    rng = np.random.default_rng(seed)
    last = pd.to_datetime(rows.date.max())
    week0 = last + pd.Timedelta(days=7 - last.weekday())          # next Monday
    state = rows.drop_duplicates(['household_id', 'product_id']).set_index(['household_id', 'product_id'])[HH + ['has_demo']]
    prods = rows.product_id.unique() if products == 'all' else np.array(products)
    by_hh = {h: g[['weekday', 'hour']].to_numpy() for h, g in visits.groupby('household_id')}
    out = []
    for w in range(horizon_weeks):
        counts = rng.poisson(rate.values)
        for hh, n in zip(rate.index, counts):
            for i in range(n):
                wd, hr = by_hh[hh][rng.integers(len(by_hh[hh]))]
                out.append((f'sim-{hh}-{start_week + w}-{i}', hh, home[hh], start_week + w,
                            (week0 + pd.Timedelta(days=7 * w + int(wd))).strftime('%Y-%m-%d'), int(hr)))
    v = pd.DataFrame(out, columns=['basket_id', 'household_id', 'store_id', 'week', 'date', 'hour'])
    v = v.merge(pd.DataFrame({'product_id': prods}), how='cross')
    v = v.join(state, on=['household_id', 'product_id'], how='inner')
    v[COND] = 0
    v['y'] = np.nan
    v['split'] = 'forecast'
    return v.reset_index(drop=True)


# ---------------------------------------------------------------- the run

def uniforms(keys, seed):
    """One uniform per key, fixed by (key, seed). Shared by every plan and engine in a run."""
    h = pd.util.hash_pandas_object(keys, index=False, hash_key=f'{seed:016d}'[-16:]).to_numpy(np.uint64)
    return (h >> np.uint64(11)).astype(np.float64) * 2.0 ** -53


def _sum_by(idx, n, values):
    return np.bincount(idx, weights=values, minlength=n)


def run(sched, plans, engine, products, draws=100, seed=42, sample_per_day=12, baseline=None):
    t0 = time.time()
    sched = sched.reset_index(drop=True)
    keys = sched.basket_id.astype(str) + ':' + sched.product_id.astype(str)
    price = sched.product_id.map(products.shelf_price).to_numpy()
    week_ix, weeks = pd.factorize(sched.week, sort=True)
    date_ix, dates = pd.factorize(sched.date, sort=True)
    dh = sched.date + ' ' + sched.hour.astype(str).str.zfill(2)
    hour_ix, hours = pd.factorize(dh, sort=True)

    probs = {p.id: engine.predict(p.apply(sched)) for p in plans}
    conds = {p.id: p.apply(sched).plan_condition.to_numpy() for p in plans}

    # Monte Carlo: draw 0 is the simulated history the ledger and replay show; all draws give the interval.
    tot = {p.id: np.zeros(draws) for p in plans}
    wk = {p.id: np.zeros((draws, len(weeks))) for p in plans}
    bought0 = {}
    for d in range(draws):
        u = uniforms(keys, seed + d)
        if d == 0:
            u0 = u
        for p in plans:
            b = u < probs[p.id]
            tot[p.id][d] = b.sum()
            wk[p.id][d] = _sum_by(week_ix, len(weeks), b.astype(float))
            if d == 0:
                bought0[p.id] = b

    # Representative visits: chosen by a seeded rank that never looks at outcomes, same visits for every plan.
    v = sched.drop_duplicates('basket_id')[['basket_id', 'date']]
    v = v.assign(rank=uniforms(v.basket_id.astype(str) + ':sample', seed))
    picked = set(v.sort_values('rank').groupby('date').head(sample_per_day).basket_id)
    pick_rows = np.flatnonzero(sched.basket_id.isin(picked).to_numpy())

    n_visits = int(sched.basket_id.nunique())
    seg_masks = {
        '이 상품을 산 적 있는 가구': sched.hp_count.to_numpy() > 0,
        '이 상품을 산 적 없는 가구': sched.hp_count.to_numpy() == 0,
        '시리얼 자주 삼 (상위 1/3)': (sched.cereal_visit_rate >= sched.cereal_visit_rate.quantile(2 / 3)).to_numpy(),
        '시리얼 드물게 삼 (하위 1/3)': (sched.cereal_visit_rate <= sched.cereal_visit_rate.quantile(1 / 3)).to_numpy(),
        '할인 민감 (상위 1/3)': (sched.disc_share >= sched.disc_share.quantile(2 / 3)).to_numpy(),
        '할인 덜 민감 (하위 1/3)': (sched.disc_share <= sched.disc_share.quantile(1 / 3)).to_numpy(),
    }

    out_plans = []
    for p in plans:
        pr, b0 = probs[p.id], bought0[p.id]
        exp_w = _sum_by(week_ix, len(weeks), pr)
        lo, hi = np.percentile(wk[p.id], [5, 95], axis=0)
        visits_w = sched.groupby(week_ix).basket_id.nunique().reindex(range(len(weeks)), fill_value=0).to_numpy()
        out_plans.append({
            'id': p.id, 'label': p.label, 'condition': p.condition, 'products': p.products, 'scope': p.scope,
            'totals': {
                'visits': n_visits, 'decisions': int(len(sched)),
                'expected_units': float(pr.sum()), 'simulated_units': int(b0.sum()),
                'mc_mean': float(tot[p.id].mean()), 'mc_p05': float(np.percentile(tot[p.id], 5)), 'mc_p95': float(np.percentile(tot[p.id], 95)),
                'expected_revenue': float((pr * price).sum()), 'simulated_revenue': float((b0 * price).sum()),
                'per_1000_decisions': float(pr.mean() * 1000), 'per_1000_visits': float(pr.sum() / n_visits * 1000),
            },
            'by_condition': {c: {'decisions': int((conds[p.id] == c).sum()), 'expected_units': float(pr[conds[p.id] == c].sum())}
                             for c in CONDS if (conds[p.id] == c).any()},
            'weekly': [{'week': int(w), 'visits': int(visits_w[i]), 'expected_units': float(exp_w[i]),
                        'simulated_units': int(_sum_by(week_ix, len(weeks), b0.astype(float))[i]),
                        'mc_p05': float(lo[i]), 'mc_p95': float(hi[i]),
                        'expected_revenue': float(_sum_by(week_ix, len(weeks), pr * price)[i])} for i, w in enumerate(weeks)],
            'daily': [{'date': d, 'expected_units': float(e), 'simulated_units': int(s), 'simulated_revenue': float(r)}
                      for d, e, s, r in zip(dates, _sum_by(date_ix, len(dates), pr), _sum_by(date_ix, len(dates), b0.astype(float)),
                                            _sum_by(date_ix, len(dates), b0 * price))],
            'hourly': [{'slot': h, 'expected_units': float(e), 'simulated_units': int(s)}
                       for h, e, s in zip(hours, _sum_by(hour_ix, len(hours), pr), _sum_by(hour_ix, len(hours), b0.astype(float)))],
            'by_product': sorted([{'product_id': pid, 'brand': products.brand.get(pid), 'type': products.product_type.get(pid),
                                   'size': products.package_size.get(pid), 'shelf_price': float(products.shelf_price.get(pid)),
                                   'decisions': int(len(ix)), 'expected_units': float(pr[ix].sum()), 'simulated_units': int(b0[ix].sum())}
                                  for pid, ix in sched.groupby('product_id').indices.items()],
                                 key=lambda r: -r['expected_units']),
            'by_segment': [{'segment': name, 'decisions': int(m.sum()), 'expected_units': float(pr[m].sum()),
                            'per_1000_decisions': float(pr[m].mean() * 1000) if m.any() else None} for name, m in seg_masks.items()],
            'sample_visits': _sample(sched, pick_rows, pr, u0, b0, conds[p.id], price),
        })

    base_id = baseline or plans[0].id
    base = next(x for x in out_plans if x['id'] == base_id)
    for x in out_plans:
        b, e = base['totals'], x['totals']
        x['vs_baseline'] = {'baseline': base_id,
                            'lift': e['expected_units'] / b['expected_units'] if b['expected_units'] else None,
                            'extra_units': e['expected_units'] - b['expected_units'],
                            'extra_revenue': e['expected_revenue'] - b['expected_revenue'],
                            'share_of_draws_above_baseline': float((tot[x['id']] > tot[base_id]).mean())}
    return {
        'schema': 'offline-sim-ledger/1',
        'engine': {'name': engine.name, 'label': engine.label, 'note': engine.note},
        'run': {'weeks': [int(weeks.min()), int(weeks.max())], 'draws': draws, 'seed': seed, 'seconds': round(time.time() - t0, 1),
                'households': int(sched.household_id.nunique()), 'stores': int(sched.store_id.nunique()),
                'products': int(sched.product_id.nunique()), 'schedule': str(sched.split.iloc[0])},
        'definitions': {
            'units': '이 상품을 산 방문 수 (방문 1회에 몇 개를 샀는지는 세지 않음)',
            'expected_units': '모든 결정의 확률 합',
            'simulated_units': '0번 추첨으로 실제로 굴린 하루하루의 기록. 대표 방문과 3D 재생이 이 기록을 읽는다',
            'mc_p05_p95': f'{draws}번 추첨의 5–95% 범위. 손님 운에 의한 흔들림만 담고, 모델 자체의 오차는 담지 않는다',
            'revenue': '판매 방문 수 × 상품별 할인 전 가격 중간값 (USD)',
            'same_luck': '모든 안이 같은 방문과 같은 (방문, 상품, 추첨)별 난수를 쓴다',
        },
        'plans': out_plans,
    }


def _sample(sched, ix, pr, u, b, cond, price):
    s = sched.iloc[ix].assign(p=pr[ix], u=u[ix], bought=b[ix], cond=cond[ix], price=price[ix])
    out = []
    for bid, g in s.groupby('basket_id', sort=False):
        f = g.iloc[0]
        out.append({'basket_id': str(bid), 'household_id': str(f.household_id), 'store_id': str(f.store_id),
                    'date': f.date, 'hour': int(f.hour), 'state': {k: round(float(f[k]), 4) for k in STATE_FIELDS},
                    'decisions': [{'product_id': str(r.product_id), 'condition': r.cond, 'p': round(float(r.p), 6),
                                   'draw': round(float(r.u), 6), 'bought': bool(r.bought), 'price': round(float(r.price), 2)}
                                  for r in g.itertuples()],
                    'bought': int(g.bought.sum()), 'paid': round(float((g.bought * g.price).sum()), 2)})
    return sorted(out, key=lambda r: (r['date'], r['hour'], r['basket_id']))


def decision_product(rows):
    """The cereal with the most front-endcap visits in the test weeks: the S4 decision's product."""
    te = rows[rows.split == 'test']
    return te[te.condition == 'A_front_endcap'].product_id.value_counts().index[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--weeks', default='48-53', help='replay these weeks (e.g. 48-53)')
    ap.add_argument('--forecast-weeks', type=int, default=0, help='instead of replay, simulate N future weeks of Poisson visits')
    ap.add_argument('--products', default='decision', help="'decision' (one product), 'all', or comma-separated ids")
    ap.add_argument('--plans', default='none,A_front_endcap,B_mailer_only,C_other_display')
    ap.add_argument('--scope', default='all', help="'all' or 'where:<condition>'")
    ap.add_argument('--engine', default='calibrated', choices=['calibrated', 'no_promo', 'avg_lift'])
    ap.add_argument('--draws', type=int, default=100)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--out', default=str(HERE / 'results' / 'run.json'))
    a = ap.parse_args()

    rows, products = load()
    engines = train_engines(rows)
    prods = [decision_product(rows)] if a.products == 'decision' else 'all' if a.products == 'all' else a.products.split(',')
    if a.forecast_weeks:
        sched = poisson_schedule(rows, a.forecast_weeks, prods, seed=a.seed)
    else:
        lo, hi = (int(x) for x in a.weeks.split('-'))
        sched = replay_schedule(rows, (lo, hi), prods)
    plans = [Plan(c, c, prods, a.scope) for c in a.plans.split(',')]
    ledger = run(sched, plans, engines[a.engine], products, draws=a.draws, seed=a.seed)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(ledger, ensure_ascii=False, indent=1))
    print(f"{ledger['run']} -> {a.out}")
    for x in ledger['plans']:
        t, v = x['totals'], x['vs_baseline']
        print(f"  {x['label']:<8} 기대 {t['expected_units']:8.2f}  추첨0 {t['simulated_units']:5d}  90% [{t['mc_p05']:.0f}, {t['mc_p95']:.0f}]"
              f"  1,000결정당 {t['per_1000_decisions']:.3f}  ${t['expected_revenue']:,.2f}  vs {v['baseline']} ×{v['lift']:.2f}")


if __name__ == '__main__':
    main()
