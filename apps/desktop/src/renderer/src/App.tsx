// 골격 확인용 화면. 실제 화면(작업공간 · 팀 · 활동 · 캘린더)은 #25부터 prototype/을 기준으로 만든다.
export function App() {
  const { platform, protocolVersion, versions } = window.cadora;

  return (
    <main className="skeleton">
      <h1>Cadora</h1>
      <p>데스크톱 앱 골격이 실행 중이에요.</p>
      <dl>
        <dt>플랫폼</dt>
        <dd>{platform}</dd>
        <dt>Electron</dt>
        <dd>{versions.electron}</dd>
        <dt>프로토콜</dt>
        <dd>v{protocolVersion}</dd>
      </dl>
    </main>
  );
}
