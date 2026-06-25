export interface Ping {
  instanceId: string;
  pingId: number;
  kind: string;
  title: string;
  body: string;
}

export function applyPing(prev: Ping | null, next: Ping): Ping {
  if (prev && next.pingId <= prev.pingId) return prev;
  return next;
}
