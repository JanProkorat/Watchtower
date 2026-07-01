import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createReconnectingTransport, type ConnStatus } from '../lib/reconnectingTransport.js';
import { connectionToWsUrl, type Connection } from '../connection.js';

type Bridge = ReturnType<typeof createReconnectingTransport>;

interface ConnectionContextValue {
  bridge: Bridge;
  status: ConnStatus;
  /** Force an immediate fresh connect (tears down the current bridge and rebuilds). */
  reconnect: () => void;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

interface ConnectionProviderProps {
  connection: Connection;
  children: ReactNode;
}

export function ConnectionProvider({ connection, children }: ConnectionProviderProps) {
  // Bumping this rebuilds the bridge (below), which is how `reconnect()` forces
  // an immediate fresh connect instead of waiting out the backoff.
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const bridge = useMemo(
    () => createReconnectingTransport({ url: connectionToWsUrl(connection), token: connection.token }),
    // Rebuild if host/port/token changes, or on an explicit reconnect().
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connection.host, connection.port, connection.token, reconnectNonce],
  );

  const [status, setStatus] = useState<ConnStatus>('connecting');

  useEffect(() => {
    const off = bridge.onStatus(setStatus);
    return () => {
      off();
      bridge.close();
    };
  }, [bridge]);

  const reconnect = useCallback(() => setReconnectNonce((n) => n + 1), []);

  return <ConnectionContext.Provider value={{ bridge, status, reconnect }}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used inside <ConnectionProvider>');
  return ctx;
}
