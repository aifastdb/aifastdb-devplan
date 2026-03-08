import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';

import { EmbeddedCodeIntelligenceStore } from '../src/code-intelligence';

function fixtureRoot(name = 'native-advanced'): string {
  return path.join(__dirname, 'fixtures', 'code-intelligence', name);
}

function setupFixtureRepo(name = 'native-advanced'): { tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-code-intel-guardrails-'));
  fs.cpSync(fixtureRoot(name), tempRoot, { recursive: true });
  return { tempRoot };
}

describe('Code Intelligence graph query guardrails', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('should expose read-only structured graph query and explicit refactor guardrails', async () => {
    const { tempRoot } = setupFixtureRepo();
    tempDirs.push(tempRoot);
    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const store = new EmbeddedCodeIntelligenceStore('native_validation', basePath);
    await store.rebuildIndex(tempRoot);

    const graphQuery = await store.queryGraph({
      communityId: 'community:src/gamma',
      nodeTypes: ['symbol'],
      limit: 20,
    }, tempRoot);

    expect(graphQuery.nodes.length).toBeGreaterThan(0);
    expect(graphQuery.nodes.every(node => node.type === 'symbol')).toBe(true);
    expect(graphQuery.nodes.some(node => node.id === 'symbol:function:src/gamma/entry.ts:bootstrapGamma')).toBe(true);
    expect(graphQuery.summary).toContain('Read-only graph query');

    const guardrails = store.getRefactorGuardrails();
    expect(guardrails.renameSupportedLanguages).toEqual(['ts', 'js']);
    expect(guardrails.requiresPreviewBeforeApply).toBe(true);
    expect(guardrails.arbitraryCypherAllowed).toBe(false);
    expect(guardrails.arbitraryGraphMutationAllowed).toBe(false);
    expect(guardrails.summary).toContain('read-only graph query');
  });
});
