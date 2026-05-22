import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

const RECENT_KEY = 'watchtower.recent-cwds';
const MAX_RECENT = 8;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function pushRecent(cwd: string): void {
  try {
    const next = [cwd, ...readRecent().filter((c) => c !== cwd)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private browsing or quota — best effort */
  }
}

interface Props {
  open: boolean;
  defaultCwd?: string;
  onClose(): void;
  onSpawn(cwd: string): void;
}

export function NewInstanceModal({ open, defaultCwd, onClose, onSpawn }: Props) {
  const [cwd, setCwd] = useState('');
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const list = readRecent();
    setRecent(list);
    setCwd(list[0] ?? defaultCwd ?? '');
  }, [open, defaultCwd]);

  const browse = async () => {
    const res = await window.watchtower.invoke('chooseDirectory', {
      defaultPath: cwd || defaultCwd || '~/Projects',
    });
    if (res.path) setCwd(res.path);
  };

  const submit = () => {
    const trimmed = cwd.trim();
    if (!trimmed) return;
    pushRecent(trimmed);
    onSpawn(trimmed);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New Claude Code instance</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Working directory"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              slotProps={{ input: { sx: { fontFamily: 'Menlo, monospace', fontSize: 13 } } }}
            />
            <Button variant="outlined" onClick={browse} sx={{ flexShrink: 0 }}>
              Browse…
            </Button>
          </Stack>
          {recent.length > 0 && (
            <Stack spacing={0.5}>
              <Typography
                variant="caption"
                color="text.disabled"
                sx={{ letterSpacing: 1.1, textTransform: 'uppercase' }}
              >
                Recent
              </Typography>
              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  maxHeight: 220,
                  overflow: 'auto',
                }}
              >
                <List dense disablePadding>
                  {recent.map((r) => (
                    <ListItemButton key={r} onClick={() => setCwd(r)} selected={r === cwd}>
                      <ListItemText
                        primary={r}
                        primaryTypographyProps={{
                          sx: { fontFamily: 'Menlo, monospace', fontSize: 12 },
                        }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Box>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={submit} variant="contained" disabled={!cwd.trim()}>
          Spawn
        </Button>
      </DialogActions>
    </Dialog>
  );
}
