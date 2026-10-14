"""Stage 4 in 3D: put the chosen layout on a 3D store and animate the move from the current layout.

Reads a run folder (01_map.json is not needed: 04_final_map.json carries the current conditions too)
and writes 04_final_3d.html, a single page with the data embedded. three.js r128 loads from jsDelivr;
pass --local-three DIR to point at a local copy instead (for headless screenshots without network).

  python viewer3d.py runs/dunnhumby
"""
import argparse
import json
from pathlib import Path

from sim import LABEL

CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0'


def payload(run):
    m = json.loads((run / '04_final_map.json').read_text())
    led = json.loads((run / '04_ledger.json').read_text())
    val = json.loads((run / '03_validation.json').read_text()) if (run / '03_validation.json').exists() else None
    opt = {r['product_id']: r for r in m['options']}
    prods = [{'n': p['n'], 'id': p['product_id'], 'name': f"{p['brand']} {p['type'].title()}", 'size': p['size'],
              'now': p['condition'], 'next': p['proposed'], 'moved': p['moved'], 'mailer': p['mailer'] != '0',
              'units': {o: round(opt[p['product_id']][f'{o}_units'], 2) for o in ['none', 'A_front_endcap', 'C_other_display']},
              'gain': round(opt[p['product_id']]['gain_revenue_vs_shelf'], 2)} for p in m['products']]
    return {'store': m['store_id'], 'asOf': m['as_of_week'], 'weeks': led['weeks'], 'category': m['category'],
            'visitsPerWeek': m['store']['visits_per_week'], 'capacity': m['capacity'],
            'aisles': [{'name': a['department'], 'share': a['sales_share'], 'home': a['category_home']} for a in m['aisles']],
            'products': prods, 'labels': LABEL, 'plans': led['plans'], 'draws': None,
            'validation': val and val['store_total']}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run')
    ap.add_argument('--out')
    ap.add_argument('--local-three', help='folder holding build/three.min.js and examples/js/controls/OrbitControls.js')
    a = ap.parse_args()
    run = Path(a.run)
    base = Path(a.local_three).resolve().as_uri() if a.local_three else CDN
    html = TEMPLATE.replace('__THREE__', f'{base}/build/three.min.js').replace('__ORBIT__', f'{base}/examples/js/controls/OrbitControls.js')
    html = html.replace('__DATA__', json.dumps(payload(run), ensure_ascii=False))
    out = Path(a.out) if a.out else run / '04_final_3d.html'
    out.write_text(html)
    print(out)


TEMPLATE = r'''<title>매장 367 진열 3D</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">
<style>
/* Layout: the store floor is the page; a narrow ledger column on the right reads the same numbers the floor shows. */
:root {
  --bg: #f3f4f1; --surface: #ffffff; --ink: #16191a; --muted: #5d6463; --line: #dcdfdb;
  --floor: #d5d9d3; --fixture: #f4f4f0; --fixture-edge: #9da4a0; --home: #e7eeff;
  --endcap: #3b73ff; --display: #88acfa; --shelf: #b4bab9; --mailer: #f2b200; --moved: #0f766e; --moved-soft: #d6efec;
  --sans: "IBM Plex Sans KR", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #121514; --surface: #1a1e1d; --ink: #eceeeb; --muted: #9aa19f; --line: #2c3231;
  --floor: #1f2423; --fixture: #2d3332; --fixture-edge: #444c4a; --home: #23304d;
  --endcap: #5b8bff; --display: #8fb1fb; --shelf: #6f7776; --mailer: #ffc629; --moved: #2bb3a3; --moved-soft: #133a36; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #121514; --surface: #1a1e1d; --ink: #eceeeb; --muted: #9aa19f; --line: #2c3231;
  --floor: #1f2423; --fixture: #2d3332; --fixture-edge: #444c4a; --home: #23304d;
  --endcap: #5b8bff; --display: #8fb1fb; --shelf: #6f7776; --mailer: #ffc629; --moved: #2bb3a3; --moved-soft: #133a36; color-scheme: dark }
html, body { height: 100%; }
body { background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 14px; line-height: 1.5; }
.wrap { padding: 20px 20px 28px; display: grid; gap: 16px; max-width: 1480px; margin: 0 auto; }
header { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px 24px; }
.eyebrow { font-family: var(--mono); font-size: 12px; letter-spacing: .04em; color: var(--muted); }
h1 { margin: 2px 0 0; font-size: 26px; font-weight: 700; letter-spacing: -.01em; text-wrap: balance; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 3px; gap: 3px; }
.seg button { font: 500 13px var(--sans); color: var(--muted); background: none; border: 0; border-radius: 6px; padding: 7px 14px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--ink); color: var(--bg); }
.seg button:focus-visible, .moves button:focus-visible { outline: 2px solid var(--endcap); outline-offset: 2px; }
.main { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
.stage { position: relative; min-width: 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--floor); height: min(72vh, 680px); min-height: 420px; }
#gl { display: block; width: 100%; height: 100%; touch-action: none; }
.hud { position: absolute; left: 12px; bottom: 12px; display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--muted); background: color-mix(in srgb, var(--surface) 88%, transparent); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; max-width: calc(100% - 24px); }
.key { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.sw.ring { background: none; border: 2px solid var(--moved); }
.sw.dot { border-radius: 50%; width: 9px; height: 9px; background: var(--mailer); }
.hint { position: absolute; right: 12px; top: 10px; font-size: 12px; color: var(--muted); }
#tip { position: absolute; pointer-events: none; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 12px; min-width: 200px; box-shadow: 0 6px 20px rgb(0 0 0 / .12); }
#tip b { font-weight: 600; }
#tip table { border-collapse: collapse; margin-top: 4px; font-family: var(--mono); font-variant-numeric: tabular-nums; }
#tip td { padding: 1px 8px 1px 0; }
#tip tr.on td { color: var(--ink); font-weight: 600; } #tip tr td { color: var(--muted); }
aside { display: grid; gap: 14px; min-width: 0; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: grid; gap: 10px; }
.panel h2 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .02em; }
.kpi { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
.kpi div { display: grid; gap: 1px; }
.kpi .v { font-family: var(--mono); font-size: 20px; font-weight: 500; font-variant-numeric: tabular-nums; }
.kpi .l { font-size: 12px; color: var(--muted); }
.note { font-size: 12px; color: var(--muted); margin: 0; }
.note strong { color: var(--ink); font-weight: 600; }
.moves { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; max-height: 360px; overflow: auto; }
.moves button { width: 100%; text-align: left; display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 8px; align-items: center; background: none; border: 0; border-radius: 6px; padding: 6px; font: inherit; color: inherit; cursor: pointer; }
.moves button:hover, .moves button.sel { background: var(--moved-soft); }
.num { font-family: var(--mono); font-size: 12px; font-weight: 500; text-align: center; border-radius: 4px; padding: 1px 0; color: #fff; }
.mv-name { font-size: 12.5px; line-height: 1.3; overflow-wrap: anywhere; }
.mv-path { display: block; font-size: 11.5px; color: var(--muted); }
.gain { font-family: var(--mono); font-size: 12px; font-variant-numeric: tabular-nums; color: var(--muted); }
@media (max-width: 900px) { .main { grid-template-columns: 1fr; } .stage { height: 62vh; } }
@media (max-width: 480px) { .wrap { padding-inline: 16px; } h1 { font-size: 21px; } .hint { display: none; } }
</style>

<div class="wrap">
  <header>
    <div>
      <div class="eyebrow" id="eyebrow"></div>
      <h1 id="h1"></h1>
    </div>
    <div class="seg" role="group" aria-label="배치 선택">
      <button id="b-now" type="button" aria-pressed="false"></button>
      <button id="b-next" type="button" aria-pressed="true">제안 배치</button>
    </div>
  </header>
  <div class="main">
    <div class="stage" id="stage">
      <canvas id="gl" aria-label="매장 3D 배치도"></canvas>
      <div class="hint">드래그 회전 · 휠 확대 · 상자에 마우스</div>
      <div class="hud">
        <span class="key"><span class="sw" style="background:var(--endcap)"></span>앞쪽 엔드캡</span>
        <span class="key"><span class="sw" style="background:var(--display)"></span>기타 진열</span>
        <span class="key"><span class="sw" style="background:var(--shelf)"></span>일반 선반</span>
        <span class="key"><span class="sw dot"></span>전단</span>
        <span class="key"><span class="sw ring"></span>바뀌는 상품</span>
      </div>
      <div id="tip" hidden></div>
    </div>
    <aside>
      <section class="panel">
        <h2 id="kpi-h"></h2>
        <div class="kpi" id="kpi"></div>
        <p class="note" id="kpi-note"></p>
      </section>
      <section class="panel">
        <h2 id="mv-h"></h2>
        <ul class="moves" id="moves"></ul>
        <p class="note">좌표는 템플릿입니다. 통로·부서 비중·진열 자리 수·상품의 현재 위치는 데이터에서 왔습니다.</p>
      </section>
    </aside>
  </div>
</div>

<script src="__THREE__"></script>
<script src="__ORBIT__"></script>
<script>
const D = __DATA__;
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COND_VAR = { A_front_endcap: '--endcap', C_other_display: '--display', none: '--shelf' };
const P = D.plans, cur = P.current, nxt = P.proposed;
const fmt = (x, d = 1) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------------------------------------------------------------- text
$('eyebrow').textContent = `매장 ${D.store} · ${D.category} ${D.products.length}개 · ${D.asOf}주까지 보고 결정 · ${D.weeks[0]}–${D.weeks[1]}주 시뮬레이션`;
$('h1').textContent = `${D.asOf}주 배치 → 제안 배치, ${D.products.filter(p => p.moved).length}개 이동`;
$('b-now').textContent = `${D.asOf}주 배치`;
$('kpi-h').textContent = `같은 손님 · 같은 운, ${D.weeks[0]}–${D.weeks[1]}주`;
$('kpi').innerHTML = [
  [`${fmt(cur.expected_units)} → ${fmt(nxt.expected_units)}`, '기대 판매 방문'],
  [`×${nxt.lift.toFixed(2)}`, `${D.asOf}주 배치 고정 대비`],
  [`+$${fmt(nxt.extra_revenue, 2)}`, '기대 매출 차이'],
  [`${Math.round(nxt.share_of_draws_above_baseline * 100)}%`, '추첨 중 기준선보다 많음'],
].map(([v, l]) => `<div><span class="v">${v}</span><span class="l">${l}</span></div>`).join('');
const V = D.validation;
$('kpi-note').innerHTML = `90% 범위(손님 운) ${fmt(cur.mc_p05, 0)}–${fmt(cur.mc_p95, 0)} → ${fmt(nxt.mc_p05, 0)}–${fmt(nxt.mc_p95, 0)}. 제안 배치의 효과는 시뮬레이션 값입니다.` +
  (V ? ` 이 매장 실제 진열 그대로 돌렸을 때 <strong>실제 ${V.actual} vs 기대 ${fmt(V.expected)}</strong> (90% ${fmt(V.mc_p05, 0)}–${fmt(V.mc_p95, 0)}, 범위 ${V.in_band ? '안' : '밖'}).` : '');
const moved = D.products.filter(p => p.moved).sort((a, b) => b.gain - a.gain);
$('mv-h').textContent = `바뀌는 상품 ${moved.length}개 · 자리 앞쪽 엔드캡 ${D.capacity.A_front_endcap}, 기타 진열 ${D.capacity.C_other_display}`;
$('moves').innerHTML = moved.map(p => `<li><button type="button" data-id="${p.id}">
  <span class="num" style="background:var(${COND_VAR[p.next]});${p.next === 'none' ? 'color:var(--ink)' : ''}">${p.n}</span>
  <span class="mv-name">${p.name} ${p.size}<span class="mv-path">${D.labels[p.now]} → ${D.labels[p.next]}</span></span>
  <span class="gain">${p.gain ? (p.gain > 0 ? '+' : '') + '$' + p.gain.toFixed(2) : '자리 양보'}</span></button></li>`).join('');

// ---------------------------------------------------------------- scene
const canvas = $('gl'), stage = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
camera.position.set(4, 13, 15);
const controls = new THREE.OrbitControls(camera, canvas);
controls.target.set(-12, 0, 0); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 8; controls.maxDistance = 80;
scene.add(new THREE.HemisphereLight(0xffffff, 0x6d736f, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 0.55);
sun.position.set(-14, 30, 18); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 }); scene.add(sun);

const themed = [];   // [material, css var] pairs repainted on theme change
const mat = (v, opts = {}) => { const m = new THREE.MeshStandardMaterial({ roughness: .85, metalness: 0, ...opts }); themed.push([m, v]); return m; };
function box(w, h, d, m, x, y, z) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); o.castShadow = o.receiveShadow = true; scene.add(o); return o;
}
function label(text, { size = 46, color = '--ink', weight = 600, scale = 1.7 } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const f = `${weight} ${size}px "IBM Plex Sans KR", "Noto Sans KR", sans-serif`;
  g.font = f; const w = Math.ceil(g.measureText(text).width) + 16; c.width = w; c.height = size + 16;
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(w / 100 * scale, (size + 16) / 100 * scale, 1);
  s.userData.paint = () => { g.clearRect(0, 0, c.width, c.height); g.font = f; g.fillStyle = css(color); g.textBaseline = 'middle'; g.fillText(text, 8, c.height / 2); tex.needsUpdate = true; };
  s.userData.paint(); scene.add(s); return s;
}

// floor and walls
const W = 44, Dp = 30;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), mat('--floor')); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(W, 22); grid.position.y = .01; grid.material.transparent = true; grid.material.opacity = .12; scene.add(grid);
const wallM = mat('--fixture-edge');
box(W, .6, .3, wallM, 0, 0, -Dp / 2); box(.3, .6, Dp, wallM, -W / 2, 0, 0); box(.3, .6, Dp, wallM, W / 2, 0, 0);
box(W - 8, 1.2, .8, mat('--fixture'), 0, 0, -Dp / 2 + 1.2);
label('매장 뒤 벽면', { size: 34, color: '--muted', weight: 500 }).position.set(-15, 1.8, -Dp / 2 + 1.2);

// aisles
const N = D.aisles.length, x0 = -18.5, step = 37 / (N - 1);
const ax = i => x0 + i * step;
const AW = 2.0, AZ0 = -9.5, AZ1 = 3.0, AH = 1.9;
const fixtureM = mat('--fixture'), homeM = mat('--home');
D.aisles.forEach((a, i) => {
  box(AW, AH, AZ1 - AZ0, a.home ? homeM : fixtureM, ax(i), 0, (AZ0 + AZ1) / 2);
  for (const y of [.95]) box(AW + .24, .04, AZ1 - AZ0 - .1, mat('--fixture-edge'), ax(i), y, (AZ0 + AZ1) / 2);
  box(AW, 1.1, .8, fixtureM, ax(i), 0, AZ0 - .7);                                  // rear end cap
  box(AW, 1.1, .9, mat('--fixture'), ax(i), 0, AZ1 + .75);                           // front end cap
  const l = label(a.name.slice(0, 12), { size: 40 }); l.position.set(ax(i), AH + 1.1, AZ0 + 1.2);
  const s = label(`${Math.round(a.share * 100)}% 매출`, { size: 30, color: '--muted', weight: 500 }); s.position.set(ax(i), AH + .6, AZ0 + 1.2);
});
const home = D.aisles.findIndex(a => a.home);

// front band: displays table, entrance, checkout
const TX0 = -17, TX1 = -3, TZ = 8;
box(TX1 - TX0, .75, 2.2, mat('--fixture'), (TX0 + TX1) / 2, 0, TZ);
label('매장 앞·보조 진열', { size: 34, color: '--muted', weight: 500 }).position.set((TX0 + TX1) / 2, .3, TZ + 1.7);
box(4.5, .08, 2.4, mat('--ink'), -18, 0, Dp / 2 - 1.4);
label('입구', { size: 40 }).position.set(-18, .9, Dp / 2 - 1.4);
for (const x of [6, 10, 14]) box(2.6, 1.0, 1.0, mat('--fixture-edge'), x, 0, 11);
label('계산대', { size: 40 }).position.set(10, 1.9, 11);

// ---------------------------------------------------------------- products
const PW = .62, PH = .9, PD = .22;
function slots(layout) {
  const pos = {}, g = { A_front_endcap: [], C_other_display: [], none: [] };
  D.products.forEach(p => g[layout(p)].push(p));
  const order = [...Array(N).keys()].sort((a, b) => Math.abs(a - home) - Math.abs(b - home));
  g.A_front_endcap.forEach((p, j) => { const i = order[Math.floor(j / 3) % N]; pos[p.id] = [ax(i) - .7 + (j % 3) * .7, 1.1, AZ1 + 1.2 + PD / 2 + .02, 0]; });
  g.C_other_display.forEach((p, j) => { const r = Math.floor(j / 10), c = j % 10; pos[p.id] = [TX0 + .8 + c * 1.4, .75, TZ - .5 + r * 1.0, 0]; });
  g.none.forEach((p, j) => { const lvl = j % 2, col = Math.floor(j / 2); pos[p.id] = [ax(home) + AW / 2 + PD / 2 + .1, [0, .97][lvl] + .02, AZ0 + .6 + col * .9, Math.PI / 2]; });
  return pos;
}
const POS = { now: slots(p => p.now), next: slots(p => p.next) };
const items = D.products.map(p => {
  const m = new THREE.MeshStandardMaterial({ roughness: .6 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, PD), m); mesh.castShadow = true; mesh.userData.p = p; scene.add(mesh);
  const tag = label(String(p.n), { size: 44, weight: 700, scale: 1.3 });
  let ring = null;
  if (p.moved) {
    ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(PW + .14, PH + .14, PD + .14)), new THREE.LineBasicMaterial({ linewidth: 2 }));
    scene.add(ring);
  }
  let dot = null;
  if (p.mailer) { dot = new THREE.Mesh(new THREE.SphereGeometry(.09, 16, 12), new THREE.MeshStandardMaterial()); scene.add(dot); }
  return { p, mesh, tag, ring, dot, from: null, to: null };
});

let state = 'now', t0 = 0, dur = 1600, animating = false;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function place(it, k) {
  const a = it.from, b = it.to, x = a[0] + (b[0] - a[0]) * k, z = a[2] + (b[2] - a[2]) * k;
  const lift = (a[0] !== b[0] || a[2] !== b[2]) ? Math.sin(Math.PI * k) * 2.2 : 0;
  const y = a[1] + (b[1] - a[1]) * k + lift + PH / 2;
  const ry = a[3] + (b[3] - a[3]) * k;
  it.mesh.position.set(x, y, z); it.mesh.rotation.y = ry;
  it.tag.position.set(x, y + PH / 2 + .45, z);
  if (it.ring) { it.ring.position.copy(it.mesh.position); it.ring.rotation.y = ry; }
  if (it.dot) it.dot.position.set(x + .22 * Math.cos(ry), y + PH / 2 + .02, z - .22 * Math.sin(ry));
}
function paintItems(k) {
  for (const it of items) {
    const c = k < .5 ? (state === 'next' ? it.p.now : it.p.next) : (state === 'next' ? it.p.next : it.p.now);
    it.mesh.material.color.set(css(COND_VAR[c]));
  }
}
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function go(target, animate = !reduce) {
  for (const it of items) { it.from = POS[state][it.p.id]; it.to = POS[target][it.p.id]; }
  state = target;
  $('b-now').setAttribute('aria-pressed', target === 'now'); $('b-next').setAttribute('aria-pressed', target === 'next');
  if (animate) { t0 = performance.now(); animating = true; } else { items.forEach(it => place(it, 1)); paintItems(1); animating = false; }
}
$('b-now').onclick = () => state !== 'now' && go('now');
$('b-next').onclick = () => state !== 'next' && go('next');

// ---------------------------------------------------------------- theme
function paintTheme() {
  for (const [m, v] of themed) m.color.set(css(v));
  scene.background = new THREE.Color(css('--floor')); scene.background.lerp(new THREE.Color(css('--bg')), .55);
  grid.material.color.set(css('--muted'));
  scene.traverse(o => o.isSprite && o.userData.paint && o.userData.paint());
  for (const it of items) { if (it.ring) it.ring.material.color.set(css('--moved')); if (it.dot) it.dot.material.color.set(css('--mailer')); }
  paintItems(animating ? 0 : 1);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
new MutationObserver(paintTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---------------------------------------------------------------- hover + list
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $('tip');
let sel = null;
function showTip(p, x, y) {
  const on = state === 'next' ? p.next : p.now;
  tip.innerHTML = `<b>${p.n}. ${p.name} ${p.size}</b><br>${D.asOf}주 ${D.labels[p.now]} → 제안 ${D.labels[p.next]}${p.mailer ? ' · 전단' : ''}
    <table>${['none', 'A_front_endcap', 'C_other_display'].map(o => `<tr class="${o === on ? 'on' : ''}"><td>${D.labels[o]}</td><td>${p.units[o].toFixed(2)}</td></tr>`).join('')}</table>
    <span style="color:var(--muted)">기대 판매 방문, ${D.weeks[0]}–${D.weeks[1]}주</span>`;
  tip.hidden = false;
  const r = stage.getBoundingClientRect();
  tip.style.left = Math.min(x + 14, r.width - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(y + 14, r.height - tip.offsetHeight - 8) + 'px';
}
canvas.addEventListener('pointermove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects(items.map(i => i.mesh))[0];
  if (hit) showTip(hit.object.userData.p, e.clientX - r.left, e.clientY - r.top); else if (!sel) tip.hidden = true;
  canvas.style.cursor = hit ? 'pointer' : 'grab';
});
canvas.addEventListener('pointerleave', () => { if (!sel) tip.hidden = true; });
$('moves').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('.moves button').forEach(x => x.classList.toggle('sel', x === b && sel !== b.dataset.id));
  sel = sel === b.dataset.id ? null : b.dataset.id;
  const it = items.find(i => i.p.id === b.dataset.id);
  if (sel) { controls.target.copy(it.mesh.position); const v = it.mesh.position.clone().project(camera), r = canvas.getBoundingClientRect();
    showTip(it.p, (v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height); } else { controls.target.set(-12, 0, 0); tip.hidden = true; }
});

// ---------------------------------------------------------------- loop
function resize() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(stage);
function frame(now) {
  if (animating) { const k = Math.min(1, (now - t0) / dur); items.forEach(it => place(it, ease(k))); paintItems(k); if (k >= 1) animating = false; }
  const pulse = .55 + .45 * Math.sin(now / 320);
  for (const it of items) if (it.ring) { it.ring.material.opacity = pulse; it.ring.material.transparent = true; it.tag.material.opacity = 1; }
  if (sel) for (const it of items) it.mesh.material.emissive.setScalar(it.p.id === sel ? .25 * pulse : 0);
  else for (const it of items) it.mesh.material.emissive.setScalar(0);
  controls.update(); renderer.render(scene, camera); requestAnimationFrame(frame);
}
resize();
go('now', false); paintTheme();
if (location.hash === '#still') go('next', false);
document.fonts && document.fonts.ready.then(paintTheme);
requestAnimationFrame(frame);
if (location.hash !== '#still') setTimeout(() => go('next'), reduce ? 0 : 700);
</script>
'''

if __name__ == '__main__':
    main()
