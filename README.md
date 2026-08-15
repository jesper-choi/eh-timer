# eh timer

로컬에서 돌리는 큐브 타이머. 스크램블 엔진만 [csTimer](https://github.com/cs0x7f/cstimer) 소스를 그대로 가져다 쓰고, 나머지는 새로 만든 최소 구성이다.

## 실행

```bash
node server.js          # http://localhost:8000, 기록은 ./solves.json
node server.js 3000     # 포트 지정

# 기록 파일 위치 지정 — 클라우드 폴더로 지정하면 그대로 기기 간 동기화가 된다
node server.js 8000 ~/Library/CloudStorage/GoogleDrive-내계정/My\ Drive/cube/solves.json
```

node가 없으면 `python3 -m http.server 8000` (윈도우는 `python -m http.server 8000`) 로 띄워도 된다.
정적 파일이라 빌드도, 설치도, 로그인도 없다. Windows / macOS 동일.

> `file://` 로 직접 열면 Web Worker가 차단돼서 스크램블이 안 나온다. 반드시 서버로 띄울 것.

## 다른 PC에 설치 (Windows / macOS)

**준비물은 Node.js 하나뿐이다.** [nodejs.org](https://nodejs.org) 에서 LTS를 설치하고,
이 폴더를 통째로 복사하면 끝. 빌드도 npm install도 없다.

- `.env`까지 같이 복사하면 gist 동기화가 그대로 이어진다 (토큰이 들어있으니 본인 기기에만)
- `solves.json`은 복사할 필요 없다 — 첫 실행 때 gist에서 받아온다

### macOS

`eh timer.app` 더블클릭. 끝.

- 다른 기기에서 복사해 온 경우 첫 실행만 **우클릭 → 열기** (서명 안 된 앱이라 그냥 더블클릭하면 막힌다).
  경고가 계속 뜨면: `xattr -dr com.apple.quarantine "eh timer.app"`
- 실행 중엔 Dock에 아이콘이 뜬다. **종료는 Dock 아이콘 우클릭 → 종료** (서버도 같이 내려간다)
- 앱은 이 폴더 안에 있어야 한다 (옆의 `server.js`를 찾아 쓴다). Dock에 고정하거나 별칭(alias)을 만들어 두는 건 자유

### Windows

1. `create-shortcut.bat` 더블클릭 → 바탕화면에 큐브 아이콘 바로가기가 생긴다 (한 번만)
2. 이후로는 그 아이콘 더블클릭

- 검은 콘솔 창이 뜨고 브라우저가 열린다. **창을 닫으면 종료**된다
- SmartScreen 경고가 뜨면 *추가 정보 → 실행*
- 바로가기 없이 `eh timer.bat`을 직접 더블클릭해도 똑같이 동작한다

### 아이콘 바꾸기

```bash
node tools/make-icons.mjs wordmark   # 기본: 큐브 아래 E.H
node tools/make-icons.mjs onface     # 큐브 윗면에 E.H
node tools/make-icons.mjs preview    # 두 안을 PNG로 비교
```

색이나 모양은 `tools/make-icons.mjs` 의 `icon()` 안에서 고친다. 맥에서 실행해야 `.icns`까지 만들어진다
(`.ico`는 어디서든 생성됨). 렌더에 크롬을 쓰므로 다른 경로면 `CHROME=... node tools/make-icons.mjs`.

## 조작

| 동작 | 키 |
|---|---|
| 시작 | 스페이스를 0.3초 이상 누르고 있다가 뗀다 (빨강 → 초록 뜨면 준비 완료) |
| 정지 | 아무 키나 |
| 취소 (기록 안 남김) | Esc |
| 새 스크램블 | 스크램블 텍스트 클릭 |

인스펙션 15초를 켜면(헤더 버튼, 설정은 저장됨) 스페이스를 떼는 순간 15초 카운트다운이 시작되고,
카운트다운 중에 다시 스페이스를 눌렀다 떼면 솔브가 시작된다. WCA 규칙대로 15초 초과는 +2, 17초 초과는 DNF가 자동으로 붙는다.

마우스/터치는 가운데 타이머 영역을 눌렀다 떼면 동일하게 동작한다.

## 기능

- 종목: 2x2 ~ 7x7, 3x3 OH, 3x3 BLD. 3x3/2x2/4x4는 csTimer와 같은 random-state 스크램블.
- 기록은 소수 4자리(0.1ms)까지. 브라우저 타이머 해상도가 그 아래라 마지막 자리는 브라우저가 결정한다.
- best / mean / ao5 / ao12 (WCA 규칙: 최고·최저 제외, DNF 2개 이상이면 DNF)
- 기록별 +2 / DNF / 삭제, 세션 삭제
- 내보내기/가져오기 JSON (가져오기는 덮어쓰지 않고 ts 기준 병합)

## 기록 저장

솔브가 끝날 때마다 `solves.json`에 저장된다(임시 파일에 쓰고 rename 하므로 중간에 죽어도 파일이 깨지지 않는다).
브라우저 localStorage에도 같은 내용을 백업으로 남기지만, **불러올 때는 파일이 우선**이다.
서버 없이 열면(file://) localStorage만 쓰고, 저장이 실패하면 헤더에 경고가 뜬다.

> 주의: localStorage는 "브라우저 + 주소" 단위라 포트를 바꾸면(8000 → 3000) 예전 기록이 안 보인다.
> 파일 저장을 쓰면 이 문제가 없다.

## 기기 간 동기화 (비공개 gist)

토큰은 **서버만** 들고 있고 브라우저로 내려가지 않는다. 로컬 파일이 항상 원본이고, gist는 그 사본이다.

**1. 비공개 gist 만들기** — [gist.github.com](https://gist.github.com) 에서
파일명 `solves.json`, 내용 `{}` 로 만들고 **Create secret gist** 클릭.
주소의 마지막 토막이 gist ID다: `gist.github.com/이름/`**`a1b2c3d4...`**

**2. 토큰 발급** — [github.com/settings/tokens](https://github.com/settings/tokens) →
*Generate new token (classic)* → 스코프는 **`gist` 하나만** 체크 → 생성 후 복사.
(fine-grained 토큰은 gist API를 지원하지 않으니 classic으로)

**3. `.env` 파일 만들기** — 프로젝트 폴더에:

```
GITHUB_TOKEN=ghp_여기에토큰
EH_TIMER_GIST=a1b2c3d4여기에gist_id
```

**4. 실행** — Windows / macOS 동일:

```bash
node --env-file=.env server.js
```

켜지면 이렇게 뜬다: `gist 동기화(시작): 총 42개`

**동작 방식**

- **시작할 때** gist를 읽어 로컬 파일과 합친다 → 다른 기기에서 한 솔브가 바로 보인다
- **솔브할 때마다** 로컬 파일에 즉시 저장, gist에는 3초 모아서 올린다
- 올릴 때도 원격을 먼저 읽어 **합쳐서** 올린다 → 다른 기기가 올린 기록을 덮어쓰지 않는다
- 네트워크가 끊겨도 로컬 파일에는 계속 쌓이고, 다음에 성공할 때 합쳐진다

**주의**

- `.env`는 커밋하지 말 것. 토큰이 유출되면 GitHub이 자동으로 무효화한다
- secret gist는 "주소를 아는 사람은 볼 수 있음"이지 암호화가 아니다 (기록이 솔브 시간뿐이라 문제될 건 없지만)
- 두 기기에서 **동시에** 타이머를 돌리는 건 상정하지 않았다. 번갈아 쓰는 건 안전하다

동기화가 필요 없으면 환경변수 없이 그냥 `node server.js` — 로컬 파일에만 저장된다.
Google Drive / iCloud / Dropbox 폴더로 기록 파일 경로를 지정하는 방식도 그대로 쓸 수 있다.

## 파일

```
index.html            UI + 스타일
app.js                타이머, 기록, 저장
stats.js              평균/포맷/병합 로직 (test.js가 검증)
scramble-worker.js    워커에서 csTimer 스크램블 엔진 구동
vendor/               csTimer 원본 소스 (GPL-3.0, vendor/LICENSE)
server.js             정적 서버 + 기록 저장/gist 동기화
test.js               node test.js
eh timer.app          맥 런처 (더블클릭)
eh timer.bat          윈도우 런처
create-shortcut.bat   윈도우 바탕화면 바로가기 생성
assets/               아이콘 (svg/png/icns/ico)
tools/make-icons.mjs  아이콘 생성기
solves.json           기록 (자동 생성)
.env                  gist 토큰 (직접 만듦, 공유 금지)
```

스크램블 엔진은 csTimer(GPL-3.0)에서 가져왔다. 그 파일들은 수정하지 않았다.
