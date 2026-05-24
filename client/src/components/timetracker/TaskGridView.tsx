import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme, alpha, type Theme } from '@mui/material/styles';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import AddIcon from '@mui/icons-material/Add';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import AdjustIcon from '@mui/icons-material/Adjust';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { useTaskGrid } from '../../state/useTaskGrid.js';
import { TaskDrawer } from './TaskDrawer.js';
import { WorklogDrawer } from './WorklogDrawer.js';
import type {
  EpicViewPayload,
  ProjectViewPayload,
  TaskGridTaskPayload,
  TaskViewPayload,
  WorklogViewPayload,
} from '../../../../shared/ipcContract.js';

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const KEY_COL_WIDTH = 200;
const LOGGED_COL_WIDTH = 90;
const DAY_COL_WIDTH = 44;
const TOTAL_ROW_HEIGHT = 32;

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
  const grid = useTaskGrid(
    year,
    month,
    projectId ?? projectFilter ?? undefined,
  );

  // Load projects once on mount (only in list mode). On the first load, snap
  // the filter to the project marked is_default = 1 so the grid lands on the
  // user's working project instead of the costlier "All projects" scan.
  const initialProjectSelectionDoneRef = useRef(false);
  useEffect(() => {
    if (projectId !== undefined) return;
    void window.watchtower.invoke('projects:list', { archived: false }).then((r) => {
      setProjects(r.projects);
      if (!initialProjectSelectionDoneRef.current) {
        initialProjectSelectionDoneRef.current = true;
        const def = r.projects.find((p) => p.isDefault);
        if (def) setProjectFilter(def.id);
      }
    });
  }, [projectId]);

  // Task + worklog drawers — opened on cell / key click.
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [taskDrawerTask, setTaskDrawerTask] = useState<TaskViewPayload | null>(null);
  const [taskDrawerEpicId, setTaskDrawerEpicId] = useState<number | null>(null);
  const [taskDrawerEpics, setTaskDrawerEpics] = useState<EpicViewPayload[]>([]);

  const [worklogDrawerOpen, setWorklogDrawerOpen] = useState(false);
  const [worklogDrawerProjectId, setWorklogDrawerProjectId] = useState<number | null>(null);
  const [worklogDrawerTaskId, setWorklogDrawerTaskId] = useState<number | null>(null);
  const [worklogDrawerWorkDate, setWorklogDrawerWorkDate] = useState<string | null>(null);
  /**
   * When the cell-click flow finds an existing worklog (or worklogs) for
   * that task/date, we open the drawer in edit mode on the first match.
   * Multiple worklogs on the same cell get a "+ N more" hint in the
   * description fallback so the user knows the rest live in the list view.
   */
  const [worklogDrawerEditing, setWorklogDrawerEditing] = useState<WorklogViewPayload | null>(
    null,
  );

  const openTaskDrawer = async (gridTask: TaskGridTaskPayload) => {
    // Fetch the full task row + the project's epics so the drawer has its
    // parent-epic select populated. The grid payload has only joined display
    // fields, not the full task shape required by the drawer.
    try {
      const [tasksRes, epicsRes] = await Promise.all([
        window.watchtower.invoke('tasks:listForEpic', { epicId: gridTask.epicId }),
        window.watchtower.invoke('epics:list', { projectId: gridTask.projectId }),
      ]);
      const fullTask = tasksRes.tasks.find((t) => t.id === gridTask.taskId) ?? null;
      setTaskDrawerTask(fullTask);
      setTaskDrawerEpicId(gridTask.epicId);
      setTaskDrawerEpics(epicsRes.epics);
      setTaskDrawerOpen(true);
    } catch {
      // best-effort — if loading fails, drop silently rather than open an
      // unusable drawer
    }
  };

  const openWorklogDrawerForCell = async (taskId: number, day: number) => {
    const ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Find the project for this task (from the grid payload).
    const gridTask = grid.data?.tasks.find((t) => t.taskId === taskId);
    if (!gridTask) return;

    // Look up any worklog(s) already on this cell so the drawer opens in
    // edit mode (with real values) when there's an existing one. The grid's
    // perDay aggregates can hide multiple worklogs per cell; we surface the
    // first match here and rely on the per-row list view for the rest.
    try {
      const res = await window.watchtower.invoke('worklogs:list', {
        taskId,
        from: ymd,
        to: ymd,
      });
      const existing = res.worklogs[0] ?? null;
      setWorklogDrawerEditing(existing);
      setWorklogDrawerProjectId(gridTask.projectId);
      setWorklogDrawerTaskId(existing ? null : taskId);
      setWorklogDrawerWorkDate(existing ? null : ymd);
      setWorklogDrawerOpen(true);
    } catch {
      // Network-ish blip: still open in create mode so the user can log
      // work even if the lookup failed.
      setWorklogDrawerEditing(null);
      setWorklogDrawerProjectId(gridTask.projectId);
      setWorklogDrawerTaskId(taskId);
      setWorklogDrawerWorkDate(ymd);
      setWorklogDrawerOpen(true);
    }
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

  // Day metadata for the column headers + tinting.
  const days = useMemo(() => {
    const daysInMonth = grid.data?.daysInMonth ?? new Date(year, month, 0).getDate();
    const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const result: Array<{
      day: number;
      ymd: string;
      dow: number;
      isWeekend: boolean;
      isToday: boolean;
    }> = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month - 1, d);
      const dow = dt.getDay();
      const ymd = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      result.push({
        day: d,
        ymd,
        dow,
        isWeekend: dow === 0 || dow === 6,
        isToday: ymd === todayYmd,
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, grid.data?.daysInMonth]);

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

        <Box sx={{ flex: 1 }} />

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
            onTaskKeyClick={openTaskDrawer}
            onCellClick={openWorklogDrawerForCell}
          />
        )}
      </Box>

      <TaskDrawer
        open={taskDrawerOpen}
        task={taskDrawerTask}
        defaultEpicId={taskDrawerEpicId ?? 0}
        epics={taskDrawerEpics}
        onClose={() => setTaskDrawerOpen(false)}
        onSubmit={async (input) => {
          if (taskDrawerTask) {
            await window.watchtower.invoke('tasks:update', { id: taskDrawerTask.id, input });
          } else {
            await window.watchtower.invoke('tasks:create', input);
          }
          await grid.refresh();
        }}
        onDelete={
          taskDrawerTask
            ? async () => {
                await window.watchtower.invoke('tasks:delete', { id: taskDrawerTask.id });
                await grid.refresh();
              }
            : undefined
        }
      />

      <WorklogDrawer
        open={worklogDrawerOpen}
        worklog={worklogDrawerEditing}
        initialProjectId={worklogDrawerProjectId}
        initialTaskId={worklogDrawerTaskId}
        initialWorkDate={worklogDrawerWorkDate}
        onClose={() => setWorklogDrawerOpen(false)}
        onSubmit={async (input) => {
          if (worklogDrawerEditing) {
            await window.watchtower.invoke('worklogs:update', {
              id: worklogDrawerEditing.id,
              input,
            });
          } else {
            await window.watchtower.invoke('worklogs:create', input);
          }
          await grid.refresh();
        }}
        onDelete={
          worklogDrawerEditing
            ? async () => {
                await window.watchtower.invoke('worklogs:delete', {
                  id: worklogDrawerEditing.id,
                });
                await grid.refresh();
              }
            : undefined
        }
      />
    </Box>
  );
}

// ─── Grid table (rendered as raw <table> + sticky cells) ────────────────────

function Grid({
  data,
  days,
  onTaskKeyClick,
  onCellClick,
}: {
  data: import('../../../../shared/ipcContract.js').TaskGridResponsePayload;
  days: Array<{ day: number; ymd: string; dow: number; isWeekend: boolean; isToday: boolean }>;
  onTaskKeyClick(task: TaskGridTaskPayload): void;
  onCellClick(taskId: number, day: number): void;
}) {
  const theme = useTheme();
  const paper = theme.palette.background.paper;
  const headerBg = alpha(paper, 0.9);
  const totalBg = alpha(theme.palette.primary.main, 0.08);
  const earningsBg = alpha(theme.palette.success.main, 0.06);
  const weekendBg = alpha(theme.palette.primary.main, 0.05);
  const todayBg = alpha(theme.palette.error.main, 0.16);
  const todayText = theme.palette.error.main;
  const hoverCellBg = alpha(theme.palette.primary.main, 0.18);
  const divider = theme.palette.divider;

  const solidOver = (tint: string) => `linear-gradient(${tint}, ${tint}), ${paper}`;
  const totalSolidBg = solidOver(totalBg);
  const earningsSolidBg = solidOver(earningsBg);
  const weekendSolidBg = solidOver(weekendBg);
  const todaySolidBg = solidOver(todayBg);

  // Vertical positions for the stacked sticky-bottom rows. Order in the DOM is
  // task rows → total row → earnings rows. The earnings rows pin from the very
  // bottom and the total row sits above the stack.
  const earningsHeight = data.earningsByCurrency.length * TOTAL_ROW_HEIGHT;

  return (
    <Box sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
      <Box
        component="table"
        sx={{
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
          '& thead th.col-key, & thead th.col-logged': { zIndex: 4 },
        }}
      >
        <thead>
          <tr>
            <th
              className="col-key"
              style={{
                position: 'sticky',
                left: 0,
                minWidth: KEY_COL_WIDTH,
                width: KEY_COL_WIDTH,
                fontWeight: 600,
                textAlign: 'left',
              }}
            >
              Key
            </th>
            <th
              className="col-logged"
              style={{
                position: 'sticky',
                left: KEY_COL_WIDTH,
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
              const cls = d.isToday
                ? { background: todayBg, color: todayText }
                : d.isWeekend
                  ? { background: weekendBg }
                  : {};
              return (
                <th
                  key={d.day}
                  style={{
                    minWidth: DAY_COL_WIDTH,
                    width: DAY_COL_WIDTH,
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
          {data.tasks.map((task) => (
            <TaskRow
              key={task.taskId}
              task={task}
              days={days}
              weekendBg={weekendBg}
              todayBg={todayBg}
              hoverCellBg={hoverCellBg}
              theme={theme}
              divider={divider}
              onKeyClick={() => onTaskKeyClick(task)}
              onCellClick={onCellClick}
            />
          ))}

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
                left: KEY_COL_WIDTH,
                bottom: earningsHeight,
                zIndex: 3,
                fontWeight: 600,
                textAlign: 'right',
                background: totalSolidBg,
                borderRight: `2px solid ${divider}`,
                borderTop: `2px solid ${divider}`,
                fontVariantNumeric: 'tabular-nums',
              }}
              title={`Capacity = ${fmtHoursTrim(data.monthCapacityMinutes)} h (Mon-Fri × 8h; Czech holidays land in Phase 19)`}
            >
              {fmtHoursTrim(sumOf(data.dailyTotals))}
              <Box
                component="span"
                sx={{ color: 'text.secondary', fontWeight: 400, ml: 0.5 }}
              >
                / {fmtHoursTrim(data.monthCapacityMinutes)}
              </Box>
            </td>
            {days.map((d) => {
              const v = data.dailyTotals[d.day] ?? 0;
              const cellBg = d.isToday ? todaySolidBg : d.isWeekend ? weekendSolidBg : totalSolidBg;
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
                    left: KEY_COL_WIDTH,
                    bottom: rowBottom,
                    zIndex: 3,
                    fontWeight: 600,
                    textAlign: 'right',
                    background: earningsSolidBg,
                    borderRight: `2px solid ${divider}`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatAmount(row.totalAmount, row.currency)}
                </td>
                {days.map((d) => {
                  const v = row.perDay[d.day] ?? 0;
                  const cellBg = d.isToday ? todaySolidBg : d.isWeekend ? weekendSolidBg : earningsSolidBg;
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
  weekendBg,
  todayBg,
  hoverCellBg,
  theme,
  divider,
  onKeyClick,
  onCellClick,
}: {
  task: TaskGridTaskPayload;
  days: Array<{ day: number; ymd: string; dow: number; isWeekend: boolean; isToday: boolean }>;
  weekendBg: string;
  todayBg: string;
  hoverCellBg: string;
  theme: Theme;
  divider: string;
  onKeyClick(): void;
  onCellClick(taskId: number, day: number): void;
}) {
  const paper = theme.palette.background.paper;
  const StatusIcon =
    task.status === 'done'
      ? TaskAltIcon
      : task.status === 'in_progress'
        ? AdjustIcon
        : RadioButtonUncheckedIcon;
  const statusColor =
    task.status === 'done'
      ? theme.palette.success.main
      : task.status === 'in_progress'
        ? theme.palette.primary.main
        : theme.palette.text.disabled;

  const overEstimate =
    task.estimatedMinutes != null &&
    task.estimatedMinutes > 0 &&
    task.totalMinutes > task.estimatedMinutes;
  const riskEstimate =
    !overEstimate &&
    task.estimatedMinutes != null &&
    task.estimatedMinutes > 0 &&
    task.totalMinutes >= task.estimatedMinutes * 0.8;
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
        style={{
          position: 'sticky',
          left: KEY_COL_WIDTH,
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
            {fmtHoursTrim(task.totalMinutes)}
            <Box
              component="span"
              sx={{ color: 'text.secondary', fontWeight: 400, ml: 0.5 }}
            >
              / {fmtHoursTrim(task.estimatedMinutes)}
            </Box>
          </>
        ) : (
          fmtHoursTrim(task.totalMinutes)
        )}
      </td>
      {days.map((d) => {
        const v = task.perDay[d.day] ?? 0;
        const baseBg = d.isToday ? todayBg : d.isWeekend ? weekendBg : 'transparent';
        return (
          <td
            key={d.day}
            onClick={() => onCellClick(task.taskId, d.day)}
            style={{
              minWidth: DAY_COL_WIDTH,
              width: DAY_COL_WIDTH,
              textAlign: 'center',
              cursor: 'pointer',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 13,
              background: baseBg,
              color: v > 0 ? undefined : theme.palette.text.disabled,
              padding: '4px 2px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = hoverCellBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = baseBg as string;
            }}
            title={v > 0 ? `${fmtHoursTrim(v)} h on ${d.ymd}` : `Log work on ${d.ymd}`}
          >
            {v > 0 ? fmtHoursTrim(v) : ''}
          </td>
        );
      })}
    </tr>
  );
}

function sumOf(record: Record<number, number>): number {
  let total = 0;
  for (const v of Object.values(record)) total += v;
  return total;
}

// Touch unused warning for AddIcon — re-exporting for use as the empty-state
// CTA elsewhere if Phase 22 wires one in. Keeps the import surface stable
// even though Phase 18 itself doesn't render the icon.
void AddIcon;
