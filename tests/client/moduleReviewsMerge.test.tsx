// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModuleReviews } from '../../apps/desktop/src/components/reviews/ModuleReviews.js';
import { ToastProvider } from '../../apps/desktop/src/state/useToast.js';

// The drawer's Merge button is now fed by a live prs:reviewState fetch (not the
// background watch-inbox item), so it must render for ANY PR — including one
// the watch-inbox poller hasn't seen yet (empty prWatch:list) — as long as
// prs:reviewState resolves for the matching host/repoKey/number.

const REPO_KEY = 'gh:acme/w';

const pr = {
  host: 'github', repoKey: REPO_KEY, repoLabel: 'w', number: 42,
  title: 'Add sprockets', author: 'jan', sourceBranch: 'feat', targetBranch: 'main',
  url: 'u', updatedAt: '2026-07-12T10:00:00Z', reviewable: true,
};

const reviewState = { amIAuthor: true, approved: true, mergeable: true, mergeBlockedReason: null };

// A matching watch-inbox item using the SAME canonical (gh:-prefixed) repoKey —
// used by the markSeen regression guard below.
const inboxItem = {
  host: 'github', repoKey: REPO_KEY, repoLabel: 'w', prNumber: 42, title: 'Add sprockets',
  myRole: 'author', approved: true, mergeable: true, mergeBlockedReason: null,
  latestEvent: 'pr-approved', latestAt: '2026-07-12T10:00:00Z', unread: true,
};

function mountWatchtower(inboxItems: unknown[]): void {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (window as any).watchtower = {
    invoke: vi.fn(async (kind: string) => {
      switch (kind) {
        case 'prs:list':
        case 'prs:refresh': return { pullRequests: [pr], syncedAt: '2026-07-12T10:00:00Z' };
        case 'prWatch:list': return { items: inboxItems, unread: inboxItems.length };
        case 'prWatch:markSeen': return { ok: true };
        case 'prs:diff': return { files: [] };
        case 'prs:comments': return { threads: [] };
        case 'prReview:list': return { reviews: [] };
        case 'prReview:get': return { review: null };
        case 'prs:reviewState': return reviewState;
        default: return {};
      }
    }),
    on: vi.fn(() => () => {}),
  };
}

describe('ModuleReviews merge button', () => {
  beforeEach(() => mountWatchtower([]));

  it('renders the Merge button fed from prs:reviewState, even when the PR is not in the watch inbox', async () => {
    render(<ToastProvider><ModuleReviews /></ToastProvider>);
    // Wait for the PR row to load, then open its drawer.
    const title = await screen.findByText('Add sprockets');
    fireEvent.click(title);
    // Merge renders regardless of role/watch-inbox membership, driven by the
    // live reviewState fetch.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Merge$/ })).toBeInTheDocument());
    // amIAuthor: true → the Approve button (self-approve) must not render.
    expect(screen.queryByRole('button', { name: /^Approve$/ })).not.toBeInTheDocument();
  });
});

// Regression guard for the #181 repoKey namespace mismatch. Merge no longer
// joins prs:list ↔ prWatch:list, but the markSeen path in ModuleReviews still
// matches an opened PR against the watch inbox by exact repoKey equality
// (ModuleReviews.tsx:50). If the two sources ever diverge again ('acme/w' vs
// 'gh:acme/w') the join is null and markSeen never fires — this asserts the
// canonical gh:-prefixed key flows through on a real producer path.
describe('ModuleReviews markSeen repoKey-format join', () => {
  beforeEach(() => mountWatchtower([inboxItem]));

  it('fires prWatch:markSeen with the canonical gh: repoKey when opening a watched PR', async () => {
    render(<ToastProvider><ModuleReviews /></ToastProvider>);
    const title = await screen.findByText('Add sprockets');
    fireEvent.click(title);
    await waitFor(() => expect((window as any).watchtower.invoke).toHaveBeenCalledWith(
      'prWatch:markSeen', { host: 'github', repoKey: REPO_KEY, prNumber: 42 },
    ));
  });
});
