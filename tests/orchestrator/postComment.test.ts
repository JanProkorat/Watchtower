import { describe, it, expect } from 'vitest';
import { formatFindingBody } from '../../orchestrator/services/prProviders/postComment.js';
import type { PrFindingPayload } from '@watchtower/shared/ipcContract.js';

const BASE: PrFindingPayload = {
  file: 'src/foo.ts',
  line: 42,
  severity: 'error',
  category: 'correctness',
  summary: 'off-by-one in loop bound',
};

describe('formatFindingBody', () => {
  it('renders the head line with severity/category/summary', () => {
    const body = formatFindingBody(BASE);
    expect(body).toContain('**[error] correctness** off-by-one in loop bound');
  });

  it('appends the detail paragraph when present', () => {
    const body = formatFindingBody({ ...BASE, detail: 'Loop iterates one past the array end.' });
    expect(body).toBe(
      '**[error] correctness** off-by-one in loop bound\n\nLoop iterates one past the array end.',
    );
  });

  it('omits any detail paragraph when absent', () => {
    const body = formatFindingBody(BASE);
    expect(body).toBe('**[error] correctness** off-by-one in loop bound');
    expect(body).not.toContain('\n\n');
  });
});
