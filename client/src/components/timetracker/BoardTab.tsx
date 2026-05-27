import { useEffect, useMemo, useState } from 'react';
import { BoardTaskDetailDrawer } from './BoardTaskDetailDrawer.js';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import LaunchIcon from '@mui/icons-material/Launch';
import ScheduleIcon from '@mui/icons-material/Schedule';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CloseIcon from '@mui/icons-material/Close';
import { useBoard } from '../../state/useBoard.js';
import { useToast } from '../../state/useToast.js';
import { epicColours } from './boardChips.js';
import type {
  BoardCardPayload,
  BoardColumn,
  ProjectViewPayload,
} from '../../../../shared/ipcContract.js';

const COLUMNS: Array<{ id: BoardColumn; label: string }> = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
];

const SELECTED_PROJECT_STORAGE_KEY = 'watchtower:board:selectedProjectId';

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

function readStoredProjectId(): number | null {
  try {
    const raw = window.localStorage.getItem(SELECTED_PROJECT_STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeStoredProjectId(id: number | null): void {
  try {
    if (id === null) window.localStorage.removeItem(SELECTED_PROJECT_STORAGE_KEY);
    else window.localStorage.setItem(SELECTED_PROJECT_STORAGE_KEY, String(id));
  } catch {
    /* localStorage may be unavailable; nothing to do */
  }
}

interface Props {
  active: boolean;
}

export function BoardTab({ active }: Props) {
  const [projectsWithBoard, setProjectsWithBoard] = useState<ProjectViewPayload[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(() =>
    readStoredProjectId(),
  );

  const { showError } = useToast();

  // Load the set of active projects that have a Jira board URL configured. We
  // do this every time the tab becomes active so a project edit in another
  // tab is picked up without a full page reload.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      setProjectsLoading(true);
      setProjectsError(null);
      try {
        const res = await window.watchtower.invoke('projects:list', { archived: false });
        if (cancelled) return;
        const withBoard = res.projects.filter(
          (p) => p.jiraBoardUrl !== null && p.jiraBoardUrl.trim() !== '',
        );
        setProjectsWithBoard(withBoard);
      } catch (err) {
        if (!cancelled) {
          setProjectsError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Reconcile the selected project with the list of projects-with-board.
  // If the stored selection points at a project that's been archived / had
  // its URL cleared, fall back to the first available; if there are none,
  // clear the selection entirely.
  useEffect(() => {
    if (projectsLoading) return;
    const stillValid =
      selectedProjectId !== null &&
      projectsWithBoard.some((p) => p.id === selectedProjectId);
    if (stillValid) return;
    const next = projectsWithBoard[0]?.id ?? null;
    setSelectedProjectId(next);
    writeStoredProjectId(next);
  }, [projectsLoading, projectsWithBoard, selectedProjectId]);

  const handleSelectProject = (id: number) => {
    setSelectedProjectId(id);
    writeStoredProjectId(id);
  };

  const selectedProject = useMemo(
    () => projectsWithBoard.find((p) => p.id === selectedProjectId) ?? null,
    [projectsWithBoard, selectedProjectId],
  );

  const { snapshot, auth, syncing, syncError, lastSyncResult, sync, signInAndSync, remove } =
    useBoard(active, selectedProjectId);

  const [selectedCard, setSelectedCard] = useState<BoardCardPayload | null>(null);

  const handleRemove = (taskId: number) => {
    void remove(taskId).catch((err: unknown) =>
      showError(err instanceof Error ? err.message : String(err)),
    );
  };

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
    if (!selectedProject?.jiraBoardUrl) return;
    openInBrowser(selectedProject.jiraBoardUrl);
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
  const syncWarning =
    lastSyncResult?.warning ?? snapshot?.lastSyncResult?.warning ?? null;

  // Empty state #1 — no projects have a board URL configured. Tell the user
  // where to set it and stop here; nothing else on this screen is useful
  // until at least one project has a URL.
  if (!projectsLoading && projectsWithBoard.length === 0) {
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, p: 2, gap: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Board</Typography>
        {projectsError && <Alert severity="error">{projectsError}</Alert>}
        <Alert severity="info">
          <strong>No Jira board configured.</strong>
          <Box sx={{ mt: 0.5 }}>
            Open the Projects tab, edit a project, and paste its Jira board URL into the
            <em> Jira board URL</em> field. The project will then appear in the selector here.
          </Box>
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, p: 2, gap: 2 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Board</Typography>
        <TextField
          select
          size="small"
          value={selectedProjectId ?? ''}
          onChange={(e) => handleSelectProject(Number(e.target.value))}
          sx={{ minWidth: 220 }}
          aria-label="Project"
        >
          {projectsWithBoard.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              <Box
                component="span"
                sx={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: p.color,
                  mr: 1,
                  verticalAlign: 'middle',
                }}
              />
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        {selectedProject?.jiraBoardUrl && (
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
            disabled={syncing || selectedProjectId === null}
            startIcon={syncing ? <CircularProgress size={14} /> : <RefreshIcon />}
          >
            {syncing ? 'Syncing…' : 'Refresh'}
          </Button>
        )}
      </Stack>

      {syncError && <Alert severity="error">{syncError}</Alert>}

      {syncWarning && <Alert severity="warning">{syncWarning}</Alert>}

      {unrouted.length > 0 && (
        <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />}>
          <strong>
            {unrouted.length} {unrouted.length === 1 ? 'ticket' : 'tickets'} couldn't be slotted into any local epic.
          </strong>
          <Box sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, mt: 0.5 }}>
            {unrouted.join(', ')}
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
                const { bg, fg } = epicColours(c.epicName);
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
                      position: 'relative',
                      bgcolor: 'background.default',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1.25,
                      px: 1.25,
                      py: 1,
                      cursor: 'pointer',
                      transition: 'border-color 120ms, transform 120ms',
                      '&:hover': { borderColor: 'primary.main', transform: 'translateY(-1px)' },
                      '&:hover .board-card-remove': { opacity: 1 },
                    }}
                  >
                    <IconButton
                      className="board-card-remove"
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(c.taskId);
                      }}
                      aria-label="Remove from board"
                      title="Remove from board"
                      sx={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        opacity: 0,
                        transition: 'opacity 120ms',
                        p: 0.25,
                        color: 'text.disabled',
                        '&:hover': { color: 'error.main', bgcolor: 'transparent' },
                      }}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      sx={{ mb: 0.5, pr: 2.5 }}
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
                        mb: c.epicName ? 0.75 : 0,
                      }}
                    >
                      {c.title}
                    </Typography>
                    {c.epicName && (
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
                          maxWidth: '100%',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={c.epicName}
                      >
                        {c.epicName}
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
        onRemove={(taskId) => {
          handleRemove(taskId);
          setSelectedCard(null);
        }}
      />
    </Box>
  );
}
