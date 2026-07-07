import { describe, it, expect, vi } from 'vitest';

// Force the web (no-op) implementation: registerPlugin uses the `web` factory
// when there's no native bridge (jsdom/node has none).
vi.mock('@capacitor/core', () => ({
  registerPlugin: (_name: string, impl: { web: () => unknown }) => impl.web(),
}));

describe('RemoteVnc web fallback', () => {
  it('present/disconnect resolve and addListener returns a remover', async () => {
    const { RemoteVnc } = await import('../../apps/ipad/src/lib/remoteVnc.js');
    await expect(RemoteVnc.present({ host: 'h', username: 'u', password: 'p' })).resolves.toBeUndefined();
    await expect(RemoteVnc.disconnect()).resolves.toBeUndefined();
    const sub = await RemoteVnc.addListener('state', () => {});
    expect(typeof sub.remove).toBe('function');
    sub.remove();
  });
});
