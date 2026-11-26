// Cadora 데모 로그인 E2E: 가짜 GitHub + 로컬 임시 서버(dev/auth-server.mjs) + 앱을 띄우고 CDP로 로그인 흐름을 확인한다.
// 진짜 GitHub에는 묻지 않는다. 실제 계정 로그인은 사람이 OAuth App Client ID로 따로 확인한다.
// 사용(Windows): 저장소 루트에서 `npm ci && npm run build` 후
//   node apps/desktop/e2e/auth-e2e.mjs node_modules\electron\dist\electron.exe apps\desktop <빈 작업 폴더>
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [electronExe, appDir, workDir] = process.argv.slice(2);
// --packaged: 설치판(win-unpacked) 실행 파일로 돌린다. 서버 주소 없이 켜면 "로그인 준비 중"이 보이는지도 확인한다.
const packaged = process.argv.includes('--packaged');
const WIN = process.platform === 'win32';
const PORT = 9334;
const CLIENT_ID = 'Ov23liE2EfakeClient';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.error(`${ok ? 'PASS' : 'FAIL'} ${name}`); return ok; };

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
const userData = join(workDir, 'userdata');
const dataFile = join(workDir, 'auth-server-data.json');

// ── 가짜 GitHub(Device Flow 엔드포인트와 /user) ──
const gh = { mode: 'approve', polls: 0, slowDowns: 0, token: null, scopeAsked: false };
const fakeGithub = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const p = new URLSearchParams(body);
    const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'POST' && req.url === '/login/device/code') {
      if (p.has('scope')) gh.scopeAsked = true;
      if (p.get('client_id') !== CLIENT_ID) return json(404, { error: 'Not Found' });
      gh.polls = 0;
      return json(200, { device_code: `dc_${Date.now()}_e2e_secret_device_code`, user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
    }
    if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
      gh.polls += 1;
      if (p.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:device_code' || p.get('client_id') !== CLIENT_ID) return json(200, { error: 'unsupported_grant_type' });
      if (gh.mode === 'deny') return json(200, { error: 'access_denied' });
      if (gh.polls === 1) return json(200, { error: 'authorization_pending' });
      if (gh.polls === 2) { gh.slowDowns += 1; return json(200, { error: 'slow_down', interval: 2 }); }
      gh.token = `gho_e2e_${Date.now()}_github_access_token`;
      return json(200, { access_token: gh.token, token_type: 'bearer', scope: '' });
    }
    if (req.method === 'GET' && req.url === '/user') {
      if (req.headers.authorization !== `Bearer ${gh.token}`) return json(401, { message: 'Bad credentials' });
      return json(200, { id: 4242, login: 'cadora-e2e', name: 'E2E 사용자', avatar_url: 'https://avatars.githubusercontent.com/u/4242?v=4' });
    }
    json(404, {});
  });
});
await new Promise((r) => fakeGithub.listen(0, '127.0.0.1', r));
const FAKE = `http://127.0.0.1:${fakeGithub.address().port}`;

// ── 로컬 임시 서버(API.md §7.1) ──
function startAuthServer() {
  const child = spawn(process.execPath, [join(appDir, 'dev', 'auth-server.mjs'), '--port', '0', '--data', dataFile], {
    env: { ...process.env, CADORA_GITHUB_CLIENT_ID: CLIENT_ID, CADORA_FAKE_GITHUB: FAKE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.logs = '';
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { child.logs += d; const m = /127\.0\.0\.1:(\d+)\/v1/.exec(child.logs); if (m) resolve(Number(m[1])); });
    child.stderr.on('data', (d) => { child.logs += d; });
    child.once('exit', (code) => reject(new Error(`auth-server exited ${code}: ${child.logs.slice(-300)}`)));
  });
  return { child, ready };
}
const auth = startAuthServer();
const authPort = await auth.ready;
const SERVER = `http://127.0.0.1:${authPort}/v1`;

// ── 앱 실행과 CDP ──
function launch({ server = true } = {}) {
  const args = packaged ? [`--remote-debugging-port=${PORT}`] : [appDir, `--remote-debugging-port=${PORT}`];
  const env = { ...process.env, CADORA_USER_DATA_DIR: userData, CADORA_SERVER_URL: SERVER };
  if (!server) delete env.CADORA_SERVER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  if (!WIN) args.push('--ozone-platform=headless');
  const child = spawn(electronExe, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.logs = '';
  child.stdout.on('data', (d) => { child.logs += d; });
  child.stderr.on('data', (d) => { child.logs += d; });
  return child;
}
async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { return []; }
}
async function connect(match, tries = 100) {
  let t;
  for (let i = 0; i < tries && !t; i++) { t = (await targets()).find(match); if (!t) await sleep(200); }
  if (!t) return null;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  return { ws, send, evaluate, logs, target: t, close: () => ws.close() };
}
const isApp = (t) => t.type === 'page' && (t.url.startsWith('file://') || t.url.startsWith('http://localhost'));
async function waitFor(fn, ms = 8000, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); }
  return null;
}
const click = (c, sel) => c.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); return !!el; })()`);
const accountName = (c) => c.evaluate(`document.querySelector('[data-real-account="in"] .nm')?.textContent || null`);
async function closeApp(app, c) {
  await c?.evaluate(`window.close(), true`).catch(() => undefined);
  c?.close();
  const code = await Promise.race([new Promise((r) => app.once('exit', (x) => r(x))), sleep(10000).then(() => 'timeout')]);
  if (code === 'timeout') app.kill();
  return code;
}

const authFile = join(userData, 'auth.json');
let app = launch();
let c;
try {
  c = await connect(isApp);
  check('앱 화면 연결', !!c, c?.target.url);
  if (!c) throw new Error('no app');
  await waitFor(() => c.evaluate(`!!(window.CadoraReal && window.CadoraReal.state.info)`), 10000);
  const info = await c.evaluate(`window.cadora.runtime.info()`);
  check('로그인 서버 주소(CADORA_SERVER_URL)', info?.authServer === SERVER, info?.authServer);
  check('로그인 전: "GitHub로 로그인" 버튼', await waitFor(() => c.evaluate(`!!document.querySelector('[data-act="real-login"]')`), 10000));
  // 배포 빌드의 CSP가 아바타 같은 필요한 자원을 막지 않는지 본다(위반은 콘솔이 아니라 이 이벤트로만 잡힌다).
  await c.evaluate(`window.__cspViolations = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI)); true`);

  await click(c, '[data-act="real-login"]');
  const code = await waitFor(() => c.evaluate(`document.querySelector('[data-real-code]')?.textContent || null`));
  check('로그인 창에 GitHub 코드 표시', code === 'WDJB-MJHT', code);
  const keys = await c.evaluate(`Object.keys(window.CadoraReal.state.auth.pending || {}).sort().join(',')`);
  check('화면이 받은 값은 코드·주소·만료 시각뿐(deviceCode 없음)', keys === 'expiresAt,userCode,verificationUri', keys);
  check('scope를 요청하지 않음(공개 프로필만)', !gh.scopeAsked);

  const name = await waitFor(() => accountName(c), 20000);
  check('GitHub 승인 후 자동 로그인(이름 표시)', name === 'E2E 사용자', name);
  check('로그인 창이 저절로 닫힘', await c.evaluate(`!document.querySelector('[data-real-code]')`));
  check('slow_down을 받아도 간격을 늘려 끝까지 진행', gh.slowDowns >= 1 && gh.polls >= 3, { polls: gh.polls, slowDowns: gh.slowDowns });
  const me = await c.evaluate(`window.cadora.team.me()`);
  check('me()는 계약 필드만(토큰 없음)', me && Object.keys(me).sort().join(',') === 'avatarUrl,displayName,id,workspaces' && !JSON.stringify(me).includes('gho_'), me);
  const avatar = await c.evaluate(`document.querySelector('.racct-av img')?.getAttribute('src') || null`);
  check('아바타는 GitHub 아바타 주소만', typeof avatar === 'string' && avatar.startsWith('https://avatars.githubusercontent.com/'), avatar);
  await sleep(1500);
  const csp = await c.evaluate(`({ meta: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || null, violations: window.__cspViolations })`);
  check('CSP가 아바타를 막지 않음(위반 0건)', Array.isArray(csp.violations) && csp.violations.length === 0, csp);
  if (packaged) check('설치판 화면에 CSP 적용', typeof csp.meta === 'string' && csp.meta.includes("script-src 'self'"), csp.meta);
  const teamKeys = await c.evaluate(`Object.keys(window.cadora.team).sort().join(',')`);
  check('window.cadora.team에 토큰을 꺼내는 함수 없음', teamKeys === 'cancelLogin,login,logout,me,openVerification', teamKeys);

  const stored = existsSync(authFile) ? JSON.parse(readFileSync(authFile, 'utf8')) : null;
  const blob = typeof stored?.refresh === 'string' ? Buffer.from(stored.refresh, 'base64').toString('latin1') : '';
  check('refresh token은 safeStorage 암호문으로만 저장', !!stored && Object.keys(stored).sort().join(',') === 'refresh,v' && blob.length > 40 && !/[A-Za-z0-9_-]{30,}/.test(blob), { keys: stored && Object.keys(stored), bytes: blob.length });
  const origin = await fetch(`${SERVER}/me`, { headers: { origin: 'https://evil.example' } });
  check('임시 서버: 브라우저 페이지(Origin) 요청 거부', origin.status === 403, origin.status);
  check('앱 화면 오류 없음(1회차)', c.logs.filter((l) => !/Electron Security Warning|Autofill/.test(l)).length === 0, c.logs.slice(0, 5));
} catch (e) {
  check('실행 중 예외(1회차)', false, String(e?.stack || e).slice(0, 600));
}
check('앱 정상 종료', (await closeApp(app, c)) !== 'timeout');

// 재시작: 저장된 refresh token으로 로그인이 유지되는가
app = launch();
c = null;
try {
  c = await connect(isApp);
  const name = await waitFor(() => accountName(c), 15000);
  check('앱을 다시 켜도 로그인 유지(refresh token 복원)', name === 'E2E 사용자', name);

  await click(c, '[data-act="real-account-logout"]');
  check('로그아웃하면 로그인 버튼으로 돌아감', await waitFor(() => c.evaluate(`!!document.querySelector('[data-act="real-login"]')`)));
  check('로그아웃하면 이 PC의 로그인 정보 삭제', await waitFor(async () => !existsSync(authFile)));
  check('로그아웃하면 서버에 폐기 요청(204)', await waitFor(async () => /POST \/v1\/auth\/logout → 204/.test(auth.child.logs)), auth.child.logs.split('\n').filter((l) => l.includes('logout')).slice(-2));

  gh.mode = 'deny';
  await click(c, '[data-act="real-login"]');
  const denied = await waitFor(() => c.evaluate(`document.querySelector('[data-real-login-error]')?.textContent || null`), 15000);
  check('GitHub에서 거부하면 알려 줌', typeof denied === 'string' && denied.includes('거부'), denied);
  await click(c, '[data-act="modal-close"]');

  gh.mode = 'approve';
  auth.child.kill();
  await sleep(500);
  await click(c, '[data-act="real-login"]');
  const down = await waitFor(() => c.evaluate(`document.querySelector('[data-real-login-error]')?.textContent || null`), 15000);
  check('서버가 꺼져 있으면 알아볼 수 있게 알려 줌', typeof down === 'string' && down.includes('연결할 수 없어요'), down);
  await click(c, '[data-act="modal-close"]');
  check('앱 화면 오류 없음(2회차)', c.logs.filter((l) => !/Electron Security Warning|Autofill/.test(l)).length === 0, c.logs.slice(0, 5));
} catch (e) {
  check('실행 중 예외(2회차)', false, String(e?.stack || e).slice(0, 600));
}
await closeApp(app, c);

if (packaged) {
  // 설치판을 서버 주소 없이 켜면 로그인 버튼 대신 "로그인 준비 중"을 보여 준다(팀원용 배포).
  app = launch({ server: false });
  c = null;
  try {
    c = await connect(isApp);
    const note = await waitFor(() => c.evaluate(`document.querySelector('[data-real-account="no-server"]')?.textContent || null`), 15000);
    const info = await c.evaluate(`window.cadora.runtime.info()`);
    check('서버 주소 없는 설치판: "로그인 준비 중" 안내, 로그인 버튼 없음', typeof note === 'string' && note.includes('팀 서버') && info.authServerState === 'not_configured' && !(await c.evaluate(`!!document.querySelector('[data-act="real-login"]')`)), { note, state: info.authServerState });
  } catch (e) {
    check('실행 중 예외(서버 없음)', false, String(e?.stack || e).slice(0, 400));
  }
  await closeApp(app, c);
}
auth.child.kill();
fakeGithub.close();

const leaks = ['gho_', 'dc_', 'e2e_secret_device_code', 'WDJB-MJHT'];
check('임시 서버 로그에 토큰·기기 코드·사용자 코드 없음', !leaks.some((s) => auth.child.logs.includes(s)), leaks.filter((s) => auth.child.logs.includes(s)));
check('앱 로그에 토큰·기기 코드·사용자 코드 없음', !leaks.some((s) => app.logs.includes(s)), leaks.filter((s) => app.logs.includes(s)));
const serverData = existsSync(dataFile) ? readFileSync(dataFile, 'utf8') : '';
check('임시 서버 저장 파일에 토큰 원문 없음(해시만)', serverData && !/gho_|dc_/.test(serverData) && /[0-9a-f]{64}/.test(serverData));
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results }, null, 1));
