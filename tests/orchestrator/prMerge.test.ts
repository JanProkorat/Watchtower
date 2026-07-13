import { describe, it, expect, vi } from 'vitest';
import { mergeGithubPr, mergeAzdoPr } from '../../orchestrator/services/prWatch/merge.js';

describe('merge', () => {
  it('mergeGithubPr squashes with delete-branch', async () => {
    const exec = vi.fn(async () => '');
    await mergeGithubPr('acme/widgets', 42, true, exec);
    expect(exec).toHaveBeenCalledWith('gh', ['pr', 'merge', '42', '--repo', 'acme/widgets', '--squash', '--delete-branch']);
  });

  it('mergeGithubPr omits --delete-branch when false', async () => {
    const exec = vi.fn(async () => '');
    await mergeGithubPr('acme/widgets', 42, false, exec);
    expect(exec).toHaveBeenCalledWith('gh', ['pr', 'merge', '42', '--repo', 'acme/widgets', '--squash']);
  });

  it('mergeAzdoPr PATCHes completed with squash', async () => {
    const patch = vi.fn(async () => {});
    await mergeAzdoPr('https://host/org', 'repo', 7, 'sha123', true, 'pat', patch);
    const [url, , body] = patch.mock.calls[0];
    expect(url).toContain('/pullRequests/7');
    expect(body).toMatchObject({
      status: 'completed',
      lastMergeSourceCommit: { commitId: 'sha123' },
      completionOptions: { mergeStrategy: 'squash', deleteSourceBranch: true },
    });
  });
});
