import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Chip,
  FormControlLabel,
  IconButton,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import RefreshIcon from '@mui/icons-material/Refresh';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { useClaudeSettings, type SettingsScope } from '../../state/useClaudeSettings.js';
import { useToast, toastMessage } from '../../state/useToast.js';
import { glassSurface } from '../../theme/glass.js';
import { invoke } from '../../state/ipc';

const PROJECT_PATH_STORAGE_KEY = 'watchtower.settings.json.projectPath';

interface ParsedDraft {
  parsed: Record<string, unknown> | null;
  parseError: string | null;
}

function parseDraft(content: string): ParsedDraft {
  try {
    const v = JSON.parse(content);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return { parsed: v as Record<string, unknown>, parseError: null };
    }
    return { parsed: null, parseError: 'Top-level value must be an object' };
  } catch (err) {
    return { parsed: null, parseError: err instanceof Error ? err.message : String(err) };
  }
}

export function SettingsJsonTab() {
  const theme = useTheme();
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

  const { parsed, parseError } = useMemo(() => parseDraft(settings.draft), [settings.draft]);

  const setField = (key: string, value: unknown) => {
    const next = { ...(parsed ?? {}), [key]: value };
    settings.setDraft(JSON.stringify(next, null, 2) + '\n');
  };

  const removeField = (key: string) => {
    if (!parsed) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [key]: _, ...rest } = parsed;
    settings.setDraft(JSON.stringify(rest, null, 2) + '\n');
  };

  const onSave = async () => {
    try {
      const { backupPath } = await settings.save();
      showSuccess(
        backupPath
          ? `Saved. Backup at ${backupPath.split('/').pop()}`
          : 'Saved (new file created).',
      );
    } catch (err) {
      showError(toastMessage(err));
    }
  };

  const browseProject = async () => {
    const res = await invoke('chooseDirectory', {
      defaultPath: projectPath || undefined,
    });
    if (res.path) setProjectPath(res.path);
  };

  const showProjectRequired = scope === 'project' && !projectPath;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          flexWrap: 'wrap',
        }}
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

        {settings.path && (
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              fontFamily: 'Menlo, monospace',
              fontSize: 11,
              maxWidth: 480,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {settings.path}
          </Typography>
        )}

        {!settings.exists && settings.path && !settings.loading && (
          <Chip label="not yet created" size="small" variant="outlined" />
        )}
        {settings.isDirty && <Chip label="Unsaved changes" size="small" color="warning" />}

        <Tooltip title="Reload from disk">
          <span>
            <IconButton
              size="small"
              onClick={() => void settings.refresh()}
              disabled={settings.loading}
            >
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
      {/* glassSurface: singleton content panel that fills the JSON tab viewport */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2, ...glassSurface(theme, { elevation: 1 }) }}>
        {showProjectRequired && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Choose a project folder to read its <code>.claude/settings.json</code>.
          </Alert>
        )}

        {settings.loading && (
          <Stack spacing={1.5}>
            <Skeleton variant="rounded" height={48} />
            <Skeleton variant="rounded" height={48} />
            <Skeleton variant="rounded" height={280} />
          </Stack>
        )}

        {settings.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {settings.error}
          </Alert>
        )}

        {!settings.loading && !showProjectRequired && (
          <Stack spacing={3}>
            {/* Form for known top-level boolean keys */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Common toggles
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Edits here update the JSON below. {parseError && 'Disabled while JSON is invalid.'}
              </Typography>
              <Stack spacing={0.5}>
                <BoolRow
                  label="alwaysThinking"
                  description="Always think before responding (slower, but higher quality on hard tasks)."
                  value={readBool(parsed, 'alwaysThinking')}
                  disabled={Boolean(parseError)}
                  onChange={(v) => setField('alwaysThinking', v)}
                  onClear={() => removeField('alwaysThinking')}
                  present={parsed !== null && 'alwaysThinking' in parsed}
                />
                <BoolRow
                  label="skipAutoPermissionPrompt"
                  description="Skip the auto-permission prompt at session start (assumes you've already configured allow/ask/deny)."
                  value={readBool(parsed, 'skipAutoPermissionPrompt')}
                  disabled={Boolean(parseError)}
                  onChange={(v) => setField('skipAutoPermissionPrompt', v)}
                  onClear={() => removeField('skipAutoPermissionPrompt')}
                  present={parsed !== null && 'skipAutoPermissionPrompt' in parsed}
                />
              </Stack>
            </Box>

            {/* Raw JSON editor */}
            <Box>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="subtitle2">Raw JSON</Typography>
                {parseError && <Chip label="Invalid JSON" size="small" color="error" />}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                The full file. Edits sync to the toggles above on every keystroke. Hooks &amp; MCP
                servers have richer tabs — edit them there for the same effect.
              </Typography>
              <TextField
                value={settings.draft}
                onChange={(e) => settings.setDraft(e.target.value)}
                fullWidth
                multiline
                minRows={18}
                maxRows={40}
                spellCheck={false}
                error={Boolean(parseError)}
                helperText={parseError ?? ' '}
                InputProps={{
                  sx: {
                    fontFamily: 'Menlo, Monaco, monospace',
                    fontSize: 12.5,
                    lineHeight: 1.55,
                  },
                }}
              />
            </Box>
          </Stack>
        )}
      </Box>
    </Box>
  );
}

function readBool(parsed: Record<string, unknown> | null, key: string): boolean {
  return parsed !== null && parsed[key] === true;
}

interface BoolRowProps {
  label: string;
  description: string;
  value: boolean;
  present: boolean;
  disabled: boolean;
  onChange(next: boolean): void;
  onClear(): void;
}

function BoolRow({ label, description, value, present, disabled, onChange, onClear }: BoolRowProps) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Box sx={{ flex: 1 }}>
        <Typography
          variant="body2"
          sx={{ fontFamily: 'Menlo, monospace', fontSize: 12.5, fontWeight: 500 }}
        >
          {label}
          {!present && (
            <Typography
              component="span"
              variant="caption"
              color="text.disabled"
              sx={{ ml: 1, fontFamily: 'inherit' }}
            >
              (not set)
            </Typography>
          )}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      </Box>
      {present && (
        <Tooltip title="Remove this key">
          <span>
            <Button size="small" onClick={onClear} disabled={disabled}>
              clear
            </Button>
          </span>
        </Tooltip>
      )}
      <FormControlLabel
        control={
          <Switch
            checked={value}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            size="small"
          />
        }
        label=""
        sx={{ m: 0 }}
      />
    </Stack>
  );
}
