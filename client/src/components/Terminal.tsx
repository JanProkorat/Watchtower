import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Box, CircularProgress, Typography } from '@mui/material';

interface Props {
  instanceId: string;
  active: boolean;
  /**
   * Current instance status. We show the "Starting claude…" overlay while
   * the status is 'spawning' or 'resuming'; once SessionStart fires the
   * state machine transitions out of those and the overlay hides.
   */
  status: string;
}

const STARTING_STATUSES = new Set(['spawning', 'resuming']);
// Safety net: if the SessionStart hook never fires (claude was spawned before
// Watchtower installed its hooks, or the listener can't reach us) the spinner
// would hang forever. After this many ms we hide it regardless and trust that
// claude is up.
const SPINNER_FALLBACK_MS = 10_000;

export function Terminal({ instanceId, active, status }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [fallbackElapsed, setFallbackElapsed] = useState(false);
  const isStarting = STARTING_STATUSES.has(status) && !fallbackElapsed;

  // Arm the fallback timer the first time we mount in a starting state.
  useEffect(() => {
    if (!STARTING_STATUSES.has(status)) return;
    const t = setTimeout(() => setFallbackElapsed(true), SPINNER_FALLBACK_MS);
    return () => clearTimeout(t);
    // intentionally only runs once per mount — we don't reset if status flips
    // back to a starting variant later (shouldn't happen, but safe).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      fontFamily: 'Menlo, Monaco, "SF Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#0e0f12',
        foreground: '#e5e7eb',
        cursor: '#e5e7eb',
        cursorAccent: '#0e0f12',
      },
      convertEol: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    // xterm's renderService isn't always ready synchronously after open();
    // calling fit() too early triggers "Cannot read properties of undefined
    // (reading 'dimensions')". Defer to next frame.
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* element hidden or term torn down before paint */
      }
    });
    termRef.current = term;
    fitRef.current = fit;

    const offData = window.watchtower.on('ptyData', (p) => {
      if (p.instanceId !== instanceId) return;
      term.write(p.chunk);
    });

    const inputDisp = term.onData((data) => {
      void window.watchtower.invoke('ptyWrite', { instanceId, data });
    });

    // Push initial geometry to the pty so claude renders at the right width.
    void window.watchtower.invoke('ptyResize', {
      instanceId,
      cols: term.cols,
      rows: term.rows,
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void window.watchtower.invoke('ptyResize', {
          instanceId,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        // fit can throw if the element is hidden — ignore until next observe.
      }
    });
    ro.observe(containerRef.current);

    return () => {
      offData();
      inputDisp.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [instanceId]);

  // Re-fit + focus when the tab becomes active (geometry might have changed
  // while the terminal was hidden behind another tab).
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
      void window.watchtower.invoke('ptyResize', {
        instanceId,
        cols: term.cols,
        rows: term.rows,
      });
    } catch {
      /* hidden — ignore */
    }
    term.focus();
  }, [active, instanceId]);

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        // Hide inactive terminals via visibility (not display:none) so xterm's
        // canvas dimensions stay valid; we re-fit when they become active.
        visibility: active ? 'visible' : 'hidden',
      }}
    >
      <Box ref={containerRef} sx={{ position: 'absolute', inset: 0, backgroundColor: '#0e0f12' }} />
      {isStarting && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
            backgroundColor: '#0e0f12',
            color: 'text.secondary',
          }}
        >
          <CircularProgress size={22} thickness={4} />
          <Typography variant="caption">
            {status === 'resuming' ? 'Resuming claude…' : 'Starting claude…'}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
