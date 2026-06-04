import { describe, it, expect } from 'vitest';
import { formatEscalationMessage, type SlackBlock } from '../../orchestrator/escalationMessage.js';

/** Flatten every renderable string out of a block list so tests can scan content. */
function textOf(b: SlackBlock): string {
  if (b.type === 'header') return b.text.text;
  if (b.type === 'section') return b.text.text;
  if (b.type === 'context') return b.elements.map((e) => e.text).join(' ');
  return '';
}
function allText(blocks: SlackBlock[]): string {
  return blocks.map(textOf).join('\n');
}
function headerBlock(blocks: SlackBlock[]) {
  return blocks.find((b) => b.type === 'header');
}

// A realistic Claude selection prompt: pre-amble context (which happens to be a
// numbered list), a separator, a tab bar, the actual question, then the real
// selectable options (one marked with ❯) and a footer of navigation hints.
const SELECTION_SNAPSHOT = [
  '  1. Validator — drop the PreparationTimeMinutes > 0 rule (prep may be 0).',
  '  2. Endpoint — add a domain check that StepTimeMinutes must be greater.',
  '',
  '  Two decisions genuinely affect behavior and the shared error contract.',
  '────────────────────────────────────────',
  '←  □ Error code  □ Step time req\'d  ✓ Submit  →',
  '',
  'For the rejection, which error should the endpoint raise?',
  '',
  '❯ 1. New dedicated code',
  '    Add PPS_VR_STEP_TIME_NOT_GREATER to ErrorCodes. Most precise.',
  '  2. Reuse generic InvalidOperation',
  '    No new code; FE gets a generic message.',
  '  3. Type something.',
  '────────────────────────────────────────',
  '  4. Chat about this',
  '',
  'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
].join('\n');

describe('formatEscalationMessage — Block Kit', () => {
  it('returns a notification fallback `text` that leads with the point', () => {
    const { text } = formatEscalationMessage('proj', 'waiting-permission', SELECTION_SNAPSHOT);
    expect(text).toBe('🔐 proj needs a permission decision.');
  });

  it('leads with a bold header block carrying the instance name + kind', () => {
    const { blocks } = formatEscalationMessage('proj', 'waiting-permission', SELECTION_SNAPSHOT);
    const header = headerBlock(blocks);
    expect(header?.type).toBe('header');
    expect(textOf(header!)).toContain('proj');
    expect(textOf(header!).toLowerCase()).toContain('permission');
  });

  it('extracts the real question (the line above the options), not the pre-amble', () => {
    const { blocks } = formatEscalationMessage('proj', 'waiting-permission', SELECTION_SNAPSHOT);
    const text = allText(blocks);
    expect(text).toContain('which error should the endpoint raise?');
  });

  it('renders the selectable options as a clean numbered list with bold numbers', () => {
    const { blocks } = formatEscalationMessage('proj', 'waiting-permission', SELECTION_SNAPSHOT);
    const text = allText(blocks);
    expect(text).toContain('*1.*');
    expect(text).toContain('New dedicated code');
    expect(text).toContain('*2.*');
    expect(text).toContain('Reuse generic InvalidOperation');
    expect(text).toContain('*4.*');
    expect(text).toContain('Chat about this');
  });

  it('does not render in a single grey code fence', () => {
    const { blocks } = formatEscalationMessage('proj', 'waiting-permission', SELECTION_SNAPSHOT);
    // structured render uses sections, not a ``` dump
    expect(allText(blocks)).not.toContain('```');
  });

  it('drops the pre-amble context and notes how much was hidden, pointing at Watchtower', () => {
    const { blocks } = formatEscalationMessage('proj', 'waiting-permission', SELECTION_SNAPSHOT);
    const text = allText(blocks);
    expect(text).not.toContain('Validator — drop the PreparationTimeMinutes');
    expect(text).toMatch(/more lines/);
    expect(text).toContain('Watchtower');
  });

  it('strips terminal chrome (separators, tab bar, navigation footer)', () => {
    const { blocks } = formatEscalationMessage('proj', 'waiting-permission', SELECTION_SNAPSHOT);
    const text = allText(blocks);
    expect(text).not.toContain('Enter to select');
    expect(text).not.toContain('Step time req');
    expect(text).not.toMatch(/────/);
  });

  it('appends a reply hint as a context block for actionable kinds', () => {
    const { blocks } = formatEscalationMessage('proj', 'waiting-permission', SELECTION_SNAPSHOT);
    const last = blocks[blocks.length - 1];
    expect(last.type).toBe('context');
    expect(textOf(last)).toMatch(/Reply in this thread/);
  });

  it('omits the pre-amble note when there is nothing hidden', () => {
    const snap = ['Do you want to proceed?', '❯ 1. Yes', '  2. No'].join('\n');
    const { blocks } = formatEscalationMessage('proj', 'waiting-permission', snap);
    const text = allText(blocks);
    expect(text).toContain('Do you want to proceed?');
    expect(text).toContain('*1.*');
    expect(text).toContain('Yes');
    expect(text).not.toMatch(/more lines/);
  });

  it('uses the idle header + reply hint for idle-notify', () => {
    const { blocks } = formatEscalationMessage('proj', 'idle-notify', 'done, awaiting next step.');
    expect(textOf(headerBlock(blocks)!).toLowerCase()).toContain('waiting');
    expect(allText(blocks)).toMatch(/Reply in this thread/);
  });

  it('uses the crash header and omits the reply hint for crashed', () => {
    const { blocks } = formatEscalationMessage('proj', 'crashed', 'Error: boom');
    expect(textOf(headerBlock(blocks)!).toLowerCase()).toContain('crash');
    const text = allText(blocks);
    expect(text).toContain('Error: boom');
    expect(text).not.toMatch(/Reply in this thread/);
  });

  it('falls back to a cleaned code block when no options can be parsed', () => {
    const snap = 'Some free-form status with no options at all.\nSecond line of detail.';
    const { blocks } = formatEscalationMessage('proj', 'idle-notify', snap);
    const text = allText(blocks);
    expect(text).toContain('Some free-form status with no options at all.');
    expect(text).toContain('```'); // robust fallback keeps a monospace block
  });

  it('falls back to a header + reply hint only when the snapshot is empty', () => {
    const { blocks, text } = formatEscalationMessage('proj', 'waiting-permission', '   ');
    expect(text).toBe('🔐 proj needs a permission decision.');
    expect(allText(blocks)).not.toContain('```');
    expect(allText(blocks)).toMatch(/Reply in this thread/);
  });

  it('neutralizes triple backticks in the fallback so they cannot break the fence', () => {
    const { blocks } = formatEscalationMessage('proj', 'idle-notify', 'before ``` after');
    const section = blocks.find((b) => b.type === 'section');
    expect(section && textOf(section).split('```').length).toBe(3);
  });
});
