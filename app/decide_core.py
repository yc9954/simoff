"""One visit through SimOff-1, with no numpy or pandas: the Try the model answer.

Used by the local server (service.decide) and by the serverless function, so both give the same JSON.
The product table (base purchase rate and store-brand flag per product) comes from decide_products.json,
written by `export_products()` from the training rows.
"""
import json
from pathlib import Path

import simoff_model

HERE = Path(__file__).resolve().parent
FIELDS = {   # name: (default = the average customer, lo, hi) in the units the data uses
    'visits': (50, 1, 300), 'avg_spend': (30.0, 1, 150), 'cereal_visit_rate': (.1, 0, 1), 'disc_share': (.15, 0, .5),
    'private_share': (.2, 0, 1), 'cereal_spend_share': (.013, 0, .2), 'hp_count': (0, 0, 13)}
RANGE = {'visits': (10, 150), 'avg_spend': (12, 60), 'cereal_visit_rate': (.02, .3), 'cereal_spend_share': (.003, .035),
         'disc_share': (.08, .25), 'private_share': (0, .8), 'hp_count': (0, 4)}
LABEL = {'visits': 'Visits', 'avg_spend': 'Spend per trip', 'cereal_visit_rate': 'Trips that include cereal', 'cereal_spend_share': 'Share of spend on cereal',
         'disc_share': 'Share bought on discount', 'private_share': 'Share of store brands', 'hp_count': 'Times bought this product'}
DISPLAY = [('shelf', 'Regular shelf', {'front_endcap': 0, 'other_display': 0}), ('other', 'Secondary display', {'front_endcap': 0, 'other_display': 1}),
           ('front', 'Entrance endcap', {'front_endcap': 1, 'other_display': 0})]
MAILER = [('none', 'No flyer', {'mailer': 0, 'mailer_front': 0}), ('inner', 'Flyer inside page', {'mailer': 1, 'mailer_front': 0}),
          ('front', 'Flyer front page', {'mailer': 1, 'mailer_front': 1})]
_P = None


def products():
    global _P
    if _P is None:
        _P = json.loads((HERE / 'decide_products.json').read_text())
    return _P


def product_list():
    return [{k: p[k] for k in ('product_id', 'brand', 'type', 'size', 'price', 'private')} for p in products()]


def decide(inp):
    """The probability this customer buys this product on one visit, under the asked condition and all nine."""
    by = {p['product_id']: p for p in products()}
    hh = {k: float(min(max(float(inp.get(k, d) if inp.get(k) is not None else d), lo), hi)) for k, (d, lo, hi) in FIELDS.items()}
    pid = str(inp.get('product_id') or products()[0]['product_id'])
    if pid not in by:
        raise KeyError(f'unknown product {pid}')
    pr = by[pid]
    want = (inp.get('display') or 'shelf', inp.get('mailer') or 'none')
    prod = {'prod_base': pr['prod_base'], 'prod_private': pr['prod_private']}
    cells = [(d, dl, df, m, ml, mf) for d, dl, df in DISPLAY for m, ml, mf in MAILER]
    P = simoff_model.predict([{**hh, **prod, **df, **mf} for _, _, df, _, _, mf in cells])
    allc = [{'display': d, 'mailer': m, 'display_label': dl, 'mailer_label': ml, 'p': p} for (d, dl, _, m, ml, _), p in zip(cells, P)]
    ref = next(c['p'] for c in allc if (c['display'], c['mailer']) == ('shelf', 'none'))
    pick = next((c for c in allc if (c['display'], c['mailer']) == want), allc[0])
    flags = {**dict((d, f) for d, _, f in DISPLAY)[pick['display']], **dict((m, f) for m, _, f in MAILER)[pick['mailer']]}
    one = {**hh, **prod, **flags}
    V = [{**one, k: v} for k, (lo, hi) in RANGE.items() for v in (lo, hi)]
    V.append({**one, **{k: d for k, (d, _, _) in FIELDS.items()}})        # the average customer, same product and condition
    Q = simoff_model.predict(V)
    drivers = [{'field': k, 'label': LABEL[k], 'low': lo, 'high': hi, 'p_low': Q[2 * i], 'p_high': Q[2 * i + 1]} for i, (k, (lo, hi)) in enumerate(RANGE.items())]
    drivers.sort(key=lambda d: -abs(d['p_high'] - d['p_low']))
    return {'model': 'SimOff-1', 'input': {**hh, 'product_id': pid, 'display': pick['display'], 'mailer': pick['mailer']},
            'average_customer_p': Q[-1], 'drivers': drivers,
            'product': {'brand': pr['brand'], 'type': pr['type'], 'size': pr['size'], 'price': pr['price']},
            'p_buy': pick['p'], 'per_1000_visits': pick['p'] * 1000, 'lift_vs_shelf': pick['p'] / ref if ref else None,
            'all_conditions': [{**c, 'lift': c['p'] / ref if ref else None} for c in allc]}


def export_products():
    import pandas as pd
    rows = pd.read_parquet(HERE.parent / 'data' / 'rows.parquet', columns=['product_id', 'prod_base', 'prod_private'])
    base = rows.groupby('product_id')[['prod_base', 'prod_private']].first()
    pr = pd.read_parquet(HERE.parent / 'data' / 'products.parquet').set_index('product_id').join(base, how='inner').sort_values('prod_base', ascending=False)
    out = [{'product_id': str(i), 'brand': r.brand, 'type': r.product_type, 'size': r.package_size, 'price': round(float(r.shelf_price), 2),
            'private': bool(r.prod_private), 'prod_base': float(r.prod_base), 'prod_private': float(r.prod_private)} for i, r in pr.iterrows()]
    (HERE / 'decide_products.json').write_text(json.dumps(out, indent=1))
    print('decide_products.json', len(out))


if __name__ == '__main__':
    export_products()
