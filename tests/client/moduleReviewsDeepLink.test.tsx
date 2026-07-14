// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ModuleReviews } from '../../apps/desktop/src/components/reviews/ModuleReviews.js';
import { ToastProvider } from '../../apps/desktop/src/state/useToast.js';

// A deep-link target (from a macOS PR-notification click, routed via App) must
// auto-open that PR's drawer without a row click, mark it seen, and be consumed
// exactly once — even though App, not ModuleReviews, owns the 'deep-link'
// subscription and only mounts this component after switching to the module.

const REPO_KEY = 'gh:acme/w';

const pr = {
  host: 'github', repoKey: REPO_KEY, repoLabel: 'w', number: 42,
  title: 'Add sprockets', author: 'jan', sourceBranch: 'feat', targetBranch: 'main',
  url: 'u', updatedAt: '2026-07-12T10:00:00Z', reviewable: true,
};

const inboxItem = {
  host: 'github', repoKey: REPO_KEY, repoLabel: 'w', prNumber: 42, title: 'Add sprockets',
  myRole: 'author', approved: true, mergeable: true, mergeBlockedReason: null,
  latestEvent: 'pr-approved', latestAt: '2026-07-12T10:00:00Z', unread: true,
};

beforeEach(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (window as any).watchtower = {
    invoke: vi.fn(async (kind: string) => {
      switch (kind) {
        case 'prs:list':
        case 'prs:refresh': return { pullRequests: [pr], syncedAt: '2026-07-12T10:00:00Z' };
        case 'prWatch:list': return { items: [inboxItem], unread: 1 };
        case 'prWatch:markSeen': return { ok: true };
        case 'prs:diff': return { files: [] };
        case 'prs:comments': return { threads: [] };
        case 'prReview:list': return { reviews: [] };
        case 'prReview:get': return { review: null };
        case 'prs:reviewState': return { amIAuthor: true, approved: true, mergeable: true, mergeBlockedReason: null };
        default: return {};
      }
    }),
    on: vi.fn(() => () => {}),
  };
});

describe('ModuleReviews deep-link target', () => {
  it('auto-opens the target PR, marks it seen, and consumes the target once', async () => {
    const onConsume = vi.fn();
    render(
      <ToastProvider>
        <ModuleReviews
          deepLinkTarget={{ host: 'github', repoKey: REPO_KEY, prNumber: 42 }}
          onConsumeDeepLink={onConsume}
        />
      </ToastProvider>,
    );
    // Drawer opens without a row click → the Merge button appears. It renders
    // regardless of role now; it's enabled here only because the prs:reviewState
    // mock returns approved + mergeable.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Merge$/ })).toBeInTheDocument());
    // The PR was marked seen and the target consumed exactly once.
    expect((window as any).watchtower.invoke).toHaveBeenCalledWith(
      'prWatch:markSeen', { host: 'github', repoKey: REPO_KEY, prNumber: 42 },
    );
    expect(onConsume).toHaveBeenCalledTimes(1);
  });
});
