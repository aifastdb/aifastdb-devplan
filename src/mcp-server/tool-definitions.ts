import { DEFAULT_PROJECT_NAME } from '../dev-plan-factory';
import type { AutopilotConfig } from '../types';

export const TOOLS = [
  {
    name: 'devplan_capabilities',
    description: 'Output runtime capability diagnostics for ABI/version alignment. Shows project engine, package versions, and native feature readiness (memoryTreeSearch, anchorExtractFromText, applyMutations).\n输出运行时能力诊断信息，用于 ABI/版本对齐排查。包含项目引擎、包版本和 native 能力状态（memoryTreeSearch、anchorExtractFromText、applyMutations）。',
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
    name: 'devplan_capabilities_verbose',
    description: 'Verbose runtime capability diagnostics for ABI/version alignment. Includes missingCapabilities, loaded module paths, and recommendedActions.\n详细运行时能力诊断（用于 ABI/版本对齐排查）。额外返回 missingCapabilities、已加载模块路径和建议动作。',
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
    description: 'Start the graph visualization HTTP server. Opens an interactive Project graph page (vis-network) in the browser to visualize modules, tasks, and their relationships as a graph. The server runs in the background. Only works with projects using the "graph" engine.\n启动项目图谱 HTTP 服务器。在浏览器中打开交互式 vis-network 页面，将模块、任务及其关系以图谱形式可视化展示。服务器在后台运行。仅支持使用 "graph" 引擎的项目。',
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
        sourceRef: {
          type: 'object',
          description: 'Optional: Unified source reference (ai_db source_ref). sourceId identifies logical origin, variant distinguishes multiple memories from same source.\n可选：统一来源标识（ai_db source_ref）。sourceId 表示逻辑来源，variant 用于同源多记忆区分。',
          properties: {
            sourceId: { type: 'string' },
            variant: { type: 'string' },
          },
        },
        provenance: {
          type: 'object',
          description: 'Optional: Unified provenance/evidence payload (ai_db provenance).\n可选：统一追溯证据结构（ai_db provenance）。',
          properties: {
            origin: { type: 'string' },
            note: { type: 'string' },
            evidences: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string' },
                  refId: { type: 'string' },
                  locator: { type: 'string' },
                  excerpt: { type: 'string' },
                },
              },
            },
          },
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
    name: 'devplan_recall_unified',
    description: 'Unified recall API aligned with ai_db phase132~136. Accepts URI/depth/scope/docStrategy/recursive and returns merged memory+doc results.\n统一召回 API（对齐 ai_db phase132~136）。支持 URI/depth/scope/docStrategy/recursive，并返回记忆+文档融合结果。',
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
        uri: {
          type: 'string',
          description: 'Optional URI hint (e.g., aidb://memory/anchors/concept/socialgraphv2)\n可选 URI 提示',
        },
        memoryType: {
          type: 'string',
          enum: ['decision', 'pattern', 'bugfix', 'insight', 'preference', 'summary'],
          description: 'Optional: Filter by memory type\n可选：按记忆类型过滤',
        },
        limit: { type: 'number', description: 'Optional: Maximum results (default: 10)\n可选：最大返回数（默认 10）' },
        minScore: { type: 'number', description: 'Optional: Minimum relevance score (default: 0)\n可选：最低相关性评分（默认 0）' },
        recursive: {
          type: 'boolean',
          description: 'Optional: Enable recursive recall (effective value also depends on feature flag)\n可选：启用递归召回（最终受 feature flag 共同控制）',
        },
        includeDocs: {
          type: 'boolean',
          description: 'Deprecated: include docs switch. Prefer docStrategy.\n已废弃：是否包含文档，建议用 docStrategy。',
        },
        graphExpand: {
          type: 'boolean',
          description: 'Backward-compatible alias for recursive.\n兼容参数，等价于 recursive。',
        },
        docStrategy: {
          type: 'string',
          enum: ['vector', 'guided', 'none'],
          description: 'Document retrieval strategy\n文档检索策略',
        },
        depth: {
          type: 'string',
          enum: ['L1', 'L2', 'L3'],
          description: 'Hierarchical recall depth\n分层召回深度',
        },
        scope: {
          type: 'object',
          properties: {
            moduleId: { type: 'string' },
            taskId: { type: 'string' },
            anchorType: { type: 'string' },
            anchorName: { type: 'string' },
          },
        },
        deterministicFirst: {
          type: 'boolean',
          description: 'Deterministic filter switch. When true, apply strict metadata filters first.\n确定性过滤开关。开启后优先执行强元数据过滤。',
        },
        filterProject: {
          type: 'string',
          description: 'Deterministic filter: project\n确定性过滤：项目名',
        },
        filterMemoryType: {
          type: 'string',
          description: 'Deterministic filter: memory type\n确定性过滤：记忆类型',
        },
        filterCreatedAfterMs: {
          type: 'number',
          description: 'Deterministic filter: created_at >= (ms)\n确定性过滤：created_at 下界（毫秒）',
        },
        filterCreatedBeforeMs: {
          type: 'number',
          description: 'Deterministic filter: created_at <= (ms)\n确定性过滤：created_at 上界（毫秒）',
        },
        filterScope: {
          type: 'string',
          description: 'Deterministic filter: scope (compat)\n确定性过滤：scope（兼容）',
        },
        filterRoleId: {
          type: 'string',
          description: 'Deterministic filter: roleId (compat)\n确定性过滤：roleId（兼容）',
        },
        filterIncludeGlobalFallback: {
          type: 'boolean',
          description: 'Deterministic filter: include global fallback (compat)\n确定性过滤：是否包含全局回退（兼容）',
        },
      },
      required: ['projectName', 'query'],
    },
  },
  {
    name: 'devplan_get_feature_flags',
    description: 'Get unified recall feature flags.\n获取统一召回 feature flags。',
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
    name: 'devplan_set_feature_flags',
    description: 'Patch unified recall feature flags (autoSession/recursiveRecall/uriIndex).\n更新统一召回 feature flags（autoSession/recursiveRecall/uriIndex）。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        featureFlags: {
          type: 'object',
          properties: {
            autoSession: { type: 'boolean' },
            recursiveRecall: { type: 'boolean' },
            uriIndex: { type: 'boolean' },
          },
          description: 'Partial feature flags patch\n部分更新 patch',
        },
      },
      required: ['projectName', 'featureFlags'],
    },
  },
  {
    name: 'devplan_get_recall_observability',
    description: 'Get unified recall observability metrics.\n获取统一召回可观测性指标。',
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
    name: 'devplan_reset_recall_observability',
    description: 'Reset unified recall observability counters.\n重置统一召回可观测性计数器。',
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
    name: 'devplan_gateway_outbox_entries',
    description: 'List LlmGateway outbox entries with explicit state (pending/ready/dead_letter).\n列出 LlmGateway outbox 队列条目（含状态：pending/ready/dead_letter）。',
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
    name: 'devplan_gateway_retry_outbox_entry',
    description: 'Retry a single LlmGateway outbox entry by ID.\n按 ID 重试单条 LlmGateway outbox 条目。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        entryId: {
          type: 'string',
          description: 'Outbox entry ID\nOutbox 条目 ID',
        },
        forceReady: {
          type: 'boolean',
          description: 'Force bypass backoff and retry immediately (default: true)\n是否强制跳过退避并立即重试（默认 true）',
        },
      },
      required: ['projectName', 'entryId'],
    },
  },
  {
    name: 'devplan_gateway_memorize_cursor_profile',
    description: 'Write memory through LlmGateway with optional Cursor dual-session binding and hook semantics.\n通过 LlmGateway 写入记忆，支持可选 Cursor 双会话 ID 与 hook 语义。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        conversationId: { type: 'string', description: 'Conversation ID\n会话 ID' },
        userId: { type: 'string', description: 'User ID\n用户 ID' },
        userContent: { type: 'string', description: 'User message content\n用户消息内容' },
        assistantContent: { type: 'string', description: 'Assistant message content\n助手消息内容' },
        writeScope: { type: 'string', description: 'Optional scope: user_global | user_role | ai_global | ai_role\n可选 scope' },
        roleId: { type: 'string', description: 'Optional role ID for scoped write\n可选角色 ID' },
        profile: { type: 'string', description: 'Optional profile: cursor | generic\n可选 profile' },
        contentSessionId: { type: 'string', description: 'Optional Cursor content session ID\n可选内容会话 ID' },
        memorySessionId: { type: 'string', description: 'Optional Cursor memory session ID\n可选记忆会话 ID' },
        hookPhase: { type: 'string', description: 'Optional hook phase: pre_prompt | post_response | manual\n可选 hook 阶段' },
        hookName: { type: 'string', description: 'Optional hook name\n可选 hook 名称' },
      },
      required: ['projectName', 'conversationId', 'userId', 'userContent', 'assistantContent'],
    },
  },
  {
    name: 'devplan_memory_save_cursor_profile',
    description: 'Convenience wrapper for cursor-profile memory save. Internally maps to gateway memorize cursor profile path.\nCursor 场景记忆保存便捷封装，内部映射到 gateway 的 cursor profile 写入链路。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        conversationId: { type: 'string', description: 'Conversation ID\n会话 ID' },
        userId: { type: 'string', description: 'User ID\n用户 ID' },
        userContent: { type: 'string', description: 'User message content\n用户消息内容' },
        assistantContent: { type: 'string', description: 'Assistant message content\n助手消息内容' },
        writeScope: { type: 'string', description: 'Optional scope: user_global | user_role | ai_global | ai_role\n可选 scope' },
        roleId: { type: 'string', description: 'Optional role ID for scoped write\n可选角色 ID' },
        profile: { type: 'string', description: 'Optional profile: cursor | generic\n可选 profile' },
        contentSessionId: { type: 'string', description: 'Optional Cursor content session ID\n可选内容会话 ID' },
        memorySessionId: { type: 'string', description: 'Optional Cursor memory session ID\n可选记忆会话 ID' },
        hookPhase: { type: 'string', description: 'Optional hook phase: pre_prompt | post_response | manual\n可选 hook 阶段' },
        hookName: { type: 'string', description: 'Optional hook name\n可选 hook 名称' },
      },
      required: ['projectName', 'conversationId', 'userId', 'userContent', 'assistantContent'],
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
    description: 'Generate memory candidates from existing documents and completed tasks. Returns structured candidates that the AI can review and selectively save as memories via devplan_memory_save. This tool aggregates raw data; the AI provides the intelligence to extract meaningful memories.\n从已有文档和已完成任务中生成记忆候选项。返回结构化候选项供 AI 审查后通过 devplan_memory_save 批量保存为记忆。此工具聚合原始数据，AI 负责提取有意义的记忆。\n\n**Batch AI Workflow (批量 AI 处理工作流)**:\nWhen user says "批量生成记忆" / "全量导入记忆" / "batch generate memories":\n1. Call this tool with limit=5 to get a small batch\n2. For EACH candidate: read its content, extract 1-3 key insights, determine the best memoryType\n3. Call devplan_memory_save for each with AI-refined content (concise, 1-3 sentences), **MUST pass sourceRef from candidate.sourceRef**\n4. Check stats.remaining — if > 0, repeat from step 1\n5. Continue until remaining === 0\n\n**Granularity Policy (粒度策略, Phase-52/T52.4)**:\n- `decision` / `bugfix`: keep decision/root-cause + fix approach, and preserve key code snippet + file path when available.\n- `summary`: keep only 2~3 sentences of high-level outcome.\n- `pattern` / `insight` / `preference`: keep 1~3 concise sentences plus one minimal example.\n- Use the latest L1/L2/L3 rules; do not reuse old definitions.\n\n**Memory Tree / suggestedRelations (记忆树 / 建议关联)**:\nEach candidate may include a `suggestedRelations` array with `{ targetSourceRef, relationType, weight, reason }` entries.\nThese represent inferred connections between candidates (e.g., task→doc DERIVED_FROM, consecutive phases TEMPORAL_NEXT, same-module RELATES).\n`targetSourceRef` references another candidate\'s `sourceRef.sourceId`. After saving all memories, map sourceRef.sourceId→entityId and build relations via the graph.\nThis transforms flat memories into a connected Memory Tree graph.\n\n**CRITICAL — sourceRef dedup tracking**: Each candidate has a `sourceRef` field with `sourceId` (e.g., "phase-7" for tasks, "overview" or "technical_notes|security" for docs). When calling devplan_memory_save, you MUST pass `sourceRef: candidate.sourceRef` so that subsequent calls to devplan_memory_generate can skip already-processed sources. Without sourceRef, the same candidates will keep appearing.\n\nThe stats.remaining field tells how many more eligible candidates exist beyond the current batch.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        source: {
          type: 'string',
          enum: ['tasks', 'docs', 'modules', 'both'],
          description: 'Data source: "tasks" for completed phases, "docs" for documents, "modules" for feature modules, "both" for all (default: "both")\n数据源："tasks" 已完成阶段、"docs" 文档、"modules" 功能模块、"both" 全部（默认 "both"）',
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
    description: 'Use local Ollama LLM to analyze text and return structured JSON. Supports multiple analysis modes for anchor-driven memory construction.\n使用本地 Ollama LLM 分析文本并返回结构化 JSON。支持多种分析模式用于触点驱动记忆构建。\n\nAnalysis modes:\n- "extract_anchors": Extract anchor candidates from a document/task description\n- "determine_change": Determine change type (created/upgraded/modified) for an anchor based on content\n- "build_structure": Analyze structural composition of a feature/module\n- "generate_memory": Generate multi-level memory content (L1 summary + L2 detail) for an anchor\n- "skill_l1": Generate L1 touchpoint summary with the latest L1 rule set\n- "skill_l2": Generate L2 detailed memory with the latest L2 rule set\n- "skill_l3": Generate L3 full-content memory with the latest L3 rule set\n- "custom": Free-form analysis with custom prompt\n\nRequires Ollama running locally (default: http://localhost:11434/v1).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectName: {
          type: 'string',
          description: `Project name (default: "${DEFAULT_PROJECT_NAME}")\n项目名称（默认："${DEFAULT_PROJECT_NAME}"）`,
        },
        mode: {
          type: 'string',
          enum: ['extract_anchors', 'determine_change', 'build_structure', 'generate_memory', 'skill_l1', 'skill_l2', 'skill_l3', 'custom'],
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
    description: 'Phase B of batch memory import pipeline. Reads the cache file generated by devplan_memory_batch_prepare, then saves each entry as a memory (triggering embedding generation). The embedding model stays loaded throughout. Supports optional Cursor binding metadata (profile/contentSessionId/memorySessionId/hookPhase/hookName), which is injected into provenance for each saved memory.\n分相批量记忆导入的 Phase B。读取 Phase A 生成的缓存文件，逐条保存为记忆（触发 embedding 生成）。Embedding 模型全程保持加载。支持可选 Cursor 绑定元数据（profile/contentSessionId/memorySessionId/hookPhase/hookName），会写入每条记忆的 provenance。\n\nCall devplan_memory_batch_prepare first to populate the cache.',
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
        profile: {
          type: 'string',
          description: 'Optional profile: cursor | generic. Use "cursor" to enable cursor session binding provenance.\n可选 profile。设为 cursor 时启用会话绑定元数据写入。',
        },
        contentSessionId: {
          type: 'string',
          description: 'Optional Cursor content session ID.\n可选内容会话 ID。',
        },
        memorySessionId: {
          type: 'string',
          description: 'Optional Cursor memory session ID.\n可选记忆会话 ID。',
        },
        hookPhase: {
          type: 'string',
          description: 'Optional hook phase: pre_prompt | post_response | manual.\n可选 hook 阶段。',
        },
        hookName: {
          type: 'string',
          description: 'Optional hook name.\n可选 hook 名称。',
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

export interface ToolArgs {
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
  /** devplan_memory_save: 统一来源标识（ai_db source_ref） */
  sourceRef?: { sourceId: string; variant?: string };
  /** devplan_memory_save: 统一追溯证据（ai_db provenance） */
  provenance?: {
    origin?: string;
    note?: string;
    evidences?: Array<{ kind: string; refId?: string; locator?: string; excerpt?: string }>;
  };
  /** devplan_recall_unified: 是否包含文档统一召回（已废弃，推荐 docStrategy） */
  includeDocs?: boolean;
  /** devplan_recall_unified: URI 定位提示 */
  uri?: string;
  /** devplan_recall_unified: 是否启用图谱关联扩展 (Phase-38) */
  graphExpand?: boolean;
  /** devplan_recall_unified: 是否启用递归召回（受 feature flag 控制） */
  recursive?: boolean;
  /** Phase-125: devplan_recall_unified: 文档检索策略 (vector/guided/none) */
  docStrategy?: string;
  /** Phase-124: devplan_recall_unified: 分层召回深度 (L1/L2/L3) */
  depth?: string;
  /** devplan_recall_unified: 确定性过滤开关 */
  deterministicFirst?: boolean;
  /** devplan_recall_unified: 过滤项目名 */
  filterProject?: string;
  /** devplan_recall_unified: 过滤记忆类型 */
  filterMemoryType?: string;
  /** devplan_recall_unified: 过滤 created_at 下界（ms） */
  filterCreatedAfterMs?: number;
  /** devplan_recall_unified: 过滤 created_at 上界（ms） */
  filterCreatedBeforeMs?: number;
  /** devplan_recall_unified: 过滤 scope（兼容） */
  filterScope?: string;
  /** devplan_recall_unified: 过滤 roleId（兼容） */
  filterRoleId?: string;
  /** devplan_recall_unified: 过滤 includeGlobalFallback（兼容） */
  filterIncludeGlobalFallback?: boolean;
  /** devplan_gateway_retry_outbox_entry: 条目 ID */
  entryId?: string;
  /** devplan_gateway_retry_outbox_entry: 是否强制立即重试 */
  forceReady?: boolean;
  /** devplan_gateway_memorize_cursor_profile: 会话 ID */
  conversationId?: string;
  /** devplan_gateway_memorize_cursor_profile: 用户 ID */
  userId?: string;
  /** devplan_gateway_memorize_cursor_profile: 用户消息内容 */
  userContent?: string;
  /** devplan_gateway_memorize_cursor_profile: 助手消息内容 */
  assistantContent?: string;
  /** devplan_gateway_memorize_cursor_profile: 可选 scope */
  writeScope?: string;
  /** devplan_gateway_memorize_cursor_profile: 可选 roleId */
  roleId?: string;
  /** devplan_gateway_memorize_cursor_profile: 可选 profile */
  profile?: string;
  /** devplan_gateway_memorize_cursor_profile: 可选 contentSessionId */
  contentSessionId?: string;
  /** devplan_gateway_memorize_cursor_profile: 可选 memorySessionId */
  memorySessionId?: string;
  /** devplan_gateway_memorize_cursor_profile: 可选 hookPhase */
  hookPhase?: string;
  /** devplan_gateway_memorize_cursor_profile: 可选 hookName */
  hookName?: string;
  /** devplan_memory_clear: 确认删除（安全保护） */
  confirm?: boolean;
  /** devplan_set_feature_flags: 特性开关 Patch */
  featureFlags?: { autoSession?: boolean; recursiveRecall?: boolean; uriIndex?: boolean };
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
