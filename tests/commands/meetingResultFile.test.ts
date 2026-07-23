import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations } from '../../orchestrator/db/migrations.js';

// node:sqlite is a Node experimental builtin that Vite's ESM resolver can't
// load via a static `import`; every other test in this suite loads it via
// createRequire (see tests/orchestrator/soft-delete.test.ts).
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const RESULT = '/tmp/watchtower-meeting-result.json';

function tmpDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wt-mr-'));
  const dbPath = join(dir, 'data.db');
  const db = new DatabaseSync(dbPath);
  runMigrations(db);
  db.close();
  return dbPath;
}

it('write-meetings-cache emits {ok,count} result file', () => {
  if (existsSync(RESULT)) rmSync(RESULT);
  const dbPath = tmpDb();
  const input = join(mkdtempSync(join(tmpdir(), 'wt-in-')), 'm.json');
  writeFileSync(input, JSON.stringify({ meetings: [
    { id: 'a', subject: 'Standup', subtitle: '', startsAt: '2026-07-23T07:15:00Z', endsAt: '2026-07-23T07:30:00Z', joinUrl: null },
  ] }));
  const script = join(process.cwd(), '.claude/commands/write-meetings-cache.mjs');
  execFileSync('node', [script, input, dbPath]);
  const res = JSON.parse(readFileSync(RESULT, 'utf8'));
  expect(res.ok).toBe(true);
  expect(res.count).toBe(1);
});
