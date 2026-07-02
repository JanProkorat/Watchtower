import { describe, it, expect } from 'vitest';
import { sizesAfterDrag } from '../../apps/ipad/src/lib/paneResize.js';

describe('sizesAfterDrag', () => {
  it('moves percentage from the right pane to the left when dragging right', () => {
    expect(sizesAfterDrag([50, 50], 0, 10)).toEqual([60, 40]);
  });
  it('moves the other way for a negative delta', () => {
    expect(sizesAfterDrag([50, 50], 0, -20)).toEqual([30, 70]);
  });
  it('clamps to the minimum and does not overshoot', () => {
    expect(sizesAfterDrag([50, 50], 0, 100, 8)).toEqual([92, 8]);
    expect(sizesAfterDrag([50, 50], 0, -100, 8)).toEqual([8, 92]);
  });
  it('only touches the two panes around the divider', () => {
    expect(sizesAfterDrag([30, 40, 30], 1, 10)).toEqual([30, 50, 20]);
  });
});
