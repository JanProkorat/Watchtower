import type React from 'react';
import { useState } from 'react';
import { useTheme } from '@mui/material/styles';
import { glassSurface } from '../../theme/glass.js';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type {
  EpicViewPayload,
  TaskViewPayload,
} from '@watchtower/shared/ipcContract.js';
import { buildTaskUrl, formatMinutes, formatMinutesReadable } from '../../util/format.js';
import { useEpicsAndTasks } from '../../state/useEpicsAndTasks.js';
import { EpicDrawer } from './EpicDrawer.js';
import { TaskDrawer } from './TaskDrawer.js';
import { TaskDetailDrawer } from './TaskDetailDrawer.js';

const PAGE_SIZE = 20;

type StatusFilter = 'all' | 'open' | 'in_progress' | 'to_accept' | 'done';

interface Props {
  projectId: number;
  /**
   * Embed mode: skip the standalone toolbar (the surrounding pane provides
   * its own framing). The "+ Add epic" affordance still renders, just
   * inline above the list.
   */
  embedded?: boolean;
  /** Project name shown in the Task detail breadcrumb. */
  projectName?: string;
  /** Project colour used as the breadcrumb dot + accent gradient. */
  projectColor?: string;
  /**
   * Per-project URL template (e.g. https://.../browse/{n}). When present,
   * each task number gets an open-in-new icon that opens the resolved URL.
   */
  taskUrlTemplate?: string | null;
  /** Open external URL in the system browser. */
  onOpenExternal?(url: string): void;
}

export function EpicsTreeView({
  projectId,
  embedded = false,
  projectName = '',
  projectColor = '#7C5CFF',
  taskUrlTemplate = null,
  onOpenExternal,
}: Props) {
  const state = useEpicsAndTasks(projectId);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [searchByEpic, setSearchByEpic] = useState<Map<number, string>>(new Map());
  const [statusByEpic, setStatusByEpic] = useState<Map<number, StatusFilter>>(new Map());
  const [pageByEpic, setPageByEpic] = useState<Map<number, number>>(new Map());
  const [epicDrawerOpen, setEpicDrawerOpen] = useState(false);
  const [editingEpic, setEditingEpic] = useState<EpicViewPayload | null>(null);
  /** Create-task form drawer (used by the "+ Add task" affordance). */
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [taskCreateDefaultEpic, setTaskCreateDefaultEpic] = useState<number | null>(null);
  /** Task detail + worklog drawer (used by row clicks). */
  const [detailTask, setDetailTask] = useState<TaskViewPayload | null>(null);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setEpicSearch = (epicId: number, q: string) => {
    setSearchByEpic((prev) => {
      const next = new Map(prev);
      next.set(epicId, q);
      return next;
    });
    setPageByEpic((prev) => {
      const next = new Map(prev);
      next.set(epicId, 0);
      return next;
    });
  };

  const setEpicStatus = (epicId: number, s: StatusFilter) => {
    setStatusByEpic((prev) => {
      const next = new Map(prev);
      next.set(epicId, s);
      return next;
    });
    setPageByEpic((prev) => {
      const next = new Map(prev);
      next.set(epicId, 0);
      return next;
    });
  };

  const setEpicPage = (epicId: number, page: number) => {
    setPageByEpic((prev) => {
      const next = new Map(prev);
      next.set(epicId, page);
      return next;
    });
  };

  const openCreateEpic = () => {
    setEditingEpic(null);
    setEpicDrawerOpen(true);
  };

  const openEditEpic = (epic: EpicViewPayload) => {
    setEditingEpic(epic);
    setEpicDrawerOpen(true);
  };

  const openCreateTask = (epicId: number) => {
    setTaskCreateDefaultEpic(epicId);
    setTaskCreateOpen(true);
  };

  const openTaskDetail = (task: TaskViewPayload) => {
    setDetailTask(task);
  };

  const detailEpicName =
    detailTask !== null
      ? (state.epics.find((e) => e.id === detailTask.epicId)?.name ?? '')
      : '';

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {!embedded && (
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }}>
            {state.epics.length} {state.epics.length === 1 ? 'epic' : 'epics'}
          </Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={openCreateEpic}
          >
            New epic
          </Button>
        </Stack>
      )}

      <Box
        sx={{
          flex: 1,
          overflow: embedded ? 'visible' : 'auto',
          px: embedded ? 0 : 2,
          py: embedded ? 0 : 1.5,
        }}
      >
        {state.error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {state.error}
          </Alert>
        )}

        {embedded && (
          <Button
            size="small"
            startIcon={<AddIcon fontSize="small" />}
            onClick={openCreateEpic}
            sx={{ textTransform: 'none', mb: 1.5 }}
          >
            Add epic
          </Button>
        )}

        {!state.loading && state.epics.length === 0 && !embedded && (
          <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 6 }}>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              No epics yet.
            </Typography>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={openCreateEpic}
            >
              Create your first epic
            </Button>
          </Box>
        )}

        <Stack spacing={1.25}>
          {state.epics.map((epic) => {
            const allTasks = state.tasksByEpic.get(epic.id) ?? [];
            const search = (searchByEpic.get(epic.id) ?? '').trim().toLowerCase();
            const status = statusByEpic.get(epic.id) ?? 'all';
            const filtered = allTasks.filter((t) => {
              if (status !== 'all' && t.status !== status) return false;
              if (
                search &&
                !t.title.toLowerCase().includes(search) &&
                !t.number.toLowerCase().includes(search)
              ) {
                return false;
              }
              return true;
            });
            return (
              <EpicCard
                key={epic.id}
                epic={epic}
                tasks={filtered}
                totalCount={allTasks.length}
                search={searchByEpic.get(epic.id) ?? ''}
                status={status}
                page={pageByEpic.get(epic.id) ?? 0}
                onSearchChange={(q) => setEpicSearch(epic.id, q)}
                onStatusChange={(s) => setEpicStatus(epic.id, s)}
                onPageChange={(p) => setEpicPage(epic.id, p)}
                expanded={expanded.has(epic.id)}
                onToggle={() => toggleExpand(epic.id)}
                onEditEpic={() => openEditEpic(epic)}
                onDeleteEpic={() => state.deleteEpic(epic.id)}
                onEditTask={openTaskDetail}
                onDeleteTask={(t) => state.deleteTask(t.id)}
                onAddTask={() => openCreateTask(epic.id)}
                taskUrlTemplate={taskUrlTemplate}
                onOpenExternal={onOpenExternal}
              />
            );
          })}
        </Stack>
      </Box>

      <EpicDrawer
        open={epicDrawerOpen}
        epic={editingEpic}
        projectId={projectId}
        onClose={() => setEpicDrawerOpen(false)}
        onSubmit={async (input) => {
          if (editingEpic) {
            await state.updateEpic(editingEpic.id, input);
          } else {
            const { projectId: _ignored, ...rest } = input;
            await state.createEpic(rest);
          }
        }}
        onDelete={
          editingEpic
            ? async () => {
                await state.deleteEpic(editingEpic.id);
              }
            : undefined
        }
      />

      <TaskDrawer
        open={taskCreateOpen}
        task={null}
        defaultEpicId={taskCreateDefaultEpic ?? state.epics[0]?.id ?? 0}
        epics={state.epics}
        onClose={() => setTaskCreateOpen(false)}
        onSubmit={async (input) => {
          await state.createTask(input);
        }}
      />

      <TaskDetailDrawer
        open={detailTask !== null}
        task={detailTask}
        projectName={projectName}
        projectColor={projectColor}
        epicName={detailEpicName}
        taskUrlTemplate={taskUrlTemplate}
        onClose={() => setDetailTask(null)}
        onUpdate={async (input) => {
          if (!detailTask) return;
          const fresh = await state.updateTask(detailTask.id, input);
          setDetailTask(fresh);
        }}
        onDelete={async () => {
          if (!detailTask) return;
          await state.deleteTask(detailTask.id);
          setDetailTask(null);
        }}
        onOpenExternal={onOpenExternal}
      />
    </Box>
  );
}

interface EpicCardProps {
  epic: EpicViewPayload;
  tasks: TaskViewPayload[];
  totalCount: number;
  search: string;
  status: StatusFilter;
  page: number;
  onSearchChange(q: string): void;
  onStatusChange(s: StatusFilter): void;
  onPageChange(page: number): void;
  expanded: boolean;
  onToggle(): void;
  onEditEpic(): void;
  onDeleteEpic(): Promise<void> | void;
  onEditTask(task: TaskViewPayload): void;
  onDeleteTask(task: TaskViewPayload): Promise<void> | void;
  onAddTask(): void;
  taskUrlTemplate?: string | null;
  onOpenExternal?(url: string): void;
}

const GRID_COLS = '180px 1fr 110px 110px 48px';

function EpicCard({
  epic,
  tasks,
  totalCount,
  search,
  status,
  page,
  onSearchChange,
  onStatusChange,
  onPageChange,
  expanded,
  onToggle,
  onDeleteEpic,
  onEditTask,
  onDeleteTask,
  onAddTask,
  taskUrlTemplate,
  onOpenExternal,
}: EpicCardProps) {
  const theme = useTheme();
  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const sliceStart = safePage * PAGE_SIZE;
  const sliceEnd = Math.min(sliceStart + PAGE_SIZE, tasks.length);
  const visibleTasks = tasks.slice(sliceStart, sliceEnd);
  const showPaging = tasks.length > PAGE_SIZE;
  const filterActive = search.trim().length > 0 || status !== 'all';

  const handleDeleteEpic = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `Delete epic "${epic.name}"? This also removes its ${epic.taskCount} task${
          epic.taskCount === 1 ? '' : 's'
        } and their worklogs. This cannot be undone.`,
      )
    ) {
      return;
    }
    void onDeleteEpic();
  };

  return (
    <Box
      sx={{
        ...glassSurface(theme, { elevation: 1 }),
        borderRadius: 1.5,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        onClick={onToggle}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 2.25,
          py: 1.5,
          cursor: 'pointer',
          borderBottom: expanded ? 1 : 0,
          borderColor: 'divider',
          ':hover': { backgroundColor: 'action.hover' },
        }}
      >
        <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'text.primary' }}>
          {epic.name}
        </Typography>
        <Chip
          label={`${totalCount} ${totalCount === 1 ? 'task' : 'tasks'}`}
          size="small"
          sx={{
            height: 22,
            fontSize: 11.5,
            fontWeight: 500,
            bgcolor: 'action.hover',
            color: 'text.secondary',
            border: 0,
            borderRadius: 999,
          }}
        />
        <Chip
          label={formatMinutesReadable(epic.totalMinutes)}
          size="small"
          sx={{
            height: 22,
            fontSize: 11.5,
            fontWeight: 600,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            border: 0,
            borderRadius: 999,
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Add task">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onAddTask();
            }}
            sx={{
              color: 'text.disabled',
              '&:hover': { color: 'primary.main', backgroundColor: 'action.hover' },
            }}
            aria-label="Add task"
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete epic">
          <IconButton
            size="small"
            onClick={handleDeleteEpic}
            sx={{
              color: 'text.disabled',
              '&:hover': { color: 'error.main', backgroundColor: 'action.hover' },
            }}
            aria-label="Delete epic"
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton
          size="small"
          sx={{ color: 'text.secondary' }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>

      {expanded && (
        <>
          {/* Filter row */}
          <Box
            sx={{
              display: 'flex',
              gap: 1.5,
              px: 2.25,
              py: 1.75,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <TextField
              size="small"
              placeholder="Search number or title"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              select
              label="Status"
              size="small"
              value={status}
              onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
              sx={{ width: 180 }}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="open">Open</MenuItem>
              <MenuItem value="in_progress">In progress</MenuItem>
              <MenuItem value="to_accept">To accept</MenuItem>
              <MenuItem value="done">Done</MenuItem>
            </TextField>
          </Box>

          {tasks.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: filterActive ? 0 : 1.5 }}>
                {filterActive ? 'No tasks match the filters.' : 'No tasks in this epic yet.'}
              </Typography>
              {!filterActive && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={onAddTask}
                >
                  Add task
                </Button>
              )}
            </Box>
          ) : (
            <>
              {/* Column headers */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: GRID_COLS,
                  borderBottom: 1,
                  borderColor: 'divider',
                }}
              >
                <HeaderCell label="Number" />
                <HeaderCell label="Title" />
                <HeaderCell label="Status" />
                <HeaderCell label="Logged" />
                <Box />
              </Box>
              {/* Task rows */}
              {visibleTasks.map((task, idx) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isLast={idx === visibleTasks.length - 1}
                  taskUrlTemplate={taskUrlTemplate}
                  onEdit={() => onEditTask(task)}
                  onDelete={() => onDeleteTask(task)}
                  onOpenExternal={onOpenExternal}
                />
              ))}
              {/* Footer: pagination only */}
              {showPaging && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 3,
                    px: 2.25,
                    py: 1,
                    borderTop: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={3}
                    alignItems="center"
                    sx={{ color: 'text.secondary', fontSize: 12.5 }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <span>Rows per page:</span>
                      <Box component="span" sx={{ fontWeight: 500, color: 'text.primary' }}>
                        {PAGE_SIZE}
                      </Box>
                    </Box>
                    <Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {sliceStart + 1}–{sliceEnd} of {tasks.length}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.25 }}>
                      <IconButton
                        size="small"
                        disabled={safePage === 0}
                        onClick={() => onPageChange(safePage - 1)}
                        aria-label="Previous page"
                      >
                        <ChevronLeftIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        disabled={safePage >= totalPages - 1}
                        onClick={() => onPageChange(safePage + 1)}
                        aria-label="Next page"
                      >
                        <ChevronRightIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Stack>
                </Box>
              )}
            </>
          )}
        </>
      )}
    </Box>
  );
}

function HeaderCell({ label }: { label: string }) {
  return (
    <Box
      sx={{
        px: 2.25,
        py: 1.5,
        fontSize: 11,
        fontWeight: 600,
        color: 'text.secondary',
        letterSpacing: 0,
      }}
    >
      {label}
    </Box>
  );
}

function TaskRow({
  task,
  isLast,
  taskUrlTemplate,
  onEdit,
  onDelete,
  onOpenExternal,
}: {
  task: TaskViewPayload;
  isLast: boolean;
  taskUrlTemplate?: string | null;
  onEdit(): void;
  onDelete(): Promise<void> | void;
  onOpenExternal?(url: string): void;
}) {
  const externalUrl = buildTaskUrl(taskUrlTemplate, task.number);
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `Delete task ${task.number} "${task.title}"? Its worklogs are also removed. This cannot be undone.`,
      )
    ) {
      return;
    }
    void onDelete();
  };
  const handleOpenExternal = (e: React.MouseEvent) => {
    if (!externalUrl) return;
    e.stopPropagation();
    e.preventDefault();
    if (onOpenExternal) onOpenExternal(externalUrl);
    else void window.watchtower.invoke('openExternalUrl', { url: externalUrl });
  };

  return (
    <Box
      onClick={onEdit}
      sx={{
        display: 'grid',
        gridTemplateColumns: GRID_COLS,
        alignItems: 'center',
        cursor: 'pointer',
        borderBottom: isLast ? 0 : 1,
        borderColor: 'divider',
        ':hover': { backgroundColor: 'action.hover' },
      }}
    >
      <Box sx={{ px: 2.25, py: 1.5 }}>
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            color: 'primary.main',
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {task.number}
          {externalUrl && (
            <Tooltip title={externalUrl}>
              <IconButton
                size="small"
                component="a"
                href={externalUrl}
                onClick={handleOpenExternal}
                aria-label="Open task in tracker"
                sx={{ p: 0.25, color: 'primary.main' }}
              >
                <OpenInNewIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>
      <Box
        sx={{
          px: 2.25,
          py: 1.5,
          fontSize: 13,
          color: 'text.primary',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {task.title}
      </Box>
      <Box sx={{ px: 2.25, py: 1.5 }}>
        <StatusChip status={task.status} />
      </Box>
      <Box
        sx={{
          px: 2.25,
          py: 1.5,
          fontSize: 13,
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontVariantNumeric: 'tabular-nums',
          color: 'text.primary',
        }}
      >
        {task.totalMinutes > 0 ? formatMinutes(task.totalMinutes) : '—'}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'center', px: 0.75 }}>
        <Tooltip title="Delete task">
          <IconButton
            size="small"
            onClick={handleDelete}
            sx={{ color: 'primary.main' }}
            aria-label="Delete task"
          >
            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function StatusChip({ status }: { status: 'open' | 'in_progress' | 'to_accept' | 'done' }) {
  const COMMON = {
    height: 22,
    fontSize: 11.5,
    border: 0,
    borderRadius: 999,
  } as const;
  if (status === 'done') {
    return (
      <Chip
        label="Done"
        size="small"
        sx={{
          ...COMMON,
          fontWeight: 600,
          bgcolor: 'success.main',
          color: 'success.contrastText',
        }}
      />
    );
  }
  if (status === 'to_accept') {
    return (
      <Chip
        label="To accept"
        size="small"
        sx={{
          ...COMMON,
          fontWeight: 500,
          bgcolor: 'warning.light',
          color: 'warning.contrastText',
        }}
      />
    );
  }
  if (status === 'in_progress') {
    return (
      <Chip
        label="In progress"
        size="small"
        sx={{
          ...COMMON,
          fontWeight: 500,
          bgcolor: 'action.selected',
          color: 'primary.main',
        }}
      />
    );
  }
  return (
    <Chip
      label="Open"
      size="small"
      sx={{
        ...COMMON,
        fontWeight: 500,
        bgcolor: 'action.hover',
        color: 'text.secondary',
      }}
    />
  );
}
