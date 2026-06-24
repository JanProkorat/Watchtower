import type { InstanceStatus } from './stateModel.js';

export type StateEvent =
  | { kind: 'sessionStart'; sessionId: string }
  | { kind: 'notificationHook' }
  | { kind: 'stopHook' }
  | { kind: 'userPromptSubmit' }
  | { kind: 'sessionEnd' }
  | { kind: 'ptyData' }
  | { kind: 'ptyExit'; code: number }
  | { kind: 'quietTimerFired' }
  | { kind: 'tabFocused' };

export type StateOutput =
  | { kind: 'startQuietTimer' }
  | { kind: 'clearQuietTimer' }
  | { kind: 'clearAttention' }
  | { kind: 'storeClaudeSessionId'; sessionId: string };

export interface TransitionResult {
  state: InstanceStatus;
  outputs: StateOutput[];
}
