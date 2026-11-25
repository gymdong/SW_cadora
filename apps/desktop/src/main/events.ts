/**
 * main → 앱 화면(renderer) 이벤트. 앱 화면 창 하나에만 보낸다(워크스페이스 웹 뷰로는 절대 보내지 않는다).
 * 터미널 출력처럼 잦은 이벤트는 terminals.ts에서 묶어서 보낸다.
 */
import type { WebContents } from 'electron';
import type { CadoraEventName, CadoraEvents } from '../shared/bridge';

let target: WebContents | null = null;

export function setEventTarget(wc: WebContents | null): void {
  target = wc;
}

export function emit<E extends CadoraEventName>(event: E, payload: CadoraEvents[E]): void {
  if (!target || target.isDestroyed()) return;
  target.send(`cadora:event:${event}`, payload);
}
