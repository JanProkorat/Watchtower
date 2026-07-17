import { useEffect, useRef } from 'react';
import { Box, Typography, Chip, Link } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type { PrCommentThreadPayload } from '@watchtower/shared/ipcContract.js';
import { glassFill } from '../../theme/glass.js';

/** Latest comment timestamp in a thread (empty string if it has none). */
function threadLatest(t: PrCommentThreadPayload): string {
  return t.comments.reduce((max, c) => (c.date > max ? c.date : max), '');
}

/**
 * Id of the thread whose most-recent comment is newest overall — the best
 * author-less guess at "the comment a notification is about", since the inbox
 * doesn't store a comment id. Null when there are no threads.
 */
export function newestThreadId(threads: PrCommentThreadPayload[]): string | null {
  let bestId: string | null = null;
  let bestTs = '';
  for (const t of threads) {
    const ts = threadLatest(t);
    if (bestId === null || ts > bestTs) { bestId = t.id; bestTs = ts; }
  }
  return bestId;
}

export function formatCommentDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('cs-CZ');
}

export type Seg = { text: string } | { href: string; label: string };

const MD_LINK_OR_URL = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;

export function parseCommentBody(body: string): Seg[] {
  const segs: Seg[] = [];
  let lastIndex = 0;
  for (const m of body.matchAll(MD_LINK_OR_URL)) {
    const idx = m.index ?? 0;
    if (idx > lastIndex) segs.push({ text: body.slice(lastIndex, idx) });
    if (m[1] !== undefined && m[2] !== undefined) {
      segs.push({ href: m[2], label: m[1] });
    } else if (m[3] !== undefined) {
      segs.push({ href: m[3], label: m[3] });
    }
    lastIndex = idx + m[0].length;
  }
  if (lastIndex < body.length) segs.push({ text: body.slice(lastIndex) });
  return segs;
}

function renderCommentBody(body: string): JSX.Element {
  const segs = parseCommentBody(body);
  return (
    <Typography sx={{ fontSize: 12.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {segs.map((s, i) =>
        'href' in s
          ? <Link key={i} href={s.href} target="_blank" rel="noreferrer">{s.label}</Link>
          : <span key={i}>{s.text}</span>,
      )}
    </Typography>
  );
}

export function CommentThread({ thread, highlight = false }: {
  thread: PrCommentThreadPayload;
  /** Scroll into view + briefly ring this thread (notification "flip to" target). */
  highlight?: boolean;
}): JSX.Element {
  const theme = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [highlight]);
  return (
    // Repeating comment card — glassFill (no per-card blur; sits over the
    // already-frosted drawer/diff backdrop) and theme-aware for light + dark.
    <Box ref={ref} sx={{
      ...glassFill(theme, { elevation: 2 }), borderRadius: 2, p: 1.25,
      ...(highlight ? { boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.7)}` } : {}),
      transition: 'box-shadow 400ms ease',
    }}>
      {thread.file && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
          <Typography component="span" sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: 'primary.main' }}>
            {thread.file}
            {thread.line != null ? `:${thread.line}` : ''}
          </Typography>
          {thread.status && (
            <Chip label={thread.status} size="small" sx={{ height: 16, fontSize: 9.5 }} />
          )}
        </Box>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {thread.comments.map((c, i) => (
          <Box key={i}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
              <Typography component="span" sx={{ fontWeight: 700, fontSize: 12 }}>{c.author}</Typography>
              <Typography component="span" sx={{ fontSize: 10, color: 'text.secondary' }}>{formatCommentDate(c.date)}</Typography>
            </Box>
            {renderCommentBody(c.body)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
