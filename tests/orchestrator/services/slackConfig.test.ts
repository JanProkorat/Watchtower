import { describe, it, expect } from 'vitest';
import { SettingsRepo } from '../../../orchestrator/db/repositories/settings.js';
import { readSlackConfig, writeSlackConfig } from '../../../orchestrator/services/slackConfig.js';
import { DEFAULT_SLACK_CONFIG } from '@watchtower/shared/slackConfig.js';

/** Minimal in-memory stand-in for the SqliteLike surface SettingsRepo uses. */
function fakeDb() {
  const store = new Map<string, string>();
  return {
    prepare(sql: string) {
      if (sql.startsWith('SELECT')) {
        return { get: (key: string) => (store.has(key) ? { value: store.get(key) } : undefined) };
      }
      return { run: (key: string, value: string) => store.set(key, value) };
    },
  } as any;
}

describe('slackConfig read/write', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readSlackConfig(new SettingsRepo(fakeDb()))).toEqual(DEFAULT_SLACK_CONFIG);
  });

  it('round-trips a full config', () => {
    const repo = new SettingsRepo(fakeDb());
    const cfg = {
      enabled: true,
      botToken: 'xoxb-1',
      appToken: 'xapp-1',
      dmUserId: 'U123',
      escalateMs: 120_000,
      triggers: { permission: true, idle: false, crash: true },
    };
    writeSlackConfig(repo, cfg);
    expect(readSlackConfig(repo)).toEqual(cfg);
  });

  it('falls back to default escalateMs when the stored value is junk', () => {
    const repo = new SettingsRepo(fakeDb());
    repo.set('slack_escalate_ms', 'not-a-number');
    expect(readSlackConfig(repo).escalateMs).toBe(DEFAULT_SLACK_CONFIG.escalateMs);
  });

  it('falls back to default triggers when the stored JSON is malformed', async () => {
    const repo = new SettingsRepo(fakeDb());
    repo.set('slack_triggers', '{not valid json');
    expect(readSlackConfig(repo).triggers).toEqual(DEFAULT_SLACK_CONFIG.triggers);
  });
});
