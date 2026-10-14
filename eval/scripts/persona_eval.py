"""Compare persona answers with the calibrated model and with what actually happened in weeks 48-53."""
import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression

S = Path(sys.argv[1])
rows = pd.read_parquet(S / 'cj_exp/rows.parquet')
ans = pd.read_parquet(S / 'cj_exp/persona_answers.parquet')
if (S / 'cj_exp/jev_answers.parquet').exists():
    ans = pd.concat([ans, pd.read_parquet(S / 'cj_exp/jev_answers.parquet').assign(buy=None)], ignore_index=True)
pairs = pd.read_parquet(S / 'cj_exp/persona_pairs.parquet')
robust = json.load(open(S / 'cj_exp/robust.json'))
HH = ['visits', 'avg_spend', 'cereal_visit_rate', 'disc_share', 'cereal_spend_share', 'private_share', 'hp_count', 'prod_base', 'prod_private']
COND = ['front_endcap', 'other_display', 'mailer', 'mailer_front']
CONDS = {'none': (0, 0, 0, 0), 'A_front_endcap': (1, 0, 0, 0), 'B_mailer_only': (0, 0, 1, 1), 'C_other_display': (0, 1, 0, 0)}
tr, ca, te = (rows[rows.split == s] for s in ['train', 'calib', 'test'])
m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200, l2_regularization=1.0, random_state=0).fit(tr[HH + COND], tr.y)
iso = IsotonicRegression(out_of_bounds='clip', y_min=1e-6, y_max=1 - 1e-6).fit(m.predict_proba(ca[HH + COND])[:, 1], ca.y)
f = lambda X: iso.predict(m.predict_proba(X[HH + COND])[:, 1])

# calibrated model on the same pairs x 4 conditions
base = te.drop_duplicates(['household_id', 'product_id']).merge(pairs, on=['household_id', 'product_id'])
cal = []
for c, vals in CONDS.items():
    Z = base.copy()
    for k, v in zip(COND, vals):
        Z[k] = v
    cal.append(pd.DataFrame({'household_id': Z.household_id, 'product_id': Z.product_id, 'condition': c, 'p': f(Z), 'variant': 'calibrated'}))
cal = pd.concat(cal)
allp = pd.concat([ans[['household_id', 'product_id', 'condition', 'p', 'variant']], cal])

actual_rate = te.groupby('condition').y.mean()
out = {'n_pairs': int(len(pairs)), 'answers': ans.groupby('variant').size().to_dict(), 'engines': {}}
lifts = robust['decision_lift_pooled']
for v, g in allp.groupby('variant'):
    mp = g.groupby('condition').p.mean()
    none = g[g.condition == 'none'].set_index(['household_id', 'product_id']).p
    calnone = cal[cal.condition == 'none'].set_index(['household_id', 'product_id']).p.reindex(none.index)
    hist = base.set_index(['household_id', 'product_id']).hp_count.reindex(none.index)
    e = {'mean_p_by_condition': mp.round(5).to_dict(),
         'level_vs_actual_none': float(mp['none'] / actual_rate['none']),
         'lift_A_endcap': float(mp['A_front_endcap'] / mp['none']),
         'lift_C_other_display': float(mp['C_other_display'] / mp['none']),
         'lift_B_mailer': float(mp['B_mailer_only'] / mp['none']),
         'cv_across_households_none': float(none.std() / none.mean()),
         'distinct_values_none': int(none.round(4).nunique()),
         'spearman_with_purchase_history': float(spearmanr(none, hist).correlation),
         'spearman_with_calibrated': float(spearmanr(none, calnone).correlation) if v != 'calibrated' else 1.0}
    if v in ('basic', 'history'):
        e['yes_rate_by_condition'] = ans[ans.variant == v].assign(yes=lambda d: d.buy.str.lower().eq('yes')).groupby('condition').yes.mean().round(3).to_dict()
    # simulate the real test visits of these pairs
    tv = te.merge(pairs, on=['household_id', 'product_id'])
    pm = g.set_index(['household_id', 'product_id', 'condition']).p
    e['predicted_buys_on_real_test_visits'] = float(pm.reindex(pd.MultiIndex.from_frame(tv[['household_id', 'product_id', 'condition']])).sum())
    out['engines'][v] = e
tv = te.merge(pairs, on=['household_id', 'product_id'])
out['real_test_visits_for_pairs'] = int(len(tv)); out['actual_buys_for_pairs'] = int(tv.y.sum())
out['actual_rate_by_condition_all_test'] = actual_rate.round(5).to_dict()
out['actual_lift_pooled'] = {k: {kk: lifts[k].get(kk) for kk in ['actual', 'ci95']} for k in lifts}
json.dump(out, open(S / 'cj_exp/persona_results.json', 'w'), indent=1)
print(json.dumps(out, indent=1))
