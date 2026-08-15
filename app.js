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
const el = { time: $('time'), scramble: $('scramble'), stats: $('stats'), times: $('times'), count: $('count'), status: $('status'), event: $('event'), file: $('file') };

// ── storage ──────────────────────────────────────────────────────────────────
// 서버가 있으면 solves.json 이 원본, localStorage 는 백업.
// 서버 없이 열면(file://) localStorage 만 쓴다.
let db = {};
let onServer = false;
try { db = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { db = {}; }
let ev = EVENTS.find(e => e.id === localStorage.getItem(KEY + '_ev')) || EVENTS[0];

const solves = () => (db[ev.id] = db[ev.id] || []);
const count = (o) => Object.values(o).reduce((n, a) => n + a.length, 0);

// 밖에서 들어온 JSON(가져오기, gist)은 믿지 않는다. 아는 종목·성한 값만 통과시킨다.
const KNOWN = new Set(EVENTS.map((e) => e.id));
function clean(data) {
	const out = {};
	if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
	for (const k of Object.keys(data)) {
		if (!KNOWN.has(k) || !Array.isArray(data[k])) continue;
		out[k] = data[k]
			.filter((s) => s && typeof s === 'object' && typeof s.ms === 'number' && isFinite(s.ms) && s.ms >= 0 && typeof s.ts === 'number' && isFinite(s.ts))
			.map((s) => ({ ms: s.ms, p: s.p === 2 || s.p === -1 ? s.p : 0, scr: typeof s.scr === 'string' ? s.scr.slice(0, 1000) : '', ts: s.ts }));
	}
	return out;
}

async function load() {
	let file;
	try { file = await (await fetch('data')).json(); } catch (e) { return; }   // 서버 없음 → localStorage 모드
	onServer = true;
	if (count(file) === 0 && count(db) > 0) { save(); return; }                // 첫 실행: localStorage 기록을 파일로 이관
	db = file;
}

let queue = Promise.resolve();
function save() {
	localStorage.setItem(KEY, JSON.stringify(db));   // 서버를 쓰더라도 백업으로 남겨둔다
	localStorage.setItem(KEY + '_ev', ev.id);
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
	return { Authorization: 'Bearer ' + gist.token, Accept: 'application/vnd.github+json' };
}
async function gistRead() {
	const r = await fetch(GIST_API + gist.id, { headers: ghHeaders(), signal: AbortSignal.timeout(15000) });
	if (!r.ok) throw new Error(r.status === 404 ? 'gist를 찾을 수 없음 (ID 확인)' : r.status === 401 ? '토큰이 거부됨' : 'HTTP ' + r.status);
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
	if (!r.ok) throw new Error('쓰기 실패 HTTP ' + r.status);
}
// 항상 원격과 합쳐서 올린다. 다른 기기가 먼저 올린 기록을 덮지 않기 위함.
// 겹쳐 실행되면 읽기/쓰기가 엇갈릴 수 있으므로 한 번에 하나씩 직렬로 돈다.
let syncing = Promise.resolve();
function gistSync() {
	if (!gist || onServer) return Promise.resolve();
	syncing = syncing.catch(() => {}).then(async () => {
		el.status.textContent = '동기화 중…';
		try {
			db = merge(db, await gistRead());
			localStorage.setItem(KEY, JSON.stringify(db));
			await gistWrite(db);
			el.status.textContent = '';
			render();
		} catch (e) {
			el.status.textContent = '동기화 실패 — 기록은 이 기기에 저장됨';
			throw e;
		}
	});
	return syncing;
}
let pushTimer = 0;
function schedulePush() {
	if (!gist || onServer) return;
	clearTimeout(pushTimer);      // 솔브마다 때리지 않고 3초 모아서 한 번
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
function render() { renderStats(); renderTimes(); }

el.times.onclick = (e) => {
	const btn = e.target.closest('button'), row = e.target.closest('.solve');
	if (!btn || !row) return;
	const i = +row.dataset.i, act = btn.dataset.act;
	if (act === 'x') solves().splice(i, 1);
	else solves()[i].p = solves()[i].p === +act ? 0 : +act;
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
	if ($('syncdlg').open) return;                    // 설정 창이 열려 있으면 타이머는 반응하지 않는다
	if (e.key === 'Escape') { cancel(); return; }
	if (state === 'running') { e.preventDefault(); stop(e.timeStamp); return; }
	if (e.key === ' ') { e.preventDefault(); if (!e.repeat) down(); }
});
document.addEventListener('keyup', (e) => {
	if ($('syncdlg').open) return;
	if (e.key === ' ') { e.preventDefault(); up(e.timeStamp); }
});

// 안드로이드는 길게 누르면 컨텍스트 메뉴를 띄운다. 홀드로 시작하는 앱이라 막아야 한다.
// 단, 입력창에서는 붙여넣기가 필요하니 그대로 둔다.
document.addEventListener('contextmenu', (e) => {
	if (!(e.target.closest && e.target.closest('input, textarea'))) e.preventDefault();
});

// 터치/클릭도 동일하게 (스테이지 영역에서만 시작)
$('stage').addEventListener('pointerdown', (e) => { e.preventDefault(); state === 'running' ? stop(e.timeStamp) : down(); });
document.addEventListener('pointerdown', (e) => { if (state === 'running') stop(e.timeStamp); });
document.addEventListener('pointerup', (e) => { if (state === 'hold' || state === 'ready') up(e.timeStamp); });

// 오프라인 캐시 등록. https 또는 localhost 에서만 동작하고, 그 외에는 조용히 무시된다.
navigator.serviceWorker && navigator.serviceWorker.register('sw.js').catch(() => {});

// 태블릿/폰: 솔브 중에 화면이 꺼지지 않게 (지원 안 하는 브라우저면 조용히 무시)
async function keepAwake() {
	try { await navigator.wakeLock.request('screen'); } catch (e) { /* 미지원 */ }
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && keepAwake());
keepAwake();

// ── controls ─────────────────────────────────────────────────────────────────
// 버튼에 포커스가 남으면 스페이스가 그 버튼을 다시 누르게 되므로 해제
document.addEventListener('click', (e) => { const b = e.target.closest('button'); b && b.blur(); });

el.event.innerHTML = EVENTS.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
el.event.value = ev.id;
el.event.onchange = () => {
	ev = EVENTS.find(e => e.id === el.event.value);
	next = null;
	save(); render(); nextScramble();
	el.event.blur();
};
el.scramble.onclick = nextScramble;
$('newscr').onclick = nextScramble;

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
	const id = $('gid').value.trim(), token = $('gtok').value.trim();
	if (!id || !token) { msg('gist ID와 토큰을 모두 입력하세요.', 'err'); return; }
	gist = { id: id, token: token };
	msg('확인 중…');
	try {
		await gistSync();
		localStorage.setItem(GKEY, JSON.stringify(gist));   // 성공한 설정만 저장
		msg('동기화 완료 — 기록 ' + Object.values(db).reduce((n, a) => n + a.length, 0) + '개', 'ok');
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
	if (!confirm(ev.name + ' 세션의 기록 ' + solves().length + '개를 지웁니다.')) return;
	db[ev.id] = [];
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
	} catch (e) {
		el.status.textContent = '가져오기 실패 — JSON 파일이 아닙니다';
		el.file.value = '';
		return;
	}
	el.file.value = '';
	save(); render();
};

load().then(() => {
	render();
	nextScramble();
	showSync();
	gistSync().catch(() => {});    // 서버 없이 열었고 토큰이 있으면 시작할 때 한 번 합친다
});
