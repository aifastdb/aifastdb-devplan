import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { DEFAULT_AUTOPILOT_CONFIG } from '../src/types';
import {
  getAutopilotConfig,
  getAutopilotNextAction,
  getAutopilotStatus,
  updateAutopilotConfig,
} from '../src/autopilot';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

interface ProgressTask {
  taskId: string;
  title: string;
  status: TaskStatus;
  total: number;
  completed: number;
  percent: number;
}

interface SubTask {
  taskId: string;
  title: string;
  status: TaskStatus;
  description?: string;
  order?: number;
}

class FakeStore {
  private tasks: ProgressTask[];
  private subTasksMap: Record<string, SubTask[]>;
  private priorities: Record<string, 'P0' | 'P1' | 'P2'>;

  constructor(
    tasks: ProgressTask[],
    subTasksMap: Record<string, SubTask[]>,
    priorities: Record<string, 'P0' | 'P1' | 'P2'> = {}
  ) {
    this.tasks = tasks;
    this.subTasksMap = subTasksMap;
    this.priorities = priorities;
  }

  getProgress() {
    return { tasks: this.tasks };
  }

  listSubTasks(parentTaskId: string) {
    return this.subTasksMap[parentTaskId] || [];
  }

  getMainTask(taskId: string) {
    return { priority: this.priorities[taskId] || 'P0' };
  }
}

describe('autopilot control plane regression', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-autopilot-'));
  const projectName = 'aifastdb-devplan';
  const projectRoot = path.join(tmpRoot, 'project-root');
  const basePath = path.join(projectRoot, '.devplan');
  const configPath = path.join(basePath, 'config.json');

  beforeAll(() => {
    fs.mkdirSync(basePath, { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          defaultProject: projectName,
          projects: {
            [projectName]: { rootPath: projectRoot },
          },
        },
        null,
        2
      ),
      'utf-8'
    );
    process.env.AIFASTDB_DEVPLAN_PATH = basePath;
  });

  afterAll(() => {
    delete process.env.AIFASTDB_DEVPLAN_PATH;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('status + next-action should be consistent when active phase has current subtask', () => {
    const store = new FakeStore(
      [
        {
          taskId: 'phase-85',
          title: 'Phase 85',
          status: 'in_progress',
          total: 3,
          completed: 1,
          percent: 33,
        },
      ],
      {
        'phase-85': [
          { taskId: 'T85.1', title: 'done', status: 'completed' },
          { taskId: 'T85.2', title: 'working', status: 'in_progress' },
          { taskId: 'T85.3', title: 'todo', status: 'pending' },
        ],
      }
    );

    const status = getAutopilotStatus(store as any);
    const next = getAutopilotNextAction(store as any);

    expect(status.hasActivePhase).toBe(true);
    expect(status.currentSubTask?.taskId).toBe('T85.2');
    expect(next.action).toBe('wait');
    expect(next.subTask?.taskId).toBe('T85.2');
  });

  test('next-action should suggest start_phase when no active phase and pending exists', () => {
    const store = new FakeStore(
      [
        {
          taskId: 'phase-85',
          title: 'Phase 85',
          status: 'completed',
          total: 5,
          completed: 5,
          percent: 100,
        },
        {
          taskId: 'phase-86',
          title: 'Phase 86',
          status: 'pending',
          total: 4,
          completed: 0,
          percent: 0,
        },
      ],
      {},
      { 'phase-86': 'P0' }
    );

    const next = getAutopilotNextAction(store as any);
    expect(next.action).toBe('start_phase');
    expect(next.phase?.taskId).toBe('phase-86');
  });

  test('config update should persist and be readable from disk-backed runtime', () => {
    const before = getAutopilotConfig(projectName);
    expect(before).toEqual(DEFAULT_AUTOPILOT_CONFIG);

    const updated = updateAutopilotConfig(projectName, {
      enabled: true,
      pollIntervalSeconds: 9,
      maxContinueRetries: 7,
    });
    expect(updated.enabled).toBe(true);
    expect(updated.pollIntervalSeconds).toBe(9);
    expect(updated.maxContinueRetries).toBe(7);

    const cfgFile = path.join(basePath, projectName, 'autopilot-config.json');
    expect(fs.existsSync(cfgFile)).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    expect(onDisk.enabled).toBe(true);
    expect(onDisk.pollIntervalSeconds).toBe(9);
    expect(onDisk.maxContinueRetries).toBe(7);
  });
});
