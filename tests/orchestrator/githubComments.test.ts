import { describe, it, expect } from 'vitest';
import { parseGithubComments } from '../../orchestrator/services/prProviders/github.js';

const REVIEW_JSON = JSON.stringify([
  {
    id: 987, path: 'src/foo.ts', line: 42, original_line: null,
    body: 'Consider extracting this.', user: { login: 'jan' }, created_at: '2026-07-10T12:00:00Z',
  },
]);

const CONVO_JSON = JSON.stringify({
  comments: [
    { author: { login: 'alice' }, body: 'LGTM overall.', createdAt: '2026-07-10T13:00:00Z' },
  ],
});

describe('parseGithubComments', () => {
  it('produces one anchored thread with path/line and one general thread with file=null', () => {
    const threads = parseGithubComments(REVIEW_JSON, CONVO_JSON);
    expect(threads).toHaveLength(2);

    const anchored = threads.find((t) => t.file != null)!;
    expect(anchored).toMatchObject({
      id: 'r987', file: 'src/foo.ts', line: 42, status: null,
      comments: [{ author: 'jan', date: '2026-07-10T12:00:00Z', body: 'Consider extracting this.' }],
    });

    const general = threads.find((t) => t.file == null)!;
    expect(general).toMatchObject({
      file: null, line: null, status: null,
      comments: [{ author: 'alice', date: '2026-07-10T13:00:00Z', body: 'LGTM overall.' }],
    });
  });

  it('falls back to original_line when line is null (outdated comment)', () => {
    const json = JSON.stringify([
      { id: 1, path: 'a.ts', line: null, original_line: 7, body: 'x', user: { login: 'u' }, created_at: '' },
    ]);
    const threads = parseGithubComments(json, '{"comments":[]}');
    expect(threads[0]).toMatchObject({ line: 7 });
  });

  it('returns no threads for empty review + convo', () => {
    expect(parseGithubComments('[]', '{"comments":[]}')).toEqual([]);
  });
});
