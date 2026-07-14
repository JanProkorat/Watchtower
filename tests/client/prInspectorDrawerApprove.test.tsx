// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PrInspectorDrawer } from '../../apps/desktop/src/components/reviews/PrInspectorDrawer.js';
import { ToastProvider } from '../../apps/desktop/src/state/useToast.js';

// The Approve button and the Merge gate are now driven by a live prs:reviewState
// fetch on drawer open (Task 3, #188) rather than the stale watch-inbox item —
// Approve must hide on my own PRs (self-approval is rejected by GitHub / pointless
// on ADO) and a successful approve must re-fetch reviewState so Merge updates.

const pr = {
  host: 'github' as const, repoKey: 'gh:acme/w', repoLabel: 'w', number: 42,
  title: 'Add sprockets', author: 'jan', sourceBranch: 'feat', targetBranch: 'main',
  url: 'u', updatedAt: '2026-07-12T10:00:00Z', reviewable: true,
};

const baseProps = {
  pr, onClose: vi.fn(),
  loadDiff: vi.fn(async () => []),
  loadComments: vi.fn(async () => []),
  review: null, reviewRunning: false,
  openReviewFor: vi.fn(async () => {}),
  runReview: vi.fn(async () => 1),
  cancelReview: vi.fn(async () => {}),
  postComments: vi.fn(async () => ({ posted: 0, skipped: 0, errors: [] })),
  mergePr: vi.fn(async () => {}),
};

describe('PrInspectorDrawer approve/merge action row', () => {
  it('hides Approve on my own PR (amIAuthor: true)', async () => {
    const fetchReviewState = vi.fn(async () => ({ amIAuthor: true, approved: false, mergeable: true, mergeBlockedReason: null }));
    render(
      <ToastProvider>
        <PrInspectorDrawer {...baseProps} fetchReviewState={fetchReviewState} approvePr={vi.fn()} />
      </ToastProvider>,
    );
    await waitFor(() => expect(fetchReviewState).toHaveBeenCalledWith('github', 'gh:acme/w', 42));
    expect(screen.queryByRole('button', { name: /^Approve$/ })).not.toBeInTheDocument();
    // Merge always renders, gated by reviewState (not approved yet → disabled).
    expect(screen.getByRole('button', { name: /^Merge$/ })).toBeDisabled();
  });

  it('shows Approve on someone else\'s PR and re-fetches reviewState on success', async () => {
    const fetchReviewState = vi.fn()
      .mockResolvedValueOnce({ amIAuthor: false, approved: false, mergeable: true, mergeBlockedReason: null })
      .mockResolvedValueOnce({ amIAuthor: false, approved: true, mergeable: true, mergeBlockedReason: null });
    const approvePr = vi.fn(async () => {});
    render(
      <ToastProvider>
        <PrInspectorDrawer {...baseProps} fetchReviewState={fetchReviewState} approvePr={approvePr} />
      </ToastProvider>,
    );
    const approveBtn = await screen.findByRole('button', { name: /^Approve$/ });
    // Not yet approved → Merge disabled.
    expect(screen.getByRole('button', { name: /^Merge$/ })).toBeDisabled();

    fireEvent.click(approveBtn);

    await waitFor(() => expect(approvePr).toHaveBeenCalledWith('github', 'gh:acme/w', 42));
    // Re-fetch after a successful approve.
    await waitFor(() => expect(fetchReviewState).toHaveBeenCalledTimes(2));
    // Second fetch says approved+mergeable → Merge lights up.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Merge$/ })).not.toBeDisabled());
  });

  it('surfaces a fetchReviewState failure without blanking the diff', async () => {
    const fetchReviewState = vi.fn(async () => { throw new Error('boom'); });
    render(
      <ToastProvider>
        <PrInspectorDrawer {...baseProps} fetchReviewState={fetchReviewState} approvePr={vi.fn()} />
      </ToastProvider>,
    );
    await waitFor(() => expect(fetchReviewState).toHaveBeenCalled());
    // Diff load (independent) still resolves fine; Merge renders disabled rather
    // than the drawer erroring out entirely.
    expect(screen.getByRole('button', { name: /^Merge$/ })).toBeDisabled();
  });
});
