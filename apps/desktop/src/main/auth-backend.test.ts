import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthBackend } from './auth-backend';

const backends: AuthBackend[] = [];
afterEach(async () => {
  while (backends.length) await backends.pop()!.stop();
});
function make(opts: Partial<ConstructorParameters<typeof AuthBackend>[0]> = {}) {
  const b = new AuthBackend({ userData: mkdtempSync(join(tmpdir(), 'cadora-backend-')), remoteUrl: '', envClientId: '', buildClientId: '', fakeGithub: 'http://127.0.0.1:9', ...opts });
  backends.push(b);
  return b;
}

describe('로그인 서버 고르기(AuthBackend)', () => {
  it('Client ID가 없으면 설정 필요, 넣으면 앱 안 임시 서버(127.0.0.1)를 켠다', async () => {
    const b = make();
    await b.start();
    expect(b.server()).toEqual({ url: null, state: 'needs_client_id' });
    const r = await b.setClientId('Ov23liBackendTest');
    expect(r.state).toBe('local');
    expect(r.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    expect(b.clientIdSource).toBe('user');
  });

  it('Client secret(40자리 16진수)은 거부하고 저장하지 않는다', async () => {
    const b = make();
    await expect(b.setClientId('0123456789abcdef0123456789abcdef01234567')).rejects.toThrow('secret');
    expect(b.clientIdSource).toBeNull();
  });

  it('저장을 두 번 눌러도 서버는 하나만 남는다', async () => {
    const b = make();
    const [a, c] = await Promise.all([b.setClientId('Ov23liBackendTest'), b.setClientId('Ov23liBackendTest')]);
    expect(a.url).not.toBe(c.url); // 두 번째가 첫 번째를 닫고 다시 켰다
    expect(b.server().url).toBe(c.url);
    await expect(fetch(`${a.url}/me`)).rejects.toThrow(); // 첫 서버는 닫혔다
  });

  it('팀 서버 주소가 있으면 임시 서버를 켜지 않고, 빌드에 넣은 Client ID는 앱에서 바꿀 수 없다', async () => {
    const remote = make({ remoteUrl: 'https://cadora.example.com/v1' });
    await remote.start();
    expect(remote.server()).toEqual({ url: 'https://cadora.example.com/v1', state: 'remote' });
    const built = make({ buildClientId: 'Ov23liBuiltInId' });
    await built.start();
    expect(built.server().state).toBe('local');
    await expect(built.setClientId('Ov23liOtherIdxx')).rejects.toThrow('이미 들어 있어요');
    const broken = make({ buildClientId: 'bad id!' });
    await broken.start();
    expect(broken.server().state).toBe('unavailable');
    expect(broken.lastError).toContain('형식');
  });
});
