// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const sendReply = vi.fn(async () => true);
vi.mock('@watchtower/data-supabase', async (orig) => ({
  ...(await orig() as any),
  useAttentionReply: () => ({ sendReply, pending: false, error: null }),
}));

import { AttentionThreadDrawer } from '../../packages/module-attention/src/AttentionThreadDrawer';

const thread = {
  instanceId: 'i1', label: 'wt', kind: 'waiting-permission', unanswered: true, closed: false,
  messages: [{
    syncId: 'c1', instanceId: 'i1', projectLabel: 'wt', role: 'claude', kind: 'waiting-permission',
    body: 'Allow X?', options: [{ number: 1, label: 'Yes' }], replyTo: null, injectedAt: null, closedAt: null, createdAt: '1',
  }],
} as any;

describe('AttentionThreadDrawer', () => {
  it('renders the snapshot and an option button; tapping an option sends its number', () => {
    render(<AttentionThreadDrawer thread={thread} onClose={() => {}} />);
    expect(screen.getByText(/Allow X\?/)).toBeTruthy();
    fireEvent.click(screen.getByText('Yes'));
    expect(sendReply).toHaveBeenCalledWith('i1', 'c1', '1');
  });

  it('renders "Open in terminal" only when openInTerminal is provided', () => {
    const open = vi.fn();
    const { rerender } = render(<AttentionThreadDrawer thread={thread} onClose={() => {}} />);
    expect(screen.queryByText('Open in terminal')).toBeNull();
    rerender(<AttentionThreadDrawer thread={thread} onClose={() => {}} openInTerminal={open} />);
    fireEvent.click(screen.getByText('Open in terminal'));
    expect(open).toHaveBeenCalledWith('i1');
  });

  it('a crashed thread is non-replyable: shows a stopped note, hides option chips, disables Send, and never calls sendReply', () => {
    const crashedThread = {
      instanceId: 'i2', label: 'wt', kind: 'crashed', unanswered: true, closed: false,
      messages: [{
        syncId: 'c2', instanceId: 'i2', projectLabel: 'wt', role: 'claude', kind: 'crashed',
        body: 'Instance crashed', options: [{ number: 1, label: 'Restart' }], replyTo: null, injectedAt: null, closedAt: null, createdAt: '1',
      }],
    } as any;

    sendReply.mockClear();
    render(<AttentionThreadDrawer thread={crashedThread} onClose={() => {}} />);

    expect(screen.getByText(/stopped/i)).toBeTruthy();
    expect(screen.queryByText('Restart')).toBeNull();

    const textarea = screen.getByPlaceholderText('Write a reply…') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);

    const sendButton = screen.getByText('Send') as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    fireEvent.click(sendButton);
    expect(sendReply).not.toHaveBeenCalled();
  });

  it('still renders "Open in terminal" for a crashed thread (inspect/restart is valid)', () => {
    const open = vi.fn();
    const crashedThread = {
      instanceId: 'i2', label: 'wt', kind: 'crashed', unanswered: true, closed: false,
      messages: [{
        syncId: 'c2', instanceId: 'i2', projectLabel: 'wt', role: 'claude', kind: 'crashed',
        body: 'Instance crashed', options: [], replyTo: null, injectedAt: null, closedAt: null, createdAt: '1',
      }],
    } as any;

    render(<AttentionThreadDrawer thread={crashedThread} onClose={() => {}} openInTerminal={open} />);
    fireEvent.click(screen.getByText('Open in terminal'));
    expect(open).toHaveBeenCalledWith('i2');
  });
});
