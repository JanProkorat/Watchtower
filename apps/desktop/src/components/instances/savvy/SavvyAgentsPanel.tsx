import { useState } from 'react';
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
const PAD = 12;
const DRAW_W = PANEL_W - PAD * 2;

interface Props {
  snapshot: SavvyProgressSnapshot;
  /** "Now" on the mod's clock (renderer time minus the measured skew). */
  at: number;
  onClose(): void;
}

/**
 * The savvy-progress mod's agents panel, drawn natively: the same SVG rows the
 * mod draws on Claude Code's desktop surface (crabs and all), laid out the way
 * its `Pane` lays them out. Each row is an `<img>` so its `<style>` stays out of
 * the app's CSS and its animations run on the compositor.
 */
export function SavvyAgentsPanel({ snapshot, at, onClose }: Props) {
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

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        overflow: 'hidden',
        backgroundColor: isDark ? '#1b1b1a' : '#fbfaf8',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,18,24,0.10)'}`,
        boxShadow: isDark ? '0 10px 28px rgba(0,0,0,0.40)' : '0 10px 26px rgba(15,18,24,0.16)',
      }}
    >
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
            source={compactSvg(ctx, DRAW_W, list, planned, t)}
            height={COMPACT_H}
            alt={`${list.length} ${s.agentsCount}`}
          />
        ) : (
          <>
            <Row source={headerSvg(ctx, DRAW_W, title, t)} height={headerHeight(title)} alt={title || s.pane} />
            {isEmpty && <Section>{s.empty}</Section>}
            {running.length > 0 && <Section>{`${s.running} · ${running.length}`}</Section>}
            {running.map((a) => (
              <Row
                key={a.id}
                source={agentSvg(ctx, DRAW_W, a, at)}
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
                  source={agentSvg(ctx, DRAW_W, a, at)}
                  height={AGENT_ROW_H}
                  alt={`${a.description}: ${modelName(a.model)}, ${s.isFinished}`}
                />
              ))}
            {planned.length > 0 && <Section>{`${s.planned} · ${planned.length}`}</Section>}
            {planned.map((pl) => (
              <Row
                key={`plan-${pl.n}`}
                source={plannedSvg(ctx, DRAW_W, pl)}
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

function Row({ source, height, alt }: { source: string; height: number; alt: string }) {
  return <Box component="img" src={svgDataUri(source)} alt={alt} width={DRAW_W} height={height} sx={{ display: 'block' }} />;
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
