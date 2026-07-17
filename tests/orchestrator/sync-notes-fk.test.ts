import { describe, it, expect } from 'vitest';
import { SYNCED_TABLES } from '../../orchestrator/sync/schema.js';
import { fkSourceForTest as pushFk } from '../../orchestrator/sync/push.js';
import { fkSourceForTest as pullFk } from '../../orchestrator/sync/pull.js';

describe('notes sync FK', () => {
  it('is registered as a synced table with a resolved project FK column', () => {
    const notes = SYNCED_TABLES.find((t) => t.name === 'notes');
    expect(notes).toBeTruthy();
    expect(notes!.columns.some((c) => c.name === 'project_sync_id')).toBe(true);
  });

  it('declares the notes FK as nullable on both push and pull', () => {
    const notes = SYNCED_TABLES.find((t) => t.name === 'notes')!;
    expect(pushFk(notes)).toMatchObject({ col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id', nullable: true });
    expect(pullFk(notes)).toMatchObject({ col: 'project_sync_id', parentTable: 'projects', localCol: 'project_id', nullable: true });
  });

  it('keeps epics FK non-nullable (unchanged behavior)', () => {
    const epics = SYNCED_TABLES.find((t) => t.name === 'epics')!;
    expect(pushFk(epics)).toMatchObject({ localCol: 'project_id' });
    expect(pushFk(epics)!.nullable).toBeFalsy();
  });
});
