// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PrWatchInboxItem } from '@watchtower/shared/ipcContract.js';
import { PrNotificationsButton } from '../../apps/desktop/src/components/reviews/PrNotificationsButton';

const item = (over: Partial<PrWatchInboxItem> = {}): PrWatchInboxItem => ({
  host: 'github', repoKey: 'gh:o/r', repoLabel: 'MyRepo', prNumber: 7, title: 'Fix things',
  myRole: 'reviewer', approved: false, mergeable: true, mergeBlockedReason: null,
  latestEvent: 'new comment', latestAt: '', unread: true, ...over,
});

const openBtn = () => screen.getByRole('button', { name: /notifications/i });

describe('PrNotificationsButton', () => {
  it('shows the unread count and, on click, lists the unread notifications', () => {
    render(<PrNotificationsButton items={[item()]} unread={1} onOpen={() => {}} onMarkAllSeen={() => {}} />);
    expect(screen.getByText('1')).toBeTruthy(); // badge
    fireEvent.click(openBtn());
    expect(screen.getByText('Fix things')).toBeTruthy();
    expect(screen.getByText(/MyRepo/)).toBeTruthy();
  });

  it('lists only unread items, not already-seen ones', () => {
    render(<PrNotificationsButton
      items={[item({ title: 'Unread one' }), item({ prNumber: 8, title: 'Seen one', unread: false })]}
      unread={1} onOpen={() => {}} onMarkAllSeen={() => {}} />);
    fireEvent.click(openBtn());
    expect(screen.getByText('Unread one')).toBeTruthy();
    expect(screen.queryByText('Seen one')).toBeNull();
  });

  it('clicking a notification calls onOpen with that item', () => {
    const onOpen = vi.fn();
    render(<PrNotificationsButton items={[item()]} unread={1} onOpen={onOpen} onMarkAllSeen={() => {}} />);
    fireEvent.click(openBtn());
    fireEvent.click(screen.getByText('Fix things'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ prNumber: 7, repoKey: 'gh:o/r' }));
  });

  it('"mark all as read" calls onMarkAllSeen', () => {
    const onMarkAllSeen = vi.fn();
    render(<PrNotificationsButton items={[item()]} unread={1} onOpen={() => {}} onMarkAllSeen={onMarkAllSeen} />);
    fireEvent.click(openBtn());
    fireEvent.click(screen.getByText(/mark all as read/i));
    expect(onMarkAllSeen).toHaveBeenCalled();
  });

  it('shows an empty state and no badge count when there is nothing unread', () => {
    render(<PrNotificationsButton items={[]} unread={0} onOpen={() => {}} onMarkAllSeen={() => {}} />);
    expect(screen.queryByText('0')).toBeNull(); // MUI Badge hides a zero count
    fireEvent.click(openBtn());
    expect(screen.getByText(/no unread notifications/i)).toBeTruthy();
  });
});
