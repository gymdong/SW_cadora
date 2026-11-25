import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// 진입점은 electron-vite 기본값을 따른다: src/main/index.ts · src/preload/index.ts · src/renderer/index.html
// 이 패키지는 dependencies를 비워 둔다. 그래야 main·preload가 쓰는 코드(@cadora/* 포함)가 모두 out/에 묶이고,
// electron-builder가 워크스페이스 node_modules를 뒤지지 않는다. 네이티브 모듈(node-pty 등)을 넣을 때 다시 정한다(#20, #28).

// 앱 화면의 Content-Security-Policy. 개발 서버는 HMR용 인라인 스크립트를 쓰므로 배포 빌드에만 넣는다.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'cadora:content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), contentSecurityPolicy()],
  },
});
