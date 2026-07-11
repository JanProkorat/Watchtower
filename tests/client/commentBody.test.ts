import { describe, it, expect } from 'vitest';
import { parseCommentBody } from '../../apps/desktop/src/components/reviews/CommentThread.js';

describe('parseCommentBody', () => {
  it('splits plain text, a markdown link, and a bare URL into ordered segments', () => {
    const body = 'See [the docs](https://example.com/docs) and also https://example.com/raw for details.';
    const segs = parseCommentBody(body);
    expect(segs).toEqual([
      { text: 'See ' },
      { href: 'https://example.com/docs', label: 'the docs' },
      { text: ' and also ' },
      { href: 'https://example.com/raw', label: 'https://example.com/raw' },
      { text: ' for details.' },
    ]);
  });

  it('returns a single text segment when there are no links', () => {
    expect(parseCommentBody('just plain text')).toEqual([{ text: 'just plain text' }]);
  });

  it('handles a body that is only a bare URL', () => {
    expect(parseCommentBody('https://example.com')).toEqual([
      { href: 'https://example.com', label: 'https://example.com' },
    ]);
  });
});
