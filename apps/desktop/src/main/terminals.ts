/**
 * TerminalManager(#28, FR-03): node-pty(ConPTY) 터미널.
 * - 워크스페이스 폴더에서 PowerShell을 띄우고, 허용 목록 환경변수 + 그 워크스페이스 환경변수만 넘긴다.
 * - 종료는 스파이크 #20 결과대로 "프로세스 트리 종료(taskkill /T /F) → pty.kill()"로 한다.
 *   taskkill만 하면 의사 콘솔(conhost)이 남고, pty.kill()은 콘솔에 붙은 프로세스만 끈다.
 * - 출력은 16ms 단위로 묶어 화면에 보내고, 다시 그릴 때를 위해 최근 출력 일부를 보관한다.
 */
import { execFile } from 'node:child_process';
import * as pty from 'node-pty';
import type { TerminalInfo } from '../shared/bridge';
import { emit } from './events';
import { newId } from './workspaces';

const BACKLOG_LIMIT = 200_000;

interface Term {
  info: TerminalInfo;
  proc: pty.IPty;
  backlog: string;
  pending: string;
  flushTimer: NodeJS.Timeout | null;
  onExit?: (code: number) => void;
}

export interface SpawnSpec {
  wsId: string;
  title: string;
  kind: 'shell' | 'agent';
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  runId?: string;
  onExit?: (code: number) => void;
}

export function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] };
  return { file: process.env['SHELL'] || '/bin/bash', args: ['-l'] };
}

export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          /* 이미 끝났다 */
        }
      }
      resolve();
      return;
    }
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

export class TerminalManager {
  private readonly terms = new Map<string, Term>();

  spawn(spec: SpawnSpec): TerminalInfo {
    const proc = pty.spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 28,
      cwd: spec.cwd,
      env: spec.env,
    });
    const info: TerminalInfo = {
      termId: newId('term'),
      wsId: spec.wsId,
      title: spec.title,
      kind: spec.kind,
      runId: spec.runId,
      alive: true,
    };
    const term: Term = { info, proc, backlog: '', pending: '', flushTimer: null, onExit: spec.onExit };
    this.terms.set(info.termId, term);
    proc.onData((data) => {
      term.backlog = (term.backlog + data).slice(-BACKLOG_LIMIT);
      term.pending += data;
      if (!term.flushTimer) {
        term.flushTimer = setTimeout(() => {
          term.flushTimer = null;
          const chunk = term.pending;
          term.pending = '';
          if (chunk) emit('terminal:data', { termId: info.termId, data: chunk });
        }, 16);
      }
    });
    proc.onExit(({ exitCode }) => {
      info.alive = false;
      const tail = `\r\n\x1b[90m[프로세스 종료 · 코드 ${exitCode}]\x1b[0m\r\n`;
      term.backlog += tail;
      emit('terminal:data', { termId: info.termId, data: tail });
      this.publish(spec.wsId);
      term.onExit?.(exitCode);
    });
    this.publish(spec.wsId);
    return { ...info };
  }

  private publish(wsId: string): void {
    emit('terminal:list', { wsId, terminals: this.list(wsId) });
  }

  list(wsId: string): TerminalInfo[] {
    return [...this.terms.values()].filter((t) => t.info.wsId === wsId).map((t) => ({ ...t.info }));
  }

  get(termId: string): TerminalInfo | null {
    const t = this.terms.get(termId);
    return t ? { ...t.info } : null;
  }

  write(termId: string, data: string): void {
    const t = this.terms.get(termId);
    if (t && t.info.alive) t.proc.write(data);
  }

  resize(termId: string, cols: number, rows: number): void {
    const t = this.terms.get(termId);
    if (t && t.info.alive) {
      try {
        t.proc.resize(cols, rows);
      } catch {
        /* 종료 직후 resize는 무시한다 */
      }
    }
  }

  backlog(termId: string): string {
    return this.terms.get(termId)?.backlog ?? '';
  }

  /** 트리 종료 → pty 닫기 → 목록에서 뺀다. */
  async close(termId: string): Promise<void> {
    const t = this.terms.get(termId);
    if (!t) return;
    if (t.info.alive) await this.kill(t);
    this.terms.delete(termId);
    this.publish(t.info.wsId);
  }

  /** 프로세스만 끄고 화면 기록은 남긴다(에이전트 종료). */
  async stop(termId: string): Promise<void> {
    const t = this.terms.get(termId);
    if (t && t.info.alive) await this.kill(t);
  }

  private async kill(t: Term): Promise<void> {
    await killTree(t.proc.pid);
    try {
      t.proc.kill();
    } catch {
      /* 이미 닫혔다 */
    }
  }

  async closeWorkspace(wsId: string): Promise<void> {
    await Promise.all([...this.terms.values()].filter((t) => t.info.wsId === wsId).map((t) => this.close(t.info.termId)));
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.terms.keys()].map((id) => this.close(id)));
  }
}
