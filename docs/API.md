# Cadora — API 명세

| 항목 | 내용 |
|---|---|
| 버전 | v0.1 (착수용 초안) |
| 작성일 | 2026년 11월 23일 |
| 기준 | [`PRD.md`](PRD.md) v1.3, [`ARCHITECTURE.md`](ARCHITECTURE.md) v0.1, `prototype/sim.js`의 이벤트 모양 |
| 범위 | §1 서버 REST · §2 서버 WebSocket · §3 데스크톱 IPC · §4 로컬 Hook 수신 · §5 에이전트 런타임 어댑터 |

REST·WebSocket 계약은 이 문서와 공통 계약 사례를 기준으로 한다. 데스크톱은 `packages/protocol`의 zod를, Java 서버는 자체 DTO·검증을 사용하며 공통 사례로 일치 여부를 검증한다. 계약 변경은 협업 규칙에 따른다.

---

## 0. 공통 규칙

- **Base URL**: `https://<host>/v1` (개발: `http://localhost:4000/v1`), WebSocket `wss://<host>/v1/ws`
- **인증**: `Authorization: Bearer <accessToken>` (JWT, 15분). 갱신은 `POST /v1/auth/refresh`.
- **시각**: ISO 8601 + 오프셋 (`2026-11-23T14:05:12+09:00`). 서버는 UTC로 저장한다.
- **ID**: 서버 리소스는 cuid. 클라이언트가 만드는 이벤트·에이전트 실행 ID는 UUID v4 (재전송 중복 제거용).
- **경로**: 파일 경로는 항상 **프로젝트 기준 상대경로**, 구분자 `/`. OS 절대경로는 어떤 API로도 보내지 않는다(FR-18).
- **오류 형식**:

```json
{ "error": { "code": "config_conflict", "message": "baseVersion 12 is stale; current is 13", "details": { "current": 13 } } }
```

| HTTP | code | 상황 |
|---|---|---|
| 400 | `invalid_request` | 스키마 검증 실패 |
| 401 | `unauthenticated` | 토큰 없음·만료 |
| 403 | `forbidden` | 역할 부족 (예: 팀원이 공유 설정 수정) |
| 404 | `not_found` | |
| 409 | `config_conflict` | 공유 설정 `baseVersion`이 최신이 아님 |
| 409 | `last_leader` | 마지막 팀장의 탈퇴·강등 |
| 409 | `invite_already_used` | 다른 사용자가 수락한 초대 |
| 403 | `device_denied` | GitHub 기기 인증 거부 |
| 410 | `device_expired` | GitHub 기기 코드 만료 |
| 410 | `invite_expired` | 초대 만료·회수 |
| 410 | `cursor_expired` | 요청한 이벤트 커서 이후 이력의 일부가 보존 기간 만료로 삭제됨 |
| 429 | `slow_down` | 기기 인증 polling 간격 초과 |
| 422 | `privacy_violation` | 이벤트에 금지 필드가 섞임 (§2.3) |

---

## 1. 서버 REST API

### 1.1 인증 — GitHub OAuth Device Flow

| 메서드 · 경로 | 설명 |
|---|---|
| `POST /auth/github/device` | 기기 코드 발급 → `{ deviceCode, userCode, verificationUri, interval, expiresIn }` |
| `POST /auth/github/poll` | `{ deviceCode }` → 승인 전 `202 { status: "pending" }`, 승인 후 `200 { accessToken, refreshToken, user }` |
| `POST /auth/refresh` | `{ refreshToken }` → `{ accessToken, refreshToken }` |
| `POST /auth/logout` | refreshToken 폐기 |
| `POST /auth/dev-login` | **개발·시연 전용** (`NODE_ENV!=production`): `{ displayName }` → 토큰 |

앱은 `userCode`를 보여주고 `verificationUri`를 외부 브라우저로 연다.

### 1.2 내 정보

| 메서드 · 경로 | 응답 |
|---|---|
| `GET /me` | `{ id, displayName, avatarUrl, workspaces: [{ id, name, role }] }` |

### 1.3 팀 워크스페이스 · 멤버 (FR-07)

개인 워크스페이스는 서버에 없다. 아래는 모두 팀 워크스페이스다.

| 메서드 · 경로 | 권한 | 요청 → 응답 |
|---|---|---|
| `POST /workspaces` | 로그인 | `{ name, type: "DEV_TEAM" \| "ASSIGNMENT" \| "CONTEST" \| "CUSTOM", config?: SharedConfig }` → `Workspace` (만든 사람이 LEADER, `config`가 있으면 version 1) |
| `GET /workspaces` | 로그인 | 내가 속한 팀 워크스페이스 목록 |
| `GET /workspaces/:id` | 멤버 | `{ id, name, type, configVersion, myRole, discordUrl? }` |
| `PATCH /workspaces/:id` | LEADER | `{ name?, discordUrl? }` |
| `DELETE /workspaces/:id` | LEADER | 204 |
| `GET /workspaces/:id/members` | 멤버 | `[{ userId, displayName, role, appliedVersion, onboarding, online }]` |
| `PATCH /workspaces/:id/members/:userId` | LEADER | `{ role }` |
| `DELETE /workspaces/:id/members/:userId` | LEADER 또는 본인 | 204 (탈퇴·내보내기) |
| `GET /workspaces/:id/members/me/privacy` | 본인 | `{ shareTaskTitle: boolean }` |
| `PATCH /workspaces/:id/members/me/privacy` | 본인 | `{ shareTaskTitle: boolean }` (FR-18) |

### 1.4 공유 층 설정 (FR-08)

공유 층은 버전이 붙은 **스냅샷 전체**로 다룬다. 변경분(diff) 계산은 클라이언트가 이전 스냅샷과 비교해서 한다.

| 메서드 · 경로 | 권한 | 요청 → 응답 |
|---|---|---|
| `GET /workspaces/:id/config` | 멤버 | `{ version, config: SharedConfig 또는 ViewerConfig, authorId, createdAt }` (§10.1) |
| `GET /workspaces/:id/config/:version` | 멤버 | 특정 버전 |
| `GET /workspaces/:id/config/history?limit=20` | LEADER·MEMBER | `[{ version, authorId, createdAt, summary }]` |
| `PUT /workspaces/:id/config` | LEADER | `{ baseVersion, config, summary }` → `{ version }`. `baseVersion`이 최신이 아니면 409 `config_conflict` |

```ts
type SharedConfig = {
  repo: { url: string; baseBranch: string } | null;
  scripts: Array<{
    id: string; name: string;                 // "dev 서버"
    command: string;                          // "npm run dev"
    autoStart: boolean;
    requiresApproval: boolean;                // 설치·재시작류는 true (PRD §4.2)
    port?: number; host?: string;             // P1: "capstone.localhost"
  }>;
  pinnedTabs: Array<{ id: string; title: string; url: string }>;
  materials: Array<{ id: string; title: string; url: string }>;   // MVP는 링크만 (PRD §11.1-1)
  services: Array<{ id: string; name: string; url: string }>;     // 필요한 서비스 체크리스트
  aiRules: { path: string; content: string } | null;              // 예: CLAUDE.md
  secrets: Array<{ name: string }>;                               // 이름 참조만 (값 없음)
  watch: { extraIgnore: string[] };                               // 팀별 감시 제외 추가
};
```

설정이 바뀌면 서버는 멤버에게 권한별로 필터링한 WS `config.updated`를 보낸다(§2.2·§10.1).

### 1.5 초대 (FR-07, FR-09)

| 메서드 · 경로 | 권한 | 요청 → 응답 |
|---|---|---|
| `POST /workspaces/:id/invites` | LEADER | `{ role, expiresInHours: 72 }` (role은 MEMBER·VIEWER) → `{ id, code, url: "cadora://invite/<code>", expiresAt }` |
| `GET /workspaces/:id/invites` | LEADER | 대기 중 초대 목록 |
| `DELETE /invites/:inviteId` | LEADER | 회수 |
| `GET /invites/:code` | 로그인 | 미리보기 `{ workspaceName, inviterName, role, expiresAt }` |
| `POST /invites/:code/accept` | 로그인 | `{ workspace, config }`. 만료·회수면 410 |

### 1.6 온보딩 · 적용 상태 (FR-08, FR-09)

| 메서드 · 경로 | 권한 | 요청 |
|---|---|---|
| `PUT /workspaces/:id/members/me/sync` | 본인 | `{ appliedVersion, onboarding: { steps: [{ id: "clone" \| "install" \| "secrets" \| "services" \| "server", status: "pending" \| "running" \| "done" \| "failed" \| "skipped", detail? }] , services: [{ id, done: boolean }] } }` |

팀장 화면의 "팀원 3명에게 반영됨", "현우 대기"는 이 값을 모아서 보여준다.

### 1.7 이벤트 다시 받기

| 메서드 · 경로 | 설명 |
|---|---|
| `GET /workspaces/:id/events?afterSeq=1200&limit=500` | 재접속·최초 진입 시 놓친 이벤트 (§2.3 모양) |
| `GET /workspaces/:id/runs?active=true` | 현재 실행 중인 에이전트 요약 (팀 AI 작업 현황 초기 화면용) |

### 1.8 경고 (FR-15)

경고는 **받는 사람별**로 존재한다. 내 경고만 조회·처리할 수 있다.

| 메서드 · 경로 | 요청 → 응답 |
|---|---|
| `GET /workspaces/:id/alerts?status=NEW,NOTIFIED` | `Alert[]` (§2.4) |
| `GET /alerts/:alertId/evidence` | 근거 이벤트 목록 (`Event[]`) |
| `POST /alerts/:alertId/actions` | `{ action: "dismiss" \| "notified" \| "handled" }` |
| `POST /alerts/:alertId/feedback` | `{ useful: boolean, note?: string }` — 오탐 피드백 (PRD §10.2) |

"내 에이전트에게 알려주기"(FR-16)는 서버가 아니라 **로컬에서** 실행한다(§3, §5). 서버에는 실행 결과로 `action: "notified"`만 보낸다.

### 1.9 비밀값 (FR-10, P1 — 보안 설계 후 확정)

| 메서드 · 경로 | 설명 |
|---|---|
| `GET /workspaces/:id/secrets` | 이름 목록만 `[{ name, updatedAt }]` |
| `PUT /workspaces/:id/secrets/:name` | LEADER, `{ value }` — 서버 측 암호화 저장 |
| `POST /workspaces/:id/secrets/lease` | 멤버, `{ names: [...] }` → `{ values: { NAME: "..." }, expiresAt }` — 로컬은 `safeStorage`로만 보관 |

MVP는 테스트용 값만 쓴다. 로컬에 전달된 값은 추출할 수 있으므로 "팀 탈퇴 후 완전 회수"는 보장하지 않는다(PRD FR-10).

---

## 2. 서버 WebSocket

### 2.1 연결

```
wss://<host>/v1/ws          헤더 Authorization: Bearer <accessToken>
```

모든 메시지는 JSON 한 개, 공통 필드 `t`(타입). 클라이언트가 보내는 요청에는 `rid`(요청 ID)를 붙이고 서버는 같은 `rid`로 응답한다.

```json
→ { "t": "hello", "rid": "r1", "client": { "app": "desktop", "version": "0.1.0", "os": "win32" },
    "workspaces": [{ "id": "ws_cap", "afterSeq": "1200" }] }
← { "t": "hello.ok", "rid": "r1", "serverTime": "2026-11-23T05:10:00Z", "subscriptions": [{ "workspaceId": "ws_cap", "status": "subscribed" }] }
← { "t": "event", "seq": "1201", "event": { … } }      // afterSeq 이후 놓친 것부터 재생
```

### 2.2 메시지 종류

| 방향 | `t` | 내용 |
|---|---|---|
| C→S | `hello` | 구독할 워크스페이스와 마지막으로 받은 `seq` |
| C→S | `event.publish` | `{ rid, event }` — §2.3 이벤트 1개 |
| C→S | `presence.update` | `{ workspaceId, state: "active" \| "background" \| "sleep" \| "elsewhere" \| "offline" }` |
| C→S | `ping` | 30초마다 |
| S→C | `hello.ok` | 서버 시각과 팀별 구독 결과 목록 (§10.8) |
| C→S | `snapshot.subscribe` | 만료된 팀의 복구 구독과 버퍼 시작 (§10.8) |
| S→C | `snapshot.subscribed` | REST 스냅샷 조회에 사용할 연결 전용 토큰 (§10.8) |
| C→S | `snapshot.apply` | 같은 연결에서 스냅샷 적용 완료를 알림 (§10.8) |
| S→C | `snapshot.ready` | 버퍼 전달 완료 및 복구 구독 활성화 (§10.8) |
| S→C | `state.changed` | 설정·멤버·경고 변경 revision 및 재조회 범위 (§10.8) |
| S→C | `ack` | `{ rid, eventId, seq }` — 저장 완료. 이걸 받아야 오프라인 큐에서 지운다 |
| S→C | `event` | `{ seq, event }` — 같은 워크스페이스 멤버의 이벤트 (작성자 본인에게도 echo) |
| S→C | `alert` | `{ alert }` — **수신자에게만** (§2.4) |
| S→C | `alert.caused` | `{ alertId, recipientId, type }` — 경고를 만든 쪽에 "지윤에게 알림 보냄" 표시용 (내용 없음) |
| S→C | `config.updated` | LEADER·MEMBER: `{ workspaceId, version, authorId, summary }`; VIEWER: `{ workspaceId, version }` → `GET /config` |
| S→C | `presence` | `{ workspaceId, userId, state }` — 다른 워크스페이스에 있으면 `elsewhere`만 (이름 비공개) |
| S→C | `member.updated` | 역할·적용 상태·온보딩 변경 |
| S→C | `error` | `{ rid?, code, message }` — `privacy_violation`이면 해당 이벤트 거부 |
| S→C | `pong` | |

**전달 보장**: 최소 1회. 클라이언트는 이벤트 `id`(UUID)로 다시 보내도 되고, 서버는 같은 `id`를 한 번만 저장한다. 연결이 끊기면 로컬 작업은 계속하고 큐에 쌓았다가 재접속 후 순서대로 보낸다(PRD §7.5).

### 2.3 이벤트 스키마 (최소 메타데이터)

`prototype/sim.js`의 `payload`를 기준으로 했다. 공통 필드:

```ts
type EventBase = {
  id: string;            // UUID v4, 클라이언트 생성
  v: 1;                  // 스키마 버전
  workspaceId: string;
  userId: string;        // 서버가 토큰으로 덮어씀
  at: string;            // ISO 8601
};
type Tool = "claude-code" | "codex" | "other";
type Observe = "hooks" | "herdr" | "process";   // 관찰 수준 (UI에 표시, PRD §11)
```

| `type` | 추가 필드 | 언제 |
|---|---|---|
| `agent_run` | `agentRunId, tool, taskTitle: string \| null, branch, status: "running" \| "stopped" \| "exited" \| "error", observe` | 에이전트 시작·종료 |
| `agent_status` | `agentRunId, status: "working" \| "waiting" \| "idle" \| "done" \| "unknown", source: "herdr" \| "hook" \| "process"` | 상태 변화 (§5.3 대응표) |
| `agent_activity` | `agentRunId, activity: "user_input" \| "tool_use" \| "turn_end"` | 마지막 활동 시각 갱신용 (내용 없음) |
| `file_change` | `agentRunId: string \| null, tool: Tool \| null, taskTitle: string \| null, branch, relativePath, changeType: "added" \| "modified" \| "deleted", category, source: "hook:PostToolUse" \| "watcher" \| "git"` | 파일 변경 (분류된 것만) |

`category`는 `core.classify()`의 값: `db-schema` · `dependency` · `infra` · `test` · `api` · `ui` · `docs` · `code`. 감시 제외·민감 파일(`.env`, 키 파일 등)은 **이벤트를 만들지 않는다.**

`taskTitle`은 멤버십의 `shareTaskTitle`이 false면 `null`로 보낸다(서버도 한 번 더 지운다).

예시 — 민수의 Claude Code가 `schema.prisma`를 수정:

```json
{
  "t": "event.publish", "rid": "r42",
  "event": {
    "id": "6c1e4f7a-2b0d-4d8e-9a51-0f3b2c7d9e10", "v": 1,
    "type": "file_change",
    "workspaceId": "ws_cap", "userId": "u_minsu", "at": "2026-11-23T14:05:12+09:00",
    "agentRunId": "1f9a0c2e-…", "tool": "claude-code", "taskTitle": "회원가입 API 구현",
    "branch": "feature/signup", "relativePath": "prisma/schema.prisma",
    "changeType": "modified", "category": "db-schema", "source": "hook:PostToolUse"
  }
}
```

**금지 필드 검사(FR-18)** — 클라이언트는 보내기 전에, 서버는 받을 때 `core.privacyCheck()`를 돌린다. 하나라도 걸리면 서버는 저장하지 않고 `error { code: "privacy_violation" }`.

| 검사 | 걸리는 예 |
|---|---|
| 코드 본문 | `old_string`, `new_string`, `content`, `diff`, `patch` 키 |
| 프롬프트 원문 | `prompt` 키 |
| OS 절대경로 | `C:\…`, `/Users/…`, `/home/…` |
| 토큰 · 비밀값 | `sk-…`, `ghp_…`, `scheme://user:pass@` |
| 쿠키 · 이메일 | `cookie`, 이메일 주소 |

### 2.4 경고 메시지

서버의 Java `rules` 모듈이 이벤트를 저장할 때마다 공통 검증 사례와 일치하는 경고 규칙을 멤버별로 실행하고, 새로 생긴 경고만 보낸다. 같은 `(workspaceId, recipientId, key)`는 한 번만 만든다.

```ts
type Alert = {
  id: string; workspaceId: string; recipientId: string;
  key: string;                         // 예: "db|u_minsu|prisma/schema.prisma"
  type: "db" | "dep" | "env" | "sim";
  severity: "high" | "medium" | "info";
  title: string;                       // "DB 스키마 충돌 가능"
  fromUserId: string;
  file?: string; branch?: string;
  myRunId?: string; otherRunId?: string;   // type "sim"
  rule: string;                        // 판단 근거 문장 (PRD FR-15 "근거 표시")
  evidence: string[];                  // Event.id
  actions: Array<"notify" | "evidence" | "restart" | "peek" | "dismiss">;
  status: "new" | "dismissed" | "notified" | "handled";
  createdAt: string;
};
```

| type | 규칙 (프로토타입 `computeAlerts`와 같음) | 받는 사람 |
|---|---|---|
| `db` | 다른 팀원이 기준 브랜치가 아닌 곳에서 `db-schema` 파일 변경 + 나에게 실행 중인 에이전트가 있음 | 실행 중인 에이전트가 있는 다른 멤버 |
| `dep` | 같은 조건, `dependency` 파일 | 위와 같음 |
| `env` | `infra` 파일 변경. 기준 브랜치 반영이면 `restart` 버튼 | 작성자 외 멤버 전원 |
| `sim` | 실행 중인 두 에이전트의 제목 유사도 ≥ 0.25 또는 같은 폴더(`dirKey`) 수정 | 두 실행의 주인 양쪽 |

`body`(HTML 문장)는 서버가 보내지 않는다. 화면 문구는 클라이언트가 위 필드로 만든다.

---

## 3. 데스크톱 IPC — `window.cadora` (preload)

renderer는 Node·파일 시스템에 직접 접근하지 않는다(`contextIsolation: true`, `nodeIntegration: false`). 계약은 `packages/protocol/src/ipc.ts`에 두고 main·preload·renderer가 같은 타입을 쓴다.

```ts
interface CadoraAPI {
  workspace: {
    list(): Promise<LocalWorkspace[]>;                       // 개인 + 팀(개인 층 포함)
    create(input: CreateWorkspaceInput): Promise<LocalWorkspace>;   // FR-01
    update(id: string, patch: { name?: string; settings?: Partial<LocalWorkspaceSettings> }): Promise<LocalWorkspace>;
    remove(id: string): Promise<void>;
    activate(id: string): Promise<void>;                     // 전면 표시
    setState(id: string, state: "background" | "sleep"): Promise<void>;   // FR-04
  };
  browser: {
    openTab(wsId: string, url: string, opts?: { pinned?: boolean }): Promise<TabInfo>;
    closeTab(wsId: string, tabId: string): Promise<void>;
    listTabs(wsId: string): Promise<{ shared: TabInfo[]; private: TabInfo[] }>;   // FR-08
    showView(wsId: string, tabId: string, bounds: Rect): Promise<void>;   // WebContentsView 배치
    openDownloadFolder(wsId: string): Promise<void>;
    openExternal(wsId: string, url: string): Promise<void>;      // S1 대안: 외부 브라우저 프로필
  };
  scripts: {
    start(wsId: string, scriptId: string): Promise<ProcessInfo>;   // FR-03
    stop(wsId: string, scriptId: string): Promise<void>;
    list(wsId: string): Promise<ProcessInfo[]>;
  };
  agents: {
    start(wsId: string, input: { tool: Tool; taskTitle: string; branch?: string; newWorktree?: boolean }): Promise<LocalAgentRunInfo>;  // FR-11
    stop(runId: string): Promise<void>;
    list(wsId: string): Promise<LocalAgentRunInfo[]>;
    suggestBranch(taskTitle: string): Promise<string>;        // core.suggestBranch
  };
  terminal: {
    open(target: { runId: string } | { wsId: string; shell?: "powershell" | "cmd" }): Promise<{ termId: string }>;
    write(termId: string, data: string): void;
    resize(termId: string, cols: number, rows: number): void;
    close(termId: string): Promise<void>;
  };
  team: {
    login(): Promise<{ userCode: string; verificationUri: string }>;   // Device Flow 시작
    me(): Promise<Me | null>;
    logout(): Promise<void>;
    getPrivacy(wsId: string): Promise<{ shareTaskTitle: boolean }>;
    listMembers(wsId: string): Promise<Member[]>;
    updateMemberRole(wsId: string, userId: string, role: Role): Promise<void>;
    removeMember(wsId: string, userId: string): Promise<void>;
    listInvites(wsId: string): Promise<Invite[]>;
    revokeInvite(inviteId: string): Promise<void>;
    createWorkspace(input: { name: string; type: WorkspaceType; fromLocalId?: string }): Promise<LocalWorkspace>;
    invite(wsId: string, role: Role): Promise<{ url: string; expiresAt: string }>;
    previewInvite(code: string): Promise<InvitePreview>;
    acceptInvite(code: string, localPath: string): Promise<LocalWorkspace>;
    getConfig(wsId: string): Promise<{ version: number; config: SharedConfig | ViewerConfig }>;
    putConfig(wsId: string, baseVersion: number, config: SharedConfig, summary: string): Promise<{ version: number }>;
    applyPending(wsId: string, approve: string[]): Promise<void>;   // 승인 필요 변경 적용
    setShareTaskTitle(wsId: string, on: boolean): Promise<void>;
  };
  alerts: {
    list(wsId: string): Promise<Alert[]>;
    evidence(alertId: string): Promise<TeamEvent[]>;
    act(alertId: string, action: "dismiss" | "handled"): Promise<void>;
    notifyAgent(alertId: string, runId: string): Promise<{ delivered: boolean }>;  // FR-16, 사용자 승인 후
    feedback(alertId: string, useful: boolean): Promise<void>;
  };
  on<E extends keyof CadoraEvents>(event: E, cb: (payload: CadoraEvents[E]) => void): () => void;
}

interface CadoraEvents {
  "workspace:changed": LocalWorkspace;
  "team:inviteReceived": { code: string };
  "team:authChanged": { status: "pending" | "authenticated" | "expired" | "denied" | "logged_out" };
  "download:done": { wsId: string; fileName: string; savedTo: string };        // FR-05 알림
  "process:state": ProcessInfo;
  "agent:status": { runId: string; status: AgentStatus; last?: string };
  "file:changed": { wsId: string; relativePath: string; category: string; branch: string };
  "terminal:data": { termId: string; data: string };
  "terminal:error": { termId: string; operation: "write" | "resize"; code: string; message: string };
  "team:event": TeamEvent;                // §2.3, 다른 멤버 이벤트
  "team:presence": { wsId: string; userId: string; state: string };
  "config:pending": { wsId: string; version: number; changes: ConfigChange[] }; // 승인 대기
  "alert:new": Alert;
  "sync:status": { online: boolean; queued: number };
}

type LocalWorkspace = {
  id: string; kind: "personal" | "team"; remoteId?: string;
  name: string; type: WorkspaceType;
  state: "active" | "background" | "sleep";
  settings: LocalWorkspaceSettings;
  appliedConfigVersion?: number;
};
type LocalWorkspaceSettings = {
  localPath: string;                 // 로컬에만 저장, 서버 전송 금지
  partition: string;                 // "persist:ws_<id>"
  downloadDir: string;               // 기본 <localPath>/자료
  privateTabs: Array<{ id: string; title: string; url: string }>;
  env: Array<{ name: string; secretRef?: string; value?: string }>;   // value는 safeStorage
  scripts?: SharedConfig["scripts"]; // 개인 워크스페이스용
  aiScope: { tabs: boolean; files: boolean; terminal: boolean };       // 와이어프레임 03
};
```

---

## 4. 로컬 Hook 수신 (Claude Code → 데스크톱, FR-13)

### 4.1 흐름

```
Claude Code ──(hook 명령 실행, stdin JSON)──▶ hook-relay.cjs ──POST 127.0.0.1──▶ HookReceiver
                                                                               │ core로 정제
                                                                               ▼
                                                              agent_status / agent_activity / file_change
```

1. 에이전트를 실행할 때 데스크톱이 워크트리의 `.claude/settings.local.json`에 Cadora hook을 넣는다. 이 파일은 `.git/info/exclude`에 추가해 커밋되지 않게 한다.
2. 에이전트 프로세스 환경변수로 `CADORA_HOOK_URL`, `CADORA_HOOK_TOKEN`(실행마다 새로 발급), `CADORA_RUN_ID`를 넣는다. hook 프로세스가 이 값을 물려받는지 스파이크 S3에서 확인한다.
3. `hook-relay.cjs`는 stdin을 그대로 POST하고 **항상 0으로 종료**한다. Cadora가 꺼져 있어도 에이전트를 막지 않는다.

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "node \"C:/Program Files/Cadora/resources/hook-relay.cjs\"" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"…/hook-relay.cjs\"" }] }],
    "PostToolUse":      [{ "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command", "command": "node \"…/hook-relay.cjs\"" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "node \"…/hook-relay.cjs\"" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node \"…/hook-relay.cjs\"" }] }],
    "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node \"…/hook-relay.cjs\"" }] }]
  }
}
```

### 4.2 수신 엔드포인트

```
POST http://127.0.0.1:<임의 포트>/hooks
X-Cadora-Token: <CADORA_HOOK_TOKEN>
X-Cadora-Run: <CADORA_RUN_ID>
Content-Type: application/json
<Claude Code가 hook에 넘긴 JSON 그대로>
```

- 127.0.0.1에만 바인딩하고, 토큰이 실행 중인 run과 맞지 않으면 401.
- 원본 JSON은 **메모리에서 정제 후 버린다.** 디스크 로그에도 원본을 남기지 않는다(FR-19).

### 4.3 정제 규칙 (원본 → 팀 이벤트)

| Hook | 꺼내는 것 | 버리는 것 | 만드는 이벤트 |
|---|---|---|---|
| `SessionStart` | — | session_id, transcript_path, cwd | `agent_status(working, source: hook)` |
| `UserPromptSubmit` | 시각만 | **prompt 전체**, session_id, cwd | `agent_activity(user_input)` |
| `PostToolUse` (Edit/Write/MultiEdit) | `tool_input.file_path` → `core.toRelative` → `core.classify` | old_string, new_string, content, tool_response | `file_change(source: hook:PostToolUse)` (제외·민감 파일이면 없음) |
| `Notification` | 알림 종류 | 메시지 원문 | `agent_status(waiting)` |
| `Stop` | — | — | `agent_status(done)` |
| `SessionEnd` | — | — | `agent_run(status: exited)` |

같은 파일 변경을 hook과 chokidar가 모두 잡으면 1초 안의 같은 `relativePath`는 hook 쪽만 보낸다.

---

## 5. 에이전트 런타임 어댑터 (데스크톱 내부)

### 5.1 인터페이스

```ts
interface AgentRuntime {
  readonly kind: "herdr" | "pty";
  ensureWorkspace(ws: { id: string; cwd: string; env: Record<string, string> }): Promise<void>;
  startAgent(opts: {
    wsId: string; runId: string; tool: Tool; cwd: string;
    env: Record<string, string>;      // 비밀값 + CADORA_HOOK_* 포함
    args?: string[];
  }): Promise<{ handle: string }>;    // Herdr pane_id 또는 pty pid
  stopAgent(handle: string): Promise<void>;      // Windows는 프로세스 트리까지 종료
  sendPrompt(handle: string, text: string): Promise<void>;   // FR-16
  attach(handle: string): TerminalStream;        // xterm.js 연결
  onStatus(cb: (e: { handle: string; status: AgentStatus; message?: string }) => void): () => void;
  dispose(): Promise<void>;
}
```

### 5.2 HerdrRuntime — Herdr 소켓 API 대응

Herdr 서버의 로컬 소켓(Windows는 named pipe)에 줄 단위 JSON으로 요청한다. 정확한 파라미터는 설치한 버전에서 `herdr api schema --json`으로 확인하고 버전을 고정한다.

| AgentRuntime | Herdr | 메모 |
|---|---|---|
| `ensureWorkspace` | 세션 `cadora-<wsId>` 서버 시작 → `workspace.create` | 세션 이름 규칙으로 워크스페이스와 1:1 |
| `startAgent` | `agent.start` (또는 `pane.split` 후 `pane.send_input`) | 환경변수 전달 방식은 S2에서 확인 |
| `stopAgent` | `pane.close` | |
| `sendPrompt` | `agent.prompt` | 상태가 `blocked`·`idle`일 때만 보내고, 아니면 대기열 |
| `attach` | `herdr terminal attach <id>`를 node-pty로 실행해 xterm.js에 연결 | 또는 사용자 터미널에 맡김 |
| `onStatus` | `events.subscribe` → `pane.agent_status_changed` | |

### 5.3 상태 대응표

| Herdr | hook / 프로세스 | Cadora `agent_status` | 화면 문구 |
|---|---|---|---|
| `working` | SessionStart, PostToolUse | `working` | 작업 중 |
| `blocked` | Notification | `waiting` | 내 확인 필요 |
| `done` | Stop | `done` | 완료 (아직 안 봄) |
| `idle` | Stop 이후 확인함 | `idle` | 대기 |
| `unknown` | 프로세스만 살아 있음 | `unknown` | 상태 모름 (관찰 수준: 프로세스) |

### 5.4 PtyRuntime

node-pty(ConPTY)로 `claude` / `codex`를 워크스페이스 cwd와 env로 실행한다. 상태는 hook(Claude Code) 또는 프로세스 생존 여부(Codex)로만 판단하므로 `observe`가 `hooks` 또는 `process`가 된다. Windows 종료는 `taskkill /PID <pid> /T /F`로 프로세스 트리를 정리한다.

---

## 6. 확정된 구현 계약

이 절은 §0~5의 세부 동작을 정의한다. 데스크톱 API 타입과 검증은 `packages/protocol`에, 서버 타입과 검증은 Java에 구현하고 공통 계약 사례로 일치를 검증한다. 역할 변경, 개인정보와 인증은 클라이언트와 서버 경계 모두에서 검증한다.

### 6.1 공통 데이터 타입

```ts
type Role = "LEADER" | "MEMBER" | "VIEWER";
type WorkspaceType = "DEV_TEAM" | "ASSIGNMENT" | "CONTEST" | "CUSTOM";
type Seq = string; // 0 또는 선행 0 없는 양의 10진수. 서버 BigInt 범위까지
type User = { id: string; displayName: string; avatarUrl: string | null };
type Workspace = { id: string; name: string; type: WorkspaceType; configVersion: number; discordUrl: string | null };
type Me = User & { workspaces: Array<{ id: string; name: string; role: Role }> };
type Member = { userId: string; displayName: string; role: Role; appliedVersion: number; onboarding: Onboarding | null; online: boolean };
type Invite = { id: string; role: Role; expiresAt: string };
type Onboarding = {
  steps: Array<{ id: "clone" | "install" | "secrets" | "services" | "server"; status: "pending" | "running" | "done" | "failed" | "skipped"; detail?: string }>;
  services: Array<{ id: string; done: boolean }>;
};
type AgentStatus = "working" | "waiting" | "idle" | "done" | "unknown";
type AgentRunInfo = { id: string; workspaceId: string; userId: string; tool: Tool; taskTitle: string | null; branch: string; runStatus: "running" | "stopped" | "exited" | "error"; agentStatus: AgentStatus; observe: Observe; lastActivityAt: string | null };
type LocalAgentRunInfo = Omit<AgentRunInfo, "userId"> & { userId: string | null };
type ProcessInfo = { id: string; workspaceId: string; scriptId: string; status: "running" | "stopped" | "exited" | "error"; exitCode: number | null };
type TabInfo = { id: string; title: string; url: string; pinned: boolean };
type Rect = { x: number; y: number; width: number; height: number };
type InvitePreview = { workspaceName: string; inviterName: string; role: Role; expiresAt: string };
type TeamEvent = EventBase & ({ type: "agent_run"; agentRunId: string; tool: Tool; taskTitle: string | null; branch: string; status: "running" | "stopped" | "exited" | "error"; observe: Observe }
  | { type: "agent_status"; agentRunId: string; status: AgentStatus; source: "herdr" | "hook" | "process" }
  | { type: "agent_activity"; agentRunId: string; activity: "user_input" | "tool_use" | "turn_end" }
  | { type: "file_change"; agentRunId: string | null; tool: Tool | null; taskTitle: string | null; branch: string; relativePath: string; changeType: "added" | "modified" | "deleted"; category: "db-schema" | "dependency" | "infra" | "test" | "api" | "ui" | "docs" | "code"; source: "hook:PostToolUse" | "watcher" | "git" });
type CreateWorkspaceInput = { name: string; type: WorkspaceType; settings: LocalWorkspaceSettings };
type ConfigChange = { id: string; path: string; requiresApproval: boolean };
type ViewerConfig = Pick<SharedConfig, "repo" | "pinnedTabs" | "materials" | "services">;
```

서버 API의 `Workspace.id`는 원격 ID다. `window.cadora`의 `wsId`는 달리 적지 않으면 로컬 ID이며 main이 팀 워크스페이스의 `remoteId`로 변환한다. `AgentRunInfo.workspaceId`는 서버에서 원격 ID이고 `LocalAgentRunInfo.workspaceId`와 IPC의 `ProcessInfo.workspaceId`는 로컬 ID다. `LocalAgentRunInfo.userId`는 개인 작업공간이면 null, 팀 작업공간이면 인증된 서버 사용자 ID다. 원격 `AgentRunInfo.userId`와 `TeamEvent.userId`는 null이 아니다. `Seq`는 REST·WebSocket에서 10진 문자열로 전송하고 `afterSeq` 쿼리도 같은 형식이다. 초기 커서는 `"0"`이다.

### 6.2 IPC와 로컬 소유권

`workspace.update`는 로컬 이름과 개인 설정을 갱신한다. 팀의 공유 이름 변경은 LEADER가 서버 `PATCH /workspaces/:id`를 사용하며 로컬 이름 갱신과 별도로 처리한다. `browser.openDownloadFolder`는 main이 로컬 설정에서 경로를 찾아 연다. `alerts.evidence`는 해당 경고 수신자만 정제된 이벤트 목록을 받는다.

`team:inviteReceived`는 main이 검증한 초대 코드만 전달한다. 앱 준비 전 링크는 큐에 보관하여 구독 준비 후 한 번 전달한다. 인증 상태는 `team:authChanged`로 통지하며 토큰은 renderer에 전달하지 않는다. `team.logout`은 현재 기기의 인증 세션을 폐기한다. `getPrivacy`는 현재 팀의 본인 설정을 반환한다.

IPC의 `Promise` 실패는 직렬화 가능한 `{ code, message, details? }` 오류로 전달하고 `code`는 §0의 REST 오류와 같은 의미로 사용한다. 민감한 원문은 오류나 로그에 넣지 않는다. `on`이 반환한 함수는 리스너를 제거한다.

### 6.3 인증과 권한

- GitHub Device Flow는 발급받은 `interval` 이상을 기다리며 polling한다. 승인 전은 202 `pending`, 사용자 거부는 403 `device_denied`, 기기 코드 만료는 410 `device_expired`, 과도한 polling은 429 `slow_down`과 `details.retryAfterSeconds`를 반환한다. 만료·거부 후 새 코드를 발급한다.
- refresh token은 기기별 세션으로 관리하며 서버에는 해시만 저장한다. 만료 기간은 30일이다. 갱신은 원자적으로 새 토큰을 발급하고 이전 토큰을 폐기한다. 재사용을 감지하면 해당 세션 계열을 폐기하고 재로그인을 요구한다. 클라이언트는 동시 갱신을 하나로 합치며 갱신 응답 유실 시 재로그인한다. 로컬 refresh token은 safeStorage로 보호한다.
- `LEADER`는 멤버 기능과 팀·설정·초대·멤버 관리를 수행한다. `MEMBER`는 팀 정보·설정·활동을 조회하고 자신의 이벤트와 동기화 상태를 발행한다. `VIEWER`는 팀 기본 정보와 공용 설정·자료만 조회하며 팀 활동·이벤트·경고 조회, 이벤트 발행과 팀 변경은 허용하지 않는다. 모든 역할은 자신의 제목 공유 설정을 변경할 수 있다. VIEWER는 설정 변경 알림만 구독할 수 있고 팀 활동·멤버 상태·이벤트·경고를 구독하거나 발행할 수 없다. 탈퇴 시 기존 구독을 해제한다.
- 마지막 LEADER의 탈퇴·강등은 409 `last_leader`로 거부한다. 팀 삭제는 LEADER만 수행한다. 이 규칙은 UI뿐 아니라 서버에서 강제한다.
- 초대는 1인 수락이며 MEMBER 또는 VIEWER만 초대할 수 있다. 이미 가입한 사용자가 새 초대를 수락해도 기존 역할은 유지한다. 같은 수락자가 여전히 팀에 속해 있으면 초대 만료·회수 후에도 기존 가입 결과를 반환하고, 다른 사용자의 재수락은 409 `invite_already_used`다. 미수락 초대의 만료·회수는 410이다. 초대 수락과 멤버십 생성은 원자적으로 처리한다.

### 6.4 이벤트 재전송과 재연결

1. main은 개인정보 검사를 통과한 팀 이벤트만 계정·팀별 영속 큐에 저장한다. 서버는 인증과 소속을 확인한 후 저장·실행 요약·경고를 원자적으로 처리하고 커밋 후 ACK한다.
2. 서버의 중복 확인 기록이 유지되는 동안 같은 사용자·팀·정규화된 내용으로 같은 UUID를 재전송하면 원래 `seq`를 ACK하고 경고를 다시 만들지 않는다. 내용이나 소유자가 다른 ID 재사용은 `event_id_conflict`로 거부한다. 다른 계정의 큐는 전송하지 않는다. 기록 만료 이후의 중복 제거는 보장하지 않으며 로컬 자동 재전송 기한은 §7.5를 따른다.
3. 서버는 워크스페이스별 이벤트 수신을 직렬화하여 같은 팀의 순번과 커밋 순서가 일치하게 한다. 전역 seq의 팀 내 결번은 허용한다. 클라이언트는 ACK를 받은 송신 항목만 삭제한다.
4. 재접속 시 `afterSeq` 이후 이벤트를 순서대로 다시 받는다. 서버는 구독 등록과 재생 사이의 실시간 이벤트를 버퍼링해 누락 없이 전달한다. 클라이언트는 ID로 중복을 제거하고 처리된 순서대로 수신 커서를 저장한다.
5. 설정·경고·멤버·활성 실행은 재연결 후 REST로 다시 조회한다. 조회와 실시간 알림이 겹치면 변경 알림을 버퍼링하고 조회 완료 후 처리하며 설정은 버전을 비교한다. 접속 상태는 연결별 일시 상태로 계산한다.

### 6.5 상태, 공개 범위, 경고

Hook `Stop`은 `done`이다. 사용자 확인을 감지하면 `idle`, 새 작업 시작은 `working`이다. 확인을 감지할 수 없으면 `done`을 유지한다. 프로세스의 `agent_run` 종료와는 별개다.

`shareTaskTitle`을 끄면 이후 이벤트와 실행 요약의 제목은 null이다. 기존 이력이나 파생 경고는 자동 삭제하지 않으며 UI에서 이를 안내한다. 기존 이력 삭제 API는 P0에 포함하지 않는다.

경고 중복은 `(workspaceId, recipientId, key)` 기준이다. 목록 상태 필터는 §1.8의 대문자, 응답 status는 §2.4의 소문자를 사용한다. 입력 변환은 서버에서 수행한다. 각 수신자는 자신의 경고·근거·피드백만 조회하거나 수정하며 원인 사용자에게는 `alert.caused`의 최소 정보만 보낸다.

### 6.6 개인정보와 안전한 공유

이벤트의 허용 필드만 받고 §2.3의 금지 필드 검사를 로컬·서버 양쪽에서 실행한다. 프로젝트 기준 상대경로만 팀 이벤트로 전송한다. 인증정보·개인 브라우저 세션·개인 탭·OS 절대경로·코드와 프롬프트 원문은 이벤트와 로그에 기록하지 않는다. 공유 설정의 `aiRules.content`는 팀장이 의도적으로 입력한 공유 규칙으로 이벤트 코드 본문 금지와 구분한다. 서버 비밀값 금고는 P1이며 §1.9의 보안 설계 전 구현하지 않는다.

### 6.7 P0 검증 시나리오

1. A가 팀을 만들고 B를 초대한다. B의 재수락은 멱등이고 C의 동일 초대 사용은 거부된다. 마지막 팀장의 탈퇴·강등은 거부된다.
2. A의 공유 탭 변경이 B에 반영되고 B의 개인 탭은 유지된다. 설치·스크립트·재시작은 사용자 승인 후에만 수행된다.
3. A의 DB 스키마 변경과 B의 실행 중인 에이전트가 있을 때 B에게만 경고와 근거를 표시한다. 다른 팀 사용자와 VIEWER는 활동·경고를 조회할 수 없다.
4. ACK 유실과 재접속 후 이벤트는 중복 저장 없이 재생되며, 코드·프롬프트·자격증명·절대경로는 원격 이벤트와 로그에 없다.

---

## 7. P0 REST 구현 세부 계약

이 절의 타입 표기는 §1과 §6의 타입을 사용한다. `?`는 필드 생략 가능, `| null`은 필드가 존재하며 값이 null일 수 있음을 뜻한다. 이 절의 응답에서 명시하지 않은 필드는 보내지 않는다. JSON 요청의 `Content-Type`은 `application/json`, 시각은 §0을 따른다. API 경로에는 §0의 `/v1`이 앞에 붙는다. `204`는 본문이 없다.

### 7.1 인증과 오류

| 요청 | 인증 | 요청 본문 | 성공 응답 | 추가 오류 |
|---|---|---|---|---|
| `POST /auth/github/device` | 불필요 | `{}` | 200 `{ deviceCode: string, userCode: string, verificationUri: string, interval: number, expiresIn: number }` | 인증 제공자 장애 시 503 |
| `POST /auth/github/poll` | 불필요 | `{ deviceCode: string }` | 대기 202 `{ status: "pending" }`; 완료 200 `{ accessToken: string, refreshToken: string, user: User }` | §6.3 거부·만료·간격 초과 |
| `POST /auth/refresh` | 불필요 | `{ refreshToken: string }` | 200 `{ accessToken: string, refreshToken: string }` | 유효하지 않거나 폐기된 토큰 401 |
| `POST /auth/logout` | access token | `{ refreshToken: string }` | 204 | 본인 세션이 아닌 토큰 403; 유효하지 않은 토큰 401 |
| `POST /auth/dev-login` | 불필요 | `{ displayName: string }` | 200 `{ accessToken: string, refreshToken: string, user: User }` | production에서는 404 |
| `GET /me` | access token | 없음 | 200 `Me` | 공통 오류 |

`interval`, `expiresIn`과 `details.retryAfterSeconds` 단위는 초다. Device Flow는 로그인된 Cadora 사용자와 무관한 사전 인증 단계다. 기기 코드·토큰은 로그에 남기지 않는다. access token은 §0의 15분, refresh token은 §6.3의 30일을 따른다.

공통 오류는 §0의 `{ "error": { "code": string, "message": string, "details"?: object } }`다. 요청 JSON 형식 오류·누락된 필수 필드·허용하지 않은 열거값은 400 `invalid_request`; 인증 실패는 401 `unauthenticated`; 권한 실패는 403 `forbidden`; 자원이 없거나 이 API에서 숨기는 자원은 404 `not_found`다. JSON 필드 검증 실패 시 `details.fields`는 `{ path: string, message: string }[]`를 사용할 수 있으며 요청 원문은 포함하지 않는다. 예상하지 못한 서버 오류는 500 `internal_error`, 외부 인증 제공자 장애는 503 `provider_unavailable`로 반환한다.

```json
{
  "error": {
    "code": "invalid_request",
    "message": "요청 값을 확인하세요.",
    "details": { "fields": [{ "path": "name", "message": "이름이 필요합니다." }] }
  }
}
```

### 7.2 워크스페이스와 멤버

모든 항목은 access token을 요구하며 `:id`는 서버 워크스페이스 ID다. 아래의 `WorkspaceDetail`은 `Workspace & { myRole: Role }`이다. `Workspace`와 `discordUrl`의 null 처리는 §6.1을 따른다.

| 요청 | 요청 본문 | 성공 응답 | 권한·조건 |
|---|---|---|---|
| `POST /workspaces` | `{ name: string, type: WorkspaceType, config?: SharedConfig }` | 201 `Workspace` | 로그인 사용자. 생성자는 LEADER. config가 있으면 version 1, 없으면 0 |
| `GET /workspaces` | 없음 | 200 `WorkspaceDetail[]` | 본인이 속한 팀만 반환 |
| `GET /workspaces/:id` | 없음 | 200 `WorkspaceDetail` | 현재 멤버 |
| `PATCH /workspaces/:id` | `{ name?: string, discordUrl?: string 또는 null }` | 200 `Workspace` | LEADER. 적어도 한 필드 필요; null은 Discord 링크 삭제 |
| `DELETE /workspaces/:id` | 없음 | 204 | LEADER |
| `GET /workspaces/:id/members` | 없음 | 200 `Member[]` | LEADER 또는 MEMBER |
| `PATCH /workspaces/:id/members/:userId` | `{ role: Role }` | 200 `Member` | LEADER; 마지막 LEADER 강등은 409 `last_leader` |
| `DELETE /workspaces/:id/members/:userId` | 없음 | 204 | LEADER 또는 본인; 마지막 LEADER 탈퇴는 409 `last_leader` |
| `GET /workspaces/:id/members/me/privacy` | 없음 | 200 `{ shareTaskTitle: boolean }` | 본인 |
| `PATCH /workspaces/:id/members/me/privacy` | `{ shareTaskTitle: boolean }` | 200 `{ shareTaskTitle: boolean }` | 본인 |

`GET /workspaces`는 가입된 팀이 없으면 `[]`다. ID가 같은 사용자의 멤버십은 팀당 하나다. 서버에서 `userId`를 인증 주체로부터 확인하며, 클라이언트가 다른 사람의 개인정보 설정이나 온보딩을 변경할 수 없다. `VIEWER`의 팀 기본 정보·공용 설정 외 접근 제한은 §6.3을 따른다.

### 7.3 설정과 초대

`ConfigSnapshot = { version: number, config: SharedConfig | ViewerConfig, authorId: string, createdAt: string }`, `ConfigHistoryItem = { version: number, authorId: string, createdAt: string, summary: string }`이다. 버전은 워크스페이스별 1부터 증가한다. 버전 0은 스냅샷이 없는 상태다.

| 요청 | 요청·조건 | 성공 응답 | 주요 오류 |
|---|---|---|---|
| `GET /workspaces/:id/config` | 멤버 | 200 `ConfigSnapshot` | 스냅샷이 없으면 404 `not_found` |
| `GET /workspaces/:id/config/:version` | 멤버; 양의 정수 버전 | 200 `ConfigSnapshot` | 해당 버전 없음 404 |
| `GET /workspaces/:id/config/history?limit=20` | LEADER·MEMBER; 최신순 | 200 `ConfigHistoryItem[]` | 잘못된 limit 400 |
| `PUT /workspaces/:id/config` | LEADER; `{ baseVersion: number, config: SharedConfig, summary: string }` | 200 `{ version: number }` | 현재 버전과 불일치 시 409 `config_conflict`, `details.current`에 현재 버전 |
| `PUT /workspaces/:id/members/me/sync` | 본인; `{ appliedVersion: number, onboarding: Onboarding }` | 204 | 존재하지 않는 적용 버전이나 최신보다 큰 버전은 400 |
| `POST /workspaces/:id/invites` | LEADER; `{ role: Role, expiresInHours: number }` | 201 `{ id: string, code: string, url: string, expiresAt: string }` | 잘못된 역할·만료시간 400 |
| `GET /workspaces/:id/invites` | LEADER; 미수락·미회수·미만료만 | 200 `Invite[]` | 공통 오류 |
| `DELETE /invites/:inviteId` | 해당 팀 LEADER | 204 | 없는 초대 404 |
| `GET /invites/:code` | 로그인 | 200 `InvitePreview` | 만료·회수 410 `invite_expired` |
| `POST /invites/:code/accept` | 로그인; `{}` | 200 `{ workspace: Workspace, config: ConfigSnapshot 또는 null }` | 만료·회수 410; 다른 사용자가 이미 수락 409 |

설정이 없는 팀의 초대 수락은 `config: null`이다. 처음 설정할 때 `baseVersion: 0`을 사용한다. 초대 수락 재요청의 멱등성·최종 팀장 보호는 §6.3을 따른다. `summary`는 이력에 표시되는 작성자 제공 요약이며 민감한 정보가 포함되지 않도록 검증한다. 입력 제한과 초대 역할은 §10.2·§10.3을 따른다.

### 7.4 이벤트와 경고 조회

```ts
type SequencedEvent = { seq: Seq; event: TeamEvent };
```

| 요청 | 요청·조건 | 성공 응답 |
|---|---|---|
| `GET /workspaces/:id/events?afterSeq=1200&limit=500` | LEADER·MEMBER; `afterSeq`는 §6.1의 문자열, 미지정 시 `0`; seq 오름차순 | 200 `SequencedEvent[]` |
| `GET /workspaces/:id/runs?active=true` | LEADER·MEMBER; active 생략 시 전체 | 200 `AgentRunInfo[]` |
| `GET /workspaces/:id/alerts?status=NEW,NOTIFIED` | 본인 경고; 상태 미지정 시 전체 | 200 `Alert[]` |
| `GET /alerts/:alertId/evidence` | 해당 경고 수신자 | 200 `TeamEvent[]` |
| `POST /alerts/:alertId/actions` | 수신자; `{ action: "dismiss" 또는 "notified" 또는 "handled" }` | 200 `Alert` |
| `POST /alerts/:alertId/feedback` | 수신자; `{ useful: boolean, note?: string }` | 204 |

모든 목록의 결과가 없으면 `[]`다. `afterSeq`가 `0`이면 유지 중인 가장 오래된 이벤트부터 조회한다. 이벤트별 커서는 응답 요소의 `seq`다. 동일한 사용자·팀·내용으로 재전송한 이벤트의 ACK는 원래 `seq`를 돌려준다(§6.4). 근거 목록은 `seq` 오름차순이며 `TeamEvent.id`와 §2.4의 `evidence`를 연결한다. 이벤트 조회 제한과 보존·복구 정책은 §7.5를 따른다.

### 7.5 이벤트 조회 제한과 보존 기간

- `limit`을 생략하면 **100**, 허용 범위는 **1~500**인 정수다. 0, 음수, 500 초과, 정수가 아닌 값 또는 빈 값은 400 `invalid_request`다.
- `afterSeq`를 생략하면 `"0"`이다. 쿼리 문자열에는 `afterSeq=1200`처럼 전달하며 0 또는 앞에 0이 없는 양의 10진수다. 부호, 공백, 소수, 빈 값 또는 서버의 signed 64-bit 정수 범위 초과는 400 `invalid_request`다.
- 이벤트는 클라이언트 시계가 아닌 서버 수신 시각 `receivedAt`을 기준으로 **최근 30일** 보관한다. 서버는 보존 기간 경과 후 삭제된 워크스페이스별 이벤트의 최대 `seq`를 삭제와 원자적으로 영속화해 **삭제 경계**로 유지한다. 경계가 없으면 `"0"`이다. 팀 내 정상적인 순번 결번과 실제 삭제를 구별하기 위해 가장 오래된 현재 이벤트만으로 삭제 여부를 판단하지 않는다.
- **후속 계획**: 초기 구현과 운영 기준은 이벤트·경고 각각 30일이며, 추후 프로젝트 기간을 고려해 이벤트·경고·경고 근거의 보존 기간을 함께 **90일로 연장할 계획**이다. 연장 시점은 정하지 않았고, 적용 전 DB 저장량·성능, 개인정보 보관 범위, 경고 근거와 UUID 중복 제거 기록의 보관 기간 및 오프라인 복구 정책을 검토한다. 이미 삭제된 이벤트는 기간을 늘려도 복구되지 않는다.
- `afterSeq`가 0보다 크고 해당 팀의 삭제 경계보다 작으면 일부 이력을 놓쳤을 가능성이 있으므로 410 `cursor_expired`를 반환한다. 경계와 같거나 크면 유효하다. 삭제 경계 이전을 실제로 모두 수신했더라도 서버가 이를 확인할 수 없으므로 동일하게 복구한다.
- `afterSeq=0`은 최초 진입 요청이므로 410 대신 현재 보관 중인 이력부터 반환한다. 과거에 삭제된 이력이 있으면 응답 헤더 `X-Cadora-History-Truncated: true`, 없으면 `false`를 보낸다. 재접속 클라이언트가 410을 받으면 사용자에게 누락된 이력을 알리고 §10.8의 기준 순번을 이용해 설정·멤버·활성 실행·경고를 다시 조회한다. `afterSeq=0` 조회는 유지 중인 활동 이력만 보여주며 삭제된 이력 복원을 보장하지 않는다.
- 성공 응답의 `SequencedEvent[]`는 `seq` 오름차순으로 최대 `limit`건이다. 클라이언트는 각 이벤트를 적용한 후 마지막으로 정상 처리한 순번을 커서로 저장한다. 응답 건수가 `limit`이면 같은 `limit`과 마지막 커서로 다음 페이지를 요청하고, 적으면 조회를 마친다. 실시간 이벤트와 겹치면 이벤트 ID로 중복을 제거한다.
- WebSocket `hello`의 팀별 `afterSeq`에도 같은 만료 판정을 적용한다. 만료된 팀은 재생하지 않고 `hello.ok.subscriptions`에 해당 팀의 `recovery_required`를 반환한다. 다른 팀의 구독에는 영향을 주지 않는다. 해당 팀은 §10.8의 기준 순번 기반 상태 재조회와 재구독 절차를 따른다. 스냅샷 연결 토큰과 응답은 §10.8.1을 따른다.
- 경고는 서버의 `createdAt` 기준 **30일** 동안 보관한다. 상태가 `new`, `dismissed`, `notified`, `handled` 중 무엇이든 만료 시 삭제하며 피드백도 함께 삭제한다. 만료된 경고는 정리 작업 실행 여부와 관계없이 목록·근거·수정 API에서 조회하거나 처리할 수 없다. 별도의 장기 피드백 보관은 P0 범위에 없다.
- 경고 생성 시 근거 이벤트의 §2.3 허용 필드만 복사한 최소 메타데이터 스냅샷을 경고에 연결해 원자적으로 저장한다. 여러 근거가 있으면 각각 저장하며 원본 `Event.id`와 `seq`를 유지한다. `GET /alerts/:alertId/evidence`는 이 스냅샷을 §7.4의 `TeamEvent[]` 형식으로 반환한다. 코드·프롬프트 원문과 비밀값은 저장하지 않는다.
- 원본 이벤트가 30일 뒤 삭제되어도 스냅샷은 경고의 생성 시각부터 30일 동안 유지한다. 경고가 만료되거나 팀이 삭제되면 해당 경고의 모든 스냅샷을 함께 삭제한다. 따라서 경고 근거 메타데이터는 원본 이벤트보다 오래 남을 수 있다. 이벤트·경고 각각의 기준 시각을 다르게 적용하므로, 여러 근거의 발생 시점이 달라도 근거가 먼저 사라지지 않는다.
- **중복 확인 기록**: 서버가 이벤트를 최초 처리·저장한 시각부터 최소 **90일** 동안 이벤트 UUID, 팀 ID, 사용자 ID, 기존 `seq`, 처리 시각과 정규화된 이벤트의 내용 비교용 해시를 원본 이벤트와 별도로 보관한다. 이벤트 저장·중복 확인 기록 생성·경고 처리는 같은 트랜잭션에서 확정한다. 기록이 유지되는 동안에는 원본 이벤트가 삭제되어도 재전송에 원래 `seq`를 ACK하고 경고를 다시 만들지 않는다. 근거 스냅샷은 중복 확인 기록으로 사용하지 않는다. 기록에는 이벤트 본문·파일 경로·코드·프롬프트·자격증명을 저장하지 않는다. 해시는 일치 판정에 쓰이는 정보이므로 접근을 제한하고 보존 기간 경과 후 삭제한다.
- **로컬 자동 재전송**: 각 항목은 로컬 큐에 최초 저장한 `queuedAt`부터 **30일 이내**에만 같은 UUID로 자동 재전송한다. 30일을 초과했거나 PC 시계 변경 등으로 경과 시간을 신뢰할 수 없는 항목은 자동 전송을 보류하고, 삭제하지 않은 채 사용자에게 미전송 항목과 보류 이유를 알린다. 보류 항목의 수동 재전송은 제공하지 않으며 사용자가 확인 후 명시적으로 삭제할 수 있다(§10.9). ACK가 없는 항목을 성공으로 표시하거나 자동 삭제하지 않는다.
- **시간 신뢰와 한계**: 실행 중에는 단조 시계와 시스템 시각 차이를 비교하고, 재시작 시 보관한 마지막 시각보다 시스템 시각이 과거로 이동한 경우 또는 서버 시각과 비교해 신뢰할 수 없는 경우 보류한다. 로컬 시각만으로 모든 시계 변경을 탐지할 수는 없다. 서버 수신 기준 90일과 로컬 큐 생성 시각은 서로 다르므로 이 정책만으로 모든 재전송의 중복 제거를 보장하지 않는다. P0 서버는 클라이언트 생성 시각을 신뢰 가능한 기한 증명으로 취급하지 않는다. 중복 기록이 남은 UUID는 기존 ACK 또는 `event_id_conflict`로 처리하고, 기록이 없는 UUID는 새 이벤트로 처리한다. 90일 경과 이후 중복 제거는 보장하지 않는다(§9). 팀 삭제 시 해당 중복 확인 기록도 함께 삭제한다.

```json
{
  "error": {
    "code": "cursor_expired",
    "message": "일부 이벤트 이력이 만료되어 현재 상태를 다시 조회해야 합니다.",
    "details": { "workspaceId": "ws_example" }
  }
}
```

## 8. WebSocket·IPC 구현 세부 계약

### 8.1 WebSocket 메시지

연결은 §2.1의 인증 헤더를 사용한다. 각 메시지는 UTF-8 JSON 객체 하나다. `rid`는 같은 연결에서 응답을 기다리는 요청을 구분하는 비어 있지 않은 문자열이며, 요청을 재시도할 때 새로운 `rid`를 사용할 수 있다. 이벤트 중복 제거는 `rid`가 아닌 `event.id`로 한다. `event.userId`는 서버가 인증된 사용자로 덮어쓴다.

```json
{ "t": "event.publish", "rid": "r42", "event": { "id": "6c1e4f7a-2b0d-4d8e-9a51-0f3b2c7d9e10", "v": 1, "type": "agent_activity", "workspaceId": "ws_example", "userId": "u_example", "at": "2026-11-23T05:10:00Z", "agentRunId": "1f9a0c2e-1234-4123-8123-123456789abc", "activity": "turn_end" } }
```

```json
{ "t": "ack", "rid": "r42", "eventId": "6c1e4f7a-2b0d-4d8e-9a51-0f3b2c7d9e10", "seq": "1201" }
```

```json
{ "t": "error", "rid": "r42", "code": "privacy_violation", "message": "공유할 수 없는 필드가 포함되어 있습니다." }
```

`hello`의 각 워크스페이스는 인증 주체가 접근 가능한 범위에서만 구독한다. §6.3에 따라 VIEWER는 설정 변경 알림만 구독하며 팀 활동을 구독·발행할 수 없다. `event.publish`의 검증·중복 처리·ACK 시점은 §6.4를 따른다. ACK 또는 error가 도착하지 않은 요청은 전송 성공으로 처리하지 않는다. `event_id_conflict`, `privacy_violation`, `forbidden`은 재전송을 무한 반복하지 않고 사용자에게 조치가 필요함을 표시한다.

`ping`은 §2.2대로 30초마다 보낸다. `presence.update`, `member.updated`, `config.updated`, `alert` 등은 이벤트 이력 조회에 포함되는 것으로 가정하지 않고 §6.4대로 재접속 후 REST에서 복구한다. 연결 종료·토큰 만료 감지 시 로컬 작업을 중단하지 않는다.

### 8.2 IPC 오류와 식별자

`window.cadora`의 워크스페이스 인자는 §6.1의 로컬 ID다. 서버 REST의 `:id`는 원격 ID이며 renderer가 원격 토큰이나 로컬 절대경로를 서버로 직접 전송하지 않는다. 팀 워크스페이스에서 main이 `remoteId`를 찾아 서버에 전달한다. 이벤트 구독자는 반환된 해제 함수를 화면 해제 시 호출한다.

정상 IPC 결과는 §3의 Promise 반환 타입 그대로다. main은 preload에 `{ ok: true, value }` 또는 `{ ok: false, error: { code, message, details? } }`를 직렬화해 전달하고 preload는 성공값을 resolve하거나 오류 객체를 reject한다. renderer에는 §3의 Promise 계약을 유지한다. main·preload는 Electron 예외 객체의 자동 직렬화에 의존하지 않으며 실제 전달을 #23에서 검증한다. `showView`와 `terminal.close`는 Promise로 오류를 반환한다. `terminal.write`·`resize`는 `terminal:error` 이벤트로 실패를 알린다(§10.7).

### 8.3 경계 테스트 사례

- **설정 충돌**: 현재 버전 3에서 `baseVersion: 2`로 저장하면 409 `config_conflict`, `details.current: 3`; 새 버전은 생성하지 않는다.
- **이벤트 재송신**: 이벤트 `id`가 같고 인증 주체·팀·정규화 내용이 같으면 첫 ACK와 같은 `seq`를 받는다. ID 재사용 내용이 다르면 `event_id_conflict`다.
- **개인정보**: 이벤트에 `prompt`, 코드 본문 또는 OS 절대경로가 있으면 WS `privacy_violation`으로 거부하고 저장·팬아웃하지 않는다.
- **권한**: 다른 팀의 이벤트·근거 요청과 VIEWER의 팀 활동 요청은 거부한다. 본인 경고의 근거만 조회할 수 있다.
- **온보딩**: 공유 설정의 설치·재시작 단계는 사용자가 승인하기 전 실행되지 않는다. 단계 실패를 표시해도 미완료 로그인 때문에 워크스페이스 진입을 강제 차단하지 않는다.
- **토큰 갱신**: 회전한 refresh token의 재사용을 감지하면 §6.3의 세션 계열 폐기 규칙을 적용한다. 토큰·deviceCode·개인 경로는 오류와 로그에 남지 않는다.

## 9. 구현 전 남은 검증과 후속 범위

§10의 결정 사항을 바탕으로 서버·데스크톱 계약 테스트를 구현한다. 다음은 제품 방향을 확정한 뒤에도 실제 환경 검증이나 별도 상세 설계가 필요한 항목이다.

- **오프라인 큐**: 서버는 클라이언트 시각을 재전송 기한의 증명으로 검증하지 않으며 중복 확인 기록 만료 이후에는 중복 제거를 보장하지 않는다. 기록이 없는 UUID는 새 이벤트로 처리한다. 보류 항목의 수동 재전송은 제공하지 않는다. #36·#37에서 시계 변경·로그아웃·탈퇴를 시험한다.
- **런타임 스파이크**: Herdr의 Windows named pipe·상태 감지와 Hook 환경변수 전달 방식은 #17·#18에서 확인한다. 실패하면 node-pty 대체 경로를 사용한다.
- **P1 비밀값**: §1.9는 보안 설계 후 확정할 P1 초안이다. 암호화·권한·리스·감사·회수 정책 전에는 구현하지 않는다.
- **P1 경고 전달·Discord·일정**: §10.11의 우선 범위에 따르며, 별도 기능 구현 전에 상세 API를 설계한다.
- **운영 배포**: Docker 환경의 실제 호스팅·백업·TLS·보존 용량은 배포 작업에서 결정한다.

## 10. P0 세부 결정과 검증 기준

이 절은 §1~§8의 확정 계약을 구체화한다. API 담당자의 승인에 따라 권장안을 반영했다. 기존 코드·프로토콜은 아직 구현되지 않았으므로 #23과 각 기능 이슈에서 Java·TypeScript 공통 계약 테스트를 작성한다.

### 10.1 VIEWER 전용 설정과 알림

VIEWER가 `GET /workspaces/:id/config` 또는 `GET /workspaces/:id/config/:version`을 호출하면 `ConfigSnapshot`의 `config`는 `ViewerConfig`만 포함한다. 기존 `version`, `authorId`, `createdAt` 메타데이터는 유지한다. `ViewerConfig`의 필드는 `repo`, `pinnedTabs`, `materials`, `services`이며 `repo`는 저장소 URL과 기준 브랜치 또는 null이다. 스크립트, AI 규칙, 감시 제외 목록, 비밀값 이름은 필드 자체를 반환하지 않는다. LEADER와 MEMBER에는 기존 `SharedConfig`를 제공한다. 설정 이력의 summary는 민감한 변경 정보를 포함할 수 있으므로 `GET /config/history`는 LEADER·MEMBER만 허용한다.

VIEWER가 초대를 수락할 때의 `config`도 동일한 `ViewerConfig` 필터를 적용한다. `team.getConfig`는 두 타입의 합집합을 반환하며 호출자는 역할에 따라 분기한다. `hello`는 VIEWER에게 `config.updated`의 workspaceId·version만 전달하고 authorId·summary는 생략한다. `member.updated`, presence, 이벤트, 활동·경고는 제공하지 않는다. 권한 검사는 UI가 아니라 서버에서 수행한다.

### 10.2 입력과 목록 제한

- 워크스페이스 이름은 앞뒤 공백 제거 후 Unicode 코드 포인트 기준 1~100자, 작업 제목은 같은 기준 1~200자다. 공백만 있으면 거부한다. 저장과 중복 비교에는 정규화된 이름을 사용한다.
- URL은 최대 2,048자다. 저장소 URL의 지원 형식과 외부 링크 허용 스킴은 기존 사용 흐름과 호환되도록 #23에서 검증하며, URL에 포함된 자격증명은 허용하지 않는다.
- JSON 요청 본문은 UTF-8 기준 최대 1 MiB다. 서버는 초과 시 413 `payload_too_large`, 잘못된 필드값은 400 `invalid_request`를 반환한다. UI도 같은 문자 수를 사전 검증한다.
- 설정 이력 `limit`은 기본 20, 최대 100이다. 1~100의 정수가 아니면 400 `invalid_request`를 반환한다. 반환 순서는 version 내림차순이다. 페이지 이어보기 인자는 아직 없으므로 이 범위의 최신 이력만 반환한다. 이벤트 목록은 §7.5의 100·500 규칙을 따른다.
- 기타 목록의 페이지네이션 계약은 각 목록이 필요한 규모와 함께 #23에서 추가한다. 빈 결과는 `[]`다.

### 10.3 초대의 경계 조건

- 초대 발급 시 role은 MEMBER 또는 VIEWER만 허용한다. LEADER 지정은 기존 LEADER의 멤버 역할 변경으로만 수행한다.
- 기존 멤버가 다른 미수락 초대를 수락하면 해당 초대를 현재 사용자에게 소비 처리하되 기존 멤버십의 role과 joinedAt은 변경하지 않는다. 수락 결과는 현재 워크스페이스와 현재 역할 범위에 맞는 설정이다.
- 이미 자신이 수락한 초대는 현재도 팀에 소속돼 있으면 만료·회수 여부보다 멱등 처리를 우선해 현재 가입 결과를 반환한다. 탈퇴한 상태에서는 과거 수락만으로 재가입시키지 않는다. 다른 사용자가 사용한 초대는 409 `invite_already_used`다. 미수락 초대가 만료·회수됐으면 410 `invite_expired`다.
- 초대 소비·기존 멤버십 확인 또는 신규 생성은 같은 DB 트랜잭션에서 처리한다. 같은 초대의 동시 수락 중 한 사용자만 성공한다.

### 10.4 경고 상태와 피드백

| 현재 상태 | action | 결과 |
|---|---|---|
| `new` | `dismiss` | `dismissed` |
| `new` | `notified` | `notified` (P1 전달 성공 후) |
| `new` 또는 `notified` | `handled` | `handled` |
| `notified` | `dismiss` | `dismissed` |
| `dismissed` / `notified` / `handled` | 현재 상태와 같은 action | 변경 없이 200과 현재 Alert |
| 그 외 조합 | 다른 action | 409 `alert_state_conflict`; 기존 상태 유지 |

P0 UI에는 에이전트 전달을 노출하지 않는다. `notified`는 P1에서 로컬 전달이 성공한 경우에만 보낸다. 종료된 경고를 다시 여는 API는 P0에 없다. 피드백은 수신자의 최신 `useful`·선택 `note`를 덮어쓰며, 경고 만료 시 삭제한다. 유용성 지표는 P0에서 보관 중인 최근 30일 평가만 집계한다.

### 10.5 실행 전 승인

`clone`, 패키지 설치, 팀 설정에 따른 자동 실행과 재시작은 실행 전 사용자의 명시적 승인을 받는다. 개인 스크립트를 사용자가 수동 실행하는 경우 UI에 실행 명령과 워크스페이스를 보여준 뒤 실행 버튼 클릭을 승인으로 본다. 팀 스크립트가 변경되면 기존 승인과 무관하게 변경된 명령의 실행 전 다시 승인한다. 사용자가 취소하면 명령은 실행하지 않고 해당 단계를 `skipped`로 기록하며 재시도할 수 있다. 팀 변경 중 탭·자료·링크는 즉시 반영한다. approval은 해당 워크스페이스·설정 버전·변경 항목에만 적용한다.

### 10.6 늦게 도착한 실행 이벤트

알려지지 않은 `agentRunId`를 포함한 이벤트는 인증된 사용자와 팀을 기록하여 보관한다. 실행의 소유권과 팀이 확인되기 전에는 해당 실행에 연결된 경고를 생성하지 않는다. 후속 실행 시작 이벤트가 도착하면 저장된 이벤트의 팀·소유자와 일치하는 경우에만 연결하여 순서대로 재처리한다. 불일치 이벤트는 실행과 연결하지 않으며 데이터 노출 없이 기록하고 사용자에게 동기화 오류를 알린다. 실행 정보가 끝내 도착하지 않은 이벤트는 보존 기한 동안 미확인 상태로 남기고 임의로 다른 사용자의 실행에 귀속하거나 경고로 사용하지 않는다. 원본 이벤트 보존·삭제는 §7.5를 따른다.

### 10.7 IPC 오류·타입과 승인 ID

- `browser.showView`와 `terminal.close`는 `Promise<void>`이며 실패 시 §6.2 오류를 반환한다. `terminal.write`·`resize`는 고빈도 스트림을 위해 void를 유지하고 `terminal:error`를 통해 termId·operation·code·message를 알린다. 종료된 termId에 대한 요청은 `not_found`로 거부하거나 오류 이벤트로 알린다.
- `AgentRunInfo.workspaceId`는 REST에서는 원격 ID이고 `LocalAgentRunInfo.workspaceId`는 IPC의 로컬 ID다. 개인 실행의 `userId`는 null이고 팀 실행은 서버 사용자 ID다(§6.1).
- `ConfigChange.id`는 같은 로컬 작업공간·대상 config version에서 고유한 승인 ID이며 `applyPending(wsId, approve)`는 해당 ID 목록을 받는다. 오래된 버전의 ID나 다른 작업공간 ID는 거부한다. `path`는 변경 표시용이고 승인 토큰으로 사용하지 않는다.
- `TerminalStream`은 main 내부의 양방향 데이터 채널이며 renderer 계약은 `terminal.open/write/resize/close`와 `terminal:data/error`다. Herdr 및 node-pty 구체 타입은 renderer에 노출하지 않는다.

### 10.8 WebSocket 구독과 재연결

`hello`에서 팀별 권한·커서를 각각 검증해 유효한 팀만 구독한다. `hello.ok.subscriptions`에서 팀별 상태를 `subscribed`, `recovery_required`, `forbidden`, `not_found` 중 하나로 반환하며 다른 팀 구독을 중단하지 않는다. 만료 커서는 `recovery_required`다. 전체 요청 처리가 끝나면 `hello.ok`를 한 번 보낸다. 누락 이력은 팀별 seq로 재생하고 진행 중 새 이벤트를 버퍼링한다.

인증 access token이 만료되면 서버는 WebSocket close code 4001로 연결을 종료하고 클라이언트는 refresh 후 재연결한다. 잘못된 첫 메시지는 1008, 메시지 1 MiB 초과는 1009, 서버 일시 오류는 1011로 연결을 종료한다. `hello.workspaces`는 최대 50개이며 초과·중복 팀 ID는 `invalid_request`로 거부한다. refresh 실패 시 로그인 상태를 갱신하고 로컬 작업을 계속한다. 버퍼에는 최대 500개 이벤트를 유지하며 초과 시 해당 팀 구독을 종료하고 `resync_required` 오류를 보낸다. 클라이언트는 마지막으로 안전하게 처리한 커서로 다시 재생한다. `member.updated`는 `{ workspaceId, userId }`만 전달하고 클라이언트가 권한에 맞는 멤버 목록을 다시 조회한다.

커서 만료 복구는 §10.8.1의 연결 전용 snapshot 구독과 일관된 REST 스냅샷을 사용한다. 단일 서버 프로세스의 메모리 버퍼를 이용하므로 P0는 서버 인스턴스 1개를 전제로 한다. 서버 재시작·연결 종료 시 스냅샷 토큰과 버퍼는 폐기하며 클라이언트는 복구를 처음부터 다시 시작한다. 다중 인스턴스는 공통 전달 계층을 설계하기 전 지원하지 않는다.

#### 10.8.1 스냅샷 기반 복구

동일 팀의 이벤트와 설정·멤버·경고 상태 변경은 같은 DB 직렬화 경계를 거친다. `stateRevision`은 팀별 부호 없는 10진수 문자열이고 최초 `"0"`에서 팀의 상태 변경 트랜잭션마다 증가한다. 이벤트 seq도 기존 §6.4를 따른다. 재생 또는 REST 읽기만으로 revision을 증가시키지 않는다. 저장소에는 event seq와 state revision을 함께 확정한다. 경고 상태·피드백과 설정·멤버의 변경도 revision을 증가시키며 알림은 커밋 후 보낸다.

1. `hello.ok`에서 팀 상태가 `recovery_required`이면 클라이언트는 `{ "t": "snapshot.subscribe", "rid": "s1", "workspaceId": "ws_example" }`을 보낸다. LEADER·MEMBER만 사용한다. 서버는 권한을 확인하고 해당 팀의 변경 알림 버퍼를 등록한 다음 `{ "t": "snapshot.subscribed", "rid": "s1", "workspaceId": "ws_example", "snapshotToken": "opaque-token" }`을 반환한다. 토큰은 무작위로 해당 사용자·팀·WS 연결에 바인딩되며 발급 후 60초 동안 유효하다. REST 조회 1회와 그에 따른 `snapshot.apply` 1회에만 사용한다. 토큰은 로그에 기록하지 않는다.
2. 클라이언트는 같은 사용자 access token과 `X-Cadora-Snapshot-Token: <snapshotToken>` 헤더로 `GET /v1/workspaces/:id/sync/snapshot`을 호출한다. 서버는 팀의 직렬화 경계 안에서 다음 객체와 두 기준점을 **한 MySQL 일관 읽기**로 생성한다. 응답의 `snapshotSeq`는 반영된 팀의 최신 이벤트 seq(없으면 `"0"`), `stateRevision`은 같은 스냅샷의 revision이다.

```json
{
  "workspaceId": "ws_example",
  "snapshotSeq": "1201",
  "stateRevision": "45",
  "config": null,
  "members": [],
  "activeRuns": [],
  "alerts": [],
  "generatedAt": "2026-11-25T09:00:00Z"
}
```

`config`는 `ConfigSnapshot | null`, `members`는 `Member[]`, `activeRuns`는 활성 `AgentRunInfo[]`, `alerts`는 요청자 본인의 미만료 `Alert[]` 전체다. 이벤트 과거 본문은 포함하지 않는다. 스냅샷의 필터링과 권한은 §6.3을 따른다. VIEWER는 이 엔드포인트를 사용할 수 없고 필터링된 설정 GET을 사용한다. 토큰 만료·사용자·팀·연결 불일치는 409 `snapshot_invalid`, 구독 권한 상실은 403 `forbidden`이다. 한 토큰은 REST 조회에 한 번만 사용할 수 있고 서버는 발급한 두 기준점을 해당 연결에 기록한다. 조회 후에도 같은 토큰으로 `snapshot.apply`를 한 번 완료할 수 있으며 60초 만료는 apply까지 적용한다. 응답이 전달되지 않으면 새 구독·토큰으로 다시 시작한다.
3. 클라이언트는 스냅샷을 로컬 상태에 적용하고 같은 연결에 `{ "t": "snapshot.apply", "rid": "s2", "workspaceId": "ws_example", "snapshotToken": "opaque-token", "snapshotSeq": "1201", "stateRevision": "45" }`을 보낸다. 서버는 저장된 토큰·연결·기준점·현재 권한을 검증하고 `snapshot_invalid` 또는 `forbidden`을 반환할 수 있다.
4. 서버는 스냅샷보다 뒤에 커밋된 버퍼를 커밋 순서로 전달한다. `event`는 기존 `{ t, seq, event }`에 `stateRevision`을 추가하며 seq가 `snapshotSeq`보다 큰 이벤트만 전달한다. 설정·멤버·경고의 변경은 해당 대상에게 `{ "t": "state.changed", "workspaceId": "ws_example", "stateRevision": "46", "resources": ["config", "members", "alerts"] }` 형식의 재조회 알림을 보낸다. `resources`는 변경된 대상만 포함하며, 수신자는 권한 범위 내에서 다시 조회한다. 이 알림은 사용자별 필터링되므로 revision의 숫자 결번만으로 메시지 누락을 판정하지 않는다. 구독 등록 후 커밋된 변경은 반드시 버퍼에 기록되며 버퍼 방출 중 새 변경도 순서대로 뒤에 붙인다.
5. 버퍼 방출을 마치면 `{ "t": "snapshot.ready", "rid": "s2", "workspaceId": "ws_example", "snapshotSeq": "1201", "stateRevision": "45" }`를 보내고 일반 실시간 전달로 전환한다. 클라이언트는 이벤트 ID로 중복을 제거한다. 스냅샷에서 마지막 반영 순번을 안전하게 저장하고 이후 정상 처리한 seq만 커서로 전진한다.

팀별 버퍼가 500개 메시지를 초과하면 해당 복구 구독과 토큰을 폐기하고 `{ "t": "error", "rid": "s1", "workspaceId": "ws_example", "code": "resync_required", "message": "스냅샷 복구를 다시 시작해야 합니다." }`를 보낸다. 토큰 만료·조회 실패·연결 종료도 복구를 처음부터 시작한다. 다른 팀 구독에는 영향을 주지 않는다. 스냅샷에 포함되지 않은 삭제 이력은 복구되지 않으며 클라이언트는 사용자에게 이를 알린다.

### 10.9 보류 큐와 탈퇴

로그아웃·다른 계정 로그인·팀 탈퇴 시 기존 큐는 원래 계정·팀에 묶어 보류한다. 사용자가 해당 계정으로 로그인했을 때 미전송 항목 수와 보류 이유를 알린다. 권한이 없으면 자동 전송하지 않고 로컬 항목을 자동 삭제하지 않는다. 30일 만료 또는 시각 불확실 항목은 자동·수동 재전송을 제공하지 않는다. 사용자가 내용을 확인하고 명시적으로 삭제할 수 있는 UI를 제공한다. 삭제 전 확인을 받는다. 동일 계정의 팀 재가입 후에도 30일·시각·권한 검사를 통과한 항목만 자동 전송한다.

### 10.10 입력·경계 검증 시나리오

- VIEWER가 팀 설정을 읽으면 `repo`, `pinnedTabs`, `materials`, `services` 외 설정 필드가 JSON에 없다. 활동·경고 발행과 조회는 거부된다.
- 101자 이름, 201자 제목, 2,049자 URL은 400으로 거부하고 1 MiB 초과 본문은 413으로 거부한다. 공백 제거 후 빈 이름도 거부한다.
- 이미 가입한 사용자가 MEMBER 초대를 사용해도 기존 LEADER 권한은 유지된다. 같은 수락자의 만료 후 재요청은 현재 가입 상태에서 멱등이며, 다른 사용자의 재수락은 거부한다.
- 같은 `dismiss` 재요청은 같은 `Alert`를 반환하고 `dismissed`를 `handled`로 변경하려 하면 409를 반환한다.
- 변경된 팀 스크립트의 자동 실행은 재승인 전 시작하지 않는다. 명시적 취소는 `skipped` 상태를 남긴다.
- `agentRunId`를 아는 파일 변경이 먼저 도착하면 원본을 저장하되 소유자 검증 전까지 실행 기반 경고를 만들지 않는다.
- 서로 다른 두 팀을 구독할 때 한 팀이 거부되어도 다른 팀의 구독은 유지된다. 버퍼 한도 초과 시 마지막 커서로 다시 복구한다.
- **스냅샷 경합**: 버퍼 등록 이후 스냅샷 읽기 전 이벤트와 설정 변경은 스냅샷에 포함되고, 읽기 직후의 변경은 버퍼에서만 전달된다. 스냅샷 적용 중 발생한 새 변경도 `snapshot.ready` 전에 전달된다. 권한 상실·토큰 재사용·연결 불일치는 거부한다.
- **오프라인 시계**: 클라이언트 시각을 신뢰할 수 없거나 큐가 30일을 초과하면 자동 전송하지 않는다. 서버의 중복 기록이 없을 때는 신규 이벤트로 처리할 수 있으므로 90일 이후 전역 중복 제거는 보장하지 않는다.
- **개인 실행**: 로컬 개인 작업공간에서는 `LocalAgentRunInfo.userId`가 null이며 팀 실행에서는 인증된 서버 사용자 ID다. 서버의 원격 이벤트 사용자 ID는 null을 허용하지 않는다.

### 10.11 P1 후속 방향

- **비밀값**: 실제 서비스용 값의 서버 보관은 별도 보안 설계 전 구현하지 않는다. §1.9의 API는 확정 계약이 아니다.
- **경고 전달**: 사용자가 승인한 요약만 로컬 에이전트에 전달하고 대기·취소·성공·실패를 표시한다. 전달 상태 API는 기능 구현 전에 별도 설계한다.
- **Discord**: 우선 팀의 Discord 링크를 외부 브라우저·앱에서 여는 기능만 제공하며 메시지·상태 연동은 포함하지 않는다.
- **일정**: 우선순위가 확정된 뒤 팀·개인 일정의 저장·동기화·권한 API를 별도 설계한다.
- **90일 보존**: 현재 30일 정책을 유지하고 저장량·개인정보·중복 확인 기간 검토 후 이벤트·경고·근거를 함께 연장한다.
