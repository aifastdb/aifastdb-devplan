import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';

import { EmbeddedCodeIntelligenceStore } from '../src/code-intelligence';
import { createDevPlan } from '../src/dev-plan-factory';

function fixtureRoot(name = 'native-advanced'): string {
  return path.join(__dirname, 'fixtures', 'code-intelligence', name);
}

function setupFixtureRepo(name = 'native-advanced'): { tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-code-intel-fusion-'));
  fs.cpSync(fixtureRoot(name), tempRoot, { recursive: true });
  return { tempRoot };
}

describe('Code Intelligence retrieval fusion', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('query should fuse devplan doc retrieval evidence when available', async () => {
    const { tempRoot } = setupFixtureRepo();
    tempDirs.push(tempRoot);
    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const plan = createDevPlan('native_validation', basePath, 'graph');
    plan.saveSection({
      projectName: 'native_validation',
      section: 'technical_notes',
      subSection: 'gamma-helper',
      title: 'GammaDomain helper design',
      content: 'GammaDomain helper GammaDomain.ConcreteRunner.run bootstrapGamma downstream default-helper gamma process',
      version: '1.0.0',
    });

    const store = new EmbeddedCodeIntelligenceStore('native_validation', basePath);
    const result = await store.query('GammaDomain helper', tempRoot, 10);

    expect(result.fusionApplied).toBe(true);
    expect(result.fusionMode).toBe('graph_recall');
    expect(result.retrievalEvidence?.[0]?.sourceKind).toBe('doc');
    expect((result.retrievalEvidence?.[0]?.reasons || []).length).toBeGreaterThan(0);
    expect(result.matchedNodeDetails.some(item => (item.fusionScore || 0) > 0)).toBe(true);
    expect(result.communityDetails.some(item => (item.fusionScore || 0) > 0)).toBe(true);
    expect(result.matchedNodeDetails[0]?.reasons.some(reason => reason.startsWith('recall:'))).toBe(true);
    expect((result.matchedNodeDetails[0]?.finalScore || 0)).toBeGreaterThan(result.matchedNodeDetails[0]?.baselineScore || 0);

    const contextResult = await store.getContext('GammaDomain.ConcreteRunner.run', tempRoot);
    expect(contextResult.fusionApplied).toBe(true);
    expect(contextResult.neighborDetails.some(item => (item.fusionScore || 0) > 0)).toBe(true);
    expect(contextResult.neighborDetails.some(item => item.reasons.some(reason => reason.startsWith('recall:')))).toBe(true);

    const impactResult = await store.getImpact('bootstrapGamma', 'downstream', tempRoot, 20);
    expect(impactResult.fusionApplied).toBe(true);
    expect(impactResult.affectedNodeDetails.some(item => (item.fusionScore || 0) > 0)).toBe(true);
    expect(impactResult.affectedNodeDetails.some(item => item.reasons.some(reason => reason.startsWith('recall:')))).toBe(true);
  });
});
