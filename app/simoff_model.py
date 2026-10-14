"""SimOff-1 without scikit-learn: the fitted boosted trees and the isotonic layer as plain JSON, scored in pure Python.

The serverless deployment cannot carry numpy + pandas + scikit-learn + scipy, so `export()` writes the calibrated
engine from data/engines.pkl to model.json once (locally), and `predict()` walks the same trees: raw score =
baseline + sum of leaf values, probability = sigmoid(raw), then the isotonic map fitted on weeks 45-47.
`check()` compares the two on held-out rows; they agree to floating-point precision.

  python3 sim/app/simoff_model.py export      # writes sim/app/model.json
  python3 sim/app/simoff_model.py check
"""
import bisect
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FEATURES = ['visits', 'avg_spend', 'cereal_visit_rate', 'disc_share', 'cereal_spend_share', 'private_share', 'hp_count',
            'prod_base', 'prod_private', 'front_endcap', 'other_display', 'mailer', 'mailer_front']
_M = None


def _model():
    global _M
    if _M is None:
        _M = json.loads((HERE / 'model.json').read_text())
    return _M


def _leaf(t, x):
    i = 0
    while not t['leaf'][i]:
        v = x[t['f'][i]]
        go_left = t['ml'][i] if v != v else v <= t['th'][i]
        i = t['l'][i] if go_left else t['r'][i]
    return t['v'][i]


def predict(rows):
    """rows: dicts with the 13 features. Returns calibrated purchase probabilities."""
    m = _model()
    X, Y = m['iso_x'], m['iso_y']
    out = []
    for r in rows:
        x = [float(r[k]) for k in FEATURES]
        raw = m['baseline'] + sum(_leaf(t, x) for t in m['trees'])
        p = 1 / (1 + math.exp(-raw))
        if p <= X[0]:
            q = Y[0]
        elif p >= X[-1]:
            q = Y[-1]
        else:
            j = bisect.bisect_right(X, p)
            x0, x1, y0, y1 = X[j - 1], X[j], Y[j - 1], Y[j]
            q = y0 if x1 == x0 else y0 + (y1 - y0) * (p - x0) / (x1 - x0)
        out.append(min(max(q, 1e-6), 1 - 1e-6))
    return out


def export():
    import pickle
    fitted = pickle.loads((HERE.parent / 'data' / 'engines.pkl').read_bytes())['fitted']
    m, iso = fitted['calibrated']
    assert list(m.feature_names_in_) == FEATURES
    trees = []
    for (pred,) in m._predictors:
        n = pred.nodes
        trees.append({'f': n['feature_idx'].tolist(), 'th': n['num_threshold'].tolist(), 'ml': n['missing_go_to_left'].astype(bool).tolist(),
                      'l': n['left'].tolist(), 'r': n['right'].tolist(), 'leaf': n['is_leaf'].astype(bool).tolist(), 'v': n['value'].tolist()})
    out = {'features': FEATURES, 'baseline': float(m._baseline_prediction.ravel()[0]), 'trees': trees,
           'iso_x': iso.X_thresholds_.tolist(), 'iso_y': iso.y_thresholds_.tolist()}
    (HERE / 'model.json').write_text(json.dumps(out, separators=(',', ':')))
    print('model.json', len(trees), 'trees', (HERE / 'model.json').stat().st_size // 1024, 'KB')


def check(n=3000):
    import numpy as np
    import pandas as pd
    sys.path.insert(0, str(HERE.parent))
    from sim import train_engines
    rows = pd.read_parquet(HERE.parent / 'data' / 'rows.parquet')
    te = rows[rows.split == 'test'].sample(n, random_state=0)
    ref = train_engines(rows)['calibrated'].predict(te)
    got = np.array(predict(te[FEATURES].to_dict('records')))
    print('max |diff|', float(np.abs(ref - got).max()), 'rows', n)


if __name__ == '__main__':
    {'export': export, 'check': check}[sys.argv[1]]()
