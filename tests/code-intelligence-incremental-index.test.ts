import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';

import { EmbeddedCodeIntelligenceStore } from '../src/code-intelligence';

function fixtureRoot(name = 'native-advanced'): string {
  return path.join(__dirname, 'fixtures', 'code-intelligence', name);
}

function setupFixtureRepo(name = 'native-advanced'): { tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-code-intel-incremental-'));
  fs.cpSync(fixtureRoot(name), tempRoot, { recursive: true });
  return { tempRoot };
}

describe('Code Intelligence incremental index rebuild', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('should reuse unchanged file analyses during rebuild and keep graph correctness', async () => {
    const { tempRoot } = setupFixtureRepo();
    tempDirs.push(tempRoot);
    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const store = new EmbeddedCodeIntelligenceStore('native_validation', basePath);
    const initialStatus = await store.rebuildIndex(tempRoot);
    expect(initialStatus.indexVersion).toBe(3);

    const targetFile = path.join(tempRoot, 'src', 'gamma', 'default-helper.ts');
    fs.appendFileSync(
      targetFile,
      '\nexport function aliasGamma(): string { return runDefaultGamma(); }\n',
      'utf-8',
    );

    const updatedStatus = await store.rebuildIndex(tempRoot);
    expect(updatedStatus.warnings.some(w => w.includes('Incremental rebuild re-analyzed'))).toBe(true);
    expect(updatedStatus.sourceFingerprint?.fileCount).toBe(initialStatus.sourceFingerprint?.fileCount);

    const graph = await store.getGraph(tempRoot);
    expect(graph.nodes.some(node => node.id === 'symbol:function:src/gamma/default-helper.ts:aliasGamma')).toBe(true);
    expect(graph.edges.some(edge =>
      edge.label === 'CALLS'
      && edge.from === 'symbol:function:src/gamma/default-helper.ts:aliasGamma'
      && edge.to === 'symbol:function:src/gamma/default-helper.ts:runDefaultGamma'
    )).toBe(true);

    const stableStatus = await store.rebuildIndex(tempRoot);
    expect(stableStatus.warnings.some(w => w.includes('reused all'))).toBe(true);
  });
});
