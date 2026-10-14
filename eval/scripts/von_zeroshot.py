"""Von as released (zero-shot), on the same rows Jev saw in jev_calib.py, then our isotonic layer on top.

Runs Von locally through its own backend (same packing, temperature and calibration map as `von serve`).
P(yes) is read from `noul_raw`, Von's calibrated posterior before its band decision rule.
Per-row answers are kept in results/von_zeroshot_answers.parquet so the run never has to be repeated.

  .venv/bin/python sim/eval/scripts/von_zeroshot.py   (the venv that has von-sdk installed)
"""
import json
import os
import time

import numpy as np
import torch
import pandas as pd
from sklearn.isotonic import IsotonicRegression

os.environ.setdefault('VON_NOUL_DECISION', 'raw')
from von.backends.option_marker_backend import OptionMarkerBackend  # noqa: E402
from von.types import Noul  # noqa: E402

from von_common import CRITERIA, INSTRUCTIONS, RESULTS, actual, gbdt_predictions, metrics, samples, state_text  # noqa: E402

backend = OptionMarkerBackend(device=os.environ.get('VON_DEVICE', 'mps'))
Q = Noul(instructions=INSTRUCTIONS, criteria=CRITERIA)


model = backend._get_model()
tok = model.tokenizer
DESC = [CRITERIA['true'], CRITERIA['false']]


@torch.no_grad()
def ask(df, cond=None, bs=32):
    """Batched forward pass, then Von's own per-request temperature: same numbers as evaluate_noul, ~10x faster."""
    out, t = [], time.time()
    for i in range(0, len(df), bs):
        texts = [state_text(r, cond) for r in df.iloc[i:i + bs].itertuples()]
        enc = tok([model.pack_sequence(x, INSTRUCTIONS, DESC) for x in texts], return_tensors='pt', padding=True).to(backend.device)
        pos = [(ids == model.mask_token_id).nonzero(as_tuple=True)[0].tolist() for ids in enc['input_ids']]
        logits = model(input_ids=enc['input_ids'], attention_mask=enc['attention_mask'], mask_positions=pos,
                       independent_options=backend._independent_options)
        for x, lg in zip(texts, logits):
            T = backend._effective_temperature(lg, x, 2, tok, None)
            out.append(round(float(torch.softmax(lg / max(T, 1e-4), dim=-1)[0]), 4))
        if i and i % 640 == 0:
            print(f'  {i}/{len(df)}  {(time.time() - t) / i * 1000:.0f} ms/row', flush=True)
    return np.array(out, dtype=float)


if os.environ.get('VON_CHECK'):  # batched path must equal Von's own evaluate_noul
    d = samples()[1].iloc[:40]
    a = ask(d); b = np.array([backend.evaluate_noul('buy', state_text(r), Q).noul_raw for r in d.itertuples()])
    print('max abs diff vs evaluate_noul:', float(np.abs(a - b).max()), a[:5], b[:5]); raise SystemExit


cs, ts, ec = samples()
print(f'calib {len(cs)} · test {len(ts)} · endcap {len(ec)}', flush=True)
t0 = time.time()
cs['von'] = ask(cs)
ts['von'] = ask(ts)
ec_with, ec_without = ask(ec), ask(ec, 'none')
secs = time.time() - t0

iso = IsotonicRegression(out_of_bounds='clip', y_min=1e-6, y_max=1 - 1e-6).fit(cs.von, cs.y, sample_weight=cs.w)
ts['von_cal'] = iso.predict(ts.von)
ts['gbdt'], ts['no_promo'] = gbdt_predictions(ts)
ec_g = gbdt_predictions(ec)[0], gbdt_predictions(ec.assign(front_endcap=0, other_display=0, mailer=0, mailer_front=0))[0]

res = {'rows_scored': int(len(cs) + len(ts) + 2 * len(ec)), 'seconds': round(secs, 1), 'cost_usd': 0,
       'distinct_values_test': int(ts.von.nunique()), 'min_p_test': float(ts.von.min()), 'max_p_test': float(ts.von.max()),
       'actual': actual(ts), 'engines': {}}
for name, col in [('von_raw', 'von'), ('von_calibrated', 'von_cal'), ('gbdt_calibrated', 'gbdt'), ('no_promo', 'no_promo')]:
    res['engines'][name] = metrics(ts, ts[col])
res['endcap_lift'] = {'rows': len(ec), 'von_raw': float(ec_with.sum() / ec_without.sum()),
                      'von_calibrated': float(iso.predict(ec_with).sum() / iso.predict(ec_without).sum()),
                      'gbdt_calibrated': float(ec_g[0].sum() / ec_g[1].sum())}
json.dump(res, open(RESULTS / 'von_zeroshot_results.json', 'w'), indent=1)
pd.concat([cs.assign(sample='calib')[['basket_id', 'product_id', 'condition', 'y', 'w', 'sample', 'von']],
           ts.assign(sample='test')[['basket_id', 'product_id', 'condition', 'y', 'w', 'sample', 'von']],
           ec.assign(sample='endcap_with', von=ec_with)[['basket_id', 'product_id', 'condition', 'y', 'sample', 'von']],
           ec.assign(sample='endcap_without', condition='none', von=ec_without)[['basket_id', 'product_id', 'condition', 'y', 'sample', 'von']]]
          ).to_parquet(RESULTS / 'von_zeroshot_answers.parquet')
print(json.dumps(res, indent=1))
