import { useState, type CSSProperties } from 'react';
import { Box, Divider, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TabId, TabRecord } from '../../../shared/layout.js';
import { DASHBOARD_TAB_ID } from '../../../shared/layout.js';
import { tabAccent } from '../util/tabAccent.js';

// Outer tab dot is locked to the project's accent color (or a hash-based
// palette pick for ad-hoc cwd tabs). Per-session attention status is
// surfaced inside the leaf via SessionTabBar's per-tab notification dot.
function dotColor(id: string, accent: string | undefined): string {
  return tabAccent(id, accent);
}

interface TabButtonProps {
  id: string;
  label: string;
  isDashboard: boolean;
  active: boolean;
  draggable: boolean;
  accent?: string;
  mounted?: boolean;
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
  isDashboard,
  active,
  draggable,
  accent,
  mounted,
  dragRef,
  dragListeners,
  dragStyle,
  onClick,
  onHide,
  onClose,
}: TabButtonProps) {
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
        gap: 1,
        minHeight: 40,
        px: 1.5,
        cursor: draggable ? 'grab' : 'pointer',
        userSelect: 'none',
        color: active ? 'text.primary' : 'text.secondary',
        backgroundColor: active ? 'background.default' : 'transparent',
        borderBottom: 2,
        borderBottomColor: active
          ? accent ?? 'primary.main'
          : mounted
          ? accent ?? 'rgba(255,255,255,0.18)'
          : 'transparent',
        ':hover': { backgroundColor: active ? 'background.default' : 'action.hover' },
        ':active': { cursor: draggable ? 'grabbing' : 'pointer' },
        fontSize: 13,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {!isDashboard && (
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: dotColor(id, accent),
            flexShrink: 0,
          }}
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
  const ids = tabs.map((t) => t.id);
  const [ctxMenu, setCtxMenu] = useState<{ id: TabId; x: number; y: number } | null>(null);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'stretch',
        borderBottom: 1,
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        flexShrink: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {/* No DndContext here — App provides one so a tab drag can also drop on workspace leaves. */}
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
          {tabs.map((t) => (
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
                isDashboard={t.id === DASHBOARD_TAB_ID}
                accent={t.color ?? undefined}
                mounted={mountedTabIds.has(t.id)}
                active={focusedTabId === t.id}
                onClick={() => onSelect(t.id)}
                onHide={
                  t.id === DASHBOARD_TAB_ID || !mountedTabIds.has(t.id)
                    ? undefined
                    : () => onHideTab(t.id)
                }
                onClose={
                  t.id === DASHBOARD_TAB_ID ? undefined : () => onCloseTab(t.id)
                }
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
