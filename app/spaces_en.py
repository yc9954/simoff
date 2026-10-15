"""English display text for the 27 archetype spaces (app/static/spaces/*.space.json), applied in place.

The spaces come from the private consumer-jev repo with Korean labels (fixtures, booths, zones, titles); the app
shows English. fetch_spaces.sh runs this after copying them. Ids and dict keys are left alone, so the GLB nodes
and the zone graph still line up.

  python3 app/spaces_en.py [spaces_dir] [--dry]
"""
import collections, glob, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
KO = re.compile(r'[가-힣]')
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
D = ARGS[0] if ARGS else os.path.join(HERE, 'static', 'spaces'); DRY = '--dry' in sys.argv

# English names already used by world.py for title/type_label (kept identical so the two never disagree)
src = open(os.path.join(HERE, 'world.py'), encoding='utf-8').read()
m = re.search(r'^SPACE_EN = (\{.*?^\})', src, re.S | re.M)
SPACE_EN = eval(m.group(1))

T = {
 'エ': 'x',  # placeholder, removed below
 '엔진 평면 (x, y) = Blender (x, y) · 높이 z · glTF +Y up(three.js 위치 = (x, z, −y))':
     'Engine plane (x, y) = Blender (x, y) · height z · glTF +Y up (three.js position = (x, z, −y))',
 '베이커리': 'Bakery', '음료 · 주류': 'Drinks · alcohol', '바디 · 헤어': 'Body · hair', '브리핑룸': 'Briefing room',
 '정육 대면': 'Butcher counter', '입장 확인(티켓 · 신분)': 'Entry check (ticket · ID)', '계산대': 'Checkout',
 '음료 · 주류 냉장': 'Drinks · alcohol fridge', '유제품 · 정육 냉장': 'Dairy · meat fridge', '무대 · 토크': 'Stage · talk',
 '전시 차량 · 제품': 'Display vehicle · products', '브랜드 전시': 'Brand exhibit', '캠페인 전시': 'Campaign exhibit',
 '대형 조형물': 'Large sculpture', '작품 · 아카이브': 'Artworks · archive', 'IP 대표 조형물 · 전시': 'IP signature sculpture · exhibit',
 '미디어 월': 'Media wall', '엔드캡': 'Endcap', '엔드캡(행사)': 'Endcap (promo)', 'VR 시승': 'VR test drive',
 '브랜드 체험': 'Brand experience', '럭키 드로우': 'Lucky draw', '경품 룰렛': 'Prize wheel', '게임 존': 'Game zone',
 '미니 게임': 'Mini game', '입점 브랜드(원형)': 'Tenant brand (archetype)', '도시락 · 삼각김밥': 'Lunch boxes · rice balls',
 '냉동': 'Frozen', '2층 관람 회랑': '2F viewing gallery', '입장 게이트(팔찌 확인)': 'Entry gate (wristband check)',
 '아트숍': 'Art shop', '가공식품 곤돌라': 'Packaged food gondola', '건강 · 위생': 'Health · hygiene', '안내 텐트': 'Info tent',
 '매장 계산대': 'Store checkout', '라이프스타일 테이블': 'Lifestyle table', '라이프스타일 벽장': 'Lifestyle wall shelving',
 '메이크업': 'Makeup', 'MD 선반(원두 · 텀블러 — 고르고 그 자리에서 계산)': 'Merch shelf (coffee beans · tumblers — pick and pay on the spot)',
 'MD 텐트': 'Merch tent', 'MD 텐트(10 창구)': 'Merch tent (10 windows)', '상품 샘플 보드': 'Product sample board',
 '미디어룸': 'Media room', '주문(POS 2)': 'Order (POS 2)', '포토존': 'Photo spot', '아티스트 등신대 포토존': 'Artist life-size cutout photo spot',
 '네컷 부스': 'Photo-strip booth', '픽업': 'Pickup', '아트숍 계산': 'Art shop checkout', '기념품 계산': 'Souvenir checkout',
 '농산': 'Produce', '행사 평대': 'Promo flat table', '샘플링 텐트': 'Sampling tent', '좌석': 'Seating', '피크닉 좌석': 'Picnic seating',
 '휴게 테이블': 'Rest tables', '4인 테이블': '4-person table', '부스 좌석': 'Booth seating', '생활용품 벽 선반': 'Household goods wall shelf',
 '과자 · 라면 곤돌라': 'Snacks · noodles gondola', '기념품': 'Souvenirs', '스킨케어': 'Skincare', '메인 무대': 'Main stage',
 '팬사인 무대': 'Fan-signing stage', '관람 1 — 조립': 'Viewing 1 — assembly', '관람 2 — 검사': 'Viewing 2 — inspection',
 '관람 3 — 물류': 'Viewing 3 — logistics', '테스터 테이블': 'Tester table', '매표 · 입장 확인': 'Tickets · entry check',
 '회차 대기석': 'Next-session waiting seats',
 '카운터(주문 · 음료)': 'Counter (order · drinks)', '픽업대': 'Pickup counter', '냅킨 · 빨대 대': 'Napkin · straw stand',
 'MD 선반(원두 · 텀블러)': 'Merch shelf (coffee beans · tumblers)', '창가 바 좌석': 'Window bar seating', '테이블(4top)': 'Table (4-top)',
 '재고 팔레트(텐트 뒤)': 'Stock pallets (behind tent)', '대기 줄 펜스': 'Queue fencing', '등신대 포토존': 'Life-size cutout photo spot',
 '안내 · 보안 텐트': 'Info · security tent', '퇴장 동선 펜스': 'Exit route fencing', '계산대(POS 2)': 'Checkout (POS 2)',
 '담배 진열': 'Tobacco display', '전자레인지 · 커피 머신': 'Microwave · coffee machine', '워크인 냉장(문)': 'Walk-in cooler (doors)',
 '오픈 냉장(도시락 · 김밥)': 'Open fridge (lunch boxes · gimbap)', '생활용품': 'Household goods', '창가 취식대': 'Window eating counter',
 '곤돌라(과자 · 라면)': 'Gondola (snacks · noodles)', '입간판': 'A-frame sign', '진열 받침': 'Display plinth', '체험 부스': 'Experience booth',
 '양면 매대': 'Double-sided display table', '계산대 뒤 선반': 'Shelf behind checkout', '계산 줄 차단봉': 'Checkout queue stanchions',
 '스킨케어 벽장': 'Skincare wall shelving', '메이크업 벽장': 'Makeup wall shelving', '건강 · 위생 벽장': 'Health · hygiene wall shelving',
 '계산대(POS 3)': 'Checkout (POS 3)', '계산 줄': 'Checkout queue', '바디 · 헤어 벽장': 'Body · hair wall shelving', '낮은 곤돌라': 'Low gondola',
 '무대': 'Stage', '굿즈 벽장': 'Merch wall shelving', '매표소': 'Ticket booth', '전시 안내': 'Exhibit info', '로비 벤치': 'Lobby bench',
 '작품 벽': 'Artwork wall', '유리 진열장': 'Glass display case', '관람 벤치': 'Viewing bench', '대표 조형물': 'Signature sculpture',
 '아트숍 벽장': 'Art shop wall shelving', '아트숍 테이블': 'Art shop table', '행사 경계 차단봉': 'Event boundary stanchions',
 '굿즈 테이블': 'Merch table', '부스 상단 사인': 'Booth header sign', '브리핑 화면': 'Briefing screen', '브리핑 의자': 'Briefing chairs',
 '관람 동선(노란 선)': 'Viewing route (yellow line)', '관람 동선': 'Viewing route', '관람 동선 난간': 'Viewing route railing',
 '작업대(작업자는 라인 쪽)': 'Workbench (worker on the line side)', '로봇 팔': 'Robot arm', '검사기': 'Inspection machine',
 '자재 랙': 'Material rack', '관람 안내 화면(난간 위)': 'Viewing info screen (on the railing)', '기념품 벽장': 'Souvenir wall shelving',
 '기념품 테이블': 'Souvenir table', '계산': 'Checkout', '무대 앞 펜스': 'Front-of-stage fencing', '대기 줄 차단봉': 'Queue stanchions',
 '입장 확인 데스크': 'Entry check desk', '대기 의자 줄': 'Row of waiting chairs', 'MD 진열': 'Merch display', 'MD 계산': 'Merch checkout',
 '외곽 펜스': 'Perimeter fencing', '입장 게이트': 'Entry gate', '주 동선': 'Main route', '피크닉 테이블': 'Picnic table', '캐노피': 'Canopy',
 '스폰서 체험': 'Sponsor experience', '대형 벌룬': 'Giant balloon', '포토 프레임': 'Photo frame', '안내 데스크': 'Info desk',
 '이동식 화장실': 'Portable toilet', '분리수거대': 'Recycling station', '화장실 · 창고(코어)': 'Restrooms · storage (core)',
 '진열대': 'Display', '주문 카운터': 'Order counter', '벤치': 'Bench', '전시 벽 패널': 'Exhibit wall panel', '전시 화면': 'Exhibit screen',
 '판매대': 'Sales stall', '마당 테이블': 'Yard table', '화분': 'Planter', '배식 창구': 'Serving window', '주방 작업대': 'Kitchen worktop',
 '대기 의자': 'Waiting chairs', '뒤 작업대': 'Back worktop', 'F&B 카운터 · POS': 'F&B counter · POS', '벽장': 'Wall shelving',
 '이동형 집기': 'Mobile fixture', '입점 칸 — 입점 브랜드(원형)': 'Tenant bay — tenant brand (archetype)',
 '입점 브랜드(원형) 사인': 'Tenant brand (archetype) sign', '계산대 6레인': 'Checkout (6 lanes)', '농산 매대': 'Produce display table',
 '냉동 리치인': 'Frozen reach-in', '아일랜드 냉동': 'Island freezer', '오픈 다단 냉장': 'Open multi-deck fridge',
 '정육 대면 판매': 'Butcher counter service', '음료 · 주류 벽 선반': 'Drinks · alcohol wall shelf', '베이커리 테이블': 'Bakery table',
 '케이크 쇼케이스': 'Cake showcase', '곤돌라(가공식품)': 'Gondola (packaged food)', '카운터 앞 줄': 'Queue at counter',
 '광장': 'Plaza', '앞 통로': 'Front aisle', '통로': 'Aisle', '로비 통로': 'Lobby walkway', '매장 가운데': 'Store center',
 '텐트 앞': 'In front of tents', '입구': 'Entrance', '광장 입구': 'Plaza entrance', '입구 · 대기': 'Entrance · waiting',
 '입구(로비)': 'Entrance (lobby)', '앞': 'Front', '에스컬레이터(위)': 'Escalator (top)', '에스컬레이터(아래)': 'Escalator (bottom)',
 '샘플 보드': 'Sample board', '입장 확인': 'Entry check', '음료 냉장': 'Drinks fridge', '유제품 · 정육': 'Dairy · meat', '홀': 'Hall',
 '무대 · 전시': 'Stage · exhibit', '푸드 텐트 줄': 'Food tent row', '굿즈 매대': 'Merch display table', '가공식품': 'Packaged food',
 '안내': 'Info', '라이프스타일': 'Lifestyle', '매장 계산': 'Store checkout', '로비 · 매표': 'Lobby · tickets',
 'MD 창구 앞': 'In front of merch windows', '주문': 'Order', '대기 줄': 'Queue', '휴게': 'Rest area', '과자 · 라면': 'Snacks · noodles',
 '무대 오르는 곳': 'Stage access', '무대 앞 관람': 'Front-of-stage viewing', '테스터': 'Testers', '회랑 벤치': 'Gallery bench',
 '회랑 전시 화면': 'Gallery exhibit screen', '공연장 외벽': 'Venue outer wall', '이웃 매장': 'Neighboring store',
 '이웃 부스': 'Neighboring booth', '섬 부스': 'Island booth', '로비 유리 전면': 'Lobby glass frontage', '스피드 게이트': 'Speed gate',
 '엘리베이터 홀': 'Elevator hall', '로비 소파': 'Lobby sofa', '난간': 'Railing', '상가 앞면': 'Shopfront', '아트리움 기둥': 'Atrium column',
 '건물 1층 앞면': 'Building ground-floor front',
 '[가정 — 업계 통상 치수]': '[assumed — typical industry dimensions]', '[가정] 입점 칸 표시': '[assumed] tenant bay marker', '[가정]': '[assumed]',
 '관람 회랑': 'Viewing gallery', '행사장': 'Event space', '루프탑': 'Rooftop', '부스 자리': 'Booth plot', '마당': 'Yard',
 'sim/scenarios/cvs_gs25.json 부스 id + 역할 층 shelf_daily': 'sim/scenarios/cvs_gs25.json booth ids + role layer shelf_daily',
 '입구 → 매표 → 1전시실 → 미디어룸 → 3전시실(포토) → 아트숍 → 출구': 'Entrance → tickets → Gallery 1 → media room → Gallery 3 (photo) → art shop → exit',
 '브리핑 → 관람 동선(1 · 2 · 3) → 계단 → 2층 회랑 → 계단 → 기념품 → 출구': 'Briefing → viewing route (1 · 2 · 3) → stairs → 2F gallery → stairs → souvenirs → exit',
 '회차 입장(entry_mode session) — 대기석 = 다음 회차': 'Timed-session entry (entry_mode session) — waiting seats = next session',
 '원형': 'archetype', '전시': 'Exhibit',
}
del T['エ']
# booth `kind` is a category word: lower-case English (nothing in sim/app reads it)
KIND = {'매대': 'display table', '전시': 'exhibit', '체험': 'experience', '계산대': 'checkout', '굿즈': 'merch', '포토': 'photo',
        '냉장': 'chilled', '엔드캡': 'endcap'}
RX = [
 (r'^\[가정 — 업계 통상 치수\] 유형 원형 — 넓이 ([\d,.]+)㎡$', r'[assumed — typical industry dimensions] type archetype — area \1 m²'),
 (r'^스폰서 체험 (\d+)$', r'Sponsor experience \1'), (r'^체험 방 (\d+)$', r'Experience room \1'),
 (r'^F&B ([AB]) 픽업$', r'F&B \1 pickup'), (r'^F&B ([AB]) 주문$', r'F&B \1 order'), (r'^푸드 텐트 (\d+)$', r'Food tent \1'),
 (r'^(\d)전시실$', r'Gallery \1'), (r'^계산대 (\d+)$', r'Checkout \1'), (r'^벽 줄 ([A-Z])$', r'Wall row \1'),
 (r'^가운데 줄 ([A-Z])$', r'Center row \1'), (r'^작업대 ([A-Z]\d+)$', r'Workbench \1'), (r'^기둥 (\d+)$', r'Column \1'),
 (r'^조립 라인 (\w+)$', r'Assembly line \1'),
 (r'^(\S+) 계단\(위\)$', r'\1 stairs (top)'), (r'^(\S+) 계단\(아래\)$', r'\1 stairs (bottom)'), (r'^(\S+) 도착\(계단\)$', r'\1 arrival (stairs)'),
]
SKIP_KEYS = {'id'}   # identifiers (zone ids such as arrival_루프탑, and edges_geom refs to them) stay as they are

done = collections.Counter(); fields = collections.Counter(); left = collections.Counter()

def tr(s, key, sid):
    if key == 'title' and sid in SPACE_EN: return SPACE_EN[sid][1]
    if key == 'type_label' and sid in SPACE_EN: return SPACE_EN[sid][0]
    if key == 'kind' and s in KIND: return KIND[s]
    if s in T: return T[s]
    for pat, rep in RX:
        if re.match(pat, s):
            out = re.sub(pat, rep, s)
            return out.replace('루프탑', 'Rooftop')
    return None

def walk(o, key, sid, path):
    if isinstance(o, dict):
        return {k: walk(v, k, sid, path + [k]) for k, v in o.items()}
    if isinstance(o, list):
        return [walk(v, key, sid, path + ['[]']) for v in o]
    if isinstance(o, str) and KO.search(o):
        if key in SKIP_KEYS or path[-1] == '[]' and path[0] == 'edges_geom':
            left[(o, '.'.join(p for p in path if p != '[]'))] += 1; return o
        out = tr(o, key, sid)
        if out is None or KO.search(out):
            left[(o, key)] += 1; return o
        done[o] += 1; fields[key] += 1
        return out
    return o

for f in sorted(glob.glob(os.path.join(D, '*.space.json'))):
    raw = open(f, encoding='utf-8').read()
    s = json.loads(raw)
    new = walk(s, None, s['id'], [])
    out = json.dumps(new, ensure_ascii=False, separators=(',', ':'))
    if not DRY and out != raw:
        open(f, 'w', encoding='utf-8').write(out)

print('unique translated', len(done), 'occurrences', sum(done.values()))
print('fields', dict(fields))
print('LEFT', len(left))
for (s, k), n in left.items(): print('  ', n, k, s)
