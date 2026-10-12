import { describe, it, expect } from 'vitest';
import { isEmptySnapshot, parseSavvySnapshot } from '@watchtower/shared/savvyProgress.js';

const run = (over: Record<string, unknown> = {}) => ({
  id: 'toolu_1',
  agentId: 'a1',
  type: 'savvy-careful',
  description: 'Write the parser',
  model: 'claude-opus-5-5',
  status: 'running',
  startedAt: 1_000,
  contextTokens: 12_000,
  contextMax: 1_000_000,
  tokens: 30_000,
  costUsd: 0.42,
  steps: 3,
  round: 1,
  ...over,
});

describe('parseSavvySnapshot', () => {
  it('accepts a full snapshot the mod posts', () => {
    const snap = parseSavvySnapshot({
      version: 1,
      lang: 'en',
      flow: { title: 'Port parser', total: 3, done: 1, running: 1, phase: 'delegate', isFinished: false, tasks: [{ title: 'Write the parser', tier: 'careful', after: [] }] },
      agents: [run()],
      sentAt: 5_000,
    });
    expect(snap).not.toBeNull();
    expect(snap?.flow?.phase).toBe('delegate');
    expect(snap?.flow?.tasks[0]?.tier).toBe('careful');
    expect(snap?.agents[0]?.costUsd).toBe(0.42);
    expect(snap?.sentAt).toBe(5_000);
  });

  it('rejects bodies that are not a v1 snapshot', () => {
    expect(parseSavvySnapshot(null)).toBeNull();
    expect(parseSavvySnapshot({ version: 2, agents: [] })).toBeNull();
    expect(parseSavvySnapshot({ version: 1 })).toBeNull();
    expect(parseSavvySnapshot([1, 2])).toBeNull();
  });

  it('is lenient per field: unknown phase/status/lang fall back, junk agents drop', () => {
    const snap = parseSavvySnapshot({
      version: 1,
      lang: 'de',
      flow: { title: 'x', phase: 'nope' },
      agents: [run({ status: 'weird', costUsd: 'free' }), { no: 'id' }, 'junk'],
    });
    expect(snap?.lang).toBe('en');
    expect(snap?.flow?.phase).toBe('plan');
    expect(snap?.flow?.total).toBe(0);
    expect(snap?.agents).toHaveLength(1);
    expect(snap?.agents[0]?.status).toBe('running');
    expect(snap?.agents[0]?.costUsd).toBe(0);
  });

  it('caps the agent list at the mod’s own 200, keeping the newest', () => {
    const agents = Array.from({ length: 250 }, (_, i) => run({ id: `t${i}` }));
    const snap = parseSavvySnapshot({ version: 1, flow: null, agents });
    expect(snap?.agents).toHaveLength(200);
    expect(snap?.agents[0]?.id).toBe('t50');
  });

  it('isEmptySnapshot: no flow and no agents', () => {
    expect(isEmptySnapshot({ lang: 'en', flow: null, agents: [], sentAt: 0 })).toBe(true);
    const withAgent = parseSavvySnapshot({ version: 1, flow: null, agents: [run()] });
    expect(withAgent && isEmptySnapshot(withAgent)).toBe(false);
  });
});
