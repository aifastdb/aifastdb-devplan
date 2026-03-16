import { describe, expect, it, jest } from '@jest/globals';

import {
  DEFAULT_EXPOSED_TOOL_NAMES,
  MCP_TOOL_MODE_ENV_VAR,
  MICRO_EXPOSED_TOOL_NAMES,
  SLIM_EXPOSED_TOOL_NAMES,
  TOOL_GROUPS,
  TOOLS,
  getExposedTools,
  getToolExposureMode,
  isExposedToolName,
} from '../src/mcp-server/tool-definitions';
import { handleSectionToolCall } from '../src/mcp-server/handlers/section-tools';
import { handleTaskToolCall } from '../src/mcp-server/handlers/task-tools';

describe('MCP tool surface', () => {
  it('only exposes the default micro tool set by default', () => {
    expect(TOOLS.map(tool => tool.name)).toEqual([...DEFAULT_EXPOSED_TOOL_NAMES]);
    expect(TOOLS.map(tool => tool.name)).toEqual([...MICRO_EXPOSED_TOOL_NAMES]);
    expect(TOOLS.some(tool => tool.name === 'devplan_code_status')).toBe(false);
    expect(TOOLS.some(tool => tool.name === 'devplan_create_module')).toBe(false);
    expect(TOOLS.some(tool => tool.name === 'devplan_auto_status')).toBe(false);
  });

  it('supports micro/slim/full tool exposure mode switching', () => {
    expect(getToolExposureMode(undefined)).toBe('micro');
    expect(getToolExposureMode('micro')).toBe('micro');
    expect(getToolExposureMode('slim')).toBe('slim');
    expect(getToolExposureMode('full')).toBe('full');
    expect(getToolExposureMode('all')).toBe('full');

    const microTools = getExposedTools('micro').map(tool => tool.name);
    const slimTools = getExposedTools('slim').map(tool => tool.name);
    const fullTools = getExposedTools('full').map(tool => tool.name);

    expect(microTools).toEqual([...MICRO_EXPOSED_TOOL_NAMES]);
    expect(slimTools).toEqual([...SLIM_EXPOSED_TOOL_NAMES]);
    expect(slimTools.length).toBeGreaterThan(microTools.length);
    expect(fullTools.length).toBeGreaterThan(slimTools.length);
    expect(fullTools).toContain('devplan_code_status');

    const slimDefinitions = getExposedTools('slim');
    expect(slimDefinitions.every(tool => tool.description.startsWith('['))).toBe(true);
    expect(slimDefinitions.find(tool => tool.name === 'devplan_delete_task')?.description).toContain('[tasks]');
    expect(slimDefinitions.find(tool => tool.name === 'devplan_update_task_status')?.description).toContain('[tasks]');

    const microSaveSection = getExposedTools('micro').find(tool => tool.name === 'devplan_save_section');
    const microProperties = microSaveSection?.inputSchema.properties as Record<string, { description?: string }> | undefined;
    expect(microProperties?.content?.description).toBe('markdown content');
    expect(microProperties?.version?.description).toBeUndefined();

    const fullSaveSection = getExposedTools('full').find(tool => tool.name === 'devplan_save_section');
    const fullProperties = fullSaveSection?.inputSchema.properties as Record<string, { description?: string }> | undefined;
    expect(String(fullProperties?.content?.description || '')).toContain('Markdown content for this section');
    expect(String(fullProperties?.version?.description || '')).toContain('Optional version string');

    expect(TOOL_GROUPS.docs).toContain('devplan_search_sections');
    expect(TOOL_GROUPS.tasks).toContain('devplan_delete_task');
    expect(TOOL_GROUPS.tasks).toContain('devplan_update_task_status');
    expect(TOOL_GROUPS.memory).toContain('devplan_recall_unified');
    expect(TOOL_GROUPS.batch).toContain('devplan_memory_batch_commit');
    expect(TOOL_GROUPS.project).toContain('devplan_save_prompt');

    const prev = process.env[MCP_TOOL_MODE_ENV_VAR];
    process.env[MCP_TOOL_MODE_ENV_VAR] = 'full';
    try {
      expect(isExposedToolName('devplan_code_status')).toBe(true);
      expect(isExposedToolName('devplan_delete_task')).toBe(true);
      expect(isExposedToolName('devplan_update_task_status')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env[MCP_TOOL_MODE_ENV_VAR];
      else process.env[MCP_TOOL_MODE_ENV_VAR] = prev;
    }

    process.env[MCP_TOOL_MODE_ENV_VAR] = 'micro';
    try {
      expect(isExposedToolName('devplan_memory_batch_commit')).toBe(false);
      expect(isExposedToolName('devplan_delete_task')).toBe(false);
      expect(isExposedToolName('devplan_update_task_status')).toBe(false);
      expect(isExposedToolName('devplan_list_tasks')).toBe(true);
      expect(isExposedToolName('devplan_start_phase')).toBe(true);
      expect(isExposedToolName('devplan_search_tasks')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env[MCP_TOOL_MODE_ENV_VAR];
      else process.env[MCP_TOOL_MODE_ENV_VAR] = prev;
    }
  });

  it('supports deleting a document section through the section handler', async () => {
    const deleteSection = jest.fn(() => true);
    const getDevPlan = jest.fn(() => ({
      deleteSection,
    }) as any);

    const result = await handleSectionToolCall(
      'devplan_delete_section',
      { projectName: 'demo', section: 'overview', subSection: 'intro' },
      { getDevPlan }
    );

    expect(deleteSection).toHaveBeenCalledWith('overview', 'intro');
    expect(JSON.parse(result!)).toEqual({
      success: true,
      deleted: true,
      projectName: 'demo',
      section: 'overview',
      subSection: 'intro',
    });
  });

  it('supports field-specific title search through devplan_search_sections', async () => {
    const listSections = jest.fn(() => [
      {
        id: 'doc-1',
        section: 'overview',
        title: 'Planner Overview',
        content: 'General architecture',
        moduleId: 'planner',
        updatedAt: 5,
      },
      {
        id: 'doc-2',
        section: 'technical_notes',
        subSection: 'memo',
        title: 'Other Note',
        content: 'Planner Overview appears only in content',
        moduleId: 'planner',
        updatedAt: 4,
      },
    ]);
    const getDevPlan = jest.fn(() => ({
      listSections,
      isSemanticSearchEnabled: () => true,
    }) as any);

    const result = await handleSectionToolCall(
      'devplan_search_sections',
      { projectName: 'demo', query: 'Planner Overview', searchBy: 'title' },
      { getDevPlan }
    );
    const parsed = JSON.parse(result!);

    expect(parsed.searchBy).toBe('title');
    expect(parsed.actualMode).toBe('literal');
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe('doc-1');
  });

  it('supports field-specific content search through devplan_search_sections', async () => {
    const listSections = jest.fn(() => [
      {
        id: 'doc-1',
        section: 'overview',
        title: 'Planner Overview',
        content: 'General architecture',
        moduleId: 'planner',
        updatedAt: 5,
      },
      {
        id: 'doc-2',
        section: 'technical_notes',
        subSection: 'memo',
        title: 'Other Note',
        content: 'Planner Overview appears only in content',
        moduleId: 'planner',
        updatedAt: 4,
      },
    ]);
    const getDevPlan = jest.fn(() => ({
      listSections,
      isSemanticSearchEnabled: () => false,
    }) as any);

    const result = await handleSectionToolCall(
      'devplan_search_sections',
      { projectName: 'demo', query: 'Planner Overview', searchBy: 'content' },
      { getDevPlan }
    );
    const parsed = JSON.parse(result!);

    expect(parsed.searchBy).toBe('content');
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe('doc-2');
  });

  it('supports field-specific id search through devplan_search_sections', async () => {
    const listSections = jest.fn(() => [
      {
        id: '171e9a18-c7e9-430b-9e3d-fa6d384a0b4e',
        section: 'overview',
        title: 'Planner Overview',
        content: 'General architecture',
        moduleId: 'planner',
        updatedAt: 5,
      },
      {
        id: 'doc-2',
        section: 'technical_notes',
        subSection: 'memo',
        title: 'ID mentioned in content',
        content: '171e9a18-c7e9-430b-9e3d-fa6d384a0b4e appears here too',
        moduleId: 'planner',
        updatedAt: 4,
      },
    ]);
    const getDevPlan = jest.fn(() => ({
      listSections,
      isSemanticSearchEnabled: () => true,
    }) as any);

    const result = await handleSectionToolCall(
      'devplan_search_sections',
      {
        projectName: 'demo',
        query: '171e9a18-c7e9-430b-9e3d-fa6d384a0b4e',
        searchBy: 'id',
      },
      { getDevPlan }
    );
    const parsed = JSON.parse(result!);

    expect(parsed.searchBy).toBe('id');
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].id).toBe('171e9a18-c7e9-430b-9e3d-fa6d384a0b4e');
  });

  it('supports field-specific task title search through devplan_search_tasks', async () => {
    const listMainTasks = jest.fn(() => [
      {
        id: 'main-1',
        projectName: 'demo',
        taskId: 'phase-1',
        title: 'Document Search Upgrade',
        priority: 'P1',
        description: 'Improve task search behavior',
        totalSubtasks: 1,
        completedSubtasks: 0,
        status: 'in_progress',
        createdAt: 10,
        updatedAt: 20,
        completedAt: null,
      },
      {
        id: 'main-2',
        projectName: 'demo',
        taskId: 'phase-2',
        title: 'Release Cleanup',
        priority: 'P1',
        description: 'Document search upgrade mentioned only in description',
        totalSubtasks: 0,
        completedSubtasks: 0,
        status: 'pending',
        createdAt: 11,
        updatedAt: 19,
        completedAt: null,
      },
    ]);
    const listSubTasks = jest.fn(() => []);
    const getDevPlan = jest.fn(() => ({
      listMainTasks,
      listSubTasks,
    }) as any);

    const result = await handleTaskToolCall(
      'devplan_search_tasks',
      { projectName: 'demo', query: 'Document Search Upgrade', searchBy: 'title' },
      { getDevPlan }
    );
    const parsed = JSON.parse(result!);

    expect(parsed.searchBy).toBe('title');
    expect(parsed.matchCount).toBe(1);
    expect(parsed.results[0]).toMatchObject({
      taskId: 'phase-1',
      matchedFields: ['title'],
    });
  });

  it('supports sub-task search through devplan_search_tasks', async () => {
    const listMainTasks = jest.fn(() => [
      {
        id: 'main-1',
        projectName: 'demo',
        taskId: 'phase-1',
        title: 'Task Search Refactor',
        priority: 'P1',
        description: 'Refactor handler',
        totalSubtasks: 2,
        completedSubtasks: 0,
        status: 'in_progress',
        createdAt: 10,
        updatedAt: 20,
        completedAt: null,
      },
    ]);
    const listSubTasks = jest.fn(() => [
      {
        id: 'sub-1',
        projectName: 'demo',
        taskId: 'T1.1',
        parentTaskId: 'phase-1',
        title: 'Implement fuzzy ranking helper',
        description: 'Support title and taskId matching',
        status: 'in_progress',
        createdAt: 10,
        updatedAt: 20,
        completedAt: null,
      },
      {
        id: 'sub-2',
        projectName: 'demo',
        taskId: 'T1.2',
        parentTaskId: 'phase-1',
        title: 'Update docs',
        description: 'No search relevance',
        status: 'pending',
        createdAt: 11,
        updatedAt: 19,
        completedAt: null,
      },
    ]);
    const getDevPlan = jest.fn(() => ({
      listMainTasks,
      listSubTasks,
    }) as any);

    const result = await handleTaskToolCall(
      'devplan_search_tasks',
      { projectName: 'demo', query: 'fuzzy ranking helper', searchBy: 'subTask' },
      { getDevPlan }
    );
    const parsed = JSON.parse(result!);

    expect(parsed.searchBy).toBe('subTask');
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toMatchObject({
      taskId: 'phase-1',
      matchedFields: ['subTask'],
    });
    expect(parsed.results[0].matchedSubTasks).toEqual([
      {
        taskId: 'T1.1',
        title: 'Implement fuzzy ranking helper',
        status: 'in_progress',
      },
    ]);
  });

  it('returns all sub-tasks for matched phases when includeSubTasks is true', async () => {
    const listMainTasks = jest.fn(() => [
      {
        id: 'main-1',
        projectName: 'demo',
        taskId: 'phase-1',
        title: 'Task Search Refactor',
        priority: 'P1',
        description: 'Refactor handler',
        totalSubtasks: 2,
        completedSubtasks: 0,
        status: 'in_progress',
        createdAt: 10,
        updatedAt: 20,
        completedAt: null,
      },
    ]);
    const subTasks = [
      {
        id: 'sub-1',
        projectName: 'demo',
        taskId: 'T1.1',
        parentTaskId: 'phase-1',
        title: 'Implement fuzzy ranking helper',
        description: 'Support title and taskId matching',
        status: 'in_progress',
        createdAt: 10,
        updatedAt: 20,
        completedAt: null,
      },
      {
        id: 'sub-2',
        projectName: 'demo',
        taskId: 'T1.2',
        parentTaskId: 'phase-1',
        title: 'Update docs',
        description: 'No search relevance',
        status: 'pending',
        createdAt: 11,
        updatedAt: 19,
        completedAt: null,
      },
    ];
    const listSubTasks = jest.fn(() => subTasks);
    const getDevPlan = jest.fn(() => ({
      listMainTasks,
      listSubTasks,
    }) as any);

    const result = await handleTaskToolCall(
      'devplan_search_tasks',
      { projectName: 'demo', query: 'refactor', includeSubTasks: true },
      { getDevPlan }
    );
    const parsed = JSON.parse(result!);

    expect(parsed.results[0].subTasks).toHaveLength(2);
    expect(parsed.results[0].matchedFields).toContain('title');
  });

  it('supports deleting a task through the task handler', async () => {
    const deleteTask = jest.fn(() => ({
      deleted: true,
      taskType: 'main',
      deletedMainTaskId: 'phase-9',
      deletedSubTaskIds: ['T9.1', 'T9.2'],
      deletedTaskIds: ['phase-9', 'T9.1', 'T9.2'],
      parentTaskId: null,
    }));
    const getDevPlan = jest.fn(() => ({
      deleteTask,
    }) as any);

    const result = await handleTaskToolCall(
      'devplan_delete_task',
      { projectName: 'demo', taskId: 'phase-9', taskType: 'main' },
      { getDevPlan }
    );

    expect(deleteTask).toHaveBeenCalledWith('phase-9', 'main');
    expect(JSON.parse(result!)).toEqual({
      success: true,
      deleted: true,
      taskType: 'main',
      deletedMainTaskId: 'phase-9',
      deletedSubTaskIds: ['T9.1', 'T9.2'],
      deletedTaskIds: ['phase-9', 'T9.1', 'T9.2'],
      parentTaskId: null,
    });
  });

  it('supports updating a task status through the task handler', async () => {
    const updateTaskStatus = jest.fn(() => ({
      updated: true,
      taskType: 'sub',
      taskId: 'T9.2',
      status: 'in_progress',
      parentTaskId: 'phase-9',
      subTask: {
        taskId: 'T9.2',
        parentTaskId: 'phase-9',
        title: 'Work item',
        status: 'in_progress',
      },
      parentMainTask: {
        taskId: 'phase-9',
        title: 'Phase 9',
        status: 'in_progress',
      },
    }));
    const getDevPlan = jest.fn(() => ({
      updateTaskStatus,
    }) as any);

    const result = await handleTaskToolCall(
      'devplan_update_task_status',
      { projectName: 'demo', taskId: 'T9.2', taskType: 'sub', status: 'in_progress' },
      { getDevPlan }
    );

    expect(updateTaskStatus).toHaveBeenCalledWith('T9.2', 'sub', 'in_progress');
    expect(JSON.parse(result!)).toMatchObject({
      success: true,
      updated: true,
      taskType: 'sub',
      taskId: 'T9.2',
      status: 'in_progress',
      parentTaskId: 'phase-9',
    });
  });

  it('defaults devplan_list_tasks to the latest 10 items', async () => {
    const listMainTasks = jest.fn(() => Array.from({ length: 12 }, (_, index) => ({
      taskId: `phase-${index + 1}`,
      title: `Phase ${index + 1}`,
      priority: 'P1',
      status: 'pending',
      totalSubtasks: 0,
      completedSubtasks: 0,
      estimatedHours: 0,
      completedAt: null,
      order: index + 1,
    })));
    const getDevPlan = jest.fn(() => ({
      listMainTasks,
    }) as any);

    const result = await handleTaskToolCall(
      'devplan_list_tasks',
      { projectName: 'demo' },
      { getDevPlan }
    );
    const parsed = JSON.parse(result!);

    expect(listMainTasks).toHaveBeenCalledWith({
      status: undefined,
      priority: undefined,
      moduleId: undefined,
    });
    expect(parsed).toMatchObject({
      projectName: 'demo',
      count: 10,
      total: 12,
      latestTaskId: 'phase-12',
      sort: 'desc',
      offset: 0,
      limit: 10,
      hasMore: true,
    });
    expect(parsed.mainTasks[0].taskId).toBe('phase-12');
    expect(parsed.mainTasks[9].taskId).toBe('phase-3');
  });
});
