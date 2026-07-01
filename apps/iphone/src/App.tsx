import { text } from '@watchtower/ui-core';

// P4 placeholder — the real iPhone shell (auth gate + bottom-tab TimeTracker)
// lands in P5.
export function App(): JSX.Element {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: text.muted,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 15,
      }}
    >
      Watchtower iPhone
    </div>
  );
}
