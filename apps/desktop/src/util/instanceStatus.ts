const LIVE_STATUSES = new Set([
  'spawning', 'working', 'waiting-permission', 'waiting-input', 'idle-notify', 'resuming',
]);

export function isLiveStatus(status: string): boolean {
  return LIVE_STATUSES.has(status);
}

export function chipColorFor(
  status: string,
): 'default' | 'primary' | 'warning' | 'error' | 'success' | 'info' {
  switch (status) {
    case 'waiting-permission':
    case 'crashed':
      return 'error';
    case 'waiting-input':
      return 'warning';
    case 'idle-notify':
      return 'default';
    case 'working':
    case 'spawning':
    case 'resuming':
      return 'primary';
    case 'finished':
      return 'success';
    default:
      return 'default';
  }
}

export function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 5_000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)} s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} h ago`;
  return `${Math.floor(delta / 86_400_000)} d ago`;
}
