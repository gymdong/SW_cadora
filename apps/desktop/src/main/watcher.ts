/**
 * ProjectWatcher(#19·#35, FR-12): 워크스페이스 폴더의 파일 변경을 감시해 상대경로·분류만 만든다.
 * - 스파이크 #19 결과대로 @parcel/watcher를 쓴다(제외 폴더를 네이티브에서 걸러 node_modules 폭주에도 CPU가 거의 안 든다).
 * - 민감 파일(.env·키 등)과 제외 경로는 이벤트를 만들지 않는다.
 * - 같은 파일을 hook과 감시기가 모두 잡으면 hook 쪽만 보낸다(API.md §4.3). 감시 이벤트는 700ms 기다렸다가 보낸다.
 * - 폴더 생성·변경은 이벤트로 만들지 않는다. 워크스페이스 다운로드 폴더(기본 자료/)도 감시하지 않는다
 *   (개인이 받은 파일 이름이 팀 이벤트로 나가지 않게, FR-18).
 */
import watcher, { type AsyncSubscription } from '@parcel/watcher';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FileChange } from '../shared/bridge';
import { emit } from './events';
import { EXCLUDED_DIRS, classify, toRelative } from './rules';

const HOOK_WINDOW_MS = 1000;
const WATCH_DELAY_MS = 700;

interface WsWatch {
  root: string;
  sub: AsyncSubscription | null;
  pending: Map<string, NodeJS.Timeout>;
  hookSeen: Map<string, number>;
  recent: FileChange[];
  branch: { value: string; at: number };
}

export function readBranch(root: string): string {
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref: refs\/heads\/(.+)$/);
    return m ? m[1]! : head.slice(0, 7);
  } catch {
    return '-';
  }
}

export class ProjectWatcher {
  private readonly ws = new Map<string, WsWatch>();

  private entry(wsId: string, root: string): WsWatch {
    let w = this.ws.get(wsId);
    if (!w) {
      w = { root, sub: null, pending: new Map(), hookSeen: new Map(), recent: [], branch: { value: '-', at: 0 } };
      this.ws.set(wsId, w);
    }
    return w;
  }

  private branch(w: WsWatch): string {
    if (Date.now() - w.branch.at > 2000) w.branch = { value: readBranch(w.root), at: Date.now() };
    return w.branch.value;
  }

  private push(wsId: string, w: WsWatch, change: FileChange): void {
    w.recent.push(change);
    if (w.recent.length > 50) w.recent.splice(0, w.recent.length - 50);
    emit('file:changed', change);
  }

  async watch(wsId: string, root: string, downloadDir?: string): Promise<void> {
    const w = this.entry(wsId, root);
    if (w.sub) return;
    const dl = downloadDir ? toRelative(downloadDir, root) : null;
    w.sub = await watcher.subscribe(
      root,
      (err, events) => {
        if (err) return;
        for (const e of events) {
          const rel = toRelative(e.path, root);
          const c = classify(rel);
          if (c.excluded || !rel) continue;
          if (dl && (rel === dl || rel.startsWith(dl + '/'))) continue;
          if (rel === '.claude/settings.local.json') continue; // Cadora가 넣는 개인 hook 설정(git에서도 빠져 있다)
          if (e.type !== 'delete') {
            try {
              if (statSync(e.path).isDirectory()) continue;
            } catch {
              continue; // 이미 사라진 경로
            }
          }
          const prev = w.pending.get(rel);
          if (prev) clearTimeout(prev);
          w.pending.set(
            rel,
            setTimeout(() => {
              w.pending.delete(rel);
              const seen = w.hookSeen.get(rel);
              if (seen && Date.now() - seen < HOOK_WINDOW_MS + WATCH_DELAY_MS) return;
              this.push(wsId, w, {
                wsId,
                relativePath: rel,
                category: c.cat,
                label: c.label,
                shared: c.shared,
                branch: this.branch(w),
                source: 'watcher',
                at: new Date().toISOString(),
              });
            }, WATCH_DELAY_MS),
          );
        }
      },
      { ignore: dl ? [...EXCLUDED_DIRS, dl] : EXCLUDED_DIRS },
    );
  }

  /** hook(PostToolUse)이 알려 준 변경: 바로 보내고, 같은 경로의 감시 이벤트는 버린다. */
  fromHook(wsId: string, root: string, runId: string, f: { relativePath: string; category: FileChange['category']; label: string; shared: boolean }): void {
    const w = this.entry(wsId, root);
    w.hookSeen.set(f.relativePath, Date.now());
    const pending = w.pending.get(f.relativePath);
    if (pending) {
      clearTimeout(pending);
      w.pending.delete(f.relativePath);
    }
    this.push(wsId, w, { wsId, ...f, branch: this.branch(w), source: 'hook:PostToolUse', runId, at: new Date().toISOString() });
  }

  recent(wsId: string): FileChange[] {
    return [...(this.ws.get(wsId)?.recent ?? [])].reverse();
  }

  async unwatch(wsId: string): Promise<void> {
    const w = this.ws.get(wsId);
    if (!w) return;
    for (const t of w.pending.values()) clearTimeout(t);
    this.ws.delete(wsId);
    await w.sub?.unsubscribe();
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.ws.keys()].map((id) => this.unwatch(id)));
  }
}
