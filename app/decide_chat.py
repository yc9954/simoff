"""모델 체험's chat: a sentence about a customer, a product and a store condition becomes SimOff-1's input.

Claude reads the sentence and calls the `decide` tool with the fields it can infer (anything unsaid stays at the
average customer); each call runs service.decide and goes back to the browser as the request/response pair the
right-hand panel shows. Claude never makes up a probability: the only numbers it may quote come from the tool.
Without a working key, a few rules read the same sentence.
"""
import json
import os
import re
import urllib.error
import urllib.request

import service

FIELDS = {
    'visits': ('integer', '26주(반년) 동안 매장에 온 횟수. 주 2번이면 52, 한 달에 한 번이면 6'),
    'avg_spend': ('number', '한 번 장볼 때 평균 지출 (달러)'),
    'cereal_visit_rate': ('number', '방문 중 시리얼을 사는 방문의 비율 0–1'),
    'cereal_spend_share': ('number', '전체 지출 중 시리얼 비중 0–0.2 (보통 0.01)'),
    'disc_share': ('number', '할인 상품을 사는 비중 0–0.5 (보통 0.15)'),
    'private_share': ('number', '자체 브랜드(PB) 상품 비중 0–1 (보통 0.2)'),
    'hp_count': ('integer', '이 상품을 전에 산 횟수'),
}
SYSTEM = """너는 SimOff-1 결정 모델의 입력을 만들어 주는 도우미다. SimOff-1은 한 손님이 매장에 한 번 들렀을 때 특정 시리얼 상품을 살 확률을 낸다.
사용자가 손님, 상품, 매장 조건을 말로 설명하면 decide 도구를 부른다. 말하지 않은 값은 비워 둔다(평균 손님 값이 들어간다).
둘 이상을 비교해 달라고 하면 decide 를 여러 번 부른다.

상품 목록 (product_id: 설명)
{products}

매장 조건: display = shelf(평소 선반) | other(매장 안 보조 진열) | front(입구 엔드캡), mailer = none(전단 없음) | inner(전단 안쪽 면) | front(전단 1면).

답은 한국어로 2~4문장. 숫자는 도구가 돌려준 것만 쓴다(확률은 %로, 소수 둘째 자리까지). 어떤 값으로 해석했는지 한 문장, 결과 한 문장, 가장 크게 움직이는 요인 한 문장.
마크다운 제목과 목록은 쓰지 않는다. 도구 이름이나 필드 이름(영문)은 말하지 않는다."""


def _tools(products):
    props = {k: {'type': t, 'description': d} for k, (t, d) in FIELDS.items()}
    props['product_id'] = {'type': 'string', 'enum': [p['product_id'] for p in products]}
    props['display'] = {'type': 'string', 'enum': ['shelf', 'other', 'front']}
    props['mailer'] = {'type': 'string', 'enum': ['none', 'inner', 'front']}
    props['label'] = {'type': 'string', 'description': '이 경우를 부를 짧은 이름 (예: 시리얼 단골 · 입구 엔드캡)'}
    return [{'name': 'decide', 'description': 'SimOff-1로 한 손님 · 한 상품 · 한 매장 조건의 구매 확률과 분석을 계산한다.', 'input_schema': {'type': 'object', 'properties': props}}]


def _post(body):
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps(body).encode(),
                                 headers={'x-api-key': os.environ['ANTHROPIC_API_KEY'], 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise service._http_error('Claude', e) from None
    u = d.get('usage') or {}
    service._log_usage('anthropic', body['model'], 'decide_chat', u.get('input_tokens'), u.get('output_tokens'))
    return d


def _call(inp):
    req = {k: v for k, v in inp.items() if k != 'label' and v is not None}
    return {'label': inp.get('label') or '', 'request': req, 'response': service.decide(req)}


def _brief(res):        # what Claude sees of a result: enough to explain it, without the full grid
    r = res['response']
    return {'p_buy_percent': round(r['p_buy'] * 100, 3), 'lift_vs_shelf': round(r['lift_vs_shelf'], 2),
            'average_customer_percent': round(r['average_customer_p'] * 100, 3), 'used_input': r['input'],
            'biggest_drivers': [{'trait': d['label'], 'low': d['low'], 'high': d['high'],
                                 'percent_low': round(d['p_low'] * 100, 3), 'percent_high': round(d['p_high'] * 100, 3)} for d in r['drivers'][:3]]}


def chat(history):
    products = service.decide_products()
    if os.environ.get('ANTHROPIC_API_KEY'):
        try:
            return _claude(history, products)
        except Exception as e:  # noqa: BLE001 — rules answer instead, and the reply says so
            out = _rules(history, products)
            out['note'] = str(e)[:160]
            return out
    return _rules(history, products)


def _claude(history, products):
    plist = '\n'.join(f"{p['product_id']}: {p['type']} {p['size']} ${p['price']}{' (자체 브랜드)' if p['private'] else ''}" for p in products)
    msgs = [{'role': h['role'], 'content': h['text']} for h in history if h.get('text')]
    calls = []
    for _ in range(5):
        d = _post({'model': service.llm_model(), 'max_tokens': 900, 'system': SYSTEM.format(products=plist), 'tools': _tools(products), 'messages': msgs})
        msgs.append({'role': 'assistant', 'content': d['content']})
        uses = [c for c in d['content'] if c.get('type') == 'tool_use']
        if not uses:
            return {'reply': ''.join(c.get('text', '') for c in d['content'] if c.get('type') == 'text').strip(), 'calls': calls, 'by': service.llm_model()}
        results = []
        for t in uses:
            try:
                res = _call(t.get('input') or {})
                calls.append(res)
                content = json.dumps(_brief(res), ensure_ascii=False)
            except Exception as e:  # noqa: BLE001
                content = json.dumps({'error': str(e)})
            results.append({'type': 'tool_result', 'tool_use_id': t['id'], 'content': content})
        msgs.append({'role': 'user', 'content': results})
    return {'reply': '여기까지 계산했습니다.', 'calls': calls, 'by': service.llm_model()}


def _rules(history, products):
    text = ' '.join(h['text'] for h in history if h['role'] == 'user')[-400:]
    inp = {}
    if m := re.search(r'주\s*(\d+)\s*(번|회)', text):
        inp['visits'] = int(m[1]) * 26
    elif m := re.search(r'(한\s*)?달에\s*(\d+|한)\s*(번|회)', text):
        inp['visits'] = 6 * (1 if m[2] == '한' else int(m[2]))
    if '단골' in text or '자주' in text:
        inp.setdefault('visits', 120); inp['cereal_visit_rate'] = .35; inp['hp_count'] = 4
    if '가끔' in text:
        inp.setdefault('visits', 10)
    if '할인' in text:
        inp['disc_share'] = .35
    if 'PB' in text or '자체 브랜드' in text:
        inp['private_share'] = .7
    inp['display'] = 'front' if ('엔드캡' in text or '입구' in text) else 'other' if '보조' in text else 'shelf'
    inp['mailer'] = 'front' if '1면' in text else 'inner' if '전단' in text else 'none'
    kind = 'KIDS CEREAL' if ('어린이' in text or '아이' in text) else 'ADULT CEREAL' if '성인' in text else 'ALL FAMILY CEREAL' if '가족' in text else None
    if kind:
        inp['product_id'] = next(p['product_id'] for p in products if p['type'] == kind)
    res = _call(inp)
    r = res['response']
    top = r['drivers'][0]
    reply = (f"이번 방문에 이 상품을 살 확률은 {r['p_buy'] * 100:.2f}%로, 평소 선반 · 전단 없음보다 {r['lift_vs_shelf']:.1f}배입니다. "
             f"같은 조건의 평균 손님은 {r['average_customer_p'] * 100:.2f}%입니다. 가장 크게 움직이는 것은 {top['label']}입니다.")
    return {'reply': reply, 'calls': [res], 'by': 'rules'}
