import { describe, it, expect } from 'vitest';
import type { IpcPush } from '@watchtower/shared/ipcContract.js';

describe('notify push PR variant', () => {
  it('accepts a PR-target payload', () => {
    const msg: Extract<IpcPush, { kind: 'notify' }> = {
      kind: 'notify',
      payload: {
        target: 'pr',
        host: 'github',
        repoKey: 'acme/widgets',
        prNumber: 42,
        title: 't',
        repoLabel: 'widgets',
        event: 'approved',
        body: 'ann approved your PR',
      },
    };
    expect(msg.payload.target).toBe('pr');
  });

  it('still accepts the existing instance-target payload', () => {
    const msg: Extract<IpcPush, { kind: 'notify' }> = {
      kind: 'notify',
      payload: { instanceId: 'i1', cwd: '/tmp/proj', kind: 'waiting-permission' },
    };
    expect(msg.payload.target).toBeUndefined();
  });
});
