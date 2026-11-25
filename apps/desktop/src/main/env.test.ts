import { describe, expect, it } from 'vitest';
import { baseEnv, withWorkspaceEnv } from './env';

describe('자식 프로세스 환경변수', () => {
  it('허용 목록만 넘긴다(앱 쪽 비밀값·Electron·Node 옵션은 넘기지 않는다)', () => {
    const env = baseEnv({
      PATH: 'C:\\Windows',
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\u',
      OPENAI_API_KEY: 'sk-proj-leak',
      GITHUB_TOKEN: 'ghp_leak',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--require evil.js',
      npm_config_token: 'leak',
    });
    expect(env['PATH']).toBe('C:\\Windows');
    expect(env['USERPROFILE']).toBe('C:\\Users\\u');
    for (const k of ['OPENAI_API_KEY', 'GITHUB_TOKEN', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'npm_config_token']) expect(env).not.toHaveProperty(k);
  });
  it('워크스페이스 값은 더하되 PATH 같은 시스템 값은 덮어쓰지 않는다', () => {
    const env = withWorkspaceEnv({ PATH: 'C:\\Windows' }, { OPENAI_API_KEY: 'sk-x', PATH: 'C:\\evil' });
    expect(env['OPENAI_API_KEY']).toBe('sk-x');
    expect(env['PATH']).toBe('C:\\Windows');
  });
});
