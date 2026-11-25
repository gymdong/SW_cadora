import { describe, expect, it } from 'vitest';
import { classify, isValidEnvName, maskValue, toRelative } from './rules';

describe('toRelative', () => {
  it('Windows 경로를 워크스페이스 기준 상대경로로 바꾼다(대소문자 무시, 한글·공백)', () => {
    expect(toRelative('C:\\Users\\u\\작업 폴더\\src\\a.ts', 'c:\\users\\u\\작업 폴더')).toBe('src/a.ts');
    expect(toRelative('C:/Users/u/proj/prisma/schema.prisma', 'C:\\Users\\u\\proj\\')).toBe('prisma/schema.prisma');
  });
  it('폴더 밖이나 .. 로 빠져나가는 경로는 null', () => {
    expect(toRelative('C:\\Users\\u\\other\\a.ts', 'C:\\Users\\u\\proj')).toBeNull();
    expect(toRelative('C:\\Users\\u\\proj\\..\\other\\a.ts', 'C:\\Users\\u\\proj')).toBeNull();
    expect(toRelative('C:\\Users\\u\\project2\\a.ts', 'C:\\Users\\u\\proj')).toBeNull();
    expect(toRelative('C:\\Users\\u\\proj', 'C:\\Users\\u\\proj')).toBeNull();
    expect(toRelative('', 'C:\\x')).toBeNull();
  });
  it('POSIX 경로도 처리한다', () => {
    expect(toRelative('/home/u/proj/src/x.ts', '/home/u/proj')).toBe('src/x.ts');
  });
});

describe('classify', () => {
  it('공유 영향 파일을 분류한다', () => {
    expect(classify('prisma/schema.prisma')).toMatchObject({ cat: 'db-schema', shared: true });
    expect(classify('package.json')).toMatchObject({ cat: 'dependency', shared: true });
    expect(classify('docker-compose.yml')).toMatchObject({ cat: 'infra', shared: true });
    expect(classify('src/auth/login.ts')).toMatchObject({ cat: 'api' });
    expect(classify('README.md')).toMatchObject({ cat: 'docs' });
  });
  it('감시 제외 경로와 민감 파일은 이벤트를 만들지 않는다', () => {
    expect(classify('node_modules/x/index.js').excluded).toBe('ignored');
    expect(classify('.git/HEAD').excluded).toBe('ignored');
    expect(classify('.env').excluded).toBe('sensitive');
    expect(classify('apps/api/.env.local').excluded).toBe('sensitive');
    expect(classify('certs/dev.pem').excluded).toBe('sensitive');
    expect(classify('.ssh/id_ed25519').excluded).toBe('sensitive');
    expect(classify(null).excluded).toBe('outside');
  });
  it('.env.example은 민감 파일이 아니라 인프라 변경이다', () => {
    expect(classify('.env.example')).toMatchObject({ cat: 'infra' });
  });
});

describe('환경변수 가리기', () => {
  it('비밀값 이름은 값을 전혀 보이지 않는다', () => {
    expect(maskValue('OPENAI_API_KEY', 'sk-proj-abcdefghijklmnop')).toBe('••••••••');
    expect(maskValue('DATABASE_URL', 'postgres://a:b@h/db')).toBe('••••••••');
  });
  it('비밀처럼 보이지 않는 이름이어도 값을 전혀 보이지 않는다', () => {
    expect(maskValue('CLAUDE_AUTH', 'sk-ant-abcdef')).toBe('••••••••');
    expect(maskValue('NODE_ENV', 'development')).toBe('••••••••');
  });
  it('이름 형식을 검사한다', () => {
    expect(isValidEnvName('OPENAI_API_KEY')).toBe(true);
    expect(isValidEnvName('1BAD')).toBe(false);
    expect(isValidEnvName('BAD-NAME')).toBe(false);
    expect(isValidEnvName('A=B')).toBe(false);
  });
});
