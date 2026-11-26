import { app, BrowserWindow, session, shell } from 'electron';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentManager } from './agents';
import { AuthService } from './auth';
import { AuthBackend } from './auth-backend';
import { authStore } from './auth-store';
import { BrowserManager } from './browser';
import { emit, setEventTarget } from './events';
import { HookReceiver } from './hooks';
import { registerIpc } from './ipc';
import { isAllowedAppNavigation, isAppSenderUrl, isExternalHttpUrl } from './security';
import { TerminalManager } from './terminals';
import { ProjectWatcher } from './watcher';
import { WorkspaceManager } from './workspaces';

// 모든 renderer(앱 화면, 워크스페이스 브라우저 뷰 포함)를 샌드박스로 띄운다. app ready 전에 불러야 한다.
app.enableSandbox();

// 테스트·시연용: 데이터 폴더를 따로 지정하면 한 PC에서 "기기 두 대"처럼 따로 띄울 수 있다(절대경로만).
const userDataOverride = process.env['CADORA_USER_DATA_DIR'];
if (userDataOverride && isAbsolute(userDataOverride)) app.setPath('userData', userDataOverride);

// 같은 데이터 폴더로 두 번 켜지 않는다(워크스페이스 JSON·로그인 정보를 두 프로세스가 동시에 쓰지 않게). 두 번째 실행은 기존 창을 앞으로 가져온다.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// 빌드 때 넣는 값(electron.vite.config.ts). 팀 서버 주소가 없으면 앱 안 임시 서버를 쓴다(auth-backend.ts).
declare const __CADORA_BUILD_SERVER_URL__: string;
declare const __CADORA_BUILD_GITHUB_CLIENT_ID__: string;

const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
const rendererFileUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Cadora',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // 새 창은 만들지 않는다. http·https 링크만 기본 브라우저로 넘긴다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 앱 화면 창은 다른 페이지로 이동하지 않는다(개발 서버 새로고침만 허용).
  win.webContents.on('will-navigate', (event) => {
    if (isAllowedAppNavigation(event.url, devServerUrl)) return;
    event.preventDefault();
    if (isExternalHttpUrl(event.url)) void shell.openExternal(event.url);
  });

  return win;
}

/** IPC를 모두 등록한 뒤에 화면을 불러온다(먼저 불러오면 첫 호출이 "No handler registered"로 실패한다). */
function loadApp(win: BrowserWindow): void {
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// 어떤 화면도 <webview>를 붙이지 못하게 한다.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

let cleanup: (() => Promise<void>) | null = null;
let quitting = false;

void app.whenReady().then(async () => {
  // 앱 화면(기본 세션)은 카메라·위치·알림 같은 권한이 필요 없다. 터미널 복사용 클립보드 쓰기만 허용한다.
  const APP_PERMISSIONS = new Set(['clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(APP_PERMISSIONS.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => APP_PERMISSIONS.has(permission));

  const win = createMainWindow();
  setEventTarget(win.webContents);

  const workspaces = new WorkspaceManager();
  const browser = new BrowserManager(win, workspaces);
  const terminals = new TerminalManager();
  const hooks = new HookReceiver();
  await hooks.start();
  const watcher = new ProjectWatcher();
  const relayPath = app.isPackaged ? join(process.resourcesPath, 'hook-relay.cjs') : join(app.getAppPath(), 'resources', 'hook-relay.cjs');
  const agents = new AgentManager(workspaces, terminals, hooks, relayPath, (e) => {
    if (!workspaces.has(e.wsId)) return;
    watcher.fromHook(e.wsId, workspaces.get(e.wsId).localPath, e.runId, e.signal);
  });
  await agents.detect();
  for (const w of workspaces.all()) void watcher.watch(w.id, w.localPath, w.downloadDir).catch(() => undefined);

  // Cadora 계정: 팀 서버(없으면 앱 안 임시 서버)의 GitHub Device Flow. refresh token은 safeStorage로 암호화해 둔다.
  const backend = new AuthBackend({
    userData: app.getPath('userData'),
    remoteUrl: process.env['CADORA_SERVER_URL'] ?? __CADORA_BUILD_SERVER_URL__,
    envClientId: process.env['CADORA_GITHUB_CLIENT_ID'] ?? '',
    buildClientId: __CADORA_BUILD_GITHUB_CLIENT_ID__,
    fakeGithub: process.env['CADORA_FAKE_GITHUB'],
  });
  await backend.start().catch(() => undefined);
  const store = authStore(join(app.getPath('userData'), 'auth.json'));
  const auth = new AuthService({
    server: () => backend.server(),
    loadRefreshToken: () => store.load(),
    saveRefreshToken: (token) => store.save(token),
    openExternal: (url) => shell.openExternal(url),
    onStatus: (status, message) => emit('team:authChanged', message ? { status, message } : { status }),
  });
  void auth.init();

  registerIpc({
    win,
    workspaces,
    browser,
    terminals,
    agents,
    watcher,
    auth,
    backend,
    profileRoot: join(app.getPath('userData'), 'browser-profiles'),
    isAppUrl: (url) => isAppSenderUrl(url, devServerUrl, rendererFileUrl),
  });
  loadApp(win);

  cleanup = async () => {
    auth.dispose();
    await backend.stop();
    browser.flush();
    await terminals.disposeAll();
    await watcher.disposeAll();
    await hooks.stop();
  };

  win.on('closed', () => setEventTarget(null));
});

// 끄기 전에 터미널·에이전트 프로세스 트리를 정리하고 감시·hook 수신을 멈춘다.
app.on('before-quit', (event) => {
  if (quitting || !cleanup) return;
  event.preventDefault();
  quitting = true;
  const done = () => app.exit(0);
  const timer = setTimeout(done, 5000);
  void cleanup()
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(timer);
      done();
    });
});

app.on('window-all-closed', () => {
  app.quit();
});
