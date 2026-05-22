import { useState, type CSSProperties } from 'react';
import { Box, Divider, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { InstanceView } from '../state/useInstances.js';

const DASHBOARD_TAB = '__dashboard__';
const LIVE_STATUSES = new Set([
  'spawning',
  'working',
  'waiting-permission',
  'waiting-input',
  'idle-notify',
  'resuming',
]);

function basename(p: string): string {
  if (!p) return '';
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

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

function instanceColor(id: string): string {
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

function dotColor(id: string, status: string): string {
  return ATTENTION_COLORS[status] ?? instanceColor(id);
}

interface TabButtonProps {
  id: string;
  label: string;
  status: string; // 'dashboard' for the pinned tab
  active: boolean;
  draggable: boolean;
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
        borderBottomColor: active ? 'primary.main' : 'transparent',
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
            backgroundColor: dotColor(id, status),
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
          // Stop drag listeners + tab click from firing when the user clicks ×.
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

interface SortableTabProps extends Omit<TabButtonProps, 'dragRef' | 'dragListeners' | 'dragStyle' | 'draggable'> {
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
  instances: InstanceView[];
  activeId: string | null;
  onSelect(id: string): void;
  onNew(): void;
  onRemove(id: string, isLive: boolean): void;
  onReorder(orderedIds: string[]): void;
  onSnooze(id: string, durationMs: number): void;
}

export function TabStrip({ instances, activeId, onSelect, onNew, onRemove, onReorder, onSnooze }: Props) {
  // 5px activation distance — clicks (no drag) still toggle the tab, but a
  // 5+ px drag picks the tab up. Otherwise every click would start a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const value = activeId ?? DASHBOARD_TAB;
  const ids = instances.map((i) => i.id);
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  };

  const openContext = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setCtxMenu({ id, x: e.clientX, y: e.clientY });
  };
  const closeContext = () => setCtxMenu(null);

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
      <TabButton
        id={DASHBOARD_TAB}
        label="Dashboard"
        status="dashboard"
        active={value === DASHBOARD_TAB}
        draggable={false}
        onClick={() => onSelect(DASHBOARD_TAB)}
      />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          <Box sx={{ display: 'flex', alignItems: 'stretch' }}>
            {instances.map((i) => (
              <Box key={i.id} onContextMenu={(e) => openContext(e, i.id)}>
                <SortableTab
                  id={i.id}
                  label={basename(i.cwd) || i.cwd}
                  status={i.status}
                  active={value === i.id}
                  onClick={() => onSelect(i.id)}
                  onClose={() => onRemove(i.id, LIVE_STATUSES.has(i.status))}
                />
              </Box>
            ))}
          </Box>
        </SortableContext>
      </DndContext>
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
        onClose={closeContext}
        anchorReference="anchorPosition"
        anchorPosition={ctxMenu ? { left: ctxMenu.x, top: ctxMenu.y } : undefined}
      >
        <MenuItem
          onClick={() => {
            if (ctxMenu) onSelect(ctxMenu.id);
            closeContext();
          }}
        >
          Open
        </MenuItem>
        <Divider />
        {[5, 30, 60].map((m) => (
          <MenuItem
            key={m}
            onClick={() => {
              if (ctxMenu) onSnooze(ctxMenu.id, m * 60_000);
              closeContext();
            }}
          >
            Snooze {m} min
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          onClick={() => {
            if (ctxMenu) {
              const inst = instances.find((i) => i.id === ctxMenu.id);
              const isLive = inst ? LIVE_STATUSES.has(inst.status) : false;
              onRemove(ctxMenu.id, isLive);
            }
            closeContext();
          }}
          sx={{ color: 'error.main' }}
        >
          Close tab
        </MenuItem>
      </Menu>
    </Box>
  );
}

export { DASHBOARD_TAB };
