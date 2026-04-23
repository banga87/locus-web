import { describe, it, expect, vi } from 'vitest';

// Real SDK exports `start`, not `trigger`. Mock it accordingly.
const startMock = vi.fn();
vi.mock('workflow', () => ({
  start: (fn: unknown, args: unknown) => startMock(fn, args),
}));
vi.mock('../workflow', () => ({
  embedDocumentWorkflow: 'fake-workflow-fn',
}));

import { triggerEmbeddingFor } from '../trigger';

describe('triggerEmbeddingFor', () => {
  it('invokes the workflow with the EmbedJobArgs payload', async () => {
    startMock.mockResolvedValueOnce(undefined);

    await triggerEmbeddingFor({
      documentId: 'doc-1',
      companyId: 'co-1',
      brainId: 'br-1',
    });

    expect(startMock).toHaveBeenCalledOnce();
    expect(startMock).toHaveBeenCalledWith('fake-workflow-fn', expect.anything());
    const callArgs = startMock.mock.calls[0][1];
    const flat = JSON.stringify(callArgs);
    expect(flat).toContain('doc-1');
    expect(flat).toContain('co-1');
    expect(flat).toContain('br-1');
  });
});
