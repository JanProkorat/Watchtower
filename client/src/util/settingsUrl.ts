/**
 * URL-hash routing for the Settings module.
 *
 * Hash format:
 *   #settings/general          — General (Watchtower's own knobs)
 *   #settings/json             — ~/.claude/settings.json editor
 *   #settings/hooks            — Hooks viewer + editor
 *   #settings/skills           — Skills browser
 *   #settings/agents           — Agents browser
 *   #settings/mcp              — MCP servers
 *   #settings/microsoft365     — Microsoft 365 sign-in for meeting sync
 *
 * Parsing is strict: an unknown tab returns null and the caller falls back
 * to the default landing (General).
 */

export const SETTINGS_TABS = [
  'general',
  'json',
  'hooks',
  'skills',
  'agents',
  'mcp',
  'microsoft365',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export interface SettingsView {
  tab: SettingsTab;
}

export const DEFAULT_VIEW: SettingsView = { tab: 'general' };

function isTab(s: string | undefined): s is SettingsTab {
  return s !== undefined && (SETTINGS_TABS as readonly string[]).includes(s);
}

export function parseSettingsHash(hash: string): SettingsView | null {
  // Tolerate the leading "#" and any trailing slash.
  const trimmed = hash.replace(/^#/, '').replace(/\/$/, '');
  if (!trimmed.startsWith('settings/')) return null;
  const rest = trimmed.slice('settings/'.length);
  if (!isTab(rest)) return null;
  return { tab: rest };
}

export function settingsHash(view: SettingsView): string {
  return `#settings/${view.tab}`;
}

export function viewsEqual(a: SettingsView, b: SettingsView): boolean {
  return a.tab === b.tab;
}
