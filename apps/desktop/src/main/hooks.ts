/**
 * HookReceiver(#18·#35, FR-13, API.md §4): Claude Code hook → 데스크톱.
 * - 127.0.0.1에만 열고, 실행(run)마다 새로 만든 토큰이 맞지 않으면 401.
 * - 브라우저가 보낸 요청(Origin 헤더)·JSON이 아닌 요청·다른 Host는 거부한다(CSRF·DNS rebinding 방어).
 * - 본문은 1MB까지만 받는다. 원본 JSON은 메모리에서 정제한 뒤 바로 버리고, 어디에도 기록하지 않는다(FR-19).
 */
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { classify, toRelative } from './rules';
import type { FileCategory } from '../shared/bridge';

const MAX_BODY = 1024 * 1024;

export type HookSignal =
  | { kind: 'status'; status: 'working' | 'waiting' | 'done' | 'exited' }
  | { kind: 'activity' }
  | { kind: 'file'; relativePath: string; category: FileCategory; label: string; shared: boolean };

export interface HookEvent {
  runId: string;
  wsId: string;
  signal: HookSignal;
}

interface Run {
  runId: string;
  wsId: string;
  root: string;
  token: Buffer;
}

const safeEqual = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/** Claude Code hook 원본 → 최소 신호(API.md §4.3). 프롬프트·코드·세션 ID·cwd는 꺼내지 않는다. */
export function sanitizeHook(raw: unknown, root: string): HookSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r['hook_event_name']) {
    case 'SessionStart':
      return { kind: 'status', status: 'working' };
    case 'UserPromptSubmit':
      return { kind: 'activity' };
    case 'PostToolUse': {
      if (!/^(Edit|Write|MultiEdit)$/.test(String(r['tool_name'] ?? ''))) return null;
      const input = r['tool_input'];
      const fp = input && typeof input === 'object' ? (input as Record<string, unknown>)['file_path'] : null;
      if (typeof fp !== 'string') return null;
      const c = classify(toRelative(fp, root));
      if (c.excluded) return null;
      const rel = toRelative(fp, root);
      return rel ? { kind: 'file', relativePath: rel, category: c.cat, label: c.label, shared: c.shared } : null;
    }
    case 'Notification':
      return { kind: 'status', status: 'waiting' };
    case 'Stop':
      return { kind: 'status', status: 'done' };
    case 'SessionEnd':
      return { kind: 'status', status: 'exited' };
    default:
      return null;
  }
}

export class HookReceiver {
  private server: Server | null = null;
  private port = 0;
  private readonly runs = new Map<string, Run>();
  private listener: ((e: HookEvent) => void) | null = null;

  onEvent(cb: (e: HookEvent) => void): void {
    this.listener = cb;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/hooks`;
  }

  register(runId: string, wsId: string, root: string): string {
    const token = randomBytes(32).toString('base64url');
    this.runs.set(runId, { runId, wsId, root, token: Buffer.from(token) });
    return token;
  }

  unregister(runId: string): void {
    this.runs.delete(runId);
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      const end = (code: number) => {
        if (!res.headersSent) res.writeHead(code, { connection: 'close' });
        res.end();
      };
      if (req.method !== 'POST' || req.url !== '/hooks') {
        req.resume();
        return end(404);
      }
      if (req.headers.origin) {
        req.resume();
        return end(403);
      }
      if (req.headers.host !== `127.0.0.1:${this.port}`) {
        req.resume();
        return end(421);
      }
      if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) {
        req.resume();
        return end(415);
      }
      const run = this.runs.get(String(req.headers['x-cadora-run'] ?? ''));
      const token = Buffer.from(String(req.headers['x-cadora-token'] ?? ''));
      if (!run || !safeEqual(token, run.token)) {
        req.resume();
        return end(401);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let rejected = false;
      req.on('data', (c: Buffer) => {
        if (rejected) return;
        size += c.length;
        if (size > MAX_BODY) {
          rejected = true;
          chunks.length = 0;
          end(413);
          req.resume();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (rejected) return;
        let raw: unknown;
        try {
          raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return end(400);
        } finally {
          chunks.length = 0;
        }
        // 원본(raw)은 이 콜백이 끝나면 버려진다. 정제한 신호만 밖으로 나간다.
        const signal = sanitizeHook(raw, run.root);
        end(204);
        if (signal) this.listener?.({ runId: run.runId, wsId: run.wsId, signal });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    this.port = typeof addr === 'object' && addr ? addr.port : 0;
    this.server = server;
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    this.runs.clear();
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  }
}
