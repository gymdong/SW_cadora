/**
 * AgentManager(#28·#35, FR-11·13): Claude Code를 워크스페이스 폴더에서 실행하고 상태를 hook으로 받는다(PtyRuntime, API.md §5.4).
 * - 실행마다 run ID와 토큰을 새로 만들고, 환경변수(CADORA_HOOK_*)로 넘긴다. 토큰은 화면에 보내지 않는다.
 * - 워크스페이스 폴더의 .claude/settings.local.json에 Cadora hook을 합쳐 넣는다(기존 설정은 보존).
 *   이 파일은 .git/info/exclude에 추가해 커밋되지 않게 한다(API.md §4.1).
 * - 작업 제목은 Cadora의 메타데이터일 뿐 명령줄로 넘기지 않는다(명령 주입 방지). 프롬프트는 사용자가 터미널에 직접 입력한다.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRunInfo, AgentStatus } from '../shared/bridge';
import { baseEnv, withWorkspaceEnv } from './env';
import { emit } from './events';
import type { HookEvent, HookReceiver } from './hooks';
import type { TerminalManager } from './terminals';
import { mergeHookSettings } from './hook-settings';
import { newId, validateName, type WorkspaceManager } from './workspaces';

export function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const tool = process.platform === 'win32' ? 'where.exe' : 'which';
    execFile(tool, [cmd], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(String(stdout).split(/\r?\n/).find(Boolean) ?? null);
    });
  });
}

interface Run {
  info: AgentRunInfo;
}

export class AgentManager {
  private readonly runs = new Map<string, Run>();
  private claudePath: string | null = null;
  private nodePath: string | null = null;

  constructor(
    private readonly workspaces: WorkspaceManager,
    private readonly terminals: TerminalManager,
    private readonly hooks: HookReceiver,
    private readonly relayPath: string,
    private readonly onFile: (e: HookEvent & { signal: { kind: 'file' } }) => void,
  ) {
    hooks.onEvent((e) => this.onHook(e));
  }

  async detect(): Promise<void> {
    [this.claudePath, this.nodePath] = await Promise.all([which('claude'), which('node')]);
  }

  get claudeAvailable(): boolean {
    return !!this.claudePath;
  }

  get hookRunner(): 'node' | 'electron' {
    return this.nodePath ? 'node' : 'electron';
  }

  private hookCommand(): string {
    const relay = this.relayPath.replace(/\\/g, '/');
    if (this.nodePath) return `node "${relay}"`;
    // Node가 없으면 Electron의 내장 Node로 relay를 돌린다(Claude Code는 Windows에서 hook을 Git Bash로 실행한다).
    return `ELECTRON_RUN_AS_NODE=1 "${process.execPath.replace(/\\/g, '/')}" "${relay}"`;
  }

  /** hook 설정을 넣는다. 성공하면 true(관찰 수준: hooks), 기존 파일이 깨져 있으면 false(관찰 수준: process). */
  private installHooks(root: string): boolean {
    const dir = join(root, '.claude');
    const file = join(dir, 'settings.local.json');
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
    const merged = mergeHookSettings(existing, this.hookCommand());
    if (merged === null) return false;
    mkdirSync(dir, { recursive: true });
    if (merged !== existing) writeFileSync(file, merged, 'utf8');
    const exclude = join(root, '.git', 'info', 'exclude');
    if (existsSync(join(root, '.git', 'info'))) {
      const cur = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
      if (!cur.split(/\r?\n/).includes('.claude/settings.local.json')) {
        appendFileSync(exclude, `${cur.endsWith('\n') || !cur ? '' : '\n'}.claude/settings.local.json\n`);
      }
    }
    return true;
  }

  private publish(run: Run): void {
    emit('agent:status', { ...run.info });
  }

  private setStatus(run: Run, status: AgentStatus): void {
    run.info.status = status;
    run.info.lastActivityAt = new Date().toISOString();
    this.publish(run);
  }

  private onHook(e: HookEvent): void {
    const run = this.runs.get(e.runId);
    if (!run) return;
    const s = e.signal;
    if (s.kind === 'status') {
      if (run.info.status !== 'exited') this.setStatus(run, s.status);
    } else if (s.kind === 'activity') {
      this.setStatus(run, 'working');
    } else if (s.kind === 'file') {
      if (run.info.status !== 'exited') this.setStatus(run, 'working');
      this.onFile({ ...e, signal: s });
    }
  }

  async start(wsId: string, input: { tool: 'claude'; taskTitle: string }): Promise<AgentRunInfo> {
    if (input.tool !== 'claude') throw new Error('지금은 Claude Code만 실행할 수 있어요.');
    if (!this.claudePath) throw new Error('Claude Code(claude)를 찾지 못했어요. 설치 후 Cadora를 다시 켜 주세요.');
    const taskTitle = validateName(input.taskTitle);
    const ws = this.workspaces.get(wsId);
    const runId = newId('run');
    const observe = this.installHooks(ws.localPath) ? 'hooks' : 'process';
    const token = observe === 'hooks' ? this.hooks.register(runId, wsId, ws.localPath) : '';
    const env = withWorkspaceEnv(baseEnv(), await this.workspaces.envValues(wsId));
    if (token) Object.assign(env, { CADORA_HOOK_URL: this.hooks.url, CADORA_HOOK_TOKEN: token, CADORA_RUN_ID: runId });
    const now = new Date().toISOString();
    const run: Run = {
      info: { runId, wsId, tool: 'claude', taskTitle, termId: '', status: 'starting', observe, startedAt: now, lastActivityAt: now },
    };
    this.runs.set(runId, run);
    const spawnSpec =
      process.platform === 'win32'
        ? { file: process.env['ComSpec'] || 'cmd.exe', args: ['/d', '/c', 'claude'] }
        : { file: this.claudePath, args: [] as string[] };
    const term = this.terminals.spawn({
      wsId,
      title: `Claude Code · ${taskTitle}`,
      kind: 'agent',
      runId,
      cwd: ws.localPath,
      env,
      ...spawnSpec,
      onExit: () => {
        this.hooks.unregister(runId);
        this.setStatus(run, 'exited');
      },
    });
    run.info.termId = term.termId;
    this.publish(run);
    return { ...run.info };
  }

  async stop(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    await this.terminals.stop(run.info.termId);
  }

  list(wsId: string): AgentRunInfo[] {
    return [...this.runs.values()].filter((r) => r.info.wsId === wsId).map((r) => ({ ...r.info }));
  }

  forgetWorkspace(wsId: string): void {
    for (const [id, r] of this.runs) {
      if (r.info.wsId === wsId) {
        this.hooks.unregister(id);
        this.runs.delete(id);
      }
    }
  }
}
