# Slack Actionable Escalation Messages — Implementation Plan (Phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Slack escalation DMs actionable by including a clean snapshot of what's on Claude's screen (the permission prompt + options, or the last output), so the user can answer meaningfully from their phone.

**Architecture:** Maintain one headless `@xterm/headless` terminal per instance in the orchestrator, fed every pty data chunk. On escalation, read its visible buffer into clean text and embed it (fenced) in the DM via a pure formatter. Reply path is unchanged (the shipped `routeReply`/`deliverSlackReply` already writes the reply into the pty).

**Tech Stack:** TypeScript (NodeNext ESM), Electron utilityProcess orchestrator, `@xterm/headless`, vitest.

**Spec:** `docs/superpowers/specs/2026-05-30-slack-actionable-messages-design.md`

**Conventions:** NodeNext ESM — local imports use `.js` extension. Commit after each task with trailer exactly `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Orchestrator typecheck: `npx tsc -p orchestrator/tsconfig.json --noEmit`. No network in tests.

---

## File Structure

**Create:**
- `orchestrator/xtermHeadlessShim.ts` — side-effect shim: define `globalThis.self` for Node before `@xterm/headless` loads.
- `orchestrator/terminalSnapshots.ts` — `TerminalSnapshots`: per-instance headless terminal; `feed`/`flush`/`resize`/`snapshot`/`dispose`.
- `orchestrator/escalationMessage.ts` — pure `formatEscalationMessage(name, kind, snapshot)`.
- Tests: `tests/orchestrator/terminalSnapshots.test.ts`, `tests/orchestrator/escalationMessage.test.ts`.

**Modify:**
- `package.json` — add `@xterm/headless`.
- `orchestrator/index.ts` — construct `TerminalSnapshots`; `feed` in pty `onData`; `resize` in `ptyResize`; `dispose` in `removeInstance` + `killInstance`; rewrite `postSlack` to use `snapshot` + `formatEscalationMessage` (replacing `slackTextFor`).

---

### Task 1: Add `@xterm/headless` dependency

**Files:** Modify `package.json`

- [ ] **Step 1: Install (version-aligned with the renderer's @xterm/xterm ^5.5.0)**

```bash
npm install @xterm/headless@^5.5.0
```

- [ ] **Step 2: Verify it imports in Node (the orchestrator runs in real Node, where `self` is undefined)**

```bash
node -e "globalThis.self = globalThis; const x = require('@xterm/headless'); console.log(typeof x.Terminal)"
```
Expected: prints `function`. (If `require` fails because the package is ESM-only, instead run: `node --input-type=module -e "globalThis.self=globalThis; const {Terminal}=await import('@xterm/headless'); console.log(typeof Terminal)"` and note which import style worked — Task 2 must use the working style.)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @xterm/headless for terminal snapshots"
```

---

### Task 2: `xtermHeadlessShim` + `TerminalSnapshots`

**Files:**
- Create: `orchestrator/xtermHeadlessShim.ts`
- Create: `orchestrator/terminalSnapshots.ts`
- Test: `tests/orchestrator/terminalSnapshots.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/terminalSnapshots.test.ts
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
    // ESC[2J clears screen, ESC[H homes cursor — simulate a TUI redraw.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/terminalSnapshots.test.ts`
Expected: FAIL — cannot find module `terminalSnapshots.js`.

- [ ] **Step 3: Create the shim**

```ts
// orchestrator/xtermHeadlessShim.ts
// @xterm/headless is built for browsers / web workers and references the
// global `self` at module-eval time. The orchestrator runs in a Node
// utilityProcess where `self` is undefined, so define it before xterm loads.
// This module has no exports; import it for its side effect BEFORE importing
// '@xterm/headless'.
const g = globalThis as unknown as { self?: unknown };
if (typeof g.self === 'undefined') {
  g.self = globalThis;
}
```

- [ ] **Step 4: Create `TerminalSnapshots`**

```ts
// orchestrator/terminalSnapshots.ts
import './xtermHeadlessShim.js'; // MUST precede the @xterm/headless import
import { Terminal } from '@xterm/headless';

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
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    while (lines.length && lines[0].trim() === '') lines.shift();
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
```

NOTE: if Task 1 Step 2 found that the named import fails, use the working form here (e.g. `import xterm from '@xterm/headless'; const { Terminal } = xterm;`) and keep the shim import first. The test in Step 1 exercises real import + parsing, so a wrong import style fails fast.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/terminalSnapshots.test.ts`
Expected: PASS (5 tests). If the "clear+redraw" test shows `first frame` still present, the buffer read is including scrollback above the cleared screen — that's acceptable ONLY if the formatter's tail-truncation hides it; but prefer fixing here by confirming `ESC[2J` clears as expected. If a test fails due to the import/`self` issue, that's a real runtime problem — fix the import/shim, don't change the test.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/xtermHeadlessShim.ts orchestrator/terminalSnapshots.ts tests/orchestrator/terminalSnapshots.test.ts
git commit -m "feat(slack): TerminalSnapshots headless-terminal capture for instances"
```

---

### Task 3: `formatEscalationMessage`

**Files:**
- Create: `orchestrator/escalationMessage.ts`
- Test: `tests/orchestrator/escalationMessage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/escalationMessage.test.ts
import { describe, it, expect } from 'vitest';
import { formatEscalationMessage } from '../../orchestrator/escalationMessage.js';

describe('formatEscalationMessage', () => {
  it('embeds the snapshot in a fenced block with a header and reply hint (permission)', () => {
    const out = formatEscalationMessage('proj', 'waiting-permission', 'Allow Bash(ls)?\n1. Yes\n2. No');
    expect(out).toContain('🔐 *proj* needs a permission decision:');
    expect(out).toContain('Allow Bash(ls)?');
    expect(out).toContain('1. Yes');
    expect(out).toMatch(/Reply in this thread/);
    // exactly one opening + one closing fence (no stray fences from content)
    expect(out.split('```').length).toBe(3);
  });

  it('uses the idle header for idle-notify', () => {
    const out = formatEscalationMessage('proj', 'idle-notify', 'done.');
    expect(out).toContain('⏳ *proj* finished and is waiting for your input:');
    expect(out).toMatch(/Reply in this thread/);
  });

  it('uses the crash header and omits the reply hint for crashed', () => {
    const out = formatEscalationMessage('proj', 'crashed', 'Error: boom');
    expect(out).toContain('💥 *proj* crashed / exited unexpectedly. Last output:');
    expect(out).toContain('Error: boom');
    expect(out).not.toMatch(/Reply in this thread/);
  });

  it('falls back to a single line (no fence) when the snapshot is empty', () => {
    const out = formatEscalationMessage('proj', 'waiting-permission', '   ');
    expect(out).not.toContain('```');
    expect(out).toContain('🔐 *proj* needs a permission decision.');
    expect(out).toMatch(/Reply in this thread/);
  });

  it('truncates long snapshots to the last 25 lines with a marker', () => {
    const snap = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const out = formatEscalationMessage('proj', 'idle-notify', snap);
    expect(out).toContain('… (truncated)');
    expect(out).toContain('line 39');
    expect(out).not.toContain('line 0\n'); // earliest lines dropped
  });

  it('neutralizes triple backticks in the snapshot so they cannot break the fence', () => {
    const out = formatEscalationMessage('proj', 'idle-notify', 'before ``` after');
    // still exactly the two fence markers
    expect(out.split('```').length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/escalationMessage.test.ts`
Expected: FAIL — cannot find module `escalationMessage.js`.

- [ ] **Step 3: Implement**

```ts
// orchestrator/escalationMessage.ts
export type EscalationKind = 'waiting-permission' | 'idle-notify' | 'crashed';

const MAX_LINES = 25;
const MAX_CHARS = 1500;
const REPLY_HINT = 'Reply in this thread with the option number (e.g. `1`) or an instruction.';

function headerFor(name: string, kind: EscalationKind): string {
  if (kind === 'waiting-permission') return `🔐 *${name}* needs a permission decision:`;
  if (kind === 'crashed') return `💥 *${name}* crashed / exited unexpectedly. Last output:`;
  return `⏳ *${name}* finished and is waiting for your input:`;
}

function fallbackLine(name: string, kind: EscalationKind): string {
  if (kind === 'waiting-permission') return `🔐 *${name}* needs a permission decision.`;
  if (kind === 'crashed') return `💥 *${name}* crashed / exited unexpectedly.`;
  return `⏳ *${name}* finished and is waiting for your input.`;
}

function clip(text: string): string {
  let lines = text.split('\n');
  let truncated = false;
  if (lines.length > MAX_LINES) {
    lines = lines.slice(-MAX_LINES);
    truncated = true;
  }
  let out = lines.join('\n');
  if (out.length > MAX_CHARS) {
    out = out.slice(out.length - MAX_CHARS);
    truncated = true;
  }
  // Stop snapshot content from closing the Slack code fence early.
  out = out.replace(/```/g, '`​``');
  return truncated ? `… (truncated)\n${out}` : out;
}

/**
 * Builds the Slack escalation DM. When `snapshot` has content it is embedded in
 * a fenced code block under a per-kind header; otherwise a single-line fallback
 * is used. A reply hint is appended for actionable kinds (not for crashes).
 */
export function formatEscalationMessage(name: string, kind: EscalationKind, snapshot: string): string {
  const hint = kind === 'crashed' ? '' : REPLY_HINT;
  const cleaned = snapshot.trim();
  if (!cleaned) {
    return [fallbackLine(name, kind), hint].filter(Boolean).join('\n');
  }
  const block = '```\n' + clip(cleaned) + '\n```';
  return [headerFor(name, kind), block, hint].filter(Boolean).join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/escalationMessage.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add orchestrator/escalationMessage.ts tests/orchestrator/escalationMessage.test.ts
git commit -m "feat(slack): formatEscalationMessage embeds prompt snapshot in the DM"
```

---

### Task 4: Wire into the orchestrator

**Files:** Modify `orchestrator/index.ts`

- [ ] **Step 1: Add imports (near the other slack imports ~line 42-45)**

```ts
import { TerminalSnapshots } from './terminalSnapshots.js';
import { formatEscalationMessage } from './escalationMessage.js';
```

- [ ] **Step 2: Add module state (near `const pty = new PtyManager();`)**

```ts
const terminalSnapshots = new TerminalSnapshots();
```

- [ ] **Step 3: Feed the snapshot terminal in the pty `onData`**

Find, in `spawnPtyForInstance`, the `onData` callback:
```ts
    onData: (chunk) => {
      api?.push({ kind: 'ptyData', payload: { instanceId: opts.id, chunk } });
      applyTransition(opts.id, { kind: 'ptyData' });
    },
```
Add the feed as the first line:
```ts
    onData: (chunk) => {
      terminalSnapshots.feed(opts.id, chunk);
      api?.push({ kind: 'ptyData', payload: { instanceId: opts.id, chunk } });
      applyTransition(opts.id, { kind: 'ptyData' });
    },
```

- [ ] **Step 4: Sync resize**

Find the `case 'ptyResize':` handler:
```ts
    case 'ptyResize':
      pty.get(req.payload.instanceId)?.resize(req.payload.cols, req.payload.rows);
```
Add the snapshot terminal resize directly after the `pty.get(...).resize(...)` line (before its `return`):
```ts
      terminalSnapshots.resize(req.payload.instanceId, req.payload.cols, req.payload.rows);
```

- [ ] **Step 5: Dispose on removal/kill (NOT on exit — crash escalation needs the buffer)**

In the `case 'removeInstance': {` handler, add alongside the existing cleanup (next to the `forgetSlackThread(...)` / `slackEscalator?.clear(...)` calls):
```ts
      terminalSnapshots.dispose(req.payload.instanceId);
```
In the `case 'killInstance':` handler, add:
```ts
      terminalSnapshots.dispose(req.payload.instanceId);
```
Read both handlers first to place these without breaking their existing return shape. Do NOT add a dispose in the pty `onExit` callback — a `crashed` instance must keep its buffer so the crash escalation can snapshot the last output.

- [ ] **Step 6: Rewrite `postSlack` to use the snapshot + formatter**

Replace the body of `postSlack` (and delete the now-unused `slackTextFor`) so it reads:
```ts
async function postSlack(instanceId: string, cwd: string, kind: 'waiting-permission' | 'idle-notify' | 'crashed'): Promise<void> {
  const cfg = readSlackConfig(new SettingsRepo(handle!.db));
  if (!cfg.enabled || !cfg.botToken || !cfg.dmUserId) return;
  try {
    const client: SlackClient = new WebApiSlackClient(cfg.botToken);
    if (!slackDmChannel) setSlackDmChannel(await client.openDm(cfg.dmUserId));
    const name = cwd.split('/').filter(Boolean).pop() || cwd;
    await terminalSnapshots.flush(instanceId);
    const text = formatEscalationMessage(name, kind, terminalSnapshots.snapshot(instanceId));
    const res = await client.postMessage(slackDmChannel!, text);
    slackThreadToInstance.set(res.ts, instanceId);
    slackInstanceToThread.set(instanceId, res.ts);
  } catch (err) {
    console.error('[slack] post failed', err);
  }
}
```
Then delete the `slackTextFor` function (it's no longer referenced). NOTE: `setSlackDmChannel` already exists from the Phase-2 fix; if the current code uses `slackDmChannel = await client.openDm(...)` directly, keep whichever form is present — the key change is replacing `slackTextFor(cwd, kind)` with the `flush` + `snapshot` + `formatEscalationMessage` sequence.

- [ ] **Step 7: Typecheck + full test run**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: clean (no unused `slackTextFor`; no errors).
Run: `npx vitest run`
Expected: all green (previous total + the new terminalSnapshots + escalationMessage tests).

- [ ] **Step 8: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat(slack): include on-screen prompt snapshot in escalation DMs"
```

---

### Task 5: Build + manual verification

**Files:** none (manual).

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: exits 0 (orchestrator bundles `@xterm/headless`; runs in Node with the shim).

- [ ] **Step 2: Manual smoke (requires the Slack app from earlier setup)**

With Slack enabled + a short escalate timer: start an instance, run something that triggers a permission prompt (e.g. a Bash command), blur the Watchtower window, wait for the timer. Confirm the DM now contains a fenced block showing the actual prompt + numbered options. Reply `1` (or the appropriate option) in the thread → confirm the session acts on it. Also trigger an idle/finished escalation and confirm it shows Claude's last message; verify a crash escalation shows the final output.

- [ ] **Step 3: Confirm the headless terminal doesn't leak**

Sanity: opening/closing several instances and removing them should `dispose` their terminals (no growth). This is covered structurally by Task 4 Step 5; no automated assertion.

---

## Self-Review Notes

- **Spec coverage:** headless-terminal capture (Task 2); `snapshot` contract — cleaned visible text, blank-trim, `''` for unknown id, no truncation (Task 2); `formatEscalationMessage` headers/hint/fence/empty-fallback/truncation/backtick-neutralization (Task 3); feed/resize/dispose/postSlack wiring (Task 4); dispose-not-on-exit so crash snapshots survive (Task 4 Step 5); dep (Task 1); tests, no network (Tasks 2–3). All covered.
- **Type consistency:** `EscalationKind` union (`escalationMessage.ts`) matches `postSlack`'s `kind` param and the `SlackEscalator` emit kinds. `TerminalSnapshots` method names (`feed`/`flush`/`resize`/`snapshot`/`dispose`) are used identically in Task 4. `setSlackDmChannel` referenced in Task 4 Step 6 exists from the Phase-2 fix (verify at execution).
- **Known risks (verify at execution):** (1) `@xterm/headless` import style + the `self` shim — Task 1 Step 2 and the Task 2 test validate the real import/parse path. (2) Exact placement of the `removeInstance`/`killInstance` dispose calls and that `postSlack` currently calls `setSlackDmChannel` vs. direct assignment — read the current code before editing.
