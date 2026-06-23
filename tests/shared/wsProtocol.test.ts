// tests/shared/wsProtocol.test.ts
import { describe, it, expect } from 'vitest';
import { encodeFrame, decodeFrame, isPushFrame } from '@watchtower/shared/wsProtocol.js';

describe('wsProtocol', () => {
  it('round-trips a request frame', () => {
    const frame = { id: 'a1', kind: 'projects:list', payload: {} } as const;
    const decoded = decodeFrame(encodeFrame(frame as never));
    expect(isPushFrame(decoded)).toBe(false);
    expect(decoded).toEqual(frame);
  });

  it('detects a push frame', () => {
    const frame = { push: true, kind: 'ptyData', payload: { instanceId: 'x', chunk: 'hi' } } as const;
    const decoded = decodeFrame(encodeFrame(frame as never));
    expect(isPushFrame(decoded)).toBe(true);
  });

  it('throws on malformed JSON', () => {
    expect(() => decodeFrame('{not json')).toThrow();
  });
});
