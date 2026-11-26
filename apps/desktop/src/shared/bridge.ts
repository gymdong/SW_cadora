/**
 * preload가 renderer에 여는 `window.cadora`의 타입(API.md §3의 부분 집합).
 * renderer는 Node·파일 시스템에 직접 접근하지 않고 이 객체만 쓴다.
 *
 * 로컬 데모 브랜치(demo/local-prototype)용이다. 정식 계약은 packages/protocol의 IPC 계약(#46, 예전 #23)으로 옮긴다.
 * team은 로그인(§1.1)만 실제 서버에 붙는다. 서버가 생기기 전에는 apps/desktop/dev/auth-server.mjs(로컬 임시 서버)를 쓴다.
 * 나머지 팀 기능은 서버가 생긴 뒤에 채우고, 그 전까지 화면은 프로토타입 시뮬레이션을 쓴다.
 */

export type WorkspaceType = '과제' | '팀 프로젝트' | '개인 프로젝트' | '기타';
export type WorkspaceState = 'active' | 'background' | 'sleep';

/** 화면에 보내는 워크스페이스. 환경변수 값은 절대 담지 않고 이름과 가린 값만 보낸다. */
export interface LocalWorkspaceView {
  id: string;
  kind: 'personal';
  name: string;
  type: WorkspaceType;
  state: WorkspaceState;
  /** 이 PC의 폴더(로컬 전용 — 팀 이벤트로 보내지 않는다). */
  localPath: string;
  partition: string;
  downloadDir: string;
  env: Array<{ name: string; masked: string }>;
  createdAt: string;
}

export interface CreateWorkspaceInput {
  name: string;
  type: WorkspaceType;
  /** 비우면 문서\Cadora\<이름> 아래에 만든다. */
  localPath?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type AgentStatus = 'starting' | 'working' | 'waiting' | 'done' | 'idle' | 'exited';

export interface AgentRunInfo {
  runId: string;
  wsId: string;
  tool: 'claude';
  taskTitle: string;
  termId: string;
  status: AgentStatus;
  /** 상태를 무엇으로 알았는지: hook(Claude Code hooks) · process(프로세스 생존만). */
  observe: 'hooks' | 'process';
  startedAt: string;
  lastActivityAt: string;
}

export type FileCategory = 'db-schema' | 'dependency' | 'infra' | 'test' | 'api' | 'ui' | 'docs' | 'code';

/** 파일 변경 이벤트: 상대경로·분류만 담는다(내용·절대경로 없음, FR-18). */
export interface FileChange {
  wsId: string;
  relativePath: string;
  category: FileCategory;
  label: string;
  shared: boolean;
  branch: string;
  source: 'watcher' | 'hook:PostToolUse';
  runId?: string;
  at: string;
}

export interface DownloadDone {
  wsId: string;
  fileName: string;
  savedTo: string;
  at: string;
}

export interface TerminalInfo {
  termId: string;
  wsId: string;
  title: string;
  kind: 'shell' | 'agent';
  runId?: string;
  alive: boolean;
}

export interface RuntimeInfo {
  /** 에이전트 런타임 어댑터(#28). 이 데모는 node-pty(ConPTY)만 쓴다. */
  agentRuntime: 'pty';
  /** Claude Code 실행 파일을 찾았는지. */
  claudeAvailable: boolean;
  /** hook relay를 무엇으로 실행하는지(node 또는 Electron의 내장 Node). */
  hookRunner: 'node' | 'electron';
  /** 파일 감시 방식(#19 결과: @parcel/watcher). */
  watcher: '@parcel/watcher';
  /** 비밀값 저장소(safeStorage)를 쓸 수 있는지(Windows는 DPAPI). */
  secretStore: boolean;
  /** 로그인에 쓰는 서버 주소. 팀 서버(CADORA_SERVER_URL·빌드 때 주소)가 없으면 앱 안 임시 서버(127.0.0.1). */
  authServer: string | null;
  /** remote: 팀 서버, local: 앱 안 임시 서버(계정이 이 PC에만 있음), invalid: 주소 설정 오류, needs_client_id: GitHub 연결 설정 필요. */
  authServerState: AuthServerState;
  /** 앱 안 임시 서버를 켜지 못한 이유(unavailable일 때). */
  authServerError: string | null;
  /** Client ID 출처. user일 때만 앱에서 다시 설정할 수 있다. */
  clientIdSource: 'env' | 'build' | 'user' | null;
}

export type AuthServerState = 'remote' | 'local' | 'invalid' | 'needs_client_id' | 'unavailable';

/** 로그인 상태(API.md §3 "team:authChanged"). */
export type AuthStatus = 'pending' | 'authenticated' | 'expired' | 'denied' | 'logged_out';
export type Role = 'LEADER' | 'MEMBER' | 'VIEWER';

/** 내 정보(API.md §6.1 Me). 토큰은 담지 않는다. avatarUrl은 GitHub 아바타 주소만 남긴다. */
export interface Me {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  workspaces: Array<{ id: string; name: string; role: Role }>;
  /** 데모 확장: 첫 GitHub 로그인 뒤 가입 마무리(이름 확인·공유 범위 동의)가 남았는지. */
  needsSignup: boolean;
}

/** 로그인 시작 결과. 화면에는 사용자가 입력할 코드와 GitHub 주소만 준다(deviceCode는 main에만 있다). */
export interface LoginStart {
  userCode: string;
  verificationUri: string;
  expiresAt: string;
}

export interface CadoraEvents {
  'team:authChanged': { status: AuthStatus; message?: string };
  'workspace:changed': LocalWorkspaceView[];
  'browser:tabs': { wsId: string; tabs: TabInfo[]; activeTabId: string | null };
  'download:done': DownloadDone;
  'terminal:data': { termId: string; data: string };
  'terminal:list': { wsId: string; terminals: TerminalInfo[] };
  'agent:status': AgentRunInfo;
  'file:changed': FileChange;
}

export type CadoraEventName = keyof CadoraEvents;

export interface CadoraBridge {
  /** 'win32' | 'darwin' | 'linux' — 운영체제별 화면 처리에 쓴다. */
  readonly platform: string;
  /** @cadora/protocol의 PROTOCOL_VERSION. */
  readonly protocolVersion: number;
  readonly versions: {
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
  };

  readonly runtime: { info(): Promise<RuntimeInfo> };

  readonly workspace: {
    list(): Promise<LocalWorkspaceView[]>;
    create(input: CreateWorkspaceInput): Promise<LocalWorkspaceView>;
    rename(id: string, name: string): Promise<LocalWorkspaceView>;
    remove(id: string): Promise<void>;
    activate(id: string): Promise<void>;
    setState(id: string, state: 'background' | 'sleep'): Promise<void>;
    setEnv(id: string, name: string, value: string): Promise<LocalWorkspaceView>;
    removeEnv(id: string, name: string): Promise<LocalWorkspaceView>;
    openFolder(id: string): Promise<void>;
    pickFolder(): Promise<string | null>;
  };

  readonly browser: {
    openTab(wsId: string, url: string): Promise<TabInfo>;
    closeTab(wsId: string, tabId: string): Promise<void>;
    selectTab(wsId: string, tabId: string): Promise<void>;
    listTabs(wsId: string): Promise<{ tabs: TabInfo[]; activeTabId: string | null }>;
    navigate(wsId: string, tabId: string, action: 'back' | 'forward' | 'reload' | { url: string }): Promise<void>;
    /** 보이는 영역에 탭을 배치한다. bounds가 null이면 모든 웹 뷰를 숨긴다. */
    showView(wsId: string | null, bounds: Rect | null): void;
    clearSession(wsId: string): Promise<void>;
    openDownloadFolder(wsId: string): Promise<void>;
    recentDownloads(wsId: string): Promise<DownloadDone[]>;
    /** S1 대안: 워크스페이스 전용 Edge 프로필로 연다(내장 브라우저 로그인이 막히는 서비스용). */
    openExternal(wsId: string, url: string): Promise<void>;
  };

  readonly terminal: {
    open(wsId: string): Promise<TerminalInfo>;
    list(wsId: string): Promise<TerminalInfo[]>;
    write(termId: string, data: string): void;
    resize(termId: string, cols: number, rows: number): void;
    close(termId: string): Promise<void>;
    /** 화면을 다시 그릴 때 지난 출력을 받는다(최근 일부만 보관). */
    backlog(termId: string): Promise<string>;
  };

  readonly agents: {
    start(wsId: string, input: { tool: 'claude'; taskTitle: string }): Promise<AgentRunInfo>;
    stop(runId: string): Promise<void>;
    list(wsId: string): Promise<AgentRunInfo[]>;
  };

  readonly files: {
    recent(wsId: string): Promise<FileChange[]>;
  };

  /** Cadora 계정(API.md §3 team 중 로그인 부분). 토큰·기기 코드는 main에만 있고 화면으로 오지 않는다. */
  readonly team: {
    /** GitHub Device Flow를 시작한다. 승인 결과는 "team:authChanged"로 온다. */
    login(): Promise<LoginStart>;
    cancelLogin(): Promise<void>;
    /** 진행 중인 로그인의 GitHub 페이지(https://github.com만)를 기본 브라우저로 연다. */
    openVerification(): Promise<void>;
    /** 로그인되어 있으면 내 정보, 아니면 null. 저장된 로그인이 있는데 서버에 닿지 못하면 오류. */
    me(): Promise<Me | null>;
    logout(): Promise<void>;
    /** 데모: 가입 마무리(팀에 보일 이름 확정). */
    completeSignup(displayName: string): Promise<Me>;
    /** 데모: 앱 안 임시 서버에 쓸 GitHub OAuth App Client ID(비밀값 아님)를 저장하고 서버를 켠다. */
    setGithubClientId(clientId: string): Promise<{ authServer: string | null; authServerState: AuthServerState; clientIdSource: RuntimeInfo['clientIdSource'] }>;
  };

  on<E extends CadoraEventName>(event: E, cb: (payload: CadoraEvents[E]) => void): () => void;
}
