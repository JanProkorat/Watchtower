import { useEffect, useMemo, useState } from 'react';
import {
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
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import { useClaudeSettings, type SettingsScope } from '../../state/useClaudeSettings.js';
import { useToast, toastMessage } from '../../state/useToast.js';

const PROJECT_PATH_STORAGE_KEY = 'watchtower.settings.json.projectPath';

type Transport = 'stdio' | 'http';

interface StdioServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
interface HttpServer {
  url: string;
  headers?: Record<string, string>;
}
type Server = StdioServer | HttpServer;

interface Preset {
  label: string;
  description: string;
  name: string;
  config: Server;
}

const PRESETS: Preset[] = [
  {
    label: 'Filesystem',
    description: 'Read/write files under one or more whitelisted paths.',
    name: 'filesystem',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '~/Projects'] },
  },
  {
    label: 'Git',
    description: 'Run git commands against a repo path.',
    name: 'git',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-git', '--repository', '~/Projects'] },
  },
  {
    label: 'GitHub',
    description: 'GitHub API via a personal access token (set GITHUB_PERSONAL_ACCESS_TOKEN in env).',
    name: 'github',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
  },
  {
    label: 'Memory',
    description: 'Persistent key-value memory backed by a local file.',
    name: 'memory',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
  },
  {
    label: 'Slack',
    description: 'Slack workspace search + post via a bot token.',
    name: 'slack',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
    },
  },
];

function isHttpServer(s: Server | undefined): s is HttpServer {
  return Boolean(s && 'url' in s);
}

function transportOf(s: Server): Transport {
  return isHttpServer(s) ? 'http' : 'stdio';
}

function parseSettings(content: string): {
  settingsObject: Record<string, unknown> | null;
  servers: Record<string, Server>;
  error: string | null;
} {
  try {
    const obj = JSON.parse(content);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { settingsObject: null, servers: {}, error: 'Top-level value must be an object' };
    }
    const raw = (obj as Record<string, unknown>).mcpServers;
    if (raw === undefined) return { settingsObject: obj as Record<string, unknown>, servers: {}, error: null };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { settingsObject: obj as Record<string, unknown>, servers: {}, error: '`mcpServers` must be an object' };
    }
    return { settingsObject: obj as Record<string, unknown>, servers: raw as Record<string, Server>, error: null };
  } catch (err) {
    return { settingsObject: null, servers: {}, error: err instanceof Error ? err.message : String(err) };
  }
}

function withServers(settingsObject: Record<string, unknown>, servers: Record<string, Server>): string {
  const next = { ...settingsObject };
  if (Object.keys(servers).length === 0) {
    delete next.mcpServers;
  } else {
    next.mcpServers = servers;
  }
  return JSON.stringify(next, null, 2) + '\n';
}

interface EditDraft {
  /** Empty when adding; original key when editing (so we know what to delete on rename). */
  originalName: string | null;
  name: string;
  transport: Transport;
  command: string;
  args: string;
  url: string;
  envText: string;
  headersText: string;
}

function emptyDraft(): EditDraft {
  return {
    originalName: null,
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    url: '',
    envText: '',
    headersText: '',
  };
}

function draftFromServer(name: string, server: Server): EditDraft {
  if (isHttpServer(server)) {
    return {
      originalName: name,
      name,
      transport: 'http',
      command: '',
      args: '',
      url: server.url,
      envText: '',
      headersText: server.headers ? formatKvText(server.headers) : '',
    };
  }
  return {
    originalName: name,
    name,
    transport: 'stdio',
    command: server.command,
    args: (server.args ?? []).join('\n'),
    url: '',
    envText: server.env ? formatKvText(server.env) : '',
    headersText: '',
  };
}

function formatKvText(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function parseKvText(text: string): Record<string, string> | string {
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return `"${trimmed}" is not in KEY=value form`;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1);
    if (!k) return `Line "${trimmed}" has no key`;
    result[k] = v;
  }
  return result;
}

function serverFromDraft(draft: EditDraft): Server | string {
  if (draft.transport === 'http') {
    if (!draft.url.trim()) return 'URL is required';
    const out: HttpServer = { url: draft.url.trim() };
    if (draft.headersText.trim()) {
      const headers = parseKvText(draft.headersText);
      if (typeof headers === 'string') return `Headers: ${headers}`;
      out.headers = headers;
    }
    return out;
  }
  if (!draft.command.trim()) return 'Command is required';
  const out: StdioServer = { command: draft.command.trim() };
  const args = draft.args
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (args.length > 0) out.args = args;
  if (draft.envText.trim()) {
    const env = parseKvText(draft.envText);
    if (typeof env === 'string') return `Env: ${env}`;
    out.env = env;
  }
  return out;
}

export function McpTab() {
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

  const { settingsObject, servers, error: parseError } = useMemo(
    () => parseSettings(settings.draft),
    [settings.draft],
  );

  const [draft, setDraft] = useState<EditDraft | null>(null);

  const writeServers = (next: Record<string, Server>) => {
    if (!settingsObject) return;
    settings.setDraft(withServers(settingsObject, next));
  };

  const remove = (name: string) => {
    const { [name]: _, ...rest } = servers;
    void _;
    writeServers(rest);
  };

  const apply = (d: EditDraft) => {
    const result = serverFromDraft(d);
    if (typeof result === 'string') {
      showError(result);
      return;
    }
    if (!d.name.trim()) {
      showError('Name is required');
      return;
    }
    const next: Record<string, Server> = { ...servers };
    if (d.originalName && d.originalName !== d.name) {
      delete next[d.originalName];
    }
    next[d.name.trim()] = result;
    writeServers(next);
    setDraft(null);
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
      showSuccess(backupPath ? `Saved. Backup at ${backupPath.split('/').pop()}` : 'Saved.');
    } catch (err) {
      showError(toastMessage(err));
    }
  };

  const showProjectRequired = scope === 'project' && !projectPath;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}
      >
        <ButtonGroup size="small" variant="outlined">
          <Button variant={scope === 'global' ? 'contained' : 'outlined'} onClick={() => setScope('global')}>
            Global
          </Button>
          <Button variant={scope === 'project' ? 'contained' : 'outlined'} onClick={() => setScope('project')}>
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

      {/* Body */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {showProjectRequired && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Choose a project folder to read its <code>.claude/settings.json</code>.
          </Alert>
        )}

        {settings.loading && (
          <Stack spacing={1.5}>
            <Skeleton variant="rounded" height={64} />
            <Skeleton variant="rounded" height={64} />
            <Skeleton variant="rounded" height={64} />
          </Stack>
        )}

        {parseError && !settings.loading && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Could not parse settings.json: {parseError}. Fix it in the <strong>settings.json</strong> tab.
          </Alert>
        )}

        {!settings.loading && !parseError && !showProjectRequired && (
          <Stack spacing={2}>
            {/* Add / preset row */}
            {!draft && (
              <Stack direction="row" spacing={1} alignItems="center">
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() => setDraft(emptyDraft())}
                >
                  Add server
                </Button>
                <TextField
                  size="small"
                  select
                  value=""
                  onChange={(e) => {
                    const p = PRESETS.find((x) => x.label === e.target.value);
                    if (!p) return;
                    setDraft(draftFromServer(p.name, p.config));
                  }}
                  sx={{ minWidth: 240 }}
                  SelectProps={{ displayEmpty: true }}
                >
                  <MenuItem value="" disabled>
                    From preset…
                  </MenuItem>
                  {PRESETS.map((p) => (
                    <MenuItem key={p.label} value={p.label}>
                      <Box>
                        <Typography variant="body2">{p.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {p.description}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            )}

            {/* Edit/add form */}
            {draft && (
              <Box
                sx={{
                  p: 2,
                  borderRadius: 1,
                  bgcolor: 'background.default',
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {draft.originalName ? `Edit ${draft.originalName}` : 'Add MCP server'}
                </Typography>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1.5}>
                    <TextField
                      label="Name"
                      size="small"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      sx={{ flex: 1 }}
                      InputProps={{ sx: { fontFamily: 'Menlo, monospace', fontSize: 13 } }}
                    />
                    <TextField
                      label="Transport"
                      size="small"
                      select
                      value={draft.transport}
                      onChange={(e) =>
                        setDraft({ ...draft, transport: e.target.value as Transport })
                      }
                      sx={{ minWidth: 140 }}
                    >
                      <MenuItem value="stdio">stdio</MenuItem>
                      <MenuItem value="http">http / sse</MenuItem>
                    </TextField>
                  </Stack>

                  {draft.transport === 'stdio' ? (
                    <>
                      <TextField
                        label="Command"
                        size="small"
                        value={draft.command}
                        onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                        InputProps={{ sx: { fontFamily: 'Menlo, monospace', fontSize: 13 } }}
                      />
                      <TextField
                        label="Args (one per line)"
                        size="small"
                        value={draft.args}
                        onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                        multiline
                        minRows={3}
                        InputProps={{ sx: { fontFamily: 'Menlo, monospace', fontSize: 12.5 } }}
                      />
                      <TextField
                        label="Env (KEY=value, one per line)"
                        size="small"
                        value={draft.envText}
                        onChange={(e) => setDraft({ ...draft, envText: e.target.value })}
                        multiline
                        minRows={2}
                        InputProps={{ sx: { fontFamily: 'Menlo, monospace', fontSize: 12.5 } }}
                      />
                    </>
                  ) : (
                    <>
                      <TextField
                        label="URL"
                        size="small"
                        value={draft.url}
                        onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                        InputProps={{ sx: { fontFamily: 'Menlo, monospace', fontSize: 13 } }}
                      />
                      <TextField
                        label="Headers (KEY=value, one per line)"
                        size="small"
                        value={draft.headersText}
                        onChange={(e) => setDraft({ ...draft, headersText: e.target.value })}
                        multiline
                        minRows={2}
                        InputProps={{ sx: { fontFamily: 'Menlo, monospace', fontSize: 12.5 } }}
                      />
                    </>
                  )}

                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button size="small" onClick={() => setDraft(null)}>
                      Cancel
                    </Button>
                    <Button size="small" variant="contained" onClick={() => apply(draft)}>
                      {draft.originalName ? 'Update' : 'Add'}
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            )}

            {/* Server list */}
            {Object.keys(servers).length === 0 && !draft && (
              <Box sx={{ p: 6, textAlign: 'center', color: 'text.disabled' }}>
                <Typography variant="body2">No MCP servers configured.</Typography>
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                  Use "Add server" above to add one, or pick a preset.
                </Typography>
              </Box>
            )}

            {Object.entries(servers).map(([name, server]) => (
              <Box
                key={name}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1,
                  p: 1.5,
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography
                      sx={{ fontFamily: 'Menlo, monospace', fontSize: 13, fontWeight: 600 }}
                    >
                      {name}
                    </Typography>
                    <Chip label={transportOf(server)} size="small" variant="outlined" />
                  </Stack>
                  {isHttpServer(server) ? (
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'Menlo, monospace', fontSize: 12, wordBreak: 'break-all' }}
                    >
                      {server.url}
                    </Typography>
                  ) : (
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'Menlo, monospace', fontSize: 12, wordBreak: 'break-all' }}
                    >
                      {server.command}
                      {server.args && server.args.length > 0 && (
                        <Typography component="span" sx={{ color: 'text.secondary', fontFamily: 'inherit', fontSize: 'inherit' }}>
                          {' ' + server.args.join(' ')}
                        </Typography>
                      )}
                    </Typography>
                  )}
                </Box>
                <Tooltip title="Edit">
                  <IconButton size="small" onClick={() => setDraft(draftFromServer(name, server))}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Remove">
                  <IconButton size="small" onClick={() => remove(name)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
