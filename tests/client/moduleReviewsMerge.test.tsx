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

beforeEach(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (window as any).watchtower = {
    invoke: vi.fn(async (kind: string) => {
      switch (kind) {
        case 'prs:list':
        case 'prs:refresh': return { pullRequests: [pr], syncedAt: '2026-07-12T10:00:00Z' };
        case 'prWatch:list': return { items: [], unread: 0 };
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
});

describe('ModuleReviews merge button', () => {
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
