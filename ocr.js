// 승무원 달력 캡처 이미지 분석
//  1) 격자선 검출 → 칸 분할
//  2) 칸 안의 색 막대 검출 → 비행/체류(LO)/휴무 분류
//  3) 글자 영역만 확대·정규화해 한 장의 시트로 모아 OCR 1회 실행
//  4) 텍스트 해석 → 일정 항목

const OCR_OPTS = { scales: [4, 3, 5] }; // 배율별로 인식 후 항목별 다수결
const OCR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-.';

// 막대 색상 기준값 (대한항공 크루 스케줄 화면 기준)
const BAR_PROTOTYPES = [
  { type: 'flight', rgb: [20, 128, 228] },  // 진한 파랑: 비행
  { type: 'layover', rgb: [95, 182, 230] }, // 하늘색: 체류(LO)
  { type: 'off', rgb: [172, 186, 20] },     // 연두: 휴무(ADO/ATDO 등)
];

// 근무/휴무 코드 → 한글 표시
const DUTY_CODES = {
  ADO: '휴무', ATDO: '휴무', RDO: '휴무', OFF: '휴무', XDO: '휴무',
  SBY: '대기', STBY: '대기', RSV: '대기', HSBY: '대기',
  VAC: '휴가', AL: '휴가', LV: '휴가', ALV: '휴가',
  TRG: '교육', TRN: '교육', SIM: '교육', GRD: '교육', ETC: '교육',
  MED: '검진', PHY: '검진',
};

// ───────────────────────── 이미지 → 격자

function toGray(img) {
  const { width: W, height: H, data } = img;
  const g = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    g[i] = (data[4 * i] * 299 + data[4 * i + 1] * 587 + data[4 * i + 2] * 114) / 1000;
  }
  return g;
}

function clusterRuns(idx) {
  const out = [];
  let start = null, prev = null;
  for (const i of idx) {
    if (start === null) { start = prev = i; continue; }
    if (i - prev <= 1) { prev = i; continue; }
    out.push(Math.round((start + prev) / 2));
    start = prev = i;
  }
  if (start !== null) out.push(Math.round((start + prev) / 2));
  return out;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

// 세로선 7칸(8개 선) 찾기
//  캡처에 상태바·메뉴 등이 섞여도 되도록 "끊기지 않고 이어진 길이"로 판정
//  → { cols: [x0..x7], top, bottom } (top/bottom = 세로선이 있는 구간 = 달력 영역)
function detectColumns(g, W, H, k) {
  const minRun = Math.max(H * 0.12, W * 0.25);
  const maxGap = Math.max(2, k);
  const runs = new Array(W).fill(null);
  const cand = [];
  for (let x = k; x < W - k; x++) {
    let best = null, start = -1, last = -1;
    for (let y = 0; y <= H; y++) {
      const o = y * W + x;
      const on = y < H && g[o] < Math.min(g[o - k], g[o + k]) - 3;
      if (on) {
        if (start < 0 || y - last > maxGap + 1) {
          if (start >= 0 && (!best || last - start > best[1] - best[0])) best = [start, last];
          start = y;
        }
        last = y;
      } else if (y === H && start >= 0 && (!best || last - start > best[1] - best[0])) {
        best = [start, last];
      }
    }
    if (best && best[1] - best[0] >= minRun) { runs[x] = best; cand.push(x); }
  }
  const xs = clusterRuns(cand);
  const minGap = W / 12;
  const diffs = [];
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > minGap) diffs.push(xs[i] - xs[i - 1]);
  if (!diffs.length) return null;
  const d = median(diffs);

  // 간격이 d로 일정한 가장 긴 사슬
  let best = [];
  for (let i = 0; i < xs.length; i++) {
    const chain = [xs[i]];
    for (let j = i + 1; j < xs.length; j++) {
      const gap = xs[j] - chain[chain.length - 1];
      if (Math.abs(gap - d) <= d * 0.05) chain.push(xs[j]);
      else if (gap > d * 1.05) break;
    }
    if (chain.length > best.length) best = chain;
  }
  if (best.length < 6) return null;

  // 세로선 구간(달력 위·아래 끝): 검출된 선들의 중앙값
  const runOf = x => {
    for (let dx = 0; dx <= 2; dx++) { if (runs[x - dx]) return runs[x - dx]; if (runs[x + dx]) return runs[x + dx]; }
    return null;
  };
  const found = best.map(runOf).filter(Boolean);
  const top = median(found.map(r => r[0]));
  const bottom = median(found.map(r => r[1]));

  // 바깥 테두리가 안 잡힌 경우 보정
  while (best.length < 8 && best[0] - d >= -2) best.unshift(Math.max(0, best[0] - d));
  while (best.length < 8 && best[best.length - 1] + d <= W + 2) best.push(Math.min(W - 1, best[best.length - 1] + d));
  if (best.length > 8) best = best.slice(0, 8);
  return best.length === 8 ? { cols: best, top, bottom } : null;
}

// 가로선 찾기 → 주(week) 행
function detectRows(g, W, H, k, cols, top = 0, bottom = H) {
  const cand = [];
  const y0 = Math.max(k, top - 3 * k), y1 = Math.min(H - k, bottom + 3 * k + 1);
  for (let y = y0; y < y1; y++) {
    let okCols = 0;
    for (let c = 0; c < 7; c++) {
      const x0 = cols[c] + k + 1, x1 = cols[c + 1] - k - 1;
      let n = 0;
      for (let x = x0; x < x1; x++) {
        const o = y * W + x;
        if (g[o] < Math.min(g[o - k * W], g[o + k * W]) - 3) n++;
      }
      if (n / (x1 - x0) >= 0.95) okCols++;
    }
    if (okCols >= 6) cand.push(y);
  }
  const ys = clusterRuns(cand);
  const colW = (cols[7] - cols[0]) / 7;
  const rows = [];
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] - ys[i - 1] >= colW * 0.45) rows.push([ys[i - 1], ys[i]]);
  }
  return { lines: ys, rows };
}

// ───────────────────────── 칸 → 막대/텍스트 영역

function isSaturated(d, o) {
  const r = d[o], gg = d[o + 1], b = d[o + 2];
  return Math.max(r, gg, b) - Math.min(r, gg, b) >= 50;
}

function classifyBar(rgb) {
  let best = null, bestD = Infinity;
  for (const p of BAR_PROTOTYPES) {
    const dd = Math.hypot(rgb[0] - p.rgb[0], rgb[1] - p.rgb[1], rgb[2] - p.rgb[2]);
    if (dd < bestD) { bestD = dd; best = p.type; }
  }
  return bestD < 70 ? best : 'other';
}

function analyzeCell(img, g, x0, x1, y0, y1) {
  const { width: W, data } = img;
  const innerW = x1 - x0;
  const minBarH = Math.max(5, Math.round(innerW * 0.06));

  // 1) 막대 행 찾기
  const barRows = [];
  for (let y = y0; y < y1; y++) {
    let n = 0;
    for (let x = x0; x < x1; x++) if (isSaturated(data, (y * W + x) * 4)) n++;
    barRows.push(n >= innerW * 0.45);
  }
  // 연속 구간 → 1행 이하 틈은 병합
  const runs = [];
  for (let i = 0; i < barRows.length; i++) {
    if (!barRows[i]) continue;
    const last = runs[runs.length - 1];
    if (last && i - last[1] <= 2) last[1] = i;
    else runs.push([i, i]);
  }
  const bars = runs
    .filter(([s, e]) => e - s + 1 >= minBarH)
    .map(([s, e]) => ({ y0: y0 + s, y1: y0 + e }));

  // 2) 막대별 색상 분류 + 가로 범위
  for (const bar of bars) {
    let r = 0, gg = 0, b = 0, n = 0, bx0 = x1, bx1 = x0;
    for (let y = bar.y0; y <= bar.y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * W + x) * 4;
        if (isSaturated(data, o)) {
          r += data[o]; gg += data[o + 1]; b += data[o + 2]; n++;
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
        }
      }
    }
    bar.rgb = [r / n, gg / n, b / n];
    bar.type = classifyBar(bar.rgb);
    bar.x0 = bx0; bar.x1 = bx1;
  }

  // 3) 막대 아래 상세 텍스트 영역 (어두운 글자 픽셀의 경계 상자)
  for (let i = 0; i < bars.length; i++) {
    const ry0 = bars[i].y1 + 1;
    const ry1 = (i + 1 < bars.length ? bars[i + 1].y0 : y1) - 1;
    // 시간은 회색 글씨라 기준을 넉넉히(200), 상자 테두리(≈229)는 제외됨
    let ty0 = ry1, ty1 = ry0;
    for (let y = ry0; y <= ry1; y++) {
      let n = 0;
      for (let x = x0 + 2; x < x1 - 2; x++) {
        if (g[y * W + x] < 200 && !isSaturated(data, (y * W + x) * 4)) n++;
      }
      if (n >= 2) { if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
    }
    if (ty1 >= ty0) {
      bars[i].detail = { x0: x0 + 1, x1: x1 - 1, y0: Math.max(ry0, ty0 - 3), y1: Math.min(ry1, ty1 + 3) };
    }
  }
  return bars;
}

// ───────────────────────── OCR

const OCR_PAD = 24;

// 영역을 확대하고 "흰 바탕 + 검은 글자"로 정규화 (여백 포함)
function renderRegion(srcCanvas, rect, invert, scale) {
  const w = rect.x1 - rect.x0 + 1, h = rect.y1 - rect.y0 + 1;
  const sw = Math.round(w * scale), sh = Math.round(h * scale);
  const c = document.createElement('canvas');
  c.width = sw + OCR_PAD * 2; c.height = sh + OCR_PAD * 2;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcCanvas, rect.x0, rect.y0, w, h, 0, 0, sw, sh);
  const id = ctx.getImageData(0, 0, sw, sh);
  const d = id.data;
  const lum = new Float32Array(sw * sh);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
  // 배경 = 중앙값, 글자 = 상/하위 1.5% 밝기 → 그 사이를 0~255로 늘림
  const sample = Array.from(lum.filter((_, i) => i % 3 === 0)).sort((a, b) => a - b);
  const bg = sample[Math.floor(sample.length / 2)];
  const text = invert ? sample[Math.floor(sample.length * 0.985)] : sample[Math.floor(sample.length * 0.015)];
  const span = Math.max(30, Math.abs(text - bg) * 0.85);
  for (let i = 0; i < lum.length; i++) {
    const t = Math.min(1, Math.max(0, (invert ? lum[i] - bg : bg - lum[i]) / span));
    let v = Math.round(255 * (1 - t));
    if (v > 200) v = 255; // 연한 테두리·잡음 제거
    d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v;
    d[4 * i + 3] = 255;
  }
  removeLongLines(d, sw, sh);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.putImageData(id, OCR_PAD, OCR_PAD);
  return { canvas: c, lines: countTextLines(d, sw, sh, scale) };
}

// 상자 테두리·막대 경계처럼 길게 이어진 직선 제거 (글자로 오인식 방지)
function removeLongLines(d, w, h) {
  const ink = i => d[4 * i] < 200;
  const clear = i => { d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = 255; };
  const longestRun = (n, at) => {
    let best = 0, run = 0;
    for (let j = 0; j < n; j++) { run = ink(at(j)) ? run + 1 : 0; if (run > best) best = run; }
    return best;
  };
  const rows = [], cols = [];
  for (let y = 0; y < h; y++) if (longestRun(w, x => y * w + x) > w * 0.5) rows.push(y);
  for (let x = 0; x < w; x++) if (longestRun(h, y => y * w + x) > h * 0.8) cols.push(x);
  for (const y of rows) for (let x = 0; x < w; x++) clear(y * w + x);
  for (const x of cols) for (let y = 0; y < h; y++) clear(y * w + x);
}

// 글자 줄 수 (가로 투영)
function countTextLines(d, w, h, scale) {
  let lines = 0, inLine = false, gap = 0;
  const minGap = scale * 2;
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (d[4 * (y * w + x)] < 128) n++;
    if (n > 0) { if (!inLine) lines++; inLine = true; gap = 0; }
    else if (inLine && ++gap >= minGap) inLine = false;
  }
  return lines;
}

// 디버그용: 영역 이미지를 세로로 이어 붙임
function buildSheet(canvases) {
  const width = Math.max(200, ...canvases.map(c => c.width));
  const height = canvases.reduce((s, c) => s + c.height, 0);
  const sheet = document.createElement('canvas');
  sheet.width = width; sheet.height = Math.max(1, height);
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const c of canvases) { ctx.drawImage(c, 0, y); y += c.height; }
  return sheet;
}

let _ocrWorkerPromise = null;

function getOcrWorker(logger) {
  if (!_ocrWorkerPromise) {
    const base = new URL('vendor/', document.baseURI).href;
    _ocrWorkerPromise = Tesseract.createWorker('eng', 1, {
      workerPath: base + 'tesseract/worker.min.js',
      corePath: base + 'tesseract/',
      langPath: base + 'lang',
      workerBlobURL: false,
      gzip: true,
      logger: m => logger && logger(m),
    }, {
      // 공항코드·편명은 영단어가 아니므로 사전 보정 끔
      load_system_dawg: '0', load_freq_dawg: '0',
    }).then(async w => {
      await w.setParameters({
        tessedit_char_whitelist: OCR_WHITELIST,
        preserve_interword_spaces: '1',
      });
      return w;
    }).catch(e => { _ocrWorkerPromise = null; throw e; });
  }
  return _ocrWorkerPromise;
}

// 영역별 OCR: 한 줄은 PSM 7(단일 줄), 여러 줄은 PSM 6(블록)
async function recognizeSet(worker, rendered, idxList, whitelist, onEach) {
  const texts = {};
  for (const psm of ['7', '6']) {
    const idx = idxList.filter(i => (rendered[i].lines > 1 ? '6' : '7') === psm);
    if (!idx.length) continue;
    await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: whitelist });
    for (const i of idx) {
      if (rendered[i].lines > 0) {
        const { data } = await worker.recognize(rendered[i].canvas);
        texts[i] = data.text.replace(/\s+/g, ' ').trim();
      }
      onEach();
    }
  }
  return texts;
}

async function recognizeRegions(worker, rendered, regions, onProgress) {
  const flightIdx = regions.map((r, i) => i).filter(i => regions[i].flight);
  const total = rendered.length + flightIdx.length;
  let done = 0;
  const tick = () => onProgress(++done, total);
  const all = await recognizeSet(worker, rendered, rendered.map((_, i) => i), OCR_WHITELIST, tick);
  // 편명 막대는 허용 문자를 좁혀 한 번 더 (O↔0, S↔5/8 혼동 감소)
  const flight = await recognizeSet(worker, rendered, flightIdx, 'KE0123456789TVL', tick);
  return {
    texts: rendered.map((_, i) => all[i] || ''),
    flightTexts: rendered.map((_, i) => flight[i] || ''),
  };
}

