import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';

import { rebuildProjectFromWal } from '../src/dev-plan-import';
import { createDevPlan } from '../src/dev-plan-factory';

describe('dev-plan import', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('rebuilds a fresh project from WAL through high-level APIs', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-import-'));
    tempDirs.push(tempRoot);

    const basePath = path.join(tempRoot, '.devplan');
    fs.mkdirSync(basePath, { recursive: true });

    const source = createDevPlan('source_archive', basePath, 'graph');
    source.createModule({
      projectName: 'source_archive',
      moduleId: 'voice-input',
      name: 'Voice Input',
      status: 'active',
    });
    source.saveSection({
      projectName: 'source_archive',
      section: 'overview',
      title: 'Source Overview',
      content: '# Source Overview\n\nOriginal content.',
      version: '1.0.0',
      moduleId: 'voice-input',
    });
    source.upsertMainTask(
      {
        projectName: 'source_archive',
        taskId: 'phase-1',
        title: 'Phase-1: Import smoke test',
        priority: 'P1',
        moduleId: 'voice-input',
      },
      { preserveStatus: false, status: 'completed' }
    );
    source.upsertSubTask(
      {
        projectName: 'source_archive',
        parentTaskId: 'phase-1',
        taskId: 'T1.1',
        title: 'Sub task from WAL',
      },
      { preserveStatus: false, status: 'completed' }
    );
    source.savePrompt({
      projectName: 'source_archive',
      content: 'Rebuild this project from WAL',
      summary: 'import smoke',
      relatedTaskId: 'phase-1',
      tags: ['import'],
    });
    source.sync();

    const overviewPath = path.join(tempRoot, 'target-overview.md');
    fs.writeFileSync(
      overviewPath,
      '# Imported Overview\n\nThis overview should override the archived one.\n',
      'utf-8'
    );

    const result = rebuildProjectFromWal({
      archiveWalPath: path.join(basePath, 'source_archive', 'graph-data', 'wal'),
      targetProjectName: 'restored_project',
      targetBasePath: basePath,
      overviewFilePath: overviewPath,
    });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.stats).toMatchObject({
      modules: 1,
      mainTasks: 1,
      subTasks: 1,
      docs: 1,
      prompts: 1,
      overviewSynced: true,
    });

    const restored = createDevPlan('restored_project', basePath, 'graph');
    expect(restored.listModules()).toHaveLength(1);
    expect(restored.listMainTasks()).toHaveLength(1);
    expect(restored.listSubTasks('phase-1')).toHaveLength(1);
    expect(restored.listPrompts()).toHaveLength(1);
    expect(restored.getSection('overview')?.title).toBe('Imported Overview');
    expect(restored.getSection('overview')?.content).toContain('override the archived one');
  });
});
