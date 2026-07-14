import { describe, it, expect } from 'vitest';
import { PG_MIGRATIONS } from '../../orchestrator/db/pg/schema';

describe('pg migration v12', () => {
  const v12 = PG_MIGRATIONS.find(m => m.version === 12);
  it('exists and is the latest version', () => {
    expect(v12).toBeDefined();
    expect(Math.max(...PG_MIGRATIONS.map(m => m.version))).toBe(13);
  });
  it('creates attention_messages idempotently with RLS', () => {
    const sql = v12!.up.join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS attention_messages/);
    expect(sql).toMatch(/role\s+TEXT/);
    expect(sql).toMatch(/options\s+JSONB/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY[\s\S]*attention_messages[\s\S]*WITH CHECK \(role = 'user'\)/);
  });
  it('creates a pg-side push_devices table for iPhone tokens', () => {
    const sql = v12!.up.join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS push_devices/);
    expect(sql).toMatch(/apns_token\s+TEXT/);
  });
});

describe('pg migration v13', () => {
  const versions = PG_MIGRATIONS.map(m => m.version);
  it('is the latest version', () => {
    expect(Math.max(...versions)).toBe(13);
  });
  it('adds bundle_id to push_devices', () => {
    const v13 = PG_MIGRATIONS.find((m) => m.version === 13)!;
    expect(v13.up.join('\n')).toMatch(/ALTER TABLE push_devices\s+ADD COLUMN IF NOT EXISTS bundle_id/);
  });
});
