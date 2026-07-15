// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast, toast as globalToast } from '../../apps/desktop/src/state/useToast';

function Trigger() {
  const t = useToast();
  return (
    <>
      <button onClick={() => t.showWarning('warn-msg')}>warn</button>
      <button onClick={() => t.showError('err-1')}>e1</button>
      <button onClick={() => t.showError('err-2')}>e2</button>
    </>
  );
}

describe('useToast', () => {
  it('showWarning renders a warning toast', () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText('warn'));
    expect(screen.getByText('warn-msg')).toBeTruthy();
  });

  it('queues toasts instead of clobbering — the second appears after the first is closed', () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText('e1'));
    fireEvent.click(screen.getByText('e2'));
    expect(screen.getByText('err-1')).toBeTruthy();  // first shown immediately
    expect(screen.queryByText('err-2')).toBeNull();  // second is queued, not shown yet
    fireEvent.click(screen.getByLabelText(/close/i)); // dismiss the first
    expect(screen.getByText('err-2')).toBeTruthy();  // second now surfaces
  });

  it('exposes a global bridge so non-React code (the IPC wrapper) can fire toasts', () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    act(() => { globalToast.showError('from-outside'); });
    expect(screen.getByText('from-outside')).toBeTruthy();
  });
});
