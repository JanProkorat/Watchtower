import { describe, it, expect } from 'vitest';
import { parseEscalation } from '../../orchestrator/escalationMessage';

describe('parseEscalation', () => {
  it('extracts a question and numbered options', () => {
    const snap = [
      ' Running tests…',
      ' Allow Bash(rm -rf build)?',
      ' 1. Yes',
      ' 2. Yes, and don\'t ask again this session',
      ' 3. No, and tell Claude what to do differently',
    ].join('\n');
    const r = parseEscalation(snap);
    expect(r.question).toBe('Allow Bash(rm -rf build)?');
    expect(r.options).toEqual([
      { number: 1, label: 'Yes' },
      { number: 2, label: "Yes, and don't ask again this session" },
      { number: 3, label: 'No, and tell Claude what to do differently' },
    ]);
  });
  it('handles a selection caret (❯) prefix on options', () => {
    const snap = 'Proceed?\n❯ 1. Yes\n  2. No';
    expect(parseEscalation(snap).options.map(o => o.number)).toEqual([1, 2]);
  });
  it('returns empty options when nothing parses, keeping the last non-empty line as question', () => {
    const snap = 'just some output\nfinal line with no options';
    const r = parseEscalation(snap);
    expect(r.options).toEqual([]);
    expect(r.question).toBe('final line with no options');
  });
});
