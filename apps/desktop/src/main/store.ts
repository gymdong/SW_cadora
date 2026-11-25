/**
 * 로컬 JSON 저장소(ARCHITECTURE §3: Windows 네이티브 빌드를 피해 JSON 파일을 쓴다).
 * 쓰기는 임시 파일에 쓴 뒤 이름을 바꿔서, 쓰는 중에 앱이 꺼져도 기존 파일이 깨지지 않게 한다.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
}
