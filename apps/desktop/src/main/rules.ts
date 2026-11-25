/**
 * 파일 변경 분류·감시 제외·민감 파일 규칙(FR-12, FR-19).
 * 프로토타입 sim.js의 classify·toRelative와 같은 규칙이다. 정식 구현은 packages/core(#22)로 옮긴다.
 * Electron·Node API 없이 판단만 하는 순수 함수라 단위 테스트로 검증한다.
 */
import type { FileCategory } from '../shared/bridge';

export const CATEGORY: Record<FileCategory, { label: string; shared: boolean }> = {
  'db-schema': { label: 'DB 스키마', shared: true },
  dependency: { label: '의존성', shared: true },
  infra: { label: '인프라 · 환경', shared: true },
  test: { label: '테스트', shared: false },
  api: { label: 'API', shared: false },
  ui: { label: 'UI', shared: false },
  docs: { label: '문서', shared: false },
  code: { label: '코드', shared: false },
};

/** 감시에서 빼는 폴더(@parcel/watcher의 ignore에도 그대로 넘긴다). */
export const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', 'release', 'coverage', '.next'];

const IGNORED = [/(^|\/)node_modules\//, /^\.git\//, /^(dist|build|out|release|coverage|\.next)\//];
const SENSITIVE = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[^/]+$/,
  /\.(pem|key|p12|pfx)$/,
  /(^|\/)id_(rsa|ed25519)/,
  /(^|\/)secrets?\//,
  /(^|\/)credentials/,
];
const CLASSIFIERS: Array<[FileCategory, (p: string) => boolean]> = [
  ['db-schema', (p) => /(^|\/)schema\.prisma$/.test(p) || /(^|\/)migrations?\//.test(p) || /\.sql$/.test(p)],
  ['dependency', (p) => /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|pyproject\.toml)$/.test(p)],
  [
    'infra',
    (p) =>
      /(^|\/)(docker-compose(\.[\w-]+)?\.ya?ml|compose\.ya?ml|Dockerfile)$/.test(p) ||
      /^(infra|deploy)\//.test(p) ||
      /(^|\/)\.env\.example$/.test(p) ||
      /^\.github\/workflows\//.test(p),
  ],
  ['test', (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /^(tests?|__tests__)\//.test(p)],
  ['api', (p) => /^src\/(api|auth|routes|server|services|mail)\//.test(p)],
  ['ui', (p) => /^src\/(pages|components|app|styles|ui)\//.test(p) || /\.(tsx|jsx|css|scss)$/.test(p)],
  ['docs', (p) => /\.(md|mdx)$/.test(p) || /^docs\//.test(p)],
];

export type Classification =
  | { excluded: 'outside' | 'ignored' | 'sensitive'; reason: string }
  | { excluded?: undefined; cat: FileCategory; label: string; shared: boolean };

export function classify(rel: string | null): Classification {
  if (rel == null) return { excluded: 'outside', reason: '프로젝트 폴더 밖 — 공유하지 않음' };
  if (IGNORED.some((r) => r.test(rel))) return { excluded: 'ignored', reason: '기본 감시 제외 경로 (node_modules · .git · 빌드 결과물)' };
  if (SENSITIVE.some((r) => r.test(rel))) return { excluded: 'sensitive', reason: '민감 파일 — 경로·내용 모두 전송하지 않음' };
  for (const [cat, test] of CLASSIFIERS) if (test(rel)) return { cat, ...CATEGORY[cat] };
  return { cat: 'code', ...CATEGORY.code };
}

/**
 * 절대경로 → 워크스페이스 폴더 기준 상대경로(슬래시 구분). 폴더 밖이거나 올바르지 않으면 null.
 * Windows 경로는 대소문자를 구분하지 않고 비교한다. `..`로 빠져나가는 경로도 밖으로 본다.
 */
export function toRelative(abs: string, rootAbs: string): string | null {
  if (typeof abs !== 'string' || typeof rootAbs !== 'string' || !abs || !rootAbs) return null;
  const norm = (p: string) =>
    p
      .replace(/\\/g, '/')
      .split('/')
      .reduce<string[]>((acc, part, i) => {
        if (part === '..') {
          if (acc.length > 1) acc.pop();
          else acc.push('..');
        } else if (part !== '.' && (part !== '' || i === 0)) acc.push(part);
        return acc;
      }, [])
      .join('/');
  const a = norm(abs);
  const r = norm(rootAbs).replace(/\/$/, '');
  if (!r || a.length <= r.length + 1) return null;
  if (a.slice(0, r.length + 1).toLowerCase() !== (r + '/').toLowerCase()) return null;
  const rel = a.slice(r.length + 1);
  return rel.split('/').includes('..') ? null : rel;
}

/** 화면·로그에 보여 줄 때 비밀값을 가린다(FR-19). */
export function isSecretName(name: string): boolean {
  return /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|DATABASE_URL|PRIVATE)/i.test(name);
}

/** 환경변수 값은 이름과 상관없이 모두 가린다(키를 비밀처럼 보이지 않는 이름으로 저장해도 새지 않게). */
export function maskValue(_name: string, value: string): string {
  return value ? '••••••••' : '';
}

/** 환경변수 이름: 문자·숫자·밑줄, 숫자로 시작하지 않는다. */
export function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name);
}
