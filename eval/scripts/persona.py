"""Persona-agent engine: ask an OpenAI model (via the logged-in codex CLI) to role-play households.

Same 80 (household, product) pairs from the held-out weeks, each asked under 4 store conditions.
Variant 'basic'   : demographics only (the usual persona prompt)
Variant 'history' : demographics + numeric purchase history (a fairer, better-informed persona)
Cases are shuffled into batches of 8 so no batch holds two cases of the same pair.
"""
import json
import random
import subprocess
import sys
import concurrent.futures as cf
from pathlib import Path
import pandas as pd

S = Path(sys.argv[1])
rows = pd.read_parquet(S / 'cj_exp/results_test_pred.parquet')
demo = pd.read_parquet(S / 'cj_data/demographics.parquet')
prod = pd.read_parquet(S / 'cj_data/products.parquet').set_index('product_id')
OUT = S / 'cj_exp/persona'
OUT.mkdir(exist_ok=True)

random.seed(7)
cand = rows[rows.has_demo == 1][['household_id', 'product_id']].drop_duplicates()
pairs = cand.sample(80, random_state=7)
hh = rows.drop_duplicates('household_id').set_index('household_id')
demo = demo.set_index('household_id')

COND_TXT = {
    'none': 'This week the product sits on its regular shelf in the cereal aisle. No special display, no ad.',
    'A_front_endcap': 'This week the product is stacked on the front end-cap display at the head of an aisle, near the store entrance.',
    'B_mailer_only': "This week the product is featured in the store's weekly mailer. In the store it is on its regular shelf.",
    'C_other_display': 'This week the product has an extra in-store display inside the aisle, besides its regular shelf spot.',
}


def persona(h, variant):
    d = demo.loc[h]
    txt = (f"Age {d.age}, household income {d.income}, {d.marital_status}, {d.home_ownership if pd.notna(d.home_ownership) else 'housing unknown'}, "
           f"household of {d.household_size} ({d.household_comp}).")
    if variant == 'history':
        r = hh.loc[h]
        txt += (f" Over the last 26 weeks you made {int(r.visits)} shopping trips to this store and bought some cold cereal on "
                f"{r.cereal_visit_rate * 100:.0f}% of them.")
    return txt


def product(pid, h, variant):
    pr = prod.loc[pid]
    txt = f"a {pr.brand.lower()}-brand {str(pr.product_type).lower()} ({pr.package_size} box)"
    if variant == 'history':
        k = int(rows[(rows.household_id == h) & (rows.product_id == pid)].hp_count.iloc[0])
        txt += f"; in those 26 weeks you bought this exact product on {k} trips"
    return txt


def cases(variant):
    out = []
    for _, r in pairs.iterrows():
        for c in COND_TXT:
            out.append({'household_id': r.household_id, 'product_id': r.product_id, 'condition': c,
                        'text': f"Shopper: {persona(r.household_id, variant)} Product: {product(r.product_id, r.household_id, variant)}. Situation: {COND_TXT[c]}"})
    random.shuffle(out)
    batches, pool = [], out[:]
    while pool:
        b, seen = [], set()
        for x in pool[:]:
            key = (x['household_id'], x['product_id'])
            if key not in seen and len(b) < 8:
                b.append(x); seen.add(key); pool.remove(x)
        batches.append(b)
    return batches


PROMPT = ("You will role-play {n} different grocery shoppers. Treat every case as a separate person; do not compare cases.\n"
          "For each case, say how likely this shopper is to put this exact product in their basket on this one shopping trip.\n"
          "Return ONLY a JSON array, one object per case: {{\"id\": <id>, \"p\": <probability 0-100>, \"buy\": \"yes\" or \"no\"}}.\n\n{cases}")


def run(variant, i, batch):
    f = OUT / f'{variant}_{i:03d}.json'
    if f.exists():
        return json.loads(f.read_text())
    body = '\n'.join(f"Case {j}: {x['text']}" for j, x in enumerate(batch))
    last = OUT / f'{variant}_{i:03d}.txt'
    subprocess.run(['codex', 'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-o', str(last), PROMPT.format(n=len(batch), cases=body)],
                   capture_output=True, text=True, timeout=300, cwd=str(OUT))
    raw = last.read_text().strip()
    ans = json.loads(raw[raw.find('['): raw.rfind(']') + 1])
    res = [{**{k: batch[a['id']][k] for k in ['household_id', 'product_id', 'condition']}, 'p': float(a['p']) / 100, 'buy': a['buy']} for a in ans]
    f.write_text(json.dumps(res))
    return res


allres = []
for variant in ['basic', 'history']:
    bs = cases(variant)
    with cf.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(run, variant, i, b): i for i, b in enumerate(bs)}
        for fu in cf.as_completed(futs):
            try:
                allres += [{**r, 'variant': variant} for r in fu.result()]
            except Exception as e:
                print('batch failed', variant, futs[fu], repr(e)[:200])
pd.DataFrame(allres).to_parquet(S / 'cj_exp/persona_answers.parquet')
pairs.to_parquet(S / 'cj_exp/persona_pairs.parquet')
print('answers', len(allres))
