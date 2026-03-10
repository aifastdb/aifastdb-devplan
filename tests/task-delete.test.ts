import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';

import { DevPlanDocumentStore } from '../src/dev-plan-document-store';
import { createDevPlan } from '../src/dev-plan-factory';

function createDocumentStore(projectName: string, tempRoot: string): DevPlanDocumentStore {
  return new DevPlanDocumentStore(projectName, {
    documentPath: path.join(tempRoot, 'documents.jsonl'),
    taskPath: path.join(tempRoot, 'tasks.jsonl'),
    modulePath: path.join(tempRoot, 'modules.jsonl'),
    promptPath: path.join(tempRoot, 'prompts.jsonl'),
  });
}

function createGraphStore(projectName: string, tempRoot: string) {
  const basePath = path.join(tempRoot, '.devplan');
  fs.mkdirSync(basePath, { recursive: true });
  return createDevPlan(projectName, basePath, 'graph');
}

describe('task deletion', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('document store deletes a main task and all historical sub-task versions', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-task-delete-doc-'));
    tempDirs.push(tempRoot);
    const store = createDocumentStore('doc_delete', tempRoot);

    store.createMainTask({
      projectName: 'doc_delete',
      taskId: 'phase-9',
      title: 'Phase 9',
      priority: 'P1',
    });
    store.addSubTask({
      projectName: 'doc_delete',
      parentTaskId: 'phase-9',
      taskId: 'T9.1',
      title: 'First sub task',
    });
    store.updateSubTaskStatus('T9.1', 'in_progress');
    store.addSubTask({
      projectName: 'doc_delete',
      parentTaskId: 'phase-9',
      taskId: 'T9.2',
      title: 'Second sub task',
    });

    const result = store.deleteTask('phase-9', 'main');

    expect(result.deleted).toBe(true);
    expect(result.taskType).toBe('main');
    expect(result.deletedMainTaskId).toBe('phase-9');
    expect([...result.deletedSubTaskIds].sort()).toEqual(['T9.1', 'T9.2']);
    expect([...result.deletedTaskIds].sort()).toEqual(['T9.1', 'T9.2', 'phase-9']);
    expect(result.parentTaskId).toBeNull();
    expect(store.getMainTask('phase-9')).toBeNull();
    expect(store.getSubTask('T9.1')).toBeNull();
    expect(store.getSubTask('T9.2')).toBeNull();
  });

  test('graph store deletes a sub task and refreshes parent counts', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-task-delete-graph-'));
    tempDirs.push(tempRoot);
    const store = createGraphStore('graph_delete', tempRoot);

    store.createMainTask({
      projectName: 'graph_delete',
      taskId: 'phase-8',
      title: 'Phase 8',
      priority: 'P1',
    });
    store.addSubTask({
      projectName: 'graph_delete',
      parentTaskId: 'phase-8',
      taskId: 'T8.1',
      title: 'First sub task',
    });
    store.addSubTask({
      projectName: 'graph_delete',
      parentTaskId: 'phase-8',
      taskId: 'T8.2',
      title: 'Second sub task',
    });
    store.completeSubTask('T8.1');

    const result = store.deleteTask('T8.2', 'sub');
    const parent = store.getMainTask('phase-8');

    expect(result).toEqual({
      deleted: true,
      taskType: 'sub',
      deletedSubTaskIds: ['T8.2'],
      deletedTaskIds: ['T8.2'],
      parentTaskId: 'phase-8',
    });
    expect(store.getSubTask('T8.2')).toBeNull();
    expect(parent?.totalSubtasks).toBe(1);
    expect(parent?.completedSubtasks).toBe(1);
    expect(parent?.status).toBe('completed');
  });

  test('document store updateTaskStatus reopens a completed parent when a sub task is moved back to pending', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-task-status-doc-'));
    tempDirs.push(tempRoot);
    const store = createDocumentStore('doc_status', tempRoot);

    store.createMainTask({
      projectName: 'doc_status',
      taskId: 'phase-4',
      title: 'Phase 4',
      priority: 'P1',
    });
    store.addSubTask({
      projectName: 'doc_status',
      parentTaskId: 'phase-4',
      taskId: 'T4.1',
      title: 'Only sub task',
    });
    store.completeSubTask('T4.1');

    const result = store.updateTaskStatus('T4.1', 'sub', 'pending');
    const parent = store.getMainTask('phase-4');

    expect(result.updated).toBe(true);
    expect(result.taskType).toBe('sub');
    expect(result.status).toBe('pending');
    expect(parent?.completedSubtasks).toBe(0);
    expect(parent?.status).toBe('in_progress');
  });

  test('graph store updateTaskStatus marks parent in progress when a sub task starts', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-task-status-graph-'));
    tempDirs.push(tempRoot);
    const store = createGraphStore('graph_status', tempRoot);

    store.createMainTask({
      projectName: 'graph_status',
      taskId: 'phase-5',
      title: 'Phase 5',
      priority: 'P1',
    });
    store.addSubTask({
      projectName: 'graph_status',
      parentTaskId: 'phase-5',
      taskId: 'T5.1',
      title: 'First sub task',
    });

    const result = store.updateTaskStatus('T5.1', 'sub', 'in_progress');
    const parent = store.getMainTask('phase-5');

    expect(result.updated).toBe(true);
    expect(result.taskType).toBe('sub');
    expect(result.status).toBe('in_progress');
    expect(parent?.status).toBe('in_progress');
  });
});
