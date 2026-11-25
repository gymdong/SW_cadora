/**
 * Claude Code hook 설정 합치기(API.md §4.1). Electron 없이 테스트할 수 있게 따로 둔다.
 * 기존 settings.local.json의 다른 설정·다른 hook은 그대로 두고, Cadora relay 항목만 넣거나 바꾼다.
 */
export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'] as const;

/** 기존 settings.local.json에 Cadora hook을 합친다. JSON이 깨져 있거나 객체가 아니면 손대지 않고 null을 돌려준다. */
export function mergeHookSettings(existing: string | null, command: string): string | null {
  let json: Record<string, unknown> = {};
  if (existing !== null && existing.trim()) {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      json = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const hooks = (json['hooks'] && typeof json['hooks'] === 'object' ? json['hooks'] : {}) as Record<string, unknown>;
  for (const ev of HOOK_EVENTS) {
    const list = Array.isArray(hooks[ev]) ? (hooks[ev] as Array<Record<string, unknown>>) : [];
    const kept = list.filter((g) => !JSON.stringify(g).includes('hook-relay.cjs'));
    const group: Record<string, unknown> = { hooks: [{ type: 'command', command }] };
    if (ev === 'PostToolUse') group['matcher'] = 'Edit|Write|MultiEdit';
    hooks[ev] = [...kept, group];
  }
  json['hooks'] = hooks;
  return JSON.stringify(json, null, 2) + '\n';
}

