# Sidebar token-usage bars — design

**Date:** 2026-07-15
**Branch:** `feat/sidebar-token-usage`
**Status:** approved design, pending implementation plan

## Goal

Use the empty space at the bottom of the left navigation sidebar
(`ModuleRail`) to show two live usage indicators:

1. **Session** — current 5-hour rolling window.
2. **Week** — current 7-day rolling window ("all models").

These must match the percentages Claude Code shows in `/status` → Usage,
i.e. real progress against the subscription plan limits — not a ccusage
estimate. When the sidebar is collapsed (78px), show a compact
"short percentage" indicator instead of the full bars.

## Key constraint (why this needs new plumbing)

The real session + weekly percentages exist **only** in Claude Code's
**statusline JSON** — the object piped to a configured `statusLine`
command. For Pro/Max subscribers it contains:

```json
"rate_limits": {
  "five_hour": { "used_percentage": <0-100>, "resets_at": <epoch seconds> },
  "seven_day": { "used_percentage": <0-100>, "resets_at": <epoch seconds> }
}
```

Verified NOT available elsewhere on this machine:

- **Hook payloads** Watchtower already receives: `.rate_limits` is `null`
  (checked 26k stored `hook_events`; the only string hits were this
  session's own diagnostic echoes).
- **Session transcript JSONL** (`transcript_path`): does not carry
  `rate_limits` (0 matches across other projects' transcripts).
- **Local files** under `~/.claude/` (`policy-limits.json`,
  `stats-cache.json`): no usage percentages.
- The underlying HTTP endpoint Claude Code calls is undocumented and
  auth'd via the macOS Keychain — not something we replicate.

`ccusage` provides only the 5-hour billing block (`blocks --active`) with
a *reconstructed* plan limit; it has **no** weekly-limit concept
(`ccusage weekly` returns raw tokens/cost only). So ccusage can back the
session bar approximately, but never the weekly bar.

**Conclusion:** to display the exact `/status` numbers, Watchtower must
*be*, or wrap, the Claude Code `statusLine` command so it can read
`rate_limits` as each statusline renders.

## Architecture

### 1. Capture — `watchtower-statusline` helper

New bundled helper alongside `watchtower-hook` in `helper/` (built for
packaging by `npm run build`). On every statusline render it:

1. Reads the full statusline JSON from **stdin**.
2. Extracts `rate_limits` (+ `session_id`) if present.
3. **Fire-and-forget POST** to the orchestrator's existing localhost HTTP
   listener (reuse the exact port-discovery mechanism `watchtower-hook`
   uses — env var / known file), with a tight timeout (≈250ms) so the
   statusline is never delayed or blocked if the listener is down.
4. Execs the user's **original** statusline command with the *same* stdin
   and prints its stdout + exit code verbatim.

Result: the user's existing statusline (currently `ccline-with-usage.sh`)
looks and behaves identically; Watchtower just tees the numbers.

If `rate_limits` is absent (API-key users, older CC), the helper still
passes through and simply POSTs nothing meaningful.

### 2. Install/restore — Settings toggle

A toggle in **Settings ▸ General**: *"Capture usage from statusline"*.

**Enable:**
- Back up `~/.claude/settings.json` → `.bak.<YYYYMMDD-HHMMSS>` (repo
  backup convention).
- Read current `statusLine.command`; store it as the **inner command**
  (persisted so restore is possible even if the backup is pruned).
- Repoint `statusLine.command` at the wrapper, passing the inner command.

**Disable:**
- Restore `statusLine.command` to the stored inner command; leave backups.

This is the *only* change to global config, and it is reversible. If no
`statusLine` was configured before, the wrapper runs with a no-op inner
command (prints nothing) — the user's statusline stays empty as it was.

### 3. Orchestrator

- New route on the existing HTTP listener: `POST /statusline`. Validates
  the body and stores the latest snapshot in memory:
  ```ts
  interface RateLimitsSnapshot {
    session: { usedPercent: number; resetsAt: number } | null;
    week:    { usedPercent: number; resetsAt: number } | null;
    capturedAt: number; // epoch ms
  }
  ```
- Persist the latest snapshot to the `settings` table (key e.g.
  `rate_limits_snapshot`) for cold-start display after an app restart.
- New IPC kind **`rateLimits:usage`** (request → `RateLimitsSnapshot | null`)
  and push **`rateLimitsUsage`**, mirrored in `packages/shared/src/ipcContract.ts`
  and `packages/shared/src/messagePort.ts`, registered in
  `apps/desktop/src/state/ipc.ts`.
- Statuslines fire every few seconds, so the push is **throttled**: emit on
  meaningful change or at most every ~5s.

### 4. Renderer

- New hook `useRateLimits()` in `apps/desktop/src/state/` mirroring
  `useTokenUsage`: invoke `rateLimits:usage` on mount, subscribe to the
  `rateLimitsUsage` push, unsubscribe on unmount.
- New component `<SidebarUsage>` rendered inside `ModuleRail.tsx`
  **after the flex spacer (`<Box sx={{ flex: 1 }} />`, ~line 481) and
  above the collapse `IconButton`** — the empty bottom space.
  - **Session %** = `rateLimits.session?.usedPercent ?? ccusage.currentPercentUsed`
    (ccusage via the existing `useTokenUsage`).
  - **Week %** = `rateLimits.week?.usedPercent` — no fallback; render
    "unavailable" state if null.
  - Severity color via the existing `usageSeverity(pct)` bands
    (`ok <70 / warn <90 / crit`) mapped to the ocean palette, reusing the
    `severityColor` pattern from `dashboard/TokenUsageCard.tsx`.
  - Freshness: keep last-known snapshot; if `capturedAt` is stale
    (e.g. > 10 min old), dim the block and show "as of Nm ago" in the
    tooltip. Reset countdown re-renders on a 30s client interval (same as
    `TokenUsageCard`).
  - Styling: MUI `sx` + theme tokens, consistent with `ModuleRail`
    (thin rounded `LinearProgress`, ~6px). No new styling system.

### 5. UI states

**Expanded (232px)** — two labeled bars, divider above, pinned to bottom:

```
────────────────────────────
 Session          42% · 2h13m
 ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░
 Week                     71%
 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░
────────────────────────────
        ‹ collapse
```

**Collapsed (78px)** — two stacked mini bars, each with a one-letter tag
(`S` / `W`) and %, full detail (incl. reset time) in a hover tooltip:

```
┌──────────┐
│ S    42% │
│ ▓▓▓▓░░░░░ │
│ W    71% │
│ ▓▓▓▓▓▓▓░░ │
└──────────┘
```

## Edge cases

- **No data yet** (fresh install, toggle off, no session has rendered a
  statusline): session bar falls back to ccusage; if that's also empty,
  the block renders a muted placeholder. Week bar shows "—".
- **Stale data** (no session live for a while): show last-known, dimmed,
  with relative "as of" time.
- **API-key user / no `rate_limits`**: session = ccusage; week =
  "unavailable" with a tooltip explaining weekly needs a Pro/Max plan.
- **Toggle off**: `<SidebarUsage>` still renders the ccusage session bar
  (best-effort) but the week bar shows "enable capture to see weekly."
  (Open question — see below.)

## Testing (vitest)

- `watchtower-statusline` helper: parses stdin, extracts `rate_limits`,
  passes stdin through to inner command, tolerates missing `rate_limits`
  and a down listener (no throw, no stall).
- Settings wrap: install backs up + repoints; restore returns the exact
  inner command; idempotent enable/disable.
- Orchestrator: `POST /statusline` validation, in-memory store,
  `settings`-table persistence, push throttle.
- Renderer: `useRateLimits` subscribe/unsubscribe; `<SidebarUsage>`
  fallback logic (rate_limits → ccusage → placeholder), severity mapping,
  collapsed vs expanded rendering.

Must keep the suite green (219+ baseline; add tests for new code).

## Scope / files (≈10 + helper)

`helper/` (new statusline helper + build wiring), Settings service for the
statusLine wrap (`orchestrator/services/`), `orchestrator/index.ts`
(route + polling/throttle + persistence), `packages/shared/src/{ipcContract,messagePort,tokenUsageFormat?}.ts`,
`apps/desktop/src/state/{ipc,useRateLimits}.ts`,
`apps/desktop/src/components/ModuleRail.tsx` + new `SidebarUsage.tsx`,
Settings ▸ General toggle UI, plus tests. This is a plan-then-execute
feature.

## Open questions for implementation plan

1. **Toggle-off behavior for the week bar**: hide the week bar entirely
   when capture is disabled, or show a muted "enable to see weekly" hint?
   (Leaning: hide the week bar, keep the ccusage session bar.)
2. **Show the whole `<SidebarUsage>` block conditionally?** e.g. hide if
   there's genuinely no data and capture is off, to avoid an empty stub.
3. **Reuse vs new payload**: fold `RateLimitsSnapshot` into the existing
   `TokenUsagePayload`/`tokenUsage` push, or keep the separate
   `rateLimits:usage` kind (design assumes separate — cleaner lifecycle).
