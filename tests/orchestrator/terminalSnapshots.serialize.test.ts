import { describe, it, expect } from 'vitest';
import { TerminalSnapshots } from '../../orchestrator/terminalSnapshots.js';

describe('TerminalSnapshots.serialize', () => {
  it('returns empty string for an unknown instance', () => {
    const s = new TerminalSnapshots();
    expect(s.serialize('nope')).toBe('');
  });

  it('produces a replayable string reproducing written content', async () => {
    const s = new TerminalSnapshots();
    s.feed('i1', 'hello \x1b[31mred\x1b[0m world\r\n');
    await s.flush('i1');
    const out = s.serialize('i1');
    expect(out).toContain('hello');
    expect(out).toContain('red');
    // SerializeAddon re-emits SGR codes for colored runs.
    expect(out).toContain('\x1b[');
  });

  it('reflects the latest screen after a clear', async () => {
    const s = new TerminalSnapshots();
    s.feed('i1', 'first line\r\n');
    s.feed('i1', '\x1b[2J\x1b[H'); // clear screen + home
    s.feed('i1', 'after clear\r\n');
    await s.flush('i1');
    const out = s.serialize('i1');
    expect(out).toContain('after clear');
    expect(out).not.toContain('first line');
  });
});
