import { useEffect, useState, type ReactNode } from 'react';
import { Box, Button, Typography } from '@mui/material';
import type { CacheTaxState, ModBands, ReflectAction, ReflectItem } from '@watchtower/shared/modBands.js';
import { ATTENTION_AMBER } from '../../../theme/glass.js';

const CACHE_COLOR: Record<CacheTaxState, string> = { warm: 'success.main', cold: '#d97757', stopped: 'text.secondary', unknown: 'text.secondary' };
const TASK_MARK = { 'in progress': '●', done: '✓', interrupted: '✕' } as const;

interface Props {
  bands: ModBands;
  onReflect(itemId: string, action: ReflectAction): void;
}

/** What cache-tax, collision-guard and reflect-mod draw above the prompt outside Watchtower. */
export function ModsTab({ bands, onReflect }: Props) {
  const { cacheTax, peers, reflect } = bands;
  if (!cacheTax && peers.length === 0 && reflect.length === 0) {
    return <Typography sx={{ fontSize: 12.5, color: 'text.secondary', px: 1.5, py: 1 }}>Nothing from the mods yet.</Typography>;
  }
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 1.5, pb: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {peers.length > 0 && (
        <Section title="Other sessions in this repo">
          {peers.map((p) => (
            <Box key={p.id} data-testid={`peer-${p.id}`}>
              <Typography sx={{ fontSize: 12.5, color: ATTENTION_AMBER }}>
                {`⚠ Session ${p.id.slice(0, 8)}${p.where ? ` (in ${p.where})` : ''}`}
              </Typography>
              {p.tasks.length === 0 ? (
                <Typography sx={{ fontSize: 12, color: 'text.secondary', pl: 2 }}>No prompt yet</Typography>
              ) : (
                p.tasks.map((t) => (
                  <Typography key={t.at} sx={{ fontSize: 12, pl: 2, color: t.status === 'in progress' ? 'text.primary' : 'text.secondary' }}>
                    {`${TASK_MARK[t.status]} ${t.status}: ${t.text}`}
                  </Typography>
                ))
              )}
            </Box>
          ))}
        </Section>
      )}
      {reflect.length > 0 && (
        <Section title="Learned rules">
          {reflect.map((item) => (
            <ReflectRow key={item.id} item={item} onReflect={onReflect} />
          ))}
        </Section>
      )}
      {cacheTax && (
        <Section title="Prompt cache">
          <Typography sx={{ fontSize: 12.5 }}>
            <Box component="span" sx={{ color: CACHE_COLOR[cacheTax.state], fontWeight: 600 }}>{cacheTax.state}</Box>
            <Box component="span" sx={{ color: 'text.secondary' }}>{cacheTax.text}</Box>
          </Typography>
        </Section>
      )}
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mb: 0.5 }}>{title}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</Box>
    </Box>
  );
}

/** A refused action (Edit with text in the prompt box) leaves the rule listed; its buttons unlock again after this. */
export const RELOCK_MS = 5_000;

/** One rule; its buttons lock after a click until the mod re-posts without it. */
function ReflectRow({ item, onReflect }: { item: ReflectItem; onReflect(itemId: string, action: ReflectAction): void }) {
  const [isSent, setIsSent] = useState(false);
  useEffect(() => {
    if (!isSent) return;
    const t = setTimeout(() => setIsSent(false), RELOCK_MS);
    return () => clearTimeout(t);
  }, [isSent]);
  const act = (action: ReflectAction) => {
    setIsSent(true);
    onReflect(item.id, action);
  };
  const isProject = item.scope === 'project';
  return (
    <Box data-testid={`rule-${item.id}`} sx={{ borderRadius: '6px', backgroundColor: 'action.hover', p: 1, opacity: isSent ? 0.5 : 1 }}>
      <Typography sx={{ fontSize: 12.5 }}>
        {item.rule}
        {item.count > 1 && <Box component="span" sx={{ color: 'text.secondary' }}>{` ×${item.count}`}</Box>}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
        <Button size="small" variant="contained" disabled={isSent} onClick={() => act('save')}>
          {isProject ? 'Save to ./CLAUDE.md' : 'Save to ~/.claude/CLAUDE.md'}
        </Button>
        <Button size="small" disabled={isSent} onClick={() => act('other')}>{isProject ? 'Global instead' : 'This repo instead'}</Button>
        <Button size="small" disabled={isSent} onClick={() => act('edit')}>Edit</Button>
        <Button size="small" disabled={isSent} onClick={() => act('skip')}>Skip</Button>
      </Box>
    </Box>
  );
}
