import { Box, Typography } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import CheckIcon from '@mui/icons-material/Check';
import PushPinIcon from '@mui/icons-material/PushPin';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import dayjs from 'dayjs';
import type { NotePriority, NoteViewPayload } from '@watchtower/shared/ipcContract.js';
import { glassFill, accentWash, accentRing } from '../../theme/glass.js';
import { formatDateShortCz } from '../../util/format.js';

const PRIORITY_COLOR: Record<Exclude<NotePriority, 'none'>, string> = {
  high: 'error.main',
  med: 'warning.main',
  low: 'text.disabled',
};

/** 'over' when the due date is in the past, 'soon' when within 3 days, else null. */
export function dueState(dueDate: string | null): 'over' | 'soon' | null {
  if (!dueDate) return null;
  const today = dayjs().startOf('day');
  const due = dayjs(dueDate).startOf('day');
  if (due.isBefore(today)) return 'over';
  if (due.diff(today, 'day') <= 3) return 'soon';
  return null;
}

export function NoteRow({
  note,
  selected,
  onSelect,
  onToggleDone,
}: {
  note: NoteViewPayload;
  selected: boolean;
  onSelect(): void;
  onToggleDone(): void;
}): JSX.Element {
  const theme = useTheme();
  const rowGlass = glassFill(theme, { elevation: 1 });
  const state = dueState(note.dueDate);
  const done1 = note.done === 1;

  return (
    <Box
      onClick={onSelect}
      sx={{
        display: 'flex',
        gap: 1.125,
        alignItems: 'flex-start',
        px: 1.125,
        py: 1.125,
        mb: 0.5,
        borderRadius: 1.5,
        cursor: 'pointer',
        ...(selected
          ? { backgroundColor: accentWash(theme), boxShadow: accentRing(theme) }
          : { ...rowGlass, ':hover': { backgroundColor: 'action.hover' } }),
      }}
    >
      {/* Checkbox: reserves layout space even when hidden (done === null) so
          titles across rows stay aligned. */}
      <Box
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone();
        }}
        sx={{
          width: 17,
          height: 17,
          mt: '2px',
          flexShrink: 0,
          borderRadius: '5px',
          border: '1.5px solid',
          borderColor: note.done === 1 ? 'success.main' : 'text.disabled',
          backgroundColor: note.done === 1 ? 'success.main' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          visibility: note.done === null ? 'hidden' : 'visible',
          cursor: 'pointer',
        }}
      >
        {note.done === 1 && <CheckIcon sx={{ fontSize: 12, color: '#04220f' }} />}
      </Box>

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {note.priority !== 'none' && (
            <Box
              sx={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                flexShrink: 0,
                backgroundColor: PRIORITY_COLOR[note.priority as Exclude<NotePriority, 'none'>],
              }}
            />
          )}
          <Typography
            noWrap
            sx={{
              fontSize: 13,
              fontWeight: 600,
              color: done1 ? 'text.disabled' : 'text.primary',
              textDecoration: done1 ? 'line-through' : 'none',
              flex: 1,
              minWidth: 0,
            }}
          >
            {note.title || 'Untitled'}
          </Typography>
          {note.pinned && <PushPinIcon sx={{ fontSize: 12, color: 'warning.main', flexShrink: 0 }} />}
        </Box>

        {note.body && (
          <Typography
            noWrap
            sx={{ fontSize: 11.5, color: done1 ? 'text.disabled' : 'text.secondary', mt: 0.25 }}
          >
            {note.body}
          </Typography>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.75, flexWrap: 'wrap' }}>
          {note.projectId != null ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                fontSize: 10,
                fontWeight: 600,
                px: 0.875,
                py: 0.25,
                borderRadius: 999,
                backgroundColor: alpha(note.projectColor ?? theme.palette.primary.main, 0.16),
                color: note.projectColor ?? theme.palette.primary.main,
              }}
            >
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: note.projectColor ?? theme.palette.primary.main,
                }}
              />
              {note.projectName}
            </Box>
          ) : (
            <Box
              sx={{
                fontSize: 10,
                fontWeight: 600,
                px: 0.875,
                py: 0.25,
                borderRadius: 999,
                backgroundColor: 'action.selected',
                color: 'text.secondary',
              }}
            >
              🌐 Global
            </Box>
          )}
          {note.dueDate && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.375,
                fontSize: 10,
                fontWeight: 600,
                px: 0.875,
                py: 0.25,
                borderRadius: 999,
                backgroundColor:
                  state === 'over'
                    ? alpha(theme.palette.error.main, 0.16)
                    : state === 'soon'
                      ? alpha(theme.palette.warning.main, 0.16)
                      : 'action.selected',
                color:
                  state === 'over'
                    ? 'error.main'
                    : state === 'soon'
                      ? 'warning.main'
                      : 'text.secondary',
              }}
            >
              <AccessTimeIcon sx={{ fontSize: 10 }} />
              {formatDateShortCz(note.dueDate)}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
