// apps/ipad/src/lib/attachTerminal.ts
type Bridge = {
  invoke(kind: string, payload: unknown): Promise<unknown>;
  on(kind: string, handler: (p: unknown) => void): () => void;
};
export interface TerminalSink {
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

/**
 * Attach a sink (an xterm) to a live pty stream without gap or double-render:
 * subscribe first and buffer; fetch the serialized snapshot; resize; write the
 * snapshot; drain buffered chunks; then write live. Returns a disposer that
 * unsubscribes from ptyData.
 */
export async function attachTerminal(
  bridge: Bridge,
  instanceId: string,
  sink: TerminalSink,
): Promise<{ dispose(): void }> {
  let live = false;
  const buffer: string[] = [];
  const off = bridge.on('ptyData', (p) => {
    const d = p as { instanceId: string; chunk: string };
    if (d.instanceId !== instanceId) return;
    if (live) sink.write(d.chunk);
    else buffer.push(d.chunk);
  });

  const res = (await bridge.invoke('terminalAttach', { instanceId })) as {
    data: string; cols: number; rows: number;
  };
  sink.resize(res.cols, res.rows);
  if (res.data) sink.write(res.data);
  for (const chunk of buffer.splice(0)) sink.write(chunk);
  live = true;

  return { dispose: off };
}
