import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  createFilterOptions,
  Drawer,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import CloseIcon from '@mui/icons-material/Close';
import { CZ_DATE_FORMAT } from '../../util/format.js';
import { isLocked, useWorklogLock } from '../../util/lockSetting.js';
import type {
  ProjectViewPayload,
  TaskViewPayload,
  WorklogInputPayload,
  WorklogViewPayload,
} from '../../../../shared/ipcContract.js';

interface Props {
  open: boolean;
  /** The worklog being edited; null in create mode. */
  worklog: WorklogViewPayload | null;
  /** Pre-fill the project select (e.g. when opening from the detail page). */
  initialProjectId?: number | null;
  /**
   * Pre-fill the task select in create mode (e.g. when opening from a task
   * grid cell). Ignored when `worklog` is non-null — the editing flow uses
   * the worklog's own task_id.
   */
  initialTaskId?: number | null;
  /**
   * Pre-fill the work-date in create mode (e.g. when opening from a task
   * grid cell). Falls back to today when unset.
   */
  initialWorkDate?: string | null;
  onClose(): void;
  onSubmit(input: WorklogInputPayload): Promise<void>;
  onDelete?(): Promise<void>;
}

interface Draft {
  projectId: number | null;
  taskId: number | null;
  description: string;
  workDate: string;
  /** Tracked time — the `worklogs.minutes` column. Required. */
  hours: string;
  /**
   * Optional reported time — `worklogs.reported_minutes`. Empty means "same
   * as tracked" and is persisted as NULL so the legacy fallback semantics
   * stay intact (NULL reported_minutes ↔ minutes in TimeTracker's reports).
   */
  reportedHours: string;
}

function todayStr(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

function emptyDraft(
  projectId: number | null = null,
  taskId: number | null = null,
  workDate: string | null = null,
): Draft {
  return {
    projectId,
    taskId,
    description: '',
    workDate: workDate ?? todayStr(),
    hours: '',
    reportedHours: '',
  };
}

function draftOf(w: WorklogViewPayload): Draft {
  // Reported hours only show in the input when explicitly different from
  // tracked — null reportedMinutes (or equal to minutes) leaves the field
  // empty, signalling "same as tracked" to the user.
  const reportedDifferent =
    w.reportedMinutes != null && w.reportedMinutes !== w.minutes;
  return {
    projectId: w.projectId,
    taskId: w.taskId,
    description: w.description ?? '',
    workDate: w.workDate,
    hours: (w.minutes / 60).toString(),
    reportedHours: reportedDifferent ? (w.reportedMinutes! / 60).toString() : '',
  };
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'manual',
  'watchtower-auto': 'watchtower',
  'jira-sync': 'jira',
};

// Substring filter over `${number} ${title}`. Explicit (not the default) so we
// never hit MUI's "input equals selected label → skip filter" edge case, which
// kept the dropdown showing every option after the user typed over a previous
// selection.
const filterTaskOptions = createFilterOptions<TaskViewPayload>({
  stringify: (t) => `${t.number} ${t.title}`,
  ignoreCase: true,
  trim: true,
});

export function WorklogDrawer({
  open,
  worklog,
  initialProjectId,
  initialTaskId,
  initialWorkDate,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() =>
    emptyDraft(initialProjectId ?? null, initialTaskId ?? null, initialWorkDate ?? null),
  );
  const [projects, setProjects] = useState<ProjectViewPayload[]>([]);
  const [tasks, setTasks] = useState<TaskViewPayload[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    setDraft(
      worklog
        ? draftOf(worklog)
        : emptyDraft(initialProjectId ?? null, initialTaskId ?? null, initialWorkDate ?? null),
    );
    void window.watchtower
      .invoke('projects:list', { archived: false })
      .then((r) => setProjects(r.projects))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, worklog, initialProjectId, initialTaskId, initialWorkDate]);

  // Fetch tasks every time the selected project changes.
  useEffect(() => {
    if (!open || draft.projectId == null) {
      setTasks([]);
      return;
    }
    void window.watchtower
      .invoke('tasks:listForProject', { projectId: draft.projectId })
      .then((r) => setTasks(r.tasks))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [open, draft.projectId]);

  const isEdit = worklog !== null;
  const lockedThrough = useWorklogLock();
  // Editing or moving a row in / out of the locked range is rejected
  // server-side (orchestrator throws WorklogLockedError); mirror the rule
  // client-side so the user gets immediate feedback rather than a round-trip.
  const editingLocked = worklog !== null && isLocked(worklog.workDate, lockedThrough);
  const dateLocked = isLocked(draft.workDate, lockedThrough);
  const locked = editingLocked || dateLocked;

  const hoursNum = Number(draft.hours);
  const minutes =
    draft.hours.trim() && Number.isFinite(hoursNum) && hoursNum > 0
      ? Math.round(hoursNum * 60)
      : 0;
  // Reported minutes are stored as NULL when "same as tracked" so the legacy
  // semantics from TimeTracker survive (NULL reported ↔ minutes in reports).
  const reportedHoursNum = Number(draft.reportedHours);
  const reportedHoursValid =
    !draft.reportedHours.trim() ||
    (Number.isFinite(reportedHoursNum) && reportedHoursNum > 0);
  const reportedMinutes =
    draft.reportedHours.trim() && Number.isFinite(reportedHoursNum) && reportedHoursNum > 0
      ? Math.round(reportedHoursNum * 60)
      : null;
  const canSubmit =
    draft.taskId != null &&
    minutes > 0 &&
    draft.workDate.length === 10 &&
    reportedHoursValid &&
    !submitting &&
    !locked;

  const submit = async () => {
    if (!canSubmit || draft.taskId == null) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        taskId: draft.taskId,
        description: draft.description.trim() ? draft.description.trim() : null,
        workDate: draft.workDate,
        minutes,
        // Only persist a distinct reported value when the user actually
        // typed something different. Equal-to-tracked round-trips as NULL.
        reportedMinutes:
          reportedMinutes != null && reportedMinutes !== minutes ? reportedMinutes : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 460 } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2.5,
            py: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
              {isEdit ? 'Edit worklog' : 'Log work'}
            </Typography>
            {isEdit && worklog.source && (
              <Box sx={{ mt: 0.5 }}>
                <Chip
                  label={SOURCE_LABELS[worklog.source] ?? worklog.source}
                  size="small"
                  variant="outlined"
                  sx={{ height: 18, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}
                />
              </Box>
            )}
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            px: 2.5,
            py: 2.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
          }}
        >
          {error && <Alert severity="error">{error}</Alert>}
          {locked && (
            <Alert severity="warning">
              Worklogs on or before {lockedThrough} are locked. Unlock in
              Settings → Worklog lock to edit.
            </Alert>
          )}

          <TextField
            select
            label="Project"
            size="small"
            value={draft.projectId ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                projectId: e.target.value === '' ? null : Number(e.target.value),
                taskId: null,
              })
            }
            required
            disabled={editingLocked}
          >
            <MenuItem value="" disabled>
              Select a project…
            </MenuItem>
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>

          <Autocomplete
            options={tasks}
            // Driven by draft.taskId — derive the selected option each render
            // so the field stays in sync if the task list is refetched (e.g.
            // project change clears taskId to null).
            value={tasks.find((t) => t.id === draft.taskId) ?? null}
            onChange={(_, next) => setDraft({ ...draft, taskId: next?.id ?? null })}
            getOptionLabel={(t) => `${t.number} ${t.title}`}
            filterOptions={filterTaskOptions}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            disabled={draft.projectId == null || editingLocked}
            noOptionsText={
              tasks.length === 0
                ? 'This project has no tasks yet.'
                : 'No matching tasks.'
            }
            renderOption={(props, t) => {
              // MUI 5 wants `key` extracted from props (it's spread into <li>).
              const { key, ...liProps } = props as typeof props & { key: string };
              return (
                <li key={key} {...liProps}>
                  <span style={{ fontFamily: 'Menlo, monospace', fontSize: 12, marginRight: 8 }}>
                    {t.number}
                  </span>
                  {t.title}
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Task"
                size="small"
                required
                helperText={
                  draft.projectId == null
                    ? 'Select a project first'
                    : tasks.length === 0
                      ? 'This project has no tasks yet — create one in the project detail page.'
                      : 'Type a task number or title to filter.'
                }
              />
            )}
          />

          <TextField
            label="Description"
            size="small"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            multiline
            minRows={2}
            fullWidth
            disabled={editingLocked}
          />

          <DatePicker
            label="Date"
            value={dayjs(draft.workDate)}
            onChange={(v: Dayjs | null) =>
              v && setDraft({ ...draft, workDate: v.format('YYYY-MM-DD') })
            }
            format={CZ_DATE_FORMAT}
            disabled={editingLocked}
            slotProps={{
              textField: {
                size: 'small',
                required: true,
                error: dateLocked,
                helperText: dateLocked ? `Locked through ${lockedThrough}` : undefined,
                sx: { alignSelf: 'flex-start', minWidth: 200 },
              },
            }}
          />

          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Tracked (hours)"
              type="number"
              size="small"
              value={draft.hours}
              onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
              inputProps={{ min: 0, step: 0.25 }}
              required
              sx={{ flex: 1 }}
              helperText="The actual time you spent on this task."
              disabled={editingLocked}
            />
            <TextField
              label="Reported (hours)"
              type="number"
              size="small"
              value={draft.reportedHours}
              onChange={(e) => setDraft({ ...draft, reportedHours: e.target.value })}
              inputProps={{ min: 0, step: 0.25 }}
              sx={{ flex: 1 }}
              placeholder="same as tracked"
              helperText={
                reportedMinutes != null && reportedMinutes !== minutes
                  ? `Billed value (differs from tracked).`
                  : 'Defaults to tracked when empty.'
              }
              disabled={editingLocked}
            />
          </Box>

          {minutes > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Tracked = {minutes} min
              {reportedMinutes != null && reportedMinutes !== minutes
                ? ` · Reported = ${reportedMinutes} min`
                : ''}
            </Typography>
          )}

          {isEdit && worklog.externalId && (
            <TextField
              label="External ID"
              size="small"
              value={worklog.externalId}
              disabled
              sx={{ '& input': { fontFamily: 'Menlo, monospace', fontSize: 12 } }}
              helperText="Read-only — preserves the origin of this worklog. Re-import by deleting + recreating."
            />
          )}
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2.5,
            py: 1.5,
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          {isEdit && onDelete && (
            <Button
              variant="text"
              color="error"
              onClick={async () => {
                await onDelete();
                onClose();
              }}
              disabled={submitting || editingLocked}
              title={editingLocked ? `Locked through ${lockedThrough}` : undefined}
            >
              Delete
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? 'Saving…' : isEdit ? 'Save' : 'Log work'}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}
