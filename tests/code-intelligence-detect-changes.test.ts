import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';

import { EmbeddedCodeIntelligenceStore } from '../src/code-intelligence';

function fixtureRoot(name = 'native-advanced'): string {
  return path.join(__dirname, 'fixtures', 'code-intelligence', name);
}

function setupFixtureRepo(name = 'native-advanced'): { tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-code-intel-detect-'));
  fs.cpSync(fixtureRoot(name), tempRoot, { recursive: true });
  return { tempRoot };
}

describe('Code Intelligence detectChanges', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('should compare current source scan against the persisted baseline', async () => {
    const { tempRoot } = setupFixtureRepo();
    tempDirs.push(tempRoot);
    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const store = new EmbeddedCodeIntelligenceStore('native_validation', basePath);
    await store.rebuildIndex(tempRoot);

    const targetFile = path.join(tempRoot, 'src', 'gamma', 'default-helper.ts');
    fs.appendFileSync(
      targetFile,
      '\nexport function aliasGamma(): string { return runDefaultGamma(); }\n',
      'utf-8',
    );

    const result = await store.detectChanges(tempRoot, 20);

    expect(result.hasBaseline).toBe(true);
    expect(result.baseline).toBe('persisted_index');
    expect(result.sourceFingerprintChanged).toBe(true);
    expect(result.nodeChanges.some(change =>
      change.changeType === 'added'
      && change.after?.id === 'symbol:function:src/gamma/default-helper.ts:aliasGamma'
    )).toBe(true);
    expect(result.edgeChanges.some(change =>
      change.changeType === 'added'
      && change.after?.from === 'symbol:function:src/gamma/default-helper.ts:aliasGamma'
      && change.after?.to === 'symbol:function:src/gamma/default-helper.ts:runDefaultGamma'
      && change.after?.label === 'CALLS'
    )).toBe(true);
    expect(result.summary).toContain('Compared current source scan against persisted index');
  });
});
