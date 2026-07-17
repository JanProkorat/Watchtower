import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeSettings } from './claudeSettings.js';

/** Minimal KV surface (SettingsRepo-compatible) for storing the inner command. */
export interface KvLike {
  getString(key: string, def: string): string;
  set(key: string, value: string): void;
}

const INNER_KEY = 'statusline_inner_command';

export interface CaptureResult {
  ok: boolean;
  changed: boolean;
  backupPath: string | null;
  error?: string;
}

interface ParsedSettings {
  statusLine?: { type?: string; command?: string } | undefined;
  [k: string]: unknown;
}

// Local file read that tolerates absence (writeSettings handles the write+backup).
function existsRaw(p: string): string | null {
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function parseGlobal(settingsPath: string): ParsedSettings {
  const raw = existsRaw(settingsPath);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ParsedSettings;
  } catch {
    return {};
  }
}

function wrappedCommand(helperPath: string, inner: string): string {
  return `node "${helperPath}" ${inner}`;
}

function isWrapped(command: string | undefined, helperPath: string): boolean {
  return typeof command === 'string' && command.includes(helperPath);
}

// Reuse claudeSettings.writeSettings via 'project' scope pointed at the file's
// dir so we inherit the backup convention (writeSettings only uses the dir to
// rebuild `<dir>/.claude/settings.json`, which round-trips correctly for both
// the real global path and a temp dir used in tests — see resolveSettingsPath
// in claudeSettings.ts: the 'project' branch only special-cases a literal
// leading `~/`, and settingsPath here is always already-resolved/absolute).
function writeGlobal(settingsPath: string, parsed: ParsedSettings): { ok: boolean; backupPath?: string; error?: string } {
  const projectDir = path.dirname(path.dirname(settingsPath)); // strip /.claude/settings.json
  return writeSettings('project', projectDir, JSON.stringify(parsed, null, 2));
}

/** True when the current statusLine.command points at our helper. */
export function captureStatus(
  settingsPath: string,
  helperPath: string,
): { enabled: boolean; available: boolean } {
  const parsed = parseGlobal(settingsPath);
  return { enabled: isWrapped(parsed.statusLine?.command, helperPath), available: true };
}

export function enableCapture(settingsPath: string, helperPath: string, kv: KvLike): CaptureResult {
  const parsed = parseGlobal(settingsPath);
  const current = parsed.statusLine?.command ?? '';
  if (isWrapped(current, helperPath)) {
    return { ok: true, changed: false, backupPath: null };
  }
  kv.set(INNER_KEY, current);
  parsed.statusLine = { type: 'command', command: wrappedCommand(helperPath, current) };
  const res = writeGlobal(settingsPath, parsed);
  return { ok: res.ok, changed: res.ok, backupPath: res.backupPath ?? null, error: res.error };
}

export function disableCapture(settingsPath: string, helperPath: string, kv: KvLike): CaptureResult {
  const parsed = parseGlobal(settingsPath);
  if (!isWrapped(parsed.statusLine?.command, helperPath)) {
    return { ok: true, changed: false, backupPath: null };
  }
  const inner = kv.getString(INNER_KEY, '');
  if (inner.trim()) {
    parsed.statusLine = { type: 'command', command: inner };
  } else {
    delete parsed.statusLine;
  }
  const res = writeGlobal(settingsPath, parsed);
  return { ok: res.ok, changed: res.ok, backupPath: res.backupPath ?? null, error: res.error };
}
