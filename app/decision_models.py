"""The decision models a person can pick, with where each one's training data comes from.

A decision model turns (who, what, which store condition) into a calibrated probability of buying. The supermarket
households are one dataset one of them was trained on, not the product: each entry says what it was trained on and
links the source, so the choice reads like picking a model in any frontier-model product.
"""

CJ = {'label': '84.51° Complete Journey · 미국 2,469가구 1년', 'url': 'https://www.8451.com/area51'}
# title: named after the data it learned from (what a person is really choosing); source: one line, linked when public
MODELS = [
    {'id': 'simoff_retail', 'title': 'SimOff-1', 'source': CJ, 'name': 'SimOff-1',
     'what': '미국 식료품 체인 2,469가구의 1년 영수증 · 진열 기록으로 학습한 결정 모델 (부스팅 + 등위 보정)',
     'trained_on': '미국 식료품 체인 2,469가구의 1년 영수증 · 진열 기록', 'live': True},
    {'id': 'jev_raw', 'title': 'Jev', 'source': {'label': 'TypeSafe API 그대로 · 학습 데이터 비공개', 'url': None},
     'name': 'Jev', 'what': 'TypeSafe의 결정 모델을 보정 없이 그대로 쓴 것', 'trained_on': '공개되지 않음', 'live': False},
    {'id': 'persona', 'title': '언어 모델 페르소나', 'source': {'label': '구매 기록 없음 · 비교용', 'url': None},
     'name': '언어 모델 페르소나', 'what': '언어 모델이 손님 역할로 답한 것 (구매 기록으로 보정 안 됨)', 'trained_on': '일반 텍스트', 'live': False},
]
BY_ID = {m['id']: m for m in MODELS}
DEFAULT = 'simoff_retail'


def get(mid):
    return BY_ID.get(mid) or BY_ID[DEFAULT]
