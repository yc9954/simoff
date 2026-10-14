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

# business words -> archetype; first match is the strongest. Korean and English both parse; an English (ASCII) word
# matches as a whole word (plural allowed), so 'mall' does not fire on 'small' or 'fan' on 'fancy'.
LEXICON = {
    'arch_cafe': ['카페', '커피', 'cafe', 'coffee', 'coffee shop', 'café', '디저트', 'dessert', '베이커리', 'bakery', '음료', 'tea house', 'juice bar'],
    'arch_cvs': ['편의점', 'convenience', 'convenience store', 'cvs', 'gs25', 'cu', '세븐일레븐', '7-eleven', 'bodega', 'corner store', '미니스톱'],
    'arch_supermarket': ['마트', '슈퍼', '식료품', 'grocery', 'supermarket', 'groceries', 'grocery store', '장보기', '시리얼', 'cereal', '신선식품', 'fresh food'],
    'arch_drugstore': ['드럭', '드러그', '올리브영', '화장품', '뷰티', 'drugstore', 'cosmetic', 'cosmetics', 'beauty', 'skincare', 'pharmacy', '약국', '헬스', 'health'],
    'arch_store': ['편집숍', '편집 매장', '굿즈 매장', '소품', '잡화', '의류', '옷가게', '매장', 'boutique', 'store', 'shop', 'retail', 'apparel', 'clothing', '서점', 'bookstore', 'concept store', 'gift shop'],
    'arch_restaurant': ['식당', '레스토랑', 'restaurant', '음식점', 'diner', 'bistro', '분식', '고깃집', '한식', 'eatery', '주점', '술집', 'bar', 'pub'],
    'arch_popup_goods': ['팝업', 'popup', 'pop-up', 'pop up', 'popup store', 'pop-up store', '굿즈', 'goods', 'merch', 'ip', '캐릭터', 'character', '한정판', 'limited edition', '콜라보 굿즈', 'collab'],
    'arch_popup_experience': ['체험', '방탈출', 'experience', 'experiential', '인터랙티브', 'interactive', '체험형', 'hands-on'],
    'arch_popup_exhibition': ['전시형 팝업', '브랜드 전시', '팝업 전시', 'brand exhibition', 'popup exhibition', 'pop-up exhibition'],
    'arch_popup_fnb': ['콜라보 카페', '팝업 카페', 'popup cafe', 'pop-up cafe', 'f&b', '디저트 팝업', 'dessert popup', 'collab cafe'],
    'arch_exhibition_hall': ['전시', '미술', '갤러리', '박물관', 'museum', 'gallery', 'exhibition', 'exhibit', 'art', '아트'],
    'arch_expo_booth': ['박람회', '부스', 'expo', 'trade show', 'tradeshow', 'booth', '전시회 부스', 'b2b', '컨벤션', 'convention'],
    'arch_festival': ['축제', '페스티벌', 'festival', '야외 행사', 'outdoor event', '푸드트럭', 'food truck', '플리마켓', 'flea market'],
    'arch_concert_md': ['공연', '콘서트', 'concert', 'gig', 'md 부스', 'merch booth', 'merch tent', '굿즈 줄', 'merch line'],
    'arch_fan_event': ['팬사인', '팬미팅', '팬 행사', 'fan', 'fan meeting', 'fan event', 'fan sign', '아이돌', 'idol', 'k-pop', '사인회', 'signing'],
    'arch_event_hall': ['행사장', '이벤트', '런칭', '쇼케이스', 'event', 'launch', 'launch event', 'showcase', '세미나', 'seminar', 'conference'],
    'arch_dept_event': ['백화점', 'department store', '행사 매대', '팝업 매대', 'promo table', 'popup counter'],
    'arch_mall_atrium': ['몰', '쇼핑몰', '아트리움', 'mall', 'shopping mall', 'atrium', '광장 행사', 'plaza event'],
    'arch_market': ['시장', '마켓', 'market', '파머스', "farmers market", "farmer's market", '장터', 'bazaar'],
    'arch_factory_tour': ['공장', '견학', 'factory', 'factory tour', '양조장', '브루어리', 'brewery', 'winery', 'distillery', '제조', 'manufacturing'],
    'arch_flagship_3f': ['플래그십', 'flagship', '다층 매장', 'multi-floor', 'multi-level', '쇼룸', 'showroom'],
    'arch_flagship_4f_esc': ['대형 플래그십', 'large flagship', '에스컬레이터', 'escalator'],
    'arch_lobby': ['로비', '공항', '오피스', 'lobby', 'airport', 'office', '탑승동', 'terminal'],
    'arch_rental_venue': ['대관', '루프탑', 'rental', 'rooftop', 'venue', '스튜디오', 'studio'],
    'arch_rental_yard': ['마당', '야드', '정원 대관', 'yard', 'courtyard', 'garden'],
    'arch_shop_in_shop': ['숍인숍', 'shop in shop', 'shop-in-shop', 'concession', '입점'],
    'arch_street_promo': ['거리', '샘플링', 'sampling', '길거리', '가두', 'street', 'street promo', 'sidewalk', '프로모션 텐트', 'promo tent'],
}
# what the person says they care about -> the booth role or fixture kind it touches
WANTS = {
    'checkout': ['계산', '줄', '대기', '결제', '포스', 'pos', 'queue', 'line', 'wait', 'waiting', 'checkout', 'cashier', 'register', 'payment',
                 'crowd', 'crowded', 'congestion', 'bottleneck', '혼잡', '회전', 'turnover'],
    'seat': ['좌석', '자리', '테이블', '앉', 'seat', 'seating', 'table', 'sit', 'dwell', 'linger', 'stay longer', '체류'],
    'promo': ['행사', '신제품', '프로모션', '할인', '진열', '엔드캡', '입구', '눈에 띄', 'promo', 'promotion', 'display', 'new product', 'launch',
              'discount', 'endcap', 'end cap', 'entrance', 'visibility', 'stand out', 'featured'],
    'photo': ['포토', '사진', '인증', 'photo', 'photos', 'selfie', 'instagram', 'instagrammable', 'picture', 'sns', 'social media'],
    'order': ['주문', '키오스크', 'order', 'ordering', 'kiosk', 'pickup', 'pick-up', 'pick up', 'takeout', 'to-go', '픽업'],
}
MODES = {'retail': ['arch_cvs', 'arch_supermarket', 'arch_drugstore', 'arch_store', 'arch_market', 'arch_shop_in_shop', 'arch_dept_event'],
         'fnb': ['arch_cafe', 'arch_restaurant', 'arch_popup_fnb'],
         'popup': ['arch_popup_goods', 'arch_popup_experience', 'arch_popup_exhibition', 'arch_street_promo', 'arch_mall_atrium'],
         'event': ['arch_festival', 'arch_concert_md', 'arch_fan_event', 'arch_event_hall', 'arch_expo_booth', 'arch_rental_venue', 'arch_rental_yard', 'arch_lobby'],
         'venue': ['arch_exhibition_hall', 'arch_factory_tour', 'arch_flagship_3f', 'arch_flagship_4f_esc']}
MODE_OF = {s: m for m, ids in MODES.items() for s in ids}
KIND_WORDS = {'pickup': ('픽업', '픽업대', 'pickup', 'pick-up', 'pickup counter', 'pickup desk', 'pickup area'),
              'checkout': ('계산대', '계산', 'checkout', 'pos', 'register', 'cashier', 'checkout counter', 'till'),
              'photo': ('포토존', '포토', 'photo', 'photo zone', 'photo spot', 'photo booth', 'photo wall'),
              'cafe_counter': ('카운터', '주문대', 'counter', 'order counter', 'ordering counter'),
              'table_set': ('테이블', '좌석', 'table', 'tables', 'seating', 'seats'), 'display': ('진열대', 'display', 'display table', 'shelf'),
              'endcap': ('엔드캡', 'endcap', 'end cap'), 'chiller': ('냉장', 'chiller', 'fridge', 'cooler'), 'stage': ('무대', 'stage'),
              'booth': ('부스', 'booth')}
# English names for the 27 archetypes (the space files carry Korean type_label/title); applied where the space leaves world.py
SPACE_EN = {
    'arch_cafe': ('Cafe', 'Cafe 110 m² — counter · pickup · seating · merch'),
    'arch_concert_md': ('Concert merch booth', 'Concert merch plaza 1,200 m² — queue fencing'),
    'arch_cvs': ('Convenience store', 'Convenience store 83 m² — gondolas · walk-in cooler · 2 checkouts'),
    'arch_dept_event': ('Department store event space', 'Department store event space 200 m² — low partitions · corridor · columns'),
    'arch_drugstore': ('Drugstore', 'Drugstore 216 m² — wall shelving · testers · 3 checkouts'),
    'arch_event_hall': ('Event hall', 'Event hall 400 m² — stage · experiences · photo'),
    'arch_exhibition_hall': ('Exhibition hall', 'Exhibition hall 600 m² — three galleries · media room · art shop'),
    'arch_expo_booth': ('Expo booth hall', 'Expo booth 54 m² (9×6) — inside an exhibition hall'),
    'arch_factory_tour': ('Factory tour', 'Factory tour 1,000 m² + upper viewing gallery'),
    'arch_fan_event': ('Timed-entry fan event', 'Timed-entry fan signing 600 m²'),
    'arch_festival': ('Outdoor festival', 'Outdoor festival 2,400 m² — stage · food tents · merch · fencing'),
    'arch_flagship_3f': ('Multi-floor flagship', 'Flagship, 3 floors, 540 m² — stairs · elevator'),
    'arch_flagship_4f_esc': ('Multi-floor flagship', 'Flagship, basement + 3 floors, 1,760 m² — escalators · stairs · elevator'),
    'arch_lobby': ('Office lobby · airport gate', 'Office lobby campaign 160 m²'),
    'arch_mall_atrium': ('Mall atrium', 'Mall atrium event 300 m² — upper-floor railings · escalators'),
    'arch_market': ('Market', 'Indoor market 400 m² — rows of stalls · rest area'),
    'arch_popup_exhibition': ('Pop-up (exhibition)', 'Pop-up — exhibition 200 m²'),
    'arch_popup_experience': ('Pop-up (experience)', 'Pop-up — experience 230 m² (3 rooms)'),
    'arch_popup_fnb': ('Pop-up (food and drink · collab cafe)', 'Pop-up — collab cafe 140 m²'),
    'arch_popup_goods': ('Pop-up (merch)', 'Pop-up — character merch store 165 m² (street front)'),
    'arch_rental_venue': ('Rental venue (multi-floor)', 'Rental venue, B1 to 2F + rooftop, 368 m²'),
    'arch_rental_yard': ('Rental venue with yard', 'Rental venue, 1F · mezzanine · yard, 546 m²'),
    'arch_restaurant': ('Restaurant', 'Restaurant 150 m² — dining room · booths · kitchen'),
    'arch_shop_in_shop': ('Shop-in-shop', 'Shop-in-shop — food and drink corner inside a 66 m² store'),
    'arch_store': ('Store (concept · merch)', 'Store — permanent concept and merch store 120 m²'),
    'arch_street_promo': ('Street promotion', 'Street promotion 36 m² — sampling tent · photo frame'),
    'arch_supermarket': ('Supermarket', 'Supermarket 900 m² — 6 checkout lanes'),
}
WANT_LABEL = {'checkout': 'checkout line', 'seat': 'seating', 'promo': 'promo display', 'photo': 'photo spot', 'order': 'ordering and pickup'}
MODE_LABEL = {'retail': 'Retail', 'fnb': 'Food and drink', 'popup': 'Pop-ups and promotions', 'event': 'Events and shows', 'venue': 'Exhibitions and venues'}


def _has(text, word):
    """Korean words match as substrings (particles attach to them); English words match whole, with an optional plural."""
    w = word.strip()
    if w.isascii():
        return re.search(r'(?<![a-z0-9])' + re.escape(w) + r'(?:s|es)?(?![a-z0-9])', text) is not None
    return w in text


@lru_cache(maxsize=None)
def space(sid):
    return json.loads((SPACES / f'{sid}.space.json').read_text())


@lru_cache(maxsize=1)
def catalog():
    out = []
    for f in sorted(SPACES.glob('arch_*.space.json')):
        s = json.loads(f.read_text())
        sid = s['id']
        en = SPACE_EN.get(sid)
        out.append({'id': sid, 'type': s['type'], 'label': en[0] if en else s['type_label'], 'title': en[1] if en else s['title'].replace('[원형] ', ''),
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
        hits = [w.strip() for w in words if _has(t, w)]
        if hits:
            first_en = next((w for w in words if w.isascii()), None)      # the strongest English word, for English descriptions
            strong = _has(t, words[0]) or (first_en is not None and _has(t, first_en))
            scores[sid] = {'score': len(hits) + (0.5 if strong else 0), 'hits': hits}
    wants = [k for k, ws in WANTS.items() if any(_has(t, w) for w in ws)]
    m = re.search(r'(\d[\d,]*(?:\.\d+)?)\s*(sq\.?\s*ft|sqft|square\s+f(?:ee|oo)t|ft2|ft²|㎡|m2|m²|sq\.?\s*m\b|sqm|square\s+met(?:er|re)s?|제곱|평)',
                  desc or '', re.I)
    if not area and m:
        v = float(m.group(1).replace(',', ''))
        unit = m.group(2).lower()
        area = v * 3.3058 if unit == '평' else v * 0.0929 if any(f in unit for f in ('ft', 'feet', 'foot')) else v
    product = None
    pm = re.search(r'(신제품|신상|행사 상품|상품)\s*[:：]?\s*([^\s,\.·]+)', desc or '')
    if pm:
        product = pm.group(2)
    else:
        pm = re.search(r'\b(?:new product|product|item|launching)\s*[:：]\s*([^,\.;·\n]+?)(?=\s+(?:on|at|in|by|near|for|next|this)\b|[,\.;·\n]|$)', desc or '', re.I)
        if pm:
            product = pm.group(1).strip()
    return {'description': desc, 'category': category, 'area_m2': round(area, 1) if area else None, 'wants': wants, 'product': product,
            'matches': sorted(({'id': k, **v} for k, v in scores.items()), key=lambda x: -x['score']), 'files': files or [],
            'read_by': 'rules'}


def understand_llm(u):
    """Optional: let a language model read the description into the same fields. Rules stay the fallback."""
    ids = [c['id'] for c in catalog()]
    prompt = (f"You classify an offline business into one of these space archetypes: {', '.join(ids)}.\n"
              f"Business description (Korean or English): {u['description']!r}. Category hint: {u['category']!r}.\n"
              "Return JSON only: {\"types\": [up to 3 archetype ids, best first], \"area_m2\": number in square metres (sq ft x 0.0929, pyeong x 3.3058) or null, "
              "\"wants\": subset of [\"checkout\",\"seat\",\"promo\",\"photo\",\"order\"], \"product\": short product name or null}")
    out, who = llm_json(prompt)
    if not out:
        u['llm_failed'] = list(LAST_LLM_ERRORS)
        return u
    types = [t for t in out.get('types', []) if t in ids]
    if types:
        base = {m['id']: m for m in u['matches']}
        u['matches'] = [{'id': t, 'score': 10 - i + base.get(t, {}).get('score', 0), 'hits': base.get(t, {}).get('hits', []) + ['language model']}
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
            hit = m['hits'][0] if m['hits'] else None
            s += 3 * m['score']; why.append(f"Fits “{hit}”" if hit and hit != 'language model' else 'Fits your business')
        if u['matches'] and MODE_OF.get(sid) == MODE_OF.get(u['matches'][0]['id']) and not m:
            s += 1; why.append(f"Similar business · {MODE_LABEL[MODE_OF[sid]]}")
        if u['area_m2']:
            r = abs(math.log(c['area_m2'] / u['area_m2']))
            s += max(0, 2 - 2 * r); why.append(f"{c['area_m2']:.0f} m²")
        roles = {b.get('role') for b in space(sid)['booths'].values()} | {f['kind'] for f in space(sid)['fixtures']}
        for w in u['wants']:
            need = {'checkout': {'checkout'}, 'seat': {'seat', 'table_set'}, 'promo': {'endcap', 'display'}, 'photo': {'photo'}, 'order': {'order', 'pickup'}}[w]
            if roles & need:
                s += .5; why.append({'checkout': 'Has checkout', 'seat': 'Has seating', 'promo': 'Has a promo display', 'photo': 'Has a photo spot', 'order': 'Has ordering and pickup'}[w])
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
        skipped.append({'op': 'duplicate', 'id': fx['id'], 'why': why, 'reason': 'No free spot that keeps the aisles wide enough'})
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
            ops.append({'op': 'stations', 'id': f['id'], 'from': n, 'to': n + 1, 'label': f['label'], 'why': f'You mentioned the checkout line, so {f["label"]} now has {n + 1} stations instead of {n}'})
        elif f:
            dup(f, 'You mentioned the checkout line, so we added another checkout')
        else:
            skipped.append({'op': 'duplicate', 'id': None, 'why': 'Add a checkout', 'reason': 'This space has no checkout'})
    if 'seat' in u['wants']:
        f = nearest(lambda f: f['kind'] in ('table_set', 'bench') and f.get('klass') != 'context')
        if f:
            dup(f, 'You want people to stay longer, so we added more seating')
    if 'promo' in u['wants'] or u.get('product'):
        f = nearest(lambda f: f['kind'] in ('endcap', 'display', 'stall') and f.get('klass') != 'context')
        if f:
            lab = f"Promo: {u['product']}" if u.get('product') else f"Promo display ({f['label']})"
            ops.append({'op': 'relabel', 'id': f['id'], 'label': lab, 'why': 'The display closest to the entrance is now the promo spot'})
            f['label'] = lab; f['promo'] = True
    if 'photo' in u['wants']:
        f = nearest(lambda f: f['kind'] == 'photo')
        if f:
            dup(f, 'You want people taking photos, so we added another photo spot')
        else:
            skipped.append({'op': 'duplicate', 'id': None, 'why': 'Add a photo spot', 'reason': 'This space has no photo spot'})
    for want in u.get('move') or []:                       # "move the pickup counter to the entrance"
        w = want.strip().lower()
        f = next((f for f in s['fixtures'] if f.get('klass') not in ('context', 'floor', 'boundary', 'structure') and
                  (w in (f.get('label') or '').lower() or w == f['kind'] or w in KIND_WORDS.get(f['kind'], ()))), None)
        if not f:
            skipped.append({'op': 'move', 'id': None, 'why': f'Move {want}', 'reason': 'Could not find that fixture in this space'}); continue
        cands = sorted(((i * .5, j * .5) for i in range(-60, 61) for j in range(0, 61)), key=lambda v: math.hypot(v[0] - ex, v[1] - ey))
        for x, y in cands:
            if math.hypot(x - ex, y - ey) >= math.hypot(f['cx'] - ex, f['cy'] - ey) - .5:
                break
            ok, _ = _fits(s, f, x, y)
            if ok:
                dx, dy = round(x - f['cx'], 2), round(y - f['cy'], 2)
                f['cx'], f['cy'] = x, y
                ops.append({'op': 'move', 'id': f['id'], 'dx': dx, 'dy': dy, 'label': f['label'], 'why': f"Moved {f['label']} {math.hypot(dx, dy):.1f} m toward the entrance"})
                break
        else:
            skipped.append({'op': 'move', 'id': f['id'], 'why': f"Move {f['label']}", 'reason': 'No free spot near the entrance that keeps the aisles wide enough'})
        if not any(o['op'] == 'move' and o['id'] == f['id'] for o in ops) and not any(o['id'] == f['id'] for o in skipped):
            skipped.append({'op': 'move', 'id': f['id'], 'why': f"Move {f['label']}", 'reason': 'Already close to the entrance'})
    note = None
    if u.get('area_m2'):
        r = u['area_m2'] / s['area_m2']
        if r > 1.3 or r < 1 / 1.3:
            note = f"Your {u['area_m2']:.0f} m² is {r:.1f}× this space ({s['area_m2']:.0f} m²). The layout stays as it is; only the number of shoppers is scaled to your area."
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
        what = u.get('product') or ("This week's promo item" if MODE_OF.get(s['id']) in ('retail', 'fnb') else 'Your main product')
        out.append({'id': 'placement', 'q': f"{what}: does it sell more on the display by the entrance or in its usual spot?", 'metric': 'Sales per 1,000 visits',
                    'needs': 'Receipts and a display schedule', 'example': '#plans', 'ready': bool(promo)})
    if 'checkout' in roles or 'checkout' in kinds:
        out.append({'id': 'checkout', 'q': 'If we open one more checkout, how much shorter is the line, and how many fewer people walk out?', 'metric': 'Average wait · walk-out rate',
                    'needs': 'Receipts with times', 'example': None, 'ready': False})
    if 'seat' in roles or 'table_set' in kinds:
        out.append({'id': 'seats', 'q': 'With more seats, do people stay longer and order more?', 'metric': 'Time spent · spend per person',
                    'needs': 'Order records with times', 'example': None, 'ready': False})
    for o in ops:
        if o['op'] == 'move':
            out.insert(0, {'id': f"move_{o['id']}", 'q': f"{o['label']}: how do wait times and sales change if it moves toward the entrance?", 'metric': 'Average wait · sales per visit',
                           'needs': 'Time-stamped orders or receipts', 'example': None, 'ready': False})
    if 'photo' in kinds:
        out.append({'id': 'photo', 'q': 'If the photo spot moves toward the entrance, do more people walk all the way in?', 'metric': 'Share reaching the back',
                    'needs': 'Foot-traffic records (sensors)', 'example': None, 'ready': False})
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
    step('understand', 'Read the business', {'understanding': u},
         f"{next((c['label'] for c in catalog() if c['id'] == top), 'Business type unclear')}"
         + (f" · {u['area_m2']:.0f} m²" if u['area_m2'] else '') + (f" · Focus: {', '.join(WANT_LABEL[x] for x in u['wants'])}" if u['wants'] else ''))
    if not u['matches'] and not pick and not category:
        step('recommend', 'Suggest a space', {'ask': True, 'choices': sorted({(c['mode'], MODE_LABEL[c['mode']]) for c in catalog()})},
             "We couldn't tell the type of business. Pick one to continue")
        return {'space': None, 'glb': None, 'steps': steps}
    recs = recommend(u)
    sid = pick if pick in {c['id'] for c in catalog()} else recs[0]['id']
    step('recommend', 'Suggest a space', {'recommendations': recs, 'chosen': sid}, f"3 suggestions · Chosen: {next(c['title'] for c in catalog() if c['id'] == sid)}")
    s, ops, skipped, note = adapt(sid, u)
    step('adapt', 'Fit the space', {'ops': ops, 'skipped': skipped, 'note': note},
         f"{len(ops)} change{'s' if len(ops) != 1 else ''}" + (f" · {len(skipped)} not possible" if skipped else '') + ' · aisles, overlaps and doors all checked')
    ppl = people(s, u)
    step('place', 'Add people', {'people': ppl}, f"{ppl['count']} shoppers · {len(ppl['targets'])} destinations (area × an assumed {ppl['per_m2']} people/m² for this kind of place)")
    ds = decisions(s, u, ops)
    data = bool(files)
    step('decide', 'Decisions to test', {'decisions': ds, 'calibrated': data},
         f"{len(ds)} decision{'s' if len(ds) != 1 else ''} · " + ('Ready to calibrate on your records' if data else 'No records yet, so no numbers yet · sample data shows how it works'))
    s['title'] = s['title'].replace('[원형] ', '')
    if sid in SPACE_EN:
        s['type_label'], s['title'] = SPACE_EN[sid]
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
