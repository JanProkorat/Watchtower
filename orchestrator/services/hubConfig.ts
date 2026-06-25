import { HUB_SETTING_KEYS, DEFAULT_HUB_CONFIG, type HubConfig } from '@watchtower/shared/hubConfig.js';

interface SettingsLike {
  getString(key: string, def: string): string;
  getNumber(key: string, def: number): number;
  set(key: string, value: string): void;
}

function parseTriggers(raw: string): HubConfig['triggers'] {
  if (!raw) return { ...DEFAULT_HUB_CONFIG.triggers };
  try {
    const t = JSON.parse(raw);
    return { permission: !!t.permission, idle: !!t.idle, crash: !!t.crash };
  } catch { return { ...DEFAULT_HUB_CONFIG.triggers }; }
}

export function readHubConfig(settings: SettingsLike): HubConfig {
  const env = settings.getString(HUB_SETTING_KEYS.apnsEnv, DEFAULT_HUB_CONFIG.apnsEnv);
  return {
    enabled: settings.getString(HUB_SETTING_KEYS.enabled, String(DEFAULT_HUB_CONFIG.enabled)) === 'true',
    apnsKey: settings.getString(HUB_SETTING_KEYS.apnsKey, DEFAULT_HUB_CONFIG.apnsKey),
    apnsKeyId: settings.getString(HUB_SETTING_KEYS.apnsKeyId, DEFAULT_HUB_CONFIG.apnsKeyId),
    apnsTeamId: settings.getString(HUB_SETTING_KEYS.apnsTeamId, DEFAULT_HUB_CONFIG.apnsTeamId),
    apnsEnv: env === 'production' ? 'production' : 'sandbox',
    escalateMs: settings.getNumber(HUB_SETTING_KEYS.escalateMs, DEFAULT_HUB_CONFIG.escalateMs),
    triggers: parseTriggers(settings.getString(HUB_SETTING_KEYS.triggers, '')),
  };
}

export function writeHubConfig(settings: SettingsLike, cfg: HubConfig): void {
  settings.set(HUB_SETTING_KEYS.enabled, String(cfg.enabled));
  settings.set(HUB_SETTING_KEYS.apnsKey, cfg.apnsKey);
  settings.set(HUB_SETTING_KEYS.apnsKeyId, cfg.apnsKeyId);
  settings.set(HUB_SETTING_KEYS.apnsTeamId, cfg.apnsTeamId);
  settings.set(HUB_SETTING_KEYS.apnsEnv, cfg.apnsEnv);
  settings.set(HUB_SETTING_KEYS.escalateMs, String(cfg.escalateMs));
  settings.set(HUB_SETTING_KEYS.triggers, JSON.stringify(cfg.triggers));
}
