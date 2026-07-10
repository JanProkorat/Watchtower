import { describe, it, expect } from 'vitest';
import { parseAzdoPrList } from '../../orchestrator/services/prProviders/azureDevops.js';

const REPO = { host: 'azdo' as const, repoKey: 'azdo:PPS/technology', repoLabel: 'PPS / technology',
  orgBaseUrl: 'https://devops.skoda/tfs/DefaultCollection', project: 'PPS', repo: 'technology', localClonePath: '/tmp/pps' };
const AZDO = { value: [
  { pullRequestId: 4821, title: 'TEH-2044', createdBy: { uniqueName: 'm.kral@skoda' },
    sourceRefName: 'refs/heads/feature/TEH-2044', targetRefName: 'refs/heads/develop',
    creationDate: '2026-07-10T09:00:00Z' },
] };

describe('azdo provider', () => {
  it('normalizes AZDO PR JSON and strips refs/heads/', () => {
    const prs = parseAzdoPrList(AZDO, REPO);
    expect(prs[0]).toMatchObject({
      host: 'azdo', repoKey: 'azdo:PPS/technology', number: 4821, title: 'TEH-2044',
      author: 'm.kral@skoda', sourceBranch: 'feature/TEH-2044', targetBranch: 'develop', reviewable: true,
    });
    expect(prs[0].url).toContain('/pullrequest/4821');
  });
});
