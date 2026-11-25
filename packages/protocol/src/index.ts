/**
 * Cadora 공통 계약(데스크톱 쪽) — 서버 REST · WebSocket · 데스크톱 IPC의 타입과 zod 검증 스키마를 둘 곳이다.
 * 기준은 docs/API.md와 공통 계약 사례다. Java 서버는 자체 DTO·검증을 쓰고 같은 사례로 일치를 확인한다(API.md 머리말).
 * 스키마는 #23에서 채운다.
 *
 * 경계: 순수 TypeScript만 쓴다. 데스크톱 main·preload·renderer가 모두 import하므로 DOM·Node API를 쓰지 않는다.
 */

/** 이벤트 스키마 버전 — API.md §2.3 `EventBase.v`. */
export const PROTOCOL_VERSION = 1;

/** 서버 REST·WebSocket 경로 접두사 — API.md §0 Base URL `https://<host>/v1`. */
export const API_PREFIX = '/v1';
