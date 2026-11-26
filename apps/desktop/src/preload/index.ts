import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { PROTOCOL_VERSION } from '@cadora/protocol';
import type { CadoraBridge, CadoraEventName } from '../shared/bridge';

// 샌드박스 preload는 electron 등 일부 모듈만 require할 수 있다.
// 그래서 @cadora/* 같은 워크스페이스 코드는 빌드 때 이 파일 안에 함께 묶인다(electron-vite).
// 화면에는 아래 함수만 연다. ipcRenderer 자체나 임의 채널은 열지 않는다.

const EVENTS: readonly CadoraEventName[] = [
  'workspace:changed',
  'browser:tabs',
  'download:done',
  'terminal:data',
  'terminal:list',
  'agent:status',
  'file:changed',
  'team:authChanged',
];

const call = <T>(channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`cadora:${channel}`, ...args).catch((err: unknown) => {
    // "Error invoking remote method 'x': Error: 메시지" → "메시지"
    const msg = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err);
    throw new Error(msg);
  }) as Promise<T>;

const bridge: CadoraBridge = {
  platform: process.platform,
  protocolVersion: PROTOCOL_VERSION,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  runtime: { info: () => call('runtime:info') },
  workspace: {
    list: () => call('workspace:list'),
    create: (input) => call('workspace:create', input),
    rename: (id, name) => call('workspace:rename', id, name),
    remove: (id) => call('workspace:remove', id),
    activate: (id) => call('workspace:activate', id),
    setState: (id, state) => call('workspace:setState', id, state),
    setEnv: (id, name, value) => call('workspace:setEnv', id, name, value),
    removeEnv: (id, name) => call('workspace:removeEnv', id, name),
    openFolder: (id) => call('workspace:openFolder', id),
    pickFolder: () => call('workspace:pickFolder'),
  },
  browser: {
    openTab: (wsId, url) => call('browser:openTab', wsId, url),
    closeTab: (wsId, tabId) => call('browser:closeTab', wsId, tabId),
    selectTab: (wsId, tabId) => call('browser:selectTab', wsId, tabId),
    listTabs: (wsId) => call('browser:listTabs', wsId),
    navigate: (wsId, tabId, action) => call('browser:navigate', wsId, tabId, action),
    showView: (wsId, bounds) => ipcRenderer.send('cadora:browser:showView', wsId, bounds),
    clearSession: (wsId) => call('browser:clearSession', wsId),
    openDownloadFolder: (wsId) => call('browser:openDownloadFolder', wsId),
    recentDownloads: (wsId) => call('browser:recentDownloads', wsId),
    openExternal: (wsId, url) => call('browser:openExternal', wsId, url),
  },
  terminal: {
    open: (wsId) => call('terminal:open', wsId),
    list: (wsId) => call('terminal:list', wsId),
    write: (termId, data) => ipcRenderer.send('cadora:terminal:write', termId, data),
    resize: (termId, cols, rows) => ipcRenderer.send('cadora:terminal:resize', termId, cols, rows),
    close: (termId) => call('terminal:close', termId),
    backlog: (termId) => call('terminal:backlog', termId),
  },
  agents: {
    start: (wsId, input) => call('agents:start', wsId, input),
    stop: (runId) => call('agents:stop', runId),
    list: (wsId) => call('agents:list', wsId),
  },
  files: {
    recent: (wsId) => call('files:recent', wsId),
  },
  team: {
    login: () => call('team:login'),
    cancelLogin: () => call('team:cancelLogin'),
    openVerification: () => call('team:openVerification'),
    me: () => call('team:me'),
    logout: () => call('team:logout'),
    completeSignup: (displayName) => call('team:completeSignup', displayName),
    setGithubClientId: (clientId) => call('team:setGithubClientId', clientId),
  },
  on: (event, cb) => {
    if (!EVENTS.includes(event)) throw new Error('알 수 없는 이벤트예요.');
    const channel = `cadora:event:${event}`;
    const listener = (_e: IpcRendererEvent, payload: Parameters<typeof cb>[0]) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
};

contextBridge.exposeInMainWorld('cadora', bridge);
