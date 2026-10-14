"""Validation mode: run the simulator on weeks it never saw and put it next to what really happened.

1. Replay weeks 48-53 with the store's actual conditions (plan 'actual') for every engine, and
   compare simulated sales with real sales: in total, per week, per condition, per store, per
   household segment. The 90% band is customer luck only (Monte Carlo over the same probabilities).
2. Reproduce the report's impact numbers (0.94 -> 3.45 per 1,000) from the simulator itself.
3. Effect check: the simulator's endcap / other-display / mailer lift against the real lift
   measured within product x week (stores that did it vs stores that did not), bootstrap 95%.

Writes results/validation.json, results/validation_ledger.json and VALIDATION.md.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import log_loss, roc_auc_score

from sim import CONDS, HERE, LABEL, Plan, condition_name, load, replay_schedule, run, train_engines

DRAWS, SEED = 200, 42
rows, products = load()
engines = train_engines(rows)
te = replay_schedule(rows, (48, 53))
actual = Plan('actual', 'actual')
res = {'weeks': [48, 53], 'draws': DRAWS, 'decisions': int(len(te)), 'visits': int(te.basket_id.nunique()),
       'households': int(te.household_id.nunique()), 'stores': int(te.store_id.nunique()), 'actual_units': int(te.y.sum()), 'engines': {}}

# ---- 1. simulated vs real, store conditions as they actually were
week_actual = te.groupby('week').y.sum()
cond_actual = te.assign(c=condition_name(te)).groupby('c').y.agg(['sum', 'size'])
store_actual = te.groupby('store_id').y.sum()
ledgers = {}
for name, eng in engines.items():
    L = run(te, [actual], eng, products, draws=DRAWS, seed=SEED)
    ledgers[name] = L
    plan = L['plans'][0]
    p = eng.predict(te)
    weekly = [{**w, 'actual_units': int(week_actual[w['week']]),
               'actual_in_band': bool(w['mc_p05'] <= week_actual[w['week']] <= w['mc_p95'])} for w in plan['weekly']]
    store_exp = pd.Series(p, index=te.store_id.values).groupby(level=0).sum().reindex(store_actual.index)
    res['engines'][name] = {
        'label': eng.label,
        'total': {'actual': int(te.y.sum()), 'expected': plan['totals']['expected_units'],
                  'mc_p05': plan['totals']['mc_p05'], 'mc_p95': plan['totals']['mc_p95'],
                  'actual_in_band': bool(plan['totals']['mc_p05'] <= te.y.sum() <= plan['totals']['mc_p95'])},
        'weekly': weekly, 'weeks_in_band': int(sum(w['actual_in_band'] for w in weekly)),
        'by_condition': [{'condition': c, 'label': LABEL[c], 'decisions': int(cond_actual.loc[c, 'size']),
                          'actual_units': int(cond_actual.loc[c, 'sum']), 'expected_units': float(plan['by_condition'][c]['expected_units'])}
                         for c in CONDS if c in cond_actual.index],
        'stores': {'n': int(len(store_actual)), 'spearman': float(spearmanr(store_exp, store_actual).statistic),
                   'mean_abs_error_units': float((store_exp - store_actual).abs().mean())},
        'by_segment': [{**s, 'actual_units': int(te.y[_m].sum())} for s, _m in zip(plan['by_segment'], [
            te.hp_count > 0, te.hp_count == 0,
            te.cereal_visit_rate >= te.cereal_visit_rate.quantile(2 / 3), te.cereal_visit_rate <= te.cereal_visit_rate.quantile(1 / 3),
            te.disc_share >= te.disc_share.quantile(2 / 3), te.disc_share <= te.disc_share.quantile(1 / 3)])],
        'per_decision': {'auc': float(roc_auc_score(te.y, p)), 'log_loss': float(log_loss(te.y, p))},
    }

# ---- 2. the report's impact numbers, from the simulator
E = te[condition_name(te) == 'A_front_endcap']
R = run(E, [Plan('none', 'none'), Plan('A_front_endcap', 'A_front_endcap')], engines['calibrated'], products, draws=DRAWS, seed=SEED)
res['report_reproduction'] = {'rows': int(len(E)), 'report': {'per_1000_without': 0.9414, 'per_1000_with': 3.4458},
                              'simulator': {'per_1000_without': R['plans'][0]['totals']['per_1000_decisions'],
                                            'per_1000_with': R['plans'][1]['totals']['per_1000_decisions'],
                                            'lift': R['plans'][1]['vs_baseline']['lift']}}

# ---- 3. effect sizes: simulator lift vs real lift within product x week
rng = np.random.default_rng(0)


def actual_lift(df, cname, B=1000):
    g = df.assign(c=condition_name(df))
    g = g[g.c.isin([cname, 'none'])].groupby(['product_id', 'week', 'c']).y.agg(['sum', 'size']).unstack('c').dropna()
    if g.empty:
        return None
    xs, xn, ns, nn = (g[(k, c)].to_numpy() for k, c in [('sum', cname), ('size', cname), ('sum', 'none'), ('size', 'none')])

    def est(ix):
        exp = (xn[ix] * ns[ix] / nn[ix]).sum()
        return xs[ix].sum() / exp if exp > 0 else np.nan
    point = est(np.arange(len(g)))
    if not np.isfinite(point):
        return None          # no store ran it in a week another store did not: nothing to compare against
    boot = [est(rng.integers(0, len(g), len(g))) for _ in range(B)]
    return {'lift': float(point), 'lo': float(np.nanpercentile(boot, 2.5)), 'hi': float(np.nanpercentile(boot, 97.5)),
            'cells': int(len(g)), 'buys_in_condition': int(xs.sum())}


res['effects'] = {}
for cname in ['A_front_endcap', 'C_other_display', 'B_mailer_only']:
    X = te[condition_name(te) == cname]
    a = actual_lift(te, cname)
    sims = {}
    for name, eng in engines.items():
        L = run(X, [Plan('none', 'none'), Plan(cname, cname)], eng, products, draws=50, seed=SEED)
        sims[name] = L['plans'][1]['vs_baseline']['lift']
    res['effects'][cname] = {'label': LABEL[cname], 'actual': a, 'simulated': sims,
                             'in_range': {n: (a is not None and a['lo'] <= v <= a['hi']) for n, v in sims.items()}}

out = HERE / 'results'
out.mkdir(exist_ok=True)
(out / 'validation.json').write_text(json.dumps(res, ensure_ascii=False, indent=1))
(out / 'validation_ledger.json').write_text(json.dumps(ledgers['calibrated'], ensure_ascii=False, indent=1))

# ---- report
c = res['engines']['calibrated']
lines = ['# 시뮬레이터 검증 · 본 적 없는 6주 (48–53주)', '',
         f"실제 방문 {res['visits']:,}회 · 가구 {res['households']:,}곳 · 매장 {res['stores']}곳 · 방문×상품 결정 {res['decisions']:,}건 · 실제 판매 방문 {res['actual_units']}건. "
         f"매장 조건은 실제 그대로 두고, 손님 운은 {DRAWS}번 추첨으로 흔들었다. 90% 범위는 손님 운만 담고 모델 오차는 담지 않는다.", '',
         '## 1. 총량 · 주별', '', '| 엔진 | 실제 | 시뮬레이션 기대 | 90% 범위 | 실제가 범위 안 | 범위 안 주 (6주 중) | 매장 순위 상관 | AUC |', '|---|---|---|---|---|---|---|---|']
for n, e in res['engines'].items():
    t = e['total']
    lines.append(f"| {e['label']} | {t['actual']} | {t['expected']:.1f} | {t['mc_p05']:.0f}–{t['mc_p95']:.0f} | {'✓' if t['actual_in_band'] else '✗'} | {e['weeks_in_band']} | {e['stores']['spearman']:.2f} | {e['per_decision']['auc']:.3f} |")
lines += ['', '보정 모델의 주별:', '', '| 주 | 방문 | 실제 | 기대 | 90% 범위 |', '|---|---|---|---|---|']
for w in c['weekly']:
    lines.append(f"| {w['week']} | {w['visits']:,} | {w['actual_units']} | {w['expected_units']:.1f} | {w['mc_p05']:.0f}–{w['mc_p95']:.0f} {'✓' if w['actual_in_band'] else '✗'} |")
lines += ['', '## 2. 조건별 (보정 모델)', '', '| 조건 | 결정 | 실제 | 기대 |', '|---|---|---|---|']
for r in c['by_condition']:
    lines.append(f"| {r['label']} | {r['decisions']:,} | {r['actual_units']} | {r['expected_units']:.1f} |")
lines += ['', '## 3. 가구층별 (보정 모델)', '', '| 가구층 | 결정 | 실제 | 기대 |', '|---|---|---|---|']
for s in c['by_segment']:
    lines.append(f"| {s['segment']} | {s['decisions']:,} | {s['actual_units']} | {s['expected_units']:.1f} |")
r = res['report_reproduction']
lines += ['', '## 4. 리포트 숫자 재현', '',
          f"실제로 엔드캡이었던 {r['rows']:,}건에서 엔드캡을 뺀 경우와 둔 경우를 같은 손님·같은 운으로 시뮬레이션: "
          f"1,000결정당 **{r['simulator']['per_1000_without']:.2f} → {r['simulator']['per_1000_with']:.2f}** (리포트 {r['report']['per_1000_without']:.2f} → {r['report']['per_1000_with']:.2f}), ×{r['simulator']['lift']:.2f}.", '',
          '## 5. 효과 크기 · 시뮬레이터 vs 실제 (같은 상품·같은 주, 48–53주만)', '',
          '| 조건 | 실제 효과 | 95% 범위 | 보정 모델 | 평소대로 예측 | 평균 효과 |', '|---|---|---|---|---|---|']
for cname, e in res['effects'].items():
    a = e['actual']
    rng_txt = f"{a['lo']:.2f}–{a['hi']:.2f}" if a else '판정 불가'
    cells = ' | '.join(f"{v:.2f} {'✓' if e['in_range'][n] else '✗'}" for n, v in e['simulated'].items())
    lines.append(f"| {e['label']} | {a['lift']:.2f} | {rng_txt} | {cells} |" if a else f"| {e['label']} | — | {rng_txt} | {cells} |")
lines += ['', '## 읽을 때 주의', '',
          '- 실제 효과의 범위는 한 기간(48–53주)만으로 잰 것이라 3개 기간을 합친 리포트 값(3.99배, 2.48–8.56)보다 넓거나 다를 수 있다.',
          '- 전단은 체인 전체에 같은 주에 나가 같은 주 대조 매장이 거의 없다. 범위가 나와도 표본이 작다.',
          '- 판매 수는 "그 상품을 산 방문 수"다. 수량이 아니다.', '- 90% 범위는 같은 확률에서의 손님 운만 반영한다. 모델이 틀릴 가능성은 위 실제 비교로만 확인한다.']
(HERE / 'VALIDATION.md').write_text('\n'.join(lines) + '\n')
print('\n'.join(lines))
