import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import LaunchIcon from '@mui/icons-material/Launch';
import type {
  BoardCardPayload,
  WorklogViewPayload,
} from '../../../../shared/ipcContract.js';
import { formatDateShortCz } from '../../util/format.js';
import { areaCodeColours, areaCodeFromComponent } from './boardChips.js';

interface Props {
  open: boolean;
  card: BoardCardPayload | null;
  jiraBaseUrl: string | null;
  onClose(): void;
  /** Open the Jira ticket in the system browser. */
  onOpenJira(url: string): void;
}

function formatMinutes(min: number): string {
  if (min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatEstimate(secs: number | null): string {
  if (secs == null || secs <= 0) return '—';
  return formatMinutes(Math.round(secs / 60));
}

export function BoardTaskDetailDrawer({
  open,
  card,
  jiraBaseUrl,
  onClose,
  onOpenJira,
}: Props) {
  const [worklogs, setWorklogs] = useState<WorklogViewPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !card) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.watchtower
      .invoke('worklogs:list', { taskId: card.taskId })
      .then((res) => {
        if (cancelled) return;
        // Most recent worklogs first.
        const sorted = [...res.worklogs].sort((a, b) =>
          a.workDate < b.workDate ? 1 : a.workDate > b.workDate ? -1 : b.id - a.id,
        );
        setWorklogs(sorted);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, card]);

  if (!card) {
    return (
      <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 540 } }}>
        <Box sx={{ p: 3 }} />
      </Drawer>
    );
  }

  const chipColours = areaCodeColours(areaCodeFromComponent(card.component));
  const totalLogged = worklogs.reduce((sum, w) => sum + w.minutes, 0) || card.loggedMinutes;

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 540 } }}>
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Stack spacing={0.5}>
            <Typography
              variant="caption"
              sx={{ fontFamily: 'ui-monospace, Menlo, monospace', color: 'text.secondary', fontWeight: 600 }}
            >
              {card.jiraKey}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
              {card.title}
            </Typography>
          </Stack>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </Stack>

        {/* Meta row: status, component chip, project, epic */}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          <Chip size="small" label={card.jiraStatus} variant="outlined" />
          {card.component && (
            <Box
              sx={{
                fontSize: 11,
                fontWeight: 600,
                px: 1,
                py: '2px',
                borderRadius: 1,
                bgcolor: chipColours.bg,
                color: chipColours.fg,
                letterSpacing: '0.02em',
              }}
            >
              {card.component}
            </Box>
          )}
          <Typography variant="caption" color="text.secondary">
            · {card.projectName} / {card.epicName}
          </Typography>
        </Stack>

        {/* Open in Jira */}
        {jiraBaseUrl && (
          <Button
            size="small"
            startIcon={<LaunchIcon sx={{ fontSize: 16 }} />}
            onClick={() => onOpenJira(`${jiraBaseUrl}/browse/${card.jiraKey}`)}
            sx={{ alignSelf: 'flex-start', mb: 2 }}
          >
            Open in Jira
          </Button>
        )}

        <Divider sx={{ mb: 2 }} />

        {/* Time totals */}
        <Stack direction="row" spacing={3} sx={{ mb: 2.5 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Logged
            </Typography>
            <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatMinutes(totalLogged)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Estimate
            </Typography>
            <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatEstimate(card.estimateSeconds)}
            </Typography>
          </Box>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        {/* Worklogs */}
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
          Worklogs ({worklogs.length})
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

        {loading && (
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 2 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">Loading worklogs…</Typography>
          </Stack>
        )}

        {!loading && worklogs.length === 0 && !error && (
          <Typography variant="body2" color="text.disabled" sx={{ py: 2, fontStyle: 'italic' }}>
            No worklogs yet.
          </Typography>
        )}

        {!loading && worklogs.length > 0 && (
          <Box sx={{ flex: 1, overflowY: 'auto', mx: -1 }}>
            {worklogs.map((w) => (
              <Stack
                key={w.id}
                direction="row"
                spacing={1.5}
                sx={{
                  px: 1,
                  py: 1,
                  borderBottom: 1,
                  borderColor: 'divider',
                  '&:last-of-type': { borderBottom: 0 },
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ minWidth: 72, fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}
                >
                  {formatDateShortCz(w.workDate)}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ minWidth: 56, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                >
                  {formatMinutes(w.minutes)}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1, color: 'text.primary' }}>
                  {w.description ?? <Box component="span" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>(no description)</Box>}
                </Typography>
              </Stack>
            ))}
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
