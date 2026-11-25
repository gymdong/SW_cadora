import { contextBridge } from 'electron';
import { PROTOCOL_VERSION } from '@cadora/protocol';
import type { CadoraBridge } from '../shared/bridge';

// 샌드박스 preload는 electron 등 일부 모듈만 require할 수 있다.
// 그래서 @cadora/* 같은 워크스페이스 코드는 빌드 때 이 파일 안에 함께 묶인다(electron-vite).
const bridge: CadoraBridge = {
  platform: process.platform,
  protocolVersion: PROTOCOL_VERSION,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
};

contextBridge.exposeInMainWorld('cadora', bridge);
