import { useState, type CSSProperties } from 'react';
import { Box, Divider, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TabId, TabRecord } from '@watchtower/shared/layout.js';
import { DASHBOARD_TAB_ID } from '@watchtower/shared/layout.js';
import { tabAccent } from '../util/tabAccent.js';
import { glassSurface, accentWash, accentRing, accentActiveText, statusDot } from '../theme/glass.js';

// Outer tab dot is locked to the project's accent color (or a hash-based
// palette pick for ad-hoc cwd tabs). Per-session attention status is
// surfaced inside the leaf via SessionTabBar's per-tab notification dot.
function dotColor(id: string, accent: string | undefined): string {
  return tabAccent(id, accent);
}

// The strip doubles as the frameless macOS title bar (window.ts sets
// titleBarStyle: 'hiddenInset'), so the empty regions must drag the window
// while the tabs and buttons stay clickable. -webkit-app-region inherits in
// Electron: the container is `drag`, interactive children opt out via `no-drag`.
// WebkitAppRegion isn't in React's CSSProperties typings, hence the cast.
const DRAG_REGION = { WebkitAppRegion: 'drag' } as unknown as CSSProperties;
const NO_DRAG_REGION = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties;

// Clears the traffic-light buttons that hiddenInset keeps at the top-left.
const TRAFFIC_LIGHT_INSET = '78px';

interface TabButtonProps {
  id: string;
  label: string;
  active: boolean;
  draggable: boolean;
  accent?: string;
  mounted?: boolean;
  /** A session under this tab is blocked on the user — show ⚠️ instead of the dot. */
  attention?: boolean;
  dragRef?: (node: HTMLElement | null) => void;
  dragListeners?: React.HTMLAttributes<HTMLElement>;
  dragStyle?: CSSProperties;
  onClick(): void;
  onHide?(): void;
  onClose?(): void;
}

function TabButton({
  id,
  label,
  active,
  draggable,
  accent,
  mounted,
  attention,
  dragRef,
  dragListeners,
  dragStyle,
  onClick,
  onHide,
  onClose,
}: TabButtonProps) {
  const theme = useTheme();
  return (
    <Box
      ref={dragRef}
      onClick={onClick}
      style={{ ...(dragStyle ?? {}), ...NO_DRAG_REGION }}
      {...(dragListeners ?? {})}
      role="tab"
      aria-selected={active}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        height: 30,
        px: 1.25,
        borderRadius: '10px',
        cursor: draggable ? 'grab' : 'pointer',
        userSelect: 'none',
        // iPad pill: active = purple wash + ring + accent text; no underline.
        color: active ? accentActiveText(theme) : 'text.secondary',
        backgroundColor: active ? accentWash(theme) : 'transparent',
        boxShadow: active ? accentRing(theme) : 'none',
        ':hover': {
          backgroundColor: active ? accentWash(theme) : 'action.hover',
          color: active ? accentActiveText(theme) : 'text.primary',
        },
        ':active': { cursor: draggable ? 'grabbing' : 'pointer' },
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'background-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
      }}
    >
      {attention ? (
        <Tooltip title="A session here needs your attention" placement="bottom">
          <Box
            aria-label={`${label} needs your attention`}
            sx={statusDot('attention', accent, theme)}
          />
        </Tooltip>
      ) : (
        <Box
          // Active → project-accent dot with glow; otherwise the project dot when
          // the tab is mounted, a muted dot when it's only a collapsed tab.
          sx={statusDot(active ? 'active' : 'idle', mounted ? dotColor(id, accent) : undefined, theme)}
        />
      )}
      <span>{label}</span>
      {onHide && (
        <Tooltip title="Hide from workspace (keep instances running)" placement="bottom">
          <Box
            component="span"
            role="button"
            aria-label={`hide ${label}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onHide();
            }}
            sx={{
              ml: 0.5,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: '4px',
              color: 'text.disabled',
              ':hover': { backgroundColor: 'action.hover', color: 'text.primary' },
            }}
          >
            <VisibilityOffIcon sx={{ fontSize: 14 }} />
          </Box>
        </Tooltip>
      )}
      {onClose && (
        <Tooltip title="Close tab (kill all sessions)" placement="bottom">
          <Box
            component="span"
            role="button"
            aria-label={`close ${label}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            sx={{
              ml: 0.25,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: '4px',
              color: 'text.disabled',
              ':hover': { backgroundColor: 'action.hover', color: 'text.primary' },
            }}
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </Box>
        </Tooltip>
      )}
    </Box>
  );
}

interface SortableTabProps
  extends Omit<TabButtonProps, 'dragRef' | 'dragListeners' | 'dragStyle' | 'draggable'> {
  id: string;
}

function SortableTab(props: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 1 : 'auto',
    position: 'relative',
  };
  return (
    <TabButton
      {...props}
      draggable
      dragRef={setNodeRef}
      dragListeners={{ ...attributes, ...listeners }}
      dragStyle={style}
    />
  );
}

interface Props {
  tabs: TabRecord[];
  mountedTabIds: Set<string>;
  /**
   * Whether the workspace (Instances module) is the visible view. When false,
   * no tab is selected and the per-tab "mounted in workspace" accent underline
   * is hidden — the workspace isn't on screen, so those markers would be noise.
   */
  workspaceActive: boolean;
  /** Tab ids with at least one session blocked on the user (renders ⚠️). */
  attentionTabIds: Set<string>;
  focusedTabId: TabId | null;
  onSelect(id: TabId): void;
  onContextSplit(id: TabId, dir: 'row' | 'col'): void;
  onContextNewInstance(id: TabId): void;
  canSpawnInTab(id: TabId): boolean;
  onCloseTab(id: TabId): void;
  onCloseInWorkspace(id: TabId): void;
  onHideTab(id: TabId): void;
  onNew(): void;
}

export function TabStrip({
  tabs,
  mountedTabIds,
  workspaceActive,
  attentionTabIds,
  focusedTabId,
  onSelect,
  onContextSplit,
  onContextNewInstance,
  canSpawnInTab,
  onCloseTab,
  onCloseInWorkspace,
  onHideTab,
  onNew,
}: Props) {
  const theme = useTheme();
  // glassSurface is the single source of truth for frosted fill + blur + border.
  // Decision: TabStrip uses glassSurface directly (not via MuiAppBar component);
  // the MuiAppBar override in theme.ts is updated to also derive from glassSurface
  // so both stay in sync and neither is dead + divergent.
  const glass = glassSurface(theme);
  // The dashboard tab id is the workspace's empty-state fallback leaf, not a
  // user-facing tab — never render it in the strip.
  const visibleTabs = tabs.filter((t) => t.id !== DASHBOARD_TAB_ID);
  const ids = visibleTabs.map((t) => t.id);
  const [ctxMenu, setCtxMenu] = useState<{ id: TabId; x: number; y: number } | null>(null);

  return (
    <Box
      style={DRAG_REGION}
      sx={{
        display: 'flex',
        alignItems: 'center',
        minHeight: 40,
        pl: TRAFFIC_LIGHT_INSET,
        // Glass frosted bar — glassSurface provides fill, backdropFilter, border, boxShadow.
        // Border is overridden to only draw the bottom edge (the top is the window chrome).
        ...glass,
        border: 'none',
        borderBottom: `1px solid ${theme.palette.divider}`,
        flexShrink: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {/* No DndContext here — App provides one so a tab drag can also drop on workspace leaves. */}
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pl: 0.5 }}>
          {visibleTabs.map((t) => (
            <Box
              key={t.id}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ id: t.id, x: e.clientX, y: e.clientY });
              }}
            >
              <SortableTab
                id={t.id}
                label={t.label}
                accent={t.color ?? undefined}
                mounted={workspaceActive && mountedTabIds.has(t.id)}
                attention={attentionTabIds.has(t.id)}
                active={focusedTabId === t.id}
                onClick={() => onSelect(t.id)}
                onHide={!mountedTabIds.has(t.id) ? undefined : () => onHideTab(t.id)}
                onClose={() => onCloseTab(t.id)}
              />
            </Box>
          ))}
        </Box>
      </SortableContext>
      <Box sx={{ flex: 1, minWidth: 0 }} />
      <Tooltip title="New instance" placement="left">
        <IconButton
          onClick={onNew}
          size="small"
          style={NO_DRAG_REGION}
          sx={{ mr: 1, color: 'text.secondary', ':hover': { color: 'primary.main' } }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        open={Boolean(ctxMenu)}
        onClose={() => setCtxMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={ctxMenu ? { left: ctxMenu.x, top: ctxMenu.y } : undefined}
      >
        <MenuItem
          onClick={() => {
            if (ctxMenu) onSelect(ctxMenu.id);
            setCtxMenu(null);
          }}
        >
          Open here
        </MenuItem>
        {ctxMenu && canSpawnInTab(ctxMenu.id) && (
          <MenuItem
            onClick={() => {
              if (ctxMenu) onContextNewInstance(ctxMenu.id);
              setCtxMenu(null);
            }}
          >
            New instance here
          </MenuItem>
        )}
        <Divider />
        <MenuItem
          disabled={ctxMenu ? mountedTabIds.has(ctxMenu.id) : false}
          onClick={() => {
            if (ctxMenu) onContextSplit(ctxMenu.id, 'row');
            setCtxMenu(null);
          }}
        >
          Split right
        </MenuItem>
        <MenuItem
          disabled={ctxMenu ? mountedTabIds.has(ctxMenu.id) : false}
          onClick={() => {
            if (ctxMenu) onContextSplit(ctxMenu.id, 'col');
            setCtxMenu(null);
          }}
        >
          Split down
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            if (ctxMenu) onCloseInWorkspace(ctxMenu.id);
            setCtxMenu(null);
          }}
          sx={{ color: 'error.main' }}
        >
          Close in workspace
        </MenuItem>
      </Menu>
    </Box>
  );
}

export const DASHBOARD_TAB = DASHBOARD_TAB_ID;
