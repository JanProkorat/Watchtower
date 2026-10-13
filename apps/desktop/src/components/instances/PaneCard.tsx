import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Box, Divider, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import TerminalIcon from '@mui/icons-material/Terminal';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { ColumnSlot } from './ColumnSlot.js';
import { ChatView } from '../chat/ChatView.js';
import { chatPalette } from '../chat/chatFormat.js';
import { TERMINAL_BG } from '../terminalTheme';
import { InstanceTaskPickerDialog } from './InstanceTaskPickerDialog.js';
import { useSavvyChrome } from './savvy/useSavvyChrome.js';
import { SavvyAgentsPanel } from './savvy/SavvyAgentsPanel.js';
import { SidePanel } from './side/SidePanel.js';
import { useSidePanel, type SideTab } from './side/useSidePanel.js';
import { ATTENTION_AMBER } from '../../theme/glass.js';

interface Props {
  instanceId: string;
  status: string;
  kind: 'claude' | 'shell' | 'chat';
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
  onNewInstance(kind: 'claude' | 'shell' | 'chat'): void;
}

/** Height of the pane's title bar; the card (terminal / chat / mod chrome) starts below it. */
const BAR_H = 30;

/**
 * One instance rendered as a floating rounded card: a title bar (attention badge,
 * per-instance controls) on top of the terminal (ColumnSlot) or chat view. The
 * bar is the card's top edge rather than an overlay, so the controls never cover
 * what Claude Code or a mod draws in the terminal's corners. Task assignment
 * lives in a right-click menu on the card.
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
  // The right-side panel (Agents from the savvy-progress mod, Files in Task 9)
  // and the savvy band below the terminal, all drawn natively.
  const sideToggle = useRef<(tab: SideTab) => void>(() => {});
  const savvy = useSavvyChrome(instanceId, kind !== 'shell', () => sideToggle.current('agents'));
  const available: SideTab[] = savvy.agents ? ['agents'] : [];
  const side = useSidePanel({
    available,
    agentsAutoKey: savvy.agentsAutoKey,
    toggles: { agents: savvy.panelToggles },
  });
  sideToggle.current = side.toggle;
  const rightInset = side.isOpen ? side.width : 0;
  // The bar takes the fill and border of the card below it, so the two read as one.
  const isDark = useTheme().palette.mode === 'dark';
  const chat = chatPalette(isDark);
  const cardBg = kind === 'chat' ? chat.bg : TERMINAL_BG;
  const cardBorder = kind === 'chat' ? chat.border : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,18,24,0.10)';

  return (
    <Box
      sx={{ position: 'relative', height: '100%', animation: 'wt-pane-in 320ms cubic-bezier(0.22,1,0.36,1)' }}
      onContextMenu={(e: ReactMouseEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setCtxAnchor({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Title bar: ⚠ badge left, controls right — brighter when the pane is focused. */}
      <Box
        onMouseDown={onFocus}
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: BAR_H,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          backgroundColor: cardBg,
          border: `1px solid ${cardBorder}`,
          borderBottomColor: kind === 'chat' ? chat.border : 'rgba(255,255,255,0.06)',
          borderRadius: '12px 12px 0 0',
        }}
      >
        {/* Line under the bar: amber + glowing when the instance needs attention
            (shown even when unfocused so it's easy to spot); otherwise the
            accent focus line. Replaces the bar's divider. */}
        {(focused || attention) && (
          <Box
            sx={{
              position: 'absolute',
              bottom: -1,
              left: -1,
              right: -1,
              height: '2px',
              backgroundColor: attention ? ATTENTION_AMBER : accent ?? '#818cf8',
              boxShadow: attention ? `0 0 10px ${ATTENTION_AMBER}` : 'none',
              zIndex: 1,
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
              fontSize: 18,
              color: ATTENTION_AMBER,
              filter: `drop-shadow(0 0 5px ${ATTENTION_AMBER}aa)`,
              pointerEvents: 'none',
            }}
          />
        )}
        <Box
          sx={{
            ml: 'auto',
            display: 'flex',
            gap: 0.5,
            opacity: focused ? 1 : 0.4,
            transition: 'opacity 120ms ease',
            ':hover': { opacity: 1 },
          }}
        >
          <ChromeButton title="New terminal to the right" onClick={() => onNewInstance('shell')}>
            <TerminalIcon sx={{ fontSize: 15 }} />
          </ChromeButton>
          <ChromeButton title="New Claude instance to the right" onClick={() => onNewInstance('claude')}>
            <AutoAwesomeIcon sx={{ fontSize: 15 }} />
          </ChromeButton>
          <ChromeButton title="New chat to the right" onClick={() => onNewInstance('chat')}>
            <ChatBubbleOutlineIcon sx={{ fontSize: 15 }} />
          </ChromeButton>
          {!side.isOpen && side.available.length > 0 && (
            <ChromeButton title="Show side panel" onClick={() => side.open()}>
              <ViewSidebarOutlinedIcon sx={{ fontSize: 15 }} />
            </ChromeButton>
          )}
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
      </Box>

      {/* With the agents panel open, the terminal's bottom-right corner goes
          square: the panel continues the card from there. */}
      <Box
        sx={{
          position: 'absolute',
          top: BAR_H,
          left: 0,
          right: rightInset,
          bottom: savvy.bottomInset,
          ...(side.isOpen ? { '& > *': { borderBottomRightRadius: 0 } } : {}),
        }}
      >
        {kind === 'chat' ? (
          <ChatView instanceId={instanceId} cwd={cwd} onFocus={onFocus} />
        ) : (
          <ColumnSlot instanceId={instanceId} onFocus={onFocus} />
        )}

      </Box>

      {savvy.band && (
        <Box sx={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>{savvy.band}</Box>
      )}
      {side.isOpen && side.tab && (
        <Box
          sx={{
            position: 'absolute',
            top: BAR_H,
            right: 0,
            bottom: savvy.bottomInset,
            width: rightInset,
            boxSizing: 'border-box',
            backgroundColor: cardBg,
            border: `1px solid ${cardBorder}`,
            borderTop: 'none',
            borderLeft: 'none',
            borderRadius: '0 0 12px 0',
            boxShadow: isDark ? '0 10px 28px rgba(0,0,0,0.40)' : '0 10px 26px rgba(15,18,24,0.16)',
          }}
        >
          <SidePanel
            tabs={side.available}
            tab={side.tab}
            width={side.width}
            onSelect={side.select}
            onClose={side.close}
            onResize={side.setWidth}
          >
            {side.tab === 'agents' && savvy.agents && (
              <SavvyAgentsPanel snapshot={savvy.agents.snapshot} at={savvy.agents.at} width={side.width} />
            )}
          </SidePanel>
        </Box>
      )}

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

/** Small frosted glass control in the pane's title bar; dark glass reads on both app themes. */
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
