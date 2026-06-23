import type { InstanceStatus } from '@watchtower/shared/stateModel.js';

export interface RuleContext {
  focused: boolean;
  snoozedUntil: number;
}

export interface NotifyAction {
  notify?: { kind: 'waiting-permission' | 'idle-notify' };
  clearAttention?: boolean;
  badgeDelta: number;
}

const ATTENTION_STATES: ReadonlyArray<InstanceStatus> = ['waiting-permission', 'idle-notify'];

function inAttention(s: InstanceStatus): boolean {
  return ATTENTION_STATES.includes(s);
}

export function decide(
  prev: InstanceStatus,
  next: InstanceStatus,
  ctx: RuleContext,
  now: number,
): NotifyAction {
  if (prev === next) return { badgeDelta: 0 };

  const entered = inAttention(next) && !inAttention(prev);
  const left = inAttention(prev) && !inAttention(next);

  if (entered) {
    const snoozed = ctx.snoozedUntil > now;
    if (ctx.focused || snoozed) return { badgeDelta: 0 };
    return {
      notify: { kind: next === 'waiting-permission' ? 'waiting-permission' : 'idle-notify' },
      badgeDelta: 1,
    };
  }

  if (left) {
    return { clearAttention: true, badgeDelta: -1 };
  }

  return { badgeDelta: 0 };
}
