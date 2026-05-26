import { describe, it, expect } from 'vitest';
import {
  areaCodeColours,
  areaCodeFromComponent,
} from '../../client/src/components/timetracker/boardChips.js';

describe('areaCodeFromComponent', () => {
  it('returns the leading uppercase prefix', () => {
    expect(areaCodeFromComponent('TEH-Technologický postup')).toBe('TEH');
    expect(areaCodeFromComponent('VYR-Logistika')).toBe('VYR');
    expect(areaCodeFromComponent('KP-Algoritmus')).toBe('KP');
  });

  it('returns null for null or non-prefix strings', () => {
    expect(areaCodeFromComponent(null)).toBeNull();
    expect(areaCodeFromComponent('')).toBeNull();
    expect(areaCodeFromComponent('lowercase-foo')).toBeNull();
  });

  it('accepts multi-token area codes (INFRA)', () => {
    expect(areaCodeFromComponent('INFRA-Sub')).toBe('INFRA');
    expect(areaCodeFromComponent('KONTROLA-Audit')).toBe('KONTROLA');
  });
});

describe('areaCodeColours', () => {
  it('returns a curated colour for known codes', () => {
    expect(areaCodeColours('TEH').bg).toBe('#7c3aed');
    expect(areaCodeColours('VYR').bg).toBe('#d97706');
    expect(areaCodeColours('KP').bg).toBe('#2563eb');
    expect(areaCodeColours('INFRA').bg).toBe('#0ea5e9');
  });

  it('falls back to a neutral grey on unknown / null codes', () => {
    const fallback = areaCodeColours(null);
    expect(fallback.bg).toBe('#4b5563');
    expect(areaCodeColours('XYZ').bg).toBe('#4b5563');
  });
});
