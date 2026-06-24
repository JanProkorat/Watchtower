export interface SlackTriggers {
  permission: boolean;
  idle: boolean;
  crash: boolean;
}

export interface SlackConfig {
  enabled: boolean;
  /** xoxb- bot token used to post messages. */
  botToken: string;
  /** xapp- app-level token used for Socket Mode (receiving replies). */
  appToken: string;
  /** Slack user id the bot should DM. */
  dmUserId: string;
  /** Escalate to Slack after this many ms of no engagement. */
  escalateMs: number;
  triggers: SlackTriggers;
}

export const DEFAULT_SLACK_CONFIG: SlackConfig = {
  enabled: false,
  botToken: '',
  appToken: '',
  dmUserId: '',
  escalateMs: 300_000,
  triggers: { permission: true, idle: true, crash: true },
};

export const SLACK_SETTING_KEYS = {
  enabled: 'slack_enabled',
  botToken: 'slack_bot_token',
  appToken: 'slack_app_token',
  dmUserId: 'slack_dm_user_id',
  escalateMs: 'slack_escalate_ms',
  triggers: 'slack_triggers',
} as const;
