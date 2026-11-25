/**
 * WorkspaceManager(#24, FR-01·04): 개인 워크스페이스 모델과 로컬 저장.
 * - 워크스페이스마다 폴더·브라우저 세션(persist:ws_<id>)·다운로드 폴더·환경변수가 따로다.
 * - 폴더 경로·탭·환경변수는 이 PC에만 저장한다(PRD §7.4 LocalWorkspaceConfig, 서버 전송 금지).
 */
import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { CreateWorkspaceInput, LocalWorkspaceView, WorkspaceState, WorkspaceType } from '../shared/bridge';
import { emit } from './events';
import { isValidEnvName, maskValue } from './rules';
import { decryptSecret, encryptSecret } from './secrets';
import { readJson, writeJsonAtomic } from './store';

export const WORKSPACE_TYPES: WorkspaceType[] = ['과제', '팀 프로젝트', '개인 프로젝트', '기타'];

export interface StoredTab {
  id: string;
  url: string;
  title: string;
}

interface StoredWorkspace {
  id: string;
  name: string;
  type: WorkspaceType;
  state: WorkspaceState;
  localPath: string;
  partition: string;
  downloadDir: string;
  tabs: StoredTab[];
  activeTabId: string | null;
  /** enc: safeStorage로 암호화한 값, masked: 저장할 때 만든 가린 값(목록을 보여 줄 때 복호화하지 않는다). */
  env: Array<{ name: string; enc: string; masked: string }>;
  createdAt: string;
}

interface StoreFile {
  version: 1;
  workspaces: StoredWorkspace[];
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

function safeFolderName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return s.slice(0, 60) || 'workspace';
}

export function validateName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const n = String(name).replace(/[\u0000-\u001f]/g, '').trim();
  if (!n) throw new Error('이름을 입력해 주세요.');
  if (n.length > 40) throw new Error('이름은 40자 이하로 입력해 주세요.');
  return n;
}

export class WorkspaceManager {
  private readonly file = join(app.getPath('userData'), 'workspaces.json');
  private data: StoreFile;

  constructor() {
    const loaded = readJson<StoreFile>(this.file, { version: 1, workspaces: [] });
    this.data = { version: 1, workspaces: Array.isArray(loaded.workspaces) ? loaded.workspaces : [] };
    // 앱을 새로 켜면 실행 중이던 화면은 없으므로 active였던 워크스페이스는 background로 돌린다.
    for (const w of this.data.workspaces) if (w.state === 'active') w.state = 'background';
  }

  private save(): void {
    writeJsonAtomic(this.file, this.data);
    emit('workspace:changed', this.list());
  }

  private view(w: StoredWorkspace): LocalWorkspaceView {
    return {
      id: w.id,
      kind: 'personal',
      name: w.name,
      type: w.type,
      state: w.state,
      localPath: w.localPath,
      partition: w.partition,
      downloadDir: w.downloadDir,
      env: w.env.map((e) => ({ name: e.name, masked: e.masked || '••••' })),
      createdAt: w.createdAt,
    };
  }

  list(): LocalWorkspaceView[] {
    return this.data.workspaces.map((w) => this.view(w));
  }

  get(id: string): StoredWorkspace {
    const w = this.data.workspaces.find((x) => x.id === id);
    if (!w) throw new Error('워크스페이스를 찾을 수 없어요.');
    return w;
  }

  has(id: string): boolean {
    return this.data.workspaces.some((x) => x.id === id);
  }

  all(): readonly StoredWorkspace[] {
    return this.data.workspaces;
  }

  create(input: CreateWorkspaceInput): LocalWorkspaceView {
    const name = validateName(input.name);
    if (!WORKSPACE_TYPES.includes(input.type)) throw new Error('워크스페이스 종류가 올바르지 않아요.');
    let localPath: string;
    if (input.localPath) {
      if (!isAbsolute(input.localPath)) throw new Error('폴더는 절대경로여야 해요.');
      localPath = resolve(input.localPath);
      if (existsSync(localPath) && !statSync(localPath).isDirectory()) throw new Error('선택한 경로가 폴더가 아니에요.');
    } else {
      // 기본 위치: 문서\Cadora\<이름>. 테스트·시연용으로 CADORA_WORKSPACES_ROOT(절대경로)를 주면 그 아래에 만든다.
      const override = process.env['CADORA_WORKSPACES_ROOT'];
      const root = override && isAbsolute(override) ? override : join(app.getPath('documents'), 'Cadora');
      localPath = join(root, safeFolderName(name));
    }
    if (this.data.workspaces.some((w) => w.localPath.toLowerCase() === localPath.toLowerCase())) {
      throw new Error('이미 다른 워크스페이스가 쓰는 폴더예요.');
    }
    mkdirSync(localPath, { recursive: true });
    const id = newId('ws');
    const w: StoredWorkspace = {
      id,
      name,
      type: input.type,
      state: 'background',
      localPath,
      partition: `persist:ws_${id}`,
      downloadDir: join(localPath, '자료'),
      tabs: [],
      activeTabId: null,
      env: [],
      createdAt: new Date().toISOString(),
    };
    this.data.workspaces.push(w);
    this.save();
    return this.view(w);
  }

  rename(id: string, name: string): LocalWorkspaceView {
    const w = this.get(id);
    w.name = validateName(name);
    this.save();
    return this.view(w);
  }

  remove(id: string): StoredWorkspace {
    const w = this.get(id);
    this.data.workspaces = this.data.workspaces.filter((x) => x.id !== id);
    this.save();
    return w;
  }

  setState(id: string, state: WorkspaceState): void {
    const w = this.get(id);
    if (state === 'active') {
      for (const x of this.data.workspaces) if (x.id !== id && x.state === 'active') x.state = 'background';
    }
    w.state = state;
    this.save();
  }

  setTabs(id: string, tabs: StoredTab[], activeTabId: string | null): void {
    if (!this.has(id)) return;
    const w = this.get(id);
    w.tabs = tabs.slice(0, 30);
    w.activeTabId = activeTabId;
    writeJsonAtomic(this.file, this.data); // 탭 변화는 화면에 따로 알린다(browser:tabs)
  }

  async setEnv(id: string, name: string, value: string): Promise<LocalWorkspaceView> {
    const w = this.get(id);
    if (!isValidEnvName(name)) throw new Error('환경변수 이름은 영문·숫자·밑줄만 쓸 수 있어요.');
    if (typeof value !== 'string' || value.length > 8192) throw new Error('값이 너무 길어요.');
    const enc = await encryptSecret(value);
    w.env = w.env.filter((e) => e.name !== name).concat({ name, enc, masked: maskValue(name, value) });
    this.save();
    return this.view(w);
  }

  removeEnv(id: string, name: string): LocalWorkspaceView {
    const w = this.get(id);
    w.env = w.env.filter((e) => e.name !== name);
    this.save();
    return this.view(w);
  }

  /** main 전용: 복호화한 환경변수. 프로세스를 띄울 때만 쓰고 화면으로 보내지 않는다. */
  async envValues(id: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const e of this.get(id).env) {
      const v = await decryptSecret(e.enc);
      if (v !== null) out[e.name] = v;
    }
    return out;
  }
}
