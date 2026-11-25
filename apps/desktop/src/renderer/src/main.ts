// 데모 화면 진입점: 프로토타입 화면(proto/) + 실제 기능 연결층(real/).
// import 순서가 실행 순서다 — sim.js → real(window.CadoraReal) → app.js.
import '@xterm/xterm/css/xterm.css';
import './proto/styles.css';
import './real/real.css';
import './proto/sim.js';
import './real/index';
import './proto/app.js';
