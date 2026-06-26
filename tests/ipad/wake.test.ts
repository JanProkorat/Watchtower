import { describe, it, expect, vi } from 'vitest';
import { wakeTargets, performWake, type WakeDeps } from '../../apps/ipad/src/state/wake.js';

describe('wakeTargets', () => {
  it('builds a LAN target at port 9 and a DDNS target at wanPort', () => {
    expect(wakeTargets({ lanIp: '192.168.1.50', wanHost: 'home.ddns', wanPort: 9999 }))
      .toEqual([{ host: '192.168.1.50', port: 9 }, { host: 'home.ddns', port: 9999 }]);
  });
  it('omits absent targets and defaults DDNS port to 9', () => {
    expect(wakeTargets({ wanHost: 'home.ddns' })).toEqual([{ host: 'home.ddns', port: 9 }]);
    expect(wakeTargets({ lanIp: '10.0.0.2' })).toEqual([{ host: '10.0.0.2', port: 9 }]);
    expect(wakeTargets({})).toEqual([]);
  });
});

describe('performWake', () => {
  const okDeps = (): WakeDeps => ({ send: vi.fn().mockResolvedValue(undefined) });

  it('rejects an invalid MAC', async () => {
    const r = await performWake(okDeps(), { mac: 'bad', targets: [{ host: 'h', port: 9 }] });
    expect(r).toEqual({ ok: false, error: 'MAC adresa je neplatná' });
  });

  it('errors when there are no targets', async () => {
    const r = await performWake(okDeps(), { mac: 'aa:bb:cc:dd:ee:ff', targets: [] });
    expect(r.ok).toBe(false);
  });

  it('sends to every target and reports the count', async () => {
    const deps = okDeps();
    const r = await performWake(deps, { mac: 'aa:bb:cc:dd:ee:ff', targets: [{ host: 'a', port: 9 }, { host: 'b', port: 7 }] });
    expect(r).toEqual({ ok: true, sent: 2 });
    expect(deps.send).toHaveBeenCalledTimes(2);
  });

  it('succeeds if at least one target send resolves', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('no route'))
      .mockResolvedValueOnce(undefined);
    const r = await performWake({ send }, { mac: 'aa:bb:cc:dd:ee:ff', targets: [{ host: 'a', port: 9 }, { host: 'b', port: 9 }] });
    expect(r).toEqual({ ok: true, sent: 1 });
  });

  it('errors only when all sends fail', async () => {
    const send = vi.fn().mockRejectedValue(new Error('fail'));
    const r = await performWake({ send }, { mac: 'aa:bb:cc:dd:ee:ff', targets: [{ host: 'a', port: 9 }] });
    expect(r).toEqual({ ok: false, error: 'Nepodařilo se odeslat paket' });
  });
});
