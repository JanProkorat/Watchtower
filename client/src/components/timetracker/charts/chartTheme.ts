import { alpha, useTheme } from '@mui/material/styles';

export interface ChartColors {
  axis: string;
  grid: string;
  text: string;
  textMuted: string;
  primary: string;
  primarySoft: string;
  accent: string;
  positive: string;
  warning: string;
  tooltipBg: string;
  tooltipBorder: string;
  sequential: string[];
}

export function useChartColors(): ChartColors {
  const theme = useTheme();
  return {
    axis: theme.palette.divider,
    grid: alpha(theme.palette.divider, 0.6),
    text: theme.palette.text.primary,
    textMuted: theme.palette.text.secondary,
    primary: theme.palette.primary.main,
    primarySoft: alpha(theme.palette.primary.main, 0.35),
    accent: theme.palette.secondary.main,
    positive: theme.palette.success.main,
    warning: theme.palette.warning.main,
    tooltipBg: theme.palette.background.paper,
    tooltipBorder: theme.palette.divider,
    sequential: [
      theme.palette.primary.main,
      theme.palette.secondary.main,
      theme.palette.success.main,
      theme.palette.warning.main,
      theme.palette.error.main,
      theme.palette.info.main,
    ],
  };
}
