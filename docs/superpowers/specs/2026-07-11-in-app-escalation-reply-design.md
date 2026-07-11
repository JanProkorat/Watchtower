# In-app escalation reply — attention threads over Supabase

**Date:** 2026-07-11
**Status:** Design (approved direction, pending spec review)
**Supersedes:** the Slack escalation path (`docs/superpowers/specs/2026-05-30-slack-escalation-design.md`), removed in `fdf8370`.
**Builds on:** the APNs "messaging hub" (`docs/runbooks/apns-messaging-hub.md`, `docs/superpowers/specs/2026-06-26-notification-hub-rework-design.md`).

## 1. Problem

When a managed Claude instance pauses needing my attention (a permission prompt,
an idle question, or a crash) and I am **away from the Mac**, work stalls until I
come back. This used to be solved by a two-way **Slack** escalation: the
orchestrator DM'd me the question + numbered options, I replied in-thread with an
option number or a free-text instruction, and the reply was injected into the pty
so work continued. That Slack machinery was removed; today's replacement is an
**APNs push that only opens the instance** — no reply path, iPad-only, and nothing
at all on iPhone.

**Goal:** replace the Slack reply loop with an **in-app reply on the iOS apps**, so
I can answer from my phone (or an iPad that can't reach the Mac) and the Mac
continues — while preserving Claude's **follow-up questions as a persistent
conversation** I can scroll back through for context.

## 2. Requirements (from brainstorming)

1. **iPhone:** answer in the app so the Mac continues. iPhone has no WS bridge and no
   terminal mirroring — the reply surface must carry enough context to answer blind.
2. **iPad, Mac reachable (WS bridge live):** I don't need the in-app reply — tapping
   the notification opens the instance and I answer in the mirrored terminal (already
   shipped). The in-app reply is still *offered* but "Open in terminal" is the primary.
3. **iPad, Mac not reachable:** falls back to the same in-app reply path as iPhone.
4. **Persistent thread per instance:** Claude can ask a follow-up to my reply. When a
   new notification pulls me back, my earlier answer must still be visible above
   Claude's new question — a scrollable back-and-forth, not a one-shot.
5. **Reply surface content:** show the terminal **snapshot** at the pause (full
   context), and *when* the pause is a permission prompt with clear numbered options,
   render those as quick-tap buttons **plus** a free-text field. (User chose "best of
   both.")
6. **Bell + drawer UX:** the existing iPad notification **bell → popover** lists items
   with a header styled by decision type; tapping opens a **drawer/dialog** with the
   full thread + reply input. iPhone gets the same, sized for phone (full-screen
   sheet + full-screen compose).

## 3. Why Supabase is the relay (feasibility)

The reply must reach the Mac even when the device cannot reach the Mac directly
(iPhone always; iPad off-network). The Mac is always **running** when it escalates
(the orchestrator is what detects the attention state), and it already holds an
**outbound** connection to Supabase/Postgres for TimeTracker sync
(`orchestrator/db/pg/pool.ts`). Both sides only ever make **outbound** connections
to Supabase, so no inbound reachability to the Mac is required. That is the property
that makes this work across all three cases with a single channel.

- **Mac → device:** on escalation, the Mac writes a `role='claude'` row (snapshot +
  parsed options) to a Supabase table and fires the existing APNs nudge.
- **Device → Mac:** the app writes a `role='user'` reply row; the Mac (polling its own
  outbound pg connection) picks it up and injects it into the pty.

### Alternatives considered (and rejected)

- **Revive `messaging:reply` over the WS bridge only.** Works on a connected iPad, but
  iPhone has no bridge and a disconnected iPad has no bridge — fails requirements 1 & 3.
  (We *do* keep the WS "Open in terminal" path for the connected-iPad case, but not as
  the reply transport.)
- **Push the reply inside an APNs payload back to the Mac.** APNs is one-way
  (server→device); it cannot carry a device→Mac reply.
- **Extend the existing 60 s TimeTracker sync to carry replies.** That plane is a
  single-writer LWW model (only the Mac pushes) with a 60 s cadence — wrong ownership
  model and far too slow for an interactive reply. The attention relay is a **separate,
  short-latency message queue** in the same Supabase project, independent of the
  TimeTracker sync cursors.

**Dependency:** the relay requires the Supabase hub to be configured (`pg != null`).
That is already true on the dogfood setup (TimeTracker sync uses it). When `pg` is
null, the feature is dormant and behaviour degrades to today's APNs-open-instance /
answer-in-terminal.

## 4. Architecture

```
                       ┌───────────────────────── Mac (orchestrator, always running) ──────────────────────────┐
  instance pauses ──▶  EscalationGate.apply()  ──(timer + window unfocused)──▶  onEscalate                       
                                                                                   │                             
                                                                                   ├─▶ TerminalSnapshots.snapshot()
                                                                                   ├─▶ parseEscalation() → {question, options[]}
                                                                                   ├─▶ AttentionRelay.writeClaudeMessage()  ──┐
                                                                                   └─▶ hubSender.fire()  → sendApns (nudge) ──┼──▶ Supabase
                                                                                                                              │   attention_messages
  AttentionRelay poll (adaptive 3 s / 30 s)  ◀── SELECT role='user' AND injected_at IS NULL ────────────────────────────────┘
        │ for each new reply:
        ├─▶ deliverReply(instanceId, text):  pty.get(id).write(text + '\r'); applyTransition(id,{userPromptSubmit})
        └─▶ UPDATE ... SET injected_at = now()
                       └────────────────────────────────────────────────────────────────────────────────────────┘

                       ┌──────────────── iOS app (iPhone / iPad) ─────────────────┐
   APNs nudge ──▶  foreground/tap ──▶ useAttentionThreads() (Supabase read, SWR)   
                       Rail bell (badge = # unanswered) ──▶ NotificationHub popover 
                          └─ tap item ──▶ AttentionThreadDrawer (BottomSheet)       
                                            ├─ renders thread (claude ↔ user rows)  
                                            ├─ option buttons (parsed) + free text  
                                            └─ send ──▶ useAttentionReply() (Supabase insert role='user')
                       └──────────────────────────────────────────────────────────┘
```

### 4.1 Data model — Supabase / Postgres (new `PG_MIGRATIONS` version 12)

A single append-only table in `orchestrator/db/pg/schema.ts`. It is **not** added to
`SYNCED_TABLES` — it is driven directly by the relay, not the TimeTracker sync.

```sql
CREATE TABLE IF NOT EXISTS attention_messages (
  id             BIGSERIAL PRIMARY KEY,
  sync_id        TEXT UNIQUE NOT NULL,        -- uuid, generated by the writer
  instance_id    TEXT NOT NULL,              -- thread key = Mac instance id
  project_label  TEXT,                        -- human name (iPhone has no bridge to resolve it)
  role           TEXT NOT NULL,              -- 'claude' | 'user'
  kind           TEXT,                        -- 'waiting-permission'|'idle-notify'|'crashed' (claude rows)
  body           TEXT,                        -- snapshot text (claude) / reply text (user)
  options        JSONB,                       -- [{number:int, label:text}] parsed options (claude rows)
  reply_to       TEXT,                        -- (user rows) sync_id of the claude row being answered
  injected_at    TIMESTAMPTZ,                 -- (user rows) set by the Mac once injected into the pty
  closed_at      TIMESTAMPTZ,                 -- (claude rows) set when the instance ends / thread retired
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attn_instance    ON attention_messages(instance_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attn_pending_user ON attention_messages(role, injected_at)
  WHERE role = 'user' AND injected_at IS NULL;

ALTER TABLE attention_messages ENABLE ROW LEVEL SECURITY;
-- Device (authenticated via anon key + Supabase auth) may read the whole thread and
-- insert only its own replies. The Mac connects via the pg pool (service role) and
-- bypasses RLS, exactly like the existing sync writes.
CREATE POLICY attn_read  ON attention_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY attn_write ON attention_messages FOR INSERT TO authenticated WITH CHECK (role = 'user');
```

**Derived state (client):** a `claude` row is *answered* iff some `user` row has
`reply_to = claude.sync_id`. The bell badge counts instances whose latest `claude`
row (with `closed_at IS NULL`) is unanswered.

**Retention:** prune rows for closed threads older than N days, reusing the existing
prune cadence (`SyncService` daily tombstone purge is the hook point).

### 4.2 Orchestrator (Mac) — new pieces

- **`orchestrator/escalationMessage.ts` (reintroduced, no Slack deps).**
  `parseEscalation(snapshot: string): { question: string; options: { number: number; label: string }[] }`.
  Ports the numbered-option/question parsing from the deleted Slack `formatEscalationMessage`
  (recoverable from history at `fdf8370^`), minus all Block Kit. When nothing parses,
  `options = []` and the client shows free-text only. The raw snapshot is always stored
  as `body`.
- **`orchestrator/attentionRelay.ts` (new).** `createAttentionRelay({ pg, getSnapshot, deliverReply, resolveLabel })`:
  - `writeClaudeMessage(instanceId, cwd, kind)` — `flush` + `snapshot` the terminal,
    `parseEscalation`, `INSERT` a `role='claude'` row (uuid `sync_id`, `project_label`
    from `resolveLabel(cwd)`, `options` JSON). Called from `onEscalate` **alongside**
    `hubSender.fire`.
  - Adaptive **reply poll**: `SELECT ... WHERE role='user' AND injected_at IS NULL
    ORDER BY created_at`. Poll every **3 s while any thread has an outstanding
    unanswered `claude` row**, else every **30 s** (both `.unref()`'d). For each new
    user row: `deliverReply(instance_id, body)`, then `UPDATE ... SET injected_at=now()`.
    If the instance is gone, still stamp `injected_at` (idempotent) and mark the thread
    `closed_at` so the device shows "instance ended".
  - No new SQLite table in v1 — the relay writes/reads pg directly (the orchestrator
    owns the pool). If `pg` is null the relay is a no-op.
  - *(Optional future optimisation: replace the poll with Postgres `LISTEN/NOTIFY` on a
    dedicated `pool.connect()` client. Out of scope for v1.)*
- **`deliverReply(instanceId, text)` (reintroduced helper in `orchestrator/index.ts`).**
  Verbatim the proven primitive:
  ```ts
  const session = pty.get(instanceId);
  if (!session) return false;
  session.write(text + '\r');
  applyTransition(instanceId, { kind: 'userPromptSubmit' }); // reply == engagement; clears attention/badge
  return true;
  ```
- **Wiring.** In the api-ready init block where `hubSender`/`escalationGate` are built
  (`orchestrator/index.ts` ~1262–1286): construct `attentionRelay`, and in `onEscalate`
  call **both** `attentionRelay.writeClaudeMessage(...)` and `hubSender.fire(...)`. Same
  gate (timer + window unfocused) → the thread only accrues "away" questions; when I'm
  at the Mac I answer in the terminal and nothing is written.
- **Fast-path follow-ups (refinement).** After a remote reply is injected while the
  window is still unfocused, treat the instance as "remotely engaged": on its *next*
  attention state, `EscalationGate` fires **immediately** (skip `escalateMs`) since we
  know I'm answering remotely. Cleared when the window regains focus. Keeps a
  back-and-forth snappy instead of waiting a full timer per turn.
- **APNs payload.** Extend `hubSender`/`buildContext` so `data` carries
  `{ instanceId, kind }` (title/body already Czech per kind); the tap opens the thread
  for `instanceId`. Message text uses `project_label` + a short question summary.

### 4.3 Shared data hooks — `packages/data-supabase` (new)

Follows the existing `useBilling` (SWR) + `useWorklogMutations` (optimistic
write-through) patterns; **no bridge**, so both apps use it.

- `useAttentionThreads()` — reads `attention_messages` grouped by `instance_id`, ordered
  by `created_at`; SWR reducer + Capacitor `Preferences` offline cache like `useBilling`.
  Refreshed on: mount, APNs foreground, drawer open, pull-to-refresh, and a light poll
  (~5 s) **while a drawer is open**. Exposes `threads`, `unansweredCount`, `refresh()`.
  *(Supabase Realtime is a later enhancement; v1 is fetch + poll, consistent with the
  rest of the client.)*
- `useAttentionReply()` — `sendReply(instanceId, replyToSyncId, text)`: optimistic append
  of a local `user` row, then `insert` into `attention_messages` (`role='user'`,
  `reply_to`, uuid `sync_id`); rollback + Czech error on failure. Guards double-send
  (disable while `pending`, mirroring the `#161` connection-save double-tap fix).

### 4.4 Shared UI — `packages/module-attention` (new small package)

The bell/popover currently lives in `apps/ipad/src/components/NotificationHub.tsx`
(iPad-only, bridge-derived). To share with iPhone, the reply UI moves into a new
lightweight package consuming `@watchtower/ui-core` (glass tokens, `BottomSheet`) +
`@watchtower/data-supabase`. (Rationale: `module-timetracker` is the wrong domain and
`ui-core` is primitives; a focused `module-attention` is the honest boundary — same
workspace-package pattern the repo already uses.)

- `NotificationHub` — the popover list. Header per item styled by `kind`:
  permission → command glyph + amber (`#f5a524`), idle question → accent (`#7c6df0`),
  crash → red. Data source is the **merge** of (a) `useAttentionThreads()` (both apps)
  and (b) — connected iPad only — the existing live-bridge `useAttentionInstances()`,
  de-duped by `instanceId`. An item with a thread shows the reply affordance; a
  bare live item behaves as today (opens the terminal).
- `AttentionThreadDrawer` — opens on tap via the shared `BottomSheet` (iPad → popover
  anchored to the bell / centered form-sheet; iPhone → full-screen bottom sheet).
  Renders the thread: `claude` rows show the snapshot (monospace, scrollable) with the
  question emphasised and parsed `options` as quick-tap buttons; `user` rows render as
  sent bubbles. Composer = option buttons + free-text field + Send. Tapping an option
  sends its number; free text sends the text. When the connected-iPad `openInTerminal`
  callback is present, a secondary "Otevřít v terminálu" button appears.
- **Bridge-agnostic injection** (same pattern as `BoardActions`): the drawer takes an
  optional `openInTerminal?(instanceId): void`. iPad supplies it (closes over the WS
  bridge + module switch); iPhone omits it → the button doesn't render.

### 4.5 App integration

- **iPad (`apps/ipad/src/App.tsx`):** replace the local `NotificationHub` import with
  the shared one; feed it the merged source; pass `openInTerminal` (existing
  `setActiveModule('instances') + selectInstance(id)`). Keep the Rail bell + badge.
- **iPhone (`apps/iphone/src/App.tsx`):** add the Rail/header **bell** (first time),
  wire the shared `NotificationHub` + `AttentionThreadDrawer` with **no**
  `openInTerminal`. Register for APNs (`@capacitor/push-notifications`) for the first
  time. Because iPhone has no WS bridge, it cannot use the iPad's `push:registerDevice`
  RPC — instead it writes its token to a **pg-side `push_devices` table** (RLS:
  `authenticated` insert), which the Mac reads alongside its local SQLite tokens when
  fanning out APNs. This pg token table is the one net-new piece of plumbing vs iPad;
  see Open Questions.

## 5. Error handling & edge cases

- **Mac asleep after escalation:** the reply sits in Supabase; picked up on the next
  wake/poll. Acceptable — escalation only fires while the Mac is awake.
- **Instance ends before reply injected:** stamp `injected_at`, set `closed_at`; device
  shows "instance ended", composer disabled.
- **Duplicate / multi-device replies:** first reply for a `claude` row wins; the row is
  answered; later replies to an already-answered row are ignored by the relay (it only
  injects rows whose `reply_to` is still the latest unanswered claude row). Client
  disables Send after send.
- **`pg == null` (no hub):** relay is a no-op; APNs still opens the instance (today's
  behaviour). Bell shows only live-bridge items on a connected iPad.
- **Parse yields no options:** free-text-only composer; snapshot still shown.
- **Reply injection into a TUI permission prompt:** uses the same `write(text+'\r')`
  primitive the Slack path used successfully; verified against a real permission prompt
  during implementation (a known primitive, but re-confirmed, not assumed).

## 6. Testing

- **Unit — orchestrator:** `parseEscalation` (question + numbered options, and the
  no-options fallback); `AttentionRelay` write + adaptive-poll + inject + `injected_at`
  idempotency (fake pg + fake pty); `deliverReply` writes `text+'\r'` and transitions;
  fast-path follow-up skips the timer only while unfocused + remotely-engaged.
- **Unit — pg schema:** migration v12 applies idempotently; RLS policies present.
- **Unit — hooks:** `useAttentionThreads` grouping/ordering + SWR states + offline
  cache; `useAttentionReply` optimistic append + rollback + double-send guard.
- **Component:** `AttentionThreadDrawer` renders claude/user rows, option buttons emit
  the number, free text emits text, `openInTerminal` conditionally rendered.
- **Full suite** must stay green (219+; note node:sqlite vs better-sqlite3 divergence
  for any SQLite migration — v12 here is **pg-only**, so this table is exercised via the
  pg-integration path, gated on `WATCHTOWER_PG_URL@5433` throwaway DB).

## 7. Scope / YAGNI

**In scope (v1):** the Supabase relay, the reintroduced parser + `deliverReply`, the
`AttentionRelay` poll, the two data hooks, the shared `module-attention` UI (bell +
thread drawer), iPad integration (replace local hub, keep terminal path), iPhone
integration incl. first-time APNs registration + bell.

**Out of scope (later):** Supabase Realtime / `LISTEN`/`NOTIFY` (v1 polls); live
terminal streaming into the drawer (v1 relays only at pause points — turn-based);
a desktop reply UI (at the Mac you answer in the terminal); rich media / attachments;
per-message read receipts.

## 8. Resolved decisions (approved 2026-07-11)

1. **iPhone token registration:** iPhone writes its APNs token to a **pg-side
   `push_devices` table** (RLS: `authenticated` insert); the Mac reads it alongside its
   local SQLite tokens when fanning out APNs. (iPad keeps registering over the WS bridge.)
2. **Bell semantics on a connected iPad:** **merge** live-bridge attention + Supabase
   threads, de-duped by `instanceId`. A thread item shows the reply affordance; a bare
   live item behaves as today (opens the terminal).
3. **Fast-path follow-ups:** **yes** — once a thread is remotely engaged and the window
   is still unfocused, the next attention state escalates immediately (skip `escalateMs`).
   Cleared when the window regains focus.
4. **Retention window:** closed threads are pruned with the existing daily purge after
   **14 days**.
