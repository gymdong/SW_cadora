import { describe, expect, it } from 'vitest';
import { isAllowedAppNavigation, isExternalHttpUrl } from './security';

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
