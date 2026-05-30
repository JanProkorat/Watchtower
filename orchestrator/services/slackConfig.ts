import type { SettingsRepo } from '../db/repositories/settings.js';
import { DEFAULT_SLACK_CONFIG, SLACK_SETTING_KEYS, type SlackConfig, type SlackTriggers } from '../../shared/slackConfig.js';

function parseTriggers(raw: string): SlackTriggers {
  try {
    const p = JSON.parse(raw) as Partial<SlackTriggers>;
    return {
      permission: p.permission ?? DEFAULT_SLACK_CONFIG.triggers.permission,
      idle: p.idle ?? DEFAULT_SLACK_CONFIG.triggers.idle,
      crash: p.crash ?? DEFAULT_SLACK_CONFIG.triggers.crash,
    };
  } catch {
    return { ...DEFAULT_SLACK_CONFIG.triggers };
  }
}

export function readSlackConfig(settings: SettingsRepo): SlackConfig {
  return {
    enabled: settings.getString(SLACK_SETTING_KEYS.enabled, DEFAULT_SLACK_CONFIG.enabled ? '1' : '0') === '1',
    botToken: settings.getString(SLACK_SETTING_KEYS.botToken, DEFAULT_SLACK_CONFIG.botToken),
    appToken: settings.getString(SLACK_SETTING_KEYS.appToken, DEFAULT_SLACK_CONFIG.appToken),
    dmUserId: settings.getString(SLACK_SETTING_KEYS.dmUserId, DEFAULT_SLACK_CONFIG.dmUserId),
    escalateMs: settings.getNumber(SLACK_SETTING_KEYS.escalateMs, DEFAULT_SLACK_CONFIG.escalateMs),
    triggers: parseTriggers(settings.getString(SLACK_SETTING_KEYS.triggers, '')),
  };
}

export function writeSlackConfig(settings: SettingsRepo, cfg: SlackConfig): void {
  settings.set(SLACK_SETTING_KEYS.enabled, cfg.enabled ? '1' : '0');
  settings.set(SLACK_SETTING_KEYS.botToken, cfg.botToken);
  settings.set(SLACK_SETTING_KEYS.appToken, cfg.appToken);
  settings.set(SLACK_SETTING_KEYS.dmUserId, cfg.dmUserId);
  settings.set(SLACK_SETTING_KEYS.escalateMs, String(cfg.escalateMs));
  settings.set(SLACK_SETTING_KEYS.triggers, JSON.stringify(cfg.triggers));
}
