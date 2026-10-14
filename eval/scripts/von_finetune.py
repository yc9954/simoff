"""Fine-tune Von on this store's receipts with its own RLCD objective, then score it like every other engine.

Objective: Von's RLCD loss as written in its repo (training/train_rlcd.py, train_option_marker.py):
cross-entropy + 0.5 x Brier on the softmax over the option markers. For a noul question that is P(yes) vs P(no).
Training rows: weeks 27-44 (the simulator's training weeks), every buy + `neg_ratio` non-buys per buy.
The sample over-represents buys, so after training the yes-logit is shifted by log(sampled share of non-buys)
(the standard prior correction for case-control sampling); the isotonic layer on weeks 45-47 is reported too.
The checkpoint kept is the one with the lowest true-rate log loss on weeks 45-47, never accuracy
(at a 0.16% buy rate "always no" is 99.8% accurate).

  .venv/bin/python sim/eval/scripts/von_finetune.py --tag full --weeks 27 44 --neg-ratio 4 --epochs 2
"""
import argparse
import json
import math
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.isotonic import IsotonicRegression

os.environ.setdefault('VON_NOUL_DECISION', 'raw')
from von.backends.option_marker_backend import OptionMarkerBackend  # noqa: E402

from von_common import CRITERIA, INSTRUCTIONS, RESULTS, actual, metrics, samples, state_text, train_sample  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--tag', required=True)
ap.add_argument('--weeks', type=int, nargs=2, default=(27, 44))
ap.add_argument('--neg-ratio', type=float, default=4.0)
ap.add_argument('--epochs', type=int, default=2)
ap.add_argument('--lr', type=float, default=1.5e-5)
ap.add_argument('--batch', type=int, default=8)
ap.add_argument('--brier-weight', type=float, default=0.5)
ap.add_argument('--train-layers', type=int, default=4, help='train only the top N encoder layers + the scorer (memory)')
ap.add_argument('--seed', type=int, default=7)
ap.add_argument('--max-steps', type=int, default=0, help='stop early (speed probe)')
ap.add_argument('--ckpt-dir', default=os.environ.get('VON_FT_DIR', '/tmp/von-ft'))
args = ap.parse_args()

dev = torch.device(os.environ.get('VON_DEVICE', 'mps'))
backend = OptionMarkerBackend(device=str(dev))
model = backend._get_model()
indep = backend._independent_options
tok = model.tokenizer
DESC = [CRITERIA['true'], CRITERIA['false']]


def encode(texts):
    packed = [model.pack_sequence(t, INSTRUCTIONS, DESC) for t in texts]
    enc = tok(packed, return_tensors='pt', padding=True, truncation=True, max_length=1024)
    pos = [(ids == model.mask_token_id).nonzero(as_tuple=True)[0].tolist() for ids in enc['input_ids']]
    assert all(len(p) == 2 for p in pos), 'option markers lost'
    return enc['input_ids'].to(dev), enc['attention_mask'].to(dev), pos


def yes_logit(texts):
    """log P(yes) - log P(no) at temperature 1."""
    ids, am, pos = encode(texts)
    out = model(input_ids=ids, attention_mask=am, mask_positions=pos, independent_options=indep)
    return torch.stack([o[0] - o[1] for o in out])


@torch.no_grad()
def score(df, cond=None, bs=32):
    model.eval()
    out = []
    for i in range(0, len(df), bs):
        out.append(yes_logit([state_text(r, cond) for r in df.iloc[i:i + bs].itertuples()]).float().cpu())
    return torch.cat(out).numpy()


sig = lambda z: 1 / (1 + np.exp(-z))  # noqa: E731

# ---- data
full = train_sample(n_neg=10 ** 9, weeks=tuple(args.weeks))
pos, neg = full[full.y == 1], full[full.y == 0]
k = min(len(neg), int(len(pos) * args.neg_ratio))
torch.manual_seed(args.seed)
tr = pd.concat([pos, neg.sample(k, random_state=args.seed)]).sample(frac=1, random_state=args.seed)
offset = math.log(k / len(neg))  # prior correction for the sampled non-buys
cs, ts, ec = samples()
print(f'train weeks {args.weeks}: {len(pos)} buys + {k} of {len(neg):,} non-buys · offset {offset:.3f} · calib {len(cs)} · test {len(ts)}', flush=True)


def calib_logloss():
    z = score(cs) + offset
    p = np.clip(sig(z), 1e-6, 1 - 1e-6)
    return float(-np.average(cs.y * np.log(p) + (1 - cs.y) * np.log(1 - p), weights=cs.w))


# ---- train: freeze the encoder except its top layers (full fine-tuning of 395M params swaps a 16 GB Mac)
layers = model.encoder.layers
for p_ in model.encoder.parameters():
    p_.requires_grad = False
for p_ in list(layers[len(layers) - args.train_layers:].parameters()) + list(model.encoder.final_norm.parameters()):
    p_.requires_grad = True
trainable = [p_ for p_ in model.parameters() if p_.requires_grad]
print(f'training {sum(p_.numel() for p_ in trainable) / 1e6:.1f}M of {sum(p_.numel() for p_ in model.parameters()) / 1e6:.1f}M params ({args.train_layers} of {len(layers)} layers + scorer)', flush=True)
opt = torch.optim.AdamW(trainable, lr=args.lr, weight_decay=0.01)
steps = math.ceil(len(tr) / args.batch) * args.epochs
sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, s / max(1, int(.1 * steps))) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / steps))))
best = {'calib_logloss': calib_logloss(), 'epoch': 0}
print(f'epoch 0 (released Von + offset) calib log loss {best["calib_logloss"]:.5f}', flush=True)
ckpt = Path(args.ckpt_dir) / args.tag
ckpt.mkdir(parents=True, exist_ok=True)
torch.save(model.state_dict(), ckpt / 'option_marker.pt')
step, t0, log = 0, time.time(), []
for ep in range(1, args.epochs + 1):
    model.train()
    for i in range(0, len(tr), args.batch):
        b = tr.iloc[i:i + args.batch]
        z = yes_logit([state_text(r) for r in b.itertuples()])
        y = torch.tensor(b.y.values, dtype=torch.float32, device=dev)
        p = torch.sigmoid(z)
        ce = torch.nn.functional.binary_cross_entropy_with_logits(z, y)
        brier = (2 * (p - y) ** 2).mean()  # sum over the two options of (p - onehot)^2
        loss = ce + args.brier_weight * brier
        opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(trainable, 1.0); opt.step(); sched.step()
        step += 1
        if step % 25 == 0:
            el = time.time() - t0
            print(f'  ep {ep} step {step}/{steps} loss {loss.item():.4f} · {el / step:.2f}s/step · eta {(steps - step) * el / step / 60:.0f} min', flush=True)
        if args.max_steps and step >= args.max_steps:
            break
    ll = calib_logloss()
    log.append({'epoch': ep, 'step': step, 'calib_logloss': ll, 'minutes': round((time.time() - t0) / 60, 1)})
    print(f'epoch {ep} calib log loss {ll:.5f}', flush=True)
    if ll < best['calib_logloss']:
        best = {'calib_logloss': ll, 'epoch': ep}
        torch.save(model.state_dict(), ckpt / 'option_marker.pt')
    if args.max_steps and step >= args.max_steps:
        break

# ---- evaluate the kept checkpoint
model.load_state_dict(torch.load(ckpt / 'option_marker.pt', map_location=dev))
zc, zt = score(cs) + offset, score(ts) + offset
ts['ft'] = sig(zt)
iso = IsotonicRegression(out_of_bounds='clip', y_min=1e-6, y_max=1 - 1e-6).fit(sig(zc), cs.y, sample_weight=cs.w)
ts['ft_cal'] = iso.predict(ts.ft)
ew, eo = sig(score(ec) + offset), sig(score(ec, 'none') + offset)
res = {'tag': args.tag, 'args': {k2: (list(v) if isinstance(v, tuple) else v) for k2, v in vars(args).items()},
       'train': {'buys': int(len(pos)), 'non_buys_sampled': int(k), 'non_buys_total': int(len(neg)), 'offset': offset, 'steps': step},
       'kept_epoch': best['epoch'], 'epochs': log, 'minutes': round((time.time() - t0) / 60, 1), 'actual': actual(ts),
       'engines': {'von_ft': metrics(ts, ts.ft), 'von_ft_calibrated': metrics(ts, ts.ft_cal)},
       'endcap_lift': {'rows': len(ec), 'von_ft': float(ew.sum() / eo.sum()), 'von_ft_calibrated': float(iso.predict(ew).sum() / iso.predict(eo).sum())}}
json.dump(res, open(RESULTS / f'von_ft_{args.tag}_results.json', 'w'), indent=1)
ts[['basket_id', 'product_id', 'condition', 'y', 'w', 'ft', 'ft_cal']].to_parquet(RESULTS / f'von_ft_{args.tag}_answers.parquet')
print(json.dumps(res, indent=1))
