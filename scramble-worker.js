// csTimer scramble engine, running off the main thread.
// vendor/* are unmodified csTimer sources (GPL-3.0, see vendor/LICENSE).
// In a worker, csTimer's execMain() UI code is skipped, so only scrMgr survives.
importScripts(
	'vendor/utillib.js',
	'vendor/isaac.js',
	'vendor/mathlib.js',
	'vendor/min2phase.js',
	'vendor/scramble.js',
	'vendor/scramble_333_edit.js',
	'vendor/scramble_444.js',
	'vendor/2x2x2.js',
	'vendor/megascramble.js'
);

onmessage = function(e) {
	var id = e.data[0], type = e.data[1], len = e.data[2] || 0;
	if (!len) {
		if (type === '555wca' || type === '555') len = 60;
		else if (type === '666wca' || type === '666') len = 80;
		else if (type === '777wca' || type === '777') len = 100;
	}
	var scrambler = scrMgr && scrMgr.scramblers ? scrMgr.scramblers[type] : null;
	var txt = '';
	try {
		if (scrambler) {
			var raw = scrambler(type, len);
			txt = scrMgr.toTxt(raw);
		}
	} catch (err) {
		txt = '';
	}
	postMessage([id, txt || ('unknown scramble type: ' + type)]);
};
