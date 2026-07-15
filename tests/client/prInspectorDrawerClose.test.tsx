// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PrInspectorDrawer } from '../../apps/desktop/src/components/reviews/PrInspectorDrawer.js';
import { ToastProvider } from '../../apps/desktop/src/state/useToast.js';

// Close-without-merge (GitHub close / ADO abandon). Author-only: closing someone
// else's PR is rare and error-prone, so the button renders only when
// reviewState.amIAuthor. Destructive-ish → inline two-step confirm, no modal.

const ghPr = {
  host: 'github' as const, repoKey: 'gh:acme/w', repoLabel: 'w', number: 42,
  title: 'Add sprockets', author: 'jan', sourceBranch: 'feat', targetBranch: 'main',
  url: 'u', updatedAt: '2026-07-12T10:00:00Z', reviewable: true,
};
const azdoPr = { ...ghPr, host: 'azdo' as const, repoKey: 'azdo:host/r' };

const baseProps = {
  onClose: vi.fn(),
  loadDiff: vi.fn(async () => []),
  loadComments: vi.fn(async () => []),
  review: null, reviewRunning: false,
  openReviewFor: vi.fn(async () => {}),
  runReview: vi.fn(async () => 1),
  cancelReview: vi.fn(async () => {}),
  postComments: vi.fn(async () => ({ posted: 0, skipped: 0, errors: [] })),
  mergePr: vi.fn(async () => {}),
  approvePr: vi.fn(async () => {}),
};

const asAuthor = vi.fn(async () => ({ amIAuthor: true, approved: false, mergeable: true, mergeBlockedReason: null }));
const asReviewer = vi.fn(async () => ({ amIAuthor: false, approved: false, mergeable: true, mergeBlockedReason: null }));

describe('PrInspectorDrawer close/abandon', () => {
  it('shows "Close PR" on my own GitHub PR; confirm-click closes it and the drawer', async () => {
    const closePr = vi.fn(async () => {});
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <PrInspectorDrawer {...baseProps} pr={ghPr} onClose={onClose} fetchReviewState={asAuthor} closePr={closePr} />
      </ToastProvider>,
    );
    const btn = await screen.findByRole('button', { name: /^Close PR$/ });
    fireEvent.click(btn);
    // First click arms the confirm — nothing invoked yet.
    expect(closePr).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Confirm close\?/ }));
    await waitFor(() => expect(closePr).toHaveBeenCalledWith('github', 'gh:acme/w', 42));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('labels the action "Abandon PR" for Azure DevOps', async () => {
    render(
      <ToastProvider>
        <PrInspectorDrawer {...baseProps} pr={azdoPr} fetchReviewState={asAuthor} closePr={vi.fn(async () => {})} />
      </ToastProvider>,
    );
    expect(await screen.findByRole('button', { name: /^Abandon PR$/ })).toBeInTheDocument();
  });

  it('hides the close action on someone else\'s PR', async () => {
    const fetch = asReviewer;
    render(
      <ToastProvider>
        <PrInspectorDrawer {...baseProps} pr={ghPr} fetchReviewState={fetch} closePr={vi.fn(async () => {})} />
      </ToastProvider>,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Close PR|Abandon PR/ })).not.toBeInTheDocument();
  });
});
