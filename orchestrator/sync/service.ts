import type { SqliteLike } from '../db/migrations.js';
import type { PgStore } from '../db/pg/pool.js';
import { pushAll } from './push.js';
import { pullAll } from './pull.js';

export interface SyncCycleResult {
  ok: boolean;
  push?: Record<string, number>;
  pull?: Record<string, { pulled: number; conflicts: number; touchedFkIds: number[] }>;
  error?: string;
}

export interface SyncServiceOptions {
  db: SqliteLike;
  store: PgStore | null;
  /** Periodic full-cycle interval. Default 60s. */
  periodMs?: number;
  /** Debounce window after a local change. Default 1.5s. */
  debounceMs?: number;
  onCycle?: (r: SyncCycleResult) => void;
}

/**
 * Drives push+pull. Postgres is optional and may vanish at any time: every
 * cycle catches connection errors and returns ok:false instead of throwing, so
 * the desktop keeps working offline. Triggers: debounced local-change notify,
 * a periodic timer, and an explicit syncNow().
 */
export class SyncService {
  private readonly db: SqliteLike;
  private readonly store: PgStore | null;
  private readonly periodMs: number;
  private readonly debounceMs: number;
  private readonly onCycle?: (r: SyncCycleResult) => void;

  private timer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private pending = false;

  constructor(opts: SyncServiceOptions) {
    this.db = opts.db;
    this.store = opts.store;
    this.periodMs = opts.periodMs ?? 60_000;
    this.debounceMs = opts.debounceMs ?? 1_500;
    this.onCycle = opts.onCycle;
  }

  start(): void {
    if (!this.store || this.timer) return;
    this.timer = setInterval(() => { void this.syncNow(); }, this.periodMs);
    // Don't keep the event loop alive just for sync.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
  }

  notifyLocalChange(): void {
    if (!this.store) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.syncNow();
    }, this.debounceMs);
    if (this.debounceTimer && typeof this.debounceTimer.unref === 'function') this.debounceTimer.unref();
  }

  async syncNow(): Promise<SyncCycleResult> {
    if (!this.store) {
      const r: SyncCycleResult = { ok: true };
      this.onCycle?.(r);
      return r;
    }
    // Collapse overlapping runs: if one is in flight, mark pending and return.
    if (this.running) { this.pending = true; return { ok: true }; }
    this.running = true;
    let result: SyncCycleResult;
    try {
      const push = await pushAll(this.db, this.store);
      const pull = await pullAll(this.db, this.store);
      result = { ok: true, push, pull };
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.running = false;
    }
    this.onCycle?.(result);
    if (this.pending) { this.pending = false; void this.syncNow(); }
    return result;
  }
}
