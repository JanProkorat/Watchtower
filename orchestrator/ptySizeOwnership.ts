type Dims = { cols: number; rows: number };

/**
 * Per-instance pty size arbitration for multiple attached clients. The
 * "most-recently-focused" client owns the pty dimensions; resizes from any
 * other client are remembered (for fallback on disconnect) but not applied.
 * Pure + synchronous so it is unit-testable without sockets.
 */
export class PtySizeOwnership {
  private owner = new Map<string, string>();              // instanceId -> clientId
  private dims = new Map<string, Map<string, Dims>>();    // instanceId -> clientId -> dims

  focus(instanceId: string, clientId: string): void {
    this.owner.set(instanceId, clientId);
  }

  recordResize(instanceId: string, clientId: string, cols: number, rows: number): { apply: boolean } & Dims {
    let perClient = this.dims.get(instanceId);
    if (!perClient) { perClient = new Map(); this.dims.set(instanceId, perClient); }
    perClient.set(clientId, { cols, rows });
    if (!this.owner.has(instanceId)) this.owner.set(instanceId, clientId); // first writer owns
    const apply = this.owner.get(instanceId) === clientId;
    return { apply, cols, rows };
  }

  /** Drop all ownership + stored dims for an instance (call on kill/remove/exit). */
  disposeInstance(instanceId: string): void {
    this.owner.delete(instanceId);
    this.dims.delete(instanceId);
  }

  clientGone(clientId: string): Array<{ instanceId: string } & Dims> {
    const reapply: Array<{ instanceId: string } & Dims> = [];
    for (const [instanceId, perClient] of this.dims) {
      perClient.delete(clientId);
      if (this.owner.get(instanceId) === clientId) {
        this.owner.delete(instanceId);
        // Pick any surviving client as the new owner; re-apply its dims.
        const next = perClient.entries().next();
        if (!next.done) {
          const [nextClient, d] = next.value;
          this.owner.set(instanceId, nextClient);
          reapply.push({ instanceId, cols: d.cols, rows: d.rows });
        }
      }
    }
    return reapply;
  }
}
