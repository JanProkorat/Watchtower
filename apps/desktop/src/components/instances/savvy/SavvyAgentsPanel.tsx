import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import type { SavvyProgressSnapshot } from '@watchtower/shared/savvyProgress.js';
import {
  AGENT_ROW_H,
  COMPACT_H,
  PLANNED_ROW_H,
  STRINGS,
  agentSvg,
  compactSvg,
  headerHeight,
  headerSvg,
  modelName,
  plannedOf,
  plannedSvg,
  svgDataUri,
  totals,
  type DrawCtx,
} from './savvyDraw.js';

export const PANEL_W = 340;
const MIN_W = 260;
const MAX_W = 720;
const PAD = 12;

export const clampPanelWidth = (w: number): number =>
  Number.isFinite(w) ? Math.round(Math.min(MAX_W, Math.max(MIN_W, w))) : PANEL_W;

interface Props {
  snapshot: SavvyProgressSnapshot;
  /** "Now" on the mod's clock (renderer time minus the measured skew). */
  at: number;
  width: number;
  /** Called while the left edge is dragged, with the width it asks for. */
  onResize(width: number): void;
  onClose(): void;
}

/**
 * The savvy-progress mod's agents panel, drawn natively: the same SVG rows the
 * mod draws on Claude Code's desktop surface (crabs and all), laid out the way
 * its `Pane` lays them out. Each row is an `<img>` so its `<style>` stays out of
 * the app's CSS and its animations run on the compositor. The frame (fill,
 * border) comes from PaneCard, so the panel reads as part of the instance card.
 */
export function SavvyAgentsPanel({ snapshot, at, width, onResize, onClose }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const ctx: DrawCtx = { lang: snapshot.lang, dark: isDark };
  const s = STRINGS[ctx.lang];
  const [isCompact, setIsCompact] = useState(false);
  const [isDoneCollapsed, setIsDoneCollapsed] = useState(false);

  const list = snapshot.agents;
  const f = snapshot.flow;
  const running = list.filter((a) => a.status === 'running').reverse();
  const finished = list.filter((a) => a.status !== 'running').reverse();
  const planned = plannedOf(f, list);
  const t = totals(list, at);
  const title = f && !f.isFinished ? f.title : '';
  const isEmpty = list.length === 0 && planned.length === 0;
  const drawW = width - PAD * 2;

  return (
    <Box sx={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <ResizeEdge width={width} onResize={onResize} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: `${PAD}px`, pt: 1, pb: 0.5 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{s.pane}</Typography>
        <TextButton onClick={() => setIsCompact((v) => !v)}>{isCompact ? s.expand : s.collapse}</TextButton>
        <Tooltip title="Hide panel">
          <IconButton aria-label="Hide agents panel" size="small" onClick={onClose} sx={{ width: 22, height: 22 }}>
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: `${PAD}px`, pb: `${PAD}px` }}>
        {isCompact ? (
          <Row
            source={compactSvg(ctx, drawW, list, planned, t)}
            width={drawW}
            height={COMPACT_H}
            alt={`${list.length} ${s.agentsCount}`}
          />
        ) : (
          <>
            <Row source={headerSvg(ctx, drawW, title, t)} width={drawW} height={headerHeight(title)} alt={title || s.pane} />
            {isEmpty && <Section>{s.empty}</Section>}
            {running.length > 0 && <Section>{`${s.running} · ${running.length}`}</Section>}
            {running.map((a) => (
              <Row
                key={a.id}
                source={agentSvg(ctx, drawW, a, at)}
                width={drawW}
                height={AGENT_ROW_H}
                alt={`${a.description}: ${modelName(a.model)}, ${s.isRunning}`}
              />
            ))}
            {finished.length > 0 && (
              <TextButton onClick={() => setIsDoneCollapsed((v) => !v)} sx={{ mt: 1 }}>
                {`${isDoneCollapsed ? '▸' : '▾'} ${s.finished} · ${finished.length}`}
              </TextButton>
            )}
            {!isDoneCollapsed &&
              finished.map((a) => (
                <Row
                  key={a.id}
                  source={agentSvg(ctx, drawW, a, at)}
                  width={drawW}
                  height={AGENT_ROW_H}
                  alt={`${a.description}: ${modelName(a.model)}, ${s.isFinished}`}
                />
              ))}
            {planned.length > 0 && <Section>{`${s.planned} · ${planned.length}`}</Section>}
            {planned.map((pl) => (
              <Row
                key={`plan-${pl.n}`}
                source={plannedSvg(ctx, drawW, pl)}
                width={drawW}
                height={PLANNED_ROW_H}
                alt={`${pl.n}. ${pl.title}: ${s.isPlanned}`}
              />
            ))}
          </>
        )}
      </Box>
    </Box>
  );
}

function Row({ source, width, height, alt }: { source: string; width: number; height: number; alt: string }) {
  return <Box component="img" src={svgDataUri(source)} alt={alt} width={width} height={height} sx={{ display: 'block' }} />;
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
      aria-label="Resize agents panel"
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

function Section({ children }: { children: string }) {
  return (
    <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 1.25, mb: 0.25 }}>{children}</Typography>
  );
}

function TextButton({ children, onClick, sx }: { children: string; onClick(): void; sx?: object }) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        fontSize: 11.5,
        color: 'text.secondary',
        borderRadius: '6px',
        px: 0.75,
        py: 0.25,
        ':hover': { color: 'text.primary', backgroundColor: 'action.hover' },
        ...sx,
      }}
    >
      {children}
    </ButtonBase>
  );
}
