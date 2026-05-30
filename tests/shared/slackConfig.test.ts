import { describe, it, expect } from 'vitest';
import { DEFAULT_SLACK_CONFIG, SLACK_SETTING_KEYS } from '../../shared/slackConfig.js';

describe('slackConfig defaults', () => {
  it('defaults to disabled with all triggers on and a 5-minute escalation', () => {
    expect(DEFAULT_SLACK_CONFIG.enabled).toBe(false);
    expect(DEFAULT_SLACK_CONFIG.escalateMs).toBe(300_000);
    expect(DEFAULT_SLACK_CONFIG.triggers).toEqual({ permission: true, idle: true, crash: true });
  });

  it('exposes a setting key for every persisted field', () => {
    expect(SLACK_SETTING_KEYS.enabled).toBe('slack_enabled');
    expect(SLACK_SETTING_KEYS.botToken).toBe('slack_bot_token');
    expect(SLACK_SETTING_KEYS.appToken).toBe('slack_app_token');
    expect(SLACK_SETTING_KEYS.dmUserId).toBe('slack_dm_user_id');
    expect(SLACK_SETTING_KEYS.escalateMs).toBe('slack_escalate_ms');
    expect(SLACK_SETTING_KEYS.triggers).toBe('slack_triggers');
  });
});
