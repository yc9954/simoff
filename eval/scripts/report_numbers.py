import sys, json, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
S = sys.argv[1]
r = pd.read_parquet(S + '/cj_exp/rows.parquet')
t = pd.read_parquet(S + '/cj_data/transactions.parquet')
HH = ['visits','avg_spend','cereal_visit_rate','disc_share','cereal_spend_share','private_share','hp_count','prod_base','prod_private']
C = ['front_endcap','other_display','mailer','mailer_front']
tr, ca, te = (r[r.split == s] for s in ['train','calib','test'])
m = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200, l2_regularization=1.0, random_state=0).fit(tr[HH+C], tr.y)
iso = IsotonicRegression(out_of_bounds='clip', y_min=1e-6, y_max=1-1e-6).fit(m.predict_proba(ca[HH+C])[:,1], ca.y)
f = lambda X: iso.predict(m.predict_proba(X[HH+C])[:,1])
def setc(X, v):
    Z = X.copy(); Z[C] = list(v); return Z
E = te[te.condition == 'A_front_endcap'].copy()
E['p_with'] = f(setc(E, (1,0,0,0))); E['p_without'] = f(setc(E, (0,0,0,0)))
# per store-week-product: visits, extra units
sw = E.groupby(['store_id','week','product_id']).agg(visits=('y','size'), with_=('p_with','sum'), without=('p_without','sum'), actual=('y','sum'))
price = t[t.product_id.isin(r.product_id.unique()) & (t.quantity > 0)].assign(unit=lambda d: (d.sales_value + d.retail_disc + d.coupon_disc) / d.quantity)
avg_price = float(price[price.product_id.isin(E.product_id.unique())].unit.median())
out = {'endcap_rows': len(E), 'store_week_product_cells': len(sw),
       'visits_per_cell_median': float(sw.visits.median()), 'visits_per_cell_mean': float(sw.visits.mean()),
       'units_without_per_cell': float(sw.without.mean()), 'units_with_per_cell': float(sw.with_.mean()),
       'extra_units_per_cell': float((sw.with_ - sw.without).mean()), 'median_shelf_price_usd': avg_price,
       'lift_test_rows': float(E.p_with.sum() / E.p_without.sum())}
out['extra_usd_per_cell'] = out['extra_units_per_cell'] * avg_price
# per 1,000 visits
out['per_1000_without'] = float(E.p_without.mean() * 1000); out['per_1000_with'] = float(E.p_with.mean() * 1000)
# segments
def seg(name, mask):
    g = E[mask]
    return {'segment': name, 'rows': int(len(g)), 'p_without_pct': round(float(g.p_without.mean()*100), 4), 'p_with_pct': round(float(g.p_with.mean()*100), 4),
            'lift': round(float(g.p_with.sum()/g.p_without.sum()), 2), 'extra_per_1000': round(float((g.p_with - g.p_without).mean()*1000), 2), 'share_of_extra': None}
segs = [seg('Households that bought it before', E.hp_count > 0), seg('Households that never bought it', E.hp_count == 0),
        seg('Frequent cereal buyers (top third)', E.cereal_visit_rate >= E.cereal_visit_rate.quantile(2/3)),
        seg('Rare cereal buyers (bottom third)', E.cereal_visit_rate <= E.cereal_visit_rate.quantile(1/3)),
        seg('Discount-sensitive (top third)', E.disc_share >= E.disc_share.quantile(2/3)),
        seg('Less discount-sensitive (bottom third)', E.disc_share <= E.disc_share.quantile(1/3))]
tot = (E.p_with - E.p_without).sum()
for s, mask in zip(segs, [E.hp_count > 0, E.hp_count == 0]):
    s['share_of_extra'] = round(float((E[mask].p_with - E[mask].p_without).sum() / tot), 3)
out['segments'] = segs
out['share_rows_bought_before'] = float((E.hp_count > 0).mean())
json.dump(out, open(S + '/cj_exp/report_numbers.json', 'w'), indent=1, ensure_ascii=False)
print(json.dumps(out, indent=1, ensure_ascii=False))
