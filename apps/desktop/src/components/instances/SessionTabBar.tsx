import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Box, Divider, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import TerminalIcon from '@mui/icons-material/Terminal';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { tabFlex } from '../../util/tabFlex.js';
import { InstanceTaskPickerDialog } from './InstanceTaskPickerDialog.js';

const ATTENTION_DOT: Record<string, string> = {
  'waiting-permission': '#ef5350',
  'waiting-input': '#ffb74d',
  'idle-notify': '#9e9e9e',
  crashed: '#ef5350',
};

const MUTED_DOT = 'rgba(255,255,255,0.18)';

export interface SessionInfo {
  id: string;
  status: string;
  kind: 'claude' | 'shell';
  taskId: number | null;
  /** Working directory of the instance — used to preselect the project in the picker. */
  cwd: string;
}

interface Props {
  sessions: SessionInfo[];
  hiddenSessions: SessionInfo[];
  focusedId: string | null;
  accent: string;
  /** Live panel percentages from the pane PanelGroup, so tabs track resizing. */
  columnSizes?: number[];
  onSelect(id: string): void;
  onClose(id: string): void;
  onRestart?(id: string): void;
  onHide(id: string): void;
  onUnhide(id: string): void;
  onAddSession(): void;
  onSetTask?(instanceId: string, taskId: number | null): void;
}

export function SessionTabBar({
  sessions,
  hiddenSessions,
  focusedId,
  accent,
  columnSizes,
  onSelect,
  onClose,
  onRestart,
  onHide,
  onUnhide,
  onAddSession,
  onSetTask,
}: Props) {
  const [hiddenAnchor, setHiddenAnchor] = useState<HTMLElement | null>(null);

  // Context menu (right-click on a session tab).
  const [ctxAnchor, setCtxAnchor] = useState<HTMLElement | null>(null);
  const [ctxSession, setCtxSession] = useState<SessionInfo | null>(null);

  // Task picker dialog.
  const [pickerSession, setPickerSession] = useState<SessionInfo | null>(null);

  const openCtxMenu = (e: ReactMouseEvent<HTMLElement>, s: SessionInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxSession(s);
    setCtxAnchor(e.currentTarget);
  };

  return (
    <Box
      role="tablist"
      sx={{
        display: 'flex',
        flexShrink: 0,
        borderBottom: 1,
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {sessions.map((s, idx) => {
        const active = s.id === focusedId;
        const attentionColor = ATTENTION_DOT[s.status];
        return (
          <Box
            key={s.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(s.id)}
            onContextMenu={(e) => openCtxMenu(e, s)}
            sx={{
              flex: tabFlex(columnSizes, idx),
              minWidth: 100,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              minHeight: 32,
              cursor: 'pointer',
              userSelect: 'none',
              color: active ? 'text.primary' : 'text.secondary',
              backgroundColor: active ? 'background.default' : 'transparent',
              borderRight: idx < sessions.length - 1 ? 1 : 0,
              borderColor: 'divider',
              borderBottom: 2,
              borderBottomColor: active ? accent : 'transparent',
              transition: 'background-color 120ms',
              ':hover': {
                backgroundColor: active ? 'background.default' : 'action.hover',
              },
              fontSize: 12,
            }}
          >
            {s.kind === 'shell' ? (
              <TerminalIcon
                aria-label="terminal"
                sx={{ fontSize: 14, flexShrink: 0, opacity: s.status === 'crashed' ? 0.5 : 0.8 }}
              />
            ) : (
              <Box
                aria-label={attentionColor ? `${s.status} — needs attention` : s.status}
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: attentionColor ?? MUTED_DOT,
                  flexShrink: 0,
                }}
              />
            )}
            <Box
              sx={{
                flex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              Session {idx + 1}
            </Box>
            {s.kind === 'shell' && s.status === 'crashed' && onRestart && (
              <Tooltip title="Restart terminal" placement="bottom-end">
                <IconButton
                  size="small"
                  aria-label="restart terminal"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestart(s.id);
                  }}
                  sx={{
                    width: 20,
                    height: 20,
                    color: 'text.disabled',
                    ':hover': { color: 'text.primary' },
                  }}
                >
                  <RefreshIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Hide session (keep running)" placement="bottom-end">
              <IconButton
                aria-label={`hide session ${idx + 1}`}
                size="small"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onHide(s.id);
                }}
                sx={{
                  width: 20,
                  height: 20,
                  color: 'text.disabled',
                  ':hover': { color: 'text.primary' },
                }}
              >
                <VisibilityOffIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Close session (kill)" placement="bottom-end">
              <IconButton
                aria-label={`close session ${idx + 1}`}
                size="small"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(s.id);
                }}
                sx={{
                  width: 20,
                  height: 20,
                  color: 'text.disabled',
                  ':hover': { color: 'text.primary' },
                }}
              >
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        );
      })}
      {hiddenSessions.length > 0 && (
        <>
          <Tooltip title="Show hidden sessions" placement="bottom-end">
            <Box
              role="button"
              aria-label={`show ${hiddenSessions.length} hidden session${
                hiddenSessions.length === 1 ? '' : 's'
              }`}
              onClick={(e: ReactMouseEvent<HTMLElement>) => setHiddenAnchor(e.currentTarget)}
              sx={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1.25,
                cursor: 'pointer',
                color: 'text.secondary',
                fontSize: 11,
                userSelect: 'none',
                borderLeft: 1,
                borderColor: 'divider',
                ':hover': { backgroundColor: 'action.hover', color: 'text.primary' },
              }}
            >
              <VisibilityOffIcon sx={{ fontSize: 14 }} />
              <Typography variant="caption">{hiddenSessions.length} hidden</Typography>
            </Box>
          </Tooltip>
          <Menu
            open={Boolean(hiddenAnchor)}
            anchorEl={hiddenAnchor}
            onClose={() => setHiddenAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {hiddenSessions.map((s, i) => (
              <MenuItem
                key={s.id}
                onClick={() => {
                  onUnhide(s.id);
                  setHiddenAnchor(null);
                }}
              >
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: ATTENTION_DOT[s.status] ?? MUTED_DOT,
                    mr: 1,
                  }}
                />
                Show hidden session {i + 1}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
      <Tooltip title="New session in this project" placement="bottom-end">
        <IconButton
          aria-label="new session"
          size="small"
          onClick={onAddSession}
          sx={{
            flexShrink: 0,
            mx: 0.5,
            color: 'text.secondary',
            ':hover': { color: 'primary.main' },
          }}
        >
          <AddIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>

      {/* Right-click context menu for a session tab */}
      <Menu
        open={Boolean(ctxAnchor)}
        anchorEl={ctxAnchor}
        onClose={() => { setCtxAnchor(null); setCtxSession(null); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {onSetTask && [
          <MenuItem
            key="assign"
            onClick={() => {
              setPickerSession(ctxSession);
              setCtxAnchor(null);
              setCtxSession(null);
            }}
          >
            Assign to task…
          </MenuItem>,
          ctxSession?.taskId != null && (
            <MenuItem
              key="clear"
              onClick={() => {
                if (ctxSession && onSetTask) onSetTask(ctxSession.id, null);
                setCtxAnchor(null);
                setCtxSession(null);
              }}
            >
              Clear assignment
            </MenuItem>
          ),
          <Divider key="divider" />,
        ]}
        <MenuItem
          onClick={() => {
            if (ctxSession) onHide(ctxSession.id);
            setCtxAnchor(null);
            setCtxSession(null);
          }}
        >
          Hide session
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (ctxSession) onClose(ctxSession.id);
            setCtxAnchor(null);
            setCtxSession(null);
          }}
        >
          Close session
        </MenuItem>
      </Menu>

      {/* Task picker dialog — opened from the context menu */}
      {pickerSession != null && onSetTask && (
        <InstanceTaskPickerDialog
          open={pickerSession != null}
          instanceCwd={pickerSession.cwd}
          currentTaskId={pickerSession.taskId}
          onAssign={(taskId) => onSetTask(pickerSession.id, taskId)}
          onClear={() => onSetTask(pickerSession.id, null)}
          onClose={() => setPickerSession(null)}
        />
      )}
    </Box>
  );
}
