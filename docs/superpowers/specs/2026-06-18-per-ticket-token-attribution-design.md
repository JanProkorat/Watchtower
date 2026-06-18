# Per-ticket token attribution — design

> Status: approved 2026-06-18. Next: implementation plan (writing-plans).

## Goal

In the Reports tab, see which tickets consumed the most tokens —
e.g. `FIE1933-19084 · 1.2M tok · 3 sessions · 2h 15m logged · [opus-4-8]`
— by joining Watchtower's existing instance↔task binding to the raw
Claude transcripts.

## Why not ccusage

`ccusage` groups only by project **directory** (its `session` command
emits a path-derived slug, not the conversation UUID). A single repo
like `Green-Code` is one bucket of ~91 conversations — useless for
per-ticket. So Watchtower computes the per-ticket figure itself from
the raw transcripts.

## Attribution chain (all parts exist today)

```
instance.task_id          ─→ tasks ─→ epics ─→ projects   (the "ticket" + project filter)
instance.claude_session_id ─→ ~/.claude/projects/<slug>/<uuid>.jsonl ─→ per-line usage
```

- `instances.task_id` (FK to `tasks`, `migrations.ts:212`) is the
  binding; set via the live `instances:setTask` IPC.
- `instances.claude_session_id` is the Claude conversation UUID, stored
  via the `storeClaudeSessionId` state-machine output.
- Each transcript line carries `message.usage`
  (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`), `message.model`, and a timestamp.
- Transcript path resolution reuses `projectSessionDir(cwd)` from
  `orchestrator/sessionResume.ts`.

## Scope decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Cost unit | **Tokens only** (input/output/cache + models) | No pricing source or USD→CZK rate to own; never "wrong"; tokens are a fine effort proxy. |
| UI home | **Reports tab panel**, ranked by tokens | Reuses the tab's project filter + period presets; joins to existing worklog→task reporting. |
| Compute model | **Cached daily buckets + incremental append-parse** | Fast repeat views, survives restarts, supports the period filter. |
| Headline metric | **input + output** prominent; **cache** muted secondary | cache_read is often billions — it would drown the ranking and isn't a good effort proxy. |

## Architecture

### 1. `orchestrator/services/sessionTokens.ts` (new)

- Locates a session's transcript via `projectSessionDir(cwd)` +
  `<claude_session_id>.jsonl`.
- **Incremental parse**: `stat` the file; read only from the stored
  `byteOffset` to EOF (transcripts are append-only JSONL). On
  truncation/rotation (`size < byteOffset`) re-parse from 0. Missing
  file → keep last cached data, mark stale.
- **Pure line parser**: `(jsonlLines: string[]) → DailyUsage[]`, bucketed
  by **local day** (system tz, matching Reports) × model, summing the
  four token types. Lines without `message.usage` are skipped.

### 2. DB — migration v6

- `session_usage` — PK `(claude_session_id, day, model)` →
  `{ input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens }`.
- `session_usage_cursor` — PK `(claude_session_id)` →
  `{ byte_offset, size, mtime }`.
- New repo `orchestrator/db/sessionUsage.ts`.

### 3. Reports rollup

Extends `orchestrator/db/reports.ts` + `reportsSql.ts`. For
`{ from, to, projectId? }`:

- Sum `session_usage` over `[from, to]` for sessions whose instance has
  `task_id` set (and matches the project filter via task→epic→project),
  `GROUP BY task_id`, rank by total tokens desc.
- **Join existing worklog→task minutes** so each row also shows logged
  time for the same task.
- Sessions with `task_id = null` roll into an **"Unattributed"** row,
  shown only in the all-projects view (it has no project to filter on).

`TicketTokenRow` shape:

```ts
interface TicketTokenRow {
  taskId: number | null;          // null = Unattributed bucket
  taskNumber: string | null;      // Jira-key-ish suffix
  taskTitle: string | null;
  projectName: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;            // creation + read, muted
  sessionCount: number;
  loggedMinutes: number;          // from worklogs, same task
  modelsUsed: string[];
}
```

### 4. IPC

Add `{ kind: 'reports:tokensByTicket'; payload: { from: string; to: string; projectId?: number } }`
→ `{ kind: 'reports:tokensByTicket'; payload: { rows: TicketTokenRow[] } }`.

The handler **runs the incremental parse for in-scope sessions first**
(bounded to sessions relevant to the active project filter to cap
work), then queries the rollup. Mirror in `messagePort.ts`, handle in
`index.ts`.

### 5. Renderer

- `client/src/state/useTokensByTicket.ts` — thin hook
  (`{ data, error, refresh() }`).
- A "Token spend by ticket" panel in `ReportsTab.tsx`, reusing the
  tab's project filter + period presets, `format.ts` (NBSP / cs-CZ
  number formatting), and a Skeleton while parsing.

## Known limitations (acceptable for an informational metric)

- A session is attributed **wholly to its currently-bound task**;
  rebinding reassigns all of that session's history (the binding is one
  `task_id` per instance, with no time-slicing).
- Sessions never bound, or whose work predates the binding, fall into
  **"Unattributed"**. No historical back-fill.
- Cache pricing tiers are irrelevant here (tokens-only), so they are
  not modeled.

## Testing

- **Pure parser**: usage extraction, day bucketing, multi-model lines,
  missing-`usage` lines, timestamp→local-day mapping.
- **Cursor**: append → only new bytes parsed; truncation → full
  reparse; missing file → stale-but-keep.
- **Rollup SQL**: attribution to task, period filter, project filter,
  Unattributed bucket, worklog-minutes join.
- **Hook**: `useTokensByTicket` refresh + error surface.

Estimated ~12–15 new tests. Keeps the suite green (≥552 currently).
