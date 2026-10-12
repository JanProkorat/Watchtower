import { useState } from 'react';
import { Box, IconButton, InputBase, MenuItem, Select, Tooltip } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import StopIcon from '@mui/icons-material/Stop';
import { CHAT_PERMISSION_MODES, type ChatPermissionMode, type ChatState } from '@watchtower/shared/chat.js';
import type { ChatPalette } from './chatFormat.js';

interface Props {
  p: ChatPalette;
  state: ChatState;
  onSend(text: string): Promise<boolean>;
  onStop(): void;
  onMode(mode: ChatPermissionMode): void;
  onModel(model: string | null): void;
}

const DEFAULT_MODEL = '__default__';

/** The rounded message box: Enter sends, Shift+Enter breaks the line; mode and model below. */
export function ChatComposer({ p, state, onSend, onStop, onMode, onModel }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setText('');
    const ok = await onSend(t).catch(() => false);
    // Keep what was typed when the send failed (the failure already toasted).
    if (!ok) setText(t);
    setSending(false);
  };

  const models = state.models.length
    ? state.models
    : [{ value: 'default', label: 'Default' }, { value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet' }, { value: 'haiku', label: 'Haiku' }];

  const selectSx = {
    fontSize: 12.5,
    color: p.muted,
    borderRadius: '8px',
    '& .MuiSelect-select': { py: 0.4, pl: 1, pr: '26px !important' },
    '& fieldset': { border: 'none' },
    '& .MuiSvgIcon-root': { color: p.faint, fontSize: 18 },
    ':hover': { backgroundColor: p.border },
  };

  return (
    <Box
      sx={{
        borderRadius: '18px',
        border: `1px solid ${p.border}`,
        backgroundColor: p.surface,
        boxShadow: '0 4px 18px rgba(0,0,0,0.12)',
        px: 1.75,
        pt: 1.25,
        pb: 0.75,
        ':focus-within': { borderColor: `${p.accent}88` },
      }}
    >
      <InputBase
        multiline
        fullWidth
        maxRows={10}
        autoFocus
        placeholder={state.busy ? 'Queue a message for Claude…' : 'Reply to Claude…'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          } else if (e.key === 'Escape' && state.busy) {
            onStop();
          }
        }}
        inputProps={{ 'aria-label': 'Message Claude' }}
        sx={{ color: p.text, fontSize: 15, lineHeight: 1.5, '& textarea::placeholder': { color: p.faint, opacity: 1 } }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75 }}>
        <Select
          size="small"
          value={state.permissionMode}
          onChange={(e) => onMode(e.target.value as ChatPermissionMode)}
          sx={selectSx}
          inputProps={{ 'aria-label': 'Permission mode' }}
        >
          {CHAT_PERMISSION_MODES.map((m) => (
            <MenuItem key={m.value} value={m.value} title={m.hint} sx={{ fontSize: 13 }}>
              {m.label}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={state.model ?? DEFAULT_MODEL}
          onChange={(e) => onModel(e.target.value === DEFAULT_MODEL || e.target.value === 'default' ? null : e.target.value)}
          sx={selectSx}
          inputProps={{ 'aria-label': 'Model' }}
          renderValue={(v) => (v === DEFAULT_MODEL ? 'Default model' : models.find((m) => m.value === v)?.label ?? v)}
        >
          <MenuItem value={DEFAULT_MODEL} sx={{ fontSize: 13 }}>
            Default model
          </MenuItem>
          {models
            .filter((m) => m.value !== 'default')
            .map((m) => (
              <MenuItem key={m.value} value={m.value} title={m.description} sx={{ fontSize: 13 }}>
                {m.label}
              </MenuItem>
            ))}
        </Select>
        <Box sx={{ flex: 1 }} />
        {state.busy && (
          <Tooltip title="Stop (Esc)">
            <IconButton aria-label="Stop" onClick={onStop} sx={{ width: 32, height: 32, color: p.text, border: `1px solid ${p.border}` }}>
              <StopIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Send (Enter)">
          <span>
            <IconButton
              aria-label="Send"
              disabled={!text.trim() || sending}
              onClick={() => void send()}
              sx={{
                width: 32,
                height: 32,
                backgroundColor: p.accent,
                color: p.accentText,
                ':hover': { backgroundColor: p.accent, filter: 'brightness(1.08)' },
                '&.Mui-disabled': { backgroundColor: `${p.accent}55`, color: p.accentText },
              }}
            >
              <ArrowUpwardIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
