// Short, monotonic-ish ids stable enough for React keys + DnD identifiers.
let counter = 0;
export function newNodeId(): string {
  counter += 1;
  return `n${Date.now().toString(36)}-${counter.toString(36)}`;
}
