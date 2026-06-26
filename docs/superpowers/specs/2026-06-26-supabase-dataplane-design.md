# Supabase data plane live (iPad billing, sub-project 1) — Design

**Date:** 2026-06-26
**Arc:** iPad TimeTracker/billing — decomposed into 3 sub-projects; **this is #1**.
**Branch:** `feat/supabase-dataplane` (off `main` @ `77faeca`).
**Status:** Design approved (brainstorm), pending implementation plan.
**Master design:** `2026-06-22-watchtower-ipad-remote-design.md` (§ data plane); sync groundwork from `2026-06-22-timetracker-postgres-sync-design.md` (#69).

---

## 1. Why / arc

The iPad needs the TimeTracker/billing module, and it must work **with the Mac
unreachable** (offline) — the reason for the Postgres/Supabase data plane. That
whole effort is too big for one spec, so it's decomposed:

1. **Supabase data plane live (this spec)** — TimeTracker data in Supabase,
   readable by an authenticated client, with billing values pre-computed
   server-side, secured by RLS + Supabase Auth. *No iPad UI.*
2. **iPad TimeTracker read module** — `supabase-js` in the iPad, read-only views,
   offline snapshot cache.
3. **iPad write-back** — log/edit worklogs from the iPad with an offline outbox.

## 2. Starting state (already done)

- Supabase Cloud project provisioned: ref `xggihnrvsmbzbkhsnuky`, URL
  `https://xggihnrvsmbzbkhsnuky.supabase.co`. anon key issued (public, role
  `anon`, exp 2036).
- The orchestrator's #69 SQLite→Postgres LWW sync (`sync_id`/`updated_at`/
  `deleted_at`) **already runs against this Supabase**: the connection string is
  in repo-root `.env.development` as **`WATCHTOWER_PG_URL`** (read in
  `orchestrator/db/pg/pool.ts`). **Schema + data are already present in Supabase.**
- The synced tables are the verbatim TimeTracker port: `projects`, `contracts`
  (was `project_rates`), `epics`, `tasks`, `worklogs`, `days_off`.

So provisioning, connection, schema, and sync are **done**. What's missing:
derived billing fields, RLS, the auth user, and a client-read proof.

## 3. Locked decisions

| Area | Decision |
|---|---|
| **Hosting** | Managed Supabase Cloud (forced by the offline requirement). |
| **Client auth** | **Supabase Auth, one-time persistent login** (email+password). `supabase-js` persists/refreshes the session; re-login only on explicit sign-out / revoke / long inactivity. (Session-storage wiring is sub-project 2.) |
| **Billing math** | **Pre-computed server-side, per worklog.** The orchestrator writes derived columns onto each synced worklog; the client only does trivial `SUM … GROUP BY`. No client-side rate joins/rounding. |
| **RLS scoping** | **`anon` → denied; `authenticated` → all rows.** Single-user, so no `owner` column (YAGNI). The anon key alone gets nothing — you must log in. |
| **Derived-field storage** | **Postgres-only projection.** SQLite stays the verbatim source of truth; the derived columns exist only in the Supabase schema and are computed in the push path. SQLite schema is untouched. |

## 4. Components

### 4.1 Derived billing fields (Postgres-only, computed in the sync push)
Add to the Supabase `worklogs` table (and the orchestrator's Postgres schema
def, `orchestrator/db/pg/schema.ts`):
- `effective_minutes INTEGER` — `reported_minutes ?? minutes`.
- `resolved_rate NUMERIC` + `rate_currency TEXT` — the contract matched to the
  worklog's date by the existing rate-window logic, at push time.
- `earned_amount NUMERIC` — the billable amount for this worklog.

These are **never** written to SQLite. The orchestrator computes them when
pushing a worklog row to Postgres. **Critical: the computation must mirror the
existing server-side earnings formula exactly** (`orchestrator/db/reportsSql.ts`
— `effectiveMinutes`, `SUM_EARNED`, the `project_rates`/contract date-window
resolution), not a re-derivation. In particular it must handle **both
`rate_type` values**: `'hourly'` (`effective_minutes / 60 × rate_amount`) and
`'daily'` (man-day conversion via the project's hours-per-day divisor, as the
existing earnings SQL does), and resolve `rate_currency` the same way the
existing earnings aggregation groups by currency. A pure helper
`computeWorklogBilling(worklog, contractsForProject, hoursPerDay) →
{ effectiveMinutes, resolvedRate, rateCurrency, earnedAmount }` is extracted so
it is unit-testable in isolation; its results must match the desktop
`reports:earnings` numbers for the same data (a parity check, since the desktop
already computes these correctly).

### 4.2 Recompute + backfill
- **On worklog change:** the push computes the fields for that row (already in
  the per-row push path).
- **On contract/rate change:** a rate edit changes earnings for every worklog in
  the affected project+window — the orchestrator recomputes and re-pushes those
  worklogs (mark them dirty for the next sync). This reuses the contracts repo
  write path (`orchestrator/db/repositories/projectRates.ts`).
- **Backfill:** a one-time pass computes the derived fields for all existing
  worklog rows already in Supabase (they were synced before the columns existed).

### 4.3 RLS + grants (Supabase migration)
A SQL migration (applied to Supabase by the owner — see §8) that, for each
client-readable table (`projects`, `contracts`, `epics`, `tasks`, `worklogs`,
`days_off`):
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY;`
- a policy `FOR SELECT TO authenticated USING (true)` (read all rows once logged
  in); `anon` gets no policy → denied.
- Write policies (INSERT/UPDATE/DELETE) are **deferred to sub-project 3**.

The orchestrator's sync connects with the Postgres role from `WATCHTOWER_PG_URL`
(table owner / service role), which **bypasses RLS** — so enabling RLS does not
affect the Mac-side sync, only the client (PostgREST) path. Confirm sync still
writes after RLS is on.

### 4.4 Auth user
Created by the owner in the Supabase dashboard (Authentication → Users → Add
user; email+password). No code; consumed by sub-project 2's login screen and by
the smoke check below.

## 5. Data flow

```
worklog/contract write (SQLite, primary)
  → orchestrator computeWorklogBilling(...) at push time
  → LWW push to Supabase worklogs row WITH derived fields
     (contract change → recompute+re-push affected worklogs; one-time backfill for existing rows)

later (sub-project 2):
  iPad → Supabase Auth login (authenticated JWT)
       → supabase-js SELECT (RLS: authenticated = all rows)
       → trivial SUM/GROUP BY over earned_amount  (no client-side billing math)
```

## 6. Error handling

- **Retroactive rate edit** → recompute is the explicit edge case (4.2); without
  it, earnings would be stale. Covered by the contract-write recompute path.
- **Supabase unreachable** → the existing #69 sync retry/debounce handles it; the
  derived-field computation is in-process and idempotent.
- **RLS lockout regression** → after enabling RLS, verify the orchestrator
  (RLS-bypassing role) still writes and an `authenticated` client can read; an
  `anon`-only request must be denied.

## 7. Testing

- **`computeWorklogBilling`** — pure unit tests: `reported_minutes` overrides
  `minutes`; correct rate resolved for a date inside / outside / on the boundary
  of a contract window; `earned_amount` for **both `rate_type='hourly'` and
  `'daily'`** (man-day conversion); `rate_currency` resolution; null rate (no
  contract) → null earned. (vitest, `environment: node`, no network.)
- **Recompute-on-contract-change** — unit test that a rate edit marks the right
  worklogs dirty.
- Existing #69 sync round-trip tests stay green (now also carrying derived
  fields).
- **Live auth + RLS + read** — **human/owner-validated** (needs the real Supabase
  + the auth user's login): a documented smoke script (`supabase-js`: sign in
  with the auth user, `select earned_amount` from a worklog, confirm a row;
  confirm an anon-only client is denied). Not in CI (needs a login secret) —
  parallels the wake/APNs device-validation pattern.

## 8. Owner setup (human steps — I can't do these)

1. **Create the auth user:** Supabase dashboard → Authentication → Users → Add
   user (your email + password).
2. **Apply the RLS migration** I write: `supabase db push` (CLI, logged in) or
   paste the SQL into the dashboard SQL editor. (Or set the conn string in env
   and authorize me to run it.)
3. Provide the **anon key + project URL** — already done
   (`https://xggihnrvsmbzbkhsnuky.supabase.co`, anon `eyJ…`); they go in the
   sub-project-2 iPad config, not a secret.

Everything else (derived-field schema + computation + recompute + backfill, the
RLS migration SQL, tests, a smoke script + runbook) is mine.

## 9. Scope

**In:** derived billing fields (Postgres-only) + `computeWorklogBilling` +
compute-in-push + recompute-on-contract-change + one-time backfill; the RLS
enable + SELECT-policy migration; auth-user setup (owner); unit tests + a
human-run auth/RLS/read smoke script + runbook.

**Out:** any iPad `supabase-js`/UI (sub-project 2); client write-back + write RLS
policies (sub-project 3); multi-user / `owner`-column scoping; changing the
existing SQLite schema or the #69 sync transport.

## 10. Next step

Hand to `writing-plans`.
