import { describe, expect, it } from 'vitest';
import { pruneAdHocCwds } from '../../../client/src/layout/pruneAdHocCwds.js';
import type { InstanceView } from '../../../client/src/state/useInstances.js';

const inst = (id: string, cwd: string, status = 'working'): InstanceView => ({
  id,
  cwd,
  status,
  lastActivityAt: 0,
});

describe('pruneAdHocCwds', () => {
  it('drops a cwd that has no backing instance (the closed-tab case)', () => {
    const next = pruneAdHocCwds(new Set(['/x']), []);
    expect([...next]).toEqual([]);
  });

  it('keeps a cwd that still has at least one instance', () => {
    const next = pruneAdHocCwds(new Set(['/x']), [inst('i1', '/x')]);
    expect([...next]).toEqual(['/x']);
  });

  it('keeps a cwd whose only instance is finished/crashed (row still present)', () => {
    const next = pruneAdHocCwds(new Set(['/x']), [inst('i1', '/x', 'finished')]);
    expect([...next]).toEqual(['/x']);
  });

  it('prunes only the empty cwds, leaving populated ones', () => {
    const next = pruneAdHocCwds(new Set(['/x', '/y']), [inst('i1', '/y')]);
    expect([...next]).toEqual(['/y']);
  });

  it('returns the same Set reference when nothing changed (no re-render)', () => {
    const input = new Set(['/x']);
    expect(pruneAdHocCwds(input, [inst('i1', '/x')])).toBe(input);
  });

  it('returns the same empty Set reference untouched', () => {
    const input = new Set<string>();
    expect(pruneAdHocCwds(input, [inst('i1', '/x')])).toBe(input);
  });
});
