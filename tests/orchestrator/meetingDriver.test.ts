import { describe, expect, it } from 'vitest';
import { MeetingDriver, type MeetingDriverDeps, type MeetingResult } from '../../orchestrator/services/meetingDriver.js';

function makeDeps(over: Partial<MeetingDriverDeps> & { statuses: string[]; result: MeetingResult | null; resultAfterTicks?: number }) {
  let tick = 0;
  const writes: string[] = [];
  let disposed = 0;
  const deps: MeetingDriverDeps = {
    spawn: () => 'inst-1',
    getStatus: () => over.statuses[Math.min(tick, over.statuses.length - 1)] ?? null,
    write: (_id, d) => { writes.push(d); },
    dispose: () => { disposed++; },
    readResult: () => (over.resultAfterTicks == null || tick >= over.resultAfterTicks ? over.result : null),
    clearResult: () => {},
    sleep: async () => { tick++; },
    now: () => tick * 100,
    ...over,
  };
  return { deps, writes: () => writes, disposed: () => disposed };
}

const spec = { key: 'teams', command: '/teams-refresh "db"', startupTimeoutMs: 10_000, jobTimeoutMs: 60_000 };

describe('MeetingDriver', () => {
  it('injects the command once working, returns the result file, and disposes', async () => {
    const h = makeDeps({ statuses: ['spawning', 'working', 'working'], result: { ok: true, count: 2 }, resultAfterTicks: 3 });
    const res = await new MeetingDriver(h.deps).run(spec);
    expect(res).toEqual({ ok: true, count: 2 });
    expect(h.writes()).toEqual(['/teams-refresh "db"\r']);
    expect(h.disposed()).toBe(1);
  });

  it('fails when the turn ends (waiting-input) with no result file', async () => {
    const h = makeDeps({ statuses: ['working', 'working', 'waiting-input'], result: null });
    const res = await new MeetingDriver(h.deps).run(spec);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/without producing a result/i);
    expect(h.disposed()).toBe(1);
  });

  it('times out when nothing ever completes', async () => {
    const h = makeDeps({ statuses: ['working'], result: null });
    const res = await new MeetingDriver(h.deps).run({ ...spec, jobTimeoutMs: 500 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timed out/i);
    expect(h.disposed()).toBe(1);
  });

  it('rejects a concurrent job of the same key', async () => {
    const driver = new MeetingDriver(makeDeps({ statuses: ['working'], result: null }).deps);
    const p1 = driver.run({ ...spec, jobTimeoutMs: 300 });
    const p2 = await driver.run(spec);
    expect(p2.ok).toBe(false);
    expect(p2.error).toMatch(/already running/i);
    await p1;
  });
});
