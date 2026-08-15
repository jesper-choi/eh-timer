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
	addSession: $('addSession'), renSession: $('renSession'), delSession: $('delSession')
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

function ghHeaders() {
	return {
		Authorization: 'Bearer ' + gist.token,
		Accept: 'application/vnd.github+json',
		'Content-Type': 'application/json'
	};
}
async function gistRead() {
	const r = await fetch(GIST_API + gist.id, { headers: ghHeaders(), signal: AbortSignal.timeout(15000) });
	if (!r.ok) {
		let detail = '';
		try { const err = await r.json(); detail = err.message ? ` (${err.message})` : ''; } catch (e) {}
		if (r.status === 404) throw new Error('Gist를 찾을 수 없습니다. Gist ID를 확인하세요' + detail);
		if (r.status === 401) throw new Error('토큰 인증 실패 (토큰 확인)' + detail);
		if (r.status === 403) throw new Error('읽기 실패 HTTP 403: 토큰 권한 부족 또는 API 요청 한도 초과' + detail);
		throw new Error('HTTP ' + r.status + detail);
	}
	const f = (await r.json()).files['solves.json'];
	if (!f) return {};
	const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;   // 1MB 넘으면 잘려서 옴
	return clean(JSON.parse(text || '{}'));
}
async function gistWrite(data) {
	const r = await fetch(GIST_API + gist.id, {
		method: 'PATCH', headers: ghHeaders(), signal: AbortSignal.timeout(15000),
		body: JSON.stringify({ files: { 'solves.json': { content: JSON.stringify(data) } } })
	});
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
}
// 항상 원격과 합쳐서 올린다. 다른 기기가 먼저 올린 기록을 덮지 않기 위함.
// 겹쳐 실행되면 읽기/쓰기가 엇갈릴 수 있으므로 한 번에 하나씩 직렬로 돈다.
let syncing = Promise.resolve();
let isSyncing = false;
function gistSync() {
	if (!gist || onServer) return Promise.resolve();
	if (isSyncing) {
		schedulePush(); // 이미 동기화 중이면 3초 뒤에 다시 묶어서 요청
		return syncing;
	}
	isSyncing = true;
	syncing = syncing.catch(() => {}).then(async () => {
		el.status.textContent = '동기화 중…';
		try {
			const keepEvent = ev.id;          // 사용자가 보고 있는 종목을 기억
			db = merge(db, await gistRead());
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
	clearTimeout(pushTimer);      // 여러 번 변경되어도 3초 모아서 딱 한 번만 동기화
	pushTimer = setTimeout(() => gistSync().catch(() => {}), 3000);
}

// ── scramble worker ──────────────────────────────────────────────────────────
const worker = new Worker('scramble-worker.js');
const pending = {};
let msgid = 0;
worker.onmessage = (e) => { const cb = pending[e.data[0]]; delete pending[e.data[0]]; cb && cb(e.data[1]); };
worker.onerror = (e) => { el.status.textContent = '스크램블 엔진 오류: ' + (e.message || e); };
function generate(event) {
	return new Promise((res) => { pending[++msgid] = res; worker.postMessage([msgid, event.scr, event.len]); });
}

let scramble = '', next = null;
async function nextScramble() {
	const want = ev, p = next || generate(want);
	next = null;
	el.status.textContent = '스크램블 생성 중…';
	const s = await p;
	if (ev !== want) return;               // 이벤트가 바뀌었으면 버림
	scramble = s;
	el.scramble.textContent = s;
	el.status.textContent = '';
	next = generate(want);                 // 미리 뽑아둬서 다음 솔브 때 안 기다리게
}

// ── stats (final/fmt/average 는 stats.js) ────────────────────────────────────
function ao(n) {
	const all = solves();
	return all.length < n ? NaN : average(all.slice(-n));
}
function renderStats() {
	const all = solves();
	const ok = all.map(final).filter(isFinite);
	const mean = all.length && ok.length === all.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN;
	const tiles = [['best', ok.length ? Math.min(...ok) : NaN], ['mean', mean], ['ao5', ao(5)], ['ao12', ao(12)]];
	el.stats.innerHTML = tiles.map(([k, v]) =>
		`<div class="stat"><span>${k}</span><b>${isNaN(v) ? '–' : fmt(v)}</b></div>`).join('');
	el.count.textContent = all.length + ' solves';
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

function renderSessions() {
	const ed = currentEventData();
	const sessionList = Object.values(ed.sessions);
	el.session.innerHTML = sessionList.map(s =>
		`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
	el.session.value = ed.active;
	el.event.value = ev.id;
}

function render() {
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

// ── timer ────────────────────────────────────────────────────────────────────
let state = 'idle';              // idle | inspect | hold | ready | running
let startAt = 0, holdTimer = 0, raf = 0, holdBack = 'idle';
let inspAt = 0, penalty = 0;
let inspOn = localStorage.getItem(KEY + '_insp') === '1';

function setState(s) {
	state = s;
	document.body.className = ((inspAt ? 'inspect ' : '') + (s === 'idle' || s === 'inspect' ? '' : s)).trim();
}

// 글자 수를 CSS에 알려줘서 폭에 맞는 최대 크기로 표시 (2:34.567 처럼 길어지면 자동으로 작아짐).
// 최소 6칸으로 잡아둬서 9.999 → 10.000 넘어갈 때 크기가 튀지 않는다.
function setTime(txt) {
	el.time.textContent = txt;
	el.time.style.setProperty('--ch', Math.max(6, txt.length));
}

function loop() {
	setTime(state === 'running' ? fmt(performance.now() - startAt) : inspText(performance.now() - inspAt));
	raf = requestAnimationFrame(loop);
}

function down() {
	if (state !== 'idle' && state !== 'inspect') return;
	const back = state;
	setState('hold');
	holdTimer = setTimeout(() => setState('ready'), HOLD_MS);
	holdBack = back;
}
function up(ts) {
	clearTimeout(holdTimer);
	if (state === 'hold') { setState(holdBack); return; }   // 너무 짧게 눌렀음
	if (state !== 'ready') return;
	if (inspOn && !inspAt) {                                // 인스펙션 시작
		inspAt = ts;
		setState('inspect');
		cancelAnimationFrame(raf); loop();
		return;
	}
	penalty = inspAt ? inspPenaltyOf(ts - inspAt) : 0;      // 인스펙션 초과 시 WCA 페널티
	inspAt = 0;
	startAt = ts;
	setState('running');
	cancelAnimationFrame(raf); loop();
}
function stop(ts) {
	cancelAnimationFrame(raf);
	setState('idle');
	const ms = ts - startAt;
	setTime(fmt(ms) + (penalty === 2 ? '+' : penalty === -1 ? ' DNF' : ''));
	solves().push({ ms: ms, p: penalty, scr: scramble, ts: Date.now() });
	penalty = 0;
	save(); render();
	nextScramble();
}
function cancel() {
	clearTimeout(holdTimer);
	cancelAnimationFrame(raf);
	inspAt = 0; penalty = 0;
	setState('idle');
	setTime(fmt(0));
}

document.addEventListener('keydown', (e) => {
	if (e.target.matches && e.target.matches('select, input')) return;
	if (document.querySelector('dialog[open]')) return; // 다이얼로그가 열려 있으면 타이머는 반응하지 않는다
	if (e.key === 'Escape') { cancel(); return; }
	if (state === 'running') { e.preventDefault(); stop(e.timeStamp); return; }
	if (e.key === ' ') { e.preventDefault(); if (!e.repeat) down(); }
});
document.addEventListener('keyup', (e) => {
	if (document.querySelector('dialog[open]')) return;
	if (e.key === ' ') { e.preventDefault(); up(e.timeStamp); }
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
	state === 'running' ? stop(e.timeStamp) : down();
}, { passive: false });

document.addEventListener('touchend', (e) => {
	if (state === 'hold' || state === 'ready') up(e.timeStamp);
}, { passive: false });

// 마우스 / 스타일러스 클릭 지원 (터치는 touchstart/touchend 에서 전담)
$('stage').addEventListener('pointerdown', (e) => {
	if (e.pointerType === 'touch') return;
	e.preventDefault();
	state === 'running' ? stop(e.timeStamp) : down();
});
document.addEventListener('pointerdown', (e) => {
	if (e.pointerType === 'touch') return;
	if (state === 'running') stop(e.timeStamp);
});
document.addEventListener('pointerup', (e) => {
	if (e.pointerType === 'touch') return;
	if (state === 'hold' || state === 'ready') up(e.timeStamp);
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

$('clear').onclick = () => {
	const curr = currentSession();
	if (!confirm(`'${curr.name}' 세션의 기록 ${curr.solves.length}개를 모두 지웁니다.`)) return;
	curr.clearedAt = Date.now();
	curr.solves = [];
	curr.updatedAt = Date.now();
	save(); render();
};
$('export').onclick = () => {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([JSON.stringify(db)], { type: 'application/json' }));
	a.download = 'eh_timer_' + new Date().toISOString().slice(0, 10) + '.json';
	a.click();
	URL.revokeObjectURL(a.href);
};
$('import').onclick = () => el.file.click();
el.file.onchange = async () => {
	try {
		db = merge(db, clean(JSON.parse(await el.file.files[0].text())));   // 덮어쓰지 않고 ts 기준 병합
		ev = EVENTS.find(e => e.id === db.currentEvent) || EVENTS[0];
	} catch (e) {
		el.status.textContent = '가져오기 실패 — JSON 파일이 아닙니다';
		el.file.value = '';
		return;
	}
	el.file.value = '';
	save(); render(); nextScramble();
};

load().then(() => {
	render();
	nextScramble();
	showSync();
	gistSync().catch(() => {});    // 서버 없이 열었고 토큰이 있으면 시작할 때 한 번 합친다
});


