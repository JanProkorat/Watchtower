// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '../../apps/desktop/src/state/ipc';
import { toast } from '../../apps/desktop/src/state/useToast';

function stubBridge(impl: (kind: string, payload: unknown) => Promise<unknown>) {
  (window as unknown as { watchtower: unknown }).watchtower = { invoke: vi.fn(impl), on: () => () => {} };
}

describe('invoke — global IPC wrapper', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns the payload on success without toasting', async () => {
    stubBridge(async () => ({ ok: true }));
    const spy = vi.spyOn(toast, 'showError');
    const res = await invoke('prs:merge', { host: 'github', repoKey: 'k', prNumber: 1, deleteBranch: false });
    expect(res).toEqual({ ok: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('toasts and re-throws on failure for a normal kind', async () => {
    stubBridge(async () => { throw new Error('boom'); });
    const spy = vi.spyOn(toast, 'showError');
    await expect(invoke('prs:merge', { host: 'github', repoKey: 'k', prNumber: 1, deleteBranch: false }))
      .rejects.toThrow('boom');
    expect(spy).toHaveBeenCalledWith('boom');
  });

  it('does NOT toast for a silent background/poll kind', async () => {
    stubBridge(async () => { throw new Error('poll fail'); });
    const spy = vi.spyOn(toast, 'showError');
    await expect(invoke('prWatch:list', {})).rejects.toThrow('poll fail');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT toast when the caller opts out via { silent: true }', async () => {
    stubBridge(async () => { throw new Error('handled'); });
    const spy = vi.spyOn(toast, 'showError');
    await expect(invoke('prs:merge', { host: 'github', repoKey: 'k', prNumber: 1, deleteBranch: false }, { silent: true }))
      .rejects.toThrow('handled');
    expect(spy).not.toHaveBeenCalled();
  });
});
