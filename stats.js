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
					const clearedAt = typeof s.clearedAt === 'number' && isFinite(s.clearedAt) ? s.clearedAt : 0;
					const deleted = Array.isArray(s.deleted) ? s.deleted.filter(t => typeof t === 'number' && isFinite(t)).slice(-500) : [];
					const delSet = new Set(deleted);
					const rawSolves = Array.isArray(s.solves) ? s.solves : [];
					const cleanSolves = rawSolves
						.filter(x => x && typeof x === 'object' && typeof x.ms === 'number' && isFinite(x.ms) && x.ms >= 0 && typeof x.ts === 'number' && isFinite(x.ts) && x.ts > clearedAt && !delSet.has(x.ts))
						.map(x => ({ ms: x.ms, p: x.p === 2 || x.p === -1 ? x.p : 0, scr: typeof x.scr === 'string' ? x.scr.slice(0, 1000) : '', ts: x.ts }));
					sessions[sId] = {
						id: String(s.id || sId),
						name: String(s.name || 'session 1'),
						solves: cleanSolves,
						updatedAt: typeof s.updatedAt === 'number' && isFinite(s.updatedAt) ? s.updatedAt : 0,
						clearedAt,
						deleted
					};
				}
				if (Object.keys(sessions).length === 0) {
					sessions['s_1'] = { id: 's_1', name: 'session 1', solves: [], updatedAt: 0, clearedAt: 0, deleted: [] };
				}
				const active = (evData.active && sessions[evData.active]) ? evData.active : Object.keys(sessions)[0];
				const deletedSessions = Array.isArray(evData.deletedSessions) ? evData.deletedSessions.filter(x => typeof x === 'string').slice(-100) : [];
				out.events[evId] = { active, sessions, deletedSessions };
			} else {
				out.events[evId] = { active: 's_1', sessions: { s_1: { id: 's_1', name: 'session 1', solves: [], updatedAt: 0, clearedAt: 0, deleted: [] } }, deletedSessions: [] };
			}
		}
		return out;
	}

	// Case 2: Top-level sessions
	if (data.sessions && typeof data.sessions === 'object' && !Array.isArray(data.sessions)) {
		for (const evId of DEFAULT_EVENTS) {
			out.events[evId] = { active: 's_1', sessions: {}, deletedSessions: [] };
		}
		for (const [sId, s] of Object.entries(data.sessions)) {
			if (!s || typeof s !== 'object') continue;
			const evId = (typeof s.event === 'string' && DEFAULT_EVENTS.includes(s.event)) ? s.event : '333';
			const clearedAt = typeof s.clearedAt === 'number' && isFinite(s.clearedAt) ? s.clearedAt : 0;
			const deleted = Array.isArray(s.deleted) ? s.deleted.filter(t => typeof t === 'number' && isFinite(t)).slice(-500) : [];
			const delSet = new Set(deleted);
			const rawSolves = Array.isArray(s.solves) ? s.solves : [];
			const cleanSolves = rawSolves
				.filter(x => x && typeof x === 'object' && typeof x.ms === 'number' && isFinite(x.ms) && x.ms >= 0 && typeof x.ts === 'number' && isFinite(x.ts) && x.ts > clearedAt && !delSet.has(x.ts))
				.map(x => ({ ms: x.ms, p: x.p === 2 || x.p === -1 ? x.p : 0, scr: typeof x.scr === 'string' ? x.scr.slice(0, 1000) : '', ts: x.ts }));
			out.events[evId].sessions[sId] = {
				id: String(s.id || sId),
				name: String(s.name || 'session 1'),
				solves: cleanSolves,
				updatedAt: typeof s.updatedAt === 'number' && isFinite(s.updatedAt) ? s.updatedAt : 0,
				clearedAt,
				deleted
			};
		}
		for (const evId of DEFAULT_EVENTS) {
			if (Object.keys(out.events[evId].sessions).length === 0) {
				out.events[evId].sessions['s_1'] = { id: 's_1', name: 'session 1', solves: [], updatedAt: 0, clearedAt: 0, deleted: [] };
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
				s_1: { id: 's_1', name: 'session 1', solves, updatedAt: 0, clearedAt: 0, deleted: [] }
			},
			deletedSessions: []
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
		const ea = na.events[evId] || { active: 's_1', sessions: {}, deletedSessions: [] };
		const eb = nb.events[evId] || { active: 's_1', sessions: {}, deletedSessions: [] };

		const delSessions = new Set([...(ea.deletedSessions || []), ...(eb.deletedSessions || [])]);
		const sessions = {};
		const allSessionIds = new Set([...Object.keys(ea.sessions || {}), ...Object.keys(eb.sessions || {})]);

		for (const sId of allSessionIds) {
			if (delSessions.has(sId)) continue; // 삭제된 세션은 복구하지 않음

			const sa = ea.sessions && ea.sessions[sId];
			const sb = eb.sessions && eb.sessions[sId];

			if (sa && sb) {
				const aTime = sa.updatedAt || 0;
				const bTime = sb.updatedAt || 0;
				const name = (aTime >= bTime ? sa.name : sb.name) || sa.name || sb.name || 'session 1';
				const updatedAt = Math.max(aTime, bTime);

				const clearedAt = Math.max(sa.clearedAt || 0, sb.clearedAt || 0);
				const delSolves = new Set([...(sa.deleted || []), ...(sb.deleted || [])]);

				const seen = new Set();
				const combined = (sa.solves || []).concat(sb.solves || []);
				const solves = combined
					.filter(s => s && typeof s === 'object' && typeof s.ts === 'number' && s.ts > clearedAt && !delSolves.has(s.ts) && !seen.has(s.ts) && seen.add(s.ts))
					.sort((x, y) => x.ts - y.ts);

				sessions[sId] = {
					id: sId,
					name,
					solves,
					updatedAt,
					clearedAt,
					deleted: Array.from(delSolves).slice(-500)
				};
			} else if (sa) {
				const clearedAt = sa.clearedAt || 0;
				const delSolves = new Set(sa.deleted || []);
				const solves = (sa.solves || []).filter(s => s && typeof s === 'object' && typeof s.ts === 'number' && s.ts > clearedAt && !delSolves.has(s.ts));
				sessions[sId] = { ...sa, solves };
			} else if (sb) {
				const clearedAt = sb.clearedAt || 0;
				const delSolves = new Set(sb.deleted || []);
				const solves = (sb.solves || []).filter(s => s && typeof s === 'object' && typeof s.ts === 'number' && s.ts > clearedAt && !delSolves.has(s.ts));
				sessions[sId] = { ...sb, solves };
			}
		}

		if (Object.keys(sessions).length === 0) {
			sessions['s_1'] = { id: 's_1', name: 'session 1', solves: [], updatedAt: Date.now(), clearedAt: 0, deleted: [] };
		}

		const active = (ea.active && sessions[ea.active]) ? ea.active : ((eb.active && sessions[eb.active]) ? eb.active : Object.keys(sessions)[0]);
		out.events[evId] = {
			active,
			sessions,
			deletedSessions: Array.from(delSessions).slice(-100)
		};
	}
	return out;
}

if (typeof module !== 'undefined') module.exports = { final, fmt, average, inspText, inspPenaltyOf, merge, normalize, countSolves, INSPECT_MS };


