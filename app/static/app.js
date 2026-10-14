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
const LBL = { A_front_endcap: 'Front endcap', B_mailer_only: 'Flyer', C_other_display: 'Secondary display', none: 'As usual' };
const COL = { A_front_endcap: '#3B73FF', B_mailer_only: '#FCBB00', C_other_display: '#88ACFA', none: '#B8BEC2' };
const PLANS = ['A_front_endcap', 'B_mailer_only', 'C_other_display', 'none'];
const ENG = { calibrated: ['#0F766E', '#0F766E'], jev_calibrated: ['linear-gradient(90deg,#6D5BD0 50%,#0F766E 50%)', '#6D5BD0'], persona: ['#F99C00', '#F99C00'],
              no_promo: ['#B8BEC2', '#4d5353'], avg_lift: ['#4d5353', '#4d5353'], basic: ['#F99C00'], history: ['#FCC870'], jev_text: ['#B4A8F0'], jev_state: ['#6D5BD0'], persona_live: ['#F99C00'] };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem('oa:' + k)) ?? d; } catch { return d; } },
                set(k, v) { try { localStorage.setItem('oa:' + k, JSON.stringify(v)); } catch {} } };
const arrowSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

// Hosted (not localhost): read-only answers are precomputed files and only the chats and the single-visit model answer
// run as functions; see build_vercel.py. The run's "run again" reuses the precomputed grid (its per-1,000 numbers do
// not depend on the seed) and connecting records returns the finished sample calibration.
const STATIC = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const staticPath = p => p.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const FN = { chat: 'chat', decide: 'decide', 'decide/chat': 'decide_chat' };
async function api(path, body) {
  if (STATIC) {
    if (path === 'grid' && body !== undefined) return { ...(await api(`grid/latest?model=${body.model}`)), seed: body.seed, id: Math.random().toString(16).slice(2, 10) };
    if (path === 'connect' && body !== undefined) return api('connect');
    if (body !== undefined && !FN[path]) throw new Error('Not available in the hosted demo');
    if (body === undefined) {
      const r = await fetch(`/static-api/${staticPath(path)}.json`);
      if (!r.ok) throw new Error('Not available in the hosted demo');
      return r.json();
    }
    path = FN[path];
  }
  const r = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `Couldn't read the server response (${r.status})` }));
  if (!r.ok || j?.error) throw new Error(j?.error || r.statusText);
  return j;
}
const tplCache = {};
const template = id => tplCache[id] ??= fetch(`screens/${id}.html`).then(r => r.text());
const K = (root, k) => root.querySelector(`[data-k="${k}"]`);
function set(root, k, v, html = false) { const e = K(root, k); if (e) html ? e.innerHTML = v : e.textContent = v; return e; }
const slot = (root, n) => root.querySelector(`[data-slot="${n}"]`);
const llmWhy = m => /insufficient_quota|credit_balance_exhausted/.test(m) ? 'The language model was unavailable: OpenAI credits ran out' : /429/.test(m) ? 'The language model was unavailable: OpenAI rate limit hit (429)' : `Language model call failed (${esc(m)})`;
const errBox = e => `<div class="errbox" role="alert">${esc(e.message || e)}</div>`;

const tip = $('#tip');
function showTip(html, x, y) { tip.innerHTML = html; tip.hidden = false; tip.style.left = Math.min(x + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(y + 14, innerHeight - tip.offsetHeight - 8) + 'px'; }
const hideTip = () => { tip.hidden = true; };
function productTip(p, state, weeks) {
  const on = state === 'next' ? p.next : p.now, name = c => c === 'none' ? 'Shelf' : LBL[c];
  const rows = p.units && Object.keys(p.units).length ? `<table>${['none', 'A_front_endcap', 'C_other_display'].map(o => `<tr class="${o === on ? 'on' : ''}"><td>${name(o)}</td><td>${nf(p.units[o])}</td></tr>`).join('')}</table><span style="color:#4d5353">Expected sales visits · weeks ${weeks || '48–53'}</span>` : '';
  return `<b>${p.n}. ${esc(p.name)} ${esc(p.size)}</b><br>${p.moved ? `${name(p.now)} → <b>${name(p.next)}</b>` : name(on)}${p.mailer ? ' · flyer' : ''}${rows}`;
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
  const T = (rl?.label && !mv ? rl.label.replace(/^[^:：]{1,16}[:：]\s*/, '') : target?.label) || 'Featured item';
  return { kind: 'space', title: business || sp.title, spaceTitle: sp.title.split(' — ')[0], glb: r.glb, space: sp, ops, people: st.place.people,
    plans: { A_front_endcap: { label: `${T} · near the entrance`, desc: 'The first spot people see as they walk in', fx: target?.id },
             B_mailer_only: { label: 'Flyer · coupon', desc: 'Leave the space as it is and promote outside', fx: null },
             C_other_display: { label: `${T} · inner spot`, desc: 'A secondary spot further inside', fx: inner?.id },
             none: { label: 'As it is', desc: 'Baseline', fx: null } } };
}
const MODEL_NOTE = 'SimOff-1 · estimated from grocery data';
// the close of every step: one line on what this step settled, and the way to the next
const STEP_FOOT = {
  connect: ['Calibrated to People, not to Answers.', 'Not the odds that an answer is right, but the odds that this space\'s shoppers actually do it. Anywhere people come, go and choose is calibrated the same way.', '#plans', 'Next: Plans to test'],
  plans: ['Nine plans, the same shoppers.', 'Every plan is compared on the same visits and the same shoppers. The only thing that changes is the plan.', '#run?go=1', 'Run'],
  run: ['The best-selling plan is highlighted.', 'Run again to reroll only the shoppers\' luck. If the order holds, that plan is the answer.', '#layout', 'Next: Final layout'],
  layout: ['The layout, chosen before the doors open.', 'This is the layout the simulation picked before you try it for real. The report sets it out with the evidence.', '#report', 'Next: Report'],
  report: ['Time to decide.', 'Approve to go ahead with this layout. For another space or decision, build a new one.', '#start?new=1', 'Build a new space', `<span data-slot="approve"><button type="button" class="btn btn-mono" data-act="approve">Approve this plan</button></span>`],
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
  el.innerHTML = '<div class="loading"><span class="spin"></span> Loading</div>';
  const TITLES = { start: 'Build the space', connect: 'Connect records', plans: 'Plans to test', run: 'Run', layout: 'Final layout', report: 'Report', verify: 'Model check', try: 'Try the model',
                  brief: 'Decision brief', endpoints: 'Endpoints', world: 'Store world', engines: 'Engine comparison' };
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

// start · the landing chat: the agent (Claude, rules without a key) reads the business, asks if it must, and builds the
// space with tools; its cards, the 3D space, the edits and the decisions are drawn inside the conversation
const FIRST_ASK = "We're opening a 20,000 sq ft neighborhood supermarket. For next week's cold cereal, should it go on the entrance endcap, a secondary display, or the flyer?";
const EXAMPLES = [   // placeholder prompts: openings people would pay to get right before the doors open
  'I\'m opening a 1,000 sq ft café in Seongsu. Before we open, I want to see whether the pickup counter works better by the entrance or further inside.',
  'A global beauty brand is opening flagships in Seoul, Tokyo and LA. Where should the new-product trial zone go so it turns into purchases?',
  'I\'m opening a 2,000 sq ft neighborhood supermarket. I want to decide whether the seasonal drink goes on the entrance endcap or in the flyer.',
  'We\'re running food and merch booths at a music festival with 100,000 visitors. Before the gates open, I want to know where the lines will jam.',
];
const OPS_TXT = { duplicate: 'Added', relabel: 'Promo spot', stations: 'Checkout', remove: 'Removed', move: 'Moved' };
const rich = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split(/\n{2,}/).map(p => {
  const ls = p.split('\n');
  return ls.every(l => /^\s*[-·•]\s/.test(l)) ? `<ul>${ls.map(l => `<li>${l.replace(/^\s*[-·•]\s/, '')}</li>`).join('')}</ul>`
    : ls.some(l => /^\s*[-·•]\s/.test(l)) ? ls.map(l => /^\s*[-·•]\s/.test(l) ? `<ul><li>${l.replace(/^\s*[-·•]\s/, '')}</li></ul>` : `<p>${l}</p>`).join('') : `<p>${p.replace(/\n/g, '<br>')}</p>`;
}).join('');
function recsHTML(recs) {
  return `<div class="art"><div class="lbl">Suggested spaces</div><div class="recs">${recs.map((c, i) => `
<button type="button" class="rec card" data-pick="${c.id}" data-label="${esc(c.label)}"><img src="${c.thumb}" alt="3D model of ${esc(c.title)}" loading="lazy"><span style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><b style="font-weight:600">${i + 1}. ${esc(c.label)}</b><span class="mono muted" style="font-size:11px">${Math.round(c.area_m2).toLocaleString('en-US')} m²${c.floors > 1 ? ` · ${c.floors} floors` : ''}${c.outdoor ? ' · outdoor' : ''}</span></span><span class="muted" style="font-size:12px;line-height:1.5">${esc(c.title)}</span><span style="display:flex;flex-wrap:wrap;gap:4px">${(c.why || []).map(w => `<span class="tag" style="background:rgba(0,0,0,.05)">${esc(w)}</span>`).join('')}</span><span class="tag tag-ok rec-on">Built on this map</span><span class="mono muted rec-cta">Switch to this map →</span></button>`).join('')}</div></div>`;
}
function worldHTML(r) {
  const st = Object.fromEntries(r.steps.map(x => [x.key, x])), ad = st.adapt, pl = st.place, dc = st.decide;
  return `<div class="art card" style="overflow:hidden;padding:0"><div style="position:relative"><div data-slot="space" class="stage"></div>
<div style="position:absolute;left:14px;top:14px;display:flex;flex-wrap:wrap;gap:8px;max-width:calc(100% - 28px)"><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">${esc(r.space.title)}</span><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">${pl.people.count} shoppers</span><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">Hover over an object</span></div></div>
<div class="world-cols"><div><div class="lbl">What changed</div>${ad.ops.length ? ad.ops.map(o => `<button type="button" class="list-btn" data-focus="${o.id}" style="display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--border);width:100%;text-align:left"><span class="tag ${o.op === 'relabel' ? '' : 'tag-ok'}" style="${o.op === 'relabel' ? 'background:#e3ebfe;color:#1d4ed8;' : ''}flex:none">${OPS_TXT[o.op] || o.op}</span><span style="font-size:13px;line-height:1.55">${esc(o.why)}</span></button>`).join('') : '<p class="muted" style="font-size:13px;margin-top:10px">Nothing needed to change for this request, so the space is left as it was.</p>'}
${ad.skipped.map(o => `<div style="display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--border)"><span class="tag" style="background:#f6ebd3;color:#6b4a00;flex:none">Not changed</span><span style="font-size:13px;line-height:1.55">${esc(o.why)} — ${esc(o.reason)}</span></div>`).join('')}
${ad.note ? `<p class="muted" style="font-size:12px;line-height:1.6;margin-top:8px">${esc(ad.note)}</p>` : ''}</div>
<div><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="lbl">Decisions to test in this space</div><a class="btn btn-mono btn-sm" href="#connect">Next: Connect records →</a></div>${dc.decisions.map(d => `<div style="padding:12px 0;border-top:1px solid var(--border)"><div style="font-size:15px;font-weight:500;line-height:1.5">${esc(d.q)}</div><div class="muted" style="font-size:12px;margin-top:4px">Metric: ${esc(d.metric)} · Records needed: ${esc(d.needs)}</div><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">${dc.calibrated ? '<a class="btn btn-mono btn-sm" href="#connect">Calibrate with your records →</a>' : '<span class="tag" style="background:rgba(0,0,0,.05)">Numbers arrive with your records</span>'}${d.example ? `<a class="btn btn-outline btn-sm" href="${d.example}">See a calibrated example →</a>` : ''}</div></div>`).join('')}</div></div></div>`;
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
  const startChat = () => { if (el.classList.contains('chatting')) return; el.classList.add('chatting'); thread.style.display = 'flex'; thread.after(composer); ta.placeholder = 'Ask a follow-up or tell me what to change'; };
  cleanups.push(() => s3?.dispose());
  // rotating placeholder: one real-sized decision at a time
  let ex = 0; ta.placeholder = EXAMPLES[0];
  if (!CHAT.turns.length && !params.q) ta.value = FIRST_ASK;
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
    try { const u = s3.shot(); host.innerHTML = `<img src="${u}" alt="Previous 3D space" style="width:100%;height:100%;object-fit:cover;display:block">`; } catch { host.innerHTML = ''; }
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
      s3 = mountSpace(host, { glb: r.glb, space: r.space, ops: st.adapt.ops, people: st.place.people }, { maxPeople: 40, spin: true, zoom: .62 }); s3.__host = host;
      const cur = s3;
      $$('[data-focus]', body).forEach(b => b.onclick = () => { if (s3 !== cur) return; cur.spin(false); const on = !b.classList.contains('on'); $$('[data-focus]', body).forEach(x => x.classList.remove('on')); b.classList.toggle('on', on); cur.focus(on ? b.dataset.focus : null); });
    }
    if (art.type === 'mart') {
      freeze();
      setProject({ title: art.business || 'Grocery store', store: art.store, kind: 'mart' });
      body.insertAdjacentHTML('beforeend', `<div class="art card" style="overflow:hidden;padding:0"><div style="position:relative"><div data-slot="space" class="stage"></div>
<div style="position:absolute;left:14px;top:14px;display:flex;flex-wrap:wrap;gap:8px"><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">Store ${esc(art.store)} · real store data</span></div></div>
<div class="world-cols"><div><div class="lbl">Decision to test · cold cereal next week</div><div class="plan-chips">${art.plans.map(p => `<span class="plan-chip"><i style="background:${COL[p.id]}"></i>${esc(p.label)}</span>`).join('')}</div></div>
<div style="display:flex;align-items:flex-end;justify-content:flex-end"><a class="btn btn-mono" href="#connect">Next: Connect records →</a></div></div></div>`);
      const host = $$('[data-slot="space"]', body).at(-1);
      storeData().then(d => { s3 = stage3d(host, { aisles: d.aisles, products: d.products }, { state: 'now', shoppers: 24, weeks: d.L.weeks.join('–'), spin: true, zoom: .62 }); s3.__host = host; });
    }
    $$('[data-pick]', body).forEach(b => b.onclick = () => !b.classList.contains('on') && send(`Please rebuild it on the ${b.dataset.label} map (${b.dataset.pick}).`));
  }
  async function send(text) {
    text = (text || '').trim(); if (!text || busy) return;
    busy = true;
    startChat();
    history.push({ role: 'user', text });
    bubble('user', esc(text)).scrollIntoView({ behavior: 'smooth', block: 'center' });
    ta.value = '';
    const ai = bubble('ai', '<div class="typing" aria-label="Thinking"><i></i><i></i><i></i></div>');
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

// S0 decision brief
VIEWS.brief = async (root) => {
  const [cat, health, last] = await Promise.all([api('catalog'), api('health'), api('run/latest')]);
  const q = store.get('question'); if (q) K(root, 'q').textContent = q;
  set(root, 'llm', health.llm ? `Predictions come from a calibrated decision model, not a language model. The language model (${health.model}) only structures the question and explains the result.` : 'Predictions come from a calibrated decision model, not a language model. The language model only structures the question and explains the result. (No OPENAI_API_KEY · structured with rules)');
  set(root, 'basis', `${n0(cat.households)} households · 1 year · ${n0(cat.receipt_lines)} receipt lines · ${n0(cat.placement_rows)} placement rows`);
  const engines = last?.engines?.length || 5;
  set(root, 'runs', String(4 * engines)); set(root, 'runsSub', engines === 5 ? 'runs · 4 plans × (3 engines + 2 baselines)' : `runs · 4 plans × ${engines} engines`); set(root, 'runN', `${4 * engines}`);
  if (last) set(root, 'decisions', n0(last.decisions));
  const p = store.get('partner', {}); K(root, 'pw').value = p.weeks || ''; K(root, 'pv').value = p.visits || '';
  const spec = store.get('spec'); if (spec) showSpec(root, spec);
};
function showSpec(root, s) {
  set(root, 'question', s.question); set(root, 'plans', s.plans.map(p => LBL[p]).join(' · '));
  const ex = slot(root, 'excluded');
  ex.innerHTML = (s.excluded || []).map(x => `<div style="display:grid;grid-template-columns:140px minmax(0,1fr);gap:16px;padding:16px 0;border-top:1px solid var(--border)"><span class="lbl" style="padding-top:4px">Excluded</span><span style="font-size:16px;color:var(--mfg)">${esc(x)}</span></div>`).join('')
    + (s.llm_error ? `<div style="padding:8px 0" class="err">${llmWhy(s.llm_error)}; structured with rules instead.</div>` : '')
    + `<div style="padding:4px 0 0" class="lbl">${s.structured_by === 'rules' ? 'Structured with rules' : 'Structured by ' + esc(s.structured_by)}</div>`;
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

// S1 endpoints · coloured by route (receipts / display · flyer / price / sensors), not by the server's group label
const EP_COL = e => /^\/(visit|basket|checkout)/.test(e.path) ? '#000' : /^\/exposure/.test(e.path) ? '#3B73FF' : /^\/(price|coupon)/.test(e.path) ? '#FCBB00' : '#B8BEC2';
VIEWS.endpoints = async (root) => {
  const c = await api('catalog');
  set(root, 'households', n0(c.households)); set(root, 'stores', n0(c.stores)); set(root, 'visits', n0(c.visits));
  set(root, 'on', String(c.endpoints.filter(e => e.events != null).length)); set(root, 'wait', String(c.endpoints.filter(e => e.events == null).length));
  slot(root, 'rows').innerHTML = c.endpoints.map(e => `<div class="tr" style="grid-template-columns:52px 180px minmax(0,1fr) 92px;"><span class="" style="min-width:0"><span class="badge">${e.method}</span></span><span class="" style="min-width:0"><span style="display:flex;align-items:center;gap:8px;font-weight:500" class="mono"><span class="sq" style="background:${EP_COL(e)};width:8px;height:8px"></span><span style="font-size:13px">${esc(e.path)}</span></span></span><span class="" style="min-width:0"><span class="mono muted" style="font-size:11px">${esc(e.source)}</span></span><span class="r" style="min-width:0"><span class="num" style="font-size:12px;${e.events == null ? 'color:rgba(77,83,83,.6)' : ''}">${e.events == null ? 'Pending' : n0(e.events)}</span></span></div>`).join('');
};
VIEWS.endpoints.after = (el) => {
  const play = async (basket) => {
    slot(el, 'log').innerHTML = '<span class="spin"></span>';
    try {
      const r = await api('replay' + (basket ? `?basket=${basket}` : ''));
      set(el, 'basket', `basket ${r.basket_id} · ${r.time} · store ${r.store_id} · household ${r.household_id}`);
      const color = e => e.path === '/checkout' ? 'color:#000;font-weight:600' : e.m === 'GET' ? 'color:#3B73FF' : /discount|coupon/.test(e.path) ? 'color:#9a6b00' : 'color:rgba(0,0,0,.85)';
      const money = a => a == null ? '' : `  ${a < 0 ? '-' : ''}$${nf(Math.abs(a))}`;
      slot(el, 'log').innerHTML = r.events.map(e => `<div style="${color(e)}">${esc(`${e.m.padEnd(4)} ${e.path.padEnd(18)} ${e.args}${money(e.amount)}${e.item ? '  ' + e.item : ''}${e.note ? '  · ' + e.note : ''}`)}</div>`).join('');
      const d = r.events.find(e => e.path === '/exposure/display' && / loc=3$/.test(e.args));
      const pid = d && d.args.split(' ')[0].split('=')[1], item = d && r.events.find(e => e.path === '/basket/add' && e.args.startsWith(`product=${pid} `))?.item;
      slot(el, 'quote').innerHTML = d ? `<p style="font-size:15px;line-height:1.7">On Store ${esc(r.store_id)}\'s <b style="font-weight:600">front endcap</b> (display code 3) that week: #${esc(pid)}${item ? ' ' + esc(item) : ''}</p>`
        : `<p style="font-size:15px;line-height:1.7">None of this visit\'s items were on Store ${esc(r.store_id)}\'s front endcap that week.</p>`;
    } catch (e) { slot(el, 'log').innerHTML = errBox(e); }
  };
  $('[data-act="replay"]', el).onclick = () => play('random');
  play();
};

// S2 store world
const STATE_ROWS = [['visits', 'Visits', v => `${n0(v)}`, 160], ['avg_spend', 'Average basket', v => `$${nf(v)}`, 120], ['cereal_visit_rate', 'Visits with cereal', pct, 1],
                    ['disc_share', 'Share of spend discounted', pct, 1], ['private_share', 'Store brand share of cereal', pct, 1], ['cereal_spend_share', 'Cereal share of spend', pct, .1]];
function personaLine(d) {
  if (!d) return 'No demographics · no persona can be built for this household';
  const kids = /no kids/i.test(d.household_comp) ? 'without kids' : /kid/i.test(d.household_comp) ? 'with kids' : '';
  const age = /\+$/.test(d.age) ? `Aged ${d.age.slice(0, -1)}+` : `Aged ${d.age.replace('-', '–')}`;
  const size = String(d.household_size).replace(/^(\d+)\+$/, '$1+ person').replace(/^(\d+)$/, '$1-person');
  return `“${age} · ${size} household${kids ? ' ' + kids : ''} · income ${d.income.replace('-', '–')}.”`;
}
VIEWS.world = async (root, params, cleanups) => {
  const stores = await api('stores');
  const sid = params.store || store.get('store', stores[0].store_id);
  const [w, L] = await Promise.all([api(`world?store=${sid}`), api(`layout?store=${sid}`)]);
  const hh = params.hh || (w.households.find(h => h.demographics) || w.households[0]).household_id;
  const d = await api(`household?id=${hh}`).catch(() => null);
  const m = w.map;
  set(root, 'title', `Store world · Store ${sid}`);
  K(root, 'store').innerHTML = stores.map(s => `<option value="${s.store_id}" ${s.store_id === sid ? 'selected' : ''}>Store ${s.store_id}</option>`).join('');
  const caps = m.displays.filter(x => x.condition === 'A_front_endcap').length;
  set(root, 'storeChip', `Store ${sid} · ${m.aisles.length} aisles · ${m.displays.length} display types · 4 checkouts · layout as of week ${m.as_of_week}`);
  set(root, 'visitsChip', `Weeks 48–53 · ${n0(w.visits_test)} visits · ${n0(w.households_test)} households`);
  set(root, 'hhBadge', hh);
  const hhs = w.households;
  set(root, 'hhLabel', `Household ${hh} · last 26 weeks · computed from behavior`, false);
  K(root, 'hhLabel').innerHTML = `Household <select data-k="hhSel" aria-label="Household" class="num" style="font:inherit;border:1px solid var(--border);border-radius:2px;background:#fff;padding:1px 3px">${hhs.map(h => `<option ${h.household_id === hh ? 'selected' : ''}>${h.household_id}</option>`).join('')}</select> · last 26 weeks · computed from behavior`;
  const st = d?.state || hhs.find(h => h.household_id === hh)?.state || {};
  slot(root, 'bars').innerHTML = STATE_ROWS.map(([k, lab, f, max]) => `<div style="display:grid;grid-template-columns:150px minmax(0,1fr) 70px;gap:14px;align-items:center;padding:12px 0;border-top:1px solid var(--border)"><span style="font-size:14px">${lab}</span><div class="bar"><i style="width:${Math.min(100, Math.max(1.5, (st[k] || 0) / max * 100)).toFixed(1)}%;background:#171717"></i></div><span class="num r" style="font-size:12px">${f(st[k])}</span></div>`).join('')
    + (d ? `<div style="display:grid;grid-template-columns:150px minmax(0,1fr) 70px;gap:14px;align-items:center;padding:12px 0;border-top:1px solid var(--border)"><span style="font-size:14px">#${d.product.product_id} purchases</span><div class="bar"><i style="width:${Math.max(1.5, Math.min(100, d.state.hp_count * 10))}%;background:#171717"></i></div><span class="num r" style="font-size:12px">${n0(d.state.hp_count)}</span></div>` : '');
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

// S3 engine comparison
const ENGINE_ROWS = [['basic', 'Persona', 'GPT · demographic description', false], ['history', 'Persona + history', 'GPT · description + purchase-history numbers', false], ['jev_text', 'Jev · text', 'jev-1.13 · no training', false],
                     ['jev_state', 'Jev · numeric state', 'jev-1.13 · no training', false], ['no_promo', 'As-usual prediction', 'Same model · store condition removed', true], ['calibrated', 'Calibrated model', 'Trained on endpoints · calibrated on weeks 45–47', true]];
const PP_ORDER = ['none', 'A_front_endcap', 'B_mailer_only', 'C_other_display'];   // the persona strip's four cells, in board order (as usual · front endcap · flyer · secondary display)
function engineRow(id, label, note, strong, p, live) {
  const order = ['none', 'A_front_endcap', 'B_mailer_only', 'C_other_display'];
  return `<div class="tr" style="grid-template-columns:minmax(0,1.3fr) repeat(4,minmax(0,1fr));${strong ? 'background:#fff;' : ''}"><span class="" style="min-width:0"><span style="display:flex;flex-direction:column;gap:3px"><span style="display:flex;align-items:center;gap:8px;font-weight:500"><span class="sq" style="background:${(ENG[id] || ['#000'])[0]};width:8px;height:8px"></span>${esc(label)}${live === false ? ' <span class="tag tag-ai">Saved evaluation</span>' : live ? ' <span class="tag tag-ok">Computed now</span>' : ''}</span><span class="mono muted" style="font-size:10px;letter-spacing:.5px;padding-left:16px">${esc(note)}</span></span></span>${order.map(c => `<span class="r" style="min-width:0"><span class="num" style="font-size:13px;${strong ? 'color:#000;font-weight:500' : 'color:var(--mfg)'}">${pct(p[c])}</span></span>`).join('')}</div>`;
}
VIEWS.engines = async (root, params) => {
  const hh = params.hh || '1804';
  const [pairs, d, health] = await Promise.all([api('pairs'), api(`household?id=${hh}${params.product ? `&product=${params.product}` : ''}`), api('health')]);
  const opts = [...new Set([hh, ...pairs.map(p => p.household_id)])];
  K(root, 'hh').innerHTML = opts.map(h => `<option ${h === hh ? 'selected' : ''}>${h}</option>`).join('');
  const pr = d.product;
  set(root, 'prod', `#${pr.product_id}`); set(root, 'visits', String(d.actual.visits)); set(root, 'buys', String(d.actual.bought_this));
  const pname = `${pr.brand === 'Private' ? 'store-brand' : pr.brand} ${pr.type.toLowerCase()} (${pr.size.toLowerCase()})`;
  const who = d.demographics ? personaLine(d.demographics).replace(/[“”.]/g, '') : 'No demographics for this household';
  set(root, 'desc', `Persona: ${who}. We asked how likely they are to put ${pname} in the basket on this trip.`);
  set(root, 'pq', d.demographics ? `“${who}. How likely are you to put ${pname} in your basket on this trip?”` : '“This household has no demographics, so there is no persona to ask.”');
  const persona = d.engines.find(e => e.id === 'basic');
  $$('[data-pp]', root).forEach((x, k) => x.textContent = persona ? pct(persona.p[PP_ORDER[k]]) : '—');
  set(root, 'pnote', persona ? 'Plausible, and blind to the store condition · saved evaluation answer' : 'This household–product pair is not in the persona evaluation sample');
  const btn = $('[data-act="persona"]', root); if (!health.llm || !d.demographics) btn.remove();
  set(root, 'recLabel', `Household ${hh} receipts · weeks 48–53 · actual`);
  slot(root, 'receipts').innerHTML = d.receipts.slice(0, 5).map(r => `<li style="display:flex;flex-direction:column;gap:4px"><span class="mono" style="font-size:10px;letter-spacing:1px;color:rgba(255,255,255,.65)">STORE ${esc(r.store_id)} · ${esc(r.time)}</span><span style="font-size:15px;line-height:1.6;text-shadow:0 1px 8px rgba(72,0,24,.3)">${r.items} items · $${nf(r.total)} · ${esc(r.top.join(', '))}${r.bought_this ? ' · <b>this cereal</b>' : ''}</span></li>`).join('');
  set(root, 'recFoot', `${d.receipts.length} visits · this cereal ${d.actual.bought_this} times · any cereal ${d.actual.cereal_visits} times`);
  const byId = Object.fromEntries(d.engines.map(e => [e.id, e]));
  slot(root, 'eng').innerHTML = ENGINE_ROWS.filter(([id]) => byId[id]).map(([id, lab, note, strong]) => engineRow(id, lab, note, strong, byId[id].p, byId[id].live)).join('');
  VIEWS.engines._d = { hh, pr };
};
VIEWS.engines.after = (el) => {
  const { hh, pr } = VIEWS.engines._d;
  K(el, 'hh').onchange = e => location.hash = `#engines?hh=${e.target.value}`;
  const b = $('[data-act="persona"]', el);
  if (b) b.onclick = async () => {
    b.disabled = true; b.innerHTML = '<span class="spin"></span> Asking';
    try {
      const e = await api(`persona?id=${hh}&product=${pr.product_id}`);
      slot(el, 'eng').insertAdjacentHTML('afterbegin', engineRow('persona_live', e.label, e.note, false, e.p, true));
      $$('[data-pp]', el).forEach((x, k) => x.textContent = pct(e.p[PP_ORDER[k]]));
      set(el, 'pnote', `Fresh answer from ${e.label}`); b.remove();
    } catch (err) { b.disabled = false; b.textContent = 'Ask again'; set(el, 'pnote', llmWhy(err.message)); }
  };
};

// S4 plans
VIEWS.plans = async (root) => {
  const P = projSpace(), g = await api(`grid/latest?model=${currentModel()}`);
  root.innerHTML = `<div class="hdr"><h1 class="ptitle">Plans to test · ${esc(P ? P.spaceTitle : 'Cold cereal next week · Store 367')}</h1></div>
<p class="body muted" style="margin-top:-8px;max-width:980px">Three places × three flyer options = nine plans, all tested by ${esc(MODEL_TITLE[currentModel()] || 'SimOff-1')} on the same shoppers and visits.</p>
${gridHTML(g, false)}`;
};

// one model, nine plans: where it sits (shelf / in-store display / front endcap) x the flyer (none / inside / front page)
const GRID_ZONE = { shelf: 'none', other: 'C_other_display', front: 'A_front_endcap' };
const currentModel = () => { const m = store.get('decisionModel', 'simoff_retail'); return ['simoff_retail', 'jev_raw', 'persona'].includes(m) ? m : 'simoff_retail'; };
const MODEL_TITLE = { simoff_retail: 'SimOff-1', jev_raw: 'Jev', persona: 'Language-model persona' };
function gridLabels(p) {
  const P = projSpace();
  const d = P ? { shelf: P.plans.none.label, other: P.plans.C_other_display.label, front: P.plans.A_front_endcap.label }[p.display] : p.display_label;
  const m = P ? { none: 'No promotion', inner: 'Flyer · coupon', front: 'Flyer front page' }[p.mailer] : p.mailer_label;
  return [d, m];
}
function crowdPlan(p) { return p.display === 'front' ? 'A_front_endcap' : p.display === 'other' ? 'C_other_display' : p.mailer !== 'none' ? 'B_mailer_only' : 'none'; }
function gridCard(p, g, withNumbers) {
  const [d, m] = gridLabels(p), num = p.per_1000;
  const v = withNumbers ? [`<span class="stat" style="font-size:20px">${num == null ? '—' : num >= 100 ? n0(num) : nf(num)}</span>`, `<span class="lbl" style="text-transform:none">${p.lift == null ? 'Not evaluated' : `${nf(p.lift, 1)}× vs now`}</span>`] : ['', ''];
  return `<article class="card run-card grid-card" data-card="${p.id}">
<img class="g9-shot" data-shot="${GRID_ZONE[p.display]}" data-plan="${crowdPlan(p)}" data-group="g:${p.id}" data-lift="${p.lift ?? 1}" alt="3D scene: ${esc(d)} · ${esc(m)}" style="display:block;width:100%;background:#eceeed">
<div class="g9-txt"><div class="g9-l"><span style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;min-width:0"><span class="sq" style="background:${COL[GRID_ZONE[p.display]]};width:8px;height:8px;flex:none"></span>${esc(d)}</span>${v[0]}</div>
<div class="g9-l muted" style="font-size:12px"><span style="display:flex;align-items:center;gap:6px;min-width:0">${p.mailer !== 'none' ? `<span class="sq" style="background:${COL.B_mailer_only};width:7px;height:7px;flex:none"></span>` : ''}${esc(m)}</span>${v[1]}</div></div></article>`;
}
function gridHTML(g, withNumbers) {
  return `<div class="grid9${withNumbers ? '' : ' nonum'}"><span></span>${['shelf', 'other', 'front'].map(d => `<span class="grid9-h">${esc(gridLabels({ display: d, mailer: 'none', display_label: g.plans.find(p => p.display === d).display_label, mailer_label: '' })[0])}</span>`).join('')}
${['none', 'inner', 'front'].map(m => `<span class="grid9-r">${esc(gridLabels({ display: 'shelf', mailer: m, display_label: '', mailer_label: g.plans.find(p => p.mailer === m).mailer_label })[1])}</span>${['shelf', 'other', 'front'].map(d => gridCard(g.plans.find(p => p.display === d && p.mailer === m), g, withNumbers)).join('')}`).join('')}</div>`;
}
function markBestGrid(root, g) {
  $$('.grid-card', root).forEach(c => { const on = c.dataset.card === g.best; c.classList.toggle('best', on); c.classList.toggle('dim', !on); $('.best-badge', c)?.remove(); if (on) c.insertAdjacentHTML('afterbegin', '<span class="best-badge">Best</span>'); });
}

// S5 run
VIEWS.run = async (root) => {
  const g = await api(`grid/latest?model=${currentModel()}`); VIEWS.run._g = g;
  set(root, 'title', 'Run results');
  set(root, 'intro', `${MODEL_TITLE[g.model] || g.model} ran all nine plans on the same shoppers and the same visits (${n0(g.decisions)} decisions). Numbers are sales per 1,000 visits.`);
  const meta = K(root, 'decisions')?.closest('.card'); if (meta) meta.remove();
  const ran = ranGrid(g.model);
  if (!ran) { set(root, 'title', 'Run'); set(root, 'intro', `Nine plans are ready. Press Run and ${MODEL_TITLE[g.model] || g.model} simulates every one on the same shoppers and the same visits.`); const b = $('[data-act="rerun"]', root); if (b) b.textContent = 'Run'; }
  slot(root, 'engines').innerHTML = gridHTML(g, ran); if (ran) markBestGrid(root, g);
};
const ranGrid = (m, on) => { try { if (on) sessionStorage.setItem(`oa:ran:${m}`, '1'); return sessionStorage.getItem(`oa:ran:${m}`) === '1'; } catch { return !!on; } };
VIEWS.run.live = { paused: true };     // the result is in: the cards settle, then hold still
VIEWS.run.after = (el, params) => {
  const gauge = slot(el, 'gauge'), bar = $('.gauge-bar i', gauge), txt = $('.gauge-txt', gauge);
  const rerun = async () => {
    const b = $('[data-act="rerun"]', el); if (b.disabled) return; b.disabled = true; b.textContent = 'Running';
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
        txt.textContent = p >= 1 ? 'Done' : `Simulating · ${n0(438325 * p)} / 438,325 decisions × 9 plans`;
        if (p >= 1) return resolve(); setTimeout(tick, 40);   // a timer, not rAF: the gauge must finish even in a background tab
      };
      tick();
    });
    live?.stop();
    if (res) {
      const keep = new Map($$('canvas[data-key]', el).map(c => [c.dataset.key, c]));
      VIEWS.run._g = res; ranGrid(res.model, true); slot(el, 'engines').innerHTML = gridHTML(res, true);
      $$('img[data-shot]', el).forEach(i => { const c = keep.get(i.dataset.group); if (c) i.replaceWith(c); });
      markBestGrid(el, res);
    } else if (err) slot(el, 'engines').insertAdjacentHTML('afterbegin', errBox(err));
    setTimeout(() => { gauge.hidden = true; const i = K(el, 'intro'); if (i) { i.hidden = false; if (res) i.textContent = `${MODEL_TITLE[res.model] || res.model} ran all nine plans on the same shoppers and the same visits (${n0(res.decisions)} decisions). Numbers are sales per 1,000 visits.`; } }, 900);
    b.disabled = false; b.textContent = 'Run again';
  };
  $('[data-act="rerun"]', el).onclick = rerun;
  $('[data-act="csv"]', el).onclick = () => {
    const g = VIEWS.run._g, rows = [['model', 'plan', 'display', 'flyer', 'per_1000', 'lift']];
    g.plans.forEach(p => rows.push([g.model, p.id, ...gridLabels(p), p.per_1000 ?? '', p.lift ?? '']));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(x => x.join(',')).join('\n')], { type: 'text/csv' })); a.download = `simoff_${g.model}_${g.id}.csv`; a.click();
  };
  if (params.go) { history.replaceState(null, '', '#run'); setTimeout(rerun, 1200); }
};

// S6 model check
VIEWS.verify = async (root) => {
  const v = await api('validation');
  const pe = v.persona.engines, me = v.model_eval, act = v.persona.actual_rate_by_condition_all_test, L = v.persona.actual_lift_pooled.A_front_endcap;
  // keep the calibration chart from the board, on a plain card
  // found by structure, not wording: the card that draws the dashed diagonal, and the caption that carries the ECE
  const chart = $$('.card', root).find(c => c.querySelector('line[stroke-dasharray]'));
  if (chart) { chart.className = 'card'; chart.style.removeProperty('--card-accent'); $('.lbl', chart).textContent = 'SimOff-1\'s stated probability vs actual rate';
    const cap = chart.querySelector('[data-k="ece"]')?.closest('p'); if (cap) cap.innerHTML = 'When the model says "1%", about 1% actually bought. The closer the dots sit to the dashed line, the more you can trust the probability.'; }
  const M = [{ name: 'SimOff-1', c: '#0F766E', p: pe.calibrated, auc: me.engines.calibrated.auc },
             { name: 'Jev', c: '#6D5BD0', p: pe.jev_state, auc: v.jev.engines.jev_raw.auc },
             { name: 'Language-model persona', c: '#F99C00', p: pe.basic, auc: null }];
  const real = act.none, inBand = x => x >= L.ci95[0] && x <= L.ci95[1];
  const verdict = (ok, txt) => `<span class="tag ${ok ? 'tag-ok' : 'tag-no'}">${txt}</span>`;
  const row = (m, val, v2) => `<div class="vq-row"><span class="vq-m"><span class="sq" style="background:${m.c};width:8px;height:8px"></span>${m.name}</span><span class="vq-v">${val}</span>${v2}</div>`;
  const q = (n, title, sub, realTxt, rows) => `<article class="card vq"><div class="lbl">Question ${n}</div><h3>${title}</h3><p class="muted">${sub}</p><div class="vq-real"><span>Actual</span><b>${realTxt}</b></div>${rows}</article>`;
  root.innerHTML = `<div class="hdr"><h1 class="ptitle">Model check</h1></div>
<section><h2 class="display" style="font-size:24px;max-width:820px">We tested the decision model on six weeks of real purchases it had never seen.</h2>
<p class="body muted" style="margin-top:6px;max-width:860px">Of the records from 2,469 households at a US grocery chain, the last six weeks (${n0(me.n_test_rows)} visit × product rows, ${n0(me.n_test_buys)} actual purchases) were held out of training and kept only as the answer key. All three models were asked the same questions.</p></section>
<section class="vq-grid">
${q(1, 'Does it get how many will buy?', 'The chance a shopper on one visit buys the item from the regular shelf', pct(real), M.map(m => { const r = m.p.mean_p_by_condition.none / real; return row(m, pct(m.p.mean_p_by_condition.none), r < 1.5 && r > 1 / 1.5 ? verdict(true, 'Close') : verdict(false, `${n0(r)}× too high`)); }).join(''))}
${q(2, 'Does it get how much a display adds?', 'How many times more it sells on the entrance endcap than usual', `${nf(L.actual, 1)}× <span class="muted" style="font-weight:400">(${nf(L.ci95[0], 1)}–${nf(L.ci95[1], 1)})</span>`, M.map(m => row(m, `${nf(m.p.lift_A_endcap, 1)}×`, inBand(m.p.lift_A_endcap) ? verdict(true, 'In range') : verdict(false, 'Too low'))).join(''))}
${q(3, 'Does it spot who will buy?', 'How well it ranks buyers above non-buyers (0.5 = a coin flip, 1 = perfect)', '—', M.map(m => row(m, m.auc == null ? 'Not measured' : nf(m.auc, 2), m.auc == null ? '' : `<span class="vq-bar"><i style="width:${Math.max(0, (m.auc - .5) * 200).toFixed(0)}%;background:${m.c}"></i></span>`)).join(''))}
</section>
<section class="vq-bottom"><div data-slot="chart"></div>
<div><div class="lbl">Summary</div><ul class="vq-list"><li><b>SimOff-1</b> got both the real purchase level and the display effect within the actual range.</li><li><b>Jev</b> ranks who will buy fairly well, but inflates the purchase probability tens of times over and underestimates the display effect.</li><li><b>Language-model persona</b> answers plausibly, but inflates purchases about 200× and barely changes its answer when the display changes.</li></ul></div>
<div><div class="lbl">Not yet judged</div><ul class="vq-list muted"><li>Flyer effect — every store ran the flyer in the same weeks, so there is nothing to compare against</li><li>Discounts — prices on visits without a purchase are not recorded</li></ul></div></section>`;
  if (chart) slot(root, 'chart').replaceWith(chart);
};

// Try the model: say who, what and where in a sentence; the model's input, its output (JSON) and what moves the answer
const PG_TYPE = { 'KIDS CEREAL': 'Kids cereal', 'ALL FAMILY CEREAL': 'Family cereal', 'ADULT CEREAL': 'Adult cereal' };
const pgProd = p => p ? `${PG_TYPE[p.type] || p.type} ${p.size.toLowerCase()} · $${nf(p.price)}` : '';
const PG_D = { shelf: 'Regular shelf', other: 'In-store secondary display', front: 'Entrance endcap' }, PG_M = { none: 'No flyer', inner: 'Flyer inside page', front: 'Flyer front page' };
const PG_IN = [['visits', v => `${n0(v)} visits in six months`], ['avg_spend', v => `$${n0(v)} per trip`], ['cereal_visit_rate', v => `cereal on ${Math.round(v * 100)}% of visits`],
  ['cereal_spend_share', v => `cereal ${nf(v * 100, 1)}% of spend`], ['disc_share', v => `discounted items ${Math.round(v * 100)}%`], ['private_share', v => `store brand ${Math.round(v * 100)}%`], ['hp_count', v => `bought this item ${v} times`]];
const PG_EXAMPLES = ['A cereal regular who comes twice a week: would they buy kids cereal from the entrance endcap?',
  'What if family cereal goes on the flyer front page for a shopper who comes once a month and only buys on discount?',
  'For the same average shopper, compare adult cereal on the regular shelf with the entrance endcap.'];
const PG = (() => { try { return JSON.parse(sessionStorage.getItem('oa:pg')) || { turns: [] }; } catch { return { turns: [] }; } })();
const pgSave = () => { try { sessionStorage.setItem('oa:pg', JSON.stringify(PG)); } catch {} };
VIEWS.try = async () => { VIEWS.try._prods = await api('decide/products'); };
VIEWS.try.after = (el, params, cleanups) => {
  const thread = slot(el, 'thread'), ta = K(el, 'ask'), sendB = $('[data-act="send"]', el), prods = VIEWS.try._prods;
  const prodOf = id => prods.find(p => p.product_id === id);
  if (!PG.turns.length) ta.value = PG_EXAMPLES[0];
  let history = [], busy = false, current = null;
  slot(el, 'examples').innerHTML = PG_EXAMPLES.map(t => `<button type="button" data-ex>${esc(t)}</button>`).join('');
  $$('[data-ex]', el).forEach(b => b.onclick = () => send(b.textContent));
  const caseName = c => c.label || `${pgProd(prodOf(c.response.input.product_id))} · ${PG_D[c.response.input.display]}`;
  function show(c, allCases) {
    current = c; const r = c.response, i = r.input;
    set(el, 'outTitle', `SimOff-1's answer · ${caseName(c)}`);
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
    slot(el, 'view').innerHTML = `<div class="lbl">What the model received <span class="muted" style="text-transform:none;letter-spacing:0">· dark chips were read from your sentence; the rest are average-shopper values</span></div><div class="pg-in-row">${chips}</div>
<div class="pg-big" style="margin-top:18px"><span>${nf(r.p_buy * 100, 3)}%</span><span class="pg-big-s">chance of buying on this visit · about once every ${n0(1 / r.p_buy)} visits</span></div>
<div class="pg-stats"><div><span class="lbl">Per 1,000 visits</span><b>${nf(r.per_1000_visits, 2)}</b></div><div><span class="lbl">vs regular shelf · no flyer</span><b>×${nf(r.lift_vs_shelf, 2)}</b></div><div><span class="lbl">vs the average shopper, same conditions</span><b>×${nf(r.p_buy / r.average_customer_p, 2)}</b></div></div>
<div class="lbl" style="margin-top:22px">What moves the probability <span class="muted" style="text-transform:none;letter-spacing:0">· one input changed from low → high; the vertical line is now</span></div>
<div style="margin-top:6px">${r.drivers.map(d => { const lo = Math.min(d.p_low, d.p_high), hi = Math.max(d.p_low, d.p_high);
      return `<div class="pg-drv"><span>${esc(d.label)}</span><span class="trk"><i style="left:${X(lo)}%;width:${Math.max(.8, X(hi) - X(lo))}%"></i><em style="left:${X(r.p_buy)}%"></em></span><span class="v">${nf(d.p_low * 100, 2)} → ${nf(d.p_high * 100, 2)}%</span></div>`; }).join('')}</div>
<div class="lbl" style="margin-top:22px">Same shopper · same item, nine store conditions <span class="muted" style="text-transform:none;letter-spacing:0">· per 1,000 visits</span></div>
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
    const ai = bubble('ai', '<div class="typing" aria-label="Thinking"><i></i><i></i><i></i></div>');
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

// final layout (3D)
function stat(v, l, sub) { return `<div style="display:flex;flex-direction:column;gap:8px;padding:16px 0;border-top:1px solid var(--border)"><span class="lbl">${l}</span><span class="stat">${v}</span><span class="muted" style="font-size:12px">${sub}</span></div>`; }
VIEWS.layout = async (root, params) => {
  const P = projSpace(); VIEWS.layout._P = P;
  if (P) {
    const g = await api(`grid/latest?model=${currentModel()}`);
    const ranked = g.plans.filter(p => p.per_1000 != null).sort((a, b) => b.per_1000 - a.per_1000), best = ranked[0], base = g.plans.find(p => p.id === 'shelf_none');
    const name = p => gridLabels(p).join(' + '), fxOf = p => ({ front: P.plans.A_front_endcap.fx, other: P.plans.C_other_display.fx }[p.display] || null);
    VIEWS.layout._fx = Object.fromEntries(g.plans.map(p => [p.id, fxOf(p)]));
    VIEWS.layout._best = best.id;
    root.innerHTML = `<div class="hdr"><h1 class="ptitle">Final layout · ${esc(P.spaceTitle)}</h1></div>
<section class="fit-screen"><div class="fit-stage" style="position:relative;overflow:hidden;border:1px solid var(--border);background:var(--card)"><div data-slot="pstage" style="width:100%;height:100%"></div>
<div style="position:absolute;left:16px;top:16px"><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">Proposed: ${esc(name(best))}</span></div></div>
<aside class="fit-side"><div><div class="lbl">${esc(P.title.length > 60 ? P.title.slice(0, 60) + '…' : P.title)}</div><h2 class="display" style="margin-top:8px;font-size:22px;line-height:1.35">Proposed: ${esc(name(best))}. Sales at ${nf(best.lift, 1)}× today.</h2></div>
<div class="stats4">${stat(`×${nf(best.lift, 1)}`, 'vs as it is', `Per 1,000 visits ${nf(base.per_1000)} → ${nf(best.per_1000)}`)}${stat(`+${nf(best.per_1000 - base.per_1000)}`, 'Extra sales per 1,000 visits', MODEL_NOTE)}</div>
<div class="tbl fit-list"><div class="th" style="grid-template-columns:minmax(0,1fr) 70px"><span>Plan</span><span class="r">Per 1,000</span></div>${ranked.map(p => `<button type="button" class="tr list-btn" data-plan="${p.id}" style="display:grid;grid-template-columns:minmax(0,1fr) 70px;gap:10px;align-items:center;padding:12px 14px;border-top:1px solid rgba(216,221,223,.7);width:100%"><span style="display:flex;align-items:center;gap:8px;font-size:13px"><span class="sq" style="background:${COL[GRID_ZONE[p.display]]};width:8px;height:8px"></span>${esc(name(p))}${p.id === best.id ? ' <span class="tag tag-ok">Best</span>' : ''}</span><span class="num r" style="font-size:12px">${nf(p.per_1000)}</span></button>`).join('')}</div>
</aside></section>`;
    return;
  }
  const stores = await api('stores');
  const sid = params.store || store.get('store', stores[0].store_id);
  const L = await api(`layout?store=${sid}`);
  const cur = L.plans.current, nxt = L.plans.proposed, V = L.validation, LB = c => c === 'none' ? 'Shelf' : LBL[c];
  const moved = L.products.filter(p => p.moved).sort((a, b) => b.gain - a.gain);
  set(root, 'title', `Final layout · Store ${sid} · ${L.products.length} cereals`); set(root, 'asOf', `Layout as of week ${L.as_of}`);
  K(root, 'store').innerHTML = stores.map(s => `<option value="${s.store_id}" ${s.store_id === sid ? 'selected' : ''}>Store ${s.store_id}</option>`).join('');
  set(root, 'chip1', `Proposed layout · decided on data through week ${L.as_of} · simulated over weeks ${L.weeks.join('–')}`);
  set(root, 'chip2', `Slots · front endcap ${L.capacity.A_front_endcap} · secondary display ${L.capacity.C_other_display}`);
  set(root, 'lbl', `Simulated on ${n0(L.visits)} real shopper visits in weeks ${L.weeks.join('–')}`);
  set(root, 'h2', `Move ${moved.length} products and sales visits go from ${nf(cur.expected_units, 1)} to ${nf(nxt.expected_units, 1)}.`);
  slot(root, 'stats').innerHTML = stat(`×${nf(nxt.lift)}`, `vs the current layout (week ${L.as_of})`, `Sales visits ${nf(cur.expected_units, 1)} → ${nf(nxt.expected_units, 1)}`)
    + stat(`${nxt.extra_revenue >= 0 ? '+' : '-'}$${nf(Math.abs(nxt.extra_revenue))}`, 'Expected 6-week revenue difference', 'At pre-discount prices')
    + stat(`${Math.round(nxt.share_of_draws_above_baseline * 100)}%`, 'Chance it outsells today', 'From 200 reruns with the same shoppers')
    + stat(`${V.actual} / ${nf(V.expected, 1)}`, 'This store\'s actual sales / model', 'Current layout, 6 weeks');
  slot(root, 'tags').innerHTML = `<span class="tag tag-ok">Endcap effect · simulator within the actual range</span><span class="tag ${V.in_band ? 'tag-ok' : 'tag-no'}">This store's 6-week sales: ${V.actual} · ${V.in_band ? 'in range' : 'out of range'}</span>`;
  slot(root, 'moves').innerHTML = moved.map(p => `<button type="button" class="tr list-btn" data-id="${p.id}" style="display:grid;grid-template-columns:26px minmax(0,1fr) 64px;gap:10px;align-items:center;padding:10px 14px;border-top:1px solid rgba(216,221,223,.7);width:100%"><span class="num" style="font-size:11px;text-align:center;border-radius:2px;background:${COL[p.next]};color:${p.next === 'A_front_endcap' ? '#fff' : '#000'};padding:1px 0">${p.n}</span><span style="min-width:0"><span style="display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)} ${esc(p.size)}</span><span class="muted" style="display:block;font-size:11px;margin-top:2px">${LB(p.now)} → <b style="color:#000;font-weight:500">${LB(p.next)}</b></span></span><span class="num r" style="font-size:12px">${p.gain ? '+$' + nf(p.gain) : 'Gives up its spot'}</span></button>`).join('');
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

// S7 report
VIEWS.report = async (root) => {
  const [r, last] = await Promise.all([api('report'), api('run/latest')]);
  const N = r.numbers, eff = r.effects;
  const extra = N.per_1000_with - N.per_1000_without, usd = extra * N.median_shelf_price_usd;
  set(root, 'title', 'Report');
  set(root, 'lead', `On the endcap it should sell about ${nf(eff.A_front_endcap.simulated.calibrated, 1)}× more than usual. That is within the effect measured in stores where it actually sat on the endcap (${nf(eff.A_front_endcap.actual.lift, 1)}×), and it reads a little low, so the estimate is conservative.`);
  set(root, 'per1000', `${nf(N.per_1000_without)} → ${nf(N.per_1000_with)}`);
  set(root, 'usd', `$${nf(usd, 1)}`); set(root, 'usdSub', `${nf(extra, 1)} more × median price $${nf(N.median_shelf_price_usd)} · panel households`);
  const p = store.get('partner', {}), weeks = +p.weeks || 0, visits = +p.visits || 0;
  const card = (label, val, sub) => `<article class="d3 grad ink"><div class="mono" style="font-size:9px;letter-spacing:1.3px;text-transform:uppercase;color:rgba(255,255,255,.45)">${label}</div><div class="mono" style="margin-top:22px;font-size:28px;line-height:1;letter-spacing:-.04em">${val}</div><div style="margin-top:18px;padding-top:12px;border-top:1px solid rgba(255,255,255,.12);font-size:12px;line-height:1.5;color:rgba(255,255,255,.62)">${sub}</div></article>`;
  slot(root, 'partner').innerHTML = weeks && visits ? card('Decide now instead of testing in store', `$${n0(weeks * visits / 1000 * usd)}`, `${weeks}-week test × ${n0(visits)} visits a week × $${nf(usd, 1)} per 1,000 · the extra revenue lost by leaving the endcap unused for that time`)
    : card('Decide now instead of testing in store', '—', 'Enter the test length and weekly visits in the <a href="#brief" style="color:#fff">decision brief</a> to calculate');
  slot(root, 'segments').innerHTML = N.segments.map((s, i) => `<div class="tr" style="grid-template-columns:minmax(0,1fr) 90px 120px;${i === 1 ? 'background:#fff;' : ''}"><span class="" style="min-width:0">${esc(s.segment)}</span><span class="r" style="min-width:0"><span class="num" style="font-size:12px">${nf(s.lift, 1)}×</span></span><span class="r" style="min-width:0"><span class="num" style="font-size:12px">+${nf(s.extra_per_1000, 1)}</span></span></div>`).join('');
  set(root, 'share', `${Math.round((N.segments[1]?.share_of_extra || 0) * 100)}%`);
};
function relabelText(root, map) {          // swap the example's plan names for the project's, in every text node
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  const rx = map.map(([a, b]) => [new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), b]);   // English capitalises at sentence starts
  for (const n of nodes) { let t = n.nodeValue; for (const [a, b] of rx) t = t.replace(a, () => b); if (t !== n.nodeValue) n.nodeValue = t; }
}
VIEWS.report.after = (el) => {
  const P = projSpace();
  const ok = store.get('approved'); if (ok) slot(el, 'approve').innerHTML = `<span class="tag tag-ok" style="height:32px;padding:0 12px">Approved · ${esc(ok)}</span> <button type="button" class="btn btn-ghost btn-sm" data-act="undo">Undo</button>`;
  if (P) {
    const h2 = $('h2.display', el); if (h2) h2.innerHTML = `${esc(P.spaceTitle)}, ${esc(P.plans.A_front_endcap.label)}.`;
    relabelText(el, [['Cold cereal next week', P.spaceTitle], ['front endcap', P.plans.A_front_endcap.label], ['secondary display', P.plans.C_other_display.label], ['as usual', P.plans.none.label], ['flyer', P.plans.B_mailer_only.label]]);
    const lead = K(el, 'lead'); if (lead) lead.textContent = `${P.plans.A_front_endcap.label}: expected to sell more than today. ${MODEL_NOTE} — recalibrated once this space's records arrive.`;
  }
  const a = $('[data-act="approve"]', el); if (a) a.onclick = () => { store.set('approved', new Date().toLocaleString('en-US')); render(); };
  const u = $('[data-act="undo"]', el); if (u) u.onclick = () => { store.set('approved', null); render(); };
  $('[data-act="pdf"]', el).onclick = () => print();
  $('[data-act="share"]', el).onclick = async (e) => { try { await navigator.clipboard.writeText(location.href); e.currentTarget.lastChild.textContent = ' Copied'; } catch { prompt('Link', location.href); } };
};

// S8 connect records
VIEWS.connect = async (root) => {
  const P = projSpace(), pr = store.get('project');
  set(root, 'mapName', P ? P.spaceTitle : `${pr?.kind === 'mart' ? 'Grocery store · ' : ''}Store ${store.get('store', '367')}`);
  if (P) { const s = $('[data-act="sample"]', root); if (s) s.textContent = 'Continue with sample records (grocery data)'; }
  VIEWS.connect._P = P; VIEWS.connect._d = P ? null : await storeData();
};
VIEWS.connect.after = (el) => {
  let files = {};
  const job = slot(el, 'job'), P = VIEWS.connect._P, host = slot(el, 'cstage');
  let map = P ? mountSpace(host, { glb: P.glb, space: P.space, ops: P.ops, people: P.people }, { maxPeople: 40 })
    : stage3d(host, { aisles: VIEWS.connect._d.aisles, products: VIEWS.connect._d.products }, { shoppers: 12, weeks: VIEWS.connect._d.L.weeks.join('–') });
  cleanups.push(() => map.dispose());
  const mapRows = m => m.columns.map(c => `<div class="tr" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr) 140px;"><span class="" style="min-width:0"><span class="num" style="font-size:12px;">${esc(c.column)}</span></span><span class="" style="min-width:0"><span class="mono" style="font-size:12px">${esc(c.endpoint || '—')}</span></span><span class="r" style="min-width:0">${c.field ? `<span class="tag tag-ok">Connected${c.field === 'household_id' ? ' · de-identified' : ''}</span>` : '<span class="tag" style="background:rgba(0,0,0,.06)">Not used</span>'}</span></div>`).join('')
    + (files.placements ? '' : `<div class="tr" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr) 140px;"><span class="" style="min-width:0"><span class="num" style="font-size:12px;color:rgba(77,83,83,.6)">(none)</span></span><span class="" style="min-width:0"><span class="mono" style="font-size:12px">GET /exposure/display</span></span><span class="r" style="min-width:0"><span class="tag" style="background:#f6ebd3;color:#6b4a00">Display schedule needed</span></span></div>`);
  async function send(name) {
    if (!files.transactions) { job.style.display = 'block'; job.innerHTML = errBox('A receipts CSV is required. Any file whose name does not mention placements, promos, displays or products is read as receipts.'); return; }
    job.style.display = 'block'; job.innerHTML = '<div class="loading"><span class="spin"></span> Uploading</div>';
    try {
      let j = await api('connect', files);
      set(el, 'mapTitle', `Auto-mapping · ${name}`);
      for (;;) {
        const m = j.mapping; set(el, 'mapCount', `<b style="color:#000">${m.columns.filter(c => c.field).length}</b> of ${m.columns.length} columns connected`, true); slot(el, 'map').innerHTML = mapRows(m);
        const busy = j.status === 'running' || j.status === 'mapping';
        job.innerHTML = `<div class="card cn-job">${busy ? '<span class="spin"></span>' : j.status === 'done' ? '<span class="tag tag-ok">Done</span>' : `<span class="tag tag-no">${esc(j.status)}</span>`}<span style="min-width:0">${j.error ? `<span class="err">${esc(j.error)}</span>` : busy ? `<b style="font-weight:500">Calibrating</b> <span class="mono muted" style="font-size:11px">${esc((j.log || []).slice(-1)[0] || 'Starting')}</span>` : `SimOff-1 is now calibrated to the shoppers in these records. The next step compares the plans.`}</span></div>`;
        set(el, 'mapState', busy ? 'Calibrating' : j.status === 'done' ? 'SimOff-1 · calibrated on these records' : 'Records not connected');
        if (!busy) break;
        await new Promise(r => setTimeout(r, 2000)); j = await api(`job?id=${j.id}`);
      }
      if (j.layout && !P) {      // a grocery store: the map turns to the proposed placement for the next four weeks
        const L = j.layout; map.dispose();
        map = stage3d(host, { aisles: L.aisles, products: L.products }, { shoppers: 12, weeks: L.weeks.join('–') });
        setTimeout(() => map.go('next'), 800);
        set(el, 'mapState', `Proposed layout for the next 4 weeks · sales visits ${nf(L.plans.current.expected_units, 1)} → ${nf(L.plans.proposed.expected_units, 1)}`);
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
    job.style.display = 'block'; job.innerHTML = '<div class="loading"><span class="spin"></span> Building sample POS files</div>';
    const s = await api('sample?store=367'); files = { transactions: s.transactions, products: s.products, placements: s.placements };
    set(el, 'files', 'store_367_pos.csv · products.csv · placements.csv'); send('store_367_pos.csv');
  };
};

boot(); render();
