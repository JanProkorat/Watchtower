import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

/**
 * One labelled row in the Settings → General panel: title, optional caption,
 * then the control(s). Shared by SettingsPanel and the setting sections
 * extracted out of it so both render identically.
 */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="subtitle2">{label}</Typography>
      {description && (
        <Typography variant="caption" color="text.secondary">
          {description}
        </Typography>
      )}
      <Box sx={{ mt: 1 }}>{children}</Box>
    </Stack>
  );
}
