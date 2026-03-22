import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';

import { DevPlanGraphStore } from '../src/dev-plan-graph-store';

function createGraphStore(projectName: string, tempRoot: string) {
  const graphPath = path.join(tempRoot, '.devplan', projectName, 'graph-data');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  return new DevPlanGraphStore(projectName, {
    graphPath,
    enableTextSearch: true,
    recallSearchTuning: {
      tagBoostFactor: 0.15,
      queryCoverageBoost: 0.35,
      relatedTaskBoost: 0.12,
      testMemoryPenalty: 0.3,
    },
  });
}

describe('DevPlan memory recall ranking', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('technical keyword queries should rank high-value backfill memory ahead of probe memory', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-recall-ranking-'));
    tempDirs.push(tempRoot);
    const projectName = 'ranking_probe_penalty';
    const store = createGraphStore(projectName, tempRoot);

    store.saveMemory({
      projectName,
      memoryType: 'insight',
      content: 'Second write for merge validation using explicit merge mode.',
      tags: ['anchor-mode', 'merge-validation'],
      importance: 0.31,
      recallProfile: 'test_probe',
      sourceRef: { sourceId: 'anchor-merge-test', variant: 'merge-b' },
    });
    store.saveMemory({
      projectName,
      memoryType: 'insight',
      content: 'MemoryAnchor now supports soft_merge and create_distinct for realistic backfill so semantically different conclusions do not get folded together.',
      tags: ['anchorMergeMode', 'soft_merge', 'create_distinct', 'backfill'],
      relatedTaskId: 'phase-104C',
      importance: 0.89,
      sourceRef: { sourceId: 'backfill-real-memory', variant: 'final' },
    });

    const results = store.recallUnified('anchorMergeMode soft_merge create_distinct backfill', {
      memoryType: 'insight',
      docStrategy: 'none',
      limit: 5,
      deterministicFirst: true,
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.sourceRef?.sourceId).toBe('backfill-real-memory');
    expect(results[1]?.sourceRef?.sourceId).toBe('anchor-merge-test');
  });

  test('test-intent queries should still allow probe memories to rank first', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-recall-ranking-'));
    tempDirs.push(tempRoot);
    const projectName = 'ranking_probe_intent';
    const store = createGraphStore(projectName, tempRoot);

    store.saveMemory({
      projectName,
      memoryType: 'insight',
      content: 'Explicit merge validation scenario for anchor behavior.',
      tags: ['merge-validation', 'anchor-mode'],
      importance: 0.31,
      recallProfile: 'test_probe',
      sourceRef: { sourceId: 'merge-probe-memory', variant: 'probe' },
    });
    store.saveMemory({
      projectName,
      memoryType: 'insight',
      content: 'Production memory describing create_distinct backfill behavior.',
      tags: ['anchorMergeMode', 'create_distinct', 'backfill'],
      relatedTaskId: 'phase-104C',
      importance: 0.89,
      sourceRef: { sourceId: 'real-memory', variant: 'prod' },
    });

    const results = store.recallUnified('merge probe validation', {
      memoryType: 'insight',
      docStrategy: 'none',
      limit: 5,
      deterministicFirst: true,
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.sourceRef?.sourceId).toBe('merge-probe-memory');
  });
});
