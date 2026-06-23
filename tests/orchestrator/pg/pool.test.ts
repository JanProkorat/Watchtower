import { describe, it, expect } from 'vitest';
import { createPgStore, defaultPgUrl } from '../../../orchestrator/db/pg/pool.js';

const PG_URL = process.env.WATCHTOWER_PG_URL ?? 'postgresql://watchtower:watchtower_dev_password@localhost:5432/watchtower';

describe('createPgStore', () => {
  it('returns null when no connection string is available', () => {
    expect(createPgStore(undefined)).toBeNull();
  });

  it('builds a store from an explicit connection string', () => {
    const store = createPgStore(PG_URL);
    expect(store).not.toBeNull();
  });
});

describe('defaultPgUrl', () => {
  it('prefers the WATCHTOWER_PG_URL env when set', () => {
    const prev = process.env.WATCHTOWER_PG_URL;
    process.env.WATCHTOWER_PG_URL = 'postgresql://x/y';
    try {
      expect(defaultPgUrl()).toBe('postgresql://x/y');
    } finally {
      if (prev === undefined) delete process.env.WATCHTOWER_PG_URL;
      else process.env.WATCHTOWER_PG_URL = prev;
    }
  });
});

describe('PgStore.healthCheck (integration, env-gated)', () => {
  it('returns true against a reachable Postgres, else skips', async () => {
    const store = createPgStore(PG_URL);
    if (!store) return;
    let ok = false;
    try {
      ok = await store.healthCheck();
    } catch {
      console.warn('[pool.test] Postgres unreachable — skipping health-check assertion');
      await store.end();
      return;
    }
    expect(ok).toBe(true);
    await store.end();
  });
});
