# Notification hub rework (iPad) — Design

**Date:** 2026-06-26
**Issue:** #71 follow-on (UX rework of the cross-device hub's in-app surface).
**Branch:** `feat/71-messaging-hub` (extends PR #103).
**Status:** Design approved (brainstorm), pending implementation plan.
**Supersedes (in part):** the in-app `PingReply` banner from `2026-06-25-messaging-hub-design.md`.

---

## 1. Why

Device testing showed the in-app design was wrong:
- The `PingReply` banner dropped into the layout (content shift) to offer a quick reply.
- A blind reply box is useless — the ping text is only the escalation kind
  (e.g. *"Claude potřebuje vaše rozhodnutí o povolení"*) with no detail, so you
  can't answer without seeing the terminal.

The right model: a notification **takes you to the instance**, where the full
context lives and you answer in the terminal. The terminal already works on the
iPad (mirroring + accessory keys). So the in-app surface becomes a **live
"needs attention" hub** with tap-to-open, and the quick-reply path is removed
entirely.

---

## 2. Locked decisions

| Area | Decision |
|---|---|
| **Hub source** | **Live instance status**, not escalation pings. The hub lists instances currently in an attention state (`waiting-permission` / `idle-notify` / `crashed`), derived from the `stateChanged` data the iPad already receives. Self-clears when an instance leaves the attention state (i.e. when answered). No stale entries, no focus/delay dependence. |
| **Placement** | A **bell at the top of the left Rail** with a count badge (visible from every module) → tap opens a **popover** listing the attention instances → tap an entry navigates to that instance's terminal. Overlays (no content shift). |
| **Answering** | In the **terminal** (open the instance, read context, type). No in-app reply box. |
| **APNs (away)** | Unchanged as the away-alerting path: escalation gate → `hubSender` → APNs to registered device tokens. Tapping the APNs notification opens the app and **navigates to the instance** (`instanceId` from the payload). |
| **Cleanup** | **Full — no dead code.** Remove everything the new model makes unused (§5). |

---

## 3. iPad — new/changed

- **`useAttentionInstances()`** (new hook) — derives the attention set from
  `useInstances()`: filter `status ∈ { 'waiting-permission', 'idle-notify',
  'crashed' }`. Returns `{ instanceId, label, reason }[]`, where `label` is the
  project name (via `useProjects`, falling back to the cwd basename) and
  `reason` is a short Czech phrase per status: `čeká na povolení` /
  `dokončeno, čeká na vstup` / `spadlo`.
- **`NotificationBell`** (new) — a bell icon at the top of `Rail.tsx` with a
  count badge (= attention count; hidden when 0). Tap toggles the popover.
  Plain React + inline styles (palette consistent with the rail).
- **`NotificationHub`** (new) — the popover: absolutely-positioned overlay
  anchored to the bell (no layout shift). Lists entries (label + reason); tap →
  `setActiveModule('instances')` + `setActiveId(instanceId)` + close. Empty
  state: bell shows no badge; popover (if opened) shows *"Žádná upozornění"*.
- **Navigation lift** — the bell lives in the Shell, which owns `activeModule`
  but not `setActiveId` (currently local to `InstancesModule` via
  `useActiveTerminal`). Lift the active-instance selection to the Shell (pass
  `activeId`/`setActiveId` down to `InstancesModule`) so the hub and the
  module share one selection.
- **APNs tap** — `pushNotificationActionPerformed` reads `instanceId` from the
  payload → `setActiveModule('instances')` + `setActiveId(instanceId)`. No
  reply box, no `messaging:getPing`.

---

## 4. Orchestrator — simplification

- **`hubSender`** reduces to: on escalate (hub enabled) → `buildContext()` →
  `sendApns(...)` to each registered token (prune on 410). It no longer emits a
  WS `attentionPing` push and no longer logs a ping / needs a `pingId`. APNs
  `data` carries `{ instanceId }` for tap-navigation.
- The escalation gate, `hubConfig` (incl. `escalateMs`/`triggers`), `apns.ts`,
  `push_devices` + `PushDevicesRepo` + `push:registerDevice`, and the iPad push
  registration all **stay** unchanged.

---

## 5. Full removal set (no dead code)

**iPad:** `components/PingReply.tsx`, `state/usePings.ts`, `state/pingStore.ts`,
`tests/ipad/pingStore.test.ts`; the `<PingReply>` mount + `usePings` use in
`App.tsx`.

**Contract** (`messagePort.ts` + `ipcContract.ts`): the `messaging:reply` and
`messaging:getPing` request/response kinds, and the **`attentionPing`** push
kind (from `OrchPush` *and* `IpcPush`).

**Orchestrator:** `messagingReply.ts` (`routeMessagingReply`) +
`tests/orchestrator/messagingReply.test.ts`; the `messaging:reply` /
`messaging:getPing` handler cases in `index.ts`; the now-unused `deliverReply`
function; `db/repositories/pings.ts` (`PingsRepo`, `PingView`) +
`tests/orchestrator/pings.test.ts`; the **`pings` table migration (v16)**;
`hubSender`'s `emitPush`/`logPing` wiring (and the matching parts of
`tests/orchestrator/hubSender.test.ts`).

**Migration note:** removing the v16 `pings` migration leaves `push_devices`
(v15) as the latest. The dev DB already ran v16, so it keeps a **vestigial
`pings` table** (harmless; no code touches it). The branch's migration
numbering is reconciled against current `main` at merge time regardless (main
has its own post-v14 migrations) — fold this into that pass.

---

## 6. Data flow

```
in-app:   instance enters attention (status) ──stateChanged──▶ iPad useInstances
            → useAttentionInstances → bell badge + popover
            → tap entry → open Instances + select that terminal → answer in terminal
            (entry disappears when the instance leaves the attention state)

away:     attention + unfocused + escalateMs ── gate ──▶ hubSender → APNs (instanceId)
            → iOS notification → tap → app opens → navigate to that instance's terminal
```

---

## 7. Error handling / testing

- **`useAttentionInstances`** — pure filter/label/reason: unit-tested
  (statuses included/excluded; reason mapping; label fallback to cwd basename).
- **`hubSender`** — updated test: fires APNs to tokens, prunes 410, no-op when
  disabled, and asserts it no longer emits a push / touches a pings repo.
- Removed tests deleted with their code (`pingStore`, `pings`, `messagingReply`).
- `NotificationBell`/`NotificationHub` are logic-light React — typecheck +
  build + the device smoke validate them (vitest is `environment: node`).
- The whole suite stays green; shared/transport/orchestrator/iPad typecheck
  clean; iPad builds.

---

## 8. Scope

**In:** the live attention hook + rail bell + popover + navigation lift;
APNs-tap navigation; the full removal set (§5); `hubSender` simplification.

**Out:** changing the #75 `AuthBlockBanner` (separate VNC handoff — same
banner anti-pattern, but different target; revisit separately); the desktop's
own attention surfacing; migration renumbering vs current main (merge-time).

---

## 9. Next step

Hand to `writing-plans`.
