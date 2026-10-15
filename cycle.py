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
  04_final_3d.html                 the chosen layout on a 3D store, animated from the current one (viewer3d.py)
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


def engine_for(info, rows, out):
    """dunnhumby: the evaluation's own table and fitted model (data/), so the cycle, validate.py and the app
    all score with one model. The rebuilt table has the same rows in a different order, and the booster's
    early stopping would otherwise fit a slightly different model from it."""
    if info['name'] == 'dunnhumby' and (HERE / 'data' / 'rows.parquet').exists():
        ref, products = load(HERE / 'data')
        if len(ref) == len(rows) and int(ref.y.sum()) == int(rows.y.sum()):
            return ref, products, train_engines(ref)['calibrated']
    return rows, None, train_engines(rows, cache=out / 'data' / 'engines.pkl')['calibrated']


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
    exe = next((p for p in [Path('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')] + sorted(Path('/opt/pw-browsers').glob('chromium-*/chrome-linux/chrome'))
                + [Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')] if p.exists()), None)
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
    rows, ref_products, engine = engine_for(info, rows, out)
    products = ref_products if ref_products is not None else products
    backtest = info['builtin']
    as_of = split['calib'][1] if backtest else int(rows.week.max())
    horizon = tuple(split['test']) if backtest else (as_of + 1, as_of + a.weeks)
    store = pick_store(rows, pl, horizon if backtest else (split['calib'][0], as_of)) if a.store == 'auto' else a.store
    top = list(rows[rows.week <= as_of].groupby('product_id').y.sum().sort_values(ascending=False).index)
    print(f"data: {info['name']} · table {len(rows):,} rows · products {len(top)} · store {store} · decided as of week {as_of} · "
          f"{'backtest' if backtest else 'forecast'} weeks {horizon[0]}–{horizon[1]}")

    # ---- (1) space map as of the decision week
    m = spacemap.build_map(t, p, pl, store, a.category, top, as_of)
    current = {pr['product_id']: pr['condition'] for pr in m['products']}
    (out / '01_map.json').write_text(json.dumps(m, ensure_ascii=False, indent=1))
    (out / '01_map.svg').write_text(spacemap.render_svg(m, f'① Current layout · as of week {as_of}'))

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
    plans = [Plan('current', 'layout', layout=current, label=f'Week-{as_of} layout held fixed'),
             Plan('proposed', 'layout', layout=layout, label='Proposed layout')]
    if backtest:
        plans.insert(0, Plan('actual', 'actual', label='Actual displays as they were'))
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
    (out / '04_final_map.svg').write_text(spacemap.render_svg(m, f'④ Proposed layout · {len(moves)} moves', changes=[x['product_id'] for x in moves], layout=layout))
    by = {x['id']: x for x in ledger['plans']}
    summary = {pid: {'label': x['label'], **{k: x['totals'][k] for k in ['expected_units', 'mc_p05', 'mc_p95', 'expected_revenue']},
                     **x['vs_baseline']} for pid, x in by.items()}
    (out / '04_ledger.json').write_text(json.dumps({'store_id': store, 'weeks': list(horizon), 'baseline': 'current', 'plans': summary,
                                                    'moves': moves, 'definitions': ledger['definitions']}, ensure_ascii=False, indent=1))
    pngs = [render_png(out / f) for f in ['01_map.svg', '04_final_map.svg']]
    import subprocess, sys
    subprocess.run([sys.executable, str(HERE / 'viewer3d.py'), str(out)], check=True, capture_output=True)   # 04_final_3d.html

    # ---- report
    mk = lambda pid: next(f"{pr['n']}. {pr['brand']} {pr['type'].title()} {pr['size']}".strip() for pr in m['products'] if pr['product_id'] == pid)
    L = [f'# One cycle · {info["name"]} · store {store}', '',
         f"Data: {info['source']} · {info['households']:,} households · {info['stores']} stores · {info['receipt_lines']:,} receipt lines. "
         f"Decision table of {len(rows):,} rows (state weeks {split['state'][0]}–{split['state'][1]}, training weeks {split['train'][0]}–{split['train'][1]}, "
         f"calibration weeks {split['calib'][0]}–{split['calib'][1]}, {'test' if backtest else 'forecast'} weeks {horizon[0]}–{horizon[1]}).", '',
         f"Store choice: {'the store with display records and the most visits in the test weeks' if a.store == 'auto' else 'specified'} → **{store}** "
         f"({m['store']['visits_per_week']} visits per week, {m['store']['households']:,} households).", '',
         '## ① Space map', '', f"![Current layout](01_map.svg)", '',
         f"Data from weeks {m['window_weeks'][0]}–{m['window_weeks'][1]}. {len(m['aisles'])} aisles (share of department sales), {len(m['displays'])} display types used by this store. "
         f"Slots available to the category (a busy week: the 90th-percentile week): front endcap {m['capacity']['A_front_endcap']}, secondary display {m['capacity']['C_other_display']}. "
         f"As of week {as_of}: {sum(c == 'A_front_endcap' for c in current.values())} front endcaps, {sum(c == 'C_other_display' for c in current.values())} secondary displays, "
         f"{sum(c == 'none' for c in current.values())} shelf positions. Coordinates are a template; only the zones, slot counts and positions are data.", '',
         '## ② Simulation · same shoppers, same luck', '',
         f"{sched.basket_id.nunique():,} {'real' if backtest else 'Poisson'} visits · {ledger['run']['households']:,} households · "
         f"{len(sched):,} decisions · {a.draws} draws. Baseline = week-{as_of} layout held fixed.", '',
         '| Plan | Expected sale visits | 90% range (shopper luck) | Revenue | vs. baseline | Draws above baseline |', '|---|---|---|---|---|---|']
    for x in ledger['plans']:
        tt, v = x['totals'], x['vs_baseline']
        L.append(f"| {x['label']} | {tt['expected_units']:.1f} | {tt['mc_p05']:.0f}–{tt['mc_p95']:.0f} | ${tt['expected_revenue']:,.2f} | "
                 f"×{v['lift']:.2f} ({v['extra_units']:+.1f}, ${v['extra_revenue']:+,.2f}) | {v['share_of_draws_above_baseline'] * 100:.1f}% |")
    if val:
        st = val['store_total']
        L += ['', '## ③ Validation · this store, unseen weeks', '',
              f"Simulation run with the actual displays as they were vs. actual sales: total **actual {st['actual']} vs. expected {st['expected']:.1f}** "
              f"(90% {st['mc_p05']:.0f}–{st['mc_p95']:.0f} {'✓' if st['in_band'] else '✗'}), {val['weeks_in_band']} of {len(val['weekly'])} weeks within range, "
              f"product rank correlation {val['product_rank_spearman']:.2f}.", '',
              '| Week | Visits | Actual | Expected | 90% range |', '|---|---|---|---|---|']
        for w in val['weekly']:
            L.append(f"| {w['week']} | {w['visits']} | {w['actual_units']} | {w['expected_units']:.1f} | {w['mc_p05']:.0f}–{w['mc_p95']:.0f} {'✓' if w['in_band'] else '✗'} |")
        L += ['', 'Validation across all stores is in `VALIDATION.md` (`python validate.py`).']
    L += ['', '## ④ Final layout', '', '![Proposed layout](04_final_map.svg)', '',
          f"Objective: maximise {'revenue' if a.objective == 'revenue' else 'sale visits'}. For each product, the expected value on shelf, front endcap and secondary display is simulated over the same visits, "
          f"and the choice is made as an assignment problem within this store's slot counts (front endcap {m['capacity']['A_front_endcap']}, secondary display {m['capacity']['C_other_display']}). Flyers are not a space, so they are left as they were.", '',
          f"{len(moves)} products change:", '', '| Product | Now | Proposed | Expected revenue vs. shelf |', '|---|---|---|---|']
    gain = {r['product_id']: r['gain_revenue_vs_shelf'] for r in table}
    for x in moves:
        L.append(f"| {mk(x['product_id'])} | {x['from_label']} | {x['to_label']} | ${gain[x['product_id']]:+,.2f} |")
    pr_, cu = by['proposed'], by['current']
    L += ['', f"Proposed vs. week-{as_of} layout held fixed: expected {cu['totals']['expected_units']:.1f} → {pr_['totals']['expected_units']:.1f} sale visits "
          f"(×{pr_['vs_baseline']['lift']:.2f}), revenue ${pr_['vs_baseline']['extra_revenue']:+,.2f}, "
          f"above the baseline in {pr_['vs_baseline']['share_of_draws_above_baseline'] * 100:.1f}% of {a.draws} draws.", '',
          '## Caveats when reading', '',
          '- The unit of sales is "the number of visits that bought that product". It is not quantity.',
          '- The effect of the proposed layout is a simulated value. That layout was never actually used, so it cannot be compared directly with real sales; the only evidence is ③ and the effect-size comparison in the full validation.',
          *(['- In the backtest, the optimisation uses the visits that actually came in the test weeks (who came and when). It does not see the purchase outcomes (y), but this list of visits could not be known at decision time.',
             '- The 90% range captures shopper luck only. Model error is checked only by the comparisons with actuals in ③ and `VALIDATION.md`.',
             '- In the full validation, the model put the total about 10% low (684 vs 617) and put sales on visits that were on an endcap low (133 vs 80). The endcap effect size (3.66×, actual 3.18×) is within the actual range.']
            if backtest else
            ["- Future visits are Poisson draws from each household's past visits per week. The 90% range captures shopper luck only.",
             "- There is no validation yet of a model trained on this store's data. The dunnhumby test-set validation numbers must not be carried over to this store."]),
          '- Map coordinates are a template. The data has no floor plan. Only the zones, slot counts and current positions are data.',
          '- Of the display codes, only the front endcap (3) is treated separately; the other displays are grouped in the model into a single "secondary display".']
    (out / 'REPORT.md').write_text('\n'.join(L) + '\n')
    print('\n'.join(L))
    print(f"\n-> {out}  png: {[str(x) for x in pngs if x]}")


if __name__ == '__main__':
    main()
