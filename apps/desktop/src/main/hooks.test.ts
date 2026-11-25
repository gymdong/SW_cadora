import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HookReceiver, sanitizeHook, type HookEvent } from './hooks';

const ROOT = 'C:\\Users\\u\\proj';

describe('sanitizeHook (API.md §4.3)', () => {
  it('프롬프트·코드·세션 정보를 꺼내지 않는다', () => {
    const prompt = { hook_event_name: 'UserPromptSubmit', prompt: 'SECRET PROMPT', session_id: 's', cwd: ROOT };
    expect(sanitizeHook(prompt, ROOT)).toEqual({ kind: 'activity' });
    const write = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: `${ROOT}\\prisma\\schema.prisma`, content: 'model Secret {}' },
      tool_response: { ok: true },
    };
    const s = sanitizeHook(write, ROOT);
    expect(s).toEqual({ kind: 'file', relativePath: 'prisma/schema.prisma', category: 'db-schema', label: 'DB 스키마', shared: true });
    expect(JSON.stringify(s)).not.toMatch(/model Secret|C:\\\\|Users/);
  });
  it('민감 파일·폴더 밖·다른 도구는 신호를 만들지 않는다', () => {
    expect(sanitizeHook({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: `${ROOT}\\.env` } }, ROOT)).toBeNull();
    expect(sanitizeHook({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\Windows\\x.ts' } }, ROOT)).toBeNull();
    expect(sanitizeHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, ROOT)).toBeNull();
    expect(sanitizeHook({ hook_event_name: 'Nope' }, ROOT)).toBeNull();
    expect(sanitizeHook('garbage', ROOT)).toBeNull();
  });
  it('상태 신호를 매핑한다', () => {
    expect(sanitizeHook({ hook_event_name: 'SessionStart', session_id: 'x' }, ROOT)).toEqual({ kind: 'status', status: 'working' });
    expect(sanitizeHook({ hook_event_name: 'Notification', message: 'needs permission' }, ROOT)).toEqual({ kind: 'status', status: 'waiting' });
    expect(sanitizeHook({ hook_event_name: 'Stop' }, ROOT)).toEqual({ kind: 'status', status: 'done' });
    expect(sanitizeHook({ hook_event_name: 'SessionEnd' }, ROOT)).toEqual({ kind: 'status', status: 'exited' });
  });
});

describe('HookReceiver', () => {
  let rx: HookReceiver | null = null;
  afterEach(async () => {
    await rx?.stop();
    rx = null;
  });

  function post(port: number, headers: Record<string, string>, body: string): Promise<number | string> {
    return new Promise((resolve) => {
      const req = request({ host: '127.0.0.1', port, path: '/hooks', method: 'POST', headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', (e) => resolve(`error:${(e as NodeJS.ErrnoException).code}`));
      req.end(body);
    });
  }

  it('올바른 토큰만 받고, 브라우저 요청·다른 Host·JSON 아님·큰 본문은 거부한다', async () => {
    rx = new HookReceiver();
    const events: HookEvent[] = [];
    rx.onEvent((e) => events.push(e));
    await rx.start();
    const port = Number(new URL(rx.url).port);
    const token = rx.register('run_aaaaaaaaaaaa', 'ws_bbbbbbbbbbbb', ROOT);
    const ok = { 'content-type': 'application/json', 'x-cadora-run': 'run_aaaaaaaaaaaa', 'x-cadora-token': token };
    const body = JSON.stringify({ hook_event_name: 'Stop' });

    expect(await post(port, ok, body)).toBe(204);
    expect(events).toEqual([{ runId: 'run_aaaaaaaaaaaa', wsId: 'ws_bbbbbbbbbbbb', signal: { kind: 'status', status: 'done' } }]);
    expect(await post(port, { ...ok, 'x-cadora-token': 'wrong' }, body)).toBe(401);
    expect(await post(port, { ...ok, 'x-cadora-run': 'run_cccccccccccc' }, body)).toBe(401);
    expect(await post(port, { ...ok, origin: 'https://evil.example' }, body)).toBe(403);
    expect(await post(port, { ...ok, host: `localhost:${port}` }, body)).toBe(421);
    expect(await post(port, { ...ok, 'content-type': 'text/plain' }, body)).toBe(415);
    expect(await post(port, ok, '{not json')).toBe(400);
    const big = await post(port, ok, JSON.stringify({ hook_event_name: 'Stop', pad: 'x'.repeat(2 * 1024 * 1024) }));
    expect([413, 'error:ECONNRESET', 'error:EPIPE']).toContain(big);
    expect(events).toHaveLength(1);

    rx.unregister('run_aaaaaaaaaaaa');
    expect(await post(port, ok, body)).toBe(401);
  });

  it('127.0.0.1에만 열린다', async () => {
    rx = new HookReceiver();
    await rx.start();
    expect(new URL(rx.url).hostname).toBe('127.0.0.1');
  });
});
