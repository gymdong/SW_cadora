import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// 진입점은 electron-vite 기본값을 따른다: src/main/index.ts · src/preload/index.ts · src/renderer/index.html
// dependencies에는 네이티브 모듈(node-pty, @parcel/watcher)만 둔다. electron-vite가 이것만 번들 밖에 두고,
// electron-builder가 설치 파일에 넣어 asar 밖으로 푼다(electron-builder.yml asarUnpack). 나머지 코드는 out/에 묶인다.

// 설치 파일(배포 빌드)이 기본으로 쓸 Cadora 서버 주소. 빌드할 때 CADORA_BUILD_SERVER_URL로 넣는다.
// 비워 두면 앱 안 임시 서버(src/main/local-auth-server.ts)로 로그인한다.
const BUILD_SERVER_URL = process.env['CADORA_BUILD_SERVER_URL'] ?? '';
// 팀 서버가 없을 때 앱 안 임시 서버가 쓸 GitHub OAuth App Client ID(비밀값 아님). 비우면 앱이 처음 실행할 때 입력받는다.
const BUILD_GITHUB_CLIENT_ID = process.env['CADORA_BUILD_GITHUB_CLIENT_ID'] ?? '';

// 앱 화면의 Content-Security-Policy. 개발 서버는 HMR용 인라인 스크립트를 쓰므로 배포 빌드에만 넣는다.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // 로그인한 GitHub 사용자의 아바타만 외부 이미지로 허용한다(main이 이 주소만 화면에 넘긴다).
  "img-src 'self' data: https://avatars.githubusercontent.com",
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
  main: {
    define: {
      __CADORA_BUILD_SERVER_URL__: JSON.stringify(BUILD_SERVER_URL),
      __CADORA_BUILD_GITHUB_CLIENT_ID__: JSON.stringify(BUILD_GITHUB_CLIENT_ID),
    },
  },
  preload: {},
  renderer: {
    plugins: [react(), contentSecurityPolicy()],
  },
});
