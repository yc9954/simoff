"""Score rows with a fine-tuned Von checkpoint: writes the yes-logit (log P(yes) - log P(no), temperature 1).

  python von_score.py --ckpt /ckpt/full18_s0/option_marker.pt --shard 0 --nshards 4 --out logits_0.npy
The prior-correction offset from training is applied later, by whoever reads the logits.
"""
import argparse
import os
import time

import numpy as np
import torch

os.environ.setdefault('VON_NOUL_DECISION', 'raw')
from von.backends.option_marker_backend import OptionMarkerBackend  # noqa: E402

from von_common import CRITERIA, INSTRUCTIONS, full_rows, rows, state_text  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--ckpt', required=True)
ap.add_argument('--shard', type=int, default=0)
ap.add_argument('--nshards', type=int, default=1)
ap.add_argument('--limit', type=int, default=0)
ap.add_argument('--bs', type=int, default=256)
ap.add_argument('--out', required=True)
args = ap.parse_args()

dev = torch.device(os.environ.get('VON_DEVICE', 'cuda'))
torch.backends.cuda.matmul.allow_tf32 = True
backend = OptionMarkerBackend(device=str(dev))
model = backend._get_model()
model.load_state_dict(torch.load(args.ckpt, map_location=dev))
model.eval()
tok, indep = model.tokenizer, backend._independent_options
DESC = [CRITERIA['true'], CRITERIA['false']]

todo = full_rows().iloc[args.shard::args.nshards]
if args.limit:
    todo = todo.iloc[:args.limit]
R = rows.loc[todo.row.values]
texts = [state_text(r, c) for r, c in zip(R.itertuples(), todo.cond.values)]
out, t0 = np.empty(len(texts), dtype=np.float32), time.time()
with torch.no_grad():
    for i in range(0, len(texts), args.bs):
        enc = tok([model.pack_sequence(x, INSTRUCTIONS, DESC) for x in texts[i:i + args.bs]], return_tensors='pt', padding=True).to(dev)
        pos = [(ids == model.mask_token_id).nonzero(as_tuple=True)[0].tolist() for ids in enc['input_ids']]
        lg = model(input_ids=enc['input_ids'], attention_mask=enc['attention_mask'], mask_positions=pos, independent_options=indep)
        out[i:i + len(lg)] = torch.stack([o[0] - o[1] for o in lg]).float().cpu().numpy()
        if i // args.bs % 100 == 0:
            print(f'{i + len(lg)}/{len(texts)} · {(i + len(lg)) / (time.time() - t0):.0f} rows/s', flush=True)
np.save(args.out, out)
print(f'done {len(texts)} rows in {time.time() - t0:.0f}s', flush=True)
