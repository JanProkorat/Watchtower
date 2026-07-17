import { describe, it, expect } from 'vitest';
import { prEventLabel } from '../../apps/desktop/src/components/reviews/prEventLabel';

describe('prEventLabel', () => {
  it('maps known PR-watch kinds to readable messages', () => {
    expect(prEventLabel('pr-commented')).toBe('New comment');
    expect(prEventLabel('pr-approved')).toBe('Approved');
    expect(prEventLabel('pr-changes_requested')).toBe('Changes requested');
    expect(prEventLabel('pr-review_requested')).toBe('Review requested');
    expect(prEventLabel('pr-reviewed')).toBe('Reviewed');
  });

  it('falls back to a humanized form of an unknown kind', () => {
    expect(prEventLabel('pr-some_new-kind')).toBe('Some new kind');
  });

  it('falls back to "Update" for an empty event', () => {
    expect(prEventLabel('')).toBe('Update');
  });
});
