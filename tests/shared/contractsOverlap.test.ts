import { describe, it, expect } from 'vitest';
import { contractsOverlap } from '@watchtower/shared/billing/contracts-overlap.js';

describe('contractsOverlap', () => {
  it('detects overlapping closed ranges', () => {
    expect(contractsOverlap('2026-01-01', '2026-06-30', '2026-06-01', '2026-12-31')).toBe(true);
  });
  it('treats exact-boundary touch as overlap (matches orchestrator sentinel predicate)', () => {
    expect(contractsOverlap('2026-01-01', '2026-06-30', '2026-06-30', '2026-12-31')).toBe(true);
  });
  it('non-overlapping adjacent ranges (prior ends day before) do not overlap', () => {
    expect(contractsOverlap('2026-01-01', '2026-05-31', '2026-06-01', null)).toBe(false);
  });
  it('open-ended existing overlaps any later range', () => {
    expect(contractsOverlap('2026-01-01', null, '2027-01-01', '2027-06-30')).toBe(true);
  });
  it('two open-ended ranges overlap', () => {
    expect(contractsOverlap('2026-01-01', null, '2026-06-01', null)).toBe(true);
  });
  it('new range entirely before existing does not overlap', () => {
    expect(contractsOverlap('2026-06-01', '2026-12-31', '2026-01-01', '2026-05-31')).toBe(false);
  });
});
