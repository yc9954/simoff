"""Try the model's chat: a sentence about a customer, a product and a store condition becomes SimOff-1's input.

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
    'visits': ('integer', 'Store visits over 26 weeks (half a year). Twice a week is 52; once a month is 6'),
    'avg_spend': ('number', 'Average spend per shopping trip (dollars)'),
    'cereal_visit_rate': ('number', 'Share of visits that include a cereal purchase, 0–1'),
    'cereal_spend_share': ('number', 'Cereal as a share of total spend, 0–0.2 (typically 0.01)'),
    'disc_share': ('number', 'Share of purchases that are discounted items, 0–0.5 (typically 0.15)'),
    'private_share': ('number', 'Share of store-brand (private label) items, 0–1 (typically 0.2)'),
    'hp_count': ('integer', 'Times this customer has bought this product before'),
}
SYSTEM = """You help build the input for the SimOff-1 decision model. SimOff-1 gives the probability that one customer buys a specific cereal product on one store visit.
When the person describes a customer, a product and a store condition in words, call the decide tool. Leave out any value they did not mention (the average customer's value is used).
If they ask to compare two or more cases, call decide once per case.
Always call decide before answering; never ask a follow-up question. If something is ambiguous (for example which kids cereal), pick the first matching product in the list (the list is ordered from best-selling down) and say which one you used.

Products (product_id: description)
{products}

Store conditions: display = shelf (regular shelf) | other (secondary display in the store) | front (entrance endcap); mailer = none (no flyer) | inner (flyer inside page) | front (flyer front page).

Reply in English in 2 to 4 sentences. Only use numbers the tool returned (probabilities as %, to two decimal places). One sentence on how you read their description, one on the result, one on the factor that moves it most.
No markdown headings or lists. Do not mention the tool name or field names."""


def _tools(products):
    props = {k: {'type': t, 'description': d} for k, (t, d) in FIELDS.items()}
    props['product_id'] = {'type': 'string', 'enum': [p['product_id'] for p in products]}
    props['display'] = {'type': 'string', 'enum': ['shelf', 'other', 'front']}
    props['mailer'] = {'type': 'string', 'enum': ['none', 'inner', 'front']}
    props['label'] = {'type': 'string', 'description': 'A short name for this case (e.g. Loyal cereal buyer · entrance endcap)'}
    return [{'name': 'decide', 'description': 'Runs SimOff-1 for one customer, one product and one store condition: the probability of buying, and what drives it.', 'input_schema': {'type': 'object', 'properties': props}}]


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
    plist = '\n'.join(f"{p['product_id']}: {p['type']} {p['size']} ${p['price']}{' (store brand)' if p['private'] else ''}" for p in products)
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
    return {'reply': 'That is as far as I got.', 'calls': calls, 'by': service.llm_model()}


_COUNT = {'once': 1, 'one': 1, 'twice': 2, 'two': 2, 'thrice': 3, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7}


def _times(word):
    return int(word) if word.isdigit() else _COUNT.get(word, 1)


def _rules(history, products):
    text = ' '.join(h['text'] for h in history if h['role'] == 'user')[-400:]
    t = text.lower()
    inp = {}
    every = r'\s*(?:times?\s+)?(?:a|per|each|every)\s+'
    count = r'\b(\d+|once|twice|thrice|one|two|three|four|five|six|seven)'
    if m := re.search(r'주\s*(\d+)\s*(번|회)', text):
        inp['visits'] = int(m[1]) * 26
    elif m := re.search(count + every + r'week', t):
        inp['visits'] = _times(m[1]) * 26
    elif m := re.search(r'(한\s*)?달에\s*(\d+|한)\s*(번|회)', text):
        inp['visits'] = 6 * (1 if m[2] == '한' else int(m[2]))
    elif m := re.search(count + every + r'month', t):
        inp['visits'] = 6 * _times(m[1])
    elif re.search(r'\b(every day|daily)\b', t):
        inp['visits'] = 182
    elif re.search(r'\bweekly\b', t):
        inp['visits'] = 26
    elif re.search(r'\bmonthly\b', t):
        inp['visits'] = 6
    if '단골' in text or '자주' in text or re.search(r'\b(loyal|regulars?|frequent(ly)?|often)\b(?!\s+(shelf|shelves|spot|place))', t):
        inp.setdefault('visits', 120); inp['cereal_visit_rate'] = .35; inp['hp_count'] = 4
    if '가끔' in text or re.search(r'\b(occasional(ly)?|sometimes|rarely|now and then)\b', t):
        inp.setdefault('visits', 10)
    if '할인' in text or re.search(r'\b(discounts?|deals?|coupons?|bargains?|on sale)\b', t):
        inp['disc_share'] = .35
    if 'PB' in text or '자체 브랜드' in text or re.search(r'\b(store[- ]brand|private[- ]label|own[- ]brand|house brand)', t):
        inp['private_share'] = .7
    front = '엔드캡' in text or '입구' in text or re.search(r'\b(end[- ]?caps?|entrance|front of the store|store front)\b', t)
    other = '보조' in text or re.search(r'\b(secondary|extra|in-store|other) display', t)
    inp['display'] = 'front' if front else 'other' if other else 'shelf'
    fpage = '1면' in text or re.search(r'\b(front page|cover page|flyer front|front of the (flyer|mailer)|on the cover)\b', t)
    flyer = '전단' in text or re.search(r'\b(flyers?|mailers?|circulars?|leaflets?)\b', t)
    no_flyer = '전단 없' in text or re.search(r'\b(no|without(?: a| the)?) (flyers?|mailers?|circulars?)\b', t)
    inp['mailer'] = 'none' if no_flyer else 'front' if fpage else 'inner' if flyer else 'none'
    kids = '어린이' in text or '아이' in text or re.search(r'\b(kids?|children|child)\b', t)
    adult = '성인' in text or re.search(r'\badults?\b', t)
    family = '가족' in text or re.search(r'\bfamil(y|ies)\b', t)
    kind = 'KIDS CEREAL' if kids else 'ADULT CEREAL' if adult else 'ALL FAMILY CEREAL' if family else None
    if kind:
        inp['product_id'] = next(p['product_id'] for p in products if p['type'] == kind)
    res = _call(inp)
    r = res['response']
    top = r['drivers'][0]['label']
    reply = (f"The chance this customer buys this product on this visit is {r['p_buy'] * 100:.2f}%, "
             f"{r['lift_vs_shelf']:.1f}× the regular shelf with no flyer. "
             f"An average customer under the same conditions: {r['average_customer_p'] * 100:.2f}%. "
             f"What moves it most is {top[:1].lower() + top[1:]}.")
    return {'reply': reply, 'calls': [res], 'by': 'rules'}
