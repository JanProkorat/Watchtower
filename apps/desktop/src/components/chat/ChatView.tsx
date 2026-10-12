import { useEffect, useLayoutEffect, useRef } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { ChatItem } from '@watchtower/shared/chat.js';
import { useChat } from '../../state/useChat.js';
import { ChatComposer } from './ChatComposer.js';
import { PermissionCard, QuestionCard } from './ChatCards.js';
import { AssistantText, NoticeRow, ResultRow, Shimmer, ThinkingRow, ToolRow, UserBubble } from './ChatMessages.js';
import { chatPalette, shortPath, type ChatPalette } from './chatFormat.js';

interface Props {
  instanceId: string;
  cwd: string;
  onFocus(): void;
}

/** How close to the bottom (px) still counts as "following" the conversation. */
const FOLLOW_SLACK = 80;

/**
 * A chat instance: the conversation drawn the way the Claude desktop app draws
 * it — a centred reading column, user turns as bubbles, Claude's replies as
 * prose, tool calls as quiet expandable rows, permission and question prompts
 * inline — over the Agent SDK session the orchestrator runs.
 */
export function ChatView({ instanceId, cwd, onFocus }: Props) {
  const theme = useTheme();
  const p = chatPalette(theme.palette.mode === 'dark');
  const chat = useChat(instanceId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);

  // Follow new output while the reader is at the bottom; leave them be when
  // they've scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [chat.items, chat.state.busy]);

  // Jump to the end once the history has loaded.
  useEffect(() => {
    if (chat.loaded && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat.loaded]);

  const visible = chat.items.filter(isShown);
  const last = visible[visible.length - 1];
  const showWorking = chat.state.busy && !(last && isActive(last));

  return (
    <Box
      onMouseDown={onFocus}
      sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', backgroundColor: p.bg, borderRadius: '12px', overflow: 'hidden', border: `1px solid ${p.border}` }}
    >
      <Box
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK;
        }}
        sx={{ flex: 1, overflowY: 'auto', px: 3 }}
      >
        <Box sx={{ maxWidth: 740, mx: 'auto', pt: 5, pb: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {!chat.loaded && (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
              <CircularProgress size={22} sx={{ color: p.accent }} />
            </Box>
          )}
          {chat.loaded && visible.length === 0 && <EmptyState p={p} cwd={cwd} />}
          {groupTools(visible).map((group) =>
            group.length > 1 ? (
              // A run of tool calls reads as one compact list.
              <Box key={group[0]!.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {group.map((item) => (
                  <Row key={item.id} item={item} p={p} onRespond={(r) => chat.respond(item.id, r)} />
                ))}
              </Box>
            ) : (
              <Row key={group[0]!.id} item={group[0]!} p={p} onRespond={(r) => chat.respond(group[0]!.id, r)} />
            ),
          )}
          {showWorking && <Shimmer p={p} label="Working…" />}
        </Box>
      </Box>
      <Box sx={{ px: 3, pb: 2.25, pt: 0.5 }}>
        <Box sx={{ maxWidth: 740, mx: 'auto' }}>
          <ChatComposer
            p={p}
            state={chat.state}
            onSend={async (t) => {
              following.current = true;
              return chat.send(t);
            }}
            onStop={chat.interrupt}
            onMode={chat.setPermissionMode}
            onModel={chat.setModel}
          />
        </Box>
      </Box>
    </Box>
  );
}

function Row({ item, p, onRespond }: { item: ChatItem; p: ChatPalette; onRespond: Parameters<typeof PermissionCard>[0]['onRespond'] }) {
  switch (item.kind) {
    case 'user':
      return <UserBubble item={item} p={p} />;
    case 'assistant':
      return <AssistantText item={item} p={p} />;
    case 'thinking':
      return <ThinkingRow item={item} p={p} />;
    case 'tool':
      return <ToolRow item={item} p={p} />;
    case 'permission':
      return <PermissionCard item={item} p={p} onRespond={onRespond} />;
    case 'question':
      return <QuestionCard item={item} p={p} onRespond={onRespond} />;
    case 'result':
      return <ResultRow item={item} p={p} />;
    case 'notice':
      return <NoticeRow item={item} p={p} />;
  }
}

/** Splits the items into runs: consecutive tool calls together, everything else alone. */
export function groupTools(items: ChatItem[]): ChatItem[][] {
  const groups: ChatItem[][] = [];
  for (const item of items) {
    const prev = groups[groups.length - 1];
    if (item.kind === 'tool' && prev && prev[0]!.kind === 'tool') prev.push(item);
    else groups.push([item]);
  }
  return groups;
}

/** Items that draw nothing are left out, so spacing stays even. */
export function isShown(item: ChatItem): boolean {
  if (item.kind === 'thinking') return item.streaming || !!item.text;
  if (item.kind === 'assistant') return !!item.text;
  if (item.kind === 'result') return item.isError;
  // The question card stands for the AskUserQuestion call itself.
  if (item.kind === 'tool') return item.name !== 'AskUserQuestion';
  return true;
}

/** Something on screen already shows that Claude is busy. */
function isActive(item: ChatItem): boolean {
  return (
    (item.kind === 'assistant' && item.streaming) ||
    (item.kind === 'thinking' && item.streaming) ||
    (item.kind === 'tool' && item.status === 'running') ||
    ((item.kind === 'permission' || item.kind === 'question') && item.status === 'pending')
  );
}

function EmptyState({ p, cwd }: { p: ChatPalette; cwd: string }) {
  return (
    <Box sx={{ textAlign: 'center', py: 8 }}>
      <Box component="span" sx={{ fontSize: 34, color: p.accent, lineHeight: 1 }} aria-hidden>
        ✻
      </Box>
      <Typography sx={{ fontFamily: '"Anthropic Serif", "Tiempos Text", Georgia, serif', fontSize: 26, color: p.text, mt: 1.5 }}>
        What can I help with?
      </Typography>
      <Typography sx={{ fontSize: 13, color: p.faint, mt: 1, fontFamily: '"SF Mono", Menlo, monospace' }}>{shortPath(cwd, 3)}</Typography>
    </Box>
  );
}
