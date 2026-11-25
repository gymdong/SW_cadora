import type { CadoraBridge } from '../../shared/bridge';

declare global {
  interface Window {
    /** preload가 여는 유일한 통로. renderer는 Node·파일 시스템에 직접 접근하지 않는다. */
    readonly cadora: CadoraBridge;
  }
}
