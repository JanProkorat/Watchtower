import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import CheckIcon from '@mui/icons-material/Check';
import ChecklistRtlIcon from '@mui/icons-material/ChecklistRtl';
import PushPinIcon from '@mui/icons-material/PushPin';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SyncIcon from '@mui/icons-material/Sync';
import type { NoteInputPayload, NotePriority, NoteViewPayload, ProjectViewPayload } from '@watchtower/shared/ipcContract.js';
import { CZ_DATE_FORMAT } from '../../util/format.js';

const PRIORITY_LABEL: Record<NotePriority, string> = {
  none: 'None',
  low: 'Low',
  med: 'Medium',
  high: 'High',
};

const PRIORITY_COLOR: Record<NotePriority, string> = {
  none: 'text.disabled',
  low: 'text.disabled',
  med: 'warning.main',
  high: 'error.main',
};

/** "12m ago" / "3h ago" / "5d ago" — kept local since it's a one-liner used only here. */
function relativeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const DEBOUNCE_MS = 400;

export function NoteEditor({
  note,
  projects,
  onChange,
  onDelete,
}: {
  note: NoteViewPayload | null;
  projects: ProjectViewPayload[];
  onChange(input: Partial<NoteInputPayload>): void;
  onDelete(): void;
}): JSX.Element {
  const theme = useTheme();
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [priorityAnchor, setPriorityAnchor] = useState<HTMLElement | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset local editing state whenever a different note is selected.
  useEffect(() => {
    setTitle(note?.title ?? '');
    setBody(note?.body ?? '');
  }, [note?.id]);

  useEffect(() => () => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    if (bodyTimer.current) clearTimeout(bodyTimer.current);
  }, []);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => onChange({ title: value }), DEBOUNCE_MS);
  };

  const handleBodyChange = (value: string) => {
    setBody(value);
    if (bodyTimer.current) clearTimeout(bodyTimer.current);
    bodyTimer.current = setTimeout(() => onChange({ body: value }), DEBOUNCE_MS);
  };

  const dueValue = useMemo(() => (note?.dueDate ? dayjs(note.dueDate) : null), [note?.dueDate]);

  if (!note) {
    return (
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.disabled',
          fontSize: 14,
        }}
      >
        Select or create a note
      </Box>
    );
  }

  const isTodo = note.done !== null;
  const isDone = note.done === 1;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2.25,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          flexWrap: 'wrap',
        }}
      >
        <ToolbarButton
          active={isTodo}
          onClick={() => onChange({ done: note.done === null ? 0 : null })}
          icon={<ChecklistRtlIcon sx={{ fontSize: 15 }} />}
          label="Todo"
        />

        <ToolbarButton
          onClick={(e) => setPriorityAnchor(e.currentTarget)}
          icon={
            note.priority !== 'none' ? (
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: PRIORITY_COLOR[note.priority] }} />
            ) : undefined
          }
          label={`Priority: ${PRIORITY_LABEL[note.priority]}`}
        />
        <Menu anchorEl={priorityAnchor} open={Boolean(priorityAnchor)} onClose={() => setPriorityAnchor(null)}>
          {(['none', 'low', 'med', 'high'] as NotePriority[]).map((p) => (
            <MenuItem
              key={p}
              selected={p === note.priority}
              onClick={() => {
                onChange({ priority: p });
                setPriorityAnchor(null);
              }}
            >
              {PRIORITY_LABEL[p]}
            </MenuItem>
          ))}
        </Menu>

        <DatePicker
          value={dueValue}
          onChange={(v: Dayjs | null) => onChange({ dueDate: v ? v.format('YYYY-MM-DD') : null })}
          format={CZ_DATE_FORMAT}
          label="Due"
          slotProps={{
            textField: { size: 'small', sx: { width: 150 } },
            field: { clearable: true },
          }}
        />

        <Select
          size="small"
          value={note.projectId ?? ''}
          displayEmpty
          onChange={(e) => onChange({ projectId: e.target.value === '' ? null : Number(e.target.value) })}
          sx={{ minWidth: 140, fontSize: 12.5 }}
        >
          <MenuItem value="">🌐 Global</MenuItem>
          {projects.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </Select>

        <Box sx={{ flex: 1 }} />

        <ToolbarButton
          active={note.pinned}
          activeColor="warning"
          onClick={() => onChange({ pinned: !note.pinned })}
          icon={<PushPinIcon sx={{ fontSize: 14 }} />}
          label="Pinned"
        />
        <IconButton
          size="small"
          onClick={() => {
            if (window.confirm(`Delete "${note.title || 'Untitled'}"? This can't be undone.`)) onDelete();
          }}
          sx={{ color: 'text.secondary', ':hover': { color: 'error.main', backgroundColor: alpha(theme.palette.error.main, 0.12) } }}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ overflowY: 'auto', flex: 1, px: 3.75, py: 2.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 0.75 }}>
          <Box
            onClick={() => onChange({ done: note.done === null ? 0 : isDone ? 0 : 1 })}
            sx={{
              width: 24,
              height: 24,
              mt: 0.5,
              flexShrink: 0,
              borderRadius: '7px',
              border: '2px solid',
              borderColor: isDone ? 'success.main' : 'text.disabled',
              backgroundColor: isDone ? 'success.main' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              visibility: note.done === null ? 'hidden' : 'visible',
              cursor: 'pointer',
            }}
          >
            {isDone && <CheckIcon sx={{ fontSize: 15, color: '#04220f' }} />}
          </Box>
          <InputBase
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Untitled"
            sx={{
              flex: 1,
              fontSize: 24,
              fontWeight: 700,
              color: isDone ? 'text.disabled' : 'text.primary',
              textDecoration: isDone ? 'line-through' : 'none',
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, color: 'text.disabled', fontSize: 11.5, mb: 2.5 }}>
          {note.projectId != null && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.875,
                py: 0.25,
                borderRadius: 999,
                backgroundColor: alpha(note.projectColor ?? theme.palette.primary.main, 0.16),
                color: note.projectColor ?? theme.palette.primary.main,
                fontWeight: 600,
              }}
            >
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: note.projectColor ?? theme.palette.primary.main }} />
              {note.projectName}
            </Box>
          )}
          <span>Updated {relativeAgo(note.updatedAt)}</span>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'primary.main' }}>
            <SyncIcon sx={{ fontSize: 12 }} />
            Synced
          </Box>
        </Box>

        <TextField
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          placeholder="Write in markdown…"
          multiline
          minRows={4}
          fullWidth
          sx={{ mb: 2.5, '& textarea': { fontSize: 13.5, fontFamily: 'ui-monospace, Menlo, monospace' } }}
        />

        <Box
          sx={{
            fontSize: 14,
            lineHeight: 1.65,
            color: 'text.secondary',
            maxWidth: 660,
            '& h1, & h2, & h3': { color: 'text.primary', fontWeight: 650 },
            '& code': {
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 12.5,
              backgroundColor: 'action.selected',
              px: 0.75,
              py: 0.125,
              borderRadius: 0.75,
              color: 'info.main',
            },
            '& pre': {
              backgroundColor: 'action.selected',
              borderRadius: 1.5,
              p: 1.5,
              overflowX: 'auto',
            },
            '& pre code': { backgroundColor: 'transparent', p: 0 },
            '& a': { color: 'primary.main' },
            '& blockquote': {
              borderLeft: '3px solid',
              borderColor: 'divider',
              m: 0,
              pl: 1.75,
              color: 'text.secondary',
            },
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </Box>
      </Box>
    </Box>
  );
}

function ToolbarButton({
  active,
  activeColor = 'primary',
  onClick,
  icon,
  label,
}: {
  active?: boolean;
  activeColor?: 'primary' | 'warning';
  onClick(e: React.MouseEvent<HTMLElement>): void;
  icon?: React.ReactNode;
  label: string;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        fontSize: 12,
        fontWeight: 600,
        color: active ? (activeColor === 'warning' ? 'warning.main' : 'primary.main') : 'text.secondary',
        backgroundColor: (t) =>
          active
            ? alpha(t.palette[activeColor].main, t.palette.mode === 'dark' ? 0.18 : 0.12)
            : 'action.hover',
        border: '1px solid',
        borderColor: (t) =>
          active ? alpha(t.palette[activeColor].main, 0.4) : 'divider',
        borderRadius: 2,
        px: 1.375,
        py: 0.75,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {icon}
      {label}
    </Box>
  );
}
