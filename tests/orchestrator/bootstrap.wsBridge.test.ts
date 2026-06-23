import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { bootstrap, type DbHandle } from '../../orchestrator/bootstrap.js';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import type { OrchRequest } from '@watchtower/shared/messagePort.js';

// Real WS server starts; give it headroom under contention.
import { vi } from 'vitest';
vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function nodeSqliteFactory(dbPath: string): DbHandle {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  const sqlite = db as unknown as SqliteLike;
  runMigrations(sqlite);
  return { raw: sqlite, close: () => db.close() };
}

async function stubHandleRequest(_req: OrchRequest): Promise<unknown> {
  return { ok: true };
}

describe('bootstrap wires the ws bridge', () => {
  it('exposes a wsBridge handle with a numeric port', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wt-ws-'));
    const handle = await bootstrap({
      supportDir: dir,
      portRange: [17600, 17610],
      dbFactory: nodeSqliteFactory,
      timetrackerMigration: { skip: true },
      handleRequest: stubHandleRequest,
      wsPort: 0,
    });
    try {
      expect(typeof handle.wsBridge.port).toBe('number');
      expect(handle.wsBridge.port).toBeGreaterThan(0);
    } finally {
      await handle.wsBridge.stop();
      await handle.shutdown();
    }
  });
});
