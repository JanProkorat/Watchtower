// @vitest-environment jsdom
//
// Integration smoke for the iPad attention wiring (Task E1): the real Shell
// renders the shared NotificationHub off the merged bell source, and tapping a
// THREAD item opens the shared AttentionThreadDrawer. On a connected bridge the
// drawer offers "Open in terminal".
//
// The heavy shell dependencies (Capacitor, the WS bridge, the live-instances
// provider, the lazy billing module) are mocked to their smallest safe stubs so
// the test exercises the REAL merge + hub + drawer path, not a re-implemented
// copy of it. Only the two boundaries the task cares about are meaningful: the
// Supabase thread hook (one unanswered thread) and the bridge status
// ('connected').
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

// --- Bridge: connected, no-op invoke/on/onStatus. ---
const bridge = {
  invoke: vi.fn(async () => ({})),
  on: vi.fn(() => () => {}),
  onStatus: vi.fn(() => () => {}),
  close: vi.fn(),
};
vi.mock('../../apps/ipad/src/state/connectionContext.js', () => ({
  useConnection: () => ({ bridge, status: 'connected', reconnect: () => {} }),
  ConnectionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// --- Live instances: none, so the bell source is thread-only. ---
vi.mock('../../apps/ipad/src/state/instancesData.js', () => ({
  useInstancesData: () => ({ instances: [], projects: [] }),
  InstancesDataProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// --- Push + Capacitor: inert. ---
vi.mock('../../apps/ipad/src/state/pushRegistration.js', () => ({ registerForPush: async () => {} }));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: async () => ({ receive: 'denied' }),
    register: async () => {},
    addListener: async () => ({ remove() {} }),
  },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {} },
}));

// --- Lazy billing module (default dashboard view) stubbed to nothing. ---
vi.mock('@watchtower/module-timetracker', () => ({ BillingArea: () => null }));

import { Shell } from '../../apps/ipad/src/App';

const connection = { host: '127.0.0.1', port: 7445, token: 't' };

describe('iPad attention integration', () => {
  it('bell → hub → drawer: a thread item opens the reply drawer with "Open in terminal" (connected)', async () => {
    render(<Shell connection={connection} onConnectionChange={() => {}} />);

    // Bell badge reflects the merged count (one thread, no live items).
    const bell = await screen.findByTitle('Notifications');
    fireEvent.click(bell);

    // Hub lists the merged item; tapping it opens the drawer for the thread.
    const row = await screen.findByText('watchtower');
    fireEvent.click(row);

    await waitFor(() => {
      // Drawer content: the Claude snapshot question + the connected-only action.
      expect(screen.getByText(/Allow the edit\?/)).toBeTruthy();
      expect(screen.getByText('Open in terminal')).toBeTruthy();
    });
  });
});
