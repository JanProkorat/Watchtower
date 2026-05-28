import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { useSlotRegistration } from './SlotRegistry.js';

interface Props {
  instanceId: string;
  focused: boolean;
  onFocus(): void;
}

export function ColumnSlot({ instanceId, focused, onFocus }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const register = useSlotRegistration();
  useEffect(() => {
    return register(instanceId, ref.current);
  }, [instanceId, register]);

  return (
    <Box
      ref={ref}
      onMouseDown={onFocus}
      sx={{
        position: 'relative',
        flex: 1,
        height: '100%',
        minWidth: 0,
        backgroundColor: '#0e0f12',
        outline: focused ? '2px solid' : 'none',
        outlineColor: 'primary.main',
        outlineOffset: -2,
      }}
    />
  );
}
