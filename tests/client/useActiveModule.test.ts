import { describe, it, expect, beforeEach } from 'vitest';
import { readActiveModule, writeActiveModule, DEFAULT_ACTIVE_MODULE } from '../../client/src/state/useActiveModule.js';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

describe('useActiveModule helpers', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();
  });

  it('defaults to dashboard when nothing is persisted', () => {
    expect(readActiveModule()).toBe(DEFAULT_ACTIVE_MODULE);
    expect(DEFAULT_ACTIVE_MODULE).toBe('dashboard');
  });

  it('round-trips a valid module id', () => {
    writeActiveModule('timetracker');
    expect(readActiveModule()).toBe('timetracker');
  });

  it('falls back to dashboard on an unknown value', () => {
    localStorage.setItem('watchtower.activeModule', 'garbage');
    expect(readActiveModule()).toBe('dashboard');
  });

  it('swallows storage exceptions gracefully', () => {
    const broken = {
      getItem() { throw new Error('boom'); },
      setItem() { throw new Error('boom'); },
      removeItem() {}, clear() {}, key() { return null; }, length: 0,
    } as Storage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = broken;

    expect(() => readActiveModule()).not.toThrow();
    expect(readActiveModule()).toBe('dashboard');
    expect(() => writeActiveModule('settings')).not.toThrow();
  });
});
