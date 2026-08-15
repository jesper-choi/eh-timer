# eh timer

로컬에서 돌리는 큐브 타이머. 스크램블은 [csTimer](https://github.com/cs0x7f/cstimer) 엔진을 그대로 쓴다.

## 설치

**Node.js LTS** ([nodejs.org](https://nodejs.org))만 있으면 된다. 이 폴더를 통째로 복사하면 끝 —
빌드도 `npm install`도 없다.

### macOS

`eh timer.app` 더블클릭.

- 다른 기기에서 복사해 왔으면 **첫 실행만 우클릭 → 열기** (서명 안 된 앱이라 그냥 열면 막힌다)
- 종료는 Dock 아이콘 우클릭 → 종료
- 앱은 이 폴더 안에 둬야 한다 (옆의 `server.js`를 찾아 쓴다)

### Windows

1. `create-shortcut.bat` 더블클릭 → 바탕화면에 아이콘 생성 (최초 1회)
2. 이후 그 아이콘 더블클릭. 콘솔 창을 닫으면 종료된다

### 태블릿 / 폰

**https://jesper-choi.github.io/eh-timer/** 를 열고 → 메뉴 → **홈 화면에 추가**.

한 번 열어두면 PC가 꺼져 있어도, 인터넷이 없어도 동작한다.

### 터미널에서 직접

```bash
node server.js                    # http://localhost:8000
node server.js 3000               # 포트 지정
node server.js 8000 ~/기록.json    # 기록 파일 위치 지정
node server.js 8000 --lan         # 같은 와이파이의 다른 기기에서도 접속 (인증 없음, 집에서만)
```

## 조작

| 시작 | 스페이스를 0.3초 이상 누르고 있다가 뗀다 (초록 = 준비) |
|---|---|
| **정지** | 아무 키나 |
| **취소** | Esc |

터치는 가운데를 꾹 눌렀다 떼면 시작, 아무 데나 탭하면 정지.
`인스펙션 15초`를 켜면 카운트다운 후 시작되고 WCA 규칙대로 +2 / DNF가 붙는다.

## 기록 동기화 (선택)

기록은 `solves.json`(PC)과 브라우저에 저장된다. 기기 간에 합치려면 비공개 gist를 쓴다.

1. [gist.github.com](https://gist.github.com) 에서 파일명 `solves.json`, 내용 `{}` 로 **Create secret gist**
   → 주소 끝부분이 gist ID
2. [토큰 발급](https://github.com/settings/tokens) → *Generate new token (classic)* → 스코프는 **`gist`만** 체크
3. **PC**: 폴더에 `.env` 파일을 만들고 아래처럼 적은 뒤 `node --env-file=.env server.js` 로 실행
   ```
   GITHUB_TOKEN=발급받은토큰
   EH_TIMER_GIST=gist_id
   ```
4. **태블릿**: 헤더의 `동기화` 버튼 → 같은 값 입력

앱을 열 때와 솔브 3초 후에 양방향으로 병합된다(덮어쓰지 않음). 실패해도 기록은 기기에 남고 다음에 올라간다.

> `.env`는 커밋하지 말 것. 태블릿에 넣은 토큰은 브라우저에 저장되므로, 같은 GitHub 계정의
> 다른 Pages 프로젝트에서 읽힐 수 있다. 토큰에 만료일을 걸어두길 권한다.

## 참고

```bash
node test.js                       # 테스트
node tools/make-icons.mjs onface   # 아이콘 모양 변경 (wordmark | onface | preview)
```

`vendor/`는 csTimer 원본 소스(GPL-3.0)이며 수정하지 않았다. 이 프로젝트도 같은 GPL-3.0을 따른다.
