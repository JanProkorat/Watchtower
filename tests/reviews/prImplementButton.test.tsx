// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PrInspectorDrawer } from '../../apps/desktop/src/components/reviews/PrInspectorDrawer';
import { ToastProvider } from '../../apps/desktop/src/state/useToast.js';

const pr = { host: 'github', repoKey: 'gh:a/b', number: 5, title: 'T', repoLabel: 'R', author: 'me', sourceBranch: 's', targetBranch: 'main', url: 'u', updatedAt: 'x', reviewable: true } as any;
const anchored = [{ id: 't', file: 'a.ts', line: 1, status: null, comments: [{ author: 'rev', date: 'x', body: 'fix' }] }];

const baseProps = (over: any = {}) => ({
  pr, onClose: () => {},
  loadDiff: async () => [], loadComments: async () => anchored as any,
  review: null, reviewRunning: false, openReviewFor: async () => {}, runReview: async () => 1,
  cancelReview: async () => {}, postComments: async () => ({ posted: 0, skipped: 0, errors: [] }),
  mergePr: async () => {}, closePr: async () => {}, approvePr: async () => {},
  fetchReviewState: async () => ({ amIAuthor: true, approved: false, mergeable: false, mergeBlockedReason: null }),
  implementComments: vi.fn(async () => ({ instanceId: 'inst-1', worktreePath: '/w' })),
  onImplementLaunched: vi.fn(),
  ...over,
});

describe('Fix with agent button', () => {
  it('shows on own PR with a count and launches on click', async () => {
    const props = baseProps();
    render(<ToastProvider><PrInspectorDrawer {...props} /></ToastProvider>);
    const btn = await screen.findByRole('button', { name: /fix with agent \(1\)/i });
    fireEvent.click(btn);
    await waitFor(() => expect(props.implementComments).toHaveBeenCalledWith(pr));
    await waitFor(() => expect(props.onImplementLaunched).toHaveBeenCalledWith('inst-1'));
  });

  it('is hidden when the user is not the author', async () => {
    const props = baseProps({ fetchReviewState: async () => ({ amIAuthor: false, approved: true, mergeable: true, mergeBlockedReason: null }) });
    render(<ToastProvider><PrInspectorDrawer {...props} /></ToastProvider>);
    await screen.findByRole('button', { name: /approve/i }); // review state loaded
    expect(screen.queryByRole('button', { name: /fix with agent/i })).toBeNull();
  });
});
