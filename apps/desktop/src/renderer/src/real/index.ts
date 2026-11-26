/**
 * 실제 기능 연결층(데모 브랜치). 프로토타입 화면(proto/app.js)이 window.CadoraReal을 통해 쓴다.
 * - 상태: 이 PC의 실제 워크스페이스·탭·터미널·에이전트·파일 변경·다운로드(모두 window.cadora로 받는다).
 * - 터미널: xterm.js를 화면 위 고정 레이어에 두고, app.js가 그린 자리(data-real-slot="term")에 맞춘다.
 *   app.js는 상태가 바뀔 때마다 innerHTML을 통째로 다시 그리므로 터미널을 그 안에 두면 매번 사라진다.
 * - 웹 페이지: main의 WebContentsView를 data-real-slot="page" 영역에 배치한다. 모달·메뉴가 열리면 숨긴다
 *   (네이티브 뷰는 HTML 위에 그려지므로 가리지 않게).
 */
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type {
  AgentRunInfo,
  AuthStatus,
  CadoraBridge,
  CreateWorkspaceInput,
  DownloadDone,
  FileChange,
  LocalWorkspaceView,
  LoginStart,
  Me,
  RuntimeInfo,
  TabInfo,
  TerminalInfo,
} from '../../../shared/bridge';

/** Cadora 계정 화면 상태. checking: 시작 직후 확인 중, offline: 저장된 로그인이 있는데 서버에 닿지 못함. */
export interface AuthView {
  status: AuthStatus | 'checking' | 'offline';
  me: Me | null;
  pending: LoginStart | null;
  message: string | null;
  busy: boolean;
  /** "로그인 없이 이 PC 기능만 쓰기"를 골랐는지(앱을 다시 켜면 로그인 화면부터 보여 준다). */
  skipped: boolean;
}

export interface RealState {
  auth: AuthView;
  available: boolean;
  info: RuntimeInfo | null;
  workspaces: LocalWorkspaceView[];
  tabs: Record<string, { tabs: TabInfo[]; activeTabId: string | null }>;
  terminals: Record<string, TerminalInfo[]>;
  activeTerm: Record<string, string | null>;
  agents: Record<string, AgentRunInfo[]>;
  files: Record<string, FileChange[]>;
  downloads: Record<string, DownloadDone[]>;
  loaded: Record<string, boolean>;
}

type Listener = () => void;

const api: CadoraBridge | undefined = (window as unknown as { cadora?: CadoraBridge }).cadora;
const hasFullApi = !!api && typeof api.workspace === 'object';

const state: RealState = {
  auth: { status: 'checking', me: null, pending: null, message: null, busy: false, skipped: false },
  available: hasFullApi,
  info: null,
  workspaces: [],
  tabs: {},
  terminals: {},
  activeTerm: {},
  agents: {},
  files: {},
  downloads: {},
  loaded: {},
};

const listeners = new Set<Listener>();
let scheduled = false;
function changed(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const l of listeners) l();
  });
}

let toastFn: ((msg: string) => void) | null = null;
function report(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (toastFn) toastFn(msg);
  else console.warn('[cadora]', msg);
}
async function guard<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (err) {
    report(err);
    return undefined;
  } finally {
    changed();
  }
}

// ───────────── 터미널(xterm.js) ─────────────
interface XT {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  opened: boolean;
}
const xterms = new Map<string, XT>();
let overlay: HTMLDivElement | null = null;

function overlayRoot(): HTMLDivElement {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'real-term-overlay';
    overlay.style.display = 'none';
    document.body.appendChild(overlay);
  }
  return overlay;
}

function xtermFor(termId: string): XT {
  let x = xterms.get(termId);
  if (x) return x;
  const term = new Terminal({
    fontFamily: 'Consolas, "Cascadia Mono", D2Coding, ui-monospace, monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    theme: { background: '#14171b', foreground: '#d0d6de', cursor: '#2dd4bf', selectionBackground: '#2dd4bf55' },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const el = document.createElement('div');
  el.className = 'real-term';
  el.style.display = 'none';
  overlayRoot().appendChild(el);
  term.onData((d) => api?.terminal.write(termId, d));
  term.onResize(({ cols, rows }) => api?.terminal.resize(termId, cols, rows));
  // Ctrl+V는 브라우저 붙여넣기로, 선택 영역이 있으면 Ctrl+C는 복사로 처리한다.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) return false;
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined);
      term.clearSelection();
      return false;
    }
    return true;
  });
  x = { term, fit, el, opened: false };
  xterms.set(termId, x);
  return x;
}

function disposeXterm(termId: string): void {
  const x = xterms.get(termId);
  if (!x) return;
  x.term.dispose();
  x.el.remove();
  xterms.delete(termId);
}

// ───────────── Cadora 계정 ─────────────
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** main에 내 정보를 묻는다. 저장된 로그인이 있는데 서버에 닿지 못하면 offline으로 둔다. */
async function refreshMe(): Promise<void> {
  if (!api) return;
  const A = state.auth;
  try {
    const me = await api.team.me();
    A.me = me;
    if (me) {
      A.status = 'authenticated';
      A.message = null;
    } else if (A.status === 'checking' || A.status === 'offline' || A.status === 'authenticated') {
      A.status = 'logged_out';
    }
  } catch (err) {
    A.me = null;
    A.status = 'offline';
    A.message = errText(err);
  }
  changed();
}

// ───────────── 초기화와 이벤트 ─────────────
async function loadWorkspace(wsId: string): Promise<void> {
  if (!api) return;
  const [tabs, terminals, agents, files, downloads] = await Promise.all([
    api.browser.listTabs(wsId),
    api.terminal.list(wsId),
    api.agents.list(wsId),
    api.files.recent(wsId),
    api.browser.recentDownloads(wsId),
  ]);
  state.tabs[wsId] = tabs;
  state.terminals[wsId] = terminals;
  state.agents[wsId] = agents;
  state.files[wsId] = files;
  state.downloads[wsId] = downloads;
  for (const t of terminals) {
    if (!xterms.has(t.termId)) {
      const x = xtermFor(t.termId);
      x.term.write(await api.terminal.backlog(t.termId));
    }
  }
  if (!state.activeTerm[wsId] && terminals.length) state.activeTerm[wsId] = terminals[terminals.length - 1]!.termId;
  state.loaded[wsId] = true;
}

if (api && hasFullApi) {
  api.on('workspace:changed', (list) => {
    state.workspaces = list;
    changed();
  });
  api.on('browser:tabs', ({ wsId, tabs, activeTabId }) => {
    state.tabs[wsId] = { tabs, activeTabId };
    changed();
  });
  api.on('terminal:data', ({ termId, data }) => {
    xtermFor(termId).term.write(data);
  });
  api.on('terminal:list', ({ wsId, terminals }) => {
    state.terminals[wsId] = terminals;
    for (const id of [...xterms.keys()]) {
      if (!Object.values(state.terminals).some((list) => list.some((t) => t.termId === id))) disposeXterm(id);
    }
    const active = state.activeTerm[wsId];
    if (!active || !terminals.some((t) => t.termId === active)) state.activeTerm[wsId] = terminals[terminals.length - 1]?.termId ?? null;
    changed();
  });
  api.on('agent:status', (run) => {
    const list = (state.agents[run.wsId] ??= []);
    const i = list.findIndex((r) => r.runId === run.runId);
    if (i >= 0) list[i] = run;
    else list.push(run);
    changed();
  });
  api.on('file:changed', (f) => {
    const list = (state.files[f.wsId] ??= []);
    list.unshift(f);
    if (list.length > 50) list.length = 50;
    changed();
  });
  api.on('download:done', (d) => {
    const list = (state.downloads[d.wsId] ??= []);
    list.push(d);
    if (toastFn) toastFn(`받은 파일을 이 워크스페이스 폴더에 저장했어요 — ${d.fileName}`);
    changed();
  });
  api.on('team:authChanged', ({ status, message }) => {
    const A = state.auth;
    A.status = status;
    A.message = message ?? null;
    if (status !== 'pending') A.pending = null;
    if (status === 'authenticated') {
      A.skipped = false;
      void refreshMe();
    }
    else if (status !== 'pending') A.me = null;
    changed();
  });
  // 첫 정보 읽기. main이 준비되기 전이면 잠깐 뒤에 다시 시도한다.
  const init = async (attempt: number): Promise<void> => {
    try {
      const [info, list] = await Promise.all([api.runtime.info(), api.workspace.list()]);
      state.info = info;
      state.workspaces = list;
      changed();
      void refreshMe();
    } catch (err) {
      if (attempt < 5) setTimeout(() => void init(attempt + 1), 300 * (attempt + 1));
      else {
        report(err);
        // 계정 확인 화면에서 멈추지 않게: 다시 시도할 수 있는 상태로 둔다.
        state.auth.status = 'offline';
        state.auth.message = `앱을 준비하지 못했어요: ${errText(err)}`;
        changed();
      }
    }
  };
  void init(0);
}

// ───────────── 배치(layout) ─────────────
let lastView = '';
function overlayOpen(): boolean {
  return !!document.querySelector('.modal-back, .menu, .popover');
}

function layout(selectedWsId: string | null): void {
  if (!api || !hasFullApi) return;
  const blocked = overlayOpen();
  const pageSlot = document.querySelector<HTMLElement>('[data-real-slot="page"]');
  const ws = selectedWsId ? state.workspaces.find((w) => w.id === selectedWsId) : undefined;
  let viewKey = 'none';
  if (pageSlot && ws && ws.state !== 'sleep' && !blocked) {
    const r = pageSlot.getBoundingClientRect();
    if (r.width > 20 && r.height > 20) {
      const bounds = { x: r.left, y: r.top, width: r.width, height: r.height };
      viewKey = `${ws.id}:${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}:${Math.round(r.height)}`;
      if (viewKey !== lastView) api.browser.showView(ws.id, bounds);
    }
  }
  if (viewKey === 'none' && lastView !== 'none') api.browser.showView(null, null);
  lastView = viewKey;

  const root = overlayRoot();
  const termSlot = document.querySelector<HTMLElement>('[data-real-slot="term"]');
  const termId = ws ? state.activeTerm[ws.id] : null;
  if (!termSlot || !termId) {
    root.style.display = 'none';
    return;
  }
  const r = termSlot.getBoundingClientRect();
  Object.assign(root.style, {
    display: 'block',
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    visibility: blocked ? 'hidden' : 'visible',
  });
  for (const [id, x] of xterms) {
    const show = id === termId;
    x.el.style.display = show ? 'block' : 'none';
    if (show) {
      if (!x.opened) {
        x.term.open(x.el);
        x.opened = true;
      }
      try {
        x.fit.fit();
      } catch {
        /* 크기가 0이면 다음 배치에서 맞춘다 */
      }
    }
  }
}

let layoutQueued = false;
let lastSelected: string | null = null;
function queueLayout(): void {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    layout(lastSelected);
  });
}
window.addEventListener('resize', queueLayout);
document.addEventListener('scroll', queueLayout, true);

// ───────────── app.js가 쓰는 공개 객체 ─────────────
const real = {
  available: hasFullApi,
  state,
  onChange(fn: Listener) {
    listeners.add(fn);
  },
  setToast(fn: (msg: string) => void) {
    toastFn = fn;
  },
  layout(selectedWsId: string | null) {
    lastSelected = selectedWsId;
    layout(selectedWsId);
  },
  /** 터미널 화면에 지금 보이는 줄(xterm 버퍼). 출력 스트림이 아니라 그려진 결과라 상태 확인·점검에 쓴다. */
  screenText(termId: string, lines = 40): string {
    const x = xterms.get(termId);
    if (!x) return '';
    const b = x.term.buffer.active;
    const end = b.baseY + x.term.rows;
    const out: string[] = [];
    for (let i = Math.max(0, end - lines); i < end; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
    return out.join('\n');
  },
  focusTerminal(wsId: string) {
    const id = state.activeTerm[wsId];
    if (id) xterms.get(id)?.term.focus();
  },
  async select(wsId: string) {
    if (!api) return;
    await guard(
      (async () => {
        const ws = state.workspaces.find((w) => w.id === wsId);
        if (ws && ws.state !== 'sleep') await api.workspace.activate(wsId);
        if (!state.loaded[wsId]) await loadWorkspace(wsId);
        if (!(state.terminals[wsId] ?? []).length && ws && ws.state !== 'sleep') {
          const t = await api.terminal.open(wsId);
          state.activeTerm[wsId] = t.termId;
        }
      })(),
    );
  },
  async create(input: CreateWorkspaceInput) {
    if (!api) return undefined;
    return guard(api.workspace.create(input));
  },
  pickFolder: () => (api ? guard(api.workspace.pickFolder()) : Promise.resolve(undefined)),
  rename: (id: string, name: string) => api && guard(api.workspace.rename(id, name)),
  remove: (id: string) => api && guard(api.workspace.remove(id)),
  sleep: (id: string) => api && guard(api.workspace.setState(id, 'sleep')),
  wake: (id: string) => api && guard(api.workspace.activate(id)),
  openFolder: (id: string) => api && guard(api.workspace.openFolder(id)),
  setEnv: (id: string, name: string, value: string) => api && guard(api.workspace.setEnv(id, name, value)),
  removeEnv: (id: string, name: string) => api && guard(api.workspace.removeEnv(id, name)),
  openTab: (wsId: string, url: string) => api && guard(api.browser.openTab(wsId, url)),
  selectTab: (wsId: string, tabId: string) => api && guard(api.browser.selectTab(wsId, tabId)),
  closeTab: (wsId: string, tabId: string) => api && guard(api.browser.closeTab(wsId, tabId)),
  navigate: (wsId: string, tabId: string, action: 'back' | 'forward' | 'reload' | { url: string }) =>
    api && guard(api.browser.navigate(wsId, tabId, action)),
  clearSession: (wsId: string) => api && guard(api.browser.clearSession(wsId)),
  openDownloadFolder: (wsId: string) => api && guard(api.browser.openDownloadFolder(wsId)),
  openExternal: (wsId: string, url: string) => api && guard(api.browser.openExternal(wsId, url)),
  async newTerminal(wsId: string) {
    if (!api) return;
    const t = await guard(api.terminal.open(wsId));
    if (t) state.activeTerm[wsId] = t.termId;
    changed();
  },
  selectTerminal(wsId: string, termId: string) {
    state.activeTerm[wsId] = termId;
    changed();
  },
  closeTerminal: (termId: string) => api && guard(api.terminal.close(termId)),
  async startAgent(wsId: string, taskTitle: string) {
    if (!api) return;
    const run = await guard(api.agents.start(wsId, { tool: 'claude', taskTitle }));
    if (run) {
      state.activeTerm[wsId] = run.termId;
      const list = (state.agents[wsId] ??= []);
      if (!list.some((r) => r.runId === run.runId)) list.push(run);
    }
    changed();
  },
  stopAgent: (runId: string) => api && guard(api.agents.stop(runId)),

  // Cadora 계정(GitHub Device Flow). 화면은 코드·주소·내 정보만 받는다.
  async login() {
    if (!api) return;
    const A = state.auth;
    A.busy = true;
    A.message = null;
    A.pending = null;
    changed();
    try {
      A.pending = await api.team.login();
      A.status = 'pending';
    } catch (err) {
      A.message = errText(err);
      A.status = A.me ? 'authenticated' : 'logged_out';
    } finally {
      A.busy = false;
      changed();
    }
  },
  /** 코드를 복사하고 GitHub 페이지를 연다. 결과: 복사·열기 각각 성공했는지. */
  async openLoginPage(): Promise<{ copied: boolean; opened: boolean }> {
    if (!api) return { copied: false, opened: false };
    const code = state.auth.pending?.userCode;
    const copied = !!code && (await navigator.clipboard.writeText(code).then(() => true, () => false));
    const opened = (await guard(api.team.openVerification().then(() => true))) === true;
    return { copied, opened };
  },
  cancelLogin: () => api && guard(api.team.cancelLogin()),
  async logoutAccount() {
    if (!api) return;
    await guard(api.team.logout());
    state.auth.me = null;
    state.auth.status = 'logged_out';
    changed();
  },
  skipLogin() {
    if (state.auth.pending && api) void api.team.cancelLogin().catch(() => undefined);
    state.auth.pending = null;
    state.auth.skipped = true;
    state.auth.message = null;
    changed();
  },
  /** 저장된 로그인을 다시 확인한다(서버가 다시 켜졌을 때). */
  async retryAccount() {
    state.auth.status = 'checking';
    state.auth.message = null;
    changed();
    await refreshMe();
  },
  unskip() {
    state.auth.skipped = false;
    state.auth.message = null;
    changed();
  },
  clearAuthMessage() {
    state.auth.message = null;
    changed();
  },
  /** 가입 마무리: 팀에 보일 이름을 정한다(데모 확장 PATCH /me). */
  async completeSignup(displayName: string): Promise<Me | undefined> {
    if (!api) return undefined;
    const me = await guard(api.team.completeSignup(displayName));
    if (me) state.auth.me = me;
    changed();
    return me;
  },
  /** 앱 안 임시 서버에 쓸 GitHub OAuth App Client ID(비밀값 아님)를 저장한다. */
  async setClientId(clientId: string): Promise<boolean> {
    if (!api) return false;
    const r = await guard(api.team.setGithubClientId(clientId));
    if (r && state.info) {
      state.info.authServer = r.authServer;
      state.info.authServerState = r.authServerState;
      state.info.authServerError = null;
      state.info.clientIdSource = r.clientIdSource;
    }
    if (r) {
      // 저장된 로그인이 있으면 새 서버로 다시 확인한다.
      state.auth.message = null;
      await refreshMe();
    }
    changed();
    return !!r;
  },
};

(window as unknown as { CadoraReal: typeof real }).CadoraReal = real;
export type CadoraRealApi = typeof real;
