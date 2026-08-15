// node test.js  — 통계 로직 + 스크램블 엔진 스모크 테스트
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const { final, fmt, average, inspText, inspPenaltyOf, merge, normalize, countSolves } = require('./stats.js');

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

// 다중 세션 정규화 및 병합: 중복 없이, 시간순으로, 어느 쪽도 사라지지 않게
{
	// 1. 레거시 v1 병합 테스트
	const v1_a = { '333': [{ ms: 1, p: 0, ts: 10 }, { ms: 2, p: 0, ts: 30 }] };
	const v1_b = { '333': [{ ms: 2, p: 0, ts: 30 }, { ms: 3, p: 0, ts: 20 }], '222': [{ ms: 4, p: 0, ts: 40 }] };
	const m1 = merge(v1_a, v1_b);
	assert.deepEqual(m1.events['333'].sessions['s_1'].solves.map(x => x.ts), [10, 20, 30]);   // 중복 30 하나만, 정렬됨
	assert.deepEqual(m1.events['222'].sessions['s_1'].solves.map(x => x.ts), [40]);           // 한쪽에만 있는 종목도 유지
	assert.equal(countSolves(m1), 4);

	// 2. 다중 세션 v2 병합 테스트 (종목별 세션)
	const v2_a = {
		version: 2, currentEvent: '333',
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '메인', solves: [{ ms: 1000, p: 0, ts: 100 }] },
					s2: { id: 's2', name: '서브', solves: [{ ms: 2000, p: 0, ts: 200 }] }
				}
			}
		}
	};
	const v2_b = {
		version: 2, currentEvent: '333oh',
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '메인', solves: [{ ms: 1000, p: 0, ts: 100 }, { ms: 1500, p: 0, ts: 150 }] }
				}
			},
			'333oh': {
				active: 's3',
				sessions: {
					s3: { id: 's3', name: 'OH 연습', solves: [{ ms: 3000, p: 0, ts: 300 }] }
				}
			}
		}
	};
	const m2 = merge(v2_a, v2_b);
	assert.deepEqual(m2.events['333'].sessions['s1'].solves.map(x => x.ts), [100, 150]);
	assert.deepEqual(m2.events['333'].sessions['s2'].solves.map(x => x.ts), [200]);
	assert.deepEqual(m2.events['333oh'].sessions['s3'].solves.map(x => x.ts), [300]);
	assert.equal(countSolves(m2), 4);

	// 3. 빈 객체 병합
	const empty = merge({}, {});
	assert.ok(empty.events['333'].sessions['s_1']);
	assert.equal(countSolves(empty), 0);

	// 4. 세션 이름 변경 테스트 (더 최근 updatedAt을 가진 이름이 유지됨)
	const ren_a = {
		version: 2,
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '오래된 이름', solves: [], updatedAt: 100 }
				}
			}
		}
	};
	const ren_b = {
		version: 2,
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '새 이름', solves: [], updatedAt: 200 }
				}
			}
		}
	};
	const m_ren = merge(ren_a, ren_b);
	assert.equal(m_ren.events['333'].sessions['s1'].name, '새 이름');

	// 5. 기록 비우기(clearedAt) 테스트 (clearedAt 이전 기록은 원격에 있어도 다시 부활하지 않음)
	const clr_remote = {
		version: 2,
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '메인', solves: [{ ms: 1000, p: 0, ts: 100 }, { ms: 2000, p: 0, ts: 200 }] }
				}
			}
		}
	};
	const clr_local = {
		version: 2,
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '메인', solves: [{ ms: 3000, p: 0, ts: 350 }], clearedAt: 300 }
				}
			}
		}
	};
	const m_clr = merge(clr_local, clr_remote);
	// ts: 100, 200은 clearedAt: 300 이하라 제거되고, ts: 350(비운 후 새 솔브)만 남아야 함
	assert.deepEqual(m_clr.events['333'].sessions['s1'].solves.map(x => x.ts), [350]);

	// 6. 개별 솔브 삭제(deleted) 테스트
	const del_remote = {
		version: 2,
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '메인', solves: [{ ms: 1000, p: 0, ts: 100 }, { ms: 2000, p: 0, ts: 200 }] }
				}
			}
		}
	};
	const del_local = {
		version: 2,
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '메인', solves: [{ ms: 2000, p: 0, ts: 200 }], deleted: [100] }
				}
			}
		}
	};
	const m_del = merge(del_local, del_remote);
	assert.deepEqual(m_del.events['333'].sessions['s1'].solves.map(x => x.ts), [200]);

	// 7. 세션 삭제(deletedSessions) 테스트
	const sess_remote = {
		version: 2,
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '메인', solves: [] },
					s2: { id: 's2', name: '삭제될 세션', solves: [{ ms: 1000, p: 0, ts: 100 }] }
				}
			}
		}
	};
	const sess_local = {
		version: 2,
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '메인', solves: [] }
				},
				deletedSessions: ['s2']
			}
		}
	};
	// 8. 동일 ts 솔브의 페널티 수정 시 최신 updatedAt을 가진 세션의 상태가 우선됨
	const pen_old = {
		version: 2,
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '메인', solves: [{ ms: 1000, p: 0, ts: 100 }], updatedAt: 100 }
				}
			}
		}
	};
	const pen_new = {
		version: 2,
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '메인', solves: [{ ms: 1000, p: 2, ts: 100 }], updatedAt: 200 }
				}
			}
		}
	};
	const m_pen = merge(pen_old, pen_new);
	assert.equal(m_pen.events['333'].sessions['s1'].solves[0].p, 2, '최신 updatedAt의 +2 페널티가 유지되어야 함');
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

	let remote = {
		version: 2, currentEvent: '333',
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '기본 세션', solves: [{ ms: 1000, p: 0, scr: 'remote', ts: 111 }] }
				}
			}
		}
	};
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
	assert.deepEqual(afterStart.events['333'].sessions['s1'].solves.map(x => x.ts), [111], '시작할 때 원격 기록을 가져와야 함');

	// 이 기기에서 333에 새 솔브, 222에 새 세션 추가 → 3초 디바운스 후 원격에 합쳐져 올라가야 한다
	const updated = {
		version: 2, currentEvent: '222',
		events: {
			'333': {
				active: 's1',
				sessions: {
					s1: { id: 's1', name: '기본 세션', solves: [...afterStart.events['333'].sessions['s1'].solves, { ms: 2000, p: 0, scr: 'local', ts: 222 }] }
				}
			},
			'222': {
				active: 's2',
				sessions: {
					s2: { id: 's2', name: '2x2 세션', solves: [{ ms: 800, p: 0, scr: 'local2', ts: 333 }] }
				}
			}
		}
	};
	await fetch('http://127.0.0.1:8199/data', {
		method: 'PUT',
		body: JSON.stringify(updated)
	});
	await wait(6000);
	assert.deepEqual(remote.events['333'].sessions['s1'].solves.map(x => x.ts), [111, 222], '원격 기록을 덮어쓰지 않고 합쳐야 함');
	assert.deepEqual(remote.events['222'].sessions['s2'].solves.map(x => x.ts), [333], '222 새 세션도 병합되어 올라가야 함');
	assert.ok(patches >= 1, 'gist에 PATCH 되어야 함');

	srv.kill(); stub.close(); fs.unlinkSync(tmp);
	console.log('gist multi-session sync ok (종목별 세션 병합 완료)');
	console.log('\nok');
})();

