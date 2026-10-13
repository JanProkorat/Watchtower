import { useEffect, useState, type KeyboardEvent } from 'react';
import { Box, Button, ButtonBase, Typography } from '@mui/material';
import type { ReplayLineKind, ReplayTurn } from '@watchtower/shared/replay.js';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const LINE_STYLE: Record<ReplayLineKind, { color: string; sign: string }> = {
  add: { color: '#5fbf8f', sign: '+' },
  del: { color: '#e5534b', sign: '-' },
  ctx: { color: 'text.secondary', sign: ' ' },
  gap: { color: 'text.secondary', sign: '' },
};

/** The replay-theater mod's last turn: one edit at a time, as a diff. */
export function ReplayTab({ turn }: { turn: ReplayTurn | null }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [turn?.at]);
  if (!turn || turn.steps.length === 0) {
    return <Typography sx={{ fontSize: 12.5, color: 'text.secondary', px: 1.5, py: 1 }}>No edits in the last turn yet.</Typography>;
  }
  const last = turn.steps.length - 1;
  const i = Math.min(index, last);
  const step = turn.steps[i]!;
  const go = (n: number) => setIndex(Math.max(0, Math.min(last, n)));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
    else return;
    e.preventDefault();
  };

  return (
    <Box data-testid="replay" tabIndex={0} onKeyDown={onKeyDown} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 1, pb: 1, outline: 'none' }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
        {turn.steps.map((_, n) => (
          <ButtonBase
            key={n}
            aria-label={`Step ${n + 1}`}
            aria-current={n === i ? 'step' : undefined}
            onClick={() => go(n)}
            sx={{ minWidth: 22, height: 22, px: 0.5, borderRadius: '6px', fontSize: 11.5, backgroundColor: n === i ? 'primary.main' : 'action.hover', color: n === i ? 'primary.contrastText' : 'text.secondary' }}
          >
            {n + 1}
          </ButtonBase>
        ))}
      </Box>
      <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>{step.file}</Typography>
      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mb: 0.5 }}>
        {`${step.tool}${step.note ? ` · ${step.note}` : ''} +${step.added} −${step.deleted}`}
      </Typography>
      <Box sx={{ flex: 1, overflow: 'auto', fontFamily: MONO, fontSize: 12, borderRadius: '6px', backgroundColor: 'action.hover', p: 1 }}>
        {step.lines.map((l, n) => (
          <Box key={n} data-kind={l.kind} sx={{ color: LINE_STYLE[l.kind].color, whiteSpace: 'pre', opacity: l.kind === 'ctx' ? 0.7 : 1 }}>
            {l.kind === 'gap' ? '⋯' : <><span>{LINE_STYLE[l.kind].sign} </span>{l.text}</>}
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Button size="small" disabled={i === 0} onClick={() => go(i - 1)}>Prev</Button>
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', alignSelf: 'center' }}>{`${i + 1} of ${turn.steps.length}`}</Typography>
        <Button size="small" disabled={i === last} onClick={() => go(i + 1)}>Next</Button>
      </Box>
    </Box>
  );
}
