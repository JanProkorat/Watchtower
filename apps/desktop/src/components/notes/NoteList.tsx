import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import ChecklistRtlIcon from '@mui/icons-material/ChecklistRtl';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type { NoteViewPayload, ProjectViewPayload } from '@watchtower/shared/ipcContract.js';
import type { NotesFilter, NoteScope } from '../../state/useNotes.js';
import { splitNotes } from './noteSort.js';
import { NoteRow } from './NoteRow.js';

export function NoteList({
  notes,
  selectedId,
  onSelect,
  onToggleDone,
  onNew,
  filter,
  setFilter,
  projects,
}: {
  notes: NoteViewPayload[];
  selectedId: number | null;
  onSelect(id: number): void;
  onToggleDone(id: number): void;
  onNew(): void;
  filter: NotesFilter;
  setFilter(next: Partial<NotesFilter>): void;
  projects: ProjectViewPayload[];
}): JSX.Element {
  const [completedOpen, setCompletedOpen] = useState(true);
  const { open, completed } = splitNotes(notes);

  const handleScopeChange = (_e: unknown, next: NoteScope | null) => {
    if (!next) return;
    if (next === 'project') {
      setFilter({ scope: 'project', projectId: filter.projectId ?? projects[0]?.id ?? null });
    } else {
      setFilter({ scope: next, projectId: null });
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Box sx={{ px: 1.5, pt: 1.5, pb: 1, display: 'flex', flexDirection: 'column', gap: 1.125 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 650, flex: 1 }}>Notes</Typography>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon sx={{ fontSize: 14 }} />}
            onClick={onNew}
            sx={{ fontSize: 12, py: 0.5 }}
          >
            New
          </Button>
        </Box>

        <TextField
          size="small"
          placeholder="Search notes…"
          value={filter.search}
          onChange={(e) => setFilter({ search: e.target.value })}
          InputProps={{
            startAdornment: <SearchIcon sx={{ fontSize: 15, color: 'text.disabled', mr: 0.75 }} />,
          }}
        />

        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter.scope}
          onChange={handleScopeChange}
          fullWidth
          sx={{ '& .MuiToggleButton-root': { fontSize: 11.5, fontWeight: 600, py: 0.5 } }}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="global">🌐 Global</ToggleButton>
          <ToggleButton value="project">Projects</ToggleButton>
        </ToggleButtonGroup>

        {filter.scope === 'project' && (
          <Select
            size="small"
            value={filter.projectId ?? ''}
            displayEmpty
            onChange={(e) => setFilter({ projectId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <MenuItem value="" disabled>
              Select a project
            </MenuItem>
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
        )}

        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          <Chip
            size="small"
            icon={<ChecklistRtlIcon sx={{ fontSize: '13px !important' }} />}
            label="Open todos"
            onClick={() => setFilter({ openTodosOnly: !filter.openTodosOnly })}
            color={filter.openTodosOnly ? 'success' : 'default'}
            variant={filter.openTodosOnly ? 'filled' : 'outlined'}
            sx={{ fontSize: 11 }}
          />
          <Chip
            size="small"
            label="Due soon"
            onClick={() => setFilter({ dueSoon: !filter.dueSoon })}
            color={filter.dueSoon ? 'success' : 'default'}
            variant={filter.dueSoon ? 'filled' : 'outlined'}
            sx={{ fontSize: 11 }}
          />
        </Box>
      </Box>

      <Box sx={{ overflowY: 'auto', flex: 1, px: 1, pb: 1.5 }}>
        {notes.length === 0 && (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center', mt: 4 }}>
            No notes match this filter.
          </Typography>
        )}
        {open.map((n) => (
          <NoteRow
            key={n.id}
            note={n}
            selected={n.id === selectedId}
            onSelect={() => onSelect(n.id)}
            onToggleDone={() => onToggleDone(n.id)}
          />
        ))}

        {completed.length > 0 && (
          <>
            <Box
              onClick={() => setCompletedOpen((v) => !v)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                fontSize: 10,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: 'text.disabled',
                px: 0.75,
                py: 0.75,
                cursor: 'pointer',
              }}
            >
              {completedOpen ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
              Completed · {completed.length}
            </Box>
            {completedOpen &&
              completed.map((n) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  selected={n.id === selectedId}
                  onSelect={() => onSelect(n.id)}
                  onToggleDone={() => onToggleDone(n.id)}
                />
              ))}
          </>
        )}
      </Box>
    </Box>
  );
}
