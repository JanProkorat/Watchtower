import { describe, it, expect } from 'vitest';
import { epicColours } from '../../client/src/components/timetracker/boardChips.js';

describe('epicColours', () => {
  it('returns the same colour pair for the same epic name (deterministic)', () => {
    const a = epicColours('Technologický postup');
    const b = epicColours('Technologický postup');
    expect(a).toEqual(b);
  });

  it('returns different colours for different epic names (typically)', () => {
    // Not guaranteed for every pair (8-slot palette → birthday collisions are
    // possible). The specific pair below is asserted by inspection to differ.
    const a = epicColours('Technologický postup');
    const b = epicColours('Logistika');
    expect(a).not.toEqual(b);
  });

  it('falls back to neutral grey on null / empty', () => {
    expect(epicColours(null).bg).toBe('#4b5563');
    expect(epicColours('').bg).toBe('#4b5563');
    expect(epicColours(undefined).bg).toBe('#4b5563');
  });

  it('always returns a valid hex foreground/background pair', () => {
    for (const name of ['x', 'Foo', 'Bar Baz', 'Změny,reklamace']) {
      const { bg, fg } = epicColours(name);
      expect(bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(fg).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
