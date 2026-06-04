import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { handleTaskToolCall } from '../src/mcp-server/handlers/task-tools';

/**
 * Phase-435 follow-up — completion-note SOP guard tests.
 *
 * These tests pin the contract for the 4-field completion-note added to
 * `devplan_complete_task` (sync-workflow §2.3):
 *
 *   - artifactPath + conclusion missing → response includes
 *     `completionNoteWarnings` (soft mode, backward-compatible).
 *   - artifactPath + conclusion provided → handler auto-saves a summary
 *     memory linked to the task; the memory id is returned.
 *   - env AIFASTDB_DEVPLAN_REQUIRE_COMPLETION_NOTE=1 → missing fields
 *     throw InvalidParams (hard mode).
 */

interface MutexLike {
  acquire(): Promise<void>;
  release(): void;
}
function makeMutex(): MutexLike {
  return { async acquire() {}, release() {} };
}

function makePlan(opts: {
  saveMemory?: jest.Mock | undefined;
  completedSub?: any;
} = {}): any {
  return {
    completeSubTask: jest.fn(() => ({
      subTask: opts.completedSub || {
        taskId: 'T1.1', title: 'demo sub', status: 'completed', completedAt: 1234567890,
      },
      mainTask: {
        taskId: 'phase-1', title: 'demo phase', status: 'in_progress',
        totalSubtasks: 3, completedSubtasks: 1,
      },
      mainTaskCompleted: false,
      completedAtCommit: null,
    })),
    completeMainTask: jest.fn(() => ({
      taskId: 'phase-1', title: 'demo phase', status: 'completed',
      completedAt: 1234567890, totalSubtasks: 3, completedSubtasks: 3,
    })),
    listMainTasks: jest.fn(() => []),
    saveMemory: opts.saveMemory,
  };
}

describe('devplan_complete_task — completion-note SOP', () => {
  const originalEnv = process.env.AIFASTDB_DEVPLAN_REQUIRE_COMPLETION_NOTE;

  beforeEach(() => {
    delete process.env.AIFASTDB_DEVPLAN_REQUIRE_COMPLETION_NOTE;
  });
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AIFASTDB_DEVPLAN_REQUIRE_COMPLETION_NOTE;
    } else {
      process.env.AIFASTDB_DEVPLAN_REQUIRE_COMPLETION_NOTE = originalEnv;
    }
  });

  test('missing artifactPath + conclusion → warnings, no memory write', async () => {
    const saveMemory = jest.fn();
    const plan = makePlan({ saveMemory });
    const out = await handleTaskToolCall(
      'devplan_complete_task',
      { projectName: 'demo', taskId: 'T1.1' } as any,
      { getDevPlan: () => plan, taskWriteMutex: makeMutex() },
    );
    expect(out).not.toBeNull();
    const resp = JSON.parse(out as string);
    expect(resp.success).toBe(true);
    expect(resp.completionNote).toBeTruthy();
    expect(resp.completionNote.warnings.length).toBeGreaterThanOrEqual(2);
    expect(resp.completionNote.memorySaved).toBe(false);
    expect(resp.completionNote.memorySkipReason).toContain('artifactPath');
    expect(saveMemory).not.toHaveBeenCalled();
  });

  test('artifactPath + conclusion present → auto-saves summary memory with structured content', async () => {
    const saveMemory = jest.fn(() => ({ id: 'mem-xyz' })) as any;
    const plan = makePlan({ saveMemory });
    const out = await handleTaskToolCall(
      'devplan_complete_task',
      {
        projectName: 'demo',
        taskId: 'T1.1',
        artifactPath: 'docs/data/REPORT.md',
        conclusion: 'chunked +2pp accuracy',
        divergenceNote: '原 50-case A/B 被 matrix 24-combo 替代',
        verification: '24/24 combos green',
      } as any,
      { getDevPlan: () => plan, taskWriteMutex: makeMutex() },
    );
    const resp = JSON.parse(out as string);
    expect(resp.completionNote.warnings).toEqual([]); // all 4 fields present
    expect(resp.completionNote.memorySaved).toBe(true);
    expect(resp.completionNote.memoryId).toBe('mem-xyz');
    expect(saveMemory).toHaveBeenCalledTimes(1);
    const callArg = (saveMemory.mock.calls as any[])[0][0];
    expect(callArg.memoryType).toBe('summary');
    expect(callArg.relatedTaskId).toBe('T1.1');
    expect(callArg.tags).toEqual(expect.arrayContaining(['completion-note', 'T1.1']));
    expect(callArg.importance).toBeCloseTo(0.85);
    expect(callArg.content).toContain('交付物: docs/data/REPORT.md');
    expect(callArg.content).toContain('关键结论: chunked +2pp accuracy');
    expect(callArg.content).toContain('替代说明:');
    expect(callArg.content).toContain('验证: 24/24 combos green');
    expect(callArg.provenance.origin).toBe('devplan_complete_task');
  });

  test('completion-note still warns about missing optional verification', async () => {
    const saveMemory = jest.fn(() => ({ id: 'mem-1' })) as any;
    const plan = makePlan({ saveMemory });
    const out = await handleTaskToolCall(
      'devplan_complete_task',
      {
        projectName: 'demo',
        taskId: 'T1.1',
        artifactPath: 'docs/data/REPORT.md',
        conclusion: 'OK',
      } as any,
      { getDevPlan: () => plan, taskWriteMutex: makeMutex() },
    );
    const resp = JSON.parse(out as string);
    expect(resp.completionNote.memorySaved).toBe(true);
    // verification missing → soft warning emitted
    expect(resp.completionNote.warnings.join('\n')).toContain('verification');
  });

  test('hard-required mode rejects when artifactPath / conclusion missing', async () => {
    process.env.AIFASTDB_DEVPLAN_REQUIRE_COMPLETION_NOTE = '1';
    const saveMemory = jest.fn();
    const plan = makePlan({ saveMemory });
    await expect(
      handleTaskToolCall(
        'devplan_complete_task',
        { projectName: 'demo', taskId: 'T1.1' } as any,
        { getDevPlan: () => plan, taskWriteMutex: makeMutex() },
      ),
    ).rejects.toThrow(/AIFASTDB_DEVPLAN_REQUIRE_COMPLETION_NOTE/);
    expect(saveMemory).not.toHaveBeenCalled();
  });

  test('plan without saveMemory → memorySaved=false, memorySkipReason explains', async () => {
    const plan = makePlan({ saveMemory: undefined });
    const out = await handleTaskToolCall(
      'devplan_complete_task',
      {
        projectName: 'demo',
        taskId: 'T1.1',
        artifactPath: 'docs/data/REPORT.md',
        conclusion: 'OK',
      } as any,
      { getDevPlan: () => plan, taskWriteMutex: makeMutex() },
    );
    const resp = JSON.parse(out as string);
    expect(resp.completionNote.memorySaved).toBe(false);
    expect(resp.completionNote.memorySkipReason).toContain('saveMemory not available');
  });

  test('main task completion also runs completion-note guard', async () => {
    const saveMemory = jest.fn(() => ({ id: 'mem-main' })) as any;
    const plan = makePlan({ saveMemory });
    const out = await handleTaskToolCall(
      'devplan_complete_task',
      {
        projectName: 'demo',
        taskId: 'phase-1',
        taskType: 'main',
        artifactPath: 'PRs/123',
        conclusion: 'phase finished',
      } as any,
      { getDevPlan: () => plan, taskWriteMutex: makeMutex() },
    );
    const resp = JSON.parse(out as string);
    expect(resp.taskType).toBe('main');
    expect(resp.completionNote.memorySaved).toBe(true);
    const callArg = (saveMemory.mock.calls as any[])[0][0];
    expect(callArg.tags).toEqual(expect.arrayContaining(['phase-completion']));
  });
});
