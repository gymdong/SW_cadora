// 사용(Windows): 저장소 루트에서 `npm ci && npm run build` 후
//   node apps/desktop/e2e/e2e.mjs node_modules\electron\dist\electron.exe apps\desktop <빈 작업 폴더> [--agent]
// 앱을 직접 띄우고 CDP(원격 디버깅 포트)로 조작한다. 작업 폴더 안에 데이터 폴더·워크스페이스를 만든다(실제 사용자 데이터는 건드리지 않는다).
// --agent: 로그인된 Claude Code로 실제 실행(짧은 프롬프트 1회). 대화상자는 신뢰 확인만 Yes, 나머지는 바꾸지 않는 선택지만 고른다.
// Cadora 데모 E2E: 앱을 직접 띄우고 CDP로 붙어 실제 기능을 확인한다. 결과는 JSON(통과/실패 + 근거)으로 출력한다.
// 사용: node e2e.mjs <electron 실행 파일> <apps/desktop 폴더> <작업 폴더> [--agent]
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [electronExe, appDir, workDir] = process.argv.slice(2);
const withAgent = process.argv.includes('--agent');
const WIN = process.platform === 'win32';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const skip = (name, why) => { results.push({ name, ok: null, detail: why }); console.error(`SKIP ${name} — ${why}`); };
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.error(`${ok ? "PASS" : "FAIL"} ${name}`); return ok; };
// eslint-disable-next-line no-control-regex -- 터미널 출력의 ANSI 이스케이프를 지운다
const noAnsi = (s) => String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
const hideHome = (s) => String(s).replace(/[A-Za-z]:\\Users\\[^\\"\s]+/g, '<home>').replace(/\/home\/[^/"\s]+/g, '<home>');

rmSync(workDir, { recursive: true, force: true });
const dirA = join(workDir, '과제 A 폴더');
const dirB = join(workDir, 'B-project');
mkdirSync(dirA, { recursive: true });
mkdirSync(dirB, { recursive: true });
const userData = join(workDir, 'userdata');

// ── 로컬 테스트 웹 서버(쿠키 로그인 · whoami · 다운로드) ──
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const cookie = req.headers.cookie || '';
  if (u.pathname === '/login') {
    // 실제 서비스처럼 로그인 후 다른 주소로 넘긴다(새로고침해도 다시 로그인되지 않게).
    res.writeHead(302, { 'set-cookie': `user=${u.searchParams.get('u')}; Path=/`, location: `/home?ws=${u.searchParams.get('ws')}` });
    return res.end();
  }
  if (u.pathname === '/home') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<title>home</title>home`);
  }
  if (u.pathname === '/whoami') {
    const m = cookie.match(/user=([^;]+)/);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<title>whoami</title>whoami:${m ? m[1] : 'none'}`);
  }
  if (u.pathname === '/download') {
    res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="report.txt"' });
    return res.end(`report-from-${u.searchParams.get('ws')}`);
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const WEB = `http://127.0.0.1:${server.address().port}`;

// ── 앱 실행과 CDP ──
function launch() {
  const args = [appDir, `--remote-debugging-port=${PORT}`];
  const env = { ...process.env, CADORA_USER_DATA_DIR: userData, CADORA_TEST_LEAK: 'leak-me-if-you-can' };
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
async function pageText(urlPart) {
  const c = await connect((t) => t.type === 'page' && t.url.includes(urlPart), 50);
  if (!c) return null;
  const v = await c.evaluate(`({ text: document.body ? document.body.innerText : '', bridge: typeof window.cadora, req: typeof window.require, proc: typeof window.process })`);
  c.close();
  return v;
}
async function waitFor(fn, ms = 8000, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); }
  return null;
}

let app = launch();
let A, B, c;
try {
  c = await connect(isApp);
  check('앱 화면 연결', !!c, c ? hideHome(c.target.url) : hideHome(app.logs.slice(-800)));
  if (!c) throw new Error('no app');
  await waitFor(() => c.evaluate(`!!(window.CadoraReal && window.CadoraReal.state.info)`), 10000);
  const info = await c.evaluate(`window.cadora.runtime.info()`);
  check('런타임 정보', info && info.agentRuntime === 'pty' && info.watcher === '@parcel/watcher', info);
  // 첫 화면은 로그인 화면이다. 이 점검은 "로그인 없이 이 PC 기능만 쓰기"로 들어간다(로그인은 auth-e2e.mjs).
  await waitFor(() => c.evaluate(`!!document.querySelector('[data-act="real-skip-login"]')`), 10000);
  await c.evaluate(`document.querySelector('[data-act="real-skip-login"]').click(), true`);
  await waitFor(() => c.evaluate(`!!document.querySelector('[data-act="real-create-open"]')`));
  check('실제 기능 연결층', await c.evaluate(`window.CadoraReal.available === true && !!document.querySelector('[data-act="real-create-open"]')`), 'CadoraReal + 사이드바 버튼');

  // 워크스페이스 두 개
  A = await c.evaluate(`window.cadora.workspace.create({ name: '과제 A', type: '과제', localPath: ${JSON.stringify(dirA)} }).then(w => w.id)`);
  B = await c.evaluate(`window.cadora.workspace.create({ name: '팀플 B', type: '팀 프로젝트', localPath: ${JSON.stringify(dirB)} }).then(w => w.id)`);
  check('워크스페이스 생성', /^ws_/.test(A) && /^ws_/.test(B), { A, B });
  const parts = await c.evaluate(`window.cadora.workspace.list().then(l => l.map(w => w.partition))`);
  check('워크스페이스별 세션 파티션', parts.length === 2 && parts[0] !== parts[1] && parts.every((p) => p.startsWith('persist:ws_')), parts);

  // UI로 A 선택 → 터미널 자동 생성
  await waitFor(() => c.evaluate(`!!document.querySelector('[data-act="real-ws"][data-id="${A}"]')`));
  await c.evaluate(`document.querySelector('[data-act="real-ws"][data-id="${A}"]').click(), true`);
  const termA = await waitFor(() => c.evaluate(`(window.CadoraReal.state.terminals['${A}'] || [])[0]?.termId || null`));
  check('A 선택 시 터미널 생성', !!termA, termA);

  // 브라우저: 세션 격리
  await c.evaluate(`window.CadoraReal.openTab('${A}', '${WEB}/login?u=alice&ws=A')`);
  await c.evaluate(`window.CadoraReal.openTab('${B}', '${WEB}/login?u=bob&ws=B')`);
  await sleep(1500);
  await c.evaluate(`window.CadoraReal.openTab('${A}', '${WEB}/whoami?ws=A&n=1')`);
  await c.evaluate(`window.CadoraReal.openTab('${B}', '${WEB}/whoami?ws=B&n=1')`);
  const wa = await waitFor(() => pageText('whoami?ws=A&n=1').then((v) => v && v.text.includes('whoami:') && v));
  const wb = await waitFor(() => pageText('whoami?ws=B&n=1').then((v) => v && v.text.includes('whoami:') && v));
  check('세션 격리: A는 alice, B는 bob', wa?.text.includes('whoami:alice') && wb?.text.includes('whoami:bob'), { A: wa?.text, B: wb?.text });
  check('웹 페이지에는 window.cadora·Node가 없다', wa && wa.bridge === 'undefined' && wa.req === 'undefined' && wa.proc === 'undefined', wa && { cadora: wa.bridge, require: wa.req, process: wa.proc });

  // A만 로그아웃
  await c.evaluate(`window.cadora.browser.clearSession('${A}')`);
  await c.evaluate(`window.CadoraReal.openTab('${A}', '${WEB}/whoami?ws=A&n=2')`);
  await c.evaluate(`window.CadoraReal.openTab('${B}', '${WEB}/whoami?ws=B&n=2')`);
  const wa2 = await waitFor(() => pageText('whoami?ws=A&n=2').then((v) => v && v.text.includes('whoami:') && v));
  const wb2 = await waitFor(() => pageText('whoami?ws=B&n=2').then((v) => v && v.text.includes('whoami:') && v));
  check('A 로그아웃이 B에 영향 없음', wa2?.text.includes('whoami:none') && wb2?.text.includes('whoami:bob'), { A: wa2?.text, B: wb2?.text });

  // 다운로드: 같은 이름을 A·B에서 받기
  await c.evaluate(`window.CadoraReal.openTab('${A}', '${WEB}/download?ws=A')`);
  await c.evaluate(`window.CadoraReal.openTab('${B}', '${WEB}/download?ws=B')`);
  const fa = join(dirA, '자료', 'report.txt'), fb = join(dirB, '자료', 'report.txt');
  await waitFor(() => existsSync(fa) && existsSync(fb), 8000);
  const dlEvents = await c.evaluate(`({ A: (window.CadoraReal.state.downloads['${A}'] || []).map(d => d.wsId + ':' + d.fileName), B: (window.CadoraReal.state.downloads['${B}'] || []).map(d => d.wsId + ':' + d.fileName) })`);
  check('다운로드가 각 워크스페이스 자료 폴더로', existsSync(fa) && existsSync(fb) && readFileSync(fa, 'utf8') === 'report-from-A' && readFileSync(fb, 'utf8') === 'report-from-B', { A: existsSync(fa), B: existsSync(fb) });
  check('완료 이벤트의 workspaceId', dlEvents.A.includes(`${A}:report.txt`) && dlEvents.B.includes(`${B}:report.txt`), dlEvents);

  // 터미널 입출력(한글·공백 경로)
  const cmd = WIN ? `Write-Output ("CADO" + "RA_" + (40+2) + "_" + (Get-Location).Path)\r` : `echo "CADO""RA_$((40+2))_$(pwd)"\r`;
  await c.evaluate(`window.cadora.terminal.write('${termA}', ${JSON.stringify(cmd)}), true`);
  const out = await waitFor(() => c.evaluate(`window.cadora.terminal.backlog('${termA}')`).then((b) => (noAnsi(b).includes('CADORA_42') ? noAnsi(b) : null)));
  check('터미널 입출력과 작업 폴더(한글·공백)', !!out && out.includes('과제 A 폴더'), out ? hideHome(out.split(/\r?\n/).filter((l) => l.includes('CADORA_42')).pop()) : 'no output');

  // 환경변수: 암호화 저장, 화면에는 가림, 그 워크스페이스 터미널에만 주입, 앱 환경은 새지 않음
  if (!info.secretStore) {
    skip('환경변수 암호화·주입', '이 환경은 안전한 safeStorage가 없어 앱이 저장을 거부함(의도된 동작)');
    const refused = await c.evaluate(`window.cadora.workspace.setEnv('${A}', 'DEMO_API_KEY', 'x').then(() => 'stored', e => e.message)`);
    check('암호화를 못 쓰면 저장을 거부', refused !== 'stored', refused);
  } else {
  const listed = await c.evaluate(`window.cadora.workspace.setEnv('${A}', 'DEMO_API_KEY', 'sk-demo-SECRETVALUE-123').then(w => JSON.stringify(w))`);
  check('환경변수 값은 화면으로 오지 않는다', listed && !listed.includes('SECRETVALUE') && listed.includes('DEMO_API_KEY'), JSON.parse(listed).env);
  const stored = readFileSync(join(userData, 'workspaces.json'), 'utf8');
  check('저장 파일에도 평문이 없다(safeStorage)', !stored.includes('SECRETVALUE'), stored.includes('"enc"') ? 'enc 필드로 저장' : 'enc 없음');
  const t2 = await c.evaluate(`window.cadora.terminal.open('${A}').then(t => t.termId)`);
  const tB = await c.evaluate(`window.cadora.terminal.open('${B}').then(t => t.termId)`);
  const envCmd = WIN ? `Write-Output ("K=[" + $env:DEMO_API_KEY + "] L=[" + $env:CADORA_TEST_LEAK + "]")\r` : `echo "K=[$DEMO_API_KEY] L=[$CADORA_TEST_LEAK]"\r`;
  await sleep(1500);
  await c.evaluate(`window.cadora.terminal.write('${t2}', ${JSON.stringify(envCmd)}); window.cadora.terminal.write('${tB}', ${JSON.stringify(envCmd)}); true`);
  const outA = await waitFor(() => c.evaluate(`window.cadora.terminal.backlog('${t2}')`).then((b) => (/K=\[sk|K=\[\]/.test(noAnsi(b)) ? noAnsi(b) : null)));
  const outB = await waitFor(() => c.evaluate(`window.cadora.terminal.backlog('${tB}')`).then((b) => (/K=\[sk|K=\[\]/.test(noAnsi(b)) ? noAnsi(b) : null)));
  const lineA = outA && outA.split(/\r?\n/).filter((l) => /^K=\[/.test(l.trim())).pop();
  const lineB = outB && outB.split(/\r?\n/).filter((l) => /^K=\[/.test(l.trim())).pop();
  check('환경변수는 A 터미널에만', lineA?.includes('K=[sk-demo-SECRETVALUE-123]') && lineB?.includes('K=[]'), { A: lineA?.trim().replace('SECRETVALUE', '••••'), B: lineB?.trim() });
  check('앱 프로세스 환경변수는 터미널로 새지 않는다', lineA?.includes('L=[]') && lineB?.includes('L=[]'), { A: lineA?.trim().replace(/K=\[[^\]]*\]/, 'K=[…]'), B: lineB?.trim() });
  }

  // 파일 감시
  mkdirSync(join(dirA, 'prisma'), { recursive: true });
  mkdirSync(join(dirA, 'src', 'auth'), { recursive: true });
  mkdirSync(join(dirA, 'node_modules', 'x'), { recursive: true });
  const t0 = Date.now();
  writeFileSync(join(dirA, 'prisma', 'schema.prisma'), 'model User { id Int @id }');
  writeFileSync(join(dirA, 'src', 'auth', 'login.ts'), 'export {}');
  writeFileSync(join(dirA, '.env'), 'OPENAI_API_KEY=sk-should-not-appear');
  writeFileSync(join(dirA, 'node_modules', 'x', 'a.js'), '1');
  const files = await waitFor(() => c.evaluate(`(window.CadoraReal.state.files['${A}'] || []).map(f => f.relativePath + '|' + f.category + '|' + f.source)`).then((l) => (l.some((x) => x.startsWith('prisma/schema.prisma')) && l.some((x) => x.startsWith('src/auth/login.ts')) ? l : null)), 6000);
  const detectMs = Date.now() - t0;
  check('파일 감시: 분류와 지연', files && files.includes('prisma/schema.prisma|db-schema|watcher') && files.includes('src/auth/login.ts|api|watcher'), { files, msToBoth: detectMs });
  await sleep(1200);
  const allFiles = await c.evaluate(`JSON.stringify(window.CadoraReal.state.files['${A}'] || [])`);
  check('.env·node_modules는 이벤트 없음, 내용·절대경로 없음', !allFiles.includes('.env') && !allFiles.includes('node_modules') && !allFiles.includes('sk-should') && !/[A-Za-z]:\\\\|\/home\//.test(allFiles), 'files 이벤트 검사');

  // 에이전트(선택): 로그인된 Claude Code를 앱 터미널에서 실제로 돌려 hook 상태·파일 변경을 본다.
  if (withAgent && info.claudeAvailable) {
    execFileSync('git', ['init', '-q'], { cwd: dirA });
    await c.evaluate(`window.CadoraReal.startAgent('${A}', '데모 작업')`);
    const run = await waitFor(() => c.evaluate(`(window.CadoraReal.state.agents['${A}'] || []).slice(-1)[0] || null`), 5000);
    const settings = join(dirA, '.claude', 'settings.local.json');
    await waitFor(() => existsSync(settings), 5000);
    const exclude = existsSync(join(dirA, '.git', 'info', 'exclude')) ? readFileSync(join(dirA, '.git', 'info', 'exclude'), 'utf8') : '';
    check('에이전트: hook 설정과 git 제외', existsSync(settings) && readFileSync(settings, 'utf8').includes('hook-relay.cjs') && exclude.includes('.claude/settings.local.json'), { observe: run?.observe });
    const seen = [];
    const statusPoll = setInterval(async () => { try { const s = await c.evaluate(`(window.CadoraReal.state.agents['${A}'] || []).slice(-1)[0]?.status`); if (s && seen[seen.length - 1] !== s) seen.push(s); } catch { /* 무시 */ } }, 250);
    const screen = async () => String(await c.evaluate(`window.CadoraReal.screenText('${run.termId}', 40)`));
    const key = (d) => c.evaluate(`window.cadora.terminal.write('${run.termId}', ${JSON.stringify(d)}), true`);
    // 대화상자: 신뢰 확인은 "Yes"(Claude Code 2.1.3xx는 기본 선택이 No), 기능 안내는 "Not now"만. 모르는 대화상자면 멈춘다.
    let ready = false, stopReason = null, handled = 0, hookWarning = false; const dialogs = [];
    for (let i = 0; i < 80 && !ready && !stopReason; i++) {
      await sleep(500);
      const sc = await screen();
      if (/didn't start because this folder isn't trusted/.test(sc)) { stopReason = '신뢰 거절됨'; break; }
      // 선택 대화상자: 커서(❯) 줄과 같은 들여쓰기로 이어진 줄들이 선택지다(번호는 있을 수도 없을 수도 있다).
      const raw = sc.split('\n');
      const ci = raw.findIndex((l) => /^\s*❯ \S/.test(l));
      let opts = [], cur = -1;
      if (ci >= 0) {
        const col = raw[ci].indexOf('❯') + 2;
        const isOpt = (l) => l.length > col && l.slice(0, col).trim() === '' && l[col] !== ' ';
        let s0 = ci, e0 = ci;
        while (s0 > 0 && isOpt(raw[s0 - 1])) s0--;
        while (e0 < raw.length - 1 && isOpt(raw[e0 + 1])) e0++;
        opts = raw.slice(s0, e0 + 1).map((l, i) => (s0 + i === ci ? l.slice(col) : l.slice(col)).replace(/^\d\.\s*/, '').trim());
        cur = ci - s0;
      }
      if (opts.length >= 2 && handled < 5) {
        // 신뢰 확인만 "Yes", 나머지는 아무것도 바꾸지 않는 선택지(Not now · No, keep …)만 고른다.
        let want = /trust this folder/.test(sc) ? opts.findIndex((o) => /^Yes, I trust/.test(o)) : opts.findIndex((o) => /^(Not now|No, keep)/i.test(o));
        if (want < 0) { stopReason = '모르는 대화상자: ' + opts.join(' | ').slice(0, 200); break; }
        if (/hooks that can run commands/.test(sc)) hookWarning = true;
        dialogs.push(`${opts[want]}`);
        for (let k = cur; k < want; k++) { await key('\x1b[B'); await sleep(250); }
        for (let k = cur; k > want; k--) { await key('\x1b[A'); await sleep(250); }
        await key('\r'); handled++; await sleep(1500); continue;
      }
      if (/\? for shortcuts|plan mode on|accept edits on/.test(sc)) ready = true;
    }
    check('에이전트: 신뢰 확인 뒤 Claude Code 준비', ready, stopReason || { dialogsHandled: handled, chose: dialogs, hookWarningShown: hookWarning, screenTail: ready ? undefined : (await screen()).split('\n').filter((l) => l.trim()).slice(-4) });
    if (ready) {
      for (let k = 0; k < 4 && !/accept edits on/.test(await screen()); k++) { await key('\x1b[Z'); await sleep(800); }
      const sc2 = await screen();
      const acceptEdits = /accept edits on/.test(sc2);
      check('에이전트: 편집 허용 모드로 전환(Shift+Tab)', acceptEdits, acceptEdits ? 'accept edits on' : sc2.split('\n').filter((l) => l.trim()).slice(-3));
      if (acceptEdits) {
        await key('Create a file named hello.txt containing the single word hi. Do nothing else and do not run shell commands.');
        await sleep(500); await key('\r');
        const hookFile = await waitFor(() => c.evaluate(`(window.CadoraReal.state.files['${A}'] || []).find(f => f.relativePath === 'hello.txt' && f.source === 'hook:PostToolUse') || null`), 90000, 500);
        const done = await waitFor(() => c.evaluate(`(window.CadoraReal.state.agents['${A}'] || []).slice(-1)[0]?.status`).then((s) => (s === 'done' ? s : null)), 60000, 500);
        check('에이전트: PostToolUse hook → 파일 변경(hook 출처)', !!hookFile && existsSync(join(dirA, 'hello.txt')), hookFile && { relativePath: hookFile.relativePath, category: hookFile.category, source: hookFile.source, runId: !!hookFile.runId });
        check('에이전트: Stop hook → 완료', done === 'done', { statuses: seen });
        await sleep(1500);
        const dup = await c.evaluate(`(window.CadoraReal.state.files['${A}'] || []).filter(f => f.relativePath === 'hello.txt').map(f => f.source)`);
        check('에이전트: 같은 파일은 hook 쪽만(감시 이벤트 중복 없음)', dup.length === 1 && dup[0] === 'hook:PostToolUse', dup);
      }
    }
    clearInterval(statusPoll);
    await c.evaluate(`window.CadoraReal.stopAgent('${run.runId}')`);
    const ex = await waitFor(() => c.evaluate(`(window.CadoraReal.state.agents['${A}'] || []).slice(-1)[0]?.status`).then((s) => (s === 'exited' ? s : null)), 8000);
    check('에이전트: 중지하면 종료됨', ex === 'exited', { statuses: seen });
  }

  // 화면 확인용 스크린샷(A 선택 상태)
  const sel = await c.evaluate(`(() => { const b = document.querySelector('[data-act="real-ws"][data-id="${A}"]'); if (b) { b.click(); return 'clicked'; } return { realBtns: document.querySelectorAll('[data-act="real-ws"]').length, head: document.querySelector('.s-head')?.textContent, h1: document.querySelector('h1')?.textContent?.slice(0, 40), modal: !!document.querySelector('.modal-back'), ws: window.CadoraReal.state.workspaces.length }; })()`);
  check('스크린샷 전 A 선택', sel === 'clicked', sel);
  await sleep(1500);
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) writeFileSync(join(workDir, 'app.png'), Buffer.from(shot.result.data, 'base64'));

  // 잠자기: A의 웹 뷰가 닫히고, 깨우면 다시 열린다
  await c.evaluate(`window.cadora.workspace.setState('${A}', 'sleep')`);
  await sleep(1200);
  const asleep = (await targets()).filter((t) => t.url.includes('ws=A')).length;
  await c.evaluate(`window.CadoraReal.wake('${A}').then(() => window.CadoraReal.select('${A}'))`);
  await sleep(2000);
  const awake = (await targets()).filter((t) => t.url.includes('ws=A')).length;
  check('잠자기: 웹 뷰를 닫고, 깨우면 활성 탭을 다시 연다', asleep === 0 && awake >= 1, { asleep, awake });

  check('앱 화면 오류 없음', c.logs.filter((l) => !/Electron Security Warning|Autofill/.test(l)).length === 0, c.logs.slice(0, 5));
  await c.evaluate(`window.close(), true`).catch(() => undefined);
  c.close();
} catch (e) {
  check('실행 중 예외', false, String(e && e.stack || e).slice(0, 600));
  try { await c?.evaluate(`window.close(), true`); } catch { /* 이미 닫힘 */ }
}
const exited = await Promise.race([new Promise((r) => app.once('exit', (code) => r(code))), sleep(10000).then(() => 'timeout')]);
check('앱 정상 종료', exited !== 'timeout', { exit: exited });
if (exited === 'timeout') app.kill();

// 재시작: 워크스페이스와 탭이 남는가
app = launch();
try {
  const c2 = await connect(isApp);
  await waitFor(() => c2.evaluate(`!!(window.CadoraReal && window.CadoraReal.state.workspaces.length)`), 10000);
  const ws = await c2.evaluate(`window.cadora.workspace.list().then(l => l.map(w => w.name + '|' + w.state))`);
  const tabs = A ? await c2.evaluate(`window.cadora.browser.listTabs('${A}').then(t => t.tabs.map(x => x.url))`) : [];
  check('재시작 후 워크스페이스 2개 유지', ws.length === 2, ws);
  check('재시작 후 탭 주소 유지', tabs.some((u) => u.includes('whoami?ws=A')), { tabs: tabs.length });
  await c2.evaluate(`window.close(), true`).catch(() => undefined);
  c2.close();
} catch (e) {
  check('재시작 확인 중 예외', false, String(e).slice(0, 300));
}
const exited2 = await Promise.race([new Promise((r) => app.once('exit', (code) => r(code))), sleep(10000).then(() => 'timeout')]);
if (exited2 === 'timeout') app.kill();
server.close();
const logTail = hideHome(app.logs.split(/\r?\n/).filter((l) => /error|Error|exception/.test(l) && !/GPU|gpu|dbus|DevTools|Autofill|viz|SharedImage|ANGLE/.test(l)).slice(-8).join('\n'));
console.log(JSON.stringify({ passed: results.filter((r) => r.ok === true).length, failed: results.filter((r) => r.ok === false).length, skipped: results.filter((r) => r.ok === null).length, results, mainLogErrors: logTail }, null, 1));
