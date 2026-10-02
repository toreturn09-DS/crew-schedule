// 시간대 변환 (브라우저 내장 Intl 사용 → 서머타임 자동 반영)
const KST_TZ = 'Asia/Seoul';
const _dtfCache = {};

function _dtf(tz) {
  if (!_dtfCache[tz]) {
    _dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  return _dtfCache[tz];
}

// 해당 시각(ms)의 tz 기준 각 필드
function partsInTz(ms, tz) {
  const p = {};
  for (const { type, value } of _dtf(tz).formatToParts(new Date(ms))) p[type] = value;
  return {
    y: +p.year, m: +p.month, d: +p.day,
    hh: +p.hour % 24, mm: +p.minute, ss: +p.second,
  };
}

// tz의 UTC 오프셋(분)
function tzOffsetMin(ms, tz) {
  const p = partsInTz(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

// 'YYYY-MM-DD' + 'HH:MM' (tz 현지) → epoch ms
function zonedToMs(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMin(guess, tz);
  let ms = guess - off * 60000;
  const off2 = tzOffsetMin(ms, tz);
  if (off2 !== off) ms = guess - off2 * 60000;
  return ms;
}

function pad2(n) { return String(n).padStart(2, '0'); }

// epoch ms → { date:'YYYY-MM-DD', time:'HH:MM' } (tz 기준)
function msToZoned(ms, tz) {
  const p = partsInTz(ms, tz);
  return { date: `${p.y}-${pad2(p.m)}-${pad2(p.d)}`, time: `${pad2(p.hh)}:${pad2(p.mm)}` };
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

function dayDiff(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

// 한국 대비 시차 문자열 (예: "한국보다 2시간 느림")
function diffFromKstText(tz, ms) {
  const diff = tzOffsetMin(ms, tz) - tzOffsetMin(ms, KST_TZ);
  if (diff === 0) return '한국과 같은 시간';
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60), m = abs % 60;
  const txt = m ? `${h}시간 ${m}분` : `${h}시간`;
  return diff < 0 ? `한국보다 ${txt} 느림` : `한국보다 ${txt} 빠름`;
}

function durationText(ms) {
  const min = Math.round(ms / 60000);
  return `${Math.floor(min / 60)}시간 ${pad2(min % 60)}분`;
}
