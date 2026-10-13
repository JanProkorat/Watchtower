import { describe, it, expect } from 'vitest';
import { parseReplay } from '@watchtower/shared/replay.js';

const step = { file: 'src/a.ts', tool: 'Edit', note: '', added: 1, deleted: 1, lines: [{ kind: 'del', text: 'old' }, { kind: 'add', text: 'new' }] };

describe('parseReplay', () => {
  it('accepts a v1 turn, a baseline with no turn, and drops junk lines', () => {
    expect(parseReplay({ version: 1, panelToggles: 2, sentAt: 9, turn: { at: 5, steps: [step] } })).toEqual({ panelToggles: 2, sentAt: 9, turn: { at: 5, steps: [step] } });
    expect(parseReplay({ version: 1, turn: null })).toEqual({ panelToggles: 0, sentAt: 0, turn: null });
    const s = parseReplay({ version: 1, turn: { at: 1, steps: [{ ...step, lines: [{ kind: 'weird', text: 'x' }, { kind: 'ctx', text: 7 }, { kind: 'ctx', text: 'ok' }] }] } });
    expect(s?.turn?.steps[0]?.lines).toEqual([{ kind: 'ctx', text: 'ok' }]);
    expect(parseReplay({ version: 2, turn: null })).toBeNull();
  });

  it('caps steps, lines per step and line length', () => {
    const big = { ...step, lines: Array.from({ length: 300 }, () => ({ kind: 'add', text: 'z'.repeat(900) })) };
    const s = parseReplay({ version: 1, turn: { at: 1, steps: Array.from({ length: 70 }, () => big) } });
    expect(s?.turn?.steps).toHaveLength(50);
    expect(s?.turn?.steps[0]?.lines).toHaveLength(200);
    expect(s?.turn?.steps[0]?.lines[0]?.text).toHaveLength(500);
  });
});
