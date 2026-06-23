import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runMigrations, type SqliteLike } from '../../orchestrator/db/migrations.js';
import { DaysOffRepo } from '../../orchestrator/db/repositories/daysOff.js';
import { countWorkdays } from '../../orchestrator/db/workdays.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

function freshDb(): SqliteLike {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'wt-')), 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db as unknown as SqliteLike);
  return db as unknown as SqliteLike;
}

describe('DaysOffRepo', () => {
  let db: SqliteLike;
  let repo: DaysOffRepo;
  beforeEach(() => {
    db = freshDb();
    repo = new DaysOffRepo(db);
  });

  it('upserts a fresh row with the given kind + note', () => {
    const row = repo.upsert({ date: '2026-05-15', kind: 'vacation', note: 'Beach' });
    expect(row.date).toBe('2026-05-15');
    expect(row.kind).toBe('vacation');
    expect(row.note).toBe('Beach');
    expect(row.createdAt).toBeTruthy();
  });

  it('upsert on the same date overwrites the kind', () => {
    repo.upsert({ date: '2026-05-15', kind: 'vacation' });
    repo.upsert({ date: '2026-05-15', kind: 'sick' });
    expect(repo.get('2026-05-15')?.kind).toBe('sick');
    expect(repo.listAll()).toHaveLength(1);
  });

  it('omitting note on second upsert preserves the existing note', () => {
    repo.upsert({ date: '2026-05-15', kind: 'vacation', note: 'Beach' });
    repo.upsert({ date: '2026-05-15', kind: 'sick' });
    expect(repo.get('2026-05-15')?.note).toBe('Beach');
  });

  it('explicit null clears the note', () => {
    repo.upsert({ date: '2026-05-15', kind: 'vacation', note: 'Beach' });
    repo.upsert({ date: '2026-05-15', kind: 'vacation', note: null });
    expect(repo.get('2026-05-15')?.note).toBeNull();
  });

  it('listAll returns rows sorted by date ascending', () => {
    repo.upsert({ date: '2026-05-15', kind: 'vacation' });
    repo.upsert({ date: '2026-05-01', kind: 'sick' });
    repo.upsert({ date: '2026-06-01', kind: 'other' });
    expect(repo.listAll().map((d) => d.date)).toEqual([
      '2026-05-01',
      '2026-05-15',
      '2026-06-01',
    ]);
  });

  it('listInRange brackets inclusive', () => {
    repo.upsert({ date: '2026-04-30', kind: 'vacation' });
    repo.upsert({ date: '2026-05-01', kind: 'vacation' });
    repo.upsert({ date: '2026-05-31', kind: 'sick' });
    repo.upsert({ date: '2026-06-01', kind: 'other' });
    const rows = repo.listInRange('2026-05-01', '2026-05-31');
    expect(rows.map((d) => d.date)).toEqual(['2026-05-01', '2026-05-31']);
  });

  it('delete removes the row', () => {
    repo.upsert({ date: '2026-05-15', kind: 'vacation' });
    repo.delete('2026-05-15');
    expect(repo.get('2026-05-15')).toBeNull();
    const raw = db.prepare(`SELECT deleted_at FROM days_off WHERE date = ?`).get('2026-05-15') as any;
    expect(raw.deleted_at).toBeTruthy();
  });

  it('check constraint rejects unknown kinds', () => {
    expect(() =>
      db.prepare(`INSERT INTO days_off (date, kind) VALUES ('2026-05-15', 'bogus')`).run(),
    ).toThrow();
  });
});

describe('countWorkdays with extraNonWorking (days_off)', () => {
  it('subtracts days_off dates that fall on a weekday', () => {
    // June 2026 first week (Mon Jun 1 - Sun Jun 7): 5 workdays normally.
    // Mark Jun 3 (Wed) as vacation → 4.
    const off = new Set(['2026-06-03']);
    expect(countWorkdays('2026-06-01', '2026-06-07', off)).toBe(4);
  });

  it('does not double-subtract a day already marked as a Czech holiday', () => {
    // May 1 2026 is Labour Day (Czech) AND someone might also mark it as
    // vacation. Workday count should still drop by 1, not 2.
    const off = new Set(['2026-05-01']);
    // Apr 27 (Mon) — May 3 (Sun): 5 weekdays, May 1 is Friday + Labour Day.
    expect(countWorkdays('2026-04-27', '2026-05-03', off)).toBe(4);
    // Without explicit days_off — also 4 (holiday already covered it).
    expect(countWorkdays('2026-04-27', '2026-05-03')).toBe(4);
  });

  it('weekend days_off do not affect the count', () => {
    // Sat Jun 6 2026 marked as vacation — already not a workday.
    const off = new Set(['2026-06-06']);
    expect(countWorkdays('2026-06-01', '2026-06-07', off)).toBe(5);
  });
});
