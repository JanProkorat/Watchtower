type Probable = {
  invoke(kind: string, payload: unknown): Promise<unknown>;
  on(kind: string, handler: (p: unknown) => void): () => void;
};

export async function probeInstances(bridge: Probable): Promise<unknown[]> {
  const res = (await bridge.invoke('listInstances', {})) as { instances?: unknown[] };
  return res.instances ?? [];
}

export function watchState(bridge: Probable, cb: (p: unknown) => void): () => void {
  return bridge.on('stateChanged', cb);
}
