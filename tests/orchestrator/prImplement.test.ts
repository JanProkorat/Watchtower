// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { filterImplementComments, buildImplementPrompt, sanitizeSlug, worktreePathFor } from '../../orchestrator/services/prImplement.js';

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
