# Watchtower

> The personal vantage point. macOS Electron app that watches every running
> Claude Code instance and notifies the moment one needs input.

Multi-tab embedded terminals, hook-driven state tracking, native
notifications, tray badge, quit-with-suspend and start-with-resume. Plus a
bundled TimeTracker module — projects, worklogs, contracts, task grid,
Czech-locale time off, reports.

## Quick start

```bash
npm install
npm run dev          # Vite renderer + tsc-watch on main/orch; opens the app
npm test             # vitest (~3.5s, 219+ tests)
npm run dist:mac     # unsigned .dmg + .app in ./release
```

Drop the resulting `.app` into `/Applications`, right-click → Open the
first time (it's unsigned).

## Architecture

Three processes inside one Electron app:

- **Renderer** — React + MUI + xterm.js. Hosts the module rail
  (Instances + TimeTracker), tab strip, terminals.
- **Electron main** — windowing, tray, macOS notifications, IPC bridge.
- **Orchestrator** — Node `utilityProcess` child. Owns the pty sessions,
  the localhost HTTP listener that hook events POST to, the SQLite store,
  and the per-instance state machine.

Plus a bundled `watchtower-hook` helper installed into
`~/.claude/settings.json` that forwards Claude Code's hook payloads to
the orchestrator.

Full design + decision log lives in [`PROTOTYPE.md`](PROTOTYPE.md).
Project-specific Claude Code working notes are in [`CLAUDE.md`](CLAUDE.md).

## TimeTracker absorption — migration runbook

Watchtower has absorbed the standalone TimeTracker app
(`/Users/jan/Projects/TimeTracker`). The legacy schema (projects, epics,
tasks, worklogs, contracts/rates, days off) is ported verbatim into the
Watchtower SQLite DB.

### When migration runs

Automatically, at orchestrator bootstrap (`orchestrator/db/connection.ts`).
The trigger is idempotent — a marker row in `settings`
(`timetracker_migration_status`) makes re-runs a no-op once it has
completed.

### What gets backed up

The source DB at `~/Library/Application Support/timetracker/data.db` is
renamed to `data.db.migrated-<YYYYMMDD-HHMMSS>.bak` once the row copy
commits. **The file is never deleted.** Manual rollback is always
possible.

### How to verify

```bash
# Marker present?
sqlite3 ~/Library/Application\ Support/Watchtower/data.db \
  "SELECT value FROM settings WHERE key = 'timetracker_migration_status';"

# Backup present?
ls -la ~/Library/Application\ Support/timetracker/*.bak

# Row counts (compare to TT's data.db.<…>.bak before deleting)
sqlite3 ~/Library/Application\ Support/Watchtower/data.db \
  "SELECT 'projects:', COUNT(*) FROM projects UNION ALL
   SELECT 'worklogs:', COUNT(*) FROM worklogs UNION ALL
   SELECT 'days_off:', COUNT(*) FROM days_off;"
```

### Manual rollback

If anything looks wrong after the migration:

1. Quit Watchtower.
2. Move the `.bak` back to its original name:
   ```bash
   cd ~/Library/Application\ Support/timetracker
   mv data.db.migrated-<ts>.bak data.db
   ```
3. Drop the migration marker so a future Watchtower start can re-run:
   ```bash
   sqlite3 ~/Library/Application\ Support/Watchtower/data.db \
     "DELETE FROM settings WHERE key = 'timetracker_migration_status';"
   ```
4. Optionally delete the rows that Watchtower already imported (they
   share PKs with the TT source, so a re-run would otherwise collide
   on insert).

### Why TimeTracker.app is not removed

Dogfooding safety net for the first week. Once the absorbed data has
proven itself in daily use, drag `/Applications/TimeTracker.app` to the
Trash manually. The Watchtower DB has been the source of truth since
the first successful migration.

## Repository layout

```
client/         renderer (React + MUI + xterm)
electron/       main process (windowing, tray, IPC bridge)
orchestrator/   Node utilityProcess child (pty, hooks, SQLite, state machine)
helper/         bundled watchtower-hook (esbuild-built CLI for ~/.claude/settings.json)
shared/         tagged-union IPC contracts shared by all three
tests/          vitest specs (orchestrator + renderer)
docs/           design spec, implementation plans, working notes
```

## License

Private; single-user project. No license granted.
