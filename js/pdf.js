// PDF 가져오기 (pdf.js)
//  - 페이지를 고해상도 이미지로 그려 격자·색 막대를 찾고
//  - PDF에 텍스트 데이터가 있으면 OCR 대신 그 글자를 위치대로 사용 (정확도 ↑, 속도 ↑)

let _pdfjsPromise = null;

function pdfBase() {
  return new URL('vendor/pdfjs/', document.baseURI).href;
}

function loadPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import(pdfBase() + 'pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = pdfBase() + 'pdf.worker.min.mjs';
      return m;
    }).catch(e => { _pdfjsPromise = null; throw e; });
  }
  return _pdfjsPromise;
}

function isPdfFile(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

const PDF_MAX_PAGES = 12;
const PDF_TARGET_WIDTH = 2400; // 그릴 폭(px): 달력 칸 폭이 충분히 크도록

// → [{ canvas, textItems: [{ str, x0, y0, x1, y1 }] }]  (좌표 = canvas 픽셀)
async function renderPdfPages(file, onProgress = () => {}) {
  onProgress('PDF 여는 중…', 0.02);
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: pdfBase() + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: pdfBase() + 'standard_fonts/',
  });
  const doc = await task.promise;
  const n = Math.min(doc.numPages, PDF_MAX_PAGES);
  const pages = [];
  for (let i = 1; i <= n; i++) {
    onProgress(`PDF ${i}/${n}쪽 그리는 중…`, 0.02 + 0.04 * i / n);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(5, PDF_TARGET_WIDTH / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    const tc = await page.getTextContent();
    const textItems = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const t = pdfjs.Util.transform(vp.transform, it.transform);
      const fontH = Math.hypot(t[2], t[3]) || 10;
      const x0 = t[4], baseline = t[5];
      const w = (it.width || 0) * vp.scale;
      textItems.push({ str: it.str, x0, x1: x0 + w, y0: baseline - fontH, y1: baseline });
    }
    pages.push({ canvas, textItems });
    page.cleanup();
  }
  await task.destroy();
  return pages;
}

// 텍스트 조각들을 영역(사각형) 안의 문자열로: 줄(위→아래) · 칸(왼→오른) 순
function textInRect(items, rect, pad = 2) {
  const inside = items.filter(it => {
    const cx = (it.x0 + it.x1) / 2, cy = (it.y0 + it.y1) / 2;
    return cx >= rect.x0 - pad && cx <= rect.x1 + pad && cy >= rect.y0 - pad && cy <= rect.y1 + pad;
  });
  inside.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines = [];
  for (const it of inside) {
    const cy = (it.y0 + it.y1) / 2, h = it.y1 - it.y0;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.cy - cy) < h * 0.6) last.items.push(it);
    else lines.push({ cy, items: [it] });
  }
  return lines.map(l => l.items.sort((a, b) => a.x0 - b.x0).map(i => i.str).join(' ')).join(' ').replace(/\s+/g, ' ').trim();
}
