// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('Cancel has focus; Proceed, Cancel and Esc answer', () => {
    const onDecide = renderIt();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
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

  it('says when the command was shortened', () => {
    renderIt(null, { ...hold, commandTruncated: true });
    expect(screen.getByText('Command shortened — the full command is longer than shown.')).toBeInTheDocument();
  });

  it('shows hidden characters as a visible marker', () => {
    renderIt(null, { ...hold, command: 'rm -rf ‮txt.exe', lines: ['a‮b'] });
    expect(screen.getByRole('dialog').textContent).not.toContain('‮');
    expect(screen.getByRole('dialog').textContent).toContain('�');
  });
});

describe('visible', () => {
  it('replaces bidi and control characters but keeps newline and tab', () => {
    const out = visible('rm -rf ‮txt.exe');
    expect(out).toContain('�');
    expect(out).not.toContain('‮');
    expect(visible('a\nb')).toBe('a\nb');
    expect(visible('a\tb')).toBe('a\tb');
    expect(visible('a\u0007b‏c\u0085d')).toBe('a�b�c�d');
  });
});
