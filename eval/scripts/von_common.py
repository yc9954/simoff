"""Shared pieces for the Von experiments: the same samples, state and question as jev_calib.py, and the metrics.

Samples (same design and seeds as jev_calib.py, drawn from data/rows.parquet):
  calib  weeks 45-47 : all buys + 1,500 non-buys                       (weights restore the true rate)
  test   weeks 48-53 : all buys + 750 non-buys per condition           (weights restore the true rate)
  endcap 500 front-endcap test rows, asked as endcap and as regular shelf -> decision effect
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

SIM = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SIM))
from sim import train_engines  # noqa: E402

RESULTS = SIM / 'eval' / 'results'
rows = pd.read_parquet(SIM / 'data' / 'rows.parquet')
prod = pd.read_parquet(SIM / 'data' / 'products.parquet').set_index('product_id')

COND_TXT = {
    'none': 'regular shelf in the cereal aisle; no special display, no ad this week',
    'A_front_endcap': 'front end-cap display at the head of an aisle near the store entrance this week',
    'B_mailer_only': "featured in this week's store mailer; regular shelf in store",
    'C_other_display': 'extra in-store display inside the aisle this week, besides its regular shelf',
}
INSTRUCTIONS = 'On this one shopping trip, does this shopper put this exact product in the basket?'
CRITERIA = {'true': 'puts this exact product in the basket on this trip', 'false': 'does not buy it on this trip'}


def state(r, c):
    pr = prod.loc[r.product_id]
    return {'shopper_last_26_weeks': {'trips_to_this_store': int(r.visits), 'share_of_trips_with_cold_cereal': round(float(r.cereal_visit_rate), 3),
                                      'trips_buying_this_exact_product': int(r.hp_count), 'avg_basket_usd': round(float(r.avg_spend), 1),
                                      'share_of_spend_discounted': round(float(r.disc_share), 3), 'private_label_share_in_cereal': round(float(r.private_share), 3)},
            'product': {'description': f"{pr.brand.lower()}-brand {str(pr.product_type).lower()} ({pr.package_size})",
                        'share_of_all_store_trips_that_buy_it': round(float(r.prod_base), 5)},
            'store_condition_this_week': COND_TXT[c]}


def state_text(r, c=None):
    return json.dumps(state(r, c or r.condition))


def samples():
    ca = rows[rows.split == 'calib']
    cpos, cneg = ca[ca.y == 1], ca[ca.y == 0]
    cs = pd.concat([cpos, cneg.sample(1500, random_state=1)])
    cs['w'] = np.where(cs.y == 1, 1.0, len(cneg) / 1500)
    te = rows[rows.split == 'test']
    parts = [te[te.y == 1].assign(w=1.0)]
    for c, g in te[te.y == 0].groupby('condition'):
        k = min(750, len(g))
        parts.append(g.sample(k, random_state=2).assign(w=len(g) / k))
    ts = pd.concat(parts)
    ec = te[te.condition == 'A_front_endcap'].sample(500, random_state=3)
    return cs, ts, ec


def train_sample(n_neg=20000, seed=5, weeks=(27, 44)):
    """Training rows for fine-tuning: every buy in the weeks + n_neg non-buys, weighted back to the true rate."""
    tr = rows[(rows.split == 'train') & rows.week.between(*weeks)]
    pos, neg = tr[tr.y == 1], tr[tr.y == 0]
    k = min(n_neg, len(neg))
    s = pd.concat([pos, neg.sample(k, random_state=seed)])
    s['w'] = np.where(s.y == 1, 1.0, len(neg) / k)
    return s.sample(frac=1, random_state=seed)


def gbdt_predictions(df):
    eng = train_engines(rows)
    return eng['calibrated'].predict(df), eng['no_promo'].predict(df)


def wece(y, p, w, bins=8):
    q = pd.qcut(pd.Series(p).rank(method='first'), bins, labels=False)
    d = pd.DataFrame({'y': y, 'p': p, 'w': w, 'q': q.values})
    g = d.groupby('q').apply(lambda x: pd.Series({'y': np.average(x.y, weights=x.w), 'p': np.average(x.p, weights=x.w), 'w': x.w.sum()}), include_groups=False)
    return float((g.w * (g.y - g.p).abs()).sum() / g.w.sum())


def metrics(ts, p):
    p = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
    return {'log_loss': float(log_loss(ts.y, p, sample_weight=ts.w)), 'brier': float(brier_score_loss(ts.y, p, sample_weight=ts.w)),
            'auc': float(roc_auc_score(ts.y, p, sample_weight=ts.w)), 'ece': wece(ts.y.values, p, ts.w.values),
            'mean_p': float(np.average(p, weights=ts.w)),
            'by_condition': ts.assign(pp=p).groupby('condition').apply(lambda g: round(float(np.average(g.pp, weights=g.w)), 6), include_groups=False).to_dict()}


def actual(ts):
    return {'rate': float(np.average(ts.y, weights=ts.w)),
            'by_condition': ts.groupby('condition').apply(lambda g: round(float(np.average(g.y, weights=g.w)), 6), include_groups=False).to_dict()}


def full_rows():
    """Every row the full-period evaluation needs, in a fixed order: (row index, condition to ask under).

    weeks 45-47 and 48-53 as they really were, then every 48-53 row that had a display or mailer asked again as
    a regular shelf, which is what the simulator's effect sizes divide by.
    """
    ev = rows[rows.split.isin(['calib', 'test'])]
    cf = rows[(rows.split == 'test') & (rows.condition != 'none')]
    return pd.DataFrame({'row': np.r_[ev.index.values, cf.index.values],
                         'cond': np.r_[ev.condition.values, np.full(len(cf), 'none', dtype=object)]})
