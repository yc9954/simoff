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

import decision_models
import service
import world

SYSTEM = """You are an agent that simulates decisions for offline spaces (stores, pop-ups, events, exhibitions, restaurants and more) before they happen.
Theme: Decision model for offline world simulation. A store is just one example among many.

What to do
1. Understand the person's offline business: the type of business, rough size, what worries them or what they want to change, and whether they have records (receipts, orders, display schedules).
2. If the type of business is unclear, ask one short question at a time. If it is clear, do not ask; call recommend_spaces right away.
3. Call build_space with the best-fitting suggested space. If the person wants a different space or different changes, call it again.
4. For a grocery store or supermarket, the space is built from real store data and the decision to test is where to put cereal next week, across four plans. Records already exist in that case, so tell them they can go straight on to the next step, connecting records.
5. Explain the result plainly in at most 4 sentences: why this space, what changed (and what could not be changed), and, if there are records, one sentence on what can be measured.

Rules
- Only state numbers the tools returned. Never guess things like "sales will rise by some %". Decision numbers come only from a model calibrated on that space's records.
- If there are no records, say in one sentence that numbers will come once records are connected. Do not bring up sample data or any particular dataset first.
- Never mention tool names, model names or internal mechanics (rules, how many template spaces exist, how checks work). Mention the decision model the person picked by name only when needed.
- Reply in English, short and clear. Prefer sentences to lists. No markdown headings. Bold at most once or twice, only where it matters.
- The screen already shows the space cards, the 3D space, the list of changes and the decision cards. Do not repeat the decisions or spaces as a list in prose, and do not use bullet characters (-)."""

WANTS = ['checkout', 'seat', 'promo', 'photo', 'order']
MART_SPACES = {'arch_supermarket'}   # grocery: the one domain with calibrated records in this build
MART_STORE = '367'
TOOLS = [
    {'name': 'recommend_spaces',
     'description': 'From a business description, picks the 3 best-fitting spaces out of 27 templates (cafe, convenience store, supermarket, drugstore, pop-up, exhibition, festival and more), with reasons.',
     'input_schema': {'type': 'object', 'properties': {
         'business': {'type': 'string', 'description': 'One or two sentences that make the type of business clear (e.g. a 100 m² coffee shop in Brooklyn)'},
         'area_m2': {'type': 'number', 'description': 'Area in m². Multiply sq ft by 0.0929, or pyeong by 3.3058'},
         'wants': {'type': 'array', 'items': {'type': 'string', 'enum': WANTS}, 'description': 'Worries or goals: checkout=checkout line, seat=seating, promo=promo display, photo=photo spot, order=ordering and pickup'}},
         'required': ['business']}},
    {'name': 'build_space',
     'description': 'Builds the chosen space in 3D: fixture edits that follow the request (only those that pass aisle-width, overlap and door checks), shoppers placed in it, and the decisions this space can test.',
     'input_schema': {'type': 'object', 'properties': {
         'space_id': {'type': 'string', 'description': 'An id returned by recommend_spaces (e.g. arch_cafe)'},
         'business': {'type': 'string'},
         'area_m2': {'type': 'number'},
         'wants': {'type': 'array', 'items': {'type': 'string', 'enum': WANTS}},
         'product': {'type': 'string', 'description': 'The product to test a promo or display with, if one was named'},
         'move_to_entrance': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Fixtures to move toward the entrance (e.g. pickup counter, photo spot, checkout, experience zone)'}},
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
    if name == 'build_space' and inp.get('space_id') in MART_SPACES:
        # a grocery store is the case we have records for: build the real store from the data, with the decisions the
        # rest of the flow (records, plans, run, layout, report) works on
        plans = service.plans()
        summary = {'space': f'A real supermarket · Store {MART_STORE} (aisles, shelves, endcaps and flyer stand built from its data)',
                   'decision': 'Where should cold cereal go next week: ' + ' / '.join(p['label'] for p in plans),
                   'has_records': True, 'next_step': 'In Connect records, upload a POS file or continue with this store\'s records'}
        return summary, {'type': 'mart', 'store': MART_STORE, 'plans': plans, 'business': inp.get('business', '')}
    if name == 'build_space':
        sid = inp.get('space_id')
        if sid not in {c['id'] for c in world.catalog()}:
            return {'error': f'unknown space_id {sid}'}, None
        r = world.run_agent(inp.get('business', ''), None, inp.get('area_m2'), files, pick=sid,
                            read={'wants': inp.get('wants'), 'product': inp.get('product'), 'move': inp.get('move_to_entrance'), 'by': service.llm_model()})
        st = {s['key']: s for s in r['steps']}
        summary = {'space': r['space']['title'], 'area_m2': r['space']['area_m2'],
                   'edits': [o['why'] for o in st['adapt']['ops']], 'not_done': [f"{o['why']} — {o['reason']}" for o in st['adapt']['skipped']],
                   'area_note': st['adapt']['note'], 'visitors': st['place']['people']['count'],
                   'decisions': [{'question': d['q'], 'metric': d['metric'], 'needs': d['needs']} for d in st['decide']['decisions']],
                   'has_records': st['decide']['calibrated']}
        return summary, {'type': 'world', 'run': r}
    return {'error': f'unknown tool {name}'}, None


GROCERY = ('supermarket', 'grocery', 'mart', 'food store', '마트', '슈퍼', '식료품')


def _no_maps_turn(history, files):
    """The archetype spaces come from a private repo (app/fetch_spaces.sh). Without them the grocery case still runs
    end to end on the real store; anything else gets told what is missing instead of failing."""
    text = ' '.join(h['text'] for h in history if h['role'] == 'user').lower()
    if any(w in text for w in GROCERY):
        _, art = _run_tool('build_space', {'space_id': 'arch_supermarket', 'business': text}, files)
        return {'reply': f'Built from a real supermarket (Store {MART_STORE}). The decision to test is where cold cereal goes next week: '
                         'front endcap, flyer, secondary display, or as usual. This store has records, so you can go straight on to Connect records.',
                'artifacts': [art], 'by': 'rules'}
    return {'reply': "This copy of SimOff doesn't have the 3D archetype spaces installed (see app/fetch_spaces.sh), so only the grocery "
                     "case runs here. Try: \"We're opening a neighborhood supermarket.\"", 'artifacts': [], 'by': 'rules'}


def chat(history, files=None, model=None):
    """history: [{role: 'user'|'assistant', text}] as the browser shows it. Returns {reply, artifacts, by}."""
    files = files or []
    if not world.catalog():
        return _no_maps_turn(history, files)
    dm = decision_models.get(model)
    msgs = [{'role': h['role'], 'content': h['text']} for h in history if h.get('text')]
    if msgs and msgs[0]['role'] == 'user':
        msgs[0]['content'] = f"(Decision model the person picked: {dm['name']} — {dm['what']}. Trained on: {dm['trained_on']})\n\n" + msgs[0]['content']
    if files:
        msgs[-1]['content'] += f"\n\n(Uploaded record files: {', '.join(files)})"
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
            return {'reply': 'That is as far as I got. Tell me what else you would like to change.', 'artifacts': artifacts, 'tools': steps, 'by': service.llm_model()}
        except Exception as e:  # noqa: BLE001 — fall through to the rules, and say so
            fallback = str(e)[:160]
    else:
        fallback = None
    return _rules_turn(history, files, fallback)


def _rules_turn(history, files, why=None):
    text = ' '.join(h['text'] for h in history if h['role'] == 'user')
    r = world.run_agent(text, None, None, files)
    note = ''
    if not r['space']:
        return {'reply': 'What kind of business is it? For example: a cafe, a convenience store, a merch pop-up or an outdoor festival.' + note, 'artifacts': [], 'by': 'rules'}
    if r['space']['id'] in MART_SPACES:
        _, art = _run_tool('build_space', {'space_id': r['space']['id'], 'business': text}, files)
        return {'reply': f'Built from a real supermarket (Store {MART_STORE}). The decision to test is where cereal goes next week: front endcap, flyer, secondary display, or as usual. This store has records, so you can go straight on to Connect records.',
                'artifacts': [art], 'by': 'rules'}
    st = {s['key']: s for s in r['steps']}
    edits = st['adapt']['ops']
    n = len(edits)
    reply = (f"Here is your space: {st['recommend']['detail'].split('Chosen: ')[-1]}. "
             + (f"Made {n} change{'s' if n != 1 else ''} to fit your request, " if edits else 'Kept the layout as it is, ')
             + f"and added {st['place']['people']['count']} shoppers. The decisions below get numbers once this space's records are connected." + note)
    return {'reply': reply, 'artifacts': [{'type': 'recs', 'recs': st['recommend']['recommendations']}, {'type': 'world', 'run': r}], 'by': 'rules'}
