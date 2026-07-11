import { Fragment, useState } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ColumnSlot } from './ColumnSlot.js';
import { SessionTabBar } from './SessionTabBar.js';
import { EmptyWorkspace } from './EmptyWorkspace.js';
import type { TabRecord } from '@watchtower/shared/layout.js';
import type { InstanceView } from '../../state/useInstances.js';
import { tabAccent } from '../../util/tabAccent.js';

interface Props {
  tab: TabRecord;
  focused: boolean;
  instances: InstanceView[];
  onFocusColumn(instanceId: string): void;
  onCloseColumn(instanceId: string): void;
  onRestartColumn?(instanceId: string): void;
  onHideSession(instanceId: string): void;
  onUnhideSession(instanceId: string): void;
  onAddSession(): void;
  onSetTask?(instanceId: string, taskId: number | null): void;
  dashboardOnNew?(): void;
}

export function LeafView({
  tab,
  focused,
  instances,
  onFocusColumn,
  onCloseColumn,
  onRestartColumn,
  onHideSession,
  onUnhideSession,
  onAddSession,
  onSetTask,
  dashboardOnNew,
}: Props) {
  // Live pane percentages from the column PanelGroup, so the session tabs above
  // can track the resize handle instead of staying at fixed equal widths.
  const [columnSizes, setColumnSizes] = useState<number[]>([]);
  const theme = useTheme();

  if (tab.kind === 'dashboard') {
    return (
      <Box
        sx={{
          flex: 1,
          height: '100%',
          position: 'relative',
          outline: focused ? '2px solid' : 'none',
          outlineColor: 'primary.main',
          outlineOffset: -2,
        }}
      >
        <EmptyWorkspace onNew={dashboardOnNew ?? (() => {})} />
      </Box>
    );
  }

  const accent = tabAccent(tab.id, tab.color);
  const sessionInfos = tab.columnOrder.map((id) => {
    const inst = instances.find((i) => i.id === id);
    return { id, status: inst?.status ?? 'unknown', kind: inst?.kind ?? 'claude' as const, taskId: inst?.taskId ?? null, cwd: inst?.cwd ?? '' };
  });
  const hiddenSessionInfos = tab.hiddenInstanceIds.map((id) => {
    const inst = instances.find((i) => i.id === id);
    return { id, status: inst?.status ?? 'unknown', kind: inst?.kind ?? 'claude' as const, taskId: inst?.taskId ?? null, cwd: inst?.cwd ?? '' };
  });

  // Empty (no visible columns) — still render the bar so the user can
  // un-hide / add a new session. The column area shows a placeholder.
  if (tab.columnOrder.length === 0) {
    return (
      <Box sx={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <SessionTabBar
          sessions={sessionInfos}
          hiddenSessions={hiddenSessionInfos}
          focusedId={null}
          accent={accent}
          onSelect={onFocusColumn}
          onClose={onCloseColumn}
          onRestart={onRestartColumn}
          onHide={onHideSession}
          onUnhide={onUnhideSession}
          onAddSession={onAddSession}
          onSetTask={onSetTask}
        />
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
            fontSize: 13,
          }}
        >
          <Typography variant="body2">
            {hiddenSessionInfos.length > 0
              ? `All ${hiddenSessionInfos.length} session${
                  hiddenSessionInfos.length === 1 ? '' : 's'
                } in ${tab.label} are hidden`
              : `No instances in ${tab.label} yet`}
          </Typography>
        </Box>
      </Box>
    );
  }

  const focusedId = tab.focusedInstanceId ?? tab.columnOrder[0]!;

  return (
    <Box sx={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SessionTabBar
        sessions={sessionInfos}
        hiddenSessions={hiddenSessionInfos}
        focusedId={focusedId}
        accent={accent}
        columnSizes={columnSizes}
        onSelect={onFocusColumn}
        onClose={onCloseColumn}
        onRestart={onRestartColumn}
        onHide={onHideSession}
        onUnhide={onUnhideSession}
        onAddSession={onAddSession}
        onSetTask={onSetTask}
      />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <PanelGroup
          direction="horizontal"
          autoSaveId={`columns-${tab.id}`}
          onLayout={setColumnSizes}
        >
          {tab.columnOrder.map((instanceId, idx) => (
            <Fragment key={instanceId}>
              {idx > 0 && (
                <PanelResizeHandle
                  style={{
                    width: 6,
                    // Use theme divider so the hairline is visible in both dark and light mode.
                    background: theme.palette.divider,
                    cursor: 'col-resize',
                  }}
                />
              )}
              <Panel defaultSize={100 / tab.columnOrder.length} minSize={10}>
                <Box sx={{ position: 'relative', height: '100%' }}>
                  <ColumnSlot
                    instanceId={instanceId}
                    focused={focused && tab.focusedInstanceId === instanceId}
                    accent={accent}
                    onFocus={() => onFocusColumn(instanceId)}
                  />
                </Box>
              </Panel>
            </Fragment>
          ))}
        </PanelGroup>
      </Box>
    </Box>
  );
}
