import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Box, ButtonBase, IconButton, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { SideTab } from './useSidePanel.js';

export const SIDE_TAB_LABEL: Record<SideTab, string> = { agents: 'Agents', files: 'Files', replay: 'Replay' };

interface Props {
  tabs: readonly SideTab[];
  tab: SideTab;
  width: number;
  /** Per-tab badge; shown after the label when above 0. */
  counts?: Partial<Record<SideTab, number>>;
  onSelect(tab: SideTab): void;
  onClose(): void;
  onResize(width: number): void;
  children: ReactNode;
}

/** The right-side panel's chrome: tab strip, close button and resize edge. PaneCard draws the frame. */
export function SidePanel({ tabs, tab, width, counts, onSelect, onClose, onResize, children }: Props) {
  return (
    <Box sx={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ResizeEdge width={width} onResize={onResize} />
      <Box role="tablist" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pt: 0.75, pb: 0.5 }}>
        {tabs.map((t) => (
          <ButtonBase
            key={t}
            role="tab"
            aria-selected={t === tab}
            onClick={() => onSelect(t)}
            sx={{
              fontSize: 12.5,
              fontWeight: t === tab ? 600 : 500,
              color: t === tab ? 'text.primary' : 'text.secondary',
              borderRadius: '6px',
              px: 1,
              py: 0.25,
              backgroundColor: t === tab ? 'action.selected' : 'transparent',
              ':hover': { color: 'text.primary', backgroundColor: 'action.hover' },
            }}
          >
            {SIDE_TAB_LABEL[t]}
            {counts?.[t] ? ` · ${counts[t]}` : ''}
          </ButtonBase>
        ))}
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Hide panel">
          <IconButton aria-label="Hide side panel" size="small" onClick={onClose} sx={{ width: 22, height: 22 }}>
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</Box>
    </Box>
  );
}

/** The panel's left edge: drag it to change the width. */
function ResizeEdge({ width, onResize }: { width: number; onResize(width: number): void }) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onResize(width + (startX - ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize side panel"
      onPointerDown={onPointerDown}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: -4,
        width: 8,
        zIndex: 2,
        cursor: 'col-resize',
        ':hover::after': { opacity: 1 },
        '::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 3,
          width: 2,
          backgroundColor: 'primary.main',
          opacity: 0,
          transition: 'opacity 120ms ease',
        },
      }}
    />
  );
}
