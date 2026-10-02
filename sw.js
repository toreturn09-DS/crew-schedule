// 서비스워커: 오프라인 실행 + 안드로이드 "공유하기" 수신
const VERSION = 'v2';
const SHELL = `crew-shell-${VERSION}`;
const VENDOR = 'crew-vendor-v1'; // OCR 엔진(용량 큼) — 앱 업데이트와 별도로 유지

const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/airports.js', 'js/tz.js', 'js/ocr.js', 'js/parse.js', 'js/app.js',
  'vendor/tesseract/tesseract.min.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('crew-shell-') && k !== SHELL) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 공유하기로 받은 이미지 → 캐시에 보관 후 앱으로 이동
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const file = form.get('image');
      if (file) {
        const cache = await caches.open('crew-share');
        await cache.put('shared-image', new Response(file, { headers: { 'Content-Type': file.type || 'image/png' } }));
      }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // OCR 엔진·언어 데이터: 캐시 우선 (처음 쓸 때 저장)
  if (url.pathname.includes('/vendor/')) {
    e.respondWith((async () => {
      const cache = await caches.open(VENDOR);
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })());
    return;
  }

  // 앱 화면: 네트워크 우선(최신 반영), 오프라인이면 캐시
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match('index.html'));
    }
  })());
});
