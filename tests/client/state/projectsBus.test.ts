import { describe, expect, it, vi } from 'vitest';
import {
  broadcastProjectsChanged,
  subscribeProjects,
} from '../../../apps/desktop/src/state/projectsBus.js';

describe('projectsBus', () => {
  it('notifies every subscriber on broadcast', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeProjects(a);
    const offB = subscribeProjects(b);

    broadcastProjectsChanged();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it('skips the excepted listener (the mutating hook already self-refreshed)', () => {
    const self = vi.fn();
    const other = vi.fn();
    const offSelf = subscribeProjects(self);
    const offOther = subscribeProjects(other);

    broadcastProjectsChanged(self);

    expect(self).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
    offSelf();
    offOther();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const off = subscribeProjects(listener);
    off();

    broadcastProjectsChanged();

    expect(listener).not.toHaveBeenCalled();
  });

  it('tolerates a listener that unsubscribes during broadcast', () => {
    const calls: string[] = [];
    let offB = () => {};
    const a = () => {
      calls.push('a');
      offB(); // remove b mid-iteration — must not throw or skip already-snapshotted work
    };
    const b = () => {
      calls.push('b');
    };
    const offA = subscribeProjects(a);
    offB = subscribeProjects(b);

    expect(() => broadcastProjectsChanged()).not.toThrow();
    expect(calls).toContain('a');
    offA();
    offB();
  });
});
