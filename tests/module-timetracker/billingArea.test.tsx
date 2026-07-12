// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mutable auth state the mocked hook reads (vi.mock is hoisted).
const h = vi.hoisted(() => ({
  status: 'out' as 'out' | 'in' | 'loading',
  session: null as null | { user: { id: string } },
}));

vi.mock('@watchtower/data-supabase', () => ({
  useSupabaseAuth: () => ({
    status: h.status,
    session: h.session,
    signIn: vi.fn(async () => ({})),
    signOut: vi.fn(async () => {}),
  }),
  useBilling: () => ({ data: null, state: 'offline', refresh: vi.fn(async () => {}) }),
}));

// The only section rendered for module="dashboard"; stub it to a marker.
vi.mock('../../packages/module-timetracker/src/billing/DashboardView.js', () => ({
  DashboardView: () => <div>DASHBOARD_CONTENT</div>,
}));

import { BillingArea } from '../../packages/module-timetracker/src/billing/BillingArea';

beforeEach(() => {
  h.status = 'out';
  h.session = null;
});

describe('BillingArea', () => {
  it('renders content (not a login screen) when signed out', () => {
    render(<BillingArea module="dashboard" section="earnings" />);
    expect(screen.getByText('DASHBOARD_CONTENT')).toBeTruthy();
  });

  it('shows the not-connected bar when signed out', () => {
    render(<BillingArea module="dashboard" section="earnings" />);
    expect(screen.getByText(/showing cached data/i)).toBeTruthy();
  });

  it('hides the bar when signed in', () => {
    h.status = 'in';
    h.session = { user: { id: 'u1' } };
    render(<BillingArea module="dashboard" section="earnings" />);
    expect(screen.queryByText(/showing cached data/i)).toBeNull();
    expect(screen.getByText('DASHBOARD_CONTENT')).toBeTruthy();
  });

  it('opens the login dialog from the bar button', () => {
    render(<BillingArea module="dashboard" section="earnings" />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByText('Přihlášení')).toBeTruthy();
  });
});
