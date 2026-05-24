import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
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
  /**
   * Override TimeTracker migration behaviour. Pass `{ skip: true }` to bypass
   * entirely (tests do this unless explicitly exercising the migration path).
   * Pass migrate options to override source path / source opener.
   */
  timetrackerMigration?: { skip: true } | MigrateOptions;
}

export interface BootstrapHandle {
  db: SqliteLike;
  listener: HookListenerHandle;
  /** Result of the TimeTracker absorption migration attempted on startup. */
  timetrackerMigration: MigrationStatus | { status: 'skipped' };
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
  });

  writeListenerSidecar(path.join(opts.supportDir, 'listener.json'), {
    port: listener.port,
    token,
    writtenAt: Date.now(),
  });

  return {
    db: dbHandle.raw,
    listener,
    timetrackerMigration: ttResult,
    async shutdown() {
      await listener.stop();
      dbHandle.close();
    },
  };
}
