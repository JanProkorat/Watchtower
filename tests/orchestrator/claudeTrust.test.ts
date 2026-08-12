// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { withTrustedProject, ensureProjectTrusted } from '../../orchestrator/services/claudeTrust.js';

const DIR = '/Users/jan/.watchtower/worktrees/gh-a-b-pr5';

describe('withTrustedProject', () => {
  it('adds the project entry with the trust flag set', () => {
    const out = withTrustedProject('{\n  "numStartups": 3,\n  "projects": {}\n}', DIR);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!);
    expect(parsed.projects[DIR].hasTrustDialogAccepted).toBe(true);
    expect(parsed.numStartups).toBe(3); // untouched
  });

  it('creates the projects map when the config has none', () => {
    const out = withTrustedProject('{"numStartups": 1}', DIR);
    expect(JSON.parse(out!).projects[DIR].hasTrustDialogAccepted).toBe(true);
  });

  it('preserves other keys already on the project entry', () => {
    const raw = JSON.stringify({ projects: { [DIR]: { allowedTools: ['Read'], lastCost: 1.5 } } });
    const parsed = JSON.parse(withTrustedProject(raw, DIR)!);
    expect(parsed.projects[DIR]).toEqual({ allowedTools: ['Read'], lastCost: 1.5, hasTrustDialogAccepted: true });
  });

  it('leaves other projects alone', () => {
    const raw = JSON.stringify({ projects: { '/other': { hasTrustDialogAccepted: true, lastCost: 2 } } });
    const parsed = JSON.parse(withTrustedProject(raw, DIR)!);
    expect(parsed.projects['/other']).toEqual({ hasTrustDialogAccepted: true, lastCost: 2 });
  });

  it('returns null when the directory is already trusted (no write needed)', () => {
    const raw = JSON.stringify({ projects: { [DIR]: { hasTrustDialogAccepted: true } } });
    expect(withTrustedProject(raw, DIR)).toBeNull();
  });

  it('returns null for unparseable JSON rather than overwriting a live config', () => {
    expect(withTrustedProject('{ this is not json', DIR)).toBeNull();
  });

  it('returns null when the config is not a JSON object', () => {
    expect(withTrustedProject('[1,2,3]', DIR)).toBeNull();
    expect(withTrustedProject('null', DIR)).toBeNull();
  });

  it('returns null when `projects` exists but is not an object', () => {
    expect(withTrustedProject('{"projects": 5}', DIR)).toBeNull();
  });

  it('keeps 2-space formatting so the diff against the live file stays minimal', () => {
    const out = withTrustedProject('{\n  "projects": {}\n}', DIR)!;
    expect(out).toContain('\n  "projects": {');
  });
});

describe('ensureProjectTrusted', () => {
  const deps = (over: Partial<Parameters<typeof ensureProjectTrusted>[1]> = {}) => ({
    configPath: '/home/u/.claude.json',
    exists: vi.fn(() => true),
    read: vi.fn(() => '{"projects":{}}'),
    write: vi.fn(),
    backup: vi.fn(),
    ...over,
  });

  it('backs the config up before writing, per the backup convention', () => {
    const d = deps();
    expect(ensureProjectTrusted(DIR, d)).toBe(true);
    expect(d.backup).toHaveBeenCalledWith('/home/u/.claude.json');
    expect(d.write).toHaveBeenCalledTimes(1);
    const [, content] = d.write.mock.calls[0]!;
    expect(JSON.parse(content as string).projects[DIR].hasTrustDialogAccepted).toBe(true);
  });

  it('backs up before writing, never after', () => {
    const order: string[] = [];
    const d = deps({
      backup: vi.fn(() => { order.push('backup'); }),
      write: vi.fn(() => { order.push('write'); }),
    });
    ensureProjectTrusted(DIR, d);
    expect(order).toEqual(['backup', 'write']);
  });

  it('does nothing when the directory is already trusted', () => {
    const d = deps({ read: vi.fn(() => JSON.stringify({ projects: { [DIR]: { hasTrustDialogAccepted: true } } })) });
    expect(ensureProjectTrusted(DIR, d)).toBe(false);
    expect(d.write).not.toHaveBeenCalled();
    expect(d.backup).not.toHaveBeenCalled();
  });

  it('does nothing when the config file does not exist', () => {
    const d = deps({ exists: vi.fn(() => false) });
    expect(ensureProjectTrusted(DIR, d)).toBe(false);
    expect(d.read).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
  });

  it('does not write when the config cannot be parsed', () => {
    const d = deps({ read: vi.fn(() => 'not json') });
    expect(ensureProjectTrusted(DIR, d)).toBe(false);
    expect(d.write).not.toHaveBeenCalled();
  });

  it('swallows a read failure — a trust prompt is a worse outcome than a crash, but not worth one', () => {
    const d = deps({ read: vi.fn(() => { throw new Error('EACCES'); }) });
    expect(ensureProjectTrusted(DIR, d)).toBe(false);
    expect(d.write).not.toHaveBeenCalled();
  });

  it('swallows a write failure', () => {
    const d = deps({ write: vi.fn(() => { throw new Error('EROFS'); }) });
    expect(ensureProjectTrusted(DIR, d)).toBe(false);
  });
});
