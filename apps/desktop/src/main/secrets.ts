/**
 * 워크스페이스 환경변수 값(API 키 등) 보관(FR-10, FR-19).
 * - 값은 Electron safeStorage로 암호화해 저장한다(Windows는 DPAPI — 이 사용자 계정에서만 풀린다).
 * - 화면(renderer)에는 이름과 가린 값만 보내고, 값은 이 워크스페이스의 터미널·에이전트 환경변수로만 넘긴다.
 * - 암호화를 쓸 수 없는 환경(예: Linux에 키링이 없음)에서는 값을 저장하지 않는다. 평문 저장으로 물러서지 않는다.
 */
import { safeStorage } from 'electron';

export async function secretStoreAvailable(): Promise<boolean> {
  try {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
    // Linux에서 키링이 없으면 basic_text(고정 키, 사실상 평문)로 물러선다 → 안전하지 않으므로 쓰지 않는다.
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
    return true;
  } catch {
    return false;
  }
}

export async function encryptSecret(value: string): Promise<string> {
  if (!(await secretStoreAvailable())) throw new Error('이 PC에서는 비밀값 암호화(safeStorage)를 쓸 수 없어 저장하지 않았어요.');
  return (await safeStorage.encryptStringAsync(value)).toString('base64');
}

export async function decryptSecret(encoded: string): Promise<string | null> {
  try {
    return (await safeStorage.decryptStringAsync(Buffer.from(encoded, 'base64'))).result;
  } catch {
    return null;
  }
}
