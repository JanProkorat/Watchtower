import { useEffect, useState } from 'react';
import { invoke } from '../state/ipc';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';

type PreviewPayload = {
  settingsPath: string;
  helperPath: string;
  alreadyInstalled: boolean;
  entries: Array<{ event: string; command: string; alreadyPresent: boolean }>;
  preserved: Array<{ event: string; command: string }>;
};

type Step = 'welcome' | 'hooks' | 'test' | 'done';

interface Props {
  open: boolean;
  onClose(): void;
}

export function FirstRunWizard({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('welcome');
    setPreview(null);
    setInstalling(false);
    setError(null);
    setInstallResult(null);
  }, [open]);

  useEffect(() => {
    if (step !== 'hooks' || preview) return;
    void invoke('previewHookInstall', {})
      .then((p) => setPreview(p))
      .catch((e: Error) => setError(e.message));
  }, [step, preview]);

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      const res = await invoke('installHooks', {});
      setInstallResult(
        res.changed
          ? `Installed (backup at ${res.backedUp ?? '— no existing file'}).`
          : 'Already installed.',
      );
      setStep('test');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  };

  const finish = async () => {
    try {
      await invoke('setSetting', {
        key: 'first_run_completed_at',
        value: String(Date.now()),
      });
    } catch {
      /* not fatal */
    }
    setStep('done');
    onClose();
  };

  return (
    <Dialog open={open} fullWidth maxWidth="md">
      <DialogTitle>Welcome to Watchtower</DialogTitle>
      <Box sx={{ display: 'flex', gap: 0.5, px: 3, mt: -1 }}>
        {(['welcome', 'hooks', 'test'] as const).map((s) => (
          <Box
            key={s}
            sx={{
              flex: 1,
              height: 3,
              borderRadius: 1.5,
              backgroundColor:
                step === s
                  ? 'primary.main'
                  : (step === 'test' && s !== 'test') || step === 'done'
                    ? 'success.main'
                    : (step === 'hooks' && s === 'welcome')
                      ? 'success.main'
                      : 'divider',
            }}
          />
        ))}
      </Box>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {step === 'welcome' && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography>
              Watchtower watches your Claude Code instances and pings you when one needs your input —
              permission prompts, end-of-turn idle, anything that would otherwise leave a tab silently
              waiting.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              To do that it installs five hooks into{' '}
              <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                ~/.claude/settings.json
              </Box>{' '}
              (SessionStart, UserPromptSubmit, Notification, Stop, SessionEnd). They POST events to
              a localhost listener that only Watchtower can talk to (bearer-token auth on a 127.0.0.1
              port). Your existing settings file is backed up before any change.
            </Typography>
            <Typography variant="caption" color="text.disabled">
              You can uninstall the hooks any time from Settings.
            </Typography>
          </Stack>
        )}
        {step === 'hooks' && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {!preview ? (
              <LinearProgress />
            ) : preview.alreadyInstalled ? (
              <Alert severity="success">
                All five hooks are already installed and point at the current helper. Nothing to do.
              </Alert>
            ) : (
              <>
                <Typography variant="body2">
                  These entries will be added to{' '}
                  <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {preview.settingsPath}
                  </Box>
                  :
                </Typography>
                <Box
                  sx={{
                    backgroundColor: 'background.default',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1.5,
                    maxHeight: 280,
                    overflow: 'auto',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    lineHeight: 1.6,
                  }}
                >
                  {preview.entries.map((e) => (
                    <Box
                      key={e.event}
                      sx={{
                        color: e.alreadyPresent ? 'text.disabled' : 'success.main',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {e.alreadyPresent ? '· ' : '+ '}
                      {e.event}: {e.command}
                    </Box>
                  ))}
                </Box>
                {preview.preserved.length > 0 && (
                  <Alert severity="info" variant="outlined">
                    {preview.preserved.length} non-Watchtower hook
                    {preview.preserved.length === 1 ? '' : 's'} will be preserved as-is.
                  </Alert>
                )}
              </>
            )}
          </Stack>
        )}
        {step === 'test' && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {installResult && <Alert severity="success">{installResult}</Alert>}
            <Typography>Try a test notification to verify macOS permissions.</Typography>
            <Button
              variant="outlined"
              onClick={() => void invoke('sendTestNotification', {})}
              sx={{ alignSelf: 'flex-start' }}
            >
              Send test notification
            </Button>
            <Typography variant="caption" color="text.secondary">
              If nothing appears, check <strong>System Settings → Notifications → Electron / Watchtower</strong>{' '}
              and allow alerts. Hooks only fire for sessions started after install — kill and respawn
              any tabs that were open before now.
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {step === 'welcome' && (
          <>
            <Button onClick={onClose}>Skip for now</Button>
            <Button variant="contained" onClick={() => setStep('hooks')}>
              Continue
            </Button>
          </>
        )}
        {step === 'hooks' && (
          <>
            <Button onClick={onClose}>Skip</Button>
            {preview?.alreadyInstalled ? (
              <Button variant="contained" onClick={() => setStep('test')}>
                Continue
              </Button>
            ) : (
              <Button variant="contained" onClick={install} disabled={!preview || installing}>
                {installing ? 'Installing…' : 'Install hooks'}
              </Button>
            )}
          </>
        )}
        {step === 'test' && (
          <Button variant="contained" onClick={finish}>
            Finish
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
