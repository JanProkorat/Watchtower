import { useEffect, useState } from 'react';
import { useConnection } from './connectionContext.js';

export interface InstanceView {
  id: string;
  cwd: string;
  status: string;
  lastActivityAt: number;
  kind: string;
  taskId: number | null;
}

export function useInstances(): { instances: InstanceView[] } {
  const { bridge } = useConnection();
  const [instances, setInstances] = useState<InstanceView[]>([]);

  const refetch = () =>
    void bridge
      .invoke('listInstances', {})
      .then((r) => setInstances((r as { instances: InstanceView[] }).instances));

  useEffect(() => {
    refetch();
    return bridge.on('stateChanged', () => refetch());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  return { instances };
}
