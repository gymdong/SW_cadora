import { describe, expect, it } from 'vitest';
import { isAllowedAppNavigation, isAppSenderUrl, isExternalHttpUrl } from './security';

describe('isExternalHttpUrl', () => {
  it.each(['https://github.com/gymdong/SW_cadora', 'http://localhost:3000/', 'HTTPS://EXAMPLE.COM'])(
    'allows %s',
    (url) => {
      expect(isExternalHttpUrl(url)).toBe(true);
    },
  );

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'cadora://invite/abc',
    'ms-settings:privacy',
    'not a url',
    '',
  ])('blocks %s', (url) => {
    expect(isExternalHttpUrl(url)).toBe(false);
  });
});

describe('isAllowedAppNavigation', () => {
  const dev = 'http://localhost:5173/';

  it('allows reloads from the dev server origin', () => {
    expect(isAllowedAppNavigation('http://localhost:5173/index.html', dev)).toBe(true);
  });

  it('blocks other origins during development', () => {
    expect(isAllowedAppNavigation('http://localhost:5174/', dev)).toBe(false);
    expect(isAllowedAppNavigation('https://example.com/', dev)).toBe(false);
  });

  it('blocks every navigation in packaged builds, including file URLs', () => {
    expect(isAllowedAppNavigation('file:///C:/Users/me/evil.html', undefined)).toBe(false);
    expect(isAllowedAppNavigation('http://localhost:5173/', undefined)).toBe(false);
  });
});

describe('isAppSenderUrl', () => {
  const file = 'file:///C:/Users/u/cadora/apps/desktop/out/renderer/index.html';
  it('배포 빌드: 앱의 renderer/index.html만 허용한다', () => {
    expect(isAppSenderUrl(file, undefined, file)).toBe(true);
    expect(isAppSenderUrl(`${file}#team`, undefined, file)).toBe(true);
    expect(isAppSenderUrl('file:///C:/Users/u/Downloads/evil.html', undefined, file)).toBe(false);
    expect(isAppSenderUrl('https://example.com/', undefined, file)).toBe(false);
  });
  it('개발 모드: Vite 개발 서버 출처만 허용한다', () => {
    expect(isAppSenderUrl('http://localhost:5173/#home', 'http://localhost:5173', file)).toBe(true);
    expect(isAppSenderUrl('http://localhost:5174/', 'http://localhost:5173', file)).toBe(false);
    expect(isAppSenderUrl('https://accounts.google.com/', 'http://localhost:5173', file)).toBe(false);
  });
  it('잘못된 주소는 거부한다', () => {
    expect(isAppSenderUrl('not a url', undefined, file)).toBe(false);
  });
});
