"""Jev engine (zero-shot, no training available): same 80 pairs x 4 conditions as the persona test.

Variant 'jev_text'  : the persona-style demographic description as state
Variant 'jev_state' : the numeric household state our endpoints compute, as a JSON object
One state per request (the API takes a single state); noul question -> probability of buying.
"""
import json
import os
import sys
import time
import urllib.request
import concurrent.futures as cf
from pathlib import Path
import pandas as pd

S = Path(sys.argv[1])
KEY = (S / '.jev_key').read_text().strip()
rows = pd.read_parquet(S / 'cj_exp/rows.parquet')
te = rows[rows.split == 'test']
pairs = pd.read_parquet(S / 'cj_exp/persona_pairs.parquet')
demo = pd.read_parquet(S / 'cj_data/demographics.parquet').set_index('household_id')
prod = pd.read_parquet(S / 'cj_data/products.parquet').set_index('product_id')
OUT = S / 'cj_exp/jev'
OUT.mkdir(exist_ok=True)
COND_TXT = {
    'none': 'regular shelf in the cereal aisle; no special display, no ad this week',
    'A_front_endcap': 'front end-cap display at the head of an aisle near the store entrance this week',
    'B_mailer_only': "featured in this week's store mailer; regular shelf in store",
    'C_other_display': 'extra in-store display inside the aisle this week, besides its regular shelf',
}
QUESTION = {'buy': {'type': 'noul', 'instructions': 'On this one shopping trip, does this shopper put this exact product in the basket?',
                    'criteria': {'true': 'puts this exact product in the basket on this trip', 'false': 'does not buy it on this trip'}}}
base = te.drop_duplicates(['household_id', 'product_id']).merge(pairs, on=['household_id', 'product_id']).set_index(['household_id', 'product_id'])


def state(h, pid, c, variant):
    pr = prod.loc[pid]
    product = f"{pr.brand.lower()}-brand {str(pr.product_type).lower()} ({pr.package_size})"
    if variant == 'jev_text':
        d = demo.loc[h]
        return {'shopper': f"Age {d.age}, income {d.income}, {d.marital_status}, household of {d.household_size} ({d.household_comp})",
                'product': product, 'situation': COND_TXT[c]}
    r = base.loc[(h, pid)]
    return {'shopper_last_26_weeks': {'trips_to_this_store': int(r.visits), 'share_of_trips_with_cold_cereal': round(float(r.cereal_visit_rate), 3),
                                      'trips_buying_this_exact_product': int(r.hp_count), 'avg_basket_usd': round(float(r.avg_spend), 1),
                                      'share_of_spend_discounted': round(float(r.disc_share), 3), 'private_label_share_in_cereal': round(float(r.private_share), 3)},
            'product': {'description': product, 'share_of_all_store_trips_that_buy_it': round(float(r.prod_base), 5)},
            'store_condition_this_week': COND_TXT[c]}


def call(job):
    h, pid, c, v = job
    f = OUT / f'{v}_{h}_{pid}_{c}.json'
    if f.exists():
        return json.loads(f.read_text())
    body = json.dumps({'model': 'jev-latest', 'state': state(h, pid, c, v), 'questions': QUESTION}).encode()
    for attempt in range(6):
        try:
            req = urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=body, method='POST',
                                         headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=60) as resp:
                out = json.loads(resp.read())
            rec = {'household_id': h, 'product_id': pid, 'condition': c, 'variant': v, 'p': out['answers']['buy']['noul'], 'model': out['model']}
            f.write_text(json.dumps(rec))
            return rec
        except urllib.error.HTTPError as e:
            if e.code in (429, 529, 500, 502, 503):
                time.sleep(2 ** attempt); continue
            raise
        except Exception:
            time.sleep(2 ** attempt)
    raise RuntimeError('gave up')


jobs = [(h, pid, c, v) for (h, pid) in base.index for c in COND_TXT for v in ['jev_text', 'jev_state']]
res, fails = [], 0
with cf.ThreadPoolExecutor(8) as ex:
    for fu in cf.as_completed([ex.submit(call, j) for j in jobs]):
        try:
            res.append(fu.result())
        except Exception as e:
            fails += 1
pd.DataFrame(res).to_parquet(S / 'cj_exp/jev_answers.parquet')
print('answers', len(res), 'fails', fails, 'models', pd.DataFrame(res).model.unique())
