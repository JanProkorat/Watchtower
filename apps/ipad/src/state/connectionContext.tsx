import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createReconnectingTransport, type ConnStatus } from '../lib/reconnectingTransport.js';
import { connectionToWsUrl, type Connection } from '../connection.js';

type Bridge = ReturnType<typeof createReconnectingTransport>;

interface ConnectionContextValue {
  bridge: Bridge;
  status: ConnStatus;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

interface ConnectionProviderProps {
  connection: Connection;
  children: ReactNode;
}

export function ConnectionProvider({ connection, children }: ConnectionProviderProps) {
  const bridge = useMemo(
    () => createReconnectingTransport({ url: connectionToWsUrl(connection), token: connection.token }),
    // Rebuild only if host/port/token changes — stringify is cheap for this tiny object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connection.host, connection.port, connection.token],
  );

  const [status, setStatus] = useState<ConnStatus>('connecting');

  useEffect(() => {
    const off = bridge.onStatus(setStatus);
    return () => {
      off();
      bridge.close();
    };
  }, [bridge]);

  return <ConnectionContext.Provider value={{ bridge, status }}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used inside <ConnectionProvider>');
  return ctx;
}
