// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PullRequestPayload } from '@watchtower/shared/ipcContract.js';
import { PrRow } from '../../apps/desktop/src/components/reviews/PrRow';

const pr: PullRequestPayload = {
  host: 'github', repoKey: 'gh:o/r', repoLabel: 'MyRepo', number: 7, title: 'Fix things',
  author: 'Jan Prokorát', sourceBranch: 'b', targetBranch: 'main', url: 'u',
  updatedAt: '2026-07-10T00:00:00Z', reviewable: true,
};

describe('PrRow unread badge', () => {
  it('shows an unread badge when the PR has an unread notification', () => {
    render(<PrRow pr={pr} nowMs={0} onOpen={() => {}} unread />);
    expect(screen.getByLabelText('unread notification')).toBeTruthy();
  });

  it('shows no unread badge otherwise', () => {
    render(<PrRow pr={pr} nowMs={0} onOpen={() => {}} />);
    expect(screen.queryByLabelText('unread notification')).toBeNull();
  });
});
