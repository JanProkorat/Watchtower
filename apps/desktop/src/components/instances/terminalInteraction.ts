import { ACTION_NEEDED_STATUSES } from '@watchtower/shared/tabAttention.js';

/**
 * Clear an instance's "attention needed" dot on genuine interaction.
 *
 * The dot is a pure function of instance status, and status is only cleared by
 * a focus *transition* (the layout-derived `focusChanged` effect fires only
 * when the focused instance id changes). Clicking or typing in an ALREADY
 * focused terminal produces no transition, so the dot lingers until the user
 * leaves and refocuses. When the instance currently needs attention, re-emit
 * `focusChanged` for it so the orchestrator runs its `tabFocused →
 * clearAttention` transition. Gated on status so ordinary typing never spams IPC.
 */
export function signalTerminalInteraction(
  instanceId: string,
  status: string,
  invokeFocusChanged: (instanceId: string) => void,
): void {
  if (!ACTION_NEEDED_STATUSES.has(status)) return;
  invokeFocusChanged(instanceId);
}
