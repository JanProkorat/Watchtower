// apps/ipad/src/components/TerminalView.tsx
import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useConnection } from '../state/connectionContext.js';
import { attachTerminal } from '../lib/attachTerminal.js';

interface Props {
  instanceId: string;
}

export function TerminalView({ instanceId }: Props) {
  const { bridge } = useConnection();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // --- Create xterm + FitAddon ---
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
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // Initial fit — deferred one frame so the DOM has laid out.
    requestAnimationFrame(() => {
      try { fit.fit(); } catch { /* hidden element, will fit later */ }
    });

    // --- Wire keystrokes straight through to the pty ---
    const inputDisp = term.onData((data) => {
      void bridge.invoke('ptyWrite', { instanceId, data });
    });

    // --- Focus detection ---
    // xterm exposes its hidden textarea; listening to its focus event is the
    // most reliable way to detect focus on both desktop browsers and Capacitor
    // WebView (tapping inside the terminal shifts input focus to the textarea).
    const onTextareaFocus = () => {
      void bridge.invoke('terminalFocus', { instanceId });
    };
    term.textarea?.addEventListener('focus', onTextareaFocus);

    // Emit focus on mount so the orchestrator knows which session has the pty
    // even before the user taps into the terminal.
    void bridge.invoke('terminalFocus', { instanceId });

    // --- ResizeObserver ---
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void bridge.invoke('ptyResize', { instanceId, cols: term.cols, rows: term.rows });
      } catch { /* ignore during teardown */ }
    });
    ro.observe(host);

    // --- Attach to live pty stream ---
    // sink.resize is intentionally a no-op: we fit to our own viewport, not
    // the snapshot dims. The ResizeObserver above drives ptyResize; focus
    // ownership (Task 4) lets the orchestrator follow this client's size.
    let attachDispose: (() => void) | null = null;
    // Guard against the component unmounting between attach resolving and the
    // rAF firing; avoids calling ptyResize (and fit.fit on a disposed terminal)
    // after teardown.
    let disposed = false;
    void attachTerminal(bridge, instanceId, {
      write: (d) => term.write(d),
      resize: () => { /* no-op: viewport-fit takes priority */ },
    }).then((handle) => {
      if (disposed) { handle.dispose(); return; }
      attachDispose = handle.dispose;
      // After the snapshot is applied, fit once more and report current size.
      requestAnimationFrame(() => {
        if (disposed) return;
        try {
          fit.fit();
          void bridge.invoke('ptyResize', { instanceId, cols: term.cols, rows: term.rows });
        } catch { /* ignore */ }
      });
    }).catch(() => {
      /* attach failed (e.g. WS drop); reconnect remount will retry */
    });

    return () => {
      disposed = true;
      term.textarea?.removeEventListener('focus', onTextareaFocus);
      inputDisp.dispose();
      ro.disconnect();
      if (attachDispose) attachDispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  // We deliberately re-run only when instanceId or bridge changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, bridge]);

  return (
    <div
      ref={hostRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#0e0f12',
        overflow: 'hidden',
        position: 'relative',
      }}
    />
  );
}
