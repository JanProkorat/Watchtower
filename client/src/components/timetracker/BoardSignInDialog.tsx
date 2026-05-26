import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import LaunchIcon from '@mui/icons-material/Launch';
import VpnKeyIcon from '@mui/icons-material/VpnKey';

const JIRA_LOGIN_URL = 'https://jira.skoda.vwgroup.com/login.jsp';

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Called when the user clicks Save. Implementation should validate the
   * cookie against Jira, store it, and resolve with `ok: true` on success.
   */
  onSubmit: (cookie: string) => Promise<{ ok: boolean; error?: string }>;
  /** Trigger that opens the Jira login URL in the user's default browser. */
  onOpenJira: () => void;
}

export function BoardSignInDialog({ open, onClose, onSubmit, onOpenJira }: Props) {
  const [cookie, setCookie] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCookie('');
    setBusy(false);
    setError(null);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    const r = await onSubmit(cookie);
    setBusy(false);
    if (r.ok) {
      reset();
      onClose();
    } else {
      setError(r.error ?? 'Sign-in failed.');
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Sign in to Jira</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            Watchtower needs your Jira session cookie. Sign in with your passkey
            in your default browser, then copy the <code>Cookie</code> header
            from any request and paste it below.
          </Typography>

          <Stack spacing={1}>
            <Typography variant="subtitle2">1. Open Jira in your browser</Typography>
            <Button
              variant="outlined"
              startIcon={<LaunchIcon />}
              onClick={onOpenJira}
              disabled={busy}
              sx={{ alignSelf: 'flex-start' }}
            >
              Open {JIRA_LOGIN_URL}
            </Button>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="subtitle2">2. Copy the Cookie header</Typography>
            <Typography variant="body2" color="text.secondary" component="div">
              After you've logged in:
              <Box component="ol" sx={{ pl: 2.5, my: 1, '& li': { mb: 0.5 } }}>
                <li>Open DevTools (<code>⌥⌘I</code>) and switch to the <strong>Network</strong> tab.</li>
                <li>Refresh the page so a request to <code>jira.skoda.vwgroup.com</code> appears.</li>
                <li>
                  Click any such request → <strong>Headers</strong> → find{' '}
                  <strong>Request Headers → Cookie</strong>.
                </li>
                <li>Right-click the value → <strong>Copy value</strong>.</li>
              </Box>
            </Typography>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="subtitle2">3. Paste it here</Typography>
            <TextField
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              multiline
              minRows={4}
              maxRows={10}
              placeholder="JSESSIONID=…; atlassian.xsrf.token=…; …"
              fullWidth
              disabled={busy}
              spellCheck={false}
              sx={{ '& textarea': { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 } }}
            />
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleClose} disabled={busy}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={busy || cookie.trim().length === 0}
          startIcon={busy ? <CircularProgress size={14} /> : <VpnKeyIcon />}
        >
          {busy ? 'Validating…' : 'Save & sync'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export { JIRA_LOGIN_URL };
