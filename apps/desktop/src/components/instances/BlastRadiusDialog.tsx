import { useEffect, useRef, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import type { BlastDecision, BlastHold } from '@watchtower/shared/blastRadius.js';

interface Props {
  hold: BlastHold;
  decided: BlastDecision | null;
  onDecide(decision: BlastDecision): void;
}

// Bidi controls and C0/C1 controls (except \n and \t) can disguise what a command does.
// eslint-disable-next-line no-control-regex
const HIDDEN_CHARS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/** Replaces characters that can hide a command's real meaning with a visible marker. */
export function visible(text: string): string {
  return text.replace(HIDDEN_CHARS, '\uFFFD');
}

/** Proceed stays disabled this long after the popup appears, so a click already in flight cannot land on it. */
const PROCEED_ARM_MS = 500;

/** The blast-radius mod's hold, drawn over its pane: Claude waits until the user answers. */
export function BlastRadiusDialog({ hold, decided, onDecide }: Props) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, [hold.id]);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    const t = setTimeout(() => setArmed(true), PROCEED_ARM_MS);
    return () => clearTimeout(t);
  }, [hold.id]);
  const title = `⚠ Blast Radius · ${hold.riskLabel}`;

  return (
    <Box sx={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: '12px' }}>
      <Box
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !decided) {
            e.preventDefault();
            onDecide('cancel');
          }
        }}
        sx={{ width: 'min(560px, 92%)', maxHeight: '80%', overflowY: 'auto', p: 2, borderRadius: '12px', border: '1px solid #e0a43a', backgroundColor: 'background.paper', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}
      >
        <Typography sx={{ fontWeight: 700, color: '#e0a43a', mb: 1 }}>{title}</Typography>
        <Typography component="pre" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all', m: 0, mb: 1, fontWeight: 600 }}>
          {visible(hold.command)}
        </Typography>
        {hold.commandTruncated && (
          <Typography sx={{ fontSize: 12, color: 'warning.main', mb: 1 }}>
            Command shortened — the full command is longer than shown.
          </Typography>
        )}
        <Typography sx={{ color: '#e5534b', fontSize: 13, mb: 0.5 }}>{`Would ${hold.summary}`}</Typography>
        {hold.lines.map((l, i) => (
          <Typography key={`${i}:${l}`} sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: 'text.secondary' }}>
            {visible(l)}
          </Typography>
        ))}
        {hold.more > 0 && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{`+${hold.more} more`}</Typography>}
        {hold.note && <Typography sx={{ fontSize: 12, fontStyle: 'italic', color: 'text.secondary', mt: 1 }}>{hold.note}</Typography>}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>{decided ? 'Waiting for Claude…' : 'Claude is waiting on your answer'}</Typography>
          <Button variant="outlined" color="warning" disabled={!!decided || !armed} onClick={() => armed && onDecide('proceed')}>
            Proceed
          </Button>
          <Button ref={cancelRef} variant="contained" disabled={!!decided} onClick={() => onDecide('cancel')}>
            Cancel
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
