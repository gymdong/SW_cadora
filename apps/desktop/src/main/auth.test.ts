import { describe, expect, it, vi } from 'vitest';
import { AuthService, isGithubVerificationUri, parseServerUrl, safeAvatarUrl } from './auth';
import type { AuthStatus } from '../shared/bridge';

const BASE = 'http://127.0.0.1:4000/v1';
const DEVICE = { deviceCode: 'dc-secret', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900 };
const AVATAR = 'https://avatars.githubusercontent.com/u/1?v=4';
const USER = { id: 'c1', displayName: '건한', avatarUrl: AVATAR };
const ME = { ...USER, workspaces: [] };
/** 앱이 화면에 주는 내 정보: 가입 마무리 여부가 붙는다. */
const ME_OUT = { ...ME, needsSignup: false };

type Reply = { status: number; body?: unknown } | Error;
type Handler = (body: Record<string, unknown> | undefined, auth: string | undefined) => Reply | Promise<Reply>;

function fakeServer(routes: Record<string, Handler>) {
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown>; auth?: string }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, '');
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body, auth: headers['authorization'] });
    const h = routes[`${method} ${path}`];
    const r = h ? await h(body, headers['authorization']) : { status: 404, body: { error: { code: 'not_found' } } };
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

function setup(routes: Record<string, Handler>, opts: { stored?: string | null; serverUrl?: string | null; sleep?: (ms: number) => Promise<void> } = {}) {
  const url = opts.serverUrl === undefined ? BASE : opts.serverUrl;
  const srv = fakeServer(routes);
  const statuses: Array<[AuthStatus, string | undefined]> = [];
  const saved: Array<string | null> = [];
  const opened: string[] = [];
  const sleeps: number[] = [];
  let now = 1_000_000;
  const auth = new AuthService({
    server: () => ({ url, state: url ? 'remote' : 'invalid' }),
    loadRefreshToken: async () => opts.stored ?? null,
    saveRefreshToken: async (t) => {
      saved.push(t);
    },
    openExternal: async (u) => {
      opened.push(u);
    },
    onStatus: (s, m) => statuses.push([s, m]),
    fetch: srv.fetchFn,
    sleep:
      opts.sleep ??
      (async (ms) => {
        sleeps.push(ms);
        now += ms;
      }),
    now: () => now,
  });
  const polls = () => srv.calls.filter((c) => c.path === '/auth/github/poll').length;
  return { auth, srv, statuses, saved, opened, sleeps, polls };
}

const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
const pendingReply = { status: 202, body: { status: 'pending' } };
const loginDone = (at = 'at-1', rt = 'rt-1') => ({ status: 200, body: { accessToken: at, refreshToken: rt, user: USER } });
const meFor = (token: string) => (_b: unknown, auth: string | undefined): Reply => (auth === `Bearer ${token}` ? { status: 200, body: ME } : { status: 401, body: { error: { code: 'unauthenticated' } } });
const never = () => new Promise<void>(() => undefined);

describe('주소 검사', () => {
  it('서버 주소는 https, 또는 이 PC의 http만 받는다', () => {
    expect(parseServerUrl(undefined)).toBe('http://localhost:4000/v1');
    expect(parseServerUrl('https://cadora.example.com/v1/')).toBe('https://cadora.example.com/v1');
    expect(parseServerUrl('http://127.0.0.1:4000/v1')).toBe('http://127.0.0.1:4000/v1');
    expect(parseServerUrl('http://cadora.example.com/v1')).toBeNull();
    expect(parseServerUrl('https://user:pw@cadora.example.com/v1')).toBeNull();
    expect(parseServerUrl('file:///C:/Windows')).toBeNull();
    expect(parseServerUrl('주소 아님')).toBeNull();
  });

  it('로그인 페이지는 https://github.com만, 아바타는 GitHub 아바타 주소만 쓴다', () => {
    expect(isGithubVerificationUri('https://github.com/login/device')).toBe(true);
    expect(isGithubVerificationUri('http://github.com/login/device')).toBe(false);
    expect(isGithubVerificationUri('https://github.com.evil.example/login/device')).toBe(false);
    expect(isGithubVerificationUri('https://user@github.com/login/device')).toBe(false);
    expect(isGithubVerificationUri('https://github.com:8443/login/device')).toBe(false);
    expect(safeAvatarUrl(AVATAR)).toBe(AVATAR);
    expect(safeAvatarUrl('https://evil.example/pixel.png')).toBeNull();
    expect(safeAvatarUrl(null)).toBeNull();
  });
});

describe('Device Flow 로그인', () => {
  it('승인될 때까지 interval마다 묻고, 화면에는 코드·주소·내 정보만 준다', async () => {
    let n = 0;
    const t = setup({
      'POST /auth/github/device': () => ({ status: 200, body: DEVICE }),
      'POST /auth/github/poll': (b) => (b?.['deviceCode'] === 'dc-secret' && ++n >= 3 ? loginDone() : pendingReply),
      'GET /me': meFor('at-1'),
    });
    const start = await t.auth.login();
    expect(start).toEqual({ userCode: 'WDJB-MJHT', verificationUri: DEVICE.verificationUri, expiresAt: expect.any(String) });
    expect(JSON.stringify(start)).not.toContain('dc-secret');
    await vi.waitFor(() => expect(t.auth.status).toBe('authenticated'));
    expect(t.statuses.map((s) => s[0])).toEqual(['pending', 'authenticated']);
    expect(t.sleeps).toEqual([5000, 5000, 5000]);
    expect(t.saved).toEqual(['rt-1']);
    const me = await t.auth.me();
    expect(me).toEqual(ME_OUT);
    expect(JSON.stringify(me)).not.toMatch(/at-1|rt-1|dc-secret/);
  });

  it('slow_down이면 간격을 늘린다(최소 +5초, 서버가 준 retryAfterSeconds 이상)', async () => {
    const replies: Reply[] = [pendingReply, { status: 429, body: { error: { code: 'slow_down', details: { retryAfterSeconds: 12 } } } }, loginDone()];
    const t = setup({
      'POST /auth/github/device': () => ({ status: 200, body: DEVICE }),
      'POST /auth/github/poll': () => replies.shift() ?? pendingReply,
      'GET /me': meFor('at-1'),
    });
    await t.auth.login();
    await vi.waitFor(() => expect(t.auth.status).toBe('authenticated'));
    expect(t.sleeps).toEqual([5000, 5000, 12000]);
  });

  it('거부(403 device_denied)와 만료(410 device_expired)를 알리고 멈춘다', async () => {
    const denied = setup({
      'POST /auth/github/device': () => ({ status: 200, body: DEVICE }),
      'POST /auth/github/poll': () => ({ status: 403, body: { error: { code: 'device_denied' } } }),
    });
    await denied.auth.login();
    await vi.waitFor(() => expect(denied.auth.status).toBe('denied'));
    expect(denied.statuses.at(-1)?.[1]).toContain('거부');
    expect(denied.polls()).toBe(1);
    expect(denied.saved).toEqual([]);

    const expired = setup({
      'POST /auth/github/device': () => ({ status: 200, body: DEVICE }),
      'POST /auth/github/poll': () => ({ status: 410, body: { error: { code: 'device_expired' } } }),
    });
    await expired.auth.login();
    await vi.waitFor(() => expect(expired.auth.status).toBe('expired'));
    expect(expired.polls()).toBe(1);
  });

  it('expiresIn이 지나면 더 묻지 않고 만료로 끝낸다', async () => {
    const t = setup({
      'POST /auth/github/device': () => ({ status: 200, body: { ...DEVICE, expiresIn: 6 } }),
      'POST /auth/github/poll': () => pendingReply,
    });
    await t.auth.login();
    await vi.waitFor(() => expect(t.auth.status).toBe('expired'));
    expect(t.polls()).toBe(1);
  });

  it('서버가 github.com이 아닌 주소를 주면 로그인을 시작하지 않고 열지도 않는다', async () => {
    const t = setup({
      'POST /auth/github/device': () => ({ status: 200, body: { ...DEVICE, verificationUri: 'https://evil.example/login/device' } }),
    });
    await expect(t.auth.login()).rejects.toThrow('github.com');
    await expect(t.auth.openVerification()).rejects.toThrow();
    expect(t.opened).toEqual([]);
    expect(t.polls()).toBe(0);
  });

  it('GitHub 페이지는 사용자가 요청할 때만 열고, 취소하면 더 묻지 않는다', async () => {
    const t = setup(
      { 'POST /auth/github/device': () => ({ status: 200, body: DEVICE }), 'POST /auth/github/poll': () => pendingReply },
      { sleep: never },
    );
    await t.auth.login();
    expect(t.opened).toEqual([]);
    await t.auth.openVerification();
    expect(t.opened).toEqual(['https://github.com/login/device']);
    t.auth.cancelLogin();
    expect(t.auth.status).toBe('logged_out');
    await expect(t.auth.openVerification()).rejects.toThrow('진행 중인 로그인');
  });

  it('서버가 꺼져 있거나 주소 설정이 잘못되면 알아볼 수 있는 오류를 낸다', async () => {
    const down = setup({ 'POST /auth/github/device': () => refused() });
    await expect(down.auth.login()).rejects.toMatchObject({ code: 'server_unreachable', message: expect.stringContaining('127.0.0.1:4000') });
    const bad = setup({}, { serverUrl: null });
    await expect(bad.auth.login()).rejects.toMatchObject({ code: 'config' });
    const none = new AuthService({
      server: () => ({ url: null, state: 'needs_client_id' }),
      loadRefreshToken: async () => null,
      saveRefreshToken: async () => undefined,
      openExternal: async () => undefined,
      onStatus: () => undefined,
    });
    expect(none.serverState).toBe('needs_client_id');
    await expect(none.login()).rejects.toMatchObject({ code: 'client_id_missing', message: expect.stringContaining('Client ID') });
    const provider = setup({
      'POST /auth/github/device': () => ({ status: 503, body: { error: { code: 'provider_unavailable', message: 'Device Flow가 꺼져 있어요' } } }),
    });
    await expect(provider.auth.login()).rejects.toMatchObject({ code: 'provider_unavailable', message: expect.stringContaining('Device Flow') });
  });
});

describe('세션 유지와 갱신', () => {
  it('앱을 다시 켜면 저장된 refresh token으로 세션을 되살리고 새 토큰을 저장한다', async () => {
    const t = setup(
      {
        'POST /auth/refresh': (b) => (b?.['refreshToken'] === 'rt-old' ? { status: 200, body: { accessToken: 'at-2', refreshToken: 'rt-2' } } : { status: 401 }),
        'GET /me': meFor('at-2'),
      },
      { stored: 'rt-old' },
    );
    await t.auth.init();
    expect(t.auth.status).toBe('authenticated');
    expect(t.saved).toEqual(['rt-2']);
    expect(await t.auth.me()).toEqual(ME_OUT);
  });

  it('폐기된 refresh token이면 지우고 만료를 알린다', async () => {
    const t = setup({ 'POST /auth/refresh': () => ({ status: 401, body: { error: { code: 'unauthenticated' } } }) }, { stored: 'rt-revoked' });
    await t.auth.init();
    expect(t.auth.status).toBe('expired');
    expect(t.saved).toEqual([null]);
    expect(await t.auth.me()).toBeNull();
  });

  it('서버가 꺼져 있으면 토큰을 지우지 않고, 서버가 돌아오면 다시 붙는다', async () => {
    let up = false;
    const t = setup(
      {
        'POST /auth/refresh': () => (up ? { status: 200, body: { accessToken: 'at-2', refreshToken: 'rt-2' } } : refused()),
        'GET /me': meFor('at-2'),
      },
      { stored: 'rt-old' },
    );
    await t.auth.init();
    expect(t.auth.status).toBe('logged_out');
    expect(t.saved).toEqual([]);
    await expect(t.auth.me()).rejects.toMatchObject({ code: 'server_unreachable' });
    up = true;
    expect(await t.auth.me()).toEqual(ME_OUT);
    expect(t.saved).toEqual(['rt-2']);
  });

  it('갱신 응답을 잃으면(요청은 나갔을 수 있음) 다시 로그인하게 한다', async () => {
    const t = setup({ 'POST /auth/refresh': () => new Error('timeout') }, { stored: 'rt-old' });
    await t.auth.init();
    expect(t.auth.status).toBe('expired');
    expect(t.saved).toEqual([null]);
  });

  it('동시에 401을 받아도 갱신 요청은 하나만 보낸다', async () => {
    let valid = 'at-2';
    let n = 1;
    const t = setup(
      {
        'POST /auth/refresh': () => {
          n += 1;
          valid = `at-${n}`;
          return { status: 200, body: { accessToken: valid, refreshToken: `rt-${n}` } };
        },
        'GET /me': (_b, auth) => (auth === `Bearer ${valid}` ? { status: 200, body: ME } : { status: 401 }),
      },
      { stored: 'rt-1' },
    );
    await t.auth.init(); // 갱신 1번 → at-2
    valid = 'none'; // 서버가 at-2를 더는 받지 않는다
    const [a, b] = await Promise.all([t.auth.me(), t.auth.me()]);
    expect(a).toEqual(ME_OUT);
    expect(b).toEqual(ME_OUT);
    expect(t.srv.calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(2);
  });

  it('로그아웃은 서버에 refresh token 폐기를 요청하고, 실패해도 이 PC의 로그인 정보를 지운다', async () => {
    const t = setup({
      'POST /auth/github/device': () => ({ status: 200, body: DEVICE }),
      'POST /auth/github/poll': () => loginDone(),
      'GET /me': meFor('at-1'),
      'POST /auth/logout': () => ({ status: 204 }),
    });
    await t.auth.login();
    await vi.waitFor(() => expect(t.auth.status).toBe('authenticated'));
    await t.auth.logout();
    const call = t.srv.calls.find((c) => c.path === '/auth/logout');
    expect(call).toMatchObject({ method: 'POST', body: { refreshToken: 'rt-1' }, auth: 'Bearer at-1' });
    expect(t.saved.at(-1)).toBeNull();
    expect(t.auth.status).toBe('logged_out');
    expect(await t.auth.me()).toBeNull();

    const broken = setup(
      { 'POST /auth/refresh': () => ({ status: 200, body: { accessToken: 'at-2', refreshToken: 'rt-2' } }), 'GET /me': meFor('at-2'), 'POST /auth/logout': () => refused() },
      { stored: 'rt-old' },
    );
    await broken.auth.init();
    await broken.auth.logout();
    expect(broken.saved.at(-1)).toBeNull();
    expect(broken.auth.status).toBe('logged_out');
  });

  it('서버가 준 아바타가 GitHub 주소가 아니면 화면에 넘기지 않는다', async () => {
    const t = setup(
      {
        'POST /auth/refresh': () => ({ status: 200, body: { accessToken: 'at-2', refreshToken: 'rt-2' } }),
        'GET /me': () => ({ status: 200, body: { ...ME, avatarUrl: 'https://evil.example/pixel.png' } }),
      },
      { stored: 'rt-old' },
    );
    await t.auth.init();
    expect((await t.auth.me())?.avatarUrl).toBeNull();
  });
});

describe('회원가입(첫 GitHub 로그인)', () => {
  it('처음 온 사람은 needsSignup이 붙고, 이름을 정하면 풀린다(PATCH /me)', async () => {
    let registered = false;
    let name = '건한';
    const me = () => ({ ...USER, displayName: name, workspaces: [], needsSignup: !registered });
    const t = setup({
      'POST /auth/github/device': () => ({ status: 200, body: DEVICE }),
      'POST /auth/github/poll': () => ({ status: 200, body: { accessToken: 'at-1', refreshToken: 'rt-1', user: USER, needsSignup: true } }),
      'GET /me': (_b, a) => (a === 'Bearer at-1' ? { status: 200, body: me() } : { status: 401 }),
      'PATCH /me': (b, a) => {
        if (a !== 'Bearer at-1') return { status: 401 };
        name = String(b?.['displayName']);
        registered = true;
        return { status: 200, body: me() };
      },
    });
    await t.auth.login();
    await vi.waitFor(() => expect(t.auth.status).toBe('authenticated'));
    expect((await t.auth.me())?.needsSignup).toBe(true);
    const done = await t.auth.updateProfile('김건한');
    expect(done).toMatchObject({ displayName: '김건한', needsSignup: false });
    expect(t.srv.calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/me', body: { displayName: '김건한' }, auth: 'Bearer at-1' });
    expect((await t.auth.me())?.needsSignup).toBe(false);
  });

  it('로그인 전에는 가입 마무리를 할 수 없다', async () => {
    const t = setup({});
    await expect(t.auth.updateProfile('누구')).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
