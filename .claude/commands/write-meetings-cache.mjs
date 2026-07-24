#!/usr/bin/env node
// Writes today's Teams/Outlook meetings into the Watchtower `settings` table
// under the `teams.meetings_today` key, in the shape `parseMeetingsToday`
// (packages/shared/src/meetings.ts) expects:
//   { syncedAt: number, meetings: MeetingSummary[] }
// where MeetingSummary = { id, subject, subtitle, startsAt, endsAt, joinUrl }.
//
// Used by the /teams-refresh chat command (see teams-refresh.md) as the final
// step: it hands this script a small JSON file it built from a live Outlook
// calendar search, and this script upserts the settings row.
//
// Usage:
//   node .claude/commands/write-meetings-cache.mjs <meetings.json | -> <db-path>
//
// <meetings.json> is either:
//   - a MeetingSummary[] array, or
//   - { meetings: MeetingSummary[] }
// Entries missing id/subject/startsAt/endsAt are dropped (mirrors the
// parser's tolerant-parse contract). Missing subtitle defaults to '';
// missing/empty joinUrl defaults to null.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SETTINGS_KEY = 'teams.meetings_today';
const RESULT_FILE = '/tmp/watchtower-meeting-result.json';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function parseArgs(argv) {
  const args = { input: null, dbPath: null };
  for (const a of argv) {
    if (!args.input) args.input = a;
    else if (!args.dbPath) args.dbPath = a;
  }
  return args;
}

function readInput(input) {
  if (!input) {
    throw new Error(
      'Usage: node write-meetings-cache.mjs <meetings.json | -> <db-path>',
    );
  }
  const text = input === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(input), 'utf8');
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.meetings)) return parsed.meetings;
  throw new Error('Input JSON must be an array, or { meetings: [] }.');
}

// Mirrors packages/shared/src/meetings.ts::parseMeetingsToday's tolerant
// normalization, so what we write is guaranteed to round-trip through it.
function normalizeMeetings(raw) {
  const meetings = [];
  let dropped = 0;
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      dropped++;
      continue;
    }
    const m = item;
    if (
      !isNonEmptyString(m.id) ||
      !isNonEmptyString(m.subject) ||
      !isNonEmptyString(m.startsAt) ||
      !isNonEmptyString(m.endsAt)
    ) {
      dropped++;
      continue;
    }
    meetings.push({
      id: m.id,
      subject: m.subject,
      subtitle: typeof m.subtitle === 'string' ? m.subtitle : '',
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      joinUrl: isNonEmptyString(m.joinUrl) ? m.joinUrl : null,
    });
  }
  return { meetings, dropped };
}

function upsertSettings(db, value) {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  stmt.run(SETTINGS_KEY, value);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dbPath) {
    throw new Error(
      'Missing <db-path>. Usage: node write-meetings-cache.mjs <meetings.json | -> <db-path>',
    );
  }
  const dbPath = resolve(args.dbPath);
  if (!existsSync(dbPath) || !statSync(dbPath).isFile()) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const raw = readInput(args.input);
  const { meetings, dropped } = normalizeMeetings(raw);

  const blob = { syncedAt: Date.now(), meetings };
  const value = JSON.stringify(blob);

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  upsertSettings(db, value);
  db.close();

  console.log(
    `Wrote ${meetings.length} meeting(s)${dropped > 0 ? ` (${dropped} dropped: missing id/subject/startsAt/endsAt)` : ''} ` +
      `to "${SETTINGS_KEY}" in ${dbPath} (syncedAt=${blob.syncedAt}).`,
  );

  writeFileSync(
    RESULT_FILE,
    JSON.stringify({
      ok: true,
      count: meetings.length,
      detail: `${meetings.length} written${dropped > 0 ? `, ${dropped} dropped` : ''}`,
    }),
  );
}

try {
  main();
} catch (err) {
  console.error(err.stack ?? err.message);
  try { writeFileSync(RESULT_FILE, JSON.stringify({ ok: false, error: err.message ?? String(err) })); } catch { /* best effort */ }
  process.exit(1);
}
