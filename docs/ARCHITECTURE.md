# Cadora — 아키텍처 · 프로젝트 구성 · 착수 계획

| 항목 | 내용 |
|---|---|
| 버전 | v0.1 (착수용 초안) |
| 작성일 | 2026년 11월 23일 |
| 기준 문서 | [`PRD.md`](PRD.md) v1.3, [`prototype/`](../prototype/README.md) v2.1 (`feat/prototype`) |
| 함께 보는 문서 | [`API.md`](API.md) — 서버 REST · WebSocket · 데스크톱 IPC · 로컬 Hook · 에이전트 런타임 명세 |

이 문서는 클릭형 프로토타입을 실제 Electron 앱과 팀 동기화 서버로 옮기기 위한 구성안과 첫 3주의 작업 순서를 정한다. PRD의 미결정 사항 중 착수에 필요한 것은 **제안**으로 표시하고, 1주차 스파이크 결과로 확정한다.

---

## 1. 출발점: 프로토타입에서 가져갈 것과 버릴 것

| 대상 | 판단 | 이유 |
|---|---|---|
| `prototype/sim.js`의 순수 로직 — `classify`, `toRelative`, `dirKey`, `titleSimilarity`, `suggestBranch`, `maskSecrets`, `maskEnv`, `privacyCheck`, `computeAlerts`, `teammates` | **TypeScript로 이식해 `packages/core`로** | DOM 의존이 없고 FR-12·15·18·19 규칙이 이미 들어 있다. 프로토타입 시연 시나리오를 그대로 단위 테스트로 옮긴다. |
| `sim.js`의 이벤트 모양 — `agent_run`, `agent_activity`, `file_change` 페이로드와 `removed`(정제 시 버린 필드) 목록 | **`packages/protocol`의 스키마로** | 팀 서버로 나가는 최소 메타데이터 규격의 초안으로 쓸 수 있다. |
| `sim.js`의 `createState`·시드 데이터·`SAMPLE_CODE` | 테스트 픽스처로만 | 실제 상태는 서버 DB와 로컬 저장소가 가진다. |
| `prototype/app.js`(바닐라 DOM UI 1,670줄) | **화면 설계 참고용** | 화면 구성·문구·상호작용은 그대로 따르되 코드는 React로 다시 쓴다. |
| `prototype/styles.css`, `fonts/` | 색상·간격 토큰만 추출 | 그래파이트 + 청록 팔레트, Pretendard. |
| `hosted.html`의 공유 기록 방식 | 버림 | 실제 동기화는 서버가 맡는다. |

`prototype/`은 시연·리뷰용으로 그대로 남긴다.

## 2. 시스템 구성

```
┌──────────────────────── Cadora Desktop (Electron, Windows 11 우선) ────────────────────────┐
│ renderer (React)  ── 화면: 작업공간 · 팀 · 활동 · 캘린더 · 생성/온보딩 모달                    │
│      │ window.cadora (preload, contextBridge)                                              │
│ main process                                                                               │
│  ├─ WorkspaceManager   로컬 워크스페이스 모델, 활성/백그라운드/잠자기                    FR-01,04 │
│  ├─ BrowserManager     WebContentsView + session.fromPartition('persist:ws_<id>')         FR-02 │
│  │   └─ DownloadRouter  will-download → 워크스페이스 다운로드 폴더                         FR-05 │
│  ├─ AgentRuntime       에이전트·터미널 실행 (어댑터: Herdr | node-pty)                FR-03,11 │
│  ├─ ProjectWatcher     chokidar + simple-git → core.classify → file_change             FR-12 │
│  ├─ HookReceiver       127.0.0.1 HTTP, Claude Code hooks 수신 → 정제                    FR-13 │
│  ├─ SyncClient         WebSocket, 오프라인 큐, 재접속 재전송                             FR-08,14 │
│  ├─ AlertService       서버 경고 수신 · 표시 · "내 에이전트에게 알려주기"                 FR-15,16 │
│  └─ SecretStore        Electron safeStorage(Windows DPAPI)                            FR-10,19 │
└──────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                       │ HTTPS(REST) + WSS — 최소 메타데이터만 (FR-18)
┌──────────────────────────────────────▼─────────────────────────────────────────────────────┐
│ Cadora Sync Server (Node 22, Fastify + ws + Prisma)                                         │
│  ├─ auth        GitHub OAuth Device Flow → JWT                                              │
│  ├─ workspaces  팀 워크스페이스 · 멤버십 · 초대 · 역할                                 FR-07 │
│  ├─ config      공유 층 설정 버전 관리 · 구성원별 적용 상태                            FR-08,09 │
│  ├─ events      이벤트 수신 · 검증(core.privacyCheck) · 저장 · 팬아웃                   FR-14,18 │
│  └─ rules       core.computeAlerts 기반 경고 생성 · 수신자 지정                        FR-15 │
│  DB: PostgreSQL (개발·시연은 SQLite 가능)                                                    │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
외부 도구: VS Code/Cursor · Claude Code/Codex CLI · Herdr(선택) · Git · Docker · Discord
```

### 2.1 역할 분담 원칙

- **판단 로직은 `packages/core` 한 곳에만 둔다.** 데스크톱은 전송 전 검사(`privacyCheck`)와 분류(`classify`)에, 서버는 수신 검증과 경고 생성(`computeAlerts`)에 같은 코드를 쓴다.
- **경고는 서버가 만든다.** 프로토타입의 `computeAlerts(viewer)`는 보는 사람 기준으로 계산하는데, 실제로는 서버가 이벤트가 들어올 때마다 대상 팀원별로 계산해 `alert` 메시지로 보낸다. 그래야 "지윤에게만 보이는 경고"(FR-15)와 경고 이력 저장(RiskAlert)이 한 곳에서 처리된다.
- **개인 층은 서버에 올리지 않는다.** 개인 워크스페이스, 로그인 세션, 개인 탭, 다운로드 경로는 로컬 저장소에만 둔다(PRD §7.4 LocalWorkspaceConfig).

## 3. 결정 제안 (PRD §11.1 미결정 사항 중 착수에 필요한 것)

| 항목 | 제안 | 근거 | 확정 시점 |
|---|---|---|---|
| 팀 동기화 서버 | **자체 Node 서버** (Fastify + ws + Prisma) | 경고 규칙을 `packages/core`와 같은 TypeScript로 서버에서 돌릴 수 있다. Supabase를 쓰면 인증·실시간은 빨라지지만 규칙 실행 위치(Edge Function, Deno)가 갈라진다. 시연 데모의 `schema.prisma`와 같은 스택이라 설명하기도 좋다. | 1주차 |
| 인증 | **GitHub OAuth Device Flow** | 데스크톱 앱에 리다이렉트 서버가 필요 없고, 대상 사용자가 모두 GitHub 계정이 있다. 시연용 `dev-login`을 함께 둔다. | 1주차 |
| 에이전트 런타임 | **`AgentRuntime` 인터페이스 + 어댑터 2개** — Herdr 어댑터(1순위), node-pty 어댑터(대체) | Herdr는 세션 유지·에이전트 상태 감지·소켓 API를 이미 제공한다. Windows 지원 성숙도가 문서마다 다르게 적혀 있어 스파이크로 확인한다. | 1주차 스파이크 |
| 로컬 저장소 | JSON 파일(`electron-store` 또는 직접 구현) | Windows에서 네이티브 모듈 빌드(better-sqlite3)를 피한다. 데이터 양이 작다. | 1주차 |
| 비밀값 | MVP는 **테스트용 비밀값 + 이름 참조만 동기화**, 로컬은 `safeStorage` | PRD §5.2 FR-10 경고대로 실제 서비스 전 보안 설계를 따로 한다. | P1 |
| 공식 지원 에이전트 | P0는 Claude Code(hooks + 상태), Codex는 프로세스·파일 감시만 | PRD FR-11과 같다. | 확정 |
| 팀 변경 적용 | 탭·자료·링크는 **즉시**, 설치·스크립트·재시작은 **사용자 승인 후** | PRD §4.2 "자동 실행은 설명 가능하고 취소 가능". | 확정 제안 |

## 4. 저장소 구성 (npm workspaces 모노레포)

README의 규약대로 npm과 Node 22를 쓰고, 루트 스크립트 `lint`·`typecheck`·`test`·`build`·`dist`를 맞춘다. **루트에 `package.json`이 생기는 첫 PR부터 Windows CI가 돌기 시작하므로**, 그 PR에서 다섯 스크립트가 모두 통과하는 상태로 올린다.

```
SW_cadora/
├─ package.json                 # workspaces, 루트 스크립트 (lint · typecheck · test · build · dist)
├─ tsconfig.base.json
├─ eslint.config.js
├─ apps/
│  ├─ desktop/                  # Electron + electron-vite + React + TypeScript
│  │  ├─ electron-builder.yml   # directories.output: release (README 규약)
│  │  ├─ resources/
│  │  │  └─ hook-relay.cjs      # Claude Code hook 명령이 실행하는 작은 스크립트 (API.md §4)
│  │  └─ src/
│  │     ├─ main/
│  │     │  ├─ index.ts
│  │     │  ├─ ipc/             # API.md §3 계약 구현 (handle / send)
│  │     │  ├─ workspace/       # WorkspaceManager, local-store
│  │     │  ├─ browser/         # BrowserManager, DownloadRouter
│  │     │  ├─ runtime/
│  │     │  │  ├─ AgentRuntime.ts
│  │     │  │  ├─ herdr/        # HerdrRuntime: 소켓(named pipe) 클라이언트
│  │     │  │  └─ pty/          # PtyRuntime: node-pty + ConPTY
│  │     │  ├─ watcher/         # ProjectWatcher (chokidar, simple-git)
│  │     │  ├─ hooks/           # HookReceiver (127.0.0.1)
│  │     │  ├─ sync/            # SyncClient, OfflineQueue
│  │     │  ├─ alerts/
│  │     │  ├─ secrets/         # SecretStore (safeStorage)
│  │     │  └─ platform/        # OS 어댑터: 경로 · 셸 · 프로세스 트리 종료 (Windows 우선)
│  │     ├─ preload/            # contextBridge → window.cadora
│  │     └─ renderer/           # React 화면 (prototype/app.js 화면 단위로 이식)
│  │        ├─ screens/         # Workspace · Team · Activity · Calendar
│  │        ├─ components/
│  │        └─ styles/          # prototype/styles.css 토큰
│  └─ server/                   # Fastify + ws + Prisma
│     ├─ prisma/schema.prisma   # §6 데이터 모델
│     └─ src/
│        ├─ http/               # REST 라우트 (API.md §1)
│        ├─ ws/                 # WebSocket 게이트웨이 (API.md §2)
│        ├─ rules/              # core.computeAlerts 호출, 수신자 지정, 이력 저장
│        └─ auth/
├─ packages/
│  ├─ core/                     # sim.js 이식 (순수 TS, DOM·Node API 없음) + vitest
│  │  └─ src/ classify.ts · privacy.ts · mask.ts · similarity.ts · branch.ts · alerts.ts
│  └─ protocol/                 # zod 스키마: 이벤트 · REST DTO · WS 메시지 · IPC 계약
├─ prototype/                   # 그대로 유지
└─ docs/  PRD.md · ARCHITECTURE.md · API.md · ui/
```

### 4.1 핵심 의존성

| 영역 | 패키지 | 메모 |
|---|---|---|
| 데스크톱 | `electron`, `electron-vite`, `electron-builder`, `react`, `xterm`(@xterm/xterm) | 브라우저 뷰는 `WebContentsView`를 쓴다(`BrowserView`는 Electron 30부터 deprecated). |
| 런타임 | `node-pty`(대체 어댑터), Herdr CLI(외부 설치) | node-pty는 네이티브 모듈이라 electron-builder 재빌드가 필요하다. |
| 감시 | `chokidar`, `simple-git` | `.git`, `node_modules`, 빌드 결과물 제외(core의 IGNORED와 같은 목록). |
| 서버 | `fastify`, `ws`(또는 `@fastify/websocket`), `prisma`, `jose`(JWT) | |
| 공통 | `zod`, `typescript`, `vitest`, `eslint` | |

## 5. 에이전트 런타임: Herdr 어댑터와 node-pty 대체

에이전트 실행과 터미널은 `AgentRuntime` 인터페이스 뒤에 둔다(API.md §5). 나머지 코드는 어느 구현이 쓰이는지 모른다.

| | HerdrRuntime (1순위) | PtyRuntime (대체) |
|---|---|---|
| 실행 단위 | 워크스페이스 1개 = Herdr 세션 1개 (`cadora-<workspaceId>`) | 워크스페이스별 node-pty 프로세스 |
| 세션 유지 | Herdr 서버가 유지 (앱을 닫아도 에이전트 계속 실행) | 앱 프로세스와 수명이 같다 |
| 에이전트 상태 | Herdr의 `pane.agent_status_changed` 이벤트 | Claude Code hooks + 프로세스 생존 여부 |
| 터미널 화면 | xterm.js 안에서 `herdr terminal attach <id>` 실행, 또는 사용자 터미널에 맡김 | xterm.js ↔ node-pty 직접 |
| 경고 전달 (FR-16) | `agent.prompt` | 에이전트 입력으로 텍스트 전송 |
| 위험 | Windows 지원 성숙도, 버전별 API 변경 | 상태 감지를 직접 만들어야 한다 |

Herdr를 쓰더라도 **파일·Git 감시와 Claude Code hooks는 Cadora가 직접 한다.** Herdr는 에이전트가 "작업 중인지"만 알려주고, 어떤 파일을 바꿨는지와 팀 공유는 Cadora의 몫이다.

## 6. 데이터 모델 (서버, Prisma 초안)

PRD §7.4 엔터티를 MVP에 맞게 줄였다. 팀은 "팀 워크스페이스 + 멤버십"으로 표현하고 Team 테이블은 두지 않는다(팀 1개 = 팀 워크스페이스 1개).

```prisma
model User {
  id          String   @id @default(cuid())
  githubId    String   @unique
  displayName String
  avatarUrl   String?
  createdAt   DateTime @default(now())
  memberships Membership[]
}

model Workspace {                    // 팀 워크스페이스만 서버에 존재 (개인은 로컬 전용)
  id            String   @id @default(cuid())
  name          String
  type          WorkspaceType
  configVersion Int      @default(0)
  createdAt     DateTime @default(now())
  memberships   Membership[]
  configs       ConfigVersion[]
  events        Event[]
  alerts        Alert[]
  invites       Invite[]
}

model Membership {
  workspaceId    String
  userId         String
  role           Role                  // LEADER | MEMBER | VIEWER
  shareTaskTitle Boolean  @default(true)   // FR-18 공유 범위
  appliedVersion Int      @default(0)      // FR-08 구성원별 적용 상태
  onboarding     Json?                     // FR-09 단계별 상태
  joinedAt       DateTime @default(now())
  @@id([workspaceId, userId])
}

model Invite {
  id          String   @id @default(cuid())
  workspaceId String
  code        String   @unique
  role        Role
  createdBy   String
  expiresAt   DateTime
  acceptedBy  String?
  revokedAt   DateTime?
}

model ConfigVersion {                // 공유 층 스냅샷, 버전마다 1행
  workspaceId String
  version     Int
  config      Json                   // API.md §1.4 SharedConfig
  authorId    String
  createdAt   DateTime @default(now())
  @@id([workspaceId, version])
}

model Event {                        // 최소 메타데이터 이벤트 (API.md §2.3)
  seq         BigInt   @id @default(autoincrement())
  id          String   @unique       // 클라이언트 생성 UUID (재전송 중복 제거)
  workspaceId String
  userId      String
  type        String                 // agent_run | agent_status | agent_activity | file_change
  agentRunId  String?
  payload     Json
  at          DateTime
  receivedAt  DateTime @default(now())
  @@index([workspaceId, seq])
}

model Alert {
  id          String   @id @default(cuid())
  workspaceId String
  key         String                 // 같은 원인 중복 방지 (core.computeAlerts의 key)
  type        AlertType              // DB | DEP | ENV | SIM
  severity    Severity               // HIGH | MEDIUM | INFO
  recipientId String                 // 경고는 받는 사람별로 1행
  fromUserId  String
  evidence    String[]               // Event.id 목록 (SQLite면 Json)
  rule        String                 // 사람이 읽는 판단 근거
  status      AlertStatus @default(NEW)  // NEW | DISMISSED | NOTIFIED | HANDLED
  feedback    Boolean?               // 오탐 피드백 (PRD §10.2 경고의 유용성)
  createdAt   DateTime @default(now())
  @@unique([workspaceId, recipientId, key])
}

enum WorkspaceType { ASSIGNMENT DEV_TEAM CONTEST CUSTOM }
enum Role          { LEADER MEMBER VIEWER }
enum AlertType     { DB DEP ENV SIM }
enum Severity      { HIGH MEDIUM INFO }
enum AlertStatus   { NEW DISMISSED NOTIFIED HANDLED }
```

로컬(데스크톱) 저장소는 `workspaces.json` 하나로 시작한다: 개인 워크스페이스 전체, 팀 워크스페이스의 개인 층(로컬 경로, partition 이름, 다운로드 폴더, 개인 탭), 마지막으로 적용한 공유 설정 버전, 오프라인 큐.

## 7. 착수 계획

### 7.1 0주차 — 리스크 스파이크 (각 1~2일, 결과를 이슈에 기록)

코드를 쌓기 전에 PRD §11의 리스크 중 구조를 바꿀 수 있는 것부터 확인한다.

| # | 확인할 것 | 성공 기준 | 실패 시 |
|---|---|---|---|
| S1 | Electron 내장 브라우저에서 **Google 로그인과 학교 LMS 로그인** | partition 두 개에서 서로 다른 Google 계정이 동시에 유지된다 | Google은 내장 브라우저 로그인을 막는 경우가 있다. 대안: 워크스페이스별 `--user-data-dir`로 외부 Chrome/Edge 프로필을 띄우는 "외부 브라우저 모드" |
| S2 | **Herdr on Windows 11**: 설치, named pipe 소켓 연결, `events.subscribe`로 Claude Code 상태 수신, `herdr api schema --json`으로 파라미터 확인 | Node에서 상태 변화 이벤트를 받는다 | PtyRuntime으로 간다 |
| S3 | **Claude Code hooks → 로컬 HTTP**: `.claude/settings.local.json`에 hook을 넣고 `hook-relay.cjs`가 127.0.0.1로 POST | PostToolUse(Edit/Write)의 file_path가 수신된다. 에이전트를 띄울 때 넣은 환경변수가 hook 프로세스에서도 보인다 | 토큰을 환경변수 대신 워크트리별 파일로 전달 |
| S4 | **chokidar 성능**: node_modules가 큰 저장소에서 감시 제외 적용 | CPU·메모리가 눈에 띄게 오르지 않고 변경이 1초 안에 잡힌다 | 감시 범위를 `src/`·설정 파일로 축소 |
| S5 | **node-pty + ConPTY** (S2와 무관하게 필요할 수 있음) | PowerShell 실행, 프로세스 트리 종료(`taskkill /T`) | — |

### 7.2 1~3주차 — 첫 PR 묶음

README의 브랜치 규칙(`feat/*` → `dev`, Conventional Commits PR 제목)과 이슈 템플릿의 FR 번호를 따른다.

| 순서 | PR 제목 예시 | 내용 | 끝났다는 기준 |
|---|---|---|---|
| 1 | `chore: npm workspaces 모노레포 골격` | 루트 package.json, TS·ESLint·Vitest 설정, 빈 apps·packages | Windows CI 5개 스크립트 통과 |
| 2 | `feat(core): 프로토타입 sim.js 규칙 이식 (FR-12, FR-15, FR-18, FR-19)` | classify · privacy · mask · similarity · branch · alerts | 프로토타입 시연 1~5단계를 테스트로 재현 (예: 민수 `schema.prisma` 수정 → 지윤에게 DB 경고, 민수에게는 없음) |
| 3 | `feat(protocol): 이벤트 · WS · REST · IPC 스키마` | zod 스키마 + 예시 JSON | core 테스트가 protocol 타입으로 컴파일됨 |
| 4 | `feat(desktop): Electron 셸과 워크스페이스 목록 (FR-01)` | electron-vite, 사이드바, 생성 모달, 로컬 저장 | 앱 재시작 후 워크스페이스 2개 유지 |
| 5 | `feat(browser): 워크스페이스별 세션 분리와 다운로드 분기 (FR-02, FR-05)` | WebContentsView + partition, will-download | PRD FR-02·05 수용 기준 |
| 6 | `feat(runtime): AgentRuntime과 S2 결과 어댑터 (FR-03, FR-11)` | 스크립트·에이전트 실행, 상태 | 작업 제목·브랜치로 Claude Code 실행 후 상태 표시 |
| 7 | `feat(server): 인증 · 팀 워크스페이스 · 초대 (FR-07)` | Fastify, Prisma, Device Flow, 초대 | 노트북 B에서 초대 수락 후 사이드바에 표시 |

4~5주차부터는 PRD §8.3 일정을 따른다(감시 → 동기화 → hooks → 경고 → 통합 테스트).

### 7.3 팀 역할과 작업 분담

| 팀원 | 담당 | 주요 범위 |
|---|---|---|
| 김건한 | 일렉트론 코어 | Electron main·preload·IPC, 창·트레이·단축키, 로컬 저장·파일·프로세스, 런타임·Hook·파일 감시, 서버 연결, 설치 파일 패키징 |
| 윤일준 | 백엔드 | 서버·DB, 인증·팀·초대, 공유 설정, WebSocket 동기화, 경고 생성·저장, 배포 |
| 박범찬 | 일렉트론 UI | React renderer 화면·컴포넌트, 레이아웃·상태 관리·사용자 흐름, preload API를 통한 코어 기능 연결 |

렌더러는 파일 시스템이나 Node API에 직접 접근하지 않고 `window.cadora`를 사용한다. IPC 계약은 코어와 UI가 함께 정하고, REST·WebSocket 계약은 코어와 백엔드가 함께 정한다. 세 영역에 걸친 기능은 아래 주 담당자가 작업을 조율한다.

#### 이슈별 분배 계획

아래는 PRD·아키텍처의 착수 계획을 이슈 단위로 분해한 **작업 계획**이다. 현재 GitHub에 등록된 이슈가 아니며 번호, 실제 이슈 생성 및 담당자 지정은 별도로 진행한다. 공통 `packages/core`와 `packages/protocol`은 서버·데스크톱 양쪽에 영향을 주므로 계약을 함께 검토한다.

| 작업 이슈 | 주 담당 | 협업 | 근거·범위 |
|---|---|---|---|
| 모노레포·TypeScript·CI 골격 | 김건한 | 윤일준, 박범찬 | ARCH §7.2 PR 1. npm workspaces, 공통 설정, 빌드·테스트 스크립트 |
| 공통 규칙 모듈 이식 | 윤일준 | 김건한 | PR 2, FR-12·15·18·19. 파일 분류, 개인정보 검사, 경고 규칙과 테스트 |
| 공통 프로토콜·이벤트·IPC 스키마 | 윤일준 | 김건한, 박범찬 | PR 3. REST·WS·IPC 타입 및 검증 계약; 각 경계 담당자가 검토 |
| Electron 셸·로컬 워크스페이스 저장 | 김건한 | 박범찬 | PR 4, FR-01·04. main/preload, JSON 저장, IPC |
| 워크스페이스 목록·생성 화면 | 박범찬 | 김건한 | PR 4, FR-01. 목록·생성 폼·상태 UI와 IPC 연결 |
| 브라우저 세션·다운로드 분리 | 김건한 | 박범찬 | PR 5, FR-02·05. partition, WebContentsView, 다운로드 라우팅 |
| 브라우저·탭·다운로드 화면 | 박범찬 | 김건한 | FR-02·05. 탭 제어와 다운로드 알림 |
| 런타임·터미널·스크립트 실행 | 김건한 | 박범찬 | PR 6, FR-03·11. Herdr/node-pty 어댑터, 프로세스 제어 |
| 터미널·실행 상태 UI | 박범찬 | 김건한 | FR-03·11. 터미널 표시, 스크립트·에이전트 제어 및 상태 |
| 서버 인증·사용자·팀·초대 | 윤일준 | 김건한 | PR 7, FR-07. Device Flow, 멤버십·역할, 초대 API |
| 로그인·팀 생성·초대 화면 | 박범찬 | 윤일준, 김건한 | FR-07. 로그인 안내, 멤버 목록, 초대·수락 화면 |
| 공유 설정·버전·온보딩 서버 | 윤일준 | 김건한 | FR-08·09. 스냅샷, 낙관적 동시성, 적용 상태 API |
| 로컬 설정 동기화·승인 후 적용 | 김건한 | 윤일준, 박범찬 | FR-08·09. 공유/개인 층 분리, 로컬 적용과 동기화 |
| 팀 설정·온보딩 화면 | 박범찬 | 김건한, 윤일준 | FR-08·09. 공유 설정 편집, 변경 확인, 단계별 진행 상태 |
| 파일·Git 감시 및 Hook 수신 | 김건한 | 윤일준 | FR-12·13. 민감 파일 제외, 원본 정제, 상대경로 이벤트 |
| 이벤트 수신·재생·WebSocket | 윤일준 | 김건한 | FR-14·18. 검증, 중복 제거, 저장, 재접속 재생 |
| 오프라인 큐·실시간 연결 | 김건한 | 윤일준 | FR-14. 로컬 큐, ACK 후 삭제, 재연결·재전송 |
| 충돌 경고·근거·피드백 API | 윤일준 | 김건한 | FR-15. 수신자별 규칙 실행, 근거 저장, 상태·피드백 |
| 팀 AI 현황·경고 화면 | 박범찬 | 윤일준, 김건한 | FR-14·15. 실행 상태, 변경 파일, 경고 및 근거 표시 |
| 개인정보·보안 통합 검증 | 김건한 | 윤일준, 박범찬 | FR-18·19. 로컬 정제·서버 검증·화면 노출 전체 확인 |
| Windows 패키징·두 기기 통합 검증 | 김건한 | 윤일준, 박범찬 | Windows 빌드 및 P0 시연. 서버·화면 담당자는 각 영역 오류 해결 |

S1 브라우저 로그인 호환성, S2 Herdr, S3 Hooks, S4 파일 감시, S5 node-pty 스파이크는 김건한이 주관하고, S1의 화면 확인은 박범찬이 협업한다. 공통 골격을 먼저 만들고 프로토콜을 합의한 뒤 각 영역을 병렬로 진행한다. P1 비밀값 금고·일정 등은 P0 이슈와 분리해 추후 배정한다.

## 8. 테스트 전략

- **core**: 프로토타입 시연 단계별 시나리오 테스트. 경고 규칙의 오탐·놓침 사례를 테스트 케이스로 계속 추가한다.
- **protocol**: 서버가 금지 필드(코드 본문, 프롬프트, OS 절대경로, 토큰, 이메일)가 섞인 이벤트를 거부하는지 확인한다(FR-18 수용 기준).
- **desktop**: main 모듈은 Vitest로 단위 테스트, 화면은 Playwright Electron 스모크 테스트(P1).
- **통합**: 같은 PC에서 두 사용자 프로필로 앱 두 개를 띄우는 스크립트(`npm run dev:pair`)로 시연 시나리오를 반복한다. 두 기기 테스트는 14주차.
