import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import AdjustIcon from '@mui/icons-material/Adjust';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import type {
  EpicViewPayload,
  TaskViewPayload,
} from '../../../../shared/ipcContract.js';
import { useEpicsAndTasks } from '../../state/useEpicsAndTasks.js';
import { EpicDrawer } from './EpicDrawer.js';
import { TaskDrawer } from './TaskDrawer.js';

const PAGE_SIZE = 20;

interface Props {
  projectId: number;
}

function fmtMinutes(minutes: number): string {
  if (minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const STATUS_COPY: Record<'planned' | 'active' | 'done', string> = {
  planned: 'planned',
  active: 'active',
  done: 'done',
};

const TASK_STATUS_COPY: Record<'open' | 'in_progress' | 'done', string> = {
  open: 'to do',
  in_progress: 'doing',
  done: 'done',
};

const STATUS_COLOR: Record<
  'planned' | 'active' | 'done',
  'default' | 'primary' | 'success' | 'warning'
> = {
  planned: 'default',
  active: 'primary',
  done: 'success',
};

export function EpicsTreeView({ projectId }: Props) {
  const state = useEpicsAndTasks(projectId);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState<string>('');
  // Per-epic pagination — reset to page 0 when the search filter changes so
  // the user never lands on an out-of-range page.
  const [pageByEpic, setPageByEpic] = useState<Map<number, number>>(new Map());
  const [epicDrawerOpen, setEpicDrawerOpen] = useState(false);
  const [editingEpic, setEditingEpic] = useState<EpicViewPayload | null>(null);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskViewPayload | null>(null);
  const [taskDrawerDefaultEpic, setTaskDrawerDefaultEpic] = useState<number | null>(null);

  // Pre-compute the filtered task list per epic so the row count + paging
  // controls don't re-filter on every render.
  const filteredTasksByEpic = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = new Map<number, TaskViewPayload[]>();
    for (const [epicId, tasks] of state.tasksByEpic) {
      const filtered = q
        ? tasks.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              t.number.toLowerCase().includes(q),
          )
        : tasks;
      result.set(epicId, filtered);
    }
    return result;
  }, [state.tasksByEpic, search]);

  // When the search query changes, snap every epic's page back to 0 to keep
  // the visible window in sync with the new (smaller) result set.
  const setSearchAndResetPages = (next: string) => {
    setSearch(next);
    setPageByEpic(new Map());
  };

  const setEpicPage = (epicId: number, page: number) => {
    setPageByEpic((prev) => {
      const next = new Map(prev);
      next.set(epicId, page);
      return next;
    });
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
    setEditingTask(null);
    setTaskDrawerDefaultEpic(epicId);
    setTaskDrawerOpen(true);
  };

  const openEditTask = (task: TaskViewPayload) => {
    setEditingTask(task);
    setTaskDrawerDefaultEpic(task.epicId);
    setTaskDrawerOpen(true);
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}
      >
        <TextField
          size="small"
          placeholder="Search tasks (title or number)…"
          value={search}
          onChange={(e) => setSearchAndResetPages(e.target.value)}
          sx={{ minWidth: 260 }}
        />
        <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }}>
          {state.epics.length} {state.epics.length === 1 ? 'epic' : 'epics'}
          {search.trim() && totalFilteredTaskCount(filteredTasksByEpic) > 0
            ? ` · ${totalFilteredTaskCount(filteredTasksByEpic)} matching ${
                totalFilteredTaskCount(filteredTasksByEpic) === 1 ? 'task' : 'tasks'
              }`
            : ''}
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

      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
        {state.error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {state.error}
          </Alert>
        )}

        {!state.loading && state.epics.length === 0 && (
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

        <Stack spacing={1}>
          {state.epics.map((epic) => (
            <EpicCard
              key={epic.id}
              epic={epic}
              tasks={filteredTasksByEpic.get(epic.id) ?? []}
              totalUnfiltered={state.tasksByEpic.get(epic.id)?.length ?? 0}
              searchActive={search.trim().length > 0}
              page={pageByEpic.get(epic.id) ?? 0}
              onPageChange={(p) => setEpicPage(epic.id, p)}
              expanded={expanded.has(epic.id)}
              onToggle={() => toggleExpand(epic.id)}
              onEdit={() => openEditEpic(epic)}
              onAddTask={() => openCreateTask(epic.id)}
              onEditTask={openEditTask}
            />
          ))}
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
        open={taskDrawerOpen}
        task={editingTask}
        defaultEpicId={taskDrawerDefaultEpic ?? state.epics[0]?.id ?? 0}
        epics={state.epics}
        onClose={() => setTaskDrawerOpen(false)}
        onSubmit={async (input) => {
          if (editingTask) {
            await state.updateTask(editingTask.id, input);
          } else {
            await state.createTask(input);
          }
        }}
        onDelete={
          editingTask
            ? async () => {
                await state.deleteTask(editingTask.id);
              }
            : undefined
        }
      />
    </Box>
  );
}

function EpicCard({
  epic,
  tasks,
  totalUnfiltered,
  searchActive,
  page,
  onPageChange,
  expanded,
  onToggle,
  onEdit,
  onAddTask,
  onEditTask,
}: {
  epic: EpicViewPayload;
  tasks: TaskViewPayload[];
  /** All tasks in this epic before search narrowing — used in the header counter. */
  totalUnfiltered: number;
  /** True when a non-empty search query is filtering the list. */
  searchActive: boolean;
  page: number;
  onPageChange(page: number): void;
  expanded: boolean;
  onToggle(): void;
  onEdit(): void;
  onAddTask(): void;
  onEditTask(task: TaskViewPayload): void;
}) {
  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const sliceStart = safePage * PAGE_SIZE;
  const sliceEnd = Math.min(sliceStart + PAGE_SIZE, tasks.length);
  const visibleTasks = tasks.slice(sliceStart, sliceEnd);
  const showPaging = tasks.length > PAGE_SIZE;

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        backgroundColor: 'background.paper',
      }}
    >
      <Box
        onClick={onToggle}
        sx={{
          display: 'grid',
          gridTemplateColumns: '20px minmax(0, 1fr) auto auto auto auto',
          gap: 2,
          alignItems: 'center',
          px: 1.5,
          py: 1.25,
          cursor: 'pointer',
          ':hover': { backgroundColor: 'action.hover' },
        }}
      >
        {expanded ? (
          <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        ) : (
          <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
            {epic.name}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {searchActive && tasks.length !== totalUnfiltered
              ? `${tasks.length} of ${totalUnfiltered} ${totalUnfiltered === 1 ? 'task' : 'tasks'} match`
              : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
            {epic.totalMinutes > 0 ? ` · ${fmtMinutes(epic.totalMinutes)} logged` : ''}
          </Typography>
        </Box>
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
            minWidth: 70,
            textAlign: 'right',
          }}
        >
          {fmtMinutes(epic.totalMinutes)}
        </Typography>
        {epic.jiraEpicKey ? (
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', fontFamily: 'Menlo, monospace', fontSize: 11 }}
          >
            {epic.jiraEpicKey}
          </Typography>
        ) : (
          <Box />
        )}
        <Chip
          label={STATUS_COPY[epic.status]}
          size="small"
          variant="outlined"
          color={STATUS_COLOR[epic.status]}
          sx={{ height: 20, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}
        />
        <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
          <Tooltip title="Add task">
            <IconButton size="small" onClick={onAddTask}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Edit epic">
            <IconButton size="small" onClick={onEdit}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {expanded && (
        <Box sx={{ borderTop: 1, borderColor: 'divider', backgroundColor: 'action.hover' }}>
          {tasks.length === 0 ? (
            <Box sx={{ py: 1.5, textAlign: 'center' }}>
              {searchActive && totalUnfiltered > 0 ? (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  No tasks in this epic match your search.
                </Typography>
              ) : (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={onAddTask}
                >
                  Add task to this epic
                </Button>
              )}
            </Box>
          ) : (
            <>
              <Stack divider={<Box sx={{ height: 1, backgroundColor: 'divider' }} />}>
                {visibleTasks.map((task) => (
                  <TaskRow key={task.id} task={task} onEdit={() => onEditTask(task)} />
                ))}
              </Stack>
              {showPaging && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1,
                    py: 0.75,
                    borderTop: 1,
                    borderColor: 'divider',
                  }}
                >
                  <IconButton
                    size="small"
                    disabled={safePage === 0}
                    onClick={() => onPageChange(safePage - 1)}
                    aria-label="Previous page"
                  >
                    <ChevronLeftIcon fontSize="small" />
                  </IconButton>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {sliceStart + 1}–{sliceEnd} of {tasks.length}
                  </Typography>
                  <IconButton
                    size="small"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => onPageChange(safePage + 1)}
                    aria-label="Next page"
                  >
                    <ChevronRightIcon fontSize="small" />
                  </IconButton>
                </Box>
              )}
              <Box sx={{ py: 1, textAlign: 'center', borderTop: 1, borderColor: 'divider' }}>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={onAddTask}
                >
                  Add task
                </Button>
              </Box>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

function totalFilteredTaskCount(
  filteredTasksByEpic: Map<number, TaskViewPayload[]>,
): number {
  let count = 0;
  for (const tasks of filteredTasksByEpic.values()) count += tasks.length;
  return count;
}

function TaskRow({ task, onEdit }: { task: TaskViewPayload; onEdit(): void }) {
  const StatusIcon =
    task.status === 'done'
      ? TaskAltIcon
      : task.status === 'in_progress'
        ? AdjustIcon
        : RadioButtonUncheckedIcon;
  const statusColor =
    task.status === 'done'
      ? 'success.main'
      : task.status === 'in_progress'
        ? 'primary.main'
        : 'text.disabled';
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '16px minmax(0, 1fr) 110px 70px 80px auto',
        gap: 1.5,
        alignItems: 'center',
        px: 4,
        py: 1,
      }}
    >
      <StatusIcon fontSize="small" sx={{ color: statusColor, fontSize: 14 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {task.title}
        </Typography>
      </Box>
      <Typography
        variant="caption"
        sx={{ color: 'text.secondary', fontFamily: 'Menlo, monospace', fontSize: 11 }}
      >
        {task.number}
      </Typography>
      <Typography
        variant="caption"
        sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}
      >
        {fmtMinutes(task.totalMinutes)}
      </Typography>
      <Chip
        label={TASK_STATUS_COPY[task.status]}
        size="small"
        variant="outlined"
        sx={{ height: 18, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}
      />
      <IconButton size="small" onClick={onEdit}>
        <EditIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
