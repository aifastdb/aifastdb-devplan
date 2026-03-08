import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';

import { createDevPlan } from '../src/dev-plan-factory';

function createGraphStore(projectName: string, tempRoot: string) {
  const basePath = path.join(tempRoot, '.devplan');
  fs.mkdirSync(basePath, { recursive: true });
  return createDevPlan(projectName, basePath, 'graph');
}

describe('DevPlanGraphStore document hierarchy guardrails', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('saveSection should reject self parentDoc assignment', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-graph-doc-cycle-'));
    tempDirs.push(tempRoot);
    const store = createGraphStore('graph_cycle_self', tempRoot);

    store.saveSection({
      projectName: 'graph_cycle_self',
      section: 'api_design',
      title: 'API Root',
      content: 'root-content',
    });

    expect(() => store.saveSection({
      projectName: 'graph_cycle_self',
      section: 'api_design',
      title: 'API Root',
      content: 'root-content',
      parentDoc: 'api_design',
    })).toThrow('cannot be its own parent');

    const root = store.getSection('api_design');
    expect(root?.parentDoc).toBeUndefined();
    expect(root?.childDocs).toBeUndefined();
  });

  test('addSection should reject self parentDoc assignment for new documents', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-graph-doc-cycle-'));
    tempDirs.push(tempRoot);
    const store = createGraphStore('graph_cycle_add', tempRoot);

    expect(() => store.addSection({
      projectName: 'graph_cycle_add',
      section: 'technical_notes',
      subSection: 'self-ref',
      title: 'Self Ref',
      content: 'self-ref-content',
      parentDoc: 'technical_notes|self-ref',
    })).toThrow('cannot be its own parent');

    expect(store.getSection('technical_notes', 'self-ref')).toBeNull();
  });

  test('saveSection should reject assigning a descendant as parent', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-graph-doc-cycle-'));
    tempDirs.push(tempRoot);
    const store = createGraphStore('graph_cycle_descendant', tempRoot);

    store.saveSection({
      projectName: 'graph_cycle_descendant',
      section: 'technical_notes',
      subSection: 'root',
      title: 'Root',
      content: 'root-content',
    });
    store.saveSection({
      projectName: 'graph_cycle_descendant',
      section: 'technical_notes',
      subSection: 'child',
      title: 'Child',
      content: 'child-content',
      parentDoc: 'technical_notes|root',
    });

    expect(() => store.saveSection({
      projectName: 'graph_cycle_descendant',
      section: 'technical_notes',
      subSection: 'root',
      title: 'Root',
      content: 'root-content',
      parentDoc: 'technical_notes|child',
    })).toThrow('would create a document hierarchy cycle');

    const root = store.getSection('technical_notes', 'root');
    const child = store.getSection('technical_notes', 'child');
    expect(root?.parentDoc).toBeUndefined();
    expect(root?.childDocs).toEqual(['technical_notes|child']);
    expect(child?.parentDoc).toBe('technical_notes|root');
  });
});
