'use strict';

const EVENTS = [
	{ id: '333', name: '3x3', scr: '333', len: 0 },
	{ id: '222', name: '2x2', scr: '222so', len: 0 },
	{ id: '444', name: '4x4', scr: '444wca', len: 0 },
	{ id: '555', name: '5x5', scr: '555wca', len: 60 },
	{ id: '666', name: '6x6', scr: '666wca', len: 80 },
	{ id: '777', name: '7x7', scr: '777wca', len: 100 },
	{ id: '333oh', name: '3x3 OH', scr: '333', len: 0 },
	{ id: '333bld', name: '3x3 BLD', scr: '333ni', len: 0 }
];
const HOLD_MS = 300;          // 이 시간 이상 누르고 있어야 준비 완료 (INSPECT_MS 등은 stats.js)
const KEY = 'eh_timer_v1';

const $ = (id) => document.getElementById(id);
const el = {
	time: $('time'), scramble: $('scramble'), stats: $('stats'), times: $('times'),
	count: $('count'), status: $('status'), event: $('event'), session: $('session'), file: $('file'),
	addSession: $('addSession'), renSession: $('renSession'), delSession: $('delSession'),
	sfx: $('sfx'), bgm: $('bgm')
};

// ── storage ──────────────────────────────────────────────────────────────────
// 서버가 있으면 solves.json 이 원본, localStorage 는 백업.
// 서버 없이 열면(file://) localStorage 만 쓴다.
let db = normalize({});
let onServer = false;

try {
	const raw = JSON.parse(localStorage.getItem(KEY));
	if (raw) db = normalize(raw);
} catch (e) {
	db = normalize({});
}

let ev = EVENTS.find(e => e.id === db.currentEvent) || EVENTS[0];

const currentEventData = () => db.events[ev.id] || (db.events[ev.id] = { active: 's_1', sessions: { s_1: { id: 's_1', name: 'session 1', solves: [], updatedAt: 0, clearedAt: 0, deleted: [] } }, deletedSessions: [] });
const currentSession = () => {
	const ed = currentEventData();
	return ed.sessions[ed.active] || (ed.sessions[ed.active] = { id: ed.active, name: 'session 1', solves: [], updatedAt: 0, clearedAt: 0, deleted: [] });
};

const solves = () => currentSession().solves;

// 밖에서 들어온 JSON(가져오기, gist)은 믿지 않는다. 아는 종목·성한 값만 통과시킨다.
const KNOWN = new Set(EVENTS.map((e) => e.id));
function clean(data) {
	const norm = normalize(data);
	const out = { version: 2, currentEvent: norm.currentEvent, events: {} };
	for (const [evId, evData] of Object.entries(norm.events)) {
		if (!KNOWN.has(evId) || !evData || typeof evData !== 'object') continue;
		const sessions = {};
		if (evData.sessions && typeof evData.sessions === 'object') {
			for (const [sId, s] of Object.entries(evData.sessions)) {
				if (!s || typeof s !== 'object') continue;
				const cleanSolves = (Array.isArray(s.solves) ? s.solves : [])
					.filter((x) => x && typeof x === 'object' && typeof x.ms === 'number' && isFinite(x.ms) && x.ms >= 0 && typeof x.ts === 'number' && isFinite(x.ts))
					.map((x) => ({ ms: x.ms, p: x.p === 2 || x.p === -1 ? x.p : 0, scr: typeof x.scr === 'string' ? x.scr.slice(0, 1000) : '', ts: x.ts }));
				sessions[sId] = {
					id: String(s.id || sId),
					name: String(s.name || 'session 1').slice(0, 50),
					solves: cleanSolves,
					updatedAt: typeof s.updatedAt === 'number' && isFinite(s.updatedAt) ? s.updatedAt : 0,
					clearedAt: typeof s.clearedAt === 'number' && isFinite(s.clearedAt) ? s.clearedAt : 0,
					deleted: Array.isArray(s.deleted) ? s.deleted.filter(t => typeof t === 'number' && isFinite(t)).slice(-500) : []
				};
			}
		}
		if (Object.keys(sessions).length === 0) {
			sessions['s_1'] = { id: 's_1', name: 'session 1', solves: [], updatedAt: 0, clearedAt: 0, deleted: [] };
		}
		const active = (evData.active && sessions[evData.active]) ? evData.active : Object.keys(sessions)[0];
		const deletedSessions = Array.isArray(evData.deletedSessions) ? evData.deletedSessions.filter(x => typeof x === 'string').slice(-100) : [];
		out.events[evId] = { active, sessions, deletedSessions };
	}
	return out;
}

async function load() {
	let file;
	try { file = await (await fetch('data')).json(); } catch (e) { return; }   // 서버 없음 → localStorage 모드
	onServer = true;
	const norm = normalize(file);
	if (countSolves(norm) === 0 && countSolves(db) > 0) { save(); return; }    // 첫 실행: localStorage 기록을 파일로 이관
	db = norm;
	ev = EVENTS.find(e => e.id === db.currentEvent) || EVENTS[0];
}

let queue = Promise.resolve();
function save() {
	db.currentEvent = ev.id;
	localStorage.setItem(KEY, JSON.stringify(db));   // 서버를 쓰더라도 백업으로 남겨둔다
	if (!onServer) { schedulePush(); return; }       // 서버가 없으면 브라우저가 직접 gist로
	const body = JSON.stringify(db);
	// 순서 보장: 예전 내용이 나중에 도착해서 최신 기록을 덮는 일이 없게 직렬로 보낸다
	queue = queue.then(() => fetch('data', { method: 'PUT', body: body }))
		.then((r) => { if (!r.ok) throw 0; el.status.textContent = ''; })
		.catch(() => { el.status.textContent = '저장 실패 — 기록은 브라우저에만 있음'; });
}

// ── gist 동기화 (서버 없이 태블릿에서 쓸 때) ────────────────────────────────
// 서버가 있으면 server.js가 하므로 브라우저는 관여하지 않는다.
const GKEY = KEY + '_gist';
const GIST_API = 'https://api.github.com/gists/';
let gist = null;
try { gist = JSON.parse(localStorage.getItem(GKEY)) || null; } catch (e) { gist = null; }

function ghHeaders(etag) {
	const h = {
		Authorization: 'Bearer ' + gist.token,
		Accept: 'application/vnd.github+json',
		'Content-Type': 'application/json'
	};
	if (etag) h['If-None-Match'] = etag;
	return h;
}

let lastEtag = null;
let lastGistDataStr = '';
let rateLimitResetAt = 0; // Epoch ms

function checkRateLimitHeaders(r) {
	const remaining = r.headers.get('x-ratelimit-remaining');
	const reset = r.headers.get('x-ratelimit-reset');
	const retryAfter = r.headers.get('retry-after');

	if (remaining === '0' || r.status === 429 || (r.status === 403 && remaining === '0')) {
		if (reset) {
			rateLimitResetAt = Number(reset) * 1000;
		} else if (retryAfter) {
			rateLimitResetAt = Date.now() + Number(retryAfter) * 1000;
		} else {
			rateLimitResetAt = Date.now() + 60000;
		}
		const mins = Math.max(1, Math.ceil((rateLimitResetAt - Date.now()) / 60000));
		const timeStr = new Date(rateLimitResetAt).toLocaleTimeString();
		throw new Error(`API 요청 한도 초과: 약 ${mins}분 뒤(${timeStr})에 자동 리셋됩니다.`);
	} else if (r.ok || r.status === 304) {
		rateLimitResetAt = 0; // 정상이면 한도 락 해제
	}
}

async function gistRead() {
	if (rateLimitResetAt > Date.now()) {
		const mins = Math.ceil((rateLimitResetAt - Date.now()) / 60000);
		throw new Error(`API 한도 보호 중: ${mins}분 뒤에 재시도합니다.`);
	}

	const r = await fetch(GIST_API + gist.id, { headers: ghHeaders(lastEtag), signal: AbortSignal.timeout(15000) });
	checkRateLimitHeaders(r);

	// 304 Not Modified: 내용이 전혀 바뀌지 않았으므로 캐시된 데이터를 그대로 사용 (API 쿼터 절약)
	if (r.status === 304 && lastGistDataStr) {
		return clean(JSON.parse(lastGistDataStr));
	}

	if (!r.ok) {
		let detail = '';
		try { const err = await r.json(); detail = err.message ? ` (${err.message})` : ''; } catch (e) {}
		if (r.status === 404) throw new Error('Gist를 찾을 수 없습니다. Gist ID를 확인하세요' + detail);
		if (r.status === 401) throw new Error('토큰 인증 실패 (토큰 확인)' + detail);
		if (r.status === 403) throw new Error(`읽기 실패 HTTP 403: 토큰 권한 부족 또는 일시적 차단${detail}`);
		throw new Error('HTTP ' + r.status + detail);
	}

	lastEtag = r.headers.get('etag') || lastEtag;
	const f = (await r.json()).files['solves.json'];
	if (!f) return {};
	const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;   // 1MB 넘으면 잘려서 옴
	lastGistDataStr = text || '{}';
	return clean(JSON.parse(lastGistDataStr));
}

async function gistWrite(data) {
	const newStr = JSON.stringify(data);
	// 로컬과 원격이 완벽히 동일하면 불필요한 PATCH 요청을 생략하여 쿼터 50% 절약
	if (lastGistDataStr && newStr === lastGistDataStr) {
		return;
	}

	if (rateLimitResetAt > Date.now()) {
		const mins = Math.ceil((rateLimitResetAt - Date.now()) / 60000);
		throw new Error(`API 한도 보호 중: ${mins}분 뒤에 재시도합니다.`);
	}

	const r = await fetch(GIST_API + gist.id, {
		method: 'PATCH', headers: ghHeaders(), signal: AbortSignal.timeout(15000),
		body: JSON.stringify({ files: { 'solves.json': { content: newStr } } })
	});
	checkRateLimitHeaders(r);

	if (!r.ok) {
		let detail = '';
		try { const err = await r.json(); detail = err.message ? ` (${err.message})` : ''; } catch (e) {}
		if (r.status === 403) {
			throw new Error(`쓰기 실패 HTTP 403: 토큰에 'gist' 권한이 없거나 Gist 소유자가 아닙니다${detail}`);
		}
		if (r.status === 404) throw new Error('Gist를 찾을 수 없습니다. Gist ID를 확인하세요' + detail);
		if (r.status === 401) throw new Error('토큰이 올바르지 않거나 만료되었습니다' + detail);
		throw new Error('쓰기 실패 HTTP ' + r.status + detail);
	}

	lastEtag = r.headers.get('etag') || lastEtag;
	lastGistDataStr = newStr;
}

// 항상 원격과 합쳐서 올린다. 다른 기기가 먼저 올린 기록을 덮지 않기 위함.
// 겹쳐 실행되면 읽기/쓰기가 엇갈릴 수 있으므로 한 번에 하나씩 직렬로 돈다.
let syncing = Promise.resolve();
let isSyncing = false;
function gistSync() {
	if (!gist || onServer) return Promise.resolve();
	if (isSyncing) {
		schedulePush(); // 이미 동기화 중이면 5초 뒤에 다시 묶어서 요청
		return syncing;
	}
	isSyncing = true;
	syncing = syncing.catch(() => {}).then(async () => {
		el.status.textContent = '동기화 중…';
		try {
			const keepEvent = ev.id;          // 사용자가 보고 있는 종목을 기억
			const remoteData = await gistRead();
			db = merge(db, remoteData);
			db.currentEvent = keepEvent;       // 동기화가 사용자의 종목 선택을 바꾸지 않게
			ev = EVENTS.find(e => e.id === keepEvent) || EVENTS[0];
			localStorage.setItem(KEY, JSON.stringify(db));
			await gistWrite(db);
			el.status.textContent = '';
			render();
		} catch (e) {
			console.error('gistSync 실패:', e);
			el.status.textContent = '동기화 실패: ' + (e.message || e) + ' — 기록은 이 기기에 저장됨';
			throw e;
		} finally {
			isSyncing = false;
		}
	});
	return syncing;
}
let pushTimer = 0;
function schedulePush() {
	if (!gist || onServer) return;
	clearTimeout(pushTimer);      // 여러 번 변경되어도 5초 모아서 딱 한 번만 동기화
	pushTimer = setTimeout(() => gistSync().catch(() => {}), 5000);
}

// ── fallback scrambler (워커 오류/지연 시 비상용 메인스레드 생성기) ───────────
function fallbackScramble(event) {
	const evId = (event && event.id) || '333';
	const moves333 = ["R", "R'", "R2", "L", "L'", "L2", "U", "U'", "U2", "D", "D'", "D2", "F", "F'", "F2", "B", "B'", "B2"];
	const moves222 = ["R", "R'", "R2", "U", "U'", "U2", "F", "F'", "F2"];
	const moves444 = ["R", "R'", "R2", "L", "L'", "L2", "U", "U'", "U2", "D", "D'", "D2", "F", "F'", "F2", "B", "B'", "B2", "Rw", "Rw'", "Rw2", "Fw", "Fw'", "Fw2", "Uw", "Uw'", "Uw2"];
	const movesBig = ["R", "R'", "R2", "L", "L'", "L2", "U", "U'", "U2", "D", "D'", "D2", "F", "F'", "F2", "B", "B'", "B2", "Rw", "Rw'", "Rw2", "Lw", "Lw'", "Lw2", "Uw", "Uw'", "Uw2", "Dw", "Dw'", "Dw2", "Fw", "Fw'", "Fw2", "Bw", "Bw'", "Bw2"];

	let list = moves333, len = 20;
	if (evId === '222') { list = moves222; len = 9; }
	else if (evId === '444') { list = moves444; len = 40; }
	else if (evId === '555') { list = movesBig; len = 60; }
	else if (evId === '666') { list = movesBig; len = 80; }
	else if (evId === '777') { list = movesBig; len = 100; }

	const res = [];
	let lastAxis = -1;
	const axisMap = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };

	while (res.length < len) {
		const m = list[Math.floor(Math.random() * list.length)];
		const axis = axisMap[m[0]] !== undefined ? axisMap[m[0]] : Math.random();
		if (axis !== lastAxis) {
			res.push(m);
			lastAxis = axis;
		}
	}
	return res.join(' ');
}

// ── scramble worker ──────────────────────────────────────────────────────────
let worker = null;
try {
	worker = new Worker('scramble-worker.js');
} catch (e) {
	console.warn('Web Worker 초기화 불가, 메인스레드 폴백 사용:', e);
}

const pending = {};
let msgid = 0;

if (worker) {
	worker.onmessage = (e) => {
		const id = e.data && e.data[0];
		const cb = pending[id];
		if (cb) {
			delete pending[id];
			const res = e.data[1];
			if (!res || typeof res !== 'string' || res.startsWith('unknown')) {
				cb(fallbackScramble(ev));
			} else {
				cb(res);
			}
		}
	};
	worker.onerror = (e) => {
		console.error('스크램블 워커 에러:', e);
		for (const id of Object.keys(pending)) {
			const cb = pending[id];
			delete pending[id];
			cb && cb(fallbackScramble(ev));
		}
	};
}

function generate(event) {
	const target = event || ev;
	if (!worker) {
		return Promise.resolve(fallbackScramble(target));
	}
	return new Promise((res) => {
		const id = ++msgid;
		pending[id] = res;
		// 1.5초 내에 워커 응답이 없으면 멈춤 방지를 위해 즉시 폴백 반환
		const timer = setTimeout(() => {
			if (pending[id]) {
				delete pending[id];
				res(fallbackScramble(target));
			}
		}, 1500);

		try {
			const len = target.len || (target.id === '555' ? 60 : target.id === '666' ? 80 : target.id === '777' ? 100 : 0);
			worker.postMessage([id, target.scr, len]);
		} catch (e) {
			clearTimeout(timer);
			delete pending[id];
			res(fallbackScramble(target));
		}
	});
}

let scramble = '', next = null;
async function nextScramble() {
	const want = ev;
	const p = next || generate(want);
	next = null;
	el.status.textContent = '스크램블 생성 중…';
	try {
		const s = await p;
		if (ev !== want) return;               // 종목이 바뀌었으면 버림
		scramble = s || fallbackScramble(want);
		el.scramble.textContent = scramble;
		el.status.textContent = '';
	} catch (e) {
		scramble = fallbackScramble(want);
		el.scramble.textContent = scramble;
		el.status.textContent = '';
	}
	try {
		next = generate(want);                 // 미리 뽑아둬서 다음 솔브 때 안 기다리게
	} catch (e) {
		next = null;
	}
}

// ── stats (final/fmt/average 는 stats.js) ────────────────────────────────────
function ao(n) {
	const all = solves();
	return all.length < n ? NaN : average(all.slice(-n));
}
let lastStatsHtml = '';
let lastCountText = '';
function renderStats() {
	const all = solves();
	const ok = all.map(final).filter(isFinite);
	const mean = all.length && ok.length === all.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN;
	const best = ok.length ? ok.reduce((m, x) => (x < m ? x : m), Infinity) : NaN;
	const tiles = [['best', best], ['avg', mean], ['ao5', ao(5)], ['ao12', ao(12)]];
	const html = tiles.map(([k, v]) =>
		`<div class="stat"><span>${k}</span><b>${isNaN(v) ? '–' : fmt(v)}</b></div>`).join('');
	if (html !== lastStatsHtml) {
		el.stats.innerHTML = html;
		lastStatsHtml = html;
	}
	const countText = all.length + ' solves';
	if (countText !== lastCountText) {
		el.count.textContent = countText;
		lastCountText = countText;
	}
}

// 가져오기로 들어온 남의 JSON이 HTML로 실행되지 않게
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
	(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderTimes() {
	const all = solves();
	el.times.innerHTML = all.map((s, i) =>
		`<div class="solve${s.p === -1 ? ' dnf' : ''}" data-i="${i}" title="${esc(s.scr)}">
			<span class="idx">${i + 1}</span>
			<span class="t">${fmt(final(s))}${s.p === 2 ? '+' : ''}</span>
			<span class="acts">
				<button data-act="2" class="${s.p === 2 ? 'on' : ''}">+2</button>
				<button data-act="-1" class="${s.p === -1 ? 'on' : ''}">DNF</button>
				<button data-act="x">×</button>
			</span>
		</div>`).reverse().join('');
}

let lastSessionsHtml = '';
function renderSessions() {
	const ed = currentEventData();
	const sessionList = Object.values(ed.sessions);
	const html = sessionList.map(s =>
		`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
	if (html !== lastSessionsHtml) {
		el.session.innerHTML = html;
		lastSessionsHtml = html;
	}
	el.session.value = ed.active;
	el.event.value = ev.id;
}

const CUBE_CYCLES = {
	'222': '4.0s',
	'333': '6.0s',
	'333oh': '6.0s',
	'333bld': '6.0s',
	'444': '8.1s',
	'555': '10.3s',
	'666': '12.6s',
	'777': '14.8s'
};

function getCubeN(eventId) {
	if (eventId === '222') return 2;
	if (eventId === '444') return 4;
	if (eventId === '555') return 5;
	if (eventId === '666') return 6;
	if (eventId === '777') return 7;
	return 3;
}

let currentRenderedN = 0;

function updateStageCube() {
	const n = getCubeN(ev.id);
	if (currentRenderedN === n) return;
	currentRenderedN = n;

	const wrap = document.querySelector('.stage-cube-wrap');
	if (wrap) {
		wrap.className = 'stage-cube-wrap cube-grid-' + n;
	}

	const box = document.querySelector('.stage-cube-wrap .cube-anim-box');
	if (!box) return;

	const faces = [
		{ cls: 'cube-front',  c: 'b' },
		{ cls: 'cube-back',   c: 'g' },
		{ cls: 'cube-right',  c: 'r' },
		{ cls: 'cube-left',   c: 'o' },
		{ cls: 'cube-top',    c: 'w' },
		{ cls: 'cube-bottom', c: 'y' }
	];

	let html = `<div class="cube-3d cube-nxn">`;
	for (const f of faces) {
		html += `<div class="cube-face ${f.cls} grid-${n}">`;
		for (let r = 0; r < n; r++) {
			for (let c = 0; c < n; c++) {
				let phase;
				const isCorner = (r === 0 || r === n - 1) && (c === 0 || c === n - 1);
				const isEdge = (r === 0 || r === n - 1 || c === 0 || c === n - 1);
				if (n === 2) {
					const idx = r * 2 + c;
					phase = (idx + 1);
				} else if (isCorner) {
					phase = 4;
				} else if (isEdge) {
					phase = ((r + c) % 2 === 0) ? 3 : 2;
				} else {
					phase = 1;
				}
				html += `<span class="c-sticker cs-${f.c}-p${phase}"></span>`;
			}
		}
		html += `</div>`;
	}
	html += `</div>`;
	box.innerHTML = html;
}

function render() {
	updateStageCube();
	renderSessions();
	renderStats();
	renderTimes();
}

el.times.onclick = (e) => {
	const btn = e.target.closest('button'), row = e.target.closest('.solve');
	if (!btn || !row) return;
	const i = +row.dataset.i, act = btn.dataset.act;
	const curr = currentSession();
	if (act === 'x') {
		const del = curr.solves.splice(i, 1)[0];
		if (del && del.ts) {
			curr.deleted = (curr.deleted || []).concat(del.ts);
		}
	} else {
		curr.solves[i].p = curr.solves[i].p === +act ? 0 : +act;
	}
	save(); render();
};

// ── Web Audio Synthesizer (SFX & Ambient Focus BGM) ──────────────────────────
let audioCtx = null;
function getAudioCtx() {
	if (!audioCtx) {
		const AudioContextClass = window.AudioContext || window.webkitAudioContext;
		if (AudioContextClass) {
			audioCtx = new AudioContextClass();
		}
	}
	if (audioCtx && audioCtx.state === 'suspended') {
		audioCtx.resume();
	}
	return audioCtx;
}

let sfxOn = localStorage.getItem('eh_timer_sfx') !== '0'; // 기본값: 켜짐(1)
let bgmOn = localStorage.getItem('eh_timer_bgm') === '1'; // 기본값: 꺼짐(0)

function updateAudioUI() {
	if (el.sfx) {
		el.sfx.classList.toggle('on', sfxOn);
		const icon = el.sfx.querySelector('.btn-icon');
		if (icon) icon.textContent = sfxOn ? '🔊' : '🔈';
	}
	if (el.bgm) {
		el.bgm.classList.toggle('on', bgmOn);
	}
}

// 1. Ready Sound: 스택매트 준비 완료 (Green) - 청량하고 정갈한 상승 2화음 핑
function playReadySound() {
	if (!sfxOn) return;
	const ctx = getAudioCtx();
	if (!ctx) return;
	const now = ctx.currentTime;
	
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = 'sine';
	osc.frequency.setValueAtTime(587.33, now); // D5
	osc.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5
	
	gain.gain.setValueAtTime(0, now);
	gain.gain.linearRampToValueAtTime(0.18, now + 0.015);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
	
	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.start(now);
	osc.stop(now + 0.25);
}

// 2. Start Sound: 출발음 - 경쾌하고 빠른 미니 릴리즈 클릭
function playStartSound() {
	if (!sfxOn) return;
	const ctx = getAudioCtx();
	if (!ctx) return;
	const now = ctx.currentTime;
	
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = 'triangle';
	osc.frequency.setValueAtTime(1046.5, now);
	osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.04);
	
	gain.gain.setValueAtTime(0.12, now);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
	
	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.start(now);
	osc.stop(now + 0.06);
}

// 3. Stop Sound: 솔빙 완료 및 PB(최고기록) 축하 차임
function playStopSound(isPB) {
	if (!sfxOn) return;
	const ctx = getAudioCtx();
	if (!ctx) return;
	const now = ctx.currentTime;
	
	if (isPB) {
		// 🌟 신기록(PB) 달성: 찬란하고 화려한 아르페지오 승리 차임 (C5, E5, G5, B5, C6, E6)
		const notes = [523.25, 659.25, 783.99, 987.77, 1046.50, 1318.51];
		notes.forEach((freq, i) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = i % 2 === 0 ? 'sine' : 'triangle';
			osc.frequency.setValueAtTime(freq, now + i * 0.06);
			
			gain.gain.setValueAtTime(0, now + i * 0.06);
			gain.gain.linearRampToValueAtTime(0.16, now + i * 0.06 + 0.015);
			gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.7);
			
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(now + i * 0.06);
			osc.stop(now + i * 0.06 + 0.75);
		});
	} else {
		// 🎯 일반 솔빙 완료: 깔끔하고 안정감 넘치는 메이저 9 화음 차임
		const chord = [523.25, 659.25, 783.99, 1046.50];
		chord.forEach((freq, idx) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(freq, now + idx * 0.025);
			
			gain.gain.setValueAtTime(0, now + idx * 0.025);
			gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.025 + 0.015);
			gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.025 + 0.65);
			
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(now + idx * 0.025);
			osc.stop(now + idx * 0.025 + 0.7);
		});
	}
}

// 4. Inspection 경고음: WCA 규정 8초 / 12초 알림음
function playInspectWarning(type) {
	if (!sfxOn) return;
	const ctx = getAudioCtx();
	if (!ctx) return;
	const now = ctx.currentTime;
	
	if (type === 8) {
		// 8초 알림음 (A5 중간 톤 알림)
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(880, now);
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start(now);
		osc.stop(now + 0.22);
	} else if (type === 12) {
		// 12초 알림음 (D6 2연속 빠른 비프)
		[0, 0.12].forEach((offset) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'triangle';
			osc.frequency.setValueAtTime(1174.66, now + offset);
			gain.gain.setValueAtTime(0, now + offset);
			gain.gain.linearRampToValueAtTime(0.16, now + offset + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.1);
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(now + offset);
			osc.stop(now + offset + 0.12);
		});
	}
}

// 5. Click Sound: 버튼 조작 틱 사운드
function playClickSound() {
	if (!sfxOn) return;
	const ctx = getAudioCtx();
	if (!ctx) return;
	const now = ctx.currentTime;
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = 'sine';
	osc.frequency.setValueAtTime(700, now);
	osc.frequency.exponentialRampToValueAtTime(300, now + 0.02);
	gain.gain.setValueAtTime(0.06, now);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.start(now);
	osc.stop(now + 0.03);
}

// ── Soul Cafe 감성 카페 팝 BGM 합성기 (YouTube yx7QlKMU324 감성 기반) ──────
let bgmMode = localStorage.getItem('eh_timer_bgm_mode') || 'synth'; // 'synth' | 'yt'
let bgmNodes = null;
let bgmSeqTimer = 0;
let bgmStep = 0;
let bgmChordIdx = 0;

// 감성 카페 팝 시그니처 4코드 진행 (Fmaj7 - G7 - Em7 - Am7)
const CAFE_PROGRESSION = [
	{ bass: 87.31, chord: [174.61, 261.63, 329.63, 440.00] }, // Fmaj7 (F2 bass, F3, C4, E4, A4)
	{ bass: 98.00, chord: [196.00, 246.94, 293.66, 349.23] }, // G7 (G2 bass, G3, B3, D4, F4)
	{ bass: 82.41, chord: [164.81, 196.00, 246.94, 293.66] }, // Em7 (E2 bass, E3, G3, B3, D4)
	{ bass: 110.00, chord: [220.00, 261.63, 329.63, 392.00] } // Am7 (A2 bass, A3, C4, E4, G4)
];

// Rhodes Electric Piano 노트 합성
function playEPNote(ctx, dest, freq, time, duration, velocity = 0.5) {
	try {
		const osc1 = ctx.createOscillator();
		const gain1 = ctx.createGain();
		osc1.type = 'sine';
		osc1.frequency.setValueAtTime(freq, time);

		const osc2 = ctx.createOscillator();
		const gain2 = ctx.createGain();
		osc2.type = 'sine';
		osc2.frequency.setValueAtTime(freq * 2, time);

		const osc3 = ctx.createOscillator();
		const gain3 = ctx.createGain();
		osc3.type = 'sine';
		osc3.frequency.setValueAtTime(freq * 3.5, time);

		const noteGain = ctx.createGain();
		noteGain.gain.setValueAtTime(0, time);
		noteGain.gain.linearRampToValueAtTime(velocity * 0.12, time + 0.006);
		noteGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

		gain1.gain.setValueAtTime(0.75, time);
		gain2.gain.setValueAtTime(0.25, time);
		gain3.gain.setValueAtTime(0.2, time);
		gain3.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

		osc1.connect(gain1);
		osc2.connect(gain2);
		osc3.connect(gain3);
		gain1.connect(noteGain);
		gain2.connect(noteGain);
		gain3.connect(noteGain);
		noteGain.connect(dest);

		osc1.start(time); osc2.start(time); osc3.start(time);
		osc1.stop(time + duration + 0.05);
		osc2.stop(time + duration + 0.05);
		osc3.stop(time + duration + 0.05);
	} catch (e) {}
}

// 멜로우 어쿠스틱 베이스
function playBassNote(ctx, dest, freq, time, duration, velocity = 0.6) {
	try {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = 'triangle';
		osc.frequency.setValueAtTime(freq, time);

		gain.gain.setValueAtTime(0, time);
		gain.gain.linearRampToValueAtTime(velocity * 0.16, time + 0.015);
		gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

		osc.connect(gain);
		gain.connect(dest);
		osc.start(time);
		osc.stop(time + duration + 0.05);
	} catch (e) {}
}

// 소프트 칠 비트 (Kick / Snare)
function playChillBeat(ctx, dest, type, time, velocity = 0.3) {
	try {
		if (type === 'kick') {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(110, time);
			osc.frequency.exponentialRampToValueAtTime(45, time + 0.08);
			gain.gain.setValueAtTime(velocity * 0.14, time);
			gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
			osc.connect(gain);
			gain.connect(dest);
			osc.start(time);
			osc.stop(time + 0.12);
		} else if (type === 'snare') {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'triangle';
			osc.frequency.setValueAtTime(240, time);
			gain.gain.setValueAtTime(velocity * 0.09, time);
			gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
			osc.connect(gain);
			gain.connect(dest);
			osc.start(time);
			osc.stop(time + 0.14);
		}
	} catch (e) {}
}

// 🎼 타이머 각 동작(State)에 맞춰 배경음 주파수/볼륨/무드를 실시간 전환
function setBGMState(newState) {
	if (!bgmNodes || !bgmOn) return;
	const ctx = getAudioCtx();
	if (!ctx) return;
	const now = ctx.currentTime;

	if (newState === 'hold' || newState === 'ready') {
		// 🌊 집중 다이빙 (Focus Underwater Ducking): 320Hz 로우패스 필터로 닫히며 잡념 소거
		bgmNodes.masterFilter.frequency.setTargetAtTime(320, now, 0.08);
		bgmNodes.masterGain.gain.setTargetAtTime(0.035, now, 0.08);
	} else if (newState === 'inspect') {
		// ⏱️ 인스펙션 모드: 15초 관찰 집중
		bgmNodes.masterFilter.frequency.setTargetAtTime(950, now, 0.15);
		bgmNodes.masterGain.gain.setTargetAtTime(0.06, now, 0.15);
	} else if (newState === 'running') {
		// ⚡ 솔빙 몰입 펄스 (Flow-State Groove): 스피드큐빙 템포에 맞춘 리드미컬 필터
		bgmNodes.masterFilter.frequency.setTargetAtTime(1600, now, 0.2);
		bgmNodes.masterGain.gain.setTargetAtTime(0.075, now, 0.2);
	} else if (newState === 'just-solved') {
		// 🌟 완성 축하 블룸 (Bloom): 필터가 3200Hz로 활짝 열리며 화려한 메이저 여운
		bgmNodes.masterFilter.frequency.setTargetAtTime(3200, now, 0.05);
		bgmNodes.masterGain.gain.setTargetAtTime(0.09, now, 0.05);
		setTimeout(() => {
			if (state === 'idle' && bgmNodes) {
				const currNow = ctx.currentTime;
				bgmNodes.masterFilter.frequency.setTargetAtTime(2200, currNow, 0.8);
				bgmNodes.masterGain.gain.setTargetAtTime(0.07, currNow, 0.8);
			}
		}, 1800);
	} else {
		// ☕ 기본 대기(idle): 감성 카페 팝 2200Hz 풀 스펙트럼
		bgmNodes.masterFilter.frequency.setTargetAtTime(2200, now, 0.4);
		bgmNodes.masterGain.gain.setTargetAtTime(0.07, now, 0.4);
	}
}

function startBGM() {
	if (!bgmOn) return;
	if (bgmMode === 'yt') {
		const yt = $('ytPlayer');
		if (yt) {
			yt.src = 'https://www.youtube-nocookie.com/embed/yx7QlKMU324?autoplay=1&enablejsapi=1&loop=1&playlist=yx7QlKMU324';
		}
		return;
	}

	const ctx = getAudioCtx();
	if (!ctx || bgmNodes) return;

	try {
		const masterGain = ctx.createGain();
		masterGain.gain.setValueAtTime(0, ctx.currentTime);
		masterGain.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 1.5);

		const masterFilter = ctx.createBiquadFilter();
		masterFilter.type = 'lowpass';
		masterFilter.frequency.setValueAtTime(2200, ctx.currentTime);
		masterFilter.Q.setValueAtTime(1.0, ctx.currentTime);

		// 따뜻한 앰비언트 서브 패드 (C3, G3 - 배경을 은은하게 채워주는 베이스 드론)
		const freqs = [130.81, 196.00];
		const subOscs = freqs.map((f) => {
			const o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.setValueAtTime(f, ctx.currentTime);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.03, ctx.currentTime);
			o.connect(g);
			g.connect(masterFilter);
			o.start();
			return o;
		});

		masterFilter.connect(masterGain);
		masterGain.connect(ctx.destination);

		bgmNodes = { masterGain, masterFilter, subOscs };
		bgmStep = 0;
		bgmChordIdx = 0;

		// 76 BPM 감성 카페 팝 시퀀서 루프 (1 스텝 = 0.395초)
		const stepInterval = 395;
		clearInterval(bgmSeqTimer);
		bgmSeqTimer = setInterval(() => {
			if (!bgmNodes || !bgmOn) return;
			const audioNow = ctx.currentTime;
			const currChord = CAFE_PROGRESSION[bgmChordIdx];

			// Step 0: 마디 시작 (Bass + EP Chord + Kick)
			if (bgmStep === 0) {
				playBassNote(ctx, masterFilter, currChord.bass, audioNow, 0.7, 0.7);
				currChord.chord.forEach((note, idx) => {
					playEPNote(ctx, masterFilter, note, audioNow + idx * 0.015, 1.2, 0.55);
				});
				if (state !== 'hold' && state !== 'ready') playChillBeat(ctx, masterFilter, 'kick', audioNow, 0.35);
			}
			// Step 2: 엇박 컴핑
			else if (bgmStep === 2) {
				if (state === 'idle' || state === 'running') {
					playEPNote(ctx, masterFilter, currChord.chord[1], audioNow, 0.5, 0.4);
					playEPNote(ctx, masterFilter, currChord.chord[3], audioNow + 0.02, 0.5, 0.35);
				}
			}
			// Step 4: 3박 (Bass + Snare)
			else if (bgmStep === 4) {
				playBassNote(ctx, masterFilter, currChord.bass, audioNow, 0.6, 0.5);
				currChord.chord.forEach((note, idx) => {
					playEPNote(ctx, masterFilter, note, audioNow + idx * 0.01, 0.9, 0.45);
				});
				if (state !== 'hold' && state !== 'ready') playChillBeat(ctx, masterFilter, 'snare', audioNow, 0.3);
			}
			// Step 6: 멜로디 장식음 (Embellishment)
			else if (bgmStep === 6) {
				if (state === 'idle' || state === 'running') {
					const melodyNote = currChord.chord[2] * 1.5;
					playEPNote(ctx, masterFilter, melodyNote, audioNow, 0.6, 0.3);
				}
			}

			bgmStep = (bgmStep + 1) % 8;
			if (bgmStep === 0) {
				bgmChordIdx = (bgmChordIdx + 1) % CAFE_PROGRESSION.length;
			}
		}, stepInterval);

	} catch (e) {
		bgmNodes = null;
	}
}

function stopBGM() {
	const yt = $('ytPlayer');
	if (yt) yt.src = '';
	clearInterval(bgmSeqTimer);
	if (!bgmNodes) return;
	const ctx = getAudioCtx();
	if (ctx && bgmNodes.masterGain) {
		try {
			bgmNodes.masterGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
			const oldNodes = bgmNodes;
			bgmNodes = null;
			setTimeout(() => {
				if (oldNodes) {
					oldNodes.subOscs.forEach(o => { try { o.stop(); o.disconnect(); } catch (e) {} });
				}
			}, 900);
		} catch (e) {
			bgmNodes = null;
		}
	} else {
		bgmNodes = null;
	}
}

// ── timer ────────────────────────────────────────────────────────────────────
let state = 'idle';              // idle | inspect | hold | ready | running
let startAt = 0, holdTimer = 0, raf = 0, holdBack = 'idle';
let inspAt = 0, penalty = 0;
let inspOn = localStorage.getItem(KEY + '_insp') === '1';
let inspWarned8 = false, inspWarned12 = false;

function setState(s) {
	state = s;
	document.body.className = ((inspAt ? 'inspect ' : '') + (s === 'idle' || s === 'inspect' ? '' : s)).trim();
	setBGMState(s);
}

// 글자 수를 CSS에 알려줘서 폭에 맞는 최대 크기로 표시 (2:34.567 처럼 길어지면 자동으로 작아짐).
// 최소 6칸으로 잡아둬서 9.999 → 10.000 넘어갈 때 크기가 튀지 않는다.
let lastCh = -1;
function setTime(txt) {
	el.time.textContent = txt;
	const ch = Math.max(6, txt.length);
	if (ch !== lastCh) {
		el.time.style.setProperty('--ch', ch);
		lastCh = ch;
	}
}

function loop() {
	if (state === 'inspect') {
		const elapsed = performance.now() - inspAt;
		if (elapsed >= 8000 && !inspWarned8) {
			inspWarned8 = true;
			playInspectWarning(8);
		}
		if (elapsed >= 12000 && !inspWarned12) {
			inspWarned12 = true;
			playInspectWarning(12);
		}
	}
	setTime(state === 'running' ? fmt(performance.now() - startAt) : inspText(performance.now() - inspAt));
	raf = requestAnimationFrame(loop);
}

let solvedCelebrationTimer = 0;

function down() {
	if (state !== 'idle' && state !== 'inspect') return;
	getAudioCtx();
	document.body.classList.remove('just-solved');
	clearTimeout(solvedCelebrationTimer);
	const back = state;
	setState('hold');
	holdTimer = setTimeout(() => {
		setState('ready');
		playReadySound();
	}, HOLD_MS);
	holdBack = back;
}
function up() {
	clearTimeout(holdTimer);
	if (state === 'hold') { setState(holdBack); return; }   // 너무 짧게 눌렀음
	if (state !== 'ready') return;
	const now = performance.now();
	inspWarned8 = false;
	inspWarned12 = false;
	if (inspOn && !inspAt) {                                // 인스펙션 시작
		inspAt = now;
		setState('inspect');
		cancelAnimationFrame(raf); loop();
		return;
	}
	penalty = inspAt ? inspPenaltyOf(now - inspAt) : 0;     // 인스펙션 초과 시 WCA 페널티
	inspAt = 0;
	startAt = now;
	setState('running');
	playStartSound();
	cancelAnimationFrame(raf); loop();
}
function stop() {
	cancelAnimationFrame(raf);
	setState('idle');
	const now = performance.now();
	const ms = Math.max(0, now - startAt);
	setTime(fmt(ms) + (penalty === 2 ? '+' : penalty === -1 ? ' DNF' : ''));
	
	// 신기록(PB) 판정 후 사운드 재생
	const prevSolves = solves();
	const prevOk = prevSolves.map(final).filter(isFinite);
	const prevBest = prevOk.length ? prevOk.reduce((m, x) => (x < m ? x : m), Infinity) : Infinity;
	const currFinal = final({ ms, p: penalty });
	const isPB = isFinite(currFinal) && currFinal < prevBest && prevOk.length > 0;
	playStopSound(isPB);

	solves().push({ ms: ms, p: penalty, scr: scramble, ts: Date.now() });
	penalty = 0;
	save(); render();
	nextScramble();

	// 🏆 타이머 정지 시 100% 완성 쇼케이스 & 빅토리 쇼크웨이브 애니메이션 발동
	document.body.classList.add('just-solved');
	clearTimeout(solvedCelebrationTimer);
	solvedCelebrationTimer = setTimeout(() => {
		document.body.classList.remove('just-solved');
	}, 3800);
}
function cancel() {
	clearTimeout(holdTimer);
	clearTimeout(solvedCelebrationTimer);
	document.body.classList.remove('just-solved');
	cancelAnimationFrame(raf);
	inspAt = 0; penalty = 0;
	inspWarned8 = false;
	inspWarned12 = false;
	setState('idle');
	setTime(fmt(0));
	playClickSound();
}

document.addEventListener('keydown', (e) => {
	if (e.target.matches && e.target.matches('select, input, textarea')) return;
	if (document.querySelector('dialog[open]')) return; // 다이얼로그가 열려 있으면 타이머는 반응하지 않는다
	if (e.key === 'Escape') { cancel(); return; }
	if (state === 'running') { e.preventDefault(); stop(); return; }
	if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) down(); }
});
document.addEventListener('keyup', (e) => {
	if (document.querySelector('dialog[open]')) return;
	if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); up(); }
});

// ── 태블릿 / 모바일 롱프레스 팝업(뒤로/새로고침/공유/돋보기) 완전 차단 ─────────
window.addEventListener('contextmenu', (e) => {
	if (!e.target.closest('input, textarea, select')) {
		e.preventDefault();
		e.stopPropagation();
		return false;
	}
}, { capture: true, passive: false });

window.addEventListener('selectstart', (e) => {
	if (!e.target.closest('input, textarea, select')) e.preventDefault();
});

// 터치 이벤트: touchstart에서 preventDefault를 해야 모바일 브라우저의 기본 롱프레스 팝업이 차단된다
$('stage').addEventListener('touchstart', (e) => {
	e.preventDefault();
	state === 'running' ? stop() : down();
}, { passive: false });

document.addEventListener('touchend', (e) => {
	if (e.touches.length === 0 && (state === 'hold' || state === 'ready')) up();
}, { passive: false });

document.addEventListener('touchcancel', () => {
	if (state === 'hold' || state === 'ready') cancel();
}, { passive: false });

// 마우스 / 스타일러스 클릭 지원 (터치는 touchstart/touchend 에서 전담)
$('stage').addEventListener('pointerdown', (e) => {
	if (e.pointerType === 'touch') return;
	e.preventDefault();
	state === 'running' ? stop() : down();
});
document.addEventListener('pointerdown', (e) => {
	if (e.pointerType === 'touch') return;
	if (state === 'running') stop();
});
document.addEventListener('pointerup', (e) => {
	if (e.pointerType === 'touch') return;
	if (state === 'hold' || state === 'ready') up();
});

// 서비스 워커 등록은 index.html 인라인 스크립트에서 처리 (구버전 캐시 문제 방지)

// 태블릿/폰: 솔브 중에 화면이 꺼지지 않게 (지원 안 하는 브라우저면 조용히 무시)
async function keepAwake() {
	try { await navigator.wakeLock.request('screen'); } catch (e) { /* 미지원 */ }
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && keepAwake());
keepAwake();

// ── controls ─────────────────────────────────────────────────────────────────
// 버튼에 포커스가 남으면 스페이스가 그 버튼을 다시 누르게 되므로 해제
document.addEventListener('click', (e) => { const b = e.target.closest('button'); b && b.blur(); });

// 종목 드롭다운 초기화 및 변경
el.event.innerHTML = EVENTS.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
el.event.value = ev.id;
el.event.onchange = () => {
	ev = EVENTS.find(e => e.id === el.event.value) || EVENTS[0];
	db.currentEvent = ev.id;
	next = null;
	save(); render(); nextScramble();
	el.event.blur();
};

// 세션 변경
el.session.onchange = () => {
	currentEventData().active = el.session.value;
	save(); renderStats(); renderTimes();
	el.session.blur();
};

// 세션 추가 (+)
el.addSession.onclick = () => {
	const ed = currentEventData();
	let n = 1;
	const existingNames = new Set(Object.values(ed.sessions).map(s => s.name));
	while (
		existingNames.has('session ' + n) ||
		existingNames.has('session' + n) ||
		existingNames.has('Session ' + n) ||
		existingNames.has('Session' + n) ||
		existingNames.has('세션 ' + n) ||
		existingNames.has('세션' + n)
	) {
		n++;
	}
	const name = 'session ' + n;
	const id = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
	ed.sessions[id] = { id, name, solves: [], updatedAt: Date.now(), clearedAt: 0, deleted: [] };
	ed.active = id;
	save(); render();
};

// 세션 이름 변경 (✎) - 모바일/태블릿에서도 100% 동작하는 커스텀 다이얼로그
const rendlg = $('rendlg'), renInput = $('renInput');
el.renSession.onclick = () => {
	const curr = currentSession();
	renInput.value = curr.name;
	rendlg.showModal();
	setTimeout(() => renInput.focus(), 50);
};
$('renCancel').onclick = () => rendlg.close();
$('renSave').onclick = () => {
	const name = renInput.value.trim();
	if (!name) return;
	const curr = currentSession();
	curr.name = name;
	curr.updatedAt = Date.now();
	rendlg.close();
	save(); renderSessions();
};
renInput.onkeydown = (e) => {
	if (e.key === 'Enter') { e.preventDefault(); $('renSave').click(); }
};

// 세션 삭제 (×)
el.delSession.onclick = () => {
	const ed = currentEventData();
	const keys = Object.keys(ed.sessions);
	if (keys.length <= 1) {
		if (confirm('마지막 세션입니다. 기록을 모두 초기화하시겠습니까?')) {
			const curr = currentSession();
			curr.clearedAt = Date.now();
			curr.solves = [];
			curr.updatedAt = Date.now();
			save(); render();
		}
		return;
	}
	const curr = currentSession();
	if (!confirm(`'${curr.name}' 세션을 삭제하시겠습니까?\n(기록 ${curr.solves.length}개가 함께 삭제됩니다)`)) return;
	ed.deletedSessions = (ed.deletedSessions || []).concat(ed.active);
	delete ed.sessions[ed.active];
	ed.active = Object.keys(ed.sessions)[0];
	save(); render();
};

el.scramble.onclick = nextScramble;
$('newscr').onclick = nextScramble;
$('cancel').onclick = () => cancel();

// ── 동기화 설정 창 ───────────────────────────────────────────────────────────
const dlg = $('syncdlg'), gmsg = $('gmsg');
const syncBtn = $('sync');
const showSync = () => syncBtn.classList.toggle('on', !!gist && !onServer);

function msg(text, cls) { gmsg.textContent = text; gmsg.className = cls || ''; }

syncBtn.onclick = () => {
	$('gid').value = (gist && gist.id) || '';
	$('gtok').value = (gist && gist.token) || '';
	msg(onServer ? 'PC 서버가 이미 동기화 중입니다. 이 설정은 서버 없이 열었을 때만 쓰입니다.' : '');
	dlg.showModal();
};
$('gclose').onclick = () => dlg.close();
$('gsave').onclick = async () => {
	let rawId = $('gid').value.trim(), token = $('gtok').value.trim();
	if (!rawId || !token) { msg('gist ID와 토큰을 모두 입력하세요.', 'err'); return; }
	// URL 전체를 붙여넣었을 경우 순수 Gist ID만 자동 추출 (예: https://gist.github.com/user/123 -> 123)
	const id = rawId.replace(/^https?:\/\/gist\.github\.com\/([^\/]+\/)?/, '').replace(/[/?#].*$/, '');
	gist = { id: id, token: token };
	msg('확인 중…');
	try {
		await gistSync();
		localStorage.setItem(GKEY, JSON.stringify(gist));   // 성공한 설정만 저장
		msg('동기화 완료 — 총 기록 ' + countSolves(db) + '개', 'ok');
		showSync();
	} catch (e) {
		gist = null;
		msg(e.message || '연결 실패', 'err');
	}
};
$('gdel').onclick = () => {
	gist = null;
	localStorage.removeItem(GKEY);
	msg('토큰을 지웠습니다. 기록은 이 기기에 그대로 있습니다.', 'ok');
	showSync();
};

const inspBtn = $('insp');
inspBtn.classList.toggle('on', inspOn);
inspBtn.onclick = () => {
	inspOn = !inspOn;
	localStorage.setItem(KEY + '_insp', inspOn ? '1' : '0');
	inspBtn.classList.toggle('on', inspOn);
	cancel();
};

const clrBtn = $('clear');
if (clrBtn) {
	clrBtn.onclick = () => {
		const curr = currentSession();
		if (!confirm(`'${curr.name}' 세션의 기록 ${curr.solves.length}개를 모두 지웁니다.`)) return;
		curr.clearedAt = Date.now();
		curr.solves = [];
		curr.updatedAt = Date.now();
		save(); render();
	};
}
if ($('export')) {
	$('export').onclick = () => {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([JSON.stringify(db)], { type: 'application/json' }));
		a.download = 'eh_timer_' + new Date().toISOString().slice(0, 10) + '.json';
		a.click();
		URL.revokeObjectURL(a.href);
	};
}
if ($('import') && el.file) {
	$('import').onclick = () => el.file.click();
	el.file.onchange = async () => {
		try {
			db = merge(db, clean(JSON.parse(await el.file.files[0].text())));
			ev = EVENTS.find(e => e.id === db.currentEvent) || EVENTS[0];
		} catch (e) {
			el.status.textContent = '가져오기 실패 — JSON 파일이 아닙니다';
			el.file.value = '';
			return;
		}
		el.file.value = '';
		save(); render(); nextScramble();
	};
}

if (el.sfx) {
	el.sfx.onclick = () => {
		sfxOn = !sfxOn;
		localStorage.setItem('eh_timer_sfx', sfxOn ? '1' : '0');
		updateAudioUI();
		if (sfxOn) playReadySound();
	};
}

if (el.bgm) {
	el.bgm.onclick = () => {
		bgmOn = !bgmOn;
		localStorage.setItem('eh_timer_bgm', bgmOn ? '1' : '0');
		updateAudioUI();
		if (bgmOn) startBGM(); else stopBGM();
	};

	// 우클릭 또는 모바일 롱프레스로 BGM 스타일 변경 창 열기
	const bgmdlg = $('bgmdlg');
	if (bgmdlg) {
		el.bgm.oncontextmenu = (e) => {
			e.preventDefault();
			const currentRadio = document.querySelector(`input[name="bgmMode"][value="${bgmMode}"]`);
			if (currentRadio) currentRadio.checked = true;
			bgmdlg.showModal();
		};

		let touchTimer = 0;
		el.bgm.addEventListener('touchstart', () => {
			touchTimer = setTimeout(() => {
				const currentRadio = document.querySelector(`input[name="bgmMode"][value="${bgmMode}"]`);
				if (currentRadio) currentRadio.checked = true;
				bgmdlg.showModal();
			}, 600);
		}, { passive: true });
		el.bgm.addEventListener('touchend', () => clearTimeout(touchTimer), { passive: true });
		el.bgm.addEventListener('touchcancel', () => clearTimeout(touchTimer), { passive: true });
	}
}

if ($('bgmClose')) $('bgmClose').onclick = () => { const d = $('bgmdlg'); d && d.close(); };
if ($('bgmSave')) {
	$('bgmSave').onclick = () => {
		const selected = document.querySelector('input[name="bgmMode"]:checked');
		if (selected) {
			const wasRunning = bgmOn;
			if (wasRunning) stopBGM();
			bgmMode = selected.value;
			localStorage.setItem('eh_timer_bgm_mode', bgmMode);
			if (wasRunning) startBGM();
		}
		const d = $('bgmdlg');
		if (d) d.close();
	};
}

// 최초 사용자 인터랙션 시 AudioContext 준비 및 BGM 시작
const triggerInitialAudio = () => {
	getAudioCtx();
	if (bgmOn && !bgmNodes) startBGM();
};
document.addEventListener('pointerdown', triggerInitialAudio, { once: true });
document.addEventListener('keydown', triggerInitialAudio, { once: true });

load().then(() => {
	updateAudioUI();
	render();
	nextScramble();
	showSync();
	gistSync().catch(() => {});    // 서버 없이 열었고 토큰이 있으면 시작할 때 한 번 합친다
});


