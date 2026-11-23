/* Cadora 프로토타입 — 시뮬레이션 코어 (DOM 없음)
 *
 * 실제 앱이라면 Electron 메인 프로세스(파일·Git 감시, Claude Code Hooks 수신)와
 * 팀 동기화 서버(규칙 기반 경고)가 나눠 맡을 로직을 한 파일에 모았다.
 *   - classify()        FR-12  변경 파일 자동 분류 · 감시 제외 · 민감 파일 제외
 *   - makeEvent()       FR-13  로컬 원본 이벤트 → 팀 서버용 최소 메타데이터로 정제 (FR-18)
 *   - maskSecrets()     FR-19  UI·로그에서 비밀값 마스킹
 *   - computeAlerts()   FR-15  DB 스키마 · 의존성 · 환경 변경 · 비슷한 작업 경고
 *   - teammates()       FR-14  팀원별 작업 요약 (개인 워크스페이스 이름은 숨김)
 */
(function (root) {
  'use strict';

  // ───────────────────────── 사람 · 기기 ─────────────────────────
  const USERS = {
    minsu:   { id: 'minsu',   name: '민수',       role: '팀장',   device: '노트북 A', win: 'minsu' },
    jiyun:   { id: 'jiyun',   name: '지윤',       role: '팀원',   device: '노트북 B', win: 'jiyun' },
    hyunwoo: { id: 'hyunwoo', name: '현우',       role: '팀원',   device: '노트북 C', win: 'hyunwoo' },
    prof:    { id: 'prof',    name: '지도교수님', role: '열람자', device: null,       win: 'prof' },
  };

  // ───────────────────────── FR-12 분류 ─────────────────────────
  const CATEGORY = {
    'db-schema':  { label: 'DB 스키마', shared: true },
    'dependency': { label: '의존성',    shared: true },
    'infra':      { label: '인프라 · 환경', shared: true },
    'test':       { label: '테스트' },
    'api':        { label: 'API' },
    'ui':         { label: 'UI' },
    'docs':       { label: '문서' },
    'code':       { label: '코드' },
  };

  const IGNORED = [/(^|\/)node_modules\//, /^\.git\//, /^(dist|build|out|release|coverage|\.next)\//];
  const SENSITIVE = [
    /(^|\/)\.env$/,
    /(^|\/)\.env\.(?!example$)[^/]+$/,
    /\.(pem|key|p12|pfx)$/,
    /(^|\/)id_(rsa|ed25519)/,
    /(^|\/)secrets?\//,
    /(^|\/)credentials/,
  ];
  const CLASSIFIERS = [
    ['db-schema',  p => /(^|\/)schema\.prisma$/.test(p) || /(^|\/)migrations?\//.test(p) || /\.sql$/.test(p)],
    ['dependency', p => /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|pyproject\.toml)$/.test(p)],
    ['infra',      p => /(^|\/)(docker-compose(\.[\w-]+)?\.ya?ml|compose\.ya?ml|Dockerfile)$/.test(p)
                     || /^(infra|deploy)\//.test(p) || /(^|\/)\.env\.example$/.test(p) || /^\.github\/workflows\//.test(p)],
    ['test',       p => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /^(tests?|__tests__)\//.test(p)],
    ['api',        p => /^src\/(api|auth|routes|server|services|mail)\//.test(p)],
    ['ui',         p => /^src\/(pages|components|app|styles|ui)\//.test(p) || /\.(tsx|jsx|css|scss)$/.test(p)],
    ['docs',       p => /\.(md|mdx)$/.test(p) || /^docs\//.test(p)],
  ];

  function classify(rel) {
    if (rel == null) return { excluded: 'outside', reason: '프로젝트 폴더 밖 — 공유하지 않음' };
    if (IGNORED.some(r => r.test(rel))) return { excluded: 'ignored', reason: '기본 감시 제외 경로 (node_modules · .git · 빌드 결과물)' };
    if (SENSITIVE.some(r => r.test(rel))) return { excluded: 'sensitive', reason: '민감 파일 — 경로·내용 모두 전송하지 않음' };
    for (const [cat, test] of CLASSIFIERS) if (test(rel)) return Object.assign({ cat }, CATEGORY[cat]);
    return Object.assign({ cat: 'code' }, CATEGORY.code);
  }

  /** Windows 절대경로 → 프로젝트 기준 상대경로 (밖이면 null) */
  function toRelative(abs, rootAbs) {
    const a = String(abs).replace(/\\/g, '/');
    const r = String(rootAbs).replace(/\\/g, '/').replace(/\/$/, '');
    if (a.toLowerCase().startsWith(r.toLowerCase() + '/')) return a.slice(r.length + 1);
    return null;
  }

  function dirKey(rel) {
    const parts = rel.split('/');
    if (parts.length >= 3) return parts.slice(0, 2).join('/') + '/';
    if (parts.length === 2) return parts[0] + '/';
    return './';
  }

  // ───────────────────────── 제목 유사도 ─────────────────────────
  const STOPWORDS = new Set(['구현', '작업', '기능', '수정', '추가', '개발', '만들기', '처리', '및', '개선']);

  function titleTokens(title) {
    const words = String(title || '').toLowerCase().split(/[\s·,./\-_()[\]]+/).filter(w => w && !STOPWORDS.has(w));
    const set = new Set();
    for (const w of words) {
      if (/^[a-z0-9]+$/.test(w) || w.length === 1) { set.add(w); continue; }
      for (let i = 0; i < w.length - 1; i++) set.add(w.slice(i, i + 2));
    }
    return set;
  }

  function titleSimilarity(a, b) {
    const A = titleTokens(a), B = titleTokens(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    return inter / (A.size + B.size - inter);
  }

  const SIMILAR_THRESHOLD = 0.25;

  // ───────────────────────── 브랜치 이름 ─────────────────────────
  const BRANCH_DICT = [
    ['비밀번호', 'password'], ['재설정', 'reset'], ['회원가입', 'signup'], ['로그인', 'login'],
    ['인증', 'auth'], ['회원', 'member'], ['폼', 'form'], ['메일', 'mail'], ['결제', 'payment'],
    ['검색', 'search'], ['프로필', 'profile'], ['알림', 'notification'], ['대시보드', 'dashboard'],
    ['게시판', 'board'], ['댓글', 'comment'], ['업로드', 'upload'], ['관리자', 'admin'],
    ['스키마', 'schema'], ['테스트', 'test'], ['배포', 'deploy'], ['문서', 'docs'], ['채팅', 'chat'],
    ['api', 'api'], ['ui', 'ui'],
  ];

  function suggestBranch(title, fallbackN) {
    const t = String(title || '').toLowerCase();
    const hits = [];
    for (const [ko, en] of BRANCH_DICT) {
      let i = t.indexOf(ko);
      while (i !== -1) { hits.push({ i, len: ko.length, en }); i = t.indexOf(ko, i + ko.length); }
    }
    hits.sort((x, y) => x.i - y.i || y.len - x.len);
    const picked = [];
    let end = -1;
    for (const h of hits) {
      if (h.i < end) continue;
      if (!picked.includes(h.en)) picked.push(h.en);
      end = h.i + h.len;
    }
    const slug = picked.slice(0, 2).join('-') || ('task-' + (fallbackN || 1));
    return 'feature/' + slug;
  }

  // ───────────────────────── FR-19 마스킹 ─────────────────────────
  const SECRET_REPLACERS = [
    [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-••••••••'],
    [/\bghp_[A-Za-z0-9]{10,}/g, 'ghp_••••••••'],
    [/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/([^:\s/@]+):([^@\s]+)@/g, '$1://$2:••••••@'],
  ];
  const SECRET_TEST = /\bsk-[A-Za-z0-9_-]{8,}|\bghp_[A-Za-z0-9]{10,}|:\/\/[^:\s/@"]+:[^@\s"]+@/;

  function maskSecrets(text) {
    let s = String(text);
    for (const [re, rep] of SECRET_REPLACERS) s = s.replace(re, rep);
    return s;
  }
  function isSecretName(name) { return /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|DATABASE_URL|PRIVATE)/i.test(name); }
  function maskEnv(name, value) { return isSecretName(name) ? '••••••••' : maskSecrets(value); }

  /** FR-18 전송 전 검사: 금지 항목이 페이로드에 섞였는지 */
  function privacyCheck(payload) {
    const s = JSON.stringify(payload || {});
    return [
      { label: '코드 본문',       ok: !/"(old_string|new_string|content|diff|code|patch)":/.test(s) },
      { label: '프롬프트 원문',   ok: !/"prompt":/.test(s) },
      { label: 'OS 절대경로',     ok: !/[A-Za-z]:(\\\\|\/)|\/Users\/|\/home\//.test(s) },
      { label: '토큰 · 비밀값',   ok: !SECRET_TEST.test(s) },
      { label: '쿠키 · 이메일',   ok: !/cookie/i.test(s) && !/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(s) },
    ];
  }

  // ───────────────────────── 초기 상태 ─────────────────────────
  function createState() {
    const now = Date.now();
    const st = {
      seq: 0,
      runSeq: 0,
      online: true,
      users: USERS,
      shareTitle: { minsu: true, jiyun: true, hyunwoo: true },
      presence: { minsu: 'capstone', jiyun: 'capstone', hyunwoo: 'other' },
      team: {
        id: 'team_capstone',
        wsId: 'capstone',
        name: '캡스톤 팀플',
        repo: 'github.com/team/capstone',
        base: 'main',
        scripts: 'docker compose up · npm run dev',
        sharedTabs: ['노션 기획', '피그마', 'API 문서'],
        version: 12,
        synced: { jiyun: 12, hyunwoo: 12, prof: 12 },
        materials: '기획서 · 발표 자료 · 회의록 폴더 동기화',
        aiRules: '코딩 컨벤션 · 프로젝트 설명 — 팀원의 AI가 모두 같은 규칙으로 작업해요',
        members: [
          { id: 'minsu',   role: '팀장',   note: '' },
          { id: 'jiyun',   role: '팀원',   note: '준비 완료' },
          { id: 'hyunwoo', role: '팀원',   note: '로그인 1개 남음', warn: true },
          { id: 'prof',    role: '열람자', note: '자료 · 배포 링크만' },
        ],
        invites: [],
        secrets: [{ name: 'OPENAI_API_KEY' }, { name: 'DATABASE_URL' }],
        services: [
          { name: 'GitHub', done: 3, total: 3 },
          { name: '노션',   done: 3, total: 3 },
          { name: '피그마', done: 2, total: 3, wait: '현우 대기' },
        ],
        changes: [
          { title: 'OPENAI_API_KEY 교체', sub: '팀원 서버 자동 재시작 · 어제' },
          { title: '실행 스크립트에 docker compose 추가', sub: '팀원 PC에서 자동 설치 · 3일 전' },
        ],
        discord: '#캡스톤-팀플',
        discordUnread: 5,
      },
      privateTabs: { minsu: ['내 메모'], jiyun: ['개인 Notion 메모', 'ChatGPT'], hyunwoo: [] },
      servers: { minsu: 'running', jiyun: 'running', hyunwoo: 'running' },
      agents: [],
      events: [],
      alertState: {},   // `${viewer}|${key}` → 'dismissed' | 'notified' | 'handled'
      alertFeedback: {},
      agentNotes: {},   // runId → [{ text, at }]
    };

    // 시드: 민수가 이미 Codex로 폼 UI 작업 중 (와이어프레임 06)
    const codex = launchAgent(st, 'minsu', {
      tool: 'Codex', title: '회원가입 폼 UI', branch: 'feature/signup-ui',
      at: new Date(now - 18 * 60e3), silentPrompt: true,
    });
    emitFile(st, { user: 'minsu', runId: codex.id, kind: 'watch', path: 'src/pages/signup.tsx', changeType: 'added', at: new Date(now - 12 * 60e3) });
    emitFile(st, { user: 'minsu', runId: codex.id, kind: 'watch', path: 'src/components/SignupForm.tsx', changeType: 'added', at: new Date(now - 9 * 60e3) });
    codex.status = 'waiting';
    codex.last = '터미널에서 권한 승인 대기';
    st.events.forEach(e => { e.seed = true; });
    return st;
  }

  // ───────────────────────── 이벤트 생성 · 정제 ─────────────────────────
  const iso = d => {
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}+09:00`;
  };
  const toolId = t => (t === 'Claude Code' ? 'claude-code' : t === 'Codex' ? 'codex' : String(t).toLowerCase());
  const projectRoot = user => `C:\\Users\\${USERS[user].win}\\projects\\capstone`;
  const sessionId = run => (run ? 'a1f0' + run.id.replace(/\D/g, '').padStart(4, '0') + '-7c2e-4b19-9d3a-1e5f' : null);

  const SAMPLE_CODE = {
    'prisma/schema.prisma': {
      old: 'model User {\n  id        Int      @id @default(autoincrement())\n  email     String   @unique\n  password  String\n}',
      neu: 'model User {\n  id        Int      @id @default(autoincrement())\n  email     String   @unique\n  password  String\n  phone     String?  @unique\n  verifiedAt DateTime?\n}',
    },
    'src/auth/signup.ts': {
      old: 'export async function signup(req: Request) {\n  // TODO\n}',
      neu: 'export async function signup(req: Request) {\n  const { email, password, phone } = await req.json();\n  const hash = await bcrypt.hash(password, 12);\n  return db.user.create({ data: { email, password: hash, phone } });\n}',
    },
    'src/auth/login.ts': {
      old: 'export async function login(req: Request) {\n  // TODO\n}',
      neu: 'export async function login(req: Request) {\n  const { email, password } = await req.json();\n  const user = await db.user.findUnique({ where: { email } });\n  if (!user || !(await bcrypt.compare(password, user.password))) throw unauthorized();\n  return issueSession(user.id);\n}',
    },
    'docker-compose.yml': {
      diff: '@@ services:\n+  redis:\n+    image: redis:7-alpine\n+    ports: ["6379:6379"]\n   api:\n     environment:\n-      OPENAI_API_KEY: sk-proj-old0000000000\n+      OPENAI_API_KEY: sk-proj-4fT9qL2mXv8RkZ0aB7cD\n+      REDIS_URL: redis://default:r3disPass@redis:6379',
    },
  };

  function launchAgent(st, user, { tool, title, branch, at, prompt, silentPrompt }) {
    const run = {
      id: 'run_' + String(++st.runSeq).padStart(2, '0'),
      user, tool, title, branch,
      ws: 'capstone',
      status: 'running',
      observe: tool === 'Claude Code' ? 'hooks' : 'process',
      startedAt: at || new Date(),
      last: '세션 시작',
      lastAt: at || new Date(),
    };
    st.agents.push(run);
    pushEvent(st, buildSessionEvent(st, run, at));
    if (!silentPrompt) pushEvent(st, buildPromptEvent(st, run, prompt || `${title} 해줘. 팀 AI 규칙(CLAUDE.md) 지켜서.`));
    return run;
  }

  function base(st, user, at) {
    return { team: st.team.id, workspace: 'ws_capstone', user: 'u_' + user, at: iso(at) };
  }

  function buildSessionEvent(st, run, at) {
    at = at || new Date();
    const titleShared = st.shareTitle[run.user];
    const isHook = run.tool === 'Claude Code';
    const raw = isHook
      ? {
          hook_event_name: 'SessionStart',
          session_id: sessionId(run),
          transcript_path: `C:\\Users\\${USERS[run.user].win}\\.claude\\projects\\C--Users-${USERS[run.user].win}-projects-capstone\\${sessionId(run)}.jsonl`,
          cwd: projectRoot(run.user),
          source: 'startup',
          _cadora_launch: { taskTitle: run.title, branch: run.branch, tool: run.tool },
        }
      : {
          process: 'codex.exe',
          pid: 18000 + st.runSeq * 37,
          cwd: projectRoot(run.user),
          argv: ['codex', '--cd', projectRoot(run.user)],
          _cadora_launch: { taskTitle: run.title, branch: run.branch, tool: run.tool },
        };
    return {
      user: run.user, at, runId: run.id,
      source: isHook ? 'Hook · SessionStart' : '프로세스 감시',
      raw,
      payload: Object.assign(base(st, run.user, at), {
        type: 'agent_run', agentRunId: run.id, tool: toolId(run.tool),
        taskTitle: titleShared ? run.title : null, branch: run.branch, status: 'running',
        observe: run.observe,
      }),
      removed: isHook
        ? ['session_id', 'transcript_path (OS 절대경로)', 'cwd (OS 절대경로)']
        : ['pid · argv', 'cwd (OS 절대경로)'],
      summary: `에이전트 시작 · ${run.tool}`,
    };
  }

  function buildPromptEvent(st, run, prompt) {
    const at = new Date();
    return {
      user: run.user, at, runId: run.id,
      source: 'Hook · UserPromptSubmit',
      raw: {
        hook_event_name: 'UserPromptSubmit',
        session_id: sessionId(run),
        transcript_path: `C:\\Users\\${USERS[run.user].win}\\.claude\\projects\\…\\${sessionId(run)}.jsonl`,
        cwd: projectRoot(run.user),
        prompt,
      },
      payload: Object.assign(base(st, run.user, at), {
        type: 'agent_activity', agentRunId: run.id, status: 'running', activity: 'user_input',
      }),
      removed: ['prompt (프롬프트 원문)', 'session_id', 'transcript_path · cwd (OS 절대경로)'],
      summary: '프롬프트 입력 (원문 비전송)',
    };
  }

  /**
   * 파일 변경 이벤트. kind: 'hook'(Claude Code PostToolUse) | 'watch'(chokidar) | 'git'(simple-git, main 반영)
   */
  function emitFile(st, { user, runId, kind, path, changeType, at, branch }) {
    at = at || new Date();
    const run = runId ? st.agents.find(a => a.id === runId) : null;
    // hooks는 Claude Code에서만 — 그 외에는 파일 감시로 대체 (FR-13 한계)
    if (kind === 'hook' && (!run || run.tool !== 'Claude Code')) kind = 'watch';
    changeType = changeType || 'modified';
    const rootAbs = projectRoot(user);
    const abs = path.startsWith('..') ? `C:\\Users\\${USERS[user].win}\\Downloads\\${path.replace(/^\.\.\//, '')}` : rootAbs + '\\' + path.replace(/\//g, '\\');
    const rel = toRelative(abs, rootAbs);
    const cls = classify(rel);
    const br = branch || (kind === 'git' ? 'main' : run ? run.branch : 'main');
    const code = SAMPLE_CODE[path] || {};

    let raw, source, removed;
    if (kind === 'hook') {
      source = 'Hook · PostToolUse(Edit)';
      raw = {
        hook_event_name: 'PostToolUse',
        session_id: sessionId(run),
        transcript_path: `C:\\Users\\${USERS[user].win}\\.claude\\projects\\…\\${sessionId(run)}.jsonl`,
        cwd: rootAbs,
        tool_name: changeType === 'added' ? 'Write' : 'Edit',
        tool_input: changeType === 'added'
          ? { file_path: abs, content: code.neu || '// …' }
          : { file_path: abs, old_string: code.old || '// …', new_string: code.neu || '// …' },
        tool_response: { filePath: abs, success: true },
      };
      removed = ['tool_input의 코드 본문 (old_string · new_string · content)', 'tool_response (도구 응답 전문)',
                 'file_path → 상대경로로 변환', 'session_id · transcript_path · cwd (OS 절대경로)'];
    } else if (kind === 'git') {
      source = 'Git 감시 · main 반영';
      raw = {
        source: 'simple-git',
        ref: 'origin/main',
        commit: 'a91f3c2',
        author: `${USERS[user].name} <${USERS[user].win}.dev@gmail.com>`,
        message: 'chore: redis 서비스 추가, API 키 교체',
        files: [{ path: rel, status: 'M' }],
        diff: code.diff || '…',
      };
      removed = ['diff (코드 본문 · 비밀값 포함 가능)', 'author 이메일 (개인정보)', 'commit message'];
    } else {
      source = '파일 감시 (chokidar)';
      raw = {
        watcher: 'chokidar',
        event: changeType === 'added' ? 'add' : changeType === 'deleted' ? 'unlink' : 'change',
        path: abs,
        stats: { size: 1840, mtimeMs: at.getTime() },
        git: { branch: br, dirty: true },
      };
      removed = ['path → 상대경로로 변환 (OS 절대경로 제거)', 'stats (파일 크기 · 시각)'];
    }

    const ev = {
      user, at, runId: run ? run.id : null, source, raw, removed,
      relPath: rel, category: cls.cat || null, excluded: cls.excluded || null, excludedReason: cls.reason || null,
      payload: null,
      summary: rel ? `${rel}` : path,
    };
    if (!cls.excluded) {
      ev.payload = Object.assign(base(st, user, at), {
        type: 'file_change',
        agentRunId: run ? run.id : null,
        tool: run ? toolId(run.tool) : null,
        taskTitle: run && st.shareTitle[user] ? run.title : null,
        branch: br,
        relativePath: rel,
        changeType,
        category: cls.cat,
        source: kind === 'hook' ? 'hook:PostToolUse' : kind === 'git' ? 'git' : 'watcher',
      });
    }
    if (run) { run.last = `${rel || path} ${changeType === 'added' ? '추가' : '수정'}`; run.lastAt = at; }
    return pushEvent(st, ev);
  }

  function pushEvent(st, ev) {
    ev.id = 'evt_' + String(++st.seq).padStart(3, '0');
    ev.device = USERS[ev.user].device;
    ev.delivered = !!ev.payload && st.online;
    ev.queued = !!ev.payload && !st.online;
    st.events.push(ev);
    return ev;
  }

  function flushQueue(st) {
    let n = 0;
    for (const e of st.events) if (e.queued) { e.queued = false; e.delivered = true; n++; }
    return n;
  }

  // ───────────────────────── 팀 공유 층 (FR-08) ─────────────────────────
  function addSharedTab(st, name) {
    name = String(name || '').trim();
    if (!name || st.team.sharedTabs.includes(name)) return null;
    st.team.sharedTabs.push(name);
    st.team.version += 1;
    st.team.changes.unshift({ title: `고정 탭 '${name}' 추가`, sub: '팀원 3명에게 반영됨 · 방금', fresh: true });
    if (st.online) for (const k of Object.keys(st.team.synced)) st.team.synced[k] = st.team.version;
    return st.team.version;
  }

  /** 기기 viewer가 보는 팀 워크스페이스 탭: 공유 층(동기화된 버전까지) + 개인 층 */
  function tabsFor(st, viewer) {
    const v = viewer === 'minsu' ? st.team.version : (st.team.synced[viewer] || st.team.version);
    const shared = st.team.sharedTabs.slice(0, st.team.sharedTabs.length - (st.team.version - v));
    return { shared, private: st.privateTabs[viewer] || [], version: v };
  }

  // ───────────────────────── 가시성 ─────────────────────────
  /** viewer 기기가 알고 있는 이벤트 = 내 것 전부 + 남의 것 중 서버를 통해 전달된 것 */
  function visibleEvents(st, viewer) {
    return st.events.filter(e => e.payload && (e.user === viewer || e.delivered));
  }
  function knownRuns(st, viewer) {
    const vis = visibleEvents(st, viewer);
    return st.agents.filter(a => a.user === viewer || vis.some(e => e.runId === a.id && e.payload.type === 'agent_run'));
  }
  const isActive = a => a.status === 'running' || a.status === 'waiting';

  // ───────────────────────── FR-15 경고 ─────────────────────────
  const SEVERITY = { high: 0, medium: 1, info: 2 };
  const h = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function computeAlerts(st, viewer, { includeHidden } = {}) {
    const vis = visibleEvents(st, viewer);
    const others = vis.filter(e => e.user !== viewer && e.payload.type === 'file_change');
    const myRuns = st.agents.filter(a => a.user === viewer && isActive(a));
    const map = new Map();
    const put = (key, a) => {
      const prev = map.get(key);
      if (prev) { prev.evidence.push(...a.evidence); return; }
      map.set(key, Object.assign({ key }, a));
    };

    for (const e of others) {
      const p = e.payload;
      const who = USERS[e.user].name;
      if (p.category === 'db-schema' && p.branch !== st.team.base && myRuns.length) {
        put(`db|${e.user}|${p.relativePath}`, {
          type: 'db', severity: 'high', title: 'DB 스키마 충돌 가능', from: e.user, file: p.relativePath, branch: p.branch,
          body: `${who} 님 에이전트가 <code>${h(p.relativePath)}</code>을(를) 바꿨어요. 아직 ${h(st.team.base)}에 반영 전이고, 내 에이전트는 이전 스키마로 작업 중이에요.`,
          rule: '공유 자원(DB 스키마) 파일이 다른 팀원 브랜치에서 변경됨 + 내 에이전트 실행 중',
          evidence: [e.id], actions: ['notify', 'evidence', 'dismiss'],
        });
      }
      if (p.category === 'dependency' && p.branch !== st.team.base && myRuns.length) {
        put(`dep|${e.user}|${p.relativePath}`, {
          type: 'dep', severity: 'medium', title: '의존성 변경', from: e.user, file: p.relativePath, branch: p.branch,
          body: `${who} 님 브랜치 <code>${h(p.branch)}</code>에서 <code>${h(p.relativePath)}</code>이(가) 바뀌었어요. 머지 후 다시 설치해야 할 수 있어요.`,
          rule: '의존성 설정 파일이 다른 팀원 브랜치에서 변경됨',
          evidence: [e.id], actions: ['notify', 'evidence', 'dismiss'],
        });
      }
      if (p.category === 'infra') {
        const onMain = p.branch === st.team.base;
        put(`env|${p.relativePath}|${p.branch}`, {
          type: 'env', severity: 'info', title: '환경 변경', from: e.user, file: p.relativePath, branch: p.branch,
          body: onMain
            ? `${who} 님이 바꾼 <code>${h(p.relativePath)}</code>이(가) ${h(p.branch)}에 반영됐어요.`
            : `${who} 님이 <code>${h(p.branch)}</code>에서 <code>${h(p.relativePath)}</code>을(를) 바꾸는 중이에요.`,
          rule: onMain ? '인프라 파일이 기준 브랜치에 반영됨 → 로컬 서버 재시작 확인' : '인프라 파일이 다른 브랜치에서 변경 중',
          evidence: [e.id], actions: onMain ? ['restart', 'evidence', 'dismiss'] : ['evidence', 'dismiss'],
        });
      }
    }

    // 비슷한 작업: 제목 유사도 또는 같은 폴더(코드 분류) 수정
    const otherRuns = knownRuns(st, viewer).filter(a => a.user !== viewer && isActive(a));
    for (const mine of myRuns) {
      const myDirs = new Set(vis.filter(e => e.runId === mine.id && e.payload.type === 'file_change' && !CATEGORY[e.payload.category].shared)
        .map(e => dirKey(e.payload.relativePath)));
      for (const o of otherRuns) {
        const oEvents = vis.filter(e => e.runId === o.id && e.payload.type === 'file_change');
        const oDirs = new Set(oEvents.filter(e => !CATEGORY[e.payload.category].shared).map(e => dirKey(e.payload.relativePath)));
        const overlap = [...myDirs].filter(d => oDirs.has(d));
        const titlesShared = st.shareTitle[viewer] && st.shareTitle[o.user];
        const sim = titlesShared ? titleSimilarity(mine.title, o.title) : 0;
        if (sim < SIMILAR_THRESHOLD && !overlap.length) continue;
        const who = USERS[o.user].name;
        const oTitle = titlesShared ? `"${h(o.title)}"` : '비공개 작업';
        const reasons = [];
        if (sim >= SIMILAR_THRESHOLD) reasons.push(`작업 제목 유사도 ${Math.round(sim * 100)}%`);
        if (overlap.length) reasons.push(`같은 폴더 수정: ${overlap.join(', ')}`);
        const evIds = vis.filter(e => (e.runId === mine.id || e.runId === o.id) &&
          (e.payload.type === 'agent_run' || (e.payload.type === 'file_change' && overlap.includes(dirKey(e.payload.relativePath))))).map(e => e.id);
        put(`sim|${mine.id}|${o.id}`, {
          type: 'sim', severity: 'medium', title: '비슷한 작업', from: o.user, myRun: mine.id, otherRun: o.id,
          body: overlap.length
            ? `내 "${h(mine.title)}"과(와) ${who} 님의 ${oTitle}이(가) 같은 폴더 <code>${h(overlap[0])}</code>를 수정하고 있어요.`
            : `내 "${h(mine.title)}"과(와) ${who} 님의 ${oTitle}이(가) 비슷해 보여요.`,
          rule: reasons.join(' · '),
          evidence: evIds, actions: ['peek', 'dismiss'],
        });
      }
    }

    const all = [...map.values()].map(a => Object.assign(a, { status: st.alertState[viewer + '|' + a.key] || 'new' }));
    const shown = includeHidden ? all : all.filter(a => a.status !== 'dismissed');
    return shown.sort((x, y) => SEVERITY[x.severity] - SEVERITY[y.severity]);
  }

  /** 내가 만든 변경 때문에 다른 팀원 화면에 뜬 경고 (작성자 쪽 확인용) */
  function alertsCausedBy(st, author, evId) {
    const out = [];
    for (const u of ['minsu', 'jiyun', 'hyunwoo']) {
      if (u === author) continue;
      for (const a of computeAlerts(st, u, { includeHidden: true })) if (a.evidence.includes(evId) && a.type !== 'sim') out.push({ user: u, alert: a });
    }
    return out;
  }

  // ───────────────────────── FR-14 팀원별 작업 ─────────────────────────
  function teammates(st, viewer) {
    const vis = visibleEvents(st, viewer);
    const runs = knownRuns(st, viewer);
    const order = ['minsu', 'jiyun', 'hyunwoo'].filter(u => u !== viewer).concat([viewer]);
    return order.map(u => {
      const mine = runs.filter(a => a.user === u && isActive(a));
      const evs = vis.filter(e => e.user === u && e.payload.type === 'file_change');
      const areas = [];
      for (const e of evs.slice().reverse()) {
        const p = e.payload;
        const tag = CATEGORY[p.category].shared ? CATEGORY[p.category].label : dirKey(p.relativePath);
        if (!areas.includes(tag)) areas.push(tag);
      }
      const titles = mine.map(a => (st.shareTitle[u] || u === viewer ? a.title : '비공개 작업'));
      const lastMain = evs.filter(e => e.payload.branch === st.team.base).pop();
      let state = 'idle';
      if (mine.length) state = 'agent';
      else if (st.presence[u] === 'other') state = 'other';
      return {
        user: u, me: u === viewer, state, runs: mine, titles,
        branches: [...new Set(mine.map(a => a.branch))],
        areas: areas.slice(0, 3),
        recentMain: lastMain ? `${lastMain.payload.relativePath} ${st.team.base} 반영` : null,
      };
    });
  }

  function myChanges(st, viewer) {
    const seen = new Map();
    for (const e of st.events) {
      if (e.user !== viewer || !e.payload || e.payload.type !== 'file_change') continue;
      seen.set(e.payload.relativePath, e);
    }
    return [...seen.values()].reverse();
  }

  function eventById(st, id) { return st.events.find(e => e.id === id); }

  const api = {
    USERS, CATEGORY, classify, toRelative, dirKey, titleSimilarity, SIMILAR_THRESHOLD, suggestBranch,
    maskSecrets, maskEnv, isSecretName, privacyCheck,
    createState, launchAgent, emitFile, pushEvent, flushQueue, addSharedTab, tabsFor,
    visibleEvents, knownRuns, isActive, computeAlerts, alertsCausedBy, teammates, myChanges, eventById, iso,
  };
  root.Cadora = root.Cadora || {};
  root.Cadora.sim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
