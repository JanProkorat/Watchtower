// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { filterImplementComments, buildImplementPrompt, sanitizeSlug, worktreePathFor, prepareImplementLaunch } from '../../orchestrator/services/prImplement.js';

const thread = (o: Partial<any> = {}) => ({
  id: 't', file: 'src/a.ts', line: 10, status: null,
  comments: [{ author: 'reviewer', date: '2026-07-20T00:00:00Z', body: 'rename this' }], ...o,
});

describe('filterImplementComments', () => {
  it('keeps code-anchored threads (file + line present)', () => {
    const kept = filterImplementComments([thread(), thread({ id: 'g', file: null, line: null })]);
    expect(kept.map((t) => t.id)).toEqual(['t']);
  });
  it('drops azdo threads marked fixed/closed, keeps active/null', () => {
    const kept = filterImplementComments([
      thread({ id: 'a', status: 'active' }), thread({ id: 'f', status: 'fixed' }),
      thread({ id: 'c', status: 'closed' }), thread({ id: 'n', status: null }),
    ]);
    expect(kept.map((t) => t.id).sort()).toEqual(['a', 'n']);
  });
  it('when myAuthor given, drops threads with no comment from someone else', () => {
    const kept = filterImplementComments([
      thread({ id: 'mine', comments: [{ author: 'me', date: 'x', body: 'note to self' }] }),
      thread({ id: 'theirs', comments: [{ author: 'reviewer', date: 'x', body: 'fix' }] }),
    ], 'me');
    expect(kept.map((t) => t.id)).toEqual(['theirs']);
  });
  it('when myAuthor omitted, does not apply the authorship filter', () => {
    const kept = filterImplementComments([thread({ id: 'mine', comments: [{ author: 'me', date: 'x', body: 'n' }] })]);
    expect(kept.map((t) => t.id)).toEqual(['mine']);
  });
});

describe('buildImplementPrompt', () => {
  const pr = { number: 7, title: 'Add widget', repoLabel: 'Spot', sourceBranch: 'feat/widget', host: 'github' as const };
  it('includes PR context, the source branch, grouped comments, and push-gated instructions', () => {
    const p = buildImplementPrompt(pr, [thread({ file: 'src/a.ts', line: 10, comments: [{ author: 'rev', date: 'x', body: 'rename foo' }] })]);
    expect(p).toContain('#7');
    expect(p).toContain('Add widget');
    expect(p).toContain('feat/widget');
    expect(p).toContain('src/a.ts');
    expect(p).toContain('rename foo');
    expect(p.toLowerCase()).toContain('ask'); // ask before push
    expect(p.toLowerCase()).toContain('push');
    expect(p.toLowerCase()).toContain('never force');
  });
});

describe('worktreePathFor / sanitizeSlug', () => {
  it('sanitizes repoKey and builds a stable path', () => {
    expect(sanitizeSlug('azdo:dev.azure.com/o/r')).toBe('azdo-dev.azure.com-o-r');
    expect(worktreePathFor('/base', 'gh:acme/w', 7)).toBe('/base/gh-acme-w-pr7');
  });
});

describe('prepareImplementLaunch', () => {
  const basePr = { host: 'github' as const, repoKey: 'gh:acme/w', number: 7, title: 'Add widget', repoLabel: 'Spot', sourceBranch: 'feat/widget', clonePath: '/repo' };
  const okThreads = [{ id: 't', file: 'src/a.ts', line: 3, status: null, comments: [{ author: 'rev', date: 'x', body: 'fix' }] }];

  it('fetches the source branch and adds a worktree on it, returning prompt + path', async () => {
    const calls: string[][] = [];
    const launch = await prepareImplementLaunch(basePr, {
      exec: async (cmd, args) => { calls.push([cmd, ...args]); return ''; },
      fetchComments: async () => okThreads as any,
      resolveMyAuthor: async () => 'me',
      ensureDir: () => {},
      baseDir: '/base',
    });
    expect(launch.worktreePath).toBe('/base/gh-acme-w-pr7');
    expect(launch.commentCount).toBe(1);
    expect(launch.prompt).toContain('src/a.ts');
    // git fetch origin feat/widget
    expect(calls.some((c) => c.join(' ') === 'git -C /repo fetch --no-tags --force origin feat/widget')).toBe(true);
    // git worktree add <path> feat/widget  (no -B: never resets an existing local branch)
    expect(calls.some((c) => c.join(' ') === 'git -C /repo worktree add /base/gh-acme-w-pr7 feat/widget')).toBe(true);
  });

  it('throws when there are no qualifying comments (nothing to implement)', async () => {
    await expect(prepareImplementLaunch(basePr, {
      exec: async () => '',
      fetchComments: async () => [{ id: 'g', file: null, line: null, status: null, comments: [{ author: 'rev', date: 'x', body: 'lgtm' }] }] as any,
      resolveMyAuthor: async () => 'me',
      ensureDir: () => {}, baseDir: '/base',
    })).rejects.toThrow(/no unresolved code comments/i);
  });

  it('propagates a git worktree-add failure (e.g. branch already checked out)', async () => {
    await expect(prepareImplementLaunch(basePr, {
      exec: async (_cmd, args) => { if (args.includes('add')) throw new Error("fatal: 'feat/widget' is already checked out"); return ''; },
      fetchComments: async () => okThreads as any,
      resolveMyAuthor: async () => 'me',
      ensureDir: () => {}, baseDir: '/base',
    })).rejects.toThrow(/already checked out/);
  });
});
