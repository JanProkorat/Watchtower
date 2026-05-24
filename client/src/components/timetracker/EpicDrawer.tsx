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
import type { EpicInputPayload, EpicViewPayload } from '../../../../shared/ipcContract.js';

interface Props {
  open: boolean;
  /** The epic being edited, or null for create mode. */
  epic: EpicViewPayload | null;
  projectId: number;
  onClose(): void;
  onSubmit(input: EpicInputPayload): Promise<void>;
  onDelete?(): Promise<void>;
}

interface Draft {
  name: string;
  description: string;
  status: 'planned' | 'active' | 'done';
  jiraEpicKey: string;
  githubIssueUrl: string;
}

function emptyDraft(): Draft {
  return { name: '', description: '', status: 'planned', jiraEpicKey: '', githubIssueUrl: '' };
}

function draftOf(epic: EpicViewPayload | null): Draft {
  if (!epic) return emptyDraft();
  return {
    name: epic.name,
    description: epic.description ?? '',
    status: epic.status,
    jiraEpicKey: epic.jiraEpicKey ?? '',
    githubIssueUrl: epic.githubIssueUrl ?? '',
  };
}

export function EpicDrawer({ open, epic, projectId, onClose, onSubmit, onDelete }: Props) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(draftOf(epic));
      setError(null);
      setSubmitting(false);
    }
  }, [open, epic]);

  const isEdit = epic !== null;
  const canSubmit = draft.name.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        projectId,
        name: draft.name.trim(),
        description: draft.description.trim() ? draft.description.trim() : null,
        status: draft.status,
        jiraEpicKey: draft.jiraEpicKey.trim() ? draft.jiraEpicKey.trim() : null,
        githubIssueUrl: draft.githubIssueUrl.trim() ? draft.githubIssueUrl.trim() : null,
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
            {isEdit ? `Edit epic · ${epic.name}` : 'New epic'}
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
            label="Name"
            size="small"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            required
            fullWidth
            autoFocus
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

          <TextField
            select
            label="Status"
            size="small"
            value={draft.status}
            onChange={(e) =>
              setDraft({ ...draft, status: e.target.value as 'planned' | 'active' | 'done' })
            }
            fullWidth
          >
            <MenuItem value="planned">Planned</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="done">Done</MenuItem>
          </TextField>

          <TextField
            label="Jira Epic Link"
            size="small"
            value={draft.jiraEpicKey}
            onChange={(e) => setDraft({ ...draft, jiraEpicKey: e.target.value })}
            placeholder="WT-100"
            helperText="Optional · used by downstream sync logic"
            fullWidth
            sx={{ '& input': { fontFamily: 'Menlo, monospace', fontSize: 13 } }}
          />

          <TextField
            label="GitHub issue"
            size="small"
            value={draft.githubIssueUrl}
            onChange={(e) => setDraft({ ...draft, githubIssueUrl: e.target.value })}
            placeholder="https://github.com/JanProkorat/Watchtower/issues/12"
            fullWidth
          />
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
