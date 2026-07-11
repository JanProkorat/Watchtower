import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useSlotRegistration } from './SlotRegistry.js';

interface Props {
  instanceId: string;
  focused: boolean;
  accent?: string;
  onFocus(): void;
}

export function ColumnSlot({ instanceId, focused, accent, onFocus }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const register = useSlotRegistration();
  const theme = useTheme();
  useEffect(() => {
    return register(instanceId, ref.current);
  }, [instanceId, register]);

  // The xterm terminal is reparented into this slot via raw `appendChild`, so
  // it lives outside React's fiber tree — a React `onMouseDown` here never sees
  // clicks that land on the terminal. Listen natively in the capture phase so a
  // click anywhere in the slot (terminal included) focuses the session, even if
  // xterm stops propagation on the way back up.
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => onFocusRef.current();
    el.addEventListener('mousedown', handler, { capture: true });
    return () => el.removeEventListener('mousedown', handler, { capture: true });
  }, []);

  // Each instance is a rounded liquid-glass card: opaque dark terminal fill
  // (terminals stay readable), rounded corners that clip the reparented xterm,
  // a soft drop shadow that lifts the card off the vibrancy backdrop, and a thin
  // accent line along the top edge when focused (iPad PaneTerminal language).
  const isDark = theme.palette.mode === 'dark';
  const drop = isDark ? '0 10px 28px rgba(0,0,0,0.40)' : '0 10px 26px rgba(15,18,24,0.16)';
  const topHighlight = isDark ? 'inset 0 1px 0 rgba(255,255,255,0.06)' : 'inset 0 1px 0 rgba(255,255,255,0.40)';
  const focusLine = `inset 0 3px 0 ${accent ?? theme.palette.primary.main}`;
  return (
    <Box
      ref={ref}
      sx={{
        position: 'absolute',
        inset: 0,
        backgroundColor: '#0e0f12',
        borderRadius: '12px',
        overflow: 'hidden',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,18,24,0.10)'}`,
        boxShadow: focused ? `${focusLine}, ${drop}, ${topHighlight}` : `${drop}, ${topHighlight}`,
        transition: 'box-shadow 120ms ease',
      }}
    />
  );
}
