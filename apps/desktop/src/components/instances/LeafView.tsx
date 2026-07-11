import { Fragment, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Box, Typography, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { PaneCard } from './PaneCard.js';
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
  onAddSessionAfter(afterInstanceId: string, cwd: string, kind: 'claude' | 'shell'): void;
  onSetTask?(instanceId: string, taskId: number | null): void;
  dashboardOnNew?(): void;
}

interface SessionInfo {
  id: string;
  status: string;
  kind: 'claude' | 'shell';
  taskId: number | null;
  cwd: string;
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
  onAddSessionAfter,
  onSetTask,
  dashboardOnNew,
}: Props) {
  const [hiddenAnchor, setHiddenAnchor] = useState<HTMLElement | null>(null);

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
  const sessionInfos: SessionInfo[] = tab.columnOrder.map((id) => {
    const inst = instances.find((i) => i.id === id);
    return { id, status: inst?.status ?? 'unknown', kind: inst?.kind ?? ('claude' as const), taskId: inst?.taskId ?? null, cwd: inst?.cwd ?? '' };
  });
  const hiddenSessionInfos: SessionInfo[] = tab.hiddenInstanceIds.map((id) => {
    const inst = instances.find((i) => i.id === id);
    return { id, status: inst?.status ?? 'unknown', kind: inst?.kind ?? ('claude' as const), taskId: inst?.taskId ?? null, cwd: inst?.cwd ?? '' };
  });

  // Leaf-level actions cluster — floats at the top-left, opposite the per-card
  // chrome (top-right). Holds "new session" and, when there are hidden sessions,
  // the tray that brings them back (the only path to un-hide).
  const leafActions = (
    <Box
      sx={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 6,
        display: 'flex',
        gap: 0.5,
        opacity: 0.55,
        transition: 'opacity 120ms ease',
        ':hover': { opacity: 1 },
      }}
    >
      {/* The "+" only seeds the FIRST instance of an empty leaf — once panes
          exist, each pane's chrome carries the terminal/claude add buttons
          (which insert positionally). */}
      {tab.columnOrder.length === 0 && (
        <Tooltip title="New session in this project" placement="bottom-start">
          <IconButton
            aria-label="new session"
            size="small"
            onClick={onAddSession}
            sx={LEAF_BTN_SX}
          >
            <AddIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      )}
      {hiddenSessionInfos.length > 0 && (
        <Tooltip title={`${hiddenSessionInfos.length} hidden session${hiddenSessionInfos.length === 1 ? '' : 's'}`} placement="bottom-start">
          <IconButton
            aria-label={`show ${hiddenSessionInfos.length} hidden session${hiddenSessionInfos.length === 1 ? '' : 's'}`}
            size="small"
            onClick={(e: ReactMouseEvent<HTMLElement>) => setHiddenAnchor(e.currentTarget)}
            sx={{ ...LEAF_BTN_SX, width: 'auto', px: 0.75, gap: 0.5, fontSize: 11, fontWeight: 600 }}
          >
            <VisibilityOffIcon sx={{ fontSize: 14 }} />
            {hiddenSessionInfos.length}
          </IconButton>
        </Tooltip>
      )}
      <Menu
        open={Boolean(hiddenAnchor)}
        anchorEl={hiddenAnchor}
        onClose={() => setHiddenAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {hiddenSessionInfos.map((s, i) => (
          <MenuItem
            key={s.id}
            onClick={() => {
              onUnhideSession(s.id);
              setHiddenAnchor(null);
            }}
          >
            Show hidden session {i + 1}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );

  // Empty (no visible columns) — placeholder + the leaf actions so the user can
  // still add a session or un-hide.
  if (tab.columnOrder.length === 0) {
    return (
      <Box sx={{ flex: 1, height: '100%', position: 'relative', minHeight: 0 }}>
        {leafActions}
        <Box
          sx={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
            fontSize: 13,
          }}
        >
          <Typography variant="body2">
            {hiddenSessionInfos.length > 0
              ? `All ${hiddenSessionInfos.length} session${hiddenSessionInfos.length === 1 ? '' : 's'} in ${tab.label} are hidden`
              : `No instances in ${tab.label} yet`}
          </Typography>
        </Box>
      </Box>
    );
  }

  const focusedId = tab.focusedInstanceId ?? tab.columnOrder[0]!;

  return (
    // Outer gutter so the instance cards float clear of the edges; the
    // transparent resize handles become the inter-card gaps.
    <Box sx={{ flex: 1, minHeight: 0, position: 'relative', p: '8px' }}>
      {leafActions}
      <PanelGroup direction="horizontal" autoSaveId={`columns-${tab.id}`}>
        {tab.columnOrder.map((instanceId, idx) => {
          const s = sessionInfos[idx]!;
          return (
            <Fragment key={instanceId}>
              {idx > 0 && (
                <PanelResizeHandle
                  style={{
                    // Transparent gap between cards — the backdrop shows through.
                    width: 12,
                    background: 'transparent',
                    cursor: 'col-resize',
                  }}
                />
              )}
              <Panel defaultSize={100 / tab.columnOrder.length} minSize={10}>
                <PaneCard
                  instanceId={instanceId}
                  status={s.status}
                  kind={s.kind}
                  taskId={s.taskId}
                  cwd={s.cwd}
                  focused={focused && tab.focusedInstanceId === instanceId}
                  accent={accent}
                  onFocus={() => onFocusColumn(instanceId)}
                  onHide={() => onHideSession(instanceId)}
                  onClose={() => onCloseColumn(instanceId)}
                  onRestart={onRestartColumn ? () => onRestartColumn(instanceId) : undefined}
                  onSetTask={onSetTask ? (taskId) => onSetTask(instanceId, taskId) : undefined}
                  onNewInstance={(kind) => onAddSessionAfter(instanceId, s.cwd, kind)}
                />
              </Panel>
            </Fragment>
          );
        })}
      </PanelGroup>
    </Box>
  );
}

const LEAF_BTN_SX = {
  height: 24,
  minWidth: 24,
  borderRadius: '7px',
  border: '1px solid rgba(255,255,255,0.14)',
  backgroundColor: 'rgba(20,22,28,0.6)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  color: '#d6dae2',
  display: 'flex',
  alignItems: 'center',
  ':hover': { backgroundColor: 'rgba(44,48,60,0.85)', color: '#fff' },
} as const;
