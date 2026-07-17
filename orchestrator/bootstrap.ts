import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { resolveWsRemoteBind, formatIpadConnectionInfo } from './remoteBind.js';
import { openDb } from './db/connection.js';
import { startHookListener, type HookListenerHandle } from './hookListener.js';
import { writeListenerSidecar } from './listenerSidecar.js';
import { HookEventsRepo } from './db/repositories/hookEvents.js';
import type { SqliteLike } from './db/migrations.js';
import {
  migrateTimetracker,
  type MigrationStatus,
  type MigrateOptions,
} from './db/migrateTimetracker.js';
import { startWsBridge, type WsBridgeHandle } from './wsBridge.js';
import type { OrchRequest } from '@watchtower/shared/messagePort.js';
import { createPgStore, evaluateHubGuard, type PgStore } from './db/pg/pool.js';
import { runPgMigrations } from './db/pg/migrate.js';
import { SyncService } from './sync/service.js';
import { SettingsRepo } from './db/repositories/settings.js';

export interface DbHandle {
  /** Whatever the underlying driver exposes — better-sqlite3 in prod, node:sqlite in tests. */
  raw: SqliteLike;
  close(): void;
}

export interface BootstrapOptions {
  supportDir: string;
  portRange: [number, number];
  /** Override for tests — defaults to a real better-sqlite3 opened from supportDir/data.db. */
  dbFactory?: (dbPath: string) => DbHandle;
  onHookEvent?: (event: string, body: unknown, instanceId: string) => Promise<void>;
  onStatusline?: (body: unknown, instanceId: string) => Promise<void> | void;
  /**
   * Override TimeTracker migration behaviour. Pass `{ skip: true }` to bypass
   * entirely (tests do this unless explicitly exercising the migration path).
   * Pass migrate options to override source path / source opener.
   */
  timetrackerMigration?: { skip: true } | MigrateOptions;
  /**
   * Required for the WS bridge. Pass `handleRequest` from index.ts here
   * (rather than importing it) to avoid a circular dependency:
   * index.ts → bootstrap.ts → index.ts.
   * Omitting this causes any inbound WS request to throw rather than silently
   * succeed. Pass it explicitly whenever the WS path will be exercised.
   */
  handleRequest?: (req: OrchRequest, origin?: string) => Promise<unknown>;
  /**
   * Called when a WS client disconnects. Pass `handleClientGone` from index.ts
   * to re-apply the surviving client's pty dimensions after the owner leaves.
   */
  onClientGone?: (clientId: string) => void;
  /** Host for the WS bridge server. Defaults to '127.0.0.1'. */
  wsHost?: string;
  /** Port for the WS bridge server. 0 = ephemeral (good for tests). Defaults to 0. */
  wsPort?: number;
  /**
   * Called on the same daily cadence as the tombstone purge (i.e. whenever a
   * sync cycle actually ran it — see SyncCycleResult.purge). index.ts wires
   * this to attentionRelay.pruneClosedThreads(14); attentionRelay is created
   * after bootstrap() resolves, so this fires via closure over that
   * module-scoped variable, never called synchronously during bootstrap.
   */
  onPurgeDue?: () => void;
}

export interface BootstrapHandle {
  db: SqliteLike;
  pg: PgStore | null;
  sync: SyncService;
  listener: HookListenerHandle;
  /** Result of the TimeTracker absorption migration attempted on startup. */
  timetrackerMigration: MigrationStatus | { status: 'skipped' };
  wsBridge: WsBridgeHandle;
  shutdown(): Promise<void>;
}

function readOrCreateToken(supportDir: string): string {
  const file = path.join(supportDir, 'hook-token');
  if (existsSync(file)) {
    return readFileSync(file, 'utf8').trim();
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, token, { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

function defaultDbFactory(dbPath: string): DbHandle {
  const db = openDb(dbPath);
  return {
    raw: db as unknown as SqliteLike,
    close: () => db.close(),
  };
}

export async function bootstrap(opts: BootstrapOptions): Promise<BootstrapHandle> {
  const dbFactory = opts.dbFactory ?? defaultDbFactory;
  const dbHandle = dbFactory(path.join(opts.supportDir, 'data.db'));

  // Optional Postgres hub. Construction never connects eagerly — a bad URL only
  // surfaces on first query, so an outage can't block startup.
  //
  // Cross-environment guard: refuse the hub when the local data store and the
  // resolved hub belong to different environments (the `WATCHTOWER_ENV=production
  // npm run dev` footgun — dev SQLite would migrate/push into prod). A blocked
  // hub stays null, so the desktop runs SQLite-only and never dials the wrong DB.
  const hubGuard = evaluateHubGuard({ supportDir: opts.supportDir });
  const pg = hubGuard.allow ? createPgStore() : null;
  if (!hubGuard.allow) {
    console.warn(`[orchestrator] Supabase hub disabled: ${hubGuard.reason}`);
  }
  if (pg) {
    try { await runPgMigrations(pg); }
    catch (err) { console.error('[orchestrator] pg migrations failed (sync dormant):', err); }
  }

  // One-time backfill: re-derive the Postgres-only billing columns onto worklog
  // rows that synced before those columns existed. Guarded by a settings flag;
  // only runs when pg is configured.
  //
  // The push is LWW-guarded (`ON CONFLICT … WHERE updated_at < EXCLUDED.updated_at`,
  // see sync/push.ts), so merely resetting the push cursor is NOT enough: the
  // re-pushed rows carry an UNCHANGED updated_at, the guard's `X < X` is false, and
  // the UPDATE is skipped — the derived columns stay null. We therefore BUMP
  // updated_at on every live worklog, which both re-selects them (updated_at >
  // cursor) and lets the upsert pass the LWW guard so the derived fields are written.
  // Flag is versioned: v1 marked the earlier, ineffective cursor-only attempt; v2
  // forces the corrected backfill to run once even where v1 already "completed".
  const BACKFILL_FLAG = 'sync.backfill.worklogs_billing.v2.done';
  if (pg) {
    const settings = new SettingsRepo(dbHandle.raw);
    const done = settings.getString(BACKFILL_FLAG, '');
    if (!done) {
      dbHandle.raw
        .prepare(`UPDATE worklogs SET updated_at = ? WHERE deleted_at IS NULL`)
        .run(new Date().toISOString());
      settings.set(BACKFILL_FLAG, '1');
    }
  }

  // Surface cycle outcomes: failures were previously swallowed (no onCycle), so
  // a broken sync looked identical to an idle one (cursor just never advanced).
  // Success is debug-gated to keep the steady state quiet.
  const syncDebug = process.env.WATCHTOWER_SYNC_DEBUG === '1';
  const sync = new SyncService({
    db: dbHandle.raw,
    store: pg,
    onCycle: (r) => {
      if (!r.ok) {
        console.error('[sync] cycle failed:', r.error);
      } else if (syncDebug && (r.push || r.pull)) {
        console.debug('[sync] cycle ok:', { push: r.push, pull: r.pull });
      }
      // r.purge is only populated when purgeDue() actually let the tombstone
      // sweep run this cycle (throttled to once/day) — piggyback the
      // attention-thread retention prune on that exact same cadence.
      if (r.purge) opts.onPurgeDue?.();
    },
  });
  sync.start();

  // One-shot import of legacy TimeTracker data. Idempotent — the function
  // returns `no-source` when there's nothing to import and `already-migrated`
  // once the marker is set, so calling it every startup is safe and free.
  let ttResult: BootstrapHandle['timetrackerMigration'];
  const ttOpt = opts.timetrackerMigration;
  if (ttOpt && 'skip' in ttOpt) {
    ttResult = { status: 'skipped' };
  } else {
    ttResult = migrateTimetracker(dbHandle.raw, ttOpt);
  }

  const token = readOrCreateToken(opts.supportDir);
  const hookEvents = new HookEventsRepo(dbHandle.raw);

  const listener = await startHookListener({
    token,
    portRange: opts.portRange,
    onEvent: async (event, body, instanceId) => {
      hookEvents.append(instanceId, event, body, Date.now());
      if (opts.onHookEvent) {
        await opts.onHookEvent(event, body, instanceId);
      }
    },
    onStatusline: opts.onStatusline,
  });

  writeListenerSidecar(path.join(opts.supportDir, 'listener.json'), {
    port: listener.port,
    token,
    writtenAt: Date.now(),
  });

  const remote = resolveWsRemoteBind(process.env, networkInterfaces() as never);
  const wsBridge = await startWsBridge({
    host: remote?.host ?? opts.wsHost ?? '127.0.0.1',
    port: remote?.port ?? opts.wsPort ?? 0,
    token,
    handleRequest: opts.handleRequest ?? (() => { throw new Error('handleRequest not wired'); }),
    onClientGone: opts.onClientGone,
  });
  if (remote) {
    console.log(formatIpadConnectionInfo({ host: remote.host, port: wsBridge.port, token }));
  }

  return {
    db: dbHandle.raw,
    pg,
    sync,
    listener,
    timetrackerMigration: ttResult,
    wsBridge,
    async shutdown() {
      await wsBridge.stop();
      await listener.stop();
      sync.stop();
      if (pg) await pg.end();
      dbHandle.close();
    },
  };
}
