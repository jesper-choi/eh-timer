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

// 기록 묶음 둘을 ts 기준으로 병합. 덮어쓰지 않으니 어느 쪽 기록도 사라지지 않는다.
function merge(a, b) {
	const out = Object.create(null);   // "__proto__" 같은 키가 들어와도 프로토타입이 오염되지 않게
	for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) {
		const seen = new Set();
		out[k] = (a[k] || []).concat(b[k] || [])
			.filter((s) => !seen.has(s.ts) && seen.add(s.ts))
			.sort((x, y) => x.ts - y.ts);
	}
	return out;
}

if (typeof module !== 'undefined') module.exports = { final, fmt, average, inspText, inspPenaltyOf, merge, INSPECT_MS };
