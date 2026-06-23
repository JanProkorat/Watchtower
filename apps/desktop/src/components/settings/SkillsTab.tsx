import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useSkills } from '../../state/useSkills.js';
import type { SkillRowPayload } from '@watchtower/shared/ipcContract.js';

export function SkillsTab() {
  const state = useSkills();
  const [search, setSearch] = useState('');
  const [activeSource, setActiveSource] = useState<string | 'all'>('all');
  const [selected, setSelected] = useState<SkillRowPayload | null>(null);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const s of state.skills) set.add(s.source);
    return ['all', ...Array.from(set)];
  }, [state.skills]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.skills.filter((s) => {
      if (activeSource !== 'all' && s.source !== activeSource) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    });
  }, [state.skills, search, activeSource]);

  // Auto-select first row when the filter list changes so the preview is
  // never empty when there's a candidate.
  useMemo(() => {
    if (filtered.length > 0 && (!selected || !filtered.some((s) => s.path === selected.path))) {
      setSelected(filtered[0] ?? null);
    } else if (filtered.length === 0 && selected) {
      setSelected(null);
    }
  }, [filtered, selected]);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}
      >
        <TextField
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills…"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ minWidth: 240 }}
        />

        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
          {sources.map((src) => (
            <Chip
              key={src}
              label={src === 'all' ? `All (${state.skills.length})` : src}
              size="small"
              variant={activeSource === src ? 'filled' : 'outlined'}
              color={activeSource === src ? 'primary' : 'default'}
              onClick={() => setActiveSource(src)}
            />
          ))}
        </Stack>

        <Box sx={{ flex: 1 }} />

        <Typography variant="caption" color="text.secondary">
          {filtered.length} of {state.skills.length}
        </Typography>
        <Tooltip title="Re-scan ~/.claude/skills + plugin skills">
          <span>
            <IconButton size="small" onClick={() => void state.refresh()} disabled={state.loading}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {/* Body: split list + preview */}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* List */}
        <Box sx={{ width: 340, borderRight: 1, borderColor: 'divider', overflow: 'auto' }}>
          {state.loading && (
            <Stack spacing={1} sx={{ p: 1.5 }}>
              <Skeleton variant="rounded" height={48} />
              <Skeleton variant="rounded" height={48} />
              <Skeleton variant="rounded" height={48} />
              <Skeleton variant="rounded" height={48} />
            </Stack>
          )}
          {state.error && (
            <Alert severity="error" sx={{ m: 1.5 }}>
              {state.error}
            </Alert>
          )}
          {!state.loading && !state.error && filtered.length === 0 && (
            <Box sx={{ p: 3, color: 'text.disabled', textAlign: 'center', fontSize: 13 }}>
              No skills match the current filter.
            </Box>
          )}
          <List dense disablePadding>
            {filtered.map((skill) => (
              <ListItemButton
                key={skill.path}
                selected={selected?.path === skill.path}
                onClick={() => setSelected(skill)}
                sx={{
                  alignItems: 'flex-start',
                  py: 1,
                  borderBottom: 1,
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.25 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {skill.name}
                    </Typography>
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {skill.description || <em>(no description)</em>}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    sx={{ display: 'block', mt: 0.25, fontSize: 10.5 }}
                  >
                    {skill.source}
                  </Typography>
                </Box>
              </ListItemButton>
            ))}
          </List>
        </Box>

        {/* Preview */}
        <Box sx={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          {selected ? (
            <Box sx={{ p: 2 }}>
              <Stack spacing={0.5} sx={{ mb: 2 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="h6" sx={{ fontFamily: 'Menlo, monospace', fontSize: 15 }}>
                    {selected.name}
                  </Typography>
                  <Chip label={selected.source} size="small" variant="outlined" />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {selected.description}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ fontFamily: 'Menlo, monospace', fontSize: 10.5, color: 'text.disabled' }}
                >
                  {selected.path}
                </Typography>
              </Stack>

              {/* Render the SKILL.md body as plain text. A markdown renderer
                  would be nicer but isn't on the dep list yet; this stays
                  legible because the structure is just headers + bullets. */}
              <Box
                component="pre"
                sx={{
                  fontFamily: 'Menlo, monospace',
                  fontSize: 12,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  m: 0,
                }}
              >
                {selected.body || '(empty)'}
              </Box>
            </Box>
          ) : (
            <Box sx={{ p: 6, color: 'text.disabled', textAlign: 'center', fontSize: 13 }}>
              Select a skill to preview its SKILL.md.
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
