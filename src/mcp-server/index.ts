#!/usr/bin/env node
/**
 * aifastdb-devplan MCP Server
 *
 * 通用开发计划管理 MCP Server，使用 aifastdb 作为存储引擎。
 *
 * Tools (DevPlan — 通用开发计划管理):
 * - devplan_init: Initialize a dev plan for a project
 * - devplan_save_section: Save/update a document section
 * - devplan_get_section: Read a document section
 * - devplan_list_sections: List all document sections
 * - devplan_create_main_task: Create a main task (development phase)
 * - devplan_add_sub_task: Add a sub task under a main task
 * - devplan_upsert_task: Idempotent import (upsert) main/sub tasks — prevents duplicates
 * - devplan_complete_task: Complete a task (auto-updates progress, anchors Git commit)
 * - devplan_list_tasks: List tasks with optional filters
 * - devplan_get_progress: Get project progress overview
 * - devplan_export_markdown: Export plan as Markdown
 * - devplan_sync_git: Sync task statuses with Git history (revert rolled-back tasks)
 * - devplan_create_module: Create/register a feature module
 * - devplan_list_modules: List all feature modules
 * - devplan_get_module: Get module details with associated tasks and docs
 * - devplan_update_module: Update module info
 */

// @ts-ignore - MCP SDK types will be available after npm install
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
// @ts-ignore - MCP SDK types will be available after npm install
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// @ts-ignore - MCP SDK types will be available after npm install
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import {
  DevPlanStore,
  createDevPlan,
  listDevPlans,
  ALL_SECTIONS,
  SECTION_DESCRIPTIONS,
  type DevPlanSection,
  type TaskStatus,
  type TaskPriority,
} from '../dev-plan-store';

// ============================================================================
// DevPlan Store Cache
// ============================================================================

const devPlanCache = new Map<string, DevPlanStore>();

function getDevPlan(projectName: string): DevPlanStore {
  if (!devPlanCache.has(projectName)) {
    devPlanCache.set(projectName, createDevPlan(projectName));
  }
  return devPlanCache.get(projectName)!;
}

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS = [
  {
    name: 'devplan_init',
    description: 'Initialize a development plan for a project. Creates an empty plan structure. Also lists existing plans if no projectName is given.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name (e.g., "federation-db", "aidb-viewer"). Omit to list existing plans.',
        },
      },
    },
  },
  {
    name: 'devplan_save_section',
    description: 'Save or update a document section in the dev plan. Sections are typed: overview, core_concepts, api_design, file_structure, config, examples, technical_notes, api_endpoints, milestones, changelog, custom. technical_notes and custom support subSection for multiple sub-documents.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        section: {
          type: 'string',
          enum: ['overview', 'core_concepts', 'api_design', 'file_structure', 'config', 'examples', 'technical_notes', 'api_endpoints', 'milestones', 'changelog', 'custom'],
          description: 'Document section type',
        },
        title: {
          type: 'string',
          description: 'Section title (e.g., "概述 - 背景与目标")',
        },
        content: {
          type: 'string',
          description: 'Markdown content for this section',
        },
        version: {
          type: 'string',
          description: 'Optional version string (default: "1.0.0")',
        },
        subSection: {
          type: 'string',
          description: 'Optional sub-section name for technical_notes/custom (e.g., "security", "resilience")',
        },
        moduleId: {
          type: 'string',
          description: 'Optional: Associate with a feature module',
        },
      },
      required: ['projectName', 'section', 'title', 'content'],
    },
  },
  {
    name: 'devplan_get_section',
    description: 'Read a specific document section from the dev plan.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        section: {
          type: 'string',
          enum: ['overview', 'core_concepts', 'api_design', 'file_structure', 'config', 'examples', 'technical_notes', 'api_endpoints', 'milestones', 'changelog', 'custom'],
          description: 'Document section type',
        },
        subSection: {
          type: 'string',
          description: 'Optional sub-section name',
        },
      },
      required: ['projectName', 'section'],
    },
  },
  {
    name: 'devplan_list_sections',
    description: 'List all document sections in the dev plan for a project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_create_main_task',
    description: 'Create a main task (development phase) in the dev plan. A main task groups multiple sub-tasks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        taskId: {
          type: 'string',
          description: 'Main task ID (e.g., "phase-7", "phase-14B")',
        },
        title: {
          type: 'string',
          description: 'Task title (e.g., "阶段七：Store Trait 与适配器")',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
          description: 'Priority level',
        },
        description: {
          type: 'string',
          description: 'Optional task description',
        },
        estimatedHours: {
          type: 'number',
          description: 'Optional estimated hours',
        },
        moduleId: {
          type: 'string',
          description: 'Optional: Associate with a feature module',
        },
      },
      required: ['projectName', 'taskId', 'title', 'priority'],
    },
  },
  {
    name: 'devplan_add_sub_task',
    description: 'Add a sub-task under a main task. Sub-tasks correspond to Cursor TodoList items.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        taskId: {
          type: 'string',
          description: 'Sub-task ID (e.g., "T7.2", "T14.8")',
        },
        parentTaskId: {
          type: 'string',
          description: 'Parent main task ID (e.g., "phase-7")',
        },
        title: {
          type: 'string',
          description: 'Sub-task title',
        },
        estimatedHours: {
          type: 'number',
          description: 'Optional estimated hours',
        },
        description: {
          type: 'string',
          description: 'Optional task description',
        },
      },
      required: ['projectName', 'taskId', 'parentTaskId', 'title'],
    },
  },
  {
    name: 'devplan_upsert_task',
    description: 'Idempotent import (upsert) for main tasks or sub-tasks. If the task does not exist, it will be created. If it already exists, it will be updated with the new data while preserving the higher-priority status (e.g., completed tasks will not be reverted to pending). This is the recommended tool for bulk data import to prevent duplicates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        taskType: {
          type: 'string',
          enum: ['main', 'sub'],
          description: 'Whether this is a main task or sub-task',
        },
        taskId: {
          type: 'string',
          description: 'Task ID (e.g., "phase-7" for main, "T7.2" for sub)',
        },
        title: {
          type: 'string',
          description: 'Task title',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
          description: 'Priority level (required for main tasks)',
        },
        parentTaskId: {
          type: 'string',
          description: 'Parent main task ID (required for sub-tasks)',
        },
        description: {
          type: 'string',
          description: 'Optional task description',
        },
        estimatedHours: {
          type: 'number',
          description: 'Optional estimated hours',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description: 'Target status (default: pending). Higher-priority existing status is preserved unless preserveStatus is false.',
        },
        preserveStatus: {
          type: 'boolean',
          description: 'If true (default), existing higher-priority status is preserved. Set to false to force overwrite.',
        },
        moduleId: {
          type: 'string',
          description: 'Optional: Associate with a feature module (main tasks only)',
        },
      },
      required: ['projectName', 'taskType', 'taskId', 'title'],
    },
  },
  {
    name: 'devplan_complete_task',
    description: 'Mark a task as completed. For sub-tasks: auto-updates parent main task progress count and completedAt timestamp. If all sub-tasks are done, the main task is also auto-completed. For main tasks: directly marks as completed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        taskId: {
          type: 'string',
          description: 'Task ID (sub-task like "T7.2" or main task like "phase-7")',
        },
        taskType: {
          type: 'string',
          enum: ['sub', 'main'],
          description: 'Whether this is a sub-task or main task (default: "sub")',
        },
      },
      required: ['projectName', 'taskId'],
    },
  },
  {
    name: 'devplan_list_tasks',
    description: 'List tasks in the dev plan. Can list main tasks, or sub-tasks of a specific main task. When parentTaskId is omitted but status is provided, aggregates sub-tasks across ALL main tasks matching the status filter.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        parentTaskId: {
          type: 'string',
          description: 'Optional: List sub-tasks of this main task ID. If omitted, lists main tasks.',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description: 'Optional: Filter by status',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
          description: 'Optional: Filter by priority (main tasks only)',
        },
        moduleId: {
          type: 'string',
          description: 'Optional: Filter by feature module ID',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_get_progress',
    description: 'Get overall project progress: section count, main task count, sub-task completion rates, per-phase progress bars.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_export_markdown',
    description: 'Export the dev plan as a Markdown document. Scope can be "full" (documents + tasks) or "tasks" (task summary only).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        scope: {
          type: 'string',
          enum: ['full', 'tasks'],
          description: 'Export scope: "full" for documents + tasks, "tasks" for task summary only (default: "tasks")',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_sync_git',
    description: 'Synchronize DevPlan task statuses with Git history. Checks if completed tasks\' commits are still ancestors of the current HEAD. If a completed task\'s commit was rolled back (e.g., via git reset), the task is automatically reverted to pending. Use dryRun=true to preview changes without modifying data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, only report which tasks would be reverted without actually changing them (default: false)',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_create_module',
    description: 'Create/register a feature module in the dev plan. Modules represent independent functional areas of the project (e.g., "vector-store", "permission-system"). Main tasks and documents can be associated with modules.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        moduleId: {
          type: 'string',
          description: 'Module identifier (e.g., "vector-store", "permission")',
        },
        name: {
          type: 'string',
          description: 'Module display name (e.g., "向量存储模块")',
        },
        description: {
          type: 'string',
          description: 'Optional module description',
        },
        status: {
          type: 'string',
          enum: ['planning', 'active', 'completed', 'deprecated'],
          description: 'Module status (default: active)',
        },
      },
      required: ['projectName', 'moduleId', 'name'],
    },
  },
  {
    name: 'devplan_list_modules',
    description: 'List all feature modules in the dev plan, with main task count, sub-task count (total and completed), and document counts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        status: {
          type: 'string',
          enum: ['planning', 'active', 'completed', 'deprecated'],
          description: 'Optional: Filter by module status',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_get_module',
    description: 'Get module details including all associated main tasks, sub-tasks, and documents.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        moduleId: {
          type: 'string',
          description: 'Module identifier',
        },
      },
      required: ['projectName', 'moduleId'],
    },
  },
  {
    name: 'devplan_update_module',
    description: 'Update module information (name, description, status).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name',
        },
        moduleId: {
          type: 'string',
          description: 'Module identifier',
        },
        name: {
          type: 'string',
          description: 'New module name',
        },
        description: {
          type: 'string',
          description: 'New module description',
        },
        status: {
          type: 'string',
          enum: ['planning', 'active', 'completed', 'deprecated'],
          description: 'New module status',
        },
      },
      required: ['projectName', 'moduleId'],
    },
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

interface ToolArgs {
  projectName?: string;
  // DevPlan-specific args
  section?: string;
  title?: string;
  content?: string;
  subSection?: string;
  version?: string;
  priority?: string;
  description?: string;
  estimatedHours?: number;
  parentTaskId?: string;
  taskId?: string;
  taskType?: string;
  status?: string;
  scope?: string;
  /** devplan_sync_git: 是否仅预览不实际修改 */
  dryRun?: boolean;
  /** devplan_upsert_task: 是否保留已有更高级状态 */
  preserveStatus?: boolean;
  /** 功能模块 ID */
  moduleId?: string;
  /** 功能模块名称 */
  name?: string;
}

async function handleToolCall(name: string, args: ToolArgs): Promise<string> {
  switch (name) {
    case 'devplan_init': {
      if (!args.projectName) {
        // List existing plans
        const plans = listDevPlans();
        return JSON.stringify({
          existingPlans: plans,
          availableSections: ALL_SECTIONS,
          sectionDescriptions: SECTION_DESCRIPTIONS,
          message: plans.length > 0
            ? `Found ${plans.length} existing plan(s). Provide a projectName to initialize a new one.`
            : 'No existing plans. Provide a projectName to create one.',
        });
      }

      const plan = getDevPlan(args.projectName);
      return JSON.stringify({
        success: true,
        projectName: args.projectName,
        availableSections: ALL_SECTIONS,
        sectionDescriptions: SECTION_DESCRIPTIONS,
        message: `DevPlan initialized for "${args.projectName}". Use devplan_save_section to add document sections and devplan_create_main_task to add development phases.`,
      });
    }

    case 'devplan_save_section': {
      if (!args.projectName || !args.section || !args.title || !args.content) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, section, title, content');
      }

      const plan = getDevPlan(args.projectName);
      const id = plan.saveSection({
        projectName: args.projectName,
        section: args.section as DevPlanSection,
        title: args.title,
        content: args.content,
        version: args.version,
        subSection: args.subSection,
        moduleId: args.moduleId,
      });

      return JSON.stringify({
        success: true,
        documentId: id,
        projectName: args.projectName,
        section: args.section,
        subSection: args.subSection || null,
        title: args.title,
      });
    }

    case 'devplan_get_section': {
      if (!args.projectName || !args.section) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, section');
      }

      const plan = getDevPlan(args.projectName);
      const doc = plan.getSection(args.section as DevPlanSection, args.subSection);

      if (!doc) {
        return JSON.stringify({
          found: false,
          message: `Section "${args.section}"${args.subSection ? ` (${args.subSection})` : ''} not found for project "${args.projectName}"`,
        });
      }

      return JSON.stringify({
        found: true,
        document: doc,
      });
    }

    case 'devplan_list_sections': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const sections = plan.listSections();

      return JSON.stringify({
        projectName: args.projectName,
        count: sections.length,
        sections: sections.map(s => ({
          id: s.id,
          section: s.section,
          subSection: s.subSection || null,
          title: s.title,
          version: s.version,
          contentPreview: s.content.slice(0, 200) + (s.content.length > 200 ? '...' : ''),
          updatedAt: s.updatedAt,
        })),
      });
    }

    case 'devplan_create_main_task': {
      if (!args.projectName || !args.taskId || !args.title || !args.priority) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, taskId, title, priority');
      }

      const plan = getDevPlan(args.projectName);
      try {
        const mainTask = plan.createMainTask({
          projectName: args.projectName,
          taskId: args.taskId,
          title: args.title,
          priority: args.priority as TaskPriority,
          description: args.description,
          estimatedHours: args.estimatedHours,
          moduleId: args.moduleId,
        });

        return JSON.stringify({
          success: true,
          mainTask: {
            id: mainTask.id,
            taskId: mainTask.taskId,
            title: mainTask.title,
            priority: mainTask.priority,
            status: mainTask.status,
          },
        });
      } catch (err) {
        throw new McpError(ErrorCode.InvalidParams,
          err instanceof Error ? err.message : String(err));
      }
    }

    case 'devplan_add_sub_task': {
      if (!args.projectName || !args.taskId || !args.parentTaskId || !args.title) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, taskId, parentTaskId, title');
      }

      const plan = getDevPlan(args.projectName);
      try {
        const subTask = plan.addSubTask({
          projectName: args.projectName,
          taskId: args.taskId,
          parentTaskId: args.parentTaskId,
          title: args.title,
          estimatedHours: args.estimatedHours,
          description: args.description,
        });

        return JSON.stringify({
          success: true,
          subTask: {
            id: subTask.id,
            taskId: subTask.taskId,
            parentTaskId: subTask.parentTaskId,
            title: subTask.title,
            status: subTask.status,
          },
        });
      } catch (err) {
        throw new McpError(ErrorCode.InvalidParams,
          err instanceof Error ? err.message : String(err));
      }
    }

    case 'devplan_upsert_task': {
      if (!args.projectName || !args.taskType || !args.taskId || !args.title) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, taskType, taskId, title');
      }

      const plan = getDevPlan(args.projectName);
      const upsertTaskType = args.taskType;
      const targetStatus = (args.status as TaskStatus) || 'pending';
      const preserveStatus = args.preserveStatus !== false; // 默认 true

      try {
        if (upsertTaskType === 'main') {
          if (!args.priority) {
            throw new McpError(ErrorCode.InvalidParams, 'Missing required for main task: priority');
          }
          const mainTask = plan.upsertMainTask(
            {
              projectName: args.projectName,
              taskId: args.taskId,
              title: args.title,
              priority: args.priority as TaskPriority,
              description: args.description,
              estimatedHours: args.estimatedHours,
              moduleId: args.moduleId,
            },
            { preserveStatus, status: targetStatus }
          );
          return JSON.stringify({
            success: true,
            taskType: 'main',
            mainTask: {
              id: mainTask.id,
              taskId: mainTask.taskId,
              title: mainTask.title,
              priority: mainTask.priority,
              status: mainTask.status,
              updatedAt: mainTask.updatedAt,
            },
          });
        } else {
          if (!args.parentTaskId) {
            throw new McpError(ErrorCode.InvalidParams, 'Missing required for sub-task: parentTaskId');
          }
          const subTask = plan.upsertSubTask(
            {
              projectName: args.projectName,
              taskId: args.taskId,
              parentTaskId: args.parentTaskId,
              title: args.title,
              estimatedHours: args.estimatedHours,
              description: args.description,
            },
            { preserveStatus, status: targetStatus }
          );
          return JSON.stringify({
            success: true,
            taskType: 'sub',
            subTask: {
              id: subTask.id,
              taskId: subTask.taskId,
              parentTaskId: subTask.parentTaskId,
              title: subTask.title,
              status: subTask.status,
              updatedAt: subTask.updatedAt,
            },
          });
        }
      } catch (err) {
        throw new McpError(ErrorCode.InvalidParams,
          err instanceof Error ? err.message : String(err));
      }
    }

    case 'devplan_complete_task': {
      if (!args.projectName || !args.taskId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, taskId');
      }

      const plan = getDevPlan(args.projectName);
      const taskType = args.taskType || 'sub';

      try {
        if (taskType === 'main') {
          const mainTask = plan.completeMainTask(args.taskId);
          return JSON.stringify({
            success: true,
            taskType: 'main',
            mainTask: {
              taskId: mainTask.taskId,
              title: mainTask.title,
              status: mainTask.status,
              completedAt: mainTask.completedAt,
              totalSubtasks: mainTask.totalSubtasks,
              completedSubtasks: mainTask.completedSubtasks,
            },
          });
        } else {
          const result = plan.completeSubTask(args.taskId);
          return JSON.stringify({
            success: true,
            taskType: 'sub',
            subTask: {
              taskId: result.subTask.taskId,
              title: result.subTask.title,
              status: result.subTask.status,
              completedAt: result.subTask.completedAt,
              completedAtCommit: result.completedAtCommit || null,
            },
            mainTask: {
              taskId: result.mainTask.taskId,
              title: result.mainTask.title,
              status: result.mainTask.status,
              totalSubtasks: result.mainTask.totalSubtasks,
              completedSubtasks: result.mainTask.completedSubtasks,
            },
            mainTaskCompleted: result.mainTaskCompleted,
            completedAtCommit: result.completedAtCommit || null,
          });
        }
      } catch (err) {
        throw new McpError(ErrorCode.InvalidParams,
          err instanceof Error ? err.message : String(err));
      }
    }

    case 'devplan_list_tasks': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);

      if (args.parentTaskId) {
        // Mode 1: List sub-tasks of a specific main task
        const subTasks = plan.listSubTasks(args.parentTaskId, {
          status: args.status as TaskStatus | undefined,
        });
        return JSON.stringify({
          projectName: args.projectName,
          parentTaskId: args.parentTaskId,
          count: subTasks.length,
          subTasks: subTasks.map(st => ({
            taskId: st.taskId,
            title: st.title,
            status: st.status,
            estimatedHours: st.estimatedHours,
            completedAt: st.completedAt,
          })),
        });
      } else if (args.status && !args.priority && !args.moduleId) {
        // Mode 2: Aggregate sub-tasks across ALL main tasks matching the status filter
        const mainTasks = plan.listMainTasks();
        const allSubTasks: Array<{
          taskId: string;
          title: string;
          status: string;
          estimatedHours?: number;
          completedAt?: number | null;
          parentTaskId: string;
          parentTitle: string;
        }> = [];
        for (const mt of mainTasks) {
          const subs = plan.listSubTasks(mt.taskId, {
            status: args.status as TaskStatus | undefined,
          });
          for (const sub of subs) {
            allSubTasks.push({
              taskId: sub.taskId,
              title: sub.title,
              status: sub.status,
              estimatedHours: sub.estimatedHours,
              completedAt: sub.completedAt,
              parentTaskId: mt.taskId,
              parentTitle: mt.title,
            });
          }
        }
        return JSON.stringify({
          projectName: args.projectName,
          status: args.status,
          count: allSubTasks.length,
          subTasks: allSubTasks,
        });
      } else {
        // Mode 3: List main tasks (supports moduleId filter)
        const mainTasks = plan.listMainTasks({
          status: args.status as TaskStatus | undefined,
          priority: args.priority as TaskPriority | undefined,
          moduleId: args.moduleId,
        });
        return JSON.stringify({
          projectName: args.projectName,
          count: mainTasks.length,
          mainTasks: mainTasks.map(mt => ({
            taskId: mt.taskId,
            title: mt.title,
            priority: mt.priority,
            status: mt.status,
            totalSubtasks: mt.totalSubtasks,
            completedSubtasks: mt.completedSubtasks,
            estimatedHours: mt.estimatedHours,
            completedAt: mt.completedAt,
          })),
        });
      }
    }

    case 'devplan_get_progress': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const progress = plan.getProgress();

      return JSON.stringify(progress);
    }

    case 'devplan_export_markdown': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const scope = args.scope || 'tasks';
      const markdown = scope === 'full'
        ? plan.exportToMarkdown()
        : plan.exportTaskSummary();

      return JSON.stringify({
        projectName: args.projectName,
        scope,
        markdown,
      });
    }

    case 'devplan_sync_git': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const dryRun = args.dryRun ?? false;

      try {
        const result = plan.syncWithGit(dryRun);

        return JSON.stringify({
          success: true,
          dryRun,
          ...result,
          summary: result.error
            ? `⚠️ ${result.error}`
            : result.reverted.length === 0
              ? `✅ All ${result.checked} completed tasks are consistent with Git HEAD (${result.currentHead})`
              : dryRun
                ? `⚠️ ${result.reverted.length} of ${result.checked} tasks would be reverted (dry run, no changes made)`
                : `🔄 ${result.reverted.length} of ${result.checked} tasks reverted to pending due to Git rollback`,
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }

    case 'devplan_create_module': {
      if (!args.projectName || !args.moduleId || !args.name) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, moduleId, name');
      }

      const plan = getDevPlan(args.projectName);
      try {
        const mod = plan.createModule({
          projectName: args.projectName,
          moduleId: args.moduleId,
          name: args.name,
          description: args.description,
          status: args.status as any,
        });
        return JSON.stringify({ success: true, module: mod });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }

    case 'devplan_list_modules': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const modules = plan.listModules({
        status: args.status as any,
      });
      return JSON.stringify({
        projectName: args.projectName,
        count: modules.length,
        modules: modules.map(m => ({
          moduleId: m.moduleId,
          name: m.name,
          description: m.description,
          status: m.status,
          mainTaskCount: m.mainTaskCount,
          subTaskCount: m.subTaskCount,
          completedSubTaskCount: m.completedSubTaskCount,
          docCount: m.docCount,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        })),
      });
    }

    case 'devplan_get_module': {
      if (!args.projectName || !args.moduleId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, moduleId');
      }

      const plan = getDevPlan(args.projectName);
      const detail = plan.getModuleDetail(args.moduleId);
      if (!detail) {
        return JSON.stringify({ error: `Module "${args.moduleId}" not found` });
      }

      return JSON.stringify({
        projectName: args.projectName,
        module: {
          moduleId: detail.module.moduleId,
          name: detail.module.name,
          description: detail.module.description,
          status: detail.module.status,
          mainTaskCount: detail.module.mainTaskCount,
          subTaskCount: detail.module.subTaskCount,
          completedSubTaskCount: detail.module.completedSubTaskCount,
          docCount: detail.module.docCount,
        },
        mainTasks: detail.mainTasks.map(mt => ({
          taskId: mt.taskId,
          title: mt.title,
          priority: mt.priority,
          status: mt.status,
          totalSubtasks: mt.totalSubtasks,
          completedSubtasks: mt.completedSubtasks,
        })),
        subTasks: detail.subTasks.map(st => ({
          taskId: st.taskId,
          title: st.title,
          status: st.status,
          parentTaskId: st.parentTaskId,
        })),
        documents: detail.documents.map(doc => ({
          section: doc.section,
          subSection: doc.subSection,
          title: doc.title,
        })),
      });
    }

    case 'devplan_update_module': {
      if (!args.projectName || !args.moduleId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, moduleId');
      }

      const plan = getDevPlan(args.projectName);
      const updated = plan.updateModule(args.moduleId, {
        name: args.name,
        description: args.description,
        status: args.status as any,
      });

      if (!updated) {
        return JSON.stringify({ error: `Module "${args.moduleId}" not found` });
      }

      return JSON.stringify({ success: true, module: updated });
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

// ============================================================================
// Server Setup
// ============================================================================

async function main() {
  const server = new Server(
    {
      name: 'aifastdb-devplan',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(name, args as ToolArgs);
      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('aifastdb-devplan MCP Server started');
}

// Run
main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
