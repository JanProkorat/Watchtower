import { HUB_SETTING_KEYS, DEFAULT_HUB_CONFIG, type HubConfig } from '@watchtower/shared/hubConfig.js';

interface SettingsLike {
  getString(key: string, def: string): string;
  set(key: string, value: string): void;
}

export function readHubConfig(settings: SettingsLike): HubConfig {
  const env = settings.getString(HUB_SETTING_KEYS.apnsEnv, DEFAULT_HUB_CONFIG.apnsEnv);
  return {
    enabled: settings.getString(HUB_SETTING_KEYS.enabled, String(DEFAULT_HUB_CONFIG.enabled)) === 'true',
    apnsKey: settings.getString(HUB_SETTING_KEYS.apnsKey, DEFAULT_HUB_CONFIG.apnsKey),
    apnsKeyId: settings.getString(HUB_SETTING_KEYS.apnsKeyId, DEFAULT_HUB_CONFIG.apnsKeyId),
    apnsTeamId: settings.getString(HUB_SETTING_KEYS.apnsTeamId, DEFAULT_HUB_CONFIG.apnsTeamId),
    apnsEnv: env === 'production' ? 'production' : 'sandbox',
  };
}

export function writeHubConfig(settings: SettingsLike, cfg: HubConfig): void {
  settings.set(HUB_SETTING_KEYS.enabled, String(cfg.enabled));
  settings.set(HUB_SETTING_KEYS.apnsKey, cfg.apnsKey);
  settings.set(HUB_SETTING_KEYS.apnsKeyId, cfg.apnsKeyId);
  settings.set(HUB_SETTING_KEYS.apnsTeamId, cfg.apnsTeamId);
  settings.set(HUB_SETTING_KEYS.apnsEnv, cfg.apnsEnv);
}
