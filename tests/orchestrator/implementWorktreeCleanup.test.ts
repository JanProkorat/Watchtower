// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { safeRemoveWorktree } from '../../orchestrator/services/prImplement.js';

describe('safeRemoveWorktree', () => {
  it('no-ops when path is null', async () => {
    const exec = vi.fn(async () => '');
    await safeRemoveWorktree(null, { exec, warn: () => {} });
    expect(exec).not.toHaveBeenCalled();
  });
  it('runs a NON-force git worktree remove', async () => {
    const calls: string[][] = [];
    await safeRemoveWorktree('/base/gh-acme-w-pr7', { exec: async (c, a) => { calls.push([c, ...a]); return ''; }, warn: () => {} });
    const joined = calls.map((c) => c.join(' '));
    expect(joined).toContain('git -C /base/gh-acme-w-pr7 worktree remove /base/gh-acme-w-pr7');
    expect(joined.some((c) => c.includes('--force'))).toBe(false);
  });
  it('warns (does not throw) when removal fails — uncommitted work is left in place', async () => {
    const warn = vi.fn();
    await safeRemoveWorktree('/w', { exec: async () => { throw new Error('contains modified or untracked files'); }, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/w'));
  });
});
