import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Box } from '@mui/material';

interface Props {
  instanceId: string;
  active: boolean;
}

export function Terminal({ instanceId, active }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

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
      if (p.instanceId === instanceId) term.write(p.chunk);
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
      ref={containerRef}
      sx={{
        position: 'absolute',
        inset: 0,
        backgroundColor: '#0e0f12',
        // Hide inactive terminals via visibility (not display:none) so xterm's
        // canvas dimensions stay valid; we re-fit when they become active.
        visibility: active ? 'visible' : 'hidden',
      }}
    />
  );
}
