// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationHub } from '../../packages/module-attention/src/NotificationHub';

describe('NotificationHub', () => {
  it('renders items and fires onSelect', () => {
    const onSelect = vi.fn();
    render(<NotificationHub items={[{ instanceId: 'i1', label: 'wt', kind: 'waiting-permission', reason: 'waiting for permission', hasThread: true }]} onSelect={onSelect} onClose={() => {}} />);
    expect(screen.getByText(/wt/)).toBeTruthy();
    fireEvent.click(screen.getByText(/wt/));
    expect(onSelect).toHaveBeenCalledWith('i1');
  });
  it('shows the empty state', () => {
    render(<NotificationHub items={[]} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByText('No notifications')).toBeTruthy();
  });
});
