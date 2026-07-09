import { describe, it, expect, vi } from 'vitest';
import { signalTerminalInteraction } from '../../../apps/desktop/src/components/instances/terminalInteraction.js';

describe('signalTerminalInteraction', () => {
  it('emits focusChanged when the instance needs attention', () => {
    const spy = vi.fn();
    signalTerminalInteraction('i1', 'waiting-permission', spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('i1');
  });

  it('does nothing for a non-attention status', () => {
    const spy = vi.fn();
    signalTerminalInteraction('i1', 'working', spy);
    expect(spy).not.toHaveBeenCalled();
  });
});
