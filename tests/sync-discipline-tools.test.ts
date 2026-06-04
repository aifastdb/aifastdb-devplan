import { describe, expect, test } from '@jest/globals';

import {
  handleSyncDisciplineToolCall,
  __testables,
} from '../src/mcp-server/handlers/sync-discipline-tools';

/**
 * Phase-435 follow-up — unit tests for the three sync-discipline tools.
 *
 * These tests run entirely against an in-memory `plan` stub. They do not
 * boot the MCP server, do not use ai_db's NAPI, and do not touch the file
 * system. The handler contracts under test are:
 *
 *   - devplan_audit_active_layer:
 *       returns a structured report per in_progress phase with stale /
 *       large-optional / description-alignment signals + suggested actions.
 *   - devplan_phase_alignment_check:
 *       extracts goal candidates from a phase description and flags the
 *       ones not covered by any sub-task (Phase-426 "LLM-as-judge" case).
 *   - devplan_session_close:
 *       emits an end-of-session checklist + concrete next-action scripts
 *       sized to one of the three sync-workflow §3 scenarios.
 */

type MainStub = {
  id: string;
  projectName: string;
  taskId: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  description?: string;
  totalSubtasks: number;
  completedSubtasks: number;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'revoked';
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

type SubStub = {
  id: string;
  projectName: string;
  taskId: string;
  parentTaskId: string;
  title: string;
  description?: string;
  estimatedHours?: number;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'revoked';
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

interface Fixture {
  mains: MainStub[];
  subsByParent: Record<string, SubStub[]>;
}

function makePlan(fixture: Fixture): any {
  return {
    listMainTasks: (filter?: { status?: string }) => {
      if (!filter?.status) return [...fixture.mains];
      return fixture.mains.filter(m => m.status === filter.status);
    },
    listSubTasks: (parentTaskId: string) => {
      return fixture.subsByParent[parentTaskId] || [];
    },
    getMainTask: (taskId: string) => {
      return fixture.mains.find(m => m.taskId === taskId) || null;
    },
  };
}

function nowMs(): number {
  return Date.now();
}

function daysAgo(d: number): number {
  return nowMs() - d * 24 * 60 * 60 * 1000;
}

// ============================================================================
// extractGoalCandidates / goalCoveredBy — pure heuristic checks
// ============================================================================

describe('extractGoalCandidates', () => {
  test('pulls list items as goals', () => {
    const goals = __testables.extractGoalCandidates(
      '主目标:\n- 跑通 chunked-path A/B\n- 调优 recall K\n- LLM-as-judge 评分',
    );
    expect(goals).toEqual(expect.arrayContaining([
      expect.stringContaining('chunked-path A/B'),
      expect.stringContaining('recall K'),
      expect.stringContaining('LLM-as-judge'),
    ]));
  });

  test('captures **bold** and `backticked` phrases', () => {
    const goals = __testables.extractGoalCandidates(
      'this phase covers **LongMemEval** integration and the `chunked-path` switch.',
    );
    expect(goals).toEqual(expect.arrayContaining([
      'LongMemEval',
      'chunked-path',
    ]));
  });

  test('drops tiny noise and dedupes case-insensitively', () => {
    const goals = __testables.extractGoalCandidates(
      '- AA\n- chunked\n- Chunked\n- 是\n- LLM-as-judge',
    );
    const lower = goals.map(g => g.toLowerCase());
    expect(lower).toEqual(expect.arrayContaining(['chunked', 'llm-as-judge']));
    expect(lower.filter(g => g === 'chunked')).toHaveLength(1);
    expect(lower).not.toContain('aa');
  });

  test('returns empty array for empty or whitespace description', () => {
    expect(__testables.extractGoalCandidates('')).toEqual([]);
    expect(__testables.extractGoalCandidates('   \n  ')).toEqual([]);
  });
});

describe('goalCoveredBy', () => {
  test('matches when goal phrase appears verbatim in haystack', () => {
    expect(__testables.goalCoveredBy('chunked-path', 'add chunked-path switch to retriever')).toBe(true);
  });

  test('matches when distinctive tokens appear (Phase-426 "LLM-as-judge" → "judge" sub-task)', () => {
    expect(__testables.goalCoveredBy('LLM-as-judge 评分', 'implement judge scoring pipeline')).toBe(true);
  });

  test('does not match when only stop-tokens overlap', () => {
    expect(__testables.goalCoveredBy('the cool thing', 'something else')).toBe(false);
  });
});

// ============================================================================
// devplan_audit_active_layer
// ============================================================================

describe('devplan_audit_active_layer', () => {
  test('flags Phase-426-style stale phase with unmatched goal + large optional sub-task', async () => {
    const fixture: Fixture = {
      mains: [
        {
          id: 'm1',
          projectName: 'demo',
          taskId: 'phase-426',
          title: 'LongMemEval-full chunked-path A/B + recall',
          priority: 'P1',
          description: '目标:\n- chunked-path A/B 跑通\n- recall K 调优\n- LLM-as-judge 评分修正',
          totalSubtasks: 3,
          completedSubtasks: 1,
          status: 'in_progress',
          createdAt: daysAgo(30),
          updatedAt: daysAgo(15),
          completedAt: null,
        },
      ],
      subsByParent: {
        'phase-426': [
          {
            id: 's1',
            projectName: 'demo',
            taskId: 'T426.1',
            parentTaskId: 'phase-426',
            title: 'chunked-path A/B 50 case 跑通',
            status: 'completed',
            createdAt: daysAgo(30),
            updatedAt: daysAgo(20),
            completedAt: daysAgo(20),
          },
          {
            id: 's2',
            projectName: 'demo',
            taskId: 'T426.2',
            parentTaskId: 'phase-426',
            title: 'recall K 调优实验',
            status: 'in_progress',
            createdAt: daysAgo(30),
            updatedAt: daysAgo(15),
            completedAt: null,
          },
          {
            id: 's3',
            projectName: 'demo',
            taskId: 'T426.5',
            parentTaskId: 'phase-426',
            title: '200+ case 全能力采样',
            estimatedHours: 24,
            status: 'pending',
            createdAt: daysAgo(30),
            updatedAt: daysAgo(30),
            completedAt: null,
          },
        ],
      },
    };
    const out = await handleSyncDisciplineToolCall(
      'devplan_audit_active_layer',
      { projectName: 'demo' } as any,
      { getDevPlan: () => makePlan(fixture) },
    );
    expect(out).not.toBeNull();
    const report = JSON.parse(out as string);
    expect(report.status).toBe('audited');
    expect(report.inProgressPhases).toBe(1);
    expect(report.auditedPhases).toBe(1);
    const phase = report.phases[0];
    expect(phase.taskId).toBe('phase-426');
    expect(phase.stale).toBe(true);
    expect(phase.lastActivityDaysAgo).toBeGreaterThanOrEqual(7);
    // Large optional sub-task ≥ 8h
    expect(phase.largeOptionalSubtasks.map((s: any) => s.taskId)).toContain('T426.5');
    // LLM-as-judge described but no sub-task covers it
    expect(phase.descriptionGoalsLikelyMissing).toBe(true);
    // Suggested actions reference the right tool follow-ups
    expect(phase.suggestedActions.join('\n')).toContain('devplan_phase_alignment_check');
    expect(phase.suggestedActions.join('\n')).toContain('T426.5');
  });

  test('respects staleDays + maxPhases + largeSubtaskHourThreshold', async () => {
    const fixture: Fixture = {
      mains: [
        {
          id: 'm1', projectName: 'demo', taskId: 'phase-100', title: 'p100', priority: 'P1',
          totalSubtasks: 0, completedSubtasks: 0, status: 'in_progress',
          createdAt: daysAgo(2), updatedAt: daysAgo(2), completedAt: null,
        },
        {
          id: 'm2', projectName: 'demo', taskId: 'phase-101', title: 'p101', priority: 'P1',
          totalSubtasks: 0, completedSubtasks: 0, status: 'in_progress',
          createdAt: daysAgo(1), updatedAt: daysAgo(1), completedAt: null,
        },
      ],
      subsByParent: {},
    };
    const out = await handleSyncDisciplineToolCall(
      'devplan_audit_active_layer',
      { projectName: 'demo', staleDays: 14, maxPhases: 1, largeSubtaskHourThreshold: 4 } as any,
      { getDevPlan: () => makePlan(fixture) },
    );
    const report = JSON.parse(out as string);
    expect(report.inProgressPhases).toBe(2);
    expect(report.auditedPhases).toBe(1);
    expect(report.truncated).toBe(true);
    expect(report.staleCount).toBe(0); // 2d < 14d
  });

  test('returns null for non-target tool names', async () => {
    const out = await handleSyncDisciplineToolCall(
      'devplan_memory_save',
      { projectName: 'demo' } as any,
      { getDevPlan: () => ({} as any) },
    );
    expect(out).toBeNull();
  });
});

// ============================================================================
// devplan_phase_alignment_check
// ============================================================================

describe('devplan_phase_alignment_check', () => {
  test('Phase-426 case: detects "LLM-as-judge" missing from sub-tasks', async () => {
    const fixture: Fixture = {
      mains: [{
        id: 'm1', projectName: 'demo', taskId: 'phase-426', title: 'p426', priority: 'P1',
        description: '目标:\n- chunked-path A/B 跑通\n- LLM-as-judge 评分修正\n- recall K 调优',
        totalSubtasks: 2, completedSubtasks: 0, status: 'in_progress',
        createdAt: daysAgo(10), updatedAt: daysAgo(5), completedAt: null,
      }],
      subsByParent: {
        'phase-426': [
          { id: 's1', projectName: 'demo', taskId: 'T426.1', parentTaskId: 'phase-426',
            title: 'chunked-path A/B 50 case', status: 'completed',
            createdAt: daysAgo(10), updatedAt: daysAgo(5), completedAt: daysAgo(5) },
          { id: 's2', projectName: 'demo', taskId: 'T426.2', parentTaskId: 'phase-426',
            title: 'recall K 调优', status: 'in_progress',
            createdAt: daysAgo(10), updatedAt: daysAgo(5), completedAt: null },
        ],
      },
    };
    const out = await handleSyncDisciplineToolCall(
      'devplan_phase_alignment_check',
      { projectName: 'demo', taskId: 'phase-426' } as any,
      { getDevPlan: () => makePlan(fixture) },
    );
    const report = JSON.parse(out as string);
    expect(report.status).toBe('checked');
    expect(report.taskId).toBe('phase-426');
    expect(report.unmatchedGoals.length).toBeGreaterThanOrEqual(1);
    expect(
      report.unmatchedGoals.some((g: string) => g.toLowerCase().includes('llm-as-judge')),
    ).toBe(true);
    expect(report.matchedGoals.some((g: string) => g.toLowerCase().includes('chunked'))).toBe(true);
    expect(report.suggestedActions.join('\n')).toContain('devplan_add_sub_task');
  });

  test('clean alignment when all goals are covered', async () => {
    const fixture: Fixture = {
      mains: [{
        id: 'm1', projectName: 'demo', taskId: 'phase-1', title: 'p1', priority: 'P1',
        description: '目标:\n- 写 schema\n- 加 tests',
        totalSubtasks: 2, completedSubtasks: 0, status: 'in_progress',
        createdAt: daysAgo(2), updatedAt: daysAgo(1), completedAt: null,
      }],
      subsByParent: {
        'phase-1': [
          { id: 's1', projectName: 'demo', taskId: 'T1.1', parentTaskId: 'phase-1',
            title: '写 schema 定义', status: 'completed',
            createdAt: daysAgo(2), updatedAt: daysAgo(1), completedAt: daysAgo(1) },
          { id: 's2', projectName: 'demo', taskId: 'T1.2', parentTaskId: 'phase-1',
            title: '补 tests 覆盖', status: 'in_progress',
            createdAt: daysAgo(2), updatedAt: daysAgo(1), completedAt: null },
        ],
      },
    };
    const out = await handleSyncDisciplineToolCall(
      'devplan_phase_alignment_check',
      { projectName: 'demo', taskId: 'phase-1' } as any,
      { getDevPlan: () => makePlan(fixture) },
    );
    const report = JSON.parse(out as string);
    expect(report.unmatchedGoals).toEqual([]);
    expect(report.coverage).toBe(1);
    expect(report.suggestedActions.join('\n')).toContain('alignment OK');
  });

  test('throws for missing or non-existent taskId', async () => {
    const fixture: Fixture = { mains: [], subsByParent: {} };
    await expect(
      handleSyncDisciplineToolCall(
        'devplan_phase_alignment_check',
        { projectName: 'demo' } as any,
        { getDevPlan: () => makePlan(fixture) },
      ),
    ).rejects.toThrow(/Missing required: taskId/);
    await expect(
      handleSyncDisciplineToolCall(
        'devplan_phase_alignment_check',
        { projectName: 'demo', taskId: 'phase-doesnotexist' } as any,
        { getDevPlan: () => makePlan(fixture) },
      ),
    ).rejects.toThrow(/not found/);
  });
});

// ============================================================================
// devplan_session_close
// ============================================================================

describe('devplan_session_close', () => {
  const baseFixture = (): Fixture => ({
    mains: [{
      id: 'm1', projectName: 'demo', taskId: 'phase-435', title: 'p435', priority: 'P1',
      description: '目标:\n- 唤醒栈\n- AAAK 索引\n- Cursor hooks',
      totalSubtasks: 3, completedSubtasks: 1, status: 'in_progress',
      createdAt: daysAgo(7), updatedAt: daysAgo(1), completedAt: null,
    }],
    subsByParent: {
      'phase-435': [
        { id: 's1', projectName: 'demo', taskId: 'T435.1', parentTaskId: 'phase-435',
          title: 'L0~L3 唤醒栈', status: 'completed',
          createdAt: daysAgo(7), updatedAt: daysAgo(5), completedAt: daysAgo(5) },
        { id: 's2', projectName: 'demo', taskId: 'T435.5', parentTaskId: 'phase-435',
          title: 'Cursor hooks dispatcher', status: 'in_progress', estimatedHours: 4,
          createdAt: daysAgo(7), updatedAt: daysAgo(1), completedAt: null },
        { id: 's3', projectName: 'demo', taskId: 'T435.8', parentTaskId: 'phase-435',
          title: 'baseline 全量回归', status: 'pending', estimatedHours: 12,
          createdAt: daysAgo(7), updatedAt: daysAgo(7), completedAt: null },
      ],
    },
  });

  test('outcome=completed: emits devplan_complete_task scripts for the touched sub-tasks', async () => {
    const out = await handleSyncDisciplineToolCall(
      'devplan_session_close',
      {
        projectName: 'demo',
        recentTaskIds: ['T435.5'],
        sessionOutcome: 'completed',
        conversationId: 'conv-x',
      } as any,
      { getDevPlan: () => makePlan(baseFixture()) },
    );
    const report = JSON.parse(out as string);
    expect(report.status).toBe('session-close-checklist');
    expect(report.sessionOutcome).toBe('completed');
    expect(report.preflight).toBe(true);
    const scripts = report.nextActions.join('\n');
    expect(scripts).toContain('FULLY COMPLETED');
    expect(scripts).toContain('devplan_complete_task');
    expect(scripts).toContain('T435.5');
    expect(scripts).toContain('artifactPath');
    expect(scripts).not.toContain('PARTIAL'); // outcome-specific branch only
  });

  test('outcome=partial: emits upsert_task in_progress + memory_save progress note', async () => {
    const out = await handleSyncDisciplineToolCall(
      'devplan_session_close',
      {
        projectName: 'demo',
        recentTaskIds: ['T435.5'],
        sessionOutcome: 'partial',
      } as any,
      { getDevPlan: () => makePlan(baseFixture()) },
    );
    const report = JSON.parse(out as string);
    const scripts = report.nextActions.join('\n');
    expect(scripts).toContain('PARTIALLY');
    expect(scripts).toContain('devplan_upsert_task');
    expect(scripts).toContain('in_progress');
    expect(scripts).toContain('devplan_memory_save');
  });

  test('outcome=diverged: emits both options (divergenceNote + cancelled+migrate)', async () => {
    const out = await handleSyncDisciplineToolCall(
      'devplan_session_close',
      {
        projectName: 'demo',
        recentTaskIds: ['T435.5'],
        sessionOutcome: 'diverged',
      } as any,
      { getDevPlan: () => makePlan(baseFixture()) },
    );
    const report = JSON.parse(out as string);
    const scripts = report.nextActions.join('\n');
    expect(scripts).toContain('DIVERGED');
    expect(scripts).toContain('divergenceNote');
    expect(scripts).toContain('cancelled');
  });

  test('omitting sessionOutcome emits all three branches for inspection', async () => {
    const out = await handleSyncDisciplineToolCall(
      'devplan_session_close',
      { projectName: 'demo', recentTaskIds: ['T435.5'] } as any,
      { getDevPlan: () => makePlan(baseFixture()) },
    );
    const report = JSON.parse(out as string);
    expect(report.sessionOutcome).toBe('unspecified');
    const scripts = report.nextActions.join('\n');
    expect(scripts).toContain('FULLY COMPLETED');
    expect(scripts).toContain('PARTIALLY');
    expect(scripts).toContain('DIVERGED');
  });

  test('fallback to all in_progress phases when recentTaskIds omitted; flags large optional sub-task', async () => {
    const out = await handleSyncDisciplineToolCall(
      'devplan_session_close',
      { projectName: 'demo' } as any,
      { getDevPlan: () => makePlan(baseFixture()) },
    );
    const report = JSON.parse(out as string);
    expect(report.reports).toHaveLength(1);
    expect(report.reports[0].taskType).toBe('main');
    expect(report.reports[0].taskId).toBe('phase-435');
    // T435.8 has estimatedHours=12 ≥ default 8 → flagged
    const largeIds = report.reports[0].largeOptionalSubtasks.map((s: any) => s.taskId);
    expect(largeIds).toContain('T435.8');
  });

  test('rejects invalid sessionOutcome value', async () => {
    await expect(
      handleSyncDisciplineToolCall(
        'devplan_session_close',
        { projectName: 'demo', sessionOutcome: 'wat' } as any,
        { getDevPlan: () => makePlan(baseFixture()) },
      ),
    ).rejects.toThrow(/sessionOutcome must be one of/);
  });
});
