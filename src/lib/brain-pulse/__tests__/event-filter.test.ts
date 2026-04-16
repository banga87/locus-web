import { describe, expect, it } from 'vitest';
import { filterEvent } from '../event-filter';

const base = {
  id: 'e1', createdAt: new Date(), companyId: 'c', brainId: 'b',
  actorType: 'agent_token' as const, actorId: 'a1', actorName: 'A',
  targetType: null, targetId: null, eventType: 'x', details: {},
};

describe('filterEvent', () => {
  it('passes included categories through', () => {
    expect(filterEvent({ ...base, category: 'document_access' })).not.toBeNull();
    expect(filterEvent({ ...base, category: 'document_mutation' })).not.toBeNull();
    expect(filterEvent({ ...base, category: 'mcp_invocation' })).not.toBeNull();
  });

  it('drops excluded categories', () => {
    expect(filterEvent({ ...base, category: 'authentication' as unknown as 'document_access' })).toBeNull();
    expect(filterEvent({ ...base, category: 'administration' as unknown as 'document_access' })).toBeNull();
    expect(filterEvent({ ...base, category: 'token_usage' as unknown as 'document_access' })).toBeNull();
  });
});
