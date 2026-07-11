import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Box, Divider, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import TerminalIcon from '@mui/icons-material/Terminal';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import { ColumnSlot } from './ColumnSlot.js';
import { InstanceTaskPickerDialog } from './InstanceTaskPickerDialog.js';
import { ATTENTION_AMBER } from '../../theme/glass.js';

interface Props {
  instanceId: string;
  status: string;
  kind: 'claude' | 'shell';
  taskId: number | null;
  cwd: string;
  focused: boolean;
  /** This instance is blocked on the user (waiting-permission/input, crashed). */
  attention: boolean;
  accent?: string;
  onFocus(): void;
  onHide(): void;
  onClose(): void;
  onRestart?(): void;
  onSetTask?(taskId: number | null): void;
  /** Add a new instance of `kind` immediately to the right of this pane. */
  onNewInstance(kind: 'claude' | 'shell'): void;
}

/**
 * One instance rendered as a floating rounded glass card (the terminal lives in
 * ColumnSlot). Replaces the old per-leaf SessionTabBar header: per-instance
 * controls now float as fading chrome buttons in the card's top-right (iPad
 * PaneTerminal language), and task assignment moves to a right-click menu on
 * the card. The chrome sits on the always-dark terminal, so it stays a
 * light-on-dark glass treatment in both app themes.
 */
export function PaneCard({
  instanceId,
  status,
  kind,
  taskId,
  cwd,
  focused,
  attention,
  accent,
  onFocus,
  onHide,
  onClose,
  onRestart,
  onSetTask,
  onNewInstance,
}: Props) {
  const [ctxAnchor, setCtxAnchor] = useState<{ x: number; y: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const closeCtx = () => setCtxAnchor(null);

  return (
    <Box
      sx={{ position: 'relative', height: '100%' }}
      onContextMenu={(e: ReactMouseEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setCtxAnchor({ x: e.clientX, y: e.clientY });
      }}
    >
      <ColumnSlot instanceId={instanceId} onFocus={onFocus} />

      {/* Top-edge line, drawn as an overlay ABOVE the terminal (an inset shadow
          on the slot would be hidden behind the xterm host). Amber + glowing
          when the instance needs attention (shown even when unfocused so it's
          easy to spot); otherwise the accent focus line. iPad language. */}
      {(focused || attention) && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '3px',
            backgroundColor: attention ? ATTENTION_AMBER : accent ?? '#818cf8',
            boxShadow: attention ? `0 0 10px ${ATTENTION_AMBER}` : 'none',
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
            zIndex: 7,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Which instance needs attention — a glowing warning badge, matching the
          project tab's ⚠ marker. */}
      {attention && (
        <WarningRoundedIcon
          aria-label="needs your attention"
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 7,
            fontSize: 18,
            color: ATTENTION_AMBER,
            filter: `drop-shadow(0 0 5px ${ATTENTION_AMBER}aa)`,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Fading top-right chrome — brighter when the pane is focused. */}
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: 0.5,
          opacity: focused ? 1 : 0.4,
          transition: 'opacity 120ms ease',
          zIndex: 6,
        }}
      >
        <ChromeButton title="New terminal to the right" onClick={() => onNewInstance('shell')}>
          <TerminalIcon sx={{ fontSize: 15 }} />
        </ChromeButton>
        <ChromeButton title="New Claude instance to the right" onClick={() => onNewInstance('claude')}>
          <AutoAwesomeIcon sx={{ fontSize: 15 }} />
        </ChromeButton>
        {kind === 'shell' && status === 'crashed' && onRestart && (
          <ChromeButton title="Restart terminal" onClick={onRestart}>
            <RefreshIcon sx={{ fontSize: 15 }} />
          </ChromeButton>
        )}
        <ChromeButton title="Hide (keep running)" onClick={onHide}>
          <VisibilityOffIcon sx={{ fontSize: 15 }} />
        </ChromeButton>
        <ChromeButton title="Close (kill session)" onClick={onClose}>
          <CloseIcon sx={{ fontSize: 15 }} />
        </ChromeButton>
      </Box>

      <Menu
        open={ctxAnchor != null}
        onClose={closeCtx}
        anchorReference="anchorPosition"
        anchorPosition={ctxAnchor ? { left: ctxAnchor.x, top: ctxAnchor.y } : undefined}
      >
        {onSetTask && [
          <MenuItem key="assign" onClick={() => { setPickerOpen(true); closeCtx(); }}>
            Assign to task…
          </MenuItem>,
          taskId != null && (
            <MenuItem key="clear" onClick={() => { onSetTask(null); closeCtx(); }}>
              Clear assignment
            </MenuItem>
          ),
          <Divider key="divider" />,
        ]}
        <MenuItem onClick={() => { onHide(); closeCtx(); }}>Hide session</MenuItem>
        <MenuItem onClick={() => { onClose(); closeCtx(); }}>Close session</MenuItem>
      </Menu>

      {pickerOpen && onSetTask && (
        <InstanceTaskPickerDialog
          open={pickerOpen}
          instanceCwd={cwd}
          currentTaskId={taskId}
          onAssign={(id) => onSetTask(id)}
          onClear={() => onSetTask(null)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </Box>
  );
}

/** Small frosted glass control that floats on the (always-dark) terminal card. */
function ChromeButton({ title, onClick, children }: { title: string; onClick(): void; children: ReactNode }) {
  return (
    <Tooltip title={title} placement="bottom-end">
      <IconButton
        aria-label={title}
        size="small"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        sx={{
          width: 24,
          height: 24,
          borderRadius: '7px',
          border: '1px solid rgba(255,255,255,0.14)',
          backgroundColor: 'rgba(20,22,28,0.6)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          color: '#d6dae2',
          ':hover': { backgroundColor: 'rgba(44,48,60,0.85)', color: '#fff' },
        }}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}
