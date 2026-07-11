import { useCallback, useEffect, useState } from 'react';
import type { PullRequestPayload, DiffFilePayload, PrCommentThreadPayload, PrHost } from '@watchtower/shared/ipcContract.js';

export type HostFilter = 'all' | 'github' | 'azdo';
const HOST_LABEL: Record<PrHost, string> = { github: 'GitHub', azdo: 'Azure DevOps · Škoda' };

export function sortByUpdatedDesc(prs: PullRequestPayload[]): PullRequestPayload[] {
  return [...prs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function groupPrsByHost(prs: PullRequestPayload[]) {
  const order: PrHost[] = ['github', 'azdo'];
  return order.map((host) => ({ host, label: HOST_LABEL[host],
    prs: sortByUpdatedDesc(prs.filter((p) => p.host === host)) })).filter((g) => g.prs.length > 0);
}

export function applyPrFilter(prs: PullRequestPayload[], host: HostFilter, query: string): PullRequestPayload[] {
  const q = query.trim().toLowerCase();
  return prs.filter((p) => (host === 'all' || p.host === host)
    && (q === '' || p.title.toLowerCase().includes(q) || p.repoLabel.toLowerCase().includes(q)
      || String(p.number).includes(q)));
}

export function relativeAge(iso: string, nowMs: number): string {
  const diff = nowMs - Date.parse(iso);
  if (diff < 60_000) return 'just now';
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `${Math.floor(diff / 60_000)}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function useReviews() {
  const [pullRequests, setPullRequests] = useState<PullRequestPayload[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (kind: 'prs:list' | 'prs:refresh') => {
    setLoading(true); setError(null);
    try {
      const res = await window.watchtower.invoke(kind, {});
      setPullRequests(res.pullRequests); setSyncedAt(res.syncedAt);
      return res;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); return null; }
    finally { setLoading(false); }
  }, []);

  const refresh = useCallback(() => load('prs:refresh'), [load]);

  useEffect(() => {
    void (async () => {
      const res = await load('prs:list');
      if (res && res.syncedAt === null) await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadDiff = useCallback(async (pr: PullRequestPayload): Promise<DiffFilePayload[]> => {
    const res = await window.watchtower.invoke('prs:diff', { host: pr.host, repoKey: pr.repoKey, prNumber: pr.number });
    return res.files;
  }, []);

  const loadComments = useCallback(async (pr: PullRequestPayload): Promise<PrCommentThreadPayload[]> => {
    const res = await window.watchtower.invoke('prs:comments', { host: pr.host, repoKey: pr.repoKey, prNumber: pr.number });
    return res.threads;
  }, []);

  return { pullRequests, syncedAt, loading, error, refresh, loadDiff, loadComments };
}
