import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Node·Electron 모듈을 import하면 오류로 막는다. 공통 패키지와 앱 화면(renderer)의 경계를 지킨다. */
function forbidNodeAndElectron(message) {
  return [
    'error',
    {
      patterns: [
        {
          group: ['node:*', 'fs', 'fs/*', 'path', 'os', 'child_process', 'net', 'http', 'https', 'crypto', 'electron', 'electron/*'],
          message,
        },
      ],
    },
  ];
}

export default defineConfig(
  // apps/server는 Java(Spring Boot) 서버라 ESLint 대상이 아니다 (ARCHITECTURE §4).
  // apps/desktop/src/renderer/src/proto/는 데모 브랜치에서 prototype/을 복사해 고친 화면이라 원본처럼 제외한다.
  globalIgnores(['**/node_modules/', '**/dist/', '**/out/', 'release/', 'coverage/', 'prototype/', 'apps/server/', 'apps/desktop/src/renderer/src/proto/']),

  js.configs.recommended,
  tseslint.configs.recommended,

  // 설정 파일과 Node에서 도는 코드(데스크톱 main·preload)
  {
    files: ['*.{js,ts}', 'apps/*/*.config.ts', 'apps/desktop/src/{main,preload}/**/*.ts', 'apps/desktop/resources/**/*.cjs'],
    languageOptions: { globals: globals.node },
  },

  // Claude Code hook이 plain node로 실행하는 CommonJS 스크립트(번들하지 않는다)
  {
    files: ['apps/desktop/resources/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // 공통 패키지: 데스크톱이 쓰는 순수 TypeScript. Java 서버는 같은 규칙·계약을 따로 구현한다 (ARCHITECTURE §2.1)
  {
    files: ['packages/{core,protocol}/**/*.ts'],
    rules: {
      'no-restricted-imports': forbidNodeAndElectron('공통 패키지(core·protocol)는 DOM·Node·Electron 없이 순수 TypeScript로 작성합니다 (#22, #23).'),
    },
  },

  // 앱 화면: 브라우저 환경이고, main 기능은 window.cadora(preload)로만 쓴다 (API.md §3)
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: reactHooks.configs.flat.recommended.plugins,
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'no-restricted-imports': forbidNodeAndElectron('앱 화면은 Node·Electron을 직접 쓰지 않고 window.cadora(preload)를 씁니다.'),
    },
  },
);
