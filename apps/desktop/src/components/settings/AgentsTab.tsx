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
import { useAgents } from '../../state/useAgents.js';
import type { AgentRowPayload } from '@watchtower/shared/ipcContract.js';

export function AgentsTab() {
  const state = useAgents();
  const [search, setSearch] = useState('');
  const [activeSource, setActiveSource] = useState<string | 'all'>('all');
  const [selected, setSelected] = useState<AgentRowPayload | null>(null);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const a of state.agents) set.add(a.source);
    return ['all', ...Array.from(set)];
  }, [state.agents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.agents.filter((a) => {
      if (activeSource !== 'all' && a.source !== activeSource) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
    });
  }, [state.agents, search, activeSource]);

  useMemo(() => {
    if (filtered.length > 0 && (!selected || !filtered.some((a) => a.path === selected.path))) {
      setSelected(filtered[0] ?? null);
    } else if (filtered.length === 0 && selected) {
      setSelected(null);
    }
  }, [filtered, selected]);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
          placeholder="Search agents…"
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
              label={src === 'all' ? `All (${state.agents.length})` : src}
              size="small"
              variant={activeSource === src ? 'filled' : 'outlined'}
              color={activeSource === src ? 'primary' : 'default'}
              onClick={() => setActiveSource(src)}
            />
          ))}
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {filtered.length} of {state.agents.length}
        </Typography>
        <Tooltip title="Re-scan ~/.claude/agents + plugin agents">
          <span>
            <IconButton size="small" onClick={() => void state.refresh()} disabled={state.loading}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Box sx={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <Box sx={{ width: 340, borderRight: 1, borderColor: 'divider', overflow: 'auto' }}>
          {state.loading && (
            <Stack spacing={1} sx={{ p: 1.5 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} variant="rounded" height={56} />
              ))}
            </Stack>
          )}
          {state.error && (
            <Alert severity="error" sx={{ m: 1.5 }}>
              {state.error}
            </Alert>
          )}
          {!state.loading && !state.error && filtered.length === 0 && (
            <Box sx={{ p: 3, color: 'text.disabled', textAlign: 'center', fontSize: 13 }}>
              No agents match the current filter.
            </Box>
          )}
          <List dense disablePadding>
            {filtered.map((agent) => (
              <ListItemButton
                key={agent.path}
                selected={selected?.path === agent.path}
                onClick={() => setSelected(agent)}
                sx={{ alignItems: 'flex-start', py: 1, borderBottom: 1, borderColor: 'divider' }}
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
                      {agent.name}
                    </Typography>
                    {agent.model && (
                      <Chip
                        label={agent.model}
                        size="small"
                        sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }}
                      />
                    )}
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
                    {agent.description || <em>(no description)</em>}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    sx={{ display: 'block', mt: 0.25, fontSize: 10.5 }}
                  >
                    {agent.source}
                  </Typography>
                </Box>
              </ListItemButton>
            ))}
          </List>
        </Box>

        <Box sx={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          {selected ? (
            <Box sx={{ p: 2 }}>
              <Stack spacing={0.5} sx={{ mb: 2 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="h6" sx={{ fontFamily: 'Menlo, monospace', fontSize: 15 }}>
                    {selected.name}
                  </Typography>
                  <Chip label={selected.source} size="small" variant="outlined" />
                  {selected.model && <Chip label={selected.model} size="small" />}
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

              {/* Frontmatter summary table */}
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Frontmatter
                </Typography>
                <FrontmatterRow label="model" value={selected.model || '(unset — uses default)'} />
                <FrontmatterRow label="tools" value={selected.tools || '(all)'} />
              </Box>

              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Prompt
              </Typography>
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
              Select an agent to preview its definition.
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function FrontmatterRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={2} sx={{ py: 0.25 }}>
      <Typography
        sx={{ fontFamily: 'Menlo, monospace', fontSize: 12, color: 'text.secondary', minWidth: 80 }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontFamily: 'Menlo, monospace', fontSize: 12 }}>{value}</Typography>
    </Stack>
  );
}
