import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';

import { EmbeddedCodeIntelligenceStore } from '../src/code-intelligence';

function fixtureRoot(name = 'native-advanced'): string {
  return path.join(__dirname, 'fixtures', 'code-intelligence', name);
}

function setupFixtureRepo(name = 'native-advanced'): { tempRoot: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-code-intel-rename-'));
  fs.cpSync(fixtureRoot(name), tempRoot, { recursive: true });
  return { tempRoot };
}

describe('Code Intelligence renameSymbol', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('should preview and apply a TS rename across definition and import/call sites', async () => {
    const { tempRoot } = setupFixtureRepo();
    tempDirs.push(tempRoot);
    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const store = new EmbeddedCodeIntelligenceStore('native_validation', basePath);
    await store.rebuildIndex(tempRoot);

    const preview = await store.renameSymbol(
      'symbol:function:src/gamma/default-helper.ts:runDefaultGamma',
      'runDefaultGammaRenamed',
      tempRoot,
      false,
    );

    expect(preview.supported).toBe(true);
    expect(preview.applied).toBe(false);
    expect(preview.edits.some(edit =>
      edit.filePath === 'src/gamma/default-helper.ts' && edit.oldText === 'runDefaultGamma'
    )).toBe(true);
    expect(preview.edits.some(edit =>
      edit.filePath === 'src/delta/consumer.ts' && edit.oldText === 'runDefaultGamma'
    )).toBe(true);

    const applied = await store.renameSymbol(
      'symbol:function:src/gamma/default-helper.ts:runDefaultGamma',
      'runDefaultGammaRenamed',
      tempRoot,
      true,
    );

    expect(applied.supported).toBe(true);
    expect(applied.applied).toBe(true);
    expect(fs.readFileSync(path.join(tempRoot, 'src', 'gamma', 'default-helper.ts'), 'utf-8'))
      .toContain('runDefaultGammaRenamed');
    const consumerContent = fs.readFileSync(path.join(tempRoot, 'src', 'delta', 'consumer.ts'), 'utf-8');
    expect(consumerContent).toContain('import runDefaultGammaRenamed from');
    expect(consumerContent).toContain('return runDefaultGammaRenamed();');
    expect(applied.postDetectChanges?.nodeChanges.some(change =>
      change.changeType === 'added'
      && change.after?.id === 'symbol:function:src/gamma/default-helper.ts:runDefaultGammaRenamed'
    )).toBe(true);
    expect(applied.postDetectChanges?.nodeChanges.some(change =>
      change.changeType === 'removed'
      && change.before?.id === 'symbol:function:src/gamma/default-helper.ts:runDefaultGamma'
    )).toBe(true);
  });
});
