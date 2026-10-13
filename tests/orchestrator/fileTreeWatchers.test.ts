import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileTreeWatchers, type WatchFn } from '../../orchestrator/services/fileTreeWatchers.js';

let emitters: Map<string, (f: string | null) => void>;
let closed: string[];
const fakeWatch: WatchFn = (dir, onEvent) => {
  emitters.set(dir, onEvent);
  return { close: () => closed.push(dir) };
};

beforeEach(() => {
  vi.useFakeTimers();
  emitters = new Map();
  closed = [];
});
afterEach(() => vi.useRealTimers());

describe('FileTreeWatchers', () => {
  it('one watcher per folder, debounced, telling every watching pane', () => {
    const changed: string[] = [];
    const w = new FileTreeWatchers(fakeWatch, (id) => changed.push(id), 300);
    w.watch('/repo', 'a');
    w.watch('/repo', 'b');
    expect(emitters.size).toBe(1);
    emitters.get('/repo')?.('src/x.ts');
    emitters.get('/repo')?.('src/y.ts');
    vi.advanceTimersByTime(299);
    expect(changed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changed.sort()).toEqual(['a', 'b']);
  });

  it('ignores .git noise except index and HEAD', () => {
    const changed: string[] = [];
    const w = new FileTreeWatchers(fakeWatch, (id) => changed.push(id), 300);
    w.watch('/repo', 'a');
    emitters.get('/repo')?.('.git/objects/ab/cdef');
    vi.advanceTimersByTime(400);
    expect(changed).toEqual([]);
    emitters.get('/repo')?.('.git/index');
    vi.advanceTimersByTime(400);
    expect(changed).toEqual(['a']);
  });

  it('closing one pane keeps the folder watched for the other; the last one closes it', () => {
    const changed: string[] = [];
    const w = new FileTreeWatchers(fakeWatch, (id) => changed.push(id), 300);
    w.watch('/repo', 'a');
    w.watch('/repo', 'b');
    w.unwatch('a');
    expect(closed).toEqual([]);
    emitters.get('/repo')?.('x');
    vi.advanceTimersByTime(300);
    expect(changed).toEqual(['b']);
    w.unwatch('b');
    expect(closed).toEqual(['/repo']);
  });

  it('a pane switching folders moves its watch', () => {
    const w = new FileTreeWatchers(fakeWatch, () => {}, 300);
    w.watch('/one', 'a');
    w.watch('/two', 'a');
    expect(closed).toEqual(['/one']);
    expect([...emitters.keys()]).toEqual(['/one', '/two']);
  });

  it('a watcher that fails to start leaves nothing behind', () => {
    const w = new FileTreeWatchers(() => { throw new Error('EMFILE'); }, () => {}, 300);
    expect(() => w.watch('/repo', 'a')).not.toThrow();
    expect(() => w.unwatch('a')).not.toThrow();
  });
});
