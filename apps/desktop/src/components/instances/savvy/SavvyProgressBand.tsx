import { useLayoutEffect, useRef, useState } from 'react';
import { Box, ButtonBase, IconButton, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import type { SavvyFlow } from '@watchtower/shared/savvyProgress.js';
import { BAND_H, label, ratio, rowSvg, svgDataUri, type Lang } from './savvyDraw.js';

export const BAND_BOX_H = 34;

interface Props {
  flow: SavvyFlow;
  lang: Lang;
  crew: number;
  isWorking: boolean;
  onToggleAgents(): void;
  onDismiss(): void;
}

/**
 * The savvy-progress mod's band above the prompt — title, dithered progress
 * bar, percent and the walking crab — drawn natively below the terminal, with
 * the crew count that toggles the agents panel and a dismiss.
 */
export function SavvyProgressBand({ flow, lang, crew, isWorking, onToggleAgents, onDismiss }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const slotRef = useRef<HTMLDivElement | null>(null);
  const width = useWidth(slotRef);
  const percent = `${Math.round(ratio(flow) * 100)}%`;

  return (
    <Box
      sx={{
        height: BAND_BOX_H,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        borderRadius: '10px',
        backgroundColor: isDark ? '#1b1b1a' : '#fbfaf8',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,18,24,0.10)'}`,
      }}
    >
      <Box ref={slotRef} sx={{ flex: 1, minWidth: 0, height: BAND_H }}>
        {width > 0 && (
          <Box
            component="img"
            src={svgDataUri(rowSvg({ lang, dark: isDark }, flow, width, isWorking))}
            alt={`${flow.title}: ${label(flow, lang)}, ${percent}`}
            width={width}
            height={BAND_H}
            sx={{ display: 'block' }}
          />
        )}
      </Box>
      <Tooltip title="Agents panel">
        <ButtonBase
          onClick={onToggleAgents}
          sx={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'text.secondary', borderRadius: '6px', px: 0.75, py: 0.25, ':hover': { color: 'text.primary', backgroundColor: 'action.hover' } }}
        >
          {`×${crew}`}
        </ButtonBase>
      </Tooltip>
      <Tooltip title="Dismiss">
        <IconButton aria-label="Dismiss progress band" size="small" onClick={onDismiss} sx={{ width: 22, height: 22 }}>
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
