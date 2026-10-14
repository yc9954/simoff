"""Jev as a ranker + our data as the calibrator.

Case-control sampling (all buys + sampled non-buys, reweighted back to the true rates):
  calib  weeks 45-47 : all buys + 1,500 non-buys          -> fit isotonic map  Jev p -> real probability
  test   weeks 48-53 : all buys + 750 non-buys per condition -> evaluate against the calibrated GBDT on the same rows
  lift   500 front-endcap test rows asked twice (endcap / regular shelf) -> decision effect
"""
import hashlib
import json
import sys
import time
import urllib.request
import concurrent.futures as cf
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import log_loss, roc_auc_score, brier_score_loss

S = Path(sys.argv[1])
KEY = (S / '.jev_key').read_text().strip()
rows = pd.read_parquet(S / 'cj_exp/rows.parquet')
pred = pd.read_parquet(S / 'cj_exp/results_test_pred.parquet')
prod = pd.read_parquet(S / 'cj_data/products.parquet').set_index('product_id')
CACHE = S / 'cj_exp/jev_cache'
CACHE.mkdir(exist_ok=True)
COND_TXT = {
    'none': 'regular shelf in the cereal aisle; no special display, no ad this week',
    'A_front_endcap': 'front end-cap display at the head of an aisle near the store entrance this week',
    'B_mailer_only': "featured in this week's store mailer; regular shelf in store",
    'C_other_display': 'extra in-store display inside the aisle this week, besides its regular shelf',
}
QUESTION = {'buy': {'type': 'noul', 'instructions': 'On this one shopping trip, does this shopper put this exact product in the basket?',
                    'criteria': {'true': 'puts this exact product in the basket on this trip', 'false': 'does not buy it on this trip'}}}
rng = np.random.default_rng(11)


def state(r, c):
    pr = prod.loc[r.product_id]
    return {'shopper_last_26_weeks': {'trips_to_this_store': int(r.visits), 'share_of_trips_with_cold_cereal': round(float(r.cereal_visit_rate), 3),
                                      'trips_buying_this_exact_product': int(r.hp_count), 'avg_basket_usd': round(float(r.avg_spend), 1),
                                      'share_of_spend_discounted': round(float(r.disc_share), 3), 'private_label_share_in_cereal': round(float(r.private_share), 3)},
            'product': {'description': f"{pr.brand.lower()}-brand {str(pr.product_type).lower()} ({pr.package_size})",
                        'share_of_all_store_trips_that_buy_it': round(float(r.prod_base), 5)},
            'store_condition_this_week': COND_TXT[c]}


def ask(st):
    body = json.dumps({'model': 'jev-latest', 'state': st, 'questions': QUESTION}, sort_keys=True)
    f = CACHE / (hashlib.sha1(body.encode()).hexdigest() + '.json')
    if f.exists():
        return json.loads(f.read_text())
    for attempt in range(7):
        try:
            req = urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=body.encode(), method='POST',
                                         headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=60) as resp:
                out = json.loads(resp.read())
            rec = {'p': out['answers']['buy']['noul'], 'in_tok': out.get('usage', {}).get('input_tokens', 0)}
            f.write_text(json.dumps(rec))
            return rec
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 529):
                time.sleep(min(60, 2 ** attempt)); continue
            raise
        except Exception:
            time.sleep(min(60, 2 ** attempt))
    raise RuntimeError('gave up')


def run(df, cond_col='condition'):
    sts = [state(r, getattr(r, cond_col)) for r in df.itertuples()]
    out = [None] * len(sts)
    with cf.ThreadPoolExecutor(8) as ex:
        futs = {ex.submit(ask, s): i for i, s in enumerate(sts)}
        for fu in cf.as_completed(futs):
            try:
                out[futs[fu]] = fu.result()
            except Exception:
                out[futs[fu]] = {'p': np.nan, 'in_tok': 0}
    return np.array([o['p'] for o in out], dtype=float), sum(o['in_tok'] for o in out)


tokens = 0
# ---- calibration sample
ca = rows[rows.split == 'calib']
cpos, cneg = ca[ca.y == 1], ca[ca.y == 0]
cs = pd.concat([cpos, cneg.sample(1500, random_state=1)])
cs['w'] = np.where(cs.y == 1, 1.0, len(cneg) / 1500)
cs['jev'], t = run(cs); tokens += t

# ---- test sample, non-buys stratified by condition
te = pred
tpos = te[te.y == 1]
parts = [tpos.assign(w=1.0)]
for c, g in te[te.y == 0].groupby('condition'):
    k = min(750, len(g))
    parts.append(g.sample(k, random_state=2).assign(w=len(g) / k))
ts = pd.concat(parts)
ts['jev'], t = run(ts); tokens += t

# ---- decision effect: 500 front-endcap test rows, asked as endcap and as regular shelf
ec = te[te.condition == 'A_front_endcap'].sample(500, random_state=3)
ec_with, t = run(ec); tokens += t
ec_none = ec.assign(condition='none')
ec_without, t = run(ec_none); tokens += t

# ---- fit the calibration layer on weeks 45-47 only
okc = cs.jev.notna()
iso = IsotonicRegression(out_of_bounds='clip', y_min=1e-6, y_max=1 - 1e-6).fit(cs.jev[okc], cs.y[okc], sample_weight=cs.w[okc])
ts = ts[ts.jev.notna()].copy()
ts['jev_cal'] = iso.predict(ts.jev)


def wece(y, p, w, bins=8):
    q = pd.qcut(pd.Series(p).rank(method='first'), bins, labels=False)
    d = pd.DataFrame({'y': y, 'p': p, 'w': w, 'q': q.values})
    g = d.groupby('q').apply(lambda x: pd.Series({'y': np.average(x.y, weights=x.w), 'p': np.average(x.p, weights=x.w), 'w': x.w.sum()}), include_groups=False)
    return float((g.w * (g.y - g.p).abs()).sum() / g.w.sum())


res = {'calls': int(len(cs) + len(ts) + 2 * len(ec)), 'input_tokens': int(tokens), 'est_cost_usd': round(tokens / 1e6 * 0.042, 4),
       'calib_sample': {'buys': int(cpos.shape[0]), 'non_buys': 1500}, 'test_sample': {'buys': int(tpos.shape[0]), 'non_buys': int(len(ts) - tpos.shape[0])},
       'engines': {}}
for name, col in [('jev_raw', 'jev'), ('jev_calibrated', 'jev_cal'), ('gbdt_calibrated', 'p_calibrated'), ('no_promo', 'p_no_promo')]:
    p = ts[col].clip(1e-6, 1 - 1e-6).values
    res['engines'][name] = {'log_loss': float(log_loss(ts.y, p, sample_weight=ts.w)), 'brier': float(brier_score_loss(ts.y, p, sample_weight=ts.w)),
                            'auc': float(roc_auc_score(ts.y, p, sample_weight=ts.w)), 'ece': wece(ts.y.values, p, ts.w.values),
                            'mean_p': float(np.average(p, weights=ts.w)),
                            'by_condition': ts.assign(pp=p).groupby('condition').apply(lambda g: round(float(np.average(g.pp, weights=g.w)), 6), include_groups=False).to_dict()}
res['actual_rate'] = float(np.average(ts.y, weights=ts.w))
res['actual_by_condition'] = ts.groupby('condition').apply(lambda g: round(float(np.average(g.y, weights=g.w)), 6), include_groups=False).to_dict()
ok = ~(np.isnan(ec_with) | np.isnan(ec_without))
res['endcap_lift'] = {'rows': int(ok.sum()),
                      'jev_raw': float(ec_with[ok].sum() / ec_without[ok].sum()),
                      'jev_calibrated': float(iso.predict(ec_with[ok]).sum() / iso.predict(ec_without[ok]).sum()),
                      'actual_pooled': json.load(open(S / 'cj_exp/robust.json'))['decision_lift_pooled']['A_front_endcap']}
res['jev_distinct_values'] = int(pd.Series(ts.jev).nunique())
res['iso_map'] = {str(round(x, 3)): round(float(iso.predict([x])[0]) * 100, 4) for x in sorted(pd.Series(cs.jev.dropna()).unique())}
json.dump(res, open(S / 'cj_exp/jev_calib_results.json', 'w'), indent=1)
print(json.dumps(res, indent=1))
