import { describe, it, expect } from 'vitest';
import { patFieldView } from '../../apps/desktop/src/components/reviews/patFieldView.js';

describe('patFieldView', () => {
  it('shows no chip and a plain prompt when no PAT is set', () => {
    const v = patFieldView('none');
    expect(v.chip).toBeNull();
    expect(v.placeholder).toBe('enter PAT');
  });

  it('shows a success chip and a "leave unchanged" prompt when saved', () => {
    const v = patFieldView('saved');
    expect(v.chip).toEqual({ label: 'saved', color: 'success' });
    expect(v.placeholder).toMatch(/saved/i);
  });

  it('shows a warning chip and a re-enter prompt when the stored PAT is unreadable', () => {
    const v = patFieldView('unreadable');
    expect(v.chip).toEqual({ label: 'unreadable — re-enter', color: 'warning' });
    expect(v.placeholder).toMatch(/re-enter/i);
  });
});
