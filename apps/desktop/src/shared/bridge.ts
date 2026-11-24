/**
 * preload가 renderer에 여는 `window.cadora`의 골격 단계 타입.
 * renderer는 Node·파일 시스템에 직접 접근하지 않고 이 객체만 쓴다(API.md §3).
 *
 * 실제 계약(API.md §3 CadoraAPI: workspace · browser · agents · terminal · team · alerts …)은
 * packages/protocol의 IPC 계약(#23)으로 옮기고, #24부터 기능별로 채운다.
 */
export interface CadoraBridge {
  /** 'win32' | 'darwin' | 'linux' — 운영체제별 화면 처리에 쓴다. */
  readonly platform: string;
  /** @cadora/protocol의 PROTOCOL_VERSION. */
  readonly protocolVersion: number;
  readonly versions: {
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
  };
}
