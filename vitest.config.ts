import { defineConfig } from 'vitest/config';

// 루트에서 `npm test` 한 번으로 TypeScript 패키지 테스트를 모두 돌린다. 패키지마다 별도 프로젝트로 실행된다.
// apps/server(Java)는 여기에 넣지 않는다. 한 패키지만: npx vitest run --project @cadora/desktop
export default defineConfig({
  test: {
    projects: ['apps/desktop', 'packages/*'],
  },
});
