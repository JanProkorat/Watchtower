import { describe, it, expect } from 'vitest';
import { registerForPush } from '../../apps/ipad/src/state/pushRegistration.js';

describe('registerForPush', () => {
  it('registers and forwards the token when permission granted', async () => {
    let tokenCb: (t: string) => void = () => {}; const sent: string[] = []; let registered = false;
    await registerForPush({
      requestPermission: async () => true,
      register: async () => { registered = true; tokenCb('TOKEN123'); },
      onToken: (cb) => { tokenCb = cb; },
      sendToken: async (t) => { sent.push(t); },
    });
    expect(registered).toBe(true);
    expect(sent).toEqual(['TOKEN123']);
  });
  it('does nothing when permission denied', async () => {
    const sent: string[] = [];
    await registerForPush({ requestPermission: async () => false, register: async () => { throw new Error('should not register'); }, onToken: () => {}, sendToken: async (t) => { sent.push(t); } });
    expect(sent).toEqual([]);
  });
});
