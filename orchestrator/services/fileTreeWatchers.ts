import { watch } from 'node:fs';

export type WatchFn = (dir: string, onEvent: (filename: string | null) => void) => { close(): void };

/** Recursive fs.watch; macOS supports `recursive` natively. */
export const nodeWatch: WatchFn = (dir, onEvent) => {
  const w = watch(dir, { recursive: true }, (_ev, filename) => onEvent(filename ? String(filename) : null));
  // An unhandled 'error' (e.g. folder deleted) would crash the orchestrator process.
  w.on('error', () => w.close());
  return w;
};

interface Entry {
  close(): void;
  ids: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

/** One recursive watcher per folder, shared by every pane showing it; tells each pane after a quiet spell. */
export class FileTreeWatchers {
  private byCwd = new Map<string, Entry>();
  private cwdOf = new Map<string, string>();

  constructor(
    private readonly watchFn: WatchFn,
    private readonly onChange: (instanceId: string) => void,
    private readonly debounceMs = 300,
  ) {}

  watch(cwd: string, instanceId: string): void {
    if (this.cwdOf.get(instanceId) === cwd) return;
    this.unwatch(instanceId);
    let entry = this.byCwd.get(cwd);
    if (!entry) {
      const fresh: Entry = { close: () => {}, ids: new Set(), timer: null };
      try {
        fresh.close = this.watchFn(cwd, (f) => this.onEvent(fresh, f)).close;
      } catch {
        return; // No live refresh for this folder; the tab still lists on demand.
      }
      entry = fresh;
      this.byCwd.set(cwd, entry);
    }
    entry.ids.add(instanceId);
    this.cwdOf.set(instanceId, cwd);
  }

  unwatch(instanceId: string): void {
    const cwd = this.cwdOf.get(instanceId);
    if (cwd === undefined) return;
    this.cwdOf.delete(instanceId);
    const entry = this.byCwd.get(cwd);
    if (!entry) return;
    entry.ids.delete(instanceId);
    if (entry.ids.size > 0) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.close();
    this.byCwd.delete(cwd);
  }

  private onEvent(entry: Entry, filename: string | null): void {
    const f = filename?.split('\\').join('/') ?? '';
    if ((f === '.git' || f.startsWith('.git/')) && f !== '.git/index' && f !== '.git/HEAD') return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      for (const id of entry.ids) {
        try {
          this.onChange(id);
        } catch {
          // One failing listener must not escape the timer or skip the other panes.
        }
      }
    }, this.debounceMs);
  }
}
