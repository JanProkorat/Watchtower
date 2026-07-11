import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useSlotForInstance } from './instances/SlotRegistry.js';
import { signalTerminalInteraction } from './instances/terminalInteraction.js';

interface Props {
  instanceId: string;
  status: string;
}

const STARTING_STATUSES = new Set(['spawning', 'resuming']);
// Safety net: if the SessionStart hook never fires (claude was spawned before
// Watchtower installed its hooks, or the listener can't reach us) the spinner
// would hang forever. After this many ms we hide it regardless and trust that
// claude is up.
const SPINNER_FALLBACK_MS = 10_000;

export function Terminal({ instanceId, status }: Props) {
  const homeRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [fallbackElapsed, setFallbackElapsed] = useState(false);
  const slot = useSlotForInstance(instanceId);
  const isStarting = STARTING_STATUSES.has(status) && !fallbackElapsed;

  const statusRef = useRef(status);
  statusRef.current = status;

  const clearAttentionOnInteraction = () =>
    signalTerminalInteraction(instanceId, statusRef.current, (id) =>
      void window.watchtower.invoke('focusChanged', { instanceId: id }),
    );

  useEffect(() => {
    if (!STARTING_STATUSES.has(status)) return;
    const t = setTimeout(() => setFallbackElapsed(true), SPINNER_FALLBACK_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount xterm once per instance. The host element is created via React (the
  // `hostRef` div below); xterm attaches its canvas inside it. We never let
  // React unmount the host — instead we reparent it via appendChild between
  // the hidden "home" pool and whatever slot is currently bound.
  useEffect(() => {
    if (!hostRef.current) return;
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
    term.open(hostRef.current);
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* hidden */
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
      clearAttentionOnInteraction();
    });
    void window.watchtower.invoke('ptyResize', {
      instanceId,
      cols: term.cols,
      rows: term.rows,
    });
    void window.watchtower.invoke('terminalFocus', { instanceId });

    const host = hostRef.current;
    const onHostMouseDown = () => clearAttentionOnInteraction();
    host.addEventListener('mousedown', onHostMouseDown, true);

    return () => {
      offData();
      inputDisp.dispose();
      host.removeEventListener('mousedown', onHostMouseDown, true);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [instanceId]);

  // Reparent host into the bound slot (or back to home when no slot is bound).
  useEffect(() => {
    const host = hostRef.current;
    const home = homeRef.current;
    if (!host) return;
    const target = slot ?? home;
    if (target && host.parentElement !== target) {
      target.appendChild(host);
      if (slot) {
        const fit = fitRef.current;
        const term = termRef.current;
        requestAnimationFrame(() => {
          try {
            fit?.fit();
            if (term) {
              void window.watchtower.invoke('ptyResize', {
                instanceId,
                cols: term.cols,
                rows: term.rows,
              });
              term.focus();
              void window.watchtower.invoke('terminalFocus', { instanceId });
            }
          } catch {
            /* hidden */
          }
        });
      }
    }
  }, [slot, instanceId]);

  // Re-fit whenever the bound slot resizes.
  useEffect(() => {
    if (!slot) return;
    const fit = fitRef.current;
    if (!fit) return;
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const term = termRef.current;
        if (term) {
          void window.watchtower.invoke('ptyResize', {
            instanceId,
            cols: term.cols,
            rows: term.rows,
          });
        }
      } catch {
        /* hidden */
      }
    });
    ro.observe(slot);
    return () => ro.disconnect();
  }, [slot, instanceId]);

  return (
    <Box ref={homeRef} sx={{ display: 'none' }} aria-hidden>
      <Box
        ref={hostRef}
        sx={{ position: 'absolute', inset: 0, backgroundColor: '#0e0f12' }}
      >
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
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <CircularProgress size={22} thickness={4} />
            <Typography variant="caption">
              {status === 'resuming' ? 'Resuming claude…' : 'Starting claude…'}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
