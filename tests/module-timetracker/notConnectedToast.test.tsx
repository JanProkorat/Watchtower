// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotConnectedToast } from '../../packages/module-timetracker/src/billing/NotConnectedToast';

describe('NotConnectedToast', () => {
  it('renders the not-connected message', () => {
    render(<NotConnectedToast onSignIn={() => {}} />);
    expect(screen.getByText(/showing cached data/i)).toBeTruthy();
  });

  it('fires onSignIn when the button is clicked', () => {
    const onSignIn = vi.fn();
    render(<NotConnectedToast onSignIn={onSignIn} />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSignIn).toHaveBeenCalled();
  });
});
