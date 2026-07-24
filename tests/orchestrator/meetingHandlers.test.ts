import { describe, it, expect } from 'vitest';
import { buildSyncCommand, buildTeamsCommand } from '../../orchestrator/services/meetingCommands.js';

describe('meetingCommands', () => {
  it('builds the sync-meetings command with range + db path', () => {
    expect(buildSyncCommand('2026-07-01', '2026-07-23'))
      .toBe('/sync-meetings 2026-07-01 2026-07-23 "/Users/jan/Library/Application Support/Watchtower/data.db"');
  });
  it('builds the teams-refresh command with db path', () => {
    expect(buildTeamsCommand())
      .toBe('/teams-refresh "/Users/jan/Library/Application Support/Watchtower/data.db"');
  });
});
