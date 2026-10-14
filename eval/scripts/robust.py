"""Rolling-origin check: three held-out windows instead of one, pooled for the decision-lift test.

Household state always comes from weeks 1-26. Each fold trains only on weeks before its calibration window.
"""
import json
import sys
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import log_loss, roc_auc_score

rows = pd.read_parquet(sys.argv[1])
HH = ['visits', 'avg_spend', 'cereal_visit_rate', 'disc_share', 'cereal_spend_share', 'private_share', 'hp_count', 'prod_base', 'prod_private']
COND = ['front_endcap', 'other_display', 'mailer', 'mailer_front']
CONDS = {'none': (0, 0, 0, 0), 'A_front_endcap': (1, 0, 0, 0), 'B_mailer_only': (0, 0, 1, 1), 'C_other_display': (0, 1, 0, 0)}
FOLDS = [((27, 32), (33, 35), (36, 41)), ((27, 38), (39, 41), (42, 47)), ((27, 44), (45, 47), (48, 53))]
rng = np.random.default_rng(1)


def setc(X, name):
    Z = X.copy()
    for c, v in zip(COND, CONDS[name]):
        Z[c] = v
    return Z


per_fold, pooled = [], []
for (a0, a1), (c0, c1), (t0, t1) in FOLDS:
    tr = rows[rows.week.between(a0, a1)]; ca = rows[rows.week.between(c0, c1)]; te = rows[rows.week.between(t0, t1)].copy()
    out = {'test_weeks': f'{t0}-{t1}', 'test_buys': int(te.y.sum())}
    for name, feats in [('calibrated', HH + COND), ('no_promo', HH)]:
        m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200, l2_regularization=1.0, random_state=0).fit(tr[feats], tr.y)
        iso = IsotonicRegression(out_of_bounds='clip', y_min=1e-6, y_max=1 - 1e-6).fit(m.predict_proba(ca[feats])[:, 1], ca.y)
        f = lambda X, m=m, iso=iso, feats=feats: iso.predict(m.predict_proba(X[feats])[:, 1])
        p = f(te)
        out[name] = {'log_loss': float(log_loss(te.y, p)), 'auc': float(roc_auc_score(te.y, p))}
        if name == 'calibrated':
            for cname in ['A_front_endcap', 'C_other_display']:
                X = te[te.condition == cname]
                te.loc[X.index, 'cf_with'] = f(setc(X, cname)); te.loc[X.index, 'cf_without'] = f(setc(X, 'none'))
    lift = tr.groupby('condition').y.mean() / tr[tr.condition == 'none'].y.mean()
    pa = (te.prod_base * te.condition.map(lift)).clip(1e-6, 1 - 1e-6)
    out['avg_lift'] = {'log_loss': float(log_loss(te.y, pa)), 'auc': float(roc_auc_score(te.y, pa))}
    te['avg_with'] = te.prod_base * te.condition.map(lift); te['avg_without'] = te.prod_base * lift['none']
    per_fold.append(out); pooled.append(te)

P = pd.concat(pooled)
res = {'per_fold': per_fold, 'decision_lift_pooled': {}}
for cname in ['A_front_endcap', 'B_mailer_only', 'C_other_display']:
    g = P[P.condition.isin([cname, 'none'])].groupby(['product_id', 'week', 'condition']).y.agg(['sum', 'size']).unstack('condition').dropna()
    if len(g) < 10:
        res['decision_lift_pooled'][cname] = {'actual': None, 'note': f'only {len(g)} product-week cells with both arms; promotion runs chain-wide so there is no same-week control'}
        continue
    xs, xn, ns, nn = (g[(k, c)].values for k, c in [('sum', cname), ('size', cname), ('sum', 'none'), ('size', 'none')])
    est = lambda ix: xs[ix].sum() / (xn[ix] * ns[ix] / nn[ix]).sum()
    boot = np.array([est(rng.integers(0, len(g), len(g))) for _ in range(1000)])
    X = P[P.condition == cname]
    res['decision_lift_pooled'][cname] = {
        'actual': float(est(np.arange(len(g)))), 'ci95': [float(np.nanpercentile(boot, 2.5)), float(np.nanpercentile(boot, 97.5))],
        'cells': int(len(g)), 'buys': int(xs.sum()),
        'calibrated': float(X.cf_with.sum() / X.cf_without.sum()), 'avg_lift': float(X.avg_with.sum() / X.avg_without.sum()), 'no_promo': 1.0}
json.dump(res, open(sys.argv[2], 'w'), indent=1)
print(json.dumps(res, indent=1))
