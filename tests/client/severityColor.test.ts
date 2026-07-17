import { describe, it, expect } from 'vitest';
import { severityColor } from '../../apps/desktop/src/components/usage/severityColor.js';

describe('severityColor', () => {
  it('prefers ccusage status string', () => {
    expect(severityColor('exceeds', 10)).toBe('error.main');
    expect(severityColor('warning', 10)).toBe('warning.main');
    expect(severityColor('ok', 99)).toBe('success.main');
  });
  it('falls back to 90/75 percent bands', () => {
    expect(severityColor(null, 95)).toBe('error.main');
    expect(severityColor(null, 80)).toBe('warning.main');
    expect(severityColor(null, 50)).toBe('primary.main');
    expect(severityColor(null, null)).toBe('primary.main');
  });
});
