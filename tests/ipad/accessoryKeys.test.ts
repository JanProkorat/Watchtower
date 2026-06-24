// tests/ipad/accessoryKeys.test.ts
import { describe, it, expect } from 'vitest';
import { accessoryKeyToSequence, ctrlChar } from '../../apps/ipad/src/lib/accessoryKeys.js';

describe('accessoryKeyToSequence', () => {
  it('maps esc/tab/arrows to control sequences', () => {
    expect(accessoryKeyToSequence('esc')).toBe('\x1b');
    expect(accessoryKeyToSequence('tab')).toBe('\t');
    expect(accessoryKeyToSequence('up')).toBe('\x1b[A');
    expect(accessoryKeyToSequence('down')).toBe('\x1b[B');
    expect(accessoryKeyToSequence('right')).toBe('\x1b[C');
    expect(accessoryKeyToSequence('left')).toBe('\x1b[D');
  });
});

describe('ctrlChar', () => {
  it('maps letters to their control byte', () => {
    expect(ctrlChar('c')).toBe('\x03');
    expect(ctrlChar('C')).toBe('\x03');
    expect(ctrlChar('a')).toBe('\x01');
  });
  it('returns empty string for non-letters', () => {
    expect(ctrlChar('1')).toBe('');
    expect(ctrlChar('')).toBe('');
  });
});
