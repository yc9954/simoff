"""Copy the decision table next to the simulator and attach what a ledger needs.

Inputs (from the offline-api-eval run):
  --cj-data  folder with the dunnhumby Complete Journey parquet files
  --rows     the visit x product decision table built by offline-api-eval/scripts/build.py

Writes data/:
  rows.parquet      the decision table + visit timestamp (date, hour)
  products.parquet  the 25 cold cereal products: brand, type, size, median shelf price
"""
import argparse
from pathlib import Path

import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument('--cj-data', required=True)
ap.add_argument('--rows', required=True)
ap.add_argument('--out', default=str(Path(__file__).parent / 'data'))
a = ap.parse_args()
D, OUT = Path(a.cj_data), Path(a.out)
OUT.mkdir(parents=True, exist_ok=True)

rows = pd.read_parquet(a.rows)
t = pd.read_parquet(D / 'transactions.parquet', columns=['basket_id', 'product_id', 'quantity', 'sales_value', 'retail_disc', 'coupon_disc', 'transaction_timestamp'])
p = pd.read_parquet(D / 'products.parquet')

# One timestamp per visit. A basket has a single checkout time in this data.
ts = t.groupby('basket_id').transaction_timestamp.min().rename('ts')
rows = rows.merge(ts, left_on='basket_id', right_index=True, how='left')
if rows.ts.isna().any():
    raise SystemExit(f'{int(rows.ts.isna().sum())} rows have no visit timestamp')
rows['date'] = rows.ts.dt.strftime('%Y-%m-%d')
rows['hour'] = rows.ts.dt.hour.astype('int8')
rows = rows.drop(columns='ts')
rows.to_parquet(OUT / 'rows.parquet', index=False)

# Shelf price = what the shopper paid before store and coupon discounts, per unit.
top = rows.product_id.unique()
sold = t[t.product_id.isin(top) & (t.quantity > 0)]
unit = (sold.sales_value + sold.retail_disc + sold.coupon_disc) / sold.quantity
price = unit.groupby(sold.product_id).median().rename('shelf_price')
prod = p[p.product_id.isin(top)][['product_id', 'brand', 'product_type', 'package_size']].merge(price, left_on='product_id', right_index=True)
prod.to_parquet(OUT / 'products.parquet', index=False)

print(f'rows {len(rows):,} · visits {rows.basket_id.nunique():,} · households {rows.household_id.nunique():,} · products {len(prod)}')
print(rows.groupby('split').agg(rows=('y', 'size'), weeks=('week', lambda w: f'{w.min()}-{w.max()}'), buys=('y', 'sum')).to_string())
