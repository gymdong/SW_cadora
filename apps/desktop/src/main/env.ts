/**
 * 터미널·에이전트에 넘길 환경변수(보안: API 키 유출 방지).
 * 앱 프로세스의 환경을 통째로 넘기지 않고 허용 목록만 넘긴다. 그래서 개발 도구가 앱에 남긴
 * ELECTRON_*, NODE_OPTIONS, npm_* 같은 값이나 다른 프로그램의 토큰이 자식 프로세스로 새지 않는다.
 * 워크스페이스에 저장한 환경변수(복호화한 값)는 그 워크스페이스의 프로세스에만 더한다.
 */
const ALLOW = [
  'SystemRoot', 'windir', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME', 'USERDOMAIN',
  'HOMEDRIVE', 'HOMEPATH', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)',
  'ProgramW6432', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'PSModulePath', 'SystemDrive', 'COMPUTERNAME',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'LANG', 'LC_ALL', 'TERM', 'SHELL', 'USER', 'LOGNAME',
  'XDG_RUNTIME_DIR', 'DISPLAY', 'WAYLAND_DISPLAY',
];
const ALLOW_LOWER = new Set(ALLOW.map((k) => k.toLowerCase()));

export function baseEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (typeof v === 'string' && ALLOW_LOWER.has(k.toLowerCase())) out[k] = v;
  }
  out['TERM'] = out['TERM'] || 'xterm-256color';
  out['COLORTERM'] = 'truecolor';
  return out;
}

/** 워크스페이스 환경변수를 더한다. 허용 목록의 시스템 값(PATH 등)은 워크스페이스 값으로 덮어쓰지 않는다. */
export function withWorkspaceEnv(base: Record<string, string>, extra: Record<string, string>): Record<string, string> {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (ALLOW_LOWER.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}
