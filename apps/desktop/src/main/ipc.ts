/**
 * IPC 등록(API.md §3, §8.2). 모든 호출은 두 가지를 검사한다.
 * 1) 보낸 곳: Cadora 앱 화면 창의 최상위 프레임이고 주소가 앱 화면인지(웹 뷰·iframe·다른 창은 거부).
 * 2) 입력값: zod 스키마로 형식·길이·범위를 확인한다. 검사에 실패하면 자세한 내용 없이 거부한다.
 */
import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { AgentManager } from './agents';
import type { AuthService } from './auth';
import type { BrowserManager } from './browser';
import { secretStoreAvailable } from './secrets';
import type { TerminalManager } from './terminals';
import { defaultShell } from './terminals';
import { baseEnv, withWorkspaceEnv } from './env';
import type { ProjectWatcher } from './watcher';
import { WORKSPACE_TYPES, type WorkspaceManager } from './workspaces';
import type { RuntimeInfo } from '../shared/bridge';

const Id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-f0-9]{12}$`));
const WsId = Id('ws');
const TabId = Id('tab');
const TermId = Id('term');
const RunId = Id('run');
const Url = z.string().min(1).max(2048);
const Bounds = z
  .object({
    x: z.number().min(-10000).max(100000),
    y: z.number().min(-10000).max(100000),
    width: z.number().min(0).max(100000),
    height: z.number().min(0).max(100000),
  })
  .strict();

export interface Services {
  win: BrowserWindow;
  workspaces: WorkspaceManager;
  browser: BrowserManager;
  terminals: TerminalManager;
  agents: AgentManager;
  watcher: ProjectWatcher;
  auth: AuthService;
  profileRoot: string;
  isAppUrl: (url: string) => boolean;
}

class Blocked extends Error {}

export function registerIpc(s: Services): void {
  const check = (e: IpcMainInvokeEvent | IpcMainEvent) => {
    const wc = s.win.webContents;
    const frame = e.senderFrame;
    if (e.sender !== wc || !frame || frame !== wc.mainFrame || !s.isAppUrl(frame.url)) throw new Blocked('허용되지 않은 호출이에요.');
  };
  const handle = <T extends z.ZodTuple>(channel: string, schema: T, fn: (args: z.infer<T>) => unknown) => {
    ipcMain.handle(`cadora:${channel}`, async (e, ...raw: unknown[]) => {
      check(e);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new Error('입력값이 올바르지 않아요.');
      return fn(parsed.data);
    });
  };
  const on = <T extends z.ZodTuple>(channel: string, schema: T, fn: (args: z.infer<T>) => void) => {
    ipcMain.on(`cadora:${channel}`, (e, ...raw: unknown[]) => {
      try {
        check(e);
      } catch {
        return;
      }
      const parsed = schema.safeParse(raw);
      if (parsed.success) fn(parsed.data);
    });
  };
  const termOf = (termId: string) => {
    const t = s.terminals.get(termId);
    if (!t) throw new Error('터미널을 찾을 수 없어요.');
    return t;
  };

  handle('runtime:info', z.tuple([]), async (): Promise<RuntimeInfo> => ({
    agentRuntime: 'pty',
    claudeAvailable: s.agents.claudeAvailable,
    hookRunner: s.agents.hookRunner,
    watcher: '@parcel/watcher',
    secretStore: await secretStoreAvailable(),
    authServer: s.auth.server,
    authServerState: s.auth.serverState,
  }));

  // Cadora 계정(API.md §1.1·§3). 토큰·기기 코드는 돌려주지 않는다.
  handle('team:login', z.tuple([]), () => s.auth.login());
  handle('team:cancelLogin', z.tuple([]), () => s.auth.cancelLogin());
  handle('team:openVerification', z.tuple([]), () => s.auth.openVerification());
  handle('team:me', z.tuple([]), () => s.auth.me());
  handle('team:logout', z.tuple([]), () => s.auth.logout());

  // 워크스페이스
  handle('workspace:list', z.tuple([]), () => s.workspaces.list());
  handle(
    'workspace:create',
    z.tuple([z.object({ name: z.string().max(100), type: z.enum(WORKSPACE_TYPES as [string, ...string[]]), localPath: z.string().max(1024).optional() }).strict()]),
    async ([input]) => {
      const w = s.workspaces.create(input as Parameters<WorkspaceManager['create']>[0]);
      await s.watcher.watch(w.id, w.localPath, w.downloadDir).catch(() => undefined);
      return w;
    },
  );
  handle('workspace:rename', z.tuple([WsId, z.string().max(100)]), ([id, name]) => s.workspaces.rename(id, name));
  handle('workspace:remove', z.tuple([WsId]), async ([id]) => {
    s.agents.forgetWorkspace(id);
    await s.terminals.closeWorkspace(id);
    await s.watcher.unwatch(id);
    const removed = s.workspaces.remove(id);
    await s.browser.dispose(id, removed.partition);
  });
  handle('workspace:activate', z.tuple([WsId]), ([id]) => s.workspaces.setState(id, 'active'));
  handle('workspace:setState', z.tuple([WsId, z.enum(['background', 'sleep'])]), ([id, state]) => {
    s.workspaces.setState(id, state);
    if (state === 'sleep') s.browser.sleep(id);
  });
  handle('workspace:setEnv', z.tuple([WsId, z.string().max(64), z.string().max(8192)]), ([id, name, value]) => s.workspaces.setEnv(id, name, value));
  handle('workspace:removeEnv', z.tuple([WsId, z.string().max(64)]), ([id, name]) => s.workspaces.removeEnv(id, name));
  handle('workspace:openFolder', z.tuple([WsId]), async ([id]) => {
    const err = await shell.openPath(s.workspaces.get(id).localPath);
    if (err) throw new Error(err);
  });
  handle('workspace:pickFolder', z.tuple([]), async () => {
    const r = await dialog.showOpenDialog(s.win, { title: '워크스페이스 폴더 선택', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  // 브라우저
  handle('browser:openTab', z.tuple([WsId, Url]), ([wsId, url]) => s.browser.openTab(wsId, url));
  handle('browser:closeTab', z.tuple([WsId, TabId]), ([wsId, tabId]) => s.browser.closeTab(wsId, tabId));
  handle('browser:selectTab', z.tuple([WsId, TabId]), ([wsId, tabId]) => s.browser.selectTab(wsId, tabId));
  handle('browser:listTabs', z.tuple([WsId]), ([wsId]) => s.browser.list(wsId));
  handle(
    'browser:navigate',
    z.tuple([WsId, TabId, z.union([z.enum(['back', 'forward', 'reload']), z.object({ url: Url }).strict()])]),
    ([wsId, tabId, action]) => s.browser.navigate(wsId, tabId, action),
  );
  on('browser:showView', z.tuple([WsId.nullable(), Bounds.nullable()]), ([wsId, bounds]) => s.browser.show(wsId, bounds));
  handle('browser:clearSession', z.tuple([WsId]), ([wsId]) => s.browser.clearSession(wsId));
  handle('browser:openDownloadFolder', z.tuple([WsId]), ([wsId]) => s.browser.openDownloadFolder(wsId));
  handle('browser:recentDownloads', z.tuple([WsId]), ([wsId]) => s.browser.recentDownloads(wsId));
  handle('browser:openExternal', z.tuple([WsId, Url]), ([wsId, url]) => s.browser.openExternal(wsId, s.profileRoot, url));

  // 터미널
  handle('terminal:open', z.tuple([WsId]), async ([wsId]) => {
    const w = s.workspaces.get(wsId);
    const sh = defaultShell();
    const wsEnv = await s.workspaces.envValues(wsId);
    return s.terminals.spawn({
      wsId,
      title: process.platform === 'win32' ? 'PowerShell' : 'Shell',
      kind: 'shell',
      file: sh.file,
      args: sh.args,
      cwd: w.localPath,
      env: withWorkspaceEnv(baseEnv(), wsEnv),
    });
  });
  handle('terminal:list', z.tuple([WsId]), ([wsId]) => s.terminals.list(wsId));
  on('terminal:write', z.tuple([TermId, z.string().max(65536)]), ([termId, data]) => s.terminals.write(termId, data));
  on('terminal:resize', z.tuple([TermId, z.number().int().min(2).max(500), z.number().int().min(1).max(300)]), ([termId, cols, rows]) =>
    s.terminals.resize(termId, cols, rows),
  );
  handle('terminal:close', z.tuple([TermId]), async ([termId]) => {
    termOf(termId);
    await s.terminals.close(termId);
  });
  handle('terminal:backlog', z.tuple([TermId]), ([termId]) => s.terminals.backlog(termId));

  // 에이전트·파일
  handle('agents:start', z.tuple([WsId, z.object({ tool: z.literal('claude'), taskTitle: z.string().max(100) }).strict()]), ([wsId, input]) =>
    s.agents.start(wsId, input),
  );
  handle('agents:stop', z.tuple([RunId]), ([runId]) => s.agents.stop(runId));
  handle('agents:list', z.tuple([WsId]), ([wsId]) => s.agents.list(wsId));
  handle('files:recent', z.tuple([WsId]), ([wsId]) => s.watcher.recent(wsId));
}
