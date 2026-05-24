import type { ReactNode } from 'react';
import { Paper, Typography } from '@mui/material';
import { useChartColors } from './chartTheme';

interface Props {
  title: ReactNode;
  rows: { label: ReactNode; value: ReactNode; color?: string }[];
}

export default function ChartTooltip({ title, rows }: Props) {
  const colors = useChartColors();
  return (
    <Paper
      elevation={6}
      sx={{
        p: 1.25,
        minWidth: 140,
        border: `1px solid ${colors.tooltipBorder}`,
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            marginTop: 4,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {r.color && (
              <span
                style={{
                  display: 'inline-block',
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: r.color,
                }}
              />
            )}
            <Typography variant="caption">{r.label}</Typography>
          </span>
          <Typography variant="caption" className="tt-num" sx={{ fontWeight: 600 }}>
            {r.value}
          </Typography>
        </div>
      ))}
    </Paper>
  );
}
