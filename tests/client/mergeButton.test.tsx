// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MergeButton } from '../../apps/desktop/src/components/reviews/MergeButton.js';

describe('MergeButton', () => {
  it('is disabled with a reason when not mergeable', () => {
    render(<MergeButton approved mergeable={false} mergeBlockedReason="Merge conflicts" onMerge={vi.fn()} />);
    expect(screen.getByRole('button', { name: /merge/i })).toBeDisabled();
  });

  it('opens confirm and calls onMerge with deleteBranch', async () => {
    const onMerge = vi.fn(async () => {});
    render(<MergeButton approved mergeable mergeBlockedReason={null} onMerge={onMerge} />);
    fireEvent.click(screen.getByRole('button', { name: /merge/i }));
    fireEvent.click(await screen.findByRole('button', { name: /squash & merge/i }));
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith(true));
  });
});
