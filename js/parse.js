// OCR 텍스트 해석 · 배율별 다수결 · 일정 흐름 보정 · 분석 메인
// (ocr.js, airports.js, tz.js 이후에 로드)

const LETTER_FIX = { '0': 'O', '1': 'I', '8': 'B', '5': 'S', '2': 'Z', '6': 'G', '4': 'A' };
const DIGIT_FIX = { O: '0', D: '0', Q: '0', U: '0', I: '1', L: '1', J: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
const DIGIT_LIKE = '0123456789ODQUILJZSBGT';
const DUTY_ORDER = ['ADO', 'ATDO', ...Object.keys(DUTY_CODES).filter(c => c !== 'ADO' && c !== 'ATDO')];

const isTime = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const isFlightNo = f => /^[A-Z0-9]{2}\d{4}$/.test(f);

function hamming(a, b) {
  if (a.length !== b.length) return 99;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// ───────────────────────── 텍스트 해석

function normalizeTimes(s) {
  return s
    // 숫자 바로 뒤의 숫자 닮은 글자: "174S" → "1745"
    .replace(/(?<=\d)[SOIBZDQ]/g, c => DIGIT_FIX[c])
    .replace(/(?<=\d)[SOIBZDQ]/g, c => DIGIT_FIX[c])
    .replace(/(\d{1,2})\s*[:.;,]+\s*(\d{2})(?!\d)/g, (_, h, m) => `${h.padStart(2, '0')}:${m}`)
    // 콜론이 숫자로 읽힌 5자리: "12230" → "12:30"
    .replace(/(?<![\d:])([01]\d|2[0-3])\d([0-5]\d)(?![\d:])/g, '$1:$2')
    // 콜론이 빠진 4자리: "1855" → "18:55"
    .replace(/(?<![\d:])([01]\d|2[0-3])([0-5]\d)(?![\d:])/g, '$1:$2');
}

// 편명: 끝쪽의 숫자(닮은 글자 포함) 3~4자리 + 그 앞 2글자 항공사
function parseFlightBar(text) {
  let s = (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const deadhead = /TVL|TUL|TYL|IVL/.test(s);
  s = s.replace(/TVL|TUL|TYL|IVL/g, '');
  const end = s.length;
  let start = end;
  while (start > 0 && DIGIT_LIKE.includes(s[start - 1])) start--;
  if (end - start < 3) return { flightNo: null, deadhead, full: false };
  const num = s.slice(Math.max(start, end - 4), end).split('').map(c => DIGIT_FIX[c] || c).join('').padStart(4, '0');
  const prefix = s.slice(Math.max(0, start - 2), start);
  // 대한항공 승무원 스케줄이므로 애매하면 KE
  const airline = prefix.length === 2 && hamming(prefix, 'KE') > 1 ? prefix : 'KE';
  // full: 숫자 4자리를 온전히 읽음 (3자리는 한 글자 놓쳤을 가능성)
  return { flightNo: airline + num, deadhead, full: end - start >= 4 };
}

// → { code, exact } exact: 코드표와 그대로 일치(보정 없음)
function parseDutyBar(text) {
  const s = (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O');
  if (!s) return { code: null, exact: false };
  if (DUTY_CODES[s]) return { code: s, exact: true };
  let best = null, bestD = 2;
  for (const c of DUTY_ORDER) {
    const d = levenshtein(s, c);
    if (d < bestD) { best = c; bestD = d; }
  }
  return { code: best || s, exact: false };
}

// OCR 토큰 → 공항코드 후보
//  3자: 그대로 / 6자: 붙은 두 코드 / 5자: 한 글자 빠진 두 코드("PVGCN") / 7자: 한 글자 낀 두 코드
//  4자: 한 글자 낀 단일 코드("UKSB")
function splitCodes(tok) {
  if (/^\d+$/.test(tok)) return [];
  switch (tok.length) {
    case 3: return [tok];
    case 6: return [tok.slice(0, 3), tok.slice(3)];
    case 5:
    case 7: return [tok.slice(0, 3), tok.slice(-3)];
    case 4: {
      for (let i = 0; i < 4; i++) {
        const c = tok.slice(0, i) + tok.slice(i + 1);
        if (isKnownAirport(c)) return [c];
      }
      return [tok.slice(0, 3)];
    }
    default: return [];
  }
}

// 상세 텍스트: "ICN-HAN 08:00 - 10:35", "HAN -10:45", "ICN-GUM 19:45 -", "GMP - 18:40 - HND 21:00"
function parseDetail(text) {
  const s = normalizeTimes((text || '').toUpperCase().replace(/[–—~_=]/g, '-'));

  // 1) 시간 먼저 추출 (앞뒤 '-'로 출발/도착 판정: "19:45 -" 출발, "-01:00" 도착)
  const times = [];
  const tRe = /([01]\d|2[0-3]):([0-5]\d)/g;
  let m;
  while ((m = tRe.exec(s))) {
    times.push({
      t: m[0],
      dashBefore: /-\s*$/.test(s.slice(0, m.index)),
      dashAfter: /^\s*-/.test(s.slice(m.index + 5)),
    });
  }

  // 2) 시간을 지운 나머지에서 공항코드
  const fix = raw => (isKnownAirport(raw) ? raw : raw.split('').map(c => LETTER_FIX[c] || c).join(''));
  const rest = s.replace(tRe, '     ');
  const found = [];
  const tokRe = /[A-Z0-9]+/g;
  while ((m = tokRe.exec(rest))) {
    const codes = splitCodes(m[0]).map(fix);
    const dashBefore = /-\s*$/.test(rest.slice(0, m.index));
    codes.forEach((code, i) => found.push({ code, dashBefore: i > 0 || dashBefore }));
  }
  // 코드가 하나뿐이고 '-' 뒤에 있으면 도착지 ("…-NGO": 앞 코드를 놓친 경우)
  let airports = found.map(f => f.code);
  if (found.length === 1 && found[0].dashBefore) airports = ['', found[0].code];
  return { airports, times };
}

// 한 배율의 인식 결과로 만든 항목 후보
function buildCandidate(type, barText, detailText, flightText) {
  const det = parseDetail(detailText);
  if (type === 'flight') {
    const strict = parseFlightBar(flightText);
    const loose = parseFlightBar(barText);
    const c = {
      type,
      flightNos: [strict, loose].filter(r => r.flightNo).map(r => ({ no: r.flightNo, full: r.full })),
      deadhead: strict.deadhead || loose.deadhead,
      from: det.airports[0] || '',
      to: det.airports[1] || '',
      dep: null, arr: null,
    };
    if (det.times.length >= 2) {
      c.dep = det.times[0].t; c.arr = det.times[1].t;
    } else if (det.times.length === 1) {
      const t = det.times[0];
      if (!t.dashAfter && t.dashBefore) c.arr = t.t; else c.dep = t.t;
    }
    return c;
  }
  if (type === 'layover') {
    return { type, station: det.airports[0] || '', end: det.times.length ? det.times[det.times.length - 1].t : null };
  }
  if (type === 'off') {
    const { code, exact } = parseDutyBar(barText);
    return { type, code, exact };
  }
  return { type: 'other', text: [barText, detailText].filter(Boolean).join(' ').trim() };
}

// ───────────────────────── 다수결

// 유효한 값만 세어 최다 득표 (동률이면 먼저 나온 값 = 앞선 배율 우선)
function voteWithShare(values, isValid) {
  const counts = new Map();
  let total = 0;
  for (const v of values) if (v != null && v !== '' && isValid(v)) { counts.set(v, (counts.get(v) || 0) + 1); total++; }
  let best = null, bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return { value: best, share: total ? bestN / total : 0, votes: bestN };
}

function vote(values, isValid) {
  return voteWithShare(values, isValid).value;
}

// 출발/도착 시간: 먼저 "둘 다 / 출발만 / 도착만" 형태를 정하고 값을 투표
//  (오인식은 시간을 잃는 쪽이 많으므로, 둘 다 읽힌 배율이 있으면 둘 다로 판단)
function mergeTimes(cands) {
  const both = cands.filter(c => c.dep && c.arr && c.dep !== c.arr);
  if (both.length) {
    return { dep: vote(cands.map(c => c.dep), isTime), arr: vote(cands.map(c => c.arr), isTime) };
  }
  const depOnly = cands.filter(c => c.dep && !c.arr).length;
  const arrOnly = cands.filter(c => c.arr && !c.dep).length;
  if (!depOnly && !arrOnly) return { dep: null, arr: null };
  return depOnly >= arrOnly
    ? { dep: vote(cands.map(c => c.dep), isTime), arr: null }
    : { dep: null, arr: vote(cands.map(c => c.arr), isTime) };
}

// 출발/도착 공항 투표 (같은 공항이 되지 않게)
function mergeRoute(cands, first) {
  const from = vote(cands.map(c => c.from), isKnownAirport) || first('from');
  const to = vote(cands.map(c => c.to), c => isKnownAirport(c) && c !== from) || first('to');
  if (from && from === to) {
    const altFrom = vote(cands.map(c => c.from), c => isKnownAirport(c) && c !== to);
    return { from: altFrom || '', to };
  }
  return { from, to };
}

function mergeCandidates(cands, tall) {
  const type = cands[0].type;
  const first = k => (cands.find(c => c[k]) || {})[k] || '';
  // 미등록 코드 보정용: 배율별 원래 후보 전부 보관
  const alts = k => [...new Set(cands.map(c => c[k]).filter(Boolean))];
  if (type === 'flight') {
    // 엄격 인식(KE+숫자 전용) 결과는 2표
    // 4자리로 온전히 읽힌 후보가 있으면 그것만 사용
    const anyFull = cands.some(c => c.flightNos.some(f => f.full));
    const nos = cands.flatMap(c => {
      const fs = c.flightNos.filter(f => f.full || !anyFull).map(f => f.no);
      return c.flightNos[0] && fs[0] === c.flightNos[0].no ? [fs[0], ...fs] : fs;
    });
    const fn = voteWithShare(nos, isFlightNo);
    return {
      type,
      flightNo: fn.value || '',
      _noWeak: fn.share < 0.6 || fn.votes <= 3, // 득표 약함 (한 배율에서만 나온 값 = 최대 3표)
      deadhead: tall || cands.filter(c => c.deadhead).length * 2 > cands.length,
      ...mergeRoute(cands, first),
      ...mergeTimes(cands),
      _alts: { from: alts('from'), to: alts('to') },
    };
  }
  if (type === 'layover') {
    return {
      type,
      station: vote(cands.map(c => c.station), isKnownAirport) || first('station'),
      end: vote(cands.map(c => c.end), isTime),
      _alts: { station: alts('station') },
    };
  }
  if (type === 'off') {
    // 정확히 읽힌 코드 우선 ("ATDO"가 "DO"로 잘려 ADO로 보정된 것보다 신뢰)
    let exact = cands.filter(c => c.exact).map(c => c.code);
    const isSubseq = (a, b) => { let i = 0; for (const ch of b) if (ch === a[i]) i++; return i === a.length; };
    exact = exact.map(c => exact.find(o => o.length > c.length && isSubseq(c, o)) || c);
    const codes = cands.map(c => c.code);
    return { type, code: vote(exact, () => true) || vote(codes, c => !!DUTY_CODES[c]) || vote(codes, () => true) || 'OFF' };
  }
  return { type, text: vote(cands.map(c => c.text), () => true) || '' };
}

function itemWarnings(it) {
  const w = [];
  if (it._uncertain && it._uncertain.length) w.push('공항(추정)');
  if (it.type === 'flight') {
    if (!isFlightNo(it.flightNo)) w.push('편명');
    if (!isKnownAirport(it.from) || !isKnownAirport(it.to)) w.push('공항');
    if (!it.dep && !it.arr) w.push('시간');
  } else if (it.type === 'layover') {
    if (!isKnownAirport(it.station)) w.push('체류 공항');
  }
  return w;
}

// ───────────────────────── 막대 색 재판정

// 같은 사진 안의 막대끼리 비교해 비행(진한 파랑)/체류(연한 파랑)/휴무(연두) 판정
// → 기기·앱·PDF 렌더링마다 색감이 달라도 동작
function reclassifyBars(cells) {
  const bars = cells.flatMap(c => c.bars);
  const isBlue = b => b.rgb[2] > b.rgb[0] + 40 && b.rgb[2] >= b.rgb[1];
  const isGreen = b => b.rgb[1] > b.rgb[2] + 40 && b.rgb[0] > b.rgb[2] + 40;
  for (const b of bars) if (isGreen(b)) b.type = 'off';
  const blues = bars.filter(isBlue);
  if (!blues.length) return;
  const m = b => b.rgb[0] + b.rgb[1]; // 진할수록 작음 (비행 ≈ 170~220, 체류 ≈ 280~310)
  const vals = blues.map(m);
  let c1 = Math.min(...vals), c2 = Math.max(...vals);
  let thr = 250;
  if (c2 - c1 >= 40) {
    for (let it = 0; it < 10; it++) {
      thr = (c1 + c2) / 2;
      const a = vals.filter(v => v < thr), z = vals.filter(v => v >= thr);
      if (!a.length || !z.length) break;
      c1 = a.reduce((x, y) => x + y, 0) / a.length;
      c2 = z.reduce((x, y) => x + y, 0) / z.length;
    }
    thr = (c1 + c2) / 2;
  }
  for (const b of blues) b.type = m(b) < thr ? 'flight' : 'layover';
}

// ───────────────────────── 월 단위 보정

// 같은 달 안에서 이미 등장한 공항코드로 오인식 보정
function fixUnknownAirports(cells) {
  const seen = new Set();
  const all = [];
  for (const c of cells) for (const it of c.items) {
    for (const k of ['from', 'to', 'station']) {
      if (it[k]) { all.push([it, k]); if (isKnownAirport(it[k])) seen.add(it[k]); }
    }
  }
  const known = Object.keys(AIRPORTS);
  for (const [it, k] of all) {
    const code = it[k];
    if (isKnownAirport(code)) continue;
    // 1) 배율별 후보 중 이달에 등장한 코드와 한 글자 차이 ("KKN"/"KCN" → ICN)
    const tries = [code, ...((it._alts && it._alts[k]) || [])];
    const opposite = k === 'from' ? it.to : k === 'to' ? it.from : null; // 출발=도착은 불가
    const hits = new Set();
    for (const t of tries) for (const s of seen) if (hamming(s, t) === 1 && s !== opposite) hits.add(s);
    if (hits.size === 1) { it[k] = [...hits][0]; continue; }
    // 2) 전체 공항 DB에서 유일하게 한 글자 차이
    const fromAll = known.filter(s => hamming(s, code) === 1 && s !== opposite);
    if (fromAll.length === 1) {
      it[k] = fromAll[0];
      (it._guessed = it._guessed || {})[k] = true; // 추정값 → 일정 흐름이 있으면 그쪽 우선
    }
  }
  for (const c of cells) for (const it of c.items) delete it._alts;
}

const guessed = (it, k) => !!(it._guessed && it._guessed[k]);
const unguess = (it, k) => { if (it._guessed) delete it._guessed[k]; };

// 작은 글씨에서 OCR이 자주 혼동하는 숫자 쌍으로만 다른지
const CONFUSABLE_DIGITS = ['68', '38', '58', '08', '17', '69', '35'];
function isConfusableDiff(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const pair = [a[i], b[i]].sort().join('');
    if (!CONFUSABLE_DIGITS.includes(pair)) return false;
  }
  return true;
}

// 일정 흐름으로 빈칸/오인식 보정
//  - 체류 공항 = 직전 비행 도착지 (없으면 다음 비행 출발지)
//  - 비행 출발지 = 직전 체류/도착지
//  - 다음날로 이어지는 비행(출발만/도착만)은 서로 편명·노선 공유
function inferFromSequence(cells) {
  const items = [...cells].sort((a, b) => a.row - b.row || a.col - b.col).flatMap(c => c.items);
  const ok = c => isKnownAirport(c);
  const isMove = x => x.type === 'flight' || x.type === 'layover';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const prev = items.slice(0, i).reverse().find(isMove);
    const next = items.slice(i + 1).find(isMove);
    const prevStation = prev && (prev.type === 'flight' ? prev.to : prev.station);
    if (it.type === 'layover' && (!ok(it.station) || (guessed(it, 'station') && ok(prevStation)))) {
      if (ok(prevStation)) { it.station = prevStation; unguess(it, 'station'); }
      else if (next && next.type === 'flight' && ok(next.from)) it.station = next.from;
    }
    if (it.type !== 'flight') continue;
    if (prev && prev.type === 'flight' && prev.dep && !prev.arr && it.arr && !it.dep) {
      if (!isFlightNo(it.flightNo)) it.flightNo = prev.flightNo;
      if (!isFlightNo(prev.flightNo)) prev.flightNo = it.flightNo;
      if (!ok(it.from)) it.from = prev.from;
      if (!ok(it.to)) it.to = prev.to;
      if (!ok(prev.to)) prev.to = it.to;
      continue;
    }
    if ((!ok(it.from) || guessed(it, 'from')) && ok(prevStation) && prevStation !== it.to) {
      it.from = prevStation;
      // 국내 귀환 후에는 인천/김포 어느 쪽에서든 출발할 수 있어 확인 필요로 표시
      if (getAirport(prevStation).tz === KST_TZ && prev.type === 'flight') (it._guessed = it._guessed || {}).from = true;
      else unguess(it, 'from');
    }
    if (!ok(it.to) && next) {
      const ns = next.type === 'layover' ? next.station : next.from;
      if (ok(ns) && ns !== it.from) it.to = ns;
    }
  }

  // 왕복편 번호 보정: A→B(홀수 n) 다음 B→A 편은 보통 n+1.
  // OCR 득표가 약하고 기대값과 한 글자 차이일 때만 적용
  const flights = items.filter(x => x.type === 'flight');
  for (let i = 1; i < flights.length; i++) {
    const out = flights[i - 1], back = flights[i];
    if (!isFlightNo(out.flightNo) || out.from !== back.to || out.to !== back.from) continue;
    const n = +out.flightNo.slice(2);
    if (n % 2 === 0) continue;
    const expected = out.flightNo.slice(0, 2) + String(n + 1).padStart(4, '0');
    if (back.flightNo === expected) continue;
    if (!isFlightNo(back.flightNo) ||
        (hamming(back.flightNo, expected) === 1 && (back._noWeak || isConfusableDiff(back.flightNo, expected)))) {
      back.flightNo = expected;
    }
  }
  for (const it of items) {
    delete it._noWeak;
    // 추정으로 채운 값은 "확인 필요"로 남김 (저장 시 제거, 수정하면 사라짐)
    const g = it._guessed ? Object.keys(it._guessed) : [];
    if (g.length) it._uncertain = g;
    delete it._guessed;
  }
}

// ───────────────────────── 칸 위치 → 날짜

function cellsToDays(cells, year, month) {
  const first = new Date(year, month - 1, 1).getDay(); // 0=일
  const dim = new Date(year, month, 0).getDate();
  const days = {};
  for (const c of cells) {
    const day = c.row * 7 + c.col - first + 1;
    if (day < 1 || day > dim || !c.items.length) continue;
    days[`${year}-${pad2(month)}-${pad2(day)}`] = c.items.map(x => ({ ...x }));
  }
  return days;
}

// ───────────────────────── 메인

async function loadImageToCanvas(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return c;
}

// 다크 모드(어두운 배경) 캡처 → 밝기만 뒤집어 밝은 배경처럼 변환 (색상 차이는 유지)
function normalizeDarkMode(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = id.data;
  const sample = [];
  for (let i = 0; i < d.length; i += 4 * 97) sample.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  if (median(sample) >= 100) return false;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const shift = 255 - 2 * lum;
    d[i] = Math.max(0, Math.min(255, d[i] + shift));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + shift));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + shift));
  }
  ctx.putImageData(id, 0, 0);
  return true;
}

// 파일(이미지 또는 PDF) → 달력별 분석 결과 배열 (PDF는 달력이 있는 쪽마다 1개)
async function analyzeScheduleFile(file, onProgress = () => {}) {
  if (typeof isPdfFile === 'function' && isPdfFile(file)) {
    const pages = await renderPdfPages(file, onProgress);
    const results = [];
    let lastErr = null;
    for (let i = 0; i < pages.length; i++) {
      const sub = (t, f) => onProgress(pages.length > 1 ? `[${i + 1}/${pages.length}쪽] ${t}` : t, 0.06 + 0.94 * (i + f) / pages.length);
      try {
        results.push(await analyzeCanvas(pages[i].canvas, sub, pages[i].textItems));
      } catch (e) {
        lastErr = e; // 달력이 없는 쪽은 건너뜀
      }
    }
    if (!results.length) throw lastErr || new Error('PDF에서 달력을 찾지 못했습니다.');
    return results;
  }
  onProgress('이미지 불러오는 중…', 0.02);
  const canvas = await loadImageToCanvas(file);
  return [await analyzeCanvas(canvas, onProgress)];
}

async function analyzeScheduleImage(file, onProgress = () => {}) {
  return (await analyzeScheduleFile(file, onProgress))[0];
}

// textItems: PDF 텍스트 조각 (있으면 OCR 대신 사용)
async function analyzeCanvas(canvas, onProgress = () => {}, textItems = null) {
  onProgress('이미지 분석 중…', 0.03);
  const dark = normalizeDarkMode(canvas);
  const W = canvas.width, H = canvas.height;
  const img = canvas.getContext('2d').getImageData(0, 0, W, H);
  const g = toGray(img);
  const k = Math.max(2, Math.round(W / 350));

  const grid = detectColumns(g, W, H, k);
  if (!grid) throw new Error('달력 격자(세로줄)를 찾지 못했습니다. 달력 전체가 보이게 캡처해 주세요.');
  const { cols, top: gridTop, bottom: gridBottom } = grid;
  const { lines, rows } = detectRows(g, W, H, k, cols, gridTop, gridBottom);
  if (rows.length < 4) throw new Error('달력 격자(가로줄)를 찾지 못했습니다. 달력 전체가 보이게 캡처해 주세요.');

  // 칸별 막대/영역
  const cells = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < 7; c++) {
      const x0 = cols[c] + k + 1, x1 = cols[c + 1] - k;
      const y0 = rows[r][0] + k + 1, y1 = rows[r][1] - k;
      cells.push({ row: r, col: c, bars: analyzeCell(img, g, x0, x1, y0, y1) });
    }
  }
  reclassifyBars(cells);

  // OCR 대상 영역
  const regions = [];
  // 연·월 제목: 달력 바로 위 띠 (상태바·메뉴는 제외)
  const colW = (cols[7] - cols[0]) / 7;
  // 해상도 기준: 기준 샘플의 칸 폭 114px = 1
  const unit = colW / 114;
  const titleBottom = Math.min(gridTop, rows[0][0]) - 2;
  const titleTop = Math.max(0, Math.round(titleBottom - colW * 0.9));
  if (titleBottom - titleTop > 8) {
    regions.push({ kind: 'title', rect: { x0: Math.max(0, cols[0] - 4), x1: Math.round(cols[0] + (cols[7] - cols[0]) * 0.6), y0: titleTop, y1: titleBottom }, invert: false });
  }
  for (const cell of cells) {
    for (const bar of cell.bars) {
      if (bar.type !== 'layover') {
        bar.textRegion = regions.length;
        // 둥근 모서리/바깥 흰 배경이 검은 테두리로 바뀌지 않도록 안쪽으로 잘라냄
        const ix = Math.max(2, Math.round(4 * unit)), iy = Math.max(1, Math.round(unit));
        regions.push({ kind: 'bar', flight: bar.type === 'flight', rect: { x0: bar.x0 + ix, x1: bar.x1 - ix, y0: bar.y0 + iy, y1: bar.y1 - iy }, invert: true });
      }
      if (bar.detail) {
        bar.detailRegion = regions.length;
        regions.push({ kind: 'detail', rect: bar.detail, invert: false });
      }
    }
  }

  // PDF 텍스트가 달력 안에 충분히 있으면 OCR 생략
  const gridRect = { x0: cols[0], x1: cols[7], y0: gridTop, y1: gridBottom };
  const pdfText = textItems && textItems.filter(t => {
    const cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2;
    return cx >= gridRect.x0 && cx <= gridRect.x1 && cy >= gridRect.y0 && cy <= gridRect.y1;
  }).length >= 5;

  const passes = [];
  let firstRendered = null;
  const scales = pdfText ? [] : [...new Set(OCR_OPTS.scales.map(s => Math.max(1, Math.round(s / unit * 4) / 4)))];
  if (pdfText) {
    onProgress('PDF 글자 읽는 중…', 0.5);
    const texts = regions.map(r => textInRect(textItems, r.rect, Math.max(2, Math.round(2 * unit))));
    passes.push({ texts, flightTexts: texts });
  } else {
    onProgress('문자 인식 엔진 불러오는 중…', 0.06);
  }
  const worker = pdfText ? null : await getOcrWorker(m => {
    if (/load|initializ/.test(m.status)) onProgress('문자 인식 엔진 불러오는 중…', 0.06 + (m.progress || 0) * 0.08);
  });

  // 배율별 인식 (글자 크기가 일정하도록 해상도에 반비례해 확대)
  for (let p = 0; p < scales.length; p++) {
    const rendered = regions.map(r => renderRegion(canvas, r.rect, r.invert, scales[p]));
    if (p === 0) firstRendered = rendered;
    passes.push(await recognizeRegions(worker, rendered, regions, (n, total) => {
      const f = (p + n / total) / scales.length;
      onProgress(`문자 인식 중… ${Math.round(f * 100)}%`, 0.15 + 0.82 * f);
    }));
  }

  onProgress('일정 해석 중…', 0.98);

  // 연/월
  let year = null, month = null;
  if (regions[0] && regions[0].kind === 'title') {
    for (const ps of passes) {
      const mm = ps.texts[0].replace(/\s+/g, '').match(/(20\d{2})[.\-/]?(\d{1,2})/);
      if (mm && +mm[2] >= 1 && +mm[2] <= 12) { year = +mm[1]; month = +mm[2]; break; }
    }
  }
  if (!year && textItems) {
    // PDF: 달력 위쪽 텍스트에서 "2026.10" 같은 연·월 찾기
    for (const t of textItems.filter(t => t.y1 <= gridTop + 4).sort((a, b) => b.y1 - a.y1)) {
      const mm = t.str.replace(/\s+/g, '').match(/(20\d{2})[.\-/년]?(\d{1,2})/);
      if (mm && +mm[2] >= 1 && +mm[2] <= 12) { year = +mm[1]; month = +mm[2]; break; }
    }
  }

  // 항목 생성 (배율별 후보 → 다수결)
  const medH = median(cells.flatMap(c => c.bars.filter(b => b.type === 'flight').map(b => b.y1 - b.y0)));
  const textOf = (ps, idx) => (idx != null ? ps.texts[idx] : '');
  const outCells = cells.map(cell => {
    const items = cell.bars.map(bar => {
      const cands = passes.map(ps => buildCandidate(
        bar.type, textOf(ps, bar.textRegion), textOf(ps, bar.detailRegion),
        bar.textRegion != null ? ps.flightTexts[bar.textRegion] : '',
      ));
      const tall = bar.type === 'flight' && medH > 0 && (bar.y1 - bar.y0) > medH * 1.5;
      const item = mergeCandidates(cands, tall);
      item._raw = passes.map(ps => [textOf(ps, bar.textRegion), bar.textRegion != null && ps.flightTexts[bar.textRegion] ? `(${ps.flightTexts[bar.textRegion]})` : "", textOf(ps, bar.detailRegion)]
        .filter(Boolean).join(' | ')).join(' ‖ ');
      return item;
    });
    return { row: cell.row, col: cell.col, items };
  });
  fixUnknownAirports(outCells);
  inferFromSequence(outCells);
  for (const c of outCells) for (const it of c.items) it.warnings = itemWarnings(it);

  return {
    year, month,
    weeks: rows.length,
    lowRes: !pdfText && colW < 95, // 칸 폭이 작아 글자가 매우 작음 → 인식 부정확 가능
    source: pdfText ? 'pdf-text' : 'ocr',
    dark,
    cells: outCells,
    debug: {
      cols, lines, rows,
      texts: passes[0].texts, flightTexts: passes[0].flightTexts,
      sheet: firstRendered ? buildSheet(firstRendered.map(r => r.canvas)) : null,
    },
  };
}
