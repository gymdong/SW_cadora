/* Cadora 프로토타입 v2.2 — 작업공간 · 팀 그래프 · 활동 · 캘린더 (여러 명 실시간)
 * 시뮬레이션(팀 이벤트 · 경고 규칙 · 정제)은 sim.js. 이 파일은 화면과 공유 기록을 담당한다.
 * 공유 기록: 팀이 함께 바꾸는 것(시연 단계 · 에이전트 · 파일 변경 · 경고 처리 · 팀 과제 · 공유 탭)은
 *   동작(action) 하나하나를 차례로 쌓고, 접속한 모든 화면이 같은 기록을 다시 계산해 같은 상태를 본다.
 *   claude.ai 아티팩트로 열면 db(공유 저장) · room(접속 중인 사람) · user(누구인지)로 실시간 공유,
 *   파일로 열면 이 브라우저 안에서만 동작한다.
 * 개인 층(로그인 세션 · 터미널 · 다운로드 · 개인 탭 · 개인 과제)은 각자 브라우저에만 남는다.
 * 해시: #home · #team · #activity · #cal  (파일로 열 때만: /N = N단계까지 · @jiyun = 자리 · ~14:30 = 시계 고정)
 */
(function () {
  'use strict';
  const S = window.Cadora.sim;
  const U = S.USERS;
  // ── 실제 기능 연결(데모 브랜치): Electron에서 열면 window.CadoraReal이 있다. 브라우저로 열면 null → 원래 프로토타입 그대로.
  const R = window.CadoraReal && window.CadoraReal.available ? window.CadoraReal : null;
  let realSel = null;   // 보고 있는 실제 워크스페이스 id (null이면 시뮬레이션 워크스페이스)
  const REAL_COLORS = ['#0d9488', '#7c3aed', '#2563eb', '#db2777', '#ea580c', '#0891b2', '#65a30d', '#9333ea'];
  const PERSONAS = ['minsu', 'jiyun', 'hyunwoo'];   // 참여할 수 있는 자리
  const VIEWERS = PERSONAS;
  const perP = fn => Object.fromEntries(PERSONAS.map(p => [p, fn(p)]));

  // ───────────────────────── 유틸 ─────────────────────────
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const z = n => String(n).padStart(2, '0');
  let clockShift = 0;
  const now = () => new Date(Date.now() + clockShift);
  const hm = d => `${z(d.getHours())}:${z(d.getMinutes())}`;
  const ampm = d => { const h = d.getHours(); return `${h < 12 ? '오전' : '오후'} ${((h + 11) % 12) + 1}:${z(d.getMinutes())}`; };
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const DAY = 86400000;
  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const relDays = d => Math.round((startOfDay(d) - startOfDay(now())) / DAY);
  const fmtHour = h => `${z(Math.floor(h))}:${z(Math.round((h % 1) * 60))}`;
  const fmtDate = d => `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`;
  const textW = s => [...String(s)].reduce((w, c) => w + (/[가-힣]/.test(c) ? 11.6 : c === ' ' ? 3.6 : 6.8), 0);
  const winPath = (viewer, folder) => `C:\\Users\\${U[viewer].win}\\` + folder.replace(/^~\//, '').replace(/\//g, '\\');

  const ICON = {
    home: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M2.5 7.5h15"/><path d="M5.2 5.5h.01M7.6 5.5h.01"/>',
    activity: '<path d="M2 10.5h3.5l2.2-5.5 4.3 10 2.2-4.5H18"/>',
    cal: '<rect x="2.5" y="4" width="15" height="13.5" rx="2"/><path d="M2.5 8h15M6.5 2.5v3M13.5 2.5v3"/>',
    graph: '<circle cx="4" cy="10" r="2.2"/><circle cx="15.5" cy="4" r="2.2"/><circle cx="15.5" cy="10" r="2.2"/><circle cx="15.5" cy="16" r="2.2"/><path d="M6.2 10h7.1M6 9l7.4-4.2M6 11l7.4 4.2"/>',
    search: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/>',
    down: '<path d="M5.5 8l4.5 4.5L14.5 8"/>',
    left: '<path d="M12.5 4.5L7 10l5.5 5.5"/>',
    right: '<path d="M7.5 4.5L13 10l-5.5 5.5"/>',
    eye: '<path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10z"/><circle cx="10" cy="10" r="2.5"/>',
    check: '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
    x: '<path d="M5 5l10 10M15 5L5 15"/>',
    play: '<path d="M6.5 4.5l9 5.5-9 5.5z"/>',
    plus: '<path d="M10 4.5v11M4.5 10h11"/>',
    lock: '<rect x="4.5" y="9" width="11" height="8" rx="1.6"/><path d="M7 9V6.8a3 3 0 0 1 6 0V9"/>',
    dl: '<path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12"/>',
    pin: '<path d="M12.5 2.8l4.7 4.7-1.7 1.7-1-.4-3 3 .4 3-1.6 1.6-2.8-2.8-4 4-.9-.9 4-4-2.8-2.8 1.6-1.6 3 .4 3-3-.4-1z"/>',
    code: '<path d="M7 6l-4 4 4 4M13 6l4 4-4 4"/>',
    moon: '<path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z"/>',
    discord: '<path d="M4 4.5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9.5l-4 3v-3H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z"/>',
  };
  const ico = (n, s = 20, w = 1.7) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

  // ───────────────────────── 정적 데이터 ─────────────────────────
  const WS_SEED = [
    { id: 'capstone', name: '캡스톤 팀플',    short: '캡', kind: 'team',     color: '#3b7cf5', members: ['minsu', 'jiyun', 'hyunwoo', 'prof'], lead: 'minsu', discord: '#캡스톤-팀플', unread: 5 },
    { id: 'contest',  name: '공모전 기획서',   short: '공', kind: 'team',     color: '#f08c2e', members: ['minsu', 'jiyun', 'hyunwoo'], lead: 'jiyun', discord: '#공모전', unread: 2, sharedTabs: ['공모전 공지', '기획서 · Google Docs', 'Figma 시안'] },
    { id: 'compiler', name: '컴파일러 과제 3', short: '컴', kind: 'personal', color: '#e0527d', members: ['minsu'] },
    { id: 'vr',       name: 'VR 콘텐츠 과제',  short: 'VR', kind: 'personal', color: '#8b5cf6', members: ['minsu'] },
    { id: 'os',       name: '운영체제 과제 2', short: '운', kind: 'personal', color: '#65a30d', members: ['jiyun'] },
    { id: 'dbhw',     name: '데이터베이스 과제', short: '데', kind: 'personal', color: '#0ea5e9', members: ['hyunwoo'] },
  ];
  const NEW_COLORS = ['#d946ef', '#ca8a04', '#f43f5e', '#64748b'];
  const isTeamWs = id => { const w = WS_SEED.find(x => x.id === id); return !!w && w.kind === 'team'; };
  const PEOPLE = { minsu: '#1f8fc7', jiyun: '#8a5cd6', hyunwoo: '#d9822b', prof: '#2e9e62' };
  const GLOW = { minsu: '#56c2e6', jiyun: '#b18cf2', hyunwoo: '#f0a35e', prof: '#4fd08a' };
  const initial = u => (u === 'prof' ? '교' : U[u].name[0]);
  const STATUS_LABEL = { active: '활성', background: '백그라운드', sleep: '잠자기' };

  /** 남은 과제 (마감은 오늘 기준 상대 날짜). 팀 과제는 팀원 모두가 같은 체크리스트를 본다 */
  const TASKS = [
    { id: 't-compiler', ws: 'compiler', title: '컴파일러 과제 3 · LL(1) 파서', due: 3, at: '23:59', items: [['렉서 구현', 1], ['문법 정리', 1], ['파싱 테이블', 0], ['오류 처리', 0], ['보고서', 0]] },
    { id: 't-dbhw',     ws: 'dbhw',     title: '데이터베이스 과제 · 정규화', due: 2, at: '23:59', items: [['ERD', 1], ['정규화', 0], ['SQL 쿼리', 0]] },
    { id: 't-os',       ws: 'os',       title: '운영체제 과제 2 · 스케줄러', due: 4, at: '23:59', items: [['FCFS', 1], ['Round Robin', 0], ['MLFQ', 0], ['보고서', 0]] },
    { id: 't-contest',  ws: 'contest',  title: '공모전 기획서 제출', due: 5, at: '18:00', items: [['개요', 1], ['시장 분석', 0], ['디자인 시안', 0]] },
    { id: 't-capstone', ws: 'capstone', title: '캡스톤 중간발표', due: 6, at: '15:00', items: [['회원가입 API · 민수', 0], ['로그인 API · 지윤', 0], ['발표 자료', 0], ['데모 영상', 0]] },
    { id: 't-vr',       ws: 'vr',       title: 'VR 콘텐츠 과제', due: 9, at: '23:59', items: [['씬 배치', 0], ['인터랙션', 0], ['시연 영상', 0]] },
  ];
  /** 일정 [오늘 기준 일, 시작, 끝, 워크스페이스, 제목, 부제, 연결 과제, 볼 수 있는 사람(없으면 워크스페이스 멤버 전체)] */
  const EVENTS = [
    [-1, 10, 12, 'compiler', '렉서 테스트 작성', '과제 3', 't-compiler'],
    [-1, 15, 16, 'capstone', '주간 회의', 'Discord 음성'],
    [-1, 10, 12, 'os', 'FCFS 구현', '과제 2', 't-os'],
    [-1, 13, 15, 'dbhw', 'ERD 그리기', '과제', 't-dbhw'],
    [0, 10, 12, 'dbhw', '데이터베이스 강의', '공학관 102'],
    [0, 14, 16, 'capstone', 'redis 설정', 'docker-compose', null, ['hyunwoo']],
    [1, 19, 21, 'dbhw', '정규화 실습', '과제', 't-dbhw'],
    [0, 9, 10.5, 'compiler', '컴파일러 강의', '공학관 301'],
    [0, 10.5, 12, 'compiler', 'LL(1) 파싱 테이블', '과제 3', 't-compiler'],
    [0, 10, 12, 'os', '운영체제 강의', '공학관 205'],
    [0, 13, 14, 'capstone', '팀 스탠드업', 'Discord'],
    [0, 14, 16, 'capstone', '회원가입 API 구현', 'Claude Code와 작업', 't-capstone', ['minsu']],
    [0, 14, 16, 'capstone', '로그인·인증 API', 'Claude Code와 작업', 't-capstone', ['jiyun']],
    [0, 16.5, 17.5, 'contest', '기획서 피드백', '팀 회의'],
    [0, 19, 21, 'vr', '씬 배치', 'Unity', 't-vr'],
    [0, 19.5, 21, 'os', 'Round Robin 구현', '과제 2', 't-os'],
    [1, 9, 11, 'compiler', '오류 처리 구현', '과제 3', 't-compiler'],
    [1, 10, 12, 'os', 'MLFQ 설계', '과제 2', 't-os'],
    [1, 13, 15, 'capstone', '로그인 연동 테스트', '지윤 · 민수'],
    [1, 16, 17, 'vr', 'VR 중간 점검', '실습실'],
    [2, 10, 12, 'contest', '시장 분석 작성', '기획서', 't-contest'],
    [2, 14, 16, 'compiler', '파서 테스트', '과제 3', 't-compiler'],
    [2, 16, 18, 'os', '스케줄러 테스트', '과제 2', 't-os'],
    [2, 19, 20, 'capstone', '발표 자료 초안', '', 't-capstone'],
    [3, 9, 11, 'compiler', '보고서 마무리', '과제 3', 't-compiler'],
    [3, 15, 17, 'capstone', '중간발표 리허설', '세미나실'],
    [3, 19, 21, 'os', '보고서 작성', '과제 2', 't-os'],
    [4, 11, 12, 'capstone', '지도교수 미팅', '교수 연구실'],
    [4, 14, 16, 'contest', '디자인 시안', 'Figma', 't-contest'],
    [5, 13, 15, 'vr', '인터랙션 구현', 'Unity', 't-vr'],
    [6, 10, 12, 'capstone', '데모 영상 촬영', '', 't-capstone'],
    [7, 14, 16, 'vr', '시연 영상', '', 't-vr'],
    [8, 10, 12, 'vr', '최종 점검', '', 't-vr'],
  ].map(([rel, s, e, ws, title, sub, task, only], i) => ({ i, rel, s, e, ws, title, sub, task, only }));
  const H0 = 8, H1 = 22, HPX = 46;

  const TYPE_DEFAULTS = {
    '과제':        { desc: '강의 사이트 · 자료 · 제출 폴더', tabs: ['과제 명세 · 학교 LMS', '강의자료.pdf'], cmd: '' },
    '개발 팀플':   { desc: '저장소 · 서버 · 비밀값', tabs: ['GitHub 저장소', '노션 기획', 'API 문서'], cmd: 'npm run dev' },
    '공모전·문서': { desc: '기획서 · 디자인 툴', tabs: ['공모전 공지', '기획서 · Google Docs', 'Figma'], cmd: '' },
    '직접 설정':   { desc: '빈 워크스페이스', tabs: [], cmd: '' },
  };

  /** 기기별 로컬 환경 (팀 서버로 동기화되지 않는 개인 층) */
  function seedLocal() {
    const L = (viewer, o) => Object.assign({
      loggedIn: true, tab: 0, server: 'none', host: null, port: null, cmd: '', env: {}, files: [], term: [], downloads: [], tabs: [], privateTabs: [],
      win: winPath(viewer, o.folder), partition: 'persist:ws-' + o.folder.split('/').pop(),
    }, o);
    const capEnv = { NODE_ENV: 'development', PORT: '3002', DATABASE_URL: 'postgresql://capstone:Sup3rS3cret!@localhost:5432/capstone', OPENAI_API_KEY: 'sk-proj-4fT9qL2mXv8RkZ0aB7cD' };
    const capTerm = [['cmd', 'docker compose up -d'], ['dim', '✔ Container capstone-db  Started'], ['cmd', 'npm run dev'], ['ok', 'http://capstone.localhost (포트 3002 자동 배정)']];
    const capFiles = ['prisma/', 'src/', 'docker-compose.yml', 'package.json', 'CLAUDE.md'];
    return {
      minsu: {
        capstone: L('minsu', { account: '개인 Google 계정', email: 'minsu.dev@gmail.com', folder: '~/projects/capstone', download: '캡스톤 팀플/자료', host: 'capstone.localhost', port: 3002, server: 'running', cmd: 'npm run dev', branch: 'feature/signup', env: capEnv, files: capFiles, term: capTerm.slice() }),
        contest: L('minsu', { account: '개인 Google 계정', email: 'minsu.dev@gmail.com', folder: '~/projects/contest-plan', download: '공모전 기획서/자료', files: ['기획서_v3.docx', '발표자료/'], term: [['dim', '실행 명령이 없는 워크스페이스예요.']] }),
        compiler: L('minsu', { account: '학교 Google 계정', email: 'minsu@univ.ac.kr', folder: '~/projects/compiler-hw3', download: '과제3/자료', host: 'compiler.localhost', port: 3001, server: 'running', cmd: 'npm run dev', branch: 'main', env: { NODE_ENV: 'development', PORT: '3001' }, files: ['src/', 'tests/', 'package.json', 'README.md'], tabs: ['과제 명세 · 학교 LMS', '강의자료 7주차.pdf', 'compiler.localhost'], term: [['cmd', 'npm run dev'], ['ok', 'http://compiler.localhost (포트 3001 자동 배정)'], ['cmd', 'git config user.email'], ['dim', 'minsu@univ.ac.kr   (학교 계정 · 이 폴더에만 적용)']] }),
        vr: L('minsu', { account: '학교 Google 계정', email: 'minsu@univ.ac.kr', folder: '~/projects/vr-content', download: 'VR 과제/자료', host: 'vr.localhost', port: 3003, server: 'stopped', cmd: 'npm run preview', branch: 'main', tabs: ['과제 안내 · 학교 LMS', 'Unity 문서'], files: ['Assets/', 'ProjectSettings/'] }),
      },
      jiyun: {
        capstone: L('jiyun', { account: '개인 Google 계정', email: 'jiyun.k@gmail.com', folder: '~/projects/capstone', download: '캡스톤 팀플/자료', host: 'capstone.localhost', port: 3002, server: 'running', cmd: 'npm run dev', branch: 'feature/login', env: capEnv, files: capFiles, term: capTerm.slice() }),
        contest: L('jiyun', { account: '개인 Google 계정', email: 'jiyun.k@gmail.com', folder: '~/projects/contest-plan', download: '공모전 기획서/자료', privateTabs: ['레퍼런스 모음'], files: ['기획서_v3.docx'] }),
        os: L('jiyun', { account: '학교 Google 계정', email: 'jiyun@univ.ac.kr', folder: '~/projects/os-hw2', download: '운영체제/자료', cmd: 'make test', branch: 'main', tabs: ['과제 명세 · 학교 LMS', 'xv6 문서', '강의자료 9주차.pdf'], files: ['kernel/', 'user/', 'Makefile'], term: [['cmd', 'make test'], ['ok', '12/15 tests passed']] }),
      },
      hyunwoo: {
        capstone: L('hyunwoo', { account: '개인 Google 계정', email: 'hyunwoo.dev@gmail.com', folder: '~/projects/capstone', download: '캡스톤 팀플/자료', host: 'capstone.localhost', port: 3002, server: 'running', cmd: 'npm run dev', branch: 'chore/redis', env: capEnv, files: capFiles, term: capTerm.slice() }),
        contest: L('hyunwoo', { account: '개인 Google 계정', email: 'hyunwoo.dev@gmail.com', folder: '~/projects/contest-plan', download: '공모전 기획서/자료', files: ['기획서_v3.docx'] }),
        dbhw: L('hyunwoo', { account: '학교 Google 계정', email: 'hyunwoo@univ.ac.kr', folder: '~/projects/db-hw', download: 'DB 과제/자료', tabs: ['과제 명세 · 학교 LMS', 'MySQL 문서'], files: ['schema.sql', 'queries/'], term: [['dim', '실행 명령이 없는 워크스페이스예요.']] }),
      },
    };
  }

  // ───────────────────────── 상태 ─────────────────────────
  let st, ui;
  function freshUI(prev) {
    return {
      gen: (prev ? prev.gen : 0) + 1,
      view: prev ? prev.view : 'home',
      viewer: prev ? prev.viewer : 'minsu',
      wsList: WS_SEED.map(w => Object.assign({}, w)),
      cur: perP(() => 'capstone'),
      wsStatus: {
        minsu: { capstone: 'active', contest: 'background', compiler: 'background', vr: 'sleep' },
        jiyun: { capstone: 'active', contest: 'background', os: 'background' },
        hyunwoo: { capstone: 'active', contest: 'background', dbhw: 'background' },
      },
      local: seedLocal(),
      feedFilter: 'all',
      // 보기 설정 · 개인 층도 자리(사람)마다 따로
      ptasks: perP(() => ({})),          // 개인 과제 체크 (이 브라우저에만)
      privTabs: perP(() => []),          // 캡스톤에서 새로 연 개인 탭 (이 브라우저에만)
      weekOffset: perP(() => 0),
      calHidden: perP(() => new Set()),
      openTask: perP(() => null),
      tabAdd: false,
      tabClicked: new Set(),
      popover: null,
      menu: null,
      modal: null,
      auto: false, autoToken: 0, confirmReset: false,
      graphSel: null,
      expanded: {},
      seenEph: perP(() => new Set()),
      term: perP(() => []),
      termCleared: perP(() => 0),
      peers: [],                         // 지금 접속 중인 사람 (room)
      names: {},                         // id → 프로필 (user.profiles, 화면에 그릴 때만)
    };
  }

  // ───────────────────────── 공유 기록 (팀 동기화 서버 역할) ─────────────────────────
  const TAB_ID = Math.random().toString(36).slice(2, 10);
  const BOOT = Date.now();
  const NET = {
    mode: window.claude && typeof window.claude.use === 'function' ? 'connecting' : 'local',   // local | connecting | shared
    db: null, room: null, user: null, me: null, readOnly: false, full: false, loaded: false, note: null,
    epoch: null, startedAt: null, unsubLog: null, first: true, lastPresence: null, whoT: 0,
  };
  let LOG = [];
  let localSeq = 0, idSeq = 0;
  const newId = p => `${p}-${Date.now().toString(36)}-${TAB_ID}-${(++idSeq).toString(36).padStart(4, '0')}`;
  const logPath = () => 'runs/' + NET.epoch + '/log';
  const STR = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const isP = u => PERSONAS.includes(u);

  /** 공유 기록 한 줄을 검증한다 — 다른 사람이 쓴 값은 믿지 않는다 */
  function cleanAction(raw, id) {
    if (!raw || typeof raw !== 'object') return null;
    const t = Number(raw.t);
    if (!isFinite(t)) return null;
    const a = { _id: String(id), t, type: STR(raw.type, 20), by: isP(raw.by) ? raw.by : null, src: STR(raw.src, 24) };
    const key = STR(raw.key, 200);
    switch (a.type) {
      case 'step': a.n = Math.floor(Number(raw.n)); return a.n >= 1 && a.n <= 5 ? a : null;
      case 'launch':
        if (!isP(raw.user) || !STR(raw.rid, 80)) return null;
        return Object.assign(a, { user: raw.user, tool: raw.tool === 'Codex' ? 'Codex' : 'Claude Code', title: STR(raw.title, 80) || '작업', branch: STR(raw.branch, 80) || 'feature/task', rid: STR(raw.rid, 80) });
      case 'file':
        if (!isP(raw.user) || !STR(raw.path, 160)) return null;
        return Object.assign(a, { user: raw.user, rid: STR(raw.rid, 80) || null, kind: ['hook', 'watch', 'git'].includes(raw.kind) ? raw.kind : 'watch', path: STR(raw.path, 160), changeType: ['added', 'modified', 'deleted'].includes(raw.changeType) ? raw.changeType : 'modified' });
      case 'sharedTab': a.name = STR(raw.name, 40).trim(); return a.name ? a : null;
      case 'alert': return isP(raw.viewer) && key ? Object.assign(a, { viewer: raw.viewer, key, state: ['dismissed', 'notified', 'handled'].includes(raw.state) ? raw.state : null }) : null;
      case 'feedback': return isP(raw.viewer) && key ? Object.assign(a, { viewer: raw.viewer, key, v: raw.v === 'fp' ? 'fp' : 'useful' }) : null;
      case 'notify': return isP(raw.viewer) && key ? Object.assign(a, { viewer: raw.viewer, key, rid: STR(raw.rid, 80), text: STR(raw.text, 400) }) : null;
      case 'runStatus': return STR(raw.rid, 80) ? Object.assign(a, { rid: STR(raw.rid, 80), status: ['running', 'waiting', 'done'].includes(raw.status) ? raw.status : 'done', last: STR(raw.last, 60) }) : null;
      case 'shareTitle': return isP(raw.user) ? Object.assign(a, { user: raw.user, value: !!raw.value }) : null;
      case 'invite': return STR(raw.email, 120) ? Object.assign(a, { email: STR(raw.email, 120), role: raw.role === '열람자' ? '열람자' : '팀원' }) : null;
      case 'task': { const i = Math.floor(Number(raw.i)); return STR(raw.id, 40) && i >= 0 ? Object.assign(a, { id: STR(raw.id, 40), i, done: !!raw.done }) : null; }
      default: return null;
    }
  }

  /** 기록 한 줄을 시뮬레이션 상태에 적용한다 (모든 화면에서 같은 순서 → 같은 결과) */
  function applyAction(s, a) {
    const at = new Date(a.t);
    const run = id => s.agents.find(r => r.id === id);
    switch (a.type) {
      case 'step':
        if (a.n === s.step + 1) { STEPS[a.n - 1].apply(s, a, at); s.step = a.n; }
        break;
      case 'launch':
        if (!run(a.rid)) S.launchAgent(s, a.user, { tool: a.tool, title: a.title, branch: a.branch, id: a.rid, at });
        break;
      case 'file':
        S.emitFile(s, { user: a.user, runId: a.rid && run(a.rid) ? a.rid : null, kind: a.kind, path: a.path, changeType: a.changeType, at });
        break;
      case 'sharedTab': {
        const v = S.addSharedTab(s, a.name);
        if (v) s.feed.push({ kind: 'bot-text', at, seq: s.seq + 0.5, html: `<b>${esc(a.by ? U[a.by].name : '팀장')}</b> 님이 공유 고정 탭 <b>${esc(a.name)}</b>를 추가했어요 · 팀원에게 반영됨 (v${v})` });
        break;
      }
      case 'alert':
        if (a.state) s.alertState[a.viewer + '|' + a.key] = a.state; else delete s.alertState[a.viewer + '|' + a.key];
        break;
      case 'feedback': s.alertFeedback[a.viewer + '|' + a.key] = a.v; break;
      case 'notify': {
        const r = run(a.rid);
        if (r) { (s.agentNotes[r.id] = s.agentNotes[r.id] || []).push({ text: a.text, at }); r.last = '팀 알림 수신 · 변경된 스키마 확인'; r.lastAt = at; }
        s.alertState[a.viewer + '|' + a.key] = 'notified';
        break;
      }
      case 'runStatus': { const r = run(a.rid); if (r) { r.status = a.status; r.last = a.last || r.last; r.lastAt = at; } break; }
      case 'shareTitle': s.shareTitle[a.user] = a.value; break;
      case 'invite': s.team.invites.push({ email: a.email, role: a.role }); break;
      case 'task': { const arr = s.taskState[a.id]; if (arr && a.i < arr.length) arr[a.i] = a.done; break; }
    }
  }

  function rebuild() {
    st = S.createState({ now: NET.startedAt || BOOT });
    st.feed = [];
    st.step = 0;
    st.taskState = {};
    TASKS.forEach(t => { if (isTeamWs(t.ws)) st.taskState[t.id] = t.items.map(x => !!x[1]); });
    const sorted = LOG.slice().sort((x, y) => (x.t - y.t) || (x._id < y._id ? -1 : x._id > y._id ? 1 : 0));
    for (const a of sorted) {
      try { applyAction(st, a); } catch (e) { console.warn('[cadora] 기록 하나를 건너뛰었어요', a.type, e); }
    }
    // 실제로 접속한 사람이 있으면 그 자리의 '다른 워크스페이스 사용 중' 표시를 접속 상태로 바꾼다
    for (const p of PERSONAS) {
      const occ = occupants(p);
      if (occ.length) st.presence[p] = occ.some(o => o.presence.ws === 'capstone') ? 'capstone' : 'other';
    }
  }

  /** 팀이 함께 바꾸는 동작은 모두 여기로 — 공유 모드면 db에 쌓고, 아니면 이 브라우저 기록에 쌓는다 */
  function dispatch(raw) {
    if (NET.mode === 'connecting') { toast('공유 데이터에 연결하는 중이에요 — 잠시 후 다시 눌러 주세요'); return false; }
    if (NET.readOnly) { toast('보기 권한이라 바꿀 수 없어요 — 공유한 사람에게 편집 권한(Contributor 이상)을 받아 주세요'); return false; }
    if (NET.full) { toast('기록이 가득 찼어요 — 시연 메뉴에서 초기화해 주세요'); return false; }
    // 노트북마다 시계가 조금씩 달라도, 내가 쓰는 동작은 지금까지 본 기록보다 항상 뒤에 오게 한다
    const maxT = LOG.reduce((m, a) => (a.t > m ? a.t : m), 0);
    const doc = Object.assign({ t: Math.max(Date.now(), maxT + 1), by: ui.viewer, src: TAB_ID }, raw);
    if (NET.mode !== 'shared') {
      const a = cleanAction(doc, 'l' + String(++localSeq).padStart(6, '0'));
      if (a) { LOG.push(a); rebuild(); }
      return true;
    }
    NET.db.collection(logPath()).doc(newId('a')).set(doc).catch(e => {
      const code = e && e.code;
      if (code === 'invalid_argument') { NET.readOnly = true; toast('보기 권한이라 바꿀 수 없어요 — 공유한 사람에게 편집 권한을 받아 주세요'); }
      else if (code === 'quota_exceeded') { NET.full = true; toast('공유 저장 공간이 가득 찼어요 — 시연 메뉴에서 초기화해 주세요'); }
      else toast('저장하지 못했어요 — 잠시 후 다시 해 주세요');
      render();
    });
    return true;
  }

  function resetLocalForEpoch() {
    ui.seenEph = perP(() => new Set());
    ui.expanded = {};
    ui.graphSel = null;
    ui.term = perP(() => []);
    ui.termCleared = perP(() => 0);
    ui.tabClicked = new Set();
    stopAuto();
  }

  async function doReset() {
    ui.confirmReset = false;
    if (NET.mode === 'shared') {
      if (NET.readOnly) { toast('보기 권한이라 초기화할 수 없어요'); return; }
      const n = parseInt(String(NET.epoch).slice(1), 10) || 1;
      try {
        await NET.db.doc('meta/state').set({ epoch: 'e' + (n + 1), startedAt: Date.now() });
        toast('모두의 시연을 처음 상태로 되돌렸어요');
      } catch (e) {
        toast(e && e.code === 'invalid_argument' ? '보기 권한이라 초기화할 수 없어요' : '초기화하지 못했어요 — 잠시 후 다시 해 주세요');
      }
      render();
      return;
    }
    LOG = [];
    ui = freshUI(ui);
    rebuild();
    toast('처음 상태로 되돌렸어요');
  }

  function subscribeLog() {
    if (NET.unsubLog) NET.unsubLog();
    LOG = []; NET.loaded = false; NET.full = false; NET.first = true; NET.note = null;
    resetLocalForEpoch();
    rebuild(); render();
    const timer = setTimeout(() => { if (!NET.loaded) { NET.note = '공유 데이터에 아직 연결하지 못했어요'; render(); } }, 10000);
    NET.unsubLog = NET.db.collection(logPath()).orderBy('t').limit(1000).onSnapshot(snap => {
      if (!snap.metadata.fromCache) { clearTimeout(timer); NET.loaded = true; NET.note = null; }
      const next = [];
      for (const d of snap.docs) { const a = cleanAction(d.data(), d.id); if (a) next.push(a); }
      const fresh = NET.first ? [] : snap.docChanges().filter(c => c.type === 'added').map(c => cleanAction(c.doc.data(), c.doc.id)).filter(Boolean);
      NET.first = false;
      LOG = next;
      NET.full = snap.size >= 1000;
      rebuild();
      fresh.forEach(remoteToast);
      render();
    }, () => { clearTimeout(timer); NET.loaded = true; NET.note = '실시간 연결이 끊겼어요'; render(); });
  }

  /** 다른 사람이 한 일을 짧게 알려 준다 (내 탭이 한 일, 들어오기 전 기록은 빼고) */
  function remoteToast(a) {
    if (a.src === TAB_ID || a.t < BOOT) return;
    const who = a.by ? `${U[a.by].name} 자리` : '팀원';
    if (a.type === 'step') { const s = STEPS[a.n - 1]; toast(`${esc(who)}에서 시연 ${a.n}단계 · ${esc(s.label)}`, s.shared); }
    else if (a.type === 'launch') toast(`${esc(U[a.user].name)} 님이 ${esc(a.tool)}를 시작했어요 · "${esc(a.title)}"`, { label: '팀 그래프 보기', fn: () => go('team') });
    else if (a.type === 'sharedTab') toast(`공유 탭 '${esc(a.name)}'이(가) 추가됐어요`, { label: '작업공간 보기', fn: () => { setWs('capstone'); go('home'); } });
  }

  const occupants = p => ui.peers.filter(x => x.kind === 'viewer' && x.presence && x.presence.persona === p);
  const peerName = x => { const pr = x.by && ui.names[x.by]; return (pr && pr.name) || (x.isMe ? '나' : '이름 없음'); };
  const peerAv = (x, size) => {
    const pr = x.by && ui.names[x.by];
    return pr && pr.avatarUrl
      ? `<img class="pav" src="${esc(pr.avatarUrl)}" width="${size}" height="${size}" alt="">`
      : `<span class="pav" style="width:${size}px;height:${size}px;background:${PEOPLE[x.presence.persona] || '#5b6470'}"></span>`;
  };
  function uniquePeople() {
    const seen = new Map();
    for (const x of ui.peers) if (x.kind === 'viewer') { const k = x.by || x.peer; if (!seen.has(k) || x.isMe) seen.set(k, x); }
    return [...seen.values()];
  }

  function syncPresence() {
    if (!NET.room) return;
    // 개인 워크스페이스 이름은 보내지 않는다 (FR-14): 캡스톤인지 아닌지만
    const p = { persona: ui.viewer, view: ui.view, ws: curId() === 'capstone' ? 'capstone' : 'other' };
    const key = JSON.stringify(p);
    if (key === NET.lastPresence) return;
    NET.lastPresence = key;
    if (NET.me && NET.me.color) { if (!NET.whoT) NET.whoT = Date.now(); p.who = { c: NET.me.color, t: NET.whoT }; }
    NET.room.presence(p).catch(() => {});
  }

  function setPersona(u) {
    if (!isP(u)) return;
    ui.viewer = u;
    ui.graphSel = null;
    ui.tabAdd = false;
    try { localStorage.setItem('cadora.persona', u); } catch (_) { /* 저장 못 해도 괜찮다 */ }
  }

  async function connect() {
    if (NET.mode !== 'connecting') return;
    const give = setTimeout(() => { if (NET.mode === 'connecting') { NET.mode = 'local'; render(); } }, 12000);
    let db = null, user = null, room = null;
    try { [db, user, room] = await Promise.all([window.claude.use('db'), window.claude.use('user'), window.claude.use('room')]); } catch (_) { /* 혼자 보기로 */ }
    clearTimeout(give);
    if (!db) { NET.mode = 'local'; render(); return; }
    NET.db = db; NET.user = user; NET.room = room;
    if (user) {
      try { NET.me = await user.me(); } catch (_) { /* 없어도 된다 */ }
      let can = null;
      try { can = await user.can('data.write'); } catch (_) { can = null; }
      if (can === false) NET.readOnly = true;
    }
    NET.mode = 'shared';
    db.doc('meta/state').onSnapshot(snap => {
      const d = snap.exists ? snap.data() : null;
      const ep = d && typeof d.epoch === 'string' && /^e\d{1,6}$/.test(d.epoch) ? d.epoch : 'e1';
      NET.startedAt = (d && Number(d.startedAt)) || null;
      if (ep !== NET.epoch) { NET.epoch = ep; subscribeLog(); }
    }, () => { NET.note = '공유 상태를 불러오지 못했어요'; render(); });
    if (room) {
      room.onPeers(change => {
        ui.peers = change.peers.slice();
        const ids = [...new Set(ui.peers.map(x => x.by).filter(Boolean))];
        if (ids.length && user) user.profiles(ids).then(ps => { ui.names = ps || {}; render(); }).catch(() => {});
        rebuild(); render();
      }, () => {});
    }
    if (!storedPersona()) ui.modal = { type: 'persona', first: true };
    render();
  }
  function storedPersona() { try { const v = localStorage.getItem('cadora.persona'); return isP(v) ? v : null; } catch (_) { return null; } }
  function later(ms, fn) {
    const gen = ui.gen;
    setTimeout(() => { if (gen === ui.gen) { fn(); render(); } }, ms);
  }
  function toast(html, action) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span>${html}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    const bye = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    if (action) el.querySelector('button').addEventListener('click', () => { action.fn(); render(); bye(); });
    box.appendChild(el);
    while (box.children.length > 2) box.firstChild.remove();
    setTimeout(bye, 3800);
  }

  // ───────────────────────── 보는 사람별 파생 데이터 ─────────────────────────
  const wsById = id => ui.wsList.find(w => w.id === id);
  const myWs = (v = ui.viewer) => ui.wsList.filter(w => w.members.includes(v));
  const curId = () => ui.cur[ui.viewer];
  const curWs = () => wsById(curId());
  const env = (v = ui.viewer, id = curId()) => ui.local[v][id];
  const canSee = (v, wsId, only) => { const w = wsById(wsId); return !!w && w.members.includes(v) && (!only || only.includes(v)); };
  /** 과제 + 체크 상태: 팀 과제는 공유 기록에서, 개인 과제는 이 브라우저에서 */
  function taskView(t, v = ui.viewer) {
    const team = isTeamWs(t.ws), mine = ui.ptasks[v][t.id];
    return Object.assign({}, t, { team, items: t.items.map(([label, d], i) => ({ label, done: team ? !!(st.taskState[t.id] || [])[i] : (mine && mine[i] != null ? mine[i] : !!d) })) });
  }
  const myTasks = (v = ui.viewer) => TASKS.filter(t => canSee(v, t.ws)).map(t => taskView(t, v));
  const myEvents = (v = ui.viewer) => EVENTS.filter(e => canSee(v, e.ws, e.only));
  const taskById = id => { const t = TASKS.find(x => x.id === id); return t ? taskView(t) : null; };
  const taskDone = t => t.items.filter(x => x.done).length;
  const dueDate = t => { const d = addDays(startOfDay(now()), t.due); const [h, m] = t.at.split(':'); d.setHours(+h, +m); return d; };
  const dday = n => (n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `D+${-n}`);
  const isLead = (v = ui.viewer, w = curWs()) => w.kind === 'team' && w.lead === v;

  function setWs(id, v = ui.viewer) {
    if (!canSee(v, id)) return;
    const prev = ui.cur[v];
    if (prev !== id) {
      if (ui.wsStatus[v][prev] === 'active') ui.wsStatus[v][prev] = 'background';
      const woke = ui.wsStatus[v][id] === 'sleep';
      ui.wsStatus[v][id] = 'active';
      ui.cur[v] = id;
      ui.tabAdd = false;
      if (woke) toast(`${esc(wsById(id).name)} 깨움 — 탭을 다시 불러와요`);
    }
  }

  const evSeq = id => +String(id).replace(/\D/g, '');
  const latestAt = ids => new Date(Math.max(...ids.map(id => (S.eventById(st, id) || { at: new Date(0) }).at.getTime())));
  const alertsFor = v => (VIEWERS.includes(v) ? S.computeAlerts(st, v) : []);
  const unreadFor = v => alertsFor(v).filter(a => a.status === 'new' && !ui.seenEph[v].has(a.key)).length;
  const activeRunOf = v => st.agents.find(r => r.user === v && S.isActive(r) && r.tool === 'Claude Code') || st.agents.find(r => r.user === v && S.isActive(r));
  const myRunsIn = (v, wsId) => st.agents.filter(r => r.user === v && S.isActive(r) && r.ws === wsId);

  // ───────────────────────── 셸 ─────────────────────────
  const VIEWS = [
    { id: 'home', label: '작업공간', icon: 'home' },
    { id: 'team', label: '팀', icon: 'graph' },
    { id: 'activity', label: '활동', icon: 'activity' },
    { id: 'cal', label: '캘린더', icon: 'cal' },
  ];

  function shell(side, pane, dark) {
    const rw = realSel && realWs(realSel);
    const ws = rw ? { name: rw.name, color: realColor(rw), short: realShort(rw) } : curWs();
    const onTeam = curId() === 'capstone';
    const unread = onTeam ? unreadFor(ui.viewer) : 0;
    const highTeam = onTeam && alertsFor(ui.viewer).some(a => a.severity === 'high' && a.status === 'new');
    const nav = VIEWS.map(v => {
      const badge = v.id === 'activity' && unread ? `<span class="badge">${unread}</span>` : v.id === 'team' && highTeam && ui.view !== 'team' ? '<span class="badge">!</span>' : '';
      return `<button class="nav ${ui.view === v.id ? 'on' : ''}" data-act="view" data-v="${v.id}"><span class="ic">${ico(v.icon)}</span>${v.label}${badge}</button>`;
    }).join('');
    const me = U[ui.viewer];
    return `<div class="win">
      <header class="top">
        <span class="brand">CADORA</span>
        <label class="search">${ico('search', 16)}<input id="search" placeholder="${esc(ws.name)} 검색" data-enter="search" autocomplete="off"></label>
        <div class="top-r">${liveHTML()}<button class="demo-pill" data-act="menu" data-m="demo"><span class="dot"></span>시연 ${st.step}/${STEPS.length}</button></div>
      </header>
      <div class="body">
        <nav class="rail">
          <button class="ws-av" style="background:${ws.color}" data-act="menu" data-m="ws" title="워크스페이스 전환">${esc(ws.short)}</button>
          ${nav}
          <button class="me" data-act="seat-open" title="내 자리 바꾸기"><span class="av" style="background:${PEOPLE[ui.viewer]}">${initial(ui.viewer)}</span><span class="pres"></span></button>
          <div class="me-label">${esc(me.name)}<br>${esc(me.device)}</div>
        </nav>
        <div class="frame">
          <aside class="side">${side}</aside>
          <main class="pane ${dark ? 'dark' : ''}">${pane}</main>
        </div>
      </div>
    </div>`;
  }

  function liveHTML() {
    if (NET.mode === 'local') return '<span class="live off" title="파일로 열었거나 공유 데이터를 쓸 수 없어서 이 브라우저 안에서만 동작해요">혼자 보기</span>';
    if (NET.mode === 'connecting') return '<span class="live wait">연결 중…</span>';
    const people = uniquePeople();
    const avs = people.slice(0, 4).map(x => peerAv(x, 20)).join('');
    const label = NET.note ? esc(NET.note) : `${NET.readOnly ? '보기 전용 · ' : ''}${people.length || 1}명 접속`;
    return `<button class="live ${NET.note ? 'bad' : ''}" data-act="menu" data-m="people">${avs ? `<span class="avs">${avs}</span>` : '<span class="dot"></span>'}${label}</button>`;
  }

  const wsHead = () => `<button class="s-head" data-act="menu" data-m="ws">${esc(curWs().name)} ${ico('down', 16)}</button>`;

  function wsMeta(v, w) {
    const s = ui.wsStatus[v][w.id] || 'background';
    const E = env(v, w.id);
    const parts = [STATUS_LABEL[s], w.kind === 'team' ? '팀' : '개인'];
    const runs = myRunsIn(v, w.id).length;
    if (runs) parts.push(`에이전트 ${runs}`);
    else if (E.server === 'running' && s !== 'active') parts.push('서버 실행 중');
    return { s, text: parts.join(' · ') };
  }
  const statusDot = s => (s === 'active' ? '#2dd4bf' : s === 'background' ? '#d29922' : 'transparent;box-shadow:inset 0 0 0 1.5px rgba(230,237,243,.45)');

  // ───────────────────────── 작업공간 (FR-01~05 · FR-08) ─────────────────────────
  function tabsOf(v = ui.viewer, id = curId()) {
    const w = wsById(id), E = env(v, id);
    if (id === 'capstone') {
      const t = S.tabsFor(st, v);
      return t.shared.map((x, i) => ({ title: x, shared: true, fresh: i >= 3 && !ui.tabClicked.has(v + '|' + x) }))
        .concat(t.private.concat(ui.privTabs[v]).map(x => ({ title: x, private: true })));
    }
    if (w.kind === 'team') return (w.sharedTabs || []).map(x => ({ title: x, shared: true })).concat(E.privateTabs.map(x => ({ title: x, private: true })));
    return E.tabs.map(x => ({ title: x }));
  }

  function homeSide() {
    const items = myWs().map(w => {
      const m = wsMeta(ui.viewer, w);
      return `<button class="s-item tall ${!realSel && w.id === curId() ? 'on' : ''}" data-act="ws" data-id="${w.id}">
        <span class="wsq" style="background:${w.color}">${esc(w.short)}</span>
        <span class="grow"><span class="nm">${esc(w.name)}</span><span class="mt"><i style="background:${statusDot(m.s)}"></i>${esc(m.text)}</span></span></button>`;
    }).join('');
    if (R) return `<div class="s-head" style="cursor:default">작업공간</div>${realSideHTML()}<div class="s-sec">팀 시연<span class="rtag sim">시뮬레이션</span></div>${items}`;
    return `<div class="s-head" style="cursor:default">작업공간</div><div class="s-sec">내 워크스페이스</div>${items}
      <button class="s-add" data-act="create-open">${ico('plus', 15)}새 워크스페이스</button>`;
  }

  function serverChip(E) {
    if (!E.host) return '';
    if (E.server === 'running') return `<span class="chip ok"><i></i>${esc(E.host)} · :${E.port}</span>`;
    if (E.server === 'starting') return `<span class="chip warn"><i></i>시작 중 · ${esc(E.host)}</span>`;
    return `<span class="chip"><i></i>서버 꺼짐 · ${esc(E.host)}</span>`;
  }

  function homePane() {
    if (R && realSel && realWs(realSel)) return realHomePane();
    const v = ui.viewer, w = curWs(), E = env();
    const status = ui.wsStatus[v][w.id];
    const head = `<div class="h-head">
      <div class="grow"><h1>${esc(w.name)} <span class="tagk">${w.kind === 'team' ? `팀 · ${w.members.length}명` : '개인'}</span></h1>
        <div class="chips">${serverChip(E)}<span class="chip">${ico('lock', 13)}${esc(E.account)}</span><span class="chip">${ico('dl', 13)}${esc(E.download)}</span></div></div>
      <div class="acts"><button class="btn" data-act="vscode">${ico('code', 15)}VS Code로 열기</button>
        ${status === 'sleep' ? '<button class="btn primary" data-act="wake">깨우기</button>' : `<button class="btn" data-act="sleep">${ico('moon', 15)}잠자기</button>`}</div></div>`;
    if (status === 'sleep') {
      return `<div class="home">${head}<div class="sleep">${ico('moon', 30)}<b>잠자기 중</b><span>탭과 브라우저 리소스를 멈췄어요. 프로세스를 끈 것과는 달라요.</span><button class="btn primary" data-act="wake">깨우기</button></div></div>`;
    }
    const tabs = tabsOf();
    if (E.tab >= tabs.length) E.tab = 0;
    const firstPrivate = tabs.findIndex(t => t.private);
    const strip = tabs.map((t, i) => `${i === firstPrivate && i > 0 ? '<span class="tsep"></span>' : ''}<button class="tb ${i === E.tab ? 'on' : ''} ${t.private ? 'priv' : ''} ${t.fresh ? 'fresh' : ''}" data-act="tab" data-i="${i}" title="${t.shared ? '팀 공유 고정 탭' : t.private ? '내 개인 탭 · 팀에 공유되지 않아요' : ''}">${t.shared ? ico('pin', 12, 1.4) : ''}${esc(t.title)}${t.fresh ? '<span class="newdot">NEW</span>' : ''}</button>`).join('');
    let sync = '';
    if (w.id === 'capstone') {
      const t = S.tabsFor(st, v);
      sync = isLead(v, w)
        ? `공유 구성 v${st.team.version} · ${Object.keys(st.team.synced).filter(k => k !== 'prof').map(k => `${esc(U[k].name)} ${st.team.synced[k] === st.team.version ? '✓' : '대기'}`).join(' · ')}`
        : `팀장 설정 v${t.version} 반영됨`;
    }
    const addRow = ui.tabAdd ? `<div class="tab-add"><input id="tabname" placeholder="탭 이름 또는 URL" data-enter="tab-mine" autocomplete="off">
      <button class="btn" data-act="tab-mine">${w.kind === 'team' ? '내 탭으로' : '추가'}</button>
      ${isLead(v, w) && w.id === 'capstone' ? '<button class="btn primary" data-act="tab-shared">팀 공유 탭으로</button>' : ''}
      <button class="icon-btn" data-act="tab-add-close" aria-label="닫기">${ico('x', 15)}</button></div>` : '';
    const cur = tabs[E.tab] || { title: '' };
    return `<div class="home">${head}
      <div class="tabbar">${strip}<button class="tb add" data-act="tab-add" aria-label="탭 추가">${ico('plus', 14)}</button><span class="sync">${sync}</span></div>
      ${addRow}
      <div class="browser">
        <div class="sess">${ico('lock', 13)}<span>이 워크스페이스 전용 세션</span><code>${esc(E.partition)}</code><span class="grow"></span>
          ${E.loggedIn ? `<span class="who">${esc(E.email)}</span><button class="btn sm" data-act="logout">로그아웃</button>` : '<button class="btn sm primary" data-act="login">로그인</button>'}</div>
        <div class="page">${pageHTML(v, w, E, cur)}</div>
      </div>
      <div class="h-bottom">${terminalHTML(w, E)}${homeCard(v, w, E)}</div>
    </div>`;
  }

  function pageHTML(v, w, E, tab) {
    if (!E.loggedIn) {
      const others = myWs(v).filter(x => x.id !== w.id && env(v, x.id).loggedIn).map(x => esc(x.name));
      return `<div class="blank">${ico('lock', 26)}<b>${esc(w.name)}에서 로그아웃된 상태예요</b><span>${others.length ? `${others.join(', ')}의 로그인은 그대로예요.` : '다른 워크스페이스 로그인에는 영향이 없어요.'}</span></div>`;
    }
    if (/localhost/.test(tab.title)) {
      if (E.server !== 'running') return `<div class="blank"><b>${esc(E.host)}에 연결할 수 없어요</b><span>서버가 꺼져 있어요.</span><button class="btn primary" data-act="server-start">서버 시작</button></div>`;
      return `<div class="pg-h">${esc(E.host)}</div><div class="pg-m">개발 서버 · 포트 ${E.port} · 이 워크스페이스 터미널에서 실행 중</div><div class="sk w60"></div><div class="sk w80"></div><div class="sk blk"></div>`;
    }
    const dlName = /\.pdf$/i.test(tab.title) ? tab.title : '중간발표_초안.pdf';
    return `<div class="pg-row"><div class="grow"><div class="pg-h">${esc(tab.title)}</div><div class="pg-m">${esc(E.email)} 로 로그인됨</div></div>
      <button class="btn sm" data-act="download" data-file="${esc(dlName)}">${ico('dl', 14)}${esc(dlName)} 받기</button></div>
      <div class="sk w60"></div><div class="sk w80"></div><div class="sk w40"></div><div class="sk blk"></div>`;
  }

  function terminalHTML(w, E) {
    const lines = E.term.slice(-9).map(([t, s]) => `<div class="l-${t}">${esc(s)}</div>`).join('');
    const ctl = E.cmd ? (E.server === 'running' ? '<button class="tbtn" data-act="server-stop">■ 중지</button>' : `<button class="tbtn" data-act="server-start">▶ ${esc(E.cmd)}</button>`) : '';
    return `<div class="hterm"><div class="hterm-h"><span>PowerShell · ${esc(E.folder)}</span><span class="grow"></span>${ctl}</div>
      <div class="hterm-b" id="htermbody">${lines || '<div class="l-dim">help 를 입력해 보세요</div>'}</div>
      <div class="hterm-in"><span>&gt;</span><input id="term-${w.id}" data-enter="hterm" placeholder="help · pwd · npm run dev · echo $env:DATABASE_URL" autocomplete="off" spellcheck="false" aria-label="터미널 입력"></div></div>`;
  }

  function homeCard(v, w, E) {
    const task = myTasks(v).find(t => t.ws === w.id);
    const others = myWs(v).filter(x => x.id !== w.id).map(x => {
      const m = wsMeta(v, x);
      return `<button class="bg-row" data-act="ws" data-id="${x.id}"><i style="background:${statusDot(m.s)}"></i><span class="grow">${esc(x.name)}</span><span class="mt">${esc(m.text.split(' · ').slice(2).join(' · ') || STATUS_LABEL[m.s])}</span></button>`;
    }).join('');
    return `<div class="h-card">
      ${task ? `<div class="hc-sec">마감</div><button class="hc-task" data-act="task-open" data-id="${task.id}"><span class="grow">${esc(task.title)}</span><span class="dd ${task.due <= 3 ? 'soon' : ''}">${dday(task.due)}</span></button>
        <div class="prog"><i style="width:${Math.round(taskDone(task) / task.items.length * 100)}%;background:${w.color}"></i></div>
        ${ui.openTask[ui.viewer] === task.id ? `<div class="hc-items">${checklist(task)}</div>` : ''}` : ''}
      ${E.downloads.length ? `<div class="hc-sec">받은 파일</div>${E.downloads.slice(-3).map(d => `<div class="dl-row">${ico('dl', 13)}<span class="grow">${esc(d.name)}</span><span class="mt">${esc(E.download)}</span></div>`).join('')}` : ''}
      <div class="hc-sec">다른 워크스페이스</div>${others || '<div class="mt">없음</div>'}
    </div>`;
  }

  // ───────────────────────── 실제 워크스페이스 (Electron · 데모 브랜치) ─────────────────────────
  // window.cadora(preload)로만 동작한다. 폴더 경로·탭·환경변수는 이 PC에만 있고 팀 이벤트로 보내지 않는다.
  const realWs = id => (R ? R.state.workspaces.find(w => w.id === id) || null : null);
  function realColor(w) { let h = 0; for (const c of w.id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return REAL_COLORS[h % REAL_COLORS.length]; }
  function realShort(w) { const n = String(w.name).trim(); return /^[A-Za-z0-9]/.test(n) ? n.slice(0, 2).toUpperCase() : [...n].slice(0, 2).join(''); }
  const REAL_STATE = { active: '활성', background: '백그라운드', sleep: '잠자기' };
  const RUN_LABEL = { starting: '시작 중', working: '작업 중', waiting: '내 확인 필요', done: '완료 (아직 안 봄)', idle: '대기', exited: '종료됨' };
  const realStatus = w => (realSel === w.id && ui.view === 'home' && w.state !== 'sleep' ? 'active' : w.state);
  function realMeta(w) {
    const parts = [REAL_STATE[realStatus(w)] || w.state, w.type];
    const runs = (R.state.agents[w.id] || []).filter(r => r.status !== 'exited').length;
    if (runs) parts.push(`에이전트 ${runs}`);
    return parts.join(' · ');
  }
  // Cadora 계정: 실제 서버(CADORA_SERVER_URL)의 GitHub Device Flow. 토큰은 화면에 오지 않고 main에만 있다.
  function realAccountHTML() {
    const A = R.state.auth;
    const head = '<div class="s-sec">Cadora 계정<span class="rtag real">실제</span></div>';
    if (A.status === 'authenticated' && A.me) {
      const me = A.me;
      const av = me.avatarUrl ? `<img src="${esc(me.avatarUrl)}" alt="" referrerpolicy="no-referrer">` : esc([...String(me.displayName || '?')][0] || '?');
      return `${head}<div class="racct" data-real-account="in"><span class="racct-av">${av}</span>
        <span class="grow"><span class="nm">${esc(me.displayName)}</span><span class="mt">GitHub로 로그인됨</span></span>
        <button class="btn sm" data-act="real-account-logout">로그아웃</button></div>`;
    }
    if (A.status === 'checking' || A.status === 'authenticated') return `${head}<div class="racct"><span class="mt">계정 확인 중…</span></div>`;
    if (A.status === 'offline') {
      return `${head}<div class="racct col" data-real-account="offline"><span class="mt">${esc(A.message || 'Cadora 서버에 연결할 수 없어요.')}</span>
        <button class="btn sm" data-act="real-account-retry">다시 시도</button></div>`;
    }
    const note = A.message && !(ui.modal && ui.modal.type === 'real-login') ? `<div class="rnote racct-note">${esc(A.message)}</div>` : '';
    return `${head}<button class="s-add racct-login" data-act="real-login" ${A.busy ? 'disabled' : ''}>${ico('lock', 15)}GitHub로 로그인</button>${note}`;
  }

  function realSideHTML() {
    const items = R.state.workspaces.map(w => `<button class="s-item tall ${realSel === w.id ? 'on' : ''}" data-act="real-ws" data-id="${esc(w.id)}">
        <span class="wsq" style="background:${realColor(w)}">${esc(realShort(w))}</span>
        <span class="grow"><span class="nm">${esc(w.name)}</span><span class="mt"><i style="background:${statusDot(realStatus(w))}"></i>${esc(realMeta(w))}</span></span></button>`).join('');
    return `${realAccountHTML()}<div class="s-sec">이 PC<span class="rtag real">실제</span></div>${items || '<div class="rnote" style="padding:2px 18px 6px;color:var(--side-mute)">아직 없어요. 만들면 폴더 · 브라우저 세션 · 터미널이 따로 생겨요.</div>'}
      <button class="s-add" data-act="real-create-open">${ico('plus', 15)}새 워크스페이스</button>`;
  }
  const fmtClock = iso => { const d = new Date(iso); return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`; };

  function realHomePane() {
    const w = realWs(realSel);
    const RS = R.state;
    const info = RS.info || {};
    const sleeping = w.state === 'sleep';
    const head = `<div class="h-head">
      <div class="grow"><h1>${esc(w.name)} <span class="tagk">개인 · ${esc(w.type)}</span><span class="rtag real">이 PC에서 실제로 동작</span></h1>
        <div class="chips">
          <button class="chip rfolder" data-act="real-folder" title="탐색기에서 열기 · ${esc(w.localPath)}">${ico('code', 13)}${esc(w.localPath)}</button>
          <span class="chip" title="이 워크스페이스 전용 브라우저 세션">${ico('lock', 13)}${esc(w.partition)}</span>
          <button class="chip" data-act="real-dl-folder" title="받은 파일 폴더 열기">${ico('dl', 13)}${esc(w.downloadDir)}</button></div></div>
      <div class="acts">
        ${sleeping ? '<button class="btn primary" data-act="real-wake">깨우기</button>' : `<button class="btn" data-act="real-sleep">${ico('moon', 15)}잠자기</button>`}
        <button class="btn" data-act="real-remove-open" title="워크스페이스 삭제 (폴더는 남겨요)">${ico('x', 15)}</button></div></div>`;
    if (sleeping) {
      return `<div class="home">${head}<div class="sleep">${ico('moon', 30)}<b>잠자기 중</b><span>브라우저 탭을 닫아 메모리를 돌려받았어요. 탭 주소와 터미널 · 에이전트 프로세스는 그대로예요.</span><button class="btn primary" data-act="real-wake">깨우기</button></div></div>`;
    }
    const T = RS.tabs[w.id] || { tabs: [], activeTabId: null };
    const cur = T.tabs.find(t => t.id === T.activeTabId) || null;
    const strip = T.tabs.map(t => `<button class="tb priv ${t.id === T.activeTabId ? 'on' : ''}" data-act="real-tab" data-id="${esc(t.id)}" title="${esc(t.url)}">${t.loading ? '<span class="ld"></span>' : ''}${esc((t.title || t.url).slice(0, 28))}<span class="x" data-act="real-tab-close" data-id="${esc(t.id)}" title="탭 닫기">✕</span></button>`).join('');
    const addrId = 'real-addr-' + w.id;
    const typing = document.activeElement && document.activeElement.id === addrId ? document.activeElement.value : null;
    const nav = `<div class="rnav">
        <button class="icon-btn" data-act="real-nav" data-a="back" ${cur && cur.canGoBack ? '' : 'disabled'} aria-label="뒤로">${ico('left', 15)}</button>
        <button class="icon-btn" data-act="real-nav" data-a="forward" ${cur && cur.canGoForward ? '' : 'disabled'} aria-label="앞으로">${ico('right', 15)}</button>
        <button class="icon-btn" data-act="real-nav" data-a="reload" ${cur ? '' : 'disabled'} aria-label="새로고침">⟳</button>
        <input id="${esc(addrId)}" data-norestore data-enter="real-go" placeholder="주소를 넣으면 ${cur ? '이 탭에서' : '새 탭으로'} 열어요 (예: github.com)" value="${esc(typing !== null ? typing : cur ? cur.url : '')}" autocomplete="off" spellcheck="false">
        <button class="btn sm" data-act="real-tab-new" title="새 탭">${ico('plus', 13)}새 탭</button>
        <button class="btn sm" data-act="real-ext" ${cur ? '' : 'disabled'} title="로그인이 막히는 서비스는 이 워크스페이스 전용 Edge 프로필로 열어요">Edge 프로필로</button></div>`;
    const page = T.tabs.length
      ? '<div class="rpage" data-real-slot="page"></div>'
      : `<div class="rpage"><div class="blank">${ico('lock', 26)}<b>이 워크스페이스 전용 브라우저</b><span>여기서 로그인해도 다른 워크스페이스에는 영향이 없어요. 위 주소창에 주소를 넣어 보세요.</span></div></div>`;
    const terms = RS.terminals[w.id] || [];
    const activeTerm = RS.activeTerm[w.id];
    const ttabs = terms.map(t => `<button class="tt ${t.termId === activeTerm ? 'on' : ''}" data-act="real-term" data-id="${esc(t.termId)}"><span class="dot ${t.alive ? 'alive' : ''}"></span>${esc(t.title)}<span class="x" data-act="real-term-close" data-id="${esc(t.termId)}" title="닫기 (프로세스 트리 종료)">✕</span></button>`).join('');
    const term = `<div class="rterm"><div class="rterm-h">${ttabs}<span class="grow"></span>
        <button class="tbtn" data-act="real-term-new">+ PowerShell</button>
        <button class="tbtn claude" data-act="real-agent-open" ${info.claudeAvailable ? '' : 'disabled title="Claude Code를 찾지 못했어요"'}>▶ Claude Code</button></div>
        ${terms.length ? '<div class="rterm-slot" data-real-slot="term"></div>' : '<div class="rterm-empty">터미널이 없어요. + PowerShell로 여세요.</div>'}</div>`;
    return `<div class="home">${head}
      <div class="tabbar">${strip}<span class="sync">${T.tabs.length ? `탭 ${T.tabs.length}개 · 앱을 다시 켜도 남아요` : ''}</span></div>
      <div class="browser">
        <div class="sess">${ico('lock', 13)}<span>이 워크스페이스 전용 세션</span><code>${esc(w.partition)}</code><span class="grow"></span>
          <button class="btn sm" data-act="real-logout" title="이 워크스페이스의 쿠키 · 저장소만 지워요">이 세션만 로그아웃</button></div>
        ${nav}${page}
      </div>
      <div class="h-bottom">${term}${realCard(w)}</div>
    </div>`;
  }

  function realCard(w) {
    const RS = R.state, info = RS.info || {};
    const runs = (RS.agents[w.id] || []).slice().reverse();
    const files = (RS.files[w.id] || []).slice(0, 8);
    const dls = (RS.downloads[w.id] || []).slice(-3).reverse();
    const others = RS.workspaces.filter(x => x.id !== w.id);
    const runRows = runs.map(r => `<div class="rrun"><span class="st ${esc(r.status)}">${esc(RUN_LABEL[r.status] || r.status)}</span><span class="grow ellip" title="관찰 수준: ${r.observe === 'hooks' ? 'Claude Code hooks' : '프로세스만'}">${esc(r.taskTitle)}</span>${r.status !== 'exited' ? `<button class="btn sm" data-act="real-agent-stop" data-id="${esc(r.runId)}">중지</button>` : ''}</div>`).join('');
    const fileRows = files.map(f => `<div class="rfile"><span class="cat ${f.shared ? 'shared' : ''}">${esc(f.label)}</span><code class="grow" title="${esc(f.relativePath)}">${esc(f.relativePath)}</code><span class="src">${f.source === 'watcher' ? '감시' : 'hook'} · ${esc(fmtClock(f.at))}</span></div>`).join('');
    const envRows = w.env.map(e => `<div class="renv"><code class="grow">${esc(e.name)}=${esc(e.masked)}</code><button class="icon-btn" style="width:22px;height:22px" data-act="real-env-del" data-name="${esc(e.name)}" aria-label="삭제">${ico('x', 12)}</button></div>`).join('');
    return `<div class="h-card rcard-scroll">
      <div class="hc-sec">에이전트 (Claude Code)</div>${runRows || `<div class="rnote">${info.claudeAvailable ? '▶ Claude Code로 이 폴더에서 실행해요. 상태는 hook으로 받아요.' : 'Claude Code를 찾지 못했어요.'}</div>`}
      <div class="hc-sec">파일 변경 <span class="rnote">상대경로 · 분류만 · .env · 키는 제외</span></div>${fileRows || '<div class="rnote">폴더의 파일을 바꾸면 여기 보여요.</div>'}
      <div class="hc-sec">받은 파일</div>${dls.map(d => `<div class="dl-row">${ico('dl', 13)}<span class="grow ellip" title="${esc(d.savedTo)}">${esc(d.fileName)}</span></div>`).join('') || '<div class="rnote">이 워크스페이스 브라우저에서 받은 파일은 자료 폴더로 가요.</div>'}
      <div class="hc-sec">환경변수 <span class="rnote">${info.secretStore ? '값은 Windows 계정으로 암호화' : '암호화를 쓸 수 없어 저장 불가'}</span></div>${envRows}
      <div class="renv-add"><input id="real-env-name" placeholder="이름 (예: OPENAI_API_KEY)" autocomplete="off" spellcheck="false"><input id="real-env-value" type="password" placeholder="값" autocomplete="off" data-enter="real-env-add"><button class="btn sm" data-act="real-env-add">추가</button></div>
      <div class="rnote">이 워크스페이스의 터미널 · 에이전트에만 들어가요. 화면에는 가린 값만 보여요.</div>
      ${others.length ? `<div class="hc-sec">다른 워크스페이스</div>${others.map(x => `<button class="bg-row" data-act="real-ws" data-id="${esc(x.id)}"><i style="background:${statusDot(x.state)}"></i><span class="grow">${esc(x.name)}</span><span class="mt">${esc(REAL_STATE[x.state] || '')}</span></button>`).join('')}` : ''}
    </div>`;
  }

  const REAL_TYPES = ['과제', '팀 프로젝트', '개인 프로젝트', '기타'];
  function realModalHTML(m) {
    if (m.type === 'real-create') {
      return `<h2>새 워크스페이스 <span class="rtag real">실제</span></h2>
        <div class="sub">폴더 · 브라우저 세션 · 다운로드 폴더 · 터미널이 이 워크스페이스 전용으로 생겨요. 이 PC에만 저장돼요.</div>
        <div class="mlabel">이름</div><div class="field-row"><input id="r-name" data-input="r-name" data-norestore data-enter="real-create-submit" value="${esc(m.name || '')}" placeholder="예: 알고리즘 과제 2" autocomplete="off"></div>
        <div class="mlabel">종류</div><div class="seg">${REAL_TYPES.map(t => `<button class="${m.wtype === t ? 'on' : ''}" data-act="real-create-type" data-t="${t}">${t}</button>`).join('')}</div>
        <div class="mlabel">폴더</div><div class="field-row"><code class="grow ellip" style="font-size:12.5px">${m.folder ? esc(m.folder) : '기본 위치: 문서\\Cadora\\(이름)'}</code><button class="btn sm" data-act="real-create-pick">폴더 선택…</button>${m.folder ? '<button class="btn sm" data-act="real-create-default">기본 위치</button>' : ''}</div>
        ${m.err ? `<div class="merr">${esc(m.err)}</div>` : ''}
        <div class="mrow"><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="real-create-submit" ${m.busy ? 'disabled' : ''}>만들기</button></div>`;
    }
    if (m.type === 'real-tab') {
      return `<h2>새 탭</h2><div class="sub">이 워크스페이스 전용 세션으로 열어요.</div>
        <div class="field-row"><input id="r-url" data-norestore data-enter="real-tab-open" placeholder="주소 (예: github.com)" autocomplete="off" spellcheck="false"></div>
        <div class="mrow"><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="real-tab-open">열기</button></div>`;
    }
    if (m.type === 'real-agent') {
      return `<h2>Claude Code 실행</h2>
        <div class="sub">이 워크스페이스 폴더에서 Claude Code를 터미널로 띄워요. 프롬프트는 터미널에 직접 입력해요. 작업 제목은 Cadora 화면에만 쓰여요.</div>
        <div class="mlabel">작업 제목</div><div class="field-row"><input id="r-title" data-input="r-title" data-norestore data-enter="real-agent-start" value="${esc(m.title || '')}" placeholder="예: 로그인 폼 검증 추가" autocomplete="off"></div>
        <div class="rnote" style="margin-top:8px">상태(작업 중 · 내 확인 필요 · 완료)는 Claude Code hooks로 받아요. hook 설정은 이 폴더의 .claude/settings.local.json에 넣고 git에서 빼 둬요.</div>
        ${m.err ? `<div class="merr">${esc(m.err)}</div>` : ''}
        <div class="mrow"><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="real-agent-start">실행</button></div>`;
    }
    if (m.type === 'real-login') {
      const A = R.state.auth;
      const p = A.pending;
      const srv = (R.state.info && R.state.info.authServer) || '설정 오류(CADORA_SERVER_URL)';
      const h = '<h2>GitHub로 로그인 <span class="rtag real">실제</span></h2>';
      if (!p && (A.busy || A.status === 'pending')) {
        return `${h}<div class="sub">GitHub 로그인 코드를 받는 중이에요…</div><div class="rnote">서버 ${esc(srv)}</div>
          <div class="mrow"><button class="btn" data-act="real-login-cancel">취소</button></div>`;
      }
      if (!p) {
        return `${h}<div class="merr" data-real-login-error>${esc(A.message || '로그인하지 못했어요.')}</div><div class="rnote" style="margin-top:8px">서버 ${esc(srv)}</div>
          <div class="mrow"><button class="btn" data-act="modal-close">닫기</button><button class="btn primary" data-act="real-login-retry">다시 시도</button></div>`;
      }
      const mins = Math.max(1, Math.round((new Date(p.expiresAt).getTime() - Date.now()) / 60000));
      return `${h}<div class="sub">GitHub 페이지에 아래 코드를 넣고 승인하면 이 앱이 자동으로 로그인돼요. 코드는 ${mins}분 동안 쓸 수 있어요.</div>
        <div class="rcode" data-real-code>${esc(p.userCode)}</div>
        <div class="rnote"><span class="ld-dot"></span>GitHub 승인을 기다리는 중 · 서버 ${esc(srv)}</div>
        <div class="rnote">Cadora는 GitHub 공개 프로필(이름 · 아바타)만 읽어요. 저장소 권한은 요청하지 않아요.</div>
        <div class="mrow"><button class="btn" data-act="real-login-cancel">취소</button><button class="btn primary" data-act="real-login-open">코드 복사하고 GitHub 열기</button></div>`;
    }
    if (m.type === 'real-remove') {
      const w = realWs(m.id);
      return `<h2>워크스페이스 삭제</h2>
        <div class="sub">${esc(w ? w.name : '')}의 브라우저 로그인 · 탭 · 터미널을 정리해요. 폴더와 받은 파일은 지우지 않아요.</div>
        <div class="mrow"><button class="btn" data-act="modal-close">취소</button><button class="btn danger" data-act="real-remove">삭제</button></div>`;
    }
    return '';
  }

  const curTab = () => { const T = R.state.tabs[realSel]; return T ? T.tabs.find(t => t.id === T.activeTabId) : null; };
  const REAL_ACTIONS = R ? {
    'real-ws': d => { realSel = d.id; ui.view = 'home'; ui.menu = null; R.select(d.id).then(() => later(50, () => R.focusTerminal(d.id))); },
    'real-create-open': () => { ui.menu = null; ui.modal = { type: 'real-create', name: '', wtype: '과제', folder: null }; later(0, () => { const el = document.getElementById('r-name'); if (el) el.focus(); }); },
    'real-create-type': d => { ui.modal.wtype = d.t; },
    'real-create-pick': () => { const m = ui.modal; R.pickFolder().then(p => { if (p && ui.modal === m) { m.folder = p; render(); } }); },
    'real-create-default': () => { ui.modal.folder = null; },
    'real-create-submit': () => {
      const m = ui.modal; if (!m || m.busy) return;
      const name = (m.name || '').trim();
      if (!name) { m.err = '이름을 입력해 주세요'; return; }
      m.busy = true;
      R.create({ name, type: m.wtype, ...(m.folder ? { localPath: m.folder } : {}) }).then(w => {
        m.busy = false;
        if (!w) { m.err = '만들지 못했어요. 이름이나 폴더를 확인해 주세요.'; render(); return; }
        ui.modal = null; realSel = w.id; ui.view = 'home';
        toast(`${esc(w.name)} 만들었어요 — 세션 ${esc(w.partition)}`);
        R.select(w.id);
      });
    },
    'real-tab': (d, t, e) => { if (e && e.target.closest('.x')) return; R.selectTab(realSel, d.id); },
    'real-tab-close': d => { R.closeTab(realSel, d.id); },
    'real-tab-new': () => { ui.modal = { type: 'real-tab' }; later(0, () => { const el = document.getElementById('r-url'); if (el) el.focus(); }); },
    'real-tab-open': () => { const el = document.getElementById('r-url'); const v = el ? el.value.trim() : ''; if (!v) return; ui.modal = null; R.openTab(realSel, v); },
    'real-go': (d, t) => {
      const v = (t.value || '').trim(); if (!v) return;
      const cur = curTab();
      if (cur) R.navigate(realSel, cur.id, { url: v });
      else R.openTab(realSel, v);
      t.blur();
    },
    'real-nav': d => { const cur = curTab(); if (cur) R.navigate(realSel, cur.id, d.a); },
    'real-ext': () => { const cur = curTab(); if (cur) R.openExternal(realSel, cur.url).then(() => toast('이 워크스페이스 전용 Edge 프로필로 열었어요')); },
    'real-logout': () => { const w = realWs(realSel); R.clearSession(realSel).then(() => toast(`${esc(w.name)}에서만 로그아웃했어요 — 다른 워크스페이스 로그인은 그대로예요`)); },
    'real-folder': () => { R.openFolder(realSel); },
    'real-dl-folder': () => { R.openDownloadFolder(realSel); },
    'real-sleep': () => { const w = realWs(realSel); R.sleep(realSel).then(() => toast(`${esc(w.name)} 잠자기 — 탭을 닫아 메모리를 돌려받았어요. 프로세스는 그대로예요`)); },
    'real-wake': () => { R.wake(realSel).then(() => R.select(realSel)); },
    'real-remove-open': () => { ui.modal = { type: 'real-remove', id: realSel }; },
    'real-remove': () => { const id = ui.modal.id; ui.modal = null; realSel = null; R.remove(id).then(() => toast('워크스페이스를 삭제했어요 — 폴더는 남겨 뒀어요')); },
    'real-term': (d, t, e) => { if (e && e.target.closest('.x')) return; R.selectTerminal(realSel, d.id); later(30, () => R.focusTerminal(realSel)); },
    'real-term-close': d => { R.closeTerminal(d.id); },
    'real-term-new': () => { R.newTerminal(realSel).then(() => later(50, () => R.focusTerminal(realSel))); },
    'real-agent-open': () => { ui.modal = { type: 'real-agent', title: '' }; later(0, () => { const el = document.getElementById('r-title'); if (el) el.focus(); }); },
    'real-agent-start': () => {
      const m = ui.modal; const title = ((m && m.title) || '').trim();
      if (!title) { m.err = '작업 제목을 입력해 주세요'; return; }
      ui.modal = null;
      R.startAgent(realSel, title).then(() => later(80, () => R.focusTerminal(realSel)));
    },
    'real-agent-stop': d => { R.stopAgent(d.id); },
    'real-login': () => { ui.menu = null; ui.modal = { type: 'real-login' }; R.login(); },
    'real-login-retry': () => { R.login(); },
    'real-login-open': () => { R.openLoginPage().then(() => toast('코드를 복사했어요 — 열린 GitHub 페이지에 붙여 넣으세요')); },
    'real-login-cancel': () => { ui.modal = null; R.cancelLogin(); },
    'real-account-logout': () => { R.logoutAccount().then(() => toast('로그아웃했어요 — 이 PC에 저장된 로그인 정보도 지웠어요')); },
    'real-account-retry': () => { R.retryAccount(); },
    'real-env-add': () => {
      const n = document.getElementById('real-env-name'), v = document.getElementById('real-env-value');
      const name = n ? n.value.trim() : '', value = v ? v.value : '';
      if (!name || !value) { toast('이름과 값을 모두 넣어 주세요'); return; }
      if (v) v.value = '';   // 비밀값은 화면에 남기지 않는다(저장 중에 다시 그려져도 복원되지 않게 먼저 비운다)
      R.setEnv(realSel, name, value).then(w => {
        // 저장하는 사이 화면이 다시 그려졌을 수 있으니 지금 있는 입력칸을 id로 다시 찾는다.
        const nn = document.getElementById('real-env-name'), vv = document.getElementById('real-env-value');
        if (vv) vv.value = '';
        if (w) { if (nn) nn.value = ''; toast(`${esc(name)} 저장 — 값은 암호화해 두고 화면에는 가려서 보여요`); }
      });
    },
    'real-env-del': d => { R.removeEnv(realSel, d.name); },
  } : {};

  function runCommand(E, raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    const out = (t, s) => E.term.push([t, s]);
    out('cmd', cmd);
    const c = cmd.toLowerCase();
    let m;
    if (c === 'help') out('dim', 'pwd · ls · npm run dev · stop · git branch · echo $env:이름 · env · clear');
    else if (c === 'pwd') out('dim', E.win);
    else if (c === 'ls' || c === 'dir') out('dim', E.files.join('    ') || '(비어 있음)');
    else if (E.cmd && c === E.cmd.toLowerCase()) startServer(E, true);
    else if (/^(npm (run )?(dev|start|preview)|docker compose up.*)$/.test(c)) startServer(E, true);
    else if (c === 'stop' || c === '^c') stopServer(E);
    else if (c === 'git branch') out('dim', '* ' + (E.branch || 'main'));
    else if ((m = cmd.match(/^echo\s+\$(?:env:)?([A-Za-z_][A-Za-z0-9_]*)$/i))) {
      const name = m[1].toUpperCase(), val = E.env[name];
      out(val === undefined ? 'warn' : 'dim', val === undefined ? `${name} — 이 워크스페이스에는 없는 환경변수예요` : S.maskEnv(name, val) + (S.isSecretName(name) ? '   (비밀값은 화면·로그에서 가려요)' : ''));
    } else if (c === 'env') {
      const ks = Object.keys(E.env);
      if (!ks.length) out('dim', '(지정된 환경변수 없음)');
      ks.forEach(k => out('dim', `${k}=${S.maskEnv(k, E.env[k])}`));
    } else if (c === 'clear' || c === 'cls') E.term = [];
    else out('warn', `'${cmd}' — 프로토타입에서는 지원하지 않는 명령이에요 (help)`);
  }
  function startServer(E, fromTerm) {
    if (!E.host) { E.term.push(['warn', E.cmd ? `${E.cmd} 실행 완료 (서버 없음)` : '실행 명령이 없는 워크스페이스예요']); return; }
    if (E.server === 'running') { E.term.push(['dim', `이미 실행 중 · http://${E.host}`]); return; }
    if (!fromTerm) E.term.push(['cmd', E.cmd]);
    E.server = 'starting';
    later(900, () => { E.server = 'running'; E.term.push(['ok', `http://${E.host} (포트 ${E.port} 자동 배정)`]); });
  }
  function stopServer(E) {
    if (E.server !== 'running') { E.term.push(['dim', '실행 중인 서버가 없어요']); return; }
    E.server = 'stopped';
    const others = myWs().map(x => env(ui.viewer, x.id)).filter(x => x !== E && x.server === 'running').map(x => x.host);
    E.term.push(['dim', `서버를 껐어요 — 이 워크스페이스만${others.length ? ` (${others.join(', ')} 은 계속 실행 중)` : ''}`]);
  }
  function doDownload(E, file) {
    const same = E.downloads.filter(d => d.base === file).length;
    const name = same ? file.replace(/(\.[^.]+)$/, ` (${same})$1`) : file;
    E.downloads.push({ base: file, name, at: new Date() });
    toast(`${esc(name)} → <b>${esc(E.download)}</b> 폴더에 저장했어요`, { label: '폴더 열기', fn: () => toast(`탐색기에서 ${esc(E.win)}\\자료 열기`) });
  }

  // ───────────────────────── 활동 (FR-14 · 15 · 17) ─────────────────────────
  function feedItems(v) {
    if (curId() !== 'capstone') return [];
    const items = st.feed.map(m => Object.assign({ type: m.kind }, m));
    for (const e of S.visibleEvents(st, v)) {
      const p = e.payload;
      if (p.type === 'agent_run') items.push({ type: 'bot-run', at: e.at, seq: evSeq(e.id), ev: e });
      else if (p.type === 'file_change' && p.branch === st.team.base) items.push({ type: 'bot-main', at: e.at, seq: evSeq(e.id), ev: e });
    }
    for (const a of alertsFor(v)) items.push({ type: 'eph', at: latestAt(a.evidence), seq: Math.max(...a.evidence.map(evSeq)) + 0.2, alert: a });
    const told = new Set();
    for (const e of st.events) {
      if (e.user !== v || !e.payload || e.payload.type !== 'file_change') continue;
      for (const c of S.alertsCausedBy(st, v, e.id)) {
        const k = c.user + c.alert.key;
        if (told.has(k)) continue;
        told.add(k);
        items.push({ type: 'eph-info', at: e.at, seq: evSeq(e.id) + 0.3, info: c, ev: e });
      }
    }
    return items.sort((a, b) => (a.at - b.at) || ((a.seq || 0) - (b.seq || 0)));
  }
  const FILTERS = [
    { id: 'all', label: '전체', test: () => true },
    { id: 'mine', label: '나에게 온 알림', test: it => it.type === 'eph' || it.type === 'eph-info' },
    { id: 'agents', label: '에이전트', test: it => it.type === 'bot-run' },
    { id: 'main', label: 'main 반영 · 팀 설정', test: it => it.type === 'bot-main' || it.type === 'bot-text' },
  ];

  function activitySide() {
    const w = curWs();
    const all = feedItems(ui.viewer);
    const filters = curId() === 'capstone' ? FILTERS.map(f => {
      const n = all.filter(f.test).length;
      return `<button class="s-item ${ui.feedFilter === f.id ? 'on' : ''}" data-act="feed-filter" data-f="${f.id}">${esc(f.label)}<span class="n">${n}</span></button>`;
    }).join('') : '<div class="s-empty">팀 활동이 없어요</div>';
    const tools = w.kind === 'team'
      ? `<button class="s-item" data-act="discord">${ico('discord', 15)}Discord ${esc(w.discord)}<span class="cnt">${w.unread}</span></button>
         <button class="s-item" data-act="vscode">${ico('code', 15)}VS Code에서 열기</button>`
      : `<button class="s-item" data-act="vscode">${ico('code', 15)}VS Code에서 열기</button>`;
    return `${wsHead()}<div class="s-sec">보기</div>${filters}<div class="s-sec">연결된 도구</div>${tools}`;
  }

  const avHTML = (u, size) => `<span class="av" style="background:${PEOPLE[u]};width:${size}px;height:${size}px">${initial(u)}</span>`;
  function msgShell(at, body, cont) {
    if (cont) return `<div class="msg cont"><span class="gutter">${hm(at)}</span><div class="mb"><div class="mx">${body}</div></div></div>`;
    return `<div class="msg"><span class="av cadora" style="width:36px;height:36px">C</span><div class="mb"><div class="mh"><span class="mn">Cadora</span><span class="mt">${ampm(at)}</span></div><div class="mx">${body}</div></div></div>`;
  }

  function alertButtons(a, viewer) {
    const id = viewer + '|' + a.key;
    const b = [];
    if (a.actions.includes('notify') && a.status !== 'notified') b.push(`<button class="btn primary" data-act="notify-open" data-key="${esc(a.key)}">내 에이전트에게 알려주기</button>`);
    if (a.actions.includes('restart') && a.status !== 'handled') b.push(`<button class="btn" data-act="restart" data-key="${esc(a.key)}">내 서버 다시 시작</button>`);
    if (a.actions.includes('evidence') || a.actions.includes('peek')) b.push(`<button class="btn" data-act="evidence" data-id="${esc(id)}">${ui.expanded[id] ? '근거 닫기' : '근거 보기'}</button>`);
    if (a.actions.includes('dismiss')) b.push(`<button class="btn" data-act="dismiss" data-key="${esc(a.key)}">${a.type === 'sim' ? '괜찮아요' : '무시'}</button>`);
    return b.join('');
  }

  function evidenceHTML(a, viewer) {
    const rows = a.evidence.map(id => S.eventById(st, id)).filter(Boolean).map(e => {
      const p = e.payload;
      const what = p.type === 'file_change' ? `<code>${esc(p.relativePath)}</code> · ${esc(p.branch)}` : `에이전트 시작 · ${esc(p.taskTitle || '비공개 작업')}`;
      return `<div class="row"><span class="tm">${hm(e.at)}</span><span>${esc(U[e.user].name)} · ${what}</span></div>`;
    }).join('');
    const fb = st.alertFeedback[viewer + '|' + a.key];
    return `<div class="evid"><div class="why">${esc(a.rule)}</div>${rows}<div class="fp">파일 경로 기반 '가능성' 알림이에요. 작업을 막지 않아요.</div>
      <div class="btns" style="margin-top:6px">${fb ? `<span class="done">피드백: ${fb === 'useful' ? '유용했어요' : '오탐이에요'}</span>`
        : `<button class="btn sm" data-act="feedback" data-key="${esc(a.key)}" data-v="useful">유용했어요</button><button class="btn sm" data-act="feedback" data-key="${esc(a.key)}" data-v="fp">오탐이에요</button>`}</div></div>`;
  }

  function activityPane() {
    const v = ui.viewer, w = curWs();
    const f = FILTERS.find(x => x.id === ui.feedFilter) || FILTERS[0];
    const items = feedItems(v).filter(f.test);
    let html = '', lastDay = null, last = null;
    for (const it of items) {
      const dk = startOfDay(it.at).getTime();
      if (dk !== lastDay) {
        const r = relDays(it.at);
        html += `<div class="daydiv"><span>${r === 0 ? '오늘' : r === -1 ? '어제' : fmtDate(it.at)}</span></div>`;
        lastDay = dk; last = null;
      }
      const isEph = it.type === 'eph' || it.type === 'eph-info';
      const cont = !isEph && last && !last.eph && it.at - last.at < 5 * 60e3;
      if (it.type === 'bot-text') html += msgShell(it.at, it.html, cont);
      else if (it.type === 'bot-run') {
        const p = it.ev.payload;
        html += msgShell(it.at, `<b>${esc(U[it.ev.user].name)}</b> 님이 ${p.tool === 'codex' ? 'Codex' : 'Claude Code'}를 시작했어요
          <div class="att" style="border-color:${PEOPLE[it.ev.user]}"><div class="t">${esc(p.taskTitle || '비공개 작업')}</div><div class="m">${esc(p.branch)}</div></div>`, cont);
      } else if (it.type === 'bot-main') {
        const p = it.ev.payload;
        html += msgShell(it.at, `<b>${esc(U[it.ev.user].name)}</b> 님이 <code>${esc(p.relativePath)}</code>을(를) ${esc(p.branch)}에 반영했어요`, cont);
      } else if (it.type === 'eph') {
        const a = it.alert, id = v + '|' + a.key;
        const body = `<div class="a-title">${esc(a.title)}</div><div class="a-text">${a.body}</div><div class="btns">${alertButtons(a, v)}</div>
          ${a.status === 'notified' ? '<div class="done">✓ 내 에이전트에게 전달했어요</div>' : ''}${a.status === 'handled' ? '<div class="done">✓ 서버를 다시 시작했어요</div>' : ''}
          ${ui.expanded[id] ? evidenceHTML(a, v) : ''}`;
        html += `<div class="eph ${a.severity !== 'info' ? 'warn' : ''}" data-alert="${esc(a.type)}"><div class="eph-note">${ico('eye', 14)}나에게만 보이는 알림</div>${msgShell(it.at, body, false)}</div>`;
      } else if (it.type === 'eph-info') {
        html += `<div class="eph" data-alert="caused"><div class="eph-note">${ico('eye', 14)}나에게만 보이는 알림</div>${msgShell(it.at,
          `내 변경(<code>${esc(it.ev.payload.relativePath)}</code>)으로 <b>${esc(U[it.info.user].name)}</b> 님에게 '${esc(it.info.alert.title)}' 알림이 갔어요`, false)}</div>`;
      }
      last = { at: it.at, eph: isEph };
    }
    if (!items.length) html = `<div class="feed-empty">${curId() === 'capstone' ? '이 보기에는 아직 활동이 없어요' : w.kind === 'team' ? '이 워크스페이스에는 아직 에이전트 활동이 없어요' : '개인 워크스페이스예요 — 팀 활동이 없어요'}</div>`;
    if (curId() === 'capstone' && (f.id === 'all' || f.id === 'mine')) alertsFor(v).forEach(a => ui.seenEph[v].add(a.key));
    const right = w.kind === 'team' ? `<div class="right"><span class="stack">${w.members.filter(u => u !== 'prof').map(u => avHTML(u, 24)).join('')}</span><span class="count">${w.members.length}</span></div>` : '';
    const bar = w.kind === 'team'
      ? `<div class="dbar">${ico('discord', 18)}<span class="grow">대화와 음성은 <b>Discord ${esc(w.discord)}</b>에서 · 새 메시지 ${w.unread}</span><button class="btn primary" data-act="discord">Discord 열기</button></div>` : '';
    return `<div class="pane-head"><h1>활동 · ${esc(w.name)}</h1>${right}</div><div class="msgs" id="msgs">${html}</div>${bar}`;
  }

  // ───────────────────────── 캘린더 (FR-20 제안) ─────────────────────────
  function weekStart() {
    const d = startOfDay(now());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + ui.weekOffset[ui.viewer] * 7);
    return d;
  }

  function calSide() {
    const ws0 = weekStart();
    const mid = addDays(ws0, 3);
    const first = new Date(mid.getFullYear(), mid.getMonth(), 1);
    const gridStart = addDays(first, -((first.getDay() + 6) % 7));
    const today = startOfDay(now()).getTime();
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const cls = [d.getMonth() !== mid.getMonth() ? 'out' : '', d >= ws0 && d < addDays(ws0, 7) ? 'wk' : '', d.getTime() === today ? 'today' : ''].join(' ');
      cells += `<button class="${cls}" data-act="goto-date" data-t="${d.getTime()}">${d.getDate()}</button>`;
    }
    const togs = myWs().map(w => {
      const on = !ui.calHidden[ui.viewer].has(w.id);
      return `<button class="cal-tog" data-act="cal-toggle" data-ws="${w.id}"><span class="box" style="border-color:${w.color};background:${on ? w.color : 'transparent'}">${on ? ico('check', 12, 2.6) : ''}</span>${esc(w.name)}</button>`;
    }).join('');
    return `<div class="s-head" style="cursor:default">캘린더</div>
      <div class="mini"><div class="mini-h">${mid.getFullYear()}년 ${mid.getMonth() + 1}월</div>
        <div class="mini-g">${['월', '화', '수', '목', '금', '토', '일'].map(x => `<span class="w">${x}</span>`).join('')}${cells}</div></div>
      <div class="s-sec">내 캘린더</div>${togs}`;
  }

  function calPane() {
    const ws0 = weekStart();
    const days = [...Array(7)].map((_, i) => addDays(ws0, i));
    const nowD = now();
    const nowH = nowD.getHours() + nowD.getMinutes() / 60;
    const evAll = myEvents();
    const head = days.map(d => {
      const r = relDays(d);
      return `<div class="d ${r === 0 ? 'today' : ''} ${d.getDay() % 6 === 0 ? 'weekend' : ''}"><div class="dw">${DOW[d.getDay()]}</div><div class="dn">${d.getDate()}</div></div>`;
    }).join('');
    const allday = days.map(d => {
      const r = relDays(d);
      const dl = myTasks().filter(t => t.due === r && !ui.calHidden[ui.viewer].has(t.ws));
      return `<div class="c">${dl.map(t => `<button class="chip-dl" style="background:${wsById(t.ws).color}" data-act="pop" data-k="task" data-id="${t.id}">마감 · ${esc(t.title.split(' · ')[0])}</button>`).join('')}</div>`;
    }).join('');
    const hours = [...Array(H1 - H0)].map((_, i) => { const h = H0 + i; return `<div class="h">${i === 0 ? '' : `${h < 12 ? '오전' : '오후'} ${((h + 11) % 12) + 1}시`}</div>`; }).join('');
    const cols = days.map(d => {
      const r = relDays(d);
      const evs = evAll.filter(e => e.rel === r && !ui.calHidden[ui.viewer].has(e.ws)).map(e => {
        const past = r < 0 || (r === 0 && e.e <= nowH);
        const h = (e.e - e.s) * HPX - 3;
        return `<button class="ev ${past ? 'past' : ''}" style="top:${(e.s - H0) * HPX + 1}px;height:${h}px;background:${wsById(e.ws).color}" data-act="pop" data-k="ev" data-id="${e.i}">
          <b>${esc(e.title)}</b>${h > 40 ? `${fmtHour(e.s)} – ${fmtHour(e.e)}${e.sub ? ' · ' + esc(e.sub) : ''}` : ''}</button>`;
      }).join('');
      const line = r === 0 && nowH >= H0 && nowH <= H1 ? `<div class="nowline" style="top:${(nowH - H0) * HPX}px"></div>` : '';
      return `<div class="col ${r === 0 ? 'today' : ''}" style="height:${(H1 - H0) * HPX}px">${evs}${line}</div>`;
    }).join('');
    const last = days[6];
    return `<div class="cal-tool">
        <button class="btn" data-act="week" data-d="0">오늘</button>
        <button class="icon-btn" data-act="week" data-d="-1" aria-label="이전 주">${ico('left', 18)}</button>
        <button class="icon-btn" data-act="week" data-d="1" aria-label="다음 주">${ico('right', 18)}</button>
        <h1>${ws0.getFullYear()}년 ${ws0.getMonth() + 1}월</h1>
        <span class="range">${ws0.getMonth() + 1}월 ${ws0.getDate()}일 – ${last.getMonth() + 1}월 ${last.getDate()}일</span>
        <div class="seg"><span class="on">주</span></div>
      </div>
      <div class="cal">
        <div class="cal-head"><div></div>${head}</div>
        <div class="cal-allday"><div class="lbl">종일</div>${allday}</div>
        <div class="cal-scroll" id="calscroll"><div class="cal-grid"><div class="hours">${hours}</div>${cols}</div></div>
      </div>`;
  }

  function checklist(task) {
    return task.items.map((it, i) => `<button class="ck ${it.done ? 'on' : ''}" data-act="task-item" data-task="${task.id}" data-i="${i}"><span class="box">${it.done ? ico('check', 12, 2.6) : ''}</span><span class="lb">${esc(it.label)}</span></button>`).join('');
  }

  function popoverHTML() {
    const p = ui.popover;
    if (!p) return '';
    let title, meta, color, task;
    if (p.k === 'ev') {
      const e = EVENTS[+p.id];
      const d = addDays(startOfDay(now()), e.rel);
      title = e.title; color = wsById(e.ws).color;
      meta = `${fmtDate(d)} · ${fmtHour(e.s)} – ${fmtHour(e.e)}<br>${esc(wsById(e.ws).name)}${e.sub ? ' · ' + esc(e.sub) : ''}`;
      task = e.task && taskById(e.task);
    } else {
      task = taskById(p.id);
      title = `마감 · ${task.title}`; color = wsById(task.ws).color;
      meta = `${fmtDate(dueDate(task))} ${task.at} · ${dday(task.due)}<br>${esc(wsById(task.ws).name)}`;
    }
    const x = Math.max(8, Math.min(p.x + 12, window.innerWidth - 316));
    const y = Math.max(52, Math.min(p.y - 20, window.innerHeight - 340));
    return `<div class="popover" style="left:${x}px;top:${y}px">
      <div class="pt"><span class="sw" style="background:${color}"></span><div style="flex:1"><h3>${esc(title)}</h3><div class="meta">${meta}</div></div>
        <button class="icon-btn" data-act="pop-close" aria-label="닫기" style="width:26px;height:26px">${ico('x', 15)}</button></div>
      ${task ? `<div class="check-list"><div class="meta">${esc(task.title)} · 남은 일 ${task.items.length - taskDone(task)}개${wsById(task.ws).kind === 'team' ? ' · 팀원과 함께 보는 목록' : ''}</div>${checklist(task)}
        <div class="prog"><i style="width:${Math.round(taskDone(task) / task.items.length * 100)}%;background:${wsById(task.ws).color}"></i></div></div>` : ''}
    </div>`;
  }

  // ───────────────────────── 팀: 사이드바 (팀원 · 오늘 · 남은 과제) ─────────────────────────
  function todayItems() {
    const nowD = now();
    const nowH = nowD.getHours() + nowD.getMinutes() / 60;
    return myEvents().filter(e => e.rel === 0).sort((a, b) => a.s - b.s).map(e => ({
      time: fmtHour(e.s), title: e.title, sub: `${wsById(e.ws).name}${e.sub ? ' · ' + e.sub : ''}`, color: wsById(e.ws).color,
      state: e.e <= nowH ? 'past' : e.s <= nowH ? 'now' : 'next',
    }));
  }

  function todayBlock() {
    const d = now();
    const tl = todayItems().map(it => `<li class="${it.state}" style="--c:${it.color}" data-act="view" data-v="cal" title="${esc(it.sub)}">
        <span class="t">${it.time}</span><span class="n"></span><span class="l">${esc(it.title)}${it.state === 'now' ? '<span class="now-tag">지금</span>' : ''}</span></li>`).join('');
    const tasks = myTasks().slice().sort((a, b) => a.due - b.due).map(t => {
      const w = wsById(t.ws);
      const pct = Math.round(taskDone(t) / t.items.length * 100);
      return `<div class="task"><button class="task-b" data-act="task-open" data-id="${t.id}">
          <div class="tt"><span class="sw" style="background:${w.color}"></span><span class="nm">${esc(t.title)}</span><span class="dd ${t.due <= 3 ? 'soon' : ''}">${dday(t.due)}</span></div>
          <div class="tm">${fmtDate(dueDate(t))} ${t.at} · ${taskDone(t)}/${t.items.length}</div>
          <div class="prog"><i style="width:${pct}%;background:${w.color}"></i></div>
        </button>${ui.openTask[ui.viewer] === t.id ? `<div class="items">${checklist(t)}</div>` : ''}</div>`;
    }).join('');
    return `<div class="s-sec s-sec-row">오늘<span>${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})</span></div>
      <ol class="mtl">${tl}</ol>
      <div class="s-sec">남은 과제</div>${tasks}`;
  }

  function teamSide() {
    const w = curWs();
    let members;
    if (w.id === 'capstone') {
      const rows = S.teammates(st, ui.viewer).map(m => {
        const state = m.runs.length ? `에이전트 ${m.runs.length}개` : m.state === 'other' ? '다른 워크스페이스' : '대기';
        const occ = occupants(m.user);
        const occHTML = occ.length ? `<span class="occ" title="${esc(occ.map(peerName).join(', '))} 접속 중">${occ.slice(0, 3).map(x => peerAv(x, 16)).join('')}</span>` : '';
        return `<button class="s-item" data-act="gsel" data-k="member" data-id="${m.user}"><span class="av sav" style="background:${PEOPLE[m.user]}">${initial(m.user)}</span>${esc(U[m.user].name)}${m.me ? ' (나)' : ''}${m.user === w.lead ? '<span class="lead">팀장</span>' : ''}${occHTML}<span class="r">${state}</span></button>`;
      }).join('');
      const invites = st.team.invites.map(i => `<div class="s-item"><span class="av sav" style="background:#5b6470">?</span><span class="ellip">${esc(i.email)}</span><span class="r">초대 대기</span></div>`).join('');
      members = `${rows}<button class="s-item" data-act="gsel" data-k="member" data-id="prof"><span class="av sav" style="background:${PEOPLE.prof}">${initial('prof')}</span>지도교수님<span class="r">열람자</span></button>${invites}`;
    } else {
      members = `<div class="s-empty">${w.kind === 'team' ? '실행 중인 에이전트가 없어요' : '개인 워크스페이스예요'}</div>`;
    }
    const invite = isLead(ui.viewer, w) && w.id === 'capstone' ? `<button class="s-mini" data-act="invite-open">${ico('plus', 13)}초대</button>` : '';
    return `${wsHead()}<div class="s-sec s-sec-row">팀원${invite}</div>${members}
      ${todayBlock()}
      <div class="s-note"><b>팀에 공유</b> 작업 제목 · 브랜치 · 바뀐 파일 경로<br><b>공유 안 함</b> 코드 · 프롬프트 원문 · 로그인
        <button class="s-link" data-act="privacy-open">공유 범위 설정</button></div>`;
  }

  // ───────────────────────── 팀: 그래프 (FR-11 · 14 · 15) ─────────────────────────
  const MEMBER_Y = { minsu: 100, jiyun: 250, hyunwoo: 385 };
  const X_HUB = 36, Y_HUB = 240, X_MEM = 200, X_RUN = 380;

  function layout(viewer) {
    const runs = S.knownRuns(st, viewer).filter(S.isActive);
    const pos = {};
    for (const m of Object.keys(MEMBER_Y)) {
      pos[m] = { x: X_MEM, y: MEMBER_Y[m] };
      const rs = runs.filter(r => r.user === m).slice(0, 3);
      rs.forEach((r, i) => { pos[r.id] = { x: X_RUN, y: MEMBER_Y[m] + (i - (rs.length - 1) / 2) * 84 }; });
    }
    return { pos, runs: runs.filter(r => pos[r.id]) };
  }

  function pill(x, y, text, color, anchor, act) {
    const w = Math.round(textW(text) + 20);
    const rx = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    return `<g class="pill" ${act || ''}><rect x="${rx}" y="${y - 11}" width="${w}" height="22" rx="11" fill="#0d1117" stroke="${color}" stroke-width="1.2"/>
      <text x="${rx + w / 2}" y="${y + 4}" text-anchor="middle" fill="${color}">${esc(text)}</text></g>`;
  }

  const curve = (a, b, dx) => {
    const cx = (dx < 0 ? Math.min(a.x, b.x) : Math.max(a.x, b.x)) + dx, cy = (a.y + b.y) / 2;
    return { d: `M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`, mx: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, my: 0.25 * a.y + 0.5 * cy + 0.25 * b.y };
  };

  function graphSVG(viewer) {
    const { pos, runs } = layout(viewer);
    const alerts = alertsFor(viewer);
    let edges = '', nodes = '', over = '';
    const envA = alerts.find(a => a.type === 'env') || S.computeAlerts(st, viewer === 'minsu' ? 'jiyun' : 'minsu', { includeHidden: true }).find(a => a.type === 'env');

    edges += `<path class="edge dash" d="M0 ${Y_HUB} L${X_HUB} ${Y_HUB}" stroke="#6e7681"/>`;
    for (const m of S.teammates(st, viewer)) {
      const c = GLOW[m.user], p = pos[m.user];
      const active = m.runs.length > 0;
      const envHere = envA && envA.from === m.user;
      const ring = active ? c : envHere ? '#f0a35e' : '#484f58';
      edges += `<path class="edge ${active || envHere ? 'flow' : ''}" d="M${X_HUB} ${Y_HUB} L${p.x} ${p.y}" stroke="${active ? c : envHere ? '#f0a35e' : '#30363d'}"/>`;
      if (envHere) over += pill((X_HUB + p.x) / 2 + 6, (Y_HUB + p.y) / 2 + 22, `${envA.file} → ${envA.branch}`, '#f0a35e', 'middle', `data-act="gsel" data-k="alert" data-id="${esc(envA.key)}"`);
      nodes += `<g class="node" data-act="gsel" data-k="member" data-id="${m.user}" data-node="${m.user}" data-active="${active}">
        ${active ? `<circle class="halo" cx="${p.x}" cy="${p.y}" r="24" fill="none" stroke="${c}" stroke-width="2"/>` : ''}
        <circle class="ring" cx="${p.x}" cy="${p.y}" r="24" fill="#0d1117" stroke="${ring}" stroke-width="2" ${active ? 'filter="url(#glow)"' : ''}/>
        <circle cx="${p.x}" cy="${p.y}" r="7" fill="${ring}"/>
        <text class="lbl name" x="${p.x}" y="${p.y + 44}" text-anchor="middle">${esc(U[m.user].name)}${m.me ? ' · 나' : ''}</text>
        <text class="lbl" x="${p.x}" y="${p.y + 60}" text-anchor="middle">${active ? `에이전트 ${m.runs.length}` : m.state === 'other' ? '다른 워크스페이스' : '대기'}</text></g>`;
    }

    for (const r of runs) {
      const p = pos[r.id], mp = pos[r.user], c = GLOW[r.user];
      const running = r.status === 'running';
      const shared = st.shareTitle[r.user] || r.user === viewer;
      const ring = running ? c : '#d29922';
      edges += `<path class="edge ${running ? 'flow' : 'dash'}" d="M${mp.x} ${mp.y} L${p.x} ${p.y}" stroke="${running ? c : '#8b6a2b'}"/>`;
      nodes += `<g class="node" data-act="gsel" data-k="run" data-id="${r.id}" data-run="${esc(r.title)}">
        ${running ? `<circle class="halo" cx="${p.x}" cy="${p.y}" r="15" fill="none" stroke="${c}" stroke-width="2"/>` : ''}
        <circle class="ring" cx="${p.x}" cy="${p.y}" r="15" fill="#0d1117" stroke="${ring}" stroke-width="2" ${running ? 'filter="url(#glow)"' : ''}/>
        <circle cx="${p.x}" cy="${p.y}" r="5" fill="${ring}"/>
        <text class="lbl title" x="${p.x + 24}" y="${p.y - 2}">${esc(shared ? r.title : '비공개 작업')}${running ? '' : '<tspan class="lbl warn" dx="6">확인 필요</tspan>'}</text>
        <text class="lbl" x="${p.x + 24}" y="${p.y + 14}">${r.tool === 'Claude Code' ? 'claude' : 'codex'} · ${esc(r.branch)}</text></g>`;
    }

    // 경고 선: 비슷한 작업은 오른쪽, 공유 자원 충돌은 왼쪽으로 휘게
    for (const a of alerts) {
      const act = `data-act="gsel" data-k="alert" data-id="${esc(a.key)}"`;
      if (a.type === 'sim' && pos[a.myRun] && pos[a.otherRun]) {
        const k = curve(pos[a.myRun], pos[a.otherRun], 70);
        edges += `<path class="edge dash" d="${k.d}" stroke="#a5a0ff" opacity=".85" data-edge="sim"/>`;
        over += pill(k.mx + 6, k.my, '비슷한 작업', '#a5a0ff', 'start', act);
      }
      if (a.type === 'db' || a.type === 'dep') {
        const src = S.eventById(st, a.evidence[a.evidence.length - 1]);
        const from = src && src.runId && pos[src.runId] ? pos[src.runId] : pos[a.from];
        const mine = runs.find(r => r.user === viewer && r.tool === 'Claude Code') || runs.find(r => r.user === viewer);
        const to = mine ? pos[mine.id] : pos[viewer];
        const k = curve(from, to, -80);
        edges += `<path class="edge flow thick" d="${k.d}" stroke="#e3b341" filter="url(#glow)" data-edge="conflict"/>`;
        over += pill(k.mx - 6, k.my, a.type === 'db' ? 'DB 스키마 충돌 가능' : '의존성 변경', '#e3b341', 'end', act);
      }
    }
    // 내 변경으로 다른 팀원에게 경고가 간 경우: 작성자 화면에는 조용한 회색 선만
    const drawn = new Set();
    for (const e of st.events) {
      if (e.user !== viewer || !e.payload || e.payload.type !== 'file_change' || !pos[e.runId]) continue;
      for (const c of S.alertsCausedBy(st, viewer, e.id)) {
        if (drawn.has(c.user + c.alert.key)) continue;
        drawn.add(c.user + c.alert.key);
        const otherRun = runs.find(r => r.user === c.user && r.tool === 'Claude Code') || runs.find(r => r.user === c.user);
        const to = otherRun ? pos[otherRun.id] : pos[c.user];
        const k = curve(pos[e.runId], to, -80);
        edges += `<path class="edge dash" d="${k.d}" stroke="#6e7681" data-edge="caused"/>`;
        over += pill(k.mx - 6, k.my, `${U[c.user].name}에게 알림 보냄`, '#8b949e', 'end', '');
      }
    }

    const hubWarn = envA && envA.branch === st.team.base;
    nodes += `<g><circle cx="${X_HUB}" cy="${Y_HUB}" r="9" fill="${hubWarn ? '#f0a35e' : '#c9d1d9'}" ${hubWarn ? 'filter="url(#glow)"' : ''}/>
      <text class="lbl" x="${X_HUB}" y="${Y_HUB + 28}" text-anchor="middle">main</text><text class="lbl" x="${X_HUB}" y="${Y_HUB + 43}" text-anchor="middle">v${st.team.version}</text></g>`;

    return `<svg class="g-svg" viewBox="0 0 640 460" preserveAspectRatio="xMidYMid meet" role="img" aria-label="팀 AI 작업 그래프">
      <defs><filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${edges}${nodes}${over}</svg>`;
  }

  function termLines(viewer) {
    const lines = [];
    for (const e of S.visibleEvents(st, viewer)) {
      const p = e.payload, who = `<span style="color:${GLOW[e.user]}">${esc(U[e.user].name)}</span>`, t = `<span class="t">${hm(e.at)}</span>`;
      if (p.type === 'agent_run') lines.push({ at: e.at, h: `${t} ${who} <span class="g">▶</span> ${esc(p.tool)} <span class="s">"${esc(p.taskTitle || '비공개 작업')}"</span> <span class="b">${esc(p.branch)}</span>` });
      else if (p.type === 'agent_activity') lines.push({ at: e.at, h: `${t} ${who} <span class="m">프롬프트 입력 · 원문 비전송</span>` });
      else if (p.type === 'file_change') {
        const c = S.CATEGORY[p.category];
        lines.push({ at: e.at, h: `${t} ${who} ${esc(p.relativePath)} <span class="${c.shared ? 'w' : 'm'}">${esc(c.label)}</span>${p.branch === st.team.base ? ' <span class="b">→ main</span>' : ''}` });
      }
    }
    for (const a of alertsFor(viewer)) {
      if (a.severity !== 'high' && a.type !== 'dep') continue;
      const at = latestAt(a.evidence);
      lines.push({ at, h: `<span class="t">${hm(at)}</span> <span class="w">⚠ ${esc(a.title)}</span> <span class="m">· 나에게만</span>` });
    }
    lines.push(...ui.term[viewer]);
    return lines.filter(l => l.at.getTime() > ui.termCleared[viewer]).sort((a, b) => a.at - b.at).slice(-13);
  }

  function gCard(viewer) {
    let sel = ui.graphSel;
    const alerts = alertsFor(viewer);
    if (!sel) {
      const high = alerts.find(a => a.severity === 'high');
      if (high) sel = { k: 'alert', id: high.key };
    }
    const close = `<button class="x" data-act="gsel-close" aria-label="닫기">${ico('x', 15)}</button>`;
    if (sel && sel.k === 'alert') {
      const a = alerts.find(x => x.key === sel.id);
      if (a) {
        const evs = a.evidence.map(id => S.eventById(st, id)).filter(Boolean).slice(-3).map(e => {
          const p = e.payload;
          return `${hm(e.at)} ${esc(U[e.user].name)} · ${p.type === 'file_change' ? esc(p.relativePath) + ' · ' + esc(p.branch) : '에이전트 시작'}`;
        }).join('<br>');
        return `<div class="g-card ${a.severity === 'info' ? '' : 'warn'}" data-card="alert"><h3>${esc(a.title)}${close}</h3><p>${a.body}</p>
          <div class="ev-l">${esc(a.rule)}<br>${evs}</div>
          <div class="btns">${a.actions.includes('notify') && a.status !== 'notified' ? `<button class="btn primary" data-act="notify-open" data-key="${esc(a.key)}">내 에이전트에게 알려주기</button>` : ''}
            ${a.actions.includes('restart') && a.status !== 'handled' ? `<button class="btn" data-act="restart" data-key="${esc(a.key)}">서버 다시 시작</button>` : ''}
            <button class="btn" data-act="dismiss" data-key="${esc(a.key)}">${a.type === 'sim' ? '괜찮아요' : '무시'}</button></div>
          ${a.status === 'notified' ? '<div class="done">✓ 내 에이전트에게 전달했어요</div>' : ''}${a.status === 'handled' ? '<div class="done">✓ 서버를 다시 시작했어요</div>' : ''}</div>`;
      }
    }
    if (sel && sel.k === 'run') {
      const r = st.agents.find(x => x.id === sel.id);
      if (r) {
        const files = [...new Set(st.events.filter(e => e.runId === r.id && e.payload && e.payload.type === 'file_change').map(e => e.payload.relativePath))];
        const shared = st.shareTitle[r.user] || r.user === viewer;
        const mine = r.user === viewer && S.isActive(r);
        return `<div class="g-card" data-card="run"><h3>${esc(shared ? r.title : '비공개 작업')}${close}</h3>
          <p>${esc(U[r.user].name)} · ${esc(r.tool)} · <code>${esc(r.branch)}</code><br>${r.status === 'running' ? '작업 중' : r.status === 'waiting' ? '터미널에서 확인 필요' : '종료됨'} · 마지막: ${esc(r.last)}</p>
          <div class="ev-l">관찰: ${r.observe === 'hooks' ? 'Claude Code Hooks + 파일·Git 감시' : '프로세스 + 파일·Git 감시 (Hooks 없음)'}<br>${files.length ? files.map(esc).join('<br>') : '아직 바뀐 파일 없음'}</div>
          ${mine ? `<div class="btns">${r.status === 'waiting' ? `<button class="btn" data-act="run-resume" data-id="${r.id}">터미널 열기</button>` : ''}<button class="btn" data-act="run-stop" data-id="${r.id}">에이전트 종료</button></div>` : ''}</div>`;
      }
    }
    if (sel && sel.k === 'member') {
      const m = sel.id === 'prof' ? null : S.teammates(st, viewer).find(x => x.user === sel.id);
      const body = !m ? '자료와 배포 링크만 볼 수 있는 열람자예요.'
        : m.runs.length ? `${m.titles.map(esc).join(', ')}<br><code>${m.branches.map(esc).join(', ')}</code>`
        : m.state === 'other' ? '다른 워크스페이스에서 작업 중이에요. 어떤 워크스페이스인지는 공유되지 않아요.' : '지금 실행 중인 에이전트가 없어요.';
      return `<div class="g-card" data-card="member"><h3>${esc(U[sel.id].name)} · ${esc(U[sel.id].role)}${close}</h3><p>${body}</p>
        ${m && m.areas.length ? `<div class="ev-l">최근 영역 · ${m.areas.map(esc).join(' · ')}</div>` : ''}</div>`;
    }
    return `<div class="g-card" data-card="legend"><h3>보는 법</h3>
      <div class="legend"><span><i style="background:#56c2e6"></i>빛나는 노드 = 작업 중</span><span><i style="background:#d29922"></i>확인 필요</span><span><i style="background:#484f58"></i>대기</span><span><i style="background:#e3b341"></i>충돌 가능</span></div>
      <p style="color:var(--dark-mute)">노드를 누르면 자세히 보여요.</p></div>`;
  }

  function teamPane() {
    const viewer = ui.viewer, w = curWs();
    if (w.id !== 'capstone') {
      return `<div class="g-wrap"><div class="g-kick">TEAM GRAPH</div><div class="g-title">${esc(w.name)}</div>
        <div class="g-empty">${w.kind === 'team' ? '이 워크스페이스에는 아직 실행 중인 에이전트가 없어요.' : '개인 워크스페이스예요 — 팀 그래프는 팀 워크스페이스에서 보여요.'}</div></div>`;
    }
    const lines = termLines(viewer).map(l => `<div>${l.h}</div>`).join('');
    return `<div class="g-wrap">
      <div class="g-top"><div><div class="g-kick">LIVE · TEAM AI</div><div class="g-title">캡스톤 팀플</div><div class="g-sub">지금 누가 무엇을 하고 있는지</div></div>
        <div class="g-view">보는 사람 · <b>${esc(U[viewer].name)}</b> (${esc(U[viewer].device)})</div></div>
      <div class="g-stage">
        <div class="g-left">
        <div class="term"><div class="term-bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>~/projects/capstone</span></div>
          <div class="term-body" id="termbody"><div><span class="g">$</span> cadora watch --team</div><div class="m">공유: 제목 · 브랜치 · 상대경로만</div>${lines}</div>
          <div class="term-in"><span class="g">$</span><input id="tin" data-enter="term" placeholder='claude "작업 제목"' autocomplete="off" spellcheck="false" aria-label="터미널"></div></div>
        ${gCard(viewer)}
        </div>
        ${graphSVG(viewer)}
      </div>
    </div>`;
  }

  function runTerm(raw) {
    const v = ui.viewer;
    const cmd = raw.trim();
    if (!cmd) return;
    const out = h => ui.term[v].push({ at: new Date(), h });
    out(`<span class="g">$</span> ${esc(cmd)}`);
    let m;
    if ((m = cmd.match(/^(claude|codex)\s+["“]?(.+?)["”]?$/i))) {
      const tool = m[1].toLowerCase() === 'claude' ? 'Claude Code' : 'Codex';
      const title = m[2].trim();
      const branch = S.suggestBranch(title, st.runSeq + 1);
      const rid = newId('r');
      if (!dispatch({ type: 'launch', user: v, tool, title, branch, rid })) return;
      const slug = branch.replace(/^[^/]+\//, '');
      const area = /login|signup|auth|password|member|reset/.test(slug) ? 'auth' : /mail/.test(slug) ? 'mail' : /form|ui|dashboard|profile/.test(slug) ? 'pages' : 'features';
      later(1800, () => {
        const r = st.agents.find(x => x.id === rid);
        if (r && S.isActive(r)) dispatch({ type: 'file', user: v, rid, kind: 'hook', path: `src/${area}/${slug}.${area === 'pages' ? 'tsx' : 'ts'}`, changeType: 'added' });
      });
    } else if ((m = cmd.match(/^edit\s+(\S+)$/i))) {
      // 감시 규칙 시험: 분류(FR-12) · 감시 제외 · 민감 파일 제외(FR-19) — 제외된 파일은 이 PC 밖으로 나가지 않는다
      const path = m[1].slice(0, 160);
      const cls = S.classify(path.startsWith('..') ? null : path.replace(/^\.\//, ''));
      if (cls.excluded) { out(`<span class="w">⛔ ${esc(path)} — ${esc(cls.reason)}</span>`); return; }
      const run = activeRunOf(v);
      if (dispatch({ type: 'file', user: v, rid: run ? run.id : null, kind: run && run.tool === 'Claude Code' ? 'hook' : 'watch', path })) {
        out(`<span class="m">→ 팀 서버로 보냄 · 분류: ${esc(cls.label)}</span>`);
      }
    } else if (cmd === 'clear') {
      ui.termCleared[v] = Date.now();
    } else if (cmd === 'help') {
      out('<span class="m">claude "작업 제목" · codex "작업 제목" · edit 파일경로 · clear</span>');
    } else {
      out('<span class="w">알 수 없는 명령 — help</span>');
    }
  }

  // ───────────────────────── 시연 (PRD §12) ─────────────────────────
  const STEPS = [
    {
      label: "팀장 민수 · 공유 탭 '배포 대시보드' 추가",
      apply(s, a, at) {
        S.addSharedTab(s, '배포 대시보드');
        s.feed.push({ kind: 'bot-text', at, seq: s.seq + 0.5, html: `<b>민수</b> 님이 공유 고정 탭 <b>배포 대시보드</b>를 추가했어요 · 팀원에게 반영됨 (v${s.team.version})` });
      },
      say: '공유 탭이 팀원 작업공간에 반영됐어요 — 개인 탭은 그대로',
      action: { label: '지윤 작업공간 보기', fn: () => { setPersona('jiyun'); setWs('capstone'); go('home'); } },
      shared: { label: '작업공간 보기', fn: () => { setWs('capstone'); go('home'); } },
    },
    {
      label: '지윤 · Claude Code "로그인·회원 인증 API"',
      apply(s, a, at) {
        const r = S.launchAgent(s, 'jiyun', { tool: 'Claude Code', title: '로그인·회원 인증 API', branch: 'feature/login', prompt: '로그인/세션 API 만들어줘. DATABASE_URL=postgresql://capstone:Sup3rS3cret!@localhost:5432/capstone', id: a._id + '-j', at });
        S.emitFile(s, { user: 'jiyun', runId: r.id, kind: 'hook', path: 'src/auth/login.ts', at: new Date(a.t + 1) });
      },
      say: '지윤의 에이전트가 팀 그래프에 나타났어요',
      action: { label: '팀 그래프 보기', fn: () => go('team') },
    },
    {
      label: '민수 · Claude Code "회원가입 API 구현"',
      apply(s, a, at) {
        const r = S.launchAgent(s, 'minsu', { tool: 'Claude Code', title: '회원가입 API 구현', branch: 'feature/signup', id: a._id + '-m', at });
        S.emitFile(s, { user: 'minsu', runId: r.id, kind: 'hook', path: 'src/auth/signup.ts', at: new Date(a.t + 1) });
      },
      say: '같은 src/auth/ 폴더 → 두 사람에게 "비슷한 작업"',
      action: { label: '팀 그래프 보기', fn: () => go('team') },
    },
    {
      label: '민수의 에이전트가 schema.prisma 수정', star: true,
      apply(s, a, at) {
        const r = s.agents.find(x => x.user === 'minsu' && x.title === '회원가입 API 구현' && S.isActive(x));
        S.emitFile(s, { user: 'minsu', runId: r && r.id, kind: 'hook', path: 'prisma/schema.prisma', at });
      },
      say: '지윤 화면에만 "DB 스키마 충돌 가능"이 떴어요',
      action: { label: '지윤 화면 보기', fn: () => { setPersona('jiyun'); setWs('capstone'); ui.graphSel = null; go('team'); } },
      shared: { label: '팀 그래프 보기', fn: () => { ui.graphSel = null; go('team'); } },
    },
    {
      label: '현우 · docker-compose.yml main 반영',
      apply(s, a, at) { S.emitFile(s, { user: 'hyunwoo', kind: 'git', path: 'docker-compose.yml', at }); },
      say: '환경 변경 — 서버 재시작 안내 · 대화는 Discord에서',
      action: { label: '활동 보기', fn: () => go('activity') },
    },
  ];
  STEPS.forEach(x => { if (!x.shared) x.shared = x.action; });

  /** 다음 단계 하나를 공유 기록에 쌓는다 (여러 명이 동시에 눌러도 같은 단계는 한 번만 적용) */
  function doStep(n, quiet) {
    if (n !== st.step + 1 || n > STEPS.length) return false;
    if (!dispatch({ type: 'step', n })) return false;
    ui.graphSel = null;
    const s = STEPS[n - 1];
    if (!quiet) toast(esc(s.say), NET.mode === 'shared' ? s.shared : s.action);
    return true;
  }
  function stopAuto() { if (ui) { ui.auto = false; ui.autoToken += 1; } }
  function autoPlay(token) {
    if (!ui.auto || token !== ui.autoToken) return;
    const n = st.step + 1;
    if (n > STEPS.length || !doStep(n)) { ui.auto = false; return; }
    if (n >= STEPS.length) { ui.auto = false; return; }
    later(2800, () => autoPlay(token));
  }

  // ───────────────────────── 메뉴 · 모달 ─────────────────────────
  function menuHTML() {
    if (ui.menu === 'ws') {
      const items = myWs().map(w => {
        const m = wsMeta(ui.viewer, w);
        return `<button class="menu-item ${curId() === w.id ? 'on' : ''}" data-act="ws" data-id="${w.id}"><span class="av" style="background:${w.color}">${esc(w.short)}</span>
          <span class="grow"><b>${esc(w.name)}</b><br><span style="font-size:12px;color:var(--text-3)">${esc(m.text)}</span></span></button>`;
      }).join('');
      return `<div class="menu" style="left:72px;top:50px"><h4>${esc(U[ui.viewer].name)}의 워크스페이스</h4>${items}<div class="sep"></div>
        <button class="menu-item" data-act="create-open"><span class="av" style="background:#e9ecef;color:#495057">${ico('plus', 15)}</span><b>새 워크스페이스</b></button></div>`;
    }
    if (ui.menu === 'demo') {
      const steps = STEPS.map((s, i) => `<li class="${i < st.step ? 'done' : i === st.step ? 'next' : ''} ${s.star ? 'star' : ''}"><span class="n">${i < st.step ? ico('check', 12, 2.6) : i + 1}</span>${esc(s.label)}</li>`).join('');
      const shared = NET.mode === 'shared';
      return `<div class="menu" style="right:10px;top:46px;width:340px"><h4>P0 시연${shared ? ' · 접속한 모두에게 함께 진행돼요' : ''}</h4>
        <ol class="steps">${steps}</ol>
        <div class="row"><button class="btn primary" data-act="step" ${st.step >= STEPS.length ? 'disabled' : ''}>다음 단계</button>
          ${ui.auto ? '<button class="btn" data-act="auto-stop">멈춤</button>' : `<button class="btn" data-act="auto" ${st.step >= STEPS.length ? 'disabled' : ''}>${ico('play', 13)}자동 재생</button>`}
          ${ui.confirmReset ? '<button class="btn danger" data-act="reset-go">정말 초기화</button>' : '<button class="btn" data-act="reset">초기화</button>'}</div>
        ${ui.confirmReset && shared ? '<div class="menu-note">접속한 모든 사람의 시연 기록이 처음으로 돌아가요.</div>' : ''}
        <div class="sep"></div><h4>내 자리</h4>
        <div class="viewer-seg">${VIEWERS.map(u => `<button class="${ui.viewer === u ? 'on' : ''}" data-act="viewer-set" data-u="${u}">${esc(U[u].name)}${occupants(u).length ? ` · ${occupants(u).length}명` : ''}</button>`).join('')}</div>
      </div>`;
    }
    if (ui.menu === 'people') {
      const rows = uniquePeople().map(x => `<div class="person">${peerAv(x, 28)}<span class="grow"><b>${esc(peerName(x))}</b>${x.isMe ? ' (나)' : ''}${x.guest ? ' · 게스트' : ''}<br><span class="sub2">${x.presence.persona ? esc(U[x.presence.persona].name) + ' 자리' : '자리 고르는 중'}${x.presence.view ? ' · ' + esc(({ home: '작업공간', team: '팀', activity: '활동', cal: '캘린더' })[x.presence.view] || '') : ''}</span></span></div>`).join('');
      return `<div class="menu" style="right:96px;top:46px;width:290px"><h4>지금 접속 중</h4>${rows || '<div class="menu-note">아직 다른 사람이 없어요. 공유한 주소로 팀원이 들어오면 여기에 보여요.</div>'}
        ${NET.readOnly ? '<div class="menu-note">보기 전용이에요 — 함께 조작하려면 편집 권한(Contributor 이상)이 필요해요.</div>' : ''}</div>`;
    }
    return '';
  }

  function notifyText(a) {
    const who = U[a.from].name;
    if (a.type === 'db') return `[Cadora 팀 알림] ${who} 님의 에이전트가 ${a.branch} 브랜치에서 ${a.file}을(를) 수정했습니다 (아직 ${st.team.base} 미반영). DB 스키마에 의존하는 코드를 작성하기 전에 변경된 스키마를 확인하세요.`;
    return `[Cadora 팀 알림] ${who} 님 브랜치 ${a.branch}에서 ${a.file}이(가) 바뀌었습니다. 새 의존성을 추가하기 전에 확인하세요.`;
  }

  const ONB_LOG = [
    ['✓ 워크스페이스 생성 · 세션 persist:ws-capstone'],
    ['> git clone https://github.com/team/capstone.git', 'Receiving objects: 100% (1532/1532), done.'],
    ['> npm install', 'added 812 packages in 21s', '> docker compose pull', '✔ db Pulled  ✔ redis Pulled'],
    ['✓ OPENAI_API_KEY → 실행할 때만 환경변수 (값 ••••)', '✓ DATABASE_URL → 실행할 때만 환경변수 (값 ••••)'],
  ];

  function modalHTML() {
    const m = ui.modal;
    if (!m) return '';
    let body = '', wide = false;
    if (String(m.type).startsWith('real-')) {
      body = realModalHTML(m);
    } else if (m.type === 'notify') {
      const a = alertsFor(ui.viewer).find(x => x.key === m.key);
      const run = activeRunOf(ui.viewer);
      if (!a) { ui.modal = null; return ''; }
      body = `<h2>내 에이전트에게 알려주기</h2>
        <div class="sub">${run ? `"${esc(run.title)}" 에이전트에` : '실행 중인 에이전트가 없어요 —'} 아래 요약만 맥락으로 넣어요. 다른 명령은 실행하지 않아요.</div>
        <div class="quote">${esc(notifyText(a))}</div>
        <div class="foot"><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="notify-send" ${run ? '' : 'disabled'}>전달하기</button></div>`;
    } else if (m.type === 'create') {
      const d = m.draft;
      const types = Object.keys(TYPE_DEFAULTS).map(t => `<button class="type ${d.type === t ? 'on' : ''}" data-act="create-type" data-t="${t}"><b>${t}</b><span>${TYPE_DEFAULTS[t].desc}</span></button>`).join('');
      body = `<h2>새 워크스페이스</h2><div class="sub">이 워크스페이스 안의 로그인 · 파일 · 서버는 다른 워크스페이스와 섞이지 않아요.</div>
        <div class="types">${types}</div>
        <div class="fgrid">
          <label class="fld"><span>이름</span><input id="c-name" class="inp ${m.err ? 'err' : ''}" data-input="c-name" data-norestore value="${esc(d.name)}" placeholder="예: 알고리즘 과제 2"></label>
          <label class="fld"><span>작업 폴더</span><input id="c-folder" class="inp mono" data-input="c-folder" data-norestore value="${esc(d.folder)}"></label>
          <div class="fld"><span>브라우저 세션</span>
            <button class="opt ${d.session === 'new' ? 'on' : ''}" data-act="create-session" data-v="new"><i></i>새 세션 — 여기서만 로그인</button>
            <button class="opt ${d.session === 'share' ? 'on' : ''}" data-act="create-session" data-v="share"><i></i>지금 워크스페이스 세션 함께 쓰기 (실험)</button></div>
          <label class="fld"><span>실행 명령 (선택)</span><input id="c-cmd" class="inp mono" data-input="c-cmd" data-norestore value="${esc(d.cmd)}" placeholder="npm run dev"></label>
        </div>
        <div class="fld"><span>고정 탭</span><div class="chips">${d.tabs.map(t => `<span class="chip">${esc(t)}</span>`).join('') || '<span class="sub">없음</span>'}</div></div>
        ${m.err ? `<div class="err-t">${esc(m.err)}</div>` : ''}
        <div class="foot"><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="create-submit">워크스페이스 만들기</button></div>`;
    } else if (m.type === 'invite') {
      body = m.sent
        ? `<h2>초대를 보냈어요</h2><div class="sub">${esc(m.email)} · ${esc(m.role)} · 7일 후 만료, 언제든 회수할 수 있어요.</div>
           <div class="quote">수락하면 저장소 · 고정 탭 ${st.team.sharedTabs.length}개 · 실행 스크립트 · 팀 AI 규칙을 받아요. 비밀값은 값 없이 참조만 연결돼요.</div>
           <div class="foot"><button class="btn" data-act="modal-close">닫기</button><button class="btn primary" data-act="onb-open">초대받은 사람 화면 미리보기</button></div>`
        : `<h2>팀원 초대</h2><div class="sub">초대를 수락하면 같은 공통 환경으로 시작해요. 개인 로그인과 탭은 각자 유지돼요.</div>
           <label class="fld"><span>이메일</span><input id="inv-email" class="inp" placeholder="teammate@univ.ac.kr" data-enter="invite-send" autocomplete="off"></label>
           <div class="fld"><span>역할</span><div class="seg2">${['팀원', '열람자'].map(r => `<button class="${m.role === r ? 'on' : ''}" data-act="invite-role" data-r="${r}">${r}</button>`).join('')}</div></div>
           ${m.err ? `<div class="err-t">${esc(m.err)}</div>` : ''}
           <div class="foot"><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="invite-send">초대 보내기</button></div>`;
    } else if (m.type === 'onb') {
      wide = true;
      const o = m.o;
      const loginsDone = o.logins.notion && o.logins.figma;
      const done = o.done + (loginsDone ? 1 : 0) + (o.phase === 'done' ? 1 : 0);
      const ic = s => `<span class="si ${s}">${s === 'ok' ? ico('check', 14, 2.6) : s === 'warn' ? '!' : ''}</span>`;
      const st4 = i => (o.done > i ? 'ok' : o.phase === 'running' && o.done === i ? 'spin' : '');
      const steps = [`워크스페이스 만들기 · 고정 탭 ${st.team.sharedTabs.length}개`, '저장소 받기 · ~/projects/capstone', '의존성 설치 · npm install, docker 이미지', '비밀값 연결 · 2개 (값은 보이지 않아요)']
        .map((t, i) => `<div class="ostep">${ic(st4(i))}<span>${esc(t)}</span></div>`).join('');
      const loginRow = `<div class="ostep">${ic(loginsDone ? 'ok' : o.done >= 4 ? 'warn' : '')}<span class="grow">로그인이 필요한 서비스${o.later && !loginsDone ? ' — 나중에 하기로 했어요' : ''}
        ${o.done >= 4 && !loginsDone ? `<span class="orow">${o.logins.notion ? '<span class="chip ok">노션 ✓</span>' : '<button class="btn sm" data-act="onb-login" data-k="notion">노션 로그인</button>'}${o.logins.figma ? '<span class="chip ok">피그마 ✓</span>' : '<button class="btn sm" data-act="onb-login" data-k="figma">피그마 초대 수락</button>'}</span>` : ''}</span></div>`;
      const serverRow = `<div class="ostep">${ic(o.phase === 'done' ? 'ok' : o.phase === 'starting' ? 'spin' : '')}<span>서버 시작 · capstone.localhost</span></div>`;
      const confirm = o.phase === 'confirm' ? `<div class="confirm"><b>실행 전 확인</b> — 팀장이 설정한 명령을 이 PC에서 실행해요.
          <pre>git clone https://github.com/team/capstone.git
npm install
docker compose pull</pre><div class="btns"><button class="btn primary" data-act="onb-start">확인하고 시작</button></div></div>` : '';
      const foot = o.phase === 'done'
        ? `<div class="okbox">✓ 준비 완료 · capstone.localhost 실행 중${loginsDone ? '' : ' · 로그인은 나중에'}</div><div class="foot"><button class="btn primary" data-act="modal-close">닫기</button></div>`
        : `<div class="foot"><button class="btn" data-act="onb-later" ${o.phase === 'logins' ? '' : 'disabled'}>로그인은 나중에</button><button class="btn primary" data-act="onb-finish" ${o.phase === 'logins' ? '' : 'disabled'}>워크스페이스 열기</button></div>`;
      body = `<div class="onb">
        <div class="onb-main"><div class="eyebrow">미리보기 · 초대받은 사람의 화면</div><h2>캡스톤 팀플에 들어왔어요</h2>
          <div class="sub">팀장 민수 님이 만든 환경을 내 PC에 그대로 준비하고 있어요.</div>
          <div class="obar"><span>6단계 중 ${done}단계</span><div class="prog"><i style="width:${Math.round(done / 6 * 100)}%;background:var(--accent)"></i></div></div>
          ${confirm}${steps}${loginRow}${serverRow}
          ${o.log.length ? `<pre class="olog">${o.log.map(esc).join('\n')}</pre>` : ''}${foot}</div>
        <div class="onb-side"><div class="hc-sec">팀장 환경에서 받아오는 것</div><div>고정 탭 · ${esc(st.team.sharedTabs.join(', '))}</div><div>공용 자료 · 기획서 · 발표 자료 · 회의록</div><div>팀 AI 규칙 · 코딩 컨벤션</div>
          <div class="hc-sec">내 것으로 남는 것</div><div>내 로그인 · 개인 탭 · 창 배치 · 메모</div></div></div>`;
    } else if (m.type === 'persona') {
      const seats = PERSONAS.map(p => {
        const occ = occupants(p).filter(x => !x.isMe);
        return `<button class="seat ${ui.viewer === p ? 'on' : ''}" data-act="seat" data-u="${p}"><span class="av" style="background:${PEOPLE[p]};width:40px;height:40px">${initial(p)}</span>
          <b>${esc(U[p].name)}</b><span class="sub2">${esc(U[p].role)} · ${esc(U[p].device)}</span>
          <span class="occ-l">${occ.length ? esc(occ.map(peerName).join(', ')) + ' 접속 중' : '비어 있음'}</span></button>`;
      }).join('');
      body = `<h2>어느 자리로 참여할까요?</h2>
        <div class="sub">한 사람이 한 자리를 맡으면 서로의 화면이 실시간으로 이어져요. 같은 자리에 여러 명이 들어와도 괜찮고, 나중에 왼쪽 아래 아바타로 바꿀 수 있어요.</div>
        <div class="seats">${seats}</div>
        <div class="foot"><button class="btn primary" data-act="seat-done">이 자리로 시작</button></div>`;
    } else if (m.type === 'privacy') {
      const mine = st.events.filter(e => e.user === ui.viewer && e.payload).pop();
      body = `<h2>팀에 공유되는 범위</h2><div class="sub">팀 서버로는 최소 메타데이터만 보내요.</div>
        <button class="opt ${st.shareTitle[ui.viewer] ? 'on' : ''}" data-act="share-title" style="margin-top:12px"><i></i>내 에이전트 작업 제목 공유 <span class="sub">— 끄면 팀원에게 '비공개 작업'으로 보여요</span></button>
        <div class="two"><div><b>공유함</b><br>작업 제목 · 에이전트 상태 · 브랜치 · 상대 파일 경로 · 변경 분류 · 경고</div><div><b>공유 안 함</b><br>코드 · 프롬프트 원문 · 로그인 쿠키·토큰 · 개인 워크스페이스 이름 · OS 절대경로</div></div>
        ${mine ? `<div class="hc-sec" style="margin-top:14px">내가 마지막으로 보낸 내용</div><pre class="pjson">${esc(JSON.stringify(mine.payload, null, 2))}</pre>` : ''}
        <div class="foot"><button class="btn primary" data-act="modal-close">확인</button></div>`;
    }
    return `<div class="modal-back" data-act="modal-back"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${body}</div></div>`;
  }

  function onbRun() {
    const o = ui.modal.o;
    o.phase = 'running';
    const tick = () => {
      if (!ui.modal || ui.modal.o !== o) return;
      if (o.done >= 4) { o.phase = 'logins'; return; }
      o.log.push(...ONB_LOG[o.done]);
      o.done += 1;
      later(o.done >= 4 ? 300 : 700, tick);
    };
    later(400, tick);
  }
  function onbFinish() {
    const o = ui.modal.o;
    o.phase = 'starting';
    o.log.push('> npm run dev');
    later(900, () => { if (ui.modal && ui.modal.o === o) { o.phase = 'done'; o.log.push('▶ http://capstone.localhost (포트 3002 자동 배정)'); } });
  }

  function createSubmit() {
    const m = ui.modal, d = m.draft, v = ui.viewer;
    const name = d.name.trim();
    if (!name) { m.err = '이름을 적어 주세요'; return; }
    if (myWs().some(w => w.name === name)) { m.err = '이미 있는 이름이에요'; return; }
    const folder = d.folder.trim() || '~/projects/' + Date.now();
    const base = folder.split('/').pop();
    const id = 'ws' + Date.now();
    const share = d.session === 'share' ? env() : null;
    const ports = Object.values(ui.local).flatMap(x => Object.values(x)).map(x => x.port || 3000);
    const port = Math.max(...ports) + 1;
    const host = d.cmd.trim() ? `${base.split('-')[0]}.localhost` : null;
    ui.wsList.push({ id, name, short: name[0], kind: 'personal', color: NEW_COLORS[ui.wsList.length % NEW_COLORS.length], members: [v] });
    ui.local[v][id] = {
      loggedIn: !!(share && share.loggedIn), tab: 0, server: host ? 'running' : 'none', host, port: host ? port : null, cmd: d.cmd.trim(), env: host ? { PORT: String(port) } : {},
      files: ['자료/'], downloads: [], tabs: d.tabs.length ? d.tabs.slice() : ['새 탭'], privateTabs: [], branch: 'main',
      account: share ? share.account : '새 세션', email: share ? share.email : '로그인 전',
      folder, win: winPath(v, folder), partition: share ? share.partition : 'persist:ws-' + base, download: `${name}/자료`,
      term: host ? [['cmd', d.cmd.trim()], ['ok', `http://${host} (포트 ${port} 자동 배정)`]] : [['dim', '실행 명령 없이 만들었어요']],
    };
    ui.wsStatus[v][id] = 'background';
    setWs(id);
    ui.modal = null;
    go('home');
    toast(`${esc(name)} 만들었어요 — 세션 ${esc(ui.local[v][id].partition)}`);
  }

  // ───────────────────────── 렌더 ─────────────────────────
  const app = document.getElementById('app');
  function render() {
    const active = document.activeElement;
    const focusId = active && active.id;
    const kept = {};
    app.querySelectorAll('input[id]:not([data-norestore])').forEach(el => { if (el.type !== 'checkbox' && el.value) kept[el.id] = el.value; });
    const calEl = document.getElementById('calscroll');
    const calTop = calEl ? calEl.scrollTop : null;

    if (!canSee(ui.viewer, curId())) ui.cur[ui.viewer] = 'capstone';
    let side, pane, dark = false;
    // 본문을 먼저 그려야 읽음 처리가 레일 배지에 반영된다
    if (ui.view === 'activity') { pane = activityPane(); side = activitySide(); }
    else if (ui.view === 'cal') { pane = calPane(); side = calSide(); }
    else if (ui.view === 'team') { pane = teamPane(); side = teamSide(); dark = true; }
    else { pane = homePane(); side = homeSide(); }
    app.innerHTML = shell(side, pane, dark) + menuHTML() + (ui.view === 'cal' ? popoverHTML() : '') + modalHTML();

    Object.keys(kept).forEach(id => { const el = document.getElementById(id); if (el && !el.value) el.value = kept[id]; });
    ['msgs', 'termbody', 'htermbody'].forEach(id => { const el = document.getElementById(id); if (el) el.scrollTop = el.scrollHeight; });
    const cs = document.getElementById('calscroll');
    if (cs && calTop != null) cs.scrollTop = calTop;
    if (focusId) { const el = document.getElementById(focusId); if (el) el.focus({ preventScroll: true }); }
    syncPresence();
    if (R) R.layout(ui.view === 'home' && !ui.modal ? realSel : null);
  }

  function go(v) {
    ui.view = v; ui.popover = null;
    try { history.replaceState(null, '', '#' + v); } catch (_) { /* file:// */ }
  }

  // ───────────────────────── 액션 ─────────────────────────
  const A = {
    view: d => go(d.v),
    menu: d => { ui.menu = ui.menu === d.m ? null : d.m; },
    ws: d => { realSel = null; setWs(d.id); ui.menu = null; ui.graphSel = null; },
    'seat-open': () => { ui.modal = { type: 'persona' }; },
    seat: d => { setPersona(d.u); },
    'seat-done': () => { setPersona(ui.viewer); ui.modal = null; toast(`${esc(U[ui.viewer].name)} 자리로 참여했어요`); },
    'viewer-set': d => { setPersona(d.u); },
    search: () => toast('검색은 다음 단계예요'),

    // 작업공간
    tab: d => { const E = env(); E.tab = +d.i; const t = tabsOf()[E.tab]; if (t && t.shared) ui.tabClicked.add(ui.viewer + '|' + t.title); },
    'tab-add': () => { ui.tabAdd = true; later(0, () => { const el = document.getElementById('tabname'); if (el) el.focus(); }); },
    'tab-add-close': () => { ui.tabAdd = false; },
    'tab-mine': () => {
      const el = document.getElementById('tabname'); const name = el ? el.value.trim() : '';
      if (!name) return;
      const w = curWs();
      if (w.id === 'capstone') ui.privTabs[ui.viewer].push(name);
      else if (w.kind === 'team') env().privateTabs.push(name);
      else env().tabs.push(name);
      el.value = ''; ui.tabAdd = false;
      toast(w.kind === 'team' ? `'${esc(name)}' 내 탭으로 추가 — 팀원에게는 보이지 않아요` : `'${esc(name)}' 탭 추가`);
    },
    'tab-shared': () => {
      const el = document.getElementById('tabname'); const name = el ? el.value.trim() : '';
      if (!name) return;
      el.value = ''; ui.tabAdd = false;
      if (st.team.sharedTabs.includes(name.slice(0, 40))) { toast('이미 있는 탭이에요'); return; }
      if (dispatch({ type: 'sharedTab', name })) toast(`'${esc(name)}' 팀 공유 탭 추가 → 팀원 모두에게 반영돼요`);
    },
    logout: () => { const E = env(); E.loggedIn = false; toast(`${esc(curWs().name)}에서만 로그아웃했어요 — 다른 워크스페이스 로그인은 그대로예요`); },
    login: () => { const E = env(); E.loggedIn = true; if (E.email === '로그인 전') { E.email = `${U[ui.viewer].win}@gmail.com`; E.account = '개인 Google 계정'; } toast('이 워크스페이스 세션에만 로그인했어요'); },
    'server-start': () => startServer(env()),
    'server-stop': () => stopServer(env()),
    download: d => doDownload(env(), d.file),
    sleep: () => { ui.wsStatus[ui.viewer][curId()] = 'sleep'; toast(`${esc(curWs().name)} 잠자기 — 탭 리소스를 멈췄어요${env().server === 'running' ? ' · 서버는 유지' : ''}`); },
    wake: () => { ui.wsStatus[ui.viewer][curId()] = 'active'; toast(`${esc(curWs().name)} 깨움`); },
    vscode: () => toast(`VS Code에서 ${esc(env().folder)} 열기 — 편집은 원래 쓰던 도구에서`),
    discord: () => toast(`Discord 앱에서 ${esc(curWs().discord || '')} 채널을 열어요`),

    // 활동
    'feed-filter': d => { ui.feedFilter = d.f; },
    evidence: d => { ui.expanded[d.id] = !ui.expanded[d.id]; },
    feedback: d => { if (dispatch({ type: 'feedback', viewer: ui.viewer, key: d.key, v: d.v })) toast('피드백을 남겼어요 — 경고 규칙 개선에 써요'); },
    dismiss: d => {
      const viewer = ui.viewer;
      if (!dispatch({ type: 'alert', viewer, key: d.key, state: 'dismissed' })) return;
      ui.graphSel = { k: 'none' };
      toast('알림을 숨겼어요', { label: '되돌리기', fn: () => { dispatch({ type: 'alert', viewer, key: d.key, state: null }); } });
    },
    restart: d => {
      if (!dispatch({ type: 'alert', viewer: ui.viewer, key: d.key, state: 'handled' })) return;
      const E = ui.local[ui.viewer].capstone;
      E.term.push(['cmd', 'docker compose up -d && npm run dev']);
      E.server = 'starting';
      later(900, () => { E.server = 'running'; E.term.push(['ok', 'http://capstone.localhost (재시작 · redis 추가됨)']); });
      toast('capstone.localhost 다시 시작 — docker compose up -d && npm run dev');
    },
    'notify-open': d => { ui.modal = { type: 'notify', key: d.key }; },
    'notify-send': () => {
      const a = alertsFor(ui.viewer).find(x => x.key === ui.modal.key);
      const run = activeRunOf(ui.viewer);
      if (a && run && dispatch({ type: 'notify', viewer: ui.viewer, key: a.key, rid: run.id, text: notifyText(a) })) {
        toast(`'${esc(run.title)}' 에이전트에게 전달했어요`);
      }
      ui.modal = null;
    },

    // 캘린더 · 과제
    week: d => { ui.weekOffset[ui.viewer] = +d.d === 0 ? 0 : ui.weekOffset[ui.viewer] + +d.d; ui.popover = null; },
    'goto-date': d => {
      const base = startOfDay(now());
      base.setDate(base.getDate() - ((base.getDay() + 6) % 7));
      ui.weekOffset[ui.viewer] = Math.floor(Math.round((startOfDay(new Date(+d.t)) - base) / DAY) / 7);
    },
    'cal-toggle': d => { if (ui.calHidden[ui.viewer].has(d.ws)) ui.calHidden[ui.viewer].delete(d.ws); else ui.calHidden[ui.viewer].add(d.ws); },
    pop: (d, t, e) => { ui.popover = { k: d.k, id: d.id, x: e.clientX, y: e.clientY }; },
    'pop-close': () => { ui.popover = null; },
    'task-item': d => {
      const t = taskById(d.task), i = +d.i;
      if (!t || !t.items[i]) return;
      if (t.team) { dispatch({ type: 'task', id: t.id, i, done: !t.items[i].done }); return; }   // 팀 과제: 팀원과 함께
      const mine = ui.ptasks[ui.viewer][t.id] || (ui.ptasks[ui.viewer][t.id] = t.items.map(x => x.done));
      mine[i] = !mine[i];                                                                      // 개인 과제: 이 브라우저에만
    },
    'task-open': d => { ui.openTask[ui.viewer] = ui.openTask[ui.viewer] === d.id ? null : d.id; },

    // 팀
    gsel: d => { ui.graphSel = { k: d.k, id: d.id }; },
    'gsel-close': () => { ui.graphSel = { k: 'none' }; },
    'run-stop': d => {
      const r = st.agents.find(x => x.id === d.id);
      if (!r || !dispatch({ type: 'runStatus', rid: r.id, status: 'done', last: '사용자가 종료' })) return;
      ui.term[ui.viewer].push({ at: new Date(), h: `<span class="m">■ "${esc(r.title)}" 에이전트 종료 — 팀 현황에서 빠져요</span>` });
      ui.graphSel = { k: 'none' };
    },
    'run-resume': d => {
      const r = st.agents.find(x => x.id === d.id);
      if (!r) return;
      toast(`외부 터미널에서 ${esc(r.tool)} 세션을 열어요`);
      later(1200, () => { dispatch({ type: 'runStatus', rid: d.id, status: 'running', last: '권한 승인 · 작업 재개' }); });
    },
    'invite-open': () => { ui.modal = { type: 'invite', role: '팀원' }; later(0, () => { const el = document.getElementById('inv-email'); if (el) el.focus(); }); },
    'invite-role': d => { ui.modal.role = d.r; },
    'invite-send': () => {
      const el = document.getElementById('inv-email');
      const email = (el ? el.value : '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ui.modal.err = '이메일 형식을 확인해 주세요'; return; }
      if (!dispatch({ type: 'invite', email, role: ui.modal.role })) return;
      ui.modal = { type: 'invite', sent: true, email, role: ui.modal.role };
    },
    'onb-open': () => { ui.modal = { type: 'onb', o: { phase: 'confirm', done: 0, logins: { notion: false, figma: false }, log: [], later: false } }; },
    'onb-start': () => onbRun(),
    'onb-login': d => { ui.modal.o.logins[d.k] = true; toast(`${d.k === 'figma' ? '피그마' : '노션'} 로그인 완료 — 이 워크스페이스 세션에만 저장돼요`); },
    'onb-later': () => { ui.modal.o.later = true; onbFinish(); },
    'onb-finish': () => onbFinish(),
    'privacy-open': () => { ui.modal = { type: 'privacy' }; },
    'share-title': () => { dispatch({ type: 'shareTitle', user: ui.viewer, value: !st.shareTitle[ui.viewer] }); },

    // 생성
    'create-open': () => { ui.menu = null; ui.modal = { type: 'create', draft: { type: '과제', name: '', folder: '~/projects/', session: 'new', cmd: '', tabs: TYPE_DEFAULTS['과제'].tabs.slice() } }; },
    'create-type': d => { const dr = ui.modal.draft; dr.type = d.t; dr.tabs = TYPE_DEFAULTS[d.t].tabs.slice(); dr.cmd = TYPE_DEFAULTS[d.t].cmd; },
    'create-session': d => { ui.modal.draft.session = d.v; },
    'create-submit': () => createSubmit(),

    ...REAL_ACTIONS,
    'modal-close': () => { ui.modal = null; },
    step: () => { stopAuto(); doStep(st.step + 1); },
    auto: () => { stopAuto(); ui.auto = true; autoPlay(ui.autoToken); },
    'auto-stop': () => stopAuto(),
    reset: () => { ui.confirmReset = true; },
    'reset-go': () => { doReset(); },
  };

  const INPUTS = {
    'r-name': v => { ui.modal.name = v; ui.modal.err = null; },
    'r-title': v => { ui.modal.title = v; ui.modal.err = null; },
    'c-name': v => { ui.modal.draft.name = v; ui.modal.err = null; },
    'c-folder': v => { ui.modal.draft.folder = v; },
    'c-cmd': v => { ui.modal.draft.cmd = v; },
  };

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    let changed = false;
    if (ui.menu && !e.target.closest('.menu') && !(t && t.dataset.act === 'menu')) { ui.menu = null; ui.confirmReset = false; changed = true; }
    if (ui.popover && !e.target.closest('.popover') && !(t && t.dataset.act === 'pop')) { ui.popover = null; changed = true; }
    if (t) {
      if (t.dataset.act === 'modal-back') { if (e.target === t) { ui.modal = null; render(); } return; }
      if (t.disabled) { if (changed) render(); return; }
      const fn = A[t.dataset.act];
      if (fn) { fn(t.dataset, t, e); changed = true; }
    }
    if (changed) render();
  });

  document.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.input;
    if (k && INPUTS[k] && ui.modal) INPUTS[k](e.target.value);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (ui.modal || ui.menu || ui.popover)) { ui.modal = null; ui.menu = null; ui.popover = null; render(); return; }
    const t = e.target;
    if (e.key !== 'Enter' || !t.dataset || !t.dataset.enter || e.isComposing) return;
    e.preventDefault();
    const k = t.dataset.enter;
    if (k === 'term') { runTerm(t.value); t.value = ''; }
    else if (k === 'hterm') { runCommand(env(), t.value); t.value = ''; }
    else if (A[k]) A[k](t.dataset, t, e);
    render();
  });

  // ───────────────────────── 시작 ─────────────────────────
  // 예: #team/4@jiyun~14:30   (예전 주소 #chat → 활동, #today → 팀)
  const m = (location.hash || '').match(/^#?(home|team|activity|chat|cal|today)?(?:\/(\d))?(?:@(minsu|jiyun|hyunwoo))?(?:~(\d{1,2}):(\d{2}))?/) || [];
  ui = freshUI(null);
  ui.viewer = storedPersona() || 'minsu';
  ui.view = ({ chat: 'activity', today: 'team' })[m[1]] || m[1] || 'home';
  rebuild();
  if (NET.mode === 'local') {
    // 파일로 열 때만: 시연용 바로가기 (공유 모드에서는 열기만으로 기록을 쓰지 않는다)
    if (m[5]) { const d = new Date(); d.setHours(+m[4], +m[5], 0, 0); clockShift = d.getTime() - Date.now(); }
    if (m[3]) ui.viewer = m[3];
    if (m[2]) for (let i = 1; i <= Math.min(+m[2], STEPS.length); i++) doStep(i, true);
  }
  if (R) {
    R.onChange(() => {
      // 로그인 창이 열린 채로 승인되면 창을 닫고 알린다.
      const A = R.state.auth;
      if (ui.modal && ui.modal.type === 'real-login' && A.status === 'authenticated' && A.me) {
        ui.modal = null;
        toast(`GitHub 계정 <b>${esc(A.me.displayName)}</b>(으)로 로그인했어요`);
      }
      render();
    });
    R.setToast(msg => toast(esc(msg)));
  }
  render();
  connect();
  window.addEventListener('hashchange', () => {
    const v = (location.hash || '').slice(1);
    if (['home', 'team', 'activity', 'cal'].includes(v) && v !== ui.view) { ui.view = v; ui.popover = null; render(); }
  });
})();
