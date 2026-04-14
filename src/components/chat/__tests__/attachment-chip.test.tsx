// AttachmentChip render states. Verifies the three status modes
// (uploading / extracted / error), the optional remove button, and
// the error tooltip (surfaced via the `title` attribute — non-invasive
// for mobile and screen readers).

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AttachmentChip } from '@/components/chat/attachment-chip';

describe('AttachmentChip', () => {
  it('renders filename and status=extracted by default', () => {
    render(
      <AttachmentChip filename="report.pdf" status="extracted" sizeBytes={2048} />,
    );
    const chip = screen.getByTestId('attachment-chip');
    expect(chip).toBeInTheDocument();
    expect(chip.dataset.status).toBe('extracted');
    expect(chip).toHaveTextContent('report.pdf');
    // 2048 bytes → 2.0 KB
    expect(chip).toHaveTextContent('2.0 KB');
  });

  it('surfaces errorMessage via the title attribute when status=error', () => {
    render(
      <AttachmentChip
        filename="bad.pdf"
        status="error"
        errorMessage="PDF is corrupt"
      />,
    );
    const chip = screen.getByTestId('attachment-chip');
    expect(chip).toHaveAttribute('title', 'PDF is corrupt');
    expect(chip.dataset.status).toBe('error');
  });

  it('renders a remove button only when onRemove is provided', () => {
    const { unmount } = render(
      <AttachmentChip filename="a.md" status="extracted" />,
    );
    expect(screen.queryByLabelText('Remove a.md')).not.toBeInTheDocument();
    unmount();

    const onRemove = vi.fn();
    render(
      <AttachmentChip
        filename="b.md"
        status="extracted"
        onRemove={onRemove}
      />,
    );
    const btn = screen.getByLabelText('Remove b.md');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('formats sizes across byte/KB/MB boundaries', () => {
    const { rerender } = render(
      <AttachmentChip filename="tiny.txt" status="extracted" sizeBytes={200} />,
    );
    expect(screen.getByTestId('attachment-chip')).toHaveTextContent('200 B');

    rerender(
      <AttachmentChip
        filename="small.txt"
        status="extracted"
        sizeBytes={3072}
      />,
    );
    expect(screen.getByTestId('attachment-chip')).toHaveTextContent('3.0 KB');

    rerender(
      <AttachmentChip
        filename="big.pdf"
        status="extracted"
        sizeBytes={5 * 1024 * 1024}
      />,
    );
    expect(screen.getByTestId('attachment-chip')).toHaveTextContent('5.0 MB');
  });
});
