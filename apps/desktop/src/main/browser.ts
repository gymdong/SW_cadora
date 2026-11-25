/**
 * BrowserManager(#26, FR-02·05): 워크스페이스별 내장 브라우저.
 * - 워크스페이스마다 세션 파티션(persist:ws_<id>)이 따로라 쿠키·로그인이 섞이지 않는다.
 * - 웹 뷰에는 preload를 넣지 않는다 → 웹 페이지는 window.cadora에 접근할 수 없다.
 * - 다운로드는 그 워크스페이스의 다운로드 폴더로 보낸다(같은 이름이면 번호를 붙인다).
 * - 권한 요청(카메라·위치·알림 등)은 기본 거부한다.
 */
import { BrowserWindow, WebContentsView, session, shell, type Session } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { DownloadDone, Rect, TabInfo } from '../shared/bridge';
import { emit } from './events';
import { isExternalHttpUrl } from './security';
import { newId, type StoredTab, type WorkspaceManager } from './workspaces';

interface Tab {
  id: string;
  url: string;
  title: string;
  view: WebContentsView | null;
}

interface WsBrowser {
  tabs: Tab[];
  activeTabId: string | null;
}

/** 웹 페이지에 허용하는 권한. 나머지(카메라·마이크·위치·알림·MIDI 등)는 거부한다. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const s = basename(String(name)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  return s.slice(0, 180) || 'download';
}

function uniquePath(dir: string, fileName: string): string {
  const ext = extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  let p = join(dir, fileName);
  for (let i = 1; existsSync(p) && i < 1000; i++) p = join(dir, `${stem} (${i})${ext}`);
  return p;
}

export class BrowserManager {
  private readonly ws = new Map<string, WsBrowser>();
  private readonly configured = new WeakSet<Session>();
  private readonly downloads = new Map<string, DownloadDone[]>();
  private shown: { wsId: string; bounds: Rect } | null = null;
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly workspaces: WorkspaceManager,
  ) {}

  private state(wsId: string): WsBrowser {
    let s = this.ws.get(wsId);
    if (!s) {
      const w = this.workspaces.get(wsId);
      s = { tabs: w.tabs.map((t) => ({ ...t, view: null })), activeTabId: w.activeTabId };
      if (s.activeTabId && !s.tabs.some((t) => t.id === s!.activeTabId)) s.activeTabId = s.tabs[0]?.id ?? null;
      this.ws.set(wsId, s);
    }
    return s;
  }

  private sessionFor(wsId: string): Session {
    const w = this.workspaces.get(wsId);
    const ses = session.fromPartition(w.partition);
    if (this.configured.has(ses)) return ses;
    this.configured.add(ses);
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
    ses.on('will-download', (_event, item) => {
      const cur = this.workspaces.has(wsId) ? this.workspaces.get(wsId) : null;
      if (!cur) return item.cancel();
      mkdirSync(cur.downloadDir, { recursive: true });
      const target = uniquePath(cur.downloadDir, sanitizeFileName(item.getFilename()));
      item.setSavePath(target);
      item.once('done', (_e, state) => {
        if (state !== 'completed') return;
        const d: DownloadDone = { wsId, fileName: basename(target), savedTo: target, at: new Date().toISOString() };
        const list = this.downloads.get(wsId) ?? [];
        list.push(d);
        this.downloads.set(wsId, list.slice(-20));
        emit('download:done', d);
      });
    });
    return ses;
  }

  private info(t: Tab): TabInfo {
    const wc = t.view?.webContents;
    const live = wc && !wc.isDestroyed();
    return {
      id: t.id,
      title: (live ? wc.getTitle() : '') || t.title || t.url,
      url: (live ? wc.getURL() : '') || t.url,
      loading: live ? wc.isLoading() : false,
      canGoBack: live ? wc.navigationHistory.canGoBack() : false,
      canGoForward: live ? wc.navigationHistory.canGoForward() : false,
    };
  }

  private publish(wsId: string): void {
    const s = this.state(wsId);
    emit('browser:tabs', { wsId, tabs: s.tabs.map((t) => this.info(t)), activeTabId: s.activeTabId });
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistAll(), 500);
  }

  private persistAll(): void {
    for (const [wsId, s] of this.ws) {
      const tabs: StoredTab[] = s.tabs.map((t) => {
        const i = this.info(t);
        return { id: t.id, url: i.url, title: i.title };
      });
      this.workspaces.setTabs(wsId, tabs, s.activeTabId);
    }
  }

  private createView(wsId: string, tab: Tab): WebContentsView {
    const w = this.workspaces.get(wsId);
    this.sessionFor(wsId);
    const view = new WebContentsView({
      webPreferences: {
        partition: w.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        // preload 없음: 웹 페이지에 window.cadora를 열지 않는다.
      },
    });
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      // 로그인 팝업은 opener 관계가 필요해서, 같은 세션의 팝업 창으로 연다(웹 프로토콜만).
      if (isExternalHttpUrl(url) || url === 'about:blank') {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 720,
            autoHideMenuBar: true,
            webPreferences: { partition: w.partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
          },
        };
      }
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event) => {
      if (!isExternalHttpUrl(event.url)) event.preventDefault();
    });
    wc.on('will-attach-webview', (event) => event.preventDefault());
    const update = () => this.publish(wsId);
    wc.on('page-title-updated', update);
    wc.on('did-navigate', update);
    wc.on('did-navigate-in-page', update);
    wc.on('did-start-loading', update);
    wc.on('did-stop-loading', update);
    view.setVisible(false);
    this.win.contentView.addChildView(view);
    void wc.loadURL(tab.url).catch(() => undefined);
    return view;
  }

  private destroyView(tab: Tab): void {
    if (!tab.view) return;
    const info = this.info(tab);
    tab.url = info.url;
    tab.title = info.title;
    try {
      this.win.contentView.removeChildView(tab.view);
    } catch {
      /* 창이 이미 닫혔다 */
    }
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    tab.view = null;
  }

  list(wsId: string): { tabs: TabInfo[]; activeTabId: string | null } {
    const s = this.state(wsId);
    return { tabs: s.tabs.map((t) => this.info(t)), activeTabId: s.activeTabId };
  }

  openTab(wsId: string, rawUrl: string): TabInfo {
    const url = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    if (!isExternalHttpUrl(url)) throw new Error('http·https 주소만 열 수 있어요.');
    const s = this.state(wsId);
    if (s.tabs.length >= 30) throw new Error('탭은 워크스페이스마다 30개까지 열 수 있어요.');
    const tab: Tab = { id: newId('tab'), url, title: url, view: null };
    s.tabs.push(tab);
    s.activeTabId = tab.id;
    if (this.workspaces.get(wsId).state !== 'sleep') tab.view = this.createView(wsId, tab);
    this.layout();
    this.publish(wsId);
    return this.info(tab);
  }

  selectTab(wsId: string, tabId: string): void {
    const s = this.state(wsId);
    if (!s.tabs.some((t) => t.id === tabId)) throw new Error('탭을 찾을 수 없어요.');
    s.activeTabId = tabId;
    this.layout();
    this.publish(wsId);
  }

  closeTab(wsId: string, tabId: string): void {
    const s = this.state(wsId);
    const i = s.tabs.findIndex((t) => t.id === tabId);
    if (i < 0) return;
    const [tab] = s.tabs.splice(i, 1);
    if (tab) this.destroyView(tab);
    if (s.activeTabId === tabId) s.activeTabId = s.tabs[Math.max(0, i - 1)]?.id ?? null;
    this.layout();
    this.publish(wsId);
  }

  navigate(wsId: string, tabId: string, action: 'back' | 'forward' | 'reload' | { url: string }): void {
    const tab = this.state(wsId).tabs.find((t) => t.id === tabId);
    const wc = tab?.view?.webContents;
    if (!tab || !wc || wc.isDestroyed()) return;
    if (action === 'back') wc.navigationHistory.goBack();
    else if (action === 'forward') wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
    else {
      const url = /^[a-z][a-z0-9+.-]*:/i.test(action.url) ? action.url : `https://${action.url}`;
      if (!isExternalHttpUrl(url)) throw new Error('http·https 주소만 열 수 있어요.');
      void wc.loadURL(url).catch(() => undefined);
    }
  }

  /** 화면이 알려 준 영역에 지금 워크스페이스의 활성 탭만 보인다. null이면 모두 숨긴다(모달·다른 화면). */
  show(wsId: string | null, bounds: Rect | null): void {
    this.shown = wsId && bounds ? { wsId, bounds } : null;
    this.layout();
  }

  private layout(): void {
    const target = this.shown;
    for (const [wsId, s] of this.ws) {
      for (const t of s.tabs) {
        const visible = !!target && target.wsId === wsId && s.activeTabId === t.id;
        if (visible && !t.view && this.workspaces.has(wsId) && this.workspaces.get(wsId).state !== 'sleep') {
          t.view = this.createView(wsId, t);
        }
        if (!t.view) continue;
        if (visible && target) {
          t.view.setBounds({
            x: Math.round(target.bounds.x),
            y: Math.round(target.bounds.y),
            width: Math.max(0, Math.round(target.bounds.width)),
            height: Math.max(0, Math.round(target.bounds.height)),
          });
        }
        t.view.setVisible(visible);
      }
    }
    if (target && !this.ws.has(target.wsId) && this.workspaces.has(target.wsId)) {
      this.state(target.wsId);
      this.layout();
    }
  }

  /** 잠자기(FR-04): 웹 뷰를 닫아 메모리를 돌려받는다. 탭 주소는 남겨 두고 깨우면 다시 연다. */
  sleep(wsId: string): void {
    const s = this.ws.get(wsId);
    if (!s) return;
    for (const t of s.tabs) this.destroyView(t);
    this.publish(wsId);
  }

  /** 이 워크스페이스의 쿠키·저장소·캐시만 지운다(로그아웃). 다른 워크스페이스는 그대로다. */
  async clearSession(wsId: string): Promise<void> {
    const ses = this.sessionFor(wsId);
    await ses.clearStorageData();
    await ses.clearCache();
    for (const t of this.state(wsId).tabs) t.view?.webContents.reload();
  }

  async openDownloadFolder(wsId: string): Promise<void> {
    const dir = this.workspaces.get(wsId).downloadDir;
    mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
  }

  recentDownloads(wsId: string): DownloadDone[] {
    return this.downloads.get(wsId) ?? [];
  }

  /** S1 대안: 워크스페이스 전용 Edge 프로필로 연다(내장 브라우저 로그인이 막히는 서비스용). */
  openExternal(wsId: string, profileRoot: string, url: string): void {
    if (!isExternalHttpUrl(url)) throw new Error('http·https 주소만 열 수 있어요.');
    if (process.platform !== 'win32') {
      void shell.openExternal(url);
      return;
    }
    const candidates = [
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    const edge = candidates.find((p) => existsSync(p));
    if (!edge) throw new Error('Microsoft Edge를 찾지 못했어요.');
    const profile = join(profileRoot, wsId);
    mkdirSync(profile, { recursive: true });
    const child = spawn(edge, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', url], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  /** 워크스페이스 삭제: 웹 뷰를 닫고 이 세션의 저장소를 지운다. */
  async dispose(wsId: string, partition: string): Promise<void> {
    const s = this.ws.get(wsId);
    if (s) for (const t of s.tabs) this.destroyView(t);
    this.ws.delete(wsId);
    this.downloads.delete(wsId);
    await session.fromPartition(partition).clearStorageData();
  }

  flush(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistAll();
  }
}
