import { describe, it, expect } from 'vitest';
import { TerminalSnapshots } from '../../orchestrator/terminalSnapshots.js';

describe('TerminalSnapshots', () => {
  it('captures plain prompt text fed as a chunk', async () => {
    const t = new TerminalSnapshots();
    t.feed('a', 'Allow Bash(ls)?\r\n1. Yes\r\n2. No\r\n');
    await t.flush('a');
    const snap = t.snapshot('a');
    expect(snap).toContain('Allow Bash(ls)?');
    expect(snap).toContain('1. Yes');
    expect(snap).toContain('2. No');
  });

  it('reflects the final screen after a clear+redraw (not stale frames)', async () => {
    const t = new TerminalSnapshots();
    t.feed('a', 'first frame\r\n');
    t.feed('a', '\x1b[2J\x1b[Hsecond frame\r\n');
    await t.flush('a');
    const snap = t.snapshot('a');
    expect(snap).toContain('second frame');
    expect(snap).not.toContain('first frame');
  });

  it('trims leading/trailing blank lines', async () => {
    const t = new TerminalSnapshots();
    t.feed('a', 'hello\r\n');
    await t.flush('a');
    expect(t.snapshot('a')).toBe('hello');
  });

  it('returns empty string for an unknown id', () => {
    const t = new TerminalSnapshots();
    expect(t.snapshot('nope')).toBe('');
  });

  it('dispose drops the terminal (snapshot empty afterward)', async () => {
    const t = new TerminalSnapshots();
    t.feed('a', 'hello\r\n');
    await t.flush('a');
    t.dispose('a');
    expect(t.snapshot('a')).toBe('');
  });
});
