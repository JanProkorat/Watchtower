import { useState } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
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
}

/**
 * The savvy-progress mod's agents panel, drawn natively: the same SVG rows the
 * mod draws on Claude Code's desktop surface, laid out the way its `Pane` lays
 * them out. Agents tab body; SidePanel draws the chrome.
 */
export function SavvyAgentsPanel({ snapshot, at, width }: Props) {
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
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: `${PAD}px`, pb: 0.5 }}>
        <TextButton onClick={() => setIsCompact((v) => !v)}>{isCompact ? s.expand : s.collapse}</TextButton>
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
