import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readSettings, writeSettings, resolveSettingsPath } from '../../orchestrator/services/claudeSettings.js';

describe('claudeSettings', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'wt-claude-settings-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('resolveSettingsPath', () => {
    it('returns ~/.claude/settings.json for global', () => {
      const p = resolveSettingsPath('global');
      expect(p).toBe(path.join(os.homedir(), '.claude', 'settings.json'));
    });

    it('appends .claude/settings.json to a project path', () => {
      expect(resolveSettingsPath('project', '/Users/x/p')).toBe('/Users/x/p/.claude/settings.json');
    });

    it('expands a leading ~/ in project path', () => {
      const p = resolveSettingsPath('project', '~/Projects/Foo');
      expect(p).toBe(path.join(os.homedir(), 'Projects/Foo', '.claude', 'settings.json'));
    });

    it('throws when project scope is missing a path', () => {
      expect(() => resolveSettingsPath('project')).toThrow(/projectPath/);
    });
  });

  describe('readSettings', () => {
    it('returns exists=false + empty content when the file does not exist', () => {
      const r = readSettings('project', tmp);
      expect(r.exists).toBe(false);
      expect(r.content).toBe('');
      expect(r.path).toBe(path.join(tmp, '.claude', 'settings.json'));
    });

    it('returns the file content verbatim when present', () => {
      mkdirSync(path.join(tmp, '.claude'), { recursive: true });
      const json = '{\n  "permissions": { "allow": ["Read"] }\n}\n';
      writeFileSync(path.join(tmp, '.claude', 'settings.json'), json, 'utf8');
      const r = readSettings('project', tmp);
      expect(r.exists).toBe(true);
      expect(r.content).toBe(json);
    });
  });

  describe('writeSettings', () => {
    it('refuses to write invalid JSON', () => {
      const r = writeSettings('project', tmp, '{ not: valid');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Invalid JSON/);
    });

    it('creates the .claude/ dir on first write to a project that has none', () => {
      const r = writeSettings('project', tmp, '{}', () => new Date('2026-05-24T12:00:00Z'));
      expect(r.ok).toBe(true);
      expect(r.backupPath).toBeUndefined();
      expect(readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8')).toBe('{}');
    });

    it('backs up the existing file before overwriting', () => {
      mkdirSync(path.join(tmp, '.claude'), { recursive: true });
      const target = path.join(tmp, '.claude', 'settings.json');
      writeFileSync(target, '{"a":1}', 'utf8');

      const r = writeSettings('project', tmp, '{"a":2}', () => new Date('2026-05-24T12:34:56Z'));
      expect(r.ok).toBe(true);
      expect(r.backupPath).toBeDefined();
      // Backup contains the original content; target contains the new.
      expect(readFileSync(r.backupPath!, 'utf8')).toBe('{"a":1}');
      expect(readFileSync(target, 'utf8')).toBe('{"a":2}');
    });
  });
});
