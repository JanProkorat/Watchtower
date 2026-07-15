import type { IpcRequest, IpcResponse } from '@watchtower/shared/ipcContract.js';
import { toast, toastMessage } from './useToast';

/**
 * Background / poll / probe IPC kinds whose failures are routine and must NOT
 * raise a toast — they fire on timers (so a toast would spam) or are expected to
 * fail in normal operation (auth probes before sign-in). Everything else toasts
 * on failure. Keep this list small and documented so nothing is hidden silently;
 * one-off callers that intentionally swallow a failure should pass
 * `{ silent: true }` instead of being added here.
 */
const SILENT_KINDS = new Set<string>([
  'prWatch:list',   // periodic PR-watch inbox poll (usePrWatch surfaces its own error state)
  'tokens:usage',   // token-usage poll (shells out to ccusage; transient failures are normal)
  'board:authPing', // board auth probe — expected to fail when not signed in
  'ping',           // health probe
]);

/**
 * The single choke point for renderer → main IPC. Mirrors
 * `WatchtowerBridge.invoke` exactly (so every call site keeps its typed payload
 * and response), but on failure raises a global error toast and re-throws — so
 * existing local handling (inline state, drawer errors) still runs. Pass
 * `{ silent: true }` to suppress the toast for a call whose failure the caller
 * handles gracefully.
 */
export function invoke<T extends IpcRequest['kind']>(
  kind: T,
  payload: Extract<IpcRequest, { kind: T }>['payload'],
  opts?: { silent?: boolean },
): Promise<Extract<IpcResponse, { kind: T }>['payload']> {
  return window.watchtower.invoke(kind, payload).catch((err: unknown) => {
    if (!opts?.silent && !SILENT_KINDS.has(kind)) {
      toast.showError(toastMessage(err));
    }
    throw err;
  });
}
