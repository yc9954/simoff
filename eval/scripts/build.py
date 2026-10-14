"""Build the visit x product decision table for cold cereal.

Unit: one store visit (basket) x one of the top-K cold cereal products.
Target: was that product bought on that visit.
Condition: what the store did with that product that week (promotions table):
  front_endcap (display 3), other_display (any other display code), mailer_only (ad, no display), none.

Time split (no peeking):
  weeks 1-26  -> household state + product base rates only (never a target)
  weeks 27-44 -> training targets
  weeks 45-47 -> calibration targets
  weeks 48-53 -> held-out test ("weeks the model never saw")
"""
import sys
import numpy as np
import pandas as pd

D, OUT = sys.argv[1], sys.argv[2]
K = 25
t = pd.read_parquet(D + 'transactions.parquet')
p = pd.read_parquet(D + 'products.parquet')
pr = pd.read_parquet(D + 'promotions.parquet')
demo = pd.read_parquet(D + 'demographics.parquet')

t = t.merge(p[['product_id', 'product_category', 'brand', 'product_type']], on='product_id', how='left')
cereal = t[t.product_category == 'COLD CEREAL']
top = cereal.groupby('product_id').basket_id.nunique().sort_values(ascending=False).head(K).index
promo_stores = set(pr.store_id.unique())

# visits = baskets in stores that have promotion records
v = t.groupby('basket_id').agg(household_id=('household_id', 'first'), store_id=('store_id', 'first'),
                               week=('week', 'first'), spend=('sales_value', 'sum'),
                               disc=('retail_disc', 'sum')).reset_index()
v = v[v.store_id.isin(promo_stores)]

# ---- household state from weeks 1-26 only
f = t[t.week <= 26]
fv = f.groupby(['household_id', 'basket_id']).agg(spend=('sales_value', 'sum'), disc=('retail_disc', 'sum'),
                                                  cereal=('product_category', lambda s: (s == 'COLD CEREAL').any())).reset_index()
hh = fv.groupby('household_id').agg(visits=('basket_id', 'size'), avg_spend=('spend', 'mean'),
                                    disc_share=('disc', lambda s: 0), cereal_visit_rate=('cereal', 'mean')).reset_index()
tot = f.groupby('household_id').agg(sv=('sales_value', 'sum'), rd=('retail_disc', 'sum')).reset_index()
tot['disc_share'] = tot.rd / (tot.sv + tot.rd).clip(lower=1e-9)
hh = hh.drop(columns='disc_share').merge(tot[['household_id', 'disc_share']], on='household_id', how='left')
cs = f[f.product_category == 'COLD CEREAL'].groupby('household_id').agg(cereal_spend=('sales_value', 'sum'),
                                                                         private_share=('brand', lambda s: (s == 'Private').mean())).reset_index()
hh = hh.merge(cs, on='household_id', how='left').fillna({'cereal_spend': 0, 'private_share': 0})
hh['cereal_spend_share'] = hh.cereal_spend / f.groupby('household_id').sales_value.sum().reindex(hh.household_id).values
# per household x product counts in weeks 1-26
hp = f[f.product_id.isin(top)].groupby(['household_id', 'product_id']).basket_id.nunique().rename('hp_count').reset_index()

# product base rate per visit in weeks 1-26 (across promo stores)
fvis = v[v.week <= 26].shape[0]
pb = f[f.product_id.isin(top) & f.store_id.isin(promo_stores)].groupby('product_id').basket_id.nunique() / fvis
pb = pb.rename('prod_base').reset_index()
pbrand = p.set_index('product_id').brand.reindex(top).eq('Private').astype(int).rename('prod_private').reset_index()

# ---- conditions per product x store x week
pp = pr[pr.product_id.isin(top)].copy()
pp['front_endcap'] = (pp.display_location == '3').astype(int)
pp['other_display'] = (~pp.display_location.isin(['0', '3'])).astype(int)
pp['mailer'] = (pp.mailer_location != '0').astype(int)
pp['mailer_front'] = pp.mailer_location.isin(['D', 'F', 'H', 'L', 'Z']).astype(int)
cond = pp.groupby(['product_id', 'store_id', 'week'])[['front_endcap', 'other_display', 'mailer', 'mailer_front']].max().reset_index()

# ---- visit x product rows for weeks 27-53
vv = v[v.week >= 27]
rows = vv.assign(k=1).merge(pd.DataFrame({'product_id': top, 'k': 1}), on='k').drop(columns='k')
bought = t[t.product_id.isin(top)][['basket_id', 'product_id']].drop_duplicates().assign(y=1)
rows = rows.merge(bought, on=['basket_id', 'product_id'], how='left').fillna({'y': 0})
rows = rows.merge(cond, on=['product_id', 'store_id', 'week'], how='left').fillna({'front_endcap': 0, 'other_display': 0, 'mailer': 0, 'mailer_front': 0})
rows = rows.merge(hh, on='household_id', how='left').merge(hp, on=['household_id', 'product_id'], how='left').fillna({'hp_count': 0})
rows = rows.merge(pb, on='product_id', how='left').merge(pbrand, on='product_id', how='left')
for c in ['visits', 'avg_spend', 'cereal_visit_rate', 'disc_share', 'cereal_spend', 'private_share', 'cereal_spend_share']:
    rows[c] = rows[c].fillna(0)
rows['condition'] = np.select([rows.front_endcap == 1, rows.other_display == 1, rows.mailer == 1], ['A_front_endcap', 'C_other_display', 'B_mailer_only'], 'none')
rows['split'] = np.select([rows.week <= 44, rows.week <= 47], ['train', 'calib'], 'test')
rows['has_demo'] = rows.household_id.isin(set(demo.household_id)).astype(int)
for c in ['y', 'front_endcap', 'other_display', 'mailer', 'mailer_front']:
    rows[c] = rows[c].astype(int)
rows.to_parquet(OUT)
print('top products:', len(top))
print(p.set_index('product_id').loc[top, ['brand', 'product_type', 'package_size']].head(10).to_string())
print('rows', len(rows), 'visits', rows.basket_id.nunique(), 'households', rows.household_id.nunique())
print(rows.groupby('split').agg(n=('y', 'size'), buy_rate=('y', 'mean')).to_string())
print(rows.groupby(['split', 'condition']).agg(n=('y', 'size'), buy_rate=('y', 'mean')).to_string())
