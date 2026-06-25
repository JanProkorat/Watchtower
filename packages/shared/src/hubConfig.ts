export const HUB_BUNDLE_ID = 'cz.greencode.watchtower.ipad';

export interface HubConfig {
  enabled: boolean;
  apnsKey: string;       // .p8 PEM contents
  apnsKeyId: string;
  apnsTeamId: string;
  apnsEnv: 'sandbox' | 'production';
}

export const DEFAULT_HUB_CONFIG: HubConfig = {
  enabled: false, apnsKey: '', apnsKeyId: '', apnsTeamId: '', apnsEnv: 'sandbox',
};

export const HUB_SETTING_KEYS = {
  enabled: 'hub_enabled',
  apnsKey: 'hub_apns_key',
  apnsKeyId: 'hub_apns_key_id',
  apnsTeamId: 'hub_apns_team_id',
  apnsEnv: 'hub_apns_env',
} as const;
