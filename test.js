// node test.js  — 통계 로직 + 스크램블 엔진 스모크 테스트
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const { final, fmt, average, inspText, inspPenaltyOf, merge } = require('./stats.js');

const s = (ms, p) => ({ ms, p: p || 0 });

assert.equal(final(s(1000)), 1000);
assert.equal(final(s(1000, 2)), 3000);
assert.equal(final(s(1000, -1)), Infinity);

assert.equal(fmt(12345.6789), '12.346');
assert.equal(fmt(1000), '1.000');
assert.equal(fmt(83210), '1:23.210');
assert.equal(fmt(605000), '10:05.000');
assert.equal(fmt(Infinity), 'DNF');

// 최고/최저 하나씩 버림: (2+3+4)/3
assert.equal(average([1, 2, 3, 4, 5].map(x => s(x * 1000))), 3000);
// DNF 1개는 최악값으로 버려짐: (2+3+4)/3
assert.equal(average([s(1000), s(2000), s(3000), s(4000), s(9000, -1)]), 3000);
// DNF 2개면 DNF
assert.equal(average([s(1000), s(2000), s(3000), s(4000, -1), s(9000, -1)]), Infinity);
// +2 포함: (3+4+5)/3
assert.equal(average([s(1000), s(1000, 2), s(4000), s(5000), s(9000)]), 4000);

// 인스펙션 카운트다운 / 페널티
assert.equal(inspText(0), '15');
assert.equal(inspText(1), '15');
assert.equal(inspText(14000), '1');
assert.equal(inspText(14999), '1');
assert.equal(inspText(15000), '+2');
assert.equal(inspText(17000), '+2');
assert.equal(inspText(17001), 'DNF');
assert.equal(inspPenaltyOf(15000), 0);
assert.equal(inspPenaltyOf(15001), 2);
assert.equal(inspPenaltyOf(17000), 2);
assert.equal(inspPenaltyOf(17001), -1);

// 병합: 중복 없이, 시간순으로, 어느 쪽도 사라지지 않게
{
	const a = { '333': [{ ms: 1, p: 0, ts: 10 }, { ms: 2, p: 0, ts: 30 }] };
	const b = { '333': [{ ms: 2, p: 0, ts: 30 }, { ms: 3, p: 0, ts: 20 }], '222': [{ ms: 4, p: 0, ts: 40 }] };
	const m = merge(a, b);
	assert.deepEqual(m['333'].map(x => x.ts), [10, 20, 30]);   // 중복 30 하나만, 정렬됨
	assert.deepEqual(m['222'].map(x => x.ts), [40]);           // 한쪽에만 있는 종목도 유지
	assert.deepEqual(merge({}, {}), {});
}

// 스크램블 엔진(vendor/*)이 실제로 돌아가는지
globalThis.require = require;
for (const f of ['utillib', 'isaac', 'mathlib', 'min2phase', 'scramble', 'scramble_333_edit', 'scramble_444', '2x2x2', 'megascramble']) {
	vm.runInThisContext(fs.readFileSync(__dirname + '/vendor/' + f + '.js', 'utf8'), { filename: f });
}
for (const [type, len] of [['333', 0], ['222so', 0], ['444wca', 0], ['555wca', 60], ['666wca', 80], ['777wca', 100], ['333ni', 0]]) {
	const scr = scrMgr.toTxt(scrMgr.scramblers[type](type, len));
	assert.ok(scr.split(/\s+/).length > 8, type + ': ' + scr);
	console.log(type.padEnd(7), scr);
}

// gist 동기화: 가짜 gist API를 띄워서 서버가 원격 기록을 덮어쓰지 않는지 확인
(async () => {
	const http = require('node:http');
	const { spawn } = require('node:child_process');
	const os = require('node:os');
	const path = require('node:path');

	let remote = { '333': [{ ms: 1000, p: 0, scr: 'remote', ts: 111 }] };   // 다른 기기가 올려둔 기록
	let patches = 0;
	const stub = http.createServer((req, res) => {
		if (req.method === 'GET') {
			res.end(JSON.stringify({ files: { 'solves.json': { content: JSON.stringify(remote), truncated: false } } }));
			return;
		}
		let b = '';
		req.on('data', (c) => { b += c; });
		req.on('end', () => { remote = JSON.parse(JSON.parse(b).files['solves.json'].content); patches++; res.end('{}'); });
	}).listen(8198, '127.0.0.1');

	const tmp = path.join(os.tmpdir(), 'eh_timer_test_' + Date.now() + '.json');
	const srv = spawn(process.execPath, [__dirname + '/server.js', '8199', tmp], {
		env: { ...process.env, GITHUB_TOKEN: 't', EH_TIMER_GIST: 'g1', EH_TIMER_GIST_API: 'http://127.0.0.1:8198/' },
		stdio: 'ignore'
	});
	const wait = (ms) => new Promise(r => setTimeout(r, ms));
	for (let i = 0; i < 50; i++) { try { await fetch('http://127.0.0.1:8199/data'); break; } catch (e) { await wait(100); } }
	await wait(400);

	// 시작 동기화로 원격 기록이 로컬에 들어와야 한다
	const afterStart = await (await fetch('http://127.0.0.1:8199/data')).json();
	assert.deepEqual(afterStart['333'].map(x => x.ts), [111], '시작할 때 원격 기록을 가져와야 함');

	// 이 기기에서 솔브 하나 추가 → 3초 디바운스 후 원격에 합쳐져 올라가야 한다
	await fetch('http://127.0.0.1:8199/data', {
		method: 'PUT',
		body: JSON.stringify({ '333': [...afterStart['333'], { ms: 2000, p: 0, scr: 'local', ts: 222 }] })
	});
	await wait(4000);
	assert.deepEqual(remote['333'].map(x => x.ts), [111, 222], '원격 기록을 덮어쓰지 않고 합쳐야 함');
	assert.ok(patches >= 1, 'gist에 PATCH 되어야 함');

	srv.kill(); stub.close(); fs.unlinkSync(tmp);
	console.log('gist sync ok (원격 1개 + 로컬 1개 → 2개 병합)');
	console.log('\nok');
})();
