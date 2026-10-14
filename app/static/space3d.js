// Any offline space in 3D: a consumer-jev archetype GLB (white model, metres, +Y up) with people walking in it.
// The GLB keeps its node names in userData (fixture id, booth, role, label), so the agent's map edits are applied
// to the real nodes: duplicate (clone + offset), relabel, stations (a tag), remove. People walk on a 0.5 m grid
// around the fixtures from the main door to booth access points and back.
//
// mountSpace(el, { glb, space, ops, people }, opts) -> { ready(), focus(id|null), setPeople(on), dispose() }
// engine plan (x, y) -> three.js (x, 0, -y) on level 0.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const NEW = '#0F766E';
const loader = new GLTFLoader();
let shopperP = null;
const shopper = () => shopperP ??= loader.loadAsync('assets/shopper.glb').catch(() => null);
const rnd = (i, k = 0) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

function rectOf(f, cx = f.cx, cy = f.cy) {
  const turned = Math.round(f.rot || 0) % 180 === 90, w = turned ? f.d : f.w, d = turned ? f.w : f.d;
  return [cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2];
}

// ---------------------------------------------------------------- walking grid (plan view, level 0)
function grid(space) {
  const fl = space.floors.find(f => f.level === 0) || space.floors[0], P = fl.polygon;
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
  const x0 = Math.min(...xs) - 2, y0 = Math.min(...ys) - 3, x1 = Math.max(...xs) + 2, y1 = Math.max(...ys) + .5, c = .5;
  const nx = Math.ceil((x1 - x0) / c), ny = Math.ceil((y1 - y0) / c), block = new Uint8Array(nx * ny);
  const inside = (x, y) => { let r = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) r = !r; } return r; };
  const door = (space.doors.find(d => d.main) || space.doors[0]);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + .5) * c, y = y0 + (j + .5) * c;
    const outsideApron = y < 0 && Math.abs(x - door.x) < door.w / 2 + 1.5 && y > -2.8;   // the strip in front of the main door
    if (!inside(x, y) && !outsideApron) block[j * nx + i] = 1;
  }
  for (const f of space.fixtures) {
    if ((f.level || 0) !== 0 || ['context', 'floor'].includes(f.klass)) continue;
    const [a, b, e, d] = rectOf(f);
    for (let j = Math.max(0, Math.floor((b - .15 - y0) / c)); j <= Math.min(ny - 1, Math.floor((d + .15 - y0) / c)); j++)
      for (let i = Math.max(0, Math.floor((a - .15 - x0) / c)); i <= Math.min(nx - 1, Math.floor((e + .15 - x0) / c)); i++) block[j * nx + i] = 1;
  }
  const cell = (x, y) => [Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / c))), Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / c)))];
  const free = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && !block[j * nx + i];
  function nearestFree([i, j]) {
    for (let r = 0; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (free(i + di, j + dj)) return [i + di, j + dj];
    return [i, j];
  }
  const cache = new Map();
  function path(ax, ay, bx, by) {
    const s = nearestFree(cell(ax, ay)), t = nearestFree(cell(bx, by)), key = `${s}|${t}`;
    if (cache.has(key)) return cache.get(key);
    const N = nx * ny, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), open = [[0, s[1] * nx + s[0]]];
    g[s[1] * nx + s[0]] = 0; const goal = t[1] * nx + t[0];
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [, cur] = open.splice(bi, 1)[0]; if (cur === goal) break;
      const ci = cur % nx, cj = (cur - ci) / nx;
      for (const [di, dj, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [-1, -1, 1.41]]) {
        const ni = ci + di, nj = cj + dj; if (!free(ni, nj) || (di && dj && (!free(ci + di, cj) || !free(ci, cj + dj)))) continue;
        const k = nj * nx + ni, ng = g[cur] + w;
        if (ng < g[k]) { g[k] = ng; came[k] = cur; open.push([ng + Math.hypot(ni - t[0], nj - t[1]), k]); }
      }
    }
    const pts = []; let k = goal;
    if (came[k] < 0 && k !== s[1] * nx + s[0]) { const r = [[ax, ay], [bx, by]]; cache.set(key, r); return r; }
    while (k >= 0) { const i = k % nx, j = (k - i) / nx; pts.push([x0 + (i + .5) * c, y0 + (j + .5) * c]); k = came[k]; }
    pts.reverse();
    const simple = pts.filter((p, n) => n === 0 || n === pts.length - 1 || n % 3 === 0);   // fewer turns, smoother walk
    cache.set(key, simple); return simple;
  }
  return { path };
}

export function mountSpace(el, data, opts = {}) {
  const { space, ops = [], people = null } = data;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.02;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#e9ecec');
  const pmrem = new THREE.PMREMGenerator(renderer), env = new RoomEnvironment();
  scene.environment = pmrem.fromScene(env, .04).texture; scene.environmentIntensity = .5; env.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#f6f8ff', '#c3c9c0', 1.15));
  const fl = space.floors.find(f => f.level === 0) || space.floors[0];
  const xs = fl.polygon.map(p => p[0]), ys = fl.polygon.map(p => p[1]);
  const W = Math.max(...xs) - Math.min(...xs), D = Math.max(...ys) - Math.min(...ys), cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const R = Math.max(W, D);
  const sun = new THREE.DirectionalLight('#fff4e2', 2.4); sun.position.set(cx - R * .5, R * 1.1, -cy + R * .7); sun.target.position.set(cx, 0, -cy);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004;
  Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: R * 4 }); scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#dfeaff', .8); fill.position.set(cx + R, R * .5, -cy - R * .4); scene.add(fill);

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: .08, minPolarAngle: .3, maxPolarAngle: Math.PI / 2.3, minZoom: .5, maxZoom: 8, screenSpacePanning: true });
  const target = new THREE.Vector3(cx, 0, -cy), dir = new THREE.Vector3(-.8, 1.05, 1.0).normalize();
  controls.target.copy(target); camera.position.copy(target).addScaledVector(dir, R * 3);
  // a freshly built space turns slowly on its vertical axis until the person grabs it
  const spinOk = opts.spin && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  Object.assign(controls, { autoRotate: !!spinOk, autoRotateSpeed: 1.6 });
  controls.addEventListener('start', () => { controls.autoRotate = false; });
  function frustum(a) {
    const half = R * .5;
    Object.assign(camera, a > 1.2 ? { left: -half * a / 1.2, right: half * a / 1.2, top: half / 1.2, bottom: -half / 1.2 } : { left: -half, right: half, top: half / a, bottom: -half / a });
    camera.updateProjectionMatrix();
  }
  function resize() {
    const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false);
    const half = R * .5, a = w / h;
    Object.assign(camera, a > 1.2 ? { left: -half * a / 1.2, right: half * a / 1.2, top: half / 1.2, bottom: -half / 1.2 } : { left: -half, right: half, top: half / a, bottom: -half / a });
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(el); resize();

  // ---------------------------------------------------------------- the space
  const root = new THREE.Group(); scene.add(root);
  const marks = [], labels = new Map();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(R * 6, R * 6), new THREE.ShadowMaterial({ opacity: .12 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -.02, -cy); ground.receiveShadow = true; root.add(ground);
  // labels are HTML (crisp at any zoom, same look as the hover card), pinned to a 3D point and re-placed every frame;
  // when two collide the less important one steps aside
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  const tags = [];
  function tag(text, kind = 'booth') {
    const o = new THREE.Object3D(), d = document.createElement('div');
    d.className = `s3-lab s3-lab-${kind}`; d.innerHTML = `<i></i>${text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}`;
    el.appendChild(d); o.userData.el = d; o.userData.pri = kind === 'booth' ? 1 : 2; tags.push(o); return o;
  }
  const tagV = new THREE.Vector3();
  function placeTags() {
    const w = el.clientWidth, h = el.clientHeight, placed = [];
    for (const o of [...tags].sort((a, b) => b.userData.pri - a.userData.pri)) {
      const d = o.userData.el; o.getWorldPosition(tagV).project(camera);
      if (!o.userData.sz?.[0]) o.userData.sz = [d.offsetWidth, d.offsetHeight];   // measure once; reading layout every frame would thrash
      const x = (tagV.x + 1) / 2 * w, y = (1 - tagV.y) / 2 * h, [ww, hh] = o.userData.sz;
      const r = [x - ww / 2, y - hh, x + ww / 2, y];
      const hit = tagV.z > 1 || r[0] < 0 || r[2] > w || r[1] < 0 || r[3] > h || placed.some(q => !(r[2] + 4 < q[0] || q[2] + 4 < r[0] || r[3] + 3 < q[1] || q[3] + 3 < r[1]));
      d.classList.toggle('off', hit);
      if (!hit) { placed.push(r); d.style.transform = `translate(${r[0].toFixed(1)}px, ${r[1].toFixed(1)}px)`; }
    }
  }
  function mark(box, color) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .32, depthWrite: false }));
    const s = new THREE.Vector3(), c = new THREE.Vector3(); box.getSize(s); box.getCenter(c);
    m.scale.set(s.x + .3, s.y + .2, s.z + .3); m.position.copy(c); m.renderOrder = 9; root.add(m); marks.push(m); return m;
  }
  let model = null;
  const fixtureNode = id => { let n = null; model?.traverse(o => { if (!n && o.userData?.fixture === id && String(o.userData?.name || '').startsWith('fixture:')) n = o; }); return n; };

  const ready = loader.loadAsync(data.glb).then(g => {
    if (!alive) return;
    model = g.scene; root.add(model);
    const near = Math.min(W, D) * .32;
    model.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      const nm = String(o.userData?.name || '');
      if (nm.startsWith('wall:')) {          // lower the walls between the camera and the room so the inside reads
        const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
        if (c.x < cx - W / 2 + near || -c.z < cy - D / 2 + near) o.scale.y *= .28;
      }
    });
    model.updateMatrixWorld(true);
    // the agent's edits, on the real nodes
    for (const op of ops) {
      const n = fixtureNode(op.id); if (!n) continue;
      if (op.op === 'duplicate') {
        const c = n.clone(true); c.userData = { ...n.userData, __clone: op.new_id }; c.position.x += op.dx; c.position.z -= op.dy; n.parent.add(c); c.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(c); mark(b, NEW);
        const t = tag(`새로 놓음 · ${op.label}`, 'new'); t.position.set((b.min.x + b.max.x) / 2, b.max.y + .9, (b.min.z + b.max.z) / 2); root.add(t); labels.set(op.new_id, t);
      } else if (op.op === 'remove') { n.visible = false; }
      else if (op.op === 'move') {
        n.position.x += op.dx; n.position.z -= op.dy; n.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(n); mark(b, NEW);
        const t = tag(`옮김 · ${op.label}`, 'new'); t.position.set((b.min.x + b.max.x) / 2, b.max.y + .9, (b.min.z + b.max.z) / 2); root.add(t); labels.set(op.id, t);
      }
      else {
        const b = new THREE.Box3().setFromObject(n); mark(b, op.op === 'relabel' ? '#3B73FF' : NEW);
        const txt = op.op === 'relabel' ? op.label : `계산 자리 ${op.from} → ${op.to}`;
        const t = tag(txt, op.op === 'relabel' ? 'promo' : 'new'); t.position.set((b.min.x + b.max.x) / 2, b.max.y + .9, (b.min.z + b.max.z) / 2); root.add(t); labels.set(op.id, t);
      }
    }
    // booth names (small, grey), skipped where an edit already put a tag
    for (const b of Object.values(space.booths || {})) {
      if ((b.level || 0) !== 0 || !b.anchor || (b.fixtures || []).some(id => labels.has(id))) continue;
      const t = tag(b.label || b.id, 'booth'); t.position.set(b.anchor[0], 2.4, -b.anchor[1]); root.add(t);
    }
    if (people && opts.people !== false) addPeople();
  });

  // ---------------------------------------------------------------- hover card (after the 21st.dev contribution-skyline:
  // the object lifts a little and gets a dark outline, a dark card with an arrow rides it through orbit; tap/click pins, Esc clears)
  const KIND = { display: '진열대', bench: '벤치', booth: '부스', table_set: '테이블 · 의자', gondola: '곤돌라 진열대', wallshelf: '벽면 선반', partition: '가벽',
    photo: '포토존', checkout: '계산대', endcap: '엔드캡 진열대', stall: '판매대', barricade: '바리케이드', tent: '텐트', stanchion: '줄 서기 펜스', pillar: '기둥',
    workstation: '작업대', counter: '카운터', room: '방', sign: '안내판', rack: '행거', pickup: '픽업대', robot: '로봇', toilet: '화장실', trash: '쓰레기통',
    chiller: '냉장 쇼케이스', cafe_counter: '카페 카운터', patch: '바닥 표시', stage: '무대', freezer: '냉동고', conveyor: '컨베이어', gate: '게이트', machine: '기계', planter: '화분' };
  const ROLE = { pick: '손님이 상품을 고르는 곳', seat: '앉아 머무는 곳', browse: '둘러보는 곳', service: '안내 · 체험', shop: '사는 곳', checkout: '계산하는 곳',
    order: '주문하는 곳', work: '작업하는 곳', pickup: '받아 가는 곳' };
  const fx = new Map(space.fixtures.map(f => [f.id, f]));
  const boothOf = id => Object.values(space.booths || {}).find(b => (b.fixtures || []).includes(id));
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  const card = document.createElement('div'); card.className = 's3-tip'; card.setAttribute('role', 'tooltip'); el.appendChild(card);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const outline = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#171717')); outline.visible = false; outline.renderOrder = 12;
  outline.material.depthTest = false; outline.material.transparent = true; root.add(outline);
  let hov = null, pin = null, lifted = null, liftY = 0, down = null;
  const fixtureOf = o => { while (o && o !== model) { if (String(o.userData?.name || '').startsWith('fixture:')) return o; o = o.parent; } return null; };
  function pick(ev) {
    if (!model) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const h of ray.intersectObject(model, true)) { const f = fixtureOf(h.object); if (f && f.visible && f.userData.klass !== 'context') return f; }
    return null;
  }
  function describe(n) {
    const id = n.userData.fixture, cloneOf = ops.find(o => o.new_id && n.userData.__clone === o.new_id);
    const f = fx.get(id) || {}, op = cloneOf || ops.find(o => o.id === id && o.op !== 'duplicate');
    const b = boothOf(id), name = cloneOf ? cloneOf.label : (op?.op === 'relabel' ? op.label : f.label || KIND[n.userData.kind] || id);
    const size = f.w ? `${f.w}×${f.d}${f.h ? '×' + f.h : ''} m` : '';
    const st = op?.op === 'stations' ? `계산 자리 ${op.from} → ${op.to}` : f.params?.stations ? `계산 자리 ${f.params.stations}` : '';
    const rows = [`<b>${esc(name)}</b>`, `<span>${esc([KIND[f.kind || n.userData.kind] || f.kind, size].filter(Boolean).join(' · '))}</span>`];
    if (b || f.role) rows.push(`<span>${esc([b?.label, ROLE[f.role || b?.role]].filter(Boolean).join(' · '))}</span>`);
    if (f.tiers || st) rows.push(`<span>${esc([f.tiers ? `선반 ${f.tiers}단` : '', st].filter(Boolean).join(' · '))}</span>`);
    if (cloneOf || op) rows.push(`<em>에이전트 · ${esc((cloneOf || op).why)}</em>`);
    return rows.join('');
  }
  function setActive(n) {
    if (n === (lifted && lifted.n)) return;
    if (lifted) lifted.n.position.y = lifted.y;
    lifted = n ? { n, y: n.position.y } : null; liftY = 0;
    if (n) { card.innerHTML = describe(n); card.classList.add('on'); outline.visible = true; } else { card.classList.remove('on'); outline.visible = false; }
    renderer.domElement.style.cursor = n ? 'pointer' : 'grab';
  }
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cv = renderer.domElement;
  cv.addEventListener('pointermove', ev => {
    if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5) down = null;
    if (ev.pointerType !== 'mouse' || ev.buttons) return;
    hov = pick(ev); setActive(hov || pin);
  });
  cv.addEventListener('pointerdown', ev => { down = [ev.clientX, ev.clientY]; });
  cv.addEventListener('pointerup', ev => { if (!down) return; down = null; const n = pick(ev); pin = n && n !== pin ? n : null; if (ev.pointerType !== 'mouse') hov = null; setActive(hov || pin); });
  cv.addEventListener('pointerleave', () => { hov = null; setActive(pin); });
  const onKey = ev => { if (ev.key === 'Escape') { pin = hov = null; setActive(null); } };
  addEventListener('keydown', onKey);
  const tmpBox = new THREE.Box3(), tmpV = new THREE.Vector3();
  function rideCard() {
    if (!lifted) return;
    liftY += (.14 - liftY) * .25; lifted.n.position.y = lifted.y + liftY;
    tmpBox.setFromObject(lifted.n); outline.box.copy(tmpBox).expandByScalar(.04);
    tmpV.set((tmpBox.min.x + tmpBox.max.x) / 2, tmpBox.max.y, (tmpBox.min.z + tmpBox.max.z) / 2).project(camera);
    const w = el.clientWidth, h = el.clientHeight, x = (tmpV.x + 1) / 2 * w, y = (1 - tmpV.y) / 2 * h;
    const half = card.offsetWidth / 2, cx = Math.min(w - half - 6, Math.max(half + 6, x));
    card.style.transform = `translate(${(cx - half).toFixed(1)}px, ${(y - 10).toFixed(1)}px) translateY(-100%)`;
    card.style.setProperty('--arrow', `${(x - cx + half).toFixed(1)}px`);
  }

  // ---------------------------------------------------------------- people
  const walkers = []; let G = null;
  function pickTarget(k) {
    const T = people.targets.filter(t => (t.level || 0) === 0); if (!T.length) return null;
    const tot = T.reduce((s, t) => s + t.w, 0); let r = rnd(k, 3) * tot;
    for (const t of T) { r -= t.w; if (r <= 0) return t; } return T[T.length - 1];
  }
  function trip(k) {
    const [ex, ey] = people.entrance, a = pickTarget(k), b = pickTarget(k + 17);
    const pay = people.targets.find(t => t.role === 'checkout' || t.role === 'order');
    const legs = [[ex, ey - 2.2], [ex, ey + .6], a?.at, b && rnd(k, 4) > .5 ? b.at : null, pay && rnd(k, 5) > .3 ? pay.at : null, [ex, ey + .6], [ex, ey - 2.4]].filter(Boolean);
    const pts = [];
    for (let i = 0; i < legs.length - 1; i++) {
      const seg = G.path(legs[i][0], legs[i][1], legs[i + 1][0], legs[i + 1][1]);
      seg.forEach((p, n) => { if (n || !i) pts.push([p[0], p[1], 'Walk', 0]); });
      const stop = legs[i + 1];
      if (stop === a?.at || stop === b?.at) pts.push([pts.at(-1)[0], pts.at(-1)[1], 'Browse', 1.5 + rnd(k + i, 6) * 2.5]);
      if (stop === pay?.at) pts.push([pts.at(-1)[0], pts.at(-1)[1], 'Pay', 1.6]);
    }
    return pts;
  }
  function addPeople() {
    shopper().then(asset => {
      if (!asset || !alive) return;
      G = grid(space);
      const colors = ['#496077', '#954f51', '#657851', '#806488', '#337477', '#9d873e', '#6a6b79'], skins = ['#cfa281', '#b88668', '#d8ae8a', '#b78a70'];
      const n = Math.min(people.count, opts.maxPeople || 40);
      for (let k = 0; k < n; k++) {
        const r = cloneSkinned(asset.scene);
        r.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.material = o.material.clone();
          if (o.material.name === 'Outerwear') o.material.color.set(colors[k % colors.length]);
          if (o.material.name === 'Skin') o.material.color.set(skins[k % skins.length]);
          if (o.material.name === 'Trousers') o.material.color.set(k % 3 === 0 ? '#b9ae97' : '#323d4d'); });
        r.scale.setScalar(.95 + (k % 4) * .03);
        const mixer = new THREE.AnimationMixer(r), acts = Object.fromEntries(asset.animations.map(c => [c.name, mixer.clipAction(c)]));
        const w = { root: r, mixer, acts, cur: null, k, path: trip(k), seg: 0, t: 0, wait: 0 };
        w.seg = Math.floor(rnd(k, 11) * Math.max(1, w.path.length - 2));
        root.add(r); walkers.push(w);
      }
    });
  }
  function play(w, name) {
    if (w.cur === name) return; const a = w.acts[name] || w.acts.Walk; if (!a) return;
    a.reset().play(); if (w.acts[w.cur]) w.acts[w.cur].crossFadeTo(a, .25, false); w.cur = name;
  }
  function walk(dt) {
    for (const w of walkers) {
      const P = w.path; if (w.seg >= P.length - 1) { w.k += 31; w.path = trip(w.k); w.seg = 0; w.t = 0; continue; }
      const a = P[w.seg], b = P[w.seg + 1];
      if (b[3] && b[0] === a[0] && b[1] === a[1]) { w.wait += dt; play(w, b[2]); w.mixer.update(dt); if (w.wait > b[3]) { w.seg++; w.wait = 0; } continue; }
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || .001;
      w.t += dt * 1.1 / len; if (w.t >= 1) { w.seg++; w.t = 0; continue; }
      w.root.position.set(a[0] + dx * w.t, 0, -(a[1] + dy * w.t)); w.root.rotation.y = Math.atan2(dx, -dy);
      play(w, 'Walk'); w.mixer.update(dt);
    }
  }

  // ---------------------------------------------------------------- loop
  let alive = true, last = performance.now(), boost = 1;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // one highlighted fixture (a plan's spot) for the cards
  const hl = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#8bd34f', transparent: true, opacity: .5, depthWrite: false }));
  hl.visible = false; hl.renderOrder = 10; root.add(hl);
  function setHighlight(id) {
    const n = id && fixtureNode(id); hl.visible = !!n; if (!n) return;
    const b = new THREE.Box3().setFromObject(n), sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    hl.scale.set(sz.x + .5, sz.y + .3, sz.z + .5); hl.position.copy(c);
  }
  function update(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const pulse = .22 + .14 * Math.sin(now / 350); marks.forEach(m => { m.material.opacity = pulse; });
    if (!reduce) walk(dt * (opts.speed ?? 6) * boost);   // time-lapse, like the store views
    if (opts.manual) return;
    placeTags(); rideCard();
    controls.update(); renderer.render(scene, camera);
  }
  function frame(now) { if (!alive) return; update(now); requestAnimationFrame(frame); }
  if (!opts.manual) requestAnimationFrame(frame);
  return {
    advance(now) { update(now); },
    pace(b) { boost = b; },
    spin(on) { controls.autoRotate = !!on; },
    setHighlight,
    drawInto(ctx, w, h, card) {
      setHighlight(card.fx);
      if (renderer.domElement.width !== w || renderer.domElement.height !== h) { renderer.setPixelRatio(1); renderer.setSize(w, h, false); }
      frustum(w / h); controls.update(); renderer.render(scene, camera); ctx.drawImage(renderer.domElement, 0, 0, w, h);
    },
    ready: () => ready,
    focus(id) {
      const n = id && (fixtureNode(id) || null);
      if (!n) { controls.target.copy(target); camera.zoom = 1; camera.updateProjectionMatrix(); return; }
      const b = new THREE.Box3().setFromObject(n), c = b.getCenter(new THREE.Vector3());
      controls.target.copy(c); camera.position.copy(c).addScaledVector(dir, R * 3); camera.zoom = 2.2; camera.updateProjectionMatrix();
    },
    shot(w = 960, h = 540) { update(performance.now()); renderer.setSize(w, h, false); renderer.render(scene, camera); const u = renderer.domElement.toDataURL('image/jpeg', .86); resize(); return u; },
    dispose() { alive = false; ro.disconnect(); removeEventListener('keydown', onKey); card.remove(); tags.forEach(t => t.userData.el.remove()); walkers.forEach(w => w.mixer.stopAllAction()); renderer.dispose(); el.removeChild(renderer.domElement); },
  };
}

// Live cards for a space: one off-screen scene drawn in turn into every visible card canvas, each card highlighting
// its own plan's fixture. Same contract as store3d.liveCards: run() speeds people up, stop() freezes the frame.
export function spaceCards(data, cards, opts = {}) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:300px';
  document.body.appendChild(host);
  const s3 = mountSpace(host, data, { manual: true, maxPeople: 30 });
  const dpr = Math.min(devicePixelRatio || 1, 2), seen = new Set();
  const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? seen.add(e.target) : seen.delete(e.target)), { rootMargin: '80px' });
  cards.forEach(c => io.observe(c.canvas));
  let alive = true, turn = 0, running = false, freezeAt = opts.paused ? performance.now() + 2500 : Infinity;
  const draw = c => { const r = c.canvas.getBoundingClientRect(), w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (c.canvas.width !== w || c.canvas.height !== h) { c.canvas.width = w; c.canvas.height = h; } s3.drawInto(c.canvas.getContext('2d'), w, h, c); };
  function frame(now) {
    if (!alive) return;
    if (now >= freezeAt) { freezeAt = Infinity; cards.forEach(draw); running = false; return; }
    s3.advance(now);
    const vis = cards.filter(c => seen.has(c.canvas));
    for (let k = 0; k < Math.min(3, vis.length); k++) draw(vis[(turn + k) % vis.length]);
    turn += 3; requestAnimationFrame(frame);
  }
  const start = () => { if (alive && !running) { running = true; requestAnimationFrame(frame); } };
  s3.ready().then(() => setTimeout(start, 600));
  return {
    run() { freezeAt = Infinity; s3.pace(4); start(); },
    stop() { s3.pace(1); freezeAt = performance.now(); },
    dispose() { alive = false; io.disconnect(); s3.dispose(); host.remove(); },
  };
}
