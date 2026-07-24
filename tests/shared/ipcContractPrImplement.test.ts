import { describe, it, expect } from 'vitest';
import type { IpcRequest, IpcResponse } from '../../packages/shared/src/ipcContract.js';

describe('prImplement:start contract', () => {
  it('request and response types line up', () => {
    const req: Extract<IpcRequest, { kind: 'prImplement:start' }> =
      { kind: 'prImplement:start', payload: { host: 'github', repoKey: 'gh:a/b', prNumber: 1 } };
    const res: Extract<IpcResponse, { kind: 'prImplement:start' }> =
      { kind: 'prImplement:start', payload: { instanceId: 'x', worktreePath: '/p' } };
    expect(req.payload.prNumber).toBe(1);
    expect(res.payload.instanceId).toBe('x');
  });
});
