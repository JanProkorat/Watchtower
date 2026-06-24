import type { TerminalSnapshots } from './terminalSnapshots.js';

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

/**
 * Build the terminalAttach response: the replayable ANSI snapshot plus the
 * pty's current dimensions so the client sizes its xterm to match the stream
 * it is about to receive. `getDims` returns null when the pty is unknown.
 */
export function buildTerminalAttachResponse(
  snaps: TerminalSnapshots,
  instanceId: string,
  getDims: (id: string) => { cols: number; rows: number } | null,
): { data: string; cols: number; rows: number } {
  const dims = getDims(instanceId) ?? { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
  return { data: snaps.serialize(instanceId), cols: dims.cols, rows: dims.rows };
}
