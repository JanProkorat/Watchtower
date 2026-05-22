// Idempotent hook installer. Writes our 5 event entries into
// ~/.claude/settings.json so a freshly-spawned `claude` POSTs lifecycle events
// to the orchestrator's listener. Without this the orchestrator never sees
// SessionStart / Notification / Stop / etc. and the state machine stays at
// 'spawning' forever (visible to the user as a stuck "Starting claude…" overlay).
//
// Phase 9 will wrap this in a first-run wizard with a diff preview + UI; for
// now it runs silently on every orchestrator boot, backs up the existing
// settings file once on first change, and is a no-op if the entries already
// match.

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'] as const;
type EventName = (typeof EVENTS)[number];

interface HookCommand {
  type: string;
  command: string;
}
interface HookBlock {
  hooks: HookCommand[];
}

function commandFor(helperPath: string, event: EventName): string {
  // JSON.stringify guards against spaces / special chars in the path
  return `node ${JSON.stringify(helperPath)} ${event}`;
}

export interface InstallResult {
  changed: boolean;
  backedUp: string | null;
  helperPath: string;
}

export function ensureHooksInstalled(settingsPath: string, helperPath: string): InstallResult {
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch {
      // The file exists but isn't valid JSON — refuse to overwrite. Better to
      // surface this in a log than silently clobber user config.
      console.error(`[hookInstaller] ${settingsPath} is not valid JSON; skipping install`);
      return { changed: false, backedUp: null, helperPath };
    }
  }

  const hooks = ((settings.hooks as Record<string, HookBlock[]> | undefined) ?? {}) as Record<
    string,
    HookBlock[]
  >;

  let changed = false;
  for (const event of EVENTS) {
    const cmd = commandFor(helperPath, event);
    const blocks: HookBlock[] = hooks[event] ?? [];
    // Strip any stale watchtower-hook entries that point at a different path
    // (helper moved between dev/packaged, repo cloned to a new location, etc.).
    let blocksTouched = false;
    const cleaned: HookBlock[] = [];
    for (const block of blocks) {
      const filteredHooks = (block.hooks ?? []).filter((h) => {
        if (h.command === cmd) return true;
        // Recognise our own outdated entries by the helper script name and
        // drop them so they don't accumulate.
        const looksLikeOurs = typeof h.command === 'string' && h.command.includes('watchtower-hook.mjs');
        if (looksLikeOurs) {
          blocksTouched = true;
          return false;
        }
        return true;
      });
      if (filteredHooks.length > 0) cleaned.push({ hooks: filteredHooks });
      else blocksTouched = true;
    }
    const present = cleaned.some((b) => b.hooks?.some((h) => h.command === cmd));
    if (!present) {
      cleaned.push({ hooks: [{ type: 'command', command: cmd }] });
      changed = true;
    } else if (blocksTouched) {
      changed = true;
    }
    hooks[event] = cleaned;
  }

  if (!changed) return { changed: false, backedUp: null, helperPath };

  let backedUp: string | null = null;
  if (existsSync(settingsPath)) {
    backedUp = `${settingsPath}.watchtower-bak.${Date.now()}`;
    copyFileSync(settingsPath, backedUp);
  } else {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
  }
  settings.hooks = hooks;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return { changed: true, backedUp, helperPath };
}
