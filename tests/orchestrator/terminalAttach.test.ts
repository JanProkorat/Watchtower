import { describe, it, expect } from 'vitest';
import { buildTerminalAttachResponse } from '../../orchestrator/terminalAttach.js';
import { TerminalSnapshots } from '../../orchestrator/terminalSnapshots.js';

describe('buildTerminalAttachResponse', () => {
  it('returns serialized data + the pty dimensions', async () => {
    const snaps = new TerminalSnapshots();
    snaps.feed('i1', 'prompt$ \r\n');
    await snaps.flush('i1');
    const res = buildTerminalAttachResponse(snaps, 'i1', () => ({ cols: 100, rows: 40 }));
    expect(res.cols).toBe(100);
    expect(res.rows).toBe(40);
    expect(res.data).toContain('prompt$');
  });

  it('falls back to default dims when the pty is unknown', () => {
    const snaps = new TerminalSnapshots();
    const res = buildTerminalAttachResponse(snaps, 'gone', () => null);
    expect(res).toEqual({ data: '', cols: 120, rows: 30 });
  });
});
