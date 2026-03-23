import { randomUUID } from 'crypto';

type PutRelationMutation = {
  type: 'PutRelation';
  relation: {
    id: string;
    source: string;
    target: string;
    relation_type: string;
    weight: number;
    bidirectional: boolean;
    metadata: Record<string, unknown>;
    created_at: number;
  };
};

export function buildPutRelationMutation(
  sourceId: string,
  targetId: string,
  relationType: string,
  weight: number,
  metadata: Record<string, unknown> = {},
): PutRelationMutation {
  return {
    type: 'PutRelation',
    relation: {
      // aifastdb 3.9.x expects the full low-level Relation payload here.
      id: randomUUID(),
      source: sourceId,
      target: targetId,
      relation_type: relationType,
      weight,
      bidirectional: false,
      metadata,
      created_at: Date.now(),
    },
  };
}
