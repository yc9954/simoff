"""Offline world builder: a business description in, a recommended 3D space with people and testable decisions out.

The spaces are the 27 archetypes from yc9954/consumer-jev (static/spaces/<id>.{glb,png,space.json}; fetch_spaces.sh).
Each space.json is metric (floors, walls, doors, fixtures with role/booth/label, booths with access points), so the
agent can reason about it and edit it at fixture level without rebuilding the GLB.

The agent runs five visible steps. Every step works on rules alone; a language model, when a key is set, only reads the
description better (step 1). It never invents geometry: map edits are a whitelist (duplicate, move, relabel, remove)
checked against the floor outline, the other fixtures and the space's minimum aisle.
"""
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
from functools import lru_cache
from pathlib import Path

SPACES = Path(__file__).resolve().parent / 'static' / 'spaces'

# business words -> archetype; first match is the strongest
LEXICON = {
    'arch_cafe': ['카페', '커피', 'cafe', 'coffee', '디저트', '베이커리', 'bakery', '음료'],
    'arch_cvs': ['편의점', 'cvs', 'convenience', 'gs25', 'cu ', '세븐일레븐', '미니스톱'],
    'arch_supermarket': ['마트', '슈퍼', '식료품', 'grocery', 'supermarket', '장보기', '시리얼', '신선식품'],
    'arch_drugstore': ['드럭', '드러그', '올리브영', '화장품', '뷰티', 'drugstore', 'cosmetic', '약국', '헬스'],
    'arch_store': ['편집숍', '편집 매장', '굿즈 매장', '소품', '잡화', '의류', '옷가게', '매장', 'store', 'shop', '서점'],
    'arch_restaurant': ['식당', '레스토랑', 'restaurant', '음식점', '분식', '고깃집', '한식', '주점', '술집'],
    'arch_popup_goods': ['팝업', 'popup', 'pop-up', '굿즈', 'ip ', '캐릭터', '한정판', '콜라보 굿즈'],
    'arch_popup_experience': ['체험', '방탈출', 'experience', '인터랙티브', '체험형'],
    'arch_popup_exhibition': ['전시형 팝업', '브랜드 전시', '팝업 전시'],
    'arch_popup_fnb': ['콜라보 카페', '팝업 카페', 'f&b', '디저트 팝업'],
    'arch_exhibition_hall': ['전시', '미술', '갤러리', '박물관', 'museum', 'gallery', 'exhibition', '아트'],
    'arch_expo_booth': ['박람회', '부스', 'expo', '전시회 부스', 'b2b', '컨벤션'],
    'arch_festival': ['축제', '페스티벌', 'festival', '야외 행사', '푸드트럭', '플리마켓'],
    'arch_concert_md': ['공연', '콘서트', 'concert', 'md 부스', '굿즈 줄'],
    'arch_fan_event': ['팬사인', '팬미팅', '팬 행사', 'fan', '아이돌', '사인회'],
    'arch_event_hall': ['행사장', '이벤트', '런칭', '쇼케이스', 'event', '세미나'],
    'arch_dept_event': ['백화점', '행사 매대', '팝업 매대'],
    'arch_mall_atrium': ['몰', '쇼핑몰', '아트리움', 'mall', '광장 행사'],
    'arch_market': ['시장', '마켓', 'market', '파머스', '장터'],
    'arch_factory_tour': ['공장', '견학', 'factory', '양조장', '브루어리', '제조'],
    'arch_flagship_3f': ['플래그십', 'flagship', '다층 매장', '쇼룸'],
    'arch_flagship_4f_esc': ['대형 플래그십', '에스컬레이터'],
    'arch_lobby': ['로비', '공항', '오피스', 'lobby', '탑승동'],
    'arch_rental_venue': ['대관', '루프탑', 'rental', '스튜디오'],
    'arch_rental_yard': ['마당', '야드', '정원 대관'],
    'arch_shop_in_shop': ['숍인숍', 'shop in shop', '입점'],
    'arch_street_promo': ['거리', '샘플링', '길거리', '가두', 'street', '프로모션 텐트'],
}
# what the person says they care about -> the booth role or fixture kind it touches
WANTS = {
    'checkout': ['계산', '줄', '대기', '결제', '포스', 'pos', 'queue', '혼잡', '회전'],
    'seat': ['좌석', '자리', '테이블', '앉', 'seat', '체류'],
    'promo': ['행사', '신제품', '프로모션', '할인', '진열', '엔드캡', '입구', '눈에 띄', 'promo', 'display'],
    'photo': ['포토', '사진', '인증', 'photo', 'sns'],
    'order': ['주문', '키오스크', 'order', '픽업'],
}
MODES = {'retail': ['arch_cvs', 'arch_supermarket', 'arch_drugstore', 'arch_store', 'arch_market', 'arch_shop_in_shop', 'arch_dept_event'],
         'fnb': ['arch_cafe', 'arch_restaurant', 'arch_popup_fnb'],
         'popup': ['arch_popup_goods', 'arch_popup_experience', 'arch_popup_exhibition', 'arch_street_promo', 'arch_mall_atrium'],
         'event': ['arch_festival', 'arch_concert_md', 'arch_fan_event', 'arch_event_hall', 'arch_expo_booth', 'arch_rental_venue', 'arch_rental_yard', 'arch_lobby'],
         'venue': ['arch_exhibition_hall', 'arch_factory_tour', 'arch_flagship_3f', 'arch_flagship_4f_esc']}
MODE_OF = {s: m for m, ids in MODES.items() for s in ids}
KIND_WORDS = {'pickup': ('픽업', 'pickup'), 'checkout': ('계산대', '계산', 'checkout', 'pos'), 'photo': ('포토존', '포토', 'photo'),
              'cafe_counter': ('카운터', '주문대', 'counter'), 'table_set': ('테이블', '좌석', 'table'), 'display': ('진열대', 'display'), 'endcap': ('엔드캡',),
              'chiller': ('냉장', 'chiller'), 'stage': ('무대', 'stage'), 'booth': ('부스', 'booth')}
WANT_LABEL = {'checkout': '계산 줄', 'seat': '좌석', 'promo': '행사 진열', 'photo': '포토존', 'order': '주문 · 픽업'}
MODE_LABEL = {'retail': '소매', 'fnb': '식음', 'popup': '팝업 · 프로모션', 'event': '행사 · 공연', 'venue': '전시 · 공간'}


@lru_cache(maxsize=None)
def space(sid):
    return json.loads((SPACES / f'{sid}.space.json').read_text())


@lru_cache(maxsize=1)
def catalog():
    out = []
    for f in sorted(SPACES.glob('arch_*.space.json')):
        s = json.loads(f.read_text())
        sid = s['id']
        out.append({'id': sid, 'type': s['type'], 'label': s['type_label'], 'title': s['title'].replace('[원형] ', ''),
                    'area_m2': s['area_m2'], 'floors': len(s['floors']), 'outdoor': bool(s['floors'][0].get('outdoor')),
                    'mode': MODE_OF.get(sid, 'venue'), 'booths': [b['label'] for b in s['booths'].values()][:8],
                    'fixtures': len(s['fixtures']), 'glb': f'spaces/{sid}.glb', 'thumb': f'spaces/{sid}.png'})
    return out


# ---------------------------------------------------------------- geometry helpers (plan view, metres)

def _rect(fx, cx=None, cy=None):
    cx, cy = fx['cx'] if cx is None else cx, fx['cy'] if cy is None else cy
    w, d = (fx['d'], fx['w']) if round(fx.get('rot', 0)) % 180 == 90 else (fx['w'], fx['d'])
    return (cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2)


def _overlap(a, b, gap):
    return not (a[2] + gap <= b[0] or b[2] + gap <= a[0] or a[3] + gap <= b[1] or b[3] + gap <= a[1])


def _inside(poly, x, y):
    c = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def _fits(s, fx, cx, cy, ignore=()):
    """A fixture at (cx, cy) stays on its floor, keeps the space's minimum aisle to every other fixture and clears the doors."""
    r = _rect(fx, cx, cy)
    floor = next(f for f in s['floors'] if f['level'] == fx.get('level', 0))
    if not all(_inside(floor['polygon'], x, y) for x, y in [(r[0], r[1]), (r[2], r[1]), (r[0], r[3]), (r[2], r[3])]):
        return False, 'floor'
    gap = float(s.get('aisle_min_std') or 0.8)
    for o in s['fixtures']:
        if o['id'] in ignore or o['id'] == fx['id'] or o.get('level', 0) != fx.get('level', 0) or o.get('klass') in ('context', 'floor', 'boundary'):
            continue
        if _overlap(r, _rect(o), gap if o.get('klass') not in ('decor',) else 0.3):
            return False, o['id']
    for d in s['doors']:
        if d.get('level', 0) == fx.get('level', 0) and _overlap(r, (d['x'] - d['w'] / 2 - .6, d['y'] - 1.5, d['x'] + d['w'] / 2 + .6, d['y'] + 1.5), 0):
            return False, f"door:{d['id']}"
    return True, None


def _entrance(s):
    d = next((d for d in s['doors'] if d.get('main')), s['doors'][0])
    return d['x'], d['y']


# ---------------------------------------------------------------- the five steps

def understand(desc, category=None, area=None, files=None):
    t = f' {(desc or "").lower()} {(category or "").lower()} '
    scores = {}
    for sid, words in LEXICON.items():
        hits = [w.strip() for w in words if w in t]
        if hits:
            scores[sid] = {'score': len(hits) + (0.5 if words[0] in t else 0), 'hits': hits}
    wants = [k for k, ws in WANTS.items() if any(w in t for w in ws)]
    m = re.search(r'(\d[\d,\.]*)\s*(㎡|m2|제곱|평)', desc or '')
    if not area and m:
        v = float(m.group(1).replace(',', ''))
        area = v * 3.3058 if m.group(2) == '평' else v
    product = None
    pm = re.search(r'(신제품|신상|행사 상품|상품)\s*[:：]?\s*([^\s,\.·]+)', desc or '')
    if pm:
        product = pm.group(2)
    return {'description': desc, 'category': category, 'area_m2': round(area, 1) if area else None, 'wants': wants, 'product': product,
            'matches': sorted(({'id': k, **v} for k, v in scores.items()), key=lambda x: -x['score']), 'files': files or [],
            'read_by': 'rules'}


def understand_llm(u):
    """Optional: let a language model read the description into the same fields. Rules stay the fallback."""
    ids = [c['id'] for c in catalog()]
    prompt = (f"You classify an offline business into one of these space archetypes: {', '.join(ids)}.\n"
              f"Business description (Korean or English): {u['description']!r}. Category hint: {u['category']!r}.\n"
              "Return JSON only: {\"types\": [up to 3 archetype ids, best first], \"area_m2\": number or null, "
              "\"wants\": subset of [\"checkout\",\"seat\",\"promo\",\"photo\",\"order\"], \"product\": short product name or null}")
    out, who = llm_json(prompt)
    if not out:
        u['llm_failed'] = list(LAST_LLM_ERRORS)
        return u
    types = [t for t in out.get('types', []) if t in ids]
    if types:
        base = {m['id']: m for m in u['matches']}
        u['matches'] = [{'id': t, 'score': 10 - i + base.get(t, {}).get('score', 0), 'hits': base.get(t, {}).get('hits', []) + ['언어 모델']}
                        for i, t in enumerate(types)] + [m for m in u['matches'] if m['id'] not in types]
    u['area_m2'] = u['area_m2'] or out.get('area_m2')
    u['wants'] = sorted(set(u['wants']) | {w for w in out.get('wants', []) if w in WANTS})
    u['product'] = u['product'] or out.get('product')
    u['read_by'] = who
    return u


def recommend(u, k=3):
    cat = {c['id']: c for c in catalog()}
    ranked = []
    for sid, c in cat.items():
        m = next((x for x in u['matches'] if x['id'] == sid), None)
        s, why = 0.0, []
        if m:
            s += 3 * m['score']; why.append(f"{m['hits'][0]}에 맞는 공간" if m['hits'] else '업종이 맞음')
        if u['matches'] and MODE_OF.get(sid) == MODE_OF.get(u['matches'][0]['id']) and not m:
            s += 1; why.append(f"비슷한 업종 · {MODE_LABEL[MODE_OF[sid]]}")
        if u['area_m2']:
            r = abs(math.log(c['area_m2'] / u['area_m2']))
            s += max(0, 2 - 2 * r); why.append(f"{c['area_m2']:.0f}㎡")
        roles = {b.get('role') for b in space(sid)['booths'].values()} | {f['kind'] for f in space(sid)['fixtures']}
        for w in u['wants']:
            need = {'checkout': {'checkout'}, 'seat': {'seat', 'table_set'}, 'promo': {'endcap', 'display'}, 'photo': {'photo'}, 'order': {'order', 'pickup'}}[w]
            if roles & need:
                s += .5; why.append({'checkout': '계산대 있음', 'seat': '좌석 있음', 'promo': '행사 진열대 있음', 'photo': '포토존 있음', 'order': '주문 · 픽업 있음'}[w])
        ranked.append({'id': sid, 'score': round(s, 2), 'why': why, **{k2: c[k2] for k2 in ('label', 'title', 'area_m2', 'thumb', 'glb', 'mode', 'floors', 'outdoor')}})
    ranked.sort(key=lambda x: -x['score'])
    return ranked[:k]


def adapt(sid, u):
    """A few fixture-level edits that follow what the person asked for. Each edit is checked; a failed one is reported, not applied."""
    s = json.loads(json.dumps(space(sid)))
    ops, skipped = [], []
    ex, ey = _entrance(s)
    by_id = {f['id']: f for f in s['fixtures']}

    def dup(fx, why, label=None):
        cands = sorted(((i * .5, j * .5) for i in range(-24, 25) for j in range(-24, 25) if (i, j) != (0, 0)), key=lambda v: math.hypot(*v))
        for dx, dy in cands:
            if _overlap(_rect(fx, fx['cx'] + dx, fx['cy'] + dy), _rect(fx), 0):
                continue
            ok, hit = _fits(s, fx, fx['cx'] + dx, fx['cy'] + dy)
            if ok:
                nid = f"{fx['id']}_n{len(ops) + 1}"
                nf = {**fx, 'id': nid, 'cx': round(fx['cx'] + dx, 2), 'cy': round(fx['cy'] + dy, 2), 'label': label or fx['label']}
                s['fixtures'].append(nf); by_id[nid] = nf
                ops.append({'op': 'duplicate', 'id': fx['id'], 'new_id': nid, 'dx': round(dx, 2), 'dy': round(dy, 2), 'label': nf['label'], 'why': why})
                return True
        skipped.append({'op': 'duplicate', 'id': fx['id'], 'why': why, 'reason': '통로 폭을 지키며 놓을 빈자리가 없음'})
        return False

    def nearest(pred):
        c = [f for f in s['fixtures'] if pred(f)]
        return min(c, key=lambda f: math.hypot(f['cx'] - ex, f['cy'] - ey)) if c else None

    if 'checkout' in u['wants']:
        f = nearest(lambda f: f.get('klass') != 'queue' and (f['kind'] in ('checkout', 'cafe_counter') or f.get('role') in ('checkout', 'order')))
        if f and (f.get('params') or {}).get('stations'):
            n = int(f['params']['stations'])
            f['params']['stations'] = n + 1
            for b in s['booths'].values():
                if f['id'] in (b.get('fixtures') or []):
                    b['stations'] = (b.get('stations') or n) + 1
            ops.append({'op': 'stations', 'id': f['id'], 'from': n, 'to': n + 1, 'label': f['label'], 'why': f'계산 줄이 걱정된다고 해서 {f["label"]}의 계산 자리를 {n}개에서 {n + 1}개로 늘렸습니다'})
        elif f:
            dup(f, '계산 줄이 걱정된다고 해서 계산대를 하나 더 놓았습니다')
        else:
            skipped.append({'op': 'duplicate', 'id': None, 'why': '계산대 추가', 'reason': '이 맵에는 계산대가 없음'})
    if 'seat' in u['wants']:
        f = nearest(lambda f: f['kind'] in ('table_set', 'bench') and f.get('klass') != 'context')
        if f:
            dup(f, '머무는 시간을 늘리고 싶다고 해서 좌석을 하나 더 놓았습니다')
    if 'promo' in u['wants'] or u.get('product'):
        f = nearest(lambda f: f['kind'] in ('endcap', 'display', 'stall') and f.get('klass') != 'context')
        if f:
            lab = f"행사: {u['product']}" if u.get('product') else f"행사 진열 ({f['label']})"
            ops.append({'op': 'relabel', 'id': f['id'], 'label': lab, 'why': '입구에서 가장 가까운 진열대를 행사 자리로 정했습니다'})
            f['label'] = lab; f['promo'] = True
    if 'photo' in u['wants']:
        f = nearest(lambda f: f['kind'] == 'photo')
        if f:
            dup(f, '사진을 찍게 하고 싶다고 해서 포토존을 하나 더 놓았습니다')
        else:
            skipped.append({'op': 'duplicate', 'id': None, 'why': '포토존 추가', 'reason': '이 맵에는 포토존이 없음'})
    for want in u.get('move') or []:                       # "move the pickup counter to the entrance"
        w = want.strip().lower()
        f = next((f for f in s['fixtures'] if f.get('klass') not in ('context', 'floor', 'boundary', 'structure') and
                  (w in (f.get('label') or '').lower() or w == f['kind'] or w in KIND_WORDS.get(f['kind'], ()))), None)
        if not f:
            skipped.append({'op': 'move', 'id': None, 'why': f'{want} 옮기기', 'reason': '이 맵에서 그 집기를 찾지 못함'}); continue
        cands = sorted(((i * .5, j * .5) for i in range(-60, 61) for j in range(0, 61)), key=lambda v: math.hypot(v[0] - ex, v[1] - ey))
        for x, y in cands:
            if math.hypot(x - ex, y - ey) >= math.hypot(f['cx'] - ex, f['cy'] - ey) - .5:
                break
            ok, _ = _fits(s, f, x, y)
            if ok:
                dx, dy = round(x - f['cx'], 2), round(y - f['cy'], 2)
                f['cx'], f['cy'] = x, y
                ops.append({'op': 'move', 'id': f['id'], 'dx': dx, 'dy': dy, 'label': f['label'], 'why': f"{f['label']} — 입구 쪽으로 {math.hypot(dx, dy):.1f}m 옮겼습니다"})
                break
        else:
            skipped.append({'op': 'move', 'id': f['id'], 'why': f"{f['label']} 옮기기", 'reason': '입구 쪽에 통로 폭을 지킬 빈자리가 없음'})
        if not any(o['op'] == 'move' and o['id'] == f['id'] for o in ops) and not any(o['id'] == f['id'] for o in skipped):
            skipped.append({'op': 'move', 'id': f['id'], 'why': f"{f['label']} 옮기기", 'reason': '이미 입구 가까이 있음'})
    note = None
    if u.get('area_m2'):
        r = u['area_m2'] / s['area_m2']
        if r > 1.3 or r < 1 / 1.3:
            note = f"입력한 면적 {u['area_m2']:.0f}㎡는 이 원형({s['area_m2']:.0f}㎡)의 {r:.1f}배입니다. 집기 배치는 원형 그대로 두고, 손님 수만 면적에 맞췄습니다."
    return s, ops, skipped, note


def people(s, u):
    """Who walks in: a visitor count from the area and the kind of place, and where they go (booth access points, weighted)."""
    area = u.get('area_m2') or s['area_m2']
    density = {'retail': .12, 'fnb': .18, 'popup': .2, 'event': .25, 'venue': .08}.get(MODE_OF.get(s['id'], 'venue'), .12)
    n = int(max(6, min(80, area * density)))
    ex, ey = _entrance(s)
    targets = []
    for b in s['booths'].values():
        w = {'checkout': 1.0, 'pick': 1.5, 'seat': 1.2, 'order': 1.3, 'pickup': .8, 'browse': 1.2, 'service': 1.0, 'shop': 1.3, 'work': .4}.get(b.get('role'), .8)
        if any(f.get('promo') for f in s['fixtures'] if f['id'] in (b.get('fixtures') or [])):
            w *= 2
        for a in (b.get('access') or [b.get('anchor')])[:6]:
            if a:
                targets.append({'booth': b['id'], 'label': b.get('label') or b['id'], 'role': b.get('role'), 'at': a, 'level': b.get('level', 0), 'w': round(w, 2)})
    return {'count': n, 'per_m2': density, 'entrance': [ex, ey], 'targets': targets}


def decisions(s, u, ops):
    """Questions this space can test, written so anyone can read them, with what the answer needs."""
    roles = {b.get('role') for b in s['booths'].values()}
    kinds = {f['kind'] for f in s['fixtures']}
    out = []
    promo = next((o for o in ops if o['op'] == 'relabel'), None)
    if roles & {'pick', 'shop'}:
        what = u.get('product') or ('이번 주 행사 상품' if MODE_OF.get(s['id']) in ('retail', 'fnb') else '대표 상품')
        out.append({'id': 'placement', 'q': f"{what} — 입구 쪽 진열대와 원래 자리 중 어디서 더 팔릴까?", 'metric': '방문 1,000회당 판매',
                    'needs': '영수증 + 진열 일정표', 'example': '#plans', 'ready': bool(promo)})
    if 'checkout' in roles or 'checkout' in kinds:
        out.append({'id': 'checkout', 'q': '계산대를 하나 더 열면 줄이 얼마나 줄고, 떠나는 손님이 얼마나 줄까?', 'metric': '평균 대기 · 이탈률',
                    'needs': '시간대별 영수증', 'example': None, 'ready': False})
    if 'seat' in roles or 'table_set' in kinds:
        out.append({'id': 'seats', 'q': '좌석을 늘리면 머무는 시간과 추가 주문이 늘까?', 'metric': '체류 시간 · 1인 객단가',
                    'needs': '주문 기록(시간 포함)', 'example': None, 'ready': False})
    for o in ops:
        if o['op'] == 'move':
            out.insert(0, {'id': f"move_{o['id']}", 'q': f"{o['label']} — 입구 쪽으로 옮기면 대기와 매출이 어떻게 바뀔까?", 'metric': '평균 대기 · 방문당 매출',
                           'needs': '시간이 찍힌 주문 · 영수증 기록', 'example': None, 'ready': False})
    if 'photo' in kinds:
        out.append({'id': 'photo', 'q': '포토존을 입구 쪽으로 옮기면 안쪽까지 들어오는 사람이 늘까?', 'metric': '안쪽 구역 도달률',
                    'needs': '출입 · 동선 기록(센서)', 'example': None, 'ready': False})
    return out


def run_agent(desc, category=None, area=None, files=None, pick=None, read=None):
    """The whole flow, returned as visible steps. `pick` forces a recommended space (the person chose another card).
    `read` is what a chat model already understood ({wants, product, by}); it replaces the description-reading step."""
    steps, t0 = [], time.time()

    def step(key, title, out, detail=''):
        steps.append({'key': key, 'title': title, 'detail': detail, 'ms': int((time.time() - t0) * 1000), **out})

    u = understand(desc, category, area, files)
    if read:
        u['wants'] = [w for w in read.get('wants') or u['wants'] if w in WANTS]
        u['product'] = read.get('product') or u['product']
        u['move'] = read.get('move') or []
        u['read_by'] = read.get('by', 'claude')
    elif has_llm():
        u = understand_llm(u)
    top = u['matches'][0]['id'] if u['matches'] else None
    step('understand', '업종 이해', {'understanding': u},
         f"{next((c['label'] for c in catalog() if c['id'] == top), '업종 미확정')}"
         + (f" · {u['area_m2']:.0f}㎡" if u['area_m2'] else '') + (f" · 원하는 것: {', '.join(WANT_LABEL[x] for x in u['wants'])}" if u['wants'] else '')
         + f" · {'규칙' if u['read_by'] == 'rules' else u['read_by']}으로 읽음")
    if not u['matches'] and not pick and not category:
        step('recommend', '맵 추천', {'ask': True, 'choices': sorted({(c['mode'], MODE_LABEL[c['mode']]) for c in catalog()})},
             '설명에서 업종을 찾지 못했습니다. 업종을 하나 골라 주세요')
        return {'space': None, 'glb': None, 'steps': steps}
    recs = recommend(u)
    sid = pick if pick in {c['id'] for c in catalog()} else recs[0]['id']
    step('recommend', '맵 추천', {'recommendations': recs, 'chosen': sid}, f"{len(catalog())}개 원형 맵 중 3개 · 고른 맵: {next(c['title'] for c in catalog() if c['id'] == sid)}")
    s, ops, skipped, note = adapt(sid, u)
    step('adapt', '맵 맞추기', {'ops': ops, 'skipped': skipped, 'note': note},
         f"바꾼 것 {len(ops)}개" + (f" · 못 바꾼 것 {len(skipped)}개" if skipped else '') + ' · 통로 폭 · 겹침 · 출입문 검사 통과한 것만')
    ppl = people(s, u)
    step('place', '사람 배치', {'people': ppl}, f"손님 {ppl['count']}명 · 목적지 {len(ppl['targets'])}곳 (면적 × 업종별 밀도 {ppl['per_m2']}명/㎡, 가정)")
    ds = decisions(s, u, ops)
    data = bool(files)
    step('decide', '시험할 결정', {'decisions': ds, 'calibrated': data},
         f"결정 {len(ds)}개 · " + ('올린 기록으로 보정할 수 있음' if data else '기록이 없어 아직 숫자를 내지 않음 · 예시 데이터로 흐름만 볼 수 있음'))
    s['title'] = s['title'].replace('[원형] ', '')
    return {'space': {k: s[k] for k in ('id', 'title', 'type_label', 'area_m2', 'floors', 'doors', 'fixtures', 'booths', 'zones', 'aisle_min_std')},
            'glb': f'spaces/{sid}.glb', 'steps': steps}


# ---------------------------------------------------------------- optional language model (reads the description only)

def has_llm():
    return any(os.environ.get(k) for k in ('ANTHROPIC_API_KEY', 'OPENAI_API_KEY'))


def llm_json(prompt):
    """service.llm_text (Claude first, OpenAI otherwise, usage logged); any failure falls back to the rules (None)."""
    import service
    try:
        txt = service.llm_text(prompt, json_mode=True, purpose='agent')
        m = re.search(r'\{.*\}', txt, re.S)
        LAST_LLM_ERRORS[:] = []
        return json.loads(m.group(0) if m else txt), service.llm_model()
    except Exception as e:  # noqa: BLE001 — a dead key or a spent quota must not stop the rules path
        LAST_LLM_ERRORS[:] = [str(e)[:160]]
        return None, 'rules'


LAST_LLM_ERRORS = []
