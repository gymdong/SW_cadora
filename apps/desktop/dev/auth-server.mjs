// Cadora 로그인 임시 서버(로컬 대역, 데모 브랜치 전용).
// 윤일준 님의 Java 서버(#46·#49)에 인증 API가 생기기 전까지, 데스크톱 로그인을 실제 GitHub 계정으로 확인하는 용도다.
// Java 서버가 생기면 앱의 CADORA_SERVER_URL만 그 서버로 바꾸고 이 파일은 쓰지 않는다.
//
// - API.md §1.1·§1.2·§6.3·§7.1의 인증 API만 같은 모양으로 구현한다:
//   POST /v1/auth/github/device · /v1/auth/github/poll · /v1/auth/refresh · /v1/auth/logout, GET /v1/me
// - GitHub Device Flow는 진짜 GitHub에 묻는다. 필요한 건 OAuth App의 Client ID뿐이다(Client secret은 쓰지 않는다).
// - scope를 요청하지 않는다(공개 프로필 읽기만). GitHub 토큰은 /user를 한 번 읽고 버린다(저장하지 않는다).
// - 이 PC(127.0.0.1, ::1)에서만 받는다. Host 헤더도 확인하고(DNS rebinding), Origin 헤더가 있는 요청(브라우저 페이지)은 거부한다.
// - 기기 코드·토큰은 로그에 남기지 않는다. refresh token은 SHA-256 해시만 저장한다. access token은 메모리에만 둔다.
// - /v1/auth/dev-login(시연용 가짜 로그인)은 열지 않는다.
//
// 실행: node apps/desktop/dev/auth-server.mjs --client-id-file <Client ID를 넣은 파일> [--data <세션 저장 JSON>] [--port 4000]
//   환경변수로도 된다: CADORA_GITHUB_CLIENT_ID, CADORA_AUTH_DATA, CADORA_AUTH_PORT
// 자동 테스트 전용: CADORA_FAKE_GITHUB=http://127.0.0.1:<port> 이면 github.com 대신 그 주소(이 PC만)에 묻는다.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const log = (msg) => console.log(`[auth-server] ${msg}`);
const die = (msg, code = 2) => {
  console.error(`[auth-server] ${msg}`);
  process.exit(code);
};

const clientIdFile = arg('--client-id-file');
let CLIENT_ID = '';
try {
  CLIENT_ID = (clientIdFile ? readFileSync(clientIdFile, 'utf8') : (process.env.CADORA_GITHUB_CLIENT_ID ?? '')).replace(/^\uFEFF/, '').trim();
} catch {
  die(`Client ID 파일을 읽지 못했어요: ${clientIdFile}`);
}
if (!/^[A-Za-z0-9._-]{8,64}$/.test(CLIENT_ID)) {
  die('GitHub OAuth App의 Client ID가 필요해요. --client-id-file <파일> 또는 CADORA_GITHUB_CLIENT_ID로 넣어 주세요.');
}

const PORT = Number(arg('--port') ?? process.env.CADORA_AUTH_PORT ?? 4000);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) die('포트가 올바르지 않아요.');
const DATA = arg('--data') ?? process.env.CADORA_AUTH_DATA ?? '';

function loopbackOrigin(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}
const FAKE = process.env.CADORA_FAKE_GITHUB ?? '';
const FAKE_ORIGIN = FAKE ? loopbackOrigin(FAKE) : null;
if (FAKE && !FAKE_ORIGIN) die('CADORA_FAKE_GITHUB는 이 PC의 http 주소만 쓸 수 있어요.');
const GH = FAKE_ORIGIN ?? 'https://github.com';
const GH_API = FAKE_ORIGIN ?? 'https://api.github.com';

const ACCESS_TTL = 15 * 60 * 1000; // API.md §0: access token 15분
const REFRESH_TTL = 30 * 24 * 60 * 60 * 1000; // §6.3: refresh token 30일
const sha = (s) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const newId = () => 'c' + randomBytes(12).toString('hex');

// 저장: GitHub 사용자 id → Cadora 사용자, refresh token 해시 → 세션. access token과 기기 코드는 메모리에만 둔다.
const db = { users: {}, sessions: {} };
if (DATA && existsSync(DATA)) {
  try {
    const saved = JSON.parse(readFileSync(DATA, 'utf8'));
    db.users = saved.users ?? {};
    db.sessions = saved.sessions ?? {};
  } catch {
    log('저장 파일을 읽지 못해 빈 상태로 시작해요.');
  }
}
function save() {
  if (!DATA) return;
  mkdirSync(dirname(DATA), { recursive: true });
  const tmp = `${DATA}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
  renameSync(tmp, DATA);
}
const accessTokens = new Map(); // 해시 → { userId, family, exp }
const deviceCodes = new Map(); // 해시 → { exp }

function issue(userId, family = newId()) {
  const accessToken = newToken();
  const refreshToken = newToken();
  accessTokens.set(sha(accessToken), { userId, family, exp: Date.now() + ACCESS_TTL });
  db.sessions[sha(refreshToken)] = { userId, family, exp: Date.now() + REFRESH_TTL, revoked: false };
  save();
  return { accessToken, refreshToken };
}
function revokeFamily(family) {
  for (const s of Object.values(db.sessions)) if (s.family === family) s.revoked = true;
  for (const [k, a] of accessTokens) if (a.family === family) accessTokens.delete(k);
  save();
}
const userById = (id) => Object.values(db.users).find((u) => u.id === id) ?? null;
function bearer(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(req.headers.authorization ?? '');
  if (!m) return null;
  const a = accessTokens.get(sha(m[1]));
  if (!a || a.exp < Date.now()) return null;
  const user = userById(a.userId);
  return user ? { user, family: a.family } : null;
}

function send(res, status, body) {
  const headers = { 'cache-control': 'no-store' };
  if (body === undefined) {
    res.writeHead(status, headers);
    return res.end();
  }
  res.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
const fail = (res, status, code, message, details) => send(res, status, { error: { code, message, ...(details ? { details } : {}) } });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new Error('too_large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function githubForm(path, params) {
  const res = await fetch(`${GH}${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'cadora-dev-auth-server' },
    body: new URLSearchParams(params).toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data: data && typeof data === 'object' ? data : {} };
}

async function githubUser(token) {
  const res = await fetch(`${GH_API}/user`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'cadora-dev-auth-server' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok ? res.json() : null;
}

const ROUTES = {
  // §7.1 기기 코드 발급
  async 'POST /v1/auth/github/device'(req, res) {
    let g;
    try {
      g = await githubForm('/login/device/code', { client_id: CLIENT_ID });
    } catch {
      return fail(res, 503, 'provider_unavailable', 'GitHub에 연결하지 못했어요.');
    }
    const d = g.data;
    if (g.status !== 200 || typeof d.device_code !== 'string' || typeof d.user_code !== 'string') {
      const why = typeof d.error === 'string' ? d.error : `HTTP ${g.status}`;
      const hint =
        why === 'device_flow_disabled' ? ' OAuth App 설정에서 Enable Device Flow를 켜세요.' : g.status === 404 || why === 'Not Found' ? ' Client ID를 확인하세요.' : '';
      return fail(res, 503, 'provider_unavailable', `GitHub이 기기 코드를 주지 않았어요(${why}).${hint}`);
    }
    const expiresIn = Number(d.expires_in) || 900;
    deviceCodes.set(sha(d.device_code), { exp: Date.now() + expiresIn * 1000 });
    return send(res, 200, { deviceCode: d.device_code, userCode: d.user_code, verificationUri: d.verification_uri, interval: Number(d.interval) || 5, expiresIn });
  },

  // §7.1 승인 확인: 대기 202, 완료 200, 거부 403, 만료 410, 너무 잦음 429
  async 'POST /v1/auth/github/poll'(req, res, body) {
    const deviceCode = body?.deviceCode;
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
      g = await githubForm('/login/oauth/access_token', { client_id: CLIENT_ID, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    } catch {
      return fail(res, 503, 'provider_unavailable', 'GitHub에 연결하지 못했어요.');
    }
    const d = g.data;
    if (typeof d.access_token !== 'string') {
      switch (d.error) {
        case 'authorization_pending':
          return send(res, 202, { status: 'pending' });
        case 'slow_down':
          return fail(res, 429, 'slow_down', '조금 천천히 물어봐 주세요.', { retryAfterSeconds: Number(d.interval) || 10 });
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
          return fail(res, 503, 'provider_unavailable', `GitHub 응답: ${typeof d.error === 'string' ? d.error : `HTTP ${g.status}`}`);
      }
    }
    deviceCodes.delete(key);
    let gu;
    try {
      gu = await githubUser(d.access_token); // 공개 프로필만 읽고 GitHub 토큰은 버린다
    } catch {
      gu = null;
    }
    if (!gu || (typeof gu.id !== 'number' && typeof gu.id !== 'string')) return fail(res, 503, 'provider_unavailable', 'GitHub 사용자 정보를 읽지 못했어요.');
    const ghKey = String(gu.id);
    const prev = db.users[ghKey];
    const user = {
      id: prev?.id ?? newId(),
      displayName: String(gu.name || gu.login || 'GitHub 사용자').slice(0, 100),
      avatarUrl: typeof gu.avatar_url === 'string' ? gu.avatar_url : null,
    };
    db.users[ghKey] = user;
    return send(res, 200, { ...issue(user.id), user });
  },

  // §6.3 갱신: 원자적으로 새 쌍을 주고 이전 토큰을 폐기한다. 폐기된 토큰을 다시 쓰면 그 계열을 모두 폐기한다.
  async 'POST /v1/auth/refresh'(req, res, body) {
    const rt = body?.refreshToken;
    if (typeof rt !== 'string' || !rt) return fail(res, 400, 'invalid_request', 'refreshToken이 필요해요.');
    const s = db.sessions[sha(rt)];
    if (!s) return fail(res, 401, 'unauthenticated', '유효하지 않은 토큰이에요.');
    if (s.revoked) {
      revokeFamily(s.family);
      return fail(res, 401, 'unauthenticated', '이미 쓴 토큰이에요. 다시 로그인해 주세요.');
    }
    if (s.exp < Date.now()) return fail(res, 401, 'unauthenticated', '토큰이 만료됐어요.');
    s.revoked = true;
    return send(res, 200, issue(s.userId, s.family));
  },

  // §7.1 로그아웃: 본인 세션의 refresh token(과 같은 계열)을 폐기한다.
  async 'POST /v1/auth/logout'(req, res, body) {
    const who = bearer(req);
    if (!who) return fail(res, 401, 'unauthenticated', '로그인이 필요해요.');
    const rt = body?.refreshToken;
    if (typeof rt !== 'string' || !rt) return fail(res, 400, 'invalid_request', 'refreshToken이 필요해요.');
    const s = db.sessions[sha(rt)];
    if (!s) return fail(res, 401, 'unauthenticated', '유효하지 않은 토큰이에요.');
    if (s.userId !== who.user.id) return fail(res, 403, 'forbidden', '본인 세션이 아니에요.');
    revokeFamily(s.family);
    return send(res, 204);
  },

  // §1.2 내 정보. 이 임시 서버에는 팀 워크스페이스가 없다.
  async 'GET /v1/me'(req, res) {
    const who = bearer(req);
    if (!who) return fail(res, 401, 'unauthenticated', '로그인이 필요해요.');
    const { id, displayName, avatarUrl } = who.user;
    return send(res, 200, { id, displayName, avatarUrl, workspaces: [] });
  },
};

async function handler(req, res) {
  const started = Date.now();
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  res.on('finish', () => log(`${req.method} ${path} → ${res.statusCode} (${Date.now() - started}ms)`)); // 본문·토큰은 남기지 않는다
  try {
    if (req.headers.origin) return fail(res, 403, 'forbidden', '브라우저 페이지에서는 부를 수 없어요.');
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(req.headers.host ?? '')) return fail(res, 421, 'forbidden', '이 PC에서만 받아요.');
    const route = ROUTES[`${req.method} ${path}`];
    if (!route) {
      if (path === '/v1/auth/dev-login') return fail(res, 404, 'not_found', '이 임시 서버는 시연용 로그인(dev-login)을 열지 않아요.');
      return fail(res, 404, 'not_found', '없는 경로예요.');
    }
    let body = null;
    if (req.method === 'POST') {
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return fail(res, 415, 'invalid_request', 'JSON으로 보내 주세요.');
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        return fail(res, 400, 'invalid_request', 'JSON 형식이 아니에요.');
      }
    }
    await route(req, res, body);
  } catch {
    if (!res.headersSent) fail(res, 500, 'internal_error', '임시 서버 오류예요.');
  }
}

const main = createServer(handler);
main.on('error', (err) => {
  if (err.code === 'EADDRINUSE') die(`포트 ${PORT}을(를) 이미 쓰고 있어요. 임시 서버가 이미 켜져 있으면 그 창을 그대로 쓰면 돼요.`, 3);
  die(`시작하지 못했어요: ${err.code ?? err.message}`, 1);
});
main.listen(PORT, '127.0.0.1', () => {
  const port = main.address().port;
  // localhost가 ::1로 풀리는 PC를 위해 IPv6 loopback에서도 받는다(없으면 건너뛴다).
  const v6 = createServer(handler);
  v6.on('error', () => undefined);
  v6.listen(port, '::1');
  log(`Cadora 로그인 임시 서버: http://127.0.0.1:${port}/v1 · GitHub ${FAKE_ORIGIN ? '테스트용 가짜' : 'github.com'} · Client ID ${CLIENT_ID.slice(0, 4)}… · 세션 ${DATA ? '파일에 해시로 저장' : '메모리'}`);
  log('끄려면 이 창에서 Ctrl+C를 누르세요.');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
