import { mountStore } from './store3d.js';

// ---------------------------------------------------------------- helpers
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = x => x == null ? '—' : Math.round(x).toLocaleString('en-US');
const nf = (x, d = 2) => x == null ? '—' : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = p => p == null ? '—' : p >= .1 ? `${Math.round(p * 100)}%` : p >= .01 ? `${(p * 100).toFixed(1)}%` : `${(p * 100).toFixed(3)}%`;
const LBL = { A_front_endcap: '앞쪽 엔드캡', B_mailer_only: '전단', C_other_display: '기타 진열', none: '평소대로' };
const COL = { A_front_endcap: '#3B73FF', B_mailer_only: '#FCBB00', C_other_display: '#88ACFA', none: '#B8BEC2' };
const PLANS = ['none', 'A_front_endcap', 'B_mailer_only', 'C_other_display'];
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem('oa:' + k)) ?? d; } catch { return d; } },
                set(k, v) { try { localStorage.setItem('oa:' + k, JSON.stringify(v)); } catch {} } };

async function api(path, body) {
  const r = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `서버 응답을 읽지 못했습니다 (${r.status})` }));
  if (!r.ok || j?.error) throw new Error(j?.error || r.statusText);
  return j;
}
const ico = d => `<svg class="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const arrow = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const loading = (msg = '불러오는 중') => `<div class="empty"><span class="spin"></span> ${esc(msg)}</div>`;
const fail = e => `<div class="card pad err" role="alert">${esc(e.message || e)}</div>`;
const hdr = (title, right = '') => `<div class="hdr"><h1 class="ptitle">${title}</h1><div class="row">${right}</div></div>`;
const tag = (live) => live ? '<span class="tag tag-ok">지금 계산</span>' : '<span class="tag tag-ai">저장된 평가</span>';
const tip = $('#tip');
function showTip(html, x, y) { tip.innerHTML = html; tip.hidden = false; tip.style.left = Math.min(x + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(y + 14, innerHeight - tip.offsetHeight - 8) + 'px'; }
const hideTip = () => { tip.hidden = true; };
function productTip(p, state, weeks) {
  const on = state === 'next' ? p.next : p.now;
  const rows = p.units && Object.keys(p.units).length ? `<table>${['none', 'A_front_endcap', 'C_other_display'].map(o => `<tr class="${o === on ? 'on' : ''}"><td>${LBL[o] === '평소대로' ? '선반' : LBL[o]}</td><td>${nf(p.units[o])}</td></tr>`).join('')}</table><span style="color:#4d5353">기대 판매 방문 · ${weeks || '48–53'}주</span>` : '';
  return `<b>${p.n}. ${esc(p.name)} ${esc(p.size)}</b><br>${p.moved ? `${LBL[p.now]} → <b>${LBL[p.next]}</b>` : LBL[on]}${p.mailer ? ' · 전단' : ''}${rows}`;
}
function stage3d(el, data, opts = {}) {
  const r = () => el.getBoundingClientRect();
  return mountStore(el, data, { ...opts, onHover: (p, x, y, st) => p ? showTip(productTip(p, st, opts.weeks), r().left + x, r().top + y) : hideTip() });
}

// ---------------------------------------------------------------- shell
const NAV = [
  ['sec', '01 결정'], ['brief', '결정 브리프', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5'],
  ['sec', '02 매장을 API로'], ['endpoints', '엔드포인트', 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
  ['world', '매장 월드', 'M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7zM3.3 7 12 12l8.7-5M12 22V12'],
  ['sec', '03 엔진'], ['engines', '엔진 비교', 'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM13 6h3a2 2 0 0 1 2 2v7M11 18H8a2 2 0 0 1-2-2V9'],
  ['plans', '결정 안', 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'], ['run', '실행', 'M6 3l14 9-14 9V3z'],
  ['sec', '04 증명 · 결론'], ['verify', '검증', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4'],
  ['layout', '최종 배치', 'M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM9 21v-7h6v7'], ['report', '리포트', 'M3 3v18h18M7 16l4-4 4 4 5-6'],
  ['sec', '05 확장'], ['connect', '매장 연결', 'M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8'],
];
$('#nav').innerHTML = NAV.map(([id, label, d]) => id === 'sec' ? `<div class="sec">${label}</div>` : `<a href="#${id}" data-id="${id}">${ico(d)}<span>${label}</span></a>`).join('');

let cleanup = null;
async function render() {
  const [id, qs] = (location.hash.slice(1) || 'brief').split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const view = VIEWS[id] ? id : 'brief';
  document.querySelectorAll('#nav a').forEach(a => a.dataset.id === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  cleanup?.(); cleanup = null; hideTip();
  const el = $('#view'); el.innerHTML = '';
  document.title = `${NAV.find(n => n[0] === view)[1]} · Offline API`;
  try { cleanup = await VIEWS[view](el, params) || null; } catch (e) { el.insertAdjacentHTML('beforeend', fail(e)); }
}
addEventListener('hashchange', render);

async function boot() {
  try {
    const h = await api('health');
    $('#f-llm').textContent = h.llm ? `LLM ${h.model}` : 'LLM 꺼짐';
    const c = await api('catalog');
    $('#f-hh').textContent = n0(c.households); $('#f-st').textContent = n0(c.stores);
    const v = await api('validation');
    $('#f-auc').textContent = nf(v.simulator.engines.calibrated.per_decision.auc, 3);
    const poll = async () => { const s = await api('health'); $('#f-status').textContent = s.loaded ? '연결됨 · 모델 준비' : '모델 불러오는 중…'; if (!s.loaded) setTimeout(poll, 1500); };
    poll();
  } catch (e) { $('#f-status').textContent = '서버에 연결하지 못했습니다'; }
}

// ---------------------------------------------------------------- views
const VIEWS = {};

// S0 · 결정 브리프
VIEWS.brief = async (el) => {
  const health = await api('health');
  const cat = await api('catalog');
  const partner = store.get('partner', { weeks: '', visits: '' });
  el.innerHTML = `${hdr('결정 브리프', `<span class="chip">${health.llm ? `질문 정리 · ${esc(health.model)}` : '질문 정리 · 규칙 (OPENAI_API_KEY 없음)'}</span>`)}
  <section class="hero"><span class="lbl lbl15">Offline API</span>
    <h2 class="display d44">오프라인 결정을, 미리 돌려보세요</h2>
    <p class="lead">매장을 API로 읽고, 실제 손님의 구매로 보정한 시뮬레이션이 다음 주 진열을 먼저 시험합니다. 예측은 언어 모델이 아니라 보정된 결정 모델이 합니다. 언어 모델은 질문 정리와 설명만 맡습니다.</p></section>
  <form id="f" class="card pad20 stack" style="max-width:880px">
    <div class="field"><label for="q">이번 결정</label><textarea id="q" class="input">${esc(store.get('question', '다음 주 시리얼, 입구 엔드캡에 둘까 전단에 실을까?'))}</textarea></div>
    <div class="row"><button class="btn btn-mono" id="go" type="submit">시험 가능한 결정으로 정리 ${arrow}</button><span class="muted" style="font-size:13px">고민 한 줄이 안과 지표가 됩니다.</span></div>
  </form>
  <section id="spec"></section>
  <section class="cols2">
    <div class="card pad20 stack"><span class="lbl">시험에 걸리는 것</span>
      <div class="cols3"><div><div class="stat">${n0(cat.receipt_lines)}</div><div class="muted" style="font-size:12px;margin-top:6px">영수증 줄 · 1년</div></div>
      <div><div class="stat">${n0(cat.placement_rows)}</div><div class="muted" style="font-size:12px;margin-top:6px">진열 기록 줄</div></div>
      <div><div class="stat">6주</div><div class="muted" style="font-size:12px;margin-top:6px">본 적 없는 시험 기간 (48–53주)</div></div></div></div>
    <div class="card pad20 stack"><span class="lbl">매장 실험이라면 · 파트너 입력</span>
      <p class="muted" style="font-size:13px">실험 기간과 주당 방문 수를 넣으면 리포트가 아낀 기간과 매출을 계산합니다. 비워 두면 계산하지 않습니다.</p>
      <div class="row"><div class="field" style="flex:1"><label for="pw">매장 실험 기간 (주)</label><input id="pw" class="input" inputmode="numeric" value="${esc(partner.weeks)}" placeholder="예: 4"></div>
      <div class="field" style="flex:1"><label for="pv">주당 매장 방문 수</label><input id="pv" class="input" inputmode="numeric" value="${esc(partner.visits)}" placeholder="예: 12000"></div></div></div>
  </section>`;
  const save = () => store.set('partner', { weeks: $('#pw').value.replace(/\D/g, ''), visits: $('#pv').value.replace(/\D/g, '') });
  $('#pw').oninput = $('#pv').oninput = save;
  const show = (s) => {
    $('#spec').innerHTML = `<div class="tbl" style="max-width:880px">
      <div class="th" style="grid-template-columns:120px 1fr"><span>항목</span><span>${s.structured_by === 'rules' ? '규칙으로 정리' : `${esc(s.structured_by)}로 정리`}</span></div>
      <div class="tr" style="grid-template-columns:120px 1fr"><span class="lbl">질문</span><span>${esc(s.question)}</span></div>
      <div class="tr" style="grid-template-columns:120px 1fr"><span class="lbl">안</span><span class="row" style="gap:6px">${s.plans.map(p => `<span class="pill"><span class="sq" style="background:${COL[p]}"></span>${LBL[p]}</span>`).join('')}</span></div>
      <div class="tr" style="grid-template-columns:120px 1fr"><span class="lbl">지표</span><span>${esc(s.metric)}</span></div>
      <div class="tr" style="grid-template-columns:120px 1fr"><span class="lbl">근거</span><span>${n0(cat.households)}가구 · ${n0(cat.stores)}개 매장 · 영수증 ${n0(cat.receipt_lines)}줄 · 진열 기록 ${n0(cat.placement_rows)}줄</span></div>
      <div class="tr" style="grid-template-columns:120px 1fr"><span class="lbl">엔진</span><span>보정 모델 · 평소대로 예측 · 평균 효과 (지금 계산) · Jev + 보정 · 페르소나 (저장된 평가)</span></div>
      ${s.excluded?.length ? `<div class="tr" style="grid-template-columns:120px 1fr"><span class="lbl">제외</span><span class="muted">${s.excluded.map(esc).join('<br>')}</span></div>` : ''}
      ${s.llm_error ? `<div class="tr" style="grid-template-columns:120px 1fr"><span class="lbl">LLM</span><span class="err">모델 호출 실패, 규칙으로 정리했습니다: ${esc(s.llm_error)}</span></div>` : ''}
    </div>
    <div class="row" style="margin-top:16px"><a class="btn btn-mono" href="#run?go=1">${s.plans.length * 5}개 실행 시작 ${arrow}</a><a class="btn btn-outline" href="#plans">안 자세히</a></div>`;
  };
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const b = $('#go'); b.disabled = true; b.innerHTML = '<span class="spin"></span> 정리 중';
    store.set('question', $('#q').value);
    try { const s = await api('brief', { question: $('#q').value }); store.set('spec', s); show(s); } catch (err) { $('#spec').innerHTML = fail(err); }
    b.disabled = false; b.innerHTML = `시험 가능한 결정으로 정리 ${arrow}`;
  };
  const prev = store.get('spec'); if (prev) show(prev);
};

// S1 · 엔드포인트
VIEWS.endpoints = async (el) => {
  el.innerHTML = hdr('엔드포인트', '<span class="chip">dunnhumby · 연결됨</span>') + loading();
  const c = await api('catalog');
  const groups = [['영수증', 'POST /visit · /basket/add', '방문 · 담기 · 할인 · 쿠폰 · 결제. POS 내보내기 파일만으로 연결됩니다.'],
                  ['진열 · 전단', 'GET /exposure/display', '상품 × 매장 × 주마다 어디에 놓였는지. 진열 효과를 잴 수 있게 만드는 기록입니다.'],
                  ['센서', '/path · /dwell · 대기', '이동과 체류. 아직 연결 전이라 월드 속 걸음은 표현으로만 쓰입니다.']];
  el.innerHTML = hdr('엔드포인트', '<span class="chip">dunnhumby · 연결됨</span>') + `
  <p class="lead" style="max-width:900px">온라인은 클릭마다 이벤트가 남고, 오프라인은 영수증만 남습니다. 영수증과 진열 기록을 매장의 순간마다 API 이벤트로 나눠 받습니다. 지난 1년, ${n0(c.households)}가구 · ${n0(c.stores)}개 매장 · 방문 ${n0(c.visits)}회.</p>
  <section class="cols3">${groups.map(([g, path, d]) => `<div class="card pad20 stack"><span class="lbl">${esc(path)}</span><b style="font-size:16px;font-weight:600">${g} 엔드포인트</b><p class="muted" style="font-size:14px;line-height:1.6">${d}</p></div>`).join('')}</section>
  <section class="tbl scroll"><div class="th" style="grid-template-columns:70px 180px minmax(0,1fr) 130px"><span>방식</span><span>경로</span><span>원천</span><span class="r">이벤트 · 1년</span></div>
    ${c.endpoints.map(e => `<div class="tr" style="grid-template-columns:70px 180px minmax(0,1fr) 130px"><span class="badge">${e.method}</span><span class="mono" style="font-size:13px">${esc(e.path)}</span><span class="muted" style="font-size:13px">${esc(e.source)}</span><span class="num r">${e.events == null ? '<span class="tag">대기</span>' : n0(e.events)}</span></div>`).join('')}</section>
  <section class="stack"><div class="hdr"><div><span class="lbl">이벤트 로그</span><h2 class="display d29" style="margin-top:6px">장바구니 하나를 다시 재생</h2></div><button class="btn btn-outline btn-sm" id="again" type="button">다른 방문 재생</button></div><div id="log">${loading()}</div></section>`;
  const play = async (basket) => {
    $('#log').innerHTML = loading();
    const r = await api('replay' + (basket ? `?basket=${basket}` : ''));
    const disp = r.events.find(e => e.path === '/exposure/display' && e.args.endsWith('loc=3'));
    $('#log').innerHTML = `<div class="lbl" style="margin-bottom:8px;text-transform:none">basket ${esc(r.basket_id)} · ${esc(r.time)} · store ${esc(r.store_id)} · 가구 ${esc(r.household_id)} · ${r.week}주</div>
      <div class="log" role="log">${r.events.map(e => `<div><span class="m">${e.m}</span><span class="p">${esc(e.path)}</span> <span class="a">${esc(e.args)}</span>${e.amount != null ? ` <span>${e.amount < 0 ? '-' : ''}$${nf(Math.abs(e.amount))}</span>` : ''}${e.item ? ` <span class="a">${esc(e.item)}</span>` : ''}${e.note ? ` <span class="n">${esc(e.note)}</span>` : ''}</div>`).join('')}</div>
      ${disp ? `<p class="body" style="margin-top:12px">상품 #${esc(disp.args.split(' ')[0].split('=')[1])}는 그 주 Store ${esc(r.store_id)}의 <b>앞쪽 엔드캡</b>(진열 코드 3)에 있었습니다.</p>` : ''}`;
  };
  $('#again').onclick = () => play('random');
  await play();
};

// S2 · 매장 월드
VIEWS.world = async (el, params) => {
  el.innerHTML = hdr('매장 월드') + loading('매장 지도를 만드는 중');
  const stores = await api('stores');
  const sid = params.store || store.get('store', stores[0].store_id);
  const w = await api(`world?store=${sid}`);
  const m = w.map;
  el.innerHTML = hdr(`매장 월드 · Store ${esc(sid)}`, `<label class="lbl" for="st">매장</label><select id="st" class="input">${stores.map(s => `<option value="${s.store_id}" ${s.store_id === sid ? 'selected' : ''}>Store ${s.store_id} · 방문 ${s.visits}</option>`).join('')}</select>`) + `
  <section class="stage" id="stage">
    <div class="ov" style="left:16px;top:16px;z-index:2"><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px;letter-spacing:.5px">Store ${esc(sid)} · 통로 ${m.aisles.length} · 진열 ${m.displays.length}종 · ${m.as_of_week}주 기준 배치</span></div>
    <div class="ov" style="left:16px;bottom:16px;z-index:2"><span class="chip glass" style="color:#000">48–53주 방문 ${n0(w.visits_test)}회 · 가구 ${n0(w.households_test)}</span><span class="chip glass" style="color:#000">시리얼 판매 방문 ${w.buys_test}</span><span class="chip glass" style="color:#000">걷는 모습은 표현 · 이동 데이터 없음</span></div>
  </section>
  <div class="legend"><span><span class="sq" style="background:#3B73FF"></span>앞쪽 엔드캡</span><span><span class="sq" style="background:#88ACFA"></span>기타 진열</span><span><span class="sq" style="background:#B8BEC2"></span>일반 선반</span><span><span class="sq" style="background:#FCBB00;border-radius:50%"></span>전단</span><span class="muted">좌표는 템플릿. 통로 비중·진열 자리·상품 위치는 데이터.</span></div>
  <section class="cols2">
    <div><div class="lbl">이 매장에 온 가구 · 지난 26주 행동에서 계산</div><h2 class="display d29" style="margin-top:10px">글이 아니라, 숫자로 된 사람.</h2>
      <p class="muted" style="margin-top:8px;font-size:14px">가구를 고르면 같은 가구에게 엔진들이 무엇이라고 답하는지 봅니다.</p></div>
    <div class="tbl"><div class="th" style="grid-template-columns:90px 1fr 1fr 1fr 70px"><span>가구</span><span>방문 · 26주</span><span>시리얼 방문</span><span>할인 비중</span><span class="r">48–53주</span></div>
      ${w.households.slice(0, 14).map(h => `<a class="tr" style="grid-template-columns:90px 1fr 1fr 1fr 70px;text-decoration:none" href="#engines?hh=${h.household_id}"><span class="num">${h.household_id}</span><span class="num">${n0(h.state.visits)}</span><span class="num">${pct(h.state.cereal_visit_rate)}</span><span class="num">${pct(h.state.disc_share)}</span><span class="num r">${h.visits_test}회 · ${h.cereal_buys_test}</span></a>`).join('')}</div>
  </section>`;
  $('#st').onchange = e => { store.set('store', e.target.value); location.hash = `#world?store=${e.target.value}`; };
  const prods = m.products.map(p => ({ n: p.n, id: p.product_id, name: `${p.brand} ${p.type.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}`, size: p.size, now: p.condition, next: p.condition, moved: false, mailer: p.mailer !== '0', units: {} }));
  const perDay = w.visits_test / Math.max(1, w.daily_visits.length);
  const s3 = stage3d($('#stage'), { aisles: m.aisles, products: prods }, { shoppers: Math.max(3, Math.min(16, Math.round(perDay / 4))) });
  return () => s3.dispose();
};

// S3 · 엔진 비교
VIEWS.engines = async (el, params) => {
  el.innerHTML = hdr('엔진 비교') + loading();
  const [pairs, val, health] = await Promise.all([api('pairs'), api('validation'), api('health')]);
  const hh = params.hh || '1804';
  let d;
  try { d = await api(`household?id=${hh}${params.product ? `&product=${params.product}` : ''}`); }
  catch (e) { el.innerHTML = hdr('엔진 비교') + fail(e) + `<p class="muted"><a href="#engines?hh=1804">가구 1804로 돌아가기</a></p>`; return; }
  const opts = [...new Set([hh, ...pairs.map(p => p.household_id)])];
  const pr = d.product;
  const pname = `${pr.brand === 'Private' ? '자체 브랜드' : pr.brand} ${pr.type.toLowerCase()} (${pr.size})`;
  const demo = d.demographics ? `${d.demographics.age}세 · ${d.demographics.household_comp} · ${d.demographics.household_size}인 · 소득 ${d.demographics.income}` : '인구통계 없음 (페르소나를 만들 수 없는 가구)';
  const row = (e) => `<div class="tr" style="grid-template-columns:minmax(0,1.4fr) repeat(4, minmax(70px,.6fr))"><span><b style="font-weight:500">${esc(e.label)}</b> ${tag(e.live)}<br><span class="muted" style="font-size:12px">${esc(e.note)}</span></span>${PLANS.map(c => `<span class="num r" style="font-size:14px">${pct(e.p[c])}</span>`).join('')}</div>`;
  const level = [['보정 모델', val.persona.engines.calibrated.level_vs_actual_none, '#0f766e'],
                 ['Jev + 매장 보정', val.jev.engines.jev_calibrated.by_condition.none / val.persona.actual_rate_by_condition_all_test.none, '#6d5bd0'],
                 ['페르소나 + 이력', val.persona.engines.history.level_vs_actual_none, '#f99c00'],
                 ['Jev · 숫자 상태', val.persona.engines.jev_state.level_vs_actual_none, '#6d5bd0'],
                 ['페르소나', val.persona.engines.basic.level_vs_actual_none, '#f99c00'],
                 ['Jev · 글', val.persona.engines.jev_text.level_vs_actual_none, '#6d5bd0']];
  const lx = r => Math.max(0, Math.min(100, (Math.log10(r) + 1) / 4 * 100));    // 0.1x .. 1000x
  el.innerHTML = hdr('엔진 비교', `<label class="lbl" for="hh">가구</label><select id="hh" class="input">${opts.map(h => `<option ${h === hh ? 'selected' : ''}>${h}</option>`).join('')}</select>`) + `
  <section class="cols2">
    <div class="stack"><span class="lbl">가구 ${esc(hh)} · 상품 #${esc(pr.product_id)} · 실제 ${d.actual.visits}회 방문 · ${d.actual.bought_this}회 구매</span>
      <h2 class="display d32">같은 가구, 같은 상품, 네 가지 매장 조건</h2>
      <p class="lead">${esc(demo)}에게 ${esc(pname)}을 이번 장보기에 담을 확률을 물었습니다.</p></div>
    <div class="card pad20 stack"><span class="lbl">행동에서 계산한 상태 · 1–26주</span>
      <div class="cols3" style="gap:10px">${[['방문', n0(d.state.visits) + '회'], ['평균 장바구니', '$' + nf(d.state.avg_spend)], ['시리얼 산 방문', pct(d.state.cereal_visit_rate)], ['할인 비중', pct(d.state.disc_share)], ['자체 브랜드', pct(d.state.private_share)], ['이 상품 구매', n0(d.state.hp_count) + '회']].map(([k, v]) => `<div><div class="lbl" style="text-transform:none">${k}</div><div class="num" style="font-size:16px;margin-top:4px">${v}</div></div>`).join('')}</div></div>
  </section>
  <section class="tbl scroll" id="eng"><div class="th" style="grid-template-columns:minmax(0,1.4fr) repeat(4, minmax(70px,.6fr))"><span>엔진</span>${PLANS.map(c => `<span class="r">${LBL[c]}</span>`).join('')}</div>
    ${d.engines.map(row).join('')}</section>
  <div class="row">${health.llm && d.demographics ? `<button class="btn btn-outline btn-sm" id="live" type="button">페르소나에게 지금 다시 묻기 · ${esc(health.model)}</button>` : `<span class="muted" style="font-size:13px">${health.llm ? '이 가구는 인구통계가 없어 페르소나에게 물을 수 없습니다.' : 'OPENAI_API_KEY를 넣으면 페르소나에게 지금 다시 물을 수 있습니다.'}</span>`}
    <span class="muted" style="font-size:13px">위 몇 줄은 조건이 바뀌어도 거의 그대로입니다. 보정된 줄만 엔드캡에서 오릅니다.</span></div>
  <section class="cols2">
    <div class="stack"><span class="lbl">가구 ${esc(hh)}의 영수증 · 48–53주 · 실제</span>
      <div class="tbl">${d.receipts.slice(0, 8).map(r => `<div class="tr" style="grid-template-columns:150px 1fr 90px"><span class="mono" style="font-size:12px">STORE ${esc(r.store_id)} · ${esc(r.time)}</span><span style="font-size:13px">${r.items}개 · ${esc(r.top.join(', '))}</span><span class="r">${r.bought_this ? '<span class="tag tag-ok">이 상품</span>' : r.cereal ? '<span class="tag">시리얼</span>' : '<span class="muted" style="font-size:12px">$' + nf(r.total) + '</span>'}</span></div>`).join('')}</div>
      <p class="muted" style="font-size:13px">${d.receipts.length}번 방문 · 이 상품 ${d.actual.bought_this}번 · 시리얼 전체 ${d.actual.cereal_visits}번</p></div>
    <div class="stack"><span class="lbl">전체 가구로 넓히면 · 평소 구매 확률 · 실제 대비 · 로그 눈금</span>
      ${level.map(([k, r, c]) => `<div class="logbar"><span>${k}</span><span class="track"><span class="act" style="left:${lx(1)}%"></span><i style="width:${lx(r)}%;background:${c}"></i></span><span class="num r">${r < 1.5 && r > .67 ? (r >= .95 && r <= 1.05 ? '실제와 일치' : nf(r) + '배') : n0(r) + '배'}</span></div>`).join('')}
      <div class="logbar" style="border-top:0;padding-top:0"><span></span><span class="row mono muted" style="justify-content:space-between;font-size:10px"><span>0.1배</span><span>실제</span><span>10배</span><span>100배</span><span>1000배</span></span><span></span></div>
      <div class="quote"><p class="body"><b>Calibrated to People, not to Answers.</b> Jev는 답이 맞을 확률을 보정합니다. 사람의 구매 비율은 그 매장 데이터로만 보정됩니다.</p></div></div>
  </section>`;
  $('#hh').onchange = e => location.hash = `#engines?hh=${e.target.value}`;
  const live = $('#live');
  if (live) live.onclick = async () => {
    live.disabled = true; live.innerHTML = '<span class="spin"></span> 묻는 중';
    try { const e = await api(`persona?id=${hh}&product=${pr.product_id}`); $('#eng').insertAdjacentHTML('beforeend', row(e)); live.remove(); }
    catch (err) { live.disabled = false; live.textContent = '다시 묻기'; $('#eng').insertAdjacentHTML('afterend', fail(err)); }
  };
};

// S4 · 결정 안
VIEWS.plans = async (el) => {
  const plans = await api('plans');
  const spec = store.get('spec');
  el.innerHTML = hdr('결정 안 · 다음 주 콜드 시리얼', `<span class="chip">근거 기록 ${n0(plans.reduce((a, p) => a + p.evidence_rows, 0))}</span><span class="chip">시험할 안 ${plans.length}</span>`) + `
  <p class="lead" style="max-width:900px">과거에 실제로 있었던 진열만 안이 됩니다. 근거 기록은 27–53주에 그 조건이었던 방문 × 상품 행 수입니다.</p>
  <section class="cols4">${plans.map(p => `<div class="card acc wash pad20 stack" style="--card-accent:${COL[p.id]}"><div class="row" style="justify-content:space-between"><span class="sq" style="background:${COL[p.id]};width:12px;height:12px"></span><span class="tag tag-ok">✓ 시험 가능</span></div>
    <b style="font-size:18px;font-weight:600">${p.label}</b><span class="muted" style="font-size:13px">${esc(p.desc)}</span><div><div class="lbl">근거 기록</div><div class="stat" style="margin-top:6px">${n0(p.evidence_rows)}</div></div></div>`).join('')}</section>
  <section class="card pad20 stack" style="max-width:900px"><span class="lbl">제외한 안</span><p class="body"><b>할인</b>: 사지 않은 방문의 가격이 기록에 없어 시험할 수 없습니다.${spec?.excluded?.length ? ' 브리프에서도 제외했습니다.' : ''}</p></section>
  <div class="row"><a class="btn btn-mono" href="#run?go=1">${plans.length}개 안 × 5개 엔진 실행 ${arrow}</a></div>`;
};

// S5 · 실행
VIEWS.run = async (el, params) => {
  el.innerHTML = hdr('실행') + loading();
  let r = await api('run/latest');
  const draw = () => {
    el.innerHTML = hdr(`실행 #${esc(r.id)}`, `<span class="chip">시드 ${r.seed} · 추첨 ${r.draws}번</span><button class="btn btn-outline btn-sm" id="rerun" type="button">다른 운으로 다시 실행</button>`) + `
    <p class="lead" style="max-width:960px">엔진 ${r.engines.length}개 × 안 4개. 숫자는 방문 1,000회당 판매이고, 오른쪽은 시험 기간(48–53주) 실제값입니다. 모델이 이 기간의 구매를 본 적은 없습니다. 모든 안이 같은 방문과 같은 난수를 씁니다.</p>
    <div class="hstat"><span>방문 × 상품 <b>${n0(r.decisions)}</b></span><span>방문 <b>${n0(r.visits)}</b></span><span>실제 구매 <b>${n0(r.actual_buys)}</b></span><span>기간 <b>${r.weeks.join('–')}주</b></span><span>${esc(r.at)}</span></div>
    ${r.engines.map(e => `<section class="stack"><div class="row" style="justify-content:space-between"><div><b style="font-size:16px;font-weight:600">${esc(e.label)}</b> ${tag(e.live)}<div class="muted" style="font-size:13px;margin-top:2px">${esc(e.note)}</div></div></div>
      <div class="cols4">${['A_front_endcap', 'B_mailer_only', 'C_other_display', 'none'].map(c => { const p = e.plans.find(x => x.id === c), a = r.actual_per_1000[c], k = p.ratio_to_actual;
        return `<div class="card pad stack" style="gap:6px"><div class="row" style="justify-content:space-between"><span class="lbl">${LBL[c]}</span><span class="sq" style="background:${COL[c]}"></span></div>
        <div class="row" style="align-items:baseline;gap:8px"><span class="stat">${p.per_1000 >= 100 ? n0(p.per_1000) : nf(p.per_1000)}</span><span class="muted" style="font-size:12px">실제 ${nf(a)}</span></div>
        <div class="muted" style="font-size:12px">평소 대비 ${nf(p.lift, 1)}배${p.mc_p05 != null ? ` · 90% ${n0(p.mc_p05)}–${n0(p.mc_p95)}건` : ''}</div>
        <div style="font-size:12px" class="${k > 3 ? 'err' : ''}">${k == null ? '' : k > 3 ? `${n0(k)}배 과대` : `실제의 ${nf(k)}`}</div></div>`; }).join('')}</div></section>`).join('')}`;
    $('#rerun').onclick = go;
  };
  async function go() {
    const b = $('#rerun'); if (b) { b.disabled = true; b.innerHTML = '<span class="spin"></span> 438,325 결정 × 4안 계산 중'; }
    try { r = await api('run', { draws: 100, seed: Math.floor(Math.random() * 1e6) }); draw(); } catch (e) { el.insertAdjacentHTML('beforeend', fail(e)); }
  }
  if (!r) { el.innerHTML = hdr('실행') + loading('첫 실행 중 · 438,325 결정 × 4안'); r = await api('run', { draws: 100, seed: 42 }); }
  draw();
  if (params.go) { history.replaceState(null, '', '#run'); go(); }
};

// S6 · 검증
VIEWS.verify = async (el) => {
  const v = await api('validation');
  const S = v.simulator, c = S.engines.calibrated, pe = v.persona.engines;
  const W = 640, H = 220, pad = 30, wk = c.weekly, mx = Math.max(...wk.map(w => Math.max(w.actual_units, w.mc_p95))) * 1.1;
  const bw = (W - pad * 2) / wk.length, y = val => H - pad - val / mx * (H - pad * 2);
  const chart = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="주별 실제 판매와 시뮬레이션 범위" style="width:100%;height:auto">
    ${[0, .5, 1].map(f => `<line x1="${pad}" x2="${W - pad}" y1="${y(mx * f / 1.1)}" y2="${y(mx * f / 1.1)}" stroke="#d8dddf"/><text x="${pad - 6}" y="${y(mx * f / 1.1) + 4}" font-size="10" text-anchor="end" fill="#4d5353">${Math.round(mx * f / 1.1)}</text>`).join('')}
    ${wk.map((w, i) => { const x = pad + i * bw; return `<rect x="${x + bw * .2}" y="${y(w.mc_p95)}" width="${bw * .6}" height="${y(w.mc_p05) - y(w.mc_p95)}" fill="#0f766e" fill-opacity=".14" rx="2"/>
      <line x1="${x + bw * .2}" x2="${x + bw * .8}" y1="${y(w.expected_units)}" y2="${y(w.expected_units)}" stroke="#0f766e" stroke-width="2"/>
      <circle cx="${x + bw / 2}" cy="${y(w.actual_units)}" r="5" fill="${w.actual_in_band ? '#000' : '#e40014'}"/>
      <text x="${x + bw / 2}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#4d5353">${w.week}주</text>`; }).join('')}</svg>`;
  const rel = v.model_eval.engines.calibrated.reliability, rm = Math.sqrt(Math.max(...rel.map(r => Math.max(r.p, r.y))) * 100) * 1.1;
  const R = 220, rx = p => 24 + Math.sqrt(p * 100) / rm * (R - 34), ry = p => R - 24 - Math.sqrt(p * 100) / rm * (R - 34);
  const relSvg = `<svg viewBox="0 0 ${R} ${R}" role="img" aria-label="보정 곡선" style="width:100%;max-width:300px;height:auto"><line x1="${rx(0)}" y1="${ry(0)}" x2="${rx((rm / 1.1) ** 2 / 100)}" y2="${ry((rm / 1.1) ** 2 / 100)}" stroke="#4d5353" stroke-dasharray="4 4"/>
    ${rel.map(r => `<circle cx="${rx(r.p)}" cy="${ry(r.y)}" r="${3 + Math.sqrt(r.n) / 80}" fill="#0f766e" fill-opacity=".8"/>`).join('')}
    <text x="${R / 2}" y="${R - 4}" font-size="10" text-anchor="middle" fill="#4d5353">예측 · √%</text><text x="10" y="${R / 2}" font-size="10" fill="#4d5353" transform="rotate(-90 10 ${R / 2})" text-anchor="middle">실제 · √%</text></svg>`;
  const aucs = [['보정 모델', v.model_eval.engines.calibrated.auc], ['Jev + 매장 보정', v.jev.engines.jev_calibrated.auc], ['평소대로 예측', v.model_eval.engines.no_promo.auc]];
  el.innerHTML = hdr('검증', '<span class="tab on">48–53주</span>') + `
  <p class="lead" style="max-width:960px">모델이 본 적 없는 주의 실제 구매와 비교했습니다. 방문 × 상품 ${n0(S.decisions)}건, 실제 구매 ${S.actual_units}건. 90% 범위는 손님 운만 담고 모델 오차는 담지 않습니다.</p>
  <section class="cols4">
    <div class="card pad20 stack"><span class="lbl">방문 1,000회 → 실제 구매</span><span class="stat">1건</span><span class="muted" style="font-size:12px">보정 모델 ${nf(pe.calibrated.predicted_buys_on_real_test_visits)} · Jev 그대로 ${n0(pe.jev_state.predicted_buys_on_real_test_visits)} · 페르소나 ${n0(pe.basic.predicted_buys_on_real_test_visits)}</span></div>
    <div class="card pad20 stack"><span class="lbl">시뮬레이션 총량 · 실제 진열 그대로</span><span class="stat">${n0(c.total.expected)} <span class="muted" style="font-size:14px">/ 실제 ${c.total.actual}</span></span><span class="muted" style="font-size:12px">90% ${n0(c.total.mc_p05)}–${n0(c.total.mc_p95)} ${c.total.actual_in_band ? '✓' : '✗ · 약 10% 낮게 봄'}</span></div>
    <div class="card pad20 stack"><span class="lbl">리포트 숫자 재현</span><span class="stat">${nf(S.report_reproduction.simulator.per_1000_without)} → ${nf(S.report_reproduction.simulator.per_1000_with)}</span><span class="muted" style="font-size:12px">1,000결정당 · 리포트 0.94 → 3.45</span></div>
    <div class="card pad20 stack"><span class="lbl">매장 순위 상관</span><span class="stat">${nf(c.stores.spearman)}</span><span class="muted" style="font-size:12px">${c.stores.n}개 매장 · 기대 vs 실제</span></div>
  </section>
  <section class="cols2">
    <div class="stack"><span class="lbl">주별 · 점 = 실제 · 선 = 기대 · 띠 = 90% 손님 운</span>${chart}<span class="muted" style="font-size:13px">6주 중 ${c.weeks_in_band}주가 범위 안. 빨간 점은 범위 밖.</span></div>
    <div class="stack"><span class="lbl">진열 효과 · 평소 대비 배수 · 같은 상품 · 같은 주</span>
      <div class="tbl"><div class="th" style="grid-template-columns:1fr 1.2fr .8fr .8fr .8fr"><span>안</span><span>실제 (95%)</span><span>보정</span><span>평소대로</span><span>평균 효과</span></div>
      ${Object.values(S.effects).map(e => `<div class="tr" style="grid-template-columns:1fr 1.2fr .8fr .8fr .8fr"><span>${e.label}</span><span class="num">${e.actual ? `${nf(e.actual.lift)} <span class="muted">(${nf(e.actual.lo)}–${nf(e.actual.hi)})</span>` : '판정 불가'}</span>${['calibrated', 'no_promo', 'avg_lift'].map(k => `<span class="num">${nf(e.simulated[k])} ${e.in_range[k] ? '✓' : e.actual ? '✗' : ''}</span>`).join('')}</div>`).join('')}</div>
      <p class="muted" style="font-size:13px">전단은 체인 전체에 같은 주에 나가 같은 주 대조 매장이 없습니다.</p></div>
  </section>
  <section class="cols2">
    <div class="stack"><span class="lbl">가구 순위 · AUC · 0.5 = 무작위</span>${aucs.map(([k, a]) => `<div style="display:grid;grid-template-columns:150px 1fr 60px;gap:12px;align-items:center"><span style="font-size:14px">${k}</span><div class="bar"><i style="width:${(a - .5) * 200}%;background:#171717"></i></div><span class="num r">${nf(a, 3)}</span></div>`).join('')}</div>
    <div class="row" style="align-items:flex-start;gap:24px"><div style="flex:1;min-width:200px">${relSvg}</div><div class="stack" style="flex:1;min-width:200px"><span class="lbl">보정 곡선 · 보정 모델</span><p class="muted" style="font-size:13px;line-height:1.7">점선 위에 놓일수록 예측 확률 = 실제 비율. 보정 오차 ${nf(v.model_eval.engines.calibrated.ece, 5)}. 페르소나 평균 20.7%는 이 차트 밖입니다.</p></div></div>
  </section>
  <section class="card pad20 stack"><span class="lbl">판정하지 못한 것</span><p class="body">전단 효과 · 같은 주 대조 매장 없음 · 할인 · 사지 않은 방문의 가격 없음 · 엔드캡 효과 범위가 넓음 · 엔드캡이었던 방문의 판매를 낮게 봄(실제 ${c.by_condition.find(x => x.condition === 'A_front_endcap')?.actual_units} vs 기대 ${n0(c.by_condition.find(x => x.condition === 'A_front_endcap')?.expected_units)})</p></section>`;
};

// 최종 배치 (3D)
VIEWS.layout = async (el, params) => {
  el.innerHTML = hdr('최종 배치') + loading('같은 손님으로 상품마다 세 자리를 시뮬레이션하는 중');
  const stores = await api('stores');
  const sid = params.store || store.get('store', stores[0].store_id);
  const L = await api(`layout?store=${sid}`);
  const cur = L.plans.current, nxt = L.plans.proposed, V = L.validation;
  const moved = L.products.filter(p => p.moved).sort((a, b) => b.gain - a.gain);
  el.innerHTML = hdr(`최종 배치 · Store ${esc(sid)} · 시리얼 ${L.products.length}개`, `<select id="st" class="input" aria-label="매장">${stores.map(s => `<option value="${s.store_id}" ${s.store_id === sid ? 'selected' : ''}>Store ${s.store_id}</option>`).join('')}</select>
    <div class="tabs" role="group" aria-label="배치"><button class="tab" id="b-now" type="button">${L.as_of}주 배치</button><button class="tab on" id="b-next" type="button">제안 배치</button></div>`) + `
  <section class="split">
    <div class="stack"><div class="stage" id="stage"><div class="ov" style="left:16px;top:16px;z-index:2"><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">${L.as_of}주까지 보고 결정 · ${L.weeks.join('–')}주 시뮬레이션</span><span class="glass mono" style="padding:6px 10px;border-radius:4px;font-size:11px">자리 · 앞쪽 엔드캡 ${L.capacity.A_front_endcap} · 기타 진열 ${L.capacity.C_other_display}</span></div></div>
      <div class="legend"><span><span class="sq" style="background:#3B73FF"></span>앞쪽 엔드캡</span><span><span class="sq" style="background:#88ACFA"></span>기타 진열</span><span><span class="sq" style="background:#B8BEC2"></span>일반 선반</span><span><span class="sq" style="background:#FCBB00;border-radius:50%"></span>전단</span><span><span class="ring"></span>바뀌는 상품</span><span class="muted">드래그 회전 · 휠 확대 · 상자에 마우스</span></div></div>
    <aside class="stack">
      <div class="card pad20 stack"><span class="lbl">같은 손님 · 같은 운 · 방문 ${n0(L.visits)}회</span>
        <div class="cols3" style="grid-template-columns:1fr 1fr;gap:14px">
          <div><div class="stat">${nf(cur.expected_units, 1)} → ${nf(nxt.expected_units, 1)}</div><div class="muted" style="font-size:12px;margin-top:4px">기대 판매 방문</div></div>
          <div><div class="stat">×${nf(nxt.lift)}</div><div class="muted" style="font-size:12px;margin-top:4px">${L.as_of}주 배치 고정 대비</div></div>
          <div><div class="stat">${nxt.extra_revenue >= 0 ? '+' : '-'}$${nf(Math.abs(nxt.extra_revenue))}</div><div class="muted" style="font-size:12px;margin-top:4px">기대 매출 차이</div></div>
          <div><div class="stat">${(nxt.share_of_draws_above_baseline * 100).toFixed(1)}%</div><div class="muted" style="font-size:12px;margin-top:4px">추첨 중 기준선보다 많음</div></div></div>
        <div class="row" style="gap:6px"><span class="tag ${V.in_band ? 'tag-ok' : 'tag-no'}">이 매장 실제 ${V.actual} vs 기대 ${nf(V.expected, 1)} · ${V.in_band ? '범위 안' : '범위 밖'}</span></div>
        <p class="muted" style="font-size:12px;line-height:1.6">제안 배치의 효과는 시뮬레이션 값입니다. 실제로 해 본 배치가 아니라 근거는 전체 매장 검증의 효과 크기입니다. 최적화는 시험 주에 실제로 온 방문을 씁니다(구매 결과는 보지 않음).</p></div>
      <div class="tbl"><div class="th" style="grid-template-columns:28px minmax(0,1fr) 70px"><span>#</span><span>바뀌는 상품 ${moved.length}개</span><span class="r">선반 대비</span></div>
        ${moved.map(p => `<button class="list-btn" type="button" data-id="${p.id}" style="grid-template-columns:28px minmax(0,1fr) 70px;display:grid;gap:8px;align-items:center"><span class="num" style="font-size:11px;text-align:center;border-radius:2px;background:${COL[p.next]};color:${p.next === 'A_front_endcap' ? '#fff' : '#000'}">${p.n}</span><span style="font-size:13px">${esc(p.name)} ${esc(p.size)}<br><span class="mono muted" style="font-size:11px">${LBL[p.now] === '평소대로' ? '선반' : LBL[p.now]} → ${LBL[p.next] === '평소대로' ? '선반' : LBL[p.next]}</span></span><span class="num r" style="font-size:12px">${p.gain ? '+$' + nf(p.gain) : '자리 양보'}</span></button>`).join('')}</div>
      <a class="btn btn-mono" href="#report">리포트 ${arrow}</a>
    </aside></section>`;
  const s3 = stage3d($('#stage'), { aisles: L.aisles, products: L.products }, { state: 'now', weeks: L.weeks.join('–') });
  const set = (st) => { s3.go(st); $('#b-now').classList.toggle('on', st === 'now'); $('#b-next').classList.toggle('on', st === 'next'); };
  $('#b-now').onclick = () => s3.state !== 'now' && set('now');
  $('#b-next').onclick = () => s3.state !== 'next' && set('next');
  $('#st').onchange = e => { store.set('store', e.target.value); location.hash = `#layout?store=${e.target.value}`; };
  el.querySelectorAll('.list-btn').forEach(b => b.onclick = () => {
    const on = s3.select(b.dataset.id); el.querySelectorAll('.list-btn').forEach(x => x.classList.toggle('on', on && x === b));
  });
  const t = setTimeout(() => set('next'), 700);
  return () => { clearTimeout(t); s3.dispose(); };
};

// S7 · 리포트
VIEWS.report = async (el) => {
  const r = await api('report');
  const N = r.numbers, partner = store.get('partner', {}), approved = store.get('approved');
  const extra = N.per_1000_with - N.per_1000_without, usd = extra * N.median_shelf_price_usd;
  const weeks = +partner.weeks || 0, visits = +partner.visits || 0;
  const eff = r.effects;
  el.innerHTML = hdr('리포트 · 다음 주 콜드 시리얼', `<a class="btn btn-outline btn-sm" href="#verify">검증 보기</a>`) + `
  <section class="cols2">
    <div class="stack"><span class="lbl">추천 · 보정 모델 기준</span><h2 class="display d44">다음 주 콜드 시리얼,<br>앞쪽 엔드캡으로.</h2>
      <p class="lead">48–53주 실제 효과 ${nf(eff.A_front_endcap.actual.lift)}배(95% ${nf(eff.A_front_endcap.actual.lo)}–${nf(eff.A_front_endcap.actual.hi)}) 안에 든 추정입니다. 시뮬레이터 ${nf(eff.A_front_endcap.simulated.calibrated)}배. 엔드캡이었던 방문의 판매는 실제보다 낮게 보는 편이라 보수적입니다.</p>
      <div class="hstat"><span>엔진 <b>보정 모델</b></span><span>검증 <b>48–53주</b></span><span>AUC <b>${nf(r.auc, 3)}</b></span></div></div>
    <div class="cols3" style="grid-template-columns:1fr 1fr">
      <div class="card pad20 stack"><span class="lbl">방문 1,000회당 판매</span><span class="stat">${nf(N.per_1000_without)} → ${nf(N.per_1000_with)}개</span><span class="muted" style="font-size:12px">실제로 엔드캡이었던 ${n0(N.endcap_rows)}건 · 같은 손님 같은 운</span></div>
      <div class="card pad20 stack"><span class="lbl">추가 매출 · 1,000회당</span><span class="stat">$${nf(usd, 1)}</span><span class="muted" style="font-size:12px">추가 ${nf(extra, 1)}개 × 중간 가격 $${nf(N.median_shelf_price_usd)} · 패널 가구 기준</span></div>
      <div class="card pad20 stack" style="grid-column:1/-1"><span class="lbl">매장 실험 대신 지금 결정하면</span>
        ${weeks && visits ? `<span class="stat">$${n0(weeks * visits / 1000 * usd)}</span><span class="muted" style="font-size:12px">실험 ${weeks}주 × 주당 방문 ${n0(visits)} × 1,000회당 $${nf(usd, 1)} · 그 기간 엔드캡을 안 썼다면 놓쳤을 추가 매출 추정</span>`
        : `<span class="muted" style="font-size:13px">결정 브리프에서 실험 기간과 주당 방문 수를 넣으면 계산합니다. <a href="#brief">입력하러 가기</a></span>`}</div></div>
  </section>
  <section class="cols2">
    <div class="stack"><span class="lbl">누가 움직였나 · 평소 대비 · 1,000회당 추가</span>
      <div class="tbl"><div class="th" style="grid-template-columns:1fr 90px 110px"><span>가구층</span><span class="r">평소 대비</span><span class="r">1,000회당 추가</span></div>
      ${N.segments.map(s => `<div class="tr" style="grid-template-columns:1fr 90px 110px"><span>${esc(s.segment)}</span><span class="num r">${nf(s.lift, 1)}배</span><span class="num r">+${nf(s.extra_per_1000, 1)}</span></div>`).join('')}</div>
      <p class="muted" style="font-size:13px">늘어난 판매의 ${Math.round((N.segments.find(s => s.segment.includes('없는'))?.share_of_extra || 0) * 100)}%는 이 상품을 산 적 없는 가구에서 나왔습니다. 할인 민감 가구의 배수에는 함께 놓인 할인 효과가 섞였을 수 있습니다.</p></div>
    <div class="stack"><span class="lbl">다른 안</span>
      <div class="tbl">${[['C_other_display', '제외'], ['B_mailer_only', '매장 실험 필요']].map(([k, v]) => `<div class="tr" style="grid-template-columns:1fr 1fr 120px"><span>${LBL[k]}</span><span class="muted" style="font-size:13px">${eff[k].actual ? `실제 ${nf(eff[k].actual.lift)}배` : '대조 매장 없음'}</span><span class="r tag">${v}</span></div>`).join('')}</div>
      <div class="card pad20 stack"><span class="lbl">매장에서 한 번 더 확인합니다</span><p class="body">엔드캡 매장과 비교 매장을 무작위로 나누고, 같은 주 /basket/add 이벤트로 비교한 결과가 다음 예측의 보정 데이터가 됩니다.</p>
        <div class="row">${approved ? `<span class="tag tag-ok">승인됨 · ${esc(approved)}</span><button class="btn btn-ghost btn-sm" id="undo" type="button">승인 취소</button>` : `<button class="btn btn-mono" id="ok" type="button">이 안 승인 ${arrow}</button>`}<a class="btn btn-outline" href="#layout">매장별 최종 배치</a></div></div></div>
  </section>`;
  const ok = $('#ok'); if (ok) ok.onclick = () => { store.set('approved', new Date().toLocaleString('ko-KR')); render(); };
  const undo = $('#undo'); if (undo) undo.onclick = () => { store.set('approved', null); render(); };
};

// S8 · 매장 연결
VIEWS.connect = async (el) => {
  el.innerHTML = hdr('매장 연결') + `
  <section class="cols2">
    <div class="stack"><span class="lbl">당신의 매장을 API로</span><h2 class="display d44">영수증을 올리면, 그 매장의 손님에게 보정됩니다.</h2>
      <p class="lead">POS 내보내기 CSV 하나로 시작합니다. 열 이름을 엔드포인트에 자동으로 잇고, 그 매장 데이터로 결정 표 → 모델 학습·보정 → 공간맵 → 앞으로 4주 시뮬레이션 → 최종 배치까지 한 번에 돌립니다.</p></div>
    <form id="up" class="card pad20 stack">
      <div class="field"><label for="ft">영수증 CSV · 필수 · 영수증 줄 단위 · 26주 이상 권장</label><input id="ft" class="input" type="file" accept=".csv,text/csv"></div>
      <div class="field"><label for="fp">상품 CSV · 선택 · product_id, product_category …</label><input id="fp" class="input" type="file" accept=".csv,text/csv"></div>
      <div class="field"><label for="fl">진열·전단 일정 CSV · 선택 · product_id, store_id, week, display_location</label><input id="fl" class="input" type="file" accept=".csv,text/csv"></div>
      <div class="row"><button class="btn btn-mono" type="submit" id="send">연결하고 돌리기 ${arrow}</button><button class="btn btn-outline" type="button" id="sample">예시 파일로 해보기 · Store 367 POS</button></div>
      <p class="muted" style="font-size:12px">진열 일정이 없으면 모델은 "평소대로" 조건만 배웁니다. 파일은 이 서버 안에서만 처리됩니다.</p>
    </form>
  </section>
  <section id="job"></section>`;
  const read = f => f ? f.text() : Promise.resolve(null);
  async function send(files, name) {
    $('#job').innerHTML = loading(`${name} 올리는 중`);
    try {
      let j = await api('connect', files);
      const poll = async () => {
        drawJob(j);
        if (['running', 'mapping'].includes(j.status)) { await new Promise(r => setTimeout(r, 2000)); j = await api(`job?id=${j.id}`); return poll(); }
      };
      await poll();
    } catch (e) { $('#job').innerHTML = fail(e); }
  }
  function drawJob(j) {
    const m = j.mapping;
    $('#job').innerHTML = `<section class="cols2">
      <div class="stack"><span class="lbl">자동 매핑 · ${m.columns.length}개 열 중 ${m.columns.filter(c => c.field).length}개 연결</span>
        <div class="tbl"><div class="th" style="grid-template-columns:1fr 1fr 1fr"><span>내 파일의 열</span><span>엔드포인트</span><span>상태</span></div>
        ${m.columns.map(c => `<div class="tr" style="grid-template-columns:1fr 1fr 1fr"><span class="mono" style="font-size:12px">${esc(c.column)}</span><span class="mono" style="font-size:12px">${esc(c.endpoint || '—')}</span><span>${c.field ? '<span class="tag tag-ok">연결됨</span>' : '<span class="tag">쓰지 않음</span>'}</span></div>`).join('')}</div>
        ${j.error ? `<p class="err">${esc(j.error)}</p>` : ''}</div>
      <div class="stack"><span class="lbl">진행</span>
        <div class="card pad20 stack"><div class="row">${j.status === 'running' ? '<span class="spin"></span> 결정 표 · 학습 · 보정 · 시뮬레이션 · 최적화 중' : j.status === 'done' ? '<span class="tag tag-ok">완료</span>' : `<span class="tag tag-no">${esc(j.status)}</span>`}</div>
        <div class="log" style="max-height:180px">${(j.log || []).map(l => `<div>${esc(l)}</div>`).join('')}</div></div></div></section>
      ${j.layout ? `<section class="stack"><span class="lbl">이 매장의 제안 배치 · 앞으로 ${j.layout.weeks.join('–')}주 · 같은 손님 같은 운</span>
        <div class="stage" id="ustage"></div>
        <div class="cols4">${['current', 'proposed'].map(k => `<div class="card pad stack"><span class="lbl">${esc(j.layout.plans[k].label)}</span><span class="stat">${nf(j.layout.plans[k].expected_units, 1)}</span><span class="muted" style="font-size:12px">90% ${n0(j.layout.plans[k].mc_p05)}–${n0(j.layout.plans[k].mc_p95)} · ×${nf(j.layout.plans[k].lift)}</span></div>`).join('')}</div>
        <details class="card pad"><summary>REPORT.md</summary><pre style="white-space:pre-wrap;font-size:12px;line-height:1.6">${esc(j.report)}</pre></details></section>` : ''}`;
    if (j.layout) { const L = j.layout; const s3 = stage3d($('#ustage'), { aisles: L.aisles, products: L.products }, { weeks: L.weeks.join('–') }); setTimeout(() => s3.go('next'), 600); }
  }
  $('#up').onsubmit = async e => {
    e.preventDefault();
    const [t, p, l] = await Promise.all(['#ft', '#fp', '#fl'].map(s => read($(s).files[0])));
    if (!t) { $('#job').innerHTML = fail('영수증 CSV를 골라 주세요.'); return; }
    send({ transactions: t, products: p, placements: l }, $('#ft').files[0].name);
  };
  $('#sample').onclick = async () => { $('#job').innerHTML = loading('예시 파일 만드는 중'); const s = await api('sample?store=367'); send(s, 'store_367_pos.csv'); };
};

boot(); render();
