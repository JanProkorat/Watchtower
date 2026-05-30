import './xtermHeadlessShim.js'; // MUST precede the @xterm/headless import
import pkg from '@xterm/headless';
const { Terminal } = pkg;
type Terminal = InstanceType<typeof Terminal>;

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const SCROLLBACK = 200;

/**
 * Per-instance headless terminal emulator. Every pty data chunk is fed in via
 * `feed`; `snapshot` renders the current visible buffer to clean text (exactly
 * what the user would see), used to make Slack escalation DMs actionable.
 */
export class TerminalSnapshots {
  private terms = new Map<string, Terminal>();

  private ensure(id: string): Terminal {
    let term = this.terms.get(id);
    if (!term) {
      term = new Terminal({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS, scrollback: SCROLLBACK, allowProposedApi: true });
      this.terms.set(id, term);
    }
    return term;
  }

  feed(id: string, chunk: string): void {
    this.ensure(id).write(chunk);
  }

  /** Resolves once xterm has parsed everything written so far. */
  flush(id: string): Promise<void> {
    const term = this.terms.get(id);
    if (!term) return Promise.resolve();
    return new Promise((resolve) => term.write('', () => resolve()));
  }

  resize(id: string, cols: number, rows: number): void {
    const term = this.terms.get(id);
    if (term && cols > 0 && rows > 0) term.resize(cols, rows);
  }

  /** Cleaned visible text: buffer rows right-trimmed, leading/trailing blanks removed. */
  snapshot(id: string): string {
    const term = this.terms.get(id);
    if (!term) return '';
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      lines.push(line ? line.translateToString(true) : '');
    }
    while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
    while (lines.length && lines[0]!.trim() === '') lines.shift();
    return lines.join('\n');
  }

  dispose(id: string): void {
    const term = this.terms.get(id);
    if (term) {
      term.dispose();
      this.terms.delete(id);
    }
  }
}
