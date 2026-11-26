import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startLocalAuthServer, type LocalAuthServer } from './local-auth-server';

const CLIENT_ID = 'Ov23liUnitTestClient';
const gh = { mode: 'approve' as 'approve' | 'deny' | 'disabled', polls: 0, token: '', scopeAsked: false, userFails: 0, name: '단위 테스트' };
let fake: Server;
let fakeUrl = '';

beforeEach(async () => {
  Object.assign(gh, { mode: 'approve', polls: 0, token: '', scopeAsked: false, userFails: 0, name: '단위 테스트' });
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const p = new URLSearchParams(body);
      const json = (s: number, o: unknown) => {
        res.writeHead(s, { 'content-type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      if (req.url === '/login/device/code') {
        if (p.has('scope')) gh.scopeAsked = true;
        if (p.get('client_id') !== CLIENT_ID) return json(404, { error: 'Not Found' });
        gh.polls = 0;
        return json(200, { device_code: 'dc_' + 'x'.repeat(36), user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
      }
      if (req.url === '/login/oauth/access_token') {
        gh.polls += 1;
        if (p.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:device_code') return json(200, { error: 'unsupported_grant_type' });
        if (gh.mode === 'deny') return json(200, { error: 'access_denied' });
        if (gh.mode === 'disabled') return json(200, { error: 'device_flow_disabled' });
        if (gh.polls === 1) return json(200, { error: 'authorization_pending' });
        if (gh.polls === 2) return json(200, { error: 'slow_down', interval: 6 });
        gh.token = 'gho_' + 'y'.repeat(36);
        return json(200, { access_token: gh.token, token_type: 'bearer', scope: '' });
      }
      if (req.url === '/user') {
        if (req.headers.authorization !== `Bearer ${gh.token}`) return json(401, { message: 'Bad credentials' });
        if (gh.userFails > 0) { gh.userFails -= 1; return json(502, { message: 'bad gateway' }); }
        return json(200, { id: 4242, login: 'cadora-unit', name: gh.name, avatar_url: 'https://avatars.githubusercontent.com/u/4242?v=4' });
      }
      json(404, {});
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
});
afterEach(() => new Promise<void>((r) => fake.close(() => r())));

const servers: LocalAuthServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});
async function start(dataFile?: string) {
  const s = await startLocalAuthServer({ clientId: CLIENT_ID, fakeGithub: fakeUrl, dataFile });
  servers.push(s);
  return s;
}
function client(base: string) {
  return async (method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    return { status: r.status, data: t ? JSON.parse(t) : null };
  };
}
async function signIn(call: ReturnType<typeof client>) {
  const dev = await call('POST', '/auth/github/device', {});
  gh.polls = 2;
  const done = await call('POST', '/auth/github/poll', { deviceCode: dev.data.deviceCode });
  return done.data as { accessToken: string; refreshToken: string; needsSignup: boolean; user: { displayName: string } };
}

describe('앱 안 임시 인증 서버(API.md §7.1 + 데모 확장)', () => {
  it('Device Flow: 계약 필드, 대기 202, slow_down 429, 완료 200, scope 없음, 쓴 기기 코드 재사용 거부', async () => {
    const s = await start();
    const call = client(s.url);
    const dev = await call('POST', '/auth/github/device', {});
    expect(dev.status).toBe(200);
    expect(Object.keys(dev.data).sort()).toEqual(['deviceCode', 'expiresIn', 'interval', 'userCode', 'verificationUri']);
    expect(gh.scopeAsked).toBe(false);
    expect((await call('POST', '/auth/github/poll', { deviceCode: dev.data.deviceCode })).status).toBe(202);
    const slow = await call('POST', '/auth/github/poll', { deviceCode: dev.data.deviceCode });
    expect(slow).toMatchObject({ status: 429, data: { error: { code: 'slow_down', details: { retryAfterSeconds: 6 } } } });
    const done = await call('POST', '/auth/github/poll', { deviceCode: dev.data.deviceCode });
    expect(done.status).toBe(200);
    expect(done.data).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String), user: { displayName: '단위 테스트' }, needsSignup: true });
    expect((await call('POST', '/auth/github/poll', { deviceCode: dev.data.deviceCode })).status).toBe(400);
  });

  it('회원가입: 첫 로그인은 needsSignup, PATCH /me로 이름을 정하면 풀리고, 다음 로그인부터는 바로 들어온다', async () => {
    const s = await start();
    const call = client(s.url);
    const first = await signIn(call);
    expect(first.needsSignup).toBe(true);
    expect((await call('GET', '/me', undefined, first.accessToken)).data).toMatchObject({ needsSignup: true, workspaces: [] });
    expect((await call('PATCH', '/me', { displayName: '' }, first.accessToken)).status).toBe(400);
    expect((await call('PATCH', '/me', { displayName: 'x'.repeat(41) }, first.accessToken)).status).toBe(400);
    const patched = await call('PATCH', '/me', { displayName: '  김건한\u0007 ' }, first.accessToken);
    expect(patched).toMatchObject({ status: 200, data: { displayName: '김건한', needsSignup: false } });
    expect((await call('PATCH', '/me', { displayName: '남' })).status).toBe(401);
    const again = await signIn(call);
    expect(again).toMatchObject({ needsSignup: false, user: { displayName: '김건한' } });
  });

  it('refresh 회전, 폐기된 토큰 재사용 시 같은 계열 전체 폐기, 로그아웃 뒤 refresh·access 모두 401', async () => {
    const s = await start();
    const call = client(s.url);
    const t = await signIn(call);
    const r1 = await call('POST', '/auth/refresh', { refreshToken: t.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.data.refreshToken).not.toBe(t.refreshToken);
    expect((await call('POST', '/auth/refresh', { refreshToken: t.refreshToken })).status).toBe(401);
    expect((await call('POST', '/auth/refresh', { refreshToken: r1.data.refreshToken })).status).toBe(401);
    const t2 = await signIn(call);
    expect((await call('POST', '/auth/logout', { refreshToken: t2.refreshToken }, t2.accessToken)).status).toBe(204);
    expect((await call('POST', '/auth/refresh', { refreshToken: t2.refreshToken })).status).toBe(401);
    expect((await call('GET', '/me', undefined, t2.accessToken)).status).toBe(401);
  });

  it('거부 403, Origin 403, 다른 Host 421, JSON 아님 415, dev-login 닫힘, 잘못된 Client ID 거부', async () => {
    const s = await start();
    const call = client(s.url);
    gh.mode = 'deny';
    const dev = await call('POST', '/auth/github/device', {});
    expect(await call('POST', '/auth/github/poll', { deviceCode: dev.data.deviceCode })).toMatchObject({ status: 403, data: { error: { code: 'device_denied' } } });
    expect((await call('GET', '/me', undefined, undefined, { origin: 'https://evil.example' })).status).toBe(403);
    const port = new URL(s.url).port;
    const host = await new Promise<number>((resolve) => {
      const rq = request({ host: '127.0.0.1', port, path: '/v1/me', headers: { host: 'evil.example' } }, (rs) => resolve(rs.statusCode ?? 0));
      rq.end();
    });
    expect(host).toBe(421);
    expect((await fetch(s.url + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await call('POST', '/auth/dev-login', { displayName: 'x' })).status).toBe(404);
    await expect(startLocalAuthServer({ clientId: 'bad id!', fakeGithub: fakeUrl })).rejects.toThrow('Client ID');
    await expect(startLocalAuthServer({ clientId: CLIENT_ID, fakeGithub: 'https://evil.example' })).rejects.toThrow('이 PC');
  });

  it('앱을 다시 켜도(서버 재시작) 저장된 세션으로 이어지고, 저장 파일에는 토큰 원문이 없다', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cadora-local-auth-')), 'local-auth.json');
    const s1 = await start(file);
    const t = await signIn(client(s1.url));
    await client(s1.url)('PATCH', '/me', { displayName: '건한' }, t.accessToken);
    await s1.close();
    servers.splice(servers.indexOf(s1), 1);
    const s2 = await start(file);
    const call = client(s2.url);
    const r = await call('POST', '/auth/refresh', { refreshToken: t.refreshToken });
    expect(r.status).toBe(200);
    expect((await call('GET', '/me', undefined, r.data.accessToken)).data).toMatchObject({ displayName: '건한', needsSignup: false });
    const stored = readFileSync(file, 'utf8');
    for (const secret of [t.refreshToken, t.accessToken, r.data.refreshToken, gh.token]) expect(stored).not.toContain(secret);
    expect(stored).toMatch(/[0-9a-f]{64}/);
  });

  it('설정 오류(Device Flow 꺼짐)는 바로 끝나는 400, GitHub 프로필 조회가 잠깐 실패하면 다음 폴링에서 이어진다', async () => {
    const s = await start();
    const call = client(s.url);
    gh.mode = 'disabled';
    const d1 = await call('POST', '/auth/github/device', {});
    expect(await call('POST', '/auth/github/poll', { deviceCode: d1.data.deviceCode })).toMatchObject({ status: 400, data: { error: { code: 'provider_rejected' } } });
    gh.mode = 'approve';
    gh.userFails = 1;
    const d2 = await call('POST', '/auth/github/device', {});
    gh.polls = 2;
    expect((await call('POST', '/auth/github/poll', { deviceCode: d2.data.deviceCode })).status).toBe(503);
    const ok = await call('POST', '/auth/github/poll', { deviceCode: d2.data.deviceCode });
    expect(ok).toMatchObject({ status: 200, data: { user: { displayName: '단위 테스트' } } });
    expect(gh.polls).toBe(3); // 두 번째 폴링은 GitHub에 토큰을 다시 묻지 않았다
  });

  it('GitHub 이름은 40자로 자르고 보이지 않는 문자·방향 제어 문자를 지운다', async () => {
    gh.name = '\u202e' + '가'.repeat(60) + '\u200b';
    const s = await start();
    const t = await signIn(client(s.url));
    expect(t.user.displayName).toBe('가'.repeat(40));
    const p = await client(s.url)('PATCH', '/me', { displayName: 'ab\u202ecd\u2066' }, t.accessToken);
    expect(p.data.displayName).toBe('abcd');
  });

  it('저장 파일이 망가져 있어도(null) 새로 시작한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cadora-local-auth-'));
    const file = join(dir, 'local-auth.json');
    writeFileSync(file, 'null');
    const s = await start(file);
    expect((await signIn(client(s.url))).accessToken).toEqual(expect.any(String));
  });
});
