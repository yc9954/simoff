"""Train the calibrated decision model and evaluate it on held-out weeks 48-53.

Engines compared on the same test rows:
  calibrated  : gradient boosting on household state + product + store condition, isotonic-calibrated on weeks 45-47
  no_promo    : same model without condition features (the "평소대로" forecast; predicts no promotion effect)
  avg_lift    : product base rate x population-average lift per condition (no household heterogeneity)
"""
import json
import sys
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import log_loss, brier_score_loss, roc_auc_score

rows = pd.read_parquet(sys.argv[1])
OUT = sys.argv[2]
HH = ['visits', 'avg_spend', 'cereal_visit_rate', 'disc_share', 'cereal_spend_share', 'private_share', 'hp_count', 'prod_base', 'prod_private']
COND = ['front_endcap', 'other_display', 'mailer', 'mailer_front']
CONDS = {'none': (0, 0, 0, 0), 'A_front_endcap': (1, 0, 0, 0), 'B_mailer_only': (0, 0, 1, 1), 'C_other_display': (0, 1, 0, 0)}
tr, ca, te = (rows[rows.split == s].copy() for s in ['train', 'calib', 'test'])


def fit(feats, seed=0):
    m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200,
                                       l2_regularization=1.0, random_state=seed)
    m.fit(tr[feats], tr.y)
    iso = IsotonicRegression(out_of_bounds='clip', y_min=1e-6, y_max=1 - 1e-6).fit(m.predict_proba(ca[feats])[:, 1], ca.y)
    return lambda X: iso.predict(m.predict_proba(X[feats])[:, 1])


cal = fit(HH + COND)
nop = fit(HH)
lift = tr.groupby('condition').y.mean() / tr[tr.condition == 'none'].y.mean()
avg = lambda X: (X.prod_base * X.condition.map(lift)).clip(1e-6, 1 - 1e-6).values


def with_cond(X, name):
    Z = X.copy()
    for c, val in zip(COND, CONDS[name]):
        Z[c] = val
    Z['condition'] = name
    return Z


engines = {'calibrated': cal, 'no_promo': nop, 'avg_lift': avg}
res = {'n_test_rows': int(len(te)), 'n_test_buys': int(te.y.sum()), 'engines': {}}


def ece(y, p, bins=10):
    q = pd.qcut(p, bins, labels=False, duplicates='drop')
    d = pd.DataFrame({'y': y, 'p': p, 'q': q}).groupby('q').agg(y=('y', 'mean'), p=('p', 'mean'), n=('y', 'size'))
    return float((d.n * (d.y - d.p).abs()).sum() / d.n.sum()), d


# ---- 1. individual-level accuracy and calibration
for name, f in engines.items():
    p = np.asarray(f(te))
    e, rel = ece(te.y.values, p)
    res['engines'][name] = {'log_loss': float(log_loss(te.y, p)), 'brier': float(brier_score_loss(te.y, p)),
                            'auc': float(roc_auc_score(te.y, p)), 'ece': e, 'mean_p': float(p.mean()), 'actual_rate': float(te.y.mean()),
                            'reliability': rel.reset_index().round(6).to_dict('records')}
    te['p_' + name] = p

# ---- 2. aggregate per condition: predicted vs actual
agg = te.groupby('condition').agg(n=('y', 'size'), actual=('y', 'mean'), **{n: ('p_' + n, 'mean') for n in engines}).reset_index()
res['by_condition'] = agg.round(6).to_dict('records')

# ---- 3. decision lift, controlled within product x week (stores with the condition vs stores without, same product, same week)
rng = np.random.default_rng(0)


def actual_lift(df, cname, B=500):
    g = df[df.condition.isin([cname, 'none'])].groupby(['product_id', 'week', 'condition']).y.agg(['sum', 'size']).unstack('condition')
    g = g.dropna()
    if g.empty:
        return None
    xs, xn = g[('sum', cname)].values, g[('size', cname)].values
    ns, nn = g[('sum', 'none')].values, g[('size', 'none')].values
    def est(ix):
        exp = (xn[ix] * ns[ix] / nn[ix]).sum()
        return xs[ix].sum() / exp if exp > 0 else np.nan
    pt = est(np.arange(len(g)))
    boot = [est(rng.integers(0, len(g), len(g))) for _ in range(B)]
    return {'lift': float(pt), 'lo': float(np.nanpercentile(boot, 2.5)), 'hi': float(np.nanpercentile(boot, 97.5)), 'pw_cells': int(len(g)),
            'buys_in_condition': int(xs.sum())}


def model_lift(df, cname, f):
    X = df[df.condition == cname]
    return float(np.sum(f(with_cond(X, cname))) / np.sum(f(with_cond(X, 'none'))))


res['decision_lift'] = {}
for cname in ['A_front_endcap', 'B_mailer_only', 'C_other_display']:
    a = actual_lift(te, cname)
    res['decision_lift'][cname] = {'actual_within_product_week': a, **{n: model_lift(te, cname, f) for n, f in engines.items()}}

# ---- 4. spread: simulate each engine, compare household-level purchase counts with reality
hh_actual = te.groupby('household_id').y.sum()
spread = {}
for name in engines:
    sims = []
    for s in range(30):
        draw = rng.random(len(te)) < te['p_' + name].values
        sims.append(pd.Series(draw, index=te.household_id.values).groupby(level=0).sum().reindex(hh_actual.index).values)
    sims = np.array(sims)
    spread[name] = {'var_ratio': float(sims.var(axis=1).mean() / hh_actual.var()),
                    'share_hh_buying_actual': float((hh_actual > 0).mean()), 'share_hh_buying_sim': float((sims > 0).mean()),
                    'top10pct_hh_share_of_buys_actual': float(np.sort(hh_actual.values)[::-1][:len(hh_actual) // 10].sum() / hh_actual.sum()),
                    'top10pct_hh_share_of_buys_sim': float(np.mean([np.sort(r)[::-1][:len(r) // 10].sum() / max(r.sum(), 1) for r in sims]))}
res['spread'] = spread

# ---- 5. ranking of options by lift
act = {c: (res['decision_lift'][c]['actual_within_product_week'] or {}).get('lift') for c in res['decision_lift']}
res['rank_actual'] = sorted(act, key=lambda c: -(act[c] or 0))
for n in engines:
    res['rank_' + n] = sorted(res['decision_lift'], key=lambda c: -res['decision_lift'][c][n])

te.to_parquet(OUT.replace('.json', '_test_pred.parquet'))
json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in res.items() if k != 'engines'}, indent=1, ensure_ascii=False))
for n, m in res['engines'].items():
    print(n, {k: round(v, 6) for k, v in m.items() if k != 'reliability'})
