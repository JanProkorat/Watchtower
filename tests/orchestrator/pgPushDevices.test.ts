import { test, expect } from 'vitest';
import { readPgPushTokens } from '../../orchestrator/db/repositories/pgPushDevices.js';

test('readPgPushTokens returns [] when pg is null', async () => {
  expect(await readPgPushTokens(null as never)).toEqual([]);
});

test('readPgPushTokens maps rows to {token,bundleId}', async () => {
  const pg = { query: async () => ({ rows: [
    { apns_token: 'a', bundle_id: 'cz.greencode.watchtower.ios' },
    { apns_token: 'b', bundle_id: 'cz.greencode.watchtower.ipad' },
  ] }) };
  expect(await readPgPushTokens(pg as never)).toEqual([
    { token: 'a', bundleId: 'cz.greencode.watchtower.ios' },
    { token: 'b', bundleId: 'cz.greencode.watchtower.ipad' },
  ]);
});
