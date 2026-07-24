export const WATCHTOWER_DB_PATH = '/Users/jan/Library/Application Support/Watchtower/data.db';

export function buildSyncCommand(from: string, to: string): string {
  return `/sync-meetings ${from} ${to} "${WATCHTOWER_DB_PATH}"`;
}

export function buildTeamsCommand(): string {
  return `/teams-refresh "${WATCHTOWER_DB_PATH}"`;
}
