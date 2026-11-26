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

export class AuthBackend {
  private local: LocalAuthServer | null = null;

  constructor(private readonly o: AuthBackendOptions) {}

  private get clientIdFile(): string {
    return join(this.o.userData, 'github-client-id.json');
  }

  private clientId(): string {
    const stored = readJson<{ clientId?: unknown }>(this.clientIdFile, {});
    return this.o.envClientId || this.o.buildClientId || (typeof stored.clientId === 'string' ? stored.clientId : '');
  }

  server(): { url: string | null; state: ServerState } {
    if (this.o.remoteUrl) {
      const url = parseServerUrl(this.o.remoteUrl);
      return { url, state: url ? 'remote' : 'invalid' };
    }
    return this.local ? { url: this.local.url, state: 'local' } : { url: null, state: 'needs_client_id' };
  }

  /** 팀 서버가 없고 Client ID가 있으면 임시 서버를 켠다. */
  async start(): Promise<void> {
    if (this.o.remoteUrl || this.local) return;
    const clientId = this.clientId();
    if (!CLIENT_ID_PATTERN.test(clientId)) return;
    this.local = await startLocalAuthServer({ clientId, dataFile: join(this.o.userData, 'local-auth.json'), fakeGithub: this.o.fakeGithub || undefined });
  }

  /** 앱에서 입력한 Client ID를 저장하고 임시 서버를 다시 켠다. */
  async setClientId(clientId: string): Promise<{ url: string | null; state: ServerState }> {
    if (this.o.remoteUrl) throw new Error('팀 서버를 쓰는 중이라 GitHub 연결 설정이 필요 없어요.');
    if (this.o.envClientId || this.o.buildClientId) throw new Error('이 버전에는 GitHub 연결이 이미 들어 있어요.');
    if (!CLIENT_ID_PATTERN.test(clientId)) throw new Error('Client ID 형식이 올바르지 않아요.');
    writeJsonAtomic(this.clientIdFile, { clientId });
    await this.stop();
    await this.start();
    return this.server();
  }

  async stop(): Promise<void> {
    const l = this.local;
    this.local = null;
    await l?.close();
  }
}
