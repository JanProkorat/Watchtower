// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModuleReviews } from '../../apps/desktop/src/components/reviews/ModuleReviews.js';
import { ToastProvider } from '../../apps/desktop/src/state/useToast.js';

// Regression guard for the repoKey namespace mismatch: with a MATCHING
// canonical repoKey on both the prs:list PR and the prWatch:list inbox item,
// opening the PR's drawer must render the author-only Merge button. Before the
// fix the two keys diverged ('acme/w' vs 'gh:acme/w') so the join was always
// null and the button never appeared.

const REPO_KEY = 'gh:acme/w';

const pr = {
  host: 'github', repoKey: REPO_KEY, repoLabel: 'w', number: 42,
  title: 'Add sprockets', author: 'jan', sourceBranch: 'feat', targetBranch: 'main',
  url: 'u', updatedAt: '2026-07-12T10:00:00Z', reviewable: true,
};

const inboxItem = {
  host: 'github', repoKey: REPO_KEY, repoLabel: 'w', prNumber: 42, title: 'Add sprockets',
  myRole: 'author', approved: true, mergeable: true, mergeBlockedReason: null,
  latestEvent: 'pr-approved', latestAt: '2026-07-12T10:00:00Z', unread: false,
};

beforeEach(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (window as any).watchtower = {
    invoke: vi.fn(async (kind: string) => {
      switch (kind) {
        case 'prs:list':
        case 'prs:refresh': return { pullRequests: [pr], syncedAt: '2026-07-12T10:00:00Z' };
        case 'prWatch:list': return { items: [inboxItem], unread: 0 };
        case 'prs:diff': return { files: [] };
        case 'prs:comments': return { threads: [] };
        case 'prReview:list': return { reviews: [] };
        case 'prReview:get': return { review: null };
        default: return {};
      }
    }),
    on: vi.fn(() => () => {}),
  };
});

describe('ModuleReviews merge button join', () => {
  it('renders the Merge button when prs:list and prWatch:list share the canonical repoKey', async () => {
    render(<ToastProvider><ModuleReviews /></ToastProvider>);
    // Wait for the PR row to load, then open its drawer.
    const title = await screen.findByText('Add sprockets');
    fireEvent.click(title);
    // Author-role + matching repoKey/number → the Merge button appears in the drawer.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Merge$/ })).toBeInTheDocument());
  });
});
