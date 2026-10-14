"""The simulator's decision model trained on fewer weeks of labels, scored on the same test sample as the Von runs.

Same model and hyperparameters as sim._fit (boosting on 27-44 style rows + isotonic on weeks 45-47); only the
training weeks change. Answers "how much does the from-scratch model lose when a store has little history".

  python3 sim/eval/scripts/gbdt_weeks.py 42 44
"""
import json
import sys

import numpy as np

from von_common import RESULTS, metrics, rows, samples
from sim import COND, HH, _fit

lo, hi = int(sys.argv[1]), int(sys.argv[2])
tr = rows[(rows.split == 'train') & rows.week.between(lo, hi)]
ca = rows[rows.split == 'calib']
m, iso = _fit(tr, ca, HH + COND)
P = lambda X: iso.predict(m.predict_proba(X[HH + COND])[:, 1])  # noqa: E731
cs, ts, ec = samples()
off = ec.assign(front_endcap=0, other_display=0, mailer=0, mailer_front=0)
res = {'weeks': [lo, hi], 'train_rows': int(len(tr)), 'train_buys': int(tr.y.sum()),
       'engine': metrics(ts, P(ts)), 'endcap_lift': float(P(ec).sum() / P(off).sum())}
json.dump(res, open(RESULTS / f'gbdt_weeks_{lo}_{hi}_results.json', 'w'), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != 'engine'} | {k: round(v, 5) for k, v in res['engine'].items() if k != 'by_condition'}))
