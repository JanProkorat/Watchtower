# iPad Write-back Slice 1 (Time-off) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the iPad **Volno** (time-off) view editable, and build the reusable online-direct write foundation (Supabase write RLS + write helpers + optimistic cache patch) that later write-back slices reuse.

**Architecture:** Online-direct writes (write to Supabase when online; disabled offline), single-user LWW via `updated_at`, soft-delete via `deleted_at`. New pure payload-shaping + optimistic-reducer functions; a client-wired mutation hook; the R3 `TimeOffView` gains tap-to-edit. `days_off` only (no derived fields).

**Tech Stack:** TypeScript, React (apps/ipad, no MUI), `@supabase/supabase-js` (authenticated), `@watchtower/shared`, vitest (logic-only; client injected/mocked).

**Spec:** `docs/superpowers/specs/2026-06-28-ipad-writeback-s1-timeoff-design.md`

## Global Constraints

- **Online-direct, no offline outbox.** Edit controls disabled when `useBilling` state is `offline`/`cached`.
- **Soft-delete only** (`deleted_at = now`); never a hard `DELETE`. Every write stamps `updated_at = now` (ISO).
- **CZK-only world** (post-#108); `days_off` has no derived fields.
- **RLS scoped to `days_off`** in this slice; mirror the v4 read-policy pattern (idempotent, `authenticated`-role-guarded). Next free migration version is **v6** (v5 = #108 column drops).
- **Optimistic cache patch**, not full refetch; roll back on write error.
- **apps/ipad:** plain React + inline styles, no MUI; cs-CZ; no i18n. **No toast in the iPad app** — surface write errors via inline view state.
- **`@watchtower/shared` is `packages/shared/`**; run `npx tsc -b packages/shared/tsconfig.json` after editing types. CI now typechecks the whole monorepo incl. desktop — keep the branch rebased on main.
- **Logic-only tests**; Supabase client injected (never hit live). UI via typecheck.
- Never edit `.env*`. Branch `feat/120-writeback-timeoff` (spec already committed there). Commit with explicit `git add <paths>` — never `-A` (unrelated untracked files exist).

## File Structure

- `orchestrator/db/pg/schema.ts` (modify) — `PG_MIGRATIONS` v6: `days_off` write policy.
- `packages/shared/src/billing/types.ts` (modify) — `DayOffRow.syncId`.
- `apps/ipad/src/state/billingCache.ts` (modify) — `RawDayOffRow` + `mapDayOffRow`.
- `apps/ipad/src/state/useBilling.ts` (modify) — select `sync_id`, use `mapDayOffRow`, expose `patchDaysOff`.
- `apps/ipad/src/state/billingWrites.ts` (new) — pure shapers + optimistic reducer + offline gate.
- `apps/ipad/src/state/useDaysOffMutations.ts` (new) — client-wired hook.
- `apps/ipad/src/components/billing/records/TimeOffView.tsx` (modify) — editable interaction.

**Tests:** `tests/orchestrator/pgMigrations.writeback.test.ts`; extend `tests/ipad/billingCache.test.ts`; `tests/ipad/billingWrites.test.ts`.

---

## Task 1: PG migration v6 — `days_off` write RLS

**Files:**
- Modify: `orchestrator/db/pg/schema.ts`
- Test: `tests/orchestrator/pgMigrations.writeback.test.ts`

**Interfaces:**
- Produces: a `PG_MIGRATIONS` entry `{ version: 6, up: [...] }` adding `write_authenticated` on `days_off`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/pgMigrations.writeback.test.ts
import { describe, it, expect } from 'vitest';
import { PG_MIGRATIONS } from '../../orchestrator/db/pg/schema.js';

describe('PG_MIGRATIONS v6 — days_off write policy', () => {
  it('adds a version-6 migration', () => {
    const v6 = PG_MIGRATIONS.find((m) => m.version === 6);
    expect(v6).toBeDefined();
  });

  it('creates a guarded write_authenticated policy for days_off (FOR ALL)', () => {
    const sql = PG_MIGRATIONS.find((m) => m.version === 6)!.up.join('\n');
    expect(sql).toContain('days_off');
    expect(sql).toContain('write_authenticated');
    expect(sql).toContain('FOR ALL TO authenticated');
    // idempotent + role-guarded, mirroring v4
    expect(sql).toContain('DROP POLICY IF EXISTS write_authenticated ON days_off');
    expect(sql).toContain("rolname = 'authenticated'");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run tests/orchestrator/pgMigrations.writeback.test.ts` (no v6).

- [ ] **Step 3: Implement** — add to the `PG_MIGRATIONS` array in `orchestrator/db/pg/schema.ts`, after the `version: 5` entry (before the closing `];`):

```ts
  {
    version: 6,
    up: [
      // Write-back slice 1: allow authenticated INSERT/UPDATE on days_off (soft-delete
      // is an UPDATE). Mirrors the v4 read policy: idempotent + role-guarded so plain
      // Postgres (dev/test, no `authenticated` role) still applies cleanly.
      `ALTER TABLE days_off ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS write_authenticated ON days_off;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY write_authenticated ON days_off FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;`,
    ],
  },
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add orchestrator/db/pg/schema.ts tests/orchestrator/pgMigrations.writeback.test.ts
git commit -m "feat(writeback-s1): PG v6 days_off write RLS policy"
```

---

## Task 2: `DayOffRow.syncId` + read it on pull

**Files:**
- Modify: `packages/shared/src/billing/types.ts`, `apps/ipad/src/state/billingCache.ts`, `apps/ipad/src/state/useBilling.ts`
- Test: `tests/ipad/billingCache.test.ts` (extend)

**Interfaces:**
- Produces: `DayOffRow.syncId: string`; `mapDayOffRow(raw): DayOffRow`; `useBilling().patchDaysOff(next: DayOffRow[])`.

- [ ] **Step 1: Write the failing test** (append to `tests/ipad/billingCache.test.ts`)

```ts
import { mapDayOffRow } from '../../apps/ipad/src/state/billingCache.js';

describe('mapDayOffRow', () => {
  it('maps date, kind, and sync_id', () => {
    expect(mapDayOffRow({ date: '2026-07-06', kind: 'vacation', sync_id: 'abc' } as never))
      .toEqual({ date: '2026-07-06', kind: 'vacation', syncId: 'abc' });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run tests/ipad/billingCache.test.ts` (mapDayOffRow not exported).

- [ ] **Step 3: Implement**

`packages/shared/src/billing/types.ts` — add to `DayOffRow`:
```ts
export interface DayOffRow { date: string; kind: string; syncId: string }
```

`apps/ipad/src/state/billingCache.ts` — add a typed raw shape + mapper (mirrors `mapWorklogRow`):
```ts
export type RawDayOffRow = { date: string; kind: string; sync_id: string };

export function mapDayOffRow(raw: RawDayOffRow): DayOffRow {
  return { date: raw.date, kind: raw.kind, syncId: raw.sync_id };
}
```
(Ensure `DayOffRow` is imported in billingCache.ts — it already imports the billing types.)

`apps/ipad/src/state/useBilling.ts`:
- Change the days_off select to include `sync_id`:
```ts
    supabase.from('days_off').select('date,kind,sync_id').is('deleted_at', null),
```
- Replace the inline daysOff map with `mapDayOffRow` (import it from `./billingCache.js`):
```ts
  const daysOff: DayOffRow[] = (daysOffResult.data ?? []).map((r) => mapDayOffRow(r as RawDayOffRow));
```
- Add a `patchDaysOff` to the hook result. In the reducer state the dataset is `bState.data`; add an action + a callback:
```ts
// in BillingAction union:
  | { type: 'PATCH_DAYS_OFF'; daysOff: DayOffRow[] }
// in billingReducer:
    case 'PATCH_DAYS_OFF':
      return prev.data ? { ...prev, data: { ...prev.data, daysOff: action.daysOff } } : prev;
// in useBilling, expose:
  const patchDaysOff = useCallback((next: DayOffRow[]) => dispatch({ type: 'PATCH_DAYS_OFF', daysOff: next }), [dispatch]);
  return { data: bState.data, state: bState.state, lastUpdated: bState.lastUpdated, refresh, patchDaysOff };
```
Add `patchDaysOff(next: DayOffRow[]): void` to `BillingHookResult`. (Import `RawDayOffRow`, `mapDayOffRow` from `./billingCache.js`.)

- [ ] **Step 4: Run it, expect PASS** (`tests/ipad/billingCache.test.ts`), then build shared: `npx tsc -b packages/shared/tsconfig.json`, then `npx tsc -p apps/ipad/tsconfig.json --noEmit` (no new errors). NOTE: adding `syncId` to `DayOffRow` may surface usages — `buildTimeOffModel`/R3 read only `date`/`kind`, so they're unaffected, but confirm the iPad typecheck is clean.

- [ ] **Step 5: Commit**

```bash
npx tsc -b packages/shared/tsconfig.json
git add packages/shared/src/billing/types.ts apps/ipad/src/state/billingCache.ts apps/ipad/src/state/useBilling.ts tests/ipad/billingCache.test.ts
git commit -m "feat(writeback-s1): sync days_off sync_id + useBilling.patchDaysOff"
```

---

## Task 3: Pure write shapers + optimistic reducer + offline gate

**Files:**
- Create: `apps/ipad/src/state/billingWrites.ts`
- Test: `tests/ipad/billingWrites.test.ts`

**Interfaces:**
- Consumes: `DayOffRow` from `@watchtower/shared/billing/types.js`; `BillingState` from `./useBilling.js`.
- Produces:
  - `interface DayOffUpsertRow { sync_id: string; date: string; kind: string; note: null; deleted_at: null; updated_at: string }`
  - `buildDayOffUpsert(date, kind, opts: { syncId: string; now: string }): DayOffUpsertRow`
  - `buildDayOffDelete(now: string): { deleted_at: string; updated_at: string }`
  - `applyDayOffWrite(daysOff: DayOffRow[], change: { type: 'set'; row: DayOffRow } | { type: 'clear'; date: string }): DayOffRow[]`
  - `canEdit(state: BillingState): boolean` (only `'fresh'` is editable).

- [ ] **Step 1: Write the failing test**

```ts
// tests/ipad/billingWrites.test.ts
import { describe, it, expect } from 'vitest';
import { buildDayOffUpsert, buildDayOffDelete, applyDayOffWrite, canEdit } from '../../apps/ipad/src/state/billingWrites.js';
import type { DayOffRow } from '@watchtower/shared/billing/types.js';

describe('buildDayOffUpsert', () => {
  it('shapes a full upsert row with tombstone cleared + stamped updated_at', () => {
    expect(buildDayOffUpsert('2026-07-06', 'sick', { syncId: 's1', now: '2026-06-28T10:00:00.000Z' })).toEqual({
      sync_id: 's1', date: '2026-07-06', kind: 'sick', note: null, deleted_at: null, updated_at: '2026-06-28T10:00:00.000Z',
    });
  });
});

describe('buildDayOffDelete', () => {
  it('soft-deletes by stamping deleted_at + updated_at', () => {
    expect(buildDayOffDelete('2026-06-28T10:00:00.000Z')).toEqual({
      deleted_at: '2026-06-28T10:00:00.000Z', updated_at: '2026-06-28T10:00:00.000Z',
    });
  });
});

describe('applyDayOffWrite', () => {
  const base: DayOffRow[] = [{ date: '2026-07-06', kind: 'vacation', syncId: 's1' }];
  it('replaces the kind of an existing date on set', () => {
    expect(applyDayOffWrite(base, { type: 'set', row: { date: '2026-07-06', kind: 'sick', syncId: 's1' } }))
      .toEqual([{ date: '2026-07-06', kind: 'sick', syncId: 's1' }]);
  });
  it('adds a new date on set, sorted is not required', () => {
    const out = applyDayOffWrite(base, { type: 'set', row: { date: '2026-07-08', kind: 'other', syncId: 's2' } });
    expect(out).toHaveLength(2);
    expect(out.find((d) => d.date === '2026-07-08')?.kind).toBe('other');
  });
  it('removes the date on clear', () => {
    expect(applyDayOffWrite(base, { type: 'clear', date: '2026-07-06' })).toEqual([]);
  });
});

describe('canEdit', () => {
  it('only fresh state is editable', () => {
    expect(canEdit('fresh')).toBe(true);
    expect(canEdit('cached')).toBe(false);
    expect(canEdit('offline')).toBe(false);
    expect(canEdit('loading')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/ipad/src/state/billingWrites.ts
import type { DayOffRow } from '@watchtower/shared/billing/types.js';
import type { BillingState } from './useBilling.js';

export interface DayOffUpsertRow {
  sync_id: string;
  date: string;
  kind: string;
  note: null;
  deleted_at: null;
  updated_at: string;
}

export function buildDayOffUpsert(
  date: string,
  kind: string,
  opts: { syncId: string; now: string },
): DayOffUpsertRow {
  return { sync_id: opts.syncId, date, kind, note: null, deleted_at: null, updated_at: opts.now };
}

export function buildDayOffDelete(now: string): { deleted_at: string; updated_at: string } {
  return { deleted_at: now, updated_at: now };
}

export type DayOffChange =
  | { type: 'set'; row: DayOffRow }
  | { type: 'clear'; date: string };

export function applyDayOffWrite(daysOff: DayOffRow[], change: DayOffChange): DayOffRow[] {
  if (change.type === 'clear') {
    return daysOff.filter((d) => d.date !== change.date);
  }
  const without = daysOff.filter((d) => d.date !== change.row.date);
  return [...without, change.row];
}

/** Online-direct: only a fresh (live) dataset is editable; offline/cached/loading is read-only. */
export function canEdit(state: BillingState): boolean {
  return state === 'fresh';
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/ipad/src/state/billingWrites.ts tests/ipad/billingWrites.test.ts
git commit -m "feat(writeback-s1): pure day-off write shapers + optimistic reducer + offline gate"
```

---

## Task 4: `useDaysOffMutations` hook (client-wired)

**Files:**
- Create: `apps/ipad/src/state/useDaysOffMutations.ts`

**Interfaces:**
- Consumes: `getSupabase` (`../lib/supabaseClient.js`); `buildDayOffUpsert`/`buildDayOffDelete`/`applyDayOffWrite` (`./billingWrites.js`); `DayOffRow` type; a `patchDaysOff` + current `daysOff` passed in (from `useBilling`).
- Produces: `useDaysOffMutations({ daysOff, patchDaysOff }) → { setDayOff(date, kind), clearDayOff(date), pending, error }`.

The hook owns impure bits (`crypto.randomUUID()`, `new Date().toISOString()`, the Supabase call). Optimistic: patch first, write, roll back + set `error` on failure.

- [ ] **Step 1: Implement**

```ts
// apps/ipad/src/state/useDaysOffMutations.ts
import { useState, useCallback } from 'react';
import { getSupabase } from '../lib/supabaseClient.js';
import type { DayOffRow } from '@watchtower/shared/billing/types.js';
import { buildDayOffUpsert, buildDayOffDelete, applyDayOffWrite } from './billingWrites.js';

interface Args {
  daysOff: DayOffRow[];
  patchDaysOff(next: DayOffRow[]): void;
}

export function useDaysOffMutations({ daysOff, patchDaysOff }: Args) {
  const [pending, setPending] = useState<string | null>(null); // date being written
  const [error, setError] = useState<string | null>(null);

  const setDayOff = useCallback(
    async (date: string, kind: string) => {
      const prev = daysOff;
      const existing = prev.find((d) => d.date === date);
      const syncId = existing?.syncId ?? crypto.randomUUID();
      const now = new Date().toISOString();
      const row: DayOffRow = { date, kind, syncId };
      setError(null);
      setPending(date);
      patchDaysOff(applyDayOffWrite(prev, { type: 'set', row })); // optimistic
      try {
        const { error: e } = await getSupabase()
          .from('days_off')
          .upsert(buildDayOffUpsert(date, kind, { syncId, now }), { onConflict: 'date' });
        if (e) throw e;
      } catch (err) {
        patchDaysOff(prev); // rollback
        setError(err instanceof Error ? err.message : 'Uložení selhalo');
      } finally {
        setPending(null);
      }
    },
    [daysOff, patchDaysOff],
  );

  const clearDayOff = useCallback(
    async (date: string) => {
      const prev = daysOff;
      const now = new Date().toISOString();
      setError(null);
      setPending(date);
      patchDaysOff(applyDayOffWrite(prev, { type: 'clear', date })); // optimistic
      try {
        const { error: e } = await getSupabase()
          .from('days_off')
          .update(buildDayOffDelete(now))
          .eq('date', date);
        if (e) throw e;
      } catch (err) {
        patchDaysOff(prev); // rollback
        setError(err instanceof Error ? err.message : 'Smazání selhalo');
      } finally {
        setPending(null);
      }
    },
    [daysOff, patchDaysOff],
  );

  return { setDayOff, clearDayOff, pending, error };
}
```

- [ ] **Step 2: Typecheck** — `npx tsc -p apps/ipad/tsconfig.json --noEmit` (no new errors in `useDaysOffMutations.ts`). If `getSupabase().from(...).upsert/update` types complain, confirm the client is the `@supabase/supabase-js` instance from `supabaseClient.ts` (same one R1 reads use).

- [ ] **Step 3: Commit**

```bash
git add apps/ipad/src/state/useDaysOffMutations.ts
git commit -m "feat(writeback-s1): useDaysOffMutations (optimistic online-direct writes)"
```

---

## Task 5: Make `TimeOffView` editable + final verification

**Files:**
- Modify: `apps/ipad/src/components/billing/records/TimeOffView.tsx`

**Interfaces:**
- Consumes: `useBilling` (now with `patchDaysOff`), `useDaysOffMutations`, `canEdit` (`../../../state/billingWrites.js`).

Wire editing into the existing R3 calendar: when `canEdit(state)`, tapping a day opens an inline kind picker; pick a kind → `setDayOff`, *Smazat* → `clearDayOff`. When not editable, the calendar stays display-only with a hint. Show a small saving/error line from `pending`/`error`.

- [ ] **Step 1: Implement the edits**

In `TimeOffView.tsx`:
1. Pull state + patch from `useBilling`, and wire mutations:
```tsx
import { useState } from 'react';
import { useDaysOffMutations } from '../../../state/useDaysOffMutations.js';
import { canEdit } from '../../../state/billingWrites.js';
// inside component, after `const { data } = useBilling();`:
  const { data, state, patchDaysOff } = useBilling();
  const editable = canEdit(state);
  const { setDayOff, clearDayOff, pending, error } = useDaysOffMutations({
    daysOff: data?.daysOff ?? [],
    patchDaysOff,
  });
  const [picker, setPicker] = useState<string | null>(null); // date whose picker is open
```
2. Make day cells tappable when `editable`: add `onClick={() => editable && cell.date && setPicker(cell.date)}` and `cursor: editable && cell.date ? 'pointer' : 'default'` to the cell `<div>`. (Public-holiday cells are tappable too — adding a user day-off there is allowed.)
3. Render an inline kind picker when `picker` is set (a small absolutely-positioned panel or a simple row under the calendar):
```tsx
{picker && (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 16px', borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
    <span style={{ fontSize: 13, color: C.muted }}>{picker}:</span>
    {(['vacation', 'sick', 'other'] as const).map((k) => (
      <button key={k} onClick={() => { void setDayOff(picker, k); setPicker(null); }}
        style={{ background: KIND_COLOR[k], color: '#0F0F17', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        {KIND_LABEL[k]}
      </button>
    ))}
    <button onClick={() => { void clearDayOff(picker); setPicker(null); }}
      style={{ background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, padding: '5px 12px', fontSize: 13, cursor: 'pointer' }}>
      Smazat
    </button>
    <button onClick={() => setPicker(null)}
      style={{ background: 'transparent', color: C.muted, border: 'none', fontSize: 13, cursor: 'pointer' }}>
      Zrušit
    </button>
  </div>
)}
```
4. In the sticky header, show edit status / offline hint:
```tsx
  {!editable && <span style={{ fontSize: 11, color: C.muted }}>jen pro čtení offline</span>}
  {pending && <span style={{ fontSize: 11, color: C.muted }}>ukládám…</span>}
  {error && <span style={{ fontSize: 11, color: C.red }}>{error}</span>}
```
(`KIND_COLOR`/`KIND_LABEL` already exist in `TimeOffView`; `C.red` exists in `reports/tokens.ts`.)

- [ ] **Step 2: Typecheck** — `npx tsc -b packages/shared/tsconfig.json && npx tsc -p apps/ipad/tsconfig.json --noEmit` (no new errors referencing R3/writeback files).

- [ ] **Step 3: Full suite** — `npm test`. Expected: prior tests + new `pgMigrations.writeback`, `billingWrites`, extended `billingCache`. Report count.

- [ ] **Step 4: Commit**

```bash
git add apps/ipad/src/components/billing/records/TimeOffView.tsx
git commit -m "feat(writeback-s1): editable time-off (tap → kind picker, online-gated)"
```

---

## Final verification
- [ ] `npx tsc -b packages/shared/tsconfig.json && npm run typecheck` — clean (whole monorepo, gate parity).
- [ ] `npm test` — green, ≥ prior + new tests.
- [ ] Manual smoke (post-merge, device/dev): online → tap a day, pick a kind, see it persist (and survive a refresh / appear on the Mac after sync); offline → calendar read-only; clear a day → it disappears and stays gone (tombstone).

## Self-review notes (for the executor)
- The migration is **v6** (v5 is the #108 column drops) — don't reuse 5.
- `setDayOff` preserves an existing date's `syncId` from the cache; only a brand-new date mints a UUID (re-marking a previously-cleared date mints a fresh one + upserts on the `date` PK — acceptable, days_off syncs by date).
- No toast in apps/ipad — errors live in the view via the hook's `error`.
- UI tasks gate on `tsc`, no DOM tests. Keep the branch rebased; CI now typechecks desktop too.
