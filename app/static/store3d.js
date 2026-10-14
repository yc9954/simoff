// The store in 3D, in meters. Same look as gs2500 (same team): white store, soft sun, room environment,
// the gs2500 shopper and checkout-terminal models. The data has no floor plan, so positions are a template;
// the aisles (department and sales share), the display slots and where each cereal sits come from data.
//
// mountStore(el, data, opts) -> { go(state, animate), select(id), focus(name), dispose(), get state() }
// data: { aisles:[{department|name, sales_share|share, category_home|home}], products:[{n,id,name,size,now,next,moved,mailer,units}] }
// opts: { state:'now'|'next', shoppers:n, onHover(p|null,x,y,state), view:'store'|'cereal', rings:true }
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const COND = { A_front_endcap: '#3B73FF', C_other_display: '#88ACFA', none: '#9aa3a6', B_mailer_only: '#FCBB00' };
const MOVED = '#0F766E';
const W = 36, D = 24;                       // store footprint, meters
const ZB = -8, ZF = 4, GL = ZF - ZB;        // gondola run, back to front
const GW = 1.15, GH = 1.85;                 // gondola width and height
const SHELF_Y = [.16, .58, 1.0, 1.42];      // shelf decks

let assets = null;
function loadAssets() {
  if (!assets) {
    const loader = new GLTFLoader();
    assets = Promise.all([loader.loadAsync('assets/shopper.glb'), loader.loadAsync('assets/checkout-terminal.glb')])
      .then(([shopper, terminal]) => ({ shopper, terminal }))
      .catch(() => ({ shopper: null, terminal: null }));
  }
  return assets;
}

// deterministic noise so every visit to the page draws the same store
const rnd = (i, k = 0) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

export function mountStore(el, data, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.02;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e9ecec');
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new RoomEnvironment();
  scene.environment = pmrem.fromScene(env, .04).texture; scene.environmentIntensity = .5;
  env.dispose(); pmrem.dispose();

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .08;
  controls.minPolarAngle = .35; controls.maxPolarAngle = Math.PI / 2.4;
  controls.minZoom = .7; controls.maxZoom = 6; controls.screenSpacePanning = true;
  const VIEWS = {
    store: { target: new THREE.Vector3(-.5, 0, .5), dir: new THREE.Vector3(-.78, 1.0, 1.0), zoom: 1 },
    cereal: { target: new THREE.Vector3(-12.5, .8, 3.2), dir: new THREE.Vector3(-1.0, .85, .95), zoom: 2.3 },
    plan: { target: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(0, 1, .02), zoom: .95 },
    card: { target: new THREE.Vector3(-4, 0, 2), dir: new THREE.Vector3(-.78, 1.0, 1.0), zoom: 1.25 },
  };
  let view = VIEWS[opts.view || 'store'];
  const placeCamera = (v) => { controls.target.copy(v.target); camera.position.copy(v.target).addScaledVector(v.dir.clone().normalize(), 60); camera.zoom = v.zoom; camera.updateProjectionMatrix(); };
  placeCamera(view);

  scene.add(new THREE.HemisphereLight('#f6f8ff', '#c3c9c0', 1.15));
  const sun = new THREE.DirectionalLight('#fff4e2', 2.5); sun.position.set(-14, 26, 16);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 20, bottom: -20, near: 1, far: 80 });
  sun.shadow.normalBias = .03; sun.shadow.bias = -.0002; sun.shadow.radius = 3; scene.add(sun);
  const fill = new THREE.DirectionalLight('#dfeaff', .9); fill.position.set(16, 10, -8); scene.add(fill);

  // ---------------------------------------------------------------- materials and helpers
  const mats = new Map();
  const mat = (color, o = {}) => { const k = color + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: .62, metalness: .03, ...o })); return mats.get(k); };
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const root = new THREE.Group(); scene.add(root);
  function box(size, pos, color, o = {}, parent = root) {
    const m = new THREE.Mesh(o.round ? new RoundedBoxGeometry(...size, 2, o.round) : unit, typeof color === 'string' ? mat(color, o.m || {}) : color);
    if (!o.round) m.scale.set(...size);
    m.position.set(...pos); m.castShadow = o.cast !== false; m.receiveShadow = true; parent.add(m); return m;
  }
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  const FONT = '"Instrument Sans", Pretendard, "Noto Sans KR", Arial, sans-serif';
  function sign(text, sub, w, h, pos, rotY = 0, bg = '#ffffff', fg = '#16191a', parent = root) {
    const t = canvasTex(1024, Math.round(1024 * h / w), (g, cw, ch) => {
      g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 ${Math.round(ch * (sub ? .42 : .55))}px ${FONT}`; g.fillText(text, cw / 2, ch * (sub ? .4 : .52), cw * .92);
      if (sub) { g.globalAlpha = .62; g.font = `500 ${Math.round(ch * .24)}px ${FONT}`; g.fillText(sub, cw / 2, ch * .78, cw * .9); }
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, toneMapped: false, side: THREE.DoubleSide }));
    m.position.set(...pos); m.rotation.y = rotY; parent.add(m); return m;
  }

  // ---------------------------------------------------------------- shell: floor, walls, storefront
  box([W + .8, .4, D + .8], [0, -.2, 0], '#bfc7bf', { round: .06 });
  const floorTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#e4e4de'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 150 + Math.floor(rnd(i, 1) * 70); g.fillStyle = `rgba(${v},${v},${v},.07)`; g.fillRect(rnd(i, 2) * w, rnd(i, 3) * h, 2, 2); }
    g.strokeStyle = '#c9cac4'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(W / 1.2, D / 1.2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: .42, metalness: .04 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = .005; floor.receiveShadow = true; root.add(floor);
  const wallC = '#eef0ec', H = 3.6;
  box([W, H, .2], [0, H / 2, -D / 2], wallC);
  box([.2, H, D], [W / 2, H / 2, 0], '#e3e7e4');                                                // far side wall
  box([.2, .55, D], [-W / 2, .275, 0], '#e3e7e4');                                              // near side: cut away
  box([W, .22, .24], [0, H - .2, -D / 2 + .14], '#2e6f8e', { cast: false });                    // brand band
  box([.24, .22, D], [W / 2 - .14, H - .2, 0], '#2e6f8e', { cast: false });
  sign('FRESH · DAIRY · FROZEN', null, 7, .5, [-6, H - .62, -D / 2 + .12], 0, '#f5f8f6', '#2e6f8e');
  // storefront glass (front, z = +D/2) with an entrance gap on the left
  const glass = new THREE.MeshPhysicalMaterial({ color: '#d7eaee', roughness: .05, metalness: 0, transparent: true, opacity: .16, depthWrite: false });
  const ENTRY = [-15.5, -11.5];
  for (const [a, b] of [[-W / 2, ENTRY[0]], [ENTRY[1], W / 2]]) {
    const m = new THREE.Mesh(unit, glass); m.scale.set(b - a, 2.4, .05); m.position.set((a + b) / 2, 1.3, D / 2 - .05); root.add(m);
    for (let x = a; x <= b + .01; x += 3.0) box([.05, 2.5, .06], [x, 1.25, D / 2 - .05], '#b4bec0', { m: { metalness: .6, roughness: .3 }, cast: false });
    box([b - a, .08, .08], [(a + b) / 2, 2.5, D / 2 - .05], '#b4bec0', { m: { metalness: .6, roughness: .3 }, cast: false });
  }
  box([ENTRY[1] - ENTRY[0], .02, 2.2], [(ENTRY[0] + ENTRY[1]) / 2, .012, D / 2 - 1.2], '#7d8587', { cast: false });   // entrance mat
  sign('입구', null, 1.6, .5, [(ENTRY[0] + ENTRY[1]) / 2, 2.95, D / 2 - .05], 0, '#2e6f8e', '#ffffff');

  // weekly flyer stand by the entrance: the mailer reaches people here and at home
  const FLY = [-10.4, D / 2 - 2.6];
  box([.9, 1.2, .5], [FLY[0], .6, FLY[1]], '#e9ecea', { round: .03 });
  for (let i = 0; i < 3; i++) { const f = box([.26, .36, .02], [FLY[0] - .28 + i * .28, 1.05, FLY[1] + .26], '#FCBB00', { cast: false }); f.rotation.x = -.25; }
  sign('이번 주 전단', null, 1.1, .3, [FLY[0], 1.5, FLY[1] + .27], 0, '#FCBB00', '#16191a');

  // back wall: glass-door coolers
  const coolerN = 13, coolerW = (W - 4) / coolerN;
  for (let i = 0; i < coolerN; i++) {
    const x = -W / 2 + 2 + coolerW * (i + .5), z = -D / 2 + .75;
    box([coolerW - .04, 2.3, 1.2], [x, 1.15, z], '#f4f5f4');
    const lit = new THREE.Mesh(unit, new THREE.MeshStandardMaterial({ color: '#f2f7fa', emissive: '#eaf3ff', emissiveIntensity: .55, roughness: .4 }));
    lit.scale.set(coolerW - .22, 1.9, .05); lit.position.set(x, 1.2, z + .58); root.add(lit);
    for (let s = 0; s < 5; s++) for (let k = 0; k < 6; k++) {
      const c = ['#f5f1e6', '#e3edf3', '#f3d9c8', '#d7e7d2', '#f7e6a5', '#e9d1dc'][(i + s + k) % 6];
      box([.14, .26, .14], [x - coolerW / 2 + .22 + k * (coolerW - .3) / 6, .42 + s * .38, z + .45], c, { cast: false });
    }
    const door = new THREE.Mesh(unit, glass); door.scale.set(coolerW - .1, 2.0, .04); door.position.set(x, 1.2, z + .62); root.add(door);
    box([.04, 2.0, .06], [x - coolerW / 2 + .04, 1.2, z + .63], '#b9c2c4', { m: { metalness: .7, roughness: .25 }, cast: false });
  }

  // ---------------------------------------------------------------- aisles by department
  const aisles = data.aisles.map(a => ({ name: a.department ?? a.name, share: a.sales_share ?? a.share, home: a.category_home ?? a.home }));
  const N = aisles.length, X0 = -13.5, X1 = 10.5, step = (X1 - X0) / Math.max(N - 1, 1);
  const ax = i => X0 + i * step;
  const home = Math.max(0, aisles.findIndex(a => a.home));
  const goods = [];                       // instanced shelf goods: [x,y,z,w,h,d,color]
  const palette = {
    GROCERY: ['#c8463c', '#e2a33c', '#3e6fae', '#f1ebe0', '#6e8f4e', '#d36f2f', '#8a5a3b', '#e9d6a6'],
    'DRUG GM': ['#e9eef3', '#5d8fc9', '#b7d4e6', '#f2f2f2', '#7aa6c9', '#d9e4ec'],
    PRODUCE: ['#6aa84f', '#c0392b', '#f1c232', '#e69138', '#93c47d', '#a64d79'],
    MEAT: ['#c0605a', '#d98880', '#b04a4a', '#e6b0aa'], 'MEAT-PCKGD': ['#d47c6a', '#e6b8a2', '#b85c4c', '#f0d2c4'],
    DELI: ['#e8c07a', '#d9a066', '#f3e2c0', '#c98c5a'], NUTRITION: ['#4f7a5e', '#9bbf8a', '#e8efe2', '#c9a35b'],
    FUEL: ['#3c3c3c', '#c9302c', '#e8e8e8'], KIOSK: ['#e2e2e2', '#3e6fae'],
  };
  const pal = name => palette[String(name).toUpperCase()] || ['#d9dcdc', '#b9c3c8', '#e6d3b3', '#9db1a4', '#e7e2d6', '#c7b9a5'];
  function gondola(x, name, isHome) {
    box([GW, .12, GL], [x, .06, (ZB + ZF) / 2], '#cfd4d1');
    box([.06, GH, GL], [x, GH / 2 + .06, (ZB + ZF) / 2], '#e9ecea');
    for (const y of SHELF_Y) box([GW, .03, GL], [x, y, (ZB + ZF) / 2], '#f2f3f1', { cast: false });
    for (const y of SHELF_Y) for (const s of [-1, 1]) box([.02, .05, GL], [x + s * GW / 2, y + .03, (ZB + ZF) / 2], '#cbd2d4', { cast: false });   // price rails
    const p = pal(name);
    SHELF_Y.forEach((y, li) => {
      for (const side of [-1, 1]) {
        let z = ZB + .1;
        while (z < ZF - .15) {
          if (isHome && side === -1 && z > ZF - 4.6 && li >= 0) { z += .2; continue; }    // leave the cereal section free
          const k = Math.floor(rnd(x * 7 + z * 13, li * 3 + side) * p.length);
          const w = .14 + rnd(z, li + 9) * .2, h = .2 + rnd(z, li + 4) * .2, d = .3;
          const facings = 1 + Math.floor(rnd(z, li + 2) * 3);
          for (let f = 0; f < facings && z < ZF - .15; f++) { goods.push([x + side * (GW / 2 - d / 2 - .03), y + .015 + h / 2, z + w / 2, d, h, w, p[k]]); z += w + .01; }
          z += .04;
        }
      }
    });
    box([GW + .1, 1.25, .8], [x, .625, ZB - .45], '#eceeec');       // rear end cap
    box([GW + .1, 1.0, .9], [x, .5, ZF + .5], '#eceeec');           // front end cap base
  }
  function produce(x) {
    for (const z of [ZB + 1.5, ZB + 4.5, ZB + 7.5, ZB + 10.5]) {
      const t = box([GW + .8, .8, 2.6], [x, .4, z], '#b88a5a', { round: .05 });
      t.rotation.x = 0;
      const top = new THREE.Mesh(unit, mat('#8e6a45')); top.scale.set(GW + .7, .06, 2.5); top.position.set(x, .83, z); top.rotation.x = -.18; top.receiveShadow = true; root.add(top);
      const c = pal('PRODUCE')[Math.floor(rnd(z, x) * 6)];
      for (let i = 0; i < 26; i++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(.09 + rnd(i, z) * .03, 10, 8), mat(c, { roughness: .5 }));
        s.position.set(x - (GW + .5) / 2 + rnd(i, 1 + z) * (GW + .5), .95 + rnd(i, 2) * .08, z - 1.1 + rnd(i, 3 + z) * 2.2); s.castShadow = true; root.add(s);
      }
    }
  }
  function cooledCase(x, name) {
    box([GW + .5, .9, GL], [x, .45, (ZB + ZF) / 2], '#f4f5f4');
    box([GW + .3, .05, GL - .2], [x, .92, (ZB + ZF) / 2], '#dfe7ea', { cast: false });
    const p = pal(name);
    for (let z = ZB + .3; z < ZF - .2; z += .32) for (const s of [-1, 1]) goods.push([x + s * .28, .99, z, .26, .1, .22, p[Math.floor(rnd(z, x + s) * p.length)]]);
    box([.06, .35, GL], [x, 1.12, (ZB + ZF) / 2], '#cfdde2', { m: { transparent: true, opacity: .5 } });
  }
  aisles.forEach((a, i) => {
    const x = ax(i), up = String(a.name).toUpperCase();
    if (up === 'PRODUCE') produce(x);
    else if (up.startsWith('MEAT') || up === 'DELI') cooledCase(x, up);
    else gondola(x, up, i === home);
    // aisle header sign: department, aisle number, share of this store's sales
    for (const s of [-1, 1]) box([.03, .9, .03], [x + s * .9, 3.05, ZF - .3], '#9aa6a8', { cast: false });
    sign(`${i + 1}  ${a.name}`, `매출 ${Math.round(a.share * 100)}%`, 2.4, .62, [x, 2.55, ZF - .3], 0, a.home ? '#2e6f8e' : '#ffffff', a.home ? '#ffffff' : '#16191a');
  });
  if (goods.length) {
    const inst = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 1, .08), new THREE.MeshStandardMaterial({ roughness: .55 }), goods.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    goods.forEach(([x, y, z, w, h, d, col], i) => { m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d)); inst.setMatrixAt(i, m4); inst.setColorAt(i, c.set(col)); });
    inst.castShadow = true; inst.receiveShadow = true; root.add(inst);
  }

  // front: secondary displays (promo tables), checkout lanes
  const TX0 = -15, TX1 = -3.4, TZ = 7.4;
  for (let i = 0; i < 4; i++) {
    const x = TX0 + 1.45 + i * 2.9;
    box([2.5, .78, 1.5], [x, .39, TZ], '#c9a77c', { round: .04 });
    box([2.6, .05, 1.6], [x, .8, TZ], '#e9dcc6', { cast: false });
  }
  sign('매장 앞 · 보조 진열', null, 3.2, .5, [(TX0 + TX1) / 2, 2.4, TZ - .9], 0, '#ffffff', '#16191a');
  for (const s of [-1, 1]) box([.03, .7, .03], [(TX0 + TX1) / 2 + s * 1.4, 2.95, TZ - .9], '#9aa6a8', { cast: false });
  const lanes = [3, 6.4, 9.8, 13.2], CZ = 9.6;
  const terminals = [];
  lanes.forEach((x, i) => {
    box([.9, .9, 3.2], [x, .45, CZ], '#e8ebe9', { round: .04 });
    const belt = box([.62, .04, 2.2], [x, .92, CZ - .4], '#2d3133', { cast: false });
    belt.material = mat('#2d3133', { roughness: .8 });
    box([.06, 1.6, .06], [x + .5, .8, CZ - 1.5], '#9aa6a8');
    sign(String(i + 1), null, .5, .5, [x + .5, 1.85, CZ - 1.5], 0, '#2e6f8e', '#ffffff');
    terminals.push([x, CZ + .9]);
  });

  // ---------------------------------------------------------------- the 25 cereals
  const typeColor = (name) => {
    const s = name.toLowerCase();
    if (s.startsWith('private')) return ['#f4f1e8', '#2f7d4a', 'PRIVATE'];
    if (s.includes('kids')) return ['#d8322b', '#ffd23f', 'KIDS'];
    if (s.includes('adult')) return ['#8a5a36', '#f0dcb4', 'ADULT'];
    return ['#e48a1f', '#ffffff', 'FAMILY'];
  };
  const boxGeo = new RoundedBoxGeometry(.24, .34, .08, 2, .012);
  function boxMaterials(p) {
    const [bg, fg, tag] = typeColor(p.name);
    const face = canvasTex(256, 360, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = fg; g.font = `800 34px ${FONT}`; g.textAlign = 'center'; g.fillText(tag, w / 2, 52);
      g.font = `700 22px ${FONT}`; g.fillText('CEREAL', w / 2, 84);
      g.beginPath(); g.fillStyle = '#ffffff'; g.ellipse(w / 2, 220, 86, 40, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = bg === '#f4f1e8' ? '#d9b26b' : '#e8b85a';
      for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(w / 2 - 60 + rnd(i, p.n) * 120, 205 + rnd(i, p.n + 1) * 26, 9, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = fg; g.font = `600 20px ${FONT}`; g.fillText(p.size, w / 2, 318);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, h - 22, w, 22);
      g.fillStyle = '#ffffff'; g.font = `700 16px ${FONT}`; g.fillText(`#${p.n}`, w / 2, h - 6);
    });
    const side = mat(bg, { roughness: .5 });
    const front = new THREE.MeshStandardMaterial({ map: face, roughness: .45 });
    return [side, side, side, side, front, side];
  }
  // where each placement puts a product: [x, y, z, rotY] and how many facings it shows
  function slots(key) {
    const out = {}, g = { A_front_endcap: [], C_other_display: [], none: [] };
    data.products.forEach(p => (g[p[key]] || g.none).push(p));
    const capOrder = [...Array(N).keys()].sort((a, b) => Math.abs(a - home) - Math.abs(b - home));
    g.A_front_endcap.forEach((p, j) => { const i = capOrder[Math.floor(j / 2) % N]; out[p.id] = { pos: [ax(i) - .27 + (j % 2) * .54, 1.0, ZF + .98], rot: 0, kind: 'cap' }; });
    g.C_other_display.forEach((p, j) => { const t = Math.floor(j / 4), k = j % 4; out[p.id] = { pos: [TX0 + 1.45 + t * 2.9 - .9 + (k % 2) * 1.0 + (k > 1 ? .35 : 0), .82, TZ - .35 + (k > 1 ? .7 : 0)], rot: 0, kind: 'table' }; });
    g.none.forEach((p, j) => { const lvl = j % 4, col = Math.floor(j / 4); out[p.id] = { pos: [ax(home) - GW / 2 + .06, SHELF_Y[3 - lvl] + .03, ZF - .35 - col * .62], rot: -Math.PI / 2, kind: 'shelf' }; });
    return out;
  }
  const POS = { now: slots('now'), next: slots('next') };
  const pinTex = new Map();
  function pin(p) {
    const t = canvasTex(128, 160, (g) => {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 60, 52, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(40, 100); g.lineTo(88, 100); g.lineTo(64, 150); g.fill();
      g.fillStyle = '#16191a'; g.font = `800 52px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(p.n), 64, 62);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(.42, .52, 1); s.renderOrder = 10; root.add(s); return s;
  }
  const items = data.products.map(p => {
    const g = new THREE.Group(); const ms = boxMaterials(p);
    for (let k = 0; k < 3; k++) for (let r = 0; r < 2; r++) {
      const b = new THREE.Mesh(boxGeo, ms); b.position.set((k - 1) * .25, .17 + r * .345, 0); b.castShadow = true; b.userData.p = p; g.add(b);
    }
    root.add(g);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.5, .025, 8, 40), new THREE.MeshBasicMaterial({ color: MOVED, transparent: true, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.renderOrder = 9; ring.visible = !!(p.moved && opts.rings !== false); root.add(ring);
    const tag = pin(p);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 10), new THREE.MeshBasicMaterial({ color: COND.B_mailer_only, depthTest: false }));
    dot.renderOrder = 11; dot.visible = !!p.mailer; root.add(dot);
    return { p, g, ring, tag, dot, from: null, to: null };
  });

  // ---------------------------------------------------------------- shoppers (a representation: the data has no paths)
  const shoppers = []; let shopperAsset = null;
  const corridorF = ZF + 1.8, gapX = i => ax(i) + step / 2;
  function route(k) {
    const i = Math.floor(rnd(k, 5) * (N - 1)), lane = lanes[Math.floor(rnd(k, 6) * lanes.length)];
    const x = gapX(i), zIn = ZB + 1 + rnd(k, 7) * (GL - 2);
    return [[-13.5, D / 2 - .6, 'Walk'], [-13.5, corridorF, 'Walk'], [x, corridorF, 'Walk'], [x, zIn, 'Walk'], [x, zIn, 'Browse', 2.4],
            [x, corridorF, 'Carry'], [lane - .8, corridorF, 'Carry'], [lane - .8, CZ, 'Carry'], [lane - .8, CZ + .4, 'Pay', 1.8], [lane - .8, D / 2 - 1.2, 'Carry'], [-9.5, D / 2 - 1.2, 'Carry'], [-12.5, D / 2 + .2, 'Carry']];
  }
  function addShoppers(asset, n) {
    const colors = ['#496077', '#954f51', '#657851', '#806488', '#337477', '#9d873e', '#6a6b79'], skins = ['#cfa281', '#b88668', '#d8ae8a', '#b78a70'];
    for (let k = 0; k < n; k++) {
      const rootC = cloneSkinned(asset.scene);
      rootC.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.material = o.material.clone();
        if (o.material.name === 'Outerwear') o.material.color.set(colors[k % colors.length]);
        if (o.material.name === 'Skin') o.material.color.set(skins[k % skins.length]);
        if (o.material.name === 'Trousers') o.material.color.set(k % 3 === 0 ? '#b9ae97' : '#323d4d'); });
      const s = .95 + (k % 4) * .03; rootC.scale.setScalar(s);
      const mixer = new THREE.AnimationMixer(rootC);
      const acts = Object.fromEntries(asset.animations.map(c => [c.name, mixer.clipAction(c)]));
      const sh = { root: rootC, mixer, acts, cur: null, path: route(k * 3 + 1), seg: 0, t: rnd(k, 9) * 4, wait: 0, k };
      // start somewhere along the route so the store is already busy at rest
      sh.seg = Math.floor(rnd(k, 11) * (sh.path.length - 2));
      root.add(rootC); shoppers.push(sh); play(sh, 'Walk');
    }
  }
  function play(sh, name, speed = 1) {
    if (sh.cur === name) return; const a = sh.acts[name] || sh.acts.Walk; if (!a) return;
    a.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1).play(); if (sh.acts[sh.cur]) sh.acts[sh.cur].crossFadeTo(a, .25, false); sh.cur = name;
  }
  function moveShoppers(dt) {
    for (const sh of shoppers) {
      const P = sh.path; if (sh.seg >= P.length - 1) { sh.path = route(sh.k * 7 + Math.floor(performance.now() / 1000)); sh.seg = 0; }
      const a = P[sh.seg], b = P[sh.seg + 1];
      if (a[3] && sh.wait < a[3]) { sh.wait += dt; play(sh, a[2]); sh.mixer.update(dt); sh.root.position.set(a[0], 0, a[1]); continue; }
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || .001;
      sh.t += dt * 1.15 / len;
      if (sh.t >= 1) { sh.seg++; sh.t = 0; sh.wait = 0; continue; }
      sh.root.position.set(a[0] + dx * sh.t, 0, a[1] + dz * sh.t);
      sh.root.rotation.y = Math.atan2(dx, dz);
      play(sh, a[2] === 'Browse' || a[2] === 'Pay' ? 'Walk' : a[2]); sh.mixer.update(dt);
    }
  }
  loadAssets().then(as => {
    if (!alive) return;
    if (as.terminal) terminals.forEach(([x, z]) => { const t = as.terminal.scene.clone(); t.position.set(x, .9, z - 1.3); t.rotation.y = Math.PI; t.scale.setScalar(.9); t.traverse(o => { if (o.isMesh) o.castShadow = true; }); root.add(t); });
    if (as.shopper && opts.shoppers) { shopperAsset = as.shopper; addShoppers(as.shopper, opts.shoppers); }
  });

  // ---------------------------------------------------------------- plan zones (cards highlight where a plan acts)
  const zones = {
    A_front_endcap: [GW + .5, 1.6, 1.3, ax(home), ZF + .55],
    C_other_display: [TX1 - TX0 + .4, 1.4, 2.0, (TX0 + TX1) / 2, TZ],
    B_mailer_only: [1.5, 1.9, 1.2, FLY[0], FLY[1]],
    none: [.9, 2.0, 5.0, ax(home) - GW / 2 - .25, ZF - 2.3],
  };
  const hl = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: '#8bd34f', transparent: true, opacity: .55, depthWrite: false }));
  hl.visible = false; hl.renderOrder = 8; root.add(hl);
  function setHighlight(c) {
    const z = zones[c]; hl.visible = !!z; if (!z) return;
    hl.scale.set(z[0], z[1], z[2]); hl.position.set(z[3], z[1] / 2, z[4]);
  }
  setHighlight(opts.highlight);

  // ---------------------------------------------------------------- layout animation
  let state = opts.state || 'now', t0 = 0, dur = 1700, animating = false, sel = null;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const lerpAngle = (a, b, k) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
  function place(it, k) {
    const a = it.from.pos, b = it.to.pos;
    const x = a[0] + (b[0] - a[0]) * k, z = a[2] + (b[2] - a[2]) * k;
    const lift = (a[0] !== b[0] || a[2] !== b[2]) ? Math.sin(Math.PI * k) * 3.2 : 0;
    const y = a[1] + (b[1] - a[1]) * k + lift;
    it.g.position.set(x, y, z); it.g.rotation.y = lerpAngle(it.from.rot, it.to.rot, k);
    const kind = k < .5 ? it.from.kind : it.to.kind;
    it.g.scale.setScalar(kind === 'shelf' ? .78 : 1);
    it.tag.position.set(x, y + (kind === 'shelf' ? .75 : 1.25), z); it.ring.position.set(x, .03 + (y > .5 ? y - .02 : 0), z); it.dot.position.set(x + .16, it.tag.position.y + .17, z);
    it.kind = kind; it.ring.scale.setScalar(kind === 'shelf' ? .55 : kind === 'table' ? .8 : 1);
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function go(target, animate = !reduce) {
    for (const it of items) { it.from = POS[state][it.p.id]; it.to = POS[target][it.p.id]; }
    state = target;
    if (animate) { t0 = performance.now(); animating = true; } else { items.forEach(it => place(it, 1)); animating = false; }
  }

  // ---------------------------------------------------------------- hover, resize, loop
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  const meshes = items.flatMap(it => it.g.children);
  renderer.domElement.addEventListener('pointermove', e => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(meshes)[0] || ray.intersectObjects(items.map(i => i.tag))[0];
    const p = hit ? (hit.object.userData.p || items.find(i => i.tag === hit.object)?.p) : null;
    opts.onHover?.(p, e.clientX - r.left, e.clientY - r.top, state);
    renderer.domElement.style.cursor = p ? 'pointer' : 'grab';
  });
  renderer.domElement.addEventListener('pointerleave', () => opts.onHover?.(null));
  function frustum(a) {
    const half = 20.5;
    Object.assign(camera, a > 1.3 ? { left: -half, right: half, top: half / a, bottom: -half / a } : { left: -half * a / 1.3, right: half * a / 1.3, top: half / 1.3, bottom: -half / 1.3 });
    camera.updateProjectionMatrix();
  }
  function resize() {
    const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false);
    const half = 20.5, a = w / h;
    Object.assign(camera, a > 1.3 ? { left: -half, right: half, top: half / a, bottom: -half / a } : { left: -half * a / 1.3, right: half * a / 1.3, top: half / 1.3, bottom: -half / 1.3 });
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(el);
  let alive = true, last = performance.now(), camAnim = null, following = false;
  const SPEED = opts.speed ?? 6;   // people walk in time-lapse, so a few seconds show a store's worth of trips
  function update(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (animating) { const k = Math.min(1, (now - t0) / dur); items.forEach(it => place(it, ease(k))); if (k >= 1) animating = false; }
    if (camAnim) {
      const k = Math.min(1, (now - camAnim.t0) / 900), e = ease(k);
      controls.target.lerpVectors(camAnim.ft, camAnim.tt, e); camera.position.lerpVectors(camAnim.fp, camAnim.tp, e);
      camera.zoom = camAnim.fz + (camAnim.tz - camAnim.fz) * e; camera.updateProjectionMatrix(); if (k >= 1) camAnim = null;
    }
    const pulse = .55 + .45 * Math.sin(now / 300);
    for (const it of items) {
      it.ring.material.opacity = pulse;
      const on = sel && it.p.id === sel, show = on || animating || it.kind !== 'shelf' || it.p.moved;
      it.tag.visible = show; it.dot.visible = show && !!it.p.mailer;
      const sc = it.kind === 'shelf' && !on ? .75 : 1; it.tag.scale.set((on ? .56 : .42) * sc, (on ? .7 : .52) * sc, 1);
      const c = state === 'next' ? it.p.next : it.p.now;
      it.tag.material.color.set(animating ? '#ffffff' : (c === 'A_front_endcap' ? '#cfdcff' : c === 'C_other_display' ? '#e3ebfe' : '#ffffff'));
    }
    if (!reduce) moveShoppers(dt * SPEED);
    if (following && shoppers[0]) { const p = shoppers[0].root.position; controls.target.lerp(new THREE.Vector3(p.x, .9, p.z), .08);
      camera.position.copy(controls.target).addScaledVector(VIEWS.cereal.dir.clone().normalize(), 60); }
    controls.update(); if (!opts.manual) renderer.render(scene, camera);
  }
  // the loop drives animation; update() alone is what a snapshot needs, so cards still render in a hidden tab (no rAF there)
  function frame(now) { if (!alive) return; update(now); requestAnimationFrame(frame); }
  function flyTo(target, dir, zoom) {
    camAnim = { t0: performance.now(), ft: controls.target.clone(), fp: camera.position.clone(), fz: camera.zoom,
      tt: target.clone(), tp: target.clone().addScaledVector(dir.clone().normalize(), 60), tz: zoom };
  }
  resize(); go(state, false); if (!opts.manual) requestAnimationFrame(frame);
  return {
    go,
    get state() { return state; },
    focus(name) {
      following = name === 'follow';
      if (following) { if (shoppers[0]) flyTo(shoppers[0].root.position.clone(), VIEWS.cereal.dir, 2.8); return; }
      const v = VIEWS[name]; if (v) { view = v; flyTo(v.target, v.dir, v.zoom); }
    },
    setHighlight,
    setView(name) { view = VIEWS[name] || view; placeCamera(view); },
    ready: () => loadAssets(),
    advance(now) { update(now); },
    // draw the scene as `card` wants it (highlight, view, plan state) into a 2D canvas; used by liveCards
    drawInto(ctx, w, h, card) {
      setHighlight(card.highlight); if (card.view && VIEWS[card.view] !== view) { view = VIEWS[card.view]; placeCamera(view); }
      if (card.state && card.state !== state) go(card.state, false);
      if (renderer.domElement.width !== w || renderer.domElement.height !== h) { renderer.setPixelRatio(1); renderer.setSize(w, h, false); }
      frustum(w / h);
      controls.update(); renderer.render(scene, camera); ctx.drawImage(renderer.domElement, 0, 0, w, h);
    },
    shot(w, h) { update(performance.now()); const pr = renderer.getPixelRatio(); renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.updateProjectionMatrix(); controls.update(); renderer.render(scene, camera); const u = renderer.domElement.toDataURL('image/jpeg', .86); renderer.setPixelRatio(pr); resize(); return u; },
    select(id) {
      sel = sel === id ? null : id;
      const it = items.find(i => i.p.id === id);
      if (sel && it) flyTo(it.g.position.clone(), VIEWS.cereal.dir, 3.4); else flyTo(view.target, view.dir, view.zoom);
      return sel;
    },
    dispose() { alive = false; ro.disconnect(); shoppers.forEach(s => s.mixer.stopAllAction()); renderer.dispose(); el.removeChild(renderer.domElement); },
  };
}

// Live card pictures: one offscreen store, one render per request, cached for the session.
const shotCache = new Map();
export async function snapshots(data, list, w = 640, h = 300) {
  const todo = list.filter(x => !shotCache.has(x.key));
  if (todo.length) {
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px`;
    document.body.appendChild(host);
    const s3 = mountStore(host, data, { shoppers: 26, state: 'now', rings: false });
    await s3.ready(); await new Promise(r => setTimeout(r, 900));
    for (const x of todo) {
      s3.setHighlight(x.highlight); s3.setView(x.view || 'card'); if (x.state) s3.go(x.state, false);
      shotCache.set(x.key, s3.shot(w * 2, h * 2));
    }
    s3.dispose(); host.remove();
  }
  return Object.fromEntries(list.map(x => [x.key, shotCache.get(x.key)]));
}

// Live cards: one store, rendered off-screen, drawn in turn into every visible card canvas. Each card keeps its own
// highlight and view; the people are shared and keep walking. One WebGL context however many cards there are.
export function liveCards(data, cards) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:300px';
  document.body.appendChild(host);
  const s3 = mountStore(host, data, { shoppers: 26, state: 'now', rings: false, manual: true });
  const dpr = Math.min(devicePixelRatio || 1, 2), seen = new Set();
  const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? seen.add(e.target) : seen.delete(e.target)), { rootMargin: '80px' });
  cards.forEach(c => io.observe(c.canvas));
  let alive = true, turn = 0;
  function frame(now) {
    if (!alive) return;
    s3.advance(now);
    const vis = cards.filter(c => seen.has(c.canvas));
    for (let k = 0; k < Math.min(3, vis.length); k++) {          // three cards a frame: smooth enough, cheap enough
      const c = vis[(turn + k) % vis.length], r = c.canvas.getBoundingClientRect();
      const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
      if (c.canvas.width !== w || c.canvas.height !== h) { c.canvas.width = w; c.canvas.height = h; }
      s3.drawInto(c.canvas.getContext('2d'), w, h, c);
    }
    turn += 3;
    requestAnimationFrame(frame);
  }
  s3.ready().then(() => setTimeout(() => alive && requestAnimationFrame(frame), 300));
  return { dispose() { alive = false; io.disconnect(); s3.dispose(); host.remove(); } };
}
