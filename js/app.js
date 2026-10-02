// 크루 스케줄 앱 (화면 · 저장 · 가져오기)
const STORE_KEY = 'crew-schedule-v1';
const VIEW_KEY = 'crew-schedule-view';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ───────────────────────── 상태 · 저장

const state = {
  data: loadData(),          // { days: { 'YYYY-MM-DD': [item] } }
  year: 0, month: 0,         // 보고 있는 달
  view: localStorage.getItem(VIEW_KEY) || 'calendar',
  draft: null,               // 가져오기 확인 중: { result, year, month, days }
};

function loadData() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { days: d.days || {} };
  } catch {
    return { days: {} };
  }
}

function saveData() {
  localStorage.setItem(STORE_KEY, JSON.stringify({ days: state.data.days, savedAt: new Date().toISOString() }));
}

function cleanItem(it) {
  const { _raw, warnings, flightNos, ...rest } = it;
  return rest;
}

// 화면에 보여줄 일(day) 데이터 (확인 모드면 가져온 결과)
function daysSource() {
  return state.draft ? state.draft.days : state.data.days;
}

function monthKey(y, m) { return `${y}-${pad2(m)}`; }

// ───────────────────────── 시간 계산

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function mdw(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}(${WEEKDAYS[weekdayOf(dateStr)]})`;
}

// 자정을 넘겨 두 칸에 나뉜 비행(출발만 / 도착만)의 짝 찾기
function findSplitPair(date, it, field) {
  const other = field === 'arr' ? 'dep' : 'arr';
  return (daysSource()[date] || []).find(x =>
    x.type === 'flight' && x !== it && x.flightNo === it.flightNo && x[field] && !x[other]);
}

// 비행 한 구간의 현지/한국 시각 계산 (link: 나뉜 비행의 짝까지 합쳐 계산)
function calcFlight(date, it, link = false) {
  const fromA = getAirport(it.from), toA = getAirport(it.to);
  const r = { fromA, toA, dep: null, arr: null, durationMs: null, linked: false };
  let dep = it.dep, arr = it.arr, depDate = date, arrBase = date;
  if (link && dep && !arr) {
    const n = findSplitPair(addDays(date, 1), it, 'arr');
    if (n) { arr = n.arr; arrBase = addDays(date, 1); r.linked = true; }
  }
  if (link && !dep && arr) {
    const p = findSplitPair(addDays(date, -1), it, 'dep');
    if (p) { dep = p.dep; depDate = addDays(date, -1); r.linked = true; }
  }
  let depMs = null;
  if (dep && fromA) {
    depMs = zonedToMs(depDate, dep, fromA.tz);
    r.dep = { ms: depMs, local: { date: depDate, time: dep }, kst: msToZoned(depMs, KST_TZ), tz: fromA.tz };
  }
  if (arr && toA) {
    let arrDate = arrBase;
    let arrMs = zonedToMs(arrDate, arr, toA.tz);
    if (depMs != null) {
      // 도착은 출발 이후, 24시간 이내로 맞춤 (날짜변경선·자정 넘김)
      while (arrMs <= depMs) { arrDate = addDays(arrDate, 1); arrMs = zonedToMs(arrDate, arr, toA.tz); }
      while (arrMs - depMs > 24 * 3600e3) { arrDate = addDays(arrDate, -1); arrMs = zonedToMs(arrDate, arr, toA.tz); }
      r.durationMs = arrMs - depMs;
    }
    r.arr = { ms: arrMs, local: { date: arrDate, time: arr }, kst: msToZoned(arrMs, KST_TZ), tz: toA.tz };
  }
  return r;
}

function calcLayover(date, it) {
  const a = getAirport(it.station);
  const r = { a, end: null };
  if (it.end && a) {
    const ms = zonedToMs(date, it.end, a.tz);
    r.end = { ms, kst: msToZoned(ms, KST_TZ) };
  }
  return r;
}

// "+1" 같은 날짜 차이 표시
function dayMark(baseDate, dateStr) {
  const d = dayDiff(baseDate, dateStr);
  return d ? `<sup>${d > 0 ? '+' : ''}${d}</sup>` : '';
}

function shortName(code) {
  const a = getAirport(code);
  return a ? a.short : (code || '?');
}

function dutyLabel(code) {
  return DUTY_CODES[code] || '근무';
}

// ───────────────────────── 달력 칸 안 (간략 표기)

function evCompactHtml(date, it) {
  const warn = itemWarnings(it).length ? ' warn' : '';
  if (it.type === 'flight') {
    const c = calcFlight(date, it);
    const dh = it.deadhead ? '<span class="tag">편승</span>' : '';
    // "출발-도착": 칸이 좁으면 '-' 뒤에서 줄바꿈(<wbr>)
    const span = (dep, arr) => `${dep}${dep && !arr ? '-' : ''}${arr ? `-<wbr>${arr}` : ''}`;
    const arrMark = c.arr ? dayMark(date, c.arr.local.date) : '';
    const localT = span(esc(it.dep || ''), it.arr ? esc(it.arr) + arrMark : '');
    let kstLine = '';
    const kd = c.dep ? c.dep.kst : null, ka = c.arr ? c.arr.kst : null;
    const differs = (kd && kd.time !== it.dep) || (ka && ka.time !== it.arr);
    if (differs) {
      const kdT = kd ? kd.time + dayMark(date, kd.date) : '';
      const kaT = ka ? ka.time + dayMark(date, ka.date) : '';
      kstLine = `<div class="tk"><span class="k-badge">한</span>${span(kdT, kaT)}</div>`;
    }
    return `<div class="ev flight${warn}">
      <div><span class="no">${esc(it.flightNo || '편명?')}</span>${dh}</div>
      <div class="route">${esc(shortName(it.from))}→${esc(shortName(it.to))}</div>
      <div class="t">${localT}</div>${kstLine}
    </div>`;
  }
  if (it.type === 'layover') {
    const c = calcLayover(date, it);
    let t = '';
    if (it.end) {
      t = `<div class="t">~${esc(it.end)}</div>`;
      if (c.end && c.end.kst.time !== it.end) t += `<div class="tk"><span class="k-badge">한</span>${c.end.kst.time}${dayMark(date, c.end.kst.date)}</div>`;
    }
    return `<div class="ev lo${warn}"><div class="route">체류 ${esc(shortName(it.station))}</div>${t}</div>`;
  }
  if (it.type === 'off') {
    return `<div class="ev off">${esc(dutyLabel(it.code))} <small>${esc(it.code)}</small></div>`;
  }
  return `<div class="ev other">${esc(it.text || '기타')}</div>`;
}

// ───────────────────────── 상세 카드

function timePair(base, p) {
  if (!p) return '';
  const local = `현지 ${mdw(p.local.date)} <b>${p.local.time}</b>`;
  const same = p.kst.date === p.local.date && p.kst.time === p.local.time;
  const kst = same ? '<span class="k">(한국과 같음)</span>' : `<span class="k">한국 ${mdw(p.kst.date)} <b>${p.kst.time}</b></span>`;
  return `<div class="times"><span>${local}</span>${kst}</div>`;
}

function aptLine(code, a) {
  return a ? `${esc(a.name)} <small>${esc(code)}</small>` : `<span style="color:var(--warn)">${esc(code || '?')} (등록되지 않은 공항)</span>`;
}

function cardHtml(date, it, idx, editable) {
  const w = itemWarnings(it);
  const warnTag = w.length ? `<span class="warn-tag">⚠ ${esc(w.join('·'))} 확인</span>` : '';
  const actions = editable ? `<div class="card-actions">
      <button class="btn small ghost" data-act="edit" data-idx="${idx}">수정</button>
      <button class="btn small danger" data-act="del" data-idx="${idx}">삭제</button></div>` : '';

  if (it.type === 'flight') {
    const c = calcFlight(date, it, true);
    const meta = [];
    if (c.durationMs) meta.push(`비행시간 ${durationText(c.durationMs)}`);
    if (c.linked) meta.push('자정을 넘겨 두 칸에 나뉜 비행');
    const foreign = [c.fromA, c.toA].find(a => a && a.tz !== KST_TZ);
    if (foreign) meta.push(`${foreign.short}: ${diffFromKstText(foreign.tz, (c.arr || c.dep || { ms: Date.now() }).ms)}`);
    // 공항 미등록이면 계산 없이 현지시간만
    const legTime = (calc, raw, missing) =>
      calc ? timePair(date, calc) : raw ? `<div class="times">현지 ${esc(raw)}</div>` : `<div class="times">${missing}</div>`;
    return `<div class="card">
      <div class="card-head">✈ ${esc(it.flightNo || '편명?')} ${it.deadhead ? '<span class="tag">편승(TVL)</span>' : ''} ${warnTag}${actions}</div>
      <div class="leg">
        <div class="lbl">출발</div><div><div class="apt">${aptLine(it.from, c.fromA)}</div>${legTime(c.dep, it.dep, '(전날 칸에 표시)')}</div>
        <div class="lbl">도착</div><div><div class="apt">${aptLine(it.to, c.toA)}</div>${legTime(c.arr, it.arr, '(다음날 칸에 표시)')}</div>
      </div>
      ${meta.length ? `<div class="meta">${esc(meta.join(' · '))}</div>` : ''}
    </div>`;
  }
  if (it.type === 'layover') {
    const c = calcLayover(date, it);
    const meta = c.a && c.a.tz !== KST_TZ ? diffFromKstText(c.a.tz, c.end ? c.end.ms : Date.now()) : '';
    let t = '<div class="times">체류 중</div>';
    if (it.end) {
      t = `<div class="times"><span>종료 현지 <b>${esc(it.end)}</b></span>${c.end && c.end.kst.time !== it.end ? `<span class="k">한국 ${mdw(c.end.kst.date)} <b>${c.end.kst.time}</b></span>` : ''}</div>`;
    }
    return `<div class="card lo">
      <div class="card-head">🏨 체류 (LO) ${warnTag}${actions}</div>
      <div class="leg"><div class="lbl">공항</div><div><div class="apt">${aptLine(it.station, c.a)}</div>${t}</div></div>
      ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
    </div>`;
  }
  if (it.type === 'off') {
    return `<div class="card off"><div class="card-head">🌿 ${esc(dutyLabel(it.code))} <small>${esc(it.code)}</small>${actions}</div></div>`;
  }
  return `<div class="card other"><div class="card-head">📌 ${esc(it.text || '기타')}${actions}</div></div>`;
}

// ───────────────────────── 렌더링

function render() {
  const { year, month } = state;
  $('monthTitle').textContent = `${year}년 ${month}월`;
  const drafting = !!state.draft;
  $('draftBar').hidden = !drafting;
  $('prevBtn').disabled = drafting;
  $('nextBtn').disabled = drafting;
  $('importBtn').hidden = drafting;
  $('viewBtn').textContent = state.view === 'calendar' ? '☰' : '▦';
  if (drafting) renderDraftBar();

  const days = daysSource();
  const prefix = monthKey(year, month);
  const hasAny = Object.keys(days).some(k => k.startsWith(prefix));
  $('empty').hidden = hasAny;
  $('calendar').hidden = state.view !== 'calendar';
  $('list').hidden = state.view !== 'list';
  if (state.view === 'calendar') renderCalendar(days);
  else renderList(days);
}

function renderCalendar(days) {
  const { year, month } = state;
  const first = new Date(year, month - 1, 1).getDay();
  const dim = new Date(year, month, 0).getDate();
  const weeks = Math.ceil((first + dim) / 7);
  const today = msToZoned(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone).date;
  let html = `<div class="cal-head">${WEEKDAYS.map(w => `<div>${w}</div>`).join('')}</div>`;
  for (let w = 0; w < weeks; w++) {
    html += '<div class="cal-week">';
    for (let c = 0; c < 7; c++) {
      const n = w * 7 + c - first + 1;
      const t = new Date(year, month - 1, n);
      const date = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
      const out = n < 1 || n > dim;
      const items = days[date] || [];
      const cls = ['cal-cell', out && 'out', c === 0 && 'sun', c === 6 && 'sat', date === today && 'today'].filter(Boolean).join(' ');
      html += `<div class="${cls}" data-date="${date}">
        <div class="dnum"><span>${t.getDate()}</span></div>
        ${out ? '' : items.map(it => evCompactHtml(date, it)).join('')}
      </div>`;
    }
    html += '</div>';
  }
  $('calendar').innerHTML = html;
}

function renderList(days) {
  const prefix = monthKey(state.year, state.month);
  const dates = Object.keys(days).filter(k => k.startsWith(prefix)).sort();
  $('list').innerHTML = dates.map(d => {
    const wd = weekdayOf(d);
    return `<div class="day-group" data-date="${d}">
      <h3 class="${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}">${mdw(d)}</h3>
      ${days[d].map((it, i) => cardHtml(d, it, i, false)).join('')}
    </div>`;
  }).join('');
}

// ───────────────────────── 하단 시트

function openSheet(html, onClick) {
  $('sheetBody').innerHTML = html;
  $('sheet').hidden = false;
  $('sheetBackdrop').hidden = false;
  $('sheet').scrollTop = 0;
  $('sheetBody').onclick = onClick || null;
}

function closeSheet() {
  $('sheet').hidden = true;
  $('sheetBackdrop').hidden = true;
  $('sheetBody').innerHTML = '';
}

function openDay(date) {
  const days = daysSource();
  const items = days[date] || [];
  const draftNote = state.draft ? '<span class="sub">가져온 결과 (저장 전)</span>' : '';
  const raw = state.draft ? items.filter(i => i._raw).map(i => `<div class="raw">인식 원문: ${esc(i._raw)}</div>`).join('') : '';
  openSheet(`
    <h2>${mdw(date)} ${draftNote}</h2>
    ${items.length ? items.map((it, i) => cardHtml(date, it, i, true)).join('') : '<p class="empty">일정이 없습니다.</p>'}
    ${raw ? `<details><summary style="font-size:12px;color:var(--muted)">인식 원문 보기</summary>${raw}</details>` : ''}
    <div class="sheet-foot">
      <button class="btn ghost" data-act="add">＋ 일정 추가</button>
      <button class="btn primary" data-act="close">닫기</button>
    </div>`, e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act, idx = +b.dataset.idx;
    if (act === 'close') closeSheet();
    else if (act === 'add') openEditor(date, -1);
    else if (act === 'edit') openEditor(date, idx);
    else if (act === 'del') {
      if (!confirm('이 일정을 삭제할까요?')) return;
      const list = days[date];
      list.splice(idx, 1);
      if (!list.length) delete days[date];
      commit();
      openDay(date);
    }
  });
}

// 저장(확인 모드가 아니면 바로 localStorage)
function commit() {
  if (!state.draft) saveData();
  render();
}

// ───────────────────────── 편집기

function airportHint(code) {
  if (!code) return '';
  const a = getAirport(code.toUpperCase());
  return a ? `${a.name} · ${a.tz}` : '';
}

function openEditor(date, idx) {
  const days = daysSource();
  const orig = idx >= 0 ? { ...days[date][idx] } : { type: 'flight', flightNo: 'KE', from: '', to: '', dep: '', arr: '', deadhead: false };
  let type = orig.type;

  const draw = () => {
    const it = orig;
    const tabs = [['flight', '비행'], ['layover', '체류'], ['off', '휴무/근무'], ['other', '기타']]
      .map(([t, l]) => `<button type="button" data-type="${t}" class="${t === type ? 'on' : ''}">${l}</button>`).join('');
    let fields = '';
    if (type === 'flight') {
      fields = `
        <div class="row2">
          <label>편명<input name="flightNo" class="code" value="${esc(it.flightNo || '')}" placeholder="KE0441" autocomplete="off"></label>
          <label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" name="deadhead" ${it.deadhead ? 'checked' : ''}> 편승(TVL)</label>
        </div>
        <div class="row2">
          <label>출발 공항<input name="from" class="code apt" maxlength="3" value="${esc(it.from || '')}" placeholder="ICN" autocomplete="off"><span class="apt-hint"></span></label>
          <label>도착 공항<input name="to" class="code apt" maxlength="3" value="${esc(it.to || '')}" placeholder="HAN" autocomplete="off"><span class="apt-hint"></span></label>
        </div>
        <div class="row2">
          <label>출발 (현지)<input name="dep" type="time" value="${esc(it.dep || '')}"></label>
          <label>도착 (현지)<input name="arr" type="time" value="${esc(it.arr || '')}"></label>
        </div>`;
    } else if (type === 'layover') {
      fields = `
        <label>체류 공항<input name="station" class="code apt" maxlength="3" value="${esc(it.station || '')}" placeholder="HAN" autocomplete="off"><span class="apt-hint"></span></label>
        <label>종료 시각 (현지, 선택)<input name="end" type="time" value="${esc(it.end || '')}"></label>`;
    } else if (type === 'off') {
      fields = `<label>코드<input name="code" class="code" value="${esc(it.code || 'ADO')}" placeholder="ADO / ATDO / SBY…" autocomplete="off"></label>`;
    } else {
      fields = `<label>내용<input name="text" value="${esc(it.text || '')}" autocomplete="off"></label>`;
    }
    openSheet(`
      <h2>${mdw(date)} 일정 ${idx >= 0 ? '수정' : '추가'}</h2>
      <form class="form" id="editForm">
        <div class="type-tabs">${tabs}</div>
        ${fields}
        <p class="apt-hint" style="color:var(--muted)">시간은 각 공항의 <b>현지시간</b>으로 입력하세요. 한국시간은 자동 계산됩니다.</p>
        <div class="sheet-foot">
          <button type="button" class="btn ghost" data-act="cancel">취소</button>
          <button type="submit" class="btn primary">완료</button>
        </div>
      </form>`, e => {
      const t = e.target.closest('[data-type]');
      if (t) { readForm(); type = t.dataset.type; draw(); return; }
      if (e.target.closest('[data-act="cancel"]')) openDay(date);
      if (e.target.closest('[data-act="addapt"]')) openAirportEditor(e.target.closest('[data-act="addapt"]').dataset.code, () => openEditor(date, idx));
    });
    const form = $('editForm');
    form.querySelectorAll('input.apt').forEach(inp => {
      const hint = inp.parentElement.querySelector('.apt-hint');
      const upd = () => {
        const v = inp.value.toUpperCase();
        const h = airportHint(v);
        hint.classList.toggle('bad', v.length === 3 && !h);
        hint.innerHTML = h ? esc(h) : v.length === 3 ? `등록되지 않은 공항 <button type="button" class="btn small ghost" data-act="addapt" data-code="${esc(v)}">공항 추가</button>` : '';
      };
      inp.addEventListener('input', upd);
      upd();
    });
    form.onsubmit = e => {
      e.preventDefault();
      readForm();
      const item = buildEdited(type, orig);
      if (!days[date]) days[date] = [];
      if (idx >= 0) days[date][idx] = item; else days[date].push(item);
      commit();
      openDay(date);
    };
  };

  // 탭 전환 시 입력값 유지
  const readForm = () => {
    const form = $('editForm');
    if (!form) return;
    for (const el of form.elements) {
      if (!el.name) continue;
      orig[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    }
  };
  draw();
}

function buildEdited(type, f) {
  const up = v => (v || '').toUpperCase().replace(/\s+/g, '');
  if (type === 'flight') {
    return { type, flightNo: up(f.flightNo), deadhead: !!f.deadhead, from: up(f.from), to: up(f.to), dep: f.dep || null, arr: f.arr || null };
  }
  if (type === 'layover') return { type, station: up(f.station), end: f.end || null };
  if (type === 'off') return { type, code: up(f.code) || 'OFF' };
  return { type: 'other', text: f.text || '' };
}

function openAirportEditor(code, back) {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = ['Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Bangkok', 'Asia/Singapore', 'Europe/London', 'America/Los_Angeles', 'America/New_York']; }
  openSheet(`
    <h2>공항 추가 · ${esc(code)}</h2>
    <form class="form" id="aptForm">
      <label>공항 이름 (한글)<input name="name" required placeholder="예) 울란바토르 칭기스칸국제공항"></label>
      <label>짧은 이름 (달력 칸 표시)<input name="short" placeholder="예) 울란바토르"></label>
      <label>시간대<select name="tz">${zones.map(z => `<option ${z === 'Asia/Seoul' ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
      <div class="sheet-foot">
        <button type="button" class="btn ghost" data-act="cancel">취소</button>
        <button type="submit" class="btn primary">저장</button>
      </div>
    </form>`, e => { if (e.target.closest('[data-act="cancel"]')) back(); });
  $('aptForm').onsubmit = e => {
    e.preventDefault();
    const f = e.target.elements;
    saveCustomAirport(code, f.name.value.trim(), f.short.value.trim(), f.tz.value);
    toast(`${code} 공항을 추가했습니다`);
    render();
    back();
  };
}

// ───────────────────────── 가져오기

async function importImage(file) {
  if (!file) return;
  $('progress').hidden = false;
  const setP = (text, f) => { $('progressText').textContent = text; $('progressBar').style.width = `${Math.round(f * 100)}%`; };
  try {
    const result = await analyzeScheduleImage(file, setP);
    const y = result.year || state.year, m = result.month || state.month;
    state.draft = { result, year: y, month: m, days: cellsToDays(result.cells, y, m), monthGuessed: !result.year };
    state.year = y; state.month = m;
    state.view = 'calendar';
    render();
    if (!result.year) toast('연/월을 인식하지 못했습니다. 위에서 선택해 주세요.');
  } catch (e) {
    console.error(e);
    alert(`분석에 실패했습니다.\n${e.message || e}`);
  } finally {
    $('progress').hidden = true;
    $('fileInput').value = '';
  }
}

function renderDraftBar() {
  const d = state.draft;
  const ys = $('draftYear'), ms = $('draftMonth');
  if (!ys.options.length) {
    const now = new Date().getFullYear();
    for (let y = now - 2; y <= now + 2; y++) ys.add(new Option(`${y}년`, y));
    for (let m = 1; m <= 12; m++) ms.add(new Option(`${m}월`, m));
  }
  ys.value = d.year; ms.value = d.month;
  const all = Object.values(d.days).flat();
  const warn = all.filter(it => itemWarnings(it).length).length;
  $('draftInfo').innerHTML = `${Object.keys(d.days).length}일 · ${all.length}건` +
    (warn ? ` · <b style="color:var(--warn)">⚠ 확인 필요 ${warn}건</b> (점선 표시, 눌러서 수정)` : ' · 모두 인식됨');
}

function changeDraftMonth() {
  const d = state.draft;
  const y = +$('draftYear').value, m = +$('draftMonth').value;
  const rows = d.result.weeks, expected = Math.ceil((new Date(y, m - 1, 1).getDay() + new Date(y, m, 0).getDate()) / 7);
  d.year = y; d.month = m;
  d.days = cellsToDays(d.result.cells, y, m);
  state.year = y; state.month = m;
  render();
  if (rows !== expected) toast(`캡처는 ${rows}주인데 ${m}월은 ${expected}주입니다. 연/월을 확인하세요.`);
}

function saveDraft() {
  const d = state.draft;
  const prefix = monthKey(d.year, d.month);
  const existing = Object.keys(state.data.days).filter(k => k.startsWith(prefix));
  if (existing.length && !confirm(`${d.year}년 ${d.month}월에 저장된 스케줄이 있습니다.\n새로 가져온 내용으로 바꿀까요?`)) return;
  for (const k of existing) delete state.data.days[k];
  for (const [k, items] of Object.entries(d.days)) state.data.days[k] = items.map(cleanItem);
  saveData();
  state.draft = null;
  render();
  toast(`${d.year}년 ${d.month}월 스케줄을 저장했습니다`);
}

function cancelDraft() {
  if (!confirm('가져온 결과를 버릴까요?')) return;
  state.draft = null;
  render();
}

// 안드로이드 공유하기로 받은 이미지 (서비스워커가 캐시에 보관)
async function checkSharedImage() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('crew-share');
    const res = await cache.match('shared-image');
    if (!res) return;
    const blob = await res.blob();
    await cache.delete('shared-image');
    importImage(blob);
  } catch (e) {
    console.error(e);
  }
}

// ───────────────────────── 메뉴 · 백업

function openMenu() {
  openSheet(`
    <h2>메뉴</h2>
    <ul class="menu-list">
      <li><button data-act="import">📷 스케줄 캡처 가져오기<small>달력 화면 전체가 보이게 캡처한 이미지</small></button></li>
      <li><button data-act="today">📅 이번 달로 이동</button></li>
      <li><button data-act="backup">💾 백업 파일 저장<small>휴대폰 교체·초기화 대비 (JSON)</small></button></li>
      <li><button data-act="restore">📂 백업 파일 불러오기</button></li>
      <li><button data-act="clearMonth">🗑 이 달 스케줄 삭제</button></li>
      <li><button data-act="help">❓ 사용 방법</button></li>
    </ul>`, e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'import') { closeSheet(); $('fileInput').click(); }
    if (act === 'today') { const n = new Date(); state.year = n.getFullYear(); state.month = n.getMonth() + 1; closeSheet(); render(); }
    if (act === 'backup') { backup(); closeSheet(); }
    if (act === 'restore') { closeSheet(); $('restoreInput').click(); }
    if (act === 'clearMonth') {
      const prefix = monthKey(state.year, state.month);
      if (!confirm(`${state.year}년 ${state.month}월 스케줄을 모두 삭제할까요?`)) return;
      for (const k of Object.keys(state.data.days)) if (k.startsWith(prefix)) delete state.data.days[k];
      saveData(); closeSheet(); render();
    }
    if (act === 'help') openHelp();
  });
}

function openHelp() {
  openSheet(`
    <h2>사용 방법</h2>
    <ol style="font-size:14px;line-height:1.6;padding-left:20px">
      <li>회사 스케줄 화면에서 <b>한 달 달력 전체</b>가 보이게 캡처합니다. (연·월 제목 포함)</li>
      <li><b>＋</b> 버튼 → 캡처 선택. 또는 갤러리에서 <b>공유 → 크루 스케줄</b>.</li>
      <li>가져온 결과를 확인합니다. <span style="color:var(--warn)">점선</span> 항목은 인식이 불확실하니 눌러서 고쳐 주세요.</li>
      <li><b>저장</b>을 누르면 휴대폰에만 저장됩니다. (서버로 전송되지 않음)</li>
    </ol>
    <p style="font-size:13px;color:var(--muted)">
      칸 안의 검정 시간은 각 공항 <b>현지시간</b>, <span class="kst"><b class="kst">한</b> 빨간 시간</span>은 <b>한국시간</b>입니다.
      한국과 시차가 없는 구간(일본 등)은 한국시간 줄을 생략합니다. <sup>+1</sup>은 다음날입니다.
    </p>
    <div class="sheet-foot"><button class="btn primary" data-act="close">닫기</button></div>`,
  e => { if (e.target.closest('[data-act="close"]')) closeSheet(); });
}

function backup() {
  const blob = new Blob([JSON.stringify({ app: 'crew-schedule', version: 1, days: state.data.days, airports: loadCustomAirports() }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `crew-schedule-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function restore(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!d.days) throw new Error('형식이 맞지 않습니다');
    if (!confirm('백업 내용을 현재 데이터에 합칠까요? (같은 날짜는 백업 내용으로 바뀝니다)')) return;
    Object.assign(state.data.days, d.days);
    for (const [code, a] of Object.entries(d.airports || {})) saveCustomAirport(code, a[0], a[1], a[2]);
    saveData();
    render();
    toast('백업을 불러왔습니다');
  } catch (e) {
    alert(`불러오기 실패: ${e.message}`);
  } finally {
    $('restoreInput').value = '';
  }
}

// ───────────────────────── 기타

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

function moveMonth(delta) {
  const d = new Date(state.year, state.month - 1 + delta, 1);
  state.year = d.getFullYear(); state.month = d.getMonth() + 1;
  render();
}

function init() {
  const now = new Date();
  state.year = now.getFullYear(); state.month = now.getMonth() + 1;

  $('prevBtn').onclick = () => moveMonth(-1);
  $('nextBtn').onclick = () => moveMonth(1);
  $('viewBtn').onclick = () => {
    state.view = state.view === 'calendar' ? 'list' : 'calendar';
    localStorage.setItem(VIEW_KEY, state.view);
    render();
  };
  $('menuBtn').onclick = openMenu;
  $('importBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => importImage(e.target.files[0]);
  $('restoreInput').onchange = e => e.target.files[0] && restore(e.target.files[0]);
  $('sheetBackdrop').onclick = closeSheet;
  $('draftYear').onchange = changeDraftMonth;
  $('draftMonth').onchange = changeDraftMonth;
  $('draftSave').onclick = saveDraft;
  $('draftCancel').onclick = cancelDraft;
  $('calendar').onclick = e => {
    const cell = e.target.closest('.cal-cell');
    if (cell && !cell.classList.contains('out')) openDay(cell.dataset.date);
  };
  $('list').onclick = e => {
    const g = e.target.closest('.day-group');
    if (g) openDay(g.dataset.date);
  };

  // 좌우 스와이프로 달 이동
  let sx = null, sy = null;
  $('calendar').addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $('calendar').addEventListener('touchend', e => {
    if (sx == null || state.draft) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) moveMonth(dx < 0 ? 1 : -1);
    sx = null;
  });

  render();
  checkSharedImage();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW 등록 실패', e));
  }
}

init();
