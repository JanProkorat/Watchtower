// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginDialog } from '../../packages/module-timetracker/src/billing/LoginDialog';

const signIn = vi.fn(async () => ({}));

describe('LoginDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<LoginDialog open={false} onClose={() => {}} signIn={signIn} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the form when open', () => {
    render(<LoginDialog open onClose={() => {}} signIn={signIn} />);
    expect(screen.getByText('Přihlášení')).toBeTruthy();
  });

  it('closes on backdrop tap', () => {
    const onClose = vi.fn();
    render(<LoginDialog open onClose={onClose} signIn={signIn} />);
    fireEvent.click(screen.getByTestId('login-dialog-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when the card interior is clicked', () => {
    const onClose = vi.fn();
    render(<LoginDialog open onClose={onClose} signIn={vi.fn(async () => ({}))} />);
    // Click the heading (inside the card): stopPropagation must keep it open.
    fireEvent.click(screen.getByText('Přihlášení'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes after a successful sign-in', async () => {
    const onClose = vi.fn();
    render(<LoginDialog open onClose={onClose} signIn={vi.fn(async () => ({}))} />);
    fireEvent.click(screen.getByText('Přihlásit'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
