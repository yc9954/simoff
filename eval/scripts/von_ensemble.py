"""Result 7: the simulator's decision model, fine-tuned Von, and the two combined, on every held-out row.

Reads the yes-logits von_modal.py --mode score wrote (results/von_full/<tag>_<k>of<n>.npy, in von_common.full_rows()
order, sharded k::n), puts back each seed's prior-correction offset, and averages the three seeds.
The combination is a logistic regression on [logit GBDT, logit Von] fitted on weeks 45-47 only — the weeks the
GBDT used for its isotonic layer and Von used to pick its checkpoint — and scored on weeks 48-53, which neither saw.

  python3 sim/eval/scripts/von_ensemble.py
"""
import json
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score

from von_common import RESULTS, full_rows, rows
from sim import condition_name, train_engines



def actual_lift(df, cname, B=1000, rng=np.random.default_rng(0)):
    """Real lift within product x week (stores that did it vs stores that did not), bootstrap 95% — validate.py's comparison."""
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
        return None
    boot = [est(rng.integers(0, len(g), len(g))) for _ in range(B)]
    return {'lift': float(point), 'lo': float(np.nanpercentile(boot, 2.5)), 'hi': float(np.nanpercentile(boot, 97.5))}


SEEDS, NSH = (0, 1, 2), 4
FR = full_rows()
logit = lambda p: np.log(np.clip(p, 1e-7, 1 - 1e-7) / (1 - np.clip(p, 1e-7, 1 - 1e-7)))  # noqa: E731
sig = lambda z: 1 / (1 + np.exp(-z))  # noqa: E731


def von_probs():
    ps = []
    for s in SEEDS:
        tag = f'full18_s{s}'
        z = np.empty(len(FR), dtype=np.float64)
        for k in range(NSH):
            z[k::NSH] = np.load(RESULTS / 'von_full' / f'{tag}_{k}of{NSH}.npy')
        off = json.load(open(RESULTS / f'von_ft_{tag}_results.json'))['train']['offset']
        ps.append(sig(z + off))
    return np.mean(ps, axis=0), ps


pv, per_seed = von_probs()
eng = train_engines(rows)
R = rows.loc[FR.row.values].copy()
asked_none = (FR.cond.values == 'none') & (R.condition.values != 'none')        # the shelf counterfactual rows
R.loc[asked_none, ['front_endcap', 'other_display', 'mailer', 'mailer_front']] = 0
pg = eng['calibrated'].predict(R)
FR = FR.assign(split=R.split.values, y=R.y.values, week=R.week.values, store=R.store_id.values, pid=R.product_id.values,
               real_cond=rows.loc[FR.row.values].condition.values, cf=asked_none, g=pg, v=pv)

cal = FR[(FR.split == 'calib') & ~FR.cf]
X = lambda d: np.c_[logit(d.g), logit(d.v)]  # noqa: E731
lr = LogisticRegression(C=1e6, max_iter=1000).fit(X(cal), cal.y)
FR['e'] = lr.predict_proba(X(FR))[:, 1]
# weeks 45-47 favour the GBDT (its isotonic layer was fitted there), so two fairer combinations as well:
FR['avg'] = sig((logit(FR.g) + logit(FR.v)) / 2)                       # no fitting at all
FR['xfit'] = np.nan                                                    # cross-fitted on the test weeks: 48-50 -> 51-53 and back
fold = FR.week.isin([48, 49, 50])
for fit_on, apply_to in [(fold, ~fold), (~fold, fold)]:
    tr = FR[(FR.split == 'test') & ~FR.cf & fit_on]
    m = LogisticRegression(C=1e6, max_iter=1000).fit(X(tr), tr.y)
    rows_ = (FR.split == 'test') & apply_to
    FR.loc[rows_, 'xfit'] = m.predict_proba(X(FR[rows_]))[:, 1]


def ece(y, p, bins=20):
    q = pd.qcut(pd.Series(p).rank(method='first'), bins, labels=False)
    d = pd.DataFrame({'y': y, 'p': p, 'q': q.values}).groupby('q').agg(y=('y', 'mean'), p=('p', 'mean'), n=('y', 'size'))
    return float((d.n * (d.y - d.p).abs()).sum() / d.n.sum())


te = FR[(FR.split == 'test') & ~FR.cf]
cf = FR[FR.cf].set_index('row')
res = {'rows_test': int(len(te)), 'buys_test': int(te.y.sum()), 'stack': {'intercept': float(lr.intercept_[0]), 'w_gbdt': float(lr.coef_[0][0]), 'w_von': float(lr.coef_[0][1])},
       'engines': {}, 'effects': {}}
for name, col in [('gbdt', 'g'), ('von', 'v'), ('ensemble', 'e'), ('average', 'avg'), ('crossfit', 'xfit')]:
    p = te[col].values
    wk = te.assign(p=p).groupby('week').agg(a=('y', 'sum'), x=('p', 'sum'))
    st = te.assign(p=p).groupby('store').agg(a=('y', 'sum'), x=('p', 'sum'))
    res['engines'][name] = {
        'auc': float(roc_auc_score(te.y, p)), 'log_loss': float(log_loss(te.y, np.clip(p, 1e-7, 1 - 1e-7))), 'ece': ece(te.y.values, p),
        'expected': float(p.sum()), 'actual': int(te.y.sum()),
        'by_condition': {c: {'actual': int(g.y.sum()), 'expected': float(g[col].sum()), 'rows': int(len(g))} for c, g in te.groupby('real_cond')},
        'weekly_abs_err': float((wk.x - wk.a).abs().mean()), 'store_rank_corr': float(spearmanr(st.a, st.x).statistic)}
    for c in ['A_front_endcap', 'C_other_display', 'B_mailer_only']:
        X = te[te.real_cond == c]
        res['effects'].setdefault(c, {})[name] = float(X[col].sum() / cf.loc[X.row.values, col].sum())
test_rows = rows[rows.split == 'test']
for c in ['A_front_endcap', 'C_other_display', 'B_mailer_only']:
    res['effects'][c]['actual'] = actual_lift(test_rows, c)
res['von_seed_auc'] = [float(roc_auc_score(te.y, ps[(FR.split == 'test') & ~FR.cf])) for ps in per_seed]
json.dump(res, open(RESULTS / 'von_ensemble_results.json', 'w'), indent=1, ensure_ascii=False)
for n, e in res['engines'].items():
    print(f"{n:9s} AUC {e['auc']:.4f} LL {e['log_loss']:.5f} ECE {e['ece']:.5f} expected {e['expected']:.1f}/{e['actual']} "
          f"weekly|err| {e['weekly_abs_err']:.1f} store rho {e['store_rank_corr']:.2f} · "
          + ' '.join(f"{c[:6]} {v['expected']:.0f}/{v['actual']}" for c, v in e['by_condition'].items()))
print('effects', json.dumps({c: {k: (round(v, 2) if isinstance(v, float) else v and round(v['lift'], 2)) for k, v in d.items()} for c, d in res['effects'].items()}))
print('stack', res['stack'], 'von seeds', [round(a, 4) for a in res['von_seed_auc']])
