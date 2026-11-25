/**
 * Cadora 공통 규칙 모듈 — prototype/sim.js의 순수 로직을 TypeScript로 옮길 곳이다(#22).
 * classify · toRelative · dirKey · titleSimilarity · suggestBranch · maskSecrets · maskEnv · privacyCheck · computeAlerts
 *
 * 경계: DOM·Node API를 쓰지 않는다(#22 수용 기준). Java 서버는 같은 규칙을 따로 구현하고,
 * 공통 JSON 테스트 사례로 양쪽 결과가 같은지 검증한다(ARCHITECTURE §2.1).
 * tsconfig에 DOM·Node 타입이 없어서 window·process·node:fs 등을 쓰면 typecheck가 실패한다.
 */
export {};
