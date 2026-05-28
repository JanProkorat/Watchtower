import { Box } from '@mui/material';
import { Terminal } from '../Terminal.js';
import { TerminalErrorBoundary } from '../TerminalErrorBoundary.js';
import type { InstanceView } from '../../state/useInstances.js';

interface Props {
  instances: InstanceView[];
}

// Hidden, off-DOM-flow container that holds the xterm hosts for every
// instance. Reparenting into a visible slot is handled by `Terminal`.
export function TerminalPool({ instances }: Props) {
  return (
    <Box sx={{ display: 'none' }} aria-hidden>
      {instances.map((i) => (
        <TerminalErrorBoundary key={i.id} instanceId={i.id} cwd={i.cwd} active={false}>
          <Terminal instanceId={i.id} status={i.status} />
        </TerminalErrorBoundary>
      ))}
    </Box>
  );
}
