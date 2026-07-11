// @vitest-environment jsdom
//
// Task F2: iPhone attention bell + hub + drawer wiring. Mirrors
// tests/ipad/attentionIntegration.test.tsx but for the iPhone Shell, which has
// no live-instances bridge — bellItems is thread-only (mergeAttention(threads,
// [])) and the reply drawer never gets an `openInTerminal` prop, so "Open in
// terminal" must never appear.
//
// The heavy Shell dependency (the lazy @watchtower/module-timetracker views)
// is stubbed to its smallest safe shape so the test exercises the REAL
// bell -> hub -> drawer path, not a re-implemented copy of it. registerPush
// (F1) is mocked so the effect that fires on mount doesn't touch Capacitor.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Supabase-backed escalation threads: one unanswered thread for i1. ---
const thread = {
  instanceId: 'i1',
  label: 'watchtower',
  kind: 'waiting-permission',
  unanswered: true,
  closed: false,
  messages: [
    {
      syncId: 'c1', instanceId: 'i1', projectLabel: 'watchtower', role: 'claude',
      kind: 'waiting-permission', body: 'Allow the edit?',
      options: [{ number: 1, label: 'Yes' }],
      replyTo: null, injectedAt: null, closedAt: null, createdAt: '1',
    },
  ],
};
const sendReply = vi.fn(async () => true);
vi.mock('@watchtower/data-supabase', () => ({
  useAttentionThreads: () => ({ threads: [thread], unansweredCount: 1, refresh: async () => {}, state: 'fresh' }),
  useAttentionReply: () => ({ sendReply, pending: false, error: null }),
}));

// --- Push registration (F1): inert, so the mount effect is a no-op. ---
vi.mock('../../apps/iphone/src/registerPush.js', () => ({ registerPush: vi.fn(async () => {}) }));

// --- Lazy TimeTracker views: only DashboardView (the default tab) is
// rendered by the Shell under test; the rest are unused named imports. ---
vi.mock('@watchtower/module-timetracker', () => ({ DashboardView: () => null }));

import { Shell } from '../../apps/iphone/src/App';

describe('iPhone attention integration', () => {
  it('bell badge -> hub -> drawer, no "Open in terminal" (no bridge on iPhone)', async () => {
    render(<Shell signOut={async () => {}} />);

    // Bell badge reflects the merged (thread-only) count.
    const bell = await screen.findByTitle('Notifications');
    expect(bell.textContent).toContain('1');

    fireEvent.click(bell);

    // Hub lists the merged item; tapping it opens the drawer for the thread.
    const row = await screen.findByText('watchtower');
    fireEvent.click(row);

    await waitFor(() => {
      // Drawer content: the Claude snapshot question renders...
      expect(screen.getByText(/Allow the edit\?/)).toBeTruthy();
      // ...but no "Open in terminal" action (iPhone has no Mac bridge).
      expect(screen.queryByText('Open in terminal')).toBeNull();
    });
  });
});
