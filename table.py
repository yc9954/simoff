"""Build the visit x product decision table from normalized tables.

A port of offline-api-eval/scripts/build.py with the cereal-specific parts turned into arguments:
the target category, how many of its products, the private-label brand name and the week split.
Column names stay as the model expects (cereal_* = "the target category").

Time split (no peeking): state weeks -> household state + product base rates only, never a target;
train -> model; calib -> isotonic calibration; test -> held-out weeks for validation.
"""
import numpy as np
import pandas as pd

from datasets import FRONT_MAILER

DUNNHUMBY_SPLIT = {'state': (1, 26), 'train': (27, 44), 'calib': (45, 47), 'test': (48, 53)}


def default_split(weeks):
    """For a dataset without a known split: state 50%, train 34%, calibration 6%, test the rest."""
    lo, hi = int(min(weeks)), int(max(weeks))
    n = hi - lo + 1
    a, b, c = lo + round(n * .50) - 1, lo + round(n * .84) - 1, lo + round(n * .90) - 1
    return {'state': (lo, a), 'train': (a + 1, b), 'calib': (b + 1, c), 'test': (c + 1, hi)}


def build_table(t, p, pl, category='COLD CEREAL', k=25, private_brand='Private', split=None):
    split = split or default_split(t.week.unique())
    s_lo, s_hi = split['state']
    t = t.merge(p[['product_id', 'product_category', 'brand', 'product_type']], on='product_id', how='left')
    cat = t[t.product_category == category]
    if cat.empty:
        raise SystemExit(f'no receipts in category {category!r}')
    top = cat.groupby('product_id').basket_id.nunique().sort_values(ascending=False).head(k).index
    promo_stores = set(pl.store_id.unique()) or set(t.store_id.unique())

    v = t.groupby('basket_id').agg(household_id=('household_id', 'first'), store_id=('store_id', 'first'),
                                   week=('week', 'first'), spend=('sales_value', 'sum'), disc=('retail_disc', 'sum')).reset_index()
    v = v[v.store_id.isin(promo_stores)]

    # household state from the state weeks only
    f = t[t.week.between(s_lo, s_hi)]
    fv = f.groupby(['household_id', 'basket_id']).agg(spend=('sales_value', 'sum'),
                                                      cereal=('product_category', lambda s: (s == category).any())).reset_index()
    hh = fv.groupby('household_id').agg(visits=('basket_id', 'size'), avg_spend=('spend', 'mean'), cereal_visit_rate=('cereal', 'mean')).reset_index()
    tot = f.groupby('household_id').agg(sv=('sales_value', 'sum'), rd=('retail_disc', 'sum')).reset_index()
    tot['disc_share'] = tot.rd / (tot.sv + tot.rd).clip(lower=1e-9)
    hh = hh.merge(tot[['household_id', 'disc_share']], on='household_id', how='left')
    cs = f[f.product_category == category].groupby('household_id').agg(cereal_spend=('sales_value', 'sum'),
                                                                      private_share=('brand', lambda s: (s == private_brand).mean())).reset_index()
    hh = hh.merge(cs, on='household_id', how='left').fillna({'cereal_spend': 0, 'private_share': 0})
    hh['cereal_spend_share'] = hh.cereal_spend / f.groupby('household_id').sales_value.sum().reindex(hh.household_id).values
    hp = f[f.product_id.isin(top)].groupby(['household_id', 'product_id']).basket_id.nunique().rename('hp_count').reset_index()

    fvis = v[v.week.between(s_lo, s_hi)].shape[0]
    pb = (f[f.product_id.isin(top) & f.store_id.isin(promo_stores)].groupby('product_id').basket_id.nunique() / max(fvis, 1)).rename('prod_base').reset_index()
    pbrand = p.set_index('product_id').brand.reindex(top).eq(private_brand).astype(int).rename('prod_private').reset_index()

    # store conditions per product x store x week
    pp = pl[pl.product_id.isin(top)].copy()
    pp['front_endcap'] = (pp.display_location == '3').astype(int)
    pp['other_display'] = (~pp.display_location.isin(['0', '3'])).astype(int)
    pp['mailer'] = (pp.mailer_location != '0').astype(int)
    pp['mailer_front'] = pp.mailer_location.isin(FRONT_MAILER).astype(int)
    cond = pp.groupby(['product_id', 'store_id', 'week'])[['front_endcap', 'other_display', 'mailer', 'mailer_front']].max().reset_index()

    vv = v[v.week > s_hi]
    rows = vv.assign(k=1).merge(pd.DataFrame({'product_id': top, 'k': 1}), on='k').drop(columns='k')
    bought = t[t.product_id.isin(top)][['basket_id', 'product_id']].drop_duplicates().assign(y=1)
    rows = rows.merge(bought, on=['basket_id', 'product_id'], how='left').fillna({'y': 0})
    rows = rows.merge(cond, on=['product_id', 'store_id', 'week'], how='left').fillna({'front_endcap': 0, 'other_display': 0, 'mailer': 0, 'mailer_front': 0})
    rows = rows.merge(hh, on='household_id', how='left').merge(hp, on=['household_id', 'product_id'], how='left').fillna({'hp_count': 0})
    rows = rows.merge(pb, on='product_id', how='left').merge(pbrand, on='product_id', how='left')
    for c in ['visits', 'avg_spend', 'cereal_visit_rate', 'disc_share', 'cereal_spend', 'private_share', 'cereal_spend_share', 'prod_base']:
        rows[c] = rows[c].fillna(0)
    rows['condition'] = np.select([rows.front_endcap == 1, rows.other_display == 1, rows.mailer == 1], ['A_front_endcap', 'C_other_display', 'B_mailer_only'], 'none')
    rows['split'] = np.select([rows.week <= split['train'][1], rows.week <= split['calib'][1]], ['train', 'calib'], 'test')
    rows['has_demo'] = 0
    for c in ['y', 'front_endcap', 'other_display', 'mailer', 'mailer_front']:
        rows[c] = rows[c].astype(int)

    ts = t.groupby('basket_id').transaction_timestamp.min()
    rows['date'] = rows.basket_id.map(ts).dt.strftime('%Y-%m-%d')
    rows['hour'] = rows.basket_id.map(ts).dt.hour.astype('int8')

    sold = t[t.product_id.isin(top) & (t.quantity > 0)]
    unit = (sold.sales_value + sold.retail_disc + sold.coupon_disc) / sold.quantity
    price = unit.groupby(sold.product_id).median().rename('shelf_price')
    products = p[p.product_id.isin(top)][['product_id', 'brand', 'product_type', 'package_size']].merge(price, left_on='product_id', right_index=True)
    return rows.reset_index(drop=True), products, split
