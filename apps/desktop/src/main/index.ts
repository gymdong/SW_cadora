import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { isAllowedAppNavigation, isExternalHttpUrl } from './security';

// 모든 renderer(앱 화면, 이후 워크스페이스 브라우저 뷰 포함)를 샌드박스로 띄운다. app ready 전에 불러야 한다.
app.enableSandbox();

const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Cadora',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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

void app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
