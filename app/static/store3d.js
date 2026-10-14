// The store in 3D. Same scene viewer3d.py writes, as a module the screens mount.
// mountStore(el, data, opts) -> { go(state, animate), select(id), dispose() }
// data: { aisles:[{department|name, sales_share|share, category_home|home}], products:[{n,id,name,size,now,next,moved,mailer,units}], labels }
// opts: { state:'now'|'next', shoppers: n, onHover(p|null, x, y) }
// Positions are a template (the data has no floor plan); zones, slot counts and placements come from data.

const C = { floor: '#dfe3e2', fixture: '#f7f8f8', edge: '#a3aaa8', home: '#e4ecff', ink: '#111', muted: '#5b6362',
  A_front_endcap: '#3B73FF', C_other_display: '#88ACFA', none: '#B8BEC2', mailer: '#FCBB00', moved: '#0F766E', shopper: '#171717' };

export function mountStore(el, data, opts = {}) {
  const THREE = window.THREE;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  el.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eceeed');
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  const home0 = opts.camera || { pos: [4, 13, 15], target: [-12, 0, 0] };
  camera.position.set(...home0.pos);
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.target.set(...home0.target); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 6; controls.maxDistance = 80;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6d736f, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(-14, 30, 18); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 }); scene.add(sun);

  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .85, metalness: 0, ...o });
  function box(w, h, d, m, x, y, z) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); o.castShadow = o.receiveShadow = true; scene.add(o); return o;
  }
  function label(text, { size = 46, color = C.ink, weight = 600, scale = 1.7 } = {}) {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    const f = `${weight} ${size}px "Instrument Sans", Pretendard, "Noto Sans KR", sans-serif`;
    g.font = f; const w = Math.ceil(g.measureText(text).width) + 16; c.width = w; c.height = size + 16;
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    s.scale.set(w / 100 * scale, (size + 16) / 100 * scale, 1);
    s.userData.paint = () => { g.clearRect(0, 0, c.width, c.height); g.font = f; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 8, c.height / 2); tex.needsUpdate = true; };
    s.userData.paint(); scene.add(s); return s;
  }

  const W = 44, Dp = 30;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), mat(C.floor)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(W, 22, C.muted, C.muted); grid.position.y = .01; grid.material.transparent = true; grid.material.opacity = .12; scene.add(grid);
  box(W, .6, .3, mat(C.edge), 0, 0, -Dp / 2); box(.3, .6, Dp, mat(C.edge), -W / 2, 0, 0); box(.3, .6, Dp, mat(C.edge), W / 2, 0, 0);
  box(W - 8, 1.2, .8, mat(C.fixture), 0, 0, -Dp / 2 + 1.2);
  label('매장 뒤 벽면', { size: 34, color: C.muted, weight: 500 }).position.set(-15, 1.8, -Dp / 2 + 1.2);

  const aisles = data.aisles.map(a => ({ name: a.department ?? a.name, share: a.sales_share ?? a.share, home: a.category_home ?? a.home }));
  const N = aisles.length, x0 = -18.5, step = 37 / Math.max(N - 1, 1);
  const ax = i => x0 + i * step;
  const AW = 2.0, AZ0 = -9.5, AZ1 = 3.0, AH = 1.95;
  aisles.forEach((a, i) => {
    box(AW, AH, AZ1 - AZ0, mat(a.home ? C.home : C.fixture), ax(i), 0, (AZ0 + AZ1) / 2);
    box(AW + .24, .04, AZ1 - AZ0 - .1, mat(C.edge), ax(i), .95, (AZ0 + AZ1) / 2);
    box(AW, 1.1, .8, mat(C.fixture), ax(i), 0, AZ0 - .7);
    box(AW, 1.1, .9, mat(C.fixture), ax(i), 0, AZ1 + .75);
    label(String(a.name).slice(0, 12), { size: 40 }).position.set(ax(i), AH + 1.1, AZ0 + 1.2);
    label(`${Math.round(a.share * 100)}% 매출`, { size: 30, color: C.muted, weight: 500 }).position.set(ax(i), AH + .6, AZ0 + 1.2);
  });
  const home = Math.max(0, aisles.findIndex(a => a.home));
  const TX0 = -17, TX1 = -3, TZ = 8;
  box(TX1 - TX0, .75, 2.2, mat(C.fixture), (TX0 + TX1) / 2, 0, TZ);
  label('매장 앞·보조 진열', { size: 34, color: C.muted, weight: 500 }).position.set((TX0 + TX1) / 2, .3, TZ + 1.7);
  box(4.5, .08, 2.4, mat(C.ink), -18, 0, Dp / 2 - 1.4);
  label('입구', { size: 40 }).position.set(-18, .9, Dp / 2 - 1.4);
  for (const x of [6, 10, 14]) box(2.6, 1.0, 1.0, mat(C.edge), x, 0, 11);
  label('계산대', { size: 40 }).position.set(10, 1.9, 11);

  // products
  const PW = .62, PH = .9, PD = .22;
  function slots(key) {
    const pos = {}, g = { A_front_endcap: [], C_other_display: [], none: [] };
    data.products.forEach(p => (g[p[key]] || g.none).push(p));
    const order = [...Array(N).keys()].sort((a, b) => Math.abs(a - home) - Math.abs(b - home));
    g.A_front_endcap.forEach((p, j) => { const i = order[Math.floor(j / 3) % N]; pos[p.id] = [ax(i) - .7 + (j % 3) * .7, 1.1, AZ1 + 1.2 + PD / 2 + .02, 0]; });
    g.C_other_display.forEach((p, j) => { const r = Math.floor(j / 10), c = j % 10; pos[p.id] = [TX0 + .8 + c * 1.4, .75, TZ - .5 + r * 1.0, 0]; });
    g.none.forEach((p, j) => { const lvl = j % 2, col = Math.floor(j / 2); pos[p.id] = [ax(home) + AW / 2 + PD / 2 + .1, [0, .97][lvl] + .02, AZ0 + .6 + col * .9, Math.PI / 2]; });
    return pos;
  }
  const POS = { now: slots('now'), next: slots('next') };
  const items = data.products.map(p => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, PD), new THREE.MeshStandardMaterial({ roughness: .6 }));
    mesh.castShadow = true; mesh.userData.p = p; scene.add(mesh);
    const tag = label(String(p.n), { size: 44, weight: 700, scale: 1.3 });
    let ring = null;
    if (p.moved && opts.rings !== false) {
      ring = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(PW + .14, PH + .14, PD + .14)), new THREE.LineBasicMaterial({ color: C.moved, transparent: true }));
      scene.add(ring);
    }
    let dot = null;
    if (p.mailer) { dot = new THREE.Mesh(new THREE.SphereGeometry(.09, 16, 12), mat(C.mailer)); scene.add(dot); }
    return { p, mesh, tag, ring, dot, from: null, to: null };
  });

  // shoppers: a representation of foot traffic, not movement data (the data has no paths)
  const shoppers = [];
  const route = () => {
    const i = Math.floor(Math.random() * N), side = Math.random() < .5 ? -1 : 1;
    const xa = ax(i) + side * (AW / 2 + .9);
    return [[-18, Dp / 2 - 2], [xa, AZ1 + 2.2], [xa, AZ0 + 1 + Math.random() * 8], [xa, AZ1 + 2.2], [6 + Math.floor(Math.random() * 3) * 4, 12.4], [-15, Dp / 2 - 2]];
  };
  for (let k = 0; k < (opts.shoppers || 0); k++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, 1.1, 14), mat(C.shopper, { roughness: .5 }));
    m.castShadow = true; scene.add(m);
    shoppers.push({ m, path: route(), t: Math.random() * 5, speed: 2.2 + Math.random() });
  }
  function moveShoppers(dt) {
    for (const s of shoppers) {
      s.t += dt * s.speed / 6;
      const seg = Math.floor(s.t);
      if (seg >= s.path.length - 1) { s.path = route(); s.t = 0; continue; }
      const a = s.path[seg], b = s.path[seg + 1], k = s.t - seg;
      s.m.position.set(a[0] + (b[0] - a[0]) * k, .55, a[1] + (b[1] - a[1]) * k);
    }
  }

  let state = opts.state || 'now', t0 = 0, dur = 1600, animating = false, sel = null;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function place(it, k) {
    const a = it.from, b = it.to, x = a[0] + (b[0] - a[0]) * k, z = a[2] + (b[2] - a[2]) * k;
    const lift = (a[0] !== b[0] || a[2] !== b[2]) ? Math.sin(Math.PI * k) * 2.2 : 0;
    const y = a[1] + (b[1] - a[1]) * k + lift + PH / 2, ry = a[3] + (b[3] - a[3]) * k;
    it.mesh.position.set(x, y, z); it.mesh.rotation.y = ry;
    it.tag.position.set(x, y + PH / 2 + .45, z);
    if (it.ring) { it.ring.position.copy(it.mesh.position); it.ring.rotation.y = ry; }
    if (it.dot) it.dot.position.set(x + .22 * Math.cos(ry), y + PH / 2 + .02, z - .22 * Math.sin(ry));
  }
  function paint(k) {
    for (const it of items) {
      const prev = state === 'next' ? it.p.now : it.p.next, cur = state === 'next' ? it.p.next : it.p.now;
      it.mesh.material.color.set(C[k < .5 && animating ? prev : cur] || C.none);
    }
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function go(target, animate = !reduce) {
    for (const it of items) { it.from = POS[state][it.p.id]; it.to = POS[target][it.p.id]; }
    state = target;
    if (animate) { t0 = performance.now(); animating = true; } else { items.forEach(it => place(it, 1)); animating = false; paint(1); }
  }

  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(items.map(i => i.mesh))[0];
    opts.onHover?.(hit ? hit.object.userData.p : null, e.clientX - r.left, e.clientY - r.top, state);
    canvas.style.cursor = hit ? 'pointer' : 'grab';
  });
  canvas.addEventListener('pointerleave', () => opts.onHover?.(null));

  function resize() { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(el);
  let alive = true, last = performance.now();
  function frame(now) {
    if (!alive) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (animating) { const k = Math.min(1, (now - t0) / dur); items.forEach(it => place(it, ease(k))); paint(k); if (k >= 1) { animating = false; paint(1); } }
    const pulse = .55 + .45 * Math.sin(now / 320);
    for (const it of items) {
      if (it.ring) it.ring.material.opacity = pulse;
      it.mesh.material.emissive.setScalar(sel && it.p.id === sel ? .25 * pulse : 0);
    }
    if (!reduce) moveShoppers(dt);
    controls.update(); renderer.render(scene, camera); requestAnimationFrame(frame);
  }
  resize(); go(state, false); requestAnimationFrame(frame);
  if (!reduce) moveShoppers(0);
  return {
    go,
    get state() { return state; },
    select(id) {
      sel = sel === id ? null : id;
      const it = items.find(i => i.p.id === id);
      if (sel && it) controls.target.copy(it.mesh.position); else controls.target.set(...home0.target);
      return sel;
    },
    screenPos(id) {
      const it = items.find(i => i.p.id === id); if (!it) return null;
      const v = it.mesh.position.clone().project(camera), r = canvas.getBoundingClientRect();
      return [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height];
    },
    dispose() { alive = false; ro.disconnect(); renderer.dispose(); el.removeChild(canvas); },
  };
}
