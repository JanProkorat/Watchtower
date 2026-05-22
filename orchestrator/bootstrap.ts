import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { openDb } from './db/connection.js';
import { startHookListener, type HookListenerHandle } from './hookListener.js';
import { writeListenerSidecar } from './listenerSidecar.js';
import { HookEventsRepo } from './db/repositories/hookEvents.js';
import type { SqliteLike } from './db/migrations.js';

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
}

export interface BootstrapHandle {
  db: SqliteLike;
  listener: HookListenerHandle;
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
    async shutdown() {
      await listener.stop();
      dbHandle.close();
    },
  };
}
