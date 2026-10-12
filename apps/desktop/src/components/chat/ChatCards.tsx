import { useState } from 'react';
import { Box, Button, ButtonBase, TextField, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import type { ChatItem, ChatResponse } from '@watchtower/shared/chat.js';
import { ToolDetail } from './ChatMessages.js';
import { permissionVerb, toolLabel, type ChatPalette } from './chatFormat.js';

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>;

const STATUS_TEXT: Record<Of<'permission'>['status'], string> = {
  pending: '',
  allowed: 'Allowed',
  denied: 'Denied',
  cancelled: 'Cancelled',
};

/** "Claude wants to …" with what it would do and the three answers the desktop app gives. */
export function PermissionCard({
  item,
  p,
  onRespond,
}: {
  item: Of<'permission'>;
  p: ChatPalette;
  onRespond(response: ChatResponse): void;
}) {
  const pending = item.status === 'pending';
  const title = item.title || `Claude wants to ${permissionVerb(item.toolName, item.input)}`;
  if (!pending) {
    return (
      <Typography sx={{ fontSize: 12.5, color: p.faint }}>
        {`${title} — ${STATUS_TEXT[item.status].toLowerCase()}`}
      </Typography>
    );
  }
  return (
    <Box sx={{ borderRadius: '14px', border: `1px solid ${p.accent}66`, backgroundColor: p.surface, p: 2, boxShadow: `0 0 0 3px ${p.accent}14` }}>
      <Typography sx={{ fontSize: 14.5, fontWeight: 600, color: p.text, mb: 0.25 }}>{title}</Typography>
      <Typography sx={{ fontSize: 12.5, color: p.muted, mb: 1.25 }}>{item.description || toolLabel(item.toolName)}</Typography>
      <ToolDetail name={item.toolName} input={item.input} p={p} />
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap', mt: 1.5 }}>
        <Button
          size="small"
          variant="text"
          onClick={() => onRespond({ kind: 'permission', decision: 'deny' })}
          sx={{ color: p.muted, borderRadius: '9px' }}
        >
          Deny
        </Button>
        {item.canAlwaysAllow && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => onRespond({ kind: 'permission', decision: 'allowAlways' })}
            sx={{ color: p.text, borderColor: p.border, borderRadius: '9px' }}
          >
            Always allow
          </Button>
        )}
        <Button
          size="small"
          variant="contained"
          onClick={() => onRespond({ kind: 'permission', decision: 'allow' })}
          sx={{ backgroundColor: p.accent, color: p.accentText, borderRadius: '9px', ':hover': { backgroundColor: p.accent, filter: 'brightness(1.08)' } }}
        >
          Allow
        </Button>
      </Box>
    </Box>
  );
}

/** Claude's multiple-choice questions: pick per question (or type your own), then send. */
export function QuestionCard({
  item,
  p,
  onRespond,
}: {
  item: Of<'question'>;
  p: ChatPalette;
  onRespond(response: ChatResponse): void;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});

  if (item.status !== 'pending') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {item.questions.map((q) => (
          <Typography key={q.question} sx={{ fontSize: 13, color: p.muted }}>
            {q.question}{' '}
            <Box component="span" sx={{ color: p.text, fontWeight: 600 }}>
              {item.status === 'answered' ? item.answers?.[q.question] ?? '—' : 'skipped'}
            </Box>
          </Typography>
        ))}
      </Box>
    );
  }

  const answerOf = (question: string): string => {
    const typed = other[question]?.trim();
    return typed || (picked[question] ?? []).join(', ');
  };
  const complete = item.questions.every((q) => answerOf(q.question));

  const toggle = (question: string, label: string, multi: boolean) => {
    setOther((o) => ({ ...o, [question]: '' }));
    setPicked((prev) => {
      const cur = prev[question] ?? [];
      if (!multi) return { ...prev, [question]: [label] };
      return { ...prev, [question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
    });
  };

  return (
    <Box sx={{ borderRadius: '14px', border: `1px solid ${p.border}`, backgroundColor: p.surface, p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {item.questions.map((q) => (
        <Box key={q.question}>
          {q.header && (
            <Typography sx={{ display: 'inline-block', fontSize: 11, fontWeight: 600, letterSpacing: 0.3, color: p.accent, mb: 0.5 }}>
              {q.header.toUpperCase()}
            </Typography>
          )}
          <Typography sx={{ fontSize: 14.5, fontWeight: 600, color: p.text, mb: 1 }}>{q.question}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {q.options.map((o) => {
              const on = (picked[q.question] ?? []).includes(o.label) && !other[q.question]?.trim();
              return (
                <ButtonBase
                  key={o.label}
                  onClick={() => toggle(q.question, o.label, q.multiSelect)}
                  aria-pressed={on}
                  sx={{
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    gap: 1.25,
                    px: 1.5,
                    py: 1,
                    borderRadius: '10px',
                    border: `1px solid ${on ? p.accent : p.border}`,
                    backgroundColor: on ? `${p.accent}14` : 'transparent',
                    ':hover': { borderColor: p.accent },
                  }}
                >
                  <Box
                    sx={{
                      width: 18,
                      height: 18,
                      flexShrink: 0,
                      borderRadius: q.multiSelect ? '5px' : '50%',
                      border: `1.5px solid ${on ? p.accent : p.faint}`,
                      backgroundColor: on ? p.accent : 'transparent',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    {on && <CheckIcon sx={{ fontSize: 13, color: p.accentText }} />}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13.5, color: p.text, fontWeight: 500 }}>{o.label}</Typography>
                    {o.description && <Typography sx={{ fontSize: 12.5, color: p.muted }}>{o.description}</Typography>}
                  </Box>
                </ButtonBase>
              );
            })}
            <TextField
              size="small"
              placeholder="Or type your own answer"
              value={other[q.question] ?? ''}
              onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px', fontSize: 13.5, color: p.text }, '& fieldset': { borderColor: p.border } }}
            />
          </Box>
        </Box>
      ))}
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button size="small" onClick={() => onRespond({ kind: 'question', cancel: true })} sx={{ color: p.muted, borderRadius: '9px' }}>
          Skip
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!complete}
          onClick={() =>
            onRespond({ kind: 'question', answers: Object.fromEntries(item.questions.map((q) => [q.question, answerOf(q.question)])) })
          }
          sx={{ backgroundColor: p.accent, color: p.accentText, borderRadius: '9px', ':hover': { backgroundColor: p.accent, filter: 'brightness(1.08)' } }}
        >
          Send answer
        </Button>
      </Box>
    </Box>
  );
}
