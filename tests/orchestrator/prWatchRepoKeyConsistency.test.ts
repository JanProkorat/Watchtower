import { describe, it, expect } from 'vitest';
import { ReviewsService } from '../../orchestrator/services/reviews.js';
import { githubWatched, azdoWatched } from '../../orchestrator/services/prWatch/queries.js';
import type { Exec, HttpGet } from '../../orchestrator/services/prProviders/types.js';
import type { SqliteLike } from '../../orchestrator/db/migrations.js';

// Guard against the namespace mismatch that broke every renderer join between
// the Reviews PR list (PullRequestPayload.repoKey, from resolveRepos) and the
// PrWatch inbox (WatchedPr.repoKey, from queries.ts). For the SAME PR the two
// code paths MUST mint the identical canonical repoKey, or the Merge button /
// deep-link / unread badge never line up.

function service(remote: string): ReviewsService {
  return new ReviewsService({
    db: {} as SqliteLike,
    projects: () => [{ id: 1, name: 'Widgets', folder_path: '/repo' }],
    gitRemote: async () => remote,
  });
}

describe('repoKey consistency: resolveRepos vs prWatch queries', () => {
  it('GitHub: githubWatched matches resolveRepos', async () => {
    const remote = 'git@github.com:acme/w.git';
    const canonical = (await service(remote).resolveRepos()).github[0].repoKey;
    expect(canonical).toBe('gh:acme/w');

    const exec: Exec = async (_cmd, args) => {
      if (args[0] === 'search') {
        // authored + review-requested searches both return the same PR; dedup handles it.
        return JSON.stringify([{ number: 42, repository: { nameWithOwner: 'acme/w' } }]);
      }
      // gh pr view --json …
      return JSON.stringify({
        number: 42, title: 't', url: 'u',
        reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
        reviews: [], comments: [],
      });
    };
    const watched = await githubWatched('me', exec);
    expect(watched).toHaveLength(1);
    expect(watched[0].repoKey).toBe(canonical);
  });

  it('Azure DevOps: azdoWatched matches resolveRepos', async () => {
    const remote = 'https://dev.azure.com/myorg/proj/_git/repo';
    const resolved = (await service(remote).resolveRepos()).azdo[0];
    const canonical = resolved.repoKey;
    expect(canonical).toBe('azdo:dev.azure.com/repo');

    const get: HttpGet = async (url) => {
      if (url.includes('/threads')) return { value: [] };
      return {
        value: [{
          pullRequestId: 7, title: 't', createdBy: { id: 'me' },
          reviewers: [], repository: { name: 'repo' }, mergeStatus: 'succeeded',
        }],
      };
    };
    // devopsHost is threaded exactly as index.ts does — from the resolved config.
    const watched = await azdoWatched(resolved.apiBase, resolved.devopsHost, { id: 'me' }, 'pat', get);
    expect(watched).toHaveLength(1);
    expect(watched[0].repoKey).toBe(canonical);
  });
});
