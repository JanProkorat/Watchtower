# Watchtower — Dashboard module

Date: 2026-05-25
Status: Approved design, pending implementation plan

## 1. Context & motivation

Watchtower's left rail has four modules: Instances, TimeTracker, Settings, and
a disabled Dashboard slot. The original TimeTracker app (now deleted, schema
absorbed) had a Dashboard landing page that gave an "at a glance" snapshot of
recent work — KPI tiles, a 7-day strip, a 30-day heatmap with streak stats,
top projects this month — plus a project filter at the top.

This spec wires that Dashboard up as Watchtower's new default landing module
and additionally adds a "Sessions" card that surfaces the user's running
Watchtower instances with one-click navigation into the Instances module.
The Sessions card lives inline with the rest of the dashboard panels (no
separate sidebar / no secondary scroll context).

The Reports tab inside TimeTracker stays as-is; Dashboard and Reports are
intentionally different lenses on the same underlying data (Dashboard = today
+ this week + this month at a glance; Reports = arbitrary range + granularity
+ charts).

## 2. Scope

### In scope

- New `Dashboard` module in the left rail (enable existing slot in `ModuleRail.tsx`).
- Top header: title "Dashboard" + project filter dropdown (right) + today's localized Czech date.
- KPI tiles (3 across): TODAY / THIS WEEK / THIS MONTH, each showing hours
  with one decimal.
- "This week" panel: 7-day Mon→Sun strip, today highlighted, each day cell
  renders that day's worklog list (task, project colour, minutes) or "—",
  with prev / today / pick-date / next controls in the panel header.
- "Sessions" card (inline, immediately below "This week"): two-column grid
  ("Live" left, "Recent" right), each column listing instance cards with
  status chip, full cwd, relative time, "Open" button (switches active
  module to `instances` and focuses the instance), and a small kill
  icon button on live rows. Per-column empty states.
- "Last 30 days" panel: heatmap (reusing `Heatmap` from charts/) + streak
  stats row (current streak, longest streak, active days, weekly avg, busiest day).
- "Top projects this month" card: list of projects with logged minutes in the
  current calendar month, sorted desc, with project colour dots.
- Project filter (top-right) — applies to KPIs + week + heatmap + top
  projects. Does NOT filter the Sessions card.
- Dashboard becomes the default landing module on first launch; subsequent
  launches restore the last-active module via `localStorage`.

### Out of scope

- Editing or quick-logging worklogs from the Dashboard (read-only surface).
- Notifications, alerts, or "you've worked X hours today, take a break" UX.
- Cross-project comparison views (Reports tab already does this).
- Currency / earnings tiles (the original TT Dashboard didn't show them; Reports does).
- Customisable widget order or hidden panels.
- Time-off awareness on the heatmap (off-days are simply low/zero cells).
- Compact / mobile / responsive variant — Watchtower is desktop-only.

## 3. Architecture

### 3.1 Modules and files

```
client/src/components/dashboard/
  ModuleDashboard.tsx          — root, owns project filter + week anchor state
  DashboardHeader.tsx          — title, project select, localized date
  KpiTiles.tsx                 — three tiles, reads `today` / `week` / `month` minutes
  WeekStrip.tsx                — 7-day strip with paging controls
  WeekDayCell.tsx              — single day card; renders worklog list
  SessionsCard.tsx             — two-column inline card (Live | Recent)
  SessionRow.tsx               — chip / cwd / time / Open / kill row
  LastThirtyDays.tsx           — heatmap + streak stats row
  TopProjectsCard.tsx          — sorted list of projects this month

client/src/state/
  useDashboardOverview.ts      — single-IPC fetcher hook (project + weekAnchor deps)
  useActiveModule.ts           — Default = 'dashboard', persists last-active to localStorage

orchestrator/services/
  dashboardOverview.ts         — DashboardOverviewService — aggregates KPIs / week / heatmap / topProjects
```

Reuse from existing code:

- `Heatmap` (`client/src/components/timetracker/charts/Heatmap.tsx`) — same
  cell renderer is used for the 30-day grid; the rest is just a stats row
  beneath.
- `formatDate*`, `formatMinutesAsHours` helpers in `client/src/util/format.ts`.
- `useToast` for instance Open / Kill errors.
- `useInstances` (already mounted in `App.tsx`) — passed as a prop into
  `ModuleDashboard` rather than re-mounted.
- `repo()`, `db` access in orchestrator follows the same pattern as
  `ReportsService`.

### 3.2 Data flow (first paint)

```
ModuleDashboard
  ├── useDashboardOverview(projectId, weekAnchor)
  │     └─ invoke('dashboard:overview', { projectId, weekAnchor, todayDate })
  │           └─ DashboardOverviewService.run(...)
  │                 ├─ today():       SUM(minutes) WHERE date = todayDate [+ projectId]
  │                 ├─ week(anchor):  rows by day in [monday(anchor), sunday(anchor)]
  │                 ├─ month():       SUM(minutes) WHERE date IN current month
  │                 ├─ heatmap30d():  rows by day in last 30 days + stats
  │                 └─ topProjects(): GROUP BY project, current calendar month
  │
  ├── SessionsCard
  │     └─ reads instances prop (already kept fresh by useInstances)
  └── DashboardHeader
        └─ reads `projects` prop for the project filter dropdown
```

Single round-trip; one `loading` and one `error` state in the renderer.

### 3.3 IPC contract

New entries in `shared/ipcContract.ts`:

```ts
| { kind: 'dashboard:overview'; payload: DashboardOverviewRequestPayload }
```

```ts
export interface DashboardOverviewRequestPayload {
  /** Optional project filter; null = all projects. */
  projectId: number | null;
  /** Any ISO date inside the target week. Server normalises to Monday. */
  weekAnchor: string;
  /** ISO yyyy-mm-dd in the user's local tz, sent by renderer so the
   * orchestrator doesn't try to derive "today" from its own clock. */
  todayDate: string;
}

export interface DashboardOverviewResponse {
  today: { minutes: number };
  month: { minutes: number };
  week: {
    fromDate: string;            // yyyy-mm-dd Monday
    toDate: string;              // yyyy-mm-dd Sunday
    totalMinutes: number;
    days: DashboardWeekDayPayload[];   // length 7, Mon→Sun
  };
  heatmap30d: {
    fromDate: string;
    toDate: string;
    days: { date: string; minutes: number }[];
    stats: {
      currentStreak: number;       // days
      longestStreak: number;       // days
      activeDays: number;          // distinct days with minutes > 0
      weeklyAvgMinutes: number;    // total / 30 * 7, rounded
      busiestDay: { date: string; minutes: number } | null;
    };
  };
  topProjects: {
    projectId: number;
    projectName: string;
    projectColor: string | null;
    minutes: number;
  }[];
}

export interface DashboardWeekDayPayload {
  date: string;                    // yyyy-mm-dd
  minutes: number;                 // sum for the day
  worklogs: {
    id: number;
    taskNumber: string | null;     // e.g. "FIE1933-19084"
    projectName: string;
    projectColor: string | null;
    minutes: number;
    note: string | null;
  }[];
}
```

Mirrored into `shared/messagePort.ts` and handled in `orchestrator/index.ts`
via a new `case 'dashboard:overview'` that calls
`new DashboardOverviewService(handle!.db).run(req.payload)`.

### 3.4 Persistence: active module

A new `useActiveModule()` hook replaces the `useState<ModuleId>('instances')`
line in `App.tsx`:

```ts
export function useActiveModule(): [ModuleId, (m: ModuleId) => void] { /* ... */ }
```

- Reads `watchtower.activeModule` from `localStorage`, falling back to
  `'dashboard'` if unset or invalid.
- Mirrors every change back to `localStorage`.
- Same defensive try/catch pattern as `useInstances`' `activeId` persistence.
- The TT launch bridge already calls `setActiveModule('instances')`; that
  path continues to work and naturally updates the persisted value too.

The `enabled: false` flag on the Dashboard entry in `ModuleRail.tsx` flips
to `true`.

### 3.5 Instance navigation hop

`SessionsCard` exposes an `onActivateInstance(id: string) => void` prop.
`ModuleDashboard` receives this from `App.tsx` and the implementation already
exists as `switchToInstance` (line 247 of `App.tsx`) — same callback the TT
launch bridge uses. The "Open" button on each `SessionRow` calls it; no new
code in `App.tsx` beyond plumbing it into the Dashboard branch.

Kill button on live rows calls `useInstances().kill(id)` directly; failures
surface via `useToast().showError`.

## 4. UI details

### 4.1 Header

- Sticky at the top of the dashboard scroll container, like Reports' filter
  bar. `position: sticky; top: 0; zIndex: 2`.
- Left: `<Typography variant="h5">Dashboard</Typography>`.
- Right (stacked vertically):
  - Project select — small MUI `TextField select`, options = `All projects`
    + projects from `useProjects()` (non-archived). Persists last-selected
    project to `localStorage` (`watchtower.dashboard.projectId`).
  - Localized date — `formatWeekdayDateLongCz(todayIso)` from
    `client/src/util/format.ts`, e.g. "pondělí 25. května 2026".
    `Typography variant="body2" color="text.secondary"`.

### 4.2 KPI tiles

- `Grid container spacing={2}` with three `Grid item xs={12} md={4}`.
- Each tile: rounded `Paper variant="outlined"`, small icon (CalendarToday),
  uppercase label ("TODAY" / "THIS WEEK" / "THIS MONTH") in
  `text.secondary`, large `h3`-ish number ("0.0") + subdued "hours" suffix.
- Hours formatting: reuse `formatHours(minutes, 1)` from
  `client/src/util/format.ts` — already returns one-decimal cs-comma output
  (e.g. `1,5`).

### 4.3 "This week" panel

- `Paper variant="outlined"` wrapper.
- Header row:
  - Left: title "This week", small total-minutes chip ("0m" or "4h 30m").
  - Subtitle: `25. května 2026 — 31. května 2026` (cs locale, range).
  - Right: prev / today / date-pick / next icon buttons. Today button is a
    calendar icon; date-pick opens a popover `DatePicker` that snaps to the
    Monday of the picked week.
- Body: CSS grid, 7 equal columns. Each column is a `WeekDayCell`.
  - Cell header: weekday abbrev ("PO".."NE") + `D. M.` date.
  - Today's cell gets `borderColor: 'error.main'` and a red tint on the
    weekday abbrev — matching the TT design.
  - Cell body: vertical stack of worklog rows. Each row: small coloured
    square (project colour), task number (monospace 11px), minutes right-aligned
    (e.g. "30m" or "1h 15m"), optional note as a second line in `text.secondary`.
  - Empty cell renders a centered "—" placeholder.

### 4.4 "Last 30 days" panel

- `Paper variant="outlined"` wrapper.
- Title "Last 30 days".
- Body: two columns on `md+`, single column on `xs`.
  - Left: `Heatmap` reused from charts/. The 30-day window means roughly 4-5
    columns; component already handles arbitrary date ranges. Pass
    `from = heatmap30d.fromDate`, `to = heatmap30d.toDate`,
    `data = heatmap30d.days`.
  - Right: stats list — 5 mini stat blocks (label + value).
    - `Current streak`: `Nd` (0d if none).
    - `Longest streak`: `Nd`.
    - `Active days`: `N`.
    - `Weekly avg`: `1,5h` (one decimal, cs comma).
    - `Busiest day`: `D. M.` + `(Xh)` or `—`.

### 4.5 "Top projects this month"

- `Paper variant="outlined"` wrapper.
- Title "Top projects this month".
- Body: vertical list, max 8 rows. Each row: coloured dot, project name (1-line
  ellipsis), minutes right-aligned in hours.
- Empty state: `text.secondary` body "No projects with logged time this month."

### 4.6 Sessions card

- Inline `Paper variant="outlined"` directly below the "This week" panel
  (no sidebar, no independent scroll context). Spans the full width of the
  dashboard column.
- Title row: "Sessions".
- Body: `Grid container spacing={2}` with two `Grid item xs={12} md={6}` —
  "Live" left, "Recent" right.
  - "Live" — instances where `status ∈ {spawning, working, waiting-permission,
    waiting-input, idle-notify, resuming}`. Column header: "Live" label
    + count chip.
  - "Recent" — `status ∈ {finished, crashed, suspended}`, capped at 5 most
    recently touched. Column header: "Recent" + count chip.
- Each column renders `SessionRow` items vertically stacked.
- `SessionRow` layout (horizontal — comfortably wide since not sidebar-constrained):
  - Status `Chip size="small"` (lowercase, colour per existing `chipColorFor`
    map, fixed min-width so chips align).
  - `Stack` body: monospace full `cwd` with ellipsis on overflow + relative
    time underneath in `text.secondary`.
  - Actions on the right: "Open" `Button size="small"` (primary on live,
    plain on recent) + icon-only kill `IconButton` (`StopIcon`, only on
    live rows).
- Per-column empty state: muted "No live sessions" / "No recent sessions"
  copy, dashed-border card. The "Live" empty state also shows a
  `Button size="small"` "Start a new instance" → triggers
  `triggerNewInstance` IPC (same path as TabStrip's `+` button).

### 4.7 Layout grid for the page

```
┌─────────────────────────────────────────────────────────────┐
│ DashboardHeader (sticky)                                    │
├─────────────────────────────────────────────────────────────┤
│ KpiTiles                                                    │
├─────────────────────────────────────────────────────────────┤
│ WeekStrip                                                   │
├─────────────────────────────────────────────────────────────┤
│ SessionsCard:  Live │ Recent                                │
├──────────────────────────────────┬──────────────────────────┤
│ LastThirtyDays                   │ TopProjectsCard          │
└──────────────────────────────────┴──────────────────────────┘
```

Single scroll context: the dashboard column uses `flex: 1; overflow: auto`.
No sidebar, no inner scroll regions.

## 5. Czech locale specifics

- Weekday abbrevs: `['PO','ÚT','ST','ČT','PÁ','SO','NE']` (Mon-first).
- Day header date format: `D. M.` (no leading zeros).
- Header full date: `dayjs(...).locale('cs').format('dddd D. MMMM YYYY')`
  e.g. "pondělí 25. května 2026". Lowercase weekday in cs locale is the
  norm; do NOT capitalise.
- Hours number format: cs decimal comma — reuse `formatHours(minutes, 1)`
  from `client/src/util/format.ts`.
- Week start: ISO Monday. `dayjs(date).isoWeekday(1)` to snap to the week's
  Monday; `dayjs.extend(isoWeek)` if not already extended.
- All date strings on the wire are ISO `yyyy-mm-dd` — locale formatting is a
  client-side render concern only.

## 6. Default-module restore behaviour

| Scenario                                          | Result                       |
|---------------------------------------------------|------------------------------|
| First launch ever                                 | Lands on Dashboard           |
| Last session ended on Dashboard                   | Lands on Dashboard           |
| Last session ended on Instances / TT / Settings   | Lands on that module         |
| Invalid / corrupted `watchtower.activeModule`     | Falls back to Dashboard      |
| TT launch bridge fires before user switches       | Lands on Instances (override)|

The persisted key is updated on every `setActiveModule` call, including the
launch-bridge override. That's intentional: if the bridge pushes the user
into Instances, the next launch resumes there.

## 7. Error handling

| Surface              | Failure                          | UX                                                    |
|----------------------|----------------------------------|-------------------------------------------------------|
| `dashboard:overview` | IPC reject / SQL error           | Inline `<Alert severity="error">` at top of main col  |
| Project filter load  | `projects:list` reject           | Same alert; dropdown shows "All projects" only        |
| Instance Open hop    | `switchToInstance` throws        | toast via `useToast().showError`                       |
| Instance Kill        | `useInstances().kill` rejects    | toast via `useToast().showError`                       |
| Start-new-instance   | `triggerNewInstance` reject      | toast via `useToast().showError`                       |
| `localStorage` quota | persist failure                  | Swallow silently — same pattern as `useInstances`     |

No silent `void state.foo()`.

## 8. Testing

Following the project convention "always 219+ tests; if a phase adds code,
add tests":

**Server (`orchestrator/services/dashboardOverview.test.ts`):**
- Today / week / month KPI sums respect the optional projectId filter.
- Week boundaries align to ISO Monday across DST shifts.
- Heatmap returns a row per day in the 30-day window (filled with 0 minutes
  when nothing logged that day).
- Streak computation: current streak counts back from today through
  consecutive non-zero days; resets at any zero day; respects local-tz
  `todayDate` passed in.
- `longestStreak` ≥ `currentStreak` always.
- `topProjects` is sorted by minutes desc and excludes projects with 0 minutes.

**Renderer hook (`client/src/state/useDashboardOverview.test.tsx`):**
- Refetches when `projectId` changes.
- Refetches when `weekAnchor` changes.
- Surfaces error state when IPC rejects.
- Does NOT refetch on every render of unrelated state.

**Components (vitest + RTL):**
- `KpiTiles`: renders three tiles with one-decimal hours; cs locale comma.
- `WeekDayCell`: today flag applies error border; empty state renders "—";
  worklog rows render minutes with project colour swatch.
- `WeekStrip`: prev / next shift the anchor by 7 days; "today" button snaps
  to current week.
- `TopProjectsCard`: empty state copy renders; non-empty rows sorted desc.
- `SessionRow`: kill button only renders for live statuses; Open button
  calls `onActivateInstance(id)` with the instance id.
- `SessionsCard`: Live and Recent columns render independently; per-column
  empty states; "Start a new instance" CTA on the Live empty state wires
  to `triggerNewInstance`.

**Integration:**
- `ModuleDashboard` with mocked IPC: first paint shows the loading skeleton,
  then resolves into all panels populated; project filter change triggers a
  second IPC call with the new projectId.

## 9. Performance

The aggregate query touches `worklogs` joined to `tasks` / `epics` /
`projects`. Expected row counts are small (months of personal worklogs),
SQLite indexes already exist on `worklogs(date)` and `worklogs(task_id)`.
No new index needed. Single round-trip keeps first paint at one render
cycle; project filter change re-fetches but at <50 ms in the typical case.

## 10. Open questions

None that block writing the implementation plan. Items intentionally left
out of v1 that may come back as follow-ups:

- Configurable "week start" (currently hard-coded ISO Monday — matches cs
  convention).
- Today's snooze / focus controls in the sidebar (currently lives in
  TabStrip / SettingsPanel).
- Quick-jump-to-TT-detail when clicking a worklog row in a day cell (cell
  is read-only in v1).
- Aggregate cache layer if the overview query ever gets expensive.
