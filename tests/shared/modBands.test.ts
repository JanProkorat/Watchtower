import { describe, it, expect } from 'vitest';
import { parseCacheTax, parseCollisionGuard, parseReflect } from '@watchtower/shared/modBands.js';

describe('parseCacheTax', () => {
  it('reads a band, a cleared band, and rejects the rest', () => {
    expect(parseCacheTax({ version: 1, band: { state: 'warm', text: ' · 4m left' } })).toEqual({ state: 'warm', text: ' · 4m left' });
    expect(parseCacheTax({ version: 1, band: null })).toBeNull();
    expect(parseCacheTax({ version: 1, band: { state: 'hot', text: '' } })).toBeUndefined();
    expect(parseCacheTax({ version: 2, band: null })).toBeUndefined();
    expect(parseCacheTax({ version: 1 })).toBeUndefined();
  });
});

describe('parseCollisionGuard', () => {
  it('keeps valid peers and their last tasks, with unknown statuses read as done', () => {
    const peers = parseCollisionGuard({
      version: 1,
      peers: [
        { id: 'abc', where: null, tasks: [{ text: 'fix', status: 'in progress', at: 1 }, { text: 'x', status: 'weird', at: 2 }] },
        { id: '', tasks: [] },
        'nope',
      ],
    });
    expect(peers).toEqual([{ id: 'abc', where: null, tasks: [{ text: 'fix', status: 'in progress', at: 1 }, { text: 'x', status: 'done', at: 2 }] }]);
    expect(parseCollisionGuard({ version: 1 })).toBeUndefined();
  });
});

describe('parseReflect', () => {
  it('keeps rules with an id, defaults scope to global and count to 1, caps at 20', () => {
    const items = parseReflect({
      version: 1,
      items: [{ id: 'r1', rule: 'Use pnpm', scope: 'project', count: 3 }, { id: 'r2', rule: 'Be brief' }, { rule: 'no id' }],
    });
    expect(items).toEqual([
      { id: 'r1', rule: 'Use pnpm', scope: 'project', count: 3 },
      { id: 'r2', rule: 'Be brief', scope: 'global', count: 1 },
    ]);
    const many = parseReflect({ version: 1, items: Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, rule: 'x' })) });
    expect(many).toHaveLength(20);
  });
});
