import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
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

  return (
    <Box
      ref={ref}
      sx={{
        position: 'absolute',
        inset: 0,
        backgroundColor: '#0e0f12',
        outline: focused ? `2px solid ${accent ?? 'currentColor'}` : 'none',
        outlineOffset: -2,
      }}
    />
  );
}
