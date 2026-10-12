import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Box, ButtonBase, Collapse, IconButton, Tooltip, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import TerminalIcon from '@mui/icons-material/Terminal';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SearchIcon from '@mui/icons-material/Search';
import LanguageIcon from '@mui/icons-material/Language';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ChecklistIcon from '@mui/icons-material/Checklist';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import type { ChatItem } from '@watchtower/shared/chat.js';
import {
  CHAT_MONO,
  CHAT_SERIF,
  diffLines,
  editsOf,
  toolLabel,
  toolSummary,
  type ChatPalette,
} from './chatFormat.js';

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>;

export function UserBubble({ item, p }: { item: Of<'user'>; p: ChatPalette }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Box
        sx={{
          maxWidth: '85%',
          px: 1.75,
          py: 1.1,
          borderRadius: '14px',
          backgroundColor: p.userBubble,
          color: p.text,
          fontSize: 14.5,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {item.text}
      </Box>
    </Box>
  );
}

export function AssistantText({ item, p }: { item: Of<'assistant'>; p: ChatPalette }) {
  if (!item.text && item.streaming) return null;
  return (
    <Box
      sx={{
        color: p.text,
        fontFamily: CHAT_SERIF,
        fontSize: 16,
        lineHeight: 1.65,
        overflowWrap: 'anywhere',
        '& > :first-of-type': { mt: 0 },
        '& > :last-child': { mb: 0 },
        '& p': { my: 1.25 },
        '& h1, & h2, & h3, & h4': { fontFamily: CHAT_SERIF, fontWeight: 600, lineHeight: 1.3, mt: 2.5, mb: 1 },
        '& h1': { fontSize: 22 },
        '& h2': { fontSize: 19 },
        '& h3, & h4': { fontSize: 16.5 },
        '& ul, & ol': { pl: 3, my: 1.25 },
        '& li': { my: 0.5 },
        '& a': { color: p.accent },
        '& blockquote': { borderLeft: `3px solid ${p.border}`, m: 0, pl: 2, color: p.muted },
        '& hr': { border: 0, borderTop: `1px solid ${p.border}`, my: 2.5 },
        '& table': { borderCollapse: 'collapse', fontFamily: 'inherit', fontSize: 14.5, my: 1.5, display: 'block', overflowX: 'auto' },
        '& th, & td': { border: `1px solid ${p.border}`, px: 1.25, py: 0.6, textAlign: 'left' },
        '& :not(pre) > code': {
          fontFamily: CHAT_MONO,
          fontSize: '0.84em',
          backgroundColor: p.codeBg,
          border: `1px solid ${p.border}`,
          borderRadius: '5px',
          px: 0.5,
          py: '1px',
        },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: ({ children }) => <CodeBlock p={p}>{children}</CodeBlock> }}>
        {item.text}
      </ReactMarkdown>
    </Box>
  );
}

function CodeBlock({ children, p }: { children: ReactNode; p: ChatPalette }) {
  const [copied, setCopied] = useState(false);
  // react-markdown hands <pre> a single <code> child; its text is what we copy.
  const code = extractText(children);
  const lang = /language-(\w+)/.exec(classNameOf(children) ?? '')?.[1];
  return (
    <Box sx={{ my: 1.5, borderRadius: '10px', overflow: 'hidden', border: `1px solid ${p.border}`, backgroundColor: p.codeBg }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.5, borderBottom: `1px solid ${p.border}` }}>
        <Typography sx={{ fontFamily: CHAT_MONO, fontSize: 11.5, color: p.muted, flex: 1 }}>{lang ?? 'code'}</Typography>
        <Tooltip title={copied ? 'Copied' : 'Copy'}>
          <IconButton
            size="small"
            aria-label="Copy code"
            onClick={() => {
              void navigator.clipboard?.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            sx={{ color: p.muted, width: 24, height: 24 }}
          >
            {copied ? <CheckIcon sx={{ fontSize: 14 }} /> : <ContentCopyIcon sx={{ fontSize: 14 }} />}
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        component="pre"
        sx={{ m: 0, px: 1.75, py: 1.25, overflowX: 'auto', fontFamily: CHAT_MONO, fontSize: 12.5, lineHeight: 1.55, color: p.text, '& code': { fontFamily: 'inherit' } }}
      >
        {children}
      </Box>
    </Box>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) return extractText((node.props as { children?: ReactNode }).children);
  return '';
}

function classNameOf(node: ReactNode): string | undefined {
  const first = Array.isArray(node) ? node[0] : node;
  return first && typeof first === 'object' && 'props' in first ? (first.props as { className?: string }).className : undefined;
}

/** Thinking: a live "Thinking…" while it streams; a collapsed "Thought process" after, when there is text to show. */
export function ThinkingRow({ item, p }: { item: Of<'thinking'>; p: ChatPalette }) {
  const [open, setOpen] = useState(false);
  if (item.streaming && !item.text) return <Shimmer p={p} label="Thinking…" />;
  if (!item.text) return null;
  return (
    <Box>
      <Disclosure open={open} onToggle={() => setOpen((v) => !v)} p={p}>
        <Typography sx={{ fontSize: 13.5, color: p.muted }}>{item.streaming ? 'Thinking…' : 'Thought process'}</Typography>
      </Disclosure>
      <Collapse in={open}>
        <Box sx={{ ml: 3, mt: 0.75, pl: 1.5, borderLeft: `2px solid ${p.border}`, color: p.muted, fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {item.text}
        </Box>
      </Collapse>
    </Box>
  );
}

const TOOL_ICONS: Record<string, typeof TerminalIcon> = {
  Bash: TerminalIcon,
  Read: DescriptionOutlinedIcon,
  Write: EditOutlinedIcon,
  Edit: EditOutlinedIcon,
  MultiEdit: EditOutlinedIcon,
  NotebookEdit: EditOutlinedIcon,
  Glob: SearchIcon,
  Grep: SearchIcon,
  WebFetch: LanguageIcon,
  WebSearch: LanguageIcon,
  Task: AccountTreeOutlinedIcon,
  Agent: AccountTreeOutlinedIcon,
  TodoWrite: ChecklistIcon,
};

/** A tool call as one quiet row; click to see what went in and what came back. */
export function ToolRow({ item, p }: { item: Of<'tool'>; p: ChatPalette }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[item.name] ?? ExtensionOutlinedIcon;
  const summary = toolSummary(item.name, item.input);
  return (
    <Box>
      <Disclosure open={open} onToggle={() => setOpen((v) => !v)} p={p}>
        <Icon sx={{ fontSize: 15, color: item.status === 'error' ? p.danger : p.muted, flexShrink: 0 }} />
        <Typography sx={{ fontSize: 13.5, color: p.text, fontWeight: 500, flexShrink: 0 }}>{toolLabel(item.name)}</Typography>
        <Typography noWrap sx={{ fontSize: 13, color: p.muted, fontFamily: CHAT_MONO, minWidth: 0 }}>
          {summary}
        </Typography>
        {item.status === 'running' && <Pulse p={p} />}
        {item.status === 'error' && <ErrorOutlineIcon sx={{ fontSize: 15, color: p.danger, flexShrink: 0 }} />}
      </Disclosure>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ ml: 3, mt: 0.75 }}>
          <ToolDetail name={item.name} input={item.input} p={p} />
          {item.result != null && item.result !== '' && (
            <MonoBox p={p} label={item.status === 'error' ? 'Error' : 'Result'} danger={item.status === 'error'}>
              {item.result}
            </MonoBox>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/** What a tool call does, shown the way a person reads it: a command, a diff, a file. */
export function ToolDetail({ name, input, p }: { name: string; input: unknown; p: ChatPalette }) {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const edits = editsOf(name, input);
  if (edits.length) return <DiffView edits={edits} p={p} />;
  if (name === 'Bash' && typeof i.command === 'string') return <MonoBox p={p} label="Command">{`$ ${i.command}`}</MonoBox>;
  if (name === 'Write' && typeof i.content === 'string') return <MonoBox p={p} label="New file">{i.content}</MonoBox>;
  return <MonoBox p={p} label="Input">{JSON.stringify(input, null, 2)}</MonoBox>;
}

function DiffView({ edits, p }: { edits: Array<{ oldText: string; newText: string }>; p: ChatPalette }) {
  return (
    <Box sx={{ mb: 1, borderRadius: '8px', overflow: 'hidden', border: `1px solid ${p.border}`, backgroundColor: p.codeBg }}>
      <Box sx={{ maxHeight: 320, overflow: 'auto', py: 0.75, fontFamily: CHAT_MONO, fontSize: 12, lineHeight: 1.55 }}>
        {edits.map((e, k) => (
          <Box key={k} sx={{ borderTop: k ? `1px dashed ${p.border}` : 'none' }}>
            {diffLines(e.oldText, e.newText).map((l, n) => (
              <Box
                key={n}
                sx={{
                  px: 1.5,
                  whiteSpace: 'pre',
                  color: l.sign === ' ' ? p.muted : p.text,
                  backgroundColor: l.sign === '+' ? p.added : l.sign === '-' ? p.removed : 'transparent',
                }}
              >
                {`${l.sign} ${l.text}`}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function MonoBox({ children, p, label, danger }: { children: string; p: ChatPalette; label: string; danger?: boolean }) {
  return (
    <Box sx={{ mb: 1 }}>
      <Typography sx={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: danger ? p.danger : p.faint, mb: 0.5 }}>{label}</Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          maxHeight: 280,
          overflow: 'auto',
          px: 1.5,
          py: 1,
          borderRadius: '8px',
          border: `1px solid ${p.border}`,
          backgroundColor: p.codeBg,
          color: p.text,
          fontFamily: CHAT_MONO,
          fontSize: 12,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

export function NoticeRow({ item, p }: { item: Of<'notice'>; p: ChatPalette }) {
  if (item.level === 'error') {
    return (
      <Box sx={{ display: 'flex', gap: 1, px: 1.5, py: 1, borderRadius: '10px', border: `1px solid ${p.danger}55`, color: p.danger, fontSize: 13.5, whiteSpace: 'pre-wrap' }}>
        <ErrorOutlineIcon sx={{ fontSize: 17, mt: '1px' }} />
        <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{item.text}</Box>
      </Box>
    );
  }
  return <Typography sx={{ textAlign: 'center', fontSize: 12.5, color: p.faint, whiteSpace: 'pre-wrap' }}>{item.text}</Typography>;
}

/** Only failed turns get a line; a successful turn needs no footer. */
export function ResultRow({ item, p }: { item: Of<'result'>; p: ChatPalette }) {
  if (!item.isError) return null;
  return (
    <NoticeRow
      p={p}
      item={{ kind: 'notice', id: item.id, level: 'error', text: item.errors.length ? item.errors.join('\n') : 'The turn ended with an error.' }}
    />
  );
}

function Disclosure({ open, onToggle, p, children }: { open: boolean; onToggle(): void; p: ChatPalette; children: ReactNode }) {
  return (
    <ButtonBase
      onClick={onToggle}
      aria-expanded={open}
      sx={{ display: 'flex', alignItems: 'center', gap: 1, maxWidth: '100%', borderRadius: '8px', px: 0.75, py: 0.4, ml: -0.75, ':hover': { backgroundColor: p.border } }}
    >
      <ChevronRightIcon sx={{ fontSize: 16, color: p.faint, transition: 'transform 150ms', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0 }} />
      {children}
    </ButtonBase>
  );
}

function Pulse({ p }: { p: ChatPalette }) {
  return (
    <Box
      aria-label="running"
      sx={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        flexShrink: 0,
        backgroundColor: p.accent,
        animation: 'wt-chat-pulse 1.2s ease-in-out infinite',
        '@keyframes wt-chat-pulse': { '50%': { opacity: 0.25 } },
      }}
    />
  );
}

/** Claude's spark with a status line, while a turn runs. */
export function Shimmer({ p, label }: { p: ChatPalette; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: p.accent }}>
      <Box
        component="span"
        aria-hidden
        sx={{ fontSize: 17, lineHeight: 1, animation: 'wt-chat-spin 2.4s linear infinite', '@keyframes wt-chat-spin': { to: { transform: 'rotate(360deg)' } } }}
      >
        ✻
      </Box>
      <Typography sx={{ fontSize: 13.5, color: p.muted }}>{label}</Typography>
    </Box>
  );
}
