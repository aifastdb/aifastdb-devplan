import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test, jest } from '@jest/globals';

import { handleInitToolCall } from '../src/mcp-server/handlers/init-tools';

describe('handleInitToolCall devplan_init cursor rule refresh', () => {
  const tempDirs: string[] = [];
  const originalCwd = process.cwd();
  const originalBasePath = process.env.AIFASTDB_DEVPLAN_PATH;

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalBasePath === undefined) {
      delete process.env.AIFASTDB_DEVPLAN_PATH;
    } else {
      process.env.AIFASTDB_DEVPLAN_PATH = originalBasePath;
    }

    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not overwrite an existing cursor rule unless refreshCursorRule is true', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-init-'));
    tempDirs.push(projectRoot);
    const basePath = path.join(projectRoot, '.devplan');
    const cursorRuleDir = path.join(projectRoot, '.cursor', 'rules');
    const cursorRuleFile = path.join(cursorRuleDir, 'dev-plan-management.mdc');

    fs.mkdirSync(cursorRuleDir, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'demo-project' }), 'utf-8');
    fs.writeFileSync(cursorRuleFile, 'legacy rule content', 'utf-8');

    process.chdir(projectRoot);
    process.env.AIFASTDB_DEVPLAN_PATH = basePath;

    const getDevPlan = jest.fn(() => ({} as any));
    const clearDevPlanCache = jest.fn();

    const initial = JSON.parse(await handleInitToolCall(
      'devplan_init',
      { projectName: 'demo-project' },
      { getDevPlan, clearDevPlanCache }
    ) as string);

    expect(initial.cursorRuleGenerated).toBe(false);
    expect(initial.cursorRuleRefreshed).toBe(false);
    expect(fs.readFileSync(cursorRuleFile, 'utf-8')).toBe('legacy rule content');

    const refreshed = JSON.parse(await handleInitToolCall(
      'devplan_init',
      { projectName: 'demo-project', refreshCursorRule: true },
      { getDevPlan, clearDevPlanCache }
    ) as string);

    expect(refreshed.cursorRuleGenerated).toBe(false);
    expect(refreshed.cursorRuleRefreshed).toBe(true);
    const nextContent = fs.readFileSync(cursorRuleFile, 'utf-8');
    expect(nextContent).not.toBe('legacy rule content');
    expect(nextContent).toContain('## 文档搜索约定');
    expect(nextContent).toContain('searchBy: "id"');
  });
});
