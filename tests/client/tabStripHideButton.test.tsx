// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { DndContext } from '@dnd-kit/core';
import { darkTheme } from '../../apps/desktop/src/theme';
import { TabStrip } from '../../apps/desktop/src/components/TabStrip';
import { DASHBOARD_TAB_ID } from '@watchtower/shared/layout.js';
import type { TabRecord } from '@watchtower/shared/layout.js';

// "Hide from workspace" unmounts a tab's pane so the *other* panes reclaim the
// space. With a single project mounted there is nothing to reclaim, so the icon
// is dead weight on every active tab — it must only appear once two or more
// tabs share the window (split view). "Close in workspace" in the context menu
// remains available either way; it is the same unmount action.

const TABS = [
  { id: 'project:1', label: 'PPS', color: '#38bdf8' },
  { id: 'project:2', label: 'TimeTracker', color: '#22c55e' },
] as unknown as TabRecord[];

function renderStrip(mounted: string[], tabs: TabRecord[] = TABS) {
  render(
    <ThemeProvider theme={darkTheme}>
      <DndContext>
        <TabStrip
          tabs={tabs}
          mountedTabIds={new Set(mounted)}
          workspaceActive
          attentionTabIds={new Set()}
          focusedTabId={(mounted[0] ?? null) as never}
          onSelect={vi.fn()}
          onContextSplit={vi.fn()}
          onContextNewInstance={vi.fn()}
          canSpawnInTab={() => true}
          onCloseTab={vi.fn()}
          onCloseInWorkspace={vi.fn()}
          onHideTab={vi.fn()}
          onNew={vi.fn()}
        />
      </DndContext>
    </ThemeProvider>,
  );
}

describe('TabStrip hide button', () => {
  it('is hidden when only one tab is mounted in the workspace', () => {
    renderStrip(['project:1']);

    expect(screen.queryByLabelText('hide PPS')).toBeNull();
    expect(screen.queryByLabelText('hide TimeTracker')).toBeNull();
    // The tab is still closable — only the hide affordance goes away.
    expect(screen.getByLabelText('close PPS')).toBeInTheDocument();
  });

  it('shows the hide button on mounted tabs once two tabs share the window', () => {
    renderStrip(['project:1', 'project:2']);

    expect(screen.getByLabelText('hide PPS')).toBeInTheDocument();
    expect(screen.getByLabelText('hide TimeTracker')).toBeInTheDocument();
  });

  it('does not count the dashboard fallback leaf as a second pane', () => {
    renderStrip(['project:1', DASHBOARD_TAB_ID]);

    expect(screen.queryByLabelText('hide PPS')).toBeNull();
  });

  it('never shows the hide button on an unmounted tab', () => {
    renderStrip(['project:1', 'project:2'], [
      ...TABS,
      { id: 'project:3', label: 'Fitness', color: '#f5a524' },
    ] as unknown as TabRecord[]);

    expect(screen.getByLabelText('hide PPS')).toBeInTheDocument();
    expect(screen.queryByLabelText('hide Fitness')).toBeNull();
  });
});
