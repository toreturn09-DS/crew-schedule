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
  const airports = [];
  const tokens = s.replace(tRe, ' ').split(/[^A-Z0-9]+/).filter(Boolean);
  for (const tok of tokens) {
    for (const raw of splitCodes(tok)) {
      airports.push(isKnownAirport(raw) ? raw : raw.split('').map(c => LETTER_FIX[c] || c).join(''));
    }
  }
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
      from: vote(cands.map(c => c.from), isKnownAirport) || first('from'),
      to: vote(cands.map(c => c.to), isKnownAirport) || first('to'),
      dep: vote(cands.map(c => c.dep), isTime),
      arr: vote(cands.map(c => c.arr), isTime),
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
    const exact = cands.filter(c => c.exact).map(c => c.code);
    const codes = cands.map(c => c.code);
    return { type, code: vote(exact, () => true) || vote(codes, c => !!DUTY_CODES[c]) || vote(codes, () => true) || 'OFF' };
  }
  return { type, text: vote(cands.map(c => c.text), () => true) || '' };
}

function itemWarnings(it) {
  const w = [];
  if (it.type === 'flight') {
    if (!isFlightNo(it.flightNo)) w.push('편명');
    if (!isKnownAirport(it.from) || !isKnownAirport(it.to)) w.push('공항');
    if (!it.dep && !it.arr) w.push('시간');
  } else if (it.type === 'layover') {
    if (!isKnownAirport(it.station)) w.push('체류 공항');
  }
  return w;
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
    const hits = new Set();
    for (const t of tries) for (const s of seen) if (hamming(s, t) === 1) hits.add(s);
    if (hits.size === 1) { it[k] = [...hits][0]; continue; }
    // 2) 전체 공항 DB에서 유일하게 한 글자 차이
    const fromAll = known.filter(s => hamming(s, code) === 1);
    if (fromAll.length === 1) it[k] = fromAll[0];
  }
  for (const c of cells) for (const it of c.items) delete it._alts;
}

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
    if (it.type === 'layover' && !ok(it.station)) {
      if (ok(prevStation)) it.station = prevStation;
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
    if (!ok(it.from) && ok(prevStation)) it.from = prevStation;
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
  for (const it of items) delete it._noWeak;
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

async function analyzeScheduleImage(file, onProgress = () => {}) {
  onProgress('이미지 분석 중…', 0.03);
  const canvas = await loadImageToCanvas(file);
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

  // OCR 대상 영역
  const regions = [];
  // 연·월 제목: 달력 바로 위 띠 (상태바·메뉴는 제외)
  const colW = (cols[7] - cols[0]) / 7;
  // 해상도 기준: 기준 샘플의 칸 폭 114px = 1
  const unit = colW / 114;
  const titleBottom = Math.min(gridTop, lines.length ? lines[0] : gridTop) - 2;
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

  onProgress('문자 인식 엔진 불러오는 중…', 0.06);
  const worker = await getOcrWorker(m => {
    if (/load|initializ/.test(m.status)) onProgress('문자 인식 엔진 불러오는 중…', 0.06 + (m.progress || 0) * 0.08);
  });

  // 배율별 인식
  // 글자 크기가 일정하도록 해상도에 반비례해 확대
  const scales = OCR_OPTS.scales.map(s => Math.max(1, Math.round(s / unit * 2) / 2));
  const passes = [];
  let firstRendered = null;
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
    cells: outCells,
    debug: {
      cols, lines, rows,
      texts: passes[0].texts, flightTexts: passes[0].flightTexts,
      sheet: buildSheet(firstRendered.map(r => r.canvas)),
    },
  };
}
