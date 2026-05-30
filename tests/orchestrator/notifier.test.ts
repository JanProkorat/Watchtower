import { describe, it, expect, beforeEach } from 'vitest';
import { Notifier, type NotifierEmitters } from '../../orchestrator/notifier.js';

function makeNotifier() {
  const notifies: Array<{ instanceId: string; kind: string }> = [];
  const cleared: string[] = [];
  const badges: number[] = [];
  const emit: NotifierEmitters = {
    notify: (p) => notifies.push({ instanceId: p.instanceId, kind: p.kind }),
    clearAttention: (id) => cleared.push(id),
    setBadge: (count) => badges.push(count),
  };
  return { notifier: new Notifier(emit), notifies, cleared, badges };
}

describe('Notifier window-focus awareness', () => {
  let h: ReturnType<typeof makeNotifier>;

  beforeEach(() => {
    h = makeNotifier();
  });

  it('suppresses notify + badge for the focused instance while the window is focused', () => {
    h.notifier.setFocused('a');
    h.notifier.setWindowFocused(true);
    h.notifier.apply('a', '/cwd', 'working', 'waiting-permission', 1000);
    expect(h.notifies).toEqual([]);
    expect(h.badges).toEqual([]);
  });

  it('fires notify + badge for the active instance once the window is blurred (bug: dock badge missing)', () => {
    h.notifier.setFocused('a');
    h.notifier.setWindowFocused(false);
    h.notifier.apply('a', '/cwd', 'working', 'idle-notify', 1000);
    expect(h.notifies).toEqual([{ instanceId: 'a', kind: 'idle-notify' }]);
    expect(h.badges).toEqual([1]);
  });

  it('still fires for a non-focused instance even when the window is focused', () => {
    h.notifier.setFocused('a');
    h.notifier.setWindowFocused(true);
    h.notifier.apply('b', '/cwd', 'working', 'waiting-permission', 1000);
    expect(h.notifies).toEqual([{ instanceId: 'b', kind: 'waiting-permission' }]);
    expect(h.badges).toEqual([1]);
  });

  it('isFocused requires both window focus and the active tab', () => {
    h.notifier.setFocused('a');
    h.notifier.setWindowFocused(true);
    expect(h.notifier.isFocused('a')).toBe(true);
    expect(h.notifier.isFocused('b')).toBe(false);
    h.notifier.setWindowFocused(false);
    expect(h.notifier.isFocused('a')).toBe(false);
  });

  it('focusedId reports the currently focused instance', () => {
    expect(h.notifier.focusedId()).toBeNull();
    h.notifier.setFocused('a');
    expect(h.notifier.focusedId()).toBe('a');
  });
});
