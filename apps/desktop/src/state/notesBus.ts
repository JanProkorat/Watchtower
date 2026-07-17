// Cross-subtree refresh bus for notes (same pattern as projectsBus).
type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeNotes(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function broadcastNotesChanged(except?: Listener): void {
  for (const listener of [...listeners]) {
    if (listener !== except) listener();
  }
}
