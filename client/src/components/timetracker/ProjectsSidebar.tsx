import {
  Alert,
  Box,
  Button,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import StarIcon from '@mui/icons-material/Star';
import type { ProjectViewPayload } from '../../../../shared/ipcContract.js';

interface Props {
  projects: ProjectViewPayload[];
  selectedId: number | null;
  search: string;
  onSearchChange(next: string): void;
  onSelect(projectId: number): void;
  onCreate(): void;
  loading: boolean;
  error: string | null;
}

function formatHours(minutes: number): string {
  if (minutes <= 0) return '0h';
  const h = Math.round(minutes / 60);
  return `${h}h`;
}

/**
 * Left pane of the Projects page. Lists every active project as a
 * coloured-dot row with the user's total hours; clicking a row swaps the
 * detail pane on the right. A pinned "+ New project" button sits at the
 * top so creating a new one is one click from anywhere.
 */
export function ProjectsSidebar({
  projects,
  selectedId,
  search,
  onSearchChange,
  onSelect,
  onCreate,
  loading,
  error,
}: Props) {
  return (
    <Box
      sx={{
        width: 280,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.default',
        minHeight: 0,
      }}
    >
      <Stack spacing={1.25} sx={{ px: 1.5, pt: 1.5, pb: 1 }}>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onCreate}
          fullWidth
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          New project
        </Button>
        <TextField
          size="small"
          placeholder="Search projects"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: 'text.disabled' }} />
              </InputAdornment>
            ),
          }}
          fullWidth
        />
      </Stack>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 0.75, pb: 1 }}>
        {error && (
          <Alert severity="error" sx={{ mx: 0.75, mb: 1 }}>
            {error}
          </Alert>
        )}
        {!loading && projects.length === 0 && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              textAlign: 'center',
              color: 'text.secondary',
              mt: 3,
              fontStyle: 'italic',
            }}
          >
            {search.trim() ? 'No matches.' : 'No projects yet.'}
          </Typography>
        )}
        <Stack spacing={0.25}>
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              selected={p.id === selectedId}
              onClick={() => onSelect(p.id)}
            />
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

function ProjectRow({
  project,
  selected,
  onClick,
}: {
  project: ProjectViewPayload;
  selected: boolean;
  onClick(): void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'grid',
        gridTemplateColumns: '14px minmax(0, 1fr) auto auto',
        gap: 1,
        alignItems: 'center',
        px: 1.25,
        py: 1,
        borderRadius: 1,
        cursor: 'pointer',
        bgcolor: selected ? 'action.selected' : 'transparent',
        '&:hover': {
          bgcolor: selected ? 'action.selected' : 'action.hover',
        },
      }}
    >
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: project.color,
        }}
      />
      <Typography
        variant="body2"
        sx={{ fontWeight: selected ? 600 : 500, color: 'text.primary' }}
        noWrap
      >
        {project.name}
      </Typography>
      {project.isDefault ? (
        <StarIcon sx={{ fontSize: 14, color: 'warning.main' }} />
      ) : (
        <Box sx={{ width: 14 }} />
      )}
      <Typography
        variant="caption"
        sx={{
          color: 'text.secondary',
          fontVariantNumeric: 'tabular-nums',
          minWidth: 32,
          textAlign: 'right',
        }}
      >
        {formatHours(project.totalMinutes)}
      </Typography>
    </Box>
  );
}
