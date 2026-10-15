"""Load a store dataset into three normalized tables.

Built-in test set: 'dunnhumby' (Complete Journey, 84.51°: 2,469 households, 1 year, 457 stores with
display/mailer records). Your own store: a folder with three CSV files in the same shape.

transactions.csv   household_id, store_id, basket_id, product_id, quantity, sales_value, week,
                   transaction_timestamp  [, retail_disc, coupon_disc]
                   one row per item line on a receipt; week = integer week number; sales_value =
                   amount paid for the line
products.csv       product_id, product_category  [, department, brand, product_type, package_size]
placements.csv     product_id, store_id, week, display_location  [, mailer_location]
                   where the store put the product that week. display_location uses the
                   dunnhumby codes below (0 = not on display); mailer_location '0' = not in the flyer.

Only placements decide the store conditions the model learns, so a store without them can still be
mapped and simulated, but the simulator will only see the "as usual" condition.
"""
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
BUILTIN = {'dunnhumby': HERE / 'datasets' / 'dunnhumby'}

# Official meaning of the codes, from the completejourney R package documentation (promotions).
DISPLAY_CODES = {
    '0': 'Not on display', '1': 'Store front', '2': 'Store rear', '3': 'Front endcap', '4': 'Mid-aisle endcap',
    '5': 'Rear endcap', '6': 'Side-aisle endcap', '7': 'In-aisle display', '9': 'Secondary location display', 'A': 'In-shelf highlight',
}
MAILER_CODES = {
    '0': 'Not in flyer', 'A': 'Interior page feature', 'C': 'Interior page line item', 'D': 'Front page feature', 'F': 'Back page feature', 'H': 'Wrap front feature',
    'J': 'Wrap interior coupon', 'L': 'Wrap back feature', 'P': 'Interior page coupon', 'X': 'Free on interior page', 'Z': 'Free on front or back page',
}
FRONT_MAILER = ['D', 'F', 'H', 'L', 'Z']

REQUIRED = {
    'transactions': ['household_id', 'store_id', 'basket_id', 'product_id', 'quantity', 'sales_value', 'week', 'transaction_timestamp'],
    'products': ['product_id', 'product_category'],
    'placements': ['product_id', 'store_id', 'week', 'display_location'],
}


def load_dataset(name_or_path):
    """Return (transactions, products, placements, info)."""
    if name_or_path in BUILTIN:
        d = BUILTIN[name_or_path]
        t = pd.read_parquet(d / 'transactions.parquet')
        p = pd.read_parquet(d / 'products.parquet')
        pl = pd.read_parquet(d / 'promotions.parquet')
        info = {'name': name_or_path, 'source': 'dunnhumby Complete Journey (84.51°), completejourney R package', 'builtin': True}
    else:
        d = Path(name_or_path)
        if not d.is_dir():
            raise SystemExit(f'no dataset named {name_or_path!r} and no such folder')
        t = pd.read_csv(d / 'transactions.csv', dtype={'household_id': str, 'store_id': str, 'basket_id': str, 'product_id': str})
        p = pd.read_csv(d / 'products.csv', dtype={'product_id': str})
        pl = pd.read_csv(d / 'placements.csv', dtype={'product_id': str, 'store_id': str, 'display_location': str, 'mailer_location': str}) \
            if (d / 'placements.csv').exists() else pd.DataFrame(columns=REQUIRED['placements'])
        info = {'name': d.name, 'source': str(d), 'builtin': False}
    for name, frame in [('transactions', t), ('products', p), ('placements', pl)]:
        missing = [c for c in REQUIRED[name] if c not in frame.columns]
        if missing:
            raise SystemExit(f'{name}: missing columns {missing}')
    for c in ['retail_disc', 'coupon_disc']:
        if c not in t.columns:
            t[c] = 0.0
    for c in ['department', 'brand', 'product_type', 'package_size']:
        if c not in p.columns:
            p[c] = ''
    if 'mailer_location' not in pl.columns:
        pl['mailer_location'] = '0'
    t['transaction_timestamp'] = pd.to_datetime(t.transaction_timestamp)
    for frame, cols in [(t, ['household_id', 'store_id', 'basket_id', 'product_id']), (p, ['product_id']), (pl, ['product_id', 'store_id'])]:
        for c in cols:
            frame[c] = frame[c].astype(str)
    pl['display_location'] = pl.display_location.astype(str)
    pl['mailer_location'] = pl.mailer_location.astype(str)
    info.update({'households': int(t.household_id.nunique()), 'stores': int(t.store_id.nunique()),
                 'stores_with_placements': int(pl.store_id.nunique()), 'weeks': [int(t.week.min()), int(t.week.max())],
                 'receipt_lines': int(len(t)), 'placement_rows': int(len(pl))})
    return t, p, pl, info
