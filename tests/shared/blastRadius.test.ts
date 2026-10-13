import { describe, it, expect } from 'vitest';
import { parseBlastRadiusPost, outcomeToast } from '@watchtower/shared/blastRadius.js';

const hold = { id: 'h1', command: 'rm -rf dist', riskLabel: 'rm -rf', summary: 'delete 3 files', lines: ['dist/a', 'dist/b'], more: 1, note: 'Paths: dist', startedAt: 5 };

describe('parseBlastRadiusPost', () => {
  it('accepts a hold and a release with an outcome', () => {
    expect(parseBlastRadiusPost({ version: 1, hold })).toEqual({ hold: { ...hold, commandTruncated: false }, outcome: null });
    expect(parseBlastRadiusPost({ version: 1, hold: null, outcome: { id: 'h1', command: 'rm -rf dist', decision: 'proceed' } })).toEqual({
      hold: null,
      outcome: { id: 'h1', command: 'rm -rf dist', decision: 'proceed' },
    });
  });

  it('rejects non-v1 bodies, a hold without an id, and an unknown outcome decision', () => {
    expect(parseBlastRadiusPost({ version: 2, hold })).toBeNull();
    expect(parseBlastRadiusPost(null)).toBeNull();
    expect(parseBlastRadiusPost({ version: 1, hold: { ...hold, id: '' } })).toBeNull();
    expect(parseBlastRadiusPost({ version: 1, hold: null, outcome: { id: 'h1', command: 'x', decision: 'maybe' } })).toEqual({ hold: null, outcome: null });
  });

  it('caps long fields and is lenient per field', () => {
    const p = parseBlastRadiusPost({ version: 1, hold: { ...hold, command: 'x'.repeat(5000), lines: Array.from({ length: 80 }, () => 'y'.repeat(900)), more: 'lots' } });
    expect(p?.hold?.command).toHaveLength(2000);
    expect(p?.hold?.lines).toHaveLength(50);
    expect(p?.hold?.lines[0]).toHaveLength(500);
    expect(p?.hold?.more).toBe(30);
    expect(p?.hold?.commandTruncated).toBe(true);
  });

  it('counts every dropped line in more and sanitises more', () => {
    const many = Array.from({ length: 80 }, () => 'y');
    const a = parseBlastRadiusPost({ version: 1, hold: { ...hold, lines: many, more: 2 } });
    expect(a?.hold?.lines).toHaveLength(50);
    expect(a?.hold?.more).toBe(32);
    const b = parseBlastRadiusPost({ version: 1, hold: { ...hold, lines: ['a', 7, null, 'b'], more: 0 } });
    expect(b?.hold?.lines).toEqual(['a', 'b']);
    expect(b?.hold?.more).toBe(2);
    expect(parseBlastRadiusPost({ version: 1, hold: { ...hold, lines: [], more: -3.7 } })?.hold?.more).toBe(0);
  });
});

describe('outcomeToast', () => {
  it('words each outcome with the right severity and a shortened command', () => {
    expect(outcomeToast({ id: 'a', command: 'rm -rf dist', decision: 'proceed' })).toEqual({ severity: 'info', text: 'Blast Radius: running `rm -rf dist`' });
    expect(outcomeToast({ id: 'a', command: 'rm -rf dist', decision: 'cancel' })).toEqual({ severity: 'info', text: 'Blast Radius: cancelled `rm -rf dist`' });
    expect(outcomeToast({ id: 'a', command: 'git clean -fd', decision: 'timeout' }).text).toBe("Blast Radius: didn't run `git clean -fd` (no answer within 10 minutes)");
    expect(outcomeToast({ id: 'a', command: 'x', decision: 'interrupted' })).toEqual({ severity: 'warning', text: "Blast Radius: didn't run `x` (turn interrupted)" });
    expect(outcomeToast({ id: 'a', command: 'x', decision: 'error' }).text).toBe("Blast Radius: didn't run `x` (error)");
    const long = outcomeToast({ id: 'a', command: 'rm -rf ' + 'a'.repeat(100), decision: 'proceed' }).text;
    expect(long).toContain('…`');
    expect(long.length).toBeLessThan(90);
  });
});
