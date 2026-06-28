import { describe, it, expect } from 'vitest';
import { toPgValue, toSqliteValue, deterministicSyncId, SYNCED_TABLES, DERIVERS } from '../../../orchestrator/sync/schema.js';

describe('value transforms', () => {
  it('bool: sqlite 0/1 ↔ pg boolean', () => {
    expect(toPgValue('bool', 1)).toBe(true);
    expect(toPgValue('bool', 0)).toBe(false);
    expect(toSqliteValue('bool', true)).toBe(1);
    expect(toSqliteValue('bool', false)).toBe(0);
  });

  it('json: sqlite TEXT ↔ pg jsonb (object)', () => {
    expect(toPgValue('json', '["A","B"]')).toEqual(['A', 'B']);
    expect(toPgValue('json', null)).toBeNull();
    expect(toSqliteValue('json', ['A', 'B'])).toBe('["A","B"]');
    expect(toSqliteValue('json', null)).toBeNull();
  });

  it('numeric: pg returns string → sqlite number', () => {
    expect(toSqliteValue('numeric', '100.5')).toBe(100.5);
    expect(toSqliteValue('numeric', null)).toBeNull();
    expect(toPgValue('numeric', 100.5)).toBe(100.5);
  });

  it('date: pg Date → sqlite YYYY-MM-DD', () => {
    expect(toSqliteValue('date', new Date('2026-01-02T00:00:00.000Z'))).toBe('2026-01-02');
    expect(toSqliteValue('date', '2026-01-02')).toBe('2026-01-02');
    expect(toPgValue('date', '2026-01-02')).toBe('2026-01-02');
  });

  it('ts: pg Date → sqlite ISO-Z', () => {
    expect(toSqliteValue('ts', new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(toSqliteValue('ts', null)).toBeNull();
  });

  it('deterministicSyncId is stable across calls', () => {
    expect(deterministicSyncId('projects', 7)).toBe(deterministicSyncId('projects', 7));
    expect(deterministicSyncId('projects', 7)).not.toBe(deterministicSyncId('projects', 8));
  });

  it('SYNCED_TABLES covers the 6 tables with sync_id/updated_at/deleted_at', () => {
    expect(SYNCED_TABLES.map((t) => t.name).sort()).toEqual(
      ['contracts', 'days_off', 'epics', 'projects', 'tasks', 'worklogs'],
    );
    for (const t of SYNCED_TABLES) {
      const cols = t.columns.map((c) => c.name);
      expect(cols).toContain('sync_id');
      expect(cols).toContain('updated_at');
      expect(cols).toContain('deleted_at');
      expect(cols).not.toContain('id'); // local PK never crosses the wire
    }
  });

  it('worklogs descriptor carries the 3 derived billing columns (no rate_currency)', () => {
    const wl = SYNCED_TABLES.find((t) => t.name === 'worklogs')!;
    const derived = wl.columns.filter((c) => c.derived).map((c) => c.name).sort();
    expect(derived).toEqual(['earned_amount', 'effective_minutes', 'resolved_rate']);
    expect(derived).not.toContain('rate_currency');
  });

  it('DERIVERS has a worklogs entry that is a factory function', () => {
    expect(typeof DERIVERS['worklogs']).toBe('function');
  });
});
