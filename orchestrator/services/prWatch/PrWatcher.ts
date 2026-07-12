import type { PrWatchStateRepo } from '../../db/repositories/prWatchState.js';
import { computeEvents } from './computeEvents.js';
import type { WatchedPr, WatchEvent } from './types.js';

export interface PrWatcherIdentity { github: string | null; azdo: Map<string, { id: string }> }

export interface PrWatcherDeps {
  repo: PrWatchStateRepo;
  me: () => Promise<PrWatcherIdentity>;
  fetchWatched: () => Promise<WatchedPr[]>;
  now: () => string;
  onEvent: (pr: WatchedPr, ev: WatchEvent) => void;
}

export class PrWatcher {
  constructor(private deps: PrWatcherDeps) {}

  async cycle(): Promise<void> {
    const id = await this.deps.me();
    const prs = await this.deps.fetchWatched();
    const now = this.deps.now();
    // `me` for author-side comparisons: github login covers gh PRs; for azdo we
    // compare on reviewer id inside the query parser already, so any azdo PR
    // reaching here has non-me activity — pass the github login as the scalar
    // `me`, azdo authors are already filtered by id in parseAzdoPr.
    const meScalar = id.github ?? '';

    for (const pr of prs) {
      const prev = this.deps.repo.get(pr.host, pr.repoKey, pr.prNumber);
      const { events, next } = computeEvents(prev, pr, meScalar, now);
      this.deps.repo.upsert(next);
      for (const ev of events) this.deps.onEvent(pr, ev);
    }

    this.deps.repo.prune(prs.map((p) => ({ host: p.host, repoKey: p.repoKey, prNumber: p.prNumber })));
  }
}
