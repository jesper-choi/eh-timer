// 오프라인 캐시. 태블릿에서 PC(서버) 없이도 열리게 한다.
// 네트워크 우선 + 캐시 폴백: 온라인이면 항상 최신, 오프라인이면 캐시본.
const CACHE = 'eh-timer-v31';   // 올리면 기기의 옛 캐시가 지워진다
const ASSETS = [
	'./', 'index.html', 'app.js', 'stats.js', 'scramble-worker.js', 'manifest.json',
	'favicon.ico', 'assets/icon-192.png', 'assets/icon-512.png',
	'vendor/utillib.js', 'vendor/isaac.js', 'vendor/mathlib.js', 'vendor/min2phase.js',
	'vendor/scramble.js', 'vendor/scramble_333_edit.js', 'vendor/scramble_444.js',
	'vendor/2x2x2.js', 'vendor/megascramble.js'
];

self.addEventListener('install', (e) => {
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

// 페이지에서 SKIP_WAITING 메시지를 보내면 즉시 활성화
self.addEventListener('message', (e) => {
	if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
	e.waitUntil(caches.keys()
		.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
		.then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
	if (e.request.method !== 'GET') return;
	const url = new URL(e.request.url);
	if (url.origin !== self.location.origin) return;   // gist API 등 외부 요청은 손대지 않는다
	if (url.pathname.endsWith('/data')) return;        // 기록 API는 캐시하지 않는다
	e.respondWith(
		fetch(e.request).then((res) => {
			const copy = res.clone();
			caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
			return res;
		}).catch(() => caches.match(e.request).then(
			// 오프라인: 캐시본, 없으면 페이지 이동일 때만 index.html (스크립트 자리에 HTML을 주지 않게)
			(r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
	);
});
