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
mapped and simulated, but the simulator will only see the "평소대로" condition.
"""
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
BUILTIN = {'dunnhumby': HERE / 'datasets' / 'dunnhumby'}

# Official meaning of the codes, from the completejourney R package documentation (promotions).
DISPLAY_CODES = {
    '0': '진열 없음', '1': '매장 앞', '2': '매장 뒤', '3': '앞쪽 엔드캡', '4': '통로 중간 엔드캡',
    '5': '뒤쪽 엔드캡', '6': '옆 통로 엔드캡', '7': '통로 안 진열', '9': '보조 진열대', 'A': '선반 안 강조',
}
MAILER_CODES = {
    '0': '전단 없음', 'A': '안쪽 면 특집', 'C': '안쪽 면 한 줄', 'D': '앞면 특집', 'F': '뒷면 특집', 'H': '겉표지 앞 특집',
    'J': '겉표지 안 쿠폰', 'L': '겉표지 뒤 특집', 'P': '안쪽 면 쿠폰', 'X': '안쪽 면 무료', 'Z': '앞·뒷면 무료',
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
        info = {'name': name_or_path, 'source': 'dunnhumby Complete Journey (84.51°), completejourney R 패키지', 'builtin': True}
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
