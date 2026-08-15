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
const { merge } = require('./stats.js');

const root = __dirname;
const args = process.argv.slice(2).filter((a) => a !== '--lan');
const port = Number(args[0]) || 8000;
const dataFile = path.resolve(args[1] || process.env.EH_TIMER_DATA || path.join(root, 'solves.json'));
// --lan (또는 .env에 EH_TIMER_LAN=1) 이면 같은 와이파이의 다른 기기(태블릿 등)에서도 접속 가능
const lan = process.argv.includes('--lan') || process.env.EH_TIMER_LAN === '1';
const host = lan ? '0.0.0.0' : '127.0.0.1';
const types = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
	'.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml'
};

const json = (res, code, body) => res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }).end(body);
const count = (o) => Object.values(o).reduce((n, a) => n + a.length, 0);

// ── 로컬 파일 ────────────────────────────────────────────────────────────────
function readLocal() {
	try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch (e) { return {}; }
}
function writeLocal(db) {
	// tmp에 쓰고 rename: 쓰다 죽어도 기존 기록이 반토막 나지 않는다
	const tmp = dataFile + '.tmp';
	fs.writeFileSync(tmp, typeof db === 'string' ? db : JSON.stringify(db));
	fs.renameSync(tmp, dataFile);
}

// ── gist 동기화 ──────────────────────────────────────────────────────────────
const GIST = process.env.EH_TIMER_GIST;
const TOKEN = process.env.GITHUB_TOKEN;
const gistOn = !!(GIST && TOKEN);
const gistUrl = (process.env.EH_TIMER_GIST_API || 'https://api.github.com/gists/') + GIST;
const ghHeaders = { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'eh_timer' };
const FILENAME = 'solves.json';

const TIMEOUT = 15000;   // 응답 없이 매달려 있지 않게

async function gistRead() {
	const r = await fetch(gistUrl, { headers: ghHeaders, signal: AbortSignal.timeout(TIMEOUT) });
	if (!r.ok) throw new Error('gist 읽기 실패 HTTP ' + r.status);
	const f = (await r.json()).files[FILENAME];
	if (!f) return {};
	const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;   // 1MB 넘으면 잘려서 옴
	return JSON.parse(text || '{}');
}
async function gistWrite(db) {
	const r = await fetch(gistUrl, {
		method: 'PATCH', headers: ghHeaders, signal: AbortSignal.timeout(TIMEOUT),
		body: JSON.stringify({ files: { [FILENAME]: { content: JSON.stringify(db) } } })
	});
	if (!r.ok) throw new Error('gist 쓰기 실패 HTTP ' + r.status);
}

// 항상 원격과 합쳐서 올린다. 다른 기기가 먼저 올린 기록을 덮어쓰지 않기 위함.
async function sync(why) {
	const merged = merge(readLocal(), await gistRead());
	writeLocal(merged);
	await gistWrite(merged);
	console.log(`gist 동기화(${why}): 총 ${count(merged)}개`);
}

let pushTimer = null;
function schedulePush() {
	if (!gistOn) return;
	clearTimeout(pushTimer);   // 솔브마다 때리지 않고 3초 모아서 한 번
	pushTimer = setTimeout(() => sync('저장').catch((e) => console.log('gist 동기화 실패:', e.message)), 3000);
}

// ── 서버 ─────────────────────────────────────────────────────────────────────
http.createServer((req, res) => {
	let rel;
	try {
		rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	} catch (e) {
		return json(res, 400, '{"error":"bad url"}');      // "/%" 같은 잘못된 인코딩에 죽지 않게
	}
	if (rel.indexOf('\0') !== -1) { res.writeHead(400).end(); return; }

	if (rel === '/data') {
		if (req.method === 'GET') {
			fs.readFile(dataFile, 'utf8', (err, d) => json(res, 200, err ? '{}' : d));
			return;
		}
		if (req.method === 'PUT') {
			let body = '';
			req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
			req.on('end', () => {
				try {
					const parsed = JSON.parse(body);
					if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw 0;
				} catch (e) { return json(res, 400, '{"error":"bad json"}'); }
				try { writeLocal(body); } catch (e) { return json(res, 500, '{"error":"write failed"}'); }
				schedulePush();
				json(res, 200, '{"ok":true}');
			});
			return;
		}
	}

	const file = path.join(root, rel === '/' ? 'index.html' : rel);
	if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }   // 형제 폴더(eh_timier-xxx)까지 막는다
	fs.readFile(file, (err, data) => {
		if (err) { res.writeHead(404).end('not found'); return; }
		res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
		res.end(data);
	});
}).listen(port, host, () => {
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
		// 시작할 때 원격 기록을 먼저 합쳐온다 → 다른 기기에서 한 솔브가 바로 보인다
		sync('시작').catch((e) => console.log('gist 동기화 실패 — 로컬 파일만 사용:', e.message));
	}
});
