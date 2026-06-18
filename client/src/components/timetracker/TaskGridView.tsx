import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  MenuItem,
  Popover,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useTheme, alpha, type Theme } from '@mui/material/styles';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import AddIcon from '@mui/icons-material/Add';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import AdjustIcon from '@mui/icons-material/Adjust';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/cs';
import { useToast, toastMessage } from '../../state/useToast.js';
import { formatDateLongCz } from '../../util/format.js';
import { useTaskGrid } from '../../state/useTaskGrid.js';
import { TaskDetailDrawer } from './TaskDetailDrawer.js';
import { WorklogDrawer } from './WorklogDrawer.js';
import { WorklogCellPopover } from './WorklogCellPopover.js';
import { JiraSyncDialog } from './JiraSyncDialog.js';
import type {
  ProjectViewPayload,
  TaskGridTaskPayload,
  TaskViewPayload,
  WorklogViewPayload,
} from '../../../../shared/ipcContract.js';

const WATCHTOWER_DB_PATH =
  '/Users/jan/Library/Application Support/Watchtower/data.db';

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DAY_OFF_LABEL: Record<'vacation' | 'sick' | 'other' | 'holiday', string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  other: 'Day off',
  holiday: 'Public holiday',
};

const KEY_COL_WIDTH = 200;
const DEFAULT_TITLE_COL_WIDTH = 240;
const MIN_TITLE_COL_WIDTH = 120;
const MAX_TITLE_COL_WIDTH = 600;
const LOGGED_COL_WIDTH = 90;
const DAY_COL_WIDTH = 44;
const TOTAL_ROW_HEIGHT = 32;

const TITLE_COL_LEFT = KEY_COL_WIDTH;
const TITLE_COL_WIDTH_STORAGE_KEY = 'watchtower:taskGrid:titleColWidth';
type SortField = 'key' | 'title';
type SortDir = 'asc' | 'desc';
const SORT_FIELD_STORAGE_KEY = 'watchtower:taskGrid:sortField';
const SORT_DIR_STORAGE_KEY = 'watchtower:taskGrid:sortDir';

function throwIfLockedResponse(res: unknown): void {
  if (
    res &&
    typeof res === 'object' &&
    (res as { error?: unknown }).error === 'locked'
  ) {
    throw new Error((res as { message: string }).message);
  }
}

function fmtHoursTrim(minutes: number): string {
  if (minutes <= 0) return '';
  const h = minutes / 60;
  if (Number.isInteger(h)) return String(h);
  // Show up to two decimals, trim trailing zeros.
  return h.toFixed(2).replace(/\.?0+$/, '');
}

function formatAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString('cs-CZ')} ${currency}`;
}

interface Props {
  /** When set, the grid is scoped to one project and the filter is hidden. */
  projectId?: number;
}

export function TaskGridView({ projectId }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-based
  const [projectFilter, setProjectFilter] = useState<number | null>(projectId ?? null);
  const [projects, setProjects] = useState<ProjectViewPayload[]>([]);
  /**
   * Which value the grid displays in every cell + total. Reported is the
   * billing default (what gets sent to invoices); Tracked shows the actual
   * time spent. Earnings always use reported regardless of this toggle —
   * the billing value is the source of truth there.
   */
  const [displayMode, setDisplayMode] = useState<'tracked' | 'reported'>('reported');
  const [hideDone, setHideDone] = useState(false);
  /** Case-insensitive substring filter on `taskNumber`. Empty = match all. */
  const [taskNumberFilter, setTaskNumberFilter] = useState('');
  // Sort + Title-column width persist across reloads — initialised lazily from
  // localStorage so the toolbar starts in the user's last-used configuration.
  const [sortField, setSortField] = useState<SortField>(() => {
    const raw = readLocalStorage(SORT_FIELD_STORAGE_KEY);
    return raw === 'title' ? 'title' : 'key';
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const raw = readLocalStorage(SORT_DIR_STORAGE_KEY);
    return raw === 'desc' ? 'desc' : 'asc';
  });
  const [titleColWidth, setTitleColWidth] = useState<number>(() => {
    const raw = readLocalStorage(TITLE_COL_WIDTH_STORAGE_KEY);
    const v = raw == null ? NaN : Number(raw);
    return Number.isFinite(v) && v >= MIN_TITLE_COL_WIDTH && v <= MAX_TITLE_COL_WIDTH
      ? v
      : DEFAULT_TITLE_COL_WIDTH;
  });
  // Day-column highlight — clicking a date column header toggles a tinted
  // overlay across that column so wide grids stay readable when scanning a
  // specific day. Reset on month change so the highlight doesn't carry over
  // to a day that may not exist (e.g. day 31 jumping to February).
  const [highlightedDay, setHighlightedDay] = useState<number | null>(null);
  useEffect(() => {
    setHighlightedDay(null);
  }, [year, month]);

  const toggleSort = (field: SortField) => {
    if (field === sortField) {
      const next: SortDir = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(next);
      writeLocalStorage(SORT_DIR_STORAGE_KEY, next);
    } else {
      setSortField(field);
      setSortDir('asc');
      writeLocalStorage(SORT_FIELD_STORAGE_KEY, field);
      writeLocalStorage(SORT_DIR_STORAGE_KEY, 'asc');
    }
  };
  const grid = useTaskGrid(
    year,
    month,
    projectId ?? projectFilter ?? undefined,
  );

  // Load projects once on mount. In list mode the first load also snaps the
  // filter to the project marked is_default = 1 so the grid lands on the
  // user's working project instead of the costlier "All projects" scan. In
  // single-project mode the list is still fetched so the Sync-to-Jira dialog
  // can populate its project dropdown.
  const initialProjectSelectionDoneRef = useRef(false);
  useEffect(() => {
    void window.watchtower.invoke('projects:list', { archived: false }).then((r) => {
      setProjects(r.projects);
      if (projectId === undefined && !initialProjectSelectionDoneRef.current) {
        initialProjectSelectionDoneRef.current = true;
        const def = r.projects.find((p) => p.isDefault);
        if (def) setProjectFilter(def.id);
      }
    });
  }, [projectId]);

  // Task detail drawer — same component the project-detail page uses, so the
  // full read+edit+worklog UI shows on a single key click.
  const [taskDetailTask, setTaskDetailTask] = useState<TaskViewPayload | null>(null);
  const [taskDetailContext, setTaskDetailContext] = useState<{
    projectName: string;
    projectColor: string;
    epicName: string;
    taskUrlTemplate: string | null;
  } | null>(null);

  const [jiraSyncOpen, setJiraSyncOpen] = useState(false);

  // Sync-meetings — copies a `/sync-meetings` slash command to the clipboard
  // for the user to paste into their Claude Code chat (where the M365 MCP is
  // already authenticated). The button does NOT spawn `claude -p` itself —
  // that hangs on MCP init in the orchestrator's subprocess in this user's
  // env (see the abandoned attempts in git history). The range defaults to the
  // grid's displayed month.
  const { showError, showSuccess } = useToast();
  const [syncMeetingsAnchor, setSyncMeetingsAnchor] = useState<HTMLElement | null>(null);
  const [syncMeetingsFrom, setSyncMeetingsFrom] = useState<Dayjs | null>(null);
  const [syncMeetingsTo, setSyncMeetingsTo] = useState<Dayjs | null>(null);

  const openSyncMeetings = (anchor: HTMLElement) => {
    const monthStart = dayjs(new Date(year, month - 1, 1)).startOf('day');
    const monthEnd = dayjs(new Date(year, month, 0)).startOf('day');
    const todayStart = dayjs(today).startOf('day');
    // Default: month start → min(today, month end), clamped into the month so
    // a future month still yields a valid same-month range.
    const toDefault = todayStart.isAfter(monthEnd)
      ? monthEnd
      : todayStart.isBefore(monthStart)
        ? monthStart
        : todayStart;
    setSyncMeetingsFrom(monthStart);
    setSyncMeetingsTo(toDefault);
    setSyncMeetingsAnchor(anchor);
  };

  const monthStart = dayjs(new Date(year, month - 1, 1)).startOf('day');
  const monthEnd = dayjs(new Date(year, month, 0)).endOf('day');
  const syncRangeValid =
    !!syncMeetingsFrom &&
    syncMeetingsFrom.isValid() &&
    !!syncMeetingsTo &&
    syncMeetingsTo.isValid() &&
    !syncMeetingsFrom.startOf('day').isAfter(syncMeetingsTo.startOf('day')) &&
    !syncMeetingsFrom.isBefore(monthStart) &&
    !syncMeetingsTo.isAfter(monthEnd);

  const submitSyncMeetings = async () => {
    if (!syncRangeValid || !syncMeetingsFrom || !syncMeetingsTo) return;
    const command =
      `/sync-meetings ${syncMeetingsFrom.format('YYYY-MM-DD')} ${syncMeetingsTo.format('YYYY-MM-DD')} ` +
      `"${WATCHTOWER_DB_PATH}"`;
    try {
      await navigator.clipboard.writeText(command);
      setSyncMeetingsAnchor(null);
      showSuccess('Příkaz zkopírován do schránky. Vložte ho do Claude Code chatu pro spuštění.');
    } catch (err) {
      showError(`Nepodařilo se zkopírovat příkaz: ${toastMessage(err)}`);
    }
  };

  const [worklogDrawerOpen, setWorklogDrawerOpen] = useState(false);
  const [worklogDrawerProjectId, setWorklogDrawerProjectId] = useState<number | null>(null);
  const [worklogDrawerTaskId, setWorklogDrawerTaskId] = useState<number | null>(null);
  const [worklogDrawerWorkDate, setWorklogDrawerWorkDate] = useState<string | null>(null);
  const [worklogDrawerEditing, setWorklogDrawerEditing] = useState<WorklogViewPayload | null>(
    null,
  );

  // Cell-click popover. Always opens for every cell so the user sees what's
  // there even when empty — the popover owns its own list + mutations.
  const [cellPopoverAnchor, setCellPopoverAnchor] = useState<HTMLElement | null>(null);
  const [cellPopoverYmd, setCellPopoverYmd] = useState<string>('');
  const [cellPopoverTaskId, setCellPopoverTaskId] = useState<number | null>(null);
  const [cellPopoverProjectId, setCellPopoverProjectId] = useState<number | null>(null);

  const openTaskDrawer = async (gridTask: TaskGridTaskPayload) => {
    // Fetch the full task row — TaskDetailDrawer needs the TaskViewPayload
    // shape, not the joined grid row. Project name/color/epic name are
    // already on the grid payload so they don't need a round-trip.
    try {
      const tasksRes = await window.watchtower.invoke('tasks:listForEpic', {
        epicId: gridTask.epicId,
      });
      const fullTask = tasksRes.tasks.find((t) => t.id === gridTask.taskId) ?? null;
      if (!fullTask) return;
      setTaskDetailTask(fullTask);
      setTaskDetailContext({
        projectName: gridTask.projectName,
        projectColor: gridTask.projectColor,
        epicName: gridTask.epicName,
        taskUrlTemplate: gridTask.projectTaskUrlTemplate,
      });
    } catch {
      // best-effort — if loading fails, drop silently rather than open an
      // unusable drawer
    }
  };

  const openCellPopover = (taskId: number, day: number, anchor: HTMLElement) => {
    const ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const gridTask = grid.data?.tasks.find((t) => t.taskId === taskId);
    if (!gridTask) return;
    setCellPopoverTaskId(taskId);
    setCellPopoverProjectId(gridTask.projectId);
    setCellPopoverYmd(ymd);
    setCellPopoverAnchor(anchor);
  };

  const closeCellPopover = () => {
    setCellPopoverAnchor(null);
  };

  const stepMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
  };

  // Day metadata for the column headers + tinting. Holidays come from the
  // server response so the client doesn't need its own Easter algorithm.
  const days = useMemo(() => {
    const daysInMonth = grid.data?.daysInMonth ?? new Date(year, month, 0).getDate();
    const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const holidayByYmd = new Map(
      (grid.data?.publicHolidays ?? []).map((h) => [h.date, h.name] as const),
    );
    // User-marked days off (vacation / sick / other). These tint the column the
    // same as a weekend so non-working days read at a glance. A note, if any,
    // is folded into the label shown in tooltips.
    const dayOffByYmd = new Map(
      (grid.data?.daysOff ?? []).map((o) => {
        const base = DAY_OFF_LABEL[o.kind];
        return [o.date, o.note ? `${base} — ${o.note}` : base] as const;
      }),
    );
    const result: Array<{
      day: number;
      ymd: string;
      dow: number;
      isWeekend: boolean;
      isToday: boolean;
      isHoliday: boolean;
      holidayName: string | null;
      isDayOff: boolean;
      dayOffName: string | null;
    }> = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month - 1, d);
      const dow = dt.getDay();
      const ymd = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const holidayName = holidayByYmd.get(ymd) ?? null;
      const dayOffName = dayOffByYmd.get(ymd) ?? null;
      result.push({
        day: d,
        ymd,
        dow,
        isWeekend: dow === 0 || dow === 6,
        isToday: ymd === todayYmd,
        isHoliday: holidayName != null,
        holidayName,
        isDayOff: dayOffName != null,
        dayOffName,
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, grid.data?.daysInMonth, grid.data?.publicHolidays, grid.data?.daysOff]);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}
      >
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Tooltip title="Previous month">
            <IconButton size="small" onClick={() => stepMonth(-1)}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 500, minWidth: 160, textAlign: 'center', textTransform: 'capitalize' }}
          >
            {MONTH_LABELS[month - 1]} {year}
          </Typography>
          <Tooltip title="Next month">
            <IconButton size="small" onClick={() => stepMonth(+1)}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="This month">
            <IconButton size="small" onClick={goToday}>
              <TodayIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        {projectId === undefined && (
          <TextField
            select
            size="small"
            label="Project"
            value={projectFilter ?? ''}
            onChange={(e) =>
              setProjectFilter(e.target.value === '' ? null : Number(e.target.value))
            }
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">All projects</MenuItem>
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
        )}

        <ToggleButtonGroup
          size="small"
          exclusive
          value={displayMode}
          onChange={(_, next: 'tracked' | 'reported' | null) => {
            if (next) setDisplayMode(next);
          }}
          aria-label="Display mode"
        >
          <ToggleButton value="tracked" sx={{ textTransform: 'none', px: 1.5 }}>
            Tracked
          </ToggleButton>
          <ToggleButton value="reported" sx={{ textTransform: 'none', px: 1.5 }}>
            Reported
          </ToggleButton>
        </ToggleButtonGroup>

        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
            />
          }
          label="Hide done tasks"
          sx={{ '& .MuiFormControlLabel-label': { fontSize: 13 } }}
        />

        <TextField
          size="small"
          placeholder="Filter by task number"
          value={taskNumberFilter}
          onChange={(e) => setTaskNumberFilter(e.target.value)}
          sx={{ minWidth: 200 }}
        />

        <Box sx={{ flex: 1 }} />

        <Button
          size="small"
          variant="outlined"
          startIcon={<EventRepeatIcon fontSize="small" />}
          onClick={(e) => openSyncMeetings(e.currentTarget)}
        >
          Sync meetings
        </Button>

        <Button
          size="small"
          variant="outlined"
          startIcon={<CloudUploadIcon fontSize="small" />}
          onClick={() => setJiraSyncOpen(true)}
        >
          Sync to Jira
        </Button>

        <Button
          size="small"
          variant="outlined"
          startIcon={<AccessTimeIcon fontSize="small" />}
          onClick={() => {
            setWorklogDrawerEditing(null);
            setWorklogDrawerProjectId(projectId ?? projectFilter ?? null);
            setWorklogDrawerTaskId(null);
            setWorklogDrawerWorkDate(null);
            setWorklogDrawerOpen(true);
          }}
        >
          Log work
        </Button>
      </Stack>

      <Box sx={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {grid.error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {grid.error}
          </Alert>
        )}

        {!grid.loading && grid.data && grid.data.tasks.length === 0 && (
          <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 8, px: 2 }}>
            <Typography variant="body2">
              No worklogs in {MONTH_LABELS[month - 1]} {year}.
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', mt: 0.5 }}>
              Log work to a task to see it appear here. Tasks without worklogs in the month are
              hidden so the grid stays compact.
            </Typography>
          </Box>
        )}

        {grid.data && grid.data.tasks.length > 0 && (
          <Grid
            data={grid.data}
            days={days}
            displayMode={displayMode}
            hideDone={hideDone}
            taskNumberFilter={taskNumberFilter}
            sortField={sortField}
            sortDir={sortDir}
            onToggleSort={toggleSort}
            titleColWidth={titleColWidth}
            onResizeTitleCol={setTitleColWidth}
            highlightedDay={highlightedDay}
            onToggleHighlightDay={(day) =>
              setHighlightedDay((prev) => (prev === day ? null : day))
            }
            onTaskKeyClick={openTaskDrawer}
            onCellClick={openCellPopover}
          />
        )}
      </Box>

      <TaskDetailDrawer
        open={taskDetailTask !== null}
        task={taskDetailTask}
        projectName={taskDetailContext?.projectName ?? ''}
        projectColor={taskDetailContext?.projectColor ?? '#888'}
        epicName={taskDetailContext?.epicName ?? ''}
        taskUrlTemplate={taskDetailContext?.taskUrlTemplate ?? null}
        onClose={() => {
          setTaskDetailTask(null);
          setTaskDetailContext(null);
        }}
        onUpdate={async (input) => {
          if (!taskDetailTask) return;
          const res = await window.watchtower.invoke('tasks:update', {
            id: taskDetailTask.id,
            input,
          });
          // Refresh the grid + keep the drawer's local copy in sync with the
          // returned row (status changes, edited title, etc.).
          setTaskDetailTask(res.task);
          await grid.refresh();
        }}
        onDelete={async () => {
          if (!taskDetailTask) return;
          await window.watchtower.invoke('tasks:delete', { id: taskDetailTask.id });
          setTaskDetailTask(null);
          setTaskDetailContext(null);
          await grid.refresh();
        }}
        onWorklogsChanged={() => {
          void grid.refresh();
        }}
      />

      <WorklogDrawer
        open={worklogDrawerOpen}
        worklog={worklogDrawerEditing}
        initialProjectId={worklogDrawerProjectId}
        initialTaskId={worklogDrawerTaskId}
        initialWorkDate={worklogDrawerWorkDate}
        onClose={() => setWorklogDrawerOpen(false)}
        onSubmit={async (input) => {
          const res = worklogDrawerEditing
            ? await window.watchtower.invoke('worklogs:update', {
                id: worklogDrawerEditing.id,
                input,
              })
            : await window.watchtower.invoke('worklogs:create', input);
          throwIfLockedResponse(res);
          await grid.refresh();
        }}
        onDelete={
          worklogDrawerEditing
            ? async () => {
                const res = await window.watchtower.invoke('worklogs:delete', {
                  id: worklogDrawerEditing.id,
                });
                throwIfLockedResponse(res);
                await grid.refresh();
              }
            : undefined
        }
      />

      <WorklogCellPopover
        anchor={cellPopoverAnchor}
        ymd={cellPopoverYmd}
        taskId={cellPopoverTaskId}
        projectId={cellPopoverProjectId}
        onClose={closeCellPopover}
        onChanged={() => {
          void grid.refresh();
        }}
      />

      <Popover
        open={Boolean(syncMeetingsAnchor)}
        anchorEl={syncMeetingsAnchor}
        onClose={() => setSyncMeetingsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, minWidth: 380 }}>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Sync meetings</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Pick a range within {MONTH_LABELS[month - 1]} {year} (
            {formatDateLongCz(monthStart.format('YYYY-MM-DD'))} —{' '}
            {formatDateLongCz(monthEnd.format('YYYY-MM-DD'))}).
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Klik vám zkopíruje <code>/sync-meetings</code> příkaz do schránky.
            Vložte ho do svého Claude Code chatu a stiskněte Enter — Watchtower
            si nové worklogy vyzvedne přímo z DB.
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
            <DatePicker
              label="From"
              value={syncMeetingsFrom}
              onChange={(v) => setSyncMeetingsFrom(v)}
              minDate={monthStart}
              maxDate={monthEnd}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
            <DatePicker
              label="To"
              value={syncMeetingsTo}
              onChange={(v) => setSyncMeetingsTo(v)}
              minDate={monthStart}
              maxDate={monthEnd}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={() => setSyncMeetingsAnchor(null)}>Cancel</Button>
            <Button
              variant="contained"
              startIcon={<ContentCopyIcon />}
              disabled={!syncRangeValid}
              onClick={() => void submitSyncMeetings()}
            >
              Copy command
            </Button>
          </Stack>
        </Box>
      </Popover>

      <JiraSyncDialog
        open={jiraSyncOpen}
        initialFrom={dayjs(new Date(year, month - 1, 1))}
        initialTo={dayjs(new Date(year, month, 0))}
        initialProjectId={projectId ?? projectFilter ?? null}
        projects={projects}
        onClose={() => setJiraSyncOpen(false)}
        onSynced={() => {
          void grid.refresh();
        }}
      />
    </Box>
  );
}

// ─── Grid table (rendered as raw <table> + sticky cells) ────────────────────

function Grid({
  data,
  days,
  displayMode,
  hideDone,
  taskNumberFilter,
  sortField,
  sortDir,
  onToggleSort,
  titleColWidth,
  onResizeTitleCol,
  highlightedDay,
  onToggleHighlightDay,
  onTaskKeyClick,
  onCellClick,
}: {
  data: import('../../../../shared/ipcContract.js').TaskGridResponsePayload;
  days: Array<{
    day: number;
    ymd: string;
    dow: number;
    isWeekend: boolean;
    isToday: boolean;
    isHoliday: boolean;
    holidayName: string | null;
    isDayOff: boolean;
    dayOffName: string | null;
  }>;
  displayMode: 'tracked' | 'reported';
  hideDone: boolean;
  taskNumberFilter: string;
  sortField: SortField;
  sortDir: SortDir;
  onToggleSort(field: SortField): void;
  titleColWidth: number;
  onResizeTitleCol(width: number): void;
  highlightedDay: number | null;
  onToggleHighlightDay(day: number): void;
  onTaskKeyClick(task: TaskGridTaskPayload): void;
  onCellClick(taskId: number, day: number, anchor: HTMLElement): void;
}) {
  const loggedColLeft = KEY_COL_WIDTH + titleColWidth;
  const theme = useTheme();
  const paper = theme.palette.background.paper;
  const headerBg = alpha(paper, 0.9);
  const totalBg = alpha(theme.palette.primary.main, 0.08);
  const earningsBg = alpha(theme.palette.success.main, 0.06);
  const weekendBg = alpha(theme.palette.primary.main, 0.05);
  const todayBg = alpha(theme.palette.error.main, 0.16);
  const todayText = theme.palette.error.main;
  const hoverCellBg = alpha(theme.palette.primary.main, 0.18);
  const colHighlightBg = alpha(theme.palette.warning.main, 0.22);
  const divider = theme.palette.divider;

  const solidOver = (tint: string) => `linear-gradient(${tint}, ${tint}), ${paper}`;
  // Layers an overlay tint on top of an existing background string. The base
  // may itself be a layered gradient (sticky-row tints already are), so the
  // overlay is just prepended as a new layer.
  const overlay = (base: string, overlayTint: string) =>
    `linear-gradient(${overlayTint}, ${overlayTint}), ${base}`;
  const totalSolidBg = solidOver(totalBg);
  const earningsSolidBg = solidOver(earningsBg);
  const weekendSolidBg = solidOver(weekendBg);
  const todaySolidBg = solidOver(todayBg);

  // Vertical positions for the stacked sticky-bottom rows. Order in the DOM is
  // task rows → total row → earnings rows. The earnings rows pin from the very
  // bottom and the total row sits above the stack.
  const earningsHeight = data.earningsByCurrency.length * TOTAL_ROW_HEIGHT;

  // Apply the hide-done + task-number filters client-side so the toggle and
  // text input are instant. When tasks are filtered out the daily totals row
  // needs to subtract their per-day contributions; the server's
  // `dailyTotals*` payloads always include every task returned in `data.tasks`.
  const filterQuery = taskNumberFilter.trim().toLowerCase();
  const hasTaskFilter = filterQuery.length > 0;
  const visibleTasks = data.tasks.filter((t) => {
    if (hideDone && t.status === 'done') return false;
    if (hasTaskFilter && !t.taskNumber.toLowerCase().includes(filterQuery)) return false;
    return true;
  });
  const tasksFiltered = visibleTasks.length !== data.tasks.length;
  // Client-side sort. Backend already returns natural-numeric ascending by
  // taskNumber, so the default state matches without an extra pass — but we
  // re-sort here unconditionally so toggling direction or switching to title
  // is just a state update with no extra fetch.
  visibleTasks.sort((a, b) => {
    const av = sortField === 'key' ? a.taskNumber : a.taskTitle;
    const bv = sortField === 'key' ? b.taskNumber : b.taskTitle;
    const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });
  const daysTotalsField =
    displayMode === 'tracked' ? 'dailyTotalsTracked' : 'dailyTotalsReported';
  const visibleDailyTotals: Record<number, number> = tasksFiltered
    ? visibleTasks.reduce<Record<number, number>>((acc, t) => {
        const map = displayMode === 'tracked' ? t.perDayTracked : t.perDayReported;
        for (const [d, m] of Object.entries(map)) acc[Number(d)] = (acc[Number(d)] ?? 0) + m;
        return acc;
      }, {})
    : data[daysTotalsField];

  return (
    <Box sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
      <Box
        component="table"
        sx={{
          // height: 100% lets the filler row below absorb any leftover space
          // so the sticky-bottom totals stay pinned to the container bottom
          // even when the task list is shorter than the viewport.
          height: '100%',
          // width: 100% stretches the table to fill the scroll container.
          // Day columns use minWidth only (no explicit width), so the browser
          // distributes leftover horizontal space across them. On narrow
          // viewports the minWidth clamps each day to its readable size and
          // the container's overflow-x kicks in.
          width: '100%',
          borderCollapse: 'separate',
          borderSpacing: 0,
          fontSize: 13,
          '& th, & td': {
            border: 'none',
            borderRight: `1px solid ${divider}`,
            borderBottom: `1px solid ${divider}`,
            padding: '6px 8px',
            background: paper,
            whiteSpace: 'nowrap',
          },
          '& thead th': { position: 'sticky', top: 0, zIndex: 3, background: headerBg },
          '& thead th.col-key, & thead th.col-title, & thead th.col-logged': { zIndex: 4 },
        }}
      >
        <thead>
          <tr>
            <th
              className="col-key"
              onClick={() => onToggleSort('key')}
              style={{
                position: 'sticky',
                left: 0,
                minWidth: KEY_COL_WIDTH,
                width: KEY_COL_WIDTH,
                fontWeight: 600,
                textAlign: 'left',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              title="Click to sort by task number"
            >
              Key
              <SortIndicator active={sortField === 'key'} dir={sortDir} />
            </th>
            <th
              className="col-title"
              onClick={() => onToggleSort('title')}
              style={{
                position: 'sticky',
                left: TITLE_COL_LEFT,
                minWidth: titleColWidth,
                width: titleColWidth,
                fontWeight: 600,
                textAlign: 'left',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              title="Click to sort by task title; drag right edge to resize"
            >
              Title
              <SortIndicator active={sortField === 'title'} dir={sortDir} />
              <ResizeHandle
                width={titleColWidth}
                min={MIN_TITLE_COL_WIDTH}
                max={MAX_TITLE_COL_WIDTH}
                onResize={onResizeTitleCol}
                onPersist={(v) => writeLocalStorage(TITLE_COL_WIDTH_STORAGE_KEY, String(v))}
              />
            </th>
            <th
              className="col-logged"
              style={{
                position: 'sticky',
                left: loggedColLeft,
                minWidth: LOGGED_COL_WIDTH,
                width: LOGGED_COL_WIDTH,
                fontWeight: 600,
                borderRight: `2px solid ${theme.palette.divider}`,
                textAlign: 'right',
              }}
            >
              Logged
            </th>
            {days.map((d) => {
              const isNonWorking = d.isWeekend || d.isHoliday || d.isDayOff;
              const isHighlighted = highlightedDay === d.day;
              // The header bg is a solid (the sticky thead sits over the
              // scrolling rows beneath, so we want it opaque). Today/weekend
              // tints are solids too; the highlight overlay is layered on
              // top via `overlay()` when active.
              let headerBgValue: string = headerBg;
              if (d.isToday) headerBgValue = solidOver(todayBg);
              else if (isNonWorking) headerBgValue = solidOver(weekendBg);
              if (isHighlighted) headerBgValue = overlay(headerBgValue, colHighlightBg);
              const cls = {
                background: headerBgValue,
                color: d.isToday ? todayText : undefined,
              };
              return (
                <th
                  key={d.day}
                  title={
                    (d.holidayName ?? d.dayOffName)
                      ? `${d.holidayName ?? d.dayOffName} — click to highlight column`
                      : 'Click to highlight column'
                  }
                  onClick={() => onToggleHighlightDay(d.day)}
                  style={{
                    cursor: 'pointer',
                    userSelect: 'none',
                    minWidth: DAY_COL_WIDTH,
                    textAlign: 'center',
                    fontWeight: 500,
                    lineHeight: 1.1,
                    padding: '4px 2px',
                    ...cls,
                  }}
                >
                  <Box sx={{ fontSize: 12 }}>{d.day}</Box>
                  <Box
                    sx={{
                      fontSize: 9,
                      color: d.isToday ? todayText : 'text.secondary',
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                    }}
                  >
                    {DOW_LABELS[d.dow]}
                  </Box>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visibleTasks.map((task) => (
            <TaskRow
              key={task.taskId}
              task={task}
              days={days}
              displayMode={displayMode}
              weekendBg={weekendBg}
              todayBg={todayBg}
              hoverCellBg={hoverCellBg}
              colHighlightBg={colHighlightBg}
              highlightedDay={highlightedDay}
              theme={theme}
              divider={divider}
              titleColWidth={titleColWidth}
              loggedColLeft={loggedColLeft}
              onKeyClick={() => onTaskKeyClick(task)}
              onCellClick={onCellClick}
            />
          ))}

          {/* Filler row — absorbs any leftover vertical space so the
              sticky-bottom totals/earnings rows pin against the container's
              bottom edge instead of floating mid-screen on tall viewports.
              colSpan covers Key + Title + Logged + every day column. */}
          <tr aria-hidden>
            <td
              colSpan={3 + days.length}
              style={{
                height: '100%',
                padding: 0,
                border: 'none',
                background: paper,
              }}
            />
          </tr>

          {/* Total hours — sticky above earnings rows */}
          <tr>
            <td
              style={{
                position: 'sticky',
                left: 0,
                bottom: earningsHeight,
                zIndex: 3,
                fontWeight: 600,
                background: totalSolidBg,
                borderTop: `2px solid ${divider}`,
                height: TOTAL_ROW_HEIGHT,
              }}
            >
              Total hours
            </td>
            <td
              style={{
                position: 'sticky',
                left: TITLE_COL_LEFT,
                bottom: earningsHeight,
                zIndex: 3,
                background: totalSolidBg,
                borderTop: `2px solid ${divider}`,
                height: TOTAL_ROW_HEIGHT,
              }}
            />
            <td
              style={{
                position: 'sticky',
                left: loggedColLeft,
                bottom: earningsHeight,
                zIndex: 3,
                fontWeight: 600,
                textAlign: 'right',
                background: totalSolidBg,
                borderRight: `2px solid ${divider}`,
                borderTop: `2px solid ${divider}`,
                fontVariantNumeric: 'tabular-nums',
              }}
              title={`Capacity = ${fmtHoursTrim(data.monthCapacityMinutes)} h (Mon-Fri × 8h minus Czech holidays and user days off)`}
            >
              {fmtHoursTrim(sumOf(visibleDailyTotals))}
              <Box
                component="span"
                sx={{ color: 'text.secondary', fontWeight: 400, ml: 0.5 }}
              >
                / {fmtHoursTrim(data.monthCapacityMinutes)}
              </Box>
            </td>
            {days.map((d) => {
              const v = visibleDailyTotals[d.day] ?? 0;
              const baseBg = d.isToday
                ? todaySolidBg
                : d.isWeekend || d.isHoliday || d.isDayOff
                  ? weekendSolidBg
                  : totalSolidBg;
              const cellBg =
                highlightedDay === d.day ? overlay(baseBg, colHighlightBg) : baseBg;
              return (
                <td
                  key={d.day}
                  style={{
                    position: 'sticky',
                    bottom: earningsHeight,
                    zIndex: 2,
                    textAlign: 'center',
                    fontVariantNumeric: 'tabular-nums',
                    background: cellBg,
                    borderTop: `2px solid ${divider}`,
                    color: v > 0 ? undefined : theme.palette.text.disabled,
                    height: TOTAL_ROW_HEIGHT,
                  }}
                  title={d.isToday ? 'today' : undefined}
                >
                  {v > 0 ? fmtHoursTrim(v) : ''}
                </td>
              );
            })}
          </tr>

          {/* Earnings rows — one per currency, stacking up from the bottom */}
          {data.earningsByCurrency.map((row, idx) => {
            const rowBottom = (data.earningsByCurrency.length - 1 - idx) * TOTAL_ROW_HEIGHT;
            return (
              <tr key={row.currency}>
                <td
                  style={{
                    position: 'sticky',
                    left: 0,
                    bottom: rowBottom,
                    zIndex: 3,
                    fontWeight: 600,
                    background: earningsSolidBg,
                    height: TOTAL_ROW_HEIGHT,
                  }}
                >
                  Earned ({row.currency})
                </td>
                <td
                  style={{
                    position: 'sticky',
                    left: TITLE_COL_LEFT,
                    bottom: rowBottom,
                    zIndex: 3,
                    background: earningsSolidBg,
                    height: TOTAL_ROW_HEIGHT,
                  }}
                />
                <td
                  style={{
                    position: 'sticky',
                    left: loggedColLeft,
                    bottom: rowBottom,
                    zIndex: 3,
                    fontWeight: 600,
                    textAlign: 'right',
                    background: earningsSolidBg,
                    borderRight: `2px solid ${divider}`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  title={`Capacity target: ${formatAmount(row.expectedAmount, row.currency)} (workdays × MD rate)`}
                >
                  {formatAmount(row.totalAmount, row.currency)}
                  <Box
                    component="span"
                    sx={{ color: 'text.secondary', fontWeight: 400, ml: 0.5 }}
                  >
                    / {formatAmount(row.expectedAmount, row.currency)}
                  </Box>
                </td>
                {days.map((d) => {
                  const v = row.perDay[d.day] ?? 0;
                  const baseBg = d.isToday
                    ? todaySolidBg
                    : d.isWeekend || d.isHoliday || d.isDayOff
                      ? weekendSolidBg
                      : earningsSolidBg;
                  const cellBg =
                    highlightedDay === d.day ? overlay(baseBg, colHighlightBg) : baseBg;
                  return (
                    <td
                      key={d.day}
                      style={{
                        position: 'sticky',
                        bottom: rowBottom,
                        zIndex: 2,
                        textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums',
                        background: cellBg,
                        color: v > 0 ? undefined : theme.palette.text.disabled,
                        height: TOTAL_ROW_HEIGHT,
                        fontSize: 11,
                      }}
                      title={v > 0 ? formatAmount(v, row.currency) : undefined}
                    >
                      {v > 0 ? Math.round(v).toLocaleString('cs-CZ') : ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </Box>
    </Box>
  );
}

function TaskRow({
  task,
  days,
  displayMode,
  weekendBg,
  todayBg,
  hoverCellBg,
  colHighlightBg,
  highlightedDay,
  theme,
  divider,
  titleColWidth,
  loggedColLeft,
  onKeyClick,
  onCellClick,
}: {
  task: TaskGridTaskPayload;
  days: Array<{
    day: number;
    ymd: string;
    dow: number;
    isWeekend: boolean;
    isToday: boolean;
    isHoliday: boolean;
    holidayName: string | null;
    isDayOff: boolean;
    dayOffName: string | null;
  }>;
  displayMode: 'tracked' | 'reported';
  weekendBg: string;
  todayBg: string;
  hoverCellBg: string;
  colHighlightBg: string;
  highlightedDay: number | null;
  theme: Theme;
  divider: string;
  titleColWidth: number;
  loggedColLeft: number;
  onKeyClick(): void;
  onCellClick(taskId: number, day: number, anchor: HTMLElement): void;
}) {
  const perDay = displayMode === 'tracked' ? task.perDayTracked : task.perDayReported;
  const totalMinutes = displayMode === 'tracked' ? task.totalTracked : task.totalReported;
  const paper = theme.palette.background.paper;
  const StatusIcon =
    task.status === 'done'
      ? TaskAltIcon
      : task.status === 'to_accept'
        ? HourglassEmptyIcon
        : task.status === 'in_progress'
          ? AdjustIcon
          : RadioButtonUncheckedIcon;
  const statusColor =
    task.status === 'done'
      ? theme.palette.success.main
      : task.status === 'to_accept'
        ? theme.palette.warning.main
        : task.status === 'in_progress'
          ? theme.palette.primary.main
          : theme.palette.text.disabled;

  const overEstimate =
    task.estimatedMinutes != null &&
    task.estimatedMinutes > 0 &&
    totalMinutes > task.estimatedMinutes;
  const riskEstimate =
    !overEstimate &&
    task.estimatedMinutes != null &&
    task.estimatedMinutes > 0 &&
    totalMinutes >= task.estimatedMinutes * 0.8;
  const loggedColor = overEstimate
    ? theme.palette.error.main
    : riskEstimate
      ? theme.palette.warning.main
      : theme.palette.text.primary;

  return (
    <tr>
      <td
        style={{
          position: 'sticky',
          left: 0,
          zIndex: 1,
          minWidth: KEY_COL_WIDTH,
          width: KEY_COL_WIDTH,
          background: paper,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <StatusIcon fontSize="small" sx={{ color: statusColor, fontSize: 14 }} />
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: task.projectColor,
              flexShrink: 0,
            }}
            title={task.projectName}
          />
          <Box
            component="button"
            onClick={onKeyClick}
            sx={{
              border: 'none',
              background: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'primary.main',
              fontFamily: 'Menlo, monospace',
              fontSize: 12,
              textAlign: 'left',
              ':hover': { textDecoration: 'underline' },
            }}
            title={`${task.taskTitle} — ${task.epicName}`}
          >
            {task.taskNumber}
          </Box>
        </Stack>
      </td>
      <td
        onClick={onKeyClick}
        style={{
          position: 'sticky',
          left: TITLE_COL_LEFT,
          zIndex: 1,
          minWidth: titleColWidth,
          width: titleColWidth,
          maxWidth: titleColWidth,
          background: paper,
          fontSize: 13,
          color: theme.palette.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          cursor: 'pointer',
        }}
        title={task.taskTitle}
      >
        {task.taskTitle}
      </td>
      <td
        style={{
          position: 'sticky',
          left: loggedColLeft,
          zIndex: 1,
          minWidth: LOGGED_COL_WIDTH,
          width: LOGGED_COL_WIDTH,
          background: paper,
          fontWeight: 600,
          textAlign: 'right',
          borderRight: `2px solid ${divider}`,
          color: loggedColor,
          fontVariantNumeric: 'tabular-nums',
        }}
        title={
          task.estimatedMinutes != null
            ? `Estimate ${fmtHoursTrim(task.estimatedMinutes)} h`
            : undefined
        }
      >
        {task.estimatedMinutes != null && task.estimatedMinutes > 0 ? (
          <>
            {fmtHoursTrim(totalMinutes)}
            <Box
              component="span"
              sx={{ color: 'text.secondary', fontWeight: 400, ml: 0.5 }}
            >
              / {fmtHoursTrim(task.estimatedMinutes)}
            </Box>
          </>
        ) : (
          fmtHoursTrim(totalMinutes)
        )}
      </td>
      {days.map((d) => {
        const v = perDay[d.day] ?? 0;
        const baseBg = d.isToday
          ? todayBg
          : d.isWeekend || d.isHoliday || d.isDayOff
            ? weekendBg
            : 'transparent';
        const isHighlighted = highlightedDay === d.day;
        // Highlight layer is composed on top of whatever the cell already
        // had — empty cells become a flat tint, today/weekend stay visible
        // through it. mouseenter/leave reset to the same composed value so
        // the hover state doesn't strip the column tint.
        const restBg = isHighlighted
          ? baseBg === 'transparent'
            ? colHighlightBg
            : `linear-gradient(${colHighlightBg}, ${colHighlightBg}), ${baseBg}`
          : baseBg;
        return (
          <td
            key={d.day}
            onClick={(e) => onCellClick(task.taskId, d.day, e.currentTarget)}
            style={{
              minWidth: DAY_COL_WIDTH,
              textAlign: 'center',
              cursor: 'pointer',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 13,
              background: restBg,
              color: v > 0 ? undefined : theme.palette.text.disabled,
              padding: '4px 2px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = hoverCellBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = restBg as string;
            }}
            title={
              v > 0
                ? `${fmtHoursTrim(v)} h on ${d.ymd}${
                    (d.holidayName ?? d.dayOffName)
                      ? ` (${d.holidayName ?? d.dayOffName})`
                      : ''
                  }`
                : (d.holidayName ?? d.dayOffName)
                  ? `${d.holidayName ?? d.dayOffName} · click to log work anyway`
                  : `Log work on ${d.ymd}`
            }
          >
            {v > 0 ? fmtHoursTrim(v) : ''}
          </td>
        );
      })}
    </tr>
  );
}

function SortIndicator({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null;
  return (
    <Box
      component="span"
      sx={{
        ml: 0.5,
        fontSize: 11,
        color: 'text.secondary',
        fontWeight: 400,
      }}
      aria-hidden
    >
      {dir === 'asc' ? '▲' : '▼'}
    </Box>
  );
}

function ResizeHandle({
  width,
  min,
  max,
  onResize,
  onPersist,
}: {
  width: number;
  min: number;
  max: number;
  onResize(next: number): void;
  onPersist(value: number): void;
}) {
  // Drag tracking lives in closure scope inside the pointerdown handler — no
  // component state to keep this cheap on every mousemove. The handle stops
  // propagation so the header's sort-toggle click never fires while resizing.
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = width;
    let latest = startWidth;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (ev: PointerEvent) => {
      latest = Math.max(min, Math.min(max, startWidth + ev.clientX - startX));
      onResize(latest);
    };
    const onUp = () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onPersist(latest);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
      onClick={(e) => e.stopPropagation()}
      sx={{
        position: 'absolute',
        top: 0,
        right: -3,
        height: '100%',
        width: 6,
        cursor: 'col-resize',
        zIndex: 5,
        touchAction: 'none',
        '&:hover': { background: (t) => alpha(t.palette.primary.main, 0.25) },
      }}
    />
  );
}

function sumOf(record: Record<number, number>): number {
  let total = 0;
  for (const v of Object.values(record)) total += v;
  return total;
}

// localStorage is wrapped in try/catch to stay resilient against private-mode
// or quota errors — neither is worth surfacing to the user; the grid still
// works, just without persistence.
function readLocalStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // ignored — see readLocalStorage
  }
}

// Touch unused warning for AddIcon — re-exporting for use as the empty-state
// CTA elsewhere if Phase 22 wires one in. Keeps the import surface stable
// even though Phase 18 itself doesn't render the icon.
void AddIcon;
