import { app, BrowserWindow, session, shell } from 'electron';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentManager } from './agents';
import { BrowserManager } from './browser';
import { setEventTarget } from './events';
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

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

// 어떤 화면도 <webview>를 붙이지 못하게 한다.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

let cleanup: (() => Promise<void>) | null = null;
let quitting = false;

void app.whenReady().then(async () => {
  // 앱 화면(기본 세션)은 카메라·위치·알림 같은 권한이 필요 없다.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

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

  registerIpc({
    win,
    workspaces,
    browser,
    terminals,
    agents,
    watcher,
    profileRoot: join(app.getPath('userData'), 'browser-profiles'),
    isAppUrl: (url) => isAppSenderUrl(url, devServerUrl, rendererFileUrl),
  });

  cleanup = async () => {
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
