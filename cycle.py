"""One full cycle: data -> (1) space map -> (2) simulation -> (3) validation -> (4) final layout.

  python cycle.py --dataset dunnhumby            built-in test set, backtest: decide with weeks <= 47,
                                                 score against the real weeks 48-53
  python cycle.py --data my_store/ --weeks 4     your three CSVs: decide with everything you have,
                                                 forecast N weeks of Poisson visits

Writes runs/<name>/:
  data/rows.parquet, data/products.parquet, data/engines.pkl   decision table + fitted models
  01_map.json, 01_map.svg          where the category sits now (as of the decision week)
  02_ledger.json                   simulation of the horizon: actual (backtest only) / current / proposed
  03_validation.json               this store: simulated 'actual' vs real sales (backtest only)
  04_final_map.json, 04_final_map.svg, 04_ledger.json   chosen layout, moves, same customers / same luck
  REPORT.md
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

import spacemap
from datasets import load_dataset
from optimize import choose_layout
from sim import LABEL, Plan, load, poisson_schedule, replay_schedule, run, train_engines
from table import DUNNHUMBY_SPLIT, build_table

HERE = Path(__file__).parent


def stage_data(a, out):
    t, p, pl, info = load_dataset(a.dataset or a.data)
    split = DUNNHUMBY_SPLIT if info['name'] == 'dunnhumby' else None
    d = out / 'data'
    if (d / 'rows.parquet').exists() and (d / 'split.json').exists() and not a.rebuild:
        split = {k: tuple(v) for k, v in json.loads((d / 'split.json').read_text()).items()}
    else:
        rows, products, split = build_table(t, p, pl, category=a.category, k=a.k, private_brand=a.private_brand, split=split)
        d.mkdir(parents=True, exist_ok=True)
        rows.to_parquet(d / 'rows.parquet', index=False)
        products.to_parquet(d / 'products.parquet', index=False)
        (d / 'split.json').write_text(json.dumps(split))
    rows, products = load(d)
    return t, p, pl, info, split, rows, products


def pick_store(rows, pl, weeks):
    has = set(pl.store_id.unique())
    v = rows[rows.week.between(*weeks) & rows.store_id.isin(has)].drop_duplicates('basket_id').store_id.value_counts()
    if v.empty:
        raise SystemExit('no store with placement records has visits in the horizon')
    return str(v.index[0])


def store_validation(sched, ledger, products):
    """Real sales at this store vs the simulated 'actual' plan: total, weekly, product ranking."""
    plan = next(x for x in ledger['plans'] if x['id'] == 'actual')
    real_w = sched.groupby('week').y.sum()
    weekly = [{'week': w['week'], 'visits': w['visits'], 'actual_units': int(real_w.get(w['week'], 0)),
               'expected_units': round(w['expected_units'], 2), 'mc_p05': w['mc_p05'], 'mc_p95': w['mc_p95'],
               'in_band': bool(w['mc_p05'] <= real_w.get(w['week'], 0) <= w['mc_p95'])} for w in plan['weekly']]
    real_p = sched.groupby('product_id').y.sum()
    exp_p = pd.Series({r['product_id']: r['expected_units'] for r in plan['by_product']}).reindex(real_p.index)
    prods = [{'product_id': pid, 'brand': products.brand.get(pid), 'type': products.product_type.get(pid),
              'actual_units': int(real_p[pid]), 'expected_units': round(float(exp_p[pid]), 2)}
             for pid in real_p.sort_values(ascending=False).index]
    t = plan['totals']
    return {'store_total': {'actual': int(sched.y.sum()), 'expected': round(t['expected_units'], 2),
                            'mc_p05': t['mc_p05'], 'mc_p95': t['mc_p95'], 'in_band': bool(t['mc_p05'] <= sched.y.sum() <= t['mc_p95'])},
            'weekly': weekly, 'weeks_in_band': int(sum(w['in_band'] for w in weekly)),
            'product_rank_spearman': float(spearmanr(exp_p, real_p).statistic), 'by_product': prods}


def render_png(svg_path):
    """Chromium headless screenshot of the SVG at its own size (no Python SVG renderer is needed)."""
    import subprocess
    exe = next((p for p in [Path('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')] + sorted(Path('/opt/pw-browsers').glob('chromium-*/chrome-linux/chrome')) if p.exists()), None)
    if exe is None:
        return None
    png = svg_path.with_suffix('.png')
    subprocess.run([str(exe), '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', f'--screenshot={png}',
                    '--window-size=1200,760', '--default-background-color=ffffffff', svg_path.resolve().as_uri()],
                   check=False, capture_output=True, timeout=60)
    return png if png.exists() else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument('--dataset', help="built-in test set ('dunnhumby')")
    src.add_argument('--data', help='folder with transactions.csv, products.csv, placements.csv')
    ap.add_argument('--name', help='run folder name under runs/ (default: dataset name)')
    ap.add_argument('--category', default='COLD CEREAL')
    ap.add_argument('--k', type=int, default=25, help='top products of the category')
    ap.add_argument('--private-brand', default='Private')
    ap.add_argument('--store', default='auto')
    ap.add_argument('--weeks', type=int, default=4, help='forecast horizon for your own data')
    ap.add_argument('--draws', type=int, default=200)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--objective', default='revenue', choices=['revenue', 'units'])
    ap.add_argument('--rebuild', action='store_true', help='rebuild the decision table even if the run has one')
    a = ap.parse_args()

    out = HERE / 'runs' / (a.name or a.dataset or Path(a.data).name)
    out.mkdir(parents=True, exist_ok=True)

    # ---- data
    t, p, pl, info, split, rows, products = stage_data(a, out)
    engine = train_engines(rows, cache=out / 'data' / 'engines.pkl')['calibrated']
    backtest = info['builtin']
    as_of = split['calib'][1] if backtest else int(rows.week.max())
    horizon = tuple(split['test']) if backtest else (as_of + 1, as_of + a.weeks)
    store = pick_store(rows, pl, horizon if backtest else (split['calib'][0], as_of)) if a.store == 'auto' else a.store
    top = list(rows[rows.week <= as_of].groupby('product_id').y.sum().sort_values(ascending=False).index)
    print(f"data: {info['name']} · 표 {len(rows):,}행 · 상품 {len(top)} · 매장 {store} · 결정 기준 {as_of}주 · "
          f"{'백테스트' if backtest else '예측'} {horizon[0]}–{horizon[1]}주")

    # ---- (1) space map as of the decision week
    m = spacemap.build_map(t, p, pl, store, a.category, top, as_of)
    current = {pr['product_id']: pr['condition'] for pr in m['products']}
    (out / '01_map.json').write_text(json.dumps(m, ensure_ascii=False, indent=1))
    (out / '01_map.svg').write_text(spacemap.render_svg(m, f'① 지금 배치 · {as_of}주 기준'))

    # ---- (2) schedule for the horizon at this store
    if backtest:
        sched = replay_schedule(rows, horizon, top)
        sched = sched[sched.store_id == store].reset_index(drop=True)
    else:
        local = rows[rows.store_id == store]
        sched = poisson_schedule(local, a.weeks, top, seed=a.seed, start_week=as_of + 1, rate_weeks=(split['train'][0], as_of))
    if sched.empty:
        raise SystemExit(f'store {store} has no visits in weeks {horizon}')

    # ---- (4) the optimizer runs on the same schedule; (2) is then one ledger of all plans
    layout, table, moves = choose_layout(sched, engine, products, m['capacity'], current, objective=a.objective)
    plans = [Plan('current', 'layout', layout=current, label=f'{as_of}주 배치 고정'),
             Plan('proposed', 'layout', layout=layout, label='제안 배치')]
    if backtest:
        plans.insert(0, Plan('actual', 'actual', label='실제 진열 그대로'))
    ledger = run(sched, plans, engine, products, draws=a.draws, seed=a.seed, baseline='current')
    ledger['store_id'] = store
    (out / '02_ledger.json').write_text(json.dumps(ledger, ensure_ascii=False, indent=1))

    # ---- (3) validation at this store (backtest only: the future has no receipts yet)
    val = store_validation(sched, ledger, products) if backtest else None
    if val:
        (out / '03_validation.json').write_text(json.dumps(val, ensure_ascii=False, indent=1))

    # ---- (4) final map + ledger
    final = {**m, 'schema': 'offline-sim-final-map/1', 'objective': a.objective,
             'layout': layout, 'moves': moves, 'options': table,
             'products': [{**pr, 'proposed': layout[pr['product_id']], 'proposed_label': LABEL[layout[pr['product_id']]],
                           'moved': layout[pr['product_id']] != pr['condition']} for pr in m['products']]}
    (out / '04_final_map.json').write_text(json.dumps(final, ensure_ascii=False, indent=1))
    (out / '04_final_map.svg').write_text(spacemap.render_svg(m, f'④ 제안 배치 · {len(moves)}개 이동', changes=[x['product_id'] for x in moves], layout=layout))
    by = {x['id']: x for x in ledger['plans']}
    summary = {pid: {'label': x['label'], **{k: x['totals'][k] for k in ['expected_units', 'mc_p05', 'mc_p95', 'expected_revenue']},
                     **x['vs_baseline']} for pid, x in by.items()}
    (out / '04_ledger.json').write_text(json.dumps({'store_id': store, 'weeks': list(horizon), 'baseline': 'current', 'plans': summary,
                                                    'moves': moves, 'definitions': ledger['definitions']}, ensure_ascii=False, indent=1))
    pngs = [render_png(out / f) for f in ['01_map.svg', '04_final_map.svg']]

    # ---- report
    mk = lambda pid: next(f"{pr['n']}. {pr['brand']} {pr['type'].title()} {pr['size']}".strip() for pr in m['products'] if pr['product_id'] == pid)
    L = [f'# 한 사이클 · {info["name"]} · 매장 {store}', '',
         f"데이터: {info['source']} · 가구 {info['households']:,} · 매장 {info['stores']} · 영수증 줄 {info['receipt_lines']:,}. "
         f"결정 표 {len(rows):,}행 (상태 {split['state'][0]}–{split['state'][1]}주, 학습 {split['train'][0]}–{split['train'][1]}주, "
         f"보정 {split['calib'][0]}–{split['calib'][1]}주, {'시험' if backtest else '예측'} {horizon[0]}–{horizon[1]}주).", '',
         f"매장 선택: {'진열 기록이 있고 시험 주 방문이 가장 많은 매장' if a.store == 'auto' else '지정'} → **{store}** "
         f"(주당 방문 {m['store']['visits_per_week']}, 가구 {m['store']['households']:,}).", '',
         '## ① 공간맵', '', f"![지금 배치](01_map.svg)", '',
         f"{m['window_weeks'][0]}–{m['window_weeks'][1]}주 데이터. 통로 {len(m['aisles'])}개(부서 매출 비중), 이 매장이 쓴 진열 {len(m['displays'])}종. "
         f"카테고리에 쓸 수 있는 자리(바쁜 주 90%): 앞쪽 엔드캡 {m['capacity']['A_front_endcap']}, 기타 진열 {m['capacity']['C_other_display']}. "
         f"{as_of}주 현재: 앞쪽 엔드캡 {sum(c == 'A_front_endcap' for c in current.values())}개, 기타 진열 {sum(c == 'C_other_display' for c in current.values())}개, "
         f"선반 {sum(c == 'none' for c in current.values())}개. 좌표는 템플릿이고 구역·자리 수·위치만 데이터.", '',
         '## ② 시뮬레이션 · 같은 손님, 같은 운', '',
         f"{'실제 ' if backtest else 'Poisson '}방문 {sched.basket_id.nunique():,}회 · 가구 {ledger['run']['households']:,} · "
         f"결정 {len(sched):,}건 · 추첨 {a.draws}번. 기준선 = {as_of}주 배치 고정.", '',
         '| 안 | 기대 판매 방문 | 90% 범위(손님 운) | 매출 | 기준선 대비 | 기준선보다 많은 추첨 |', '|---|---|---|---|---|---|']
    for x in ledger['plans']:
        tt, v = x['totals'], x['vs_baseline']
        L.append(f"| {x['label']} | {tt['expected_units']:.1f} | {tt['mc_p05']:.0f}–{tt['mc_p95']:.0f} | ${tt['expected_revenue']:,.2f} | "
                 f"×{v['lift']:.2f} ({v['extra_units']:+.1f}, ${v['extra_revenue']:+,.2f}) | {v['share_of_draws_above_baseline'] * 100:.0f}% |")
    if val:
        st = val['store_total']
        L += ['', '## ③ 검증 · 이 매장, 본 적 없는 주', '',
              f"실제 진열 그대로 돌린 시뮬레이션 vs 실제 판매: 총 **실제 {st['actual']} vs 기대 {st['expected']:.1f}** "
              f"(90% {st['mc_p05']:.0f}–{st['mc_p95']:.0f} {'✓' if st['in_band'] else '✗'}), 주별 {val['weeks_in_band']}/{len(val['weekly'])}주 범위 안, "
              f"상품 순위 상관 {val['product_rank_spearman']:.2f}.", '',
              '| 주 | 방문 | 실제 | 기대 | 90% 범위 |', '|---|---|---|---|---|']
        for w in val['weekly']:
            L.append(f"| {w['week']} | {w['visits']} | {w['actual_units']} | {w['expected_units']:.1f} | {w['mc_p05']:.0f}–{w['mc_p95']:.0f} {'✓' if w['in_band'] else '✗'} |")
        L += ['', '전체 매장 검증은 `VALIDATION.md`(`python validate.py`).']
    L += ['', '## ④ 최종 배치', '', '![제안 배치](04_final_map.svg)', '',
          f"목표: {'매출' if a.objective == 'revenue' else '판매 방문 수'} 최대. 상품마다 선반·앞쪽 엔드캡·기타 진열의 기대값을 같은 방문으로 시뮬레이션하고, "
          f"이 매장 자리 수(앞쪽 엔드캡 {m['capacity']['A_front_endcap']}, 기타 진열 {m['capacity']['C_other_display']}) 안에서 배정 문제로 고름. 전단은 공간이 아니라 그대로.", '',
          f"바뀌는 상품 {len(moves)}개:", '', '| 상품 | 지금 | 제안 | 선반 대비 기대 매출 |', '|---|---|---|---|']
    gain = {r['product_id']: r['gain_revenue_vs_shelf'] for r in table}
    for x in moves:
        L.append(f"| {mk(x['product_id'])} | {x['from_label']} | {x['to_label']} | ${gain[x['product_id']]:+,.2f} |")
    pr_, cu = by['proposed'], by['current']
    L += ['', f"제안 vs {as_of}주 배치 고정: 기대 {cu['totals']['expected_units']:.1f} → {pr_['totals']['expected_units']:.1f} 판매 방문 "
          f"(×{pr_['vs_baseline']['lift']:.2f}), 매출 ${pr_['vs_baseline']['extra_revenue']:+,.2f}, "
          f"추첨 {a.draws}번 중 {pr_['vs_baseline']['share_of_draws_above_baseline'] * 100:.0f}%에서 기준선보다 많음.", '',
          '## 읽을 때 주의', '',
          '- 판매 단위는 "그 상품을 산 방문 수"다. 수량이 아니다.',
          '- 제안 배치의 효과는 시뮬레이션 값이다. 실제로 그 배치를 한 적이 없으니 실제 판매와 직접 비교할 수 없고, 근거는 ③과 전체 검증의 효과 크기 비교뿐이다.',
          '- 백테스트에서 최적화는 48–53주에 실제로 온 방문(누가 언제 왔는지)을 쓴다. 구매 결과(y)는 보지 않지만, 47주 시점에 이 방문 목록을 알 수는 없다.',
          '- 90% 범위는 손님 운만 담는다. 모델 오차는 ③과 `VALIDATION.md`의 실제 비교로만 확인한다.',
          '- 전체 검증에서 모델은 총량을 약 10% 낮게 보고(684 vs 617), 엔드캡이었던 방문의 판매를 낮게 봤다(133 vs 80). 엔드캡 효과 크기(3.66배, 실제 3.18배)는 실제 범위 안이다.',
          '- 맵 좌표는 템플릿이다. 데이터에 도면이 없다. 구역·자리 수·현재 위치만 데이터.',
          '- 진열 코드는 앞쪽 엔드캡(3)만 따로 보고, 나머지 진열은 모델에서 "기타 진열" 하나로 묶인다.']
    (out / 'REPORT.md').write_text('\n'.join(L) + '\n')
    print('\n'.join(L))
    print(f"\n-> {out}  png: {[str(x) for x in pngs if x]}")


if __name__ == '__main__':
    main()
