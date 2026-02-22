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
import {
  type BatchCacheFile,
  type BatchCacheEntry,
  readBatchCache,
  writeBatchCache,
  createBatchCache,
  appendEntry,
  getCacheStats,
  deleteBatchCache,
  getCachePath,
} from '../batch-cache';

// ============================================================================
// Async Mutex — 串行化重型操作（embedding + decompose），防止并发过载崩溃
// ============================================================================

/**
 * 简易异步互斥锁。
 *
 * 当 Cursor 对同一 MCP Server 并行发送多个 tool call 时，
 * 每个 memory_save 会执行 N 次同步 NAPI embed 调用（阻塞事件循环）。
 * 5 条并行 × 5 次 embed = 25 次连续阻塞 → Cursor 心跳超时 → 连接断开。
 *
 * AsyncMutex 将并发请求串行化，并在两次操作之间通过 setImmediate
 * 让出事件循环，允许 MCP SDK 处理心跳/ping 消息，保持连接稳定。
 */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  /** 获取锁。如锁已被占用，返回的 Promise 会挂起直到前一个操作完成。 */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  /** 释放锁。如队列中有等待者，通过 setImmediate 在下一 tick 唤醒，给事件循环喘息空间。 */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // 让出事件循环，允许 MCP SDK 处理 keepalive/heartbeat
      setImmediate(next);
    } else {
      this.locked = false;
    }
  }
}

/** 全局互斥锁 — 所有 memory_save 操作共享，保证串行执行 */
const memorySaveMutex = new AsyncMutex();

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
    name: 'devplan_cleanup_duplicates',
    description: 'Phase-21: Scan and cleanup duplicate entities in the WAL. Deduplicates main tasks (by taskId), sub-tasks (by taskId), modules (by moduleId), and documents (by section+subSection). Keeps the entity with the highest status priority (completed > in_progress > pending > cancelled) and latest updatedAt. Use dryRun=true to preview without changes.\nPhase-21: 扫描并清理 WAL 中的重复 Entity。按业务键去重（mainTask 按 taskId，subTask 按 taskId，module 按 moduleId，doc 按 section+subSection）。保留状态优先级最高 + updatedAt 最新的 Entity。使用 dryRun=true 可预览而不实际修改。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, only report which duplicates would be cleaned without actually deleting them (default: false)\n为 true 时仅报告哪些重复 Entity 会被清理，不实际删除（默认 false）',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_repair_counts',
    description: 'Phase-45: Repair all main task sub-task counts and auto-complete status. Recalculates totalSubtasks/completedSubtasks from actual sub-task data and auto-completes main tasks where all sub-tasks are done but status is still in_progress. Fixes data inconsistencies caused by updateEntity routing issues.\nPhase-45: 修复所有主任务的子任务计数和自动完成状态。从实际子任务数据重新计算 totalSubtasks/completedSubtasks，并自动完成所有子任务已完成但状态仍为 in_progress 的主任务。修复因 updateEntity 路由问题导致的数据不一致。',
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
          description: 'The exact raw user input from Cursor chat (verbatim copy, no modifications)\n用户在 Cursor 对话框中的原始输入（逐字复制，不做任何修改）',
        },
        aiInterpretation: {
          type: 'string',
          description: 'Optional: AI interpretation of the user input — describe in your own words what the user wants to do\n可选：AI 对用户输入的理解和解读 — 用你自己的话描述用户想做什么',
        },
        summary: {
          type: 'string',
          description: 'Optional: AI-generated short summary of the prompt (one sentence)\n可选：AI 生成的 Prompt 简要摘要（一句话）',
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
  // ========================================================================
  // Memory Tools (Cursor 长期记忆)
  // ========================================================================
  {
    name: 'devplan_memory_save',
    description: 'Save a memory entry to the dev plan for long-term Cursor context. Memories are automatically embedded for semantic recall. Types: decision (architecture decisions), pattern (code patterns), bugfix (bug fixes), insight (learnings), preference (user/project preferences), summary (session summaries).\n保存一条记忆到开发计划，为 Cursor 提供长期上下文。记忆会自动向量化以支持语义召回。类型：decision（架构决策）、pattern（代码模式）、bugfix（Bug修复）、insight（开发洞察）、preference（偏好约定）、summary（会话摘要）。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        memoryType: {
          type: 'string',
          enum: ['decision', 'pattern', 'bugfix', 'insight', 'preference', 'summary'],
          description: 'Memory type\n记忆类型',
        },
        content: {
          type: 'string',
          description: 'Memory content (Markdown supported)\n记忆内容（支持 Markdown）',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: Custom tags for categorization\n可选：分类标签',
        },
        relatedTaskId: {
          type: 'string',
          description: 'Optional: Related main task ID (e.g., "phase-24")\n可选：关联的主任务 ID',
        },
        importance: {
          type: 'number',
          description: 'Optional: Importance score 0~1 (default: 0.5)\n可选：重要性评分 0~1（默认 0.5）',
        },
        sourceId: {
          type: 'string',
          description: 'Optional: Source ID tracking which document/task this memory was generated from. Used by devplan_memory_generate for dedup. Format: taskId (e.g., "phase-7") or "section|subSection" (e.g., "overview", "technical_notes|security"). **IMPORTANT**: When saving memories from devplan_memory_generate candidates, ALWAYS pass the candidate\'s `sourceId` field here to enable proper dedup tracking.\n可选：记忆来源 ID，标记该记忆由哪个文档/任务生成。用于 devplan_memory_generate 的去重。格式：taskId（如 "phase-7"）或 "section|subSection"（如 "overview"）。**重要**：从 devplan_memory_generate 候选项保存记忆时，务必传入候选项的 sourceId 以启用去重追踪。',
        },
        moduleId: {
          type: 'string',
          description: 'Optional: Associate with a feature module (e.g., "vector-store"). Automatically creates MODULE_MEMORY relation to integrate the memory into the module-level knowledge graph.\n可选：关联到功能模块（如 "vector-store"）。自动创建 MODULE_MEMORY 关系，将记忆融入模块级知识图谱。',
        },
        decompose: {
          type: 'string',
          enum: ['false', 'true', 'rule', 'llm'],
          description: 'Optional: Memory decomposition mode (Phase-47). Decomposes content into an Episode + Entities + Relations sub-graph using the Rust memory tree engine.\n可选：记忆分解模式（Phase-47）。将内容分解为 Episode + Entities + Relations 子图。\n- "false" (default): Traditional single-entity storage\n- "true" or "rule": Rule-based decomposer\n- "llm": Parse LLM-generated decomposition JSON (requires llmDecompositionJson)',
        },
        llmDecompositionJson: {
          type: 'string',
          description: 'Optional: LLM-generated decomposition JSON string. Only used when decompose="llm".\n可选：LLM 生成的分解 JSON 字符串。仅当 decompose="llm" 时使用。',
        },
        decomposeContext: {
          type: 'string',
          description: 'Optional: Additional context for the decomposer (e.g., current task description).\n可选：为分解器提供的额外上下文信息（如当前任务描述）。',
        },
        // ---- Phase-58: 三层差异化内容 ----
        contentL1: {
          type: 'string',
          description: 'Optional (Phase-58): L1 触点摘要（可选）\n\n极度精简的记忆摘要，作为记忆的"入口"或"触点"。\n如果提供，将用于 Anchor 的 description 和 FlowEntry 的 summary。',
        },
        contentL2: {
          type: 'string',
          description: 'Optional (Phase-58): L2 详细记忆（可选）\n\n包含关键技术细节和设计决策的详细记忆内容。\n如果提供，将用于 FlowEntry 的 detail。',
        },
        contentL3: {
          type: 'string',
          description: 'Optional (Phase-58): L3 完整内容（可选）\n\n原始文档的完整内容或其核心部分。\n如果提供，将用于 Memory 实体本身的 content 字段。',
        },
        // ---- Phase-57: 三维记忆参数 ----
        anchorName: {
          type: 'string',
          description: 'Optional (Phase-57): Explicitly specify the memory anchor (touch point) name. If omitted, auto-extracted from content.\n可选（Phase-57）：显式指定触点名称。不提供则自动从内容中提取。',
        },
        anchorType: {
          type: 'string',
          description: 'Optional (Phase-57): Anchor type — module | concept | api | architecture | feature | library | protocol. Default: concept.\n可选（Phase-57）：触点类型。默认 concept。',
        },
        anchorOverview: {
          type: 'string',
          description: 'Optional (Phase-63): Anchor overview — a 3~5 sentence directory-index summary listing key sub-items, core flow entries, and structural components. Similar to OpenViking .overview.md. Helps Agent quickly decide whether to dive deeper.\n可选（Phase-63）：触点概览 — 3~5句话的目录索引式摘要。',
        },
        changeType: {
          type: 'string',
          description: 'Optional (Phase-57): Change type — created | upgraded | modified | removed | deprecated. Auto-inferred if omitted.\n可选（Phase-57）：变更类型。不提供则自动推断（新触点=created，已有=modified）。',
        },
        structureComponents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              anchorId: { type: 'string', description: 'Component anchor ID' },
              role: { type: 'string', description: 'Component role (core | dependency | plugin etc.)' },
              versionHint: { type: 'string', description: 'Optional version hint' },
            },
            required: ['anchorId', 'role'],
          },
          description: 'Optional (Phase-57): Structure components for L3 structural snapshot. Each component references an existing Anchor ID + role.\n可选（Phase-57）：结构组件列表，用于创建 L3 结构快照。每个组件引用一个已有触点 ID + 角色。',
        },
      },
      required: ['projectName', 'memoryType', 'content'],
    },
  },
  {
    name: 'devplan_memory_recall',
    description: 'Intelligently recall memories relevant to a query using semantic vector search. Automatically updates hit counts for recalled memories. Falls back to literal matching when semantic search is unavailable.\n通过语义向量搜索智能召回与查询相关的记忆。自动更新被召回记忆的命中次数。语义搜索不可用时退化为字面匹配。\n\n**Unified Recall (统一召回)**: By default, also searches document sections and merges results via RRF fusion. Each result includes `sourceKind` ("memory" or "doc") to indicate its origin. Set `includeDocs=false` to search memories only.\n\n**Hierarchical Recall (分层召回, Phase-124)**: Controls information depth returned per result. Default "L1" returns only summaries (Anchor.description + overview). "L2" adds FlowEntry history. "L3" adds Structure Snapshot. Token savings: L1 ~30 tokens/result vs L3 ~500 tokens/result ≈ 16x reduction.\n\n**Scope-based Search (范围限定检索, Phase-124)**: Limits search scope by module, task, or anchor type/name. Multiple scope conditions are AND-combined.',
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
        memoryType: {
          type: 'string',
          enum: ['decision', 'pattern', 'bugfix', 'insight', 'preference', 'summary'],
          description: 'Optional: Filter by memory type\n可选：按记忆类型过滤',
        },
        limit: {
          type: 'number',
          description: 'Optional: Maximum results (default: 10)\n可选：最大返回数（默认 10）',
        },
        minScore: {
          type: 'number',
          description: 'Optional: Minimum relevance score 0~1 (default: 0)\n可选：最低相关性评分（默认 0）',
        },
        includeDocs: {
          type: 'boolean',
          description: 'Whether to include document sections in recall results via unified search (default: true). Set to false to search memories only.\n是否通过统一召回包含文档搜索结果（默认 true）。设为 false 仅搜索记忆。',
        },
        graphExpand: {
          type: 'boolean',
          description: 'Whether to expand results via MEMORY_RELATES graph traversal (default: true). When enabled, related memories connected through the memory network are also discovered and RRF-fused with vector results.\n是否通过 MEMORY_RELATES 图谱遍历扩展结果（默认 true）。启用时，通过记忆网络关联的记忆也会被发现并与向量结果 RRF 融合。',
        },
        depth: {
          type: 'string',
          enum: ['L1', 'L2', 'L3'],
          description: 'Hierarchical recall depth (default: "L1"). Controls how much context is returned per result.\n分层召回深度（默认 "L1"）。控制每条结果返回的上下文层级。\n\n- "L1" (default): Summary — memory content + Anchor.description + Anchor.overview. ~30 tokens/result.\n- "L2": Detail — adds FlowEntry list (summary + detail). ~200 tokens/result.\n- "L3": Full — adds Structure Snapshot (component composition). ~500 tokens/result.\n\nToken savings: 100 results × L1 ≈ 3K tokens vs L3 ≈ 50K tokens.',
        },
        scope: {
          type: 'object',
          description: 'Scope-based search filter (Phase-124). Limits search to specific modules, tasks, or anchor types.\n范围限定检索（Phase-124）。限制搜索范围到特定模块、任务或触点类型。\n\nMultiple conditions are AND-combined.\n多个条件为 AND 关系。',
          properties: {
            moduleId: {
              type: 'string',
              description: 'Filter by module ID (via MODULE_MEMORY relation). e.g., "vector-store"\n按模块 ID 过滤。例如 "vector-store"',
            },
            taskId: {
              type: 'string',
              description: 'Filter by related task ID (via relatedTaskId property). e.g., "phase-14"\n按关联任务 ID 过滤。例如 "phase-14"',
            },
            anchorType: {
              type: 'string',
              description: 'Filter by anchor type. Values: module | concept | api | architecture | feature | library | protocol\n按触点类型过滤。',
            },
            anchorName: {
              type: 'string',
              description: 'Filter by anchor name (exact match). e.g., "SocialGraphV2"\n按触点名称精确匹配。例如 "SocialGraphV2"',
            },
          },
        },
      },
      required: ['projectName', 'query'],
    },
  },
  {
    name: 'devplan_memory_list',
    description: 'List saved memories with optional filters.\n列出已保存的记忆，支持过滤。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        memoryType: {
          type: 'string',
          enum: ['decision', 'pattern', 'bugfix', 'insight', 'preference', 'summary'],
          description: 'Optional: Filter by memory type\n可选：按记忆类型过滤',
        },
        relatedTaskId: {
          type: 'string',
          description: 'Optional: Filter by related task ID\n可选：按关联任务 ID 过滤',
        },
        limit: {
          type: 'number',
          description: 'Optional: Maximum results (default: all)\n可选：最大返回数（默认全部）',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_memory_delete',
    description: 'Delete a specific memory entry by ID.\n按 ID 删除一条记忆。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        memoryId: {
          type: 'string',
          description: 'Memory ID to delete\n要删除的记忆 ID',
        },
      },
      required: ['projectName', 'memoryId'],
    },
  },
  {
    name: 'devplan_memory_clear',
    description: 'Batch clear all memories for a project. Optionally filter by memoryType. Use this before re-importing memories with the fixed batch generator.\n批量清除项目的所有记忆。可选按 memoryType 过滤。用于重新导入记忆前的清理。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        memoryType: {
          type: 'string',
          enum: ['decision', 'pattern', 'bugfix', 'insight', 'preference', 'summary'],
          description: 'Optional: Only clear memories of this type. Omit to clear ALL memories.\n可选：仅清除指定类型的记忆。省略则清除全部。',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion. Safety guard.\n必须为 true 以确认删除操作。安全保护。',
        },
      },
      required: ['projectName', 'confirm'],
    },
  },
  {
    name: 'devplan_memory_clusters',
    description: 'Get memory topic clusters based on MEMORY_RELATES graph connectivity. Automatically groups semantically related memories into themed clusters using connected component analysis. Returns cluster themes, member counts, and memory summaries.\n基于 MEMORY_RELATES 图谱连通性获取记忆主题集群。自动将语义关联的记忆按连通分量聚合为主题集群。返回集群主题、成员数量和记忆摘要。',
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
    name: 'devplan_memory_context',
    description: 'Get comprehensive project context for a new Cursor session. Aggregates recent tasks, relevant memories (via semantic search), project preferences, and recent decisions. This is the PRIMARY tool for session initialization.\n获取新 Cursor 会话的综合项目上下文。聚合最近任务、相关记忆（语义搜索）、项目偏好和最近决策。这是会话初始化的核心工具。\n\n**Unified Recall**: When a query is provided, automatically searches both memories AND documents, returning merged results. Also includes `relatedDocs` field with key document summaries (overview, core_concepts).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        query: {
          type: 'string',
          description: 'Optional: Query text for semantic memory recall\n可选：用于语义召回的查询文本',
        },
        maxMemories: {
          type: 'number',
          description: 'Optional: Maximum memories to include (default: 10)\n可选：最大记忆数（默认 10）',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_memory_generate',
    description: 'Generate memory candidates from existing documents and completed tasks. Returns structured candidates that the AI can review and selectively save as memories via devplan_memory_save. This tool aggregates raw data; the AI provides the intelligence to extract meaningful memories.\n从已有文档和已完成任务中生成记忆候选项。返回结构化候选项供 AI 审查后通过 devplan_memory_save 批量保存为记忆。此工具聚合原始数据，AI 负责提取有意义的记忆。\n\n**Batch AI Workflow (批量 AI 处理工作流)**:\nWhen user says "批量生成记忆" / "全量导入记忆" / "batch generate memories":\n1. Call this tool with limit=5 to get a small batch\n2. For EACH candidate: read its content, extract 1-3 key insights, determine the best memoryType\n3. Call devplan_memory_save for each with AI-refined content (concise, 1-3 sentences), **MUST pass sourceId from candidate.sourceId**\n4. Check stats.remaining — if > 0, repeat from step 1\n5. Continue until remaining === 0\n\n**Memory Tree / suggestedRelations (记忆树 / 建议关联)**:\nEach candidate may include a `suggestedRelations` array with `{ targetSourceId, relationType, weight, reason }` entries.\nThese represent inferred connections between candidates (e.g., task→doc DERIVED_FROM, consecutive phases TEMPORAL_NEXT, same-module RELATES).\n`targetSourceId` references another candidate\'s `sourceId`. After saving all memories, map sourceId→entityId and build relations via the graph.\nThis transforms flat memories into a connected Memory Tree graph.\n\n**CRITICAL — sourceId dedup tracking**: Each candidate has a `sourceId` field (e.g., "phase-7" for tasks, "overview" or "technical_notes|security" for docs). When calling devplan_memory_save, you MUST pass `sourceId: candidate.sourceId` so that subsequent calls to devplan_memory_generate can skip already-processed sources. Without sourceId, the same candidates will keep appearing.\n\nThe stats.remaining field tells how many more eligible candidates exist beyond the current batch.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        source: {
          type: 'string',
          enum: ['tasks', 'docs', 'both'],
          description: 'Data source: "tasks" for completed phases, "docs" for documents, "both" for all (default: "both")\n数据源："tasks" 已完成阶段、"docs" 文档、"both" 全部（默认 "both"）',
        },
        taskId: {
          type: 'string',
          description: 'Optional: Extract from a specific phase only (e.g., "phase-7")\n可选：仅从指定阶段提取（如 "phase-7"）',
        },
        section: {
          type: 'string',
          description: 'Optional: Extract from a specific document section only\n可选：仅从指定文档章节提取',
        },
        subSection: {
          type: 'string',
          description: 'Optional: Extract from a specific document sub-section\n可选：仅从指定子章节提取',
        },
        limit: {
          type: 'number',
          description: 'Optional: Maximum candidates to return (default: 50). For AI batch workflow, use limit=5 to process in small batches. stats.remaining shows how many more are available.\n可选：最大候选项数（默认 50）。AI 批量工作流建议用 limit=5 分小批处理。stats.remaining 显示剩余待处理数。',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_memory_lifecycle',
    description: 'Run memory lifecycle management scan using DynamicNode promote/demote. Long-idle memories are demoted to shadow state (excluded from vector search but preserved in graph). Re-accessed memories are auto-promoted back. This implements biological memory forgetting and reinforcement.\n运行记忆生命周期管理扫描。长期未访问的记忆降级为 shadow 状态（不参与向量搜索但保留在图谱中），被重新访问时自动恢复。实现生物记忆的遗忘与强化机制。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        demoteIdleTimeoutSecs: {
          type: 'number',
          description: 'Idle seconds before demotion to shadow (default: 2592000 = 30 days)\n降级前的闲置秒数（默认 2592000 = 30 天）',
        },
        promoteHitThreshold: {
          type: 'number',
          description: 'Minimum hit count to promote from shadow (default: 3)\n从 shadow 恢复的最低命中次数（默认 3）',
        },
      },
      required: ['projectName'],
    },
  },
  // ========== Phase-57: 三维记忆 MCP 工具 ==========
  {
    name: 'devplan_anchor_list',
    description: 'List all registered memory anchors (touch points) in the project. Anchors represent unique entities tracked by the memory system — modules, concepts, APIs, features, etc. Each anchor has a memory flow recording its evolution.\n列出项目中所有已注册的记忆触点。触点代表记忆系统跟踪的唯一实体（模块、概念、API、功能等），每个触点关联一个记忆流记录其演变历程。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        anchorType: {
          type: 'string',
          description: 'Optional: Filter by anchor type (module | concept | api | architecture | feature | library | protocol). Omit to list all.\n可选：按触点类型过滤。省略则列出全部。',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_flow_query',
    description: 'Query the memory flow (evolution history) of a specific anchor. Returns chronological entries showing how the entity was created, modified, upgraded, or deprecated over time.\n查询指定触点的记忆流（演变历史）。返回按时间排列的条目，展示实体的创建、修改、升级或废弃过程。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        anchorName: {
          type: 'string',
          description: 'Anchor name to query flow for\n要查询记忆流的触点名称',
        },
        anchorType: {
          type: 'string',
          description: 'Optional: Anchor type for disambiguation\n可选：触点类型（用于消歧义）',
        },
        changeType: {
          type: 'string',
          description: 'Optional: Filter by change type (created | upgraded | modified | removed | deprecated)\n可选：按变更类型过滤',
        },
        limit: {
          type: 'number',
          description: 'Optional: Maximum entries to return (default: 20)\n可选：最大返回条目数（默认 20）',
        },
        newestFirst: {
          type: 'boolean',
          description: 'Optional: Sort newest first (default: true)\n可选：最新的排在前面（默认 true）',
        },
      },
      required: ['projectName', 'anchorName'],
    },
  },
  {
    name: 'devplan_structure_diff',
    description: 'Compare the structural composition of an anchor between two versions. Shows which components were added, removed, or changed. Useful for understanding how a feature or module evolved structurally.\n比较触点在两个版本之间的结构组成差异。显示哪些组件被添加、移除或修改。用于理解功能或模块的结构性演变。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        anchorName: {
          type: 'string',
          description: 'Anchor name to diff structure for\n要比较结构差异的触点名称',
        },
        anchorType: {
          type: 'string',
          description: 'Optional: Anchor type for disambiguation\n可选：触点类型（用于消歧义）',
        },
        fromVersion: {
          type: 'number',
          description: 'Optional: Start version (default: current - 1)\n可选：起始版本（默认：当前版本-1）',
        },
        toVersion: {
          type: 'number',
          description: 'Optional: End version (default: current)\n可选：结束版本（默认：当前版本）',
        },
      },
      required: ['projectName', 'anchorName'],
    },
  },
  {
    name: 'devplan_structure_create',
    description: 'Create a standalone L3 structure snapshot for an anchor, without creating a new memory. Describes the structural composition (dependencies/components) of a feature, module, or concept at its current version. If no FlowEntry exists yet, automatically creates one with changeType "modified".\n为触点创建独立的 L3 结构快照，无需创建新记忆。描述功能/模块/概念在当前版本的结构组成（依赖/组件）。如果尚无记忆流条目，会自动创建一条 changeType=modified 的条目。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        anchorName: {
          type: 'string',
          description: 'Anchor name to create structure for. Must already exist (use devplan_memory_save with anchorName to create one first).\n要创建结构的触点名称。必须已存在（先用 devplan_memory_save + anchorName 创建）。',
        },
        anchorType: {
          type: 'string',
          description: 'Optional: Anchor type for disambiguation\n可选：触点类型（用于消歧义）',
        },
        components: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              anchorId: { type: 'string', description: 'Component anchor ID (use devplan_anchor_list to find IDs)\n组件触点 ID（可用 devplan_anchor_list 查找）' },
              role: { type: 'string', description: 'Component role: core | dependency | plugin | adapter | util etc.\n组件角色' },
              versionHint: { type: 'string', description: 'Optional: Version hint for this component\n可选：组件版本提示' },
            },
            required: ['anchorId', 'role'],
          },
          description: 'Structure components — each references an existing anchor ID + role. Use devplan_anchor_list to find anchor IDs.\n结构组件列表 — 每个引用一个已有触点 ID + 角色。用 devplan_anchor_list 查找触点 ID。',
        },
        description: {
          type: 'string',
          description: 'Optional: Description of this structure snapshot (e.g., "v2 added vector store support")\n可选：此结构快照的描述',
        },
      },
      required: ['projectName', 'anchorName', 'components'],
    },
  },
  // ========== Phase-57B: 触点驱动记忆构建工具集 ==========
  {
    name: 'devplan_anchor_create',
    description: 'Create an anchor (touch point) independently, without creating a memory. Use this in the "Anchor-Driven" memory construction workflow to plan the anchor index FIRST, then build memories around each anchor.\n独立创建触点（不绑定记忆）。用于"触点驱动"记忆构建流程：先规划触点索引，再围绕每个触点构建多级记忆。\n\nTypical workflow:\n1. devplan_anchor_create(name, type) — register the anchor\n2. devplan_memory_save(anchorName=...) — attach memories to it\n3. devplan_structure_create(anchorName=...) — define its components\n4. devplan_anchor_query(anchorName=...) — verify the full picture',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        anchorName: {
          type: 'string',
          description: 'Anchor name (must be unique within the same type)\n触点名称（同类型内唯一）',
        },
        anchorType: {
          type: 'string',
          description: 'Anchor type: module | concept | api | architecture | feature | library | protocol. Default: concept.\n触点类型。默认 concept。',
        },
        description: {
          type: 'string',
          description: 'Short description of this anchor\n触点的简短描述',
        },
        anchorOverview: {
          type: 'string',
          description: 'Optional (Phase-63): Anchor overview — a 3~5 sentence directory-index summary. Similar to OpenViking .overview.md.\n可选（Phase-63）：触点概览 — 3~5句话的目录索引式摘要。',
        },
        changeType: {
          type: 'string',
          description: 'Optional: Initial change type for the first FlowEntry. Default: "created".\n可选：首条记忆流的变更类型。默认 "created"。',
        },
        flowSummary: {
          type: 'string',
          description: 'Optional: Summary for the initial FlowEntry. Default: uses description.\n可选：首条记忆流的摘要。默认使用 description。',
        },
        flowDetail: {
          type: 'string',
          description: 'Optional: Detail text for the initial FlowEntry.\n可选：首条记忆流的详细内容。',
        },
      },
      required: ['projectName', 'anchorName'],
    },
  },
  {
    name: 'devplan_anchor_query',
    description: 'Query complete information for an anchor: basic info + memory flow history + current structure snapshot + parent structures that contain this anchor as a component. This is the "360° view" of a touch point.\n查询触点的完整信息：基本信息 + 记忆流历史 + 当前结构快照 + 包含此触点的父级结构链。这是触点的"360°视图"。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        anchorName: {
          type: 'string',
          description: 'Anchor name to query\n要查询的触点名称',
        },
        anchorType: {
          type: 'string',
          description: 'Optional: Anchor type for disambiguation\n可选：触点类型（用于消歧义）',
        },
        includeFlow: {
          type: 'boolean',
          description: 'Optional: Include memory flow entries (default: true)\n可选：是否包含记忆流（默认 true）',
        },
        includeStructure: {
          type: 'boolean',
          description: 'Optional: Include current structure snapshot (default: true)\n可选：是否包含当前结构快照（默认 true）',
        },
        includeParents: {
          type: 'boolean',
          description: 'Optional: Include parent structures that contain this anchor (default: true)\n可选：是否包含包含此触点的父级结构（默认 true）',
        },
        flowLimit: {
          type: 'number',
          description: 'Optional: Maximum flow entries to return (default: 20)\n可选：最大记忆流条目数（默认 20）',
        },
      },
      required: ['projectName', 'anchorName'],
    },
  },
  {
    name: 'devplan_structure_affected_by',
    description: 'Reverse structure query: find all parent anchors that include the specified anchor as a component in their structure. Answers "which features/modules depend on this component?".\n结构反向查询：查找所有在其结构中包含指定触点作为组件的父级触点。回答"哪些功能/模块依赖此组件？"',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        anchorName: {
          type: 'string',
          description: 'Component anchor name to check\n要检查的组件触点名称',
        },
        anchorType: {
          type: 'string',
          description: 'Optional: Anchor type for disambiguation\n可选：触点类型（用于消歧义）',
        },
      },
      required: ['projectName', 'anchorName'],
    },
  },
  {
    name: 'devplan_llm_analyze',
    description: 'Use local Ollama LLM to analyze text and return structured JSON. Supports multiple analysis modes for anchor-driven memory construction.\n使用本地 Ollama LLM 分析文本并返回结构化 JSON。支持多种分析模式用于触点驱动记忆构建。\n\nAnalysis modes:\n- "extract_anchors": Extract anchor candidates from a document/task description\n- "determine_change": Determine change type (created/upgraded/modified) for an anchor based on content\n- "build_structure": Analyze structural composition of a feature/module\n- "generate_memory": Generate multi-level memory content (L1 summary + L2 detail) for an anchor\n- "custom": Free-form analysis with custom prompt\n\nRequires Ollama running locally (default: http://localhost:11434/v1).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        mode: {
          type: 'string',
          enum: ['extract_anchors', 'determine_change', 'build_structure', 'generate_memory', 'custom'],
          description: 'Analysis mode\n分析模式',
        },
        content: {
          type: 'string',
          description: 'Text content to analyze\n要分析的文本内容',
        },
        anchorName: {
          type: 'string',
          description: 'Optional: Anchor name context (for determine_change, build_structure, generate_memory modes)\n可选：触点名称上下文',
        },
        model: {
          type: 'string',
          description: 'Optional: Ollama model to use (default: "qwen3:8b")\n可选：使用的 Ollama 模型（默认 "qwen3:8b"）',
        },
        customPrompt: {
          type: 'string',
          description: 'Optional: Custom system prompt (for "custom" mode)\n可选：自定义系统提示（仅 "custom" 模式）',
        },
        baseUrl: {
          type: 'string',
          description: 'Optional: Ollama API base URL (default: "http://localhost:11434/v1")\n可选：Ollama API 地址',
        },
      },
      required: ['projectName', 'mode', 'content'],
    },
  },
  // ========== Phase-59: 分相批量记忆导入 ==========
  {
    name: 'devplan_memory_batch_prepare',
    description: 'Phase A of batch memory import pipeline. Fetches all memory candidates, calls LLM (Ollama/online) to generate L1/L2/L3 content for each, and caches results to a local JSON file. The LLM model stays loaded throughout — no model swapping. After Phase A completes, call devplan_memory_batch_commit for Phase B.\n分相批量记忆导入的 Phase A。获取所有记忆候选项，调用 LLM（Ollama/在线模型）为每个候选项生成 L1/L2/L3 内容，结果缓存到本地 JSON 文件。LLM 模型全程保持加载，避免模型交换。Phase A 完成后调用 devplan_memory_batch_commit 执行 Phase B。\n\n**Pipeline (流水线)**:\n```\nPhase A (this tool): gemma3 一次加载 → 处理全部候选 → 缓存到文件\n                    ═══ 唯一一次模型交换 ═══\nPhase B (batch_commit): qwen3-embedding 一次加载 → 批量保存+embedding\n```\nSpeed: ~5x faster than sequential processing (290 swaps → 1 swap).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        source: {
          type: 'string',
          enum: ['tasks', 'docs', 'both'],
          description: 'Data source: "tasks" for completed phases, "docs" for documents, "both" for all (default: "both")\n数据源（默认 "both"）',
        },
        limit: {
          type: 'number',
          description: 'Maximum candidates to process in this batch. **limit=0: 后台自动工作流** — 启动后台循环自动处理所有候选，立即返回，用 batch_status 查看实时进度。limit>0: 同步处理指定数量。(default: 1)\n本批处理的最大候选数。**0=后台自动全部处理**。默认每次 1 个。',
        },
        resume: {
          type: 'boolean',
          description: 'If true, resume from existing cache (skip already prepared entries). If false, start fresh. (default: true)\n是否从已有缓存续接。false 则重新开始。',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_memory_batch_commit',
    description: 'Phase B of batch memory import pipeline. Reads the cache file generated by devplan_memory_batch_prepare, then saves each entry as a memory (triggering embedding generation). The embedding model stays loaded throughout.\n分相批量记忆导入的 Phase B。读取 Phase A 生成的缓存文件，逐条保存为记忆（触发 embedding 生成）。Embedding 模型全程保持加载。\n\nCall devplan_memory_batch_prepare first to populate the cache.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        limit: {
          type: 'number',
          description: 'Maximum entries to commit in this call. **limit=0: 后台自动工作流** — 启动后台循环自动提交所有条目，立即返回，用 batch_status 查看进度。limit>0: 同步处理指定数量。(default: 10)\n本次提交的最大条目数。**0=后台自动全部处理**。默认每次 10 条。',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, only report what would be committed without actually saving. (default: false)\n仅预览不保存。',
        },
      },
      required: ['projectName'],
    },
  },
  {
    name: 'devplan_memory_batch_status',
    description: 'Query the status of the batch memory import cache. Shows Phase A (prepare) and Phase B (commit) progress, entry counts, and engine/model info.\n查询批量记忆导入缓存的状态。显示 Phase A 和 Phase B 的进度、条目数、引擎/模型信息。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        clear: {
          type: 'boolean',
          description: 'If true, delete the cache file after reporting status. (default: false)\n如果为 true，报告状态后删除缓存文件。',
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
  scope?: string | { moduleId?: string; taskId?: string; anchorType?: string; anchorName?: string };
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
  /** devplan_save_prompt: AI 对用户输入的理解 */
  aiInterpretation?: string;
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
  /** devplan_memory_save: 记忆类型 */
  memoryType?: string;
  /** devplan_memory_save: 重要性评分 (0~1) */
  importance?: number;
  /** devplan_memory_delete: 记忆 ID */
  memoryId?: string;
  /** devplan_memory_context: 最大记忆数 */
  maxMemories?: number;
  /** devplan_memory_save: 记忆来源 */
  source?: string;
  /** devplan_memory_save: 记忆来源 ID（用于批量生成去重追踪） */
  sourceId?: string;
  /** devplan_memory_recall: 是否包含文档统一召回 */
  includeDocs?: boolean;
  /** devplan_memory_recall: 是否启用图谱关联扩展 (Phase-38) */
  graphExpand?: boolean;
  /** Phase-124: devplan_memory_recall: 分层召回深度 (L1/L2/L3) */
  depth?: string;
  /** devplan_memory_clear: 确认删除（安全保护） */
  confirm?: boolean;
  /** Phase-47: devplan_memory_save: 记忆分解模式 */
  decompose?: string;
  /** Phase-47: devplan_memory_save: LLM 分解结果 JSON */
  llmDecompositionJson?: string;
  /** Phase-47: devplan_memory_save: 分解器上下文 */
  decomposeContext?: string;
  /** Phase-57: devplan_anchor_list / devplan_flow_query / devplan_memory_save: 触点类型 */
  anchorType?: string;
  /** Phase-57: devplan_flow_query / devplan_memory_save: 触点名称 */
  anchorName?: string;
  /** Phase-57: devplan_flow_query / devplan_memory_save: 变更类型 */
  changeType?: string;
  /** Phase-57: devplan_flow_query: 最新排前 */
  newestFirst?: boolean;
  /** Phase-57: devplan_structure_diff: 起始版本 */
  fromVersion?: number;
  /** Phase-57: devplan_structure_diff: 结束版本 */
  toVersion?: number;
  /** Phase-57: devplan_memory_save: 结构组件列表 (L3 结构快照) */
  structureComponents?: Array<{ anchorId: string; role: string; versionHint?: string }>;
  /** Phase-57: devplan_structure_create: 组件列表 */
  components?: Array<{ anchorId: string; role: string; versionHint?: string }>;
  /** Phase-63: devplan_memory_save / devplan_anchor_create: 触点概览（L2 目录索引） */
  anchorOverview?: string;
  /** Phase-63: devplan_anchor_create: overview 别名 */
  overview?: string;
  // ---- Phase-57B: 触点驱动工具集 ----
  /** devplan_anchor_create: 初始记忆流摘要 */
  flowSummary?: string;
  /** devplan_anchor_create: 初始记忆流详情 */
  flowDetail?: string;
  /** devplan_anchor_query: 是否包含记忆流 */
  includeFlow?: boolean;
  /** devplan_anchor_query: 是否包含结构快照 */
  includeStructure?: boolean;
  /** devplan_anchor_query: 是否包含父级结构 */
  includeParents?: boolean;
  /** devplan_anchor_query: 记忆流最大条目 */
  flowLimit?: number;
  /** devplan_llm_analyze: Ollama 模型名 */
  model?: string;
  /** devplan_llm_analyze: 自定义系统 prompt */
  customPrompt?: string;
  /** devplan_llm_analyze: Ollama API 地址 */
  baseUrl?: string;
  // ---- Phase-58: 三层差异化内容 ----
  /** Phase-58: L1 触点摘要 */
  contentL1?: string;
  /** Phase-58: L2 详细记忆 */
  contentL2?: string;
  /** Phase-58: L3 完整内容 */
  contentL3?: string;
  // ---- Phase-59: 分相批量记忆导入 ----
  /** Phase-59: batch_prepare 是否续接已有缓存 */
  resume?: boolean;
  /** Phase-59: batch_status 是否清理缓存文件 */
  clear?: boolean;
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

// ========== Phase-59B: 后台自动工作流状态 ==========
interface BackgroundTaskState {
  running: boolean;
  phase: 'A' | 'B';
  projectName: string;
  prepared: number;
  committed: number;
  total: number;
  errors: number;
  startedAt: number;
  lastProcessedAt: number;
  currentTitle: string;
  speed: string; // tok/s or items/s
}
let bgTask: BackgroundTaskState | null = null;

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
        // Phase-23: createMainTask 内部已幂等处理（upsertEntityByProp），无需额外检查
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
        // Phase-23: addSubTask 内部已幂等处理（upsertEntityByProp），无需额外检查
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

    case 'devplan_cleanup_duplicates': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const dryRun = args.dryRun ?? false;

      if (typeof (plan as any).cleanupDuplicates !== 'function') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Duplicate cleanup requires "graph" engine. Project "${args.projectName}" uses a different engine.`
        );
      }

      try {
        const result = (plan as any).cleanupDuplicates(dryRun);

        return JSON.stringify({
          success: true,
          dryRun,
          cleaned: result.cleaned,
          details: result.details,
          summary: result.cleaned === 0
            ? '✅ No duplicate entities found. WAL is clean.'
            : dryRun
              ? `⚠️ Found ${result.cleaned} duplicate entities (dry run, no changes made)`
              : `🧹 Cleaned ${result.cleaned} duplicate entities from WAL`,
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }

    case 'devplan_repair_counts': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      if (typeof (plan as any).repairAllMainTaskCounts !== 'function') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Repair counts requires "graph" engine. Project "${args.projectName}" uses a different engine.`
        );
      }

      try {
        const result = (plan as any).repairAllMainTaskCounts();
        return JSON.stringify({
          success: true,
          repaired: result.repaired,
          autoCompleted: result.autoCompleted,
          details: result.details,
          summary: result.repaired === 0
            ? '✅ All main task counts are correct. No repair needed.'
            : `🔧 Repaired ${result.repaired} main tasks (${result.autoCompleted} auto-completed)`,
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

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).savePrompt !== 'function') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Prompt logging requires "graph" engine. Project "${projectName}" uses a different engine.`
        );
      }

      const prompt = (plan as any).savePrompt({
        projectName,
        content,
        aiInterpretation: args.aiInterpretation,
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
      const plan = getDevPlan(projectName);

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

    // ==================================================================
    // Memory Tools (Cursor 长期记忆)
    // ==================================================================

    case 'devplan_memory_save': {
      // ======================================================================
      // 并发控制：通过 AsyncMutex 串行化 memory_save 操作
      //
      // 每次 saveMemory 会执行多次同步 NAPI embed 调用（各 ~200-500ms）。
      // 5 条并行请求会导致 10-25 秒连续事件循环阻塞 → Cursor 断连。
      // 互斥锁保证同一时刻只有 1 条 save 在执行，两条之间让出事件循环。
      // ======================================================================
      await memorySaveMutex.acquire();
      try {
        const projectName = args.projectName!;
        const content = args.content;
        const memoryType = args.memoryType;

        if (!content) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing required: content');
        }
        if (!memoryType) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing required: memoryType');
        }

        const validTypes = ['decision', 'pattern', 'bugfix', 'insight', 'preference', 'summary'];
        if (!validTypes.includes(memoryType)) {
          throw new McpError(ErrorCode.InvalidParams,
            `Invalid memoryType: "${memoryType}". Must be one of: ${validTypes.join(', ')}`);
        }

        const plan = getDevPlan(projectName);
        if (typeof (plan as any).saveMemory !== 'function') {
          throw new McpError(ErrorCode.InvalidRequest,
            `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
        }

        // Phase-47: 解析 decompose 参数
        let decompose: boolean | 'rule' | 'llm' | undefined;
        const decomposeArg = args.decompose as string | undefined;
        if (decomposeArg === 'true' || decomposeArg === 'rule') {
          decompose = 'rule';
        } else if (decomposeArg === 'llm') {
          decompose = 'llm';
        }

        const memory = (plan as any).saveMemory({
          projectName,
          content,
          memoryType: memoryType as any,
          importance: args.importance,
          tags: args.tags,
          relatedTaskId: args.relatedTaskId,
          sourceId: args.sourceId,
          moduleId: args.moduleId,
          source: args.source || 'cursor',
          decompose,
          llmDecompositionJson: args.llmDecompositionJson,
          decomposeContext: args.decomposeContext,
          // Phase-58: 三层差异化内容
          contentL1: args.contentL1,
          contentL2: args.contentL2,
          contentL3: args.contentL3,
          // Phase-57: 三维记忆参数
          anchorName: args.anchorName,
          anchorType: args.anchorType,
          anchorOverview: args.anchorOverview,
          changeType: args.changeType,
          structureComponents: args.structureComponents,
        });

        // Phase-51: 冲突信息摘要
        const result: Record<string, unknown> = {
          status: 'saved',
          memory,
        };
        if (memory.conflicts && memory.conflicts.length > 0) {
          result.conflictSummary = `⚠️ Detected ${memory.conflicts.length} conflict(s) with existing memories: ${
            memory.conflicts.map((c: any) =>
              `${c.conflictType} with ${c.existingEntityId} (similarity: ${(c.similarity * 100).toFixed(0)}%)`
            ).join('; ')
          }. Rust layer has automatically created SUPERSEDES/CONFLICTS relations.`;
        }

        return JSON.stringify(result, null, 2);
      } finally {
        memorySaveMutex.release();
      }
    }

    case 'devplan_memory_recall': {
      const projectName = args.projectName!;
      const query = args.query;

      if (!query) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: query');
      }

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).recallMemory !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const includeDocs = args.includeDocs !== undefined ? args.includeDocs : true;
      const graphExpand = args.graphExpand !== undefined ? args.graphExpand : true;
      const depth = args.depth || 'L1'; // Phase-124: 分层召回深度
      const scope = args.scope as { moduleId?: string; taskId?: string; anchorType?: string; anchorName?: string } | undefined;

      const memories = (plan as any).recallMemory(query, {
        memoryType: args.memoryType as any,
        limit: args.limit,
        minScore: args.minScore,
        includeDocs,
        graphExpand,
        depth,   // Phase-124: 传递分层召回深度
        scope,   // Phase-124: 传递范围限定条件
      });

      // 统计来源分布
      const memoryCount = memories.filter((m: any) => m.sourceKind === 'memory' || !m.sourceKind).length;
      const docCount = memories.filter((m: any) => m.sourceKind === 'doc').length;

      return JSON.stringify({
        projectName,
        query,
        count: memories.length,
        memoryCount,
        docCount,
        unifiedRecall: includeDocs,
        depth,   // Phase-124: 返回当前使用的层级
        scope: scope || null,  // Phase-124: 返回当前使用的范围
        memories,
      }, null, 2);
    }

    case 'devplan_memory_list': {
      const projectName = args.projectName!;

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).listMemories !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const memories = (plan as any).listMemories({
        memoryType: args.memoryType as any,
        limit: args.limit,
      });

      return JSON.stringify({
        projectName,
        count: memories.length,
        filter: {
          memoryType: args.memoryType || null,
          limit: args.limit || null,
        },
        memories,
      }, null, 2);
    }

    case 'devplan_memory_delete': {
      const projectName = args.projectName!;
      const memoryId = args.memoryId;

      if (!memoryId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: memoryId');
      }

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).deleteMemory !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const success = (plan as any).deleteMemory(memoryId);
      return JSON.stringify({
        status: success ? 'deleted' : 'not_found',
        memoryId,
      }, null, 2);
    }

    case 'devplan_memory_clear': {
      const projectName = args.projectName!;
      const confirm = args.confirm;

      if (confirm !== true) {
        throw new McpError(ErrorCode.InvalidParams,
          'Safety guard: confirm must be true to clear memories. Set confirm: true to proceed.');
      }

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).clearAllMemories !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const memoryType = args.memoryType as string | undefined;
      const result = (plan as any).clearAllMemories(memoryType);
      return JSON.stringify({
        status: 'cleared',
        ...result,
        memoryType: memoryType || 'all',
        projectName,
      }, null, 2);
    }

    case 'devplan_memory_clusters': {
      const projectName = args.projectName!;

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).getMemoryClusters !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory clusters require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const clusters = (plan as any).getMemoryClusters();
      const totalMemories = clusters.reduce(
        (sum: number, c: any) => sum + c.memoryCount, 0
      );

      return JSON.stringify({
        projectName,
        totalClusters: clusters.length,
        totalMemories,
        clusters: clusters.map((c: any) => ({
          clusterId: c.clusterId,
          theme: c.theme,
          memoryCount: c.memoryCount,
          topMemoryTypes: c.topMemoryTypes,
          memories: c.memories.map((m: any) => ({
            id: m.id,
            memoryType: m.memoryType,
            content: m.content.length > 100 ? m.content.slice(0, 100) + '...' : m.content,
            importance: m.importance,
            tags: m.tags,
          })),
        })),
      }, null, 2);
    }

    case 'devplan_memory_context': {
      const projectName = args.projectName!;

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).getMemoryContext !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const context = (plan as any).getMemoryContext(
        args.query,
        args.maxMemories,
      );

      return JSON.stringify({
        projectName,
        context,
      }, null, 2);
    }

    case 'devplan_memory_generate': {
      const projectName = args.projectName!;

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).generateMemoryCandidates !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory generation requires "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const result = (plan as any).generateMemoryCandidates({
        source: args.source as any,
        taskId: args.taskId,
        section: args.section,
        subSection: args.subSection,
        limit: args.limit,
      });

      return JSON.stringify(result, null, 2);
    }

    case 'devplan_memory_lifecycle': {
      const projectName = args.projectName!;

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).runMemoryLifecycle !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory lifecycle requires "graph" engine with dynamicScan support. Project "${projectName}" may use a different engine or older aifastdb version.`);
      }

      const report = (plan as any).runMemoryLifecycle({
        demoteIdleTimeoutSecs: (args as any).demoteIdleTimeoutSecs,
        promoteHitThreshold: (args as any).promoteHitThreshold,
      });

      if (report === null) {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Memory lifecycle scan not available. Please upgrade to aifastdb >= 2.8.0.',
        });
      }

      // Phase-50: 包含 Rust 原生 memoryTreeLifecycle 的额外字段
      const extras: string[] = [];
      if (report.summariesCreated) extras.push(`${report.summariesCreated} summaries created`);
      if (report.hebbianUpdates) extras.push(`${report.hebbianUpdates} Hebbian updates`);
      const extrasStr = extras.length > 0 ? `, ${extras.join(', ')}` : '';

      return JSON.stringify({
        status: 'completed',
        projectName,
        report,
        message: `Scanned ${report.scanned} memories: ${report.promoted} promoted, ${report.demoted} demoted${extrasStr} (${report.durationMs}ms)`,
      });
    }

    // ========== Phase-57: 三维记忆 MCP 工具处理器 ==========

    case 'devplan_anchor_list': {
      const projectName = args.projectName!;
      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorList !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Anchor API requires aifastdb with Phase-122 NAPI bindings. Please update aifastdb and rebuild.',
          anchors: [],
        });
      }

      const anchorTypes = args.anchorType
        ? [args.anchorType]
        : ['module', 'concept', 'api', 'architecture', 'feature', 'library', 'protocol'];

      const allAnchors: any[] = [];
      for (const aType of anchorTypes) {
        try {
          const anchors = g.anchorList(aType);
          if (anchors && anchors.length > 0) {
            allAnchors.push(...anchors);
          }
        } catch {
          // 该类型无触点，静默跳过
        }
      }

      // 按 flow_count 降序排列
      allAnchors.sort((a: any, b: any) => (b.flow_count || 0) - (a.flow_count || 0));

      return JSON.stringify({
        status: 'ok',
        projectName,
        totalAnchors: allAnchors.length,
        anchors: allAnchors.map((a: any) => ({
          id: a.id,
          name: a.name,
          type: a.anchor_type,
          description: a.description,
          overview: a.overview || null,
          version: a.version,
          status: a.status,
          flowCount: a.flow_count,
          createdAt: a.created_at,
          updatedAt: a.updated_at,
        })),
      });
    }

    case 'devplan_flow_query': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;
      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorFindByName !== 'function' || typeof g.flowQuery !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Flow query requires aifastdb with Phase-122 NAPI bindings.',
          entries: [],
        });
      }

      // 查找触点
      let anchor: any = null;
      try {
        if (args.anchorType) {
          anchor = g.anchorFind(anchorName, args.anchorType);
        } else {
          anchor = g.anchorFindByName(anchorName);
        }
      } catch {
        // 未找到
      }

      if (!anchor) {
        return JSON.stringify({
          status: 'not_found',
          message: `Anchor "${anchorName}" not found.`,
          entries: [],
        });
      }

      // 查询记忆流
      let entries: any[] = [];
      try {
        const filter: any = {};
        if (args.changeType) filter.changeType = args.changeType;
        if (args.limit) filter.limit = args.limit;
        filter.newestFirst = args.newestFirst !== false; // 默认 true
        entries = g.flowQuery(anchor.id, filter) || [];
      } catch (e) {
        return JSON.stringify({
          status: 'error',
          message: `Flow query failed: ${e instanceof Error ? e.message : String(e)}`,
          entries: [],
        });
      }

      return JSON.stringify({
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name,
          type: anchor.anchor_type,
          version: anchor.version,
          status: anchor.status,
          flowCount: anchor.flow_count,
        },
        totalEntries: entries.length,
        entries: entries.map((e: any) => ({
          id: e.id,
          version: e.version,
          changeType: e.change_type,
          summary: e.summary,
          detail: e.detail,
          sourceTask: e.source_task,
          prevEntryId: e.prev_entry_id,
          createdAt: e.created_at,
        })),
      });
    }

    case 'devplan_structure_diff': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;
      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorFindByName !== 'function' || typeof g.structureDiff !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Structure diff requires aifastdb with Phase-122 NAPI bindings.',
        });
      }

      // 查找触点
      let anchor: any = null;
      try {
        if (args.anchorType) {
          anchor = g.anchorFind(anchorName, args.anchorType);
        } else {
          anchor = g.anchorFindByName(anchorName);
        }
      } catch {
        // 未找到
      }

      if (!anchor) {
        return JSON.stringify({
          status: 'not_found',
          message: `Anchor "${anchorName}" not found.`,
        });
      }

      // 结构差异比较
      const fromVersion = args.fromVersion ?? Math.max(1, (anchor.version || 1) - 1);
      const toVersion = args.toVersion ?? (anchor.version || 1);

      let diff: any = null;
      try {
        diff = g.structureDiff(anchor.id, fromVersion, toVersion);
      } catch (e) {
        return JSON.stringify({
          status: 'error',
          message: `Structure diff failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      if (!diff) {
        return JSON.stringify({
          status: 'no_data',
          message: `No structure snapshots found for "${anchorName}" between versions ${fromVersion} and ${toVersion}.`,
          anchor: { id: anchor.id, name: anchor.name, version: anchor.version },
        });
      }

      return JSON.stringify({
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name,
          type: anchor.anchor_type,
          version: anchor.version,
        },
        diff: {
          fromVersion: diff.from_version,
          toVersion: diff.to_version,
          added: diff.added || [],
          removed: diff.removed || [],
          changed: diff.changed || [],
          unchanged: diff.unchanged || [],
        },
        summary: `${(diff.added || []).length} added, ${(diff.removed || []).length} removed, ${(diff.changed || []).length} changed, ${(diff.unchanged || []).length} unchanged`,
      });
    }

    case 'devplan_structure_create': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;
      const components = args.components;

      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }
      if (!components || components.length === 0) {
        throw new McpError(ErrorCode.InvalidParams, 'components is required and must be non-empty');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorFindByName !== 'function' || typeof g.structureSnapshot !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Structure create requires aifastdb with Phase-122 NAPI bindings.',
        });
      }

      // Step 1: 查找触点
      let anchor: any = null;
      try {
        if (args.anchorType) {
          anchor = g.anchorFind(anchorName, args.anchorType);
        } else {
          anchor = g.anchorFindByName(anchorName);
        }
      } catch { /* 未找到 */ }

      if (!anchor) {
        return JSON.stringify({
          status: 'not_found',
          message: `Anchor "${anchorName}" not found. Create it first with devplan_memory_save(anchorName: "${anchorName}").`,
        });
      }

      // Step 2: 获取或创建 FlowEntry（L3 结构快照必须关联一个 L2 流条目）
      let flowEntry: any = null;
      try {
        // 尝试获取最新的流条目
        flowEntry = g.flowLatest(anchor.id);
      } catch { /* 无流条目 */ }

      if (!flowEntry) {
        // 自动创建一条流条目，用于挂载结构快照
        try {
          const desc = args.description || `Structure snapshot for ${anchorName}`;
          flowEntry = g.flowAppend(
            anchor.id,
            'modified',
            desc.slice(0, 80),
            desc,
            null, // sourceTask
          );
        } catch (e) {
          return JSON.stringify({
            status: 'error',
            message: `Failed to create FlowEntry for structure: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }

      if (!flowEntry) {
        return JSON.stringify({
          status: 'error',
          message: 'Could not find or create a FlowEntry to attach the structure snapshot.',
        });
      }

      // Step 3: 创建结构快照
      let snapshot: any = null;
      try {
        snapshot = g.structureSnapshot(
          flowEntry.id,
          anchor.id,
          flowEntry.version || anchor.version || 1,
          components.map((c: any) => ({
            anchorId: c.anchorId,
            role: c.role,
            versionHint: c.versionHint,
          })),
        );
      } catch (e) {
        return JSON.stringify({
          status: 'error',
          message: `structureSnapshot failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      if (!snapshot) {
        return JSON.stringify({
          status: 'error',
          message: 'structureSnapshot returned null — possible NAPI compatibility issue.',
        });
      }

      return JSON.stringify({
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name,
          type: anchor.anchor_type,
          version: anchor.version,
        },
        flowEntry: {
          id: flowEntry.id,
          version: flowEntry.version,
          changeType: flowEntry.change_type,
        },
        snapshot: {
          id: snapshot.id,
          version: snapshot.version,
          componentsCount: snapshot.components?.length || components.length,
          components: snapshot.components || components,
        },
        message: `Structure snapshot created for "${anchorName}" with ${components.length} components at version ${flowEntry.version || anchor.version || 1}.`,
      });
    }

    // ==================================================================
    // Phase-57B: 触点驱动记忆构建工具集
    // ==================================================================

    case 'devplan_anchor_create': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;
      const anchorType = args.anchorType || 'concept';
      const description = args.description || '';

      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorUpsert !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Anchor create requires aifastdb with Phase-122 NAPI bindings.',
        });
      }

      // Step 1: 检查触点是否已存在
      let existing: any = null;
      try {
        existing = g.anchorFind(anchorName, anchorType);
      } catch { /* not found */ }

      if (existing) {
        return JSON.stringify({
          status: 'already_exists',
          projectName,
          anchor: {
            id: existing.id,
            name: existing.name,
            type: existing.anchor_type || anchorType,
            version: existing.version,
            description: existing.description,
          },
          message: `Anchor "${anchorName}" (type: ${anchorType}) already exists. Use devplan_memory_save(anchorName=...) to attach memories, or devplan_anchor_query to view full info.`,
        });
      }

      // Step 2: 创建触点
      let anchor: any = null;
      try {
        anchor = g.anchorUpsert(anchorName, anchorType, description || anchorName);
      } catch (e) {
        return JSON.stringify({
          status: 'error',
          message: `anchorUpsert failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      if (!anchor) {
        return JSON.stringify({
          status: 'error',
          message: 'anchorUpsert returned null — possible NAPI compatibility issue.',
        });
      }

      // Step 2.5 (Phase-63): 设置 Anchor Overview（如果提供）
      const anchorOverview = args.anchorOverview || args.overview;
      if (anchorOverview && typeof g.anchorUpdateOverview === 'function') {
        try {
          g.anchorUpdateOverview(anchor.id, anchorOverview);
        } catch (e) {
          console.warn(`[devplan_anchor_create] anchorUpdateOverview failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Step 3: 可选 — 创建初始 FlowEntry
      let flowEntry: any = null;
      const changeType = args.changeType || 'created';
      const flowSummary = args.flowSummary || description || `${anchorName} ${changeType}`;
      const flowDetail = args.flowDetail || '';

      try {
        flowEntry = g.flowAppend(
          anchor.id,
          changeType,
          flowSummary.slice(0, 80),
          flowDetail || flowSummary,
          null, // sourceTask
        );
      } catch (e) {
        // FlowEntry 创建失败不是致命错误
        console.warn(`[devplan_anchor_create] FlowEntry creation failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      }

      return JSON.stringify({
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name || anchorName,
          type: anchor.anchor_type || anchorType,
          version: anchor.version || 1,
          description: anchor.description || description,
          overview: anchorOverview || anchor.overview || null,
        },
        flowEntry: flowEntry ? {
          id: flowEntry.id,
          version: flowEntry.version,
          changeType: flowEntry.change_type || changeType,
          summary: flowEntry.summary,
        } : null,
        message: `Anchor "${anchorName}" created (type: ${anchorType}).${flowEntry ? ` Initial FlowEntry (${changeType}) attached.` : ''}${anchorOverview ? ' Overview set.' : ''} Next: use devplan_memory_save(anchorName="${anchorName}") to build memories.`,
      });
    }

    case 'devplan_anchor_query': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;
      const includeFlow = args.includeFlow !== false; // default true
      const includeStructure = args.includeStructure !== false; // default true
      const includeParents = args.includeParents !== false; // default true
      const flowLimit = args.flowLimit || 20;

      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.anchorFindByName !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Anchor query requires aifastdb with Phase-122 NAPI bindings.',
        });
      }

      // Step 1: 查找触点
      let anchor: any = null;
      try {
        if (args.anchorType) {
          anchor = g.anchorFind(anchorName, args.anchorType);
        } else {
          anchor = g.anchorFindByName(anchorName);
        }
      } catch { /* not found */ }

      if (!anchor) {
        return JSON.stringify({
          status: 'not_found',
          message: `Anchor "${anchorName}" not found.${args.anchorType ? ` (type: ${args.anchorType})` : ''} Use devplan_anchor_create to create it first.`,
        });
      }

      const result: any = {
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name,
          type: anchor.anchor_type,
          version: anchor.version,
          description: anchor.description,
          overview: anchor.overview || null,
          status: anchor.status,
          createdAt: anchor.created_at,
          updatedAt: anchor.updated_at,
        },
      };

      // Step 2: 记忆流
      if (includeFlow) {
        try {
          const flowEntries = g.flowQuery(anchor.id, null, flowLimit, false);
          result.flow = {
            count: flowEntries?.length || 0,
            entries: (flowEntries || []).map((e: any) => ({
              id: e.id,
              version: e.version,
              changeType: e.change_type,
              summary: e.summary,
              detail: e.detail,
              createdAt: e.created_at,
            })),
          };
        } catch (e) {
          result.flow = { count: 0, entries: [], error: String(e) };
        }
      }

      // Step 3: 当前结构快照
      if (includeStructure) {
        try {
          const structure = g.structureCurrent(anchor.id);
          if (structure) {
            result.structure = {
              id: structure.id,
              version: structure.version,
              components: structure.components || [],
              createdAt: structure.created_at,
            };
          } else {
            result.structure = null;
          }
        } catch {
          result.structure = null;
        }
      }

      // Step 4: 父级结构链（反向查询）
      if (includeParents) {
        try {
          const parents = g.structureAffectedBy(anchor.id);
          result.parentStructures = (parents || []).map((p: any) => ({
            anchorId: p.anchor_id || p.anchorId || p.id,
            anchorName: p.anchor_name || p.anchorName || p.name,
            role: p.role,
          }));
        } catch {
          result.parentStructures = [];
        }
      }

      // 构建摘要
      const flowCount = result.flow?.count || 0;
      const structCount = result.structure?.components?.length || 0;
      const parentCount = result.parentStructures?.length || 0;
      result.summary = `Anchor "${anchorName}" (${anchor.anchor_type}): v${anchor.version || 1} | ${flowCount} flow entries | ${structCount} components | referenced by ${parentCount} parent structures`;

      return JSON.stringify(result);
    }

    case 'devplan_structure_affected_by': {
      const projectName = args.projectName!;
      const anchorName = args.anchorName;

      if (!anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'anchorName is required');
      }

      const plan = getDevPlan(projectName);
      const g = (plan as any).graph as any;

      if (!g || typeof g.structureAffectedBy !== 'function') {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Structure affected-by query requires aifastdb with Phase-122 NAPI bindings.',
        });
      }

      // 先查找触点
      let anchor: any = null;
      try {
        if (args.anchorType) {
          anchor = g.anchorFind(anchorName, args.anchorType);
        } else {
          anchor = g.anchorFindByName(anchorName);
        }
      } catch { /* not found */ }

      if (!anchor) {
        return JSON.stringify({
          status: 'not_found',
          message: `Anchor "${anchorName}" not found.`,
        });
      }

      // 反向查询
      let parents: any[] = [];
      try {
        parents = g.structureAffectedBy(anchor.id) || [];
      } catch (e) {
        return JSON.stringify({
          status: 'error',
          message: `structureAffectedBy failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      // 对每个父级，获取基本触点信息
      const enrichedParents = [];
      for (const p of parents) {
        const parentId = p.anchor_id || p.anchorId || p.id;
        let parentAnchor: any = null;
        try {
          parentAnchor = g.anchorGetById(parentId);
        } catch { /* skip */ }

        enrichedParents.push({
          anchorId: parentId,
          anchorName: parentAnchor?.name || p.anchor_name || p.name || 'unknown',
          anchorType: parentAnchor?.anchor_type || p.anchor_type || 'unknown',
          role: p.role || 'component',
          version: parentAnchor?.version || 1,
        });
      }

      return JSON.stringify({
        status: 'ok',
        projectName,
        anchor: {
          id: anchor.id,
          name: anchor.name,
          type: anchor.anchor_type,
        },
        referencedBy: enrichedParents,
        count: enrichedParents.length,
        message: `Anchor "${anchorName}" is referenced as a component by ${enrichedParents.length} parent structure(s).`,
      });
    }

    case 'devplan_llm_analyze': {
      const projectName = args.projectName!;
      const mode = args.mode;
      const content = args.content;
      const anchorName = args.anchorName || '';
      const customPrompt = args.customPrompt || '';

      // ---- 从 config.json 读取 LLM 分析配置 ----
      // engine 参数一键切换：cursor / ollama / models_online
      const wsConfig = readDevPlanConfig();
      const llmCfg = (wsConfig as any)?.llmAnalyze || {};
      const engine: string = llmCfg.engine || 'cursor'; // 默认 cursor

      if (!mode) {
        throw new McpError(ErrorCode.InvalidParams, 'mode is required');
      }
      if (!content) {
        throw new McpError(ErrorCode.InvalidParams, 'content is required');
      }

      // ---- engine = "cursor" → 不调用 LLM，返回提示让 Cursor 自己分析 ----
      if (engine === 'cursor') {
        return JSON.stringify({
          status: 'cursor_mode',
          projectName,
          engine: 'cursor',
          mode,
          anchorName: anchorName || undefined,
          content: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
          message: 'engine=cursor: This tool is skipped. Cursor should analyze the content directly and call devplan_anchor_create / devplan_memory_save / devplan_structure_create based on its own analysis.',
          hint: {
            extract_anchors: 'Cursor should extract anchor names, types, and descriptions from the content, then call devplan_anchor_create for each.',
            determine_change: 'Cursor should determine the change type (created/upgraded/modified/deprecated/removed) and call devplan_memory_save with changeType.',
            build_structure: 'Cursor should identify components and call devplan_structure_create with the components array.',
            generate_memory: 'Cursor should generate L1 summary + L2 detail and call devplan_memory_save for each level.',
          }[mode] || 'Cursor should analyze the content and take appropriate action.',
          switchTo: 'To use LLM instead, set "engine": "ollama" or "engine": "models_online" in .devplan/config.json llmAnalyze section.',
        });
      }

      // ---- 根据 engine 解析 provider / model / baseUrl / apiKey ----
      let provider: string;
      let model: string;
      let baseUrl: string;
      let apiKey: string | undefined;
      let protocol: string;

      if (engine === 'ollama') {
        provider = 'ollama';
        model = args.model || llmCfg.ollamaModel || 'gemma3:27b';
        baseUrl = args.baseUrl || llmCfg.ollamaBaseUrl || 'http://localhost:11434/v1';
        apiKey = undefined;
        protocol = 'openai_compat';
      } else {
        // engine === 'models_online'
        provider = llmCfg.onlineProvider || 'deepseek';
        model = args.model || llmCfg.onlineModel || (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4');
        baseUrl = args.baseUrl || llmCfg.onlineBaseUrl || (provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1');
        apiKey = llmCfg.onlineApiKey || undefined;
        protocol = llmCfg.onlineProtocol || 'openai_compat';
      }

      // ---- System prompts for each mode ----
      const systemPrompts: Record<string, string> = {
        extract_anchors: `你是一个知识图谱构建助手。请从以下文本中提取所有核心"触点"（功能模块、概念、API、架构组件等）。
每个触点需包含：name（名称）、type（module/feature/concept/api/architecture/library/protocol）、description（一句话描述）。
请以 JSON 数组格式返回，不要包含其他内容。
示例：[{"name": "SocialGraphV2", "type": "module", "description": "图结构存储引擎"}, ...]`,

        determine_change: `你是一个版本变更分析助手。请分析以下文本内容，判断触点"${anchorName}"的变更类型。
可选变更类型：created（新创建）、upgraded（功能升级）、modified（修改调整）、deprecated（弃用）、removed（移除）。
请以 JSON 格式返回：{"changeType": "...", "summary": "一句话描述变更", "detail": "详细说明", "confidence": 0.8}`,

        build_structure: `你是一个系统架构分析助手。请分析触点"${anchorName}"的结构组成，列出它依赖的所有子组件。
每个组件需包含：name（组件名）、role（角色：core/dependency/optional/adapter/config）、description（说明）。
请以 JSON 格式返回：{"components": [{"name": "...", "role": "core", "description": "..."}], "summary": "结构概述"}`,

        generate_memory: `你是一个记忆构建助手。请为触点"${anchorName}"生成多级记忆内容。
生成三个层级：
- L1（触点摘要）：一句话概括，作为记忆的"入口"
- L2（详细记忆）：3~5句话，包含关键技术细节和设计决策
- L3_summary（结构总结）：列出主要组件及其关系
请以 JSON 格式返回：{"L1": "...", "L2": "...", "L3_summary": "...", "suggestedTags": ["tag1", "tag2"]}`,

        custom: customPrompt || '请分析以下内容并返回 JSON 格式的结果。',
      };

      const systemPrompt = systemPrompts[mode] || systemPrompts['custom'];

      // ---- 直接 HTTP 调用 OpenAI-Compatible API (Ollama / DeepSeek / OpenAI) ----
      // 绕过 LlmGateway NAPI 层，直接通过 HTTP 调用 LLM 推理接口
      // 这样无需 NAPI 重编译，且支持所有 OpenAI-compatible 端点

      // 验证在线模型的 API Key
      if (engine === 'models_online' && !apiKey) {
        return JSON.stringify({
          status: 'error',
          engine,
          provider,
          message: `Online provider "${provider}" requires an API key. Set onlineApiKey in .devplan/config.json:\n`
            + `{ "llmAnalyze": { "engine": "models_online", "onlineProvider": "${provider}", "onlineApiKey": "sk-..." } }`,
        });
      }

      try {
        let replyContent = '';
        let usage: any = {};

        if (engine === 'ollama') {
          // ---- Ollama 原生 /api/chat + 流式传输 (和 chat_api 方式一致，速度快 10 倍) ----
          const nativeBase = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 300000); // 5 min

          const response = await fetch(nativeBase + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content },
              ],
              stream: true,
              keep_alive: '30m',
              options: { temperature: 0.3, num_predict: 4096 },
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!response.ok) {
            const errText = await response.text().catch(() => 'unknown');
            return JSON.stringify({
              status: 'error',
              engine,
              provider,
              model,
              httpStatus: response.status,
              message: `Ollama API returned ${response.status}: ${errText.slice(0, 500)}. Is Ollama running at ${nativeBase}? Is model "${model}" pulled?`,
              switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
            });
          }

          if (!response.body) {
            return JSON.stringify({ status: 'error', engine, provider, model, message: 'No response body from Ollama.' });
          }

          // 流式读取（和 chat_api 的 iter_lines 方式一致）
          const reader = (response.body as any).getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let evalCount = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const chunk = JSON.parse(line);
                  if (chunk.message?.content) replyContent += chunk.message.content;
                  if (chunk.done) {
                    evalCount = chunk.eval_count || 0;
                    usage = {
                      prompt_tokens: chunk.prompt_eval_count || 0,
                      completion_tokens: evalCount,
                      total_tokens: (chunk.prompt_eval_count || 0) + evalCount,
                    };
                  }
                } catch { /* skip unparseable lines */ }
              }
            }
          } finally {
            reader.releaseLock();
          }
          // 处理剩余 buffer
          if (buffer.trim()) {
            try {
              const c = JSON.parse(buffer);
              if (c.message?.content) replyContent += c.message.content;
              if (c.done) {
                usage = {
                  prompt_tokens: c.prompt_eval_count || 0,
                  completion_tokens: c.eval_count || 0,
                  total_tokens: (c.prompt_eval_count || 0) + (c.eval_count || 0),
                };
              }
            } catch { /* skip */ }
          }
        } else {
          // ---- Online 模型: OpenAI-compat /v1/chat/completions ----
          const requestBody = {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content },
            ],
            temperature: 0.3,
            max_tokens: 4096,
          };

          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

          const apiUrl = baseUrl.replace(/\/+$/, '') + '/chat/completions';
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 120000); // 2 min

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!response.ok) {
            const errText = await response.text().catch(() => 'unknown');
            return JSON.stringify({
              status: 'error',
              engine,
              provider,
              model,
              httpStatus: response.status,
              message: `LLM API returned ${response.status}: ${errText.slice(0, 500)}. Check onlineApiKey and onlineModel in .devplan/config.json.`,
              switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
            });
          }

          const data = await response.json() as any;
          replyContent = data?.choices?.[0]?.message?.content || '';
          usage = data?.usage || {};
        }

        if (!replyContent) {
          return JSON.stringify({
            status: 'error',
            engine,
            provider,
            model,
            message: `LLM returned empty response.${engine === 'ollama' ? ' Is Ollama running?' : ''}`,
            switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
          });
        }

        // 尝试解析 JSON（LLM 可能返回 markdown 代码块包裹的 JSON）
        let parsedResult: any = null;
        let rawContent = replyContent;

        // 去除可能的 markdown 代码块
        const jsonMatch = rawContent.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
          rawContent = jsonMatch[1].trim();
        }

        try {
          parsedResult = JSON.parse(rawContent);
        } catch {
          parsedResult = null;
        }

        return JSON.stringify({
          status: 'ok',
          projectName,
          engine,
          mode,
          provider,
          model,
          baseUrl,
          anchorName: anchorName || undefined,
          result: parsedResult,
          rawContent: parsedResult ? undefined : replyContent,
          tokens: {
            prompt: usage.prompt_tokens || 0,
            completion: usage.completion_tokens || 0,
            total: usage.total_tokens || 0,
          },
          message: parsedResult
            ? `LLM analysis completed (engine: ${engine}, provider: ${provider}, model: ${model}). Parsed JSON result available.`
            : `LLM analysis completed (engine: ${engine}, provider: ${provider}, model: ${model}). Raw text returned (JSON parse failed).`,
        });

      } catch (e: any) {
        const isAbort = e?.name === 'AbortError';
        const hint = isAbort
          ? `Request timed out. ${engine === 'ollama' ? 'The local model may be loading or too slow.' : 'The API server may be overloaded.'}`
          : engine === 'ollama'
            ? `Is Ollama running at ${baseUrl.replace(/\/v1\/?$/, '')}?`
            : `Check onlineApiKey in .devplan/config.json.`;
        return JSON.stringify({
          status: 'error',
          engine,
          provider,
          model,
          message: `LLM analysis failed: ${e instanceof Error ? e.message : String(e)}. ${hint}`,
          switchTo: 'Set "engine": "cursor" to fallback to Cursor analysis.',
        });
      }
    }

    // ========== Phase-59: 分相批量记忆导入处理器 ==========

    case 'devplan_memory_batch_prepare': {
      const projectName = args.projectName!;
      const source = (args.source as 'tasks' | 'docs' | 'both') || 'both';
      const batchLimit = typeof args.limit === 'number' ? args.limit : 1; // default: 1; 0 = 后台自动全部处理
      const resume = args.resume !== false; // default true

      // ---- 如果后台任务正在运行，返回状态 ----
      if (bgTask?.running && bgTask.phase === 'A' && bgTask.projectName === projectName) {
        const bgElapsed = ((Date.now() - bgTask.startedAt) / 1000).toFixed(0);
        const bgPercent = bgTask.total > 0 ? Math.round((bgTask.prepared / bgTask.total) * 100) : 0;
        const barLen = 20;
        const filled = Math.round((bgPercent / 100) * barLen);
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        return JSON.stringify({
          status: 'background_running',
          projectName,
          message: `🚀 Phase A 后台运行中 [${bar}] ${bgPercent}% — ${bgTask.prepared}/${bgTask.total} | 当前: "${bgTask.currentTitle}" | 错误: ${bgTask.errors} | 已运行 ${bgElapsed}s`,
          progress: { prepared: bgTask.prepared, total: bgTask.total, errors: bgTask.errors, percent: `${bgPercent}%` },
          hint: 'Use devplan_memory_batch_status to check progress anytime.',
        });
      }

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).generateMemoryCandidates !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory generation requires "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      // ---- 读取 LLM 配置 ----
      const wsConfig = readDevPlanConfig();
      const llmCfg = (wsConfig as any)?.llmAnalyze || {};
      const engine: string = llmCfg.engine || 'ollama';

      if (engine === 'cursor') {
        return JSON.stringify({
          status: 'error',
          message: 'batch_prepare requires an LLM engine (ollama or models_online). engine=cursor is not supported for batch processing. Set "engine": "ollama" in .devplan/config.json.',
        });
      }

      // 解析 provider / model / baseUrl / apiKey
      let provider: string;
      let model: string;
      let baseUrl: string;
      let apiKey: string | undefined;

      if (engine === 'ollama') {
        provider = 'ollama';
        model = llmCfg.ollamaModel || 'gemma3:27b';
        baseUrl = llmCfg.ollamaBaseUrl || 'http://localhost:11434/v1';
        apiKey = undefined;
      } else {
        provider = llmCfg.onlineProvider || 'deepseek';
        model = llmCfg.onlineModel || 'deepseek-chat';
        baseUrl = llmCfg.onlineBaseUrl || 'https://api.deepseek.com/v1';
        apiKey = llmCfg.onlineApiKey || undefined;
      }

      if (engine === 'models_online' && !apiKey) {
        return JSON.stringify({
          status: 'error',
          message: `Online provider "${provider}" requires an API key. Set onlineApiKey in .devplan/config.json.`,
        });
      }

      // ---- 获取或创建缓存 ----
      const defaultBase = getDefaultBasePath();
      const cachePath = getCachePath(defaultBase, projectName);
      let cache: BatchCacheFile | null = resume ? readBatchCache(cachePath) : null;

      if (!cache) {
        cache = createBatchCache(projectName, engine, model);
      }

      // 已准备的 sourceId 集合（用于跳过）
      const preparedSourceIds = new Set(cache.entries.map(e => e.sourceId));

      // ---- 获取候选项列表（优先从缓存读取，避免每次都扫描文档/任务） ----
      let candidates: any[];
      if (cache.candidates && cache.candidates.length > 0) {
        candidates = cache.candidates;
      } else {
        const allCandidates = (plan as any).generateMemoryCandidates({
          source,
          limit: 999,
        });
        candidates = allCandidates?.candidates || [];
        cache.candidates = candidates.map((c: any) => ({
          sourceId: c.sourceId,
          sourceType: c.sourceType || 'doc',
          title: c.title || c.sourceId || 'unknown',
          content: c.content || '',
          contentL3: c.contentL3,
          suggestedMemoryType: c.suggestedMemoryType,
          suggestedTags: c.suggestedTags,
        }));
        writeBatchCache(cachePath, cache);
      }

      // 过滤掉已缓存的
      const pending = candidates.filter((c: any) => !preparedSourceIds.has(c.sourceId));
      const totalCandidates = candidates.length;
      const alreadyPrepared = totalCandidates - pending.length;

      if (pending.length === 0) {
        cache.prepareCompletedAt = Date.now();
        writeBatchCache(cachePath, cache);
        const stats = getCacheStats(cache);
        return JSON.stringify({
          status: 'completed',
          projectName,
          message: `✅ Phase A completed! All ${totalCandidates} candidates prepared. Ready for Phase B (devplan_memory_batch_commit).`,
          progress: { prepared: totalCandidates, total: totalCandidates, percent: '100%' },
          stats,
          cachePath,
        });
      }

      // ---- LLM 调用辅助函数 ----
      const timeoutMs = engine === 'ollama' ? 300000 : 120000;

      const callLlm = async (systemPrompt: string, userContent: string): Promise<string | null> => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          if (engine === 'ollama') {
            const nativeBase = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
            const res = await fetch(nativeBase + '/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userContent },
                ],
                stream: true,
                keep_alive: '30m',
                options: { temperature: 0.3, num_predict: 4096 },
              }),
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (!res.ok || !res.body) return null;

            const reader = (res.body as any).getReader();
            const decoder = new TextDecoder();
            let result = '';
            let buffer = '';
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                  if (!line.trim()) continue;
                  try {
                    const chunk = JSON.parse(line);
                    if (chunk.message?.content) result += chunk.message.content;
                  } catch { /* skip */ }
                }
              }
            } finally {
              reader.releaseLock();
            }
            if (buffer.trim()) {
              try { const c = JSON.parse(buffer); if (c.message?.content) result += c.message.content; } catch { /* skip */ }
            }
            return result || null;
          } else {
            const apiUrl = baseUrl.replace(/\/+$/, '') + '/chat/completions';
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            const res = await fetch(apiUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userContent },
                ],
                temperature: 0.3,
                max_tokens: 4096,
              }),
              signal: controller.signal,
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            const data = await res.json() as any;
            return data?.choices?.[0]?.message?.content || null;
          }
        } catch {
          return null;
        }
      };

      const parseJsonFromLlm = (raw: string): any => {
        let cleaned = raw;
        const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (jsonMatch) cleaned = jsonMatch[1].trim();
        try { return JSON.parse(cleaned); } catch { return null; }
      };

      const systemPrompt = `你是一个记忆构建助手。请根据以下文档/任务内容生成多级记忆。
生成三个层级（必须以 JSON 返回）：
- L1（触点摘要）：一句话概括（15~30字），作为记忆的"入口"或"触点"
- L2（详细记忆）：3~8句话，包含关键技术细节、设计决策、实现方案。要保留重要的技术名词和架构关系
- L3_summary（结构总结）：列出主要组件、依赖关系及其作用（如果内容是技术文档）。如果是非技术内容，则提供内容的结构化摘要
- memoryType：从 decision/pattern/bugfix/insight/preference/summary 中选择最合适的类型
- importance：重要性评分 0~1
- suggestedTags：建议标签数组
- anchorName：触点名称（该记忆关联的核心概念/模块/功能）
- anchorType：触点类型（module/concept/api/architecture/feature/library/protocol）
- anchorOverview：触点概览（3~5句话的目录索引式摘要，列出该触点包含的关键子项、核心 Flow 条目、主要结构组件等。类似文件夹的 README，帮助 Agent 快速判断是否需要深入查看详情）

请严格以 JSON 格式返回：
{"L1": "...", "L2": "...", "L3_summary": "...", "memoryType": "...", "importance": 0.7, "suggestedTags": [...], "anchorName": "...", "anchorType": "...", "anchorOverview": "..."}`;

      // ---- 处理单个候选的核心函数 ----
      const processOneCandidate = async (candidate: any, cacheRef: BatchCacheFile): Promise<{ ok: boolean }> => {
        const title = candidate.title || candidate.sourceId || 'unknown';
        const rawContent = candidate.contentL3 || candidate.content || '';

        if (!rawContent || rawContent.length < 50) {
          return { ok: true }; // 跳过过短内容
        }

        const truncated = rawContent.length > 12000
          ? rawContent.slice(0, 12000) + '\n\n[... 内容已截断，共 ' + rawContent.length + ' 字符]'
          : rawContent;

        const llmResult = await callLlm(systemPrompt, `标题：${title}\n\n${truncated}`);

        let entry: BatchCacheEntry;
        if (!llmResult) {
          entry = {
            sourceId: candidate.sourceId,
            sourceType: candidate.sourceType || 'doc',
            memoryType: candidate.suggestedMemoryType || 'insight',
            contentL1: rawContent.slice(0, 100),
            contentL2: rawContent.slice(0, 500),
            contentL3: rawContent,
            content: rawContent.slice(0, 300),
            importance: 0.5,
            tags: candidate.suggestedTags || [],
            relatedTaskId: candidate.sourceType === 'task' ? candidate.sourceId : undefined,
            title,
            preparedAt: Date.now(),
            committed: false,
          };
          appendEntry(cacheRef, entry);
          writeBatchCache(cachePath, cacheRef);
          return { ok: false };
        }

        const parsed = parseJsonFromLlm(llmResult);
        entry = {
          sourceId: candidate.sourceId,
          sourceType: candidate.sourceType || 'doc',
          memoryType: parsed?.memoryType || candidate.suggestedMemoryType || 'insight',
          contentL1: parsed?.L1 || rawContent.slice(0, 100),
          contentL2: parsed?.L2 || rawContent.slice(0, 500),
          contentL3: rawContent,
          content: parsed?.L2 || rawContent.slice(0, 300),
          importance: parsed?.importance || 0.5,
          tags: parsed?.suggestedTags || candidate.suggestedTags || [],
          relatedTaskId: candidate.sourceType === 'task' ? candidate.sourceId : undefined,
          anchorName: parsed?.anchorName,
          anchorType: parsed?.anchorType,
          anchorOverview: parsed?.anchorOverview,
          title,
          preparedAt: Date.now(),
          committed: false,
        };
        appendEntry(cacheRef, entry);
        writeBatchCache(cachePath, cacheRef);
        return { ok: true };
      };

      // ========== limit=0: 后台自动工作流 ==========
      if (batchLimit === 0) {
        // 启动后台异步循环，立即返回
        bgTask = {
          running: true,
          phase: 'A',
          projectName,
          prepared: alreadyPrepared,
          committed: 0,
          total: totalCandidates,
          errors: 0,
          startedAt: Date.now(),
          lastProcessedAt: Date.now(),
          currentTitle: pending[0]?.title || '',
          speed: '',
        };

        // Fire-and-forget: 后台循环处理所有 pending 候选
        (async () => {
          let bgErrors = 0;
          let bgProcessed = 0;
          for (const candidate of pending) {
            if (!bgTask?.running) break; // 允许外部中止
            const title = candidate.title || candidate.sourceId || 'unknown';
            bgTask.currentTitle = title;

            const itemStart = Date.now();
            const result = await processOneCandidate(candidate, cache!);
            const itemElapsed = ((Date.now() - itemStart) / 1000).toFixed(1);

            bgProcessed++;
            if (!result.ok) bgErrors++;
            bgTask.prepared = alreadyPrepared + bgProcessed;
            bgTask.errors = bgErrors;
            bgTask.lastProcessedAt = Date.now();
            bgTask.speed = `${itemElapsed}s/item`;
          }

          // 完成
          cache!.prepareCompletedAt = Date.now();
          writeBatchCache(cachePath, cache!);
          bgTask!.running = false;
        })();

        return JSON.stringify({
          status: 'background_started',
          projectName,
          engine,
          model,
          message: `🚀 Phase A 后台自动工作流已启动！正在处理 ${pending.length} 个候选（已跳过 ${alreadyPrepared} 个已完成）。\n`
            + `📊 使用 devplan_memory_batch_status 随时查看实时进度。\n`
            + `⏹️ 再次调用 batch_prepare(limit=0) 可查看运行状态。`,
          progress: { prepared: alreadyPrepared, total: totalCandidates, remaining: pending.length, percent: `${Math.round((alreadyPrepared / totalCandidates) * 100)}%` },
          cachePath,
        });
      }

      // ========== limit>0: 同步处理指定数量 ==========
      const toProcess = pending.slice(0, batchLimit);
      let processed = 0;
      let errors = 0;
      const startTime = Date.now();

      for (const candidate of toProcess) {
        const result = await processOneCandidate(candidate, cache);
        processed++;
        if (!result.ok) errors++;
      }

      // 检查是否全部完成
      const allDone = pending.length <= toProcess.length;
      if (allDone) {
        cache.prepareCompletedAt = Date.now();
        writeBatchCache(cachePath, cache);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const stats = getCacheStats(cache);

      const nowPrepared = alreadyPrepared + processed;
      const percent = totalCandidates > 0 ? Math.round((nowPrepared / totalCandidates) * 100) : 100;
      const remaining = totalCandidates - nowPrepared;

      const barLen = 20;
      const filled = Math.round((percent / 100) * barLen);
      const progressBar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

      return JSON.stringify({
        status: allDone ? 'completed' : 'partial',
        projectName,
        engine,
        model,
        message: allDone
          ? `✅ Phase A completed! [${progressBar}] 100% — ${totalCandidates}/${totalCandidates} candidates processed in ${elapsed}s (${errors} errors). Cache ready for Phase B (devplan_memory_batch_commit).`
          : `🔄 Phase A: [${progressBar}] ${percent}% — ${nowPrepared}/${totalCandidates} prepared (+${processed} this batch, ${elapsed}s). ${remaining} remaining. Call again to continue.`,
        progress: {
          prepared: nowPrepared,
          total: totalCandidates,
          remaining,
          percent: `${percent}%`,
          bar: `[${progressBar}]`,
          thisBatch: processed,
          thisBatchErrors: errors,
        },
        elapsedSeconds: parseFloat(elapsed),
        stats,
        cachePath,
      });
    }

    case 'devplan_memory_batch_commit': {
      const projectName = args.projectName!;
      const commitLimit = typeof args.limit === 'number' ? args.limit : 10; // default: 10; 0 = 后台自动全部
      const dryRun = args.dryRun || false;

      // ---- 如果后台 Phase B 正在运行，返回状态 ----
      if (bgTask?.running && bgTask.phase === 'B' && bgTask.projectName === projectName) {
        const bgElapsed = ((Date.now() - bgTask.startedAt) / 1000).toFixed(0);
        const bgPercent = bgTask.total > 0 ? Math.round((bgTask.committed / bgTask.total) * 100) : 0;
        const barLen = 20;
        const filled = Math.round((bgPercent / 100) * barLen);
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        return JSON.stringify({
          status: 'background_running',
          projectName,
          message: `🚀 Phase B 后台运行中 [${bar}] ${bgPercent}% — ${bgTask.committed}/${bgTask.total} | 当前: "${bgTask.currentTitle}" | 错误: ${bgTask.errors} | 已运行 ${bgElapsed}s`,
          progress: { committed: bgTask.committed, total: bgTask.total, errors: bgTask.errors, percent: `${bgPercent}%` },
          hint: 'Use devplan_memory_batch_status to check progress anytime.',
        });
      }

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).saveMemory !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      // ---- 读取缓存 ----
      const defaultBase = getDefaultBasePath();
      const cachePath = getCachePath(defaultBase, projectName);
      const cache = readBatchCache(cachePath);

      if (!cache || cache.entries.length === 0) {
        return JSON.stringify({
          status: 'error',
          message: 'No batch cache found. Run devplan_memory_batch_prepare first to generate the cache.',
          cachePath,
        });
      }

      // 获取未提交的条目
      const pendingEntries = cache.entries.filter(e => !e.committed);
      if (pendingEntries.length === 0) {
        cache.commitCompletedAt = Date.now();
        writeBatchCache(cachePath, cache);
        const stats = getCacheStats(cache);
        return JSON.stringify({
          status: 'completed',
          projectName,
          message: `Phase B already completed. All ${cache.entries.length} entries have been committed.`,
          stats,
        });
      }

      if (dryRun) {
        return JSON.stringify({
          status: 'dry_run',
          projectName,
          message: `Would commit ${pendingEntries.length} entries (${cache.entries.length} total in cache).`,
          pendingCount: pendingEntries.length,
          sampleEntries: pendingEntries.slice(0, 5).map(e => ({
            sourceId: e.sourceId,
            title: e.title,
            memoryType: e.memoryType,
            contentL1: e.contentL1.slice(0, 80),
          })),
        });
      }

      if (!cache.commitStartedAt) {
        cache.commitStartedAt = Date.now();
      }

      // ========== limit=0: 后台自动工作流 ==========
      if (commitLimit === 0) {
        bgTask = {
          running: true,
          phase: 'B',
          projectName,
          prepared: 0,
          committed: cache.entries.length - pendingEntries.length,
          total: cache.entries.length,
          errors: 0,
          startedAt: Date.now(),
          lastProcessedAt: Date.now(),
          currentTitle: pendingEntries[0]?.title || '',
          speed: '',
        };

        // Fire-and-forget: 后台循环提交所有 pending 条目
        (async () => {
          let bgErrors = 0;
          let bgCommitted = cache.entries.length - pendingEntries.length;
          for (const entry of pendingEntries) {
            if (!bgTask?.running) break;
            bgTask.currentTitle = entry.title || entry.sourceId || '';

            const itemStart = Date.now();
            await memorySaveMutex.acquire();
            try {
              (plan as any).saveMemory({
                projectName,
                content: entry.content,
                memoryType: entry.memoryType as any,
                importance: entry.importance,
                tags: entry.tags,
                relatedTaskId: entry.relatedTaskId,
                sourceId: entry.sourceId,
                source: 'batch_import',
                contentL1: entry.contentL1,
                contentL2: entry.contentL2,
                contentL3: entry.contentL3,
                anchorName: entry.anchorName,
                anchorType: entry.anchorType,
                anchorOverview: entry.anchorOverview,
                changeType: entry.changeType,
              });
              entry.committed = true;
              entry.committedAt = Date.now();
              bgCommitted++;
            } catch (e: any) {
              entry.committed = true;
              entry.commitError = e instanceof Error ? e.message : String(e);
              bgErrors++;
              bgCommitted++;
            } finally {
              memorySaveMutex.release();
            }

            writeBatchCache(cachePath, cache);
            bgTask.committed = bgCommitted;
            bgTask.errors = bgErrors;
            bgTask.lastProcessedAt = Date.now();
            bgTask.speed = `${((Date.now() - itemStart) / 1000).toFixed(1)}s/item`;
          }

          // 完成
          cache.commitCompletedAt = Date.now();
          writeBatchCache(cachePath, cache);
          bgTask!.running = false;
        })();

        const alreadyCommitted = cache.entries.length - pendingEntries.length;
        return JSON.stringify({
          status: 'background_started',
          projectName,
          message: `🚀 Phase B 后台自动工作流已启动！正在提交 ${pendingEntries.length} 条记忆（已跳过 ${alreadyCommitted} 条已提交）。\n`
            + `📊 使用 devplan_memory_batch_status 随时查看实时进度。\n`
            + `⏹️ 再次调用 batch_commit(limit=0) 可查看运行状态。`,
          progress: { committed: alreadyCommitted, total: cache.entries.length, remaining: pendingEntries.length },
        });
      }

      // ========== limit>0: 同步处理指定数量 ==========
      const toCommit = pendingEntries.slice(0, commitLimit);
      let committed = 0;
      let commitErrors = 0;
      const startTime = Date.now();

      for (const entry of toCommit) {
        await memorySaveMutex.acquire();
        try {
          (plan as any).saveMemory({
            projectName,
            content: entry.content,
            memoryType: entry.memoryType as any,
            importance: entry.importance,
            tags: entry.tags,
            relatedTaskId: entry.relatedTaskId,
            sourceId: entry.sourceId,
            source: 'batch_import',
            contentL1: entry.contentL1,
            contentL2: entry.contentL2,
            contentL3: entry.contentL3,
            anchorName: entry.anchorName,
            anchorType: entry.anchorType,
            anchorOverview: entry.anchorOverview,
            changeType: entry.changeType,
          });

          entry.committed = true;
          entry.committedAt = Date.now();
          committed++;
        } catch (e: any) {
          entry.committed = true;
          entry.commitError = e instanceof Error ? e.message : String(e);
          commitErrors++;
        } finally {
          memorySaveMutex.release();
        }

        writeBatchCache(cachePath, cache);
      }

      // 检查是否全部完成
      const remaining = cache.entries.filter(e => !e.committed).length;
      const totalEntries = cache.entries.length;
      const totalCommitted = totalEntries - remaining;
      if (remaining === 0) {
        cache.commitCompletedAt = Date.now();
        writeBatchCache(cachePath, cache);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const stats = getCacheStats(cache);

      const commitPercent = totalEntries > 0 ? Math.round((totalCommitted / totalEntries) * 100) : 100;
      const barLen = 20;
      const filled = Math.round((commitPercent / 100) * barLen);
      const commitBar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

      return JSON.stringify({
        status: remaining === 0 ? 'completed' : 'partial',
        projectName,
        message: remaining === 0
          ? `✅ Phase B completed! [${commitBar}] 100% — ${totalEntries}/${totalEntries} memories saved + embedded in ${elapsed}s (${commitErrors} errors). 🎉 Batch import pipeline finished!`
          : `🔄 Phase B: [${commitBar}] ${commitPercent}% — ${totalCommitted}/${totalEntries} committed (+${committed} this batch, ${elapsed}s). ${remaining} remaining. Call again to continue.`,
        progress: {
          committed: totalCommitted,
          total: totalEntries,
          remaining,
          percent: `${commitPercent}%`,
          bar: `[${commitBar}]`,
          thisBatch: committed,
          thisBatchErrors: commitErrors,
        },
        elapsedSeconds: parseFloat(elapsed),
        stats,
        hint: remaining === 0
          ? 'The batch cache can be cleared with devplan_memory_batch_status(clear: true).'
          : 'Call devplan_memory_batch_commit again to continue.',
      });
    }

    case 'devplan_memory_batch_status': {
      const projectName = args.projectName!;
      const shouldClear = args.clear || false;

      const defaultBase = getDefaultBasePath();
      const cachePath = getCachePath(defaultBase, projectName);
      const cache = readBatchCache(cachePath);

      // ---- 后台工作流实时状态 ----
      const bgInfo: any = {};
      if (bgTask && bgTask.projectName === projectName) {
        const bgElapsed = ((Date.now() - bgTask.startedAt) / 1000).toFixed(0);
        const bgPercent = bgTask.total > 0 ? Math.round((bgTask.prepared / bgTask.total) * 100) : 0;
        const barLen = 20;
        const filled = Math.round((bgPercent / 100) * barLen);
        const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
        bgInfo.backgroundTask = {
          running: bgTask.running,
          phase: bgTask.phase,
          progress: `[${bar}] ${bgPercent}% — ${bgTask.prepared}/${bgTask.total}`,
          currentTitle: bgTask.currentTitle,
          errors: bgTask.errors,
          speed: bgTask.speed,
          elapsedSeconds: parseInt(bgElapsed),
          message: bgTask.running
            ? `🚀 Phase ${bgTask.phase} 后台运行中 [${bar}] ${bgPercent}% — 当前: "${bgTask.currentTitle}" | ${bgTask.speed} | 错误: ${bgTask.errors} | 已运行 ${bgElapsed}s`
            : `✅ Phase ${bgTask.phase} 后台任务已完成 — ${bgTask.prepared}/${bgTask.total} 处理完毕，${bgTask.errors} 个错误，耗时 ${bgElapsed}s`,
        };
      }

      if (!cache) {
        return JSON.stringify({
          status: 'empty',
          projectName,
          message: 'No batch cache found. Use devplan_memory_batch_prepare to start a batch import.',
          cachePath,
          ...bgInfo,
        });
      }

      const stats = getCacheStats(cache);

      const typeBreakdown: Record<string, number> = {};
      for (const entry of cache.entries) {
        typeBreakdown[entry.memoryType] = (typeBreakdown[entry.memoryType] || 0) + 1;
      }

      const errorEntries = cache.entries.filter(e => e.commitError).map(e => ({
        sourceId: e.sourceId,
        title: e.title,
        error: e.commitError,
      }));

      // Phase A 进度
      const totalCandidates = cache.candidates?.length || 0;
      const preparedCount = cache.entries.length;
      const phaseAPercent = totalCandidates > 0 ? Math.round((preparedCount / totalCandidates) * 100) : (cache.prepareCompletedAt ? 100 : 0);
      const barLen = 20;
      const filledA = Math.round((phaseAPercent / 100) * barLen);
      const barA = '█'.repeat(filledA) + '░'.repeat(barLen - filledA);

      // Phase B 进度
      const committedCount = cache.entries.filter(e => e.committed).length;
      const phaseBPercent = preparedCount > 0 ? Math.round((committedCount / preparedCount) * 100) : 0;
      const filledB = Math.round((phaseBPercent / 100) * barLen);
      const barB = '█'.repeat(filledB) + '░'.repeat(barLen - filledB);

      const result: any = {
        status: 'ok',
        projectName,
        cachePath,
        stats,
        phaseA: {
          status: cache.prepareCompletedAt ? 'completed' : (bgTask?.running && bgTask.phase === 'A' ? 'background_running' : 'in_progress'),
          progress: `[${barA}] ${phaseAPercent}% — ${preparedCount}/${totalCandidates}`,
          startedAt: new Date(cache.prepareStartedAt).toISOString(),
          completedAt: cache.prepareCompletedAt ? new Date(cache.prepareCompletedAt).toISOString() : null,
          engine: cache.engine,
          model: cache.model,
        },
        phaseB: {
          status: cache.commitCompletedAt ? 'completed' : cache.commitStartedAt ? 'in_progress' : 'not_started',
          progress: `[${barB}] ${phaseBPercent}% — ${committedCount}/${preparedCount}`,
          startedAt: cache.commitStartedAt ? new Date(cache.commitStartedAt).toISOString() : null,
          completedAt: cache.commitCompletedAt ? new Date(cache.commitCompletedAt).toISOString() : null,
        },
        typeBreakdown,
        errors: errorEntries.length > 0 ? errorEntries : undefined,
        ...bgInfo,
        message: `Phase A: [${barA}] ${phaseAPercent}% (${preparedCount}/${totalCandidates}) ${cache.prepareCompletedAt ? '✅' : '🔄'} | Phase B: [${barB}] ${phaseBPercent}% (${committedCount}/${preparedCount}) ${cache.commitCompletedAt ? '✅' : cache.commitStartedAt ? '🔄' : '⏳'}`,
      };

      if (shouldClear) {
        deleteBatchCache(cachePath);
        // 同时清理后台任务状态
        if (bgTask?.projectName === projectName) {
          bgTask.running = false;
          bgTask = null;
        }
        result.cleared = true;
        result.message += ' | Cache file deleted.';
      }

      return JSON.stringify(result, null, 2);
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
