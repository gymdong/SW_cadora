// Claude Code hook 명령 → Cadora 데스크톱(API.md §4.1). 스파이크 #18에서 Windows 11로 검증한 relay다.
// - stdin JSON을 그대로 127.0.0.1의 수신기로 POST하고 항상 0으로 끝난다. Cadora가 꺼져 있어도 에이전트를 막지 않는다.
// - 내용은 어디에도 기록하지 않는다. 1MB가 넘는 원본은 보내지 않는다(파일 변경은 감시기가 잡는다).
// - CADORA_HOOK_URL은 127.0.0.1의 http 주소만 받는다(다른 곳으로 원본이 나가지 않게).
'use strict';
const http = require('node:http');

const MAX = 1024 * 1024;
const done = () => process.exit(0);
setTimeout(done, 3000).unref();

const url = process.env.CADORA_HOOK_URL;
const token = process.env.CADORA_HOOK_TOKEN;
const run = process.env.CADORA_RUN_ID;
if (!url || !token || !run) done();

let u = null;
try {
  u = new URL(url);
} catch {
  done();
}
if (!u || u.protocol !== 'http:' || u.hostname !== '127.0.0.1') done();

const chunks = [];
let size = 0;
let tooBig = false;
process.stdin.on('data', (c) => {
  size += c.length;
  if (size > MAX) tooBig = true;
  else chunks.push(c);
});
process.stdin.on('error', done);
process.stdin.on('end', () => {
  if (tooBig) return done();
  const body = Buffer.concat(chunks);
  const req = http.request(
    {
      host: '127.0.0.1',
      port: Number(u.port),
      path: '/hooks',
      method: 'POST',
      timeout: 1500,
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-cadora-token': token,
        'x-cadora-run': run,
      },
    },
    (res) => {
      res.resume();
      res.on('end', done);
    },
  );
  req.on('error', done);
  req.on('timeout', () => {
    req.destroy();
    done();
  });
  req.end(body);
});
