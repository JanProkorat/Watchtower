import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, closeSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { enableCapture, disableCapture, captureStatus } from '../../orchestrator/services/statuslineCapture.js';

const HELPER = '/opt/wt/dist-helper/watchtower-statusline.mjs';

describe('statusline capture wrap/restore', () => {
  let tmp: string;
  let settingsPath: string;
  const store = new Map<string, string>();
  const kv = {
    getString: (k: string, d: string) => store.get(k) ?? d,
    set: (k: string, v: string) => void store.set(k, v),
  };

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'wt-sl-'));
    mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    settingsPath = path.join(tmp, '.claude', 'settings.json');
    store.clear();
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const read = () => JSON.parse(readFileSync(settingsPath, 'utf8'));

  it('enable stores the inner command and repoints statusLine.command at the helper', () => {
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'ccline.sh --foo' } }));
    const r = enableCapture(settingsPath, HELPER, kv);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(store.get('statusline_inner_command')).toBe('ccline.sh --foo');
    expect(read().statusLine.command).toBe(`node "${HELPER}" ccline.sh --foo`);
    expect(r.backupPath).toBeTruthy();
  });

  it('enable with no prior statusLine wraps an empty inner command', () => {
    writeFileSync(settingsPath, JSON.stringify({}));
    const r = enableCapture(settingsPath, HELPER, kv);
    expect(r.ok).toBe(true);
    expect(store.get('statusline_inner_command')).toBe('');
    expect(read().statusLine.command).toBe(`node "${HELPER}" `);
  });

  it('enable is idempotent (already-wrapped command does not double-wrap)', () => {
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'ccline.sh' } }));
    enableCapture(settingsPath, HELPER, kv);
    const first = read().statusLine.command;
    const r2 = enableCapture(settingsPath, HELPER, kv);
    expect(r2.changed).toBe(false);
    expect(read().statusLine.command).toBe(first);
    expect(store.get('statusline_inner_command')).toBe('ccline.sh');
  });

  it('disable restores the stored inner command', () => {
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'ccline.sh --foo' } }));
    enableCapture(settingsPath, HELPER, kv);
    const r = disableCapture(settingsPath, HELPER, kv);
    expect(r.ok).toBe(true);
    expect(read().statusLine.command).toBe('ccline.sh --foo');
  });

  it('disable removes statusLine entirely when the inner command was empty', () => {
    writeFileSync(settingsPath, JSON.stringify({}));
    enableCapture(settingsPath, HELPER, kv);
    disableCapture(settingsPath, HELPER, kv);
    expect(read().statusLine).toBeUndefined();
  });

  it('captureStatus reports enabled only when statusLine points at the helper', () => {
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'ccline.sh' } }));
    expect(captureStatus(settingsPath, HELPER).enabled).toBe(false);
    enableCapture(settingsPath, HELPER, kv);
    expect(captureStatus(settingsPath, HELPER).enabled).toBe(true);
  });

  it('captureStatus reports available: false when the helper file does not exist', () => {
    writeFileSync(settingsPath, JSON.stringify({}));
    expect(captureStatus(settingsPath, HELPER).available).toBe(false);
  });

  it('captureStatus reports available: true when the helper file exists', () => {
    writeFileSync(settingsPath, JSON.stringify({}));
    const helperPath = path.join(tmp, 'watchtower-statusline.mjs');
    closeSync(openSync(helperPath, 'w'));
    expect(captureStatus(settingsPath, helperPath).available).toBe(true);
  });

  it('detects a wrap made under a DIFFERENT absolute helper path but the same filename (cross-build regression)', () => {
    // A wrap created by e.g. a worktree build (different absolute path) must still
    // be recognized — and thus disable-able — by a packaged build calling with its
    // own resolveStatuslineHelperPath() result.
    const otherBuildHelper = '/Users/jan/other-worktree/dist-helper/watchtower-statusline.mjs';
    writeFileSync(
      settingsPath,
      JSON.stringify({ statusLine: { type: 'command', command: `node "${otherBuildHelper}" ccline.sh` } }),
    );
    expect(captureStatus(settingsPath, HELPER).enabled).toBe(true);

    const r = disableCapture(settingsPath, HELPER, kv);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
  });

  it('enable preserves pre-existing statusLine sibling keys (e.g. padding)', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ statusLine: { type: 'command', command: 'ccline.sh', padding: 0 } }),
    );
    enableCapture(settingsPath, HELPER, kv);
    const statusLine = read().statusLine;
    expect(statusLine.padding).toBe(0);
    expect(statusLine.command).toBe(`node "${HELPER}" ccline.sh`);
  });
});
