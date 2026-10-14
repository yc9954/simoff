"""The landing chat: Claude talks with the person, decides when it knows enough, and builds the space with tools.

Two tools wrap world.py: `recommend_spaces` (three archetype spaces with reasons) and `build_space` (edits, people,
decisions for one space). Their results go back to the browser as artifacts and are drawn inside the chat
(cards, the 3D space, the edit list, the decisions). The model never makes up a number: the only figures it may
quote are the ones the tools return, and the decision numbers come only from a model calibrated on records.

Without a working key the same turn runs on rules (world.run_agent) and answers from a template.
"""
import json
import os
import urllib.error
import urllib.request

import service
import world

SYSTEM = """너는 오프라인 공간(매장, 팝업, 행사, 전시, 식당 등)의 결정을 미리 시뮬레이션하는 에이전트다.
주제: Decision model for offline world simulation. 매장은 여러 예시 중 하나일 뿐이다.

할 일
1. 상대의 오프라인 비즈니스를 이해한다: 업종, 대략의 면적, 걱정되거나 바꿔 보고 싶은 것, 기록(영수증·주문·진열 일정) 유무.
2. 업종을 모르면 한 번에 하나만 짧게 되묻는다. 업종을 알면 되묻지 말고 바로 recommend_spaces 를 부른다.
3. 추천 중 가장 맞는 맵으로 build_space 를 부른다. 상대가 다른 맵이나 다른 변경을 원하면 다시 부른다.
4. 결과는 최대 4문장으로 쉽게 설명한다: 왜 이 맵인지, 무엇을 바꿨는지(못 바꾼 것도), 기록이 있으면 무엇을 숫자로 볼 수 있는지 한 문장.

규칙
- 숫자는 도구가 돌려준 것만 말한다. 판매가 몇 % 늘 것 같다는 식의 짐작은 절대 하지 않는다. 결정의 숫자는 그 공간의 기록으로 보정된 모델만 낸다.
- 기록이 없으면 "기록이 오면 숫자를 낸다"고 말하고, 보정까지 끝난 예시(미국 마트 시리얼 진열)를 볼 수 있다고 알려 준다.
- 한국어로, 짧고 분명하게. 목록보다 문장. 마크다운 제목은 쓰지 않는다. 굵게는 꼭 필요한 곳 한두 군데만.
- 화면에 맵 카드, 3D 공간, 바꾼 것 목록, 결정 카드가 함께 보인다. 결정 목록이나 맵 목록을 문장으로 다시 나열하지 않는다. 목록 기호(-)도 쓰지 않는다."""

WANTS = ['checkout', 'seat', 'promo', 'photo', 'order']
TOOLS = [
    {'name': 'recommend_spaces',
     'description': '비즈니스 설명으로 27개 원형 공간(카페, 편의점, 마트, 드럭스토어, 팝업, 전시, 축제 등) 중 맞는 3개를 이유와 함께 고른다.',
     'input_schema': {'type': 'object', 'properties': {
         'business': {'type': 'string', 'description': '업종이 드러나는 한두 문장 (예: 성수동 30평 카페)'},
         'area_m2': {'type': 'number', 'description': '면적(㎡). 평이면 3.3058을 곱해서'},
         'wants': {'type': 'array', 'items': {'type': 'string', 'enum': WANTS}, 'description': '걱정·바라는 것: checkout=계산 줄, seat=좌석, promo=행사 진열, photo=포토존, order=주문·픽업'}},
         'required': ['business']}},
    {'name': 'build_space',
     'description': '고른 공간을 3D로 세운다: 요청에 맞춘 집기 수정(통로 폭·겹침·출입문 검사 통과한 것만), 손님 배치, 이 공간에서 시험할 결정.',
     'input_schema': {'type': 'object', 'properties': {
         'space_id': {'type': 'string', 'description': 'recommend_spaces 가 돌려준 id (예: arch_cafe)'},
         'business': {'type': 'string'},
         'area_m2': {'type': 'number'},
         'wants': {'type': 'array', 'items': {'type': 'string', 'enum': WANTS}},
         'product': {'type': 'string', 'description': '행사·진열을 시험할 상품 이름이 있으면'}},
         'required': ['space_id', 'business']}},
]


def _claude(messages):
    body = {'model': service.llm_model(), 'max_tokens': 1500, 'system': SYSTEM, 'tools': TOOLS, 'messages': messages}
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps(body).encode(),
                                 headers={'x-api-key': os.environ['ANTHROPIC_API_KEY'], 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise service._http_error('Claude', e) from None
    u = d.get('usage') or {}
    service._log_usage('anthropic', body['model'], 'chat', u.get('input_tokens'), u.get('output_tokens'))
    return d


def _run_tool(name, inp, files):
    if name == 'recommend_spaces':
        u = world.understand(inp.get('business', ''), None, inp.get('area_m2'))
        u['wants'] = [w for w in inp.get('wants') or u['wants'] if w in WANTS]
        recs = world.recommend(u)
        return {'recommendations': [{k: r[k] for k in ('id', 'label', 'title', 'area_m2', 'why')} for r in recs]}, {'type': 'recs', 'recs': recs}
    if name == 'build_space':
        sid = inp.get('space_id')
        if sid not in {c['id'] for c in world.catalog()}:
            return {'error': f'unknown space_id {sid}'}, None
        r = world.run_agent(inp.get('business', ''), None, inp.get('area_m2'), files, pick=sid,
                            read={'wants': inp.get('wants'), 'product': inp.get('product'), 'by': service.llm_model()})
        st = {s['key']: s for s in r['steps']}
        summary = {'space': r['space']['title'], 'area_m2': r['space']['area_m2'],
                   'edits': [o['why'] for o in st['adapt']['ops']], 'not_done': [f"{o['why']} — {o['reason']}" for o in st['adapt']['skipped']],
                   'area_note': st['adapt']['note'], 'visitors': st['place']['people']['count'],
                   'decisions': [{'question': d['q'], 'metric': d['metric'], 'needs': d['needs']} for d in st['decide']['decisions']],
                   'has_records': st['decide']['calibrated']}
        return summary, {'type': 'world', 'run': r}
    return {'error': f'unknown tool {name}'}, None


def chat(history, files=None):
    """history: [{role: 'user'|'assistant', text}] as the browser shows it. Returns {reply, artifacts, by}."""
    files = files or []
    msgs = [{'role': h['role'], 'content': h['text']} for h in history if h.get('text')]
    if files:
        msgs[-1]['content'] += f"\n\n(올린 기록 파일: {', '.join(files)})"
    if os.environ.get('ANTHROPIC_API_KEY'):
        try:
            artifacts, steps = [], []
            for _ in range(6):
                d = _claude(msgs)
                msgs.append({'role': 'assistant', 'content': d['content']})
                uses = [c for c in d['content'] if c.get('type') == 'tool_use']
                if not uses:
                    text = ''.join(c.get('text', '') for c in d['content'] if c.get('type') == 'text').strip()
                    return {'reply': text, 'artifacts': artifacts, 'tools': steps, 'by': service.llm_model()}
                results = []
                for t in uses:
                    out, art = _run_tool(t['name'], t.get('input') or {}, files)
                    steps.append({'tool': t['name'], 'input': t.get('input')})
                    if art:
                        artifacts.append(art)
                    results.append({'type': 'tool_result', 'tool_use_id': t['id'], 'content': json.dumps(out, ensure_ascii=False)})
                msgs.append({'role': 'user', 'content': results})
            return {'reply': '여기까지 진행했습니다. 더 바꾸고 싶은 것을 말씀해 주세요.', 'artifacts': artifacts, 'tools': steps, 'by': service.llm_model()}
        except Exception as e:  # noqa: BLE001 — fall through to the rules, and say so
            fallback = str(e)[:160]
    else:
        fallback = None
    return _rules_turn(history, files, fallback)


def _rules_turn(history, files, why=None):
    text = ' '.join(h['text'] for h in history if h['role'] == 'user')
    r = world.run_agent(text, None, None, files)
    note = f" (언어 모델을 쓰지 못해 규칙으로 답합니다: {why})" if why else ' (언어 모델 키가 없어 규칙으로 답합니다)'
    if not r['space']:
        return {'reply': '어떤 업종인지 알려 주시겠어요? 예: 카페, 편의점, 굿즈 팝업, 야외 축제.' + note, 'artifacts': [], 'by': 'rules'}
    st = {s['key']: s for s in r['steps']}
    edits = st['adapt']['ops']
    reply = (f"{st['recommend']['detail'].split('고른 맵: ')[-1]}으로 세웠습니다. "
             + (f"요청에 맞춰 {len(edits)}가지를 바꿨고, " if edits else '원형 그대로 두었고, ')
             + f"손님 {st['place']['people']['count']}명을 걷게 했습니다. 아래 결정들은 이 공간의 기록이 오면 숫자를 냅니다." + note)
    return {'reply': reply, 'artifacts': [{'type': 'recs', 'recs': st['recommend']['recommendations']}, {'type': 'world', 'run': r}], 'by': 'rules'}
