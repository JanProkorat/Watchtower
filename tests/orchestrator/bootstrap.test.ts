import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';

// Spins up a real orchestrator (DB migrations + HTTP listener on a real port).
// Under heavy parallel-suite CPU contention this can exceed vitest's default
// 5s timeout; give it headroom so a transient slow boot isn't a false failure.
vi.setConfig({ testTimeout: 30_000 });
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { bootstrap, type BootstrapHandle, type DbHandle } from '../../orchestrator/bootstrap.js';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function nodeSqliteFactory(dbPath: string): DbHandle {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  const sqlite = db as unknown as SqliteLike;
  runMigrations(sqlite);
  return { raw: sqlite, close: () => db.close() };
}

describe('bootstrap', () => {
  let dir: string;
  let handle: BootstrapHandle | null = null;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'wt-'));
  });

  afterEach(async () => {
    await handle?.shutdown();
    handle = null;
  });

  it('opens DB, starts listener, writes sidecar + token', async () => {
    handle = await bootstrap({ supportDir: dir, portRange: [17500, 17510], dbFactory: nodeSqliteFactory, timetrackerMigration: { skip: true } });
    expect(handle.listener.port).toBeGreaterThanOrEqual(17500);
    expect(existsSync(path.join(dir, 'data.db'))).toBe(true);
    expect(existsSync(path.join(dir, 'listener.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'hook-token'))).toBe(true);
    const sidecar = JSON.parse(readFileSync(path.join(dir, 'listener.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    expect(sidecar.port).toBe(handle.listener.port);
    expect(sidecar.token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reuses an existing token if hook-token exists', async () => {
    const existing = 'a'.repeat(64);
    writeFileSync(path.join(dir, 'hook-token'), existing, { mode: 0o600 });
    handle = await bootstrap({ supportDir: dir, portRange: [17500, 17510], dbFactory: nodeSqliteFactory, timetrackerMigration: { skip: true } });
    const sidecar = JSON.parse(readFileSync(path.join(dir, 'listener.json'), 'utf8')) as { token: string };
    expect(sidecar.token).toBe(existing);
  });

  it('writes hook events to the DB via the listener', async () => {
    const seen: Array<{ event: string; instanceId: string }> = [];
    handle = await bootstrap({
      supportDir: dir,
      portRange: [17500, 17510],
      dbFactory: nodeSqliteFactory,
      timetrackerMigration: { skip: true },
      onHookEvent: async (event, _body, instanceId) => {
        seen.push({ event, instanceId });
      },
    });

    // hook_events.instance_id has a FK to instances(id) — in production the
    // orchestrator inserts the instance row at spawn time before any hook can
    // fire, but the test has to seed it explicitly.
    handle.db
      .prepare(
        `INSERT INTO instances (id, cwd, status, spawned_at, last_activity_at)
         VALUES ('inst-42', '/tmp', 'spawning', 0, 0)`,
      )
      .run();

    const http = await import('node:http');
    const token = readFileSync(path.join(dir, 'hook-token'), 'utf8').trim();
    const body = JSON.stringify({ session_id: 'sess-1', cwd: '/tmp' });
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: handle!.listener.port,
          method: 'POST',
          path: '/hooks/Notification',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            'x-watchtower-instance': 'inst-42',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    expect(status).toBe(204);
    expect(seen).toEqual([{ event: 'Notification', instanceId: 'inst-42' }]);

    // The event should have been persisted to the hook_events table.
    const rows = handle!.db
      .prepare(`SELECT event_name, instance_id FROM hook_events WHERE instance_id = 'inst-42'`)
      .all() as Array<{ event_name: string; instance_id: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.event_name).toBe('Notification');
  });
});
