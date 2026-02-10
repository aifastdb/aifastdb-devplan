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
  createDevPlan,
  listDevPlans,
  getProjectEngine,
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
} from '../types';

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
    description: 'Initialize a development plan for a project. Creates an empty plan structure. Also lists existing plans if no projectName is given.\n初始化项目的开发计划。创建空的计划结构。如果不提供 projectName 则列出已有的计划。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: 'Project name (e.g., "federation-db", "aidb-viewer"). Omit to list existing plans.\n项目名称（如 "federation-db"）。省略则列出已有计划。',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
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
          description: 'Project name\n项目名称',
        },
        port: {
          type: 'number',
          description: 'HTTP server port (default: 3210)\nHTTP 服务器端口（默认 3210）',
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
}

async function handleToolCall(name: string, args: ToolArgs): Promise<string> {
  switch (name) {
    case 'devplan_init': {
      if (!args.projectName) {
        // List existing plans with engine info
        const plans = listDevPlans();
        const planDetails = plans.map((name) => ({
          name,
          engine: getProjectEngine(name) || 'unknown',
        }));
        return JSON.stringify({
          existingPlans: planDetails,
          availableSections: ALL_SECTIONS,
          sectionDescriptions: SECTION_DESCRIPTIONS,
          availableEngines: ['graph', 'document'],
          defaultEngine: 'graph',
          message: plans.length > 0
            ? `Found ${plans.length} existing plan(s). Provide a projectName to initialize a new one.`
            : 'No existing plans. Provide a projectName to create one.',
        });
      }

      const plan = getDevPlan(args.projectName);
      const engine = getProjectEngine(args.projectName) || 'graph';
      return JSON.stringify({
        success: true,
        projectName: args.projectName,
        engine,
        availableSections: ALL_SECTIONS,
        sectionDescriptions: SECTION_DESCRIPTIONS,
        message: `DevPlan initialized for "${args.projectName}" with engine "${engine}". Use devplan_save_section to add document sections and devplan_create_main_task to add development phases.`,
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
          relatedSections: args.relatedDocSections,
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
              relatedSections: args.relatedDocSections,
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
