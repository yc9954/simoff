// SimOff screens. Each screen is the storyboard board's own markup (screens/<id>.html);
// this file fills its data-k / data-slot / data-shot hooks from the API and wires the controls.
import { mountStore, liveCards } from './store3d.js';
import { mountSpace } from './space3d.js';

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
    c.style.width = '100%'; c.dataset.key = `${i.dataset.engine || 'calibrated'}:${i.dataset.shot}`; i.replaceWith(c);
    const k = i.dataset.shot, eng = i.dataset.engine || 'calibrated', plan = k === 'report' ? 'A_front_endcap' : k;
    const base = { canvas: c, plan, group: `${eng}:${plan}`, lift: liftOf(eng, plan) };
    return k === 'report' ? { ...base, highlight: 'A_front_endcap', view: 'cereal', state: 'next' } : { ...base, highlight: k, view: 'card', state: 'now' };
  });
  live = liveCards(d, cards, opts);
  const mine = live; cleanups.push(() => { mine.dispose(); if (live === mine) live = null; });
}

// the project the chat started; every step after it shows the same context and the way forward
const FLOW = [['start', '공간 세우기'], ['connect', '기록 연결'], ['plans', '시험할 안'], ['run', '실행'], ['layout', '최종 배치'], ['report', '리포트']];
function setProject(p) { store.set('project', { ...p, at: Date.now() }); }
function flowBar(view) {
  const i = FLOW.findIndex(f => f[0] === view); if (i <= 0) return '';
  const p = store.get('project'), next = FLOW[i + 1];
  const what = p ? `${esc(p.title.length > 38 ? p.title.slice(0, 38) + '…' : p.title)} · Store ${esc(p.store)}` : '샘플 프로젝트 · 마트 · Store 367';
  return `<div class="flow-bar"><span><span class="lbl">프로젝트</span> ${what}</span>${next ? `<a class="btn btn-mono btn-sm" href="#${next[0]}">다음: ${next[1]} →</a>` : '<a class="btn btn-outline btn-sm" href="#start">새 공간 세우기</a>'}</div>`;
}

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
  const TITLES = { start: '공간 세우기', connect: '기록 연결', plans: '시험할 안', run: '실행', layout: '최종 배치', report: '리포트', verify: '모델 검증',
                  brief: '결정 브리프', endpoints: '엔드포인트', world: '매장 월드', engines: '엔진 비교' };
  document.title = `${TITLES[view] || ''} · SimOff`;
  try {
    const html = await template(view);
    const root = document.createElement('div'); root.style.display = 'contents'; root.innerHTML = html;
    await VIEWS[view](root, params, cleanups);
    el.replaceChildren(...root.childNodes);
    el.insertAdjacentHTML('afterbegin', flowBar(view));
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
const EXAMPLES = [   // placeholder prompts: large, real decisions people would pay to get right
  '전국 300개 매장 커피 체인이 픽업대를 입구 쪽으로 옮기려 해요. 대기 줄과 매출이 어떻게 바뀔까요?',
  '글로벌 뷰티 브랜드가 서울 · 도쿄 · LA 플래그십에 신제품 체험존을 열어요. 어디에 둬야 구매로 이어질까요?',
  '대형마트 체인이 여름 시즌 음료를 입구 엔드캡에 둘지, 전단에 실을지 정해야 해요.',
  '10만 명이 오는 음악 페스티벌의 푸드 · 굿즈 부스 배치를 정하려 해요. 줄이 어디서 막힐까요?',
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
<div><div class="lbl">이 공간에서 시험할 결정</div>${dc.decisions.map(d => `<div style="padding:12px 0;border-top:1px solid var(--border)"><div style="font-size:15px;font-weight:500;line-height:1.5">${esc(d.q)}</div><div class="muted" style="font-size:12px;margin-top:4px">지표: ${esc(d.metric)} · 필요한 기록: ${esc(d.needs)}</div><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">${dc.calibrated ? '<a class="btn btn-mono btn-sm" href="#connect">올린 기록으로 보정하기 →</a>' : '<span class="tag" style="background:rgba(0,0,0,.05)">기록이 오면 숫자를 냅니다</span>'}${d.example ? `<a class="btn btn-outline btn-sm" href="${d.example}">보정된 예시로 보기 →</a>` : ''}</div></div>`).join('')}</div></div></div>`;
}
VIEWS.start = async (root) => {
  VIEWS.start._models = await api('models').catch(() => ({ models: [], default: null }));
};
VIEWS.start.after = (el, params, cleanups) => {
  const thread = slot(el, 'thread'), composer = slot(el, 'composer'), ta = K(el, 'ask');
  let history = [], files = [], s3 = null, busy = false;
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
      $$('.rec', body).forEach(b => { const on = b.dataset.pick === r.space.id; b.classList.toggle('on', on); });
      body.insertAdjacentHTML('beforeend', worldHTML(r));
      const host = $$('[data-slot="space"]', body).at(-1), st = Object.fromEntries(r.steps.map(x => [x.key, x]));
      s3 = mountSpace(host, { glb: r.glb, space: r.space, ops: st.adapt.ops, people: st.place.people }, { maxPeople: 40 }); s3.__host = host;
      const cur = s3;
      $$('[data-focus]', body).forEach(b => b.onclick = () => { if (s3 !== cur) return; const on = !b.classList.contains('on'); $$('[data-focus]', body).forEach(x => x.classList.remove('on')); b.classList.toggle('on', on); cur.focus(on ? b.dataset.focus : null); });
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
    if (!el.classList.contains('chatting')) { el.classList.add('chatting'); thread.style.display = 'flex'; thread.after(composer); ta.placeholder = '이어서 묻거나 바꾸고 싶은 것을 말해 주세요'; }
    history.push({ role: 'user', text });
    bubble('user', esc(text)).scrollIntoView({ behavior: 'smooth', block: 'center' });
    ta.value = '';
    const ai = bubble('ai', '<div class="typing" aria-label="생각하는 중"><i></i><i></i><i></i></div>');
    try {
      const r = await api('chat', { history, files, model });
      $('.body', ai).innerHTML = rich(r.reply);
      history.push({ role: 'assistant', text: r.reply });
      const mart = (r.artifacts || []).some(a => a.type === 'mart');   // the real store replaces the archetype cards
      for (const a of r.artifacts || []) if (!(mart && a.type === 'recs')) draw(ai, a);
    } catch (e) { $('.body', ai).innerHTML = errBox(e); history.pop(); }
    busy = false; ai.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('[data-act="send"]', el).onclick = () => send(ta.value);
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ta.value); } };
  K(el, 'files').onchange = e => { files = [...e.target.files].map(f => f.name); set(el, 'fileLbl', files.length ? `${files.length}` : ''); };
  if (params.q) send(params.q);
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
  const [plans, last] = await Promise.all([api('plans'), api('run/latest')]);
  set(root, 'total', n0(plans.reduce((a, p) => a + p.evidence_rows, 0)));
  plans.forEach(p => set(root, `ev:${p.id}`, n0(p.evidence_rows)));
  set(root, 'runLabel', (last?.engines?.length || 5) === 5 ? '4개 안 × 엔진 3 + 비교 기준 2 실행' : `4개 안 × ${last.engines.length}개 엔진 실행`);
};

// S5 실행
// what each engine is, in words a store manager reads (the technical note stays in the API and the CSV)
const ENG_PLAIN = { calibrated: '이 매장들의 실제 영수증으로 학습한 결정 모델 — 우리 엔진', jev_calibrated: '외부 결정 모델(Jev)에 이 매장 기록으로 보정만 얹은 것',
  persona: '언어 모델이 손님 역할로 답한 것 — 비교용', no_promo: '진열 효과가 없다고 보는 기준', avg_lift: '전체 평균 효과만 곱하는 기준' };
function runCards(r) {
  const order = ['calibrated', 'jev_calibrated', 'persona', 'no_promo', 'avg_lift'];
  const engines = [...r.engines].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const base = e => ['no_promo', 'avg_lift'].includes(e.id);
  const section = e => {
    const [sq, acc] = ENG[e.id] || ['#000', '#000'];
    const cards = PLANS.map(c => {
      const p = e.plans.find(x => x.id === c), a = r.actual_per_1000[c], k = p.ratio_to_actual, sel = false;
      const ok = k != null && k <= 3;
      return `<article class="card acc run-card ${sel ? 'wash-w' : 'wash'}" data-card="${e.id}:${c}" style="overflow:hidden;--card-accent:${acc};${sel ? 'border-color:#171717;box-shadow:0 0 0 1px #171717' : ''}">${base(e) ? '' : `<img data-shot="${c}" data-engine="${e.id}" alt="${esc(e.label)} · ${LBL[c]} 3D 장면" style="display:block;width:100%;height:118px;object-fit:cover;border-bottom:1px solid var(--border);background:#eceeed">`}
<div style="padding:12px 14px 14px"><div style="display:flex;align-items:center;gap:8px;font-size:13px"><span class="sq" style="background:${COL[c]};width:8px;height:8px"></span>${LBL[c]}</div><div style="margin-top:10px;display:flex;align-items:baseline;justify-content:space-between"><span class="stat" style="font-size:24px">${p.per_1000 >= 100 ? n0(p.per_1000) : nf(p.per_1000)}</span><span class="num muted" style="font-size:11px">실제 ${nf(a)}</span></div>
<div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:6px"><span class="lbl" style="text-transform:none;white-space:nowrap">평소 대비 ${nf(p.lift, 1)}배</span>${ok ? '' : `<span class="tag tag-no" style="white-space:nowrap">실제의 ${n0(k)}배</span>`}</div></div></article>`;
    }).join('');
    return `<section><div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;padding-bottom:10px;border-bottom:1px solid var(--border)"><span style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:500"><span class="sq" style="background:${sq};width:10px;height:10px"></span>${esc(e.label)}</span><span class="muted" style="font-size:13px">${ENG_PLAIN[e.id] || esc(e.note)}</span></div><div style="margin-top:14px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px">${cards}</div></section>`;
  };
  const main = engines.filter(e => !base(e)), rest = engines.filter(base);
  return main.map(section).join('') + (rest.length ? `<details class="card" style="padding:12px 16px"><summary style="cursor:pointer;font-size:14px">비교 기준 ${rest.length}개 · ${rest.map(e => esc(e.label)).join(' · ')} <span class="mono muted" style="font-size:11px;margin-left:8px">진열 효과를 빼거나 평균으로 둔 경우</span></summary><div style="display:flex;flex-direction:column;gap:24px;margin-top:16px">${rest.map(section).join('')}</div></details>` : '');
}
function fillRun(root, r) {
  set(root, 'title', '실행 결과');
  set(root, 'intro', `숫자는 방문 1,000회당 판매입니다. 카드 오른쪽 '실제'는 모델이 학습에 쓰지 않은 ${r.weeks.join('–')}주에 실제로 팔린 값입니다. 네 가지 안은 같은 손님, 같은 방문으로 비교했습니다.`);
  const meta = K(root, 'decisions')?.closest('.card'); if (meta) meta.remove();
  slot(root, 'engines').innerHTML = runCards(r);
}
// the best plan of each engine: outlined and badged; the rest step back
function markBest(root, r) {
  for (const e of r.engines) {
    const best = [...e.plans].sort((x, y) => y.per_1000 - x.per_1000)[0]?.id;
    $$(`[data-card^="${e.id}:"]`, root).forEach(c => {
      const on = c.dataset.card === `${e.id}:${best}`;
      c.classList.toggle('best', on); c.classList.toggle('dim', !on);
      $('.best-badge', c)?.remove();
      if (on) c.insertAdjacentHTML('afterbegin', '<span class="best-badge">최선</span>');
    });
  }
}
VIEWS.run = async (root) => { const r = await api('run/latest') || await api('run', { draws: 100, seed: 42 }); fillRun(root, r); markBest(root, r); VIEWS.run._r = r; };
VIEWS.run.live = { paused: true };     // the result is in: the cards settle, then hold still
VIEWS.run.after = (el, params) => {
  const gauge = slot(el, 'gauge'), bar = $('.gauge-bar i', gauge), txt = $('.gauge-txt', gauge);
  const rerun = async () => {
    const b = $('[data-act="rerun"]', el); if (b.disabled) return; b.disabled = true; b.textContent = '실행 중';
    $$('.run-card', el).forEach(c => { c.classList.remove('best', 'dim'); $('.best-badge', c)?.remove(); });
    gauge.hidden = false; bar.style.width = '0%';
    live?.run();
    const t0 = performance.now(), MIN = 4800; let res = null, err = null, done = false;
    api('run', { draws: 100, seed: Math.floor(Math.random() * 1e6) }).then(r => { res = r; }).catch(e => { err = e; }).finally(() => { done = true; });
    await new Promise(resolve => {
      const tick = () => {
        const t = performance.now() - t0;
        const p = done && (err || t >= MIN) ? 1 : done ? Math.max(.9, t / MIN) : Math.min(.9, 1 - Math.exp(-t / 2200));
        bar.style.width = `${(p * 100).toFixed(1)}%`;
        txt.textContent = p >= 1 ? '완료' : `시뮬레이션 중 · 손님 ${n0(438325 * p)} 결정 / 438,325 × 안 4개`;
        if (p >= 1) return resolve(); requestAnimationFrame(tick);
      };
      tick();
    });
    live?.stop();
    if (res) {
      const keep = new Map($$('canvas[data-key]', el).map(c => [c.dataset.key, c]));
      VIEWS.run._r = res; fillRun(el, res);
      $$('img[data-shot]', el).forEach(i => { const c = keep.get(`${i.dataset.engine}:${i.dataset.shot}`); if (c) i.replaceWith(c); });
      markBest(el, res);
    } else if (err) slot(el, 'engines').insertAdjacentHTML('afterbegin', errBox(err));
    setTimeout(() => { gauge.hidden = true; }, 900);
    b.disabled = false; b.textContent = '다시 실행';
  };
  $('[data-act="rerun"]', el).onclick = rerun;
  $('[data-act="csv"]', el).onclick = () => {
    const r = VIEWS.run._r, rows = [['run', 'engine', 'plan', 'per_1000', 'lift', 'actual_per_1000', 'ratio_to_actual', 'mc_p05', 'mc_p95']];
    r.engines.forEach(e => e.plans.forEach(p => rows.push([r.id, e.id, p.id, p.per_1000, p.lift, r.actual_per_1000[p.id], p.ratio_to_actual, p.mc_p05 ?? '', p.mc_p95 ?? ''])));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(x => x.join(',')).join('\n')], { type: 'text/csv' })); a.download = `run_${r.id}.csv`; a.click();
  };
  if (params.go) { history.replaceState(null, '', '#run'); setTimeout(rerun, 1200); }
};

// S6 검증
VIEWS.verify = async (root) => {
  const v = await api('validation');
  const pe = v.persona.engines, je = v.jev.engines, me = v.model_eval;
  set(root, 'decisions', n0(me.n_test_rows)); set(root, 'buys', n0(me.n_test_buys));
  set(root, 'c1', `${v.persona.actual_buys_for_pairs}건`);
  set(root, 'c1s', `보정 모델 ${nf(pe.calibrated.predicted_buys_on_real_test_visits)} · Jev 그대로 ${n0(pe.jev_state.predicted_buys_on_real_test_visits)} · 페르소나 ${n0(pe.basic.predicted_buys_on_real_test_visits)}`);
  const actualNone = v.persona.actual_rate_by_condition_all_test.none;
  set(root, 'c2', pct(pe.calibrated.mean_p_by_condition.none)); set(root, 'c2s', `실제 ${pct(actualNone)} · ${nf(pe.calibrated.level_vs_actual_none)}배`);
  set(root, 'c3', pct(je.jev_calibrated.mean_p)); set(root, 'c3s', `실제 ${pct(me.engines.calibrated.actual_rate)} · 그대로 쓰면 ${pct(je.jev_raw.mean_p)}`);
  set(root, 'c4', pct(pe.basic.mean_p_by_condition.none)); set(root, 'c4s', `실제의 ${n0(pe.basic.level_vs_actual_none)}배`);
  set(root, 'strip', `실제 ${v.persona.actual_buys_for_pairs} · 우리 ${nf(pe.calibrated.predicted_buys_on_real_test_visits)} · Jev ${n0(pe.jev_state.predicted_buys_on_real_test_visits)} · 페르소나 ${n0(pe.basic.predicted_buys_on_real_test_visits)}`);
  const L = v.persona.actual_lift_pooled;
  set(root, 'effA', `${nf(L.A_front_endcap.actual)} <span class="muted">(${nf(L.A_front_endcap.ci95[0])}–${nf(L.A_front_endcap.ci95[1])})</span>`, true);
  set(root, 'effC', `${nf(L.C_other_display.actual)} <span class="muted">(${nf(L.C_other_display.ci95[0])}–${nf(L.C_other_display.ci95[1])})</span>`, true);
  [[je.gbdt_calibrated.auc, 1], [je.jev_calibrated.auc, 2], [je.no_promo.auc, 3]].forEach(([a, i]) => { set(root, `auc${i}`, nf(a, 3)); K(root, `aucBar${i}`).style.width = `${((a - .5) * 200).toFixed(0)}%`; });
  set(root, 'ece', nf(me.engines.calibrated.ece, 5));
};

// 최종 배치 (3D)
function stat(v, l, sub) { return `<div style="display:flex;flex-direction:column;gap:8px;padding:16px 0;border-top:1px solid var(--border)"><span class="lbl">${l}</span><span class="stat">${v}</span><span class="muted" style="font-size:12px">${sub}</span></div>`; }
VIEWS.layout = async (root, params) => {
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
  const ok = store.get('approved'); if (ok) slot(root, 'approve').innerHTML = `<span class="tag tag-ok" style="height:32px;padding:0 12px">승인됨 · ${esc(ok)}</span> <button type="button" class="btn btn-ghost btn-sm" data-act="undo">취소</button>`;
};
VIEWS.report.after = (el) => {
  const a = $('[data-act="approve"]', el); if (a) a.onclick = () => { store.set('approved', new Date().toLocaleString('ko-KR')); render(); };
  const u = $('[data-act="undo"]', el); if (u) u.onclick = () => { store.set('approved', null); render(); };
  $('[data-act="pdf"]', el).onclick = () => print();
  $('[data-act="share"]', el).onclick = async (e) => { try { await navigator.clipboard.writeText(location.href); e.currentTarget.lastChild.textContent = ' 복사됨'; } catch { prompt('링크', location.href); } };
};

// S8 매장 연결
VIEWS.connect = async (root) => {
  const c = await api('catalog');
  set(root, 'cardEp', `${c.endpoints.filter(e => e.events != null).length} / ${c.endpoints.length}`);
  set(root, 'cardStore', `STORE ${store.get('store', '367')}`); set(root, 'cardSub', `${n0(c.households)}가구 · 1년`);
};
VIEWS.connect.after = (el) => {
  let files = {};
  const job = slot(el, 'job');
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
        set(el, 'cardStore', 'STORE · 업로드'); set(el, 'cardSrc', name.toUpperCase().slice(0, 24)); set(el, 'cardVer', j.status === 'done' ? 'CALIBRATED · 이 매장' : '보정 중');
        job.innerHTML = `<div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px"><div style="display:flex;gap:10px;align-items:center">${j.status === 'running' || j.status === 'mapping' ? '<span class="spin"></span><b style="font-weight:500">결정 표 → 학습 · 보정 → 공간맵 → 앞으로 4주 시뮬레이션 → 최종 배치</b>' : j.status === 'done' ? '<span class="tag tag-ok">완료</span>' : `<span class="tag tag-no">${esc(j.status)}</span>`}</div>${j.error ? `<p class="err">${esc(j.error)}</p>` : ''}${j.status === 'done' ? `<div style="font-size:14px">기록을 연결하고 이 매장 손님으로 결정 모델을 보정했습니다. 아래는 다음 4주의 제안 배치입니다.</div>` : `<div class="mono muted" style="font-size:11px">${esc((j.log || []).slice(-1)[0] || '시작하는 중')}</div>`}</div>`;
        if (!['running', 'mapping'].includes(j.status)) break;
        await new Promise(r => setTimeout(r, 2000)); j = await api(`job?id=${j.id}`);
      }
      if (j.layout) {
        const P = j.layout.plans;
        job.insertAdjacentHTML('beforeend', `<div style="margin-top:16px;position:relative;overflow:hidden;border:1px solid var(--border);border-radius:6px"><div data-slot="ustage" style="height:520px"></div><div style="position:absolute;left:16px;top:16px;display:flex;gap:8px;flex-wrap:wrap"><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">이 매장 · 앞으로 4주 예측</span><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">판매 방문 지금 배치 ${nf(P.current.expected_units, 1)} → 제안 ${nf(P.proposed.expected_units, 1)}</span></div></div>
          <div style="margin-top:12px;display:flex;justify-content:flex-end"><a class="btn btn-mono" href="#plans">다음: 시험할 안 →</a></div>`);
        const s3 = stage3d(slot(job, 'ustage'), { aisles: j.layout.aisles, products: j.layout.products }, { shoppers: 10, weeks: j.layout.weeks.join('–') });
        setTimeout(() => s3.go('next'), 800); cleanups.push(() => s3.dispose());
        set(el, 's1', '연결됨');
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
