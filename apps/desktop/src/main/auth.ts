/**
 * Cadora 계정 로그인(API.md §1.1·§1.2·§6.3·§7.1). Cadora 서버를 거치는 GitHub Device Flow다.
 *
 * - 화면(renderer)에는 userCode·verificationUri·Me만 넘긴다. deviceCode와 토큰은 main 밖으로 나가지 않는다.
 * - access token은 메모리에만 둔다. refresh token은 saveRefreshToken으로 넘겨 safeStorage로 암호화해 둔다(§6.3).
 * - 기기 코드·토큰은 로그와 오류 메시지에 넣지 않는다(§7.1).
 * - 서버 주소는 https만 쓴다. 개발용 http는 이 PC(loopback)만 허용한다.
 * - 서버가 준 로그인 주소는 https://github.com 일 때만 연다(서버가 아무 주소나 열게 하지 않는다).
 * - electron을 import하지 않는다. safeStorage·shell은 index.ts가 넣어 주고, 단위 테스트는 가짜를 넣는다.
 */
import { z } from 'zod';
import type { AuthStatus, LoginStart, Me } from '../shared/bridge';

/** API.md §0의 개발 서버 주소. CADORA_SERVER_URL로 바꾼다. */
export const DEFAULT_SERVER_URL = 'http://localhost:4000/v1';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 서버 주소를 검사한다. https, 또는 이 PC의 http만 받는다. 올바르지 않으면 null. 끝의 /는 뗀다. */
export function parseServerUrl(raw: string | undefined): string | null {
  try {
    const u = new URL(raw === undefined || raw === '' ? DEFAULT_SERVER_URL : raw);
    if (u.username || u.password || u.search || u.hash) return null;
    const ok = u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname));
    return ok ? u.href.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

/** GitHub 기기 인증 페이지(https://github.com/…)인지. */
export function isGithubVerificationUri(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'github.com' && !u.port && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** GitHub 아바타 주소만 화면에 넘긴다(서버가 준 임의 주소의 이미지를 불러오지 않게). */
export function safeAvatarUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'avatars.githubusercontent.com' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

const Str = (max: number) => z.string().min(1).max(max);
const UserSchema = z.object({ id: Str(128), displayName: z.string().max(200), avatarUrl: z.string().max(2048).nullable() });
const MeSchema = UserSchema.extend({
  workspaces: z.array(z.object({ id: Str(128), name: z.string().max(200), role: z.enum(['LEADER', 'MEMBER', 'VIEWER']) })).max(500),
});
const DeviceSchema = z.object({
  deviceCode: Str(1024),
  userCode: Str(64),
  verificationUri: Str(2048),
  interval: z.number().int().min(0).max(600),
  expiresIn: z.number().int().min(1).max(7200),
});
const TokensSchema = z.object({ accessToken: Str(8192), refreshToken: Str(8192) });
const LoginDoneSchema = TokensSchema.extend({ user: UserSchema });
const ErrorSchema = z.object({
  error: z.object({ code: z.string().max(100), message: z.string().max(500).optional(), details: z.record(z.string(), z.unknown()).optional() }),
});

interface Reply {
  status: number;
  data: unknown;
}

function errorOf(data: unknown): { code?: string; message?: string; details?: Record<string, unknown> } {
  const p = ErrorSchema.safeParse(data);
  return p.success ? p.data.error : {};
}

/** 요청이 서버에 닿지 않은 연결 오류(이때는 refresh token이 그대로 유효하다). */
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

export type ServerState = 'configured' | 'not_configured' | 'invalid';

export interface AuthDeps {
  /** parseServerUrl 결과. null이면 로그인하지 않고 serverState에 맞는 안내를 낸다. */
  serverUrl: string | null;
  /** not_configured: 설치판에 팀 서버 주소가 아직 없음. invalid: 주소가 https·loopback 규칙에 맞지 않음. */
  serverState?: ServerState;
  loadRefreshToken(): Promise<string | null>;
  /** null이면 지운다. 암호화를 쓸 수 없으면 throw한다(그러면 앱이 켜져 있는 동안만 로그인이 유지된다). */
  saveRefreshToken(token: string | null): Promise<void>;
  openExternal(url: string): Promise<void>;
  onStatus(status: AuthStatus, message?: string): void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}

export class AuthService {
  private statusValue: AuthStatus = 'logged_out';
  private meValue: Me | null = null;
  private access: string | null = null;
  private refreshToken: string | null = null;
  private pending: { userCode: string; verificationUri: string; expiresAt: number } | null = null;
  private loginGen = 0;
  private refreshing: Promise<'ok' | 'invalid'> | null = null;
  private restoring: Promise<void> | null = null;
  private restoreError: AuthError | null = null;
  private quiet = false;
  private disposed = false;
  private readonly f: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly deps: AuthDeps) {
    this.f = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
  }

  get status(): AuthStatus {
    return this.statusValue;
  }

  get server(): string | null {
    return this.deps.serverUrl;
  }

  /** 앱 시작 때: 저장된 refresh token이 있으면 세션을 되살린다. 서버가 꺼져 있으면 토큰은 두고 다음 me()에서 다시 시도한다. */
  async init(): Promise<void> {
    let token: string | null;
    try {
      token = await this.deps.loadRefreshToken();
    } catch {
      token = null;
    }
    if (!token || this.disposed) return;
    this.refreshToken = token;
    await this.restore();
  }

  /** Device Flow를 시작한다(§1.1). 승인은 백그라운드에서 interval마다 묻고, 결과는 onStatus로 알린다. */
  async login(): Promise<LoginStart> {
    const base = this.requireServer();
    this.cancelLogin(false);
    const r = await this.call(base, 'POST', '/auth/github/device', {});
    if (r.status !== 200) throw this.replyError(r, 'GitHub 로그인을 시작하지 못했어요.');
    const p = DeviceSchema.safeParse(r.data);
    if (!p.success) throw new AuthError('invalid_response', '서버 응답 형식이 API 계약(§7.1)과 달라요.');
    if (!isGithubVerificationUri(p.data.verificationUri)) {
      throw new AuthError('invalid_response', '서버가 준 로그인 주소가 github.com이 아니어서 열지 않았어요.');
    }
    const expiresAt = this.now() + p.data.expiresIn * 1000;
    const gen = ++this.loginGen;
    this.pending = { userCode: p.data.userCode, verificationUri: p.data.verificationUri, expiresAt };
    this.setStatus('pending');
    void this.poll(gen, base, p.data.deviceCode, Math.max(1, p.data.interval), expiresAt);
    return { userCode: p.data.userCode, verificationUri: p.data.verificationUri, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** 진행 중인 로그인을 멈춘다. 서버의 기기 코드는 만료되면 사라진다. */
  cancelLogin(emit = true): void {
    this.loginGen++;
    if (!this.pending) return;
    this.pending = null;
    if (emit) this.setStatus(this.meValue && this.access ? 'authenticated' : 'logged_out');
  }

  /** 사용자가 버튼을 눌렀을 때만 GitHub 인증 페이지를 기본 브라우저로 연다. */
  async openVerification(): Promise<void> {
    const p = this.pending;
    if (!p) throw new AuthError('no_login', '진행 중인 로그인이 없어요.');
    if (!isGithubVerificationUri(p.verificationUri)) throw new AuthError('invalid_response', '로그인 주소가 github.com이 아니어서 열지 않았어요.');
    await this.deps.openExternal(p.verificationUri);
  }

  /** 로그인되어 있으면 내 정보(§1.2), 아니면 null. 저장된 로그인이 있는데 서버에 닿지 못하면 throw한다. */
  async me(): Promise<Me | null> {
    if (this.statusValue === 'authenticated' && this.access) {
      try {
        await this.loadMe();
      } catch {
        /* 서버에 잠깐 닿지 못하면 마지막으로 받은 정보를 쓴다 */
      }
      return this.statusValue === 'authenticated' ? this.meValue : null;
    }
    if (this.statusValue !== 'pending' && this.refreshToken && !this.access) {
      await this.restore();
      if (this.restoreError) throw this.restoreError;
    }
    return this.statusValue === 'authenticated' ? this.meValue : null;
  }

  /** 서버에 refresh token 폐기를 요청하고(§7.1), 서버에 닿지 못해도 이 PC의 로그인 정보는 지운다. */
  async logout(): Promise<void> {
    this.cancelLogin(false);
    const base = this.deps.serverUrl;
    this.quiet = true;
    try {
      if (base && this.refreshToken) {
        if (!this.access) await this.refresh();
        if (this.access && this.refreshToken) {
          let r = await this.call(base, 'POST', '/auth/logout', { refreshToken: this.refreshToken }, this.access);
          if (r.status === 401 && (await this.refresh()) === 'ok' && this.access && this.refreshToken) {
            r = await this.call(base, 'POST', '/auth/logout', { refreshToken: this.refreshToken }, this.access);
          }
        }
      }
    } catch {
      /* 서버에 알리지 못해도 이 PC의 로그인 정보는 지운다 */
    } finally {
      this.quiet = false;
    }
    await this.clearLocal();
    this.setStatus('logged_out');
  }

  dispose(): void {
    this.disposed = true;
    this.loginGen++;
  }

  // ───────────── 내부 ─────────────

  private async poll(gen: number, base: string, deviceCode: string, intervalSec: number, expiresAt: number): Promise<void> {
    let interval = intervalSec;
    while (gen === this.loginGen && !this.disposed) {
      await this.sleep(interval * 1000);
      if (gen !== this.loginGen || this.disposed) return;
      if (this.now() >= expiresAt) return this.endLogin(gen, 'expired', '코드 유효 시간이 지났어요. 다시 시도해 주세요.');
      let r: Reply;
      try {
        r = await this.call(base, 'POST', '/auth/github/poll', { deviceCode });
      } catch {
        continue; // 잠깐 끊겨도 만료 전까지 계속 묻는다
      }
      if (gen !== this.loginGen) return;
      if (r.status === 202) continue;
      if (r.status === 200) {
        const done = LoginDoneSchema.safeParse(r.data);
        if (!done.success) return this.endLogin(gen, 'logged_out', '서버 응답 형식이 API 계약(§7.1)과 달라요.');
        this.access = done.data.accessToken;
        this.refreshToken = done.data.refreshToken;
        this.meValue = { ...this.toUser(done.data.user), workspaces: [] };
        await this.persist(done.data.refreshToken);
        try {
          await this.loadMe();
        } catch {
          /* /me가 실패해도 로그인 응답의 user로 시작한다 */
        }
        if (gen !== this.loginGen) return;
        this.pending = null;
        this.setStatus('authenticated');
        return;
      }
      const e = errorOf(r.data);
      if (r.status === 429 || e.code === 'slow_down') {
        const retry = Number(e.details?.['retryAfterSeconds']);
        interval = Math.max(interval + 5, Number.isFinite(retry) ? Math.min(retry, 600) : 0);
        continue;
      }
      if (r.status === 403 && e.code === 'device_denied') return this.endLogin(gen, 'denied', 'GitHub에서 로그인을 거부했어요. 다시 시도할 수 있어요.');
      if (r.status === 410 || e.code === 'device_expired') return this.endLogin(gen, 'expired', '코드 유효 시간이 지났어요. 다시 시도해 주세요.');
      if (r.status >= 500) continue;
      return this.endLogin(gen, 'logged_out', e.message ? `로그인하지 못했어요: ${e.message}` : `로그인하지 못했어요 (HTTP ${r.status}).`);
    }
  }

  private endLogin(gen: number, status: AuthStatus, message: string): void {
    if (gen !== this.loginGen) return;
    this.pending = null;
    this.setStatus(status, message);
  }

  private restore(): Promise<void> {
    this.restoring ??= (async () => {
      this.restoreError = null;
      try {
        if ((await this.refresh()) === 'ok') await this.loadMe();
      } catch (err) {
        this.restoreError = err instanceof AuthError ? err : new AuthError('network', 'Cadora 서버와 통신하지 못했어요.');
      }
    })().finally(() => {
      this.restoring = null;
    });
    return this.restoring;
  }

  /** refresh token으로 새 토큰 쌍을 받는다. 동시에 여러 번 불려도 요청은 하나만 보낸다(§6.3). */
  private refresh(): Promise<'ok' | 'invalid'> {
    if (!this.refreshToken) return Promise.resolve('invalid');
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<'ok' | 'invalid'> {
    const base = this.requireServer();
    const token = this.refreshToken;
    if (!token) return 'invalid';
    let r: Reply;
    try {
      r = await this.call(base, 'POST', '/auth/refresh', { refreshToken: token });
    } catch (err) {
      // 요청이 나가지 않았다면 토큰은 그대로 유효하다. 응답만 잃었다면 서버가 이미 토큰을 바꿨을 수 있어 다시 로그인한다(§6.3).
      if (err instanceof AuthError && err.code === 'server_unreachable') throw err;
      await this.sessionLost('서버 응답을 받지 못해 다시 로그인해야 해요.');
      return 'invalid';
    }
    if (r.status === 200) {
      const t = TokensSchema.safeParse(r.data);
      if (!t.success) {
        await this.sessionLost('서버 응답 형식이 API 계약과 달라요. 다시 로그인해 주세요.');
        return 'invalid';
      }
      this.access = t.data.accessToken;
      this.refreshToken = t.data.refreshToken;
      await this.persist(t.data.refreshToken);
      return 'ok';
    }
    if (r.status === 401 || r.status === 403) {
      await this.sessionLost('로그인이 만료됐어요. 다시 로그인해 주세요.');
      return 'invalid';
    }
    throw this.replyError(r, '로그인 상태를 갱신하지 못했어요.');
  }

  private async loadMe(): Promise<void> {
    const base = this.requireServer();
    if (!this.access && (await this.refresh()) !== 'ok') return;
    let r = await this.call(base, 'GET', '/me', undefined, this.access ?? undefined);
    if (r.status === 401) {
      if ((await this.refresh()) !== 'ok') return;
      r = await this.call(base, 'GET', '/me', undefined, this.access ?? undefined);
    }
    if (r.status !== 200) throw this.replyError(r, '내 정보를 받지 못했어요.');
    const m = MeSchema.safeParse(r.data);
    if (!m.success) throw new AuthError('invalid_response', '서버 응답 형식이 API 계약(§1.2)과 달라요.');
    this.meValue = { ...this.toUser(m.data), workspaces: m.data.workspaces };
    if (this.statusValue !== 'pending') this.setStatus('authenticated');
  }

  private toUser(u: { id: string; displayName: string; avatarUrl: string | null }): Omit<Me, 'workspaces'> {
    return { id: u.id, displayName: u.displayName.trim() || 'GitHub 사용자', avatarUrl: safeAvatarUrl(u.avatarUrl) };
  }

  private async sessionLost(message: string): Promise<void> {
    const wasIn = this.statusValue === 'authenticated';
    await this.clearLocal();
    if (!this.quiet && (wasIn || this.statusValue !== 'pending')) this.setStatus('expired', message);
  }

  private async clearLocal(): Promise<void> {
    this.access = null;
    this.refreshToken = null;
    this.meValue = null;
    await this.persist(null);
  }

  private async persist(token: string | null): Promise<void> {
    try {
      await this.deps.saveRefreshToken(token);
    } catch {
      /* 암호화를 쓸 수 없으면 저장하지 않는다. 로그인은 앱이 켜져 있는 동안만 유지된다. */
    }
  }

  private setStatus(s: AuthStatus, message?: string): void {
    if (s === this.statusValue && !message) return;
    this.statusValue = s;
    if (!this.disposed) this.deps.onStatus(s, message);
  }

  get serverState(): ServerState {
    return this.deps.serverUrl ? 'configured' : (this.deps.serverState ?? 'invalid');
  }

  private requireServer(): string {
    if (this.deps.serverUrl) return this.deps.serverUrl;
    if (this.serverState === 'not_configured') {
      throw new AuthError('server_not_configured', '팀 서버가 아직 준비되지 않아 로그인할 수 없어요. 서버가 생기면 이 버전에서도 로그인을 켤 수 있어요.');
    }
    throw new AuthError('config', 'CADORA_SERVER_URL이 올바르지 않아요. https 주소나 이 PC(localhost)의 http 주소만 쓸 수 있어요.');
  }

  private replyError(r: Reply, fallback: string): AuthError {
    const e = errorOf(r.data);
    return new AuthError(e.code ?? `http_${r.status}`, e.message ? `${fallback} (${e.message})` : `${fallback} (HTTP ${r.status})`);
  }

  private async call(base: string, method: 'GET' | 'POST', path: string, body?: unknown, bearer?: string): Promise<Reply> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (bearer) headers['authorization'] = `Bearer ${bearer}`;
    let res: Response;
    try {
      res = await this.f(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? 10_000),
      });
    } catch (err) {
      const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
      if (typeof code === 'string' && NOT_SENT.has(code)) {
        throw new AuthError('server_unreachable', `Cadora 서버(${new URL(base).host})에 연결할 수 없어요. 서버가 켜져 있는지 확인해 주세요.`);
      }
      throw new AuthError('network', 'Cadora 서버와 통신하지 못했어요.');
    }
    const text = await res.text().catch(() => '');
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { status: res.status, data };
  }
}
