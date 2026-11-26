// Cadora 데모 로그인·회원가입 E2E: 가짜 GitHub를 띄우고, 앱 안 임시 서버가 그곳에 묻게 해서 처음 실행부터 끝까지 확인한다.
// 진짜 GitHub에는 묻지 않는다. 실제 계정 로그인은 사람이 OAuth App Client ID로 따로 확인한다.
// 사용(Windows): 저장소 루트에서 `npm ci && npm run build` 후
//   node apps/desktop/e2e/auth-e2e.mjs node_modules\electron\dist\electron.exe apps\desktop <빈 작업 폴더>
//   설치판: node apps/desktop/e2e/auth-e2e.mjs release\win-unpacked\Cadora.exe apps\desktop <빈 작업 폴더> --packaged
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [electronExe, appDir, workDir] = process.argv.slice(2);
const packaged = process.argv.includes('--packaged');
const WIN = process.platform === 'win32';
const PORT = 9334;
const CLIENT_ID = 'Ov23liE2EfakeClient';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.error(`${ok ? 'PASS' : 'FAIL'} ${name}`); return ok; };
const SIM_WORDS = ['캡스톤', '팀 시연', '민수', '지윤'];

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
const userData = join(workDir, 'userdata');

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

// ── 앱 실행과 CDP ──
function launch({ clientId = true } = {}) {
  const args = packaged ? [`--remote-debugging-port=${PORT}`] : [appDir, `--remote-debugging-port=${PORT}`];
  const env = { ...process.env, CADORA_USER_DATA_DIR: userData, CADORA_FAKE_GITHUB: FAKE };
  if (clientId) env.CADORA_GITHUB_CLIENT_ID = CLIENT_ID;
  else delete env.CADORA_GITHUB_CLIENT_ID;
  delete env.CADORA_SERVER_URL;
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
async function waitFor(fn, ms = 10000, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); }
  return null;
}
const q = (s) => JSON.stringify(s);
const click = (c, sel) => c.evaluate(`(() => { const el = document.querySelector(${q(sel)}); if (el) el.click(); return !!el; })()`);
const type = (c, sel, val) => c.evaluate(`(() => { const el = document.querySelector(${q(sel)}); if (!el) return false; el.focus(); el.value = ${q(val)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const page = (c) => c.evaluate(`document.querySelector('[data-real-page]')?.getAttribute('data-real-page') || null`);
const text = (c, sel) => c.evaluate(`document.querySelector(${q(sel)})?.textContent || null`);
const simFree = (c) => c.evaluate(`(() => { const t = document.body.innerText; return ${q(SIM_WORDS)}.filter((w) => t.includes(w)); })()`);
async function closeApp(app, c) {
  await c?.evaluate(`window.close(), true`).catch(() => undefined);
  c?.close();
  const code = await Promise.race([new Promise((r) => app.once('exit', (x) => r(x))), sleep(10000).then(() => 'timeout')]);
  if (code === 'timeout') app.kill();
  return code;
}
const quietLogs = (c) => c.logs.filter((l) => !/Electron Security Warning|Autofill/.test(l));

const authFile = join(userData, 'auth.json');
const localDb = join(userData, 'local-auth.json');

// ── 1회차: Client ID 없이 처음 실행 → 연결 설정 → 회원가입 → 빈 작업공간 ──
let app = launch({ clientId: false });
let c;
let server;
try {
  c = await connect(isApp);
  check('앱 화면 연결', !!c, c?.target.url);
  if (!c) throw new Error('no app');
  await c.evaluate(`window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); true`);
  check('첫 화면은 로그인 화면', (await waitFor(() => page(c).then((p) => p === 'auth' && p))) === 'auth', await page(c));
  check('첫 화면에 시연 데이터 없음', (await simFree(c)).length === 0, await simFree(c));
  check('Client ID가 없으면 GitHub 연결 설정을 먼저 안내', await waitFor(() => c.evaluate(`!!document.querySelector('[data-real-setup]')`)));
  await type(c, '#r-client-id', 'bad id!');
  await click(c, '[data-act="real-client-id-save"]');
  check('형식이 틀린 Client ID는 저장하지 않음', await c.evaluate(`!!document.querySelector('[data-real-setup]')`) && !existsSync(join(userData, 'github-client-id.json')));
  await type(c, '#r-client-id', CLIENT_ID);
  await click(c, '[data-act="real-client-id-save"]');
  check('Client ID를 넣으면 로그인 버튼이 보임', await waitFor(() => c.evaluate(`!document.querySelector('[data-real-setup]') && !!document.querySelector('[data-act="real-auth-start"]')`)));
  const info = await c.evaluate(`window.cadora.runtime.info()`);
  server = info.authServer;
  check('로그인 서버: 앱 안 임시 서버(127.0.0.1)', info.authServerState === 'local' && /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(server ?? ''), { state: info.authServerState, server });

  await click(c, '[data-act="real-auth-tab"][data-t="signup"]');
  check('회원가입 탭: GitHub로 가입 안내', (await text(c, '[data-act="real-auth-start"]'))?.includes('가입'), await text(c, '[data-act="real-auth-start"]'));
  await click(c, '[data-act="real-auth-start"]');
  const code = await waitFor(() => text(c, '[data-real-code]'));
  check('GitHub 코드 표시', code === 'WDJB-MJHT', code);
  const keys = await c.evaluate(`Object.keys(window.CadoraReal.state.auth.pending || {}).sort().join(',')`);
  check('화면이 받은 값은 코드·주소·만료 시각뿐(deviceCode 없음)', keys === 'expiresAt,userCode,verificationUri', keys);
  check('scope를 요청하지 않음(공개 프로필만)', !gh.scopeAsked);

  check('승인되면 가입 마무리 화면', (await waitFor(() => page(c).then((p) => p === 'signup' && p), 20000)) === 'signup', await page(c));
  check('slow_down을 받아도 간격을 늘려 끝까지 진행', gh.slowDowns >= 1 && gh.polls >= 3, { polls: gh.polls, slowDowns: gh.slowDowns });
  check('가입 이름은 GitHub 이름으로 채워져 있음', (await c.evaluate(`document.querySelector('#r-su-name')?.value`)) === 'E2E 사용자');
  await type(c, '#r-su-name', '김건한 테스트');
  await click(c, '[data-act="real-signup-done"]');
  check('공유 범위 동의 없이는 가입 완료 안 됨', (await waitFor(() => text(c, '[data-real-signup-error]')))?.includes('확인'), await text(c, '[data-real-signup-error]'));
  await click(c, '[data-act="real-su-agree"]');
  await click(c, '[data-act="real-signup-done"]');
  check('가입 완료 → 빈 작업공간 환영 화면', (await waitFor(() => page(c).then((p) => p === 'welcome' && p), 10000)) === 'welcome', await page(c));
  check('환영 화면에 가입 이름', (await text(c, '[data-real-page="welcome"] h1'))?.includes('김건한 테스트'), await text(c, '[data-real-page="welcome"] h1'));
  check('가입 뒤에도 시연 데이터 없음(워크스페이스 0개)', (await simFree(c)).length === 0 && (await c.evaluate(`window.CadoraReal.state.workspaces.length`)) === 0, await simFree(c));
  const me = await c.evaluate(`window.cadora.team.me()`);
  check('me(): 계약 필드 + needsSignup=false, 토큰 없음', me && Object.keys(me).sort().join(',') === 'avatarUrl,displayName,id,needsSignup,workspaces' && me.needsSignup === false && !JSON.stringify(me).includes('gho_'), me);
  await click(c, '[data-act="real-view"][data-v="team"]');
  check('팀 화면: 아직 팀이 없다는 빈 화면', (await waitFor(() => c.evaluate(`document.querySelector('.rempty h1')?.textContent || null`)))?.includes('아직 팀이 없어요'));
  await click(c, '[data-act="real-view"][data-v="home"]');
  await sleep(1200);
  const csp = await c.evaluate(`({ meta: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || null, v: window.__csp })`);
  check('CSP 위반 0건(아바타 포함)', Array.isArray(csp.v) && csp.v.length === 0, csp);
  if (packaged) check('설치판 화면에 CSP 적용', typeof csp.meta === 'string' && csp.meta.includes("script-src 'self'"), csp.meta);

  const stored = existsSync(authFile) ? JSON.parse(readFileSync(authFile, 'utf8')) : null;
  const blob = typeof stored?.refresh === 'string' ? Buffer.from(stored.refresh, 'base64').toString('latin1') : '';
  check('refresh token은 safeStorage 암호문으로만 저장', !!stored && Object.keys(stored).sort().join(',') === 'refresh,v' && blob.length > 40 && !/[A-Za-z0-9_-]{30,}/.test(blob), { keys: stored && Object.keys(stored), bytes: blob.length });
  const dbText = existsSync(localDb) ? readFileSync(localDb, 'utf8') : '';
  check('임시 서버 저장 파일: 토큰 원문 없이 해시만', !!dbText && !/gho_|dc_/.test(dbText) && /[0-9a-f]{64}/.test(dbText));
  const origin = await fetch(`${server}/me`, { headers: { origin: 'https://evil.example' } });
  check('임시 서버: 브라우저 페이지(Origin) 요청 거부', origin.status === 403, origin.status);
  check('앱 화면 오류 없음(1회차)', quietLogs(c).length === 0, quietLogs(c).slice(0, 5));
} catch (e) {
  check('실행 중 예외(1회차)', false, String(e?.stack || e).slice(0, 600));
}
check('앱 정상 종료', (await closeApp(app, c)) !== 'timeout');

// ── 2회차: 다시 켜면 로그인 유지(저장한 Client ID 사용) → 로그아웃 → 다시 로그인(가입 단계 없음) → 거부 → 로그인 없이 → 시연 화면 ──
app = launch({ clientId: false });
c = null;
try {
  c = await connect(isApp);
  check('다시 켜면 로그인 화면 없이 바로 작업공간(로그인 유지)', (await waitFor(() => page(c).then((p) => p === 'welcome' && p), 15000)) === 'welcome', await page(c));
  await click(c, '[data-act="menu"][data-m="real-account"]');
  await click(c, '[data-act="real-account-logout"]');
  check('로그아웃하면 로그인 화면', (await waitFor(() => page(c).then((p) => p === 'auth' && p))) === 'auth', await page(c));
  check('로그아웃하면 이 PC의 로그인 정보 삭제', await waitFor(async () => !existsSync(authFile)));

  await click(c, '[data-act="real-auth-tab"][data-t="login"]');
  await click(c, '[data-act="real-auth-start"]');
  const seen = new Set();
  const landed = await waitFor(async () => { const p = await page(c); seen.add(p); return p === 'welcome' && p; }, 20000, 100);
  check('이미 가입한 계정은 가입 단계 없이 바로 작업공간', landed === 'welcome' && !seen.has('signup'), [...seen]);
  check('로그인 알림', (await c.evaluate(`[...document.querySelectorAll('#toasts *')].map((e) => e.textContent).join(' ')`))?.includes('로그인했어요'));

  await click(c, '[data-act="menu"][data-m="real-account"]');
  await click(c, '[data-act="real-account-logout"]');
  await waitFor(() => page(c).then((p) => p === 'auth'));
  gh.mode = 'deny';
  await click(c, '[data-act="real-auth-start"]');
  const denied = await waitFor(() => text(c, '[data-real-auth-error]'), 15000);
  check('GitHub에서 거부하면 로그인 화면에서 알려 줌', typeof denied === 'string' && denied.includes('거부'), denied);
  gh.mode = 'approve';

  await click(c, '[data-act="real-skip-login"]');
  check('로그인 없이 쓰기 → 빈 작업공간(로그인 안 함)', (await waitFor(() => page(c).then((p) => p === 'welcome' && p))) === 'welcome' && (await text(c, '.me-label'))?.includes('로그인 안 함'));
  await click(c, '[data-act="menu"][data-m="real-account"]');
  await click(c, '[data-act="real-sim-on"]');
  check('계정 메뉴에서만 시연 화면을 열 수 있음', await waitFor(() => c.evaluate(`!!document.querySelector('[data-real-sim]') && document.body.innerText.includes('캡스톤')`)));
  await click(c, '[data-act="real-sim-off"]');
  check('시연 화면에서 실제 화면으로 돌아옴', (await waitFor(() => page(c).then((p) => p === 'welcome' && p))) === 'welcome' && (await simFree(c)).length === 0);
  await click(c, '[data-act="real-login-from-app"]');
  check('앱 안에서 로그인을 누르면 로그인 화면', (await waitFor(() => page(c).then((p) => p === 'auth' && p))) === 'auth');
  check('앱 화면 오류 없음(2회차)', quietLogs(c).length === 0, quietLogs(c).slice(0, 5));
} catch (e) {
  check('실행 중 예외(2회차)', false, String(e?.stack || e).slice(0, 600));
}
await closeApp(app, c);
fakeGithub.close();

const leaks = ['gho_', 'dc_', 'e2e_secret_device_code', 'WDJB-MJHT'];
check('앱 로그에 토큰·기기 코드·사용자 코드 없음', !leaks.some((s) => app.logs.includes(s)), leaks.filter((s) => app.logs.includes(s)));
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results }, null, 1));
