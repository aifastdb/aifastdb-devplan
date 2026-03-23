import { describe, expect, test } from '@jest/globals';

import { buildPutRelationMutation } from '../src/graph-mutation-utils';

describe('buildPutRelationMutation', () => {
  test('builds the full relation payload expected by applyMutations', () => {
    const mutation = buildPutRelationMutation('memory-a', 'memory-b', 'mem:RELATES', 0.75, { sequence: true });

    expect(mutation.type).toBe('PutRelation');
    expect(mutation.relation.source).toBe('memory-a');
    expect(mutation.relation.target).toBe('memory-b');
    expect(mutation.relation.relation_type).toBe('mem:RELATES');
    expect(mutation.relation.weight).toBe(0.75);
    expect(mutation.relation.bidirectional).toBe(false);
    expect(mutation.relation.metadata).toEqual({ sequence: true });
    expect(typeof mutation.relation.id).toBe('string');
    expect(mutation.relation.id.length).toBeGreaterThan(10);
    expect(typeof mutation.relation.created_at).toBe('number');
  });
});
