import { describe, expect, test } from '@jest/globals';

import { MemoryGatewayAdapter } from '../src/memory-gateway-adapter';
import type { ScoredMemory } from '../src/types';

describe('MemoryGatewayAdapter', () => {
  test('falls back when gateway recallUnified returns a rejected promise', async () => {
    const adapter = new MemoryGatewayAdapter({
      recallUnified: () => Promise.reject(new Error('Memory not enabled. Call enableMemory() first.')),
    });

    const fallbackResults: ScoredMemory[] = [
      {
        id: 'fallback-memory',
        projectName: 'aifastdb-devplan',
        memoryType: 'insight',
        content: 'fallback result',
        tags: [],
        importance: 0.5,
        hitCount: 0,
        lastAccessedAt: null,
        createdAt: 0,
        updatedAt: 0,
        score: 1,
        rawScore: 1,
        sourceKind: 'memory' as const,
      },
    ];

    const results = adapter.recallUnified(
      'gateway recall',
      { limit: 5 },
      () => fallbackResults,
      { projectName: 'aifastdb-devplan' },
    );

    expect(results).toEqual(fallbackResults);

    await new Promise((resolve) => setImmediate(resolve));

    const telemetry = adapter.getTelemetry();
    expect(telemetry.recallUnified.lastRoute).toBe('fallback');
    expect(telemetry.recallUnified.fallbackCalls).toBe(1);
    expect(telemetry.recallUnified.lastError).toContain('Memory not enabled');
  });
});
