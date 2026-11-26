/**
 * 로그인에 쓸 서버를 고른다.
 * - 팀 서버 주소(CADORA_SERVER_URL, 없으면 빌드 때 넣은 주소)가 있으면 그 서버를 쓴다.
 * - 없으면 앱 안 임시 서버(local-auth-server.ts)를 127.0.0.1에 켠다. 계정은 이 PC에만 있다.
 * GitHub OAuth App Client ID(비밀값 아님)는 환경변수 → 빌드 때 넣은 값 → 앱에서 입력한 값(userData) 순서로 찾는다.
 */
import { join } from 'node:path';
import { parseServerUrl, type ServerState } from './auth';
import { CLIENT_ID_PATTERN, startLocalAuthServer, type LocalAuthServer } from './local-auth-server';
import { readJson, writeJsonAtomic } from './store';

export interface AuthBackendOptions {
  userData: string;
  /** 팀 서버 주소. 빈 문자열이면 앱 안 임시 서버를 쓴다. */
  remoteUrl: string;
  envClientId: string;
  buildClientId: string;
  /** 자동 테스트 전용(이 PC의 http 주소만): 임시 서버가 github.com 대신 묻는 가짜 GitHub. */
  fakeGithub?: string;
}

/** GitHub OAuth App의 Client secret(40자리 16진수)을 Client ID 자리에 잘못 넣은 경우. secret은 저장하지 않는다. */
export const looksLikeClientSecret = (v: string) => /^[0-9a-f]{40}$/i.test(v);

export class AuthBackend {
  private local: LocalAuthServer | null = null;
  private error: string | null = null;
  /** 저장·재시작을 한 번에 하나만 한다(저장을 두 번 눌러도 서버가 둘 생기지 않게). */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: AuthBackendOptions) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Client ID가 어디서 왔는지(env·build는 앱에서 바꿀 수 없다). */
  get clientIdSource(): 'env' | 'build' | 'user' | null {
    if (this.o.envClientId) return 'env';
    if (this.o.buildClientId) return 'build';
    const stored = readJson<{ clientId?: unknown }>(this.clientIdFile, {});
    return typeof stored?.clientId === 'string' && stored.clientId ? 'user' : null;
  }

  /** 임시 서버를 켜지 못한 이유(있으면). */
  get lastError(): string | null {
    return this.error;
  }

  private get clientIdFile(): string {
    return join(this.o.userData, 'github-client-id.json');
  }

  private clientId(): string {
    const stored = readJson<{ clientId?: unknown }>(this.clientIdFile, {});
    return this.o.envClientId || this.o.buildClientId || (typeof stored?.clientId === 'string' ? stored.clientId : '');
  }

  server(): { url: string | null; state: ServerState } {
    if (this.o.remoteUrl) {
      const url = parseServerUrl(this.o.remoteUrl);
      return { url, state: url ? 'remote' : 'invalid' };
    }
    if (this.local) return { url: this.local.url, state: 'local' };
    return { url: null, state: this.error ? 'unavailable' : 'needs_client_id' };
  }

  /** 팀 서버가 없고 Client ID가 있으면 임시 서버를 켠다. */
  start(): Promise<void> {
    return this.serial(() => this.startNow());
  }

  private async startNow(): Promise<void> {
    if (this.o.remoteUrl || this.local) return;
    this.error = null;
    const clientId = this.clientId();
    if (!clientId) return;
    if (!CLIENT_ID_PATTERN.test(clientId) || looksLikeClientSecret(clientId)) {
      this.error = this.clientIdSource === 'user' ? '저장된 Client ID 형식이 올바르지 않아요. GitHub 연결을 다시 설정해 주세요.' : '이 버전에 들어 있는 Client ID 형식이 올바르지 않아요.';
      return;
    }
    try {
      this.local = await startLocalAuthServer({ clientId, dataFile: join(this.o.userData, 'local-auth.json'), fakeGithub: this.o.fakeGithub || undefined });
    } catch (err) {
      this.error = `앱 안 임시 서버를 켜지 못했어요(${err instanceof Error ? err.message : String(err)}).`;
    }
  }

  /** 앱에서 입력한 Client ID를 저장하고 임시 서버를 다시 켠다. */
  setClientId(clientId: string): Promise<{ url: string | null; state: ServerState }> {
    return this.serial(async () => {
      if (this.o.remoteUrl) throw new Error('팀 서버를 쓰는 중이라 GitHub 연결 설정이 필요 없어요.');
      if (this.o.envClientId || this.o.buildClientId) throw new Error('이 버전에는 GitHub 연결이 이미 들어 있어요.');
      if (looksLikeClientSecret(clientId)) throw new Error('Client secret 같아요. secret이 아니라 Client ID를 넣어 주세요(secret은 저장하지 않아요).');
      if (!CLIENT_ID_PATTERN.test(clientId)) throw new Error('Client ID 형식이 올바르지 않아요.');
      writeJsonAtomic(this.clientIdFile, { clientId });
      await this.stopNow();
      await this.startNow();
      if (this.error) throw new Error(this.error);
      return this.server();
    });
  }

  stop(): Promise<void> {
    return this.serial(() => this.stopNow());
  }

  private async stopNow(): Promise<void> {
    const l = this.local;
    this.local = null;
    await l?.close();
  }
}
