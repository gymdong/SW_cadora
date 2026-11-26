// 설치판 보안 점검(Windows, electron-builder 결과물).
// - Electron fuses 상태, NODE_OPTIONS·--inspect로 코드를 끼워 넣을 수 없는지
// - PC에 Node가 없을 때 쓰는 hook relay(Cadora 실행 파일의 내장 Node)가 동작하는지
// - app.asar에 소스·테스트·개발용 파일·소스맵·개인 경로·토큰이 들어가지 않았는지, 네이티브 모듈이 asar 밖에 있는지
// - 설치 파일 크기와 SHA-256
// 개인 정보는 코드에 적지 않는다: 이 PC의 사용자 이름·홈 폴더·git 이메일을 실행할 때 읽어 와서 검사한다.
// 사용: npm run dist 후 node apps/desktop/e2e/package-check.mjs <release 폴더> <빈 작업 폴더>
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
// @electron/fuses 1.8은 FuseState를 최상위에서 내보내지 않는다: '1'(49)=켜짐, '0'(48)=꺼짐.
const FuseState = { ENABLE: 49, DISABLE: 48 };
const asar = require('@electron/asar');

const [releaseDir, workDir] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.error(`${ok ? 'PASS' : 'FAIL'} ${name}`); return ok; };
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

const unpacked = join(releaseDir, 'win-unpacked');
const exe = join(unpacked, 'Cadora.exe');
const resources = join(unpacked, 'resources');
const archive = join(resources, 'app.asar');
check('설치판 폴더와 실행 파일', existsSync(exe) && existsSync(archive), { exe: existsSync(exe), asar: existsSync(archive) });

// ── fuses ──
const wire = await getCurrentFuseWire(exe);
const fuses = {};
for (const [name, idx] of Object.entries(FuseV1Options)) {
  if (typeof idx !== 'number') continue;
  const v = wire[idx];
  fuses[name] = v === FuseState.ENABLE ? 'on' : v === FuseState.DISABLE ? 'off' : String(v);
}
const want = {
  RunAsNode: 'on',
  EnableCookieEncryption: 'on',
  EnableNodeOptionsEnvironmentVariable: 'off',
  EnableNodeCliInspectArguments: 'off',
  EnableEmbeddedAsarIntegrityValidation: 'on',
  OnlyLoadAppFromAsar: 'on',
};
check('Electron fuses가 설정대로', Object.entries(want).every(([k, v]) => fuses[k] === v), fuses);

// ── NODE_OPTIONS·--inspect로 코드를 끼워 넣을 수 없는지 ──
const marker = join(workDir, 'injected.txt');
const inject = join(workDir, 'inject.cjs');
writeFileSync(inject, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'injected');`);
const probe = spawn(exe, ['--inspect=127.0.0.1:9339'], {
  env: { ...process.env, NODE_OPTIONS: `--require "${inject}"`, CADORA_USER_DATA_DIR: join(workDir, 'ud-probe'), ELECTRON_RUN_AS_NODE: '' },
  stdio: 'ignore',
});
await sleep(7000);
let inspectOpen;
try {
  inspectOpen = (await fetch('http://127.0.0.1:9339/json/version', { signal: AbortSignal.timeout(1500) })).ok;
} catch {
  inspectOpen = false;
}
probe.kill();
await sleep(1500);
check('NODE_OPTIONS(--require)로 코드 주입 안 됨', !existsSync(marker));
check('--inspect로 main 프로세스 디버거 열리지 않음', !inspectOpen);

// ── Node가 없는 PC용 hook relay: Cadora 실행 파일의 내장 Node로 돈다 ──
const relayPath = join(resources, 'hook-relay.cjs');
check('hook relay가 설치판 resources에 있음', existsSync(relayPath), relayPath.replace(homedir(), '~'));
const got = await new Promise((resolve) => {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.writeHead(204).end();
      srv.close();
      resolve({ path: req.url, token: req.headers['x-cadora-token'], run: req.headers['x-cadora-run'], body });
    });
  });
  srv.listen(0, '127.0.0.1', () => {
    const child = spawn(exe, [relayPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CADORA_HOOK_URL: `http://127.0.0.1:${srv.address().port}/hooks`, CADORA_HOOK_TOKEN: 'pkgcheck-token', CADORA_RUN_ID: 'run_pkgcheck00000' },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.stdin.end(JSON.stringify({ hook_event_name: 'Stop', session_id: 'pkgcheck' }));
    setTimeout(() => { srv.close(); resolve(null); }, 10000);
  });
});
check('Node 없는 PC용 relay(내장 Node)가 hook을 전달', got && got.path === '/hooks' && got.token === 'pkgcheck-token' && got.body.includes('Stop'), got && { path: got.path, run: got.run });

// ── app.asar 내용 ──
const files = asar.listPackage(archive, { isPack: false }).map((f) => f.replace(/\\/g, '/').replace(/^\//, ''));
const own = files.filter((f) => !f.startsWith('node_modules/'));
const badOwn = own.filter((f) => /^(src|e2e|dev|resources)\//.test(f) || /\.(test|spec)\.|\.map$|(^|\/)\.env|tsconfig|\.ts$/.test(f));
check('asar에는 빌드 결과(out/)와 package.json만(소스·테스트·개발용 파일·소스맵 없음)', badOwn.length === 0 && own.every((f) => f.startsWith('out/') || f === 'package.json' || !f.includes('.')), { own: own.length, bad: badOwn.slice(0, 10) });
// 범위 폴더 자체(node_modules/@parcel)는 모듈이 아니라서 뺀다.
const modules = [...new Set(files.filter((f) => f.startsWith('node_modules/') && !/^node_modules\/@[^/]+$/.test(f)).map((f) => f.split('/').slice(0, f.startsWith('node_modules/@') ? 3 : 2).join('/')))];
check('함께 들어간 모듈은 네이티브 의존성뿐', modules.every((m) => /^node_modules\/(node-pty|node-addon-api|@parcel\/watcher(-win32-x64)?|detect-libc|is-glob|is-extglob|micromatch|braces|fill-range|to-regex-range|is-number|picomatch|node-gyp-build)$/.test(m)), modules);

const unpackedDir = join(resources, 'app.asar.unpacked');
const walk = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])) : []);
const natives = walk(unpackedDir).map((f) => f.slice(unpackedDir.length + 1).replace(/\\/g, '/')).filter((f) => /\.(node|dll|exe)$/.test(f));
check('네이티브 파일은 asar 밖(app.asar.unpacked)에', natives.some((f) => f.startsWith('node_modules/node-pty/')) && natives.some((f) => f.includes('@parcel/watcher')), natives);

// 텍스트 파일에서 개인 정보·토큰 찾기(이 PC 값을 실행할 때 읽는다)
let gitEmail;
try { gitEmail = execFileSync('git', ['config', 'user.email'], { encoding: 'utf8' }).trim(); } catch { gitEmail = ''; }
const personal = [userInfo().username, homedir(), homedir().replace(/\\/g, '/'), gitEmail].filter((s) => s && s.length >= 4);
const secretPatterns = [/gh[opsur]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/, /sk-ant-[A-Za-z0-9_-]{20,}/, /\bsk-[A-Za-z0-9]{32,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AIza[0-9A-Za-z_-]{35}/, /xox[abprs]-[A-Za-z0-9-]{10,}/];
const hits = [];
for (const f of files) {
  if (!/\.(js|cjs|mjs|json|html|css|txt|md)$/.test(f)) continue;
  let text;
  try {
    text = asar.extractFile(archive, f).toString('utf8');
  } catch {
    const p = join(unpackedDir, f);
    if (!existsSync(p)) continue;
    text = readFileSync(p, 'utf8');
  }
  for (const s of personal) if (text.toLowerCase().includes(s.toLowerCase())) hits.push(`${f}: 이 PC의 개인 정보`);
  for (const re of secretPatterns) if (re.test(text)) hits.push(`${f}: ${re.source.slice(0, 20)}…`);
  if (/\/tmp\/claude-|[A-Za-z]:\\\\Users\\\\/.test(text) && !f.startsWith('node_modules/')) hits.push(`${f}: 빌드한 PC의 절대경로`);
}
check('asar에 개인 정보·토큰·빌드 PC 절대경로 없음', hits.length === 0, hits.slice(0, 10));

// ── 설치 파일 ──
const setup = readdirSync(releaseDir).find((f) => /^Cadora-Demo-Setup-.*\.exe$/.test(f));
if (check('설치 파일 생성', !!setup, setup)) {
  const buf = readFileSync(join(releaseDir, setup));
  console.error(`INFO ${setup} ${(statSync(join(releaseDir, setup)).size / 1048576).toFixed(1)} MB sha256=${createHash('sha256').update(buf).digest('hex')}`);
}
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results }, null, 1));
