import { describe, it, expect } from 'vitest';
import { PG_MIGRATIONS } from '../../orchestrator/db/pg/schema.js';

describe('PG_MIGRATIONS v6 — days_off write policy', () => {
  it('adds a version-6 migration', () => {
    const v6 = PG_MIGRATIONS.find((m) => m.version === 6);
    expect(v6).toBeDefined();
  });

  it('creates a guarded write_authenticated policy for days_off (FOR ALL)', () => {
    const sql = PG_MIGRATIONS.find((m) => m.version === 6)!.up.join('\n');
    expect(sql).toContain('days_off');
    expect(sql).toContain('write_authenticated');
    expect(sql).toContain('FOR ALL TO authenticated');
    // idempotent + role-guarded, mirroring v4
    expect(sql).toContain('DROP POLICY IF EXISTS write_authenticated ON days_off');
    expect(sql).toContain("rolname = 'authenticated'");
  });
});
