"""The decision models a person can pick, with where each one's training data comes from.

A decision model turns (who, what, which store condition) into a calibrated probability of buying. The supermarket
households are one dataset one of them was trained on, not the product: each entry says what it was trained on and
links the source, so the choice reads like picking a model in any frontier-model product.
"""

COMPLETE_JOURNEY = [
    {'label': '84.51° The Complete Journey 2.0', 'url': 'https://www.8451.com/area51'},
    {'label': 'completejourney R 패키지 문서', 'url': 'https://cran.r-project.org/web/packages/completejourney/vignettes/completejourney.html'},
]

MODELS = [
    {'id': 'simoff_retail', 'name': 'SimOff Retail-1', 'tag': '기본',
     'what': '실제 영수증으로 학습한 결정 모델 (부스팅 + 등위 보정). 손님 상태, 상품, 진열 조건으로 살 확률을 냅니다.',
     'trained_on': '미국 식료품 체인 2,469가구의 1년 영수증 · 진열 기록',
     'sources': COMPLETE_JOURNEY, 'live': True},
    {'id': 'simoff_retail_von', 'name': 'SimOff Retail-1 + Von', 'tag': '가장 정확',
     'what': 'Retail-1과 같은 데이터로 학습한 Von의 평균. 모델이 못 본 6주 전체에서 둘 다보다 정확했습니다.',
     'trained_on': '같은 영수증 · 진열 기록 (Von은 그 위에 미세조정)',
     'sources': COMPLETE_JOURNEY + [{'label': 'wfzyx/von (Apache-2.0)', 'url': 'https://github.com/wfzyx/von'}], 'live': False},
    {'id': 'von_ft', 'name': 'Von 1.3 · 미세조정', 'tag': '오픈 가중치',
     'what': '오픈 가중치 결정 모델(395M)을 같은 영수증으로 RLCD 손실로 미세조정한 것. 진열된 방문의 판매를 가장 가깝게 봅니다.',
     'trained_on': 'Von 사전학습 데이터 + 위 영수증',
     'sources': [{'label': 'wfzyx/von (Apache-2.0)', 'url': 'https://github.com/wfzyx/von'}] + COMPLETE_JOURNEY, 'live': False},
    {'id': 'jev', 'name': 'Jev 1.13 + 매장 보정', 'tag': '외부 API',
     'what': 'TypeSafe의 결정 모델. 가중치는 비공개이고, 확률 수준만 이 매장 기록으로 보정했습니다.',
     'trained_on': '공개되지 않음 (TypeSafe가 RLCD로 학습했다고 밝힘)',
     'sources': [], 'live': False},
    {'id': 'persona', 'name': '페르소나 (언어 모델)', 'tag': '비교용',
     'what': '언어 모델이 손님 역할로 답한 것. 구매 기록으로 보정되지 않아 수준과 효과를 크게 틀립니다.',
     'trained_on': '일반 텍스트 · 구매 기록으로 보정 안 됨',
     'sources': [], 'live': False},
]
BY_ID = {m['id']: m for m in MODELS}
DEFAULT = 'simoff_retail'


def get(mid):
    return BY_ID.get(mid) or BY_ID[DEFAULT]
