/* Cadora 프로토타입 — UI
 * 상태 3층: st(팀·이벤트 시뮬레이션, sim.js) · L(민수 노트북의 로컬 워크스페이스) · ui(화면 상태)
 * 렌더는 문자열 템플릿 → #app.innerHTML, 이벤트는 data-act / data-input / data-change 위임.
 */
(function () {
  'use strict';
  const S = window.Cadora.sim;
  const U = S.USERS;

  // ───────────────────────── 유틸 ─────────────────────────
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const z = n => String(n).padStart(2, '0');
  const hms = d => `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  const ago = d => {
    const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (s < 45) return '방금';
    if (s < 3600) return `${Math.round(s / 60)}분 전`;
    return `${Math.round(s / 3600)}시간 전`;
  };
  const byId = id => L.workspaces.find(w => w.id === id);
  const PIN = '<svg class="pin" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M10 1.3l4.7 4.7-1.3 1.3-.9-.3-2.7 2.7.3 2.7-1.3 1.3-2.6-2.6-3.6 3.6-.8-.8 3.6-3.6L2.8 8l1.3-1.3 2.7.3 2.7-2.7-.3-.9z"/></svg>';
  const LOCK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" style="vertical-align:-1px"><path fill="currentColor" d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h.5A1 1 0 0 1 13 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm1.5 0h4V5a2 2 0 0 0-4 0z"/></svg>';
  const CAT = S.CATEGORY;

  // ───────────────────────── 상태 ─────────────────────────
  let st, L, ui;
  const VIEWS = [
    { id: 'home',    n: '1', label: '홈' },
    { id: 'split',   n: '2', label: '동시 보기' },
    { id: 'create',  n: '3', label: '새 워크스페이스' },
    { id: 'team',    n: '4', label: '팀 설정' },
    { id: 'onboard', n: '5', label: '팀원 온보딩' },
    { id: 'ai',      n: '6', label: '팀 AI 현황' },
    { id: 'demo',    n: '★', label: 'P0 시연 · 두 기기', star: true },
  ];

  const TYPE_DEFAULTS = {
    '과제':        { desc: '강의 사이트 · 자료 · 제출 폴더', tabs: ['과제 명세 · 학교 LMS', '강의자료.pdf'], download: '작업 폴더/자료', cmd: '', ai: { tabs: true, files: true, terminal: true, other: false } },
    '개발 팀플':   { desc: '저장소 · 서버 · 비밀값', tabs: ['GitHub 저장소', '노션 기획', 'API 문서'], download: '작업 폴더/자료', cmd: 'npm run dev', ai: { tabs: true, files: true, terminal: true, other: false } },
    '공모전·문서': { desc: '기획서 · 디자인 툴', tabs: ['공모전 공지', '기획서 · Google Docs', 'Figma'], download: '작업 폴더/자료', cmd: '', ai: { tabs: true, files: true, terminal: false, other: false } },
    '직접 설정':   { desc: '빈 워크스페이스', tabs: [], download: '작업 폴더/다운로드', cmd: '', ai: { tabs: false, files: false, terminal: false, other: false } },
  };

  function createLocal() {
    return {
      active: 'compiler',
      workspaces: [
        {
          id: 'compiler', name: '컴파일러 과제 3', kind: 'personal', type: '과제', status: 'active',
          folder: '~/projects/compiler-hw3', win: 'C:\\Users\\minsu\\projects\\compiler-hw3', download: '과제3/자료',
          account: '학교 Google 계정', email: 'minsu@univ.ac.kr', loggedIn: true, partition: 'persist:ws-compiler',
          host: 'compiler.localhost', port: 3001, server: 'running', cmd: 'npm run dev', deadline: '마감 D-3',
          tabs: ['과제 명세 · 학교 LMS', '강의자료 7주차.pdf', 'compiler.localhost'], tab: 0,
          ai: { tabs: true, files: true, terminal: true, other: false }, week: '6시간 12분', branch: 'main',
          env: { NODE_ENV: 'development', PORT: '3001', GIT_AUTHOR_EMAIL: 'minsu@univ.ac.kr' },
          files: ['src/', 'tests/', 'package.json', 'README.md', '자료/'],
          term: [['cmd', 'npm run dev'], ['ok', 'http://compiler.localhost (포트 3001 자동 배정)'], ['cmd', 'git config user.email'], ['dim', 'minsu@univ.ac.kr   (학교 계정 이메일 · 이 폴더에 자동 적용)']],
          downloads: [],
        },
        {
          id: 'capstone', name: '캡스톤 팀플', kind: 'team', type: '개발 팀플', status: 'background', members: 4,
          folder: '~/projects/capstone', win: 'C:\\Users\\minsu\\projects\\capstone', download: '캡스톤 팀플/자료',
          account: '개인 Google 계정', email: 'minsu.dev@gmail.com', loggedIn: true, partition: 'persist:ws-capstone',
          host: 'capstone.localhost', port: 3002, server: 'running', cmd: 'docker compose up · npm run dev', tab: 0,
          ai: { tabs: true, files: true, terminal: true, other: false }, week: '11시간 40분', branch: 'feature/signup',
          env: { NODE_ENV: 'development', PORT: '3002', DATABASE_URL: 'postgresql://capstone:Sup3rS3cret!@localhost:5432/capstone', OPENAI_API_KEY: 'sk-proj-4fT9qL2mXv8RkZ0aB7cD' },
          files: ['prisma/', 'src/', 'docker-compose.yml', 'package.json', 'CLAUDE.md'],
          term: [['cmd', 'docker compose up -d'], ['dim', '✔ Container capstone-db  Started'], ['cmd', 'npm run dev'], ['ok', 'http://capstone.localhost · api.capstone.localhost (포트 3002 자동 배정)']],
          downloads: [],
        },
        {
          id: 'contest', name: '공모전 기획서', kind: 'team', type: '공모전·문서', status: 'background', members: 3,
          folder: '~/projects/contest-plan', win: 'C:\\Users\\minsu\\projects\\contest-plan', download: '공모전 기획서/자료',
          account: '개인 Google 계정', email: 'minsu.dev@gmail.com', loggedIn: true, partition: 'persist:ws-contest',
          host: null, server: 'none', cmd: '', tabs: ['공모전 공지', '기획서 · Google Docs', 'Figma 시안'], tab: 0,
          ai: { tabs: true, files: true, terminal: false, other: false }, week: '2시간 05분', branch: '-',
          env: {}, files: ['기획서_v3.docx', '발표자료/'], term: [['dim', '실행 명령이 없는 워크스페이스예요.']], downloads: [],
        },
        {
          id: 'vr', name: 'VR 콘텐츠 과제', kind: 'personal', type: '과제', status: 'sleep',
          folder: '~/projects/vr-content', win: 'C:\\Users\\minsu\\projects\\vr-content', download: 'VR 과제/자료',
          account: '학교 Google 계정', email: 'minsu@univ.ac.kr', loggedIn: true, partition: 'persist:ws-vr',
          host: 'vr.localhost', port: 3003, server: 'stopped', cmd: 'npm run preview', tabs: ['과제 안내 · 학교 LMS', 'Unity 문서'], tab: 0,
          ai: { tabs: true, files: true, terminal: true, other: false }, week: '0분', branch: 'main',
          env: { PORT: '3003' }, files: ['Assets/', 'ProjectSettings/', 'package.json'], term: [], downloads: [],
        },
      ],
    };
  }

  function freshUI(view) {
    return {
      gen: (ui ? ui.gen : 0) + 1,
      view: view || 'demo',
      step: 0,
      auto: false,
      autoToken: 0,
      say: null,
      selectedEvent: null,
      expanded: {},
      seen: { minsu: new Set(), jiyun: new Set(), hyunwoo: new Set() },
      seenTabs: new Set(),
      firstRender: true,
      modal: null,
      split: { left: 'compiler', right: 'capstone', focus: 'left' },
      create: draftFor('과제'),
      agentDraft: { title: '비밀번호 재설정 메일 발송', tool: 'Claude Code', branch: S.suggestBranch('비밀번호 재설정 메일 발송'), branchEdited: false },
      teamTabDraft: null,
      secretDraft: null,
      onb: { phase: 'confirm', done: 0, logins: { notion: false, figma: false }, log: [], later: false },
      inject: { user: 'jiyun', path: 'package.json', how: 'hook' },
    };
  }

  function draftFor(type, keep) {
    const d = TYPE_DEFAULTS[type];
    return Object.assign({
      name: '알고리즘 과제 2', folder: '~/projects/algorithm-hw2', session: 'new', err: null,
    }, keep || {}, { type, tabs: d.tabs.slice(), download: d.download, cmd: d.cmd, ai: Object.assign({}, d.ai) });
  }

  function reset(view) {
    st = S.createState();
    L = createLocal();
    ui = freshUI(view);
  }

  /** reset 이후 이전 세대의 타이머가 새 상태를 건드리지 않도록 */
  function later(ms, fn) {
    const gen = ui.gen;
    setTimeout(() => { if (gen === ui.gen) { fn(); render(); } }, ms);
  }

  // ───────────────────────── 토스트 ─────────────────────────
  function toast(html, { icon = '✓', ms = 4200, action } = {}) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<span class="ic">${icon}</span><span>${html}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').addEventListener('click', () => { action.fn(); dismiss(); });
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    function dismiss() { el.classList.add('out'); setTimeout(() => el.remove(), 260); }
    setTimeout(dismiss, ms);
  }

  // ───────────────────────── 공통 조각 ─────────────────────────
  const STATUS_LABEL = { active: '활성', background: '백그라운드', sleep: '잠자기' };
  const DOT = { active: 'green', background: 'amber', sleep: 'gray' };

  function serverChip(ws, withPort) {
    if (!ws.host) return '';
    if (ws.server === 'running') return `<span class="chip green"><span class="dot green"></span>${withPort ? '' : '서버 실행 중 · '}${esc(ws.host)}${withPort ? ' · :' + ws.port : ''}</span>`;
    if (ws.server === 'starting') return `<span class="chip amber"><span class="dot amber"></span>서버 시작 중 · ${esc(ws.host)}</span>`;
    return `<span class="chip"><span class="dot gray"></span>서버 꺼짐 · ${esc(ws.host)}</span>`;
  }

  function wsTabs(ws) {
    if (ws.id === 'capstone') {
      const t = S.tabsFor(st, 'minsu');
      return t.shared.map(x => ({ title: x, shared: true })).concat(t.private.map(x => ({ title: x, private: true })));
    }
    return ws.tabs.map(x => ({ title: x }));
  }

  function myActiveRuns(user, wsId) {
    return st.agents.filter(a => a.user === user && S.isActive(a) && (!wsId || a.ws === wsId));
  }

  function sidebar() {
    const inSplit = ui.view === 'split';
    const items = L.workspaces.map(ws => {
      let meta = [STATUS_LABEL[ws.status], ws.kind === 'team' ? '팀' : '개인'];
      let dot = DOT[ws.status];
      let on = ws.id === L.active && ui.view === 'home';
      if (inSplit && (ws.id === ui.split.left || ws.id === ui.split.right)) {
        meta = [ws.id === ui.split.left ? '왼쪽 화면' : '오른쪽 화면'];
        dot = 'green'; on = true;
      }
      let badge = '';
      if (ws.id === 'capstone') {
        const runs = myActiveRuns('minsu', 'capstone').length;
        const alerts = S.computeAlerts(st, 'minsu').filter(a => a.status === 'new').length;
        if (runs && !inSplit) meta.push('AI 작업 중');
        if (alerts && !inSplit) meta.push('경고 ' + alerts);
        if (alerts) badge = `<span class="badge amber" title="새 경고">${alerts}</span>`;
        else if (runs) badge = `<span class="badge" title="실행 중인 에이전트">${runs}</span>`;
      }
      if (ui.view === 'ai' && ws.id === 'capstone') on = true;
      return `<button class="ws-item ${on ? 'on' : ''}" data-act="open-ws" data-id="${ws.id}">
        <span class="dot ${dot}"></span>
        <span class="grow"><span class="ws-name">${esc(ws.name)}</span><br><span class="ws-meta">${esc(meta.join(' · '))}</span></span>
        ${badge}
      </button>`;
    }).join('');
    const c = { active: 0, background: 0, sleep: 0 };
    L.workspaces.forEach(w => c[w.status]++);
    const foot = inSplit
      ? '두 워크스페이스를 끌어다 놓으면 분할 보기가 돼요. 오른쪽 위 메뉴로 바꿀 수도 있어요.'
      : `활성 ${c.active} · 백그라운드 ${c.background} · 잠자기 ${c.sleep}<br>잠자는 워크스페이스는 탭을 멈춰 메모리를 아껴요`;
    return `<aside class="sidebar">
      <div class="app-name">Cadora <span class="who">민수 · 노트북 A</span></div>
      <div class="group-label">내 워크스페이스</div>
      ${items}
      <button class="new-ws" data-act="nav" data-view="create">+ 새 워크스페이스</button>
      <div class="foot">${foot}</div>
    </aside>`;
  }

  // ───────────────────────── ① 홈 ─────────────────────────
  function viewHome() {
    const ws = byId(L.active);
    const isTeam = ws.kind === 'team';
    const chips = [
      serverChip(ws),
      `<span class="chip">브라우저 세션 · ${esc(ws.account)}</span>`,
      `<span class="chip">다운로드 → ${esc(ws.download)}</span>`,
      ws.deadline ? `<span class="chip amber">${esc(ws.deadline)}</span>` : '',
      isTeam ? `<span class="chip blue">팀 · ${ws.members}명</span>` : '',
    ].join('');
    const head = `<div class="page-head">
      <div class="grow">
        <h1>${esc(ws.name)} <span class="chip sm">${isTeam ? '팀' : '개인'}</span></h1>
        <div class="chips">${chips}</div>
      </div>
      <div class="actions">
        ${ws.id === 'capstone' ? `<button class="btn" data-act="nav" data-view="ai">팀 AI 현황</button><button class="btn" data-act="nav" data-view="team">팀 설정</button>` : ''}
        ${ws.status === 'sleep' ? `<button class="btn" data-act="wake">깨우기</button>` : `<button class="btn" data-act="sleep">잠자기</button>`}
        <button class="btn primary" data-act="ask-ai">AI에게 묻기 · 이 워크스페이스 자료만</button>
      </div>
    </div>`;

    if (ws.status === 'sleep') {
      return head + `<div class="sleep-cover">
        <div class="big">☾</div>
        <div><b>잠자기 중</b> — 탭과 브라우저 리소스를 멈췄어요.</div>
        <div class="small">잠자기는 프로세스 강제 종료와 달라요. 서버 유지 여부는 설정을 따라요 (현재: ${ws.server === 'running' ? '서버 유지' : '서버 꺼짐'}).</div>
        <button class="btn primary" data-act="wake">깨우기</button>
      </div>`;
    }

    const tabs = wsTabs(ws);
    if (ws.tab >= tabs.length) ws.tab = 0;
    let lastShared = -1;
    tabs.forEach((t, i) => { if (t.shared) lastShared = i; });
    const strip = tabs.map((t, i) => `${i === lastShared + 1 && lastShared >= 0 ? '<span class="tab-sep"></span>' : ''}<button class="tab ${i === ws.tab ? 'on' : ''} ${t.private ? 'private' : ''}" data-act="tab" data-i="${i}" title="${t.shared ? '팀 공유 고정 탭' : t.private ? '내 개인 탭 (팀에 공유되지 않음)' : ''}">${t.shared ? PIN : ''}${esc(t.title)}${t.private ? ' <span class="xs muted">개인</span>' : ''}</button>`).join('');
    const cur = tabs[ws.tab] || { title: '' };

    return head + `
      <div class="tabstrip">${strip}<button class="tab tab-add" data-act="tab-add" title="탭 추가">+</button></div>
      <div class="browser">
        <div class="sessionbar">
          <span>${LOCK} 이 워크스페이스 전용 세션 — 다른 워크스페이스의 로그인과 섞이지 않아요</span>
          <span class="grow"></span>
          <span class="mono xs muted">${esc(ws.partition)}</span>
          ${ws.loggedIn
            ? `<span class="chip sm green">${esc(ws.email)}</span><button class="btn sm" data-act="logout">로그아웃</button>`
            : `<span class="chip sm">로그아웃됨</span><button class="btn sm primary" data-act="login">로그인</button>`}
        </div>
        <div class="page">${browserPage(ws, cur.title)}</div>
      </div>
      <div class="home-bottom">
        ${terminal(ws)}
        <div class="card">
          <div class="card-label">이번 주 이 워크스페이스에 머문 시간</div>
          <div class="stat-big">${esc(ws.week)}</div>
          <div class="card-label">AI가 볼 수 있는 범위</div>
          <div class="bold">${aiScopeText(ws, tabs.length)}</div>
          <div class="xs muted" style="margin-top:6px">다른 워크스페이스: ${ws.ai.other ? '켜짐' : '꺼짐'} · 실행 위치와 전달 맥락 기준이에요 (보안 격리 아님)</div>
        </div>
      </div>`;
  }

  function aiScopeText(ws, nTabs) {
    const p = [];
    if (ws.ai.tabs) p.push(`탭 ${nTabs}개`);
    if (ws.ai.files) p.push('폴더 파일');
    if (ws.ai.terminal) p.push('터미널 출력');
    return p.length ? p.join(' · ') : '없음';
  }

  function browserPage(ws, title) {
    if (!ws.loggedIn) {
      return `<div class="offline-page"><div class="big">🔑</div><div><b>${esc(ws.name)}</b>에서만 로그아웃됐어요.</div>
        <div class="small muted">${L.workspaces.filter(w => w.id !== ws.id && w.loggedIn).map(w => esc(w.name)).join(', ')}의 로그인은 그대로예요. (세션 partition 분리 · FR-02)</div></div>`;
    }
    if (/localhost/.test(title)) {
      if (ws.server !== 'running') {
        return `<div class="offline-page"><div class="big">⚠</div><div><b>${esc(ws.host)}</b>에 연결할 수 없어요 — 서버가 꺼져 있어요.</div>
          <button class="btn primary" data-act="server-start">서버 시작 (${esc(ws.cmd)})</button></div>`;
      }
      return `<div class="fakepage-title">${esc(ws.host)}</div><div class="fakepage-meta">개발 서버 · 포트 ${ws.port} 자동 배정 · 이 워크스페이스 터미널에서 실행 중</div>
        <div class="skel h"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:52%"></div><div class="skel block"></div>`;
    }
    if (/\.pdf$/i.test(title)) {
      return `<div class="row"><div class="grow"><div class="fakepage-title">📄 ${esc(title)}</div><div class="fakepage-meta">내장 PDF 뷰어</div></div>
        <button class="btn" data-act="download" data-file="${esc(title)}" data-ws="${ws.id}">⬇ 받기</button></div>
        <div class="skel" style="width:88%"></div><div class="skel" style="width:76%"></div><div class="skel" style="width:58%"></div><div class="skel block"></div>`;
    }
    return `<div class="row"><div class="grow"><div class="fakepage-title">${esc(title)}</div><div class="fakepage-meta">${esc(ws.account)} · ${esc(ws.email)}로 로그인된 페이지</div></div>
      <button class="btn sm" data-act="download" data-file="중간발표_초안.pdf" data-ws="${ws.id}">⬇ 첨부파일 받기</button></div>
      <div class="skel h"></div><div class="skel" style="width:84%"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:48%"></div><div class="skel block"></div>`;
  }

  function terminal(ws) {
    const lines = ws.term.map(([t, s]) => `<div class="l-${t}">${esc(s)}</div>`).join('');
    return `<div class="terminal">
      <div class="term-head"><span>터미널 · PowerShell · ${esc(ws.folder)}</span><span class="grow"></span>
        ${ws.host ? (ws.server === 'running' ? `<button class="term-btn" data-act="server-stop">■ 서버 중지</button>` : `<button class="term-btn" data-act="server-start">▶ ${esc(ws.cmd.split(' · ').pop())}</button>`) : ''}
      </div>
      <div class="term-body">${lines || '<div class="l-dim">help 를 입력해 보세요.</div>'}</div>
      <div class="term-input"><span>PS ${esc(ws.folder.replace(/^~\/projects\//, '~\\'))}&gt;</span><input id="term-${ws.id}" data-enter="term-run" placeholder="help · pwd · npm run dev · echo $env:DATABASE_URL" autocomplete="off" spellcheck="false" aria-label="터미널 입력"></div>
    </div>`;
  }

  function runCommand(ws, raw) {
    const cmd = raw.trim();
    if (!cmd) return;
    const out = (t, s) => ws.term.push([t, s]);
    out('cmd', cmd);
    const c = cmd.toLowerCase();
    let m;
    if (c === 'help') out('dim', '지원 명령: pwd · ls · npm run dev · stop · git branch · git config user.email · echo $env:이름 · env · clear');
    else if (c === 'pwd' || c === 'get-location') out('dim', ws.win);
    else if (c === 'ls' || c === 'dir') out('dim', ws.files.join('    '));
    else if (/^(npm (run )?(dev|start|preview)|docker compose up.*)$/.test(c)) startServer(ws, true);
    else if (c === 'stop' || c === '^c' || c === 'ctrl+c') stopServer(ws);
    else if (c === 'git branch') out('dim', '* ' + ws.branch);
    else if (c === 'git config user.email') out('dim', ws.email);
    else if ((m = cmd.match(/^echo\s+\$(?:env:)?([A-Za-z_][A-Za-z0-9_]*)$/i))) {
      const name = m[1].toUpperCase();
      const v = ws.env[name];
      if (v === undefined) out('warn', `${name} — 이 워크스페이스에는 없는 환경변수예요 (워크스페이스마다 따로 관리)`);
      else out('dim', S.maskEnv(name, v) + (S.isSecretName(name) ? '    (비밀값 — 화면·로그에서는 가려요 · FR-19)' : ''));
    } else if (c === 'env' || c === 'gci env:' || c === 'get-childitem env:') {
      const ks = Object.keys(ws.env);
      if (!ks.length) out('dim', '(지정된 환경변수 없음)');
      ks.forEach(k => out('dim', `${k}=${S.maskEnv(k, ws.env[k])}`));
    } else if (c === 'clear' || c === 'cls') ws.term = [];
    else out('warn', `'${cmd}' — 프로토타입 터미널에서는 지원하지 않는 명령이에요. help 를 입력해 보세요.`);
  }

  function startServer(ws, fromTerm) {
    if (!ws.host) { ws.term.push(['warn', '실행 명령이 설정되지 않은 워크스페이스예요.']); return; }
    if (ws.server === 'running') { ws.term.push(['dim', `이미 실행 중 · http://${ws.host}`]); return; }
    if (!fromTerm) ws.term.push(['cmd', ws.cmd.split(' · ').pop()]);
    ws.server = 'starting';
    later(900, () => {
      ws.server = 'running';
      ws.term.push(['ok', `http://${ws.host} (포트 ${ws.port} 자동 배정)`]);
    });
  }
  function stopServer(ws) {
    if (ws.server !== 'running') { ws.term.push(['dim', '실행 중인 서버가 없어요.']); return; }
    ws.server = 'stopped';
    const others = L.workspaces.filter(w => w.id !== ws.id && w.server === 'running').map(w => w.host);
    ws.term.push(['dim', `서버를 종료했어요 — 이 워크스페이스 프로세스만 (${others.join(', ') || '다른 서버 없음'} 은 계속 실행 중)`]);
  }

  function doDownload(ws, file) {
    const same = ws.downloads.filter(d => d.base === file).length;
    const name = same ? file.replace(/(\.[^.]+)$/, ` (${same})$1`) : file;
    ws.downloads.push({ base: file, name, at: new Date() });
    toast(`⬇ ${esc(name)} → <b>${esc(ws.download)}</b> 폴더에 저장했어요`, {
      icon: '⬇', action: { label: '폴더 열기', fn: () => toast(`탐색기에서 <span class="mono">${esc(ws.win)}\\자료</span> 를 열어요 (프로토타입)`, { icon: '📂' }) },
    });
  }

  // ───────────────────────── ② 동시 보기 ─────────────────────────
  function viewSplit() {
    const sides = ['left', 'right'].map(side => pane(byId(ui.split[side]), side)).join('');
    return `<div class="page-head"><div class="grow"><h1>두 워크스페이스 동시 보기</h1>
      <div class="sub" style="margin-top:6px">서로 다른 계정·서버를 유지한 채 나란히 띄워요. 같은 이름의 파일을 받아도 각 워크스페이스 폴더로 나뉘어 들어가요. (FR-02 · FR-04 · FR-05)</div></div></div>
      <div class="split">${sides}</div>`;
  }

  function pane(ws, side) {
    const focus = ui.split.focus === side;
    const run = myActiveRuns('minsu', ws.id)[0];
    const tabs = wsTabs(ws).map(t => t.title);
    const opts = L.workspaces.map(w => `<option value="${w.id}" ${w.id === ws.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    const downloads = ws.downloads.length
      ? `<ul class="download-list">${ws.downloads.map(d => `<li>⬇ ${esc(d.name)} → <b>${esc(ws.download)}</b></li>`).join('')}</ul>` : '';
    return `<section class="pane ${focus ? 'focus' : ''}" data-pane="${side}">
      <div class="pane-head">
        <div class="row"><h2>${esc(ws.name)}</h2><span class="grow"></span>
          ${focus ? '<span class="focus-label">지금 입력 중</span>' : ws.kind === 'team' ? `<span class="chip sm">팀 · ${ws.members}명</span>` : '<span class="chip sm">백그라운드 계속 실행</span>'}
          <select class="select" style="height:30px;width:auto;font-size:12px;padding:0 8px" data-change="split-ws" data-side="${side}" aria-label="${side === 'left' ? '왼쪽' : '오른쪽'} 화면 워크스페이스">${opts}</select>
        </div>
        <div class="row wrap" style="margin-top:10px"><span class="chip">${esc(ws.account)}</span>${serverChip(ws, true)}</div>
      </div>
      <div class="pane-body">
        <div class="tabs-line">탭: ${esc(tabs.join(' · '))}</div>
        ${run ? `<div class="agent-banner">
            <div class="row"><b>AI 에이전트 작업 중</b><span class="grow"></span><span class="xs warn-text bold">${focus ? '' : '백그라운드'}</span></div>
            <div style="margin-top:4px">${esc(run.title)} · ${esc(run.tool)}</div>
            <div class="progress"><i></i></div>
            <div class="small sub">이 워크스페이스의 파일 · 비밀값 · 서버만 사용해요</div>
          </div>` : ''}
        <div class="skel h"></div><div class="skel" style="width:80%"></div><div class="skel" style="width:62%"></div>
        ${ws.host ? `<div class="mini-term">$ ${esc(ws.cmd.split(' · ').pop())}<br><span class="ok">▶ ${esc(ws.host)}${ws.server === 'running' ? '' : ' (꺼짐)'}</span></div>` : ''}
        <div class="row" style="margin-top:14px"><button class="btn sm" data-act="download" data-file="중간발표_초안.pdf" data-ws="${ws.id}">⬇ 중간발표_초안.pdf 받기</button><span class="xs muted">→ ${esc(ws.download)}</span></div>
        ${downloads}
      </div>
    </section>`;
  }

  // ───────────────────────── ③ 새 워크스페이스 ─────────────────────────
  function viewCreate() {
    const d = ui.create;
    const types = Object.keys(TYPE_DEFAULTS).map(t => `<button class="type-opt ${d.type === t ? 'on' : ''}" data-act="create-type" data-type="${t}">
      <span class="t"><span class="radio ${d.type === t ? 'on' : ''}"></span>${t}</span><span class="d">${TYPE_DEFAULTS[t].desc}</span></button>`).join('');
    const tabs = d.tabs.map((t, i) => `<div class="list-input"><span class="grow">${esc(t)}</span><button data-act="create-tab-del" data-i="${i}">삭제</button></div>`).join('');
    const host = (d.folder.split('/').pop() || 'workspace').split('-')[0] || 'workspace';
    const ai = [['tabs', '열린 탭'], ['files', '작업 폴더 파일'], ['terminal', '터미널 출력'], ['other', '다른 워크스페이스 (기본 꺼짐)']]
      .map(([k, l]) => `<label class="check"><input type="checkbox" data-change="create-ai" data-k="${k}" ${d.ai[k] ? 'checked' : ''}>${l}</label>`).join('');
    return `<div class="card form-card">
      <h1>새 워크스페이스</h1>
      <div class="sub" style="margin:6px 0 20px">이 워크스페이스 안의 로그인 · 파일 · 서버 · AI는 다른 워크스페이스와 섞이지 않아요.</div>
      <div class="bold small">종류 — 고르면 아래 항목이 미리 채워져요</div>
      <div class="type-grid">${types}</div>
      <div class="form-grid">
        <div class="field"><label for="c-name">이름</label><input id="c-name" class="input ${d.err === 'name' ? 'err' : ''}" data-input="create-name" value="${esc(d.name)}" placeholder="예: 컴파일러 과제 4">
          ${d.err === 'name' ? '<div class="hint" style="color:var(--red)">이름을 입력하거나 다른 이름을 써 주세요 (이미 있는 이름)</div>' : ''}</div>
        <div class="field"><label for="c-folder">작업 폴더</label><div class="row"><input id="c-folder" class="input" data-input="create-folder" value="${esc(d.folder)}"><button class="btn" style="height:44px" data-act="pick-folder">찾기</button></div></div>
        <div class="field"><span class="label">브라우저 세션</span>
          <div class="opt-line" data-act="create-session" data-v="new"><span class="radio ${d.session === 'new' ? 'on' : ''}"></span>새 세션 — 이 워크스페이스에서만 로그인</div>
          <div class="opt-line" data-act="create-session" data-v="share"><span class="radio ${d.session === 'share' ? 'on' : ''}"></span>다른 워크스페이스 세션 함께 쓰기 <span class="chip sm amber">실험</span></div>
        </div>
        <div class="field"><label for="c-dl">다운로드 저장 위치</label><input id="c-dl" class="input" data-input="create-download" value="${esc(d.download)}"><div class="hint">이 워크스페이스 탭에서 받은 파일은 자동으로 여기 저장돼요</div></div>
        <div class="field"><span class="label">고정 탭</span>${tabs || '<div class="hint" style="margin:0 0 8px">고정 탭이 없어요</div>'}
          <div class="inline-form"><input id="c-newtab" class="input" placeholder="탭 이름 또는 URL" data-enter="create-tab-add"><button class="btn" data-act="create-tab-add">+ 추가</button></div></div>
        <div class="field"><label for="c-cmd">실행 명령 <span class="muted">(선택)</span></label><input id="c-cmd" class="input mono" data-input="create-cmd" value="${esc(d.cmd)}" placeholder="npm run dev">
          <div class="hint" id="c-cmd-hint">${d.cmd ? `들어올 때 켜고 잠잘 때 꺼요 · 주소: ${esc(host)}.localhost (포트 자동)` : '비워 두면 서버 없이 만들어요'}</div></div>
      </div>
      <fieldset class="fieldset"><legend>AI가 볼 수 있는 범위</legend>${ai}</fieldset>
      <div class="row" style="justify-content:flex-end;margin-top:22px"><button class="btn lg" data-act="nav" data-view="home">취소</button><button class="btn lg primary" data-act="create-submit">워크스페이스 만들기</button></div>
    </div>`;
  }

  function submitCreate() {
    const d = ui.create;
    const name = d.name.trim();
    if (!name || L.workspaces.some(w => w.name === name)) { d.err = 'name'; return; }
    const base = (d.folder.split('/').pop() || 'workspace');
    const slug = base.split('-')[0] || 'ws';
    const port = Math.max(...L.workspaces.map(w => w.port || 3000)) + 1;
    const share = d.session === 'share' ? byId(L.active) : null;
    const host = d.cmd ? `${slug}.localhost` : null;
    const ws = {
      id: 'ws' + Date.now(), name, kind: 'personal', type: d.type, status: 'active',
      folder: d.folder, win: 'C:\\Users\\minsu\\' + d.folder.replace(/^~\//, '').replace(/\//g, '\\'),
      download: `${name}/${d.download.split('/').pop()}`,
      account: share ? share.account : '새 세션', email: share ? share.email : '로그인 전', loggedIn: !!share,
      partition: share ? share.partition : 'persist:ws-' + base, host, port, server: d.cmd ? 'running' : 'none', cmd: d.cmd,
      tabs: d.tabs.length ? d.tabs.slice() : ['새 탭'], tab: 0, ai: Object.assign({}, d.ai), week: '0분', branch: 'main',
      env: d.cmd ? { PORT: String(port) } : {}, files: ['자료/'],
      term: d.cmd ? [['cmd', d.cmd], ['ok', `http://${host} (포트 ${port} 자동 배정)`]] : [['dim', '실행 명령 없이 만들었어요.']],
      downloads: [],
    };
    L.workspaces.forEach(w => { if (w.status === 'active') w.status = 'background'; });
    L.workspaces.push(ws);
    L.active = ws.id;
    ui.view = 'home';
    ui.create = draftFor('과제', { name: '', folder: '~/projects/' });
    toast(`'${esc(name)}' 워크스페이스를 만들었어요 — 세션 <span class="mono">${esc(ws.partition)}</span> · 다운로드 → ${esc(ws.download)}`);
  }

  // ───────────────────────── ④ 팀 설정 ─────────────────────────
  function viewTeam() {
    const T = st.team;
    const syncLine = Object.keys(T.synced).map(k => {
      const ok = T.synced[k] === T.version;
      return `<span class="${ok ? 'ok-text' : 'warn-text'}">${U[k].name} ${ok ? '✓' : '대기'}</span>`;
    }).join(' · ');
    const members = T.members.map(m => `<div class="list-row"><span class="grow">${U[m.id].name}${m.id === 'minsu' ? ' (나)' : ''}</span>
      <span class="small ${m.id === 'minsu' ? '' : m.warn ? 'warn-text' : 'sub'}" style="${m.id === 'minsu' ? 'color:var(--blue)' : ''}">${m.role}${m.note ? ' · ' + esc(m.note) : ''}</span></div>`).join('')
      + T.invites.map(i => `<div class="list-row"><span class="grow">${esc(i.email)}</span><span class="small warn-text">${esc(i.role)} · 초대 대기</span></div>`).join('');
    const tabEditor = ui.teamTabDraft != null
      ? `<div class="inline-form"><input id="team-newtab" class="input" placeholder="예: 배포 대시보드" value="${esc(ui.teamTabDraft)}" data-input="team-tab" data-enter="team-tab-save"><button class="btn sm primary" data-act="team-tab-save">추가</button><button class="btn sm" data-act="team-tab-cancel">취소</button></div>`
      : `<button class="btn ghost sm" data-act="team-tab-open" style="margin-top:6px">+ 고정 탭 추가</button>`;
    const secretEditor = ui.secretDraft
      ? `<div class="inline-form"><input id="sec-name" class="input mono" placeholder="이름 (예: STRIPE_KEY)" data-input="sec-name" value="${esc(ui.secretDraft.name)}"><input id="sec-val" class="input" type="password" placeholder="값" data-input="sec-val" autocomplete="off"><button class="btn sm primary" data-act="sec-save">저장</button></div>`
      : `<button class="btn ghost" data-act="sec-open">+ 비밀값 추가</button>`;
    return `<div class="page-head"><div class="grow">
        <h1>${esc(T.name)} · 팀 설정 <span class="chip blue sm">나는 팀장</span></h1>
        <div class="sub" style="margin-top:6px">여기서 바꾼 내용은 팀원 워크스페이스에 바로 반영돼요. 설정 파일을 쓸 필요 없이 평소처럼 세팅하면 돼요.</div></div>
      <div class="actions"><button class="btn primary lg" data-act="invite-open">+ 팀원 초대</button></div></div>
      <div class="team-grid">
        <div class="card">
          <div class="row between" style="margin-bottom:12px"><h3 style="margin:0">공유 층 · 모두에게 자동 반영</h3><span class="small muted">개인 로그인 · 개인 탭 · 창 배치는 공유되지 않아요</span></div>
          <div class="cell-grid">
            <div class="cell"><div class="card-label">저장소</div><div class="v">${esc(T.repo)} · ${esc(T.base)}</div></div>
            <div class="cell"><div class="card-label">실행 스크립트</div><div class="v mono">${esc(T.scripts)}</div></div>
            <div class="cell"><div class="card-label">고정 탭 ${T.sharedTabs.length}개</div><div class="v">${esc(T.sharedTabs.join(' · '))}</div>${tabEditor}</div>
            <div class="cell"><div class="card-label">공용 자료</div><div class="v">${esc(T.materials)}</div></div>
            <div class="cell wide"><div class="card-label">팀 AI 규칙</div><div class="v">${esc(T.aiRules)}</div></div>
          </div>
          <div class="small" style="margin-top:12px">공유 구성 <b>v${T.version}</b> · 반영 상태: ${syncLine}</div>
        </div>
        <div class="card"><h3>팀원 · 역할</h3>${members}</div>
      </div>
      <div class="team-grid-3">
        <div class="card"><h3>비밀값 금고</h3>
          <div class="small sub" style="margin-bottom:12px">값은 팀원에게 보이지 않고, 서버 실행 때 환경변수로만 넣어줘요. 팀에서 나가면 접근이 끊겨요.</div>
          ${T.secrets.map(s => `<div class="secret-row">${esc(s.name)}<span class="mask">••••••••</span></div>`).join('')}
          ${secretEditor}
          <div class="xs muted" style="margin-top:8px">P1 · 보안 설계 선행 — 로컬에 전달된 값의 완전 회수는 보장할 수 없어요 (PRD FR-10)</div>
        </div>
        <div class="card"><h3>필요한 서비스 · 초대 현황</h3>
          <div class="small sub" style="margin-bottom:6px">계정은 공유하지 않아요. 각자 로그인하도록 체크리스트로 안내해요.</div>
          ${T.services.map(s => `<div class="list-row"><span class="grow">${esc(s.name)}</span><span class="small ${s.done === s.total ? 'ok-text' : 'warn-text'}">${s.done}/${s.total}${s.done === s.total ? ' 완료' : ' · ' + esc(s.wait || '')}</span></div>`).join('')}
        </div>
        <div class="card"><h3>최근 변경 · 반영 상태</h3>
          ${T.changes.slice(0, 4).map(c => `<div class="change-item ${c.fresh ? 'fresh' : ''}"><div class="t">${esc(c.title)}</div><div class="small ${c.fresh ? 'ok-text' : 'sub'}">${esc(c.sub)}</div></div>`).join('')}
        </div>
      </div>`;
  }

  // ───────────────────────── ⑤ 온보딩 ─────────────────────────
  const ONB_LOG = [
    ['✓ 워크스페이스 생성 · 세션 persist:ws-capstone', null],
    ['> git clone https://github.com/team/capstone.git', 'Receiving objects: 100% (1532/1532), done.'],
    ['> npm install', 'added 812 packages in 21s\n> docker compose pull\n✔ db Pulled  ✔ redis Pulled'],
    ['✓ OPENAI_API_KEY → 실행 시 환경변수 (값 ••••)', '✓ DATABASE_URL → 실행 시 환경변수 (값 ••••)'],
  ];

  function viewOnboard() {
    const o = ui.onb;
    const T = st.team;
    const loginsDone = o.logins.notion && o.logins.figma;
    const doneCount = o.done + (loginsDone ? 1 : 0) + (o.phase === 'done' ? 1 : 0);
    const ic = (state) => `<span class="ic ${state}">${state === 'done' ? '✓' : state === 'warn' ? '!' : ''}</span>`;
    const stepState = i => o.done > i ? 'done' : (o.phase === 'running' && o.done === i ? 'spin' : 'todo');
    const steps = [
      `워크스페이스 만들기 · 고정 탭 ${T.sharedTabs.length}개`,
      '저장소 받기 · ~/projects/capstone',
      '의존성 설치 · npm install, docker 이미지',
      '비밀값 연결 · 2개 <span class="small muted">(값은 보이지 않아요)</span>',
    ].map((t, i) => `<div class="step">${ic(stepState(i))}<div class="t">${t}</div></div>`).join('');
    const loginState = loginsDone ? 'done' : o.done >= 4 ? 'warn' : 'todo';
    const loginStep = `<div class="step">${ic(loginState)}<div class="grow"><div class="t">로그인이 필요한 서비스${loginsDone ? ' · 완료' : ''}</div>
      ${o.done >= 4 && !loginsDone ? `<div class="row" style="margin-top:8px">
        ${o.logins.notion ? '<span class="chip green">노션 ✓</span>' : '<button class="btn" data-act="onb-login" data-k="notion">노션 로그인</button>'}
        ${o.logins.figma ? '<span class="chip green">피그마 ✓</span>' : '<button class="btn" data-act="onb-login" data-k="figma">피그마 초대 수락</button>'}
      </div>` : ''}
      ${o.later && !loginsDone ? '<div class="small warn-text" style="margin-top:4px">나중에 하기로 했어요 — 사이드바에서 다시 안내해요</div>' : ''}</div></div>`;
    const serverState = o.phase === 'done' ? 'done' : o.phase === 'starting' ? 'spin' : 'todo';
    const serverStep = `<div class="step">${ic(serverState)}<div class="t">서버 시작 · capstone.localhost</div></div>`;

    let top = '';
    if (o.phase === 'confirm') {
      top = `<div class="confirm-box"><b>실행 전 확인</b> — 팀장이 설정한 명령을 이 PC에서 실행해요. 결과와 실패 원인은 로그로 보여줘요.
        <pre>git clone https://github.com/team/capstone.git C:\\Users\\hyunwoo\\projects\\capstone
npm install
docker compose pull</pre>
        <div class="row"><button class="btn primary" data-act="onb-start">확인하고 시작</button><button class="btn" data-act="onb-skip">명령은 직접 실행할게요</button></div></div>`;
    }
    const log = o.log.length ? `<div class="logbox">${o.log.map(l => esc(l)).join('\n')}</div>` : '';
    const doneBox = o.phase === 'done' ? `<div class="confirm-box" style="background:var(--green-50);border-color:#cfe5d5;margin-top:16px">
        <b class="ok-text">✓ 준비 완료</b> — capstone.localhost 실행 중. 초대 수락부터 3분 12초 (시뮬레이션)${loginsDone ? '' : ' · 로그인 2개는 나중에'}
        <div class="row" style="margin-top:10px"><button class="btn" data-act="onb-reset">처음부터 다시</button><button class="btn primary" data-act="nav" data-view="demo">팀 AI 시연 보기 →</button></div></div>` : '';

    return `<div class="preview-banner"><b>미리보기</b> — 초대를 수락한 팀원 <b>현우</b>의 노트북 C 화면이에요. 4 팀 설정에서 공유 탭을 바꾸면 여기에도 반영돼요.</div>
    <div class="onb-grid">
      <div class="card onb-card">
        <div class="eyebrow">팀 워크스페이스 초대</div>
        <h1>${esc(T.name)}에 들어왔어요</h1>
        <div class="sub">팀장 민수 님이 만든 환경을 내 PC에 그대로 준비하고 있어요.</div>
        <div class="row between small" style="margin-top:18px"><span>${o.phase === 'done' ? '준비 완료' : '준비 중'}</span><span>6단계 중 ${doneCount}단계 완료</span></div>
        <div class="bar"><i style="width:${Math.round(doneCount / 6 * 100)}%"></i></div>
        ${top}
        ${steps}${loginStep}${serverStep}
        ${log}
        ${doneBox}
        ${o.phase !== 'done' ? `<div class="row" style="justify-content:flex-end;margin-top:18px">
          <button class="btn lg" data-act="onb-later" ${o.done >= 4 && o.phase === 'logins' ? '' : 'disabled'}>로그인은 나중에</button>
          <button class="btn lg primary" data-act="onb-open" ${o.done >= 4 && o.phase === 'logins' ? '' : 'disabled'}>워크스페이스 열기</button></div>` : ''}
      </div>
      <div class="card">
        <h3>팀장 환경에서 받아오는 것</h3>
        <div class="card-label">고정 탭</div><div class="bold" style="margin-bottom:12px">${esc(T.sharedTabs.join(' · '))}</div>
        <div class="card-label">공용 자료</div><div class="bold" style="margin-bottom:12px">기획서 · 발표 자료 · 회의록</div>
        <div class="card-label">팀 AI 규칙</div><div class="bold" style="margin-bottom:14px">코딩 컨벤션 · 프로젝트 설명</div>
        <div style="border-top:1px solid var(--line);padding-top:14px">
          <div class="card-label">내 것으로 남는 것</div><div class="bold">내 로그인 · 개인 탭 · 창 배치 · 메모</div>
          <div class="small sub" style="margin-top:10px">팀장이 나중에 바꾸는 설정도 자동으로 따라와요. 내가 바꾼 개인 설정은 덮어쓰지 않아요.</div>
        </div>
      </div>
    </div>`;
  }

  function onbRun() {
    const o = ui.onb;
    o.phase = 'running';
    const tick = () => {
      if (o.done >= 4) { o.phase = 'logins'; return; }
      const [a, b] = ONB_LOG[o.done];
      o.log.push(a);
      if (b) o.log.push(...b.split('\n'));
      o.done += 1;
      later(o.done >= 4 ? 300 : 750, tick);
    };
    later(450, tick);
  }

  function onbFinish() {
    const o = ui.onb;
    o.phase = 'starting';
    o.log.push('> docker compose up -d && npm run dev');
    later(1000, () => {
      o.phase = 'done';
      o.log.push('▶ http://capstone.localhost (포트 3002 자동 배정)');
    });
  }

  // ───────────────────────── ⑥ 팀 AI 현황 (민수) ─────────────────────────
  function viewAI() {
    const ws = byId('capstone');
    const runs = st.agents.filter(a => a.user === 'minsu' && a.ws === 'capstone' && a.status !== 'hidden');
    const cards = runs.map(r => runCard(r)).join('');
    const d = ui.agentDraft;
    return `<div class="ai-layout">
      <div class="ai-main">
        <div class="row wrap"><h1 style="font-size:24px">${esc(ws.name)}</h1><span class="chip">${esc(ws.account)}</span>${serverChip(ws).replace('서버 실행 중 · ', '')}</div>
        <div class="sub small" style="margin:4px 0 18px">코드는 VS Code · Claude Code 같은 원래 쓰던 도구에서 작업해요</div>
        <div class="section-title">이 워크스페이스에서 실행 중</div>
        <div class="run-grid">
          ${cards}
          <div class="card run-card"><div class="k">외부 앱</div><div class="title">VS Code · ~/projects/capstone</div>
            <button class="btn sm" style="margin-top:10px" data-act="ext-app">창 앞으로</button></div>
          <div class="card run-card"><div class="k">서버</div><div class="title" style="font-size:15px">capstone.localhost · api.capstone.localhost</div>
            <div class="small ${ws.server === 'running' ? 'ok-text' : 'warn-text'}" style="margin-top:6px"><span class="dot ${ws.server === 'running' ? 'green' : 'amber'}"></span> ${ws.server === 'running' ? '2개 실행 중 · 포트 자동 배정' : '다시 시작 중…'}</div></div>
        </div>
        <div class="card launch">
          <h3>새 에이전트 실행</h3>
          <div class="launch-grid">
            <div class="field"><label for="agent-title">작업 제목 — 팀에 공유돼서 중복 작업을 막아요</label><input id="agent-title" class="input" data-input="agent-title" data-enter="agent-launch" value="${esc(d.title)}" placeholder="예: 비밀번호 재설정 메일 발송"></div>
            <div class="field"><label for="agent-tool">도구</label><select id="agent-tool" class="select" data-change="agent-tool">
              ${['Claude Code', 'Codex'].map(t => `<option ${d.tool === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          </div>
          <div id="agent-sim-hint">${simHint(d.title)}</div>
          <div class="launch-foot">
            <span class="small sub grow">새 브랜치 <input id="agent-branch" class="input mono" style="display:inline-block;width:250px;height:30px;font-size:12.5px;padding:0 8px" data-input="agent-branch" value="${esc(d.branch)}" aria-label="브랜치 이름"> · 이 워크스페이스 폴더·비밀값으로 실행돼요</span>
            <button class="btn primary lg" data-act="agent-launch">실행</button>
          </div>
          <div class="xs muted" style="margin-top:8px">${d.tool === 'Claude Code' ? '관찰 수준: Hooks + 파일·Git 감시' : '관찰 수준: 프로세스 + 파일·Git 감시 (Hooks 미지원 — 작업 상태가 덜 자세해요)'}</div>
        </div>
        <div class="card" style="margin-top:18px">
          <h3>내 브랜치에서 바뀐 것 · 자동 분류</h3>
          ${changesList('minsu', false)}
        </div>
      </div>
      <aside class="ai-side">
        <h2>팀 AI 작업 현황</h2>
        ${alertsHTML('minsu', false)}
        <div class="section-title" style="margin-top:20px;font-size:15px">팀원별 작업</div>
        ${matesHTML('minsu')}
        <div class="discord"><div class="grow"><div class="xs muted">대화·음성은 디스코드에서</div><div class="bold">${esc(st.team.discord)} · 새 메시지 ${st.team.discordUnread}</div></div><button class="btn sm" data-act="discord">열기</button></div>
        <div class="privacy-note">공유되는 건 작업 제목 · 브랜치 · 바뀐 파일 경로뿐이에요. 코드 내용과 AI에게 쓴 프롬프트 원문은 공유되지 않아요.
          <button class="btn ghost sm" data-act="privacy-open">공유 범위 확인</button></div>
      </aside>
    </div>`;
  }

  function simHint(title) {
    const others = S.knownRuns(st, 'minsu').filter(a => a.user !== 'minsu' && S.isActive(a) && st.shareTitle[a.user]);
    let best = null;
    for (const o of others) {
      const s = S.titleSimilarity(title, o.title);
      if (!best || s > best.s) best = { s, o };
    }
    if (!best || best.s < S.SIMILAR_THRESHOLD || !st.shareTitle.minsu) return '';
    return `<div class="sim-hint">⚠ ${U[best.o.user].name} 님의 "${esc(best.o.title)}"과(와) 비슷해 보여요 (제목 유사도 ${Math.round(best.s * 100)}%). 실행은 막지 않아요 — 먼저 확인해 보세요.</div>`;
  }

  const STATUS_TXT = { running: '작업 중', waiting: '내 확인 필요', done: '완료', stopped: '중지됨' };

  function runCard(r) {
    const nFiles = new Set(st.events.filter(e => e.runId === r.id && e.payload && e.payload.type === 'file_change').map(e => e.payload.relativePath)).size;
    const notes = (st.agentNotes[r.id] || []).length;
    return `<div class="card run-card">
      <div class="row"><span class="k">AI 에이전트 · ${esc(r.tool)}</span><span class="st ${r.status}">${STATUS_TXT[r.status]}</span></div>
      <div class="title">${esc(r.title)}</div>
      <div class="small sub">${esc(r.branch)} · 수정한 파일 ${nFiles}개</div>
      <div class="lastbox">${ago(r.lastAt)}: ${esc(r.last)}</div>
      ${notes ? `<span class="note-chip">✉ 팀 알림 ${notes}건 전달됨</span>` : ''}
      <div class="row" style="margin-top:10px">
        ${r.status === 'waiting' ? `<button class="btn sm" data-act="run-term" data-id="${r.id}">터미널 열기</button>` : ''}
        ${S.isActive(r) ? `<button class="btn sm" data-act="run-stop" data-id="${r.id}">중지</button>` : ''}
        <span class="observe grow" style="margin:0;text-align:right">${r.observe === 'hooks' ? '관찰: Hooks + 파일 감시' : '관찰: 프로세스 + 파일 감시'}</span>
      </div>
    </div>`;
  }

  function changesList(viewer, compact) {
    const list = S.myChanges(st, viewer);
    if (!list.length) return `<div class="empty">아직 바뀐 파일이 없어요</div>`;
    return list.slice(0, compact ? 4 : 10).map(e => {
      const p = e.payload;
      const c = CAT[p.category];
      const caused = S.alertsCausedBy(st, viewer, e.id);
      return `<div class="change-row"><div class="grow"><div class="path ellipsis">${esc(p.relativePath)}</div>
          ${compact ? '' : `<div class="xs muted">${esc(p.branch)} · ${esc(e.source)} · ${ago(e.at)}</div>`}
          ${caused.map(x => `<div class="caused">→ ${U[x.user].name} 님 화면에 '${esc(x.alert.title)}' 경고가 떴어요</div>`).join('')}</div>
        <span class="tag ${c.shared ? 'shared' : ''}">${esc(c.label)}${c.shared ? ' · 공유 자원' : ''}</span></div>`;
    }).join('');
  }

  // ───────────────────────── 경고 · 팀원 (06과 기기 프레임 공용) ─────────────────────────
  function alertsHTML(viewer, compact) {
    const list = S.computeAlerts(st, viewer);
    const hidden = S.computeAlerts(st, viewer, { includeHidden: true }).filter(a => a.status === 'dismissed').length;
    const seen = ui.seen[viewer];
    let html = '';
    if (!list.length) {
      html = `<div class="empty">아직 경고가 없어요${viewer === 'minsu' && !compact && ui.step === 0 ? '<br>★ P0 시연에서 시나리오를 진행해 보세요' : ''}</div>`;
    }
    for (const a of list) {
      const id = viewer + '|' + a.key;
      const isNew = !seen.has(a.key) && !ui.firstRender;
      const open = !!ui.expanded[id];
      const who = U[a.from] ? U[a.from].name : '';
      const btn = [];
      if (a.actions.includes('notify')) {
        if (a.status === 'notified') btn.push('');
        else btn.push(`<button class="btn sm dark" data-act="notify-open" data-viewer="${viewer}" data-key="${esc(a.key)}">내 에이전트에게 알려주기</button>`);
      }
      if (a.actions.includes('restart') && a.status !== 'handled') btn.push(`<button class="btn sm" data-act="restart" data-viewer="${viewer}" data-key="${esc(a.key)}">내 서버 다시 시작</button>`);
      if (a.actions.includes('evidence')) btn.push(`<button class="btn sm" data-act="evidence" data-id="${esc(id)}">${open ? '근거 닫기' : '근거 보기'}</button>`);
      if (a.actions.includes('peek')) btn.push(`<button class="btn sm" data-act="evidence" data-id="${esc(id)}">${open ? '닫기' : who + ' 작업 보기'}</button>`);
      if (a.actions.includes('dismiss')) btn.push(`<button class="btn sm" data-act="dismiss" data-viewer="${viewer}" data-key="${esc(a.key)}">${a.type === 'sim' ? '괜찮아요' : '무시'}</button>`);
      html += `<div class="alert ${a.severity} ${isNew ? 'is-new' : ''}">
        <div class="a-title">${a.severity === 'high' ? '⚠' : a.severity === 'medium' ? '◆' : 'ℹ'} ${esc(a.title)}<span class="sev">${{ high: '높음', medium: '중간', info: '안내' }[a.severity]}</span></div>
        <div class="a-body">${a.body}</div>
        <div class="a-actions">${btn.join('')}</div>
        ${a.status === 'notified' ? '<div class="done-line">✓ 내 에이전트에게 전달됨 — 요약만 맥락으로 넣었어요</div>' : ''}
        ${a.status === 'handled' ? '<div class="done-line">✓ 내 서버를 다시 시작했어요</div>' : ''}
        ${open ? evidenceHTML(a, viewer) : ''}
      </div>`;
    }
    if (hidden) html += `<div class="xs muted" style="margin:-4px 0 8px">무시한 경고 ${hidden}개 · <button class="btn ghost sm" data-act="undismiss" data-viewer="${viewer}">다시 보기</button></div>`;
    return html;
  }

  function evidenceHTML(a, viewer) {
    const rows = a.evidence.map(id => S.eventById(st, id)).filter(Boolean).map(e => {
      const p = e.payload;
      const what = p.type === 'file_change' ? `<span class="mono">${esc(p.relativePath)}</span> · ${esc(p.branch)}` : `에이전트 시작 · "${esc(p.taskTitle || '비공개 작업')}" · ${esc(p.branch)}`;
      return `<div class="ev-row"><span class="mono muted">${hms(e.at)}</span><span>${U[e.user].name} · ${esc(e.source)}<br>${what}
        ${ui.view === 'demo' ? ` <button class="btn ghost sm" data-act="select-event" data-id="${e.id}">로그에서 보기</button>` : ''}</span></div>`;
    }).join('');
    const fb = st.alertFeedback[viewer + '|' + a.key];
    return `<div class="evidence">
      <div class="rule"><b>판단 근거</b> · ${esc(a.rule)}</div>
      ${rows}
      <div class="fp">파일 경로·규칙 기반 '가능성' 경고예요. 코드 의미는 분석하지 않고, 작업을 막지 않아요.</div>
      <div class="row" style="margin-top:8px">${fb ? `<span class="xs ok-text">피드백: ${fb === 'useful' ? '유용했어요' : '오탐이에요'} — 고마워요</span>` :
        `<button class="btn sm" data-act="feedback" data-viewer="${viewer}" data-key="${esc(a.key)}" data-v="useful">유용했어요</button><button class="btn sm" data-act="feedback" data-viewer="${viewer}" data-key="${esc(a.key)}" data-v="fp">오탐이에요</button>`}</div>
    </div>`;
  }

  function matesHTML(viewer) {
    return S.teammates(st, viewer).map(m => {
      const name = m.me ? '나' : U[m.user].name;
      const dot = m.state === 'agent' ? 'green' : m.state === 'other' ? 'amber' : 'gray';
      const l1 = `${name} · ${m.runs.length ? `에이전트 ${m.runs.length}개` : '에이전트 없음'}`;
      let l2 = '';
      if (m.runs.length) l2 = `${m.titles.map(esc).join(' · ')} · ${m.branches.map(esc).join(', ')}`;
      else if (m.state === 'other') l2 = '다른 워크스페이스 사용 중';
      else l2 = '대기 중';
      const l3 = m.recentMain ? `최근: ${esc(m.recentMain)}` : (m.areas.length && !m.me ? esc(m.areas.join(' · ')) : '');
      return `<div class="mate"><span class="dot ${dot}"></span><div class="grow"><div class="n">${l1}</div><div class="l">${l2}</div>${l3 ? `<div class="l">${l3}</div>` : ''}</div></div>`;
    }).join('');
  }

  // ───────────────────────── ★ P0 시연 ─────────────────────────
  const runOf = (u, title) => st.agents.find(a => a.user === u && a.title === title);
  const STEPS = [
    {
      who: '민수 · 팀장', title: "공유 고정 탭 '배포 대시보드' 추가", fr: 'FR-08 공유 층 / 개인 층', devices: ['jiyun'],
      run() { S.addSharedTab(st, '배포 대시보드'); },
      say: '팀장이 공유 층에 탭을 추가했어요 → <b>노트북 B</b> 탭 줄에 바로 반영되고, 지윤의 개인 탭(점선)은 그대로예요.',
    },
    {
      who: '지윤', title: 'Claude Code 실행 · "로그인·회원 인증 API"', fr: 'FR-11 에이전트 · FR-13 Hooks', devices: ['jiyun', 'minsu'], select: 'prompt',
      run() {
        const r = S.launchAgent(st, 'jiyun', { tool: 'Claude Code', title: '로그인·회원 인증 API', branch: 'feature/login', prompt: '로그인/세션 API 만들어줘. DATABASE_URL=postgresql://capstone:Sup3rS3cret!@localhost:5432/capstone 로 붙으면 돼' });
        S.emitFile(st, { user: 'jiyun', runId: r.id, kind: 'hook', path: 'src/auth/login.ts' });
      },
      say: '지윤이 작업 제목과 함께 에이전트를 실행 → SessionStart · UserPromptSubmit · PostToolUse 훅이 들어와요. 아래 로그를 보면 <b>프롬프트 원문(비밀값 포함)은 팀 서버로 가지 않아요.</b>',
    },
    {
      who: '민수', title: 'Claude Code 실행 · "회원가입 API 구현"', fr: 'FR-14 팀 현황 · FR-15 유사 작업', devices: ['minsu', 'jiyun'],
      run() {
        const r = S.launchAgent(st, 'minsu', { tool: 'Claude Code', title: '회원가입 API 구현', branch: 'feature/signup' });
        S.emitFile(st, { user: 'minsu', runId: r.id, kind: 'hook', path: 'src/auth/signup.ts' });
      },
      say: '두 에이전트가 같은 <code>src/auth/</code> 폴더를 수정하고 제목도 비슷해서 → 양쪽에 <b>비슷한 작업</b> 경고가 떠요.',
    },
    {
      star: true, who: '민수의 에이전트', title: 'prisma/schema.prisma 수정', fr: 'P0 핵심 데모 · FR-15', devices: ['jiyun'],
      run() {
        const r = runOf('minsu', '회원가입 API 구현');
        S.emitFile(st, { user: 'minsu', runId: r && r.id, kind: 'hook', path: 'prisma/schema.prisma' });
      },
      say: '<b>노트북 B(지윤)</b>에 ‘DB 스키마 충돌 가능’ 경고 — 파일·브랜치·작업 주체와 조치 버튼이 함께 떠요. 민수 화면에는 “지윤에게 경고가 떴다”는 표시만 남아요.',
    },
    {
      who: '현우', title: 'docker-compose.yml을 main에 반영', fr: 'FR-12 Git 감시 · FR-15 환경 변경', devices: ['minsu', 'jiyun'],
      run() { S.emitFile(st, { user: 'hyunwoo', kind: 'git', path: 'docker-compose.yml' }); },
      say: '에이전트 없이도 Git 감시로 감지 → 양쪽에 <b>환경 변경</b> 안내와 ‘내 서버 다시 시작’ 버튼. diff 안의 API 키는 로컬 화면에서도 가려져요.',
    },
  ];

  function doStep(n) {
    while (ui.step < n && ui.step < STEPS.length) {
      const s = STEPS[ui.step];
      const before = st.events.length;
      s.run();
      ui.step += 1;
      const fresh = st.events.slice(before);
      const pick = s.select === 'prompt' ? fresh.find(e => e.source.includes('UserPromptSubmit')) : fresh[fresh.length - 1];
      if (pick) ui.selectedEvent = pick.id;
      ui.say = s.say + (st.online ? '' : ' <b>(지금은 팀 서버 연결이 끊겨 있어서 이벤트가 기기에 쌓여 있어요)</b>');
    }
  }

  /** 멈춤 → 재생을 빠르게 반복해도 예전 타이머가 두 번째 체인을 만들지 않도록 토큰으로 구분 */
  function autoPlay(token) {
    if (!ui.auto || token !== ui.autoToken) return;
    doStep(ui.step + 1);
    if (ui.step >= STEPS.length) { ui.auto = false; return; }
    later(2800, () => autoPlay(token));
  }
  function stopAuto() { ui.auto = false; ui.autoToken += 1; }

  function viewDemo() {
    const steps = STEPS.map((s, i) => {
      const cls = i < ui.step ? 'done' : i === ui.step ? 'next' : '';
      return `<button class="stepcard ${cls} ${s.star ? 'star' : ''}" data-act="step" data-n="${i + 1}">
        <span class="num">${i < ui.step ? '✓' : ''} ${s.star ? '★ ' : ''}${i + 1}단계</span>
        <span class="who">${esc(s.who)}</span><span class="tt">${esc(s.title)}</span><span class="fr">${esc(s.fr)}</span></button>`;
    }).join('');
    const next = STEPS[ui.step];
    const queued = st.events.filter(e => e.queued).length;
    return `<div class="stage">
      <div class="stage-head">
        <div><h1>P0 시연 — 두 기기에서 같은 팀 워크스페이스</h1>
          <div class="desc">A(민수)의 Claude Code가 <code>schema.prisma</code>를 수정하면 B(지윤)의 팀 AI 작업 현황에 충돌 가능성 경고가 떠요. (PRD §8.1 · §12)</div></div>
        <div class="controls">
          <button class="server-toggle ${st.online ? '' : 'off'}" data-act="online" title="팀 동기화 서버 연결을 끊어 오프라인 동작을 확인">
            <span class="dot ${st.online ? 'green pulse' : 'red'}"></span>팀 동기화 서버 · ${st.online ? '연결됨' : `끊김${queued ? ` (대기 ${queued})` : ''}`}</button>
          ${ui.auto ? '<button class="btn" data-act="auto-stop">■ 멈춤</button>' : `<button class="btn" data-act="auto" ${ui.step >= STEPS.length ? 'disabled' : ''}>▶ 자동 재생</button>`}
          <button class="btn" data-act="reset">↺ 초기화</button>
        </div>
      </div>
      <div class="steps">${steps}
        <div class="go"><button class="btn lg ${next && next.star ? 'star' : 'primary'}" data-act="step" data-n="${ui.step + 1}" ${next ? '' : 'disabled'}>${next ? '다음 단계 ▶' : '시나리오 끝'}</button></div>
      </div>
      <div class="narration"><span class="nar-tag">해설</span><span>${ui.say || '단계 카드나 ‘다음 단계’를 눌러 진행하세요. 각 단계는 실제 앱에서 Claude Code Hooks · 파일 감시 · Git 감시가 만들 이벤트를 흉내 내요. 경고 카드의 버튼은 직접 눌러볼 수 있어요.'}</span></div>
      <div class="devices">${deviceFrame('minsu')}${deviceFrame('jiyun')}</div>
      <div class="lower">
        <div class="card">
          <div class="row between"><h3 style="margin:0">팀 동기화 서버 이벤트 로그</h3><span class="xs muted">최신순 · 클릭하면 오른쪽에서 원본과 비교</span></div>
          ${!st.online ? `<div class="queue-note">연결이 끊겨 있어요 — 로컬 작업은 계속되고, 이벤트 ${queued}개는 재연결 후 다시 보내요 (PRD §7.2)</div>` : ''}
          <div class="evlog" id="evlog" style="margin-top:10px">${eventLog()}</div>
          <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
            <div class="bold small" style="margin-bottom:8px">직접 이벤트 보내기 <span class="muted xs">— 분류·제외·경고 규칙을 즉석에서 시험</span></div>
            ${injector()}
          </div>
        </div>
        <div class="card inspector">${inspector()}</div>
      </div>
    </div>`;
  }

  function deviceFrame(viewer) {
    const u = U[viewer];
    const t = S.tabsFor(st, viewer);
    const synced = t.version === st.team.version;
    const newKeys = S.computeAlerts(st, viewer).filter(a => !ui.seen[viewer].has(a.key));
    const flash = newKeys.length && !ui.firstRender;
    const runs = st.agents.filter(a => a.user === viewer && S.isActive(a));
    const tabs = t.shared.map(x => {
      const isNew = !ui.seenTabs.has(viewer + '|' + x) && !ui.firstRender;
      return `<span class="tab shared ${isNew ? 'new' : ''}">${PIN}${esc(x)}</span>`;
    }).join('') + '<span class="tab-sep"></span>' + t.private.map(x => `<span class="tab private">${esc(x)} <span class="xs muted">개인</span></span>`).join('');
    const myQueued = st.events.filter(e => e.user === viewer && e.queued).length;
    const runsHTML = runs.length ? runs.map(r => `<div class="mini-run"><div class="row"><span class="title grow ellipsis">${esc(r.title)}</span><span class="st ${r.status} xs">${STATUS_TXT[r.status]}</span></div>
        <div class="k">${esc(r.tool)} · ${esc(r.branch)}</div><div class="k muted">${ago(r.lastAt)}: ${esc(r.last)}</div>
        ${(st.agentNotes[r.id] || []).length ? `<span class="note-chip">✉ 팀 알림 ${(st.agentNotes[r.id] || []).length}건 전달됨</span>` : ''}</div>`).join('')
      : '<div class="empty" style="padding:10px">실행 중인 에이전트 없음</div>';
    return `<section class="device ${flash ? 'flash' : ''}" aria-label="${u.device} ${u.name}">
      <div class="device-bar"><span class="lights"><i></i><i></i><i></i></span>
        <span class="ttl">${u.device} · ${u.name} (${u.role})</span><span class="muted">Cadora · Windows 11</span>
        <span class="sync-chip chip sm ${synced ? 'green' : 'amber'}">공유 구성 v${t.version}${synced ? '' : ' · 동기화 대기'}</span>
        ${myQueued ? `<span class="chip sm red">전송 대기 ${myQueued}</span>` : ''}
      </div>
      <div class="device-head"><h3>캡스톤 팀플 <span class="chip sm">개인 Google 계정</span><span class="chip sm green"><span class="dot green"></span>capstone.localhost</span></h3></div>
      <div class="tabstrip">${tabs}</div>
      <div class="device-body">
        <div>
          <h4>내 에이전트</h4>${runsHTML}
          <h4 style="margin-top:12px">내 브랜치에서 바뀐 것</h4>${changesList(viewer, true)}
        </div>
        <div>
          <h4>팀 AI 작업 현황</h4>${alertsHTML(viewer, true)}
          <h4 style="margin-top:12px">팀원별 작업</h4>${matesHTML(viewer)}
        </div>
      </div>
    </section>`;
  }

  function eventStatus(e) {
    if (e.excluded) return '<span class="chip sm red">전송 안 함</span>';
    if (e.queued) return '<span class="chip sm amber">대기</span>';
    if (e.seed) return '<span class="chip sm">이전 기록</span>';
    return '<span class="chip sm green">전송됨</span>';
  }

  function eventLog() {
    return st.events.slice().reverse().map(e => {
      const p = e.payload;
      let what;
      if (!p) what = `${esc(e.relPath || e.summary)} <span class="muted">— ${esc(e.excludedReason)}</span>`;
      else if (p.type === 'file_change') what = `${esc(p.relativePath)} <span class="tag" style="height:19px;font-size:11px">${esc(CAT[p.category].label)}</span>`;
      else if (p.type === 'agent_run') what = `에이전트 시작 · "${esc(p.taskTitle || '비공개 작업')}"`;
      else what = esc(e.summary);
      return `<button class="evrow ${ui.selectedEvent === e.id ? 'on' : ''}" data-act="select-event" data-id="${e.id}">
        <span class="time">${hms(e.at)}</span><span class="bold small">${U[e.user].name}</span>
        <span class="ellipsis"><span class="what">${what}</span><br><span class="src">${esc(e.source)}</span></span>${eventStatus(e)}</button>`;
    }).join('');
  }

  const RAW_STRIPPED = new Set(['old_string', 'new_string', 'content', 'tool_response', 'prompt', 'diff', 'author', 'message', 'transcript_path', 'cwd', 'session_id', 'file_path', 'path', 'stats', 'pid', 'argv']);

  function jsonHTML(v, ind, mark) {
    ind = ind || 0;
    const pad = '  '.repeat(ind);
    if (v === null || v === undefined) return '<span class="muted">null</span>';
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return '[\n' + v.map(x => pad + '  ' + jsonHTML(x, ind + 1, mark)).join(',\n') + '\n' + pad + ']';
    }
    if (typeof v === 'object') {
      const ks = Object.keys(v);
      if (!ks.length) return '{}';
      return '{\n' + ks.map(k => `${pad}  <span class="k ${mark && RAW_STRIPPED.has(k) ? 'rm' : ''}">"${esc(k)}"</span>: ${jsonHTML(v[k], ind + 1, mark)}`).join(',\n') + '\n' + pad + '}';
    }
    if (typeof v === 'string') {
      let s = S.maskSecrets(v);
      if (s.length > 140) s = s.slice(0, 137) + '…';
      return `<span class="s">${esc(JSON.stringify(s))}</span>`;
    }
    return esc(String(v));
  }

  function inspector() {
    const e = S.eventById(st, ui.selectedEvent) || st.events[st.events.length - 1];
    if (!e) return '<div class="empty">이벤트가 없어요</div>';
    const checks = e.payload ? S.privacyCheck(e.payload) : [];
    const right = e.payload
      ? `<pre class="json server">${jsonHTML(e.payload, 0, false)}</pre>
         <div class="checks">${checks.map(c => `<span class="chip sm ${c.ok ? 'green' : 'red'}">${c.ok ? '✓' : '✕'} ${esc(c.label)} 없음</span>`).join('')}</div>`
      : `<div class="empty" style="text-align:left;color:var(--red);border-color:#f2c4bb;background:var(--red-50)"><b>팀 서버로 보내지 않았어요</b><br>${esc(e.excludedReason)}<br><span class="xs">이 기기 로컬 기록에만 남아요 (FR-12 · FR-19)</span></div>`;
    return `<div class="row between" style="margin-bottom:10px"><h3 style="margin:0">페이로드 검사</h3>
        <span class="xs muted mono">${e.id} · ${U[e.user].name} (${esc(e.device)}) · ${esc(e.source)}</span></div>
      <div class="panes">
        <div><div class="small bold" style="margin-bottom:6px">① 이 PC에서 받은 원본 <span class="muted xs">— 기기 밖으로 나가지 않아요</span></div>
          <pre class="json">${jsonHTML(e.raw, 0, true)}</pre>
          <div class="xs muted" style="margin-top:6px"><span class="json" style="padding:0 4px;display:inline"><span class="k rm">빨간 키</span></span> = 정제하면서 빼거나 바꾼 항목 · 비밀값은 로컬 화면에서도 가려요</div></div>
        <div><div class="small bold" style="margin-bottom:6px">② 팀 서버로 보낸 최소 메타데이터</div>${right}</div>
      </div>
      <ul class="removed"><b>정제하면서 뺀 것</b>${e.removed.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`;
  }

  const INJECT_FILES = [
    'prisma/schema.prisma', 'prisma/migrations/20261117_add_phone/migration.sql', 'package.json', 'docker-compose.yml',
    'src/auth/session.ts', 'src/pages/login.tsx', 'src/auth/login.test.ts', '.env', '.env.example', 'node_modules/.cache/babel.json',
  ];
  const DEFAULT_BRANCH = { minsu: 'feature/signup', jiyun: 'feature/login', hyunwoo: 'chore/redis' };

  function injector() {
    const i = ui.inject;
    return `<div class="injector">
      <select class="select" data-change="inject" data-k="user" aria-label="누가">${['minsu', 'jiyun', 'hyunwoo'].map(u => `<option value="${u}" ${i.user === u ? 'selected' : ''}>${U[u].name} (${U[u].device})</option>`).join('')}</select>
      <select class="select mono" data-change="inject" data-k="path" aria-label="파일">${INJECT_FILES.map(p => `<option ${i.path === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <select class="select" data-change="inject" data-k="how" aria-label="감지 경로"><option value="hook" ${i.how === 'hook' ? 'selected' : ''}>Claude Code Hook</option><option value="watch" ${i.how === 'watch' ? 'selected' : ''}>파일 감시</option><option value="git" ${i.how === 'git' ? 'selected' : ''}>Git · main 반영</option></select>
      <button class="btn primary" data-act="inject">보내기</button>
    </div>`;
  }

  function doInject() {
    const i = ui.inject;
    const run = st.agents.find(a => a.user === i.user && S.isActive(a) && (i.how !== 'hook' || a.tool === 'Claude Code'))
      || st.agents.find(a => a.user === i.user && S.isActive(a));
    const ev = S.emitFile(st, {
      user: i.user, runId: i.how === 'git' ? null : run && run.id, kind: i.how, path: i.path,
      branch: i.how === 'git' ? 'main' : (run ? run.branch : DEFAULT_BRANCH[i.user]),
      changeType: /migrations\//.test(i.path) ? 'added' : 'modified',
    });
    ui.selectedEvent = ev.id;
    if (ev.excluded) toast(`'${esc(i.path)}' — ${esc(ev.excludedReason)}`, { icon: '⛔' });
    else if (i.how === 'hook' && ev.source.indexOf('Hook') === -1) toast(`${U[i.user].name} 님은 Claude Code 에이전트가 없어서 파일 감시로 대신 감지했어요 (FR-13 한계)`, { icon: 'ℹ' });
    ui.say = `직접 보낸 이벤트: <b>${esc(i.path)}</b> (${esc(U[i.user].name)}) → 분류 <b>${ev.category ? esc(CAT[ev.category].label) : '제외'}</b>. 경고가 생겼는지 두 기기를 확인해 보세요.`;
  }

  // ───────────────────────── 모달 ─────────────────────────
  function notifyText(a) {
    const who = U[a.from].name;
    if (a.type === 'db') return `[Cadora 팀 알림] ${who} 님의 에이전트가 ${a.branch} 브랜치에서 ${a.file}을(를) 수정했습니다 (아직 ${st.team.base} 미반영). DB 스키마에 의존하는 코드를 작성하기 전에 변경된 스키마를 확인하고, 머지 후 마이그레이션을 다시 실행하세요.`;
    return `[Cadora 팀 알림] ${who} 님 브랜치 ${a.branch}에서 ${a.file}이(가) 바뀌었습니다. 새 의존성을 추가하기 전에 충돌 여부를 확인하세요.`;
  }

  function modalHTML() {
    const m = ui.modal;
    if (!m) return '';
    let body = '';
    if (m.type === 'notify') {
      const a = S.computeAlerts(st, m.viewer).find(x => x.key === m.key);
      const runs = st.agents.filter(r => r.user === m.viewer && S.isActive(r));
      if (!a) { ui.modal = null; return ''; }
      body = `<h2>내 에이전트에게 알려주기</h2>
        <div class="sub small">사용자가 확인한 아래 요약만 에이전트에 맥락으로 넣어요. 다른 명령이나 프롬프트는 실행하지 않아요. (FR-16 · P1)</div>
        <div class="field" style="margin-top:14px"><label for="notify-run">전달할 에이전트</label>
          <select id="notify-run" class="select">${runs.map(r => `<option value="${r.id}">${esc(r.title)} · ${esc(r.tool)}</option>`).join('')}</select></div>
        <div class="quote">${esc(notifyText(a))}</div>
        <div class="foot"><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="notify-send" ${runs.length ? '' : 'disabled'}>전달하기</button></div>`;
    } else if (m.type === 'invite') {
      body = m.sent
        ? `<h2>초대를 보냈어요</h2><div class="sub">${esc(m.email)} · ${esc(m.role)} · 7일 후 만료 · 언제든 회수할 수 있어요.</div>
           <div class="quote">초대를 수락하면 저장소 · 고정 탭 ${st.team.sharedTabs.length}개 · 실행 스크립트 · 공용 자료 · 팀 AI 규칙을 받아요. 비밀값은 값 없이 참조만 연결돼요.</div>
           <div class="foot"><button class="btn" data-act="modal-close">닫기</button><button class="btn primary" data-act="invite-preview">초대받은 사람 화면 미리보기 →</button></div>`
        : `<h2>팀원 초대</h2><div class="sub small">초대받은 사람은 수락만 하면 같은 공통 환경으로 시작해요. (FR-07)</div>
           <div class="field" style="margin-top:14px"><label for="inv-email">이메일</label><input id="inv-email" class="input" placeholder="teammate@univ.ac.kr" data-enter="invite-send"></div>
           <div class="field" style="margin-top:12px"><label for="inv-role">역할</label><select id="inv-role" class="select"><option>팀원</option><option>열람자</option></select></div>
           <div class="foot"><button class="btn" data-act="modal-close">취소</button><button class="btn primary" data-act="invite-send">초대 보내기</button></div>`;
    } else if (m.type === 'privacy') {
      const mine = st.events.filter(e => e.user === 'minsu' && e.payload && !e.seed).pop() || st.events.filter(e => e.user === 'minsu' && e.payload).pop();
      body = `<h2>팀에 공유되는 범위</h2>
        <div class="sub small">팀 동기화 데이터는 최소 메타데이터로 한정해요. (FR-18)</div>
        <label class="check" style="margin:14px 0 4px"><input type="checkbox" data-change="share-title" ${st.shareTitle.minsu ? 'checked' : ''}> 내 에이전트 작업 제목 공유 <span class="xs muted">— 끄면 팀원에게 '비공개 작업'으로 보이고 제목 유사도 경고도 꺼져요</span></label>
        <div class="cell-grid" style="margin-top:12px">
          <div class="cell"><div class="card-label">공유함</div><div class="small">작업 제목 · 에이전트 상태 · 브랜치 · 상대 파일 경로 · 변경 분류 · 경고</div></div>
          <div class="cell"><div class="card-label">공유하지 않음</div><div class="small">코드 본문 · 프롬프트 원문 · 로그인 쿠키·토큰 · 개인 워크스페이스 이름 · OS 절대경로</div></div>
        </div>
        ${mine ? `<div class="small bold" style="margin:14px 0 6px">내가 마지막으로 보낸 페이로드 미리보기</div><pre class="json server">${jsonHTML(mine.payload, 0, false)}</pre>` : ''}
        <div class="foot"><button class="btn primary" data-act="modal-close">확인</button></div>`;
    }
    return `<div class="modal-back" data-act="modal-back"><div class="modal" role="dialog" aria-modal="true">${body}</div></div>`;
  }

  // ───────────────────────── 렌더 ─────────────────────────
  const app = document.getElementById('app');

  function protobar() {
    return `<header class="protobar">
      <div class="brand"><span class="logo">C</span>Cadora <span class="proto-badge">프로토타입</span></div>
      <nav class="protonav">${VIEWS.map(v => `<button class="${ui.view === v.id ? 'on' : ''} ${v.star ? 'star' : ''}" data-act="nav" data-view="${v.id}"><span class="nnum">${v.n}</span>${v.label}</button>`).join('')}</nav>
      <span class="sim-note">시뮬레이션 데이터 · 실제 프로세스·네트워크 없음</span>
    </header>`;
  }

  function render() {
    const active = document.activeElement;
    const focusId = active && active.id;
    const selStart = active && 'selectionStart' in active ? active.selectionStart : null;
    const logEl = document.getElementById('evlog');
    const logScroll = logEl ? logEl.scrollTop : 0;

    let body;
    if (ui.view === 'demo') body = viewDemo();
    else if (ui.view === 'ai') body = `<div class="appwin">${sidebar()}<div>${viewAI()}</div></div>`;
    else {
      const v = { home: viewHome, split: viewSplit, create: viewCreate, team: viewTeam, onboard: viewOnboard }[ui.view] || viewHome;
      body = `<div class="appwin">${sidebar()}<main class="main">${v()}</main></div>`;
    }
    app.innerHTML = protobar() + body + modalHTML();

    // 본 것으로 표시 (새 경고·새 탭 애니메이션은 처음 나타날 때 한 번만)
    for (const u of ['minsu', 'jiyun']) {
      S.computeAlerts(st, u, { includeHidden: true }).forEach(a => ui.seen[u].add(a.key));
      S.tabsFor(st, u).shared.forEach(x => ui.seenTabs.add(u + '|' + x));
    }
    ui.firstRender = false;

    document.querySelectorAll('.term-body').forEach(el => { el.scrollTop = el.scrollHeight; });
    const newLog = document.getElementById('evlog');
    if (newLog) newLog.scrollTop = logScroll;
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { el.focus({ preventScroll: true }); if (selStart != null && 'setSelectionRange' in el) { try { el.setSelectionRange(selStart, selStart); } catch (_) { /* select 등 */ } } }
    }
  }

  function go(view) {
    ui.view = view;
    try { history.replaceState(null, '', '#' + view); } catch (_) { /* file:// 일부 환경 */ }
    window.scrollTo(0, 0);
  }

  // ───────────────────────── 액션 ─────────────────────────
  const A = {
    nav: d => go(d.view),
    'open-ws': d => {
      const ws = byId(d.id);
      if (ui.view === 'split') {
        const side = ui.split.focus;
        const other = side === 'left' ? 'right' : 'left';
        if (ui.split[other] === d.id) ui.split[other] = ui.split[side];
        ui.split[side] = d.id;
        return;
      }
      const prev = byId(L.active);
      if (prev && prev.id !== ws.id && prev.status === 'active') prev.status = 'background';
      const woke = ws.status === 'sleep';
      ws.status = 'active';
      L.active = ws.id;
      go('home');
      if (woke) toast(`'${esc(ws.name)}' 깨움 — 탭을 다시 불러와요`, { icon: '☀' });
    },
    tab: d => { byId(L.active).tab = +d.i; },
    'tab-add': () => toast('새 탭은 이 워크스페이스 전용 세션으로 열려요 (프로토타입에서는 생략)', { icon: 'ℹ' }),
    sleep: () => {
      const ws = byId(L.active);
      ws.status = 'sleep';
      toast(`'${esc(ws.name)}' 잠자기 — 탭 리소스를 멈췄어요. ${ws.server === 'running' ? '서버는 설정대로 유지해요.' : ''}`, { icon: '☾' });
    },
    wake: () => { const ws = byId(L.active); ws.status = 'active'; toast(`'${esc(ws.name)}' 깨움`, { icon: '☀' }); },
    'ask-ai': () => {
      const ws = byId(L.active);
      toast(`AI 질문 패널은 이후 단계예요 — 범위: ${aiScopeText(ws, wsTabs(ws).length)} (다른 워크스페이스 ${ws.ai.other ? '포함' : '제외'})`, { icon: '✦' });
    },
    logout: () => {
      const ws = byId(L.active);
      ws.loggedIn = false;
      const others = L.workspaces.filter(w => w.id !== ws.id && w.loggedIn).map(w => esc(w.name));
      toast(`'${esc(ws.name)}'에서만 로그아웃했어요 — ${others.join(', ')}의 로그인은 그대로예요`, { icon: '🔒' });
    },
    login: () => { const ws = byId(L.active); ws.loggedIn = true; toast(`${esc(ws.email)} 로 다시 로그인 (이 워크스페이스 세션에만 저장)`, { icon: '🔑' }); },
    'server-start': () => startServer(byId(L.active)),
    'server-stop': () => stopServer(byId(L.active)),
    download: d => doDownload(byId(d.ws), d.file),

    'create-type': d => { ui.create = draftFor(d.type, { name: ui.create.name, folder: ui.create.folder, session: ui.create.session }); },
    'create-session': d => { ui.create.session = d.v; },
    'create-tab-del': d => { ui.create.tabs.splice(+d.i, 1); },
    'create-tab-add': () => {
      const el = document.getElementById('c-newtab');
      const v = el && el.value.trim();
      if (v) ui.create.tabs.push(v);
    },
    'pick-folder': () => toast('실제 앱에서는 폴더 선택 창(dialog.showOpenDialog)이 열려요', { icon: '📂' }),
    'create-submit': () => submitCreate(),

    'team-tab-open': () => { ui.teamTabDraft = ''; later(0, () => { const el = document.getElementById('team-newtab'); if (el) el.focus(); }); },
    'team-tab-cancel': () => { ui.teamTabDraft = null; },
    'team-tab-save': () => {
      const name = (ui.teamTabDraft || '').trim();
      if (!name) return;
      const v = S.addSharedTab(st, name);
      ui.teamTabDraft = null;
      if (!v) { toast('이미 있는 탭이에요', { icon: 'ℹ' }); return; }
      if (name === '배포 대시보드' && ui.step === 0) ui.step = 1;
      toast(`고정 탭 '${esc(name)}' 추가 → 팀원 3명에게 반영 (공유 구성 v${v}) · 각자의 개인 탭은 그대로예요`);
    },
    'sec-open': () => { ui.secretDraft = { name: '', value: '' }; },
    'sec-save': () => {
      const sd = ui.secretDraft;
      const name = (sd.name || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (!name) return;
      st.team.secrets.push({ name });
      st.team.changes.unshift({ title: `비밀값 ${name} 추가`, sub: '값 원문은 화면·로그에 남기지 않아요 · 방금', fresh: true });
      ui.secretDraft = null;
      toast(`${esc(name)} 저장 — 값은 금고에만 있고, 실행할 때 환경변수로만 넣어요`, { icon: '🔐' });
    },
    'invite-open': () => { ui.modal = { type: 'invite' }; later(0, () => { const el = document.getElementById('inv-email'); if (el) el.focus(); }); },
    'invite-send': () => {
      const email = (document.getElementById('inv-email') || {}).value || '';
      const role = (document.getElementById('inv-role') || {}).value || '팀원';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast('이메일 형식을 확인해 주세요', { icon: '!' }); return; }
      st.team.invites.push({ email: email.trim(), role });
      ui.modal = { type: 'invite', sent: true, email: email.trim(), role };
    },
    'invite-preview': () => { ui.modal = null; ui.onb = freshUI().onb; go('onboard'); },

    'onb-start': () => onbRun(),
    'onb-skip': () => toast('명령을 직접 실행하면 Cadora가 결과만 확인해요 — 이 데모에서는 "확인하고 시작"을 눌러 주세요', { icon: 'ℹ' }),
    'onb-login': d => {
      ui.onb.logins[d.k] = true;
      const svc = d.k === 'figma' ? '피그마' : '노션';
      toast(`${svc} 로그인 창(이 워크스페이스 세션)에서 완료했어요 — 계정은 팀에 공유되지 않아요`, { icon: '🔑' });
      if (d.k === 'figma') {
        const s = st.team.services.find(x => x.name === '피그마');
        if (s && s.done < s.total) { s.done = s.total; delete s.wait; }
      }
      if (ui.onb.logins.notion && ui.onb.logins.figma) {
        const m = st.team.members.find(x => x.id === 'hyunwoo');
        m.note = '준비 완료'; m.warn = false;
      }
    },
    'onb-later': () => { ui.onb.later = true; onbFinish(); },
    'onb-open': () => onbFinish(),
    'onb-reset': () => { ui.onb = freshUI().onb; },

    'agent-launch': () => {
      const d = ui.agentDraft;
      const title = d.title.trim();
      if (!title) { toast('작업 제목을 적어 주세요 — 팀에 공유돼서 중복 작업을 막아요', { icon: '!' }); return; }
      const branch = d.branch.trim() || S.suggestBranch(title, st.runSeq + 1);
      const r = S.launchAgent(st, 'minsu', { tool: d.tool, title, branch });
      toast(`'${esc(title)}' ${esc(d.tool)} 실행 — ${esc(branch)} · ~/projects/capstone`, { icon: '▶' });
      const slug = branch.replace(/^[^/]+\//, '');
      const w = slug.split('-');
      const area = w.some(x => ['login', 'signup', 'auth', 'password', 'member', 'reset'].includes(x)) ? 'auth'
        : w.includes('mail') ? 'mail' : w.some(x => ['form', 'ui', 'dashboard', 'profile'].includes(x)) ? 'pages' : 'features';
      later(1800, () => {
        if (!S.isActive(r)) return;
        S.emitFile(st, { user: 'minsu', runId: r.id, kind: 'hook', path: `src/${area}/${slug}.${area === 'pages' ? 'tsx' : 'ts'}`, changeType: 'added' });
      });
      ui.agentDraft = { title: '', tool: d.tool, branch: '', branchEdited: false };
    },
    'run-stop': d => { const r = st.agents.find(a => a.id === d.id); r.status = 'done'; r.last = '사용자가 중지'; r.lastAt = new Date(); },
    'run-term': d => {
      const r = st.agents.find(a => a.id === d.id);
      toast(`외부 터미널에서 ${esc(r.tool)} 세션을 열어요 — 권한을 승인하면 다시 '작업 중'이 돼요`, { icon: '⌨' });
      later(1500, () => { r.status = 'running'; r.last = '권한 승인 · 작업 재개'; r.lastAt = new Date(); });
    },
    'ext-app': () => toast('VS Code 창을 앞으로 가져와요 (외부 앱 연동 · 편집은 원래 도구에서)', { icon: '⧉' }),
    discord: () => toast(`Discord 앱에서 ${esc(st.team.discord)} 채널을 열어요 — 대화·음성은 Discord가 맡아요`, { icon: '💬' }),
    'privacy-open': () => { ui.modal = { type: 'privacy' }; },

    evidence: d => { ui.expanded[d.id] = !ui.expanded[d.id]; },
    dismiss: d => {
      st.alertState[d.viewer + '|' + d.key] = 'dismissed';
      toast('경고를 숨겼어요 — 작업은 막지 않아요', { icon: '✓', action: { label: '되돌리기', fn: () => { delete st.alertState[d.viewer + '|' + d.key]; render(); } } });
    },
    undismiss: d => { for (const k of Object.keys(st.alertState)) if (k.startsWith(d.viewer + '|') && st.alertState[k] === 'dismissed') delete st.alertState[k]; },
    feedback: d => { st.alertFeedback[d.viewer + '|' + d.key] = d.v; toast('피드백을 남겼어요 — 경고 유용성 지표에 반영돼요', { icon: '✓' }); },
    'notify-open': d => { ui.modal = { type: 'notify', viewer: d.viewer, key: d.key }; },
    'notify-send': () => {
      const m = ui.modal;
      const a = S.computeAlerts(st, m.viewer).find(x => x.key === m.key);
      const runId = (document.getElementById('notify-run') || {}).value;
      const r = st.agents.find(x => x.id === runId);
      if (!a || !r) { ui.modal = null; return; }
      (st.agentNotes[r.id] = st.agentNotes[r.id] || []).push({ text: notifyText(a), at: new Date() });
      st.alertState[m.viewer + '|' + m.key] = 'notified';
      r.last = '팀 알림 수신 · 변경된 스키마 확인 중';
      r.lastAt = new Date();
      ui.modal = null;
      toast(`'${esc(r.title)}' 에이전트에게 요약을 전달했어요`, { icon: '✉' });
    },
    restart: d => {
      st.alertState[d.viewer + '|' + d.key] = 'handled';
      if (d.viewer === 'minsu') {
        const ws = byId('capstone');
        ws.server = 'starting';
        ws.term.push(['cmd', 'docker compose up -d && npm run dev']);
        later(1100, () => { ws.server = 'running'; ws.term.push(['ok', 'http://capstone.localhost (재시작 완료 · redis 추가됨)']); });
      }
      toast(`${U[d.viewer].name}의 capstone.localhost 다시 시작 — docker compose up -d && npm run dev`, { icon: '↻' });
    },

    step: d => { stopAuto(); doStep(+d.n); },
    auto: () => { stopAuto(); ui.auto = true; autoPlay(ui.autoToken); },
    'auto-stop': () => stopAuto(),
    reset: () => { const v = ui.view; reset(v); toast('처음 상태로 되돌렸어요', { icon: '↺' }); },
    online: () => {
      st.online = !st.online;
      if (st.online) {
        const n = S.flushQueue(st);
        for (const k of Object.keys(st.team.synced)) st.team.synced[k] = st.team.version;
        toast(`팀 서버 재연결 — 대기 중이던 이벤트 ${n}개를 다시 보냈어요`, { icon: '⟳' });
      } else {
        toast('팀 서버 연결을 끊었어요 — 로컬 작업은 계속되고 이벤트는 기기에 쌓여요', { icon: '⚡' });
      }
    },
    'select-event': d => { ui.selectedEvent = d.id; },
    inject: () => doInject(),
    'modal-close': () => { ui.modal = null; },
  };

  const INPUTS = {
    'create-name': v => { ui.create.name = v; ui.create.err = null; },
    'create-folder': v => {
      ui.create.folder = v;
      const hint = document.getElementById('c-cmd-hint');
      const host = (v.split('/').pop() || 'workspace').split('-')[0] || 'workspace';
      if (hint && ui.create.cmd) hint.textContent = `들어올 때 켜고 잠잘 때 꺼요 · 주소: ${host}.localhost (포트 자동)`;
    },
    'create-download': v => { ui.create.download = v; },
    'create-cmd': v => {
      ui.create.cmd = v;
      const hint = document.getElementById('c-cmd-hint');
      const host = (ui.create.folder.split('/').pop() || 'workspace').split('-')[0] || 'workspace';
      if (hint) hint.textContent = v ? `들어올 때 켜고 잠잘 때 꺼요 · 주소: ${host}.localhost (포트 자동)` : '비워 두면 서버 없이 만들어요';
    },
    'agent-title': v => {
      const d = ui.agentDraft;
      d.title = v;
      if (!d.branchEdited) {
        d.branch = v.trim() ? S.suggestBranch(v, st.runSeq + 1) : '';
        const b = document.getElementById('agent-branch');
        if (b) b.value = d.branch;
      }
      const h = document.getElementById('agent-sim-hint');
      if (h) h.innerHTML = simHint(v);
    },
    'agent-branch': v => { ui.agentDraft.branch = v; ui.agentDraft.branchEdited = true; },
    'team-tab': v => { ui.teamTabDraft = v; },
    'sec-name': v => { ui.secretDraft.name = v; },
    'sec-val': () => { /* 값은 상태에 저장하지 않는다 (FR-19) */ },
  };

  const CHANGES = {
    'split-ws': t => {
      const side = t.dataset.side;
      const other = side === 'left' ? 'right' : 'left';
      if (ui.split[other] === t.value) ui.split[other] = ui.split[side];
      ui.split[side] = t.value;
    },
    'create-ai': t => { ui.create.ai[t.dataset.k] = t.checked; },
    'agent-tool': t => { ui.agentDraft.tool = t.value; },
    'share-title': t => { st.shareTitle.minsu = t.checked; },
    inject: t => { ui.inject[t.dataset.k] = t.value; },
  };

  document.addEventListener('click', e => {
    const paneEl = e.target.closest('[data-pane]');
    let changed = false;
    if (paneEl && ui.view === 'split' && e.target.tagName !== 'SELECT' && ui.split.focus !== paneEl.dataset.pane) { ui.split.focus = paneEl.dataset.pane; changed = true; }
    const t = e.target.closest('[data-act]');
    if (t) {
      const act = t.dataset.act;
      if (act === 'modal-back') { if (e.target === t) { ui.modal = null; render(); } return; }
      if (t.disabled) return;
      const fn = A[act];
      if (fn) { fn(t.dataset, t, e); changed = true; }
    }
    if (changed) render();
  });

  document.addEventListener('input', e => {
    const k = e.target.dataset && e.target.dataset.input;
    if (k && INPUTS[k]) INPUTS[k](e.target.value, e.target);
  });

  document.addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.change;
    if (k && CHANGES[k]) { CHANGES[k](e.target, e); render(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ui.modal) { ui.modal = null; render(); return; }
    const t = e.target;
    if (e.key !== 'Enter' || !t.dataset || !t.dataset.enter || e.isComposing) return;
    e.preventDefault();
    const k = t.dataset.enter;
    if (k === 'term-run') {
      const ws = byId(t.id.replace(/^term-/, ''));
      runCommand(ws, t.value);
      t.value = '';
    } else if (k === 'create-tab-add') {
      A['create-tab-add']();
    } else if (A[k]) {
      A[k](t.dataset, t, e);
    }
    render();
    if (k === 'term-run' || k === 'create-tab-add') {
      const el = document.getElementById(t.id);
      if (el) { el.value = ''; el.focus(); }
    }
  });

  // ───────────────────────── 시작 ─────────────────────────
  // 해시: #demo · #ai · #home … , #demo/4 = 4단계까지 진행한 상태로 시작
  const [hv, hs] = (location.hash || '#demo').slice(1).split('/');
  reset(VIEWS.some(v => v.id === hv) ? hv : 'demo');
  if (hs && /^\d$/.test(hs)) {
    doStep(Math.min(+hs, STEPS.length));
    ui.firstRender = true;
  }
  render();
})();
