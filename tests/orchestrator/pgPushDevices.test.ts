import { describe, it, expect, vi } from 'vitest';
import { readPgPushTokens } from '../../orchestrator/db/repositories/pgPushDevices';

describe('readPgPushTokens', () => {
  it('returns [] when pg is null', async () => {
    expect(await readPgPushTokens(null)).toEqual([]);
  });
  it('selects apns_token values', async () => {
    const pg = { query: vi.fn(async () => ({ rows: [{ apns_token: 'a' }, { apns_token: 'b' }] })) };
    expect(await readPgPushTokens(pg)).toEqual(['a', 'b']);
  });
});
