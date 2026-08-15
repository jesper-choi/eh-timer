// Static file server + 기록 저장소.
//   node server.js [port] [기록파일경로]
//
// 기록은 항상 로컬 파일(기본 ./solves.json)에 저장된다.
// 아래 두 환경변수가 있으면 비공개 gist와 양방향 동기화한다(기기 간 동기화용).
//   GITHUB_TOKEN    gist 스코프만 있는 classic 토큰
//   EH_TIMER_GIST   비공개 gist ID
// 토큰은 서버에만 있고 브라우저로 내려가지 않는다.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { merge, normalize, countSolves } = require('./stats.js');

const root = __dirname;
const args = process.argv.slice(2).filter((a) => a !== '--lan');
const port = Number(args[0]) || 8000;
const dataFile = path.resolve(args[1] || process.env.EH_TIMER_DATA || path.join(root, 'solves.json'));
// --lan (또는 .env에 EH_TIMER_LAN=1) 이면 같은 와이파이의 다른 기기(태블릿 등)에서도 접속 가능
const lan = process.argv.includes('--lan') || process.env.EH_TIMER_LAN === '1';
const host = lan ? '0.0.0.0' : '127.0.0.1';

const textTypes = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8'
};
const binaryTypes = {
	'.ico': 'image/x-icon',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.icns': 'image/x-icns'
};

const json = (res, code, body) => res.writeHead(code, {
	'Content-Type': 'application/json; charset=utf-8',
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
}).end(typeof body === 'string' ? body : JSON.stringify(body));

const count = countSolves;

// ── 로컬 파일 (안전 원자적 읽기/쓰기) ──────────────────────────────────────────
function readLocal() {
	try {
		const raw = fs.readFileSync(dataFile, 'utf8');
		return normalize(JSON.parse(raw));
	} catch (e) {
		return normalize({});
	}
}

function writeLocal(db) {
	// tmp에 쓰고 rename: 쓰다 죽어도 기존 기록이 손상되지 않는다
	const tmp = dataFile + '.tmp.' + process.pid + '.' + Date.now();
	const content = typeof db === 'string' ? db : JSON.stringify(normalize(db), null, '\t');
	fs.writeFileSync(tmp, content, 'utf8');
	fs.renameSync(tmp, dataFile);
}

// ── gist 동기화 ──────────────────────────────────────────────────────────────
const GIST = process.env.EH_TIMER_GIST;
const TOKEN = process.env.GITHUB_TOKEN;
const gistOn = !!(GIST && TOKEN);
const gistUrl = (process.env.EH_TIMER_GIST_API || 'https://api.github.com/gists/') + GIST;
const FILENAME = 'solves.json';
const TIMEOUT = 15000;   // 응답 없이 매달려 있지 않게

let lastServerEtag = null;
let lastGistContent = '';

function getGhHeaders(etag) {
	const h = {
		Authorization: 'Bearer ' + TOKEN,
		Accept: 'application/vnd.github+json',
		'User-Agent': 'eh_timer_backend'
	};
	if (etag) h['If-None-Match'] = etag;
	return h;
}

async function gistRead() {
	const r = await fetch(gistUrl, { headers: getGhHeaders(lastServerEtag), signal: AbortSignal.timeout(TIMEOUT) });
	if (r.status === 304 && lastGistContent) {
		return normalize(JSON.parse(lastGistContent));
	}
	if (!r.ok) throw new Error('gist 읽기 실패 HTTP ' + r.status);

	lastServerEtag = r.headers.get('etag') || lastServerEtag;
	const f = (await r.json()).files[FILENAME];
	if (!f) return normalize({});
	const text = f.truncated ? await (await fetch(f.raw_url, { signal: AbortSignal.timeout(TIMEOUT) })).text() : f.content;
	lastGistContent = text || '{}';
	return normalize(JSON.parse(lastGistContent));
}

async function gistWrite(db) {
	const bodyStr = JSON.stringify(normalize(db));
	if (lastGistContent && bodyStr === lastGistContent) return; // 내용 동일 시 불필요한 write 방지

	const r = await fetch(gistUrl, {
		method: 'PATCH',
		headers: getGhHeaders(),
		signal: AbortSignal.timeout(TIMEOUT),
		body: JSON.stringify({ files: { [FILENAME]: { content: bodyStr } } })
	});
	if (!r.ok) throw new Error('gist 쓰기 실패 HTTP ' + r.status);

	lastServerEtag = r.headers.get('etag') || lastServerEtag;
	lastGistContent = bodyStr;
}

// 직렬 동기화 큐: 동시 호출로 인한 race condition 방지
let syncQueue = Promise.resolve();
let isSyncing = false;

function sync(why) {
	if (!gistOn) return Promise.resolve();
	if (isSyncing) {
		schedulePush();
		return syncQueue;
	}
	isSyncing = true;
	syncQueue = syncQueue.catch(() => {}).then(async () => {
		try {
			const remote = await gistRead();
			const current = readLocal();
			const merged = merge(current, remote);
			writeLocal(merged);

			if (JSON.stringify(merged) !== JSON.stringify(remote)) {
				await gistWrite(merged);
			}
			console.log(`[gist sync] (${why}): 총 ${count(merged)}개 솔브 동기화 완료`);
		} catch (e) {
			console.error(`[gist sync] (${why}) 실패:`, e.message);
		} finally {
			isSyncing = false;
		}
	});
	return syncQueue;
}

let pushTimer = null;
function schedulePush() {
	if (!gistOn) return;
	clearTimeout(pushTimer);   // 여러 번 변경되어도 5초 모아서 한 번
	pushTimer = setTimeout(() => sync('저장').catch(() => {}), 5000);
}

// ── HTTP 서버 ─────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
	let rel;
	try {
		rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	} catch (e) {
		return json(res, 400, { error: 'bad url' });
	}
	if (rel.indexOf('\0') !== -1) { res.writeHead(400).end(); return; }

	// CORS Preflight
	if (req.method === 'OPTIONS') {
		res.writeHead(204, {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			'Access-Control-Max-Age': '86400'
		}).end();
		return;
	}

	if (rel === '/data') {
		if (req.method === 'GET') {
			fs.readFile(dataFile, 'utf8', (err, d) => {
				if (err) return json(res, 200, normalize({}));
				try {
					res.writeHead(200, {
						'Content-Type': 'application/json; charset=utf-8',
						'Access-Control-Allow-Origin': '*'
					}).end(d);
				} catch (e) {
					json(res, 200, normalize({}));
				}
			});
			return;
		}
		if (req.method === 'PUT') {
			let body = '';
			req.on('data', (c) => {
				body += c;
				if (body.length > 25e6) { // 25MB 상한
					req.destroy();
				}
			});
			req.on('end', () => {
				try {
					const parsed = JSON.parse(body);
					if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
						return json(res, 400, { error: 'bad json' });
					}
					// 원자적 병합: 현재 로컬 데이터와 클라이언트의 데이터를 안전하게 병합하여 저장
					const current = readLocal();
					const merged = merge(current, parsed);
					writeLocal(merged);
					schedulePush();
					json(res, 200, { ok: true, count: count(merged) });
				} catch (e) {
					return json(res, 500, { error: 'write failed: ' + (e.message || e) });
				}
			});
			return;
		}
	}

	const safePath = path.normalize(rel === '/' ? '/index.html' : rel);
	const file = path.join(root, safePath);
	if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) {
		res.writeHead(403).end('Forbidden');
		return;
	}

	fs.readFile(file, (err, data) => {
		if (err) {
			res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
			return;
		}
		const ext = path.extname(file).toLowerCase();
		const contentType = textTypes[ext] || binaryTypes[ext] || 'application/octet-stream';
		res.writeHead(200, {
			'Content-Type': contentType,
			'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
		});
		res.end(data);
	});
});

server.listen(port, host, () => {
	console.log(`eh_timer: http://localhost:${port}`);
	if (lan) {
		for (const list of Object.values(require('node:os').networkInterfaces())) {
			for (const ni of list) {
				if (ni.family === 'IPv4' && !ni.internal) console.log(`태블릿/폰에서: http://${ni.address}:${port}`);
			}
		}
	}
	console.log(`기록 파일: ${dataFile} (${count(readLocal())}개)`);
	if (!gistOn) {
		console.log('gist 동기화: 꺼짐 (GITHUB_TOKEN, EH_TIMER_GIST 설정하면 켜짐)');
	} else {
		sync('시작').catch((e) => console.log('gist 동기화 실패 — 로컬 파일만 사용:', e.message));
	}
});

// 프로세스 종료 시 남아있는 gist push 즉시 플러시
function shutdown() {
	if (pushTimer) {
		clearTimeout(pushTimer);
		sync('종료').finally(() => process.exit(0));
	} else {
		process.exit(0);
	}
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

