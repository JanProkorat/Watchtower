// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { darkTheme } from '../../../apps/desktop/src/theme';
import { SavvyAgentsPanel } from '../../../apps/desktop/src/components/instances/savvy/SavvyAgentsPanel';
import type { SavvyProgressState } from '@watchtower/shared/savvyProgress.js';

beforeAll(() => {
  // jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const snapshot: SavvyProgressState['snapshot'] = {
  lang: 'en',
  flow: {
    title: 'Port parser',
    total: 2,
    done: 0,
    running: 1,
    phase: 'delegate',
    isFinished: false,
    tasks: [
      { title: 'Write the parser', tier: 'careful', after: [] },
      { title: 'Add tests', tier: 'light', after: [1] },
    ],
  },
  agents: [
    {
      id: 't1',
      type: 'savvy-careful',
      description: 'Write the parser',
      model: 'claude-opus-5-5',
      status: 'running',
      startedAt: 9_000,
      contextTokens: 0,
      contextMax: 1_000_000,
      tokens: 0,
      costUsd: 0,
      steps: 0,
      round: 1,
    },
  ],
  sentAt: 10_000,
  panelToggles: 0,
};

describe('SavvyAgentsPanel', () => {
  it('draws a running agent and the planned task behind it', () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <SavvyAgentsPanel snapshot={snapshot} at={10_000} width={340} />
      </ThemeProvider>,
    );
    expect(screen.getByAltText('Write the parser: Opus 5.5, running')).toBeInTheDocument();
    expect(screen.getByAltText('2. Add tests: planned')).toBeInTheDocument();
  });
});
