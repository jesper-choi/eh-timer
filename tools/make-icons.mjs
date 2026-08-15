// 큐브 아이콘 생성: SVG → PNG(헤드리스 크롬) → .icns(맥) / .ico(윈도우)
//   node tools/make-icons.mjs           아이콘 빌드
//   node tools/make-icons.mjs preview    변형안들만 미리보기 PNG로 뽑기
// 모양/색을 바꾸려면 아래 icon() 안의 값만 고치면 된다.
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assets = path.join(root, 'assets');
const tmp = path.join(assets, '_png');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", Inter, Arial, sans-serif';

const shade = (hex, k) => '#' + [1, 3, 5].map(i =>
	Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)).toString(16).padStart(2, '0')).join('');

// ── 아이콘 ───────────────────────────────────────────────────────────────────
// variant: 'wordmark' = 큐브 아래 E.H,  'onface' = 큐브 윗면에 E.H
function icon(variant = 'wordmark') {
	const S = 1024, C = S / 2;
	const cell = variant === 'wordmark' ? 103 : 122;
	const cy = variant === 'wordmark' ? 400 : C;
	// round(둥근 모서리)는 stroke로 만들기 때문에 그만큼 스티커가 커진다 → gap이 이를 덮어야 한다
	const round = 0.09 * cell, gap = 0.105;
	const proj = (x, y, z) => [C + 0.866 * (x - y) * cell, cy + (0.5 * (x + y) - z) * cell];

	// 보는 방향이 (1,1,1) 이라 x=3, y=3, z=3 면이 앞으로 온다
	const faces = [
		['top', '#eef2f8', 1.00, (i, j, t) => [[i + t, j + t, 3], [i + 1 - t, j + t, 3], [i + 1 - t, j + 1 - t, 3], [i + t, j + 1 - t, 3]]],
		['left', '#ff5a6e', 0.82, (i, j, t) => [[i + t, 3, j + 1 - t], [i + 1 - t, 3, j + 1 - t], [i + 1 - t, 3, j + t], [i + t, 3, j + t]]],
		['right', '#5b7cfa', 0.68, (i, j, t) => [[3, i + t, j + 1 - t], [3, i + 1 - t, j + 1 - t], [3, i + 1 - t, j + t], [3, i + t, j + t]]]
	];

	let stickers = '';
	for (const [name, color, light, corners] of faces) {
		if (name === 'top' && variant === 'onface') continue;      // 윗면은 글자 자리로 비운다
		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) {
				// 살짝 밝기 차이를 줘서 평평해 보이지 않게
				const k = light * (1 + (name === 'top' ? (i + j) * 0.006 : -(j * 0.035)));
				const c = shade(color, k);
				const pts = corners(i, j, gap).map(p => proj(...p).map(v => v.toFixed(1)).join(',')).join(' ');
				// stroke-linejoin:round 로 폴리곤 모서리를 둥글게
				stickers += `<polygon points="${pts}" fill="${c}" stroke="${c}" stroke-width="${round}" stroke-linejoin="round"/>`;
			}
		}
	}

	let text = '';
	if (variant === 'wordmark') {
		text = `<text x="${C}" y="880" font-family='${FONT}' font-size="176" font-weight="600"
			letter-spacing="6" text-anchor="middle" fill="#eef2f8">E.H</text>`;
	} else {
		// 윗면 평면 위에 글자를 얹는다 (아이소메트릭 기저벡터를 그대로 행렬로)
		const [ox, oy] = proj(0, 0, 3);
		const m = [0.866 * cell, 0.5 * cell, -0.866 * cell, 0.5 * cell, ox, oy].map(v => v.toFixed(3)).join(',');
		const face = [[0, 0, 3], [3, 0, 3], [3, 3, 3], [0, 3, 3]].map(p => proj(...p).map(v => v.toFixed(1)).join(',')).join(' ');
		text = `<polygon points="${face}" fill="#eef2f8" stroke="#eef2f8" stroke-width="${round}" stroke-linejoin="round"/>
			<g transform="matrix(${m})"><text x="1.5" y="1.5" font-family='${FONT}' font-size="1.3" font-weight="700"
			letter-spacing="0.04" text-anchor="middle" dominant-baseline="central" fill="#12161d">E.H</text></g>`;
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
<defs>
	<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
		<stop offset="0" stop-color="#232a36"/><stop offset="0.55" stop-color="#141922"/><stop offset="1" stop-color="#0a0c10"/>
	</linearGradient>
	<radialGradient id="glow" cx="0.5" cy="${(cy / S).toFixed(2)}" r="0.5">
		<stop offset="0" stop-color="#5b7cfa" stop-opacity="0.30"/><stop offset="1" stop-color="#5b7cfa" stop-opacity="0"/>
	</radialGradient>
</defs>
<rect width="${S}" height="${S}" rx="228" fill="url(#bg)"/>
<rect width="${S}" height="${S}" rx="228" fill="url(#glow)"/>
<rect x="6" y="6" width="${S - 12}" height="${S - 12}" rx="222" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="12"/>
${stickers}
${text}
</svg>`;
}

// ── PNG 렌더 ────────────────────────────────────────────────────────────────
function png(size, file, variant) {
	const src = path.join(tmp, 'render.html');
	writeFileSync(src, `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${icon(variant)}`);
	execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars',
		'--default-background-color=00000000', `--window-size=${size},${size}`,
		`--screenshot=${file}`, src], { stdio: 'ignore' });
}

// ── ICO 조립 (PNG를 그대로 담는 Vista+ 형식) ─────────────────────────────────
function ico(sizes, file) {
	const imgs = sizes.map(s => readFileSync(path.join(tmp, `${s}.png`)));
	const header = Buffer.alloc(6 + 16 * sizes.length);
	header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
	let offset = header.length;
	sizes.forEach((s, i) => {
		const e = 6 + i * 16;
		header.writeUInt8(s >= 256 ? 0 : s, e);          // 256은 0으로 표기하는 규칙
		header.writeUInt8(s >= 256 ? 0 : s, e + 1);
		header.writeUInt16LE(1, e + 4);                  // planes
		header.writeUInt16LE(32, e + 6);                 // bpp
		header.writeUInt32LE(imgs[i].length, e + 8);
		header.writeUInt32LE(offset, e + 12);
		offset += imgs[i].length;
	});
	writeFileSync(file, Buffer.concat([header, ...imgs]));
}

// ── 실행 ────────────────────────────────────────────────────────────────────
mkdirSync(assets, { recursive: true });
mkdirSync(tmp, { recursive: true });

if (process.argv[2] === 'preview') {
	for (const v of ['wordmark', 'onface']) {
		png(512, path.join(assets, `preview-${v}.png`), v);
		png(64, path.join(assets, `preview-${v}-64.png`), v);
	}
	rmSync(tmp, { recursive: true, force: true });
	console.log('미리보기:', assets);
	process.exit(0);
}

const variant = process.argv[2] || 'wordmark';
writeFileSync(path.join(assets, 'icon.svg'), icon(variant));

const sizes = [16, 32, 48, 64, 128, 192, 256, 512, 1024];
for (const s of sizes) { png(s, path.join(tmp, `${s}.png`), variant); process.stdout.write(`${s} `); }
console.log('png 완료');

ico([16, 32, 48, 64, 128, 256], path.join(assets, 'icon.ico'));
console.log('icon.ico 완료');

const iconset = path.join(tmp, 'icon.iconset');
mkdirSync(iconset, { recursive: true });
for (const [name, s] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64],
['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512],
['512x512', 512], ['512x512@2x', 1024]]) {
	writeFileSync(path.join(iconset, `icon_${name}.png`), readFileSync(path.join(tmp, `${s}.png`)));
}
if (process.platform === 'darwin') {
	execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'icon.icns')]);
	console.log('icon.icns 완료');
	const res = path.join(root, 'eh timer.app', 'Contents', 'Resources');
	if (existsSync(res)) {
		writeFileSync(path.join(res, 'icon.icns'), readFileSync(path.join(assets, 'icon.icns')));
		// Finder가 캐시된 아이콘을 계속 보여주지 않도록 수정시각을 갱신
		execFileSync('touch', [path.join(root, 'eh timer.app')]);
		console.log('앱 번들 아이콘 갱신');
	}
}
writeFileSync(path.join(assets, 'icon.png'), readFileSync(path.join(tmp, '1024.png')));
// 파비콘 / 매니페스트용 작은 크기들
for (const s of [32, 192, 512]) {
	if (!existsSync(path.join(tmp, `${s}.png`))) png(s, path.join(tmp, `${s}.png`), variant);
	writeFileSync(path.join(assets, `icon-${s}.png`), readFileSync(path.join(tmp, `${s}.png`)));
}
writeFileSync(path.join(root, 'favicon.ico'), readFileSync(path.join(assets, 'icon.ico')));   // 브라우저가 기본으로 찾는 위치
rmSync(tmp, { recursive: true, force: true });
console.log('완료:', assets);
