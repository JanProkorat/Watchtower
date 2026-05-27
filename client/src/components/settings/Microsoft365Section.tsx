import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMicrosoft365 } from '../../state/useMicrosoft365.js';

export function Microsoft365Section() {
  const { status, active, update, startSignIn, cancelSignIn, signOut } = useMicrosoft365();

  if (!status) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <CircularProgress size={16} />
      </Paper>
    );
  }

  if (!status.configured) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography sx={{ fontWeight: 600, mb: 1 }}>Microsoft 365</Typography>
        <Alert severity="info">
          Set <code>MS_GRAPH_CLIENT_ID</code> in Watchtower&apos;s launch environment to
          enable Outlook calendar sync. See the README for one-time Azure
          app registration steps.
        </Alert>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{ mb: 1 }}
      >
        <Typography sx={{ fontWeight: 600 }}>Microsoft 365</Typography>
        {status.signedIn ? (
          <Button size="small" onClick={() => void signOut()}>
            Sign out
          </Button>
        ) : (
          <Button
            size="small"
            variant="contained"
            onClick={() => void startSignIn()}
            disabled={Boolean(active)}
          >
            Sign in
          </Button>
        )}
      </Stack>

      {status.signedIn && (
        <Typography variant="body2" color="text.secondary">
          Connected as <strong>{status.account}</strong>.
        </Typography>
      )}
      {!status.signedIn && !active && (
        <Typography variant="body2" color="text.secondary">
          Sign in to enable one-click meeting sync from the dashboard.
        </Typography>
      )}

      {active && (
        <Box sx={{ mt: 1.5 }}>
          <Alert severity="info" icon={<CircularProgress size={16} />}>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Open{' '}
              <Link href={active.verificationUri} target="_blank" rel="noopener noreferrer">
                {active.verificationUri}
              </Link>{' '}
              and enter:
            </Typography>
            <Typography
              sx={{
                fontFamily: 'monospace',
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 1,
                userSelect: 'all',
              }}
            >
              {active.userCode}
            </Typography>
            <Button size="small" sx={{ mt: 1 }} onClick={() => void cancelSignIn()}>
              Cancel
            </Button>
          </Alert>
        </Box>
      )}

      {update?.status === 'error' && (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {update.error ?? 'Sign-in failed.'}
        </Alert>
      )}
      {update?.status === 'expired' && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          Code expired. Click Sign in to try again.
        </Alert>
      )}
    </Paper>
  );
}
