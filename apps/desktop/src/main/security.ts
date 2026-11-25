/**
 * 앱 화면(renderer) 창의 이동·새 창 정책. Electron API 없이 판단만 하는 순수 함수라 단위 테스트로 검증한다.
 *
 * - 앱 화면은 다른 페이지로 이동하지 않는다. 웹 페이지는 워크스페이스 브라우저(#26, WebContentsView)에서 연다.
 * - 화면 안의 링크 중 http·https만 사용자의 기본 브라우저로 넘긴다. file:, javascript:, data: 등은 막는다.
 */

/** 기본 브라우저로 넘겨도 되는 주소인지: http·https만 허용한다. */
export function isExternalHttpUrl(rawUrl: string): boolean {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * IPC를 보낸 화면이 Cadora 앱 화면인지(보안: 웹 페이지가 window.cadora 기능을 부르지 못하게).
 * 개발 중에는 Vite 개발 서버 출처, 배포 빌드에서는 앱에 들어 있는 renderer/index.html 파일만 허용한다.
 */
export function isAppSenderUrl(senderUrl: string, devServerUrl: string | undefined, rendererFileUrl: string): boolean {
  try {
    const u = new URL(senderUrl);
    if (devServerUrl) return u.origin === new URL(devServerUrl).origin;
    const expected = new URL(rendererFileUrl);
    return u.protocol === 'file:' && decodeURIComponent(u.pathname) === decodeURIComponent(expected.pathname);
  } catch {
    return false;
  }
}

/**
 * 앱 화면 창이 그대로 이동해도 되는 주소인지.
 * 개발 중에는 Vite 개발 서버의 새로고침(HMR)이 같은 출처로 이동하므로 허용하고,
 * 배포 빌드(file://)에서는 어떤 이동도 허용하지 않는다.
 */
export function isAllowedAppNavigation(targetUrl: string, devServerUrl: string | undefined): boolean {
  if (!devServerUrl) return false;
  try {
    return new URL(targetUrl).origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}
