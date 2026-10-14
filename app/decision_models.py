"""The decision models a person can pick, with where each one's training data comes from.

A decision model turns (who, what, which store condition) into a calibrated probability of buying. The supermarket
households are one dataset one of them was trained on, not the product: each entry says what it was trained on and
links the source, so the choice reads like picking a model in any frontier-model product.
"""

CJ = {'label': '84.51° Complete Journey · 2,469 US households · 1 year', 'url': 'https://www.8451.com/area51'}
# title: named after the data it learned from (what a person is really choosing); source: one line, linked when public
MODELS = [
    {'id': 'simoff_retail', 'title': 'SimOff-1', 'source': CJ, 'name': 'SimOff-1',
     'what': 'A decision model trained on a year of receipts and display records from 2,469 households at a US grocery chain (gradient boosting with isotonic calibration)',
     'trained_on': 'A year of receipts and display records from 2,469 households at a US grocery chain', 'live': True},
    {'id': 'jev_raw', 'title': 'Jev', 'source': {'label': 'TypeSafe API as-is · training data not public', 'url': None},
     'name': 'Jev', 'what': "TypeSafe's decision model used as-is, without calibration", 'trained_on': 'Not public', 'live': False},
    {'id': 'persona', 'title': 'Language-model persona', 'source': {'label': 'No purchase records · for comparison', 'url': None},
     'name': 'Language-model persona', 'what': 'A language model answering in the role of a shopper (not calibrated on purchase records)', 'trained_on': 'General text', 'live': False},
]
BY_ID = {m['id']: m for m in MODELS}
DEFAULT = 'simoff_retail'


def get(mid):
    return BY_ID.get(mid) or BY_ID[DEFAULT]
