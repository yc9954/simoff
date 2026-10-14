"""Everything the SimOff screens ask for, computed from the data and the simulator.

Nothing here is a mock. Calibrated model, 'no promo' model and average-lift baseline run live;
Jev and the persona engine are the stored answers from the evaluation run (eval/results), because
Jev has no public key in this build. With ANTHROPIC_API_KEY (app/.env) or OPENAI_API_KEY set, the persona engine can also be
asked live for one household (persona_live), and the brief / report text uses the model.
"""
import json
import re
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.compute as pc
import pyarrow.parquet as pq

import sys
SIM = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SIM))

import spacemap                                                        # noqa: E402
from datasets import DISPLAY_CODES, MAILER_CODES                       # noqa: E402
from optimize import choose_layout                                     # noqa: E402
from sim import LABEL, Plan, condition_name, load, replay_schedule, run, train_engines   # noqa: E402

DS = SIM / 'datasets' / 'dunnhumby'
EVAL = SIM / 'eval' / 'results'
CACHE = Path(__file__).resolve().parent / 'cache'
CACHE.mkdir(exist_ok=True)
TEST = (48, 53)
AS_OF = 47
PLANS = ['A_front_endcap', 'B_mailer_only', 'C_other_display', 'none']

_lock = threading.Lock()
_state = {}


def state():
    """Decision table, products and fitted engines, loaded once."""
    with _lock:
        if not _state:
            rows, products = load()
            _state.update(rows=rows, products=products, engines=train_engines(rows), test=replay_schedule(rows, TEST))
        return _state


def _cached(name, fn):
    f = CACHE / f'{name}.json'
    if f.exists():
        return json.loads(f.read_text())
    out = fn()
    f.write_text(json.dumps(out, ensure_ascii=False))
    return out


# ---------------------------------------------------------------- S1 endpoints

def catalog():
    def build():
        t = pq.read_table(DS / 'transactions.parquet', columns=['basket_id', 'household_id', 'store_id', 'retail_disc', 'coupon_disc'])
        pr = pq.read_table(DS / 'promotions.parquet', columns=['display_location', 'mailer_location'])
        disp = pc.sum(pc.not_equal(pc.cast(pr['display_location'], 'string'), '0')).as_py()
        mail = pc.sum(pc.not_equal(pc.cast(pr['mailer_location'], 'string'), '0')).as_py()
        visits = pc.count_distinct(t['basket_id']).as_py()
        return {
            'households': pc.count_distinct(t['household_id']).as_py(), 'stores': pc.count_distinct(t['store_id']).as_py(),
            'visits': visits, 'receipt_lines': t.num_rows, 'placement_rows': pr.num_rows,
            'endpoints': [
                {'method': 'POST', 'path': '/visit', 'source': 'transactions · basket_id, store_id, timestamp', 'events': visits, 'group': '영수증'},
                {'method': 'GET', 'path': '/exposure/display', 'source': 'promotions · display_location ≠ 0', 'events': disp, 'group': '진열 · 전단'},
                {'method': 'GET', 'path': '/exposure/mailer', 'source': 'promotions · mailer_location ≠ 0', 'events': mail, 'group': '진열 · 전단'},
                {'method': 'POST', 'path': '/basket/add', 'source': 'transactions · product_id, quantity', 'events': t.num_rows, 'group': '영수증'},
                {'method': 'POST', 'path': '/price/discount', 'source': 'transactions · retail_disc ≠ 0', 'events': pc.sum(pc.not_equal(t['retail_disc'], 0)).as_py(), 'group': '가격'},
                {'method': 'POST', 'path': '/coupon/redeem', 'source': 'transactions · coupon_disc ≠ 0', 'events': pc.sum(pc.not_equal(t['coupon_disc'], 0)).as_py(), 'group': '가격'},
                {'method': 'POST', 'path': '/checkout', 'source': 'Σ transactions · sales_value', 'events': visits, 'group': '영수증'},
                {'method': '—', 'path': '/path · /dwell', 'source': '센서 연결 시 활성화', 'events': None, 'group': '센서'},
            ]}
    return _cached('catalog', build)


def replay_basket(basket_id=None):
    """One real visit as the event stream the endpoints would have received."""
    s = state()
    if basket_id in (None, 'random'):
        te = s['test']
        hit = te[(te.y == 1) & (condition_name(te) == 'A_front_endcap')]
        hit = hit if len(hit) else te
        basket_id = str(hit.basket_id.iloc[0] if basket_id is None else hit.basket_id.sample(1).iloc[0])
    t = pq.read_table(DS / 'transactions.parquet', filters=[('basket_id', '=', str(basket_id))]).to_pandas()
    if t.empty:
        raise KeyError(f'no basket {basket_id}')
    f = t.iloc[0]
    week, store = int(f.week), str(f.store_id)
    pl = pq.read_table(DS / 'promotions.parquet', filters=[('store_id', '=', store), ('week', '=', week)]).to_pandas()
    pl = pl[pl.product_id.isin(t.product_id)]
    prod = _products().reindex(t.product_id)
    ev = [{'m': 'POST', 'path': '/visit', 'args': f'store={store} hh={f.household_id}'}]
    for r, (_, p) in zip(t.itertuples(), prod.iterrows()):
        d = pl[pl.product_id == r.product_id]
        code = next((c for c in d.display_location.astype(str) if c != '0'), None)
        if code:
            ev.append({'m': 'GET', 'path': '/exposure/display', 'args': f'product={r.product_id} loc={code}', 'note': DISPLAY_CODES.get(code)})
        mcode = next((c for c in d.mailer_location.astype(str) if c != '0'), None)
        if mcode:
            ev.append({'m': 'GET', 'path': '/exposure/mailer', 'args': f'product={r.product_id} loc={mcode}', 'note': MAILER_CODES.get(mcode)})
        ev.append({'m': 'POST', 'path': '/basket/add', 'args': f'product={r.product_id} qty={int(r.quantity)}', 'amount': round(float(r.sales_value), 2),
                   'item': f"{p.get('product_type') or ''}".strip().title()})
        if r.retail_disc:
            ev.append({'m': 'POST', 'path': '/price/discount', 'args': f'product={r.product_id}', 'amount': -abs(round(float(r.retail_disc), 2))})
        if r.coupon_disc:
            ev.append({'m': 'POST', 'path': '/coupon/redeem', 'args': f'product={r.product_id}', 'amount': -abs(round(float(r.coupon_disc), 2))})
    ev.append({'m': 'POST', 'path': '/checkout', 'args': f'items={len(t)}', 'amount': round(float(t.sales_value.sum()), 2)})
    return {'basket_id': str(basket_id), 'store_id': store, 'household_id': str(f.household_id), 'week': week,
            'time': f.transaction_timestamp.strftime('%Y-%m-%d %H:%M'), 'events': ev}


@lru_cache(1)
def _products():
    return pd.read_parquet(DS / 'products.parquet').set_index('product_id')


@lru_cache(1)
def _demo():
    return pd.read_parquet(DS / 'demographics.parquet').set_index('household_id')


# ---------------------------------------------------------------- S2 world

def stores():
    def build():
        te = state()['test']
        has = set(pq.read_table(DS / 'promotions.parquet', columns=['store_id']).column('store_id').unique().to_pylist())
        v = te.drop_duplicates('basket_id').groupby('store_id').agg(visits=('basket_id', 'size'), households=('household_id', 'nunique'))
        v['buys'] = te.groupby('store_id').y.sum()
        v = v[v.index.isin(has)].sort_values('visits', ascending=False).head(30)
        return [{'store_id': str(i), **{k: int(r[k]) for k in ['visits', 'households', 'buys']}} for i, r in v.iterrows()]
    return _cached('stores', build)


def latest_run():
    runs = sorted(CACHE.glob('run_*.json'), key=lambda f: f.stat().st_mtime)
    return json.loads(runs[-1].read_text()) if runs else None


def _store_tables(store_id, lo, hi):
    t = pq.read_table(DS / 'transactions.parquet', filters=[('store_id', '=', store_id), ('week', '>=', lo), ('week', '<=', hi)]).to_pandas()
    pl = pq.read_table(DS / 'promotions.parquet', filters=[('store_id', '=', store_id), ('week', '>=', lo), ('week', '<=', hi)]).to_pandas()
    pl['display_location'] = pl.display_location.astype(str)
    pl['mailer_location'] = pl.mailer_location.astype(str)
    p = _products().reset_index()
    for c in ['department', 'brand', 'product_type', 'package_size']:
        p[c] = p[c].astype(str).replace('nan', '')
    return t, p, pl


def top_products():
    s = state()
    return list(s['rows'][s['rows'].week <= AS_OF].groupby('product_id').y.sum().sort_values(ascending=False).index)


def store_map(store_id):
    def build():
        t, p, pl = _store_tables(store_id, AS_OF - 12, AS_OF)
        return spacemap.build_map(t, p, pl, store_id, 'COLD CEREAL', top_products(), AS_OF)
    return _cached(f'map_{store_id}', build)


def world(store_id):
    s = state()
    m = store_map(store_id)
    te = s['test'][s['test'].store_id == store_id]
    v = te.drop_duplicates('basket_id')
    hh = v.groupby('household_id').agg(visits=('basket_id', 'size')).sort_values('visits', ascending=False)
    hh['buys'] = te.groupby('household_id').y.sum()
    first = te.drop_duplicates('household_id').set_index('household_id')
    demo = _demo().index
    out = [{'household_id': str(h), 'visits_test': int(r.visits), 'cereal_buys_test': int(r.buys), 'demographics': bool(h in demo),
            'state': {k: round(float(first.loc[h, k]), 4) for k in ['visits', 'avg_spend', 'cereal_visit_rate', 'disc_share', 'private_share', 'cereal_spend_share']}}
           for h, r in hh.head(40).iterrows()]
    daily = v.groupby('date').size()
    return {'map': m, 'visits_test': int(len(v)), 'households_test': int(te.household_id.nunique()), 'buys_test': int(te.y.sum()),
            'daily_visits': [{'date': d, 'visits': int(n)} for d, n in daily.items()], 'households': out}


# ---------------------------------------------------------------- S3 engines for one household

@lru_cache(1)
def _stored():
    jev = pd.read_parquet(EVAL / 'jev_answers.parquet')
    per = pd.read_parquet(EVAL / 'persona_answers.parquet')
    return jev.astype({'household_id': str, 'product_id': str}), per.astype({'household_id': str, 'product_id': str})


def stored_pairs():
    jev, per = _stored()
    pairs = jev[['household_id', 'product_id']].drop_duplicates().merge(per[['household_id', 'product_id']].drop_duplicates())
    return [{'household_id': h, 'product_id': p} for h, p in pairs.itertuples(index=False)]


def household(hh, product_id=None):
    s = state()
    rows, te = s['rows'], s['test']
    mine = te[te.household_id == hh]
    if mine.empty:
        raise KeyError(f'household {hh} has no visits in weeks {TEST[0]}–{TEST[1]}')
    if product_id is None:
        pairs = [p['product_id'] for p in stored_pairs() if p['household_id'] == hh]
        product_id = pairs[0] if pairs else mine.product_id.value_counts().index[0]
    one = mine[mine.product_id == product_id]
    f = one.iloc[0]
    probe = one.iloc[[0]]
    engines = []
    for name in ['calibrated', 'no_promo', 'avg_lift']:
        e = s['engines'][name]
        engines.append({'id': name, 'label': e.label, 'note': e.note, 'live': True,
                        'p': {c: float(e.predict(Plan(c, c).apply(probe))[0]) for c in PLANS}})
    jev, per = _stored()
    for df, var, label, note in [(per, 'basic', '페르소나 · GPT', '인구통계 설명으로 역할극 · 저장된 평가 답'),
                                 (per, 'history', '페르소나 + 이력', '설명 + 구매 이력 숫자 · 저장된 평가 답'),
                                 (jev, 'jev_text', 'Jev · 글', 'jev-1.13 · 학습 없이 · 저장된 평가 답'),
                                 (jev, 'jev_state', 'Jev · 숫자 상태', 'jev-1.13 · 학습 없이 · 저장된 평가 답')]:
        d = df[(df.household_id == hh) & (df.product_id == product_id) & (df.variant == var)]
        if len(d):
            engines.append({'id': var, 'label': label, 'note': note, 'live': False, 'p': {r.condition: float(r.p) for r in d.itertuples()}})
    demo = _demo()
    d = demo.loc[hh].astype(str).to_dict() if hh in demo.index else None
    receipts = pq.read_table(DS / 'transactions.parquet', filters=[('household_id', '=', hh), ('week', '>=', TEST[0]), ('week', '<=', TEST[1])]).to_pandas()
    prod = _products()
    rec = []
    for b, g in receipts.groupby('basket_id'):
        cats = prod.reindex(g.product_id).product_category.dropna().value_counts().index[:2].str.lower().tolist()
        rec.append({'basket_id': str(b), 'store_id': str(g.store_id.iloc[0]), 'time': g.transaction_timestamp.min().strftime('%m/%d %H:%M'),
                    'items': int(len(g)), 'total': round(float(g.sales_value.sum()), 2), 'top': cats,
                    'bought_this': bool((g.product_id == product_id).any()),
                    'cereal': bool(prod.reindex(g.product_id).product_category.eq('COLD CEREAL').any())})
    rec.sort(key=lambda r: r['time'])
    pr = s['products'].loc[product_id]
    return {'household_id': hh, 'product': {'product_id': product_id, 'brand': pr.brand, 'type': pr.product_type, 'size': pr.package_size,
                                            'price': float(pr.shelf_price)},
            'state': {k: round(float(f[k]), 4) for k in ['visits', 'avg_spend', 'cereal_visit_rate', 'disc_share', 'private_share', 'cereal_spend_share', 'hp_count']},
            'demographics': d, 'actual': {'visits': int(mine.basket_id.nunique()), 'bought_this': int(one.y.sum()),
                                          'cereal_visits': int(sum(r['cereal'] for r in rec))},
            'receipts': rec, 'engines': engines, 'labels': LABEL}


def persona_live(hh, product_id):
    """Ask the OpenAI model the same question the persona engine was asked, four store conditions."""
    demo = _demo()
    if hh not in demo.index:
        raise KeyError('this household has no demographics; the persona engine needs them')
    d = demo.loc[hh]
    pr = state()['products'].loc[product_id]
    who = f"Age {d.age}, household income {d.income}, {d.marital_status}, household of {d.household_size} ({d.household_comp})."
    what = f"a {str(pr.brand).lower()}-brand {str(pr.product_type).lower()} ({pr.package_size} box)"
    cond = {'none': 'on its regular shelf in the cereal aisle, no special display, no ad',
            'A_front_endcap': 'stacked on the front end-cap display near the store entrance',
            'B_mailer_only': "featured in this week's store mailer, regular shelf in store",
            'C_other_display': 'on an extra in-store display inside the aisle'}
    prompt = (f"You are this shopper: {who} You are on one grocery trip. This week {what} is: " +
              '; '.join(f'[{k}] {v}' for k, v in cond.items()) +
              '. For each bracketed case separately, give the probability (0-1) that you put this exact product in your basket on this trip. '
              'Answer only JSON: {"none":p,"A_front_endcap":p,"B_mailer_only":p,"C_other_display":p}')
    txt = llm_text(prompt, json_mode=True, purpose='persona')
    p = json.loads(txt)
    return {'id': 'persona_live', 'label': f'페르소나 · {llm_model()} (지금)', 'note': '같은 질문을 방금 다시 물음', 'live': True,
            'p': {c: float(p[c]) for c in PLANS}}


# ---------------------------------------------------------------- S4/S5 plans and run

def plans():
    rows = state()['rows']
    c = rows.condition.value_counts()
    return [{'id': k, 'label': LABEL[k], 'evidence_rows': int(c.get(k, 0)),
             'desc': {'A_front_endcap': '입구 쪽 통로 끝 · 진열 코드 3', 'B_mailer_only': '주간 전단 · 매장은 평소 진열',
                      'C_other_display': '통로 안 · 뒤쪽 · 보조 진열', 'none': '비교 기준'}[k]} for k in PLANS]


def run_plans(engine_ids=('calibrated', 'no_promo', 'avg_lift'), draws=50, seed=42):
    """Every plan applied to every held-out visit; actual = real rate on the visits that really had that condition."""
    s = state()
    te = s['test']
    cond = condition_name(te)
    actual = {c: float(te.y[cond == c].mean() * 1000) for c in PLANS}
    out = {'id': uuid.uuid4().hex[:8], 'at': time.strftime('%Y-%m-%d %H:%M'), 'weeks': list(TEST), 'decisions': int(len(te)),
           'visits': int(te.basket_id.nunique()), 'actual_buys': int(te.y.sum()), 'seed': seed, 'draws': draws,
           'actual_per_1000': actual, 'engines': []}
    # Same customers, same luck: one uniform per (visit, product, draw), shared by every plan and engine.
    keys = te.basket_id.astype(str) + ':' + te.product_id.astype(str)
    h0 = pd.util.hash_pandas_object(keys, index=False).to_numpy(np.uint64)
    U = [_mix(h0, seed + d) for d in range(draws)]
    for name in engine_ids:
        e = s['engines'][name]
        memo = s.setdefault('pred', {})          # predictions are deterministic; only the draws change with the seed
        P = {c: memo.setdefault((name, c), e.predict(Plan(c, c).apply(te))) if (name, c) not in memo else memo[(name, c)] for c in PLANS}
        tot = {c: np.array([(u < P[c]).sum() for u in U]) for c in PLANS}
        plans_out = []
        for c in PLANS:
            per = float(P[c].mean() * 1000)
            plans_out.append({'id': c, 'label': LABEL[c], 'per_1000': per, 'lift': float(P[c].sum() / P['none'].sum()),
                              'expected_units': float(P[c].sum()), 'mc_p05': float(np.percentile(tot[c], 5)), 'mc_p95': float(np.percentile(tot[c], 95)),
                              'share_of_draws_above_none': float((tot[c] > tot['none']).mean()),
                              'ratio_to_actual': per / actual[c] if actual[c] else None})
        out['engines'].append({'id': name, 'label': e.label, 'note': e.note, 'live': True, 'plans': plans_out})
    jc = json.loads((EVAL / 'jev_calib_results.json').read_text())['engines']['jev_calibrated']['by_condition']
    pr = json.loads((EVAL / 'persona_results.json').read_text())['engines']['basic']['mean_p_by_condition']
    for eid, label, note, src in [('jev_calibrated', 'Jev + 매장 보정', 'jev-1.13 순위 · 45–47주 실제 구매로 보정 · 저장된 평가 표본', jc),
                                  ('persona', '페르소나', 'GPT · 가구 설명 · 80쌍 표본 · 저장된 평가', pr)]:
        base = src['none']
        out['engines'].append({'id': eid, 'label': label, 'note': note, 'live': False, 'plans': [
            {'id': c, 'label': LABEL[c], 'per_1000': src[c] * 1000, 'lift': src[c] / base, 'ratio_to_actual': src[c] * 1000 / actual[c]} for c in PLANS]})
    (CACHE / f"run_{out['id']}.json").write_text(json.dumps(out, ensure_ascii=False))
    return out


def _mix(h, seed):
    """splitmix64 of (key hash, seed) -> uniform in [0, 1). Hash the keys once, then each draw is a few vector ops."""
    with np.errstate(over='ignore'):
        z = h + np.uint64(seed) * np.uint64(0x9E3779B97F4A7C15)
        z = (z ^ (z >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
        z = (z ^ (z >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
        z = z ^ (z >> np.uint64(31))
    return (z >> np.uint64(11)).astype(np.float64) * 2.0 ** -53


def validation():
    v = json.loads((SIM / 'results' / 'validation.json').read_text())
    r = json.loads((EVAL / 'results.json').read_text())
    jc = json.loads((EVAL / 'jev_calib_results.json').read_text())
    pe = json.loads((EVAL / 'persona_results.json').read_text())
    return {'simulator': v, 'model_eval': r, 'jev': jc, 'persona': pe,
            'report': json.loads((EVAL / 'report_numbers.json').read_text())}


# ---------------------------------------------------------------- S6 final layout

def layout(store_id, objective='revenue', draws=200):
    def build():
        s = state()
        m = store_map(store_id)
        current = {p['product_id']: p['condition'] for p in m['products']}
        sched = s['test'][(s['test'].store_id == store_id) & s['test'].product_id.isin(current)].reset_index(drop=True)
        if sched.empty:
            raise KeyError(f'store {store_id} has no visits in weeks {TEST[0]}–{TEST[1]}')
        e = s['engines']['calibrated']
        lay, table, moves = choose_layout(sched, e, s['products'], m['capacity'], current, objective=objective)
        L = run(sched, [Plan('actual', 'actual', label='실제 진열 그대로'), Plan('current', 'layout', layout=current, label=f'{AS_OF}주 배치 고정'),
                        Plan('proposed', 'layout', layout=lay, label='제안 배치')], e, s['products'], draws=draws, seed=42, baseline='current')
        real = int(sched.y.sum())
        act = L['plans'][0]['totals']
        opt = {r['product_id']: r for r in table}
        return {'store_id': store_id, 'as_of': AS_OF, 'weeks': list(TEST), 'objective': objective, 'capacity': m['capacity'],
                'aisles': m['aisles'], 'category': m['category'], 'visits': int(sched.basket_id.nunique()), 'households': int(sched.household_id.nunique()),
                'products': [{'n': p['n'], 'id': p['product_id'], 'name': f"{p['brand']} {p['type'].title()}", 'size': p['size'],
                              'now': p['condition'], 'next': lay[p['product_id']], 'moved': lay[p['product_id']] != p['condition'],
                              'mailer': p['mailer'] != '0',
                              'units': {o: round(opt[p['product_id']][f'{o}_units'], 2) for o in ['none', 'A_front_endcap', 'C_other_display']},
                              'gain': round(opt[p['product_id']]['gain_revenue_vs_shelf'], 2)} for p in m['products']],
                'plans': {x['id']: {'label': x['label'], **{k: x['totals'][k] for k in ['expected_units', 'mc_p05', 'mc_p95', 'expected_revenue']},
                                    **x['vs_baseline']} for x in L['plans']},
                'validation': {'actual': real, 'expected': act['expected_units'], 'mc_p05': act['mc_p05'], 'mc_p95': act['mc_p95'],
                               'in_band': bool(act['mc_p05'] <= real <= act['mc_p95'])},
                'labels': LABEL}
    return _cached(f'layout_{store_id}_{objective}', build)


# ---------------------------------------------------------------- S7 report

def report():
    r = json.loads((EVAL / 'report_numbers.json').read_text())
    v = json.loads((SIM / 'results' / 'validation.json').read_text())
    return {'recommendation': 'A_front_endcap', 'label': LABEL['A_front_endcap'], 'numbers': r,
            'effects': v['effects'], 'reproduction': v['report_reproduction'],
            'auc': json.loads((EVAL / 'jev_calib_results.json').read_text())['engines']['gbdt_calibrated']['auc']}   # the evaluation's AUC, same as the sidebar


# ---------------------------------------------------------------- LLM (question structuring, explanations, persona)

USAGE_LOG = Path(__file__).resolve().parent / 'cache' / 'llm_usage.jsonl'


def llm_model():
    """The model that answers: Claude when ANTHROPIC_API_KEY is set (app/.env), otherwise OpenAI."""
    if os.environ.get('ANTHROPIC_API_KEY'):
        return os.environ.get('ANTHROPIC_MODEL', 'claude-sonnet-5-5')
    return os.environ.get('OPENAI_MODEL', 'gpt-5-mini')


def has_llm():
    return bool(os.environ.get('ANTHROPIC_API_KEY') or os.environ.get('OPENAI_API_KEY'))


def _log_usage(provider, model, purpose, inp, out):
    """One line per call, so spend can be added up later: app/cache/llm_usage.jsonl."""
    try:
        USAGE_LOG.parent.mkdir(exist_ok=True)
        with open(USAGE_LOG, 'a') as f:
            f.write(json.dumps({'at': time.strftime('%Y-%m-%d %H:%M:%S'), 'provider': provider, 'model': model, 'purpose': purpose,
                                'input_tokens': inp, 'output_tokens': out}) + '\n')
    except OSError:
        pass


def _http_error(who, e):
    try:
        err = json.loads(e.read()).get('error') or {}
    except Exception:
        err = {}
    # OpenAI's 429 is either a spent balance or a rate limit; only the body says which
    return RuntimeError(f"{who} HTTP {e.code} {err.get('code') or err.get('type') or ''}: {(err.get('message') or e.reason)[:160]}".strip())


def llm_text(prompt, json_mode=False, system=None, purpose='app'):
    """Claude first (ANTHROPIC_API_KEY), OpenAI otherwise. json_mode asks for a bare JSON object and returns its text."""
    if not has_llm():
        raise RuntimeError('no language model key (ANTHROPIC_API_KEY or OPENAI_API_KEY)')
    if os.environ.get('ANTHROPIC_API_KEY'):
        model = llm_model()
        body = {'model': model, 'max_tokens': 1024,
                'messages': [{'role': 'user', 'content': prompt + ('\n\nReturn one JSON object only, no prose, no code fence.' if json_mode else '')}]}
        if system:
            body['system'] = system
        req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps(body).encode(),
                                     headers={'x-api-key': os.environ['ANTHROPIC_API_KEY'], 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise _http_error('Claude', e) from None
        u = d.get('usage') or {}
        _log_usage('anthropic', model, purpose, u.get('input_tokens'), u.get('output_tokens'))
        txt = ''.join(c.get('text', '') for c in d.get('content', []) if c.get('type') == 'text')
        if json_mode:
            m = re.search(r'\{.*\}', txt, re.S)
            txt = m.group(0) if m else txt
        return txt
    model = llm_model()
    body = {'model': model, 'messages': ([{'role': 'system', 'content': system}] if system else []) + [{'role': 'user', 'content': prompt}]}
    if json_mode:
        body['response_format'] = {'type': 'json_object'}
    req = urllib.request.Request(os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com/v1') + '/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Authorization': f"Bearer {os.environ['OPENAI_API_KEY']}", 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise _http_error('OpenAI', e) from None
    u = d.get('usage') or {}
    _log_usage('openai', model, purpose, u.get('prompt_tokens'), u.get('completion_tokens'))
    return d['choices'][0]['message']['content']


def brief(question):
    """Turn one line into a testable decision. The plans can only be conditions the data actually saw."""
    spec = {'question': question, 'category': 'COLD CEREAL', 'plans': PLANS, 'metric': '방문 1,000회당 판매 · 반응한 가구층',
            'weeks': list(TEST), 'structured_by': 'rules'}
    if has_llm():
        try:
            txt = llm_text(
                f'Shopper question: "{question}". Available plans (only these were ever observed in the store data): '
                f'{json.dumps({k: LABEL[k] for k in PLANS}, ensure_ascii=False)}. Return JSON '
                '{"question": a one-sentence Korean restatement as a measurable decision, "plans": the ids of the plans the question asks about '
                '(always include "none" as the baseline), "excluded": [Korean notes for anything asked that the data cannot test, e.g. price discounts]}',
                json_mode=True, system='You turn a store manager\'s question into a testable decision. Never invent plans.', purpose='brief')
            j = json.loads(txt)
            spec.update(question=j.get('question') or question, plans=[p for p in j.get('plans', PLANS) if p in PLANS] or PLANS,
                        excluded=j.get('excluded', []), structured_by=llm_model())
        except Exception as e:      # the decision still runs; say why the model was not used
            spec['llm_error'] = str(e)[:200]
    if 'none' not in spec['plans']:
        spec['plans'].append('none')
    q = question.lower()
    if 'excluded' not in spec:
        spec['excluded'] = ['할인: 사지 않은 방문의 가격이 기록에 없어 시험할 수 없음'] if any(k in q for k in ['할인', 'discount', '가격', 'price']) else []
    return spec


# ---------------------------------------------------------------- S8 connect a store

COLUMN_HINTS = {
    'household_id': ['household', 'member', 'customer', 'card', '회원', '고객'],
    'store_id': ['store', 'shop', 'branch', '매장', '지점'],
    'basket_id': ['basket', 'receipt', 'ticket', 'order', 'transaction_id', '영수증', '주문'],
    'product_id': ['product', 'item', 'sku', 'upc', 'barcode', '상품', '품목'],
    'quantity': ['qty', 'quantity', 'count', '수량'],
    'sales_value': ['paid', 'amount', 'sales', 'total', 'price', '금액', '매출'],
    'transaction_timestamp': ['time', 'date', 'timestamp', '일시', '시각', '날짜'],
    'retail_disc': ['discount', 'disc', '할인'],
}
ENDPOINT_OF = {'basket_id': 'POST /visit', 'product_id': 'POST /basket/add', 'quantity': 'POST /basket/add', 'sales_value': 'POST /checkout',
               'retail_disc': 'POST /price/discount', 'household_id': '가구 상태 (비식별)', 'store_id': 'POST /visit', 'transaction_timestamp': 'POST /visit'}


def map_columns(columns):
    used, out = set(), []
    for col in columns:
        k = col.lower().replace(' ', '_')
        hit = next((f for f, hints in COLUMN_HINTS.items() if f not in used and (k == f or any(h in k for h in hints))), None)
        if hit:
            used.add(hit)
        out.append({'column': col, 'field': hit, 'endpoint': ENDPOINT_OF.get(hit)})
    missing = [f for f in ['household_id', 'store_id', 'basket_id', 'product_id', 'quantity', 'sales_value', 'transaction_timestamp'] if f not in used]
    return {'columns': out, 'missing': missing}


JOBS = {}


def connect(files):
    """files: {'transactions': bytes, 'products': bytes?, 'placements': bytes?}. Runs the full cycle in the background."""
    jid = uuid.uuid4().hex[:8]
    d = CACHE / f'upload_{jid}'
    d.mkdir()
    tx = pd.read_csv(pd.io.common.BytesIO(files['transactions']), dtype=str)      # ids stay text: 852856 must not become 852856.0
    mapping = map_columns(list(tx.columns))
    JOBS[jid] = {'id': jid, 'status': 'mapping', 'mapping': mapping, 'log': [f'{len(tx):,}줄 · 열 {len(tx.columns)}개']}
    if mapping['missing']:
        JOBS[jid].update(status='needs_columns', error=f"이 열을 찾지 못했습니다: {', '.join(mapping['missing'])}")
        return JOBS[jid]
    tx = tx.rename(columns={m['column']: m['field'] for m in mapping['columns'] if m['field']})
    for c in ['quantity', 'sales_value', 'retail_disc']:
        if c in tx.columns:
            tx[c] = pd.to_numeric(tx[c], errors='coerce').fillna(0)
    ts = pd.to_datetime(tx.transaction_timestamp)
    if 'week' not in tx.columns:
        tx['week'] = ((ts - ts.min()).dt.days // 7 + 1).astype(int)
    tx.to_csv(d / 'transactions.csv', index=False)
    if files.get('products'):
        (d / 'products.csv').write_bytes(files['products'])
    else:
        pd.DataFrame({'product_id': tx.product_id.astype(str).unique(), 'product_category': 'ALL'}).to_csv(d / 'products.csv', index=False)
    if files.get('placements'):
        (d / 'placements.csv').write_bytes(files['placements'])

    def work():
        import subprocess
        JOBS[jid].update(status='running')
        cats = pd.read_csv(d / 'products.csv', dtype=str).product_category
        cat = 'COLD CEREAL' if (cats == 'COLD CEREAL').any() else cats.value_counts().index[0]
        p = subprocess.run([sys.executable, str(SIM / 'cycle.py'), '--data', str(d), '--name', f'upload_{jid}', '--category', str(cat), '--draws', '100'],
                           capture_output=True, text=True, cwd=SIM)
        JOBS[jid]['log'] += p.stdout.splitlines()[:3] + p.stderr.splitlines()[-5:]
        rep = SIM / 'runs' / f'upload_{jid}' / 'REPORT.md'
        JOBS[jid].update(status='done' if p.returncode == 0 else 'failed', report=rep.read_text() if rep.exists() else None)
        if p.returncode == 0:
            import viewer3d
            JOBS[jid]['layout'] = viewer3d.payload(SIM / 'runs' / f'upload_{jid}')
    threading.Thread(target=work, daemon=True).start()
    return JOBS[jid]


def sample_files(store_id='367'):
    """A POS-style export of one real store, with the column names a store would use, to try S8 with."""
    t = pq.read_table(DS / 'transactions.parquet', filters=[('store_id', '=', store_id)]).to_pandas()
    pos = pd.DataFrame({'receipt_no': t.basket_id, 'member_id': t.household_id, 'branch': t.store_id, 'item_code': t.product_id,
                        'qty': t.quantity, 'paid_total': t.sales_value.round(2), 'discount_amt': t.retail_disc.round(2),
                        'datetime': t.transaction_timestamp.dt.strftime('%Y-%m-%d %H:%M:%S')})
    prod = _products().reindex(t.product_id.unique()).reset_index()
    prod = prod.rename(columns={'index': 'product_id'})[['product_id', 'product_category', 'department', 'brand', 'product_type', 'package_size']]
    pl = pq.read_table(DS / 'promotions.parquet', filters=[('store_id', '=', store_id)]).to_pandas()
    pl = pl[pl.product_id.isin(set(prod.product_id))]
    pl = pl[(pl.display_location.astype(str) != '0') | (pl.mailer_location.astype(str) != '0')]
    w0 = t.week.min()
    pl = pl.assign(week=pl.week - w0 + 1)
    return {'name': f'store_{store_id}', 'transactions': pos.to_csv(index=False), 'products': prod.to_csv(index=False),
            'placements': pl[['product_id', 'store_id', 'week', 'display_location', 'mailer_location']].to_csv(index=False)}
