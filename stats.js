'use strict';

// 페널티 반영한 실제 기록 (DNF = Infinity)
function final(s) { return s.p === -1 ? Infinity : s.ms + (s.p === 2 ? 2000 : 0); }

// 소수 3자리(=1ms). 1분 넘으면 m:ss.sss
function fmt(ms) {
	if (!isFinite(ms)) return 'DNF';
	const sec = ms / 1000;
	if (sec >= 60) {
		const m = Math.floor(sec / 60);
		return m + ':' + (sec - m * 60).toFixed(3).padStart(6, '0');
	}
	return sec.toFixed(3);
}

// WCA average: 최고/최저 하나씩 버리고 평균, DNF 2개 이상이면 DNF
function average(list) {
	if (list.length < 3) return NaN;
	const t = list.map(final).sort((a, b) => a - b);
	if (t[t.length - 2] === Infinity) return Infinity;
	const mid = t.slice(1, -1);
	return mid.reduce((a, b) => a + b, 0) / mid.length;
}

// ── WCA 인스펙션 15초 ──
const INSPECT_MS = 15000;

// 남은 시간 표시: 15 → 1, 넘기면 +2, 17초 넘기면 DNF
function inspText(ms) {
	const left = INSPECT_MS - ms;
	if (left > 0) return String(Math.ceil(left / 1000));
	return ms > INSPECT_MS + 2000 ? 'DNF' : '+2';
}
// 인스펙션에 쓴 시간 → 페널티 (0 / +2 / DNF)
function inspPenaltyOf(ms) { return ms > INSPECT_MS + 2000 ? -1 : ms > INSPECT_MS ? 2 : 0; }

// ── 데이터 정규화 및 병합 (종목별 다중 세션 v2 지원) ──
const DEFAULT_EVENTS = ['333', '222', '444', '555', '666', '777', '333oh', '333bld'];

function normalize(data) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		data = {};
	}
	const out = {
		version: 2,
		currentEvent: (typeof data.currentEvent === 'string' && DEFAULT_EVENTS.includes(data.currentEvent)) ? data.currentEvent : '333',
		events: {}
	};

	// Case 1: Structure with `events`
	if (data.events && typeof data.events === 'object' && !Array.isArray(data.events)) {
		for (const evId of DEFAULT_EVENTS) {
			const evData = data.events[evId];
			if (evData && typeof evData === 'object' && evData.sessions && typeof evData.sessions === 'object') {
				const sessions = {};
				for (const [sId, s] of Object.entries(evData.sessions)) {
					if (!s || typeof s !== 'object') continue;
					sessions[sId] = {
						id: String(s.id || sId),
						name: String(s.name || 'session 1'),
						solves: Array.isArray(s.solves) ? s.solves : []
					};
				}
				if (Object.keys(sessions).length === 0) {
					sessions['s_1'] = { id: 's_1', name: 'session 1', solves: [] };
				}
				const active = (evData.active && sessions[evData.active]) ? evData.active : Object.keys(sessions)[0];
				out.events[evId] = { active, sessions };
			} else {
				out.events[evId] = { active: 's_1', sessions: { s_1: { id: 's_1', name: 'session 1', solves: [] } } };
			}
		}
		return out;
	}

	// Case 2: Top-level sessions
	if (data.sessions && typeof data.sessions === 'object' && !Array.isArray(data.sessions)) {
		for (const evId of DEFAULT_EVENTS) {
			out.events[evId] = { active: 's_1', sessions: {} };
		}
		for (const [sId, s] of Object.entries(data.sessions)) {
			if (!s || typeof s !== 'object') continue;
			const evId = (typeof s.event === 'string' && DEFAULT_EVENTS.includes(s.event)) ? s.event : '333';
			out.events[evId].sessions[sId] = {
				id: String(s.id || sId),
				name: String(s.name || 'session 1'),
				solves: Array.isArray(s.solves) ? s.solves : []
			};
		}
		for (const evId of DEFAULT_EVENTS) {
			if (Object.keys(out.events[evId].sessions).length === 0) {
				out.events[evId].sessions['s_1'] = { id: 's_1', name: 'session 1', solves: [] };
			}
			out.events[evId].active = Object.keys(out.events[evId].sessions)[0];
		}
		return out;
	}

	// Case 3: Legacy v1 format: { "333": [...], "222": [...] }
	for (const evId of DEFAULT_EVENTS) {
		const solves = Array.isArray(data[evId]) ? data[evId] : [];
		out.events[evId] = {
			active: 's_1',
			sessions: {
				s_1: { id: 's_1', name: 'session 1', solves }
			}
		};
	}
	return out;
}

// 전체 세션의 솔브 총합
function countSolves(db) {
	const n = normalize(db);
	let total = 0;
	for (const evData of Object.values(n.events)) {
		for (const s of Object.values(evData.sessions)) {
			if (Array.isArray(s.solves)) total += s.solves.length;
		}
	}
	return total;
}

// 기록 묶음 둘을 ts 기준으로 병합. 덮어쓰지 않으니 어느 쪽 기록도 사라지지 않는다.
function merge(a, b) {
	const na = normalize(a);
	const nb = normalize(b);
	const out = {
		version: 2,
		currentEvent: nb.currentEvent || na.currentEvent || '333',
		events: {}
	};
	const allEvents = new Set([...Object.keys(na.events), ...Object.keys(nb.events)]);
	for (const evId of allEvents) {
		const ea = na.events[evId];
		const eb = nb.events[evId];
		if (ea && eb) {
			const sessions = {};
			const allSessions = new Set([...Object.keys(ea.sessions), ...Object.keys(eb.sessions)]);
			for (const sId of allSessions) {
				const sa = ea.sessions[sId];
				const sb = eb.sessions[sId];
				if (sa && sb) {
					const seen = new Set();
					const solves = (sa.solves || []).concat(sb.solves || [])
						.filter(s => s && typeof s === 'object' && typeof s.ts === 'number' && !seen.has(s.ts) && seen.add(s.ts))
						.sort((x, y) => x.ts - y.ts);
					sessions[sId] = {
						id: sId,
						name: sb.name || sa.name || 'session 1',
						solves
					};
				} else if (sa) {
					sessions[sId] = sa;
				} else if (sb) {
					sessions[sId] = sb;
				}
			}
			const active = (eb.active && sessions[eb.active]) ? eb.active : ((ea.active && sessions[ea.active]) ? ea.active : Object.keys(sessions)[0]);
			out.events[evId] = { active, sessions };
		} else if (ea) {
			out.events[evId] = ea;
		} else if (eb) {
			out.events[evId] = eb;
		}
	}
	return out;
}

if (typeof module !== 'undefined') module.exports = { final, fmt, average, inspText, inspPenaltyOf, merge, normalize, countSolves, INSPECT_MS };


