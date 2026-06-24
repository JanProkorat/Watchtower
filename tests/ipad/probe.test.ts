import { describe, it, expect, vi } from 'vitest';
import { probeInstances, watchState } from '../../apps/ipad/src/probe.js';

function fakeBridge(over: Partial<{ invoke: any; on: any }> = {}) {
  return {
    invoke: over.invoke ?? vi.fn().mockResolvedValue({ instances: [{ id: 'a' }, { id: 'b' }] }),
    on: over.on ?? vi.fn().mockReturnValue(() => {}),
  };
}

describe('probeInstances', () => {
  it('calls listInstances and returns the instances array', async () => {
    const bridge = fakeBridge();
    const out = await probeInstances(bridge as never);
    expect(bridge.invoke).toHaveBeenCalledWith('listInstances', {});
    expect(out).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
  it('propagates an invoke rejection', async () => {
    const bridge = fakeBridge({ invoke: vi.fn().mockRejectedValue(new Error('unauthorized')) });
    await expect(probeInstances(bridge as never)).rejects.toThrow('unauthorized');
  });
});

describe('watchState', () => {
  it('subscribes to stateChanged and forwards the unsubscribe', () => {
    const unsub = vi.fn();
    const on = vi.fn().mockReturnValue(unsub);
    const bridge = fakeBridge({ on });
    const cb = vi.fn();
    const off = watchState(bridge as never, cb);
    expect(on).toHaveBeenCalledWith('stateChanged', cb);
    off();
    expect(unsub).toHaveBeenCalled();
  });
});
