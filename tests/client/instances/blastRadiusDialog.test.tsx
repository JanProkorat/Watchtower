// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { BlastRadiusDialog, visible } from '../../../apps/desktop/src/components/instances/BlastRadiusDialog';

const hold = { id: 'h1', command: 'rm -rf dist', commandTruncated: false, riskLabel: 'rm -rf', summary: 'delete 3 files (about 2 kB)', lines: ['dist/a.js', 'dist/b.js'], more: 1, note: 'Paths: dist', startedAt: 1 };
const renderIt = (decided: 'proceed' | 'cancel' | null = null, h = hold) => {
  const onDecide = vi.fn();
  render(
    <ThemeProvider theme={darkTheme}>
      <BlastRadiusDialog hold={h} decided={decided} onDecide={onDecide} />
    </ThemeProvider>,
  );
  return onDecide;
};

describe('BlastRadiusDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the risk, command, summary, paths and note', () => {
    renderIt();
    expect(screen.getByRole('dialog', { name: /Blast Radius · rm -rf/ })).toBeInTheDocument();
    expect(screen.getByText('rm -rf dist')).toBeInTheDocument();
    expect(screen.getByText(/Would delete 3 files/)).toBeInTheDocument();
    expect(screen.getByText('dist/a.js')).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    expect(screen.getByText('Paths: dist')).toBeInTheDocument();
    expect(screen.queryByText(/Command shortened/)).not.toBeInTheDocument();
  });

  it('never takes focus, not on mount and not for a new hold', () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    const ui = (h: typeof hold) => (
      <ThemeProvider theme={darkTheme}>
        <BlastRadiusDialog hold={h} decided={null} onDecide={vi.fn()} />
      </ThemeProvider>
    );
    const { rerender } = render(ui(hold));
    expect(outside).toHaveFocus();
    rerender(ui({ ...hold, id: 'h2' }));
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it('Proceed, Cancel and Esc answer', () => {
    const onDecide = renderIt();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDecide.mock.calls.map((c) => c[0])).toEqual(['proceed', 'cancel', 'cancel']);
  });

  it('after answering it waits for Claude and stops taking answers', () => {
    const onDecide = renderIt('proceed');
    expect(screen.getByText('Waiting for Claude…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proceed' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('arms Proceed only after a beat; Cancel works at once', () => {
    const onDecide = renderIt();
    expect(screen.getByRole('button', { name: 'Proceed' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));
    expect(onDecide).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }));
    expect(onDecide).toHaveBeenCalledWith('proceed');
  });

  it('says when the command was shortened', () => {
    renderIt(null, { ...hold, commandTruncated: true });
    expect(screen.getByText('Command shortened — the full command is longer than shown.')).toBeInTheDocument();
  });

  it('shows hidden characters as a visible marker', () => {
    renderIt(null, { ...hold, command: 'rm -rf \u202Etxt.exe', lines: ['a\u202Eb'] });
    expect(screen.getByRole('dialog').textContent).not.toContain('\u202E');
    expect(screen.getByRole('dialog').textContent).toContain('\uFFFD');
  });
});

describe('BlastRadiusDialog keyed by hold id', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a new hold starts with Proceed disabled on its first render', () => {
    const ui = (h: typeof hold) => (
      <ThemeProvider theme={darkTheme}>
        <BlastRadiusDialog key={h.id} hold={h} decided={null} onDecide={vi.fn()} />
      </ThemeProvider>
    );
    const { rerender } = render(ui(hold));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('button', { name: 'Proceed' })).toBeEnabled();
    rerender(ui({ ...hold, id: 'h2' }));
    expect(screen.getByRole('button', { name: 'Proceed' })).toBeDisabled();
  });

  it('strips hidden characters from the risk label', () => {
    renderIt(null, { ...hold, riskLabel: 'rm‮ -rf' });
    expect(screen.getByRole('dialog').getAttribute('aria-label')).not.toContain('‮');
    expect(screen.getByRole('dialog').textContent).not.toContain('‮');
  });
});

describe('visible', () => {
  it('replaces zero-width, BOM, ALM and line/paragraph separators', () => {
    const out = visible('a​b﻿c؜d e f‌g‍h');
    expect(out).toBe('a�b�c�d�e�f�g�h');
  });

  it('replaces bidi and control characters but keeps newline and tab', () => {
    const out = visible('rm -rf \u202Etxt.exe');
    expect(out).toContain('\uFFFD');
    expect(out).not.toContain('\u202E');
    expect(visible('a\nb')).toBe('a\nb');
    expect(visible('a\tb')).toBe('a\tb');
    expect(visible('a\u0007b\u200Fc\u0085d')).toBe('a\uFFFDb\uFFFDc\uFFFDd');
  });
});
