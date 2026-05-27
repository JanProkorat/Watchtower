import { Box, Button, Popover, Stack, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import AddIcon from '@mui/icons-material/Add';
import { formatWeekdayDateLongCz } from '../../util/format.js';
import { isLocked, useWorklogLock } from '../../util/lockSetting.js';
import type { WorklogViewPayload } from '../../../../shared/ipcContract.js';

function fmtHoursTrim(minutes: number): string {
  if (minutes <= 0) return '0';
  const h = minutes / 60;
  if (Number.isInteger(h)) return String(h);
  return h.toFixed(2).replace(/\.?0+$/, '');
}

interface Props {
  anchor: HTMLElement | null;
  /** ISO yyyy-mm-dd of the cell — drives the header. */
  ymd: string;
  worklogs: WorklogViewPayload[];
  onClose(): void;
  onEdit(worklog: WorklogViewPayload): void;
  onAdd(): void;
}

/**
 * Click-on-cell disambiguation. Opens for every cell (0 / 1 / N worklogs) so
 * the UX stays consistent — the user always sees what's there before being
 * routed to the drawer. Clicking a row opens the drawer in edit mode for
 * that specific worklog; the "Add worklog" footer always opens it in create
 * mode for the same task + date.
 */
export function WorklogCellPopover({ anchor, ymd, worklogs, onClose, onEdit, onAdd }: Props) {
  const open = anchor != null;
  const lockedThrough = useWorklogLock();
  const locked = isLocked(ymd, lockedThrough);
  return (
    <Popover
      open={open}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      slotProps={{ paper: { sx: { minWidth: 280, maxWidth: 380 } } }}
    >
      <Box sx={{ p: 1 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            color: 'text.secondary',
            px: 1,
            pb: 0.5,
            textTransform: 'capitalize',
          }}
        >
          {formatWeekdayDateLongCz(ymd)}
        </Typography>

        {worklogs.length === 0 ? (
          <Typography
            variant="body2"
            sx={{ color: 'text.disabled', px: 1, py: 1, fontStyle: 'italic' }}
          >
            No worklogs on this day yet.
          </Typography>
        ) : (
          <Stack sx={{ mt: 0.25 }}>
            {worklogs.map((w) => (
              <Box
                key={w.id}
                role="button"
                tabIndex={0}
                onClick={() => onEdit(w)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onEdit(w);
                  }
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.25,
                  px: 1,
                  py: 0.75,
                  borderRadius: 1,
                  cursor: 'pointer',
                  '&:hover, &:focus-visible': { background: 'action.hover', outline: 'none' },
                }}
              >
                <Box
                  sx={{
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 44,
                    fontSize: 13,
                  }}
                >
                  {fmtHoursTrim(w.minutes)} h
                </Box>
                <Box
                  sx={{
                    flex: 1,
                    color: w.description ? 'text.primary' : 'text.disabled',
                    fontSize: 13,
                    lineHeight: 1.35,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    fontStyle: w.description ? 'normal' : 'italic',
                  }}
                >
                  {w.description || 'no description'}
                </Box>
              </Box>
            ))}
          </Stack>
        )}

        {locked && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              px: 1,
              pt: 0.75,
              color: 'warning.main',
              fontSize: 11,
            }}
          >
            <LockOutlinedIcon sx={{ fontSize: 14 }} />
            <span>Locked through {lockedThrough}</span>
          </Box>
        )}
        <Button
          startIcon={<AddIcon fontSize="small" />}
          onClick={onAdd}
          size="small"
          fullWidth
          disabled={locked}
          sx={{ mt: 0.5, justifyContent: 'flex-start', textTransform: 'none', px: 1 }}
        >
          Add worklog
        </Button>
      </Box>
    </Popover>
  );
}
