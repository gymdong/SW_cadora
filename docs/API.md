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
| `GET /workspaces/:id/config` | 멤버 | `{ version, config: SharedConfig, authorId, createdAt }` |
| `GET /workspaces/:id/config/:version` | 멤버 | 특정 버전 |
| `GET /workspaces/:id/config/history?limit=20` | 멤버 | `[{ version, authorId, createdAt, summary }]` |
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

설정이 바뀌면 서버는 멤버 전원에게 WS `config.updated`를 보낸다(§2.2).

### 1.5 초대 (FR-07, FR-09)

| 메서드 · 경로 | 권한 | 요청 → 응답 |
|---|---|---|
| `POST /workspaces/:id/invites` | LEADER | `{ role, expiresInHours: 72 }` → `{ id, code, url: "cadora://invite/<code>", expiresAt }` |
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
← { "t": "hello.ok", "rid": "r1", "serverTime": "2026-11-23T05:10:00Z" }
← { "t": "event", "seq": "1201", "event": { … } }      // afterSeq 이후 놓친 것부터 재생
```

### 2.2 메시지 종류

| 방향 | `t` | 내용 |
|---|---|---|
| C→S | `hello` | 구독할 워크스페이스와 마지막으로 받은 `seq` |
| C→S | `event.publish` | `{ rid, event }` — §2.3 이벤트 1개 |
| C→S | `presence.update` | `{ workspaceId, state: "active" \| "background" \| "sleep" \| "elsewhere" \| "offline" }` |
| C→S | `ping` | 30초마다 |
| S→C | `hello.ok` | |
| S→C | `ack` | `{ rid, eventId, seq }` — 저장 완료. 이걸 받아야 오프라인 큐에서 지운다 |
| S→C | `event` | `{ seq, event }` — 같은 워크스페이스 멤버의 이벤트 (작성자 본인에게도 echo) |
| S→C | `alert` | `{ alert }` — **수신자에게만** (§2.4) |
| S→C | `alert.caused` | `{ alertId, recipientId, type }` — 경고를 만든 쪽에 "지윤에게 알림 보냄" 표시용 (내용 없음) |
| S→C | `config.updated` | `{ workspaceId, version, authorId, summary }` → 클라이언트가 `GET /config` |
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
    showView(wsId: string, tabId: string, bounds: Rect): void;   // WebContentsView 배치
    openDownloadFolder(wsId: string): Promise<void>;
    openExternal(wsId: string, url: string): Promise<void>;      // S1 대안: 외부 브라우저 프로필
  };
  scripts: {
    start(wsId: string, scriptId: string): Promise<ProcessInfo>;   // FR-03
    stop(wsId: string, scriptId: string): Promise<void>;
    list(wsId: string): Promise<ProcessInfo[]>;
  };
  agents: {
    start(wsId: string, input: { tool: Tool; taskTitle: string; branch?: string; newWorktree?: boolean }): Promise<AgentRunInfo>;  // FR-11
    stop(runId: string): Promise<void>;
    list(wsId: string): Promise<AgentRunInfo[]>;
    suggestBranch(taskTitle: string): Promise<string>;        // core.suggestBranch
  };
  terminal: {
    open(target: { runId: string } | { wsId: string; shell?: "powershell" | "cmd" }): Promise<{ termId: string }>;
    write(termId: string, data: string): void;
    resize(termId: string, cols: number, rows: number): void;
    close(termId: string): void;
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
    getConfig(wsId: string): Promise<{ version: number; config: SharedConfig }>;
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
type ProcessInfo = { id: string; workspaceId: string; scriptId: string; status: "running" | "stopped" | "exited" | "error"; exitCode: number | null };
type TabInfo = { id: string; title: string; url: string; pinned: boolean };
type Rect = { x: number; y: number; width: number; height: number };
type InvitePreview = { workspaceName: string; inviterName: string; role: Role; expiresAt: string };
type TeamEvent = EventBase & ({ type: "agent_run"; agentRunId: string; tool: Tool; taskTitle: string | null; branch: string; status: "running" | "stopped" | "exited" | "error"; observe: Observe }
  | { type: "agent_status"; agentRunId: string; status: AgentStatus; source: "herdr" | "hook" | "process" }
  | { type: "agent_activity"; agentRunId: string; activity: "user_input" | "tool_use" | "turn_end" }
  | { type: "file_change"; agentRunId: string | null; tool: Tool | null; taskTitle: string | null; branch: string; relativePath: string; changeType: "added" | "modified" | "deleted"; category: "db-schema" | "dependency" | "infra" | "test" | "api" | "ui" | "docs" | "code"; source: "hook:PostToolUse" | "watcher" | "git" });
type CreateWorkspaceInput = { name: string; type: WorkspaceType; settings: LocalWorkspaceSettings };
type ConfigChange = { path: string; requiresApproval: boolean };
```

서버 API의 `Workspace.id`는 원격 ID다. `window.cadora`의 `wsId`는 달리 적지 않으면 로컬 ID이며 main이 팀 워크스페이스의 `remoteId`로 변환한다. `AgentRunInfo.workspaceId`, `ProcessInfo.workspaceId`는 호출 경계에 따라 서버는 원격 ID, IPC는 로컬 ID를 반환한다. `Seq`는 REST·WebSocket에서 10진 문자열로 전송하고 `afterSeq` 쿼리도 같은 형식이다. 초기 커서는 `"0"`이다.

### 6.2 IPC와 로컬 소유권

`workspace.update`는 로컬 이름과 개인 설정을 갱신한다. 팀의 공유 이름 변경은 LEADER가 서버 `PATCH /workspaces/:id`를 사용하며 로컬 이름 갱신과 별도로 처리한다. `browser.openDownloadFolder`는 main이 로컬 설정에서 경로를 찾아 연다. `alerts.evidence`는 해당 경고 수신자만 정제된 이벤트 목록을 받는다.

`team:inviteReceived`는 main이 검증한 초대 코드만 전달한다. 앱 준비 전 링크는 큐에 보관하여 구독 준비 후 한 번 전달한다. 인증 상태는 `team:authChanged`로 통지하며 토큰은 renderer에 전달하지 않는다. `team.logout`은 현재 기기의 인증 세션을 폐기한다. `getPrivacy`는 현재 팀의 본인 설정을 반환한다.

IPC의 `Promise` 실패는 직렬화 가능한 `{ code, message, details? }` 오류로 전달하고 `code`는 §0의 REST 오류와 같은 의미로 사용한다. 민감한 원문은 오류나 로그에 넣지 않는다. `on`이 반환한 함수는 리스너를 제거한다.

### 6.3 인증과 권한

- GitHub Device Flow는 발급받은 `interval` 이상을 기다리며 polling한다. 승인 전은 202 `pending`, 사용자 거부는 403 `device_denied`, 기기 코드 만료는 410 `device_expired`, 과도한 polling은 429 `slow_down`과 `details.retryAfterSeconds`를 반환한다. 만료·거부 후 새 코드를 발급한다.
- refresh token은 기기별 세션으로 관리하며 서버에는 해시만 저장한다. 만료 기간은 30일이다. 갱신은 원자적으로 새 토큰을 발급하고 이전 토큰을 폐기한다. 재사용을 감지하면 해당 세션 계열을 폐기하고 재로그인을 요구한다. 클라이언트는 동시 갱신을 하나로 합치며 갱신 응답 유실 시 재로그인한다. 로컬 refresh token은 safeStorage로 보호한다.
- `LEADER`는 멤버 기능과 팀·설정·초대·멤버 관리를 수행한다. `MEMBER`는 팀 정보·설정·활동을 조회하고 자신의 이벤트와 동기화 상태를 발행한다. `VIEWER`는 팀 기본 정보와 공용 설정·자료만 조회하며 팀 활동·이벤트·경고 조회, 이벤트 발행과 팀 변경은 허용하지 않는다. 모든 역할은 자신의 제목 공유 설정을 변경할 수 있다. WS 구독·발행도 같은 권한을 적용하며 탈퇴 시 기존 구독을 해제한다.
- 마지막 LEADER의 탈퇴·강등은 409 `last_leader`로 거부한다. 팀 삭제는 LEADER만 수행한다. 이 규칙은 UI뿐 아니라 서버에서 강제한다.
- 초대는 1인 수락이다. 같은 사용자의 반복 수락은 기존 가입 결과를 반환하고, 다른 사용자의 재수락은 409 `invite_already_used`다. 초대의 만료·회수는 410이다. 초대 수락과 멤버십 생성은 원자적으로 처리한다.

### 6.4 이벤트 재전송과 재연결

1. main은 개인정보 검사를 통과한 팀 이벤트만 계정·팀별 영속 큐에 저장한다. 서버는 인증과 소속을 확인한 후 저장·실행 요약·경고를 원자적으로 처리하고 커밋 후 ACK한다.
2. 같은 사용자·팀·정규화된 내용으로 같은 UUID를 재전송하면 원래 `seq`를 ACK하고 경고를 다시 만들지 않는다. 내용이나 소유자가 다른 ID 재사용은 `event_id_conflict`로 거부한다. 다른 계정의 큐는 전송하지 않는다.
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
