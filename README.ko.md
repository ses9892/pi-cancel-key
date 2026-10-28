# pi-cancel-key

[English](README.md) | **한국어**

pi 에이전트를 취소하는 키를 직접 고르는 확장입니다.

pi는 `escape`를 취소로 쓰고, 그 바인딩을 **다른 어떤 액션보다 먼저** 검사합니다.
그래서 `app.interrupt`만 `ctrl+c`로 바꾸면, `ctrl+c`에 있던 다른 기능들이 조용히
먹통이 됩니다. 이 확장은 그 거래를 명시적으로 만듭니다. 키를 고르면 밀려나는
키들을 적당한 자리로 옮기고, 파일에 저장하고, 재시작 없이 즉시 적용합니다.

```
/cancel-key
```

## 만들게 된 이유

출발점은 사소한 불편이었습니다. 다른 터미널 에이전트에서 pi로 넘어왔는데,
**`escape` 한 번이면 스트리밍이 취소**되는 동작이 너무 쉽게 눌렸습니다. 키 하나,
확인도 없이요. 원래 그 자리에서 다른 일을 하던 도구에서 넘어온 손버릇이라
더 자주 걸렸습니다.

`~/.pi/agent/keybindings.json`을 직접 고치면 절반은 해결됩니다. `app.interrupt`를
다른 키로 옮길 수 있으니까요. 하지만 옮겨갈 키에는 이미 다른 기능이 붙어 있고,
pi는 `app.interrupt`를 가장 먼저 검사하기 때문에 **그 기능이 조용히 죽습니다**.
`/cancel-key`는 그 나머지 절반을 위해 있습니다.

## 설치

```bash
# git에서 (지금 바로 가능)
pi install git:github.com/ses9892/pi-cancel-key

# 릴리스 버전으로 고정
pi install git:github.com/ses9892/pi-cancel-key@v0.1.0

# 현재 프로젝트에만
pi install -l git:github.com/ses9892/pi-cancel-key

# 한 번만 써보고 흔적 남기지 않기
pi -e git:github.com/ses9892/pi-cancel-key
```

확장은 OS 권한으로 실행됩니다. 설치 전에 소스를 읽어보세요.

## 사용법

| 명령 | 동작 |
|---|---|
| `/cancel-key` | 피커: 현재 키, 후보 목록, 직접 입력, 초기화 |
| `/cancel-key ctrl+x` | 키를 바로 적용 |
| `/cancel-key` → `Reset to pi defaults` | 이 확장이 남긴 설정 제거 |

기본 상태에서 `ctrl+c`를 고르면:

| 액션 | 이전 | 이후 |
|---|---|---|
| `app.interrupt` | `escape` | `ctrl+c` ← 할당 |
| `app.clear` | `ctrl+c` | `ctrl+shift+c` ← 밀려남 |
| `tui.select.cancel` | `escape`, `ctrl+c` | `escape` ← 밀려남 |
| `tui.input.copy` | `ctrl+c` | *(해제)* ← 옮겨갈 자리 없음 |

`escape`는 다이얼로그 닫기와 트랜스크립트 검색에서 계속 동작합니다. 에이전트
취소만 하지 않게 될 뿐입니다.

반대로 `ctrl+x`를 고르면 pi가 같은 키에 두고 있던 액션들이 이렇게 이동합니다:

| 액션 | 이전 | 이후 |
|---|---|---|
| `app.interrupt` | `escape` | `ctrl+x` |
| `app.message.copy` | `ctrl+x` | `ctrl+shift+x` |
| `app.models.clearAll` | `ctrl+x` | `alt+x` |

pi 안에서 `/hotkeys`로 확인하세요. `Ctrl+C` 옆에 *Cancel autocomplete / abort
streaming* 이라고 나오면 적용된 것입니다.

## 밀려난 키는 어떻게 옮기나

같은 글자를 유지하고 수식키를 더합니다:
`ctrl+x` → `ctrl+shift+x` → `alt+x` → `ctrl+alt+x`.
모든 후보가 이미 사용 중일 때만 해제하며, 알림에 항상 결과가 표시됩니다:

```
· app.interrupt: escape → ctrl+c
· app.clear: ctrl+c → ctrl+shift+c (displaced)
· tui.select.cancel: escape / ctrl+c → escape (displaced)
· tui.input.copy: ctrl+c → (unmapped, no free key)
Saved: ~/.pi/agent/keybindings.json
```

`keybindings.json`은 제자리에서 다시 씁니다. `$schema`와 이 확장이 건드리지 않는
항목은 그대로 남습니다.

## 초기화는 정확하게

무엇을 썼는지 `~/.pi/agent/cancel-key-state.json`에 기록합니다. 그래서 초기화는
**그 항목만**, 그것도 값이 그대로일 때만 되돌립니다. 직접 손으로 고친 설정은
절대 되돌리지 않습니다.

## 개발

| 파일 | 역할 |
|---|---|
| `src/plan.ts` | 순수 중재 로직: `planCancelKey`, `planReset`, `deriveFallbacks`, `residualConflicts` |
| `src/keybindings-file.ts` | 관대한 읽기, 원자적 쓰기, 남의 항목 보존 |
| `src/state.ts` | 무엇을 썼는지 기록 → 초기화가 정확해짐 |
| `src/cancel-key.ts` | 계획 → 저장 → 적용 (의존성 주입) |
| `extensions/cancel-key.ts` | `/cancel-key` 커맨드와 피커 |

중재 로직은 순수해서 터미널 없이 규칙을 증명할 수 있습니다. 확장은 라벨을
만들고 `ctx.ui`를 호출할 뿐입니다.

```bash
npm test           # 전체
npm run test:unit  # 중재 + 통합 (밀리초 단위)
npm run test:e2e   # 실제 pi를 실제 pty에서
```

| 테스트 | 증명하는 것 |
|---|---|
| `test/plan.test.ts` | 중재 규칙, I/O 없음 |
| `test/cancel-key.test.ts` | 실제 `pi-tui` 키바인딩 매니저, 임시 디렉터리의 실제 파일, 라이브 키맵 |
| `test/e2e.test.ts` | 실제 pi 프로세스에 키 입력 → 저장된 파일 **그리고** pi 자신의 `/hotkeys` 오버레이 확인 |
| `test/publish.test.ts` | tarball을 만들어 npm 루트에 설치하고, 그 상태로 pi 부팅 |

`scripts/pty-driver.py`는 파이썬 표준 라이브러리만으로 e2e 테스트에 pty를
제공합니다. `scripts/link-pi.mjs`는 `@earendil-works/*`를 로컬 pi 설치에
심볼릭 링크합니다. 복사본을 쓰면 pi가 넘겨주는 인스턴스와 다른 모듈이 되기
때문입니다.

## 라이선스

MIT
