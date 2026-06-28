import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  ButtonGroup,
  Chip,
  IconButton,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import LockIcon from '@mui/icons-material/Lock';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import { useClaudeSettings, type SettingsScope } from '../../state/useClaudeSettings.js';
import { useToast, toastMessage } from '../../state/useToast.js';

const PROJECT_PATH_STORAGE_KEY = 'watchtower.settings.json.projectPath';

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SessionEnd',
] as const;
type EventName = (typeof EVENTS)[number];

interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
}
interface HookBlock {
  matcher?: string;
  hooks: HookCommand[];
}
type HooksMap = Partial<Record<EventName, HookBlock[]>>;

interface Template {
  label: string;
  description: string;
  matcher?: string;
  command: string;
  defaultEvent: EventName;
}

const TEMPLATES: Template[] = [
  {
    label: 'Play sound (Glass.aiff)',
    description: 'Play a short macOS system sound when an event fires.',
    command: 'afplay /System/Library/Sounds/Glass.aiff',
    defaultEvent: 'Notification',
  },
  {
    label: 'Slack webhook notify',
    description: 'POST a one-line message to a Slack incoming webhook. Replace the URL.',
    command:
      'curl -s -X POST -H "Content-Type: application/json" -d \'{"text":"Claude event"}\' https://hooks.slack.com/services/...',
    defaultEvent: 'Notification',
  },
  {
    label: 'Audit file writes',
    description: 'Append the matched tool name to a log file on every PostToolUse.',
    matcher: 'Write|Edit|MultiEdit',
    command: 'echo "$(date -u +%FT%T) $CLAUDE_TOOL_NAME" >> ~/.claude/write-audit.log',
    defaultEvent: 'PostToolUse',
  },
];

function isWatchtowerManaged(command: string): boolean {
  return command.includes('watchtower-hook.mjs');
}

function parseHooks(content: string): { hooks: HooksMap; settingsObject: Record<string, unknown> | null; error: string | null } {
  try {
    const obj = JSON.parse(content);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { hooks: {}, settingsObject: null, error: 'Top-level value must be an object' };
    }
    const raw = (obj as Record<string, unknown>).hooks;
    if (raw === undefined) return { hooks: {}, settingsObject: obj as Record<string, unknown>, error: null };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { hooks: {}, settingsObject: obj as Record<string, unknown>, error: '`hooks` must be an object' };
    }
    return { hooks: raw as HooksMap, settingsObject: obj as Record<string, unknown>, error: null };
  } catch (err) {
    return { hooks: {}, settingsObject: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function withHooks(settingsObject: Record<string, unknown>, hooks: HooksMap): string {
  // Trim out empty event arrays so a "no hooks for this event" round-trips
  // as the key being absent rather than an empty []. Then drop the `hooks`
  // key entirely if no events remain.
  const trimmed: HooksMap = {};
  for (const [event, blocks] of Object.entries(hooks) as Array<[EventName, HookBlock[] | undefined]>) {
    if (blocks && blocks.length > 0) trimmed[event] = blocks;
  }
  const next = { ...settingsObject };
  if (Object.keys(trimmed).length === 0) {
    delete next.hooks;
  } else {
    next.hooks = trimmed;
  }
  return JSON.stringify(next, null, 2) + '\n';
}

export function HooksTab() {
  const [scope, setScope] = useState<SettingsScope>('global');
  const [projectPath, setProjectPath] = useState<string>(() => {
    try {
      return localStorage.getItem(PROJECT_PATH_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      if (projectPath) localStorage.setItem(PROJECT_PATH_STORAGE_KEY, projectPath);
    } catch {
      /* best-effort */
    }
  }, [projectPath]);

  const settings = useClaudeSettings(scope, scope === 'project' ? projectPath : undefined);
  const { showError, showSuccess } = useToast();

  const { hooks, settingsObject, error: parseError } = useMemo(
    () => parseHooks(settings.draft),
    [settings.draft],
  );

  // Per-event in-place "add new hook" UI state.
  const [adding, setAdding] = useState<Partial<Record<EventName, { matcher: string; command: string }>>>({});

  const setHooks = (next: HooksMap) => {
    if (!settingsObject) return;
    settings.setDraft(withHooks(settingsObject, next));
  };

  const addHook = (event: EventName, matcher: string, command: string) => {
    if (!command.trim()) return;
    const block: HookBlock = matcher.trim()
      ? { matcher: matcher.trim(), hooks: [{ type: 'command', command }] }
      : { hooks: [{ type: 'command', command }] };
    setHooks({ ...hooks, [event]: [...(hooks[event] ?? []), block] });
    setAdding((a) => ({ ...a, [event]: undefined }));
  };

  const removeHook = (event: EventName, blockIdx: number, cmdIdx: number) => {
    const blocks = [...(hooks[event] ?? [])];
    const block = blocks[blockIdx];
    if (!block) return;
    const newCmds = block.hooks.filter((_, i) => i !== cmdIdx);
    if (newCmds.length === 0) {
      blocks.splice(blockIdx, 1);
    } else {
      blocks[blockIdx] = { ...block, hooks: newCmds };
    }
    setHooks({ ...hooks, [event]: blocks });
  };

  const browseProject = async () => {
    const res = await window.watchtower.invoke('chooseDirectory', {
      defaultPath: projectPath || undefined,
    });
    if (res.path) setProjectPath(res.path);
  };

  const onSave = async () => {
    try {
      const { backupPath } = await settings.save();
      showSuccess(
        backupPath ? `Saved. Backup at ${backupPath.split('/').pop()}` : 'Saved (new file created).',
      );
    } catch (err) {
      showError(toastMessage(err));
    }
  };

  const showProjectRequired = scope === 'project' && !projectPath;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}
      >
        <ButtonGroup size="small" variant="outlined">
          <Button
            variant={scope === 'global' ? 'contained' : 'outlined'}
            onClick={() => setScope('global')}
          >
            Global
          </Button>
          <Button
            variant={scope === 'project' ? 'contained' : 'outlined'}
            onClick={() => setScope('project')}
          >
            Project
          </Button>
        </ButtonGroup>

        {scope === 'project' && (
          <>
            <TextField
              size="small"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="/path/to/project"
              sx={{ minWidth: 320 }}
            />
            <Tooltip title="Browse…">
              <IconButton size="small" onClick={browseProject}>
                <FolderOpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}

        <Box sx={{ flex: 1 }} />

        {settings.isDirty && <Chip label="Unsaved changes" size="small" color="warning" />}
        <Tooltip title="Reload from disk">
          <span>
            <IconButton size="small" onClick={() => void settings.refresh()} disabled={settings.loading}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Button
          size="small"
          startIcon={<RestoreIcon fontSize="small" />}
          onClick={settings.revert}
          disabled={!settings.isDirty}
        >
          Revert
        </Button>
        <Button
          size="small"
          variant="contained"
          startIcon={<SaveIcon fontSize="small" />}
          onClick={() => void onSave()}
          disabled={!settings.isDirty || Boolean(parseError) || showProjectRequired}
        >
          Save
        </Button>
      </Stack>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {showProjectRequired && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Choose a project folder to read its <code>.claude/settings.json</code>.
          </Alert>
        )}

        {settings.loading && (
          <Stack spacing={1.5}>
            <Skeleton variant="rounded" height={56} />
            <Skeleton variant="rounded" height={56} />
            <Skeleton variant="rounded" height={56} />
          </Stack>
        )}

        {parseError && !settings.loading && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Could not parse settings.json: {parseError}. Fix it in the <strong>settings.json</strong> tab.
          </Alert>
        )}

        {!settings.loading && !parseError && !showProjectRequired && (
          <Stack spacing={1.5}>
            {EVENTS.map((event) => {
              const blocks = hooks[event] ?? [];
              const draft = adding[event];
              return (
                <Accordion key={event} disableGutters defaultExpanded={blocks.length > 0}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
                      <Typography sx={{ fontFamily: 'Menlo, monospace', fontSize: 13, fontWeight: 600 }}>
                        {event}
                      </Typography>
                      <Chip
                        label={`${blocks.reduce((acc, b) => acc + b.hooks.length, 0)} hook${
                          blocks.length === 1 && blocks[0]?.hooks.length === 1 ? '' : 's'
                        }`}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={1}>
                      {blocks.length === 0 && (
                        <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                          No hooks configured for this event.
                        </Typography>
                      )}
                      {blocks.flatMap((block, blockIdx) =>
                        block.hooks.map((cmd, cmdIdx) => {
                          const managed = isWatchtowerManaged(cmd.command);
                          return (
                            <Box
                              key={`${blockIdx}-${cmdIdx}`}
                              sx={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 1,
                                py: 0.5,
                                px: 1,
                                borderRadius: 1,
                                bgcolor: managed ? 'action.hover' : 'transparent',
                              }}
                            >
                              {managed && (
                                <Tooltip title="Managed by Watchtower — edit from the General tab.">
                                  <LockIcon
                                    sx={{ fontSize: 14, mt: 0.25, color: 'text.disabled', flexShrink: 0 }}
                                  />
                                </Tooltip>
                              )}
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                {block.matcher && (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: 'block', fontFamily: 'Menlo, monospace', fontSize: 11 }}
                                  >
                                    matcher: {block.matcher}
                                  </Typography>
                                )}
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontFamily: 'Menlo, monospace',
                                    fontSize: 12,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all',
                                  }}
                                >
                                  {cmd.command}
                                </Typography>
                              </Box>
                              <Tooltip title={managed ? 'Use General tab to uninstall Watchtower hook' : 'Remove this hook'}>
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={() => removeHook(event, blockIdx, cmdIdx)}
                                    disabled={managed}
                                  >
                                    <DeleteOutlineIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </Box>
                          );
                        }),
                      )}

                      {/* In-place add form */}
                      {draft ? (
                        <Stack spacing={1} sx={{ mt: 1, p: 1.5, borderRadius: 1, bgcolor: 'background.default' }}>
                          <TextField
                            label="Matcher (optional, regex)"
                            size="small"
                            value={draft.matcher}
                            onChange={(e) =>
                              setAdding((a) => ({ ...a, [event]: { ...draft, matcher: e.target.value } }))
                            }
                            placeholder="Write|Edit|MultiEdit"
                            InputProps={{ sx: { fontFamily: 'Menlo, monospace', fontSize: 12 } }}
                          />
                          <TextField
                            label="Command"
                            size="small"
                            value={draft.command}
                            onChange={(e) =>
                              setAdding((a) => ({ ...a, [event]: { ...draft, command: e.target.value } }))
                            }
                            multiline
                            minRows={2}
                            InputProps={{ sx: { fontFamily: 'Menlo, monospace', fontSize: 12 } }}
                          />
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                              size="small"
                              onClick={() => setAdding((a) => ({ ...a, [event]: undefined }))}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => addHook(event, draft.matcher, draft.command)}
                              disabled={!draft.command.trim()}
                            >
                              Add
                            </Button>
                          </Stack>
                        </Stack>
                      ) : (
                        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                          <Button
                            size="small"
                            startIcon={<AddIcon fontSize="small" />}
                            onClick={() => setAdding((a) => ({ ...a, [event]: { matcher: '', command: '' } }))}
                          >
                            Add hook
                          </Button>
                          <TextField
                            size="small"
                            select
                            value=""
                            onChange={(e) => {
                              const tpl = TEMPLATES.find((t) => t.label === e.target.value);
                              if (!tpl) return;
                              setAdding((a) => ({
                                ...a,
                                [event]: { matcher: tpl.matcher ?? '', command: tpl.command },
                              }));
                            }}
                            sx={{ minWidth: 200 }}
                            SelectProps={{ displayEmpty: true }}
                          >
                            <MenuItem value="" disabled>
                              From template…
                            </MenuItem>
                            {TEMPLATES.filter((t) => t.defaultEvent === event || true).map((t) => (
                              <MenuItem key={t.label} value={t.label}>
                                <Box>
                                  <Typography variant="body2">{t.label}</Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {t.description}
                                  </Typography>
                                </Box>
                              </MenuItem>
                            ))}
                          </TextField>
                        </Stack>
                      )}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              );
            })}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
