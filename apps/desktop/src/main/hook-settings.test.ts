import { describe, expect, it } from 'vitest';
import { HOOK_EVENTS, mergeHookSettings } from './hook-settings';

const CMD = 'node "C:/Program Files/Cadora/resources/hook-relay.cjs"';

describe('mergeHookSettings', () => {
  it('파일이 없으면 Cadora hook만 넣는다', () => {
    const out = JSON.parse(mergeHookSettings(null, CMD)!);
    for (const ev of HOOK_EVENTS) expect(out.hooks[ev]).toHaveLength(1);
    expect(out.hooks.PostToolUse[0].matcher).toBe('Edit|Write|MultiEdit');
  });
  it('사용자의 다른 설정과 hook은 보존하고, 예전 Cadora 항목은 바꾼다', () => {
    const existing = JSON.stringify({
      permissions: { allow: ['Bash(npm test)'] },
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'echo mine' }] },
          { hooks: [{ type: 'command', command: 'node "C:/old/hook-relay.cjs"' }] },
        ],
      },
    });
    const out = JSON.parse(mergeHookSettings(existing, CMD)!);
    expect(out.permissions).toEqual({ allow: ['Bash(npm test)'] });
    expect(out.hooks.Stop).toHaveLength(2);
    expect(JSON.stringify(out.hooks.Stop)).toContain('echo mine');
    expect(JSON.stringify(out.hooks.Stop)).not.toContain('C:/old');
  });
  it('깨진 JSON이나 배열이면 덮어쓰지 않는다', () => {
    expect(mergeHookSettings('{oops', CMD)).toBeNull();
    expect(mergeHookSettings('[]', CMD)).toBeNull();
  });
  it('여러 번 합쳐도 결과가 같다', () => {
    const once = mergeHookSettings(null, CMD)!;
    expect(mergeHookSettings(once, CMD)).toBe(once);
  });
});
