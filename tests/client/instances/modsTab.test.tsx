// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { ModsTab, RELOCK_MS } from '../../../apps/desktop/src/components/instances/side/ModsTab';
import { hasModBands, modBandsCount } from '../../../apps/desktop/src/state/useModBands';
import { EMPTY_BANDS, type ModBands } from '@watchtower/shared/modBands.js';

const bands: ModBands = {
  cacheTax: { state: 'warm', text: ' · 4m until cold' },
  peers: [{ id: 'abcdef123456', where: '/repo/.claude/worktrees/x', tasks: [{ text: 'fix login', status: 'in progress', at: 1 }] }],
  reflect: [
    { id: 'r1', rule: 'Use pnpm, not npm', scope: 'project', count: 2 },
    { id: 'r2', rule: 'Answer briefly', scope: 'global', count: 1 },
  ],
};

function renderTab(b: ModBands) {
  const onReflect = vi.fn();
  render(<ThemeProvider theme={darkTheme}><ModsTab bands={b} onReflect={onReflect} /></ThemeProvider>);
  return onReflect;
}

describe('ModsTab', () => {
  it('draws the peer, the rules and the cache state', () => {
    renderTab(bands);
    expect(screen.getByText('⚠ Session abcdef12 (in /repo/.claude/worktrees/x)')).toBeTruthy();
    expect(screen.getByText('● in progress: fix login')).toBeTruthy();
    expect(within(screen.getByTestId('rule-r1')).getByText('×2', { exact: false })).toBeTruthy();
    expect(screen.getByText('warm')).toBeTruthy();
  });

  it('names the target file by scope and sends the click once', () => {
    const onReflect = renderTab(bands);
    const r1 = within(screen.getByTestId('rule-r1'));
    const r2 = within(screen.getByTestId('rule-r2'));
    expect(r1.getByRole('button', { name: 'Save to ./CLAUDE.md' })).toBeTruthy();
    expect(r2.getByRole('button', { name: 'Save to ~/.claude/CLAUDE.md' })).toBeTruthy();
    expect(r2.getByRole('button', { name: 'This repo instead' })).toBeTruthy();
    fireEvent.click(r1.getByRole('button', { name: 'Global instead' }));
    expect(onReflect).toHaveBeenCalledWith('r1', 'other');
    expect((r1.getByRole('button', { name: 'Skip' }) as HTMLButtonElement).disabled).toBe(true);
    expect((r2.getByRole('button', { name: 'Skip' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('unlocks a rule whose action the mod refused', () => {
    vi.useFakeTimers();
    try {
      renderTab(bands);
      const r1 = within(screen.getByTestId('rule-r1'));
      fireEvent.click(r1.getByRole('button', { name: 'Edit' }));
      expect((r1.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
      act(() => void vi.advanceTimersByTime(RELOCK_MS));
      expect((r1.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when empty; the tab shows only with content and counts what waits on the user', () => {
    renderTab(EMPTY_BANDS);
    expect(screen.getByText('Nothing from the mods yet.')).toBeTruthy();
    expect(hasModBands(EMPTY_BANDS)).toBe(false);
    expect(hasModBands({ ...EMPTY_BANDS, cacheTax: { state: 'unknown', text: '' } })).toBe(true);
    expect(modBandsCount(bands)).toBe(3);
  });
});
