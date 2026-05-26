import { useMemo, useState } from 'react';
import { BoardTaskDetailDrawer } from './BoardTaskDetailDrawer.js';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import LaunchIcon from '@mui/icons-material/Launch';
import ScheduleIcon from '@mui/icons-material/Schedule';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useBoard } from '../../state/useBoard.js';
import { useToast } from '../../state/useToast.js';
import { areaCodeColours, areaCodeFromComponent } from './boardChips.js';
import type {
  BoardCardPayload,
  BoardColumn,
} from '../../../../shared/ipcContract.js';

const COLUMNS: Array<{ id: BoardColumn; label: string }> = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
];

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatCardTime(loggedMin: number, estimateSecs: number | null): string | null {
  const estimateMin = estimateSecs == null ? null : Math.round(estimateSecs / 60);
  if (loggedMin > 0 && estimateMin != null && estimateMin > 0) {
    return `${formatMinutes(loggedMin)} / ${formatMinutes(estimateMin)}`;
  }
  if (loggedMin > 0) return formatMinutes(loggedMin);
  if (estimateMin != null && estimateMin > 0) return formatMinutes(estimateMin);
  return null;
}

function formatSynced(iso: string | null): string {
  if (!iso) return 'Never synced';
  const d = new Date(iso);
  return `Synced ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface Props {
  active: boolean;
}

export function BoardTab({ active }: Props) {
  const { snapshot, auth, syncing, syncError, lastSyncResult, sync, signInAndSync } =
    useBoard(active);
  const [selectedCard, setSelectedCard] = useState<BoardCardPayload | null>(null);
  const { showError } = useToast();

  const byCol = useMemo(() => {
    const map: Record<BoardColumn, BoardCardPayload[]> = { todo: [], doing: [], done: [] };
    snapshot?.cards.forEach((c) => map[c.column].push(c));
    return map;
  }, [snapshot]);

  const openInBrowser = (url: string) => {
    void window.watchtower
      .invoke('openExternalUrl', { url })
      .catch((err: unknown) => showError(err instanceof Error ? err.message : String(err)));
  };

  const handleClickCard = (c: BoardCardPayload) => {
    setSelectedCard(c);
  };

  const handleBoardLink = () => {
    if (!auth?.baseUrl) return;
    openInBrowser(`${auth.baseUrl}/secure/RapidBoard.jspa?rapidView=51682`);
  };

  const unrouted = lastSyncResult?.unroutedKeys ?? snapshot?.lastSyncResult?.unroutedKeys ?? [];
  const reauthenticated =
    lastSyncResult?.neededBrowserRefresh ??
    snapshot?.lastSyncResult?.neededBrowserRefresh ??
    false;
  // A stored cookie that Jira just rejected is functionally "signed out" —
  // show the Sign-in button instead of Refresh so the action matches the
  // error message.
  const authFailed =
    lastSyncResult?.authFailed ?? snapshot?.lastSyncResult?.authFailed ?? false;
  const showSignIn = !auth?.cookiePresent || authFailed;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, p: 2, gap: 2 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Board</Typography>
        {auth?.baseUrl && (
          <Button
            size="small"
            onClick={handleBoardLink}
            startIcon={<LaunchIcon sx={{ fontSize: 16 }} />}
          >
            Open in Jira
          </Button>
        )}
        <Typography variant="caption" color="text.secondary">·</Typography>
        <Typography variant="caption" color="text.secondary">
          <ScheduleIcon sx={{ fontSize: 13, verticalAlign: -2, mr: 0.5 }} />
          {showSignIn
            ? authFailed
              ? 'Session expired'
              : 'Not signed in'
            : formatSynced(snapshot?.syncedAt ?? null)}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {reauthenticated && <Chip size="small" color="info" label="Re-authenticated" />}
        {showSignIn ? (
          <Button
            variant="contained"
            size="small"
            onClick={() => void signInAndSync()}
            disabled={syncing}
            startIcon={syncing ? <CircularProgress size={14} /> : <VpnKeyIcon />}
          >
            {syncing ? 'Waiting for sign-in…' : 'Sign in to Jira'}
          </Button>
        ) : (
          <Button
            variant="contained"
            size="small"
            onClick={() => void sync()}
            disabled={syncing}
            startIcon={syncing ? <CircularProgress size={14} /> : <RefreshIcon />}
          >
            {syncing ? 'Syncing…' : 'Refresh'}
          </Button>
        )}
      </Stack>

      {syncError && <Alert severity="error">{syncError}</Alert>}

      {unrouted.length > 0 && (
        <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />}>
          <strong>
            {unrouted.length} {unrouted.length === 1 ? 'ticket' : 'tickets'} couldn't be slotted into any local project.
          </strong>
          <Box sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, mt: 0.5 }}>
            {unrouted.join(', ')} · Add a matching glob to a project's Jira keys to include them.
          </Box>
        </Alert>
      )}

      {/* Columns */}
      <Box
        sx={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 2,
          minHeight: 0,
        }}
      >
        {COLUMNS.map((col) => (
          <Box
            key={col.id}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{
                px: 1.5,
                py: 1.25,
                fontSize: 11.5,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                fontWeight: 600,
                color: 'text.secondary',
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'background.default',
              }}
            >
              <span>{col.label}</span>
              <Chip size="small" label={byCol[col.id].length} sx={{ height: 20, fontSize: 11 }} />
            </Stack>
            <Box
              sx={{
                flex: 1,
                p: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                overflowY: 'auto',
              }}
            >
              {byCol[col.id].length === 0 && (
                <Typography
                  variant="caption"
                  color="text.disabled"
                  sx={{ textAlign: 'center', py: 3, fontStyle: 'italic' }}
                >
                  Nothing here
                </Typography>
              )}
              {byCol[col.id].map((c) => {
                const code = areaCodeFromComponent(c.component);
                const { bg, fg } = areaCodeColours(code);
                const timeLabel = formatCardTime(c.loggedMinutes, c.estimateSeconds);
                const timeTooltip = c.estimateSeconds
                  ? `Logged ${formatMinutes(c.loggedMinutes)} / estimate ${formatMinutes(
                      Math.round(c.estimateSeconds / 60),
                    )}`
                  : `Logged ${formatMinutes(c.loggedMinutes)}`;
                return (
                  <Box
                    key={c.taskId}
                    onClick={() => handleClickCard(c)}
                    sx={{
                      bgcolor: 'background.default',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1.25,
                      px: 1.25,
                      py: 1,
                      cursor: 'pointer',
                      transition: 'border-color 120ms, transform 120ms',
                      '&:hover': { borderColor: 'primary.main', transform: 'translateY(-1px)' },
                    }}
                  >
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      sx={{ mb: 0.5 }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontWeight: 600 }}
                        title={`Jira status: ${c.jiraStatus}`}
                      >
                        {c.jiraKey}
                      </Typography>
                      {timeLabel && (
                        <Typography
                          variant="caption"
                          color="text.disabled"
                          title={timeTooltip}
                        >
                          ⏱ {timeLabel}
                        </Typography>
                      )}
                    </Stack>
                    <Typography
                      variant="body2"
                      sx={{
                        lineHeight: 1.35,
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        mb: c.component ? 0.75 : 0,
                      }}
                    >
                      {c.title}
                    </Typography>
                    {c.component && (
                      <Box
                        sx={{
                          display: 'inline-block',
                          fontSize: 10.5,
                          fontWeight: 600,
                          px: 1,
                          py: '2px',
                          borderRadius: 1,
                          bgcolor: bg,
                          color: fg,
                          letterSpacing: '0.02em',
                        }}
                      >
                        {c.component}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>

      <BoardTaskDetailDrawer
        open={selectedCard !== null}
        card={selectedCard}
        jiraBaseUrl={auth?.baseUrl ?? null}
        onClose={() => setSelectedCard(null)}
        onOpenJira={openInBrowser}
      />
    </Box>
  );
}
