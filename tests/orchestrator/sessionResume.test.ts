import { describe, it, expect } from 'vitest';
import {
  hookCwdMatches,
  projectSessionDir,
  resolveResumeTarget,
} from '../../orchestrator/sessionResume.js';

describe('hookCwdMatches', () => {
  const WT = '/Users/jan/Projects/Watchtower';

  it('accepts the managed session (same cwd)', () => {
    expect(hookCwdMatches(WT, WT)).toBe(true);
  });

  it('rejects a nested claude running from /private/tmp (the real bug)', () => {
    // The global memory summarizer / skills run from /tmp and inherit
    // WATCHTOWER_INSTANCE_ID — their SessionStart must not be routed here.
    expect(hookCwdMatches(WT, '/private/tmp')).toBe(false);
  });

  it('rejects a nested claude running from a temp folder', () => {
    expect(
      hookCwdMatches(WT, '/private/var/folders/tp/x41274sn7lgdl66h5khcdptm0000gn/T'),
    ).toBe(false);
  });

  it('ignores a trailing slash difference', () => {
    expect(hookCwdMatches('/a/b/c', '/a/b/c/')).toBe(true);
  });

  it('allows events with no cwd to discriminate on (back-compat)', () => {
    expect(hookCwdMatches(WT, undefined)).toBe(true);
    expect(hookCwdMatches(WT, '')).toBe(true);
  });

  it('rejects when the instance cwd is unknown', () => {
    expect(hookCwdMatches(undefined, WT)).toBe(false);
  });
});

describe('projectSessionDir', () => {
  it('slugifies the cwd the way Claude Code does', () => {
    expect(projectSessionDir('/Users/jan/Projects/Watchtower')).toMatch(
      /\/\.claude\/projects\/-Users-jan-Projects-Watchtower$/,
    );
    expect(projectSessionDir('/private/tmp')).toMatch(/\/-private-tmp$/);
  });
});

describe('resolveResumeTarget', () => {
  const row = (claudeSessionId: string | null) => ({
    id: 'row-id-1',
    cwd: '/Users/jan/Projects/Watchtower',
    claudeSessionId,
  });

  it('prefers the stored session id when its transcript exists', () => {
    const exists = (_cwd: string, id: string) => id === 'stored-id';
    expect(resolveResumeTarget(row('stored-id'), exists)).toBe('stored-id');
  });

  it('falls back to the row id when the stored id is foreign (contaminated row)', () => {
    // Stored id was clobbered by a nested /private/tmp session and has no
    // transcript under this project; the original --session-id <rowId> does.
    const exists = (_cwd: string, id: string) => id === 'row-id-1';
    expect(resolveResumeTarget(row('foreign-id'), exists)).toBe('row-id-1');
  });

  it('returns null (fresh spawn) when neither transcript exists', () => {
    const exists = () => false;
    expect(resolveResumeTarget(row('foreign-id'), exists)).toBeNull();
  });

  it('falls back to the row id when no session id was ever stored', () => {
    const exists = (_cwd: string, id: string) => id === 'row-id-1';
    expect(resolveResumeTarget(row(null), exists)).toBe('row-id-1');
  });
});
