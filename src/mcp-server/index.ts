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
 * - devplan_start_visual: Start the graph visualization HTTP server
 * - devplan_auto_status: Query autopilot execution status
 * - devplan_auto_next: Intelligently recommend the next autopilot action
 * - devplan_auto_config: Get or update autopilot configuration
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

import * as fs from 'fs';
import * as path from 'path';
import {
  createDevPlan,
  listDevPlans,
  getProjectEngine,
  DEFAULT_PROJECT_NAME,
  readDevPlanConfig,
  writeDevPlanConfig,
  resolveProjectName as factoryResolveProjectName,
  resolveBasePathForProject,
  getDefaultBasePath,
  type DevPlanEngine,
} from '../dev-plan-factory';
import { migrateEngine } from '../dev-plan-migrate';
import type { IDevPlanStore } from '../dev-plan-interface';
import {
  ALL_SECTIONS,
  SECTION_DESCRIPTIONS,
  type DevPlanSection,
  type TaskStatus,
  type TaskPriority,
  type SearchMode,
  type AutopilotConfig,
} from '../types';
import {
  getAutopilotStatus,
  getAutopilotNextAction,
  getAutopilotConfig,
  updateAutopilotConfig,
  getLastHeartbeat,
} from '../autopilot';

// ============================================================================
// DevPlan Store Cache
// ============================================================================

const devPlanCache = new Map<string, IDevPlanStore>();

function getDevPlan(projectName: string, engine?: DevPlanEngine): IDevPlanStore {
  const cacheKey = projectName;
  if (engine) {
    // 显式指定引擎时，清除缓存以使用新引擎
    devPlanCache.delete(cacheKey);
    const plan = createDevPlan(projectName, undefined, engine);
    devPlanCache.set(cacheKey, plan);
    return plan;
  }
  if (!devPlanCache.has(cacheKey)) {
    devPlanCache.set(cacheKey, createDevPlan(projectName));
  }
  return devPlanCache.get(cacheKey)!;
}

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS = [
  {
    name: 'devplan_init',
    description: 'Initialize a development plan for a project. Creates an empty plan structure. Also lists existing plans if no projectName is given. Auto-generates .cursor/rules/dev-plan-management.mdc template if not present.\n初始化项目的开发计划。创建空的计划结构。如果不提供 projectName 则列出已有的计划。自动生成 .cursor/rules/ 模板文件（仅首次）。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name. Omit to list existing plans. Default: "${DEFAULT_PROJECT_NAME}"\n项目名称。省略则列出已有计划。默认值："${DEFAULT_PROJECT_NAME}"`,
        },
      },
    },
  },
  {
    name: 'devplan_save_section',
    description: 'Save or update a document section in the dev plan. Sections are typed: overview, core_concepts, api_design, file_structure, config, examples, technical_notes, api_endpoints, milestones, changelog, custom. technical_notes and custom support subSection for multiple sub-documents.\n保存或更新开发计划中的文档片段。支持 11 种标准类型。technical_notes 和 custom 支持通过 subSection 存储多个子文档。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        section: {
          type: 'string',
          enum: ['overview', 'core_concepts', 'api_design', 'file_structure', 'config', 'examples', 'technical_notes', 'api_endpoints', 'milestones', 'changelog', 'custom'],
          description: 'Document section type\n文档片段类型',
        },
        title: {
          type: 'string',
          description: 'Section title (e.g., "Overview - Background")\n片段标题（如 "概述 - 背景与目标"）',
        },
        content: {
          type: 'string',
          description: 'Markdown content for this section\n该片段的 Markdown 内容',
        },
        version: {
          type: 'string',
          description: 'Optional version string (default: "1.0.0")\n可选版本号（默认 "1.0.0"）',
        },
        subSection: {
          type: 'string',
          description: 'Optional sub-section name for technical_notes/custom (e.g., "security", "resilience")\n可选子片段名称，用于 technical_notes/custom（如 "security"）',
        },
        moduleId: {
          type: 'string',
          description: 'Optional: Associate with a feature module\n可选：关联到功能模块',
        },
        relatedTaskIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: Associate with main tasks by taskId (e.g., ["phase-1", "phase-2"])\n可选：通过 taskId 关联主任务',
        },
        parentDoc: {
          type: 'string',
          description: 'Optional: Parent document identifier (format: "section" or "section|subSection", e.g., "overview", "technical_notes|security"). Establishes document hierarchy.\n可选：父文档标识（格式："section" 或 "section|subSection"）。建立文档层级关系。',
        },
      },
      required: ['projectName', 'section', 'title', 'content'],
    },
  },
  {
    name: 'devplan_get_section',
    description: 'Read a specific document section from the dev plan.\n读取开发计划中的指定文档片段。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        section: {
          type: 'string',
          enum: ['overview', 'core_concepts', 'api_design', 'file_structure', 'config', 'examples', 'technical_notes', 'api_endpoints', 'milestones', 'changelog', 'custom'],
          description: 'Document section type\n文档片段类型',
        },
        subSection: {
          type: 'string',
          description: 'Optional sub-section name\n可选子片段名称',
        },
      },
      required: ['projectName', 'section'],
    },
  },
  {
    name: 'devplan_list_sections',
    description: 'List all document sections in the dev plan for a project.\n列出项目开发计划中的所有文档片段。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_create_main_task',
    description: 'Create a main task (development phase) in the dev plan. A main task groups multiple sub-tasks.\n在开发计划中创建主任务（开发阶段）。一个主任务下包含多个子任务。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        taskId: {
          type: 'string',
          description: 'Main task ID (e.g., "phase-7", "phase-14B")\n主任务 ID（如 "phase-7"）',
        },
        title: {
          type: 'string',
          description: 'Task title (e.g., "Phase 7: Store Trait & Adapters")\n任务标题（如 "阶段七：Store Trait 与适配器"）',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
          description: 'Priority level\n优先级',
        },
        description: {
          type: 'string',
          description: 'Optional task description\n可选任务描述',
        },
        estimatedHours: {
          type: 'number',
          description: 'Optional estimated hours\n可选预估工时',
        },
        moduleId: {
          type: 'string',
          description: 'Optional: Associate with a feature module\n可选：关联到功能模块',
        },
        relatedDocSections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: Associate with document sections (format: "section" or "section|subSection", e.g., ["overview", "technical_notes|security"])\n可选：关联文档片段（格式："section" 或 "section|subSection"）',
        },
        relatedPromptIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: Associate with prompt IDs (entity IDs from devplan_save_prompt)\n可选：关联 Prompt ID 列表（来自 devplan_save_prompt 的实体 ID）',
        },
        order: {
          type: 'number',
          description: 'Optional sort order (smaller number = higher priority). Auto-assigned if omitted.\n可选排序序号（数值越小越靠前）。不填则自动追加到末尾。',
        },
      },
      required: ['projectName', 'taskId', 'title', 'priority'],
    },
  },
  {
    name: 'devplan_add_sub_task',
    description: 'Add a sub-task under a main task. Sub-tasks correspond to Cursor TodoList items.\n在主任务下添加子任务。子任务对应 Cursor 的 TodoList 条目。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        taskId: {
          type: 'string',
          description: 'Sub-task ID (e.g., "T7.2", "T14.8")\n子任务 ID（如 "T7.2"）',
        },
        parentTaskId: {
          type: 'string',
          description: 'Parent main task ID (e.g., "phase-7")\n所属主任务 ID（如 "phase-7"）',
        },
        title: {
          type: 'string',
          description: 'Sub-task title\n子任务标题',
        },
        estimatedHours: {
          type: 'number',
          description: 'Optional estimated hours\n可选预估工时',
        },
        description: {
          type: 'string',
          description: 'Optional task description\n可选任务描述',
        },
        order: {
          type: 'number',
          description: 'Optional sort order (smaller number = higher priority). Auto-assigned if omitted.\n可选排序序号（数值越小越靠前）。不填则自动追加到末尾。',
        },
      },
      required: ['projectName', 'taskId', 'parentTaskId', 'title'],
    },
  },
  {
    name: 'devplan_upsert_task',
    description: 'Idempotent import (upsert) for main tasks or sub-tasks. If the task does not exist, it will be created. If it already exists, it will be updated with the new data while preserving the higher-priority status (e.g., completed tasks will not be reverted to pending). This is the recommended tool for bulk data import to prevent duplicates.\n幂等导入（upsert）主任务或子任务。任务不存在则创建，已存在则更新（保留更高优先级的状态，如已完成的任务不会被回退为待处理）。推荐用于批量数据导入以防重复。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        taskType: {
          type: 'string',
          enum: ['main', 'sub'],
          description: 'Whether this is a main task or sub-task\n任务类型：主任务 (main) 或子任务 (sub)',
        },
        taskId: {
          type: 'string',
          description: 'Task ID (e.g., "phase-7" for main, "T7.2" for sub)\n任务 ID（主任务如 "phase-7"，子任务如 "T7.2"）',
        },
        title: {
          type: 'string',
          description: 'Task title\n任务标题',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
          description: 'Priority level (required for main tasks)\n优先级（主任务必填）',
        },
        parentTaskId: {
          type: 'string',
          description: 'Parent main task ID (required for sub-tasks)\n所属主任务 ID（子任务必填）',
        },
        description: {
          type: 'string',
          description: 'Optional task description\n可选任务描述',
        },
        estimatedHours: {
          type: 'number',
          description: 'Optional estimated hours\n可选预估工时',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description: 'Target status (default: pending). Higher-priority existing status is preserved unless preserveStatus is false.\n目标状态（默认 pending）。已有的更高优先级状态会被保留，除非 preserveStatus 为 false。',
        },
        preserveStatus: {
          type: 'boolean',
          description: 'If true (default), existing higher-priority status is preserved. Set to false to force overwrite.\n为 true（默认）时保留已有的更高优先级状态。设为 false 强制覆盖。',
        },
        moduleId: {
          type: 'string',
          description: 'Optional: Associate with a feature module (main tasks only)\n可选：关联到功能模块（仅主任务）',
        },
        relatedDocSections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: Associate with document sections (main tasks only, format: "section" or "section|subSection")\n可选：关联文档片段（仅主任务，格式："section" 或 "section|subSection"）',
        },
        order: {
          type: 'number',
          description: 'Optional sort order (smaller number = higher priority). Auto-assigned if omitted.\n可选排序序号（数值越小越靠前）。不填则自动追加到末尾。',
        },
      },
      required: ['projectName', 'taskType', 'taskId', 'title'],
    },
  },
  {
    name: 'devplan_complete_task',
    description: 'Mark a task as completed. For sub-tasks: auto-updates parent main task progress count and completedAt timestamp. If all sub-tasks are done, the main task is also auto-completed. For main tasks: directly marks as completed.\n将任务标记为已完成。子任务完成时自动更新主任务的进度计数和完成时间戳。当所有子任务完成时，主任务也会自动标记为完成。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        taskId: {
          type: 'string',
          description: 'Task ID (sub-task like "T7.2" or main task like "phase-7")\n任务 ID（子任务如 "T7.2"，主任务如 "phase-7"）',
        },
        taskType: {
          type: 'string',
          enum: ['sub', 'main'],
          description: 'Whether this is a sub-task or main task (default: "sub")\n任务类型：子任务 (sub) 或主任务 (main)，默认 "sub"',
        },
      },
      required: ['projectName', 'taskId'],
    },
  },
  {
    name: 'devplan_list_tasks',
    description: 'List tasks in the dev plan. Can list main tasks, or sub-tasks of a specific main task. When parentTaskId is omitted but status is provided, aggregates sub-tasks across ALL main tasks matching the status filter.\n列出开发计划中的任务。可列出主任务，或指定主任务下的子任务。省略 parentTaskId 但提供 status 时，跨所有主任务聚合匹配状态的子任务。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        parentTaskId: {
          type: 'string',
          description: 'Optional: List sub-tasks of this main task ID. If omitted, lists main tasks.\n可选：指定主任务 ID 以列出其子任务。省略则列出主任务。',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description: 'Optional: Filter by status\n可选：按状态筛选',
        },
        priority: {
          type: 'string',
          enum: ['P0', 'P1', 'P2'],
          description: 'Optional: Filter by priority (main tasks only)\n可选：按优先级筛选（仅主任务）',
        },
        moduleId: {
          type: 'string',
          description: 'Optional: Filter by feature module ID\n可选：按功能模块 ID 筛选',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_get_progress',
    description: 'Get overall project progress: section count, main task count, sub-task completion rates, per-phase progress bars.\n获取项目整体进度概览：文档片段数、主任务数、子任务完成率、各阶段进度条。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_export_markdown',
    description: 'Export the dev plan as a Markdown document. Scope can be "full" (documents + tasks) or "tasks" (task summary only).\n将开发计划导出为 Markdown 文档。scope 可选 "full"（文档+任务）或 "tasks"（仅任务摘要）。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        scope: {
          type: 'string',
          enum: ['full', 'tasks'],
          description: 'Export scope: "full" for documents + tasks, "tasks" for task summary only (default: "tasks")\n导出范围："full" 包含文档和任务，"tasks" 仅任务摘要（默认 "tasks"）',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_sync_git',
    description: 'Synchronize DevPlan task statuses with Git history. Checks if completed tasks\' commits are still ancestors of the current HEAD. If a completed task\'s commit was rolled back (e.g., via git reset), the task is automatically reverted to pending. Use dryRun=true to preview changes without modifying data.\n将 DevPlan 任务状态与 Git 历史同步。检查已完成任务的 commit 是否仍是当前 HEAD 的祖先。如果已完成任务的 commit 被回滚（如 git reset），任务会自动回退为待处理。使用 dryRun=true 可预览变更而不修改数据。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, only report which tasks would be reverted without actually changing them (default: false)\n为 true 时仅报告哪些任务会被回退，不实际修改数据（默认 false）',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_create_module',
    description: 'Create/register a feature module in the dev plan. Modules represent independent functional areas of the project (e.g., "vector-store", "permission-system"). Main tasks and documents can be associated with modules.\n在开发计划中创建/注册功能模块。模块代表项目的独立功能区域（如 "vector-store"、"permission-system"）。主任务和文档可以关联到模块。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        moduleId: {
          type: 'string',
          description: 'Module identifier (e.g., "vector-store", "permission")\n模块标识符（如 "vector-store"、"permission"）',
        },
        name: {
          type: 'string',
          description: 'Module display name (e.g., "Vector Store Module")\n模块显示名称（如 "向量存储模块"）',
        },
        description: {
          type: 'string',
          description: 'Optional module description\n可选模块描述',
        },
        status: {
          type: 'string',
          enum: ['planning', 'active', 'completed', 'deprecated'],
          description: 'Module status (default: active)\n模块状态（默认 active）',
        },
      },
      required: ['projectName', 'moduleId', 'name'],
    },
  },
  {
    name: 'devplan_list_modules',
    description: 'List all feature modules in the dev plan, with main task count, sub-task count (total and completed), and document counts.\n列出开发计划中的所有功能模块，包含主任务数、子任务数（总数和已完成数）、文档数。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        status: {
          type: 'string',
          enum: ['planning', 'active', 'completed', 'deprecated'],
          description: 'Optional: Filter by module status\n可选：按模块状态筛选',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_get_module',
    description: 'Get module details including all associated main tasks, sub-tasks, and documents.\n获取模块详情，包含所有关联的主任务、子任务和文档。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        moduleId: {
          type: 'string',
          description: 'Module identifier\n模块标识符',
        },
      },
      required: ['projectName', 'moduleId'],
    },
  },
  {
    name: 'devplan_update_module',
    description: 'Update module information (name, description, status).\n更新模块信息（名称、描述、状态）。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        moduleId: {
          type: 'string',
          description: 'Module identifier\n模块标识符',
        },
        name: {
          type: 'string',
          description: 'New module name\n新的模块名称',
        },
        description: {
          type: 'string',
          description: 'New module description\n新的模块描述',
        },
        status: {
          type: 'string',
          enum: ['planning', 'active', 'completed', 'deprecated'],
          description: 'New module status\n新的模块状态',
        },
      },
      required: ['projectName', 'moduleId'],
    },
  },
  {
    name: 'devplan_export_graph',
    description: 'Export the DevPlan as a graph structure (nodes + edges) for visualization. Only available when the project uses the "graph" engine (SocialGraphV2). Returns { nodes, edges } compatible with vis-network.\n将 DevPlan 导出为图结构（节点+边）用于可视化。仅在项目使用 "graph" 引擎 (SocialGraphV2) 时可用。返回兼容 vis-network 的 { nodes, edges }。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        includeDocuments: {
          type: 'boolean',
          description: 'Whether to include document nodes (default: true)\n是否包含文档节点（默认 true）',
        },
        includeModules: {
          type: 'boolean',
          description: 'Whether to include module nodes (default: true)\n是否包含模块节点（默认 true）',
        },
        includeNodeDegree: {
          type: 'boolean',
          description: 'Whether to include node.degree from backend export (default: true)\n是否包含后端导出的 node.degree（默认 true）',
        },
        enableBackendDegreeFallback: {
          type: 'boolean',
          description: 'Whether backend should fallback to edge-count degree when native degree is missing (default: true)\n当原生 degree 缺失时，后端是否回退为基于边数计算（默认 true）',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_migrate_engine',
    description: 'Migrate project data between storage engines. Supports migration from "document" (EnhancedDocumentStore/JSONL) to "graph" (SocialGraphV2) or vice versa. Automatically backs up old data before migration. Use dryRun=true to preview without changes.\n在存储引擎之间迁移项目数据。支持从 "document"（EnhancedDocumentStore/JSONL）迁移到 "graph"（SocialGraphV2），或反向迁移。迁移前自动备份旧数据。使用 dryRun=true 可预览而不实际修改。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        targetEngine: {
          type: 'string',
          enum: ['graph', 'document'],
          description: 'Target engine to migrate to\n目标引擎类型',
        },
        backup: {
          type: 'boolean',
          description: 'Whether to backup old data before migration (default: true)\n是否在迁移前备份旧数据（默认 true）',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, only preview what would be migrated without making changes (default: false)\n为 true 时仅预览迁移内容，不实际修改（默认 false）',
        },
      },
      required: ['projectName', 'targetEngine'],
    },
  },
  {
    name: 'devplan_start_visual',
    description: 'Start the graph visualization HTTP server. Opens an interactive vis-network page in the browser to visualize modules, tasks, and their relationships as a graph. The server runs in the background. Only works with projects using the "graph" engine.\n启动图谱可视化 HTTP 服务器。在浏览器中打开交互式 vis-network 页面，将模块、任务及其关系以图谱形式可视化展示。服务器在后台运行。仅支持使用 "graph" 引擎的项目。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        port: {
          type: 'number',
          description: 'HTTP server port (default: 3210)\nHTTP 服务器端口（默认 3210）',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_start_phase',
    description: 'Start a development phase. Marks the main task as in_progress and returns the main task info along with all sub-tasks (with status). Output format is designed for direct Cursor TodoList creation.\n启动一个开发阶段。将主任务标记为 in_progress，返回主任务信息和全部子任务列表（含状态）。输出格式适合直接创建 Cursor TodoList。\n\n**IMPORTANT — Trigger phrases / 触发词识别**:\nWhen the user says ANY of the following patterns, this tool MUST be called FIRST before doing anything else:\n- "开始 phase-X" / "开始 phase-X 的任务" / "请开始 phase-X 的任务"\n- "开始开发 phase-X" / "开始开发 phase-X 的任务"\n- "继续 phase-X" / "继续开发 phase-X" / "继续开发 phase-X 的任务"\n- "恢复 phase-X" / "恢复 phase-X 开发"\n- "启动 phase-X" / "启动 phase-X 开发"\n- "start phase-X" / "resume phase-X"\n- Any variant containing "phase-" followed by a number combined with 开始/继续/恢复/启动/start/resume\nThis tool is idempotent: first call = start (pending→in_progress), subsequent calls = resume (preserves completed sub-tasks).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        taskId: {
          type: 'string',
          description: 'Main task ID (e.g., "phase-23")\n主任务 ID（如 "phase-23"）',
        },
      },
      required: ['projectName', 'taskId'],
    },
  },
  {
    name: 'devplan_search_sections',
    description: 'Search document sections with support for literal, semantic, or hybrid (RRF fusion) search modes. Requires "graph" engine with enableSemanticSearch in .devplan/config.json for semantic/hybrid modes. Falls back to literal search when semantic search is unavailable.\n搜索文档片段，支持字面匹配、语义搜索或混合搜索（RRF 融合）模式。语义/混合模式需要 graph 引擎且在 .devplan/config.json 中启用 enableSemanticSearch。语义搜索不可用时自动回退为字面搜索。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        query: {
          type: 'string',
          description: 'Search query text\n搜索查询文本',
        },
        mode: {
          type: 'string',
          enum: ['literal', 'semantic', 'hybrid'],
          description: 'Search mode: "literal" for text matching, "semantic" for vector similarity, "hybrid" for RRF fusion of both (default: "hybrid")\n搜索模式："literal" 字面匹配、"semantic" 语义搜索、"hybrid" 混合融合（默认 "hybrid"）',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10)\n最大返回结果数（默认 10）',
        },
        minScore: {
          type: 'number',
          description: 'Minimum relevance score threshold (0~1, default: 0)\n最低相关性评分阈值（0~1，默认 0）',
        },
      },
      required: ['projectName', 'query'],
    },
  },
  {
    name: 'devplan_rebuild_index',
    description: 'Rebuild the vector embedding index for all document sections. Reads all documents, generates embeddings via VibeSynapse (Candle MiniLM), and indexes them into SocialGraphV2. Use when: first enabling semantic search, switching embedding models, or repairing a corrupted index. Shows progress and duration.\n重建所有文档片段的向量 Embedding 索引。读取全部文档，通过 VibeSynapse（Candle MiniLM）生成 Embedding，索引到 SocialGraphV2。适用于：首次启用语义搜索、切换 Embedding 模型、修复损坏的索引。显示进度和耗时。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
      },
      required: ['projectName'],
    },
  },
  // ========================================================================
  // Autopilot Tools (3 个)
  // ========================================================================
  {
    name: 'devplan_auto_status',
    description: 'Query autopilot execution status: whether there is an active phase, current sub-task, next pending sub-task, next pending phase, and remaining phases count.\n查询自动化执行状态：是否有进行中阶段、当前子任务、下一个待执行子任务、下一个待启动阶段、剩余未完成阶段数。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (required)\n项目名称（必需）`,
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_auto_next',
    description: 'Intelligently recommend the next action for autopilot: send_task (send next sub-task), send_continue (AI was interrupted), start_phase (start a new phase), wait (task in progress), or all_done (everything completed).\n智能推荐下一步自动化动作：send_task（发送子任务）、send_continue（AI 被中断）、start_phase（启动新阶段）、wait（等待中）、all_done（全部完成）。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (required)\n项目名称（必需）`,
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_auto_config',
    description: 'Get or update autopilot configuration: poll interval, auto-start next phase, max continue retries, stuck timeout. Call without config to read current settings.\n获取或更新自动化配置：轮询间隔、自动启动下一阶段、最大重试次数、卡住超时。不传 config 则读取当前配置。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (required)\n项目名称（必需）`,
        },
        config: {
          type: 'object',
          description: 'Partial config to merge. Omit to read current config.\n要合并的配置。省略则读取当前配置。',
          properties: {
            enabled: { type: 'boolean', description: 'Enable/disable autopilot' },
            pollIntervalSeconds: { type: 'number', description: 'Executor poll interval in seconds' },
            autoStartNextPhase: { type: 'boolean', description: 'Auto-start next phase when current completes' },
            maxContinueRetries: { type: 'number', description: 'Max consecutive "continue" retries' },
            stuckTimeoutMinutes: { type: 'number', description: 'Sub-task stuck timeout in minutes' },
          },
        },
      },
      required: ['projectName'],
    },
  },

  // ========================================================================
  // Prompt Logging Tools (2 个)
  // ========================================================================
  {
    name: 'devplan_save_prompt',
    description: 'Save a user prompt to the dev plan prompt log. Optionally associate it with a main task. Returns the saved prompt with auto-assigned index.\n保存用户 Prompt 到开发计划的 Prompt 日志。可选关联主任务。返回保存的 Prompt（含自动分配的序号）。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        content: {
          type: 'string',
          description: 'The user prompt content\n用户输入的 Prompt 内容',
        },
        summary: {
          type: 'string',
          description: 'Optional: AI-generated summary of the prompt\n可选：AI 生成的 Prompt 摘要',
        },
        relatedTaskId: {
          type: 'string',
          description: 'Optional: Main task ID to associate with (e.g., "phase-7")\n可选：关联的主任务 ID（如 "phase-7"）',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: Custom tags\n可选：自定义标签',
        },
      },
      required: ['projectName', 'content'],
    },
  },
  {
    name: 'devplan_list_prompts',
    description: 'List saved prompts from the dev plan prompt log. Can filter by date or related task.\n列出开发计划中保存的 Prompt 日志。可按日期或关联任务过滤。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        date: {
          type: 'string',
          description: 'Optional: Filter by date (format: YYYY-MM-DD)\n可选：按日期过滤（格式：YYYY-MM-DD）',
        },
        relatedTaskId: {
          type: 'string',
          description: 'Optional: Filter by related main task ID\n可选：按关联主任务 ID 过滤',
        },
        limit: {
          type: 'number',
          description: 'Optional: Maximum number of results (default: all)\n可选：最大返回条数（默认：全部）',
        },
      },
      required: ['projectName'],
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
  /** devplan_export_graph: 是否包含文档节点 */
  includeDocuments?: boolean;
  /** devplan_export_graph: 是否包含模块节点 */
  includeModules?: boolean;
  /** devplan_export_graph: 是否包含后端导出的 node.degree */
  includeNodeDegree?: boolean;
  /** devplan_export_graph: 后端是否启用 degree 回退计算 */
  enableBackendDegreeFallback?: boolean;
  /** devplan_migrate_engine: 目标引擎 */
  targetEngine?: string;
  /** devplan_migrate_engine: 是否备份 */
  backup?: boolean;
  /** devplan_create_main_task / devplan_upsert_task: 关联文档片段 */
  relatedDocSections?: string[];
  /** devplan_save_section: 关联主任务 ID 列表 */
  relatedTaskIds?: string[];
  /** devplan_start_visual: HTTP 端口 */
  port?: number;
  /** devplan_search_sections: 搜索查询文本 */
  query?: string;
  /** devplan_search_sections: 搜索模式 */
  mode?: string;
  /** devplan_search_sections: 最大结果数 */
  limit?: number;
  /** devplan_search_sections: 最低评分阈值 */
  minScore?: number;
  /** 任务排序序号（越小越靠前） */
  order?: number;
  /** devplan_save_section: 父文档标识 */
  parentDoc?: string;
  /** devplan_auto_config: Autopilot 配置（部分更新） */
  config?: Partial<AutopilotConfig>;
  /** devplan_save_prompt: Prompt 摘要 */
  summary?: string;
  /** devplan_save_prompt: 关联的主任务 ID */
  relatedTaskId?: string;
  /** devplan_save_prompt: 自定义标签 */
  tags?: string[];
  /** devplan_list_prompts: 按日期过滤 */
  date?: string;
  /** devplan_create_main_task / devplan_upsert_task: 关联 Prompt ID 列表 */
  relatedPromptIds?: string[];
}

/**
 * 解析 projectName
 *
 * 优先级：
 * 1. 显式传入的 projectName
 * 2. .devplan/config.json 中的 defaultProject
 * 3. 常量 DEFAULT_PROJECT_NAME ("devplan-db")
 *
 * devplan_init 例外：未提供时返回 undefined（表示列出已有计划）
 */
function resolveProjectName(args: ToolArgs, toolName: string): string | undefined {
  if (args.projectName) return args.projectName;
  // devplan_init 不传 projectName 时 = 列出已有计划，不使用默认值
  if (toolName === 'devplan_init') return undefined;
  return factoryResolveProjectName(undefined);
}

async function handleToolCall(name: string, args: ToolArgs): Promise<string> {
  // 统一解析 projectName 默认值（devplan_init 例外）
  args.projectName = resolveProjectName(args, name);

  switch (name) {
    case 'devplan_init': {
      if (!args.projectName) {
        // List existing plans with engine info
        const plans = listDevPlans();
        const planDetails = plans.map((name) => ({
          name,
          engine: getProjectEngine(name) || 'unknown',
        }));
        const config = readDevPlanConfig();
        return JSON.stringify({
          existingPlans: planDetails,
          configDefaultProject: config?.defaultProject || null,
          availableSections: ALL_SECTIONS,
          sectionDescriptions: SECTION_DESCRIPTIONS,
          availableEngines: ['graph', 'document'],
          defaultEngine: 'graph',
          message: plans.length > 0
            ? `Found ${plans.length} existing plan(s).${config ? ` Default project: "${config.defaultProject}".` : ''} Provide a projectName to initialize a new one.`
            : 'No existing plans. Provide a projectName to create one.',
        });
      }

      const plan = getDevPlan(args.projectName);
      const engine = getProjectEngine(args.projectName) || 'graph';

      // 自动写入/更新工作区级 .devplan/config.json
      const defaultBase = getDefaultBasePath();
      const existingConfig = readDevPlanConfig(defaultBase);
      if (!existingConfig) {
        writeDevPlanConfig({
          defaultProject: args.projectName,
          enableSemanticSearch: true,
        });
      }

      // 多项目工作区：自动注册新项目到工作区 config.json 的 projects 表
      // 当项目名不在 projects 注册表中时，尝试在工作区根目录的同级查找同名目录
      let autoRegistered = false;
      const workspaceConfig = readDevPlanConfig(defaultBase) || {
        defaultProject: args.projectName,
        enableSemanticSearch: true,
      };
      if (!workspaceConfig.projects?.[args.projectName]) {
        // 尝试自动发现项目根目录：
        // 如果 defaultBase 在某个项目下 (如 D:\xxx\ai_db\.devplan)，
        // 取其父目录 (D:\xxx\) 作为工作区根，查找 D:\xxx\{projectName}\
        const devplanParent = path.dirname(defaultBase); // e.g. D:\Project\git\ai_db
        const workspaceRoot = path.dirname(devplanParent); // e.g. D:\Project\git
        const candidateRoot = path.join(workspaceRoot, args.projectName);

        if (fs.existsSync(candidateRoot) && fs.statSync(candidateRoot).isDirectory()) {
          // 找到了同名目录，自动注册到 projects 表
          if (!workspaceConfig.projects) {
            workspaceConfig.projects = {};
          }
          workspaceConfig.projects[args.projectName] = { rootPath: candidateRoot };
          writeDevPlanConfig(workspaceConfig, defaultBase);
          autoRegistered = true;
          console.error(`[devplan] Auto-registered project "${args.projectName}" → ${candidateRoot}`);
        } else {
          console.error(`[devplan] Project "${args.projectName}" not found at candidate path: ${candidateRoot}, using default basePath`);
        }
      }

      // 多项目工作区：如果项目路由到独立目录，也在该目录创建 config.json
      const projectBase = resolveBasePathForProject(args.projectName);
      if (projectBase !== defaultBase) {
        const projectLocalConfig = readDevPlanConfig(projectBase);
        if (!projectLocalConfig) {
          writeDevPlanConfig({
            defaultProject: args.projectName,
            enableSemanticSearch: true,
          }, projectBase);
          console.error(`[devplan] Created project-level config.json at ${projectBase}`);
        }
      }

      // 自动生成 .cursor/rules/dev-plan-management.mdc 模板
      // 仅当项目根目录可确定、且规则文件不存在时生成
      let cursorRuleGenerated = false;
      const projectRoot = path.dirname(projectBase); // projectBase = xxx/.devplan → projectRoot = xxx
      const cursorRulesDir = path.join(projectRoot, '.cursor', 'rules');
      const cursorRuleFile = path.join(cursorRulesDir, 'dev-plan-management.mdc');

      if (projectRoot && !fs.existsSync(cursorRuleFile)) {
        try {
          if (!fs.existsSync(cursorRulesDir)) {
            fs.mkdirSync(cursorRulesDir, { recursive: true });
          }
          const ruleContent = generateCursorRuleTemplate(args.projectName);
          fs.writeFileSync(cursorRuleFile, ruleContent, 'utf-8');
          cursorRuleGenerated = true;
          console.error(`[devplan] Generated Cursor Rule template at ${cursorRuleFile}`);
        } catch (err) {
          console.error(`[devplan] Failed to generate Cursor Rule: ${err}`);
        }
      }

      return JSON.stringify({
        success: true,
        projectName: args.projectName,
        engine,
        basePath: projectBase,
        autoRegistered,
        cursorRuleGenerated,
        cursorRulePath: cursorRuleGenerated ? cursorRuleFile : null,
        configDefaultProject: readDevPlanConfig()?.defaultProject || null,
        registeredProjects: Object.keys(readDevPlanConfig(defaultBase)?.projects || {}),
        availableSections: ALL_SECTIONS,
        sectionDescriptions: SECTION_DESCRIPTIONS,
        message: autoRegistered
          ? `DevPlan initialized for "${args.projectName}" with engine "${engine}". Project auto-registered at ${projectBase}.`
          : `DevPlan initialized for "${args.projectName}" with engine "${engine}".`,
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
        relatedTaskIds: args.relatedTaskIds,
        parentDoc: args.parentDoc,
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
          parentDoc: s.parentDoc || null,
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
          relatedSections: args.relatedDocSections,
          relatedPromptIds: args.relatedPromptIds,
          order: args.order,
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
          order: args.order,
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
              relatedSections: args.relatedDocSections,
              relatedPromptIds: args.relatedPromptIds,
              order: args.order,
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
              order: args.order,
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

      /**
       * 查找下一个待处理的主任务（按 order 排序）
       * 优先返回 in_progress 的，其次是 pending 的
       */
      const findNextPendingPhase = () => {
        const allMainTasks = plan.listMainTasks();
        // 优先找 in_progress 的主任务
        const inProgress = allMainTasks.find(t => t.status === 'in_progress');
        if (inProgress) {
          return { taskId: inProgress.taskId, title: inProgress.title, status: inProgress.status, priority: inProgress.priority };
        }
        // 其次找 pending 的主任务（已按 order 排序）
        const pending = allMainTasks.find(t => t.status === 'pending');
        if (pending) {
          return { taskId: pending.taskId, title: pending.title, status: pending.status, priority: pending.priority };
        }
        return null;
      };

      /**
       * 统计剩余未完成的主任务数量
       */
      const countRemainingPhases = () => {
        const allMainTasks = plan.listMainTasks();
        return allMainTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
      };

      try {
        if (taskType === 'main') {
          const mainTask = plan.completeMainTask(args.taskId);
          const nextPhase = findNextPendingPhase();
          const remainingCount = countRemainingPhases();
          const response: Record<string, unknown> = {
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
          };
          if (nextPhase) {
            response.nextPhase = nextPhase;
            response.remainingPhases = remainingCount;
            response.hint = `🎉 阶段 "${mainTask.title}" 已完成！还有 ${remainingCount} 个待处理阶段。下一个：${nextPhase.taskId} "${nextPhase.title}"。是否继续？（说"开始 ${nextPhase.taskId}"即可启动）`;
          } else {
            response.remainingPhases = 0;
            response.hint = `🎉🎉🎉 所有阶段全部完成！项目开发计划已圆满结束。`;
          }
          return JSON.stringify(response);
        } else {
          const result = plan.completeSubTask(args.taskId);
          const response: Record<string, unknown> = {
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
          };
          // 当主任务也随之完成时，查询下一个待处理阶段
          if (result.mainTaskCompleted) {
            const nextPhase = findNextPendingPhase();
            const remainingCount = countRemainingPhases();
            if (nextPhase) {
              response.nextPhase = nextPhase;
              response.remainingPhases = remainingCount;
              response.hint = `🎉 阶段 "${result.mainTask.title}" 全部完成！还有 ${remainingCount} 个待处理阶段。下一个：${nextPhase.taskId} "${nextPhase.title}"。是否继续？（说"开始 ${nextPhase.taskId}"即可启动）`;
            } else {
              response.remainingPhases = 0;
              response.hint = `🎉🎉🎉 所有阶段全部完成！项目开发计划已圆满结束。`;
            }
          }
          return JSON.stringify(response);
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
            order: st.order,
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
          order?: number;
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
              order: sub.order,
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
            order: mt.order,
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

    case 'devplan_export_graph': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const engine = getProjectEngine(args.projectName);

      if (engine !== 'graph' || !plan.exportGraph) {
        return JSON.stringify({
          error: `Graph export is only available for projects using the "graph" engine. Project "${args.projectName}" uses "${engine || 'document'}" engine.`,
          hint: 'Re-initialize the project with engine "graph" to enable graph export.',
        });
      }

      try {
        const graph = plan.exportGraph({
          includeDocuments: args.includeDocuments,
          includeModules: args.includeModules,
          includeNodeDegree: args.includeNodeDegree,
          enableBackendDegreeFallback: args.enableBackendDegreeFallback,
        });

        return JSON.stringify({
          success: true,
          projectName: args.projectName,
          engine: 'graph',
          nodeCount: graph?.nodes.length || 0,
          edgeCount: graph?.edges.length || 0,
          graph,
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }

    case 'devplan_migrate_engine': {
      if (!args.projectName || !args.targetEngine) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, targetEngine');
      }

      const validEngines = ['graph', 'document'];
      if (!validEngines.includes(args.targetEngine)) {
        throw new McpError(ErrorCode.InvalidParams,
          `Invalid targetEngine "${args.targetEngine}". Must be one of: ${validEngines.join(', ')}`);
      }

      try {
        const result = migrateEngine(
          args.projectName,
          args.targetEngine as DevPlanEngine,
          undefined,
          {
            backup: args.backup,
            dryRun: args.dryRun,
          }
        );

        // 迁移成功后清除缓存，下次访问时使用新引擎
        if (result.success && !args.dryRun) {
          devPlanCache.delete(args.projectName);
        }

        const statusIcon = result.success ? '✅' : '⚠️';
        const modeLabel = args.dryRun ? ' (dry run)' : '';

        return JSON.stringify({
          ...result,
          summary: result.fromEngine === result.toEngine
            ? `ℹ️ Project "${args.projectName}" already uses "${result.toEngine}" engine. No migration needed.`
            : result.success
              ? `${statusIcon} Successfully migrated "${args.projectName}" from "${result.fromEngine}" to "${result.toEngine}"${modeLabel}. ` +
                `Stats: ${result.stats.modules} modules, ${result.stats.documents} documents, ` +
                `${result.stats.mainTasks} main tasks, ${result.stats.subTasks} sub-tasks. ` +
                `Duration: ${result.durationMs}ms.` +
                (result.backupPath ? ` Backup: ${result.backupPath}` : '')
              : `${statusIcon} Migration failed with ${result.errors.length} error(s): ${result.errors.join('; ')}`,
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }

    case 'devplan_start_visual': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const engine = getProjectEngine(args.projectName);
      if (engine !== 'graph') {
        return JSON.stringify({
          success: false,
          error: `Graph visualization requires "graph" engine. Project "${args.projectName}" uses "${engine || 'document'}" engine.`,
          hint: 'Use devplan_migrate_engine to migrate to "graph" engine first.',
        });
      }

      const port = args.port || 3210;

      try {
        const { spawn } = require('child_process');
        const serverScript = require('path').resolve(__dirname, '../visualize/server.js');

        const child = spawn(process.execPath, [
          serverScript,
          '--project', args.projectName,
          '--port', String(port),
        ], {
          detached: true,
          stdio: 'ignore',
        });

        child.unref();

        const url = `http://localhost:${port}`;

        // 尝试自动打开浏览器
        const platform = process.platform;
        let openCmd: string;
        let openArgs: string[];
        if (platform === 'win32') {
          openCmd = 'cmd';
          openArgs = ['/c', 'start', '', url];
        } else if (platform === 'darwin') {
          openCmd = 'open';
          openArgs = [url];
        } else {
          openCmd = 'xdg-open';
          openArgs = [url];
        }

        const browser = spawn(openCmd, openArgs, {
          detached: true,
          stdio: 'ignore',
        });
        browser.unref();

        return JSON.stringify({
          success: true,
          projectName: args.projectName,
          port,
          url,
          pid: child.pid,
          message: `Visualization server started at ${url} (PID: ${child.pid}). Browser should open automatically. Use Ctrl+Click to drag connected nodes together.`,
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }

    case 'devplan_start_phase': {
      if (!args.projectName) throw new McpError(ErrorCode.InvalidParams, 'projectName is required');
      if (!args.taskId) throw new McpError(ErrorCode.InvalidParams, 'taskId is required');

      const plan = getDevPlan(args.projectName);
      const mainTask = plan.getMainTask(args.taskId);
      if (!mainTask) {
        throw new McpError(ErrorCode.InvalidParams, `Main task "${args.taskId}" not found in project "${args.projectName}"`);
      }

      // Mark main task as in_progress (if still pending)
      if (mainTask.status === 'pending') {
        plan.updateMainTaskStatus(args.taskId, 'in_progress');
      }

      // Fetch all sub-tasks
      const subTasks = plan.listSubTasks(args.taskId);

      // Get related document sections (if any)
      const relatedDocs = mainTask.relatedSections || [];

      // Return structured result optimized for Cursor TodoList creation
      return JSON.stringify({
        mainTask: {
          taskId: mainTask.taskId,
          title: mainTask.title,
          priority: mainTask.priority,
          status: 'in_progress',
          description: mainTask.description,
          estimatedHours: mainTask.estimatedHours,
          moduleId: mainTask.moduleId,
          order: mainTask.order,
          totalSubtasks: subTasks.length,
          completedSubtasks: subTasks.filter(s => s.status === 'completed').length,
        },
        subTasks: subTasks.map(s => ({
          taskId: s.taskId,
          title: s.title,
          status: s.status,
          description: s.description,
          estimatedHours: s.estimatedHours,
          order: s.order,
        })),
        relatedDocSections: relatedDocs,
        message: `Phase ${args.taskId} started. ${subTasks.length} sub-tasks total, ${subTasks.filter(s => s.status === 'completed').length} already completed.`,
      }, null, 2);
    }

    case 'devplan_search_sections': {
      if (!args.projectName || !args.query) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, query');
      }

      const plan = getDevPlan(args.projectName);
      const searchMode = (args.mode as SearchMode) || 'hybrid';
      const searchLimit = args.limit || 10;
      const searchMinScore = args.minScore || 0;

      // 判断是否支持高级搜索
      const isSemanticEnabled = plan.isSemanticSearchEnabled?.() ?? false;

      if (plan.searchSectionsAdvanced) {
        const results = plan.searchSectionsAdvanced(args.query, {
          mode: searchMode,
          limit: searchLimit,
          minScore: searchMinScore,
        });

        return JSON.stringify({
          projectName: args.projectName,
          query: args.query,
          mode: searchMode,
          semanticSearchEnabled: isSemanticEnabled,
          actualMode: isSemanticEnabled ? searchMode : 'literal',
          count: results.length,
          results: results.map(r => ({
            id: r.id,
            section: r.section,
            subSection: r.subSection || null,
            title: r.title,
            score: r.score ?? null,
            contentPreview: r.content.slice(0, 300) + (r.content.length > 300 ? '...' : ''),
            updatedAt: r.updatedAt,
          })),
        });
      } else {
        // 回退到基础搜索（document 引擎）
        const results = plan.searchSections(args.query, searchLimit);
        return JSON.stringify({
          projectName: args.projectName,
          query: args.query,
          mode: 'literal',
          semanticSearchEnabled: false,
          actualMode: 'literal',
          count: results.length,
          results: results.map(r => ({
            id: r.id,
            section: r.section,
            subSection: r.subSection || null,
            title: r.title,
            score: null,
            contentPreview: r.content.slice(0, 300) + (r.content.length > 300 ? '...' : ''),
            updatedAt: r.updatedAt,
          })),
        });
      }
    }

    case 'devplan_rebuild_index': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);

      if (!plan.rebuildIndex) {
        return JSON.stringify({
          success: false,
          error: `Rebuild index is only available for projects using the "graph" engine with enableSemanticSearch enabled. Use .devplan/config.json to enable.`,
          hint: 'Add { "enableSemanticSearch": true } to .devplan/config.json and restart.',
        });
      }

      const isSemanticEnabled = plan.isSemanticSearchEnabled?.() ?? false;
      if (!isSemanticEnabled) {
        return JSON.stringify({
          success: false,
          error: 'Semantic search is not enabled or VibeSynapse initialization failed.',
          hint: 'Ensure enableSemanticSearch is true in .devplan/config.json and VibeSynapse (Candle MiniLM) can initialize successfully.',
        });
      }

      try {
        const result = plan.rebuildIndex();
        const statusIcon = result.failed === 0 ? '[OK]' : '[WARN]';

        return JSON.stringify({
          success: true,
          ...result,
          summary: `${statusIcon} Rebuilt index: ${result.indexed}/${result.total} documents indexed in ${result.durationMs}ms.` +
            (result.failed > 0 ? ` ${result.failed} failed.` : ''),
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }

    // ==================================================================
    // Autopilot Tool Handlers
    // ==================================================================

    case 'devplan_auto_status': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }
      const plan = getDevPlan(args.projectName);
      const status = getAutopilotStatus(plan);
      const hbInfo = getLastHeartbeat(args.projectName);

      return JSON.stringify({
        ...status,
        executor: {
          isAlive: hbInfo.isAlive,
          lastHeartbeat: hbInfo.heartbeat,
          lastHeartbeatReceivedAt: hbInfo.receivedAt || null,
        },
      }, null, 2);
    }

    case 'devplan_auto_next': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }
      const plan = getDevPlan(args.projectName);
      const nextAction = getAutopilotNextAction(plan);

      return JSON.stringify(nextAction, null, 2);
    }

    case 'devplan_auto_config': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      if (args.config && typeof args.config === 'object') {
        // 更新配置
        const updated = updateAutopilotConfig(args.projectName, args.config);
        return JSON.stringify({
          action: 'updated',
          config: updated,
        }, null, 2);
      } else {
        // 读取配置
        const current = getAutopilotConfig(args.projectName);
        return JSON.stringify({
          action: 'read',
          config: current,
        }, null, 2);
      }
    }

    // ==================================================================
    // Prompt Logging
    // ==================================================================

    case 'devplan_save_prompt': {
      const projectName = args.projectName!;
      const content = args.content;
      if (!content) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: content');
      }

      const plan = createDevPlan(projectName);
      if (typeof (plan as any).savePrompt !== 'function') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Prompt logging requires "graph" engine. Project "${projectName}" uses a different engine.`
        );
      }

      const prompt = (plan as any).savePrompt({
        projectName,
        content,
        summary: args.summary,
        relatedTaskId: args.relatedTaskId,
        tags: args.tags,
      });

      return JSON.stringify({
        status: 'saved',
        prompt,
      }, null, 2);
    }

    case 'devplan_list_prompts': {
      const projectName = args.projectName!;
      const plan = createDevPlan(projectName);

      if (typeof (plan as any).listPrompts !== 'function') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Prompt logging requires "graph" engine. Project "${projectName}" uses a different engine.`
        );
      }

      const prompts = (plan as any).listPrompts({
        date: args.date,
        relatedTaskId: args.relatedTaskId,
        limit: args.limit,
      });

      return JSON.stringify({
        projectName,
        count: prompts.length,
        filter: {
          date: args.date || null,
          relatedTaskId: args.relatedTaskId || null,
          limit: args.limit || null,
        },
        prompts,
      }, null, 2);
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

/**
 * 生成项目专属的 Cursor Rule 模板文件内容。
 *
 * 模板只包含项目专属信息（projectName、文档层级占位、快捷操作、开发阶段占位）。
 * 通用的 DevPlan 工作流规则由用户级全局 Cursor Rule 或 MCP 工具描述提供。
 */
function generateCursorRuleTemplate(projectName: string): string {
  return `---
description: ${projectName} 项目的 DevPlan 配置。包含项目标识、文档层级、开发阶段。通用的 DevPlan 工作流规则由用户级全局规则提供。
globs: []
alwaysApply: true
mcpServers: aifastdb-devplan
---

# ${projectName} 项目 — DevPlan 配置

> **MCP Server**: \`aifastdb-devplan\`
> 通用的 DevPlan 工作流（触发词识别、阶段工作流、完成流程等）由用户级全局 Cursor Rule 提供。

## 项目标识

\`\`\`
projectName = "${projectName}"
\`\`\`

## 文档层级

| 层级 | 文件 | 用途 | 大小 |
|------|------|------|------|
| Layer 1 (鸟瞰) | \`docs/${projectName}-overview.md\` | AI 首选阅读，< 500 行 | — |
| Layer 2 (详细) | （项目完整设计文档） | 分段读取 | — |
| Layer 3 (实时) | \`.devplan/${projectName}/\` | MCP 工具查询任务状态 | — |

## 快捷操作

\`\`\`
devplan_get_progress(projectName: "${projectName}")
devplan_list_tasks(projectName: "${projectName}")
devplan_list_tasks(projectName: "${projectName}", status: "pending")
devplan_complete_task(projectName: "${projectName}", taskId: "T1.1")
devplan_sync_git(projectName: "${projectName}", dryRun: true)
devplan_list_sections(projectName: "${projectName}")
devplan_get_section(projectName: "${projectName}", section: "overview")
devplan_export_markdown(projectName: "${projectName}", scope: "tasks")
devplan_list_modules(projectName: "${projectName}")
\`\`\`

## 开发阶段概览

| 阶段 | 状态 | 说明 |
|------|------|------|
| （使用 devplan_list_tasks 查看最新状态） | | |

## 注意事项

1. **优先读概览文件**：初次了解项目时，先读概览文件（< 500 行），再按需深入完整设计文档
2. **数据存储位置**：本项目的 devplan 数据存储在项目根目录的 \`.devplan/${projectName}/\` 下
3. **通过 MCP 操作任务**：任务状态管理使用 \`devplan_*\` 系列 MCP 工具，不要手动编辑数据文件
4. **完成任务后同步**：完成代码实现后，调用 \`devplan_complete_task\` 持久化状态（自动锚定 Git commit）
5. **Git 回滚后检查**：如果执行了 \`git reset\` 或切换分支，运行 \`devplan_sync_git\` 检查任务状态一致性
6. **概览文件需手动更新**：当有重大架构变更、新增阶段或新 API 时，同步更新概览文档
`;
}

// Run
main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
