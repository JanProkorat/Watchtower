import { SettingsPanel } from '../SettingsPanel.js';

/**
 * General tab — Watchtower-specific knobs (quiet timer, default cwd, hook
 * install/uninstall, test notification). Hosted by the existing
 * SettingsPanel verbatim; the Settings module just gives it a tabbed home.
 */
export function GeneralTab() {
  return <SettingsPanel />;
}
