// apps/iphone/src/components/ErrorBoundary.tsx
//
// Top-level error boundary. Without one, any render-time throw unmounts the
// whole React tree and the WKWebView shows a blank white page with no clue.
// This catches it and shows the error message + stack on screen instead — both
// a real UX safeguard and a fast way to read a device-only crash (no Safari Web
// Inspector needed).
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null; info: string | null }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep it on screen; also log for the Xcode/Safari console.
    this.setState({ info: info.componentStack ?? null });
    // eslint-disable-next-line no-console
    console.error('[Watchtower] render crash:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        style={{
          minHeight: '100%',
          padding: '32px 20px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: '#fca5a5',
          background: '#0b0c11',
          overflow: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: '#f87171' }}>
          Aplikace narazila na chybu
        </div>
        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 16 }}>
          {error.message}
        </div>
        {error.stack && (
          <pre style={{ fontSize: 11, color: '#9aa1ab', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
            {error.stack}
          </pre>
        )}
        {info && (
          <pre style={{ fontSize: 11, color: '#5a6072', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 12 }}>
            {info}
          </pre>
        )}
      </div>
    );
  }
}
