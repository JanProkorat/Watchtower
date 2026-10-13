// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { ReplayTab } from '../../../apps/desktop/src/components/instances/side/ReplayTab';
import type { ReplayTurn } from '@watchtower/shared/replay.js';

const step = (file: string) => ({ file, tool: 'Edit', note: 'replace all', added: 1, deleted: 1, lines: [{ kind: 'ctx' as const, text: 'keep' }, { kind: 'del' as const, text: 'old' }, { kind: 'add' as const, text: 'new' }, { kind: 'gap' as const, text: '' }] });
const turn = (at: number, n: number): ReplayTurn => ({ at, steps: Array.from({ length: n }, (_, i) => step(`src/f${i + 1}.ts`)) });
const renderIt = (t: ReplayTurn | null) =>
  render(<ThemeProvider theme={darkTheme}><ReplayTab turn={t} /></ThemeProvider>);

describe('ReplayTab', () => {
  it('shows an empty note before any edits', () => {
    renderIt(null);
    expect(screen.getByText('No edits in the last turn yet.')).toBeInTheDocument();
  });

  it('shows the current step: file, tool line, diff kinds', () => {
    renderIt(turn(1, 3));
    expect(screen.getByText('src/f1.ts')).toBeInTheDocument();
    expect(screen.getByText('Edit · replace all +1 −1')).toBeInTheDocument();
    expect(screen.getByText('new').closest('[data-kind]')).toHaveAttribute('data-kind', 'add');
    expect(screen.getByText('old').closest('[data-kind]')).toHaveAttribute('data-kind', 'del');
    expect(screen.getByText('⋯')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Step 1' })).toHaveAttribute('aria-current', 'step');
  });

  it('moves with Prev/Next, the chips and the arrow keys, clamped at the ends', () => {
    renderIt(turn(1, 3));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('src/f2.ts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Step 3' }));
    fireEvent.keyDown(screen.getByTestId('replay'), { key: 'ArrowRight' });
    expect(screen.getByText('src/f3.ts')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('replay'), { key: 'ArrowLeft' });
    expect(screen.getByText('src/f2.ts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prev' })).not.toBeDisabled();
  });

  it('a new turn resets to step 1', () => {
    const { rerender } = renderIt(turn(1, 5));
    fireEvent.click(screen.getByRole('button', { name: 'Step 4' }));
    rerender(<ThemeProvider theme={darkTheme}><ReplayTab turn={turn(2, 2)} /></ThemeProvider>);
    expect(screen.getByText('src/f1.ts')).toBeInTheDocument();
  });
});
