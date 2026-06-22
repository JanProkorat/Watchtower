import { describe, it, expect, vi } from 'vitest';
import { emitPush, setPushSink } from '../../orchestrator/index';

describe('emitPush', () => {
  it('forwards a push to a registered sink', () => {
    const sink = vi.fn();
    setPushSink(sink);
    emitPush({ kind: 'badge', payload: { count: 3 } });
    expect(sink).toHaveBeenCalledWith({ kind: 'badge', payload: { count: 3 } });
    setPushSink(null);
  });

  it('does not throw when no sink is registered', () => {
    setPushSink(null);
    expect(() => emitPush({ kind: 'badge', payload: { count: 0 } })).not.toThrow();
  });
});
