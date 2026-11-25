import { describe, expect, it } from 'vitest';
import { API_PREFIX, PROTOCOL_VERSION } from './index';

// API.md에 적힌 값과 어긋나면 서버와 데스크톱이 서로 다른 계약을 쓰게 된다.
// 값을 바꿀 때는 API.md도 같이 고친다.
describe('protocol constants', () => {
  it('matches API.md §0 base path and §2.3 schema version', () => {
    expect(API_PREFIX).toBe('/v1');
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
