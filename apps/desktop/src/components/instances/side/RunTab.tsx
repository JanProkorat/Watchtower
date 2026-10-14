import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Typography } from '@mui/material';
import type { RunServerState, RunState } from '@watchtower/shared/runServers.js';
import { invoke } from '../../../state/ipc';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

interface Props {
  state: RunState;
  onStart(serverId?: string): void;
  onStop(serverId?: string): void;
  onReload(): void;
}

const isUp = (s: RunServerState) => s.status === 'starting' || s.status === 'running';

/** Servers starting or running; the tab label's badge. */
export const runningCount = (state: RunState | null): number => state?.servers.filter(isUp).length ?? 0;

function statusText(s: RunServerState): { text: string; color: string } {
  switch (s.status) {
    case 'starting':
      return { text: 'starting…', color: 'warning.main' };
    case 'running':
      return { text: s.port ? `:${s.port}` : 'running', color: 'success.main' };
    case 'busy':
      return { text: `:${s.port} already in use`, color: 'warning.main' };
    case 'exited':
      return { text: `stopped (${s.exit ?? 'unknown'})`, color: 'error.main' };
    default:
      return { text: 'off', color: 'text.secondary' };
  }
}

/** A repo's dev servers from `.watchtower/run.json`: start, stop, open, and their logs. */
export function RunTab({ state, onStart, onStop, onReload }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const shown = state.servers.find((s) => s.id === picked) ?? state.servers[0] ?? null;
  const isAnyUp = state.servers.some(isUp);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 1, pb: 1 }}>
      {state.error && (
        <Alert severity="error" sx={{ mb: 1, fontSize: 12 }}>
          {state.error}
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 0.5, mb: 1 }}>
        {isAnyUp ? (
          <Button size="small" variant="outlined" onClick={() => onStop()}>Stop all</Button>
        ) : (
          <Button size="small" variant="contained" disabled={state.servers.length === 0} onClick={() => onStart()}>Start all</Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onReload}>Reload run.json</Button>
      </Box>

      {state.servers.map((s) => {
        const st = statusText(s);
        return (
          <Box key={s.id} data-testid={`run-${s.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, minWidth: 48 }}>{s.label}</Typography>
            <Typography noWrap sx={{ fontSize: 12, color: st.color, flex: 1, fontVariantNumeric: 'tabular-nums' }}>{st.text}</Typography>
            {s.status === 'running' && s.url && (
              <Button size="small" onClick={() => void invoke('openExternalUrl', { url: s.url! })}>Open</Button>
            )}
            {isUp(s) ? (
              <Button size="small" onClick={() => onStop(s.id)}>Stop</Button>
            ) : (
              <Button size="small" onClick={() => onStart(s.id)}>Start</Button>
            )}
          </Box>
        );
      })}

      {shown && (
        <>
          <Box role="tablist" aria-label="Logs" sx={{ display: 'flex', gap: 0.5, mt: 1, mb: 0.5 }}>
            {state.servers.map((s) => (
              <ButtonBase
                key={s.id}
                role="tab"
                aria-selected={s.id === shown.id}
                onClick={() => setPicked(s.id)}
                sx={{ fontSize: 11.5, px: 0.75, py: 0.25, borderRadius: '6px', color: s.id === shown.id ? 'text.primary' : 'text.secondary', backgroundColor: s.id === shown.id ? 'action.selected' : 'transparent' }}
              >
                {`${s.label} log`}
              </ButtonBase>
            ))}
          </Box>
          <LogView lines={shown.log} />
        </>
      )}
    </Box>
  );
}

/** Output lines, kept scrolled to the bottom unless the user scrolled up to read. */
function LogView({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const isPinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && isPinned.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <Box
      ref={ref}
      data-testid="run-log"
      onScroll={(e) => {
        const el = e.currentTarget;
        isPinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      sx={{ flex: 1, minHeight: 80, overflow: 'auto', fontFamily: MONO, fontSize: 11.5, borderRadius: '6px', backgroundColor: 'action.hover', p: 1 }}
    >
      {lines.length === 0 ? (
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>No output yet.</Typography>
      ) : (
        lines.map((l, i) => (
          <Box key={i} sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {l}
          </Box>
        ))
      )}
    </Box>
  );
}
