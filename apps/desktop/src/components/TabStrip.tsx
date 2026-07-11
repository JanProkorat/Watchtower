import { useState, type CSSProperties } from 'react';
import { Box, Divider, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import WarningRoundedIcon from '@mui/icons-material/WarningRounded';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TabId, TabRecord } from '@watchtower/shared/layout.js';
import { DASHBOARD_TAB_ID } from '@watchtower/shared/layout.js';
import { tabAccent } from '../util/tabAccent.js';
import { glassFloating, accentWash, accentRing, accentActiveText, statusDot, ATTENTION_AMBER } from '../theme/glass.js';

// Outer tab dot is locked to the project's accent color (or a hash-based
// palette pick for ad-hoc cwd tabs). Per-session attention status is
// surfaced inside the leaf via SessionTabBar's per-tab notification dot.
function dotColor(id: string, accent: string | undefined): string {
  return tabAccent(id, accent);
}

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
      style={dragStyle}
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
        // Stretch-in on mount — a newly added tab expands the (content-width,
        // centered) bar open. overflow:hidden clips the content while max-width
        // animates from 0. Runs once per tab (keyed elements aren't remounted).
        overflow: 'hidden',
        animation: 'wt-tab-in 440ms cubic-bezier(0.22,1,0.36,1)',
        transition: 'background-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
      }}
    >
      {attention ? (
        <Tooltip title="A session here needs your attention" placement="bottom">
          <WarningRoundedIcon
            aria-label={`${label} needs your attention`}
            sx={{
              fontSize: 17,
              flexShrink: 0,
              // Design amber + a soft glow so it reads as a live alert.
              color: ATTENTION_AMBER,
              filter: `drop-shadow(0 0 5px ${ATTENTION_AMBER}aa)`,
            }}
          />
        </Tooltip>
      ) : (
        <Box
          // Always show the project-accent dot (never grey); it glows when the
          // tab is active, and sits flat but colorful otherwise.
          sx={statusDot(active ? 'active' : 'idle', dotColor(id, accent), theme)}
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
  // The dashboard tab id is the workspace's empty-state fallback leaf, not a
  // user-facing tab — never render it in the strip.
  const visibleTabs = tabs.filter((t) => t.id !== DASHBOARD_TAB_ID);
  const ids = visibleTabs.map((t) => t.id);
  const [ctxMenu, setCtxMenu] = useState<{ id: TabId; x: number; y: number } | null>(null);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        minHeight: 44,
        // Floating frosted pill bar — sized to its content and centered at the
        // top of the Instances content (alignSelf stops the flex-column stretch).
        ...glassFloating(theme, { radius: 14, elevation: 1 }),
        alignSelf: 'center',
        maxWidth: 'calc(100% - 16px)',
        mt: '8px',
        mb: '4px',
        px: 0.75,
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
      <Tooltip title="New instance" placement="bottom">
        <IconButton
          onClick={onNew}
          size="small"
          sx={{ ml: 0.25, color: 'text.secondary', ':hover': { color: 'primary.main' } }}
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
