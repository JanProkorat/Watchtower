import { describe, it, expect } from 'vitest';
import { formatEscalationMessage } from '../../orchestrator/escalationMessage.js';

describe('formatEscalationMessage', () => {
  it('embeds the snapshot in a fenced block with a header and reply hint (permission)', () => {
    const out = formatEscalationMessage('proj', 'waiting-permission', 'Allow Bash(ls)?\n1. Yes\n2. No');
    expect(out).toContain('🔐 *proj* needs a permission decision:');
    expect(out).toContain('Allow Bash(ls)?');
    expect(out).toContain('1. Yes');
    expect(out).toMatch(/Reply in this thread/);
    expect(out.split('```').length).toBe(3);
  });

  it('uses the idle header for idle-notify', () => {
    const out = formatEscalationMessage('proj', 'idle-notify', 'done.');
    expect(out).toContain('⏳ *proj* finished and is waiting for your input:');
    expect(out).toMatch(/Reply in this thread/);
  });

  it('uses the crash header and omits the reply hint for crashed', () => {
    const out = formatEscalationMessage('proj', 'crashed', 'Error: boom');
    expect(out).toContain('💥 *proj* crashed / exited unexpectedly. Last output:');
    expect(out).toContain('Error: boom');
    expect(out).not.toMatch(/Reply in this thread/);
  });

  it('falls back to a single line (no fence) when the snapshot is empty', () => {
    const out = formatEscalationMessage('proj', 'waiting-permission', '   ');
    expect(out).not.toContain('```');
    expect(out).toContain('🔐 *proj* needs a permission decision.');
    expect(out).toMatch(/Reply in this thread/);
  });

  it('truncates long snapshots to the last 25 lines with a marker', () => {
    const snap = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const out = formatEscalationMessage('proj', 'idle-notify', snap);
    expect(out).toContain('… (truncated)');
    expect(out).toContain('line 39');
    expect(out).not.toContain('line 0\n');
  });

  it('neutralizes triple backticks in the snapshot so they cannot break the fence', () => {
    const out = formatEscalationMessage('proj', 'idle-notify', 'before ``` after');
    expect(out.split('```').length).toBe(3);
  });
});
