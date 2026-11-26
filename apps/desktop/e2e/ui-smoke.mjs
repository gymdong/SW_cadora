// 사용(Windows): 저장소 루트에서 `npm ci && npm run build` 후
//   node apps/desktop/e2e/ui-smoke.mjs node_modules\electron\dist\electron.exe apps\desktop <빈 작업 폴더>
// 앱을 직접 띄우고 CDP(원격 디버깅 포트)로 조작한다. 작업 폴더 안에 데이터 폴더·워크스페이스를 만든다(실제 사용자 데이터는 건드리지 않는다).
// 화면 경로 스모크: window.cadora를 직접 부르지 않고 실제 DOM 이벤트(입력·Enter·클릭)로 조작한다.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [electronExe, appDir, workDir] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (n, ok, d) => { results.push({ n, ok: !!ok, d }); console.error(`${ok ? 'PASS' : 'FAIL'} ${n}`); };
rmSync(workDir, { recursive: true, force: true }); mkdirSync(workDir, { recursive: true });
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<title>page ${req.url}</title>ok ${req.url}`); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const WEB = `http://127.0.0.1:${server.address().port}`;
const app = spawn(electronExe, [appDir, '--remote-debugging-port=9336'], { env: { ...process.env, CADORA_USER_DATA_DIR: join(workDir, 'ud'), CADORA_WORKSPACES_ROOT: join(workDir, 'workspaces') }, stdio: 'ignore' });
let t; for (let i = 0; i < 100 && !t; i++) { try { t = (await (await fetch('http://127.0.0.1:9336/json/list')).json()).find((x) => x.type === 'page' && x.url.startsWith('file://')); } catch {} if (!t) await sleep(200); }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
const until = async (x, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await ev(x); if (v) return v; await sleep(150); } return null; };
// 실제 입력처럼: 값 넣기 + input 이벤트 / Enter 키 / 클릭
const type = (sel, val) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); el.value = ${JSON.stringify(val)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const enter = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
await send('Runtime.enable'); await sleep(1200);
try {
  check('첫 화면에 "이 PC" 새 워크스페이스 버튼', await until(`!!document.querySelector('[data-act="real-create-open"]')`), '');
  await click('[data-act="real-create-open"]');
  check('생성 모달 열림', await until(`!!document.querySelector('#r-name')`), '');
  await type('#r-name', '알고리즘 과제 2');
  await click('[data-act="real-create-type"][data-t="팀 프로젝트"]');
  check('종류 선택 반영', await until(`document.querySelector('[data-act="real-create-type"][data-t="팀 프로젝트"]')?.classList.contains('on')`), '');
  check('이름 입력이 다시 그려도 유지', await ev(`document.querySelector('#r-name')?.value`) === '알고리즘 과제 2', await ev(`document.querySelector('#r-name')?.value`));
  await click('[data-act="real-create-submit"]');
  const h1 = await until(`!document.querySelector('.modal-back') && document.querySelector('.home h1')?.textContent.includes('알고리즘 과제 2') && document.querySelector('.home h1').textContent`);
  check('만들기 → 새 워크스페이스 화면', !!h1, h1);
  check('기본 위치에 폴더 생성', existsSync(join(workDir, 'workspaces', '알고리즘 과제 2')), '');
  check('터미널 자동 생성', await until(`document.querySelectorAll('.rterm-h .tt').length === 1`), '');
  const addr = `input[id^="real-addr-"]`;
  await type(addr, `${WEB}/first`); await enter(addr);
  check('주소창 Enter → 새 탭', await until(`document.querySelectorAll('.tb[data-act="real-tab"]').length === 1`), await ev(`document.querySelectorAll('.tb[data-act="real-tab"]').length`));
  check('탭 제목이 페이지 제목으로', await until(`[...document.querySelectorAll('.tb[data-act="real-tab"]')].some(b => b.textContent.includes('page /first'))`), '');
  await type(addr, `${WEB}/second`); await enter(addr);
  check('주소창 Enter → 같은 탭 이동', await until(`[...document.querySelectorAll('.tb[data-act="real-tab"]')].some(b => b.textContent.includes('page /second')) && document.querySelectorAll('.tb[data-act="real-tab"]').length === 1`), '');
  await click('[data-act="real-tab-new"]');
  await until(`!!document.querySelector('#r-url')`); await type('#r-url', `${WEB}/third`); await click('[data-act="real-tab-open"]');
  check('새 탭 모달 → 탭 2개', await until(`document.querySelectorAll('.tb[data-act="real-tab"]').length === 2`), '');
  await click('.tb[data-act="real-tab"]:last-of-type [data-act="real-tab-close"]');
  check('탭 ✕ → 1개', await until(`document.querySelectorAll('.tb[data-act="real-tab"]').length === 1`), '');
  await type('#real-env-name', 'MY_HIDDEN_KEY'); await type('#real-env-value', 'sk-ui-secret-999'); await click('[data-act="real-env-add"]');
  const envRow = await until(`[...document.querySelectorAll('.renv code')].map(c => c.textContent).find(t => t.startsWith('MY_HIDDEN_KEY'))`);
  check('환경변수 추가 → 가린 값만 표시', envRow === 'MY_HIDDEN_KEY=••••••••', envRow);
  check('입력칸 비움·화면에 값 없음', (await ev(`document.querySelector('#real-env-value').value === '' && !document.body.innerHTML.includes('sk-ui-secret')`)), '');
  await click('[data-act="real-term-new"]');
  check('+ PowerShell → 터미널 2개', await until(`document.querySelectorAll('.rterm-h .tt').length === 2`), '');
  await ev(`[...document.querySelectorAll('.rterm-h .tt')].pop().querySelector('[data-act="real-term-close"]').click(), true`);
  check('터미널 ✕ → 1개', await until(`document.querySelectorAll('.rterm-h .tt').length === 1`), '');
  check('xterm이 터미널 자리에 보임', await until(`(() => { const o = document.querySelector('.real-term-overlay'); const s = document.querySelector('[data-real-slot="term"]'); if (!o || !s || o.style.display === 'none') return false; const a = o.getBoundingClientRect(), b = s.getBoundingClientRect(); return Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && !!o.querySelector('.xterm'); })()`), '');
  await sleep(800);
  const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(workDir, '..', 'ui-smoke.png'), Buffer.from(shot.result.data, 'base64'));
  await click('[data-act="real-sleep"]');
  check('잠자기 버튼', await until(`!!document.querySelector('.home .sleep')`), '');
  await click('[data-act="real-wake"]');
  check('깨우기 버튼', await until(`!document.querySelector('.home .sleep') && document.querySelectorAll('.tb[data-act="real-tab"]').length === 1`), '');
  await click('[data-act="real-remove-open"]'); await until(`!!document.querySelector('[data-act="real-remove"]')`); await click('[data-act="real-remove"]');
  check('삭제 → 목록에서 빠지고 폴더는 남음', await until(`document.querySelectorAll('[data-act="real-ws"]').length === 0`) && existsSync(join(workDir, 'workspaces', '알고리즘 과제 2')), '');
  check('화면 예외 없음', errs.length === 0, errs.slice(0, 3));
} catch (e) { check('예외', false, String(e).slice(0, 300)); }
await ev('window.close(), true').catch(() => {}); await sleep(2500); try { app.kill(); } catch {}
server.close();
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, fails: results.filter((r) => !r.ok) }));
