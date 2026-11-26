/**
 * Cadora 로그인 refresh token 보관(API.md §6.3: 로컬 refresh token은 safeStorage로 보호한다).
 * userData/auth.json에 암호문만 둔다. 암호화를 쓸 수 없는 환경이면 저장하지 않고(예전 파일도 지운다) 오류를 낸다.
 */
import { rmSync } from 'node:fs';
import { decryptSecret, encryptSecret } from './secrets';
import { readJson, writeJsonAtomic } from './store';

export function authStore(file: string): { load(): Promise<string | null>; save(token: string | null): Promise<void> } {
  return {
    async load() {
      const v = readJson<{ v?: number; refresh?: unknown }>(file, {});
      return typeof v.refresh === 'string' && v.refresh ? decryptSecret(v.refresh) : null;
    },
    async save(token) {
      if (token === null) {
        rmSync(file, { force: true });
        return;
      }
      let enc: string;
      try {
        enc = await encryptSecret(token);
      } catch (err) {
        rmSync(file, { force: true });
        throw err;
      }
      writeJsonAtomic(file, { v: 1, refresh: enc });
    },
  };
}
