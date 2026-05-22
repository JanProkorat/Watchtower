import React from 'react';
import { Box, Button, Typography } from '@mui/material';

interface Props {
  instanceId: string;
  cwd: string;
  active: boolean;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

// Catches xterm.js / FitAddon internal errors so a single misbehaving
// terminal can't blank the whole app. The most common offender is xterm
// throwing "Cannot read properties of undefined (reading 'dimensions')"
// during early init when its renderService isn't fully ready.
export class TerminalErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[Terminal] crashed:', error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: this.props.active ? 'flex' : 'none',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: 1.5,
          p: 6,
          backgroundColor: 'background.default',
        }}
      >
        <Typography variant="h6">Terminal rendering error</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
          {this.props.cwd}
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ maxWidth: 540 }}>
          xterm.js threw during init: <code>{this.state.error.message}</code>
        </Typography>
        <Button size="small" variant="outlined" onClick={this.reset}>
          Retry
        </Button>
      </Box>
    );
  }
}
