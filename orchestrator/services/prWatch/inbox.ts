import type { SqliteLike } from '../../db/migrations.js';
import type { PrHost, PrWatchInboxItem } from '@watchtower/shared/ipcContract.js';
import { PrWatchStateRepo } from '../../db/repositories/prWatchState.js';

interface NotifRow { instance_id: string; kind: string; fired_at: number; dismissed_at: number | null }

/** Newest undismissed-aware notification info per PR key `pr:host:repoKey#n`. */
function notifByPr(db: SqliteLike): Map<string, { latestEvent: string; latestAt: string; unread: boolean }> {
  const rows = db
    .prepare(`SELECT instance_id, kind, fired_at, dismissed_at FROM notifications WHERE instance_id LIKE 'pr:%' ORDER BY fired_at DESC`)
    .all() as NotifRow[];
  const out = new Map<string, { latestEvent: string; latestAt: string; unread: boolean }>();
  for (const r of rows) {
    const cur = out.get(r.instance_id);
    if (!cur) {
      out.set(r.instance_id, { latestEvent: r.kind, latestAt: new Date(r.fired_at).toISOString(), unread: r.dismissed_at == null });
    } else if (r.dismissed_at == null) {
      cur.unread = true;
    }
  }
  return out;
}

export function buildInbox(db: SqliteLike): { items: PrWatchInboxItem[]; unread: number } {
  const notif = notifByPr(db);
  const items: PrWatchInboxItem[] = new PrWatchStateRepo(db).all().map((s) => {
    const key = `pr:${s.host}:${s.repoKey}#${s.prNumber}`;
    const n = notif.get(key);
    return {
      host: s.host, repoKey: s.repoKey, repoLabel: s.repoLabel, prNumber: s.prNumber,
      title: s.title, myRole: s.myRole,
      approved: s.approved, mergeable: s.mergeable, mergeBlockedReason: s.mergeBlockedReason,
      latestEvent: n?.latestEvent ?? '', latestAt: n?.latestAt ?? s.updatedAt, unread: n?.unread ?? false,
    };
  }).sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  return { items, unread: items.filter((i) => i.unread).length };
}

export function markPrSeen(db: SqliteLike, host: PrHost, repoKey: string, prNumber: number): void {
  db.prepare(`UPDATE notifications SET dismissed_at = ? WHERE instance_id = ? AND dismissed_at IS NULL`)
    .run(Date.now(), `pr:${host}:${repoKey}#${prNumber}`);
}
