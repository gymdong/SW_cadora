/**
 * 앱 안의 임시 인증 서버(데모 브랜치 전용). 윤일준 님의 Java 서버(#46·#49)가 생기기 전까지 API.md §1.1·§1.2·§6.3·§7.1의
 * 인증 API를 같은 모양으로 흉내 낸다. 서버가 생기면 CADORA_SERVER_URL(또는 빌드 때 주소)로 그 서버를 쓰고 이건 켜지 않는다.
 *
 * - GitHub Device Flow는 진짜 GitHub에 묻는다. 필요한 건 OAuth App의 Client ID뿐이다(Client secret 없음, scope 없음).
 *   GitHub 토큰은 /user를 한 번 읽고 버린다(저장하지 않는다).
 * - 127.0.0.1의 무작위 포트에서만 받는다. Host 헤더를 확인하고(DNS rebinding), Origin 헤더가 있는 요청(브라우저 페이지)은 거부한다.
 * - refresh token은 SHA-256 해시만 저장한다. access token과 기기 코드는 메모리에만 둔다. 요청 본문·토큰은 어디에도 남기지 않는다.
 * - 계정은 이 PC에만 있다. 다른 PC와 공유되지 않는다.
 * - /auth/dev-login(시연용 가짜 로그인)은 열지 않는다.
 * - 데모 확장(API.md에 없음, 윤일준 님께 제안): poll 완료·GET /me의 needsSignup, PATCH /me { displayName }(가입 마무리).
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readJson, writeJsonAtomic } from './store';

export const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export interface LocalAuthServerOptions {
  clientId: string;
  /** 사용자·세션(해시) 저장 파일. 없으면 메모리에만 둔다. */
  dataFile?: string;
  /** 자동 테스트 전용: github.com 대신 이 PC의 가짜 GitHub(http://127.0.0.1:…)에 묻는다. */
  fakeGithub?: string;
  port?: number;
  fetch?: typeof fetch;
}

export interface LocalAuthServer {
  url: string;
  close(): Promise<void>;
}

/** 이 PC의 http 주소면 origin, 아니면 null. */
export function loopbackOrigin(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

interface UserRec {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** 가입 마무리(이름 확인·공유 범위 동의)를 했는지. */
  registered: boolean;
}
interface SessionRec {
  userId: string;
  family: string;
  exp: number;
  revoked: boolean;
}
interface Db {
  users: Record<string, UserRec>;
  sessions: Record<string, SessionRec>;
}

const ACCESS_TTL = 15 * 60 * 1000; // API.md §0
const REFRESH_TTL = 30 * 24 * 60 * 60 * 1000; // §6.3
const MAX_BODY = 64 * 1024;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const newId = () => 'c' + randomBytes(12).toString('hex');
// eslint-disable-next-line no-control-regex -- 이름에서 제어 문자를 지운다
const cleanName = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

export async function startLocalAuthServer(opts: LocalAuthServerOptions): Promise<LocalAuthServer> {
  if (!CLIENT_ID_PATTERN.test(opts.clientId)) throw new Error('GitHub Client ID 형식이 올바르지 않아요.');
  const fake = opts.fakeGithub ? loopbackOrigin(opts.fakeGithub) : null;
  if (opts.fakeGithub && !fake) throw new Error('가짜 GitHub 주소는 이 PC의 http 주소만 쓸 수 있어요.');
  const GH = fake ?? 'https://github.com';
  const GH_API = fake ?? 'https://api.github.com';
  const f = opts.fetch ?? fetch;
  const clientId = opts.clientId;

  const loaded = opts.dataFile ? readJson<Partial<Db>>(opts.dataFile, {}) : {};
  const db: Db = { users: loaded.users ?? {}, sessions: loaded.sessions ?? {} };
  const now = Date.now();
  for (const [k, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[k]; // 만료된 세션 정리
  const save = () => {
    if (opts.dataFile) writeJsonAtomic(opts.dataFile, db);
  };
  const accessTokens = new Map<string, { userId: string; family: string; exp: number }>();
  const deviceCodes = new Map<string, { exp: number }>();

  const issue = (userId: string, family = newId()) => {
    const accessToken = newToken();
    const refreshToken = newToken();
    accessTokens.set(sha(accessToken), { userId, family, exp: Date.now() + ACCESS_TTL });
    db.sessions[sha(refreshToken)] = { userId, family, exp: Date.now() + REFRESH_TTL, revoked: false };
    save();
    return { accessToken, refreshToken };
  };
  const revokeFamily = (family: string) => {
    for (const s of Object.values(db.sessions)) if (s.family === family) s.revoked = true;
    for (const [k, a] of accessTokens) if (a.family === family) accessTokens.delete(k);
    save();
  };
  const userById = (id: string) => Object.values(db.users).find((u) => u.id === id) ?? null;
  const bearer = (req: IncomingMessage) => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(req.headers.authorization ?? '');
    if (!m) return null;
    const a = accessTokens.get(sha(m[1]!));
    if (!a || a.exp < Date.now()) return null;
    const user = userById(a.userId);
    return user ? { user, family: a.family } : null;
  };
  const meOf = (u: UserRec) => ({ id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, workspaces: [], needsSignup: !u.registered });

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    if (body === undefined) {
      res.writeHead(status, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  const fail = (res: ServerResponse, status: number, code: string, message: string, details?: Record<string, unknown>) =>
    send(res, status, { error: { code, message, ...(details ? { details } : {}) } });

  const githubForm = async (path: string, params: Record<string, string>) => {
    const r = await f(`${GH}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'cadora-local-auth' },
      body: new URLSearchParams(params).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    let data: unknown;
    try {
      data = await r.json();
    } catch {
      data = null;
    }
    return { status: r.status, data: (data && typeof data === 'object' ? data : {}) as Record<string, unknown> };
  };
  const githubUser = async (token: string) => {
    const r = await f(`${GH_API}/user`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'cadora-local-auth' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  };

  type Route = (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown> | null) => Promise<void> | void;
  const routes: Record<string, Route> = {
    async 'POST /v1/auth/github/device'(_req, res) {
      let g;
      try {
        g = await githubForm('/login/device/code', { client_id: clientId }); // scope 없음: 공개 프로필만
      } catch {
        return fail(res, 503, 'provider_unavailable', 'GitHub에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
      }
      const d = g.data;
      if (g.status !== 200 || typeof d['device_code'] !== 'string' || typeof d['user_code'] !== 'string') {
        const why = typeof d['error'] === 'string' ? d['error'] : `HTTP ${g.status}`;
        const hint =
          why === 'device_flow_disabled' ? ' OAuth App 설정에서 Enable Device Flow를 켜세요.' : g.status === 404 || why === 'Not Found' ? ' Client ID를 확인하세요.' : '';
        return fail(res, 503, 'provider_unavailable', `GitHub이 로그인 코드를 주지 않았어요(${why}).${hint}`);
      }
      const expiresIn = Number(d['expires_in']) || 900;
      deviceCodes.set(sha(d['device_code']), { exp: Date.now() + expiresIn * 1000 });
      return send(res, 200, { deviceCode: d['device_code'], userCode: d['user_code'], verificationUri: d['verification_uri'], interval: Number(d['interval']) || 5, expiresIn });
    },

    async 'POST /v1/auth/github/poll'(_req, res, body) {
      const deviceCode = body?.['deviceCode'];
      if (typeof deviceCode !== 'string' || !deviceCode || deviceCode.length > 1024) {
        return fail(res, 400, 'invalid_request', 'deviceCode가 필요해요.', { fields: [{ path: 'deviceCode', message: '필요한 값이에요.' }] });
      }
      const key = sha(deviceCode);
      const dev = deviceCodes.get(key);
      if (!dev) return fail(res, 400, 'invalid_request', '이 서버가 발급한 기기 코드가 아니에요.');
      if (dev.exp < Date.now()) {
        deviceCodes.delete(key);
        return fail(res, 410, 'device_expired', '기기 코드가 만료됐어요.');
      }
      let g;
      try {
        g = await githubForm('/login/oauth/access_token', { client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      } catch {
        return fail(res, 503, 'provider_unavailable', 'GitHub에 연결하지 못했어요.');
      }
      const d = g.data;
      if (typeof d['access_token'] !== 'string') {
        switch (d['error']) {
          case 'authorization_pending':
            return send(res, 202, { status: 'pending' });
          case 'slow_down':
            return fail(res, 429, 'slow_down', '조금 천천히 물어봐 주세요.', { retryAfterSeconds: Number(d['interval']) || 10 });
          case 'expired_token':
          case 'token_expired':
            deviceCodes.delete(key);
            return fail(res, 410, 'device_expired', '기기 코드가 만료됐어요.');
          case 'access_denied':
            deviceCodes.delete(key);
            return fail(res, 403, 'device_denied', 'GitHub에서 로그인을 거부했어요.');
          case 'device_flow_disabled':
            return fail(res, 503, 'provider_unavailable', 'OAuth App에서 Device Flow가 꺼져 있어요(Enable Device Flow를 켜세요).');
          default:
            return fail(res, 503, 'provider_unavailable', `GitHub 응답: ${typeof d['error'] === 'string' ? d['error'] : `HTTP ${g.status}`}`);
        }
      }
      deviceCodes.delete(key);
      let gu: Record<string, unknown> | null;
      try {
        gu = await githubUser(d['access_token']); // 공개 프로필만 읽고 GitHub 토큰은 버린다
      } catch {
        gu = null;
      }
      if (!gu || (typeof gu['id'] !== 'number' && typeof gu['id'] !== 'string')) return fail(res, 503, 'provider_unavailable', 'GitHub 사용자 정보를 읽지 못했어요.');
      const ghKey = String(gu['id']);
      const prev = db.users[ghKey];
      const user: UserRec = prev ?? {
        id: newId(),
        displayName: cleanName(gu['name'] || gu['login'] || 'GitHub 사용자').slice(0, 100) || 'GitHub 사용자',
        avatarUrl: typeof gu['avatar_url'] === 'string' ? gu['avatar_url'] : null,
        registered: false,
      };
      if (prev && typeof gu['avatar_url'] === 'string') user.avatarUrl = gu['avatar_url'];
      db.users[ghKey] = user;
      const { workspaces: _w, needsSignup, ...pub } = meOf(user);
      void _w;
      return send(res, 200, { ...issue(user.id), user: pub, needsSignup });
    },

    async 'POST /v1/auth/refresh'(_req, res, body) {
      const rt = body?.['refreshToken'];
      if (typeof rt !== 'string' || !rt) return fail(res, 400, 'invalid_request', 'refreshToken이 필요해요.');
      const s = db.sessions[sha(rt)];
      if (!s) return fail(res, 401, 'unauthenticated', '유효하지 않은 토큰이에요.');
      if (s.revoked) {
        revokeFamily(s.family); // 재사용 감지: 같은 계열을 모두 폐기(§6.3)
        return fail(res, 401, 'unauthenticated', '이미 쓴 토큰이에요. 다시 로그인해 주세요.');
      }
      if (s.exp < Date.now()) return fail(res, 401, 'unauthenticated', '토큰이 만료됐어요.');
      s.revoked = true;
      return send(res, 200, issue(s.userId, s.family));
    },

    async 'POST /v1/auth/logout'(req, res, body) {
      const who = bearer(req);
      if (!who) return fail(res, 401, 'unauthenticated', '로그인이 필요해요.');
      const rt = body?.['refreshToken'];
      if (typeof rt !== 'string' || !rt) return fail(res, 400, 'invalid_request', 'refreshToken이 필요해요.');
      const s = db.sessions[sha(rt)];
      if (!s) return fail(res, 401, 'unauthenticated', '유효하지 않은 토큰이에요.');
      if (s.userId !== who.user.id) return fail(res, 403, 'forbidden', '본인 세션이 아니에요.');
      revokeFamily(s.family);
      return send(res, 204);
    },

    async 'GET /v1/me'(req, res) {
      const who = bearer(req);
      if (!who) return fail(res, 401, 'unauthenticated', '로그인이 필요해요.');
      return send(res, 200, meOf(who.user));
    },

    // 데모 확장: 가입 마무리(팀에 보일 이름 확인). API.md에는 없다.
    async 'PATCH /v1/me'(req, res, body) {
      const who = bearer(req);
      if (!who) return fail(res, 401, 'unauthenticated', '로그인이 필요해요.');
      const name = cleanName(body?.['displayName']);
      if (!name || name.length > 40) return fail(res, 400, 'invalid_request', '이름은 1~40자로 적어 주세요.', { fields: [{ path: 'displayName', message: '1~40자' }] });
      who.user.displayName = name;
      who.user.registered = true;
      save();
      return send(res, 200, meOf(who.user));
    },
  };

  let port = 0;
  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.headers.origin) return fail(res, 403, 'forbidden', '브라우저 페이지에서는 부를 수 없어요.');
        if (req.headers.host !== `127.0.0.1:${port}`) return fail(res, 421, 'forbidden', '이 PC에서만 받아요.');
        const path = new URL(req.url ?? '/', 'http://x').pathname;
        const route = routes[`${req.method} ${path}`];
        if (!route) {
          if (path === '/v1/auth/dev-login') return fail(res, 404, 'not_found', '이 임시 서버는 시연용 로그인(dev-login)을 열지 않아요.');
          return fail(res, 404, 'not_found', '없는 경로예요.');
        }
        let body: Record<string, unknown> | null = null;
        if (req.method === 'POST' || req.method === 'PATCH') {
          if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return fail(res, 415, 'invalid_request', 'JSON으로 보내 주세요.');
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const c of req) {
            size += (c as Buffer).length;
            if (size > MAX_BODY) return fail(res, 413, 'invalid_request', '요청이 너무 커요.');
            chunks.push(c as Buffer);
          }
          try {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
          } catch {
            return fail(res, 400, 'invalid_request', 'JSON 형식이 아니에요.');
          }
        }
        await route(req, res, body);
      } catch {
        if (!res.headersSent) fail(res, 500, 'internal_error', '임시 서버 오류예요.');
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
