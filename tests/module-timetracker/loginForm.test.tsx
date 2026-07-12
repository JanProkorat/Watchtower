// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginForm } from '../../packages/module-timetracker/src/billing/LoginForm';

describe('LoginForm', () => {
  it('calls signIn with the entered credentials and fires onSuccess on success', async () => {
    const signIn = vi.fn(async () => ({}));
    const onSuccess = vi.fn();
    render(<LoginForm signIn={signIn} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByPlaceholderText('E-mail'), { target: { value: 'a@b.cz' } });
    fireEvent.change(screen.getByPlaceholderText('Heslo'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByText('Přihlásit'));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('a@b.cz', 'pw'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows the error and does not fire onSuccess on failure', async () => {
    const signIn = vi.fn(async () => ({ error: 'Špatné heslo' }));
    const onSuccess = vi.fn();
    render(<LoginForm signIn={signIn} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByText('Přihlásit'));
    await waitFor(() => expect(screen.getByText('Špatné heslo')).toBeTruthy());
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
