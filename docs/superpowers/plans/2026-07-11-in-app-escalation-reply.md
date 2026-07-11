# In-app escalation reply — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the removed Slack reply loop with an in-app reply on the iOS apps — the Mac relays escalation questions (+ terminal snapshot) to Supabase, iPhone / off-network iPad answer in a persistent per-instance thread, and the Mac injects the reply into the pty so work continues.

**Architecture:** A new Supabase table `attention_messages` is a lightweight message queue, independent of the 60 s TimeTracker sync. On escalation the orchestrator writes a `role='claude'` row (snapshot + parsed options) and fires the existing APNs nudge; the device writes a `role='user'` reply; an `AttentionRelay` service on the Mac polls its outbound pg connection and injects `text+'\r'` into the pty. Shared `data-supabase` hooks + a new `module-attention` UI package light up the bell/thread on both apps; connected iPad additionally offers "open in terminal" via an injected callback.

**Tech Stack:** TypeScript, Node `pg` (Postgres/Supabase), `@xterm/headless` snapshots, node-pty, React (plain, no MUI), `@supabase/supabase-js` (client, via `getSupabase()`), Capacitor push-notifications, vitest.

**Reference spec:** `docs/superpowers/specs/2026-07-11-in-app-escalation-reply-design.md`

## Global Constraints

- **Locale Czech; no i18n.** User-facing strings are Czech literals. Dates `D. M. YYYY`, numbers NBSP separator (`client/src/util/format.ts` helpers).
- **No MUI in `apps/ipad` / `apps/iphone` / shared UI packages** — plain React + inline `CSSProperties`, glass tokens from `@watchtower/ui-core` (`glassPanel`, `glassCard`, `glassFill`, `glassFillStrong`, `dataPanelFill`, `accent`, `text`, `BottomSheet`).
- **IPC contract discipline** — renderer never reaches SQLite directly; new kinds go in `packages/shared/src/ipcContract.ts` + mirror in `messagePort.ts` + handler in `orchestrator/index.ts`. (This feature adds no renderer↔orchestrator kinds; the relay is pg-direct. iPad token registration reuses the existing `push:registerDevice`.)
- **pg migrations are separate from SQLite migrations.** New pg table goes in `orchestrator/db/pg/schema.ts` `PG_MIGRATIONS` (currently v1–11 → add v12) + `runPgMigrations`. Do **not** touch `orchestrator/db/migrations.ts` (SQLite, v15) except to leave it as-is.
- **`attention_messages` is NOT added to `SYNCED_TABLES`** (`orchestrator/sync/schema.ts`). It is driven directly by the relay.
- **Backup convention** for any `~/.claude` file write does not apply here (no such writes).
- **Tests:** `npm test` (vitest, keep ≥219 green). `npx tsc -p orchestrator/tsconfig.json --noEmit` and `npm run typecheck:ci` must stay clean. pg-integration tests are gated on a throwaway DB at `WATCHTOWER_PG_URL` (dev pg is host **5433**, not 5432); pure-logic tests use fakes and always run.
- **Supabase client** is created lazily in `packages/data-supabase/src/supabaseClient.ts` via `getSupabase()`; URL from `VITE_SUPABASE_URL`, key from `VITE_SUPABASE_ANON_KEY`. Reuse it — do not construct a second client.
- **Feature is dormant when `pg == null`** (no hub configured). Every orchestrator entry point must no-op safely in that case.

---

## File Structure

**Phase A — pg schema**
- Modify: `orchestrator/db/pg/schema.ts` — add `PG_MIGRATIONS` v12 (table + indexes + RLS).
- Test: `tests/orchestrator/pgAttentionSchema.test.ts`

**Phase B — orchestrator relay**
- Create: `orchestrator/escalationMessage.ts` — `parseEscalation(snapshot)`.
- Create: `orchestrator/attentionRelay.ts` — `createAttentionRelay(deps)`.
- Create: `orchestrator/db/repositories/pgPushDevices.ts` — read iPhone tokens from pg.
- Modify: `orchestrator/index.ts` — `deliverReply` helper; wire relay into `onEscalate`; extend APNs `data`; feed pg tokens into `hubSender`; fast-path follow-up flag.
- Modify: `orchestrator/escalationGate.ts` — `markRemotelyEngaged` / fast-path.
- Modify: `orchestrator/hubSender.ts` — accept extra `data` fields + extra token source.
- Test: `tests/orchestrator/escalationMessage.test.ts`, `tests/orchestrator/attentionRelay.test.ts`, `tests/orchestrator/escalationGateFastPath.test.ts`

**Phase C — shared data hooks**
- Create: `packages/data-supabase/src/attentionCache.ts` — row mappers + Preferences cache keys.
- Create: `packages/data-supabase/src/useAttentionThreads.ts`
- Create: `packages/data-supabase/src/useAttentionReply.ts`
- Modify: `packages/data-supabase/src/index.ts` — exports.
- Test: `tests/data-supabase/attentionThreads.test.ts`, `tests/data-supabase/attentionReply.test.ts`

**Phase D — shared UI package**
- Create: `packages/module-attention/package.json`, `tsconfig.json`, `src/index.ts`
- Create: `packages/module-attention/src/types.ts` — `AttentionItem`, `AttentionThread`, `AttentionMessage`.
- Create: `packages/module-attention/src/NotificationHub.tsx`
- Create: `packages/module-attention/src/AttentionThreadDrawer.tsx`
- Create: `packages/module-attention/src/mergeAttention.ts` — merge/de-dupe logic.
- Modify: root `package.json` workspaces / `tsconfig` refs if needed.
- Test: `tests/module-attention/mergeAttention.test.ts`, `tests/module-attention/threadDrawer.test.tsx`

**Phase E — iPad integration**
- Modify: `apps/ipad/src/App.tsx` — use shared `NotificationHub` + `AttentionThreadDrawer`, merged source, pass `openInTerminal`.
- Delete: `apps/ipad/src/components/NotificationHub.tsx` (moved to package).
- Test: existing iPad tests updated; `tests/ipad/mergeSource.test.ts` if logic lands here.

**Phase F — iPhone integration**
- Modify: `apps/iphone/src/App.tsx` — add bell + hub + drawer, APNs registration.
- Create: `apps/iphone/src/registerPush.ts` — token → pg write via `getSupabase()`.
- Modify: `orchestrator/db/pg/schema.ts` — v12 already includes `push_devices` pg table (see Phase A).
- Test: `tests/iphone/registerPush.test.ts`

---

## Phase A — Supabase schema

### Task A1: `attention_messages` + pg `push_devices` migration (v12)

**Files:**
- Modify: `orchestrator/db/pg/schema.ts` (append to `PG_MIGRATIONS`)
- Test: `tests/orchestrator/pgAttentionSchema.test.ts`

**Interfaces:**
- Consumes: existing `PG_MIGRATIONS: Array<{version:number, up:string[]}>`, `runPgMigrations(store)`.
- Produces: pg tables `attention_messages`, `push_devices` (pg-side). Column contract used by all later phases:
  `attention_messages(id BIGSERIAL, sync_id TEXT UNIQUE, instance_id TEXT, project_label TEXT, role TEXT('claude'|'user'), kind TEXT, body TEXT, options JSONB, reply_to TEXT, injected_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, created_at TIMESTAMPTZ)`;
  `push_devices(apns_token TEXT UNIQUE, platform TEXT, registered_at TIMESTAMPTZ)`.

- [ ] **Step 1: Write the failing test** — `tests/orchestrator/pgAttentionSchema.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { PG_MIGRATIONS } from '../../orchestrator/db/pg/schema';

describe('pg migration v12', () => {
  const v12 = PG_MIGRATIONS.find(m => m.version === 12);
  it('exists and is the latest version', () => {
    expect(v12).toBeDefined();
    expect(Math.max(...PG_MIGRATIONS.map(m => m.version))).toBe(12);
  });
  it('creates attention_messages idempotently with RLS', () => {
    const sql = v12!.up.join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS attention_messages/);
    expect(sql).toMatch(/role\s+TEXT/);
    expect(sql).toMatch(/options\s+JSONB/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY[\s\S]*attention_messages[\s\S]*WITH CHECK \(role = 'user'\)/);
  });
  it('creates a pg-side push_devices table for iPhone tokens', () => {
    const sql = v12!.up.join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS push_devices/);
    expect(sql).toMatch(/apns_token\s+TEXT/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/pgAttentionSchema.test.ts`
Expected: FAIL — no migration with version 12.

- [ ] **Step 3: Append the migration** to `PG_MIGRATIONS` in `orchestrator/db/pg/schema.ts`

```ts
{
  version: 12,
  up: [
    `CREATE TABLE IF NOT EXISTS attention_messages (
       id            BIGSERIAL PRIMARY KEY,
       sync_id       TEXT UNIQUE NOT NULL,
       instance_id   TEXT NOT NULL,
       project_label TEXT,
       role          TEXT NOT NULL,
       kind          TEXT,
       body          TEXT,
       options       JSONB,
       reply_to      TEXT,
       injected_at   TIMESTAMPTZ,
       closed_at     TIMESTAMPTZ,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_attn_instance ON attention_messages(instance_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_attn_pending_user ON attention_messages(role, injected_at)
       WHERE role = 'user' AND injected_at IS NULL`,
    `ALTER TABLE attention_messages ENABLE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS attn_read ON attention_messages`,
    `CREATE POLICY attn_read ON attention_messages FOR SELECT TO authenticated USING (true)`,
    `DROP POLICY IF EXISTS attn_write ON attention_messages`,
    `CREATE POLICY attn_write ON attention_messages FOR INSERT TO authenticated WITH CHECK (role = 'user')`,
    `GRANT SELECT, INSERT ON attention_messages TO authenticated`,
    `GRANT USAGE, SELECT ON SEQUENCE attention_messages_id_seq TO authenticated`,
    `CREATE TABLE IF NOT EXISTS push_devices (
       id            BIGSERIAL PRIMARY KEY,
       apns_token    TEXT UNIQUE NOT NULL,
       platform      TEXT NOT NULL DEFAULT 'ios',
       registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    `ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS pushdev_write ON push_devices`,
    `CREATE POLICY pushdev_write ON push_devices FOR INSERT TO authenticated WITH CHECK (true)`,
    `GRANT INSERT ON push_devices TO authenticated`,
    `GRANT USAGE, SELECT ON SEQUENCE push_devices_id_seq TO authenticated`,
  ],
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/pgAttentionSchema.test.ts`
Expected: PASS.

- [ ] **Step 5: (optional, if a throwaway pg is available) apply against real pg**

Run: `WATCHTOWER_PG_URL=postgres://…@localhost:5433/wt_throwaway npx vitest run tests/orchestrator/pgMigrate*.test.ts` (whatever the existing pg-integration migration test is named — run the existing suite so v12 applies idempotently).
Expected: PASS (or skip if no pg URL).

- [ ] **Step 6: Commit**

```bash
git add orchestrator/db/pg/schema.ts tests/orchestrator/pgAttentionSchema.test.ts
git commit -m "feat(pg): attention_messages + pg push_devices (migration v12)"
```

---

## Phase B — orchestrator relay

### Task B1: `parseEscalation` — question + numbered options from a snapshot

**Files:**
- Create: `orchestrator/escalationMessage.ts`
- Test: `tests/orchestrator/escalationMessage.test.ts`

**Interfaces:**
- Produces: `export function parseEscalation(snapshot: string): { question: string; options: { number: number; label: string }[] }`

- [ ] **Step 1: Write the failing test** — `tests/orchestrator/escalationMessage.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/escalationMessage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `orchestrator/escalationMessage.ts`

```ts
// Parses a cleaned terminal snapshot into a question + numbered options.
// Ported (minus Slack Block Kit) from the removed formatEscalationMessage (fdf8370^).
const OPTION_RE = /^\s*[❯>*]?\s*(\d+)[.)]\s+(.*\S)\s*$/;

export function parseEscalation(snapshot: string): {
  question: string;
  options: { number: number; label: string }[];
} {
  const lines = snapshot.split('\n').map(l => l.replace(/\s+$/, ''));
  const options: { number: number; label: string }[] = [];
  let firstOptionIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = OPTION_RE.exec(lines[i]);
    if (m) {
      if (firstOptionIdx === -1) firstOptionIdx = i;
      options.push({ number: Number(m[1]), label: m[2].trim() });
    }
  }
  let question = '';
  if (firstOptionIdx > 0) {
    for (let i = firstOptionIdx - 1; i >= 0; i--) {
      if (lines[i].trim()) { question = lines[i].trim(); break; }
    }
  } else {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) { question = lines[i].trim(); break; }
    }
  }
  return { question, options };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/escalationMessage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/escalationMessage.ts tests/orchestrator/escalationMessage.test.ts
git commit -m "feat(orch): revive parseEscalation (question + numbered options)"
```

### Task B2: `AttentionRelay` — write claude rows, poll & inject user replies

**Files:**
- Create: `orchestrator/attentionRelay.ts`
- Test: `tests/orchestrator/attentionRelay.test.ts`

**Interfaces:**
- Consumes: `parseEscalation` (B1); a `PgStore`-like `{ query(sql, params?): Promise<{ rows: any[] }> }`.
- Produces:
  ```ts
  export interface AttentionRelayDeps {
    pg: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> } | null;
    getSnapshot(instanceId: string): Promise<string>;       // flush+snapshot
    deliverReply(instanceId: string, text: string): boolean; // pty inject
    resolveLabel(cwd: string): string;                       // project name
    newId(): string;                                         // uuid
    now(): string;                                           // ISO
  }
  export interface AttentionRelay {
    writeClaudeMessage(instanceId: string, cwd: string, kind: string): Promise<void>;
    pollOnce(): Promise<number>;   // returns # replies injected
    hasOutstanding(): Promise<boolean>;
    start(): void; stop(): void;   // adaptive 3s/30s loop, unref'd
    closeThread(instanceId: string): Promise<void>;
  }
  export function createAttentionRelay(deps: AttentionRelayDeps): AttentionRelay;
  ```

- [ ] **Step 1: Write the failing test** — `tests/orchestrator/attentionRelay.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { createAttentionRelay } from '../../orchestrator/attentionRelay';

function fakePg() {
  const inserts: any[] = [];
  const updates: any[] = [];
  let pending: any[] = [];
  return {
    inserts, updates, setPending: (r: any[]) => { pending = r; },
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO attention_messages/.test(sql)) { inserts.push(params); return { rows: [] }; }
      if (/SELECT[\s\S]*role = 'user' AND injected_at IS NULL/.test(sql)) return { rows: pending };
      if (/UPDATE attention_messages SET injected_at/.test(sql)) { updates.push(params); pending = []; return { rows: [] }; }
      if (/SELECT 1 FROM attention_messages[\s\S]*role = 'claude'/.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
  };
}

describe('AttentionRelay', () => {
  it('writeClaudeMessage inserts a parsed claude row', async () => {
    const pg = fakePg();
    const relay = createAttentionRelay({
      pg, getSnapshot: async () => 'Allow Bash(x)?\n1. Yes\n2. No',
      deliverReply: () => true, resolveLabel: () => 'watchtower',
      newId: () => 'uuid-1', now: () => '2026-07-11T00:00:00Z',
    });
    await relay.writeClaudeMessage('inst-1', '/repo/wt', 'waiting-permission');
    expect(pg.inserts.length).toBe(1);
    const params = pg.inserts[0] as any[];
    expect(params).toContain('inst-1');
    expect(params).toContain('watchtower');
    expect(params.some(p => typeof p === 'string' && p.includes('"number":1'))).toBe(true); // options JSON
  });

  it('pollOnce injects each pending user reply and stamps injected_at', async () => {
    const pg = fakePg();
    pg.setPending([{ sync_id: 'r1', instance_id: 'inst-1', body: '1' }]);
    const deliver = vi.fn(() => true);
    const relay = createAttentionRelay({
      pg, getSnapshot: async () => '', deliverReply: deliver,
      resolveLabel: () => 'x', newId: () => 'id', now: () => 'now',
    });
    const n = await relay.pollOnce();
    expect(n).toBe(1);
    expect(deliver).toHaveBeenCalledWith('inst-1', '1');
    expect(pg.updates.length).toBe(1);
  });

  it('is a no-op when pg is null', async () => {
    const relay = createAttentionRelay({
      pg: null, getSnapshot: async () => '', deliverReply: () => true,
      resolveLabel: () => 'x', newId: () => 'id', now: () => 'now',
    });
    await relay.writeClaudeMessage('i', '/c', 'crashed');
    expect(await relay.pollOnce()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/attentionRelay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `orchestrator/attentionRelay.ts`

```ts
import { parseEscalation } from './escalationMessage';

export interface AttentionRelayDeps {
  pg: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> } | null;
  getSnapshot(instanceId: string): Promise<string>;
  deliverReply(instanceId: string, text: string): boolean;
  resolveLabel(cwd: string): string;
  newId(): string;
  now(): string;
}
export interface AttentionRelay {
  writeClaudeMessage(instanceId: string, cwd: string, kind: string): Promise<void>;
  pollOnce(): Promise<number>;
  hasOutstanding(): Promise<boolean>;
  start(): void; stop(): void;
  closeThread(instanceId: string): Promise<void>;
}

const FAST_MS = 3_000;
const SLOW_MS = 30_000;

export function createAttentionRelay(deps: AttentionRelayDeps): AttentionRelay {
  let timer: NodeJS.Timeout | null = null;

  async function writeClaudeMessage(instanceId: string, cwd: string, kind: string) {
    if (!deps.pg) return;
    const snap = await deps.getSnapshot(instanceId);
    const { options } = parseEscalation(snap);
    await deps.pg.query(
      `INSERT INTO attention_messages
         (sync_id, instance_id, project_label, role, kind, body, options, created_at)
       VALUES ($1,$2,$3,'claude',$4,$5,$6::jsonb,$7)
       ON CONFLICT (sync_id) DO NOTHING`,
      [deps.newId(), instanceId, deps.resolveLabel(cwd), kind, snap, JSON.stringify(options), deps.now()],
    );
  }

  async function pollOnce(): Promise<number> {
    if (!deps.pg) return 0;
    const { rows } = await deps.pg.query(
      `SELECT sync_id, instance_id, body FROM attention_messages
       WHERE role = 'user' AND injected_at IS NULL ORDER BY created_at ASC`,
    );
    let injected = 0;
    for (const r of rows) {
      deps.deliverReply(r.instance_id, r.body ?? ''); // returns false if instance gone — still stamp
      await deps.pg.query(
        `UPDATE attention_messages SET injected_at = $1 WHERE sync_id = $2`,
        [deps.now(), r.sync_id],
      );
      injected++;
    }
    return injected;
  }

  async function hasOutstanding(): Promise<boolean> {
    if (!deps.pg) return false;
    const { rows } = await deps.pg.query(
      `SELECT 1 FROM attention_messages c
       WHERE c.role = 'claude' AND c.closed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM attention_messages u
                         WHERE u.role='user' AND u.reply_to = c.sync_id)
       LIMIT 1`,
    );
    return rows.length > 0;
  }

  async function closeThread(instanceId: string) {
    if (!deps.pg) return;
    await deps.pg.query(
      `UPDATE attention_messages SET closed_at = $1 WHERE instance_id = $2 AND closed_at IS NULL`,
      [deps.now(), instanceId],
    );
  }

  function schedule() {
    if (!deps.pg) return;
    const tick = async () => {
      let delay = SLOW_MS;
      try { await pollOnce(); delay = (await hasOutstanding()) ? FAST_MS : SLOW_MS; }
      catch { /* offline-tolerant */ }
      timer = setTimeout(tick, delay);
      if (timer.unref) timer.unref();
    };
    timer = setTimeout(tick, FAST_MS);
    if (timer.unref) timer.unref();
  }

  return {
    writeClaudeMessage, pollOnce, hasOutstanding, closeThread,
    start: () => { if (!timer) schedule(); },
    stop: () => { if (timer) { clearTimeout(timer); timer = null; } },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/attentionRelay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orchestrator/attentionRelay.ts tests/orchestrator/attentionRelay.test.ts
git commit -m "feat(orch): AttentionRelay — write claude rows, poll+inject user replies"
```

### Task B3: fast-path follow-ups in `EscalationGate`

**Files:**
- Modify: `orchestrator/escalationGate.ts`
- Test: `tests/orchestrator/escalationGateFastPath.test.ts`

**Interfaces:**
- Consumes: existing `EscalationGate` (`apply`, `setWindowFocused`, `onFire`).
- Produces: `markRemotelyEngaged(instanceId: string): void` on `EscalationGate`; when set and window unfocused, the next attention entry for that instance fires immediately (no `escalateMs`). Cleared by `setWindowFocused(true)`.

- [ ] **Step 1: Write the failing test** — `tests/orchestrator/escalationGateFastPath.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { EscalationGate } from '../../orchestrator/escalationGate';

const cfg = () => ({ escalateMs: 300_000, triggers: { permission: true, idle: true, crash: true }, armEnabled: true });

describe('EscalationGate fast-path follow-ups', () => {
  it('fires immediately for a remotely-engaged instance while unfocused', () => {
    const onFire = vi.fn();
    const gate = new EscalationGate(cfg, onFire);
    gate.setWindowFocused(false);
    gate.markRemotelyEngaged('i1');
    gate.apply('i1', '/c', 'working', 'waiting-permission');
    expect(onFire).toHaveBeenCalledWith('i1', '/c', 'waiting-permission'); // no timer wait
  });
  it('clears the remotely-engaged flag when the window regains focus', () => {
    const onFire = vi.fn();
    const gate = new EscalationGate(cfg, onFire);
    gate.setWindowFocused(false);
    gate.markRemotelyEngaged('i1');
    gate.setWindowFocused(true);
    gate.setWindowFocused(false);
    gate.apply('i1', '/c', 'working', 'waiting-permission');
    expect(onFire).not.toHaveBeenCalled(); // back to timer path
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/escalationGateFastPath.test.ts`
Expected: FAIL — `markRemotelyEngaged` is not a function.

- [ ] **Step 3: Implement** — add to `orchestrator/escalationGate.ts`

Add a `private engaged = new Set<string>();`. In `setWindowFocused(focused)`: `if (focused) this.engaged.clear();`. Add:
```ts
markRemotelyEngaged(instanceId: string) { this.engaged.add(instanceId); }
```
In `apply`, at the point where an attention entry currently arms the timer, insert before the `setTimeout`:
```ts
if (this.engaged.has(instanceId) && !this.windowFocused) {
  this.onFire(instanceId, cwd, next as EscalationKind);
  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/orchestrator/escalationGateFastPath.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing escalation-gate suite** to confirm no regression.

Run: `npx vitest run tests/orchestrator/escalationGate*.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add orchestrator/escalationGate.ts tests/orchestrator/escalationGateFastPath.test.ts
git commit -m "feat(orch): fast-path follow-up escalations for remotely-engaged instances"
```

### Task B4: pg push-device reader + `hubSender` token merge

**Files:**
- Create: `orchestrator/db/repositories/pgPushDevices.ts`
- Modify: `orchestrator/hubSender.ts`
- Test: `tests/orchestrator/pgPushDevices.test.ts`, `tests/orchestrator/hubSender.test.ts` (extend if present)

**Interfaces:**
- Produces: `export function readPgPushTokens(pg): Promise<string[]>` (returns `[]` when pg null).
- Modifies `createHubSender` deps: `listTokens` may now be async and return the union of SQLite + pg tokens; APNs `data` gains `kind`.

- [ ] **Step 1: Write the failing test** — `tests/orchestrator/pgPushDevices.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { readPgPushTokens } from '../../orchestrator/db/repositories/pgPushDevices';

describe('readPgPushTokens', () => {
  it('returns [] when pg is null', async () => {
    expect(await readPgPushTokens(null)).toEqual([]);
  });
  it('selects apns_token values', async () => {
    const pg = { query: vi.fn(async () => ({ rows: [{ apns_token: 'a' }, { apns_token: 'b' }] })) };
    expect(await readPgPushTokens(pg)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/orchestrator/pgPushDevices.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `orchestrator/db/repositories/pgPushDevices.ts`

```ts
export async function readPgPushTokens(
  pg: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> } | null,
): Promise<string[]> {
  if (!pg) return [];
  const { rows } = await pg.query(`SELECT apns_token FROM push_devices`);
  return rows.map(r => r.apns_token as string);
}
```

- [ ] **Step 4: Extend `hubSender.ts`** — make `listTokens` awaitable and include `kind` in `data`:

In `createHubSender`, change the token gather to `const tokens = await deps.listTokens();` and the send to `sendApns(cfg, token, { title, body, data: { instanceId, kind } })`. (The `kind` is already passed to `fire`.)

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/orchestrator/pgPushDevices.test.ts tests/orchestrator/hubSender.test.ts`
Expected: PASS (update the existing hubSender test's `listTokens` stub to be async and assert `data.kind` if that test exists).

- [ ] **Step 6: Commit**

```bash
git add orchestrator/db/repositories/pgPushDevices.ts orchestrator/hubSender.ts tests/orchestrator/pgPushDevices.test.ts tests/orchestrator/hubSender.test.ts
git commit -m "feat(orch): read iPhone push tokens from pg; APNs data carries kind"
```

### Task B5: wire the relay + `deliverReply` into `orchestrator/index.ts`

**Files:**
- Modify: `orchestrator/index.ts`

**Interfaces:**
- Consumes: `createAttentionRelay` (B2), `readPgPushTokens` (B4), `terminalSnapshots` (existing), `pty` (existing), `applyTransition` (existing), `pg` from bootstrap.
- Produces: `deliverReply(instanceId, text)` in module scope; relay started at init; `onEscalate` writes a claude row + marks engagement on reply.

- [ ] **Step 1: Add the `deliverReply` helper** near the other pty helpers:

```ts
function deliverReply(instanceId: string, text: string): boolean {
  const session = pty.get(instanceId);
  if (!session) return false;
  session.write(text + '\r');
  applyTransition(instanceId, { kind: 'userPromptSubmit' });
  return true;
}
```

- [ ] **Step 2: Construct the relay** in the api-ready init block, next to `hubSender`/`escalationGate` (~1262–1286):

```ts
const attentionRelay = createAttentionRelay({
  pg, // the PgStore from bootstrap (may be null)
  getSnapshot: async (id) => { await terminalSnapshots.flush(id); return terminalSnapshots.snapshot(id); },
  deliverReply,
  resolveLabel: (cwd) => projectNameForCwd(cwd) ?? cwd.split('/').pop() ?? 'instance',
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
});
attentionRelay.start();
```
(Use the existing project-name resolver; if none, the folder basename fallback shown is fine. Import `randomUUID` from `node:crypto`.)

- [ ] **Step 3: Extend `onEscalate`** to write the claude row and re-engage on reply. In the `onEscalate` callback that currently calls `hubSender.fire(...)`:

```ts
const onEscalate = (instanceId: string, cwd: string, kind: EscalationKind) => {
  void attentionRelay.writeClaudeMessage(instanceId, cwd, kind);
  void hubSender.fire(instanceId, cwd, kind);
};
```

- [ ] **Step 4: Mark remote engagement after an injected reply.** Wrap the relay's `deliverReply` usage so that a successful remote reply marks the gate:

Change the relay dep to a small local wrapper:
```ts
deliverReply: (id, text) => {
  const ok = deliverReply(id, text);
  if (ok) escalationGate?.markRemotelyEngaged(id);
  return ok;
},
```

- [ ] **Step 5: Close the thread on instance disposal.** Where instances are killed/exit (near the existing `terminalSnapshots.dispose` / `clearAttention`), add:
```ts
void attentionRelay.closeThread(instanceId);
```

- [ ] **Step 6: Feed pg tokens into hubSender.** Update the `hubSender` `listTokens` dep to merge sources:
```ts
listTokens: async () => {
  const local = new PushDevicesRepo(handle!.db).listTokens();
  const remote = await readPgPushTokens(pg);
  return Array.from(new Set([...local, ...remote]));
},
```

- [ ] **Step 7: Typecheck + run the orchestrator suite**

Run: `npx tsc -p orchestrator/tsconfig.json --noEmit && npx vitest run tests/orchestrator`
Expected: clean typecheck, PASS.

- [ ] **Step 8: Commit**

```bash
git add orchestrator/index.ts
git commit -m "feat(orch): wire AttentionRelay + deliverReply into escalation path"
```

---

## Phase C — shared data hooks (`packages/data-supabase`)

### Task C1: row mappers + cache keys

**Files:**
- Create: `packages/data-supabase/src/attentionCache.ts`
- Test: `tests/data-supabase/attentionThreads.test.ts` (mapper portion)

**Interfaces:**
- Produces:
  ```ts
  export interface AttentionMessage {
    syncId: string; instanceId: string; projectLabel: string | null;
    role: 'claude' | 'user'; kind: string | null; body: string | null;
    options: { number: number; label: string }[]; replyTo: string | null;
    injectedAt: string | null; closedAt: string | null; createdAt: string;
  }
  export interface AttentionThread {
    instanceId: string; label: string; kind: string | null;
    messages: AttentionMessage[]; unanswered: boolean; closed: boolean;
  }
  export function mapAttentionRow(row: any): AttentionMessage;
  export function groupThreads(rows: AttentionMessage[]): AttentionThread[];
  export const ATTENTION_CACHE_KEY = 'wt.attention.threads.v1';
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mapAttentionRow, groupThreads } from '../../packages/data-supabase/src/attentionCache';

describe('attention mappers', () => {
  it('maps snake_case row to camelCase, parsing options', () => {
    const m = mapAttentionRow({
      sync_id: 's1', instance_id: 'i1', project_label: 'wt', role: 'claude',
      kind: 'waiting-permission', body: 'Q?', options: [{ number: 1, label: 'Yes' }],
      reply_to: null, injected_at: null, closed_at: null, created_at: 't0',
    });
    expect(m.instanceId).toBe('i1');
    expect(m.options[0].label).toBe('Yes');
  });
  it('groups by instance, orders by createdAt, flags unanswered', () => {
    const rows = [
      mapAttentionRow({ sync_id: 'c1', instance_id: 'i1', project_label: 'wt', role: 'claude', kind: 'idle-notify', body: 'Q', options: [], reply_to: null, injected_at: null, closed_at: null, created_at: '1' }),
    ];
    const [t] = groupThreads(rows);
    expect(t.instanceId).toBe('i1');
    expect(t.label).toBe('wt');
    expect(t.unanswered).toBe(true);
  });
  it('marks answered when a user row replies to the latest claude row', () => {
    const rows = [
      mapAttentionRow({ sync_id: 'c1', instance_id: 'i1', project_label: 'wt', role: 'claude', kind: null, body: 'Q', options: [], reply_to: null, injected_at: null, closed_at: null, created_at: '1' }),
      mapAttentionRow({ sync_id: 'u1', instance_id: 'i1', project_label: 'wt', role: 'user', kind: null, body: '1', options: [], reply_to: 'c1', injected_at: 't', closed_at: null, created_at: '2' }),
    ];
    expect(groupThreads(rows)[0].unanswered).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/data-supabase/attentionThreads.test.ts` → FAIL.

- [ ] **Step 3: Implement** `attentionCache.ts`

```ts
export interface AttentionMessage {
  syncId: string; instanceId: string; projectLabel: string | null;
  role: 'claude' | 'user'; kind: string | null; body: string | null;
  options: { number: number; label: string }[]; replyTo: string | null;
  injectedAt: string | null; closedAt: string | null; createdAt: string;
}
export interface AttentionThread {
  instanceId: string; label: string; kind: string | null;
  messages: AttentionMessage[]; unanswered: boolean; closed: boolean;
}
export const ATTENTION_CACHE_KEY = 'wt.attention.threads.v1';

export function mapAttentionRow(row: any): AttentionMessage {
  return {
    syncId: row.sync_id, instanceId: row.instance_id, projectLabel: row.project_label ?? null,
    role: row.role, kind: row.kind ?? null, body: row.body ?? null,
    options: Array.isArray(row.options) ? row.options : (row.options ? JSON.parse(row.options) : []),
    replyTo: row.reply_to ?? null, injectedAt: row.injected_at ?? null,
    closedAt: row.closed_at ?? null, createdAt: row.created_at,
  };
}

export function groupThreads(rows: AttentionMessage[]): AttentionThread[] {
  const byId = new Map<string, AttentionMessage[]>();
  for (const m of rows) { (byId.get(m.instanceId) ?? byId.set(m.instanceId, []).get(m.instanceId)!).push(m); }
  const threads: AttentionThread[] = [];
  for (const [instanceId, msgs] of byId) {
    msgs.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    const claudeMsgs = msgs.filter(m => m.role === 'claude');
    const lastClaude = claudeMsgs[claudeMsgs.length - 1];
    const answered = lastClaude ? msgs.some(m => m.role === 'user' && m.replyTo === lastClaude.syncId) : true;
    const closed = !!lastClaude?.closedAt;
    threads.push({
      instanceId, label: msgs[0].projectLabel ?? instanceId, kind: lastClaude?.kind ?? null,
      messages: msgs, unanswered: !answered && !closed, closed,
    });
  }
  return threads;
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data-supabase/src/attentionCache.ts tests/data-supabase/attentionThreads.test.ts
git commit -m "feat(data): attention row mappers + thread grouping"
```

### Task C2: `useAttentionThreads` (SWR read + poll-while-open)

**Files:**
- Create: `packages/data-supabase/src/useAttentionThreads.ts`
- Modify: `packages/data-supabase/src/index.ts`
- Test: `tests/data-supabase/useAttentionThreads.test.ts`

**Interfaces:**
- Consumes: `getSupabase()`, `groupThreads`/`mapAttentionRow`/`ATTENTION_CACHE_KEY` (C1).
- Produces: `export function useAttentionThreads(opts?: { pollWhileOpen?: boolean }): { threads: AttentionThread[]; unansweredCount: number; refresh(): Promise<void>; state: 'loading'|'fresh'|'cached'|'offline' }`

- [ ] **Step 1: Write the failing test** (mock `getSupabase`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('../../packages/data-supabase/src/supabaseClient', () => ({ getSupabase: () => ({ from }) }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async () => ({ value: null }), set: async () => {} } }), { virtual: true });

import { renderHook, waitFor } from '@testing-library/react';
import { useAttentionThreads } from '../../packages/data-supabase/src/useAttentionThreads';

describe('useAttentionThreads', () => {
  beforeEach(() => from.mockReset());
  it('fetches, groups, and counts unanswered', async () => {
    from.mockReturnValue({
      select: () => ({ order: () => Promise.resolve({ data: [
        { sync_id: 'c1', instance_id: 'i1', project_label: 'wt', role: 'claude', kind: 'idle-notify', body: 'Q', options: [], reply_to: null, injected_at: null, closed_at: null, created_at: '1' },
      ], error: null }) }),
    });
    const { result } = renderHook(() => useAttentionThreads());
    await waitFor(() => expect(result.current.threads.length).toBe(1));
    expect(result.current.unansweredCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement** `useAttentionThreads.ts` following the `useBilling` SWR shape: load Preferences cache → set `cached`, fetch `getSupabase().from('attention_messages').select('*').order('created_at')` → `groupThreads` → `fresh`; on error → `offline` with cache. Expose `refresh()`. When `pollWhileOpen`, `setInterval(refresh, 5000)` in an effect, cleared on unmount. `unansweredCount = threads.filter(t => t.unanswered).length`.

- [ ] **Step 4: Add export** to `packages/data-supabase/src/index.ts`:
```ts
export { useAttentionThreads } from './useAttentionThreads';
export { mapAttentionRow, groupThreads } from './attentionCache';
export type { AttentionMessage, AttentionThread } from './attentionCache';
```

- [ ] **Step 5: Run test** — PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/data-supabase/src/useAttentionThreads.ts packages/data-supabase/src/index.ts tests/data-supabase/useAttentionThreads.test.ts
git commit -m "feat(data): useAttentionThreads (SWR read + poll-while-open)"
```

### Task C3: `useAttentionReply` (optimistic insert + double-send guard)

**Files:**
- Create: `packages/data-supabase/src/useAttentionReply.ts`
- Modify: `packages/data-supabase/src/index.ts`
- Test: `tests/data-supabase/attentionReply.test.ts`

**Interfaces:**
- Consumes: `getSupabase()`.
- Produces: `export function useAttentionReply(): { sendReply(instanceId: string, replyToSyncId: string, text: string): Promise<boolean>; pending: boolean; error: string | null }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
const insert = vi.fn(async () => ({ error: null }));
vi.mock('../../packages/data-supabase/src/supabaseClient', () => ({ getSupabase: () => ({ from: () => ({ insert }) }) }));
import { renderHook, act } from '@testing-library/react';
import { useAttentionReply } from '../../packages/data-supabase/src/useAttentionReply';

describe('useAttentionReply', () => {
  it('inserts a user row and reports success', async () => {
    const { result } = renderHook(() => useAttentionReply());
    let ok = false;
    await act(async () => { ok = await result.current.sendReply('i1', 'c1', '1'); });
    expect(ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ instance_id: 'i1', role: 'user', reply_to: 'c1', body: '1' }));
  });
  it('sets error and returns false on failure', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'x' } });
    const { result } = renderHook(() => useAttentionReply());
    let ok = true;
    await act(async () => { ok = await result.current.sendReply('i1', 'c1', 'no'); });
    expect(ok).toBe(false);
    expect(result.current.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** `useAttentionReply.ts`: `sendReply` guards `if (pending) return false;` sets `pending`, `crypto.randomUUID()` sync_id, `getSupabase().from('attention_messages').insert({ sync_id, instance_id, role:'user', reply_to, body:text, created_at:new Date().toISOString() })`; on error set Czech message `'Nepodařilo se odeslat odpověď.'` return false; finally clear pending.

- [ ] **Step 4: Add export** to index.ts: `export { useAttentionReply } from './useAttentionReply';`

- [ ] **Step 5: Run test** — PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/data-supabase/src/useAttentionReply.ts packages/data-supabase/src/index.ts tests/data-supabase/attentionReply.test.ts
git commit -m "feat(data): useAttentionReply (optimistic insert + double-send guard)"
```

---

## Phase D — shared UI package `packages/module-attention`

### Task D1: scaffold the package + merge logic

**Files:**
- Create: `packages/module-attention/package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts`, `src/mergeAttention.ts`
- Test: `tests/module-attention/mergeAttention.test.ts`

**Interfaces:**
- Consumes: `AttentionThread` (data-supabase).
- Produces:
  ```ts
  export interface BellItem { instanceId: string; label: string; kind: string | null; reason: string; hasThread: boolean; }
  export function mergeAttention(
    threads: AttentionThread[],
    liveItems: { instanceId: string; label: string; reason: string }[],
  ): BellItem[]; // thread items win; de-duped by instanceId; unanswered/live only
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mergeAttention } from '../../packages/module-attention/src/mergeAttention';

describe('mergeAttention', () => {
  it('dedupes by instanceId, thread item wins and is marked hasThread', () => {
    const merged = mergeAttention(
      [{ instanceId: 'i1', label: 'wt', kind: 'waiting-permission', messages: [], unanswered: true, closed: false }],
      [{ instanceId: 'i1', label: 'wt', reason: 'čeká na povolení' }, { instanceId: 'i2', label: 'x', reason: 'spadlo' }],
    );
    const i1 = merged.find(m => m.instanceId === 'i1')!;
    expect(i1.hasThread).toBe(true);
    expect(merged.find(m => m.instanceId === 'i2')!.hasThread).toBe(false);
    expect(merged.length).toBe(2);
  });
  it('excludes answered/closed threads', () => {
    const merged = mergeAttention(
      [{ instanceId: 'i1', label: 'wt', kind: null, messages: [], unanswered: false, closed: false }],
      [],
    );
    expect(merged.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Scaffold package.** `package.json`:
```json
{
  "name": "@watchtower/module-attention",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@watchtower/data-supabase": "*",
    "@watchtower/ui-core": "*",
    "@watchtower/shared": "*"
  },
  "peerDependencies": { "react": "*" }
}
```
`tsconfig.json`: copy from `packages/module-timetracker/tsconfig.json`. `src/index.ts`: re-export the three components + `mergeAttention` + types.

Implement `mergeAttention.ts`:
```ts
import type { AttentionThread } from '@watchtower/data-supabase';
export interface BellItem { instanceId: string; label: string; kind: string | null; reason: string; hasThread: boolean; }
const REASON: Record<string, string> = {
  'waiting-permission': 'čeká na povolení', 'idle-notify': 'čeká na vstup', 'crashed': 'spadlo',
};
export function mergeAttention(
  threads: AttentionThread[],
  liveItems: { instanceId: string; label: string; reason: string }[],
): BellItem[] {
  const out = new Map<string, BellItem>();
  for (const li of liveItems) out.set(li.instanceId, { instanceId: li.instanceId, label: li.label, kind: null, reason: li.reason, hasThread: false });
  for (const t of threads) {
    if (t.closed || !t.unanswered) { if (!out.has(t.instanceId)) continue; }
    if (!t.unanswered && !out.has(t.instanceId)) continue;
    out.set(t.instanceId, { instanceId: t.instanceId, label: t.label, kind: t.kind, reason: t.kind ? (REASON[t.kind] ?? 'čeká na vstup') : (out.get(t.instanceId)?.reason ?? 'čeká na vstup'), hasThread: t.unanswered });
  }
  return Array.from(out.values());
}
```

- [ ] **Step 4: Register the workspace.** Confirm root `package.json` `workspaces` already globs `packages/*` (it does per repo layout). Run `npm install` to link the new package.

Run: `npm install`
Expected: `@watchtower/module-attention` linked, no errors.

- [ ] **Step 5: Run test** — `npx vitest run tests/module-attention/mergeAttention.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/module-attention tests/module-attention/mergeAttention.test.ts package-lock.json
git commit -m "feat(module-attention): scaffold package + mergeAttention"
```

### Task D2: `NotificationHub` component (shared, presentational)

**Files:**
- Create: `packages/module-attention/src/NotificationHub.tsx`
- Test: `tests/module-attention/notificationHub.test.tsx`

**Interfaces:**
- Consumes: `BellItem` (D1), `glassPanel`/`glassCard`/`text`/`accent`/`glassFillStrong` from `@watchtower/ui-core`.
- Produces: `export function NotificationHub(props: { items: BellItem[]; onSelect(instanceId: string): void; onClose(): void }): JSX.Element` — the popover list; header per `kind` (permission amber `#f5a524`, idle accent, crash red); Czech header "Upozornění"; empty state "Žádná upozornění".

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationHub } from '../../packages/module-attention/src/NotificationHub';

describe('NotificationHub', () => {
  it('renders items and fires onSelect', () => {
    const onSelect = vi.fn();
    render(<NotificationHub items={[{ instanceId: 'i1', label: 'wt', kind: 'waiting-permission', reason: 'čeká na povolení', hasThread: true }]} onSelect={onSelect} onClose={() => {}} />);
    expect(screen.getByText(/wt/)).toBeTruthy();
    fireEvent.click(screen.getByText(/wt/));
    expect(onSelect).toHaveBeenCalledWith('i1');
  });
  it('shows the empty state', () => {
    render(<NotificationHub items={[]} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Žádná upozornění')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** `NotificationHub.tsx` — port `apps/ipad/src/components/NotificationHub.tsx` markup, replacing its `AttentionItem` type with `BellItem`, adding the per-`kind` glyph/color. Use inline styles + `glassPanel({ radius: 16 })` for the popover, `glassCard(10)` per row. Click-away scrim calls `onClose`.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/module-attention/src/NotificationHub.tsx tests/module-attention/notificationHub.test.tsx
git commit -m "feat(module-attention): shared NotificationHub popover"
```

### Task D3: `AttentionThreadDrawer` component

**Files:**
- Create: `packages/module-attention/src/AttentionThreadDrawer.tsx`
- Test: `tests/module-attention/threadDrawer.test.tsx`

**Interfaces:**
- Consumes: `AttentionThread`/`AttentionMessage` (data-supabase), `useAttentionReply` (data-supabase), `BottomSheet` + glass tokens (ui-core).
- Produces:
  ```ts
  export function AttentionThreadDrawer(props: {
    thread: AttentionThread;
    onClose(): void;
    openInTerminal?: (instanceId: string) => void; // present only on connected iPad
    anchor?: any; // BottomSheet SheetAnchor
  }): JSX.Element;
  ```
  Renders claude rows (monospace snapshot + option buttons) and user rows (bubbles); composer with option chips + free-text + Send (via `useAttentionReply`, disabled while `pending` or `thread.closed`); "Otevřít v terminálu" button only when `openInTerminal` is provided.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const sendReply = vi.fn(async () => true);
vi.mock('@watchtower/data-supabase', async (orig) => ({ ...(await orig() as any), useAttentionReply: () => ({ sendReply, pending: false, error: null }) }));
import { AttentionThreadDrawer } from '../../packages/module-attention/src/AttentionThreadDrawer';

const thread = {
  instanceId: 'i1', label: 'wt', kind: 'waiting-permission', unanswered: true, closed: false,
  messages: [{ syncId: 'c1', instanceId: 'i1', projectLabel: 'wt', role: 'claude', kind: 'waiting-permission', body: 'Allow X?', options: [{ number: 1, label: 'Yes' }], replyTo: null, injectedAt: null, closedAt: null, createdAt: '1' }],
} as any;

describe('AttentionThreadDrawer', () => {
  it('renders the snapshot and an option button; tapping an option sends its number', () => {
    render(<AttentionThreadDrawer thread={thread} onClose={() => {}} />);
    expect(screen.getByText(/Allow X\?/)).toBeTruthy();
    fireEvent.click(screen.getByText('Yes'));
    expect(sendReply).toHaveBeenCalledWith('i1', 'c1', '1');
  });
  it('renders "Otevřít v terminálu" only when openInTerminal is provided', () => {
    const open = vi.fn();
    const { rerender } = render(<AttentionThreadDrawer thread={thread} onClose={() => {}} />);
    expect(screen.queryByText('Otevřít v terminálu')).toBeNull();
    rerender(<AttentionThreadDrawer thread={thread} onClose={() => {}} openInTerminal={open} />);
    fireEvent.click(screen.getByText('Otevřít v terminálu'));
    expect(open).toHaveBeenCalledWith('i1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** `AttentionThreadDrawer.tsx` — wrap content in `BottomSheet`; map `thread.messages`: `role==='claude'` → snapshot block (`dataPanelFill`, monospace) + option buttons (`sendReply(instanceId, latestClaudeSyncId, String(number))`); `role==='user'` → gradient bubble. Composer: option chips for the latest claude row's options + `<textarea>` + Send (`sendReply(instanceId, latestClaudeSyncId, text)`), disabled when `pending`/`closed`. Optional "Otevřít v terminálu" button calling `openInTerminal(instanceId)`. Latest-claude sync id = last message with `role==='claude'`.

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Export** from `src/index.ts` and commit

```bash
git add packages/module-attention/src/AttentionThreadDrawer.tsx packages/module-attention/src/index.ts tests/module-attention/threadDrawer.test.tsx
git commit -m "feat(module-attention): AttentionThreadDrawer (snapshot + options + reply)"
```

---

## Phase E — iPad integration

### Task E1: swap iPad to the shared hub + drawer with merged source

**Files:**
- Modify: `apps/ipad/src/App.tsx`
- Delete: `apps/ipad/src/components/NotificationHub.tsx`
- Test: `tests/ipad/attentionIntegration.test.tsx` (light smoke) + update any test importing the old component.

**Interfaces:**
- Consumes: `useAttentionThreads` (data-supabase), `useAttentionInstances`/`useAttention` (existing iPad), `mergeAttention` + `NotificationHub` + `AttentionThreadDrawer` (module-attention), `useConnection` (bridge).
- Produces: nothing new exported; wires state in `Shell`.

- [ ] **Step 1: Write a smoke test** that `Shell` renders the shared hub when the bell is opened and that selecting a thread item opens the drawer. (Mock `useAttentionThreads` to return one unanswered thread; mock the bridge as connected.) Assert the drawer shows "Otevřít v terminálu" (connected iPad path).

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** in `Shell`:
```tsx
const { threads } = useAttentionThreads({ pollWhileOpen: hubOpen || !!openThreadId });
const live = useAttentionInstances(); // existing bridge-derived list → map to {instanceId,label,reason}
const bellItems = useMemo(() => mergeAttention(threads, live.map(l => ({ instanceId: l.instanceId, label: l.label, reason: l.reason }))), [threads, live]);
const openThread = threads.find(t => t.instanceId === openThreadId) ?? null;
const openInTerminal = (id: string) => { setActiveModule('instances'); selectInstance(id); setOpenThreadId(null); };
```
Render `<Rail notificationCount={bellItems.length} onOpenNotifications={() => setHubOpen(true)} />`. Replace the old `<NotificationHub>` with the shared one; `onSelect={(id) => { const t = threads.find(x=>x.instanceId===id); if (t) { setOpenThreadId(id); } else { openInTerminal(id); } setHubOpen(false); }}`. When `openThread`, render `<AttentionThreadDrawer thread={openThread} onClose={() => setOpenThreadId(null)} openInTerminal={status==='connected' ? openInTerminal : undefined} />`.

- [ ] **Step 4: Delete** `apps/ipad/src/components/NotificationHub.tsx` and fix imports.

- [ ] **Step 5: Typecheck + test**

Run: `npx tsc -p client/tsconfig.json --noEmit || true` (note pre-existing drift; ensure no NEW errors) and `npx vitest run tests/ipad`
Expected: iPad tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/ipad/src/App.tsx tests/ipad/attentionIntegration.test.tsx
git rm apps/ipad/src/components/NotificationHub.tsx
git commit -m "feat(ipad): shared attention hub + reply drawer (merged source)"
```

---

## Phase F — iPhone integration

### Task F1: iPhone push registration → pg `push_devices`

**Files:**
- Create: `apps/iphone/src/registerPush.ts`
- Test: `tests/iphone/registerPush.test.ts`

**Interfaces:**
- Consumes: `getSupabase()`, `@capacitor/push-notifications`.
- Produces: `export async function registerPush(): Promise<void>` — requests permission, registers, on `registration` writes the token to pg `push_devices` (`insert ... on conflict do nothing` via `upsert`).

- [ ] **Step 1: Write the failing test** (mock the Capacitor plugin + supabase):

```ts
import { describe, it, expect, vi } from 'vitest';
const upsert = vi.fn(async () => ({ error: null }));
vi.mock('@watchtower/data-supabase', () => ({ getSupabase: () => ({ from: () => ({ upsert }) }) }));
const listeners: Record<string, Function> = {};
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  requestPermissions: async () => ({ receive: 'granted' }),
  register: async () => { listeners['registration']?.({ value: 'tok-123' }); },
  addListener: (ev: string, cb: Function) => { listeners[ev] = cb; return { remove() {} }; },
} }), { virtual: true });
import { registerPush } from '../../apps/iphone/src/registerPush';

describe('registerPush', () => {
  it('writes the APNs token to pg push_devices', async () => {
    await registerPush();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ apns_token: 'tok-123', platform: 'ios' }), expect.anything());
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** `registerPush.ts`:
```ts
import { PushNotifications } from '@capacitor/push-notifications';
import { getSupabase } from '@watchtower/data-supabase';

export async function registerPush(): Promise<void> {
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;
  PushNotifications.addListener('registration', async (t: { value: string }) => {
    await getSupabase().from('push_devices').upsert({ apns_token: t.value, platform: 'ios' }, { onConflict: 'apns_token' });
  });
  await PushNotifications.register();
}
```

- [ ] **Step 4: Run test** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/iphone/src/registerPush.ts tests/iphone/registerPush.test.ts
git commit -m "feat(iphone): register APNs token into pg push_devices"
```

### Task F2: iPhone bell + hub + drawer

**Files:**
- Modify: `apps/iphone/src/App.tsx`
- Test: `tests/iphone/attentionUi.test.tsx`

**Interfaces:**
- Consumes: `useAttentionThreads` (data-supabase), `NotificationHub`/`AttentionThreadDrawer`/`mergeAttention` (module-attention). No bridge → no `openInTerminal`, no live items.

- [ ] **Step 1: Write the failing test** — mock `useAttentionThreads` to return one unanswered thread; assert a bell badge shows "1", tapping opens the hub, selecting opens the drawer WITHOUT "Otevřít v terminálu".

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — in the iPhone `Shell` header, add a bell button (inline SVG, matching the zero-MUI convention) with a badge = `bellItems.length`. `const { threads } = useAttentionThreads({ pollWhileOpen: hubOpen || !!openThreadId });` `const bellItems = mergeAttention(threads, []);`. On tap → `NotificationHub` (full-screen on narrow via its own scrim). On select → `setOpenThreadId(id)`. Render `AttentionThreadDrawer` with **no** `openInTerminal`. Call `registerPush()` once in an effect after auth (`useSupabaseAuth` session present).

- [ ] **Step 4: Typecheck + test**

Run: `npm run typecheck:ci && npx vitest run tests/iphone`
Expected: clean, PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/iphone/src/App.tsx tests/iphone/attentionUi.test.tsx
git commit -m "feat(iphone): attention bell + reply drawer + push registration"
```

---

## Phase G — full verification

### Task G1: full suite + typecheck + manual smoke

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green, count ≥ 219 + the new tests.

- [ ] **Step 2: Typechecks**

Run: `npm run typecheck:ci` and `npx tsc -p orchestrator/tsconfig.json --noEmit`
Expected: clean (no NEW client drift beyond the documented pre-existing items).

- [ ] **Step 3: pg-integration (if throwaway pg available)**

Run the pg-gated suite with `WATCHTOWER_PG_URL` pointed at a throwaway DB on 5433; confirm migration v12 applies and a round-trip insert/select on `attention_messages` works.

- [ ] **Step 4: Manual smoke (dev app)** — per `verify` skill / the worktree native-rebuild note:
  1. `npm run electron:rebuild` (worktree ABI), launch dev app with `WATCHTOWER_WS_HOST=127.0.0.1 WATCHTOWER_WS_PORT=7455` and a dev `WATCHTOWER_PG_URL`.
  2. Drive an instance into a permission prompt, blur the Mac window, wait for the escalation → confirm a `claude` row appears in Supabase and (if a device is registered) an APNs push arrives.
  3. From the iOS app (or by inserting a `user` row via the Supabase console as a stand-in), confirm the Mac injects the reply into the pty and the instance continues; `injected_at` gets stamped.

- [ ] **Step 5: Open the PR** (do not merge). Summarize: replaces Slack reply with in-app iOS reply over Supabase; iPad keeps terminal path; iPhone gains bell + push for the first time.

---

## Self-Review notes (author)

- **Spec coverage:** §3 relay → B2/B5/C; §4.1 schema → A1; §4.2 orchestrator (parseEscalation/relay/deliverReply/fast-path/APNs/pg tokens) → B1–B5; §4.3 hooks → C2/C3; §4.4 UI → D2/D3 + merge D1; §4.5 app integration → E1/F2; §5 edge cases → covered in B2 (instance-gone stamps injected_at + closeThread), C3 (double-send), D3 (closed disables composer), pg-null no-ops throughout; §6 testing → each task is TDD; §8 resolved decisions → pg push_devices (A1/B4/F1), merge (D1/E1), fast-path (B3), retention (see below).
- **Retention (decision 4):** add a prune of `attention_messages WHERE closed_at < now()-'14 days'` to the existing daily purge in `orchestrator/sync/purge.ts` — folded into Task B5 Step 5 area; if the purge file is separate, add one line there. *(Implementer: add the DELETE alongside the tombstone purge; it is pg-direct and guarded on `pg != null`.)*
- **Type consistency:** `deliverReply(instanceId, text): boolean`, `writeClaudeMessage(instanceId, cwd, kind)`, `sendReply(instanceId, replyToSyncId, text)`, `mergeAttention(threads, liveItems)`, `BellItem`, `AttentionThread`/`AttentionMessage` used consistently across B/C/D/E/F.
