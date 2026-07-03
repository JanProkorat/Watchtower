import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Drawer,
  FormControlLabel,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import RemoveIcon from '@mui/icons-material/Close';
import type { ProjectInputPayload, ProjectViewPayload } from '@watchtower/shared/ipcContract.js';

const COLOR_PALETTE = [
  '#7aa7ff',
  '#f0a868',
  '#66bb6a',
  '#ef5350',
  '#ce93d8',
  '#4fc3f7',
  '#ffb74d',
  '#9e9e9e',
];

interface Props {
  open: boolean;
  /**
   * The project being edited, or null when the drawer is in create mode. The
   * drawer re-derives its form state from this prop whenever it transitions
   * from closed → open so reopening on a different project shows the right
   * starting values.
   */
  project: ProjectViewPayload | null;
  onClose(): void;
  onSubmit(input: ProjectInputPayload): Promise<void>;
}

interface DraftState {
  name: string;
  color: string;
  kind: 'work' | 'time_off';
  isDefault: boolean;
  folderPath: string;
  autoTrack: boolean;
  jiraGlobs: string[];
  jiraBoardUrl: string;
  taskUrlTemplate: string;
  description: string;
}

function emptyDraft(): DraftState {
  return {
    name: '',
    color: COLOR_PALETTE[0]!,
    kind: 'work',
    isDefault: false,
    folderPath: '',
    autoTrack: false,
    jiraGlobs: [],
    jiraBoardUrl: '',
    taskUrlTemplate: '',
    description: '',
  };
}

function draftOf(project: ProjectViewPayload | null): DraftState {
  if (!project) return emptyDraft();
  return {
    name: project.name,
    color: project.color,
    kind: project.kind,
    isDefault: project.isDefault,
    folderPath: project.folderPath ?? '',
    autoTrack: project.autoTrack,
    jiraGlobs: project.jiraGlobs.length > 0 ? project.jiraGlobs : [],
    jiraBoardUrl: project.jiraBoardUrl ?? '',
    taskUrlTemplate: project.taskUrlTemplate ?? '',
    description: project.description ?? '',
  };
}

export function ProjectDrawer({ open, project, onClose, onSubmit }: Props) {
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever the drawer is opened — guards against showing
  // stale state when the parent reuses the same drawer instance to edit a
  // different project.
  useEffect(() => {
    if (open) {
      setDraft(draftOf(project));
      setError(null);
      setSubmitting(false);
    }
  }, [open, project]);

  const isEdit = project !== null;
  const title = isEdit ? `Edit project · ${project!.name}` : 'New project';
  const canSubmit = draft.name.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(toInput(draft));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const pickFolder = async () => {
    const res = await window.watchtower.invoke('chooseDirectory', {
      defaultPath: draft.folderPath || undefined,
    });
    if (res.path) setDraft({ ...draft, folderPath: res.path });
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 480 } }}>
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
            {title}
          </Typography>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Box sx={{ flex: 1, overflow: 'auto', px: 2.5, py: 2.5, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
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

          <FormControlLabel
            control={
              <Checkbox
                checked={draft.isDefault}
                onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
              />
            }
            label="Default project"
            sx={{ mr: 0 }}
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={draft.autoTrack}
                onChange={(e) => setDraft({ ...draft, autoTrack: e.target.checked })}
              />
            }
            label="Auto-track time"
            sx={{ mr: 0 }}
          />

          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
              COLOR
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {COLOR_PALETTE.map((c) => (
                <SwatchButton
                  key={c}
                  color={c}
                  selected={draft.color === c}
                  onClick={() => setDraft({ ...draft, color: c })}
                />
              ))}
            </Box>
          </Box>

          <TextField
            select
            label="Kind"
            size="small"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'work' | 'time_off' })}
            helperText="Work projects are billable; Time off projects are not."
          >
            <MenuItem value="work">Work</MenuItem>
            <MenuItem value="time_off">Time off</MenuItem>
          </TextField>

          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
              LOCATION ON DISK
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                size="small"
                value={draft.folderPath}
                onChange={(e) => setDraft({ ...draft, folderPath: e.target.value })}
                placeholder="~/Projects/…"
                fullWidth
                sx={{ '& input': { fontFamily: 'Menlo, monospace', fontSize: 12 } }}
              />
              <Button variant="outlined" size="small" onClick={pickFolder}>
                Browse…
              </Button>
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
              Used by the Open in Instances bridge (Phase 21) and the Open in VS Code action.
            </Typography>
          </Box>

          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
              JIRA KEY MAPPING
            </Typography>
            <JiraGlobsEditor
              globs={draft.jiraGlobs}
              onChange={(next) => setDraft({ ...draft, jiraGlobs: next })}
            />
            <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}>
              Shell-style globs like <code>FIE1933-*</code>. Resolves Jira keys on worklog sync.
            </Typography>
          </Box>

          <TextField
            label="Jira board URL"
            size="small"
            value={draft.jiraBoardUrl}
            onChange={(e) => setDraft({ ...draft, jiraBoardUrl: e.target.value })}
            placeholder="https://jira.skoda.vwgroup.com/secure/RapidBoard.jspa?rapidView=…"
            helperText="Paste the full board URL. The board ID and quick filter (if any) are read automatically. Leave empty to hide from the Board tab."
            fullWidth
            sx={{ '& input': { fontFamily: 'Menlo, monospace', fontSize: 12 } }}
          />

          <TextField
            label="Task URL template"
            size="small"
            value={draft.taskUrlTemplate}
            onChange={(e) => setDraft({ ...draft, taskUrlTemplate: e.target.value })}
            placeholder="https://jira.skoda.vwgroup.com/browse/{n}"
            helperText="Used by the open-in-new icon next to task numbers. {n} is replaced by the task number. Leave empty to hide the icon."
            fullWidth
            sx={{ '& input': { fontFamily: 'Menlo, monospace', fontSize: 12 } }}
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
        </Box>

        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 1,
            px: 2.5,
            py: 1.5,
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
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

function SwatchButton({ color, selected, onClick }: { color: string; selected: boolean; onClick(): void }) {
  return (
    <Box
      role="button"
      aria-pressed={selected}
      aria-label={`Color ${color}`}
      onClick={onClick}
      sx={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        backgroundColor: color,
        cursor: 'pointer',
        border: '2px solid',
        borderColor: selected ? 'text.primary' : 'transparent',
        boxShadow: selected ? '0 0 0 2px rgba(255,255,255,0.06)' : 'none',
      }}
    />
  );
}

function JiraGlobsEditor({ globs, onChange }: { globs: string[]; onChange(next: string[]): void }) {
  // Always render at least one empty input so the "add" affordance is implicit
  // — the user types in the empty row and a new empty row appears.
  const rows = useMemo(() => (globs.length > 0 ? globs : ['']), [globs]);

  const setAt = (i: number, value: string) => {
    const next = rows.map((r, idx) => (idx === i ? value : r));
    // Strip trailing empty entries before persisting so the drawer doesn't
    // accumulate dead rows on every keystroke.
    while (next.length > 1 && next[next.length - 1] === '') next.pop();
    onChange(next.filter((s, idx) => s.trim() !== '' || idx === next.length - 1));
  };

  const removeAt = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    onChange(next.filter((s) => s.trim() !== ''));
  };

  const addEmpty = () => onChange([...globs, '']);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {rows.map((value, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 0.75 }}>
          <TextField
            size="small"
            value={value}
            onChange={(e) => setAt(i, e.target.value)}
            placeholder="FIE1933-*"
            fullWidth
            sx={{ '& input': { fontFamily: 'Menlo, monospace', fontSize: 12 } }}
          />
          <IconButton
            size="small"
            aria-label="Remove glob"
            onClick={() => removeAt(i)}
            disabled={rows.length === 1 && value === ''}
          >
            <RemoveIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Button
        size="small"
        startIcon={<AddIcon fontSize="small" />}
        onClick={addEmpty}
        sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
      >
        Add mapping
      </Button>
    </Box>
  );
}

function toInput(draft: DraftState): ProjectInputPayload {
  return {
    name: draft.name.trim(),
    color: draft.color,
    kind: draft.kind,
    isDefault: draft.isDefault,
    folderPath: draft.folderPath.trim() ? draft.folderPath.trim() : null,
    autoTrack: draft.autoTrack,
    jiraGlobs: draft.jiraGlobs.filter((g) => g.trim() !== ''),
    jiraBoardUrl: draft.jiraBoardUrl.trim() ? draft.jiraBoardUrl.trim() : null,
    taskUrlTemplate: draft.taskUrlTemplate.trim() ? draft.taskUrlTemplate.trim() : null,
    description: draft.description.trim() ? draft.description.trim() : null,
  };
}
