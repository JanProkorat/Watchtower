import { randomUUID } from 'node:crypto';

/** ISO-8601 UTC, millisecond precision, 'Z' suffix — the LWW comparison key. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Cross-store identity for a new row. */
export function newSyncId(): string {
  return randomUUID();
}
