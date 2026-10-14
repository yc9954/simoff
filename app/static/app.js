// SimOff screens. Each screen is the storyboard board's own markup (screens/<id>.html);
// this file fills its data-k / data-slot / data-shot hooks from the API and wires the controls.
import { mountStore, liveCards } from './store3d.js';
import { mountSpace, spaceCards } from './space3d.js';

// ---------------------------------------------------------------- helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = x => x == null ? '—' : Math.round(x).toLocaleString('en-US');
const nf = (x, d = 2) => x == null ? '—' : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = p => p == null ? '—' : p === 0 ? '0%' : p >= .1 ? `${Math.round(p * 100)}%` : p >= .01 ? `${(p * 100).toFixed(1)}%` : `${(p * 100).toFixed(3)}%`;
const LBL = { A_front_endcap: '앞쪽 엔드캡', B_mailer_only: '전단', C_other_display: '기타 진열', none: '평소대로' };
const COL = { A_front_endcap: '#3B73FF', B_mailer_only: '#FCBB00', C_other_display: '#88ACFA', none: '#B8BEC2' };
const PLANS = ['A_front_endcap', 'B_mailer_only', 'C_other_display', 'none'];
const ENG = { calibrated: ['#0F766E', '#0F766E'], jev_calibrated: ['linear-gradient(90deg,#6D5BD0 50%,#0F766E 50%)', '#6D5BD0'], persona: ['#F99C00', '#F99C00'],
              no_promo: ['#B8BEC2', '#4d5353'], avg_lift: ['#4d5353', '#4d5353'], basic: ['#F99C00'], history: ['#FCC870'], jev_text: ['#B4A8F0'], jev_state: ['#6D5BD0'], persona_live: ['#F99C00'] };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem('oa:' + k)) ?? d; } catch { return d; } },
                set(k, v) { try { localStorage.setItem('oa:' + k, JSON.stringify(v)); } catch {} } };
const arrowSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

async function api(path, body) {
  const r = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `서버 응답을 읽지 못했습니다 (${r.status})` }));
  if (!r.ok || j?.error) throw new Error(j?.error || r.statusText);
  return j;
}
const tplCache = {};
const template = id => tplCache[id] ??= fetch(`screens/${id}.html`).then(r => r.text());
const K = (root, k) => root.querySelector(`[data-k="${k}"]`);
function set(root, k, v, html = false) { const e = K(root, k); if (e) html ? e.innerHTML = v : e.textContent = v; return e; }
const slot = (root, n) => root.querySelector(`[data-slot="${n}"]`);
const llmWhy = m => /insufficient_quota|credit_balance_exhausted/.test(m) ? 'OpenAI 크레딧이 바닥나 언어 모델을 쓰지 못했습니다' : /429/.test(m) ? 'OpenAI 요청 한도에 걸려(429) 언어 모델을 쓰지 못했습니다' : `언어 모델 호출 실패(${esc(m)})`;
const errBox = e => `<div class="errbox" role="alert">${esc(e.message || e)}</div>`;

const tip = $('#tip');
function showTip(html, x, y) { tip.innerHTML = html; tip.hidden = false; tip.style.left = Math.min(x + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(y + 14, innerHeight - tip.offsetHeight - 8) + 'px'; }
const hideTip = () => { tip.hidden = true; };
function productTip(p, state, weeks) {
  const on = state === 'next' ? p.next : p.now, name = c => c === 'none' ? '선반' : LBL[c];
  const rows = p.units && Object.keys(p.units).length ? `<table>${['none', 'A_front_endcap', 'C_other_display'].map(o => `<tr class="${o === on ? 'on' : ''}"><td>${name(o)}</td><td>${nf(p.units[o])}</td></tr>`).join('')}</table><span style="color:#4d5353">기대 판매 방문 · ${weeks || '48–53'}주</span>` : '';
  return `<b>${p.n}. ${esc(p.name)} ${esc(p.size)}</b><br>${p.moved ? `${name(p.now)} → <b>${name(p.next)}</b>` : name(on)}${p.mailer ? ' · 전단' : ''}${rows}`;
}
function stage3d(el, data, opts = {}) {
  const r = () => el.getBoundingClientRect();
  return mountStore(el, data, { ...opts, onHover: (p, x, y, st) => p ? showTip(productTip(p, st, opts.weeks), r().left + x, r().top + y) : hideTip() });
}

// the store every illustration is drawn from (store 367 unless the person picked another)
let storeDataP = null;
function pickStore(id) { store.set('store', id); storeDataP = null; const g = $('[data-g="store"]'); if (g) g.textContent = `store_${id}`; }
const storeData = () => storeDataP ??= api(`layout?store=${store.get('store', '367')}`).then(L => ({ aisles: L.aisles, products: L.products, L }));
// card pictures are live: every <img data-shot> becomes a canvas fed by one shared off-screen store (store3d.liveCards),
// so the people keep walking in every card while each card keeps its own highlighted zone
let live = null;
async function fillShots(root, opts = {}) {
  const imgs = $$('img[data-shot]', root); if (!imgs.length) return;
  const d = await storeData();
  live?.dispose();
  // each card's crowd stops at its plan's display as often as that engine's lift for the plan says
  const run = await api('run/latest').catch(() => null);
  const liftOf = (eng, plan) => run?.engines?.find(e => e.id === eng)?.plans?.find(p => p.id === plan)?.lift ?? { A_front_endcap: 3, C_other_display: 2.5, B_mailer_only: 1.8 }[plan] ?? 1;
  const cards = imgs.map(i => {
    const c = document.createElement('canvas');
    c.className = i.className; c.setAttribute('style', i.getAttribute('style') || ''); c.setAttribute('role', 'img'); c.setAttribute('aria-label', i.alt || '');
    c.style.width = '100%'; c.dataset.key = i.dataset.group || `${i.dataset.engine || 'calibrated'}:${i.dataset.shot}`; i.replaceWith(c);
    const k = i.dataset.shot, eng = i.dataset.engine || 'calibrated', plan = i.dataset.plan || (k === 'report' ? 'A_front_endcap' : k);
    const base = { canvas: c, plan, group: i.dataset.group || `${eng}:${plan}`, lift: i.dataset.lift ? +i.dataset.lift : liftOf(eng, plan) };
    return k === 'report' ? { ...base, highlight: 'A_front_endcap', view: 'cereal', state: 'next' } : { ...base, highlight: k, view: 'card', state: 'now' };
  });
  const P = projSpace();
  if (P) {
    const best = run?.engines?.find(e => e.id === 'calibrated')?.plans?.slice().sort((a, b) => b.per_1000 - a.per_1000)[0]?.id || 'A_front_endcap';
    cards.forEach(c => { const plan = c.plan === 'A_front_endcap' && c.view === 'cereal' ? best : c.plan; c.fx = P.plans[plan]?.fx; });
    live = spaceCards({ glb: P.glb, space: P.space, ops: P.ops, people: P.people }, cards, opts);
  } else live = liveCards(d, cards, opts);
  const mine = live; cleanups.push(() => { mine.dispose(); if (live === mine) live = null; });
}

// the project the chat started; every step after it reads it
function setProject(p) { store.set('project', { ...p, at: Date.now() }); }
// a space project: the space the chat built, carried through every step; the numbers come from SimOff-1, whose four
// store conditions are mapped onto this space (entrance spot, inner spot, flyer/coupon, as it is)
const projSpace = () => { const p = store.get('project'); return p && p.kind === 'space' ? p : null; };
const planName = c => projSpace()?.plans?.[c]?.label || LBL[c];
function makeProject(r, business) {
  const st = Object.fromEntries(r.steps.map(x => [x.key, x])), sp = r.space, ops = st.adapt.ops;
  const door = sp.doors.find(d => d.main) || sp.doors[0], dist = f => Math.hypot(f.cx - door.x, f.cy - door.y);
  const shop = sp.fixtures.filter(f => ['pick', 'shop', 'browse', 'order', 'pickup', 'checkout', 'service', 'seat'].includes(f.role) && !['context', 'floor', 'boundary', 'structure', 'staff', 'facade', 'decor'].includes(f.klass));
  const mv = ops.find(o => o.op === 'move'), rl = ops.find(o => o.op === 'relabel');
  const target = (mv && sp.fixtures.find(f => f.id === mv.id)) || (rl && sp.fixtures.find(f => f.id === rl.id)) || [...shop].sort((a, b) => dist(a) - dist(b))[0];
  const inner = [...shop].filter(f => f !== target).sort((a, b) => dist(b) - dist(a))[0];
  const T = (rl?.label && !mv ? rl.label.replace(/^행사: /, '') : target?.label) || '대표 상품';
  return { kind: 'space', title: business || sp.title, spaceTitle: sp.title.split(' — ')[0], glb: r.glb, space: sp, ops, people: st.place.people,
    plans: { A_front_endcap: { label: `${T} · 입구 쪽`, desc: '들어오자마자 보이는 자리', fx: target?.id },
             B_mailer_only: { label: '전단 · 쿠폰 홍보', desc: '공간은 그대로 두고 밖에서 알림', fx: null },
             C_other_display: { label: `${T} · 안쪽 자리`, desc: '매장 안쪽 보조 자리', fx: inner?.id },
             none: { label: '지금 그대로', desc: '비교 기준', fx: null } } };
}
const MODEL_NOTE = 'SimOff-1 · 마트 데이터로 추정';
// the close of every step: one line on what this step settled, and the way to the next
const STEP_FOOT = {
  connect: ['Calibrated to People, not to Answers.', '답이 맞을 확률이 아니라, 이 공간의 손님이 실제로 그 행동을 할 확률. 사람이 오가고 고르는 곳이라면 같은 방식으로 보정합니다.', '#plans', '다음: 시험할 안'],
  plans: ['아홉 가지 안, 같은 손님.', '모든 안을 같은 방문, 같은 손님으로 비교합니다. 달라지는 건 안 하나뿐입니다.', '#run?go=1', '실행하기'],
  run: ['가장 잘 팔린 안이 강조됩니다.', '다시 실행하면 손님의 운만 바꿔 한 번 더 돌립니다. 순서가 바뀌지 않으면 그 안이 답입니다.', '#layout', '다음: 최종 배치'],
  layout: ['문 열기 전에 고른 배치.', '실제로 해 보기 전, 시뮬레이션이 고른 배치입니다. 리포트에서 근거와 함께 정리합니다.', '#report', '다음: 리포트'],
  report: ['결정을 내릴 차례.', '승인하면 이 배치로 진행합니다. 다른 공간이나 결정은 새로 세우면 됩니다.', '#start?new=1', '새 공간 세우기', `<span data-slot="approve"><button type="button" class="btn btn-mono" data-act="approve">이 안 승인</button></span>`],
};
const stepFoot = view => { const f = STEP_FOOT[view]; return f ? `<div class="step-foot"><p><b>${f[0]}</b> ${f[1]}</p><span class="step-acts">${f[4] || ''}<a class="btn ${f[4] ? 'btn-outline' : 'btn-mono'}" href="${f[2]}">${f[3]} ${arrowSvg}</a></span></div>` : ''; };

// Obolus card colour field + texture, ported from obolus/src/lib/cardGradient.ts (same schemes, positions, angles and
// ribbons; FNV-1a seeds, so the same card always gets the same colours and neighbours rarely repeat)
const G_SCHEMES = [['#123a86', '#2778cf', '#35e5df'], ['#07594f', '#1d9b89', '#8ee8d7'], ['#762348', '#ce3f70', '#f29bad'], ['#7c3037', '#df5b50', '#efad71'],
  ['#302b75', '#645dde', '#66d9c2'], ['#0b475a', '#1688ad', '#68e1dd'], ['#542153', '#a63c7b', '#eba0c3'], ['#174340', '#218d78', '#a8e5ca'],
  ['#26316d', '#536bd0', '#70d2d8'], ['#442654', '#8e4fb4', '#ef92bc'], ['#123f55', '#299eb0', '#b0eee4']];
const G_POS = [[12, 18], [88, 12], [18, 88], [82, 82], [50, 6], [8, 52], [92, 48], [50, 94], [28, 34], [72, 66]];
const G_ANG = [105, 120, 135, 150, 160, 115, 140, 170];
const fnv = t => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const gpick = (seed, salt, mod) => fnv(`${salt}:${seed}`) % mod;
function cardGradient(seed, deep) {
  const k = seed || 'obolus', [sh, mid, li] = G_SCHEMES[gpick(k, 'scheme', G_SCHEMES.length)];
  const [x1, y1] = G_POS[gpick(k, 'pos1', 10)], [x2, y2] = G_POS[gpick(k, 'pos2', 10)], [x3, y3] = G_POS[gpick(k, 'pos3', 10)], a = G_ANG[gpick(k, 'angle', 8)];
  const s = deep ? [94, 95, 78, 72, 74, 76] : [66, 72, 54, 68, 70, 72];
  return `radial-gradient(ellipse at ${x1}% ${y1}%, color-mix(in oklab, ${li} ${s[0]}%, white) 0%, transparent ${s[3]}%), `
    + `radial-gradient(ellipse at ${x2}% ${y2}%, color-mix(in oklab, ${mid} ${s[1]}%, white) 0%, transparent ${s[4]}%), `
    + `radial-gradient(ellipse at ${x3}% ${y3}%, color-mix(in oklab, ${sh} ${s[2]}%, black) 0%, transparent ${s[5]}%), linear-gradient(${a}deg, ${sh}, ${mid} 52%, ${li})`;
}
const G_RIBBONS = ['<path d="M-120 540 C110 80 330 510 735-90" stroke-width="168"/><path d="M155 550 C300 285 455 315 710 20" stroke-width="62" opacity=".32"/>',
  '<path d="M-140 25 C160 5 245 390 750 325" stroke-width="178"/><path d="M-80 470 C175 235 420 470 735 195" stroke-width="66" opacity=".3"/>',
  '<path d="M-130 420 C100 350 145 30 745 110" stroke-width="188"/><path d="M145 550 C245 265 505 245 655-110" stroke-width="66" opacity=".3"/>',
  '<path d="M365 570 C210 350 505 190 330-120" stroke-width="176"/><path d="M350 440 C535 240 625 270 750 35" stroke-width="64" opacity=".3"/>',
  '<path d="M-130 360 C90 55 350 405 750 95" stroke-width="170"/><path d="M-100 525 C175 300 420 520 735 290" stroke-width="60" opacity=".28"/>'];
function cardTexture(seed) {
  const k = seed || 'obulus', v = gpick(k, 'texture', 5), refl = gpick(k, 'texture-reflect', 2) === 1, rot = [-9, 5, -4, 10][gpick(k, 'texture-rotate', 4)];
  const tf = `${refl ? 'translate(600 0) scale(-1 1) ' : ''}rotate(${rot} 300 225)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" preserveAspectRatio="xMidYMid slice"><defs><filter id="flow" x="-45%" y="-45%" width="190%" height="190%"><feTurbulence type="fractalNoise" baseFrequency=".003 .008" numOctaves="2" seed="${gpick(k, 'texture-noise', 97) + 1}" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="13" xChannelSelector="R" yChannelSelector="B"/><feGaussianBlur stdDeviation="22"/></filter><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" seed="${gpick(k, 'grain', 97) + 1}"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .08 0"/></filter></defs><g transform="${tf}" fill="none" stroke="#f5ffff" stroke-linecap="round" opacity=".72" filter="url(#flow)">${G_RIBBONS[v]}</g><rect width="100%" height="100%" filter="url(#grain)" opacity=".12"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
// every .grad gets its own field, seeded by its label (data-seed wins): Obolus's soft strength under dark text, deep where only an icon sits
function paintGrads(root) {
  $$('.grad', root).forEach((e, i) => {
    if (e.dataset.grad === 'origin') { e.style.background = ''; return; }   // keeps the .grad class colour: the first endpoint card's mint · lavender
    const seed = e.dataset.seed || (e.querySelector('.mono, .lbl, h1, h2, b, [data-k]')?.textContent || e.textContent || '').replace(/[\d.,$%×→\s—-]+/g, ' ').trim().slice(0, 40) || String(i);
    e.style.background = `linear-gradient(rgba(0,0,0,.03), rgba(0,0,0,.03)), ${cardTexture(seed)} center / cover no-repeat, ${cardGradient(seed, !e.classList.contains('ink'))}`;
  });
}

// ---------------------------------------------------------------- shell
let cleanups = [];
async function render() {
  const [id, qs] = (location.hash.slice(1) || 'start').split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const view = VIEWS[id] ? id : 'start';
  $$('.nav-a').forEach(a => a.dataset.id === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  // the flow track fills from the top to the current step; steps above it read as done
  const flowSteps = $$('.flow-step'), at = flowSteps.findIndex(a => a.dataset.id === view);
  flowSteps.forEach((a, i) => a.classList.toggle('done', at >= 0 && i < at));
  const flow = $('[data-flow]'); if (flow) flow.style.setProperty('--fill', at <= 0 ? '0%' : `${(at / (flowSteps.length - 1)) * 100}%`);
  cleanups.forEach(f => { try { f(); } catch {} }); cleanups = []; hideTip();
  const el = $('#view');
  el.innerHTML = '<div class="loading"><span class="spin"></span> 불러오는 중</div>';
  const TITLES = { start: '공간 세우기', connect: '기록 연결', plans: '시험할 안', run: '실행', layout: '최종 배치', report: '리포트', verify: '모델 검증', try: '모델 체험',
                  brief: '결정 브리프', endpoints: '엔드포인트', world: '매장 월드', engines: '엔진 비교' };
  document.title = `${TITLES[view] || ''} · SimOff`;
  try {
    const html = await template(view);
    const root = document.createElement('div'); root.style.display = 'contents'; root.innerHTML = html;
    await VIEWS[view](root, params, cleanups);
    el.replaceChildren(...root.childNodes);
    el.insertAdjacentHTML('beforeend', stepFoot(view));
    el.classList.toggle('stepv', view !== 'start'); el.classList.remove('chatting');   // a step page: one screen, the way on always in view
    VIEWS[view].after?.(el, params, cleanups);
    paintGrads(el); fillShots(el, VIEWS[view].live || {}).catch(() => {});
  } catch (e) { el.innerHTML = errBox(e); }
}
addEventListener('hashchange', render);

async function boot() {}

// ---------------------------------------------------------------- screens
const VIEWS = {};

// 시작 · the landing chat: the agent (Claude, rules without a key) reads the business, asks if it must, and builds the
// space with tools; its cards, the 3D space, the edits and the decisions are drawn inside the conversation
const EXAMPLES = [   // placeholder prompts: openings people would pay to get right before the doors open
  '성수동에 30평 카페를 열려고 해요. 픽업대를 입구 쪽에 둘지 안쪽에 둘지 열기 전에 보고 싶어요.',
  '글로벌 뷰티 브랜드가 서울 · 도쿄 · LA에 플래그십을 열어요. 신제품 체험존을 어디에 둬야 구매로 이어질까요?',
  '동네에 60평 슈퍼마켓을 열 예정이에요. 시즌 음료를 입구 엔드캡에 둘지, 전단에 실을지 정하고 싶어요.',
  '10만 명이 오는 음악 페스티벌에 푸드 · 굿즈 부스를 열어요. 문 열기 전에 줄이 어디서 막힐지 알고 싶어요.',
];
const OPS_TXT = { duplicate: '추가', relabel: '행사 자리', stations: '계산 자리', remove: '뺌', move: '옮김' };
const rich = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split(/\n{2,}/).map(p => {
  const ls = p.split('\n');
  return ls.every(l => /^\s*[-·•]\s/.test(l)) ? `<ul>${ls.map(l => `<li>${l.replace(/^\s*[-·•]\s/, '')}</li>`).join('')}</ul>`
    : ls.some(l => /^\s*[-·•]\s/.test(l)) ? ls.map(l => /^\s*[-·•]\s/.test(l) ? `<ul><li>${l.replace(/^\s*[-·•]\s/, '')}</li></ul>` : `<p>${l}</p>`).join('') : `<p>${p.replace(/\n/g, '<br>')}</p>`;
}).join('');
function recsHTML(recs) {
  return `<div class="art"><div class="lbl">추천 공간</div><div class="recs">${recs.map((c, i) => `
<button type="button" class="rec card" data-pick="${c.id}" data-label="${esc(c.label)}"><img src="${c.thumb}" alt="${esc(c.title)} 3D 모형" loading="lazy"><span style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><b style="font-weight:600">${i + 1}. ${esc(c.label)}</b><span class="mono muted" style="font-size:11px">${Math.round(c.area_m2).toLocaleString()}㎡${c.floors > 1 ? ` · ${c.floors}층` : ''}${c.outdoor ? ' · 야외' : ''}</span></span><span class="muted" style="font-size:12px;line-height:1.5">${esc(c.title)}</span><span style="display:flex;flex-wrap:wrap;gap:4px">${(c.why || []).map(w => `<span class="tag" style="background:rgba(0,0,0,.05)">${esc(w)}</span>`).join('')}</span><span class="tag tag-ok rec-on">이 맵으로 세움</span><span class="mono muted rec-cta">이 맵으로 바꾸기 →</span></button>`).join('')}</div></div>`;
}
function worldHTML(r) {
  const st = Object.fromEntries(r.steps.map(x => [x.key, x])), ad = st.adapt, pl = st.place, dc = st.decide;
  return `<div class="art card" style="overflow:hidden;padding:0"><div style="position:relative"><div data-slot="space" class="stage"></div>
<div style="position:absolute;left:14px;top:14px;display:flex;flex-wrap:wrap;gap:8px;max-width:calc(100% - 28px)"><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">${esc(r.space.title)}</span><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">손님 ${pl.people.count}명</span><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">물체에 커서를 올려 보세요</span></div></div>
<div class="world-cols"><div><div class="lbl">바꾼 것</div>${ad.ops.length ? ad.ops.map(o => `<button type="button" class="list-btn" data-focus="${o.id}" style="display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--border);width:100%;text-align:left"><span class="tag ${o.op === 'relabel' ? '' : 'tag-ok'}" style="${o.op === 'relabel' ? 'background:#e3ebfe;color:#1d4ed8;' : ''}flex:none">${OPS_TXT[o.op] || o.op}</span><span style="font-size:13px;line-height:1.55">${esc(o.why)}</span></button>`).join('') : '<p class="muted" style="font-size:13px;margin-top:10px">요청에 맞춰 바꿀 것이 없어 원형 그대로 두었습니다.</p>'}
${ad.skipped.map(o => `<div style="display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--border)"><span class="tag" style="background:#f6ebd3;color:#6b4a00;flex:none">못 바꿈</span><span style="font-size:13px;line-height:1.55">${esc(o.why)} — ${esc(o.reason)}</span></div>`).join('')}
${ad.note ? `<p class="muted" style="font-size:12px;line-height:1.6;margin-top:8px">${esc(ad.note)}</p>` : ''}</div>
<div><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="lbl">이 공간에서 시험할 결정</div><a class="btn btn-mono btn-sm" href="#connect">다음: 기록 연결 →</a></div>${dc.decisions.map(d => `<div style="padding:12px 0;border-top:1px solid var(--border)"><div style="font-size:15px;font-weight:500;line-height:1.5">${esc(d.q)}</div><div class="muted" style="font-size:12px;margin-top:4px">지표: ${esc(d.metric)} · 필요한 기록: ${esc(d.needs)}</div><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">${dc.calibrated ? '<a class="btn btn-mono btn-sm" href="#connect">올린 기록으로 보정하기 →</a>' : '<span class="tag" style="background:rgba(0,0,0,.05)">기록이 오면 숫자를 냅니다</span>'}${d.example ? `<a class="btn btn-outline btn-sm" href="${d.example}">보정된 예시로 보기 →</a>` : ''}</div></div>`).join('')}</div></div></div>`;
}
// the conversation outlives the page: going to another step and back shows it again (this tab only)
const CHAT = (() => { try { return JSON.parse(sessionStorage.getItem('oa:chat')) || { turns: [] }; } catch { return { turns: [] }; } })();
const saveChat = () => { try { sessionStorage.setItem('oa:chat', JSON.stringify(CHAT)); } catch {} };
VIEWS.start = async (root, params) => {
  if (params.new) { CHAT.turns = []; saveChat(); history.replaceState(null, '', '#start'); }
  VIEWS.start._models = await api('models').catch(() => ({ models: [], default: null }));
};
VIEWS.start.after = (el, params, cleanups) => {
  const thread = slot(el, 'thread'), composer = slot(el, 'composer'), ta = K(el, 'ask');
  let history = [], files = [], s3 = null, busy = false;
  const startChat = () => { if (el.classList.contains('chatting')) return; el.classList.add('chatting'); thread.style.display = 'flex'; thread.after(composer); ta.placeholder = '이어서 묻거나 바꾸고 싶은 것을 말해 주세요'; };
  cleanups.push(() => s3?.dispose());
  // rotating placeholder: one real-sized decision at a time
  let ex = 0; ta.placeholder = EXAMPLES[0];
  const rot = setInterval(() => { if (!ta.value && document.activeElement !== ta && !el.classList.contains('chatting')) ta.placeholder = EXAMPLES[ex = (ex + 1) % EXAMPLES.length]; }, 4200);
  cleanups.push(() => clearInterval(rot));
  ta.onkeydown = null;
  // decision model picker (like choosing a model in any frontier-model product); each entry shows its training data and source
  const M = VIEWS.start._models, menu = slot(el, 'models'), btn = $('[data-act="model"]', el);
  let model = store.get('decisionModel', M.default) || M.default;
  if (!M.models.some(x => x.id === model)) model = M.default;
  const showModel = () => { const m = M.models.find(x => x.id === model) || M.models[0]; if (m) set(el, 'modelName', m.title); };
  menu.innerHTML = M.models.map(m => `<button type="button" role="option" class="mpick-item" data-model="${m.id}"><span class="mpick-row"><b>${esc(m.title)}</b><span class="mpick-check">✓</span></span><span class="mpick-src">${m.source.url ? `<a href="${m.source.url}" target="_blank" rel="noopener">${esc(m.source.label)} ↗</a>` : esc(m.source.label)}</span></button>`).join('');
  const mark = () => $$('[data-model]', menu).forEach(b => { const on = b.dataset.model === model; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); };
  $$('[data-model]', menu).forEach(b => b.onclick = e => { if (e.target.closest('a')) return; model = b.dataset.model; store.set('decisionModel', model); showModel(); mark(); close(); });
  const outside = e => { if (!e.target.closest('.mpick')) close(); }, esc_ = e => { if (e.key === 'Escape') close(); };
  addEventListener('click', outside); addEventListener('keydown', esc_);
  cleanups.push(() => { removeEventListener('click', outside); removeEventListener('keydown', esc_); });
  showModel(); mark();
  const atBottom = () => thread.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  function bubble(role, html) {
    const d = document.createElement('div'); d.className = `msg ${role}`;
    d.innerHTML = role === 'user' ? `<div class="bub">${html}</div>` : `<span class="ava" aria-hidden="true"><i></i><i></i><i></i></span><div class="body">${html}</div>`;
    thread.appendChild(d); return d;
  }
  function freeze() {          // keep one live 3D scene: the older one becomes a still picture of itself
    if (!s3) return; const host = s3.__host;
    try { const u = s3.shot(); host.innerHTML = `<img src="${u}" alt="이전 3D 공간" style="width:100%;height:100%;object-fit:cover;display:block">`; } catch { host.innerHTML = ''; }
    s3.dispose(); s3 = null;
  }
  function draw(msgEl, art) {
    const body = $('.body', msgEl);
    if (art.type === 'recs') {
      body.insertAdjacentHTML('beforeend', recsHTML(art.recs));
    } else if (art.type === 'world') {
      const r = art.run; freeze();
      setProject(makeProject(r, [...history].reverse().find(h => h.role === 'user')?.text));
      $$('.rec', body).forEach(b => { const on = b.dataset.pick === r.space.id; b.classList.toggle('on', on); });
      body.insertAdjacentHTML('beforeend', worldHTML(r));
      const host = $$('[data-slot="space"]', body).at(-1), st = Object.fromEntries(r.steps.map(x => [x.key, x]));
      s3 = mountSpace(host, { glb: r.glb, space: r.space, ops: st.adapt.ops, people: st.place.people }, { maxPeople: 40, spin: true }); s3.__host = host;
      const cur = s3;
      $$('[data-focus]', body).forEach(b => b.onclick = () => { if (s3 !== cur) return; cur.spin(false); const on = !b.classList.contains('on'); $$('[data-focus]', body).forEach(x => x.classList.remove('on')); b.classList.toggle('on', on); cur.focus(on ? b.dataset.focus : null); });
    }
    if (art.type === 'mart') {
      freeze();
      setProject({ title: art.business || '마트', store: art.store, kind: 'mart' });
      body.insertAdjacentHTML('beforeend', `<div class="art card" style="overflow:hidden;padding:0"><div style="position:relative"><div data-slot="space" class="stage"></div>
<div style="position:absolute;left:14px;top:14px;display:flex;flex-wrap:wrap;gap:8px"><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">Store ${esc(art.store)} · 실제 매장 데이터</span></div></div>
<div class="world-cols"><div><div class="lbl">시험할 결정 · 다음 주 콜드 시리얼</div><div class="plan-chips">${art.plans.map(p => `<span class="plan-chip"><i style="background:${COL[p.id]}"></i>${esc(p.label)}</span>`).join('')}</div></div>
<div style="display:flex;align-items:flex-end;justify-content:flex-end"><a class="btn btn-mono" href="#connect">다음: 기록 연결 →</a></div></div></div>`);
      const host = $$('[data-slot="space"]', body).at(-1);
      storeData().then(d => { s3 = stage3d(host, { aisles: d.aisles, products: d.products }, { state: 'now', shoppers: 24, weeks: d.L.weeks.join('–') }); s3.__host = host; });
    }
    $$('[data-pick]', body).forEach(b => b.onclick = () => !b.classList.contains('on') && send(`${b.dataset.label} 맵(${b.dataset.pick})으로 바꿔서 다시 세워 주세요.`));
  }
  async function send(text) {
    text = (text || '').trim(); if (!text || busy) return;
    busy = true;
    startChat();
    history.push({ role: 'user', text });
    bubble('user', esc(text)).scrollIntoView({ behavior: 'smooth', block: 'center' });
    ta.value = '';
    const ai = bubble('ai', '<div class="typing" aria-label="생각하는 중"><i></i><i></i><i></i></div>');
    try {
      const r = await api('chat', { history, files, model });
      $('.body', ai).innerHTML = rich(r.reply);
      history.push({ role: 'assistant', text: r.reply });
      const mart = (r.artifacts || []).some(a => a.type === 'mart');   // the real store replaces the archetype cards
      const arts = (r.artifacts || []).filter(a => !(mart && a.type === 'recs'));
      arts.forEach(a => draw(ai, a));
      CHAT.turns.push({ user: text, reply: r.reply, artifacts: arts }); saveChat();
    } catch (e) { $('.body', ai).innerHTML = errBox(e); history.pop(); }
    busy = false; ai.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('[data-act="send"]', el).onclick = () => send(ta.value);
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ta.value); } };
  K(el, 'files').onchange = e => { files = [...e.target.files].map(f => f.name); set(el, 'fileLbl', files.length ? `${files.length}` : ''); };
  // back from another step: the same conversation, with only the latest space live in 3D
  if (CHAT.turns.length) {
    startChat();
    const is3d = a => a.type === 'world' || a.type === 'mart', last = CHAT.turns.flatMap(t => t.artifacts).filter(is3d).at(-1);
    for (const t of CHAT.turns) {
      history.push({ role: 'user', text: t.user }); bubble('user', esc(t.user));
      const ai = bubble('ai', rich(t.reply)); history.push({ role: 'assistant', text: t.reply });
      t.artifacts.forEach(a => { if (!is3d(a) || a === last) draw(ai, a); });
    }
    requestAnimationFrame(() => thread.lastElementChild?.scrollIntoView({ block: 'start' }));
  }
  if (params.q) { window.history.replaceState(null, '', '#start'); send(params.q); }
};

// S0 결정 브리프
VIEWS.brief = async (root) => {
  const [cat, health, last] = await Promise.all([api('catalog'), api('health'), api('run/latest')]);
  const q = store.get('question'); if (q) K(root, 'q').textContent = q;
  set(root, 'llm', health.llm ? `예측은 언어 모델이 아니라 보정된 결정 모델이 합니다. 언어 모델(${health.model})은 질문 정리와 설명만 맡습니다.` : '예측은 언어 모델이 아니라 보정된 결정 모델이 합니다. 언어 모델은 질문 정리와 설명만 맡습니다. (OPENAI_API_KEY 없음 · 규칙으로 정리)');
  set(root, 'basis', `${n0(cat.households)}가구 · 1년 · 영수증 ${n0(cat.receipt_lines)}줄 · 진열 기록 ${n0(cat.placement_rows)}줄`);
  const engines = last?.engines?.length || 5;
  set(root, 'runs', String(4 * engines)); set(root, 'runsSub', engines === 5 ? '실행 · 안 4 × (엔진 3 + 비교 기준 2)' : `실행 · 안 4 × 엔진 ${engines}`); set(root, 'runN', `${4 * engines}개`);
  if (last) set(root, 'decisions', n0(last.decisions));
  const p = store.get('partner', {}); K(root, 'pw').value = p.weeks || ''; K(root, 'pv').value = p.visits || '';
  const spec = store.get('spec'); if (spec) showSpec(root, spec);
};
function showSpec(root, s) {
  set(root, 'question', s.question); set(root, 'plans', s.plans.map(p => LBL[p]).join(' · '));
  const ex = slot(root, 'excluded');
  ex.innerHTML = (s.excluded || []).map(x => `<div style="display:grid;grid-template-columns:140px minmax(0,1fr);gap:16px;padding:16px 0;border-top:1px solid var(--border)"><span class="lbl" style="padding-top:4px">제외</span><span style="font-size:16px;color:var(--mfg)">${esc(x)}</span></div>`).join('')
    + (s.llm_error ? `<div style="padding:8px 0" class="err">${llmWhy(s.llm_error)}, 규칙으로 정리했습니다.</div>` : '')
    + `<div style="padding:4px 0 0" class="lbl">${s.structured_by === 'rules' ? '규칙으로 정리' : esc(s.structured_by) + '로 정리'}</div>`;
}
VIEWS.brief.after = (el) => {
  const save = () => store.set('partner', { weeks: K(el, 'pw').value.replace(/\D/g, ''), visits: K(el, 'pv').value.replace(/\D/g, '') });
  K(el, 'pw').oninput = K(el, 'pv').oninput = save;
  const go = async () => {
    const b = $('[data-act="brief"]', el); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    const qv = K(el, 'q').value.trim(); store.set('question', qv);
    try { const s = await api('brief', { question: qv }); store.set('spec', s); showSpec(el, s); K(el, 'question').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    catch (e) { slot(el, 'excluded').innerHTML = errBox(e); }
    b.disabled = false; b.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  };
  $('[data-act="brief"]', el).onclick = go;
  K(el, 'q').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } };
};

// S1 엔드포인트
const EP_COL = { '영수증': '#000', '진열 · 전단': '#3B73FF', '가격': '#FCBB00', '센서': '#B8BEC2' };
VIEWS.endpoints = async (root) => {
  const c = await api('catalog');
  set(root, 'households', n0(c.households)); set(root, 'stores', n0(c.stores)); set(root, 'visits', n0(c.visits));
  set(root, 'on', String(c.endpoints.filter(e => e.events != null).length)); set(root, 'wait', String(c.endpoints.filter(e => e.events == null).length));
  slot(root, 'rows').innerHTML = c.endpoints.map(e => `<div class="tr" style="grid-template-columns:52px 180px minmax(0,1fr) 92px;"><span class="" style="min-width:0"><span class="badge">${e.method}</span></span><span class="" style="min-width:0"><span style="display:flex;align-items:center;gap:8px;font-weight:500" class="mono"><span class="sq" style="background:${EP_COL[e.group]};width:8px;height:8px"></span><span style="font-size:13px">${esc(e.path)}</span></span></span><span class="" style="min-width:0"><span class="mono muted" style="font-size:11px">${esc(e.source)}</span></span><span class="r" style="min-width:0"><span class="num" style="font-size:12px;${e.events == null ? 'color:rgba(77,83,83,.6)' : ''}">${e.events == null ? '대기' : n0(e.events)}</span></span></div>`).join('');
};
VIEWS.endpoints.after = (el) => {
  const play = async (basket) => {
    slot(el, 'log').innerHTML = '<span class="spin"></span>';
    try {
      const r = await api('replay' + (basket ? `?basket=${basket}` : ''));
      set(el, 'basket', `basket ${r.basket_id} · ${r.time} · store ${r.store_id} · 가구 ${r.household_id}`);
      const color = e => e.path === '/checkout' ? 'color:#000;font-weight:600' : e.m === 'GET' ? 'color:#3B73FF' : /discount|coupon/.test(e.path) ? 'color:#9a6b00' : 'color:rgba(0,0,0,.85)';
      const money = a => a == null ? '' : `  ${a < 0 ? '-' : ''}$${nf(Math.abs(a))}`;
      slot(el, 'log').innerHTML = r.events.map(e => `<div style="${color(e)}">${esc(`${e.m.padEnd(4)} ${e.path.padEnd(18)} ${e.args}${money(e.amount)}${e.item ? '  ' + e.item : ''}${e.note ? '  · ' + e.note : ''}`)}</div>`).join('');
      const d = r.events.find(e => e.path === '/exposure/display' && / loc=3$/.test(e.args));
      const pid = d && d.args.split(' ')[0].split('=')[1], item = d && r.events.find(e => e.path === '/basket/add' && e.args.startsWith(`product=${pid} `))?.item;
      slot(el, 'quote').innerHTML = d ? `<p style="font-size:15px;line-height:1.7">그 주 Store ${esc(r.store_id)}의 <b style="font-weight:600">앞쪽 엔드캡</b>(진열 코드 3)에 있던 상품: #${esc(pid)}${item ? ' ' + esc(item) : ''}</p>`
        : `<p style="font-size:15px;line-height:1.7">이 방문의 상품은 그 주 Store ${esc(r.store_id)}에서 앞쪽 엔드캡에 없었습니다.</p>`;
    } catch (e) { slot(el, 'log').innerHTML = errBox(e); }
  };
  $('[data-act="replay"]', el).onclick = () => play('random');
  play();
};

// S2 매장 월드
const STATE_ROWS = [['visits', '방문', v => `${n0(v)}회`, 160], ['avg_spend', '평균 장바구니', v => `$${nf(v)}`, 120], ['cereal_visit_rate', '시리얼을 산 방문', pct, 1],
                    ['disc_share', '할인받은 금액 비중', pct, 1], ['private_share', '시리얼 중 자체 브랜드', pct, 1], ['cereal_spend_share', '지출 중 시리얼', pct, .1]];
function personaLine(d) {
  if (!d) return '인구통계 없음 · 이 가구로는 페르소나를 만들 수 없습니다';
  const kids = /no kids/i.test(d.household_comp) ? '자녀 없는' : /kid/i.test(d.household_comp) ? '자녀 있는' : '';
  const age = /\+$/.test(d.age) ? `${d.age.slice(0, -1)}세 이상` : `${d.age.replace('-', '–')}세`;
  const size = String(d.household_size).replace('+', '인 이상').replace(/^(\d+)$/, '$1인');
  return `“${age} · ${kids ? kids + ' ' : ''}${size} 가구 · 소득 ${d.income.replace('K', '천 달러').replace('-', '–')}.”`;
}
VIEWS.world = async (root, params, cleanups) => {
  const stores = await api('stores');
  const sid = params.store || store.get('store', stores[0].store_id);
  const [w, L] = await Promise.all([api(`world?store=${sid}`), api(`layout?store=${sid}`)]);
  const hh = params.hh || (w.households.find(h => h.demographics) || w.households[0]).household_id;
  const d = await api(`household?id=${hh}`).catch(() => null);
  const m = w.map;
  set(root, 'title', `매장 월드 · Store ${sid}`);
  K(root, 'store').innerHTML = stores.map(s => `<option value="${s.store_id}" ${s.store_id === sid ? 'selected' : ''}>Store ${s.store_id}</option>`).join('');
  const caps = m.displays.filter(x => x.condition === 'A_front_endcap').length;
  set(root, 'storeChip', `Store ${sid} · 통로 ${m.aisles.length} · 진열 ${m.displays.length}종 · 계산대 4 · ${m.as_of_week}주 배치`);
  set(root, 'visitsChip', `48–53주 방문 ${n0(w.visits_test)}회 · 가구 ${n0(w.households_test)}`);
  set(root, 'hhBadge', hh);
  const hhs = w.households;
  set(root, 'hhLabel', `가구 ${hh} · 지난 26주 · 행동에서 계산`, false);
  K(root, 'hhLabel').innerHTML = `가구 <select data-k="hhSel" aria-label="가구" class="num" style="font:inherit;border:1px solid var(--border);border-radius:2px;background:#fff;padding:1px 3px">${hhs.map(h => `<option ${h.household_id === hh ? 'selected' : ''}>${h.household_id}</option>`).join('')}</select> · 지난 26주 · 행동에서 계산`;
  const st = d?.state || hhs.find(h => h.household_id === hh)?.state || {};
  slot(root, 'bars').innerHTML = STATE_ROWS.map(([k, lab, f, max]) => `<div style="display:grid;grid-template-columns:150px minmax(0,1fr) 70px;gap:14px;align-items:center;padding:12px 0;border-top:1px solid var(--border)"><span style="font-size:14px">${lab}</span><div class="bar"><i style="width:${Math.min(100, Math.max(1.5, (st[k] || 0) / max * 100)).toFixed(1)}%;background:#171717"></i></div><span class="num r" style="font-size:12px">${f(st[k])}</span></div>`).join('')
    + (d ? `<div style="display:grid;grid-template-columns:150px minmax(0,1fr) 70px;gap:14px;align-items:center;padding:12px 0;border-top:1px solid var(--border)"><span style="font-size:14px">#${d.product.product_id} 구매</span><div class="bar"><i style="width:${Math.max(1.5, Math.min(100, d.state.hp_count * 10))}%;background:#171717"></i></div><span class="num r" style="font-size:12px">${n0(d.state.hp_count)}회</span></div>` : '');
  set(root, 'persona', personaLine(d?.demographics));
  K(root, 'compare').href = `#engines?hh=${hh}`;
  VIEWS.world._data = { sid, hh, L, w };
};
VIEWS.world.after = (el, params, cleanups) => {
  const { sid, hh, L, w } = VIEWS.world._data;
  const perDay = w.visits_test / Math.max(1, w.daily_visits.length);
  const s3 = stage3d(slot(el, 'stage'), { aisles: L.aisles, products: L.products.map(p => ({ ...p, next: p.now, moved: false })) }, { shoppers: Math.max(10, Math.min(30, Math.round(perDay / 2.5))), state: 'now' });
  const inset = mountStore(slot(el, 'inset'), { aisles: L.aisles, products: L.products.map(p => ({ ...p, next: p.now, moved: false })) }, { shoppers: 4, view: 'cereal', rings: false });
  cleanups.push(() => s3.dispose(), () => inset.dispose());
  $$('[data-view]', el).forEach(b => b.onclick = () => { $$('[data-view]', el).forEach(x => x.classList.toggle('on', x === b)); s3.focus(b.dataset.view); });
  K(el, 'store').onchange = e => { pickStore(e.target.value); location.hash = `#world?store=${e.target.value}`; };
  K(el, 'hhSel').onchange = e => { location.hash = `#world?store=${sid}&hh=${e.target.value}`; };
};

// S3 엔진 비교
const ENGINE_ROWS = [['basic', '페르소나', 'GPT · 인구통계 설명', false], ['history', '페르소나 + 이력', 'GPT · 설명 + 구매 이력 숫자', false], ['jev_text', 'Jev · 글', 'jev-1.13 · 학습 없이', false],
                     ['jev_state', 'Jev · 숫자 상태', 'jev-1.13 · 학습 없이', false], ['no_promo', '평소대로 예측', '같은 모델 · 매장 조건 뺌', true], ['calibrated', '보정 모델', '엔드포인트로 학습 · 45–47주 보정', true]];
function engineRow(id, label, note, strong, p, live) {
  const order = ['none', 'A_front_endcap', 'B_mailer_only', 'C_other_display'];
  return `<div class="tr" style="grid-template-columns:minmax(0,1.3fr) repeat(4,minmax(0,1fr));${strong ? 'background:#fff;' : ''}"><span class="" style="min-width:0"><span style="display:flex;flex-direction:column;gap:3px"><span style="display:flex;align-items:center;gap:8px;font-weight:500"><span class="sq" style="background:${(ENG[id] || ['#000'])[0]};width:8px;height:8px"></span>${esc(label)}${live === false ? ' <span class="tag tag-ai">저장된 평가</span>' : live ? ' <span class="tag tag-ok">지금 계산</span>' : ''}</span><span class="mono muted" style="font-size:10px;letter-spacing:.5px;padding-left:16px">${esc(note)}</span></span></span>${order.map(c => `<span class="r" style="min-width:0"><span class="num" style="font-size:13px;${strong ? 'color:#000;font-weight:500' : 'color:var(--mfg)'}">${pct(p[c])}</span></span>`).join('')}</div>`;
}
VIEWS.engines = async (root, params) => {
  const hh = params.hh || '1804';
  const [pairs, d, health] = await Promise.all([api('pairs'), api(`household?id=${hh}${params.product ? `&product=${params.product}` : ''}`), api('health')]);
  const opts = [...new Set([hh, ...pairs.map(p => p.household_id)])];
  K(root, 'hh').innerHTML = opts.map(h => `<option ${h === hh ? 'selected' : ''}>${h}</option>`).join('');
  const pr = d.product;
  set(root, 'prod', `#${pr.product_id}`); set(root, 'visits', String(d.actual.visits)); set(root, 'buys', String(d.actual.bought_this));
  const pname = `${pr.brand === 'Private' ? '자체 브랜드' : pr.brand} ${pr.type.toLowerCase()}(${pr.size.toLowerCase()})`;
  const who = d.demographics ? personaLine(d.demographics).replace(/[“”.]/g, '') : '인구통계가 없는 가구';
  set(root, 'desc', `${who}에게 ${pname}을 이번 장보기에 장바구니에 넣을 확률을 물었습니다.`);
  set(root, 'pq', d.demographics ? `“${who}. 이번 장보기에 ${pname}을 담을 확률은?”` : '“이 가구는 인구통계가 없어 페르소나에게 물을 수 없습니다.”');
  const persona = d.engines.find(e => e.id === 'basic');
  const ppMap = { '평소': 'none', '앞쪽 엔드캡': 'A_front_endcap', '전단': 'B_mailer_only', '기타 진열': 'C_other_display' };
  $$('[data-pp]', root).forEach(x => x.textContent = persona ? pct(persona.p[ppMap[x.dataset.pp]]) : '—');
  set(root, 'pnote', persona ? '그럴듯하고, 조건과 무관하다 · 저장된 평가 답' : '이 가구·상품 쌍은 페르소나 평가 표본에 없습니다');
  const btn = $('[data-act="persona"]', root); if (!health.llm || !d.demographics) btn.remove();
  set(root, 'recLabel', `가구 ${hh}의 영수증 · 48–53주 · 실제`);
  slot(root, 'receipts').innerHTML = d.receipts.slice(0, 5).map(r => `<li style="display:flex;flex-direction:column;gap:4px"><span class="mono" style="font-size:10px;letter-spacing:1px;color:rgba(255,255,255,.65)">STORE ${esc(r.store_id)} · ${esc(r.time)}</span><span style="font-size:15px;line-height:1.6;text-shadow:0 1px 8px rgba(72,0,24,.3)">${r.items}개 · $${nf(r.total)} · ${esc(r.top.join(', '))}${r.bought_this ? ' · <b>이 시리얼</b>' : ''}</span></li>`).join('');
  set(root, 'recFoot', `${d.receipts.length}번 방문 · 이 시리얼 ${d.actual.bought_this}번 · 시리얼 전체 ${d.actual.cereal_visits}번`);
  const byId = Object.fromEntries(d.engines.map(e => [e.id, e]));
  slot(root, 'eng').innerHTML = ENGINE_ROWS.filter(([id]) => byId[id]).map(([id, lab, note, strong]) => engineRow(id, lab, note, strong, byId[id].p, byId[id].live)).join('');
  VIEWS.engines._d = { hh, pr };
};
VIEWS.engines.after = (el) => {
  const { hh, pr } = VIEWS.engines._d;
  K(el, 'hh').onchange = e => location.hash = `#engines?hh=${e.target.value}`;
  const b = $('[data-act="persona"]', el);
  if (b) b.onclick = async () => {
    b.disabled = true; b.innerHTML = '<span class="spin"></span> 묻는 중';
    try {
      const e = await api(`persona?id=${hh}&product=${pr.product_id}`);
      slot(el, 'eng').insertAdjacentHTML('afterbegin', engineRow('persona_live', e.label, e.note, false, e.p, true));
      const ppMap = { '평소': 'none', '앞쪽 엔드캡': 'A_front_endcap', '전단': 'B_mailer_only', '기타 진열': 'C_other_display' };
      $$('[data-pp]', el).forEach(x => x.textContent = pct(e.p[ppMap[x.dataset.pp]]));
      set(el, 'pnote', `방금 ${e.label}에게 다시 물은 답`); b.remove();
    } catch (err) { b.disabled = false; b.textContent = '다시 묻기'; set(el, 'pnote', llmWhy(err.message)); }
  };
};

// S4 결정 안
VIEWS.plans = async (root) => {
  const P = projSpace(), g = await api(`grid/latest?model=${currentModel()}`);
  root.innerHTML = `<div class="hdr"><h1 class="ptitle">시험할 안 · ${esc(P ? P.spaceTitle : '다음 주 콜드 시리얼 · Store 367')}</h1></div>
<p class="body muted" style="margin-top:-8px;max-width:820px">어디에 둘지 세 가지와 전단 세 가지를 곱한 아홉 가지 안입니다. 모두 같은 손님, 같은 방문으로 ${esc(MODEL_TITLE[currentModel()] || 'SimOff-1')} 하나가 시험합니다.</p>
${gridHTML(g, false)}`;
};

// one model, nine plans: where it sits (shelf / in-store display / front endcap) x the flyer (none / inside / front page)
const GRID_ZONE = { shelf: 'none', other: 'C_other_display', front: 'A_front_endcap' };
const currentModel = () => { const m = store.get('decisionModel', 'simoff_retail'); return ['simoff_retail', 'jev_raw', 'persona'].includes(m) ? m : 'simoff_retail'; };
const MODEL_TITLE = { simoff_retail: 'SimOff-1', jev_raw: 'Jev', persona: '언어 모델 페르소나' };
function gridLabels(p) {
  const P = projSpace();
  const d = P ? { shelf: P.plans.none.label, other: P.plans.C_other_display.label, front: P.plans.A_front_endcap.label }[p.display] : p.display_label;
  const m = P ? { none: '홍보 없음', inner: '전단 · 쿠폰 안내', front: '전단 1면' }[p.mailer] : p.mailer_label;
  return [d, m];
}
function crowdPlan(p) { return p.display === 'front' ? 'A_front_endcap' : p.display === 'other' ? 'C_other_display' : p.mailer !== 'none' ? 'B_mailer_only' : 'none'; }
function gridCard(p, g, withNumbers) {
  const [d, m] = gridLabels(p), num = p.per_1000;
  const v = withNumbers ? [`<span class="stat" style="font-size:20px">${num == null ? '—' : num >= 100 ? n0(num) : nf(num)}</span>`, `<span class="lbl" style="text-transform:none">${p.lift == null ? '평가 없음' : `지금 대비 ${nf(p.lift, 1)}배`}</span>`] : ['', ''];
  return `<article class="card run-card grid-card" data-card="${p.id}">
<img class="g9-shot" data-shot="${GRID_ZONE[p.display]}" data-plan="${crowdPlan(p)}" data-group="g:${p.id}" data-lift="${p.lift ?? 1}" alt="${esc(d)} · ${esc(m)} 3D 장면" style="display:block;width:100%;background:#eceeed">
<div class="g9-txt"><div class="g9-l"><span style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;min-width:0"><span class="sq" style="background:${COL[GRID_ZONE[p.display]]};width:8px;height:8px;flex:none"></span>${esc(d)}</span>${v[0]}</div>
<div class="g9-l muted" style="font-size:12px"><span style="display:flex;align-items:center;gap:6px;min-width:0">${p.mailer !== 'none' ? `<span class="sq" style="background:${COL.B_mailer_only};width:7px;height:7px;flex:none"></span>` : ''}${esc(m)}</span>${v[1]}</div></div></article>`;
}
function gridHTML(g, withNumbers) {
  return `<div class="grid9${withNumbers ? '' : ' nonum'}"><span></span>${['shelf', 'other', 'front'].map(d => `<span class="grid9-h">${esc(gridLabels({ display: d, mailer: 'none', display_label: g.plans.find(p => p.display === d).display_label, mailer_label: '' })[0])}</span>`).join('')}
${['none', 'inner', 'front'].map(m => `<span class="grid9-r">${esc(gridLabels({ display: 'shelf', mailer: m, display_label: '', mailer_label: g.plans.find(p => p.mailer === m).mailer_label })[1])}</span>${['shelf', 'other', 'front'].map(d => gridCard(g.plans.find(p => p.display === d && p.mailer === m), g, withNumbers)).join('')}`).join('')}</div>`;
}
function markBestGrid(root, g) {
  $$('.grid-card', root).forEach(c => { const on = c.dataset.card === g.best; c.classList.toggle('best', on); c.classList.toggle('dim', !on); $('.best-badge', c)?.remove(); if (on) c.insertAdjacentHTML('afterbegin', '<span class="best-badge">최선</span>'); });
}

// S5 실행
VIEWS.run = async (root) => {
  const g = await api(`grid/latest?model=${currentModel()}`); VIEWS.run._g = g;
  set(root, 'title', '실행 결과');
  set(root, 'intro', `${MODEL_TITLE[g.model] || g.model} 하나로 아홉 가지 안을 같은 손님, 같은 방문(${n0(g.decisions)}개 결정)에 돌렸습니다. 숫자는 방문 1,000회당 판매.`);
  const meta = K(root, 'decisions')?.closest('.card'); if (meta) meta.remove();
  slot(root, 'engines').innerHTML = gridHTML(g, true); markBestGrid(root, g);
};
VIEWS.run.live = { paused: true };     // the result is in: the cards settle, then hold still
VIEWS.run.after = (el, params) => {
  const gauge = slot(el, 'gauge'), bar = $('.gauge-bar i', gauge), txt = $('.gauge-txt', gauge);
  const rerun = async () => {
    const b = $('[data-act="rerun"]', el); if (b.disabled) return; b.disabled = true; b.textContent = '실행 중';
    $$('.run-card', el).forEach(c => { c.classList.remove('best', 'dim'); $('.best-badge', c)?.remove(); });
    const intro = K(el, 'intro'); gauge.hidden = false; if (intro) intro.hidden = true; bar.style.width = '0%';
    live?.run();
    const t0 = performance.now(), MIN = 4800; let res = null, err = null, done = false;
    api('grid', { model: currentModel(), seed: Math.floor(Math.random() * 1e6) }).then(r => { res = r; }).catch(e => { err = e; }).finally(() => { done = true; });
    await new Promise(resolve => {
      const tick = () => {
        const t = performance.now() - t0;
        const p = done && (err || t >= MIN) ? 1 : done ? Math.max(.9, t / MIN) : Math.min(.9, 1 - Math.exp(-t / 2200));
        bar.style.width = `${(p * 100).toFixed(1)}%`;
        txt.textContent = p >= 1 ? '완료' : `시뮬레이션 중 · ${n0(438325 * p)} / 438,325 결정 × 안 9개`;
        if (p >= 1) return resolve(); setTimeout(tick, 40);   // a timer, not rAF: the gauge must finish even in a background tab
      };
      tick();
    });
    live?.stop();
    if (res) {
      const keep = new Map($$('canvas[data-key]', el).map(c => [c.dataset.key, c]));
      VIEWS.run._g = res; slot(el, 'engines').innerHTML = gridHTML(res, true);
      $$('img[data-shot]', el).forEach(i => { const c = keep.get(i.dataset.group); if (c) i.replaceWith(c); });
      markBestGrid(el, res);
    } else if (err) slot(el, 'engines').insertAdjacentHTML('afterbegin', errBox(err));
    setTimeout(() => { gauge.hidden = true; const i = K(el, 'intro'); if (i) i.hidden = false; }, 900);
    b.disabled = false; b.textContent = '다시 실행';
  };
  $('[data-act="rerun"]', el).onclick = rerun;
  $('[data-act="csv"]', el).onclick = () => {
    const g = VIEWS.run._g, rows = [['model', 'plan', 'display', 'flyer', 'per_1000', 'lift']];
    g.plans.forEach(p => rows.push([g.model, p.id, ...gridLabels(p), p.per_1000 ?? '', p.lift ?? '']));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(x => x.join(',')).join('\n')], { type: 'text/csv' })); a.download = `simoff_${g.model}_${g.id}.csv`; a.click();
  };
  if (params.go) { history.replaceState(null, '', '#run'); setTimeout(rerun, 1200); }
};

// S6 검증
VIEWS.verify = async (root) => {
  const v = await api('validation');
  const pe = v.persona.engines, me = v.model_eval, act = v.persona.actual_rate_by_condition_all_test, L = v.persona.actual_lift_pooled.A_front_endcap;
  // keep the calibration chart from the board, on a plain card
  const chart = $$('.card', root).find(c => c.textContent.includes('보정 곡선'));
  if (chart) { chart.className = 'card'; chart.style.removeProperty('--card-accent'); $('.lbl', chart).textContent = 'SimOff-1이 말한 확률 vs 실제 비율';
    const cap = [...chart.querySelectorAll('p, div')].reverse().find(e => e.textContent.includes('점선')); if (cap) cap.innerHTML = '모델이 "1%"라고 하면 실제로도 1%쯤 샀다는 뜻입니다. 점이 점선에 붙을수록 믿을 만한 확률입니다.'; }
  const M = [{ name: 'SimOff-1', c: '#0F766E', p: pe.calibrated, auc: me.engines.calibrated.auc },
             { name: 'Jev', c: '#6D5BD0', p: pe.jev_state, auc: v.jev.engines.jev_raw.auc },
             { name: '언어 모델 페르소나', c: '#F99C00', p: pe.basic, auc: null }];
  const real = act.none, inBand = x => x >= L.ci95[0] && x <= L.ci95[1];
  const verdict = (ok, txt) => `<span class="tag ${ok ? 'tag-ok' : 'tag-no'}">${txt}</span>`;
  const row = (m, val, v2) => `<div class="vq-row"><span class="vq-m"><span class="sq" style="background:${m.c};width:8px;height:8px"></span>${m.name}</span><span class="vq-v">${val}</span>${v2}</div>`;
  const q = (n, title, sub, realTxt, rows) => `<article class="card vq"><div class="lbl">질문 ${n}</div><h3>${title}</h3><p class="muted">${sub}</p><div class="vq-real"><span>실제</span><b>${realTxt}</b></div>${rows}</article>`;
  root.innerHTML = `<div class="hdr"><h1 class="ptitle">모델 검증</h1></div>
<section><h2 class="display" style="font-size:24px;max-width:820px">결정 모델이 본 적 없는 6주의 실제 구매로 시험했습니다.</h2>
<p class="body muted" style="margin-top:6px;max-width:860px">미국 식료품 체인 2,469가구의 기록 중 마지막 6주(방문 × 상품 ${n0(me.n_test_rows)}건, 실제 구매 ${n0(me.n_test_buys)}건)는 학습에 쓰지 않고 정답으로만 남겼습니다. 세 모델에 같은 질문을 했습니다.</p></section>
<section class="vq-grid">
${q(1, '몇 명이 살지 맞히나', '평소 진열일 때 한 번 들른 손님이 그 상품을 살 확률', pct(real), M.map(m => { const r = m.p.mean_p_by_condition.none / real; return row(m, pct(m.p.mean_p_by_condition.none), r < 1.5 && r > 1 / 1.5 ? verdict(true, '거의 맞음') : verdict(false, `${n0(r)}배 부풀림`)); }).join(''))}
${q(2, '진열하면 얼마나 더 팔릴지 맞히나', '입구 엔드캡에 두면 평소보다 몇 배', `${nf(L.actual, 1)}배 <span class="muted" style="font-weight:400">(${nf(L.ci95[0], 1)}–${nf(L.ci95[1], 1)})</span>`, M.map(m => row(m, `${nf(m.p.lift_A_endcap, 1)}배`, inBand(m.p.lift_A_endcap) ? verdict(true, '범위 안') : verdict(false, '작게 봄'))).join(''))}
${q(3, '누가 살지 먼저 짚나', '살 손님을 안 살 손님보다 높게 놓는 정도 (0.5 = 찍기, 1 = 완벽)', '—', M.map(m => row(m, m.auc == null ? '측정 안 함' : nf(m.auc, 2), m.auc == null ? '' : `<span class="vq-bar"><i style="width:${Math.max(0, (m.auc - .5) * 200).toFixed(0)}%;background:${m.c}"></i></span>`)).join(''))}
</section>
<section class="vq-bottom"><div data-slot="chart"></div>
<div><div class="lbl">정리</div><ul class="vq-list"><li><b>SimOff-1</b> 은 실제 구매 수준과 진열 효과를 모두 실제 범위 안에서 맞혔습니다.</li><li><b>Jev</b> 는 누가 살지 순위는 꽤 짚지만, 구매 확률을 수십 배 부풀리고 진열 효과를 작게 봅니다.</li><li><b>언어 모델 페르소나</b> 는 그럴듯하게 답하지만 구매를 약 200배 부풀리고, 진열이 달라져도 답이 거의 같습니다.</li></ul></div>
<div><div class="lbl">아직 판정하지 못한 것</div><ul class="vq-list muted"><li>전단 효과 — 같은 주에 전단을 안 한 매장이 없어 비교할 수 없음</li><li>할인 — 사지 않은 방문의 가격이 기록에 없음</li></ul></div></section>`;
  if (chart) slot(root, 'chart').replaceWith(chart);
};

// 모델 체험: say who, what and where in a sentence; the model's input, its output (JSON) and what moves the answer
const PG_TYPE = { 'KIDS CEREAL': '어린이 시리얼', 'ALL FAMILY CEREAL': '가족용 시리얼', 'ADULT CEREAL': '성인용 시리얼' };
const pgProd = p => p ? `${PG_TYPE[p.type] || p.type} ${p.size.toLowerCase()} · $${nf(p.price)}` : '';
const PG_D = { shelf: '평소 선반', other: '매장 안 보조 진열', front: '입구 엔드캡' }, PG_M = { none: '전단 없음', inner: '전단 안쪽 면', front: '전단 1면' };
const PG_IN = [['visits', v => `반년 방문 ${n0(v)}회`], ['avg_spend', v => `장볼 때 $${n0(v)}`], ['cereal_visit_rate', v => `시리얼 사는 방문 ${Math.round(v * 100)}%`],
  ['cereal_spend_share', v => `지출 중 시리얼 ${nf(v * 100, 1)}%`], ['disc_share', v => `할인 상품 ${Math.round(v * 100)}%`], ['private_share', v => `자체 브랜드 ${Math.round(v * 100)}%`], ['hp_count', v => `이 상품 산 횟수 ${v}회`]];
const PG_EXAMPLES = ['주 2번 오는 시리얼 단골이, 입구 엔드캡에 어린이 시리얼이 있으면 살까?',
  '한 달에 한 번 오고 할인 상품만 찾는 손님에게 가족용 시리얼을 전단 1면에 실으면 어때?',
  '같은 평균 손님에게 성인용 시리얼을 평소 선반에 둘 때와 입구 엔드캡에 둘 때를 비교해 줘.'];
const PG = (() => { try { return JSON.parse(sessionStorage.getItem('oa:pg')) || { turns: [] }; } catch { return { turns: [] }; } })();
const pgSave = () => { try { sessionStorage.setItem('oa:pg', JSON.stringify(PG)); } catch {} };
VIEWS.try = async () => { VIEWS.try._prods = await api('decide/products'); };
VIEWS.try.after = (el, params, cleanups) => {
  const thread = slot(el, 'thread'), ta = K(el, 'ask'), sendB = $('[data-act="send"]', el), prods = VIEWS.try._prods;
  const prodOf = id => prods.find(p => p.product_id === id);
  let history = [], busy = false, current = null;
  slot(el, 'examples').innerHTML = PG_EXAMPLES.map(t => `<button type="button" data-ex>${esc(t)}</button>`).join('');
  $$('[data-ex]', el).forEach(b => b.onclick = () => send(b.textContent));
  const caseName = c => c.label || `${pgProd(prodOf(c.response.input.product_id))} · ${PG_D[c.response.input.display]}`;
  function show(c, allCases) {
    current = c; const r = c.response, i = r.input;
    set(el, 'outTitle', `SimOff-1의 답 · ${caseName(c)}`);
    const cs = slot(el, 'cases');
    cs.hidden = !(allCases && allCases.length > 1);
    if (allCases && allCases.length > 1) {
      cs.innerHTML = allCases.map((x, k) => `<button type="button" class="pg-chip${x === c ? ' on' : ''}" data-case="${k}"><b>${esc(caseName(x))}</b>${nf(x.response.p_buy * 100, 2)}%</button>`).join('');
      $$('[data-case]', cs).forEach(b => b.onclick = () => show(allCases[+b.dataset.case], allCases));
    }
    const said = new Set(Object.keys(c.request));
    const chips = [...PG_IN.map(([k, f]) => [k, f(i[k])]), ['product_id', pgProd(prodOf(i.product_id))], ['display', PG_D[i.display]], ['mailer', PG_M[i.mailer]]]
      .map(([k, t]) => `<span style="${said.has(k) ? 'background:#171717;color:#fff' : ''}">${esc(t)}</span>`).join('');
    const top = Math.max(...r.drivers.flatMap(d => [d.p_low, d.p_high]), r.p_buy) * 1.08, X = p => (p / top * 100).toFixed(1);
    const D = ['shelf', 'other', 'front'], M = ['none', 'inner', 'front'], gmax = Math.max(...r.all_conditions.map(x => x.p));
    slot(el, 'view').innerHTML = `<div class="lbl">모델이 받은 입력 <span class="muted" style="text-transform:none;letter-spacing:0">· 검은 칸은 문장에서 읽은 값, 나머지는 평균 손님 값</span></div><div class="pg-in-row">${chips}</div>
<div class="pg-big" style="margin-top:18px"><span>${nf(r.p_buy * 100, 3)}%</span><span class="pg-big-s">이번 방문에 살 확률 · ${n0(1 / r.p_buy)}번 들르면 한 번꼴</span></div>
<div class="pg-stats"><div><span class="lbl">방문 1,000회당</span><b>${nf(r.per_1000_visits, 2)}개</b></div><div><span class="lbl">평소 선반 · 전단 없음 대비</span><b>×${nf(r.lift_vs_shelf, 2)}</b></div><div><span class="lbl">같은 조건의 평균 손님 대비</span><b>×${nf(r.p_buy / r.average_customer_p, 2)}</b></div></div>
<div class="lbl" style="margin-top:22px">무엇이 확률을 움직이나 <span class="muted" style="text-transform:none;letter-spacing:0">· 한 가지만 낮게 → 높게 바꿨을 때, 세로선은 지금</span></div>
<div style="margin-top:6px">${r.drivers.map(d => { const lo = Math.min(d.p_low, d.p_high), hi = Math.max(d.p_low, d.p_high);
      return `<div class="pg-drv"><span>${esc(d.label)}</span><span class="trk"><i style="left:${X(lo)}%;width:${Math.max(.8, X(hi) - X(lo))}%"></i><em style="left:${X(r.p_buy)}%"></em></span><span class="v">${nf(d.p_low * 100, 2)} → ${nf(d.p_high * 100, 2)}%</span></div>`; }).join('')}</div>
<div class="lbl" style="margin-top:22px">같은 손님 · 같은 상품, 매장 조건 아홉 가지 <span class="muted" style="text-transform:none;letter-spacing:0">· 방문 1,000회당</span></div>
<div class="pg-grid"><span></span>${D.map(d => `<span>${PG_D[d]}</span>`).join('')}${M.map(m => `<span>${PG_M[m]}</span>` + D.map(d => {
      const x = r.all_conditions.find(y => y.display === d && y.mailer === m);
      return `<button type="button" class="pg-cell${d === i.display && m === i.mailer ? ' on' : ''}" data-cell="${d}:${m}" style="background:rgba(15,118,110,${(.06 + .5 * x.p / gmax).toFixed(3)})"><b>${nf(x.p * 1000, 2)}</b><span class="muted" style="font-size:11px">×${nf(x.lift, 2)}</span></button>`; }).join('')).join('')}</div>`;
    $$('[data-cell]', el).forEach(b => b.onclick = async () => {
      const [display, mailer] = b.dataset.cell.split(':'), req = { ...c.request, display, mailer };
      show({ label: `${caseName(c).split(' · ')[0]} · ${PG_D[display]} · ${PG_M[mailer]}`, request: req, response: await api('decide', req) }, null);
    });
    const slim = { ...r, all_conditions: r.all_conditions.map(x => ({ display: x.display, mailer: x.mailer, p: +x.p.toFixed(6), lift: +x.lift.toFixed(3) })),
      drivers: r.drivers.map(d => ({ field: d.field, low: d.low, high: d.high, p_low: +d.p_low.toFixed(6), p_high: +d.p_high.toFixed(6) })) };
    set(el, 'json', `POST /api/decide\n${JSON.stringify(c.request, null, 2)}\n\n→ 200\n${JSON.stringify(slim, null, 2)}`);
  }
  function bubble(role, html) {
    slot(el, 'hello')?.remove(); $('[data-act="reset"]', el).hidden = false;
    const d = document.createElement('div'); d.className = `msg ${role}`;
    d.innerHTML = role === 'user' ? `<div class="bub">${html}</div>` : `<span class="ava" aria-hidden="true"><i></i><i></i><i></i></span><div class="body">${html}</div>`;
    thread.appendChild(d); thread.scrollTop = thread.scrollHeight; return d;
  }
  function answer(ai, t) {
    $('.body', ai).innerHTML = rich(t.reply) + (t.calls.length ? `<div class="pg-chips">${t.calls.map((c, k) => `<button type="button" class="pg-chip" data-call="${k}"><b>${esc(caseName(c))}</b>${nf(c.response.p_buy * 100, 2)}%</button>`).join('')}</div>` : '');
    $$('[data-call]', ai).forEach(b => b.onclick = () => { $$('.pg-chip', thread).forEach(x => x.classList.remove('on')); b.classList.add('on'); show(t.calls[+b.dataset.call], t.calls); });
    $('[data-call]', ai)?.classList.add('on');
    if (t.calls.length) show(t.calls[0], t.calls);
  }
  async function send(text) {
    text = (text || '').trim(); if (!text || busy) return;
    busy = true; sendB.disabled = true; ta.value = '';
    bubble('user', esc(text)); history.push({ role: 'user', text });
    const ai = bubble('ai', '<div class="typing" aria-label="생각하는 중"><i></i><i></i><i></i></div>');
    try {
      const r = await api('decide/chat', { history });
      history.push({ role: 'assistant', text: r.reply });
      PG.turns.push({ user: text, reply: r.reply, calls: r.calls }); pgSave();
      answer(ai, r);
    } catch (e) { $('.body', ai).innerHTML = errBox(e); history.pop(); }
    busy = false; sendB.disabled = false; thread.scrollTop = thread.scrollHeight;
  }
  sendB.onclick = () => send(ta.value);
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ta.value); } };
  $('[data-act="reset"]', el).onclick = () => { PG.turns = []; pgSave(); render(); };
  $$('[data-out]', el).forEach(b => b.onclick = () => { $$('[data-out]', el).forEach(x => x.classList.toggle('on', x === b)); slot(el, 'view').hidden = b.dataset.out !== 'view'; slot(el, 'json').hidden = b.dataset.out !== 'json'; });
  for (const t of PG.turns) { bubble('user', esc(t.user)); history.push({ role: 'user', text: t.user }, { role: 'assistant', text: t.reply }); answer(bubble('ai', ''), t); }
};

// 최종 배치 (3D)
function stat(v, l, sub) { return `<div style="display:flex;flex-direction:column;gap:8px;padding:16px 0;border-top:1px solid var(--border)"><span class="lbl">${l}</span><span class="stat">${v}</span><span class="muted" style="font-size:12px">${sub}</span></div>`; }
VIEWS.layout = async (root, params) => {
  const P = projSpace(); VIEWS.layout._P = P;
  if (P) {
    const g = await api(`grid/latest?model=${currentModel()}`);
    const ranked = g.plans.filter(p => p.per_1000 != null).sort((a, b) => b.per_1000 - a.per_1000), best = ranked[0], base = g.plans.find(p => p.id === 'shelf_none');
    const name = p => gridLabels(p).join(' + '), fxOf = p => ({ front: P.plans.A_front_endcap.fx, other: P.plans.C_other_display.fx }[p.display] || null);
    VIEWS.layout._fx = Object.fromEntries(g.plans.map(p => [p.id, fxOf(p)]));
    VIEWS.layout._best = best.id;
    root.innerHTML = `<div class="hdr"><h1 class="ptitle">최종 배치 · ${esc(P.spaceTitle)}</h1></div>
<section class="fit-screen"><div class="fit-stage" style="position:relative;overflow:hidden;border:1px solid var(--border);background:var(--card)"><div data-slot="pstage" style="width:100%;height:100%"></div>
<div style="position:absolute;left:16px;top:16px"><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">제안: ${esc(name(best))}</span></div></div>
<aside class="fit-side"><div><div class="lbl">${esc(P.title.length > 60 ? P.title.slice(0, 60) + '…' : P.title)}</div><h2 class="display" style="margin-top:8px;font-size:22px;line-height:1.35">제안: ${esc(name(best))}. 판매가 지금의 ${nf(best.lift, 1)}배.</h2></div>
<div class="stats4">${stat(`×${nf(best.lift, 1)}`, '지금 그대로 대비', `방문 1,000회당 ${nf(base.per_1000)} → ${nf(best.per_1000)}`)}${stat(`+${nf(best.per_1000 - base.per_1000)}`, '방문 1,000회당 추가 판매', MODEL_NOTE)}</div>
<div class="tbl fit-list"><div class="th" style="grid-template-columns:minmax(0,1fr) 70px"><span>안</span><span class="r">1,000회당</span></div>${ranked.map(p => `<button type="button" class="tr list-btn" data-plan="${p.id}" style="display:grid;grid-template-columns:minmax(0,1fr) 70px;gap:10px;align-items:center;padding:12px 14px;border-top:1px solid rgba(216,221,223,.7);width:100%"><span style="display:flex;align-items:center;gap:8px;font-size:13px"><span class="sq" style="background:${COL[GRID_ZONE[p.display]]};width:8px;height:8px"></span>${esc(name(p))}${p.id === best.id ? ' <span class="tag tag-ok">최선</span>' : ''}</span><span class="num r" style="font-size:12px">${nf(p.per_1000)}</span></button>`).join('')}</div>
</aside></section>`;
    return;
  }
  const stores = await api('stores');
  const sid = params.store || store.get('store', stores[0].store_id);
  const L = await api(`layout?store=${sid}`);
  const cur = L.plans.current, nxt = L.plans.proposed, V = L.validation, LB = c => c === 'none' ? '선반' : LBL[c];
  const moved = L.products.filter(p => p.moved).sort((a, b) => b.gain - a.gain);
  set(root, 'title', `최종 배치 · Store ${sid} · 시리얼 ${L.products.length}개`); set(root, 'asOf', `${L.as_of}주 배치`);
  K(root, 'store').innerHTML = stores.map(s => `<option value="${s.store_id}" ${s.store_id === sid ? 'selected' : ''}>Store ${s.store_id}</option>`).join('');
  set(root, 'chip1', `제안 배치 · ${L.as_of}주까지 보고 결정 · ${L.weeks.join('–')}주 시뮬레이션`);
  set(root, 'chip2', `자리 · 앞쪽 엔드캡 ${L.capacity.A_front_endcap} · 기타 진열 ${L.capacity.C_other_display}`);
  set(root, 'lbl', `${L.weeks.join('–')}주에 실제로 온 손님 ${n0(L.visits)}회 방문으로 시뮬레이션`);
  set(root, 'h2', `상품 ${moved.length}개를 옮기면, 판매 방문이 ${nf(cur.expected_units, 1)}에서 ${nf(nxt.expected_units, 1)}로.`);
  slot(root, 'stats').innerHTML = stat(`×${nf(nxt.lift)}`, `지금(${L.as_of}주) 배치 대비`, `판매 방문 ${nf(cur.expected_units, 1)} → ${nf(nxt.expected_units, 1)}`)
    + stat(`${nxt.extra_revenue >= 0 ? '+' : '-'}$${nf(Math.abs(nxt.extra_revenue))}`, '6주 기대 매출 차이', '할인 전 가격 기준')
    + stat(`${Math.round(nxt.share_of_draws_above_baseline * 100)}%`, '지금보다 더 팔릴 확률', '같은 손님으로 200번 다시 돌려 본 결과')
    + stat(`${V.actual} / ${nf(V.expected, 1)}`, '이 매장 실제 판매 / 모델', '지금 배치 그대로 6주');
  slot(root, 'tags').innerHTML = `<span class="tag tag-ok">엔드캡 효과 · 시뮬레이터가 실제 범위 안</span><span class="tag ${V.in_band ? 'tag-ok' : 'tag-no'}">이 매장 6주 판매 ${V.actual}건 · ${V.in_band ? '범위 안' : '범위 밖'}</span>`;
  slot(root, 'moves').innerHTML = moved.map(p => `<button type="button" class="tr list-btn" data-id="${p.id}" style="display:grid;grid-template-columns:26px minmax(0,1fr) 64px;gap:10px;align-items:center;padding:10px 14px;border-top:1px solid rgba(216,221,223,.7);width:100%"><span class="num" style="font-size:11px;text-align:center;border-radius:2px;background:${COL[p.next]};color:${p.next === 'A_front_endcap' ? '#fff' : '#000'};padding:1px 0">${p.n}</span><span style="min-width:0"><span style="display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)} ${esc(p.size)}</span><span class="muted" style="display:block;font-size:11px;margin-top:2px">${LB(p.now)} → <b style="color:#000;font-weight:500">${LB(p.next)}</b></span></span><span class="num r" style="font-size:12px">${p.gain ? '+$' + nf(p.gain) : '자리 양보'}</span></button>`).join('');
  VIEWS.layout._L = L;
};
VIEWS.layout.after = (el, params, cleanups) => {
  const P = VIEWS.layout._P;
  if (P) {
    const s = mountSpace(slot(el, 'pstage'), { glb: P.glb, space: P.space, ops: P.ops, people: P.people }, { maxPeople: 40 });
    cleanups.push(() => s.dispose());
    const show = id => { s.setHighlight(VIEWS.layout._fx[id]); $$('[data-plan]', el).forEach(b => b.classList.toggle('on', b.dataset.plan === id)); };
    s.ready().then(() => show(VIEWS.layout._best));
    $$('[data-plan]', el).forEach(b => b.onclick = () => show(b.dataset.plan));
    return;
  }
  const L = VIEWS.layout._L;
  const s3 = stage3d(slot(el, 'stage'), { aisles: L.aisles, products: L.products }, { state: 'now', shoppers: 14, weeks: L.weeks.join('–') });
  cleanups.push(() => s3.dispose());
  const setSt = st => { s3.go(st); $$('[data-st]', el).forEach(b => b.classList.toggle('on', b.dataset.st === st)); };
  $$('[data-st]', el).forEach(b => b.onclick = () => s3.state !== b.dataset.st && setSt(b.dataset.st));
  const cb = $('[data-act="cereal"]', el); let close = false;
  cb.onclick = () => { close = !close; cb.classList.toggle('on', close); s3.focus(close ? 'cereal' : 'store'); };
  K(el, 'store').onchange = e => { pickStore(e.target.value); location.hash = `#layout?store=${e.target.value}`; };
  $$('.list-btn', el).forEach(b => b.onclick = () => { const on = s3.select(b.dataset.id); $$('.list-btn', el).forEach(x => x.classList.toggle('on', on && x === b)); });
  const t = setTimeout(() => setSt('next'), 900); cleanups.push(() => clearTimeout(t));
};

// S7 리포트
VIEWS.report = async (root) => {
  const [r, last] = await Promise.all([api('report'), api('run/latest')]);
  const N = r.numbers, eff = r.effects;
  const extra = N.per_1000_with - N.per_1000_without, usd = extra * N.median_shelf_price_usd;
  set(root, 'title', '리포트');
  set(root, 'lead', `엔드캡에 두면 평소보다 약 ${nf(eff.A_front_endcap.simulated.calibrated, 1)}배 팔린다고 봅니다. 실제로 엔드캡이었던 매장들에서 잰 효과(${nf(eff.A_front_endcap.actual.lift, 1)}배) 범위 안이고, 실제보다 약간 낮게 보는 편이라 보수적인 추정입니다.`);
  set(root, 'per1000', `${nf(N.per_1000_without)} → ${nf(N.per_1000_with)}개`);
  set(root, 'usd', `$${nf(usd, 1)}`); set(root, 'usdSub', `추가 ${nf(extra, 1)}개 × 중간 가격 $${nf(N.median_shelf_price_usd)} · 패널 가구 기준`);
  const p = store.get('partner', {}), weeks = +p.weeks || 0, visits = +p.visits || 0;
  const card = (label, val, sub) => `<article class="d3 grad ink"><div class="mono" style="font-size:9px;letter-spacing:1.3px;text-transform:uppercase;color:rgba(255,255,255,.45)">${label}</div><div class="mono" style="margin-top:22px;font-size:28px;line-height:1;letter-spacing:-.04em">${val}</div><div style="margin-top:18px;padding-top:12px;border-top:1px solid rgba(255,255,255,.12);font-size:12px;line-height:1.5;color:rgba(255,255,255,.62)">${sub}</div></article>`;
  slot(root, 'partner').innerHTML = weeks && visits ? card('매장 실험 대신 지금 결정하면', `$${n0(weeks * visits / 1000 * usd)}`, `실험 ${weeks}주 × 주당 방문 ${n0(visits)} × 1,000회당 $${nf(usd, 1)} · 그 기간 엔드캡을 안 썼다면 놓쳤을 추가 매출`)
    : card('매장 실험 대신 지금 결정하면', '—', '<a href="#brief" style="color:#fff">결정 브리프</a>에서 실험 기간과 주당 방문 수를 넣으면 계산합니다');
  slot(root, 'segments').innerHTML = N.segments.map((s, i) => `<div class="tr" style="grid-template-columns:minmax(0,1fr) 90px 120px;${i === 1 ? 'background:#fff;' : ''}"><span class="" style="min-width:0">${esc(s.segment)}</span><span class="r" style="min-width:0"><span class="num" style="font-size:12px">${nf(s.lift, 1)}배</span></span><span class="r" style="min-width:0"><span class="num" style="font-size:12px">+${nf(s.extra_per_1000, 1)}</span></span></div>`).join('');
  set(root, 'share', `${Math.round((N.segments.find(s => s.segment.includes('없는'))?.share_of_extra || 0) * 100)}%`);
};
function relabelText(root, map) {          // swap the example's plan names for the project's, in every text node
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) { let t = n.nodeValue; for (const [a, b] of map) t = t.split(a).join(b); if (t !== n.nodeValue) n.nodeValue = t; }
}
VIEWS.report.after = (el) => {
  const P = projSpace();
  const ok = store.get('approved'); if (ok) slot(el, 'approve').innerHTML = `<span class="tag tag-ok" style="height:32px;padding:0 12px">승인됨 · ${esc(ok)}</span> <button type="button" class="btn btn-ghost btn-sm" data-act="undo">취소</button>`;
  if (P) {
    const h2 = $('h2.display', el); if (h2) h2.innerHTML = `${esc(P.spaceTitle)}, ${esc(P.plans.A_front_endcap.label)}.`;
    relabelText(el, [['다음 주 콜드 시리얼', P.spaceTitle], ['앞쪽 엔드캡', P.plans.A_front_endcap.label], ['기타 진열', P.plans.C_other_display.label], ['평소대로', P.plans.none.label], ['전단', P.plans.B_mailer_only.label]]);
    const lead = K(el, 'lead'); if (lead) lead.textContent = `${P.plans.A_front_endcap.label}에 두면 지금보다 판매가 늘 것으로 봅니다. ${MODEL_NOTE} — 이 공간의 기록이 오면 다시 보정합니다.`;
  }
  const a = $('[data-act="approve"]', el); if (a) a.onclick = () => { store.set('approved', new Date().toLocaleString('ko-KR')); render(); };
  const u = $('[data-act="undo"]', el); if (u) u.onclick = () => { store.set('approved', null); render(); };
  $('[data-act="pdf"]', el).onclick = () => print();
  $('[data-act="share"]', el).onclick = async (e) => { try { await navigator.clipboard.writeText(location.href); e.currentTarget.lastChild.textContent = ' 복사됨'; } catch { prompt('링크', location.href); } };
};

// S8 매장 연결
VIEWS.connect = async (root) => {
  const P = projSpace(), pr = store.get('project');
  set(root, 'mapName', P ? P.spaceTitle : `${pr?.kind === 'mart' ? '마트' : '매장'} · Store ${store.get('store', '367')}`);
  if (P) { const s = $('[data-act="sample"]', root); if (s) s.textContent = '샘플 기록으로 계속 (마트 데이터)'; }
  VIEWS.connect._P = P; VIEWS.connect._d = P ? null : await storeData();
};
VIEWS.connect.after = (el) => {
  let files = {};
  const job = slot(el, 'job'), P = VIEWS.connect._P, host = slot(el, 'cstage');
  let map = P ? mountSpace(host, { glb: P.glb, space: P.space, ops: P.ops, people: P.people }, { maxPeople: 40 })
    : stage3d(host, { aisles: VIEWS.connect._d.aisles, products: VIEWS.connect._d.products }, { shoppers: 12, weeks: VIEWS.connect._d.L.weeks.join('–') });
  cleanups.push(() => map.dispose());
  const mapRows = m => m.columns.map(c => `<div class="tr" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr) 140px;"><span class="" style="min-width:0"><span class="num" style="font-size:12px;">${esc(c.column)}</span></span><span class="" style="min-width:0"><span class="mono" style="font-size:12px">${esc(c.endpoint || '—')}</span></span><span class="r" style="min-width:0">${c.field ? `<span class="tag tag-ok">연결됨${c.field === 'household_id' ? ' · 비식별' : ''}</span>` : '<span class="tag" style="background:rgba(0,0,0,.06)">쓰지 않음</span>'}</span></div>`).join('')
    + (files.placements ? '' : `<div class="tr" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr) 140px;"><span class="" style="min-width:0"><span class="num" style="font-size:12px;color:rgba(77,83,83,.6)">(없음)</span></span><span class="" style="min-width:0"><span class="mono" style="font-size:12px">GET /exposure/display</span></span><span class="r" style="min-width:0"><span class="tag" style="background:#f6ebd3;color:#6b4a00">진열 일정표 필요</span></span></div>`);
  async function send(name) {
    if (!files.transactions) { job.style.display = 'block'; job.innerHTML = errBox('영수증 CSV가 필요합니다. 파일 이름에 transactions 또는 receipt가 없으면 첫 번째 파일을 영수증으로 씁니다.'); return; }
    job.style.display = 'block'; job.innerHTML = '<div class="loading"><span class="spin"></span> 올리는 중</div>';
    try {
      let j = await api('connect', files);
      set(el, 'mapTitle', `자동 매핑 · ${name}`);
      for (;;) {
        const m = j.mapping; set(el, 'mapCount', `${m.columns.length}개 열 중 <b style="color:#000">${m.columns.filter(c => c.field).length}</b>개 연결`, true); slot(el, 'map').innerHTML = mapRows(m);
        const busy = j.status === 'running' || j.status === 'mapping';
        job.innerHTML = `<div class="card cn-job">${busy ? '<span class="spin"></span>' : j.status === 'done' ? '<span class="tag tag-ok">완료</span>' : `<span class="tag tag-no">${esc(j.status)}</span>`}<span style="min-width:0">${j.error ? `<span class="err">${esc(j.error)}</span>` : busy ? `<b style="font-weight:500">보정하는 중</b> <span class="mono muted" style="font-size:11px">${esc((j.log || []).slice(-1)[0] || '시작하는 중')}</span>` : `SimOff-1을 이 기록의 손님으로 보정했습니다. 다음 단계에서 안을 비교합니다.`}</span></div>`;
        set(el, 'mapState', busy ? '보정 중' : j.status === 'done' ? 'SimOff-1 · 이 기록으로 보정됨' : '기록 연결 전');
        if (!busy) break;
        await new Promise(r => setTimeout(r, 2000)); j = await api(`job?id=${j.id}`);
      }
      if (j.layout && !P) {      // a grocery store: the map turns to the proposed placement for the next four weeks
        const L = j.layout; map.dispose();
        map = stage3d(host, { aisles: L.aisles, products: L.products }, { shoppers: 12, weeks: L.weeks.join('–') });
        setTimeout(() => map.go('next'), 800);
        set(el, 'mapState', `앞으로 4주 제안 배치 · 판매 방문 ${nf(L.plans.current.expected_units, 1)} → ${nf(L.plans.proposed.expected_units, 1)}`);
      }
    } catch (e) { job.innerHTML = errBox(e); }
  }
  const take = async (list) => {
    files = {};
    for (const f of list) {
      const t = await f.text(), n = f.name.toLowerCase();
      if (/placement|promo|display/.test(n)) files.placements = t; else if (/product|item_master|catalog/.test(n)) files.products = t; else if (!files.transactions) files.transactions = t;
    }
    set(el, 'files', [...list].map(f => f.name).join(' · '));
    send([...list][0]?.name || 'upload.csv');
  };
  K(el, 'file').onchange = e => take(e.target.files);
  const drop = $('[data-drop]', el);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files); };
  $('[data-act="sample"]', el).onclick = async () => {
    job.style.display = 'block'; job.innerHTML = '<div class="loading"><span class="spin"></span> 예시 POS 파일 만드는 중</div>';
    const s = await api('sample?store=367'); files = { transactions: s.transactions, products: s.products, placements: s.placements };
    set(el, 'files', 'store_367_pos.csv · products.csv · placements.csv'); send('store_367_pos.csv');
  };
};

boot(); render();
