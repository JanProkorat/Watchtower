import { useMemo, useState, type CSSProperties } from 'react';
import { Box, Divider, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { InstanceView } from '../state/useInstances.js';
import type { TabId, TabRecord } from '../../../shared/layout.js';
import { DASHBOARD_TAB_ID } from '../../../shared/layout.js';

const INSTANCE_PALETTE = [
  '#7aa7ff',
  '#f0a868',
  '#66bb6a',
  '#ce93d8',
  '#4dd0e1',
  '#ffd54f',
  '#a1887f',
  '#90caf9',
  '#ef9a9a',
  '#80cbc4',
];

function paletteColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return INSTANCE_PALETTE[Math.abs(hash) % INSTANCE_PALETTE.length] ?? '#7aa7ff';
}

const ATTENTION_COLORS: Record<string, string> = {
  'waiting-permission': '#ef5350',
  'waiting-input': '#ffb74d',
  'idle-notify': '#9e9e9e',
  crashed: '#ef5350',
  finished: '#66bb6a',
  suspended: '#5a6068',
};

function dotColor(id: string, status: string, accent: string | undefined): string {
  return ATTENTION_COLORS[status] ?? accent ?? paletteColor(id);
}

interface TabButtonProps {
  id: string;
  label: string;
  status: string; // 'dashboard' for the pinned tab
  active: boolean;
  draggable: boolean;
  accent?: string;
  mounted?: boolean;
  dragRef?: (node: HTMLElement | null) => void;
  dragListeners?: React.HTMLAttributes<HTMLElement>;
  dragStyle?: CSSProperties;
  onClick(): void;
  onClose?(): void;
}

function TabButton({
  id,
  label,
  status,
  active,
  draggable,
  accent,
  mounted,
  dragRef,
  dragListeners,
  dragStyle,
  onClick,
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
      {status !== 'dashboard' && (
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: dotColor(id, status, accent),
            flexShrink: 0,
          }}
        />
      )}
      <span>{label}</span>
      {onClose && (
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
          <CloseIcon sx={{ fontSize: 14 }} />
        </Box>
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
  instances: InstanceView[];
  mountedTabIds: Set<string>;
  focusedTabId: TabId | null;
  onSelect(id: TabId): void;
  onContextSplit(id: TabId, dir: 'row' | 'col'): void;
  onCloseInWorkspace(id: TabId): void;
  onNew(): void;
}

const ATTENTION_RANK: Record<string, number> = {
  'waiting-permission': 4,
  crashed: 4,
  'waiting-input': 3,
  'idle-notify': 2,
  // everything else: 0
};

function worstStatusInTab(tab: TabRecord, instances: InstanceView[]): string {
  if (tab.kind === 'dashboard') return 'dashboard';
  let pick: string | null = null;
  let pickRank = -1;
  for (const id of tab.columnOrder) {
    const inst = instances.find((i) => i.id === id);
    if (!inst) continue;
    const rank = ATTENTION_RANK[inst.status] ?? 0;
    if (rank > pickRank) {
      pick = inst.status;
      pickRank = rank;
    }
  }
  return pick ?? 'working';
}

export function TabStrip({
  tabs,
  instances,
  mountedTabIds,
  focusedTabId,
  onSelect,
  onContextSplit,
  onCloseInWorkspace,
  onNew,
}: Props) {
  const ids = tabs.map((t) => t.id);
  const [ctxMenu, setCtxMenu] = useState<{ id: TabId; x: number; y: number } | null>(null);

  const aggregateStatus = useMemo(() => {
    const map = new Map<TabId, string>();
    for (const t of tabs) map.set(t.id, worstStatusInTab(t, instances));
    return map;
  }, [tabs, instances]);

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
                status={aggregateStatus.get(t.id) ?? 'working'}
                accent={t.color ?? undefined}
                mounted={mountedTabIds.has(t.id)}
                active={focusedTabId === t.id}
                onClick={() => onSelect(t.id)}
                onClose={
                  t.id === DASHBOARD_TAB_ID ? undefined : () => onCloseInWorkspace(t.id)
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
        <Divider />
        <MenuItem
          onClick={() => {
            if (ctxMenu) onContextSplit(ctxMenu.id, 'row');
            setCtxMenu(null);
          }}
        >
          Split right
        </MenuItem>
        <MenuItem
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
