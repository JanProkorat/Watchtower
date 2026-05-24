import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type {
  EpicViewPayload,
  TaskInputPayload,
  TaskViewPayload,
} from '../../../../shared/ipcContract.js';

interface Props {
  open: boolean;
  task: TaskViewPayload | null;
  defaultEpicId: number;
  epics: EpicViewPayload[];
  onClose(): void;
  onSubmit(input: TaskInputPayload): Promise<void>;
  onDelete?(): Promise<void>;
}

interface Draft {
  epicId: number;
  number: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'done';
  estimateHours: string;
}

function emptyDraft(defaultEpicId: number): Draft {
  return {
    epicId: defaultEpicId,
    number: '',
    title: '',
    description: '',
    status: 'open',
    estimateHours: '',
  };
}

function draftOf(task: TaskViewPayload | null, defaultEpicId: number): Draft {
  if (!task) return emptyDraft(defaultEpicId);
  return {
    epicId: task.epicId,
    number: task.number,
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    estimateHours:
      task.estimatedMinutes != null ? String(task.estimatedMinutes / 60) : '',
  };
}

export function TaskDrawer({
  open,
  task,
  defaultEpicId,
  epics,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultEpicId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(draftOf(task, defaultEpicId));
      setError(null);
      setSubmitting(false);
    }
  }, [open, task, defaultEpicId]);

  const isEdit = task !== null;
  const canSubmit =
    draft.title.trim().length > 0 && draft.number.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const estimateHoursNum = Number(draft.estimateHours);
      const estimatedMinutes =
        draft.estimateHours.trim() && Number.isFinite(estimateHoursNum) && estimateHoursNum > 0
          ? Math.round(estimateHoursNum * 60)
          : null;
      await onSubmit({
        epicId: draft.epicId,
        number: draft.number.trim(),
        title: draft.title.trim(),
        description: draft.description.trim() ? draft.description.trim() : null,
        status: draft.status,
        estimatedMinutes,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 440 } }}>
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
          <Typography variant="subtitle1" sx={{ fontWeight: 500, flex: 1 }}>
            {isEdit ? `Edit task · ${task.number}` : 'New task'}
          </Typography>
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

          <TextField
            select
            label="Epic"
            size="small"
            value={draft.epicId}
            onChange={(e) => setDraft({ ...draft, epicId: Number(e.target.value) })}
            fullWidth
          >
            {epics.map((e) => (
              <MenuItem key={e.id} value={e.id}>
                {e.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Key"
            size="small"
            value={draft.number}
            onChange={(e) => setDraft({ ...draft, number: e.target.value })}
            placeholder="WT-T39 or FIE1933-18887"
            helperText="Used as the worklog Jira key when the project has a matching glob"
            required
            fullWidth
            sx={{ '& input': { fontFamily: 'Menlo, monospace', fontSize: 13 } }}
          />

          <TextField
            label="Title"
            size="small"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            required
            fullWidth
          />

          <TextField
            label="Description"
            size="small"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            multiline
            minRows={3}
            fullWidth
          />

          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              select
              label="Status"
              size="small"
              value={draft.status}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  status: e.target.value as 'open' | 'in_progress' | 'done',
                })
              }
              sx={{ flex: 1 }}
            >
              <MenuItem value="open">To do</MenuItem>
              <MenuItem value="in_progress">Doing</MenuItem>
              <MenuItem value="done">Done</MenuItem>
            </TextField>

            <TextField
              label="Estimate (hours)"
              size="small"
              type="number"
              value={draft.estimateHours}
              onChange={(e) => setDraft({ ...draft, estimateHours: e.target.value })}
              inputProps={{ min: 0, step: 0.25 }}
              sx={{ flex: 1 }}
            />
          </Box>
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
              disabled={submitting}
            >
              Delete
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button variant="text" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? 'Saving…' : isEdit ? 'Save' : 'Create'}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}
