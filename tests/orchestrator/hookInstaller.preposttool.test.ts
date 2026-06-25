import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureHooksInstalled } from '../../orchestrator/hookInstaller.js';

describe('hook installer includes tool-use events', () => {
  it('installs PreToolUse and PostToolUse entries', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wt-hooks-'));
    const settings = path.join(dir, 'settings.json');
    ensureHooksInstalled(settings, '/abs/watchtower-hook.mjs');
    const parsed = JSON.parse(readFileSync(settings, 'utf8'));
    expect(Object.keys(parsed.hooks)).toEqual(
      expect.arrayContaining(['PreToolUse', 'PostToolUse', 'SessionStart']),
    );
  });
});
