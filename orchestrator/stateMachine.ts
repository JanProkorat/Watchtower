import type { InstanceStatus } from '@watchtower/shared/stateModel.js';
import type { StateEvent, TransitionResult } from '@watchtower/shared/events.js';

const TERMINAL: ReadonlyArray<InstanceStatus> = ['finished', 'crashed', 'suspended', 'resuming'];

export function transition(state: InstanceStatus, event: StateEvent): TransitionResult {
  if (TERMINAL.includes(state)) return { state, outputs: [] };

  switch (event.kind) {
    case 'sessionStart':
      return {
        state: state === 'spawning' ? 'working' : state,
        outputs: [{ kind: 'storeClaudeSessionId', sessionId: event.sessionId }],
      };

    case 'notificationHook':
      return { state: 'waiting-permission', outputs: [] };

    case 'stopHook':
      if (state === 'waiting-permission') return { state, outputs: [] };
      return { state: 'waiting-input', outputs: [{ kind: 'startQuietTimer' }] };

    case 'userPromptSubmit':
    case 'tabFocused':
      return {
        state: 'working',
        outputs: [{ kind: 'clearAttention' }, { kind: 'clearQuietTimer' }],
      };

    case 'ptyData':
      if (state === 'waiting-input' || state === 'idle-notify') {
        return { state: 'working', outputs: [] };
      }
      return { state, outputs: [] };

    case 'quietTimerFired':
      if (state === 'waiting-input') return { state: 'idle-notify', outputs: [] };
      return { state, outputs: [] };

    case 'sessionEnd':
      // Claude fires SessionEnd during mid-life rollovers (/clear, /compact,
      // auto-compaction, /resume), not only on true process exit — so it is
      // not a reliable terminal signal. Treat as a no-op; the pty closing
      // (ptyExit below) is the authoritative end of an instance.
      return { state, outputs: [] };

    case 'ptyExit':
      return { state: event.code === 0 ? 'finished' : 'crashed', outputs: [] };
  }
}
