import { describe, it, expect } from 'vitest';
import { sidePanelButtonTitle } from '../../../apps/desktop/src/components/instances/side/sidePanelButtonTitle';

describe('sidePanelButtonTitle', () => {
  it('is plain when nothing is unseen', () => {
    expect(sidePanelButtonTitle(0)).toBe('Show side panel');
  });
  it('uses the singular for one edit', () => {
    expect(sidePanelButtonTitle(1)).toBe('Show side panel · 1 unseen edit');
  });
  it('uses the plural for several', () => {
    expect(sidePanelButtonTitle(3)).toBe('Show side panel · 3 unseen edits');
  });
});
