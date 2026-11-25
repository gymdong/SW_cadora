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
  CadoraBridge,
  CreateWorkspaceInput,
  DownloadDone,
  FileChange,
  LocalWorkspaceView,
  RuntimeInfo,
  TabInfo,
  TerminalInfo,
} from '../../../shared/bridge';

export interface RealState {
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
    fontSize: 13,
    lineHeight: 1.15,
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
  // 첫 정보 읽기. main이 준비되기 전이면 잠깐 뒤에 다시 시도한다.
  const init = async (attempt: number): Promise<void> => {
    try {
      const [info, list] = await Promise.all([api.runtime.info(), api.workspace.list()]);
      state.info = info;
      state.workspaces = list;
      changed();
    } catch (err) {
      if (attempt < 5) setTimeout(() => void init(attempt + 1), 300 * (attempt + 1));
      else report(err);
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
};

(window as unknown as { CadoraReal: typeof real }).CadoraReal = real;
export type CadoraRealApi = typeof real;
