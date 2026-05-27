import { useCallback, useEffect, useState } from 'react';
import type {
  Ms365StatusPayload,
  Ms365StartSignInPayload,
} from '../../../shared/ipcContract.js';

export interface ActiveSignIn {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

export interface SignInUpdate {
  status: 'pending' | 'success' | 'expired' | 'error';
  account?: string;
  error?: string;
}

export interface Microsoft365State {
  status: Ms365StatusPayload | null;
  active: ActiveSignIn | null;
  /** Last push update — drives the popover's status line. */
  update: SignInUpdate | null;
  startSignIn(): Promise<void>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

export function useMicrosoft365(): Microsoft365State {
  const [status, setStatus] = useState<Ms365StatusPayload | null>(null);
  const [active, setActive] = useState<ActiveSignIn | null>(null);
  const [update, setUpdate] = useState<SignInUpdate | null>(null);

  const refresh = useCallback(async () => {
    const s = await window.watchtower.invoke('ms365:status', {});
    setStatus(s);
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.watchtower.on('ms365:signInUpdate', (payload) => {
      setUpdate(payload);
      if (
        payload.status === 'success' ||
        payload.status === 'expired' ||
        payload.status === 'error'
      ) {
        setActive(null);
        void refresh();
      }
    });
    return off;
  }, [refresh]);

  const startSignIn = useCallback(async () => {
    setUpdate({ status: 'pending' });
    const r: Ms365StartSignInPayload = await window.watchtower.invoke('ms365:startSignIn', {});
    if (r.error) {
      setUpdate({ status: 'error', error: r.error });
      return;
    }
    setActive({
      userCode: r.userCode,
      verificationUri: r.verificationUri,
      expiresIn: r.expiresIn,
    });
  }, []);

  const cancelSignIn = useCallback(async () => {
    await window.watchtower.invoke('ms365:cancelSignIn', {});
    setActive(null);
    setUpdate(null);
  }, []);

  const signOut = useCallback(async () => {
    await window.watchtower.invoke('ms365:signOut', {});
    setUpdate(null);
    await refresh();
  }, [refresh]);

  return { status, active, update, startSignIn, cancelSignIn, signOut, refresh };
}
