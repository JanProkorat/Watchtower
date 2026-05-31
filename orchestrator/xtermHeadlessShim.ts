// @xterm/headless is built for browsers / web workers and references the
// global `self` at module-eval time. The orchestrator runs in a Node
// utilityProcess where `self` is undefined, so define it before xterm loads.
// This module has no exports; import it for its side effect BEFORE importing
// '@xterm/headless'.
const g = globalThis as unknown as { self?: unknown };
if (typeof g.self === 'undefined') {
  g.self = globalThis;
}
