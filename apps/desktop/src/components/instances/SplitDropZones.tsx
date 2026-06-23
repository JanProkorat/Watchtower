import { Box } from '@mui/material';
import { useDroppable } from '@dnd-kit/core';

interface Props {
  leafId: string;
  visible: boolean;
}

const ZONES = ['centre', 'left', 'right', 'top', 'bottom'] as const;
type Zone = (typeof ZONES)[number];

export function SplitDropZones({ leafId, visible }: Props) {
  if (!visible) return null;
  return (
    <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      {ZONES.map((z) => (
        <DropZone key={z} leafId={leafId} zone={z} />
      ))}
    </Box>
  );
}

function DropZone({ leafId, zone }: { leafId: string; zone: Zone }) {
  const { isOver, setNodeRef } = useDroppable({ id: `leaf:${leafId}:${zone}` });
  const style = zoneStyle(zone, isOver);
  return <Box ref={setNodeRef} sx={style} />;
}

function zoneStyle(zone: Zone, isOver: boolean) {
  const base = {
    position: 'absolute' as const,
    pointerEvents: 'auto' as const,
    backgroundColor: isOver ? 'rgba(125, 99, 255, 0.30)' : 'rgba(125, 99, 255, 0.05)',
    border: isOver ? '2px dashed rgba(255,255,255,0.6)' : '2px dashed transparent',
    transition: 'background-color 120ms',
  };
  switch (zone) {
    case 'left':
      return { ...base, top: 0, left: 0, bottom: 0, width: '25%' };
    case 'right':
      return { ...base, top: 0, right: 0, bottom: 0, width: '25%' };
    case 'top':
      return { ...base, top: 0, left: '25%', right: '25%', height: '25%' };
    case 'bottom':
      return { ...base, bottom: 0, left: '25%', right: '25%', height: '25%' };
    case 'centre':
      return { ...base, top: '25%', left: '25%', right: '25%', bottom: '25%' };
  }
}
