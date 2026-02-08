/**
 * DevPlanStore — 通用开发计划管理系统
 *
 * 以 FEDERATED_DB_DEVELOPMENT_PLAN.md 的结构为蓝本，构建跨项目通用的
 * "开发计划文档管理 + 分层任务管理" 标准化能力。
 *
 * 特性：
 * - 11 种标准文档片段类型（overview, api_design, technical_notes 等）
 * - 主任务 (MainTask) + 子任务 (SubTask) 两级任务层级
 * - 子任务与 Cursor TodoList 一一对应
 * - 完成任务时自动更新进度和关联文档
 * - 基于 EnhancedDocumentStore 的 JSONL 持久化
 *
 * 使用方式：
 * ```typescript
 * import { DevPlanStore, createDevPlan } from 'aifastdb-devplan';
 *
 * const plan = createDevPlan('federation-db');
 * plan.saveSection({ projectName: 'federation-db', section: 'overview', ... });
 * plan.createMainTask({ projectName: 'federation-db', taskId: 'phase-7', ... });
 * plan.addSubTask({ projectName: 'federation-db', taskId: 'T7.1', parentTaskId: 'phase-7', ... });
 * plan.completeSubTask('T7.1');  // 自动更新进度
 * ```
 */

import {
  EnhancedDocumentStore,
  documentStoreProductionConfig,
  ContentType,
  type DocumentInput,
} from 'aifastdb';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * 标准文档片段类型 — 从 FEDERATED_DB_DEVELOPMENT_PLAN.md 抽象的通用模板
 *
 * 每个项目可选择使用全部或部分章节类型。
 */
export type DevPlanSection =
  | 'overview'          // 概述：背景/目标/架构图
  | 'core_concepts'     // 核心概念：术语/数据模型/关键抽象
  | 'api_design'        // API 设计：接口/类型/使用方式
  | 'file_structure'    // 文件/代码结构：目录树/模块划分
  | 'config'            // 配置设计：配置文件/环境变量/示例
  | 'examples'          // 使用示例：代码示例/调用演示
  | 'technical_notes'   // 技术笔记：性能/安全/错误处理等（支持多个子文档）
  | 'api_endpoints'     // API 端点汇总：REST/RPC 端点列表
  | 'milestones'        // 里程碑：版本目标/交付节点
  | 'changelog'         // 变更记录：版本历史
  | 'custom';           // 自定义：用户自行扩展的任意章节

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * 任务优先级
 */
export type TaskPriority = 'P0' | 'P1' | 'P2';

/**
 * 文档片段输入
 */
export interface DevPlanDocInput {
  /** 项目名称 */
  projectName: string;
  /** 文档片段类型 */
  section: DevPlanSection;
  /** 文档标题 */
  title: string;
  /** Markdown 内容 */
  content: string;
  /** 文档版本 */
  version?: string;
  /** 子分类（用于 technical_notes 等支持多子文档的类型） */
  subSection?: string;
  /** 关联的其他章节 */
  relatedSections?: string[];
  /** 关联的功能模块 */
  moduleId?: string;
}

/**
 * 存储的文档片段
 */
export interface DevPlanDoc {
  /** 文档 ID */
  id: string;
  /** 项目名称 */
  projectName: string;
  /** 文档片段类型 */
  section: DevPlanSection;
  /** 文档标题 */
  title: string;
  /** Markdown 内容 */
  content: string;
  /** 文档版本 */
  version: string;
  /** 子分类 */
  subSection?: string;
  /** 关联章节 */
  relatedSections?: string[];
  /** 关联的功能模块 ID */
  moduleId?: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * 主任务输入 — 对应一个完整的开发阶段
 */
export interface MainTaskInput {
  /** 项目名称 */
  projectName: string;
  /** 主任务标识 (如 "phase-7", "phase-14B") */
  taskId: string;
  /** 任务标题 (如 "阶段七：Store Trait 与适配器") */
  title: string;
  /** 优先级 */
  priority: TaskPriority;
  /** 任务描述 */
  description?: string;
  /** 预计工时（小时） */
  estimatedHours?: number;
  /** 关联的文档章节 */
  relatedSections?: string[];
  /** 关联的功能模块 ID */
  moduleId?: string;
}

/**
 * 存储的主任务
 */
export interface MainTask {
  /** 文档 ID */
  id: string;
  /** 项目名称 */
  projectName: string;
  /** 主任务标识 */
  taskId: string;
  /** 任务标题 */
  title: string;
  /** 优先级 */
  priority: TaskPriority;
  /** 任务描述 */
  description?: string;
  /** 预计工时 */
  estimatedHours?: number;
  /** 关联文档章节 */
  relatedSections?: string[];
  /** 关联的功能模块 ID */
  moduleId?: string;
  /** 子任务总数 */
  totalSubtasks: number;
  /** 已完成子任务数 */
  completedSubtasks: number;
  /** 任务状态 */
  status: TaskStatus;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt: number | null;
}

/**
 * 子任务输入 — 与 Cursor TodoList 粒度一致
 */
export interface SubTaskInput {
  /** 项目名称 */
  projectName: string;
  /** 子任务标识 (如 "T7.2", "T14.8") */
  taskId: string;
  /** 父主任务标识 (如 "phase-7") */
  parentTaskId: string;
  /** 任务标题 (如 "定义 Store Trait 和统一类型") */
  title: string;
  /** 预计工时（小时） */
  estimatedHours?: number;
  /** 涉及的代码文件 */
  relatedFiles?: string[];
  /** 任务描述 */
  description?: string;
}

/**
 * 存储的子任务
 */
export interface SubTask {
  /** 文档 ID */
  id: string;
  /** 项目名称 */
  projectName: string;
  /** 子任务标识 */
  taskId: string;
  /** 父主任务标识 */
  parentTaskId: string;
  /** 任务标题 */
  title: string;
  /** 预计工时 */
  estimatedHours?: number;
  /** 涉及的代码文件 */
  relatedFiles?: string[];
  /** 任务描述 */
  description?: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt: number | null;
  /** 🆕 完成时的 Git commit hash (short SHA)，用于 Git 同步检查 */
  completedAtCommit?: string;
  /** 🆕 被自动回退的原因（当 syncWithGit 检测到 commit 不在当前分支时） */
  revertReason?: string;
}

/**
 * 完成子任务的返回结果
 */
export interface CompleteSubTaskResult {
  /** 更新后的子任务 */
  subTask: SubTask;
  /** 自动更新计数后的主任务 */
  mainTask: MainTask;
  /** 主任务是否也全部完成了 */
  mainTaskCompleted: boolean;
  /** 🆕 完成时锚定的 Git commit hash */
  completedAtCommit?: string;
}

/**
 * 🆕 devplan_sync_git 返回结果
 */
export interface SyncGitResult {
  /** 检查的已完成任务数 */
  checked: number;
  /** 被回退的任务列表 */
  reverted: RevertedTask[];
  /** 当前 HEAD commit */
  currentHead: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 🆕 被回退的单个任务信息
 */
export interface RevertedTask {
  taskId: string;
  title: string;
  parentTaskId: string;
  completedAtCommit: string;
  reason: string;
}

/**
 * 功能模块状态
 */
export type ModuleStatus = 'planning' | 'active' | 'completed' | 'deprecated';

/**
 * 功能模块输入
 */
export interface ModuleInput {
  /** 项目名称 */
  projectName: string;
  /** 模块标识 (如 "vector-store", "permission") */
  moduleId: string;
  /** 模块名称 (如 "向量存储模块") */
  name: string;
  /** 模块描述 */
  description?: string;
  /** 模块状态 */
  status?: ModuleStatus;
}

/**
 * 存储的功能模块
 */
export interface Module {
  /** 文档 ID */
  id: string;
  /** 项目名称 */
  projectName: string;
  /** 模块标识 */
  moduleId: string;
  /** 模块名称 */
  name: string;
  /** 模块描述 */
  description?: string;
  /** 模块状态 */
  status: ModuleStatus;
  /** 关联的主任务数（自动计算） */
  mainTaskCount: number;
  /** 关联的子任务总数（自动计算，跨所有主任务汇总） */
  subTaskCount: number;
  /** 关联的已完成子任务数（自动计算） */
  completedSubTaskCount: number;
  /** 关联的文档数（自动计算） */
  docCount: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * 模块详情 — 包含关联的任务和文档
 */
export interface ModuleDetail {
  /** 模块信息 */
  module: Module;
  /** 关联的主任务列表 */
  mainTasks: MainTask[];
  /** 关联的所有子任务列表 */
  subTasks: SubTask[];
  /** 关联的文档列表 */
  documents: DevPlanDoc[];
}

/**
 * 单个主任务的进度
 */
export interface MainTaskProgress {
  /** 主任务标识 */
  taskId: string;
  /** 任务标题 */
  title: string;
  /** 优先级 */
  priority: TaskPriority;
  /** 状态 */
  status: TaskStatus;
  /** 总子任务数 */
  total: number;
  /** 已完成数 */
  completed: number;
  /** 进度百分比 (0-100) */
  percent: number;
}

/**
 * 项目整体进度
 */
export interface ProjectProgress {
  /** 项目名称 */
  projectName: string;
  /** 文档片段数 */
  sectionCount: number;
  /** 主任务总数 */
  mainTaskCount: number;
  /** 已完成主任务数 */
  completedMainTasks: number;
  /** 子任务总数 */
  subTaskCount: number;
  /** 已完成子任务数 */
  completedSubTasks: number;
  /** 总体进度百分比 (0-100) */
  overallPercent: number;
  /** 各主任务进度 */
  tasks: MainTaskProgress[];
}

/**
 * DevPlanStore 配置
 */
export interface DevPlanStoreConfig {
  /** 文档片段存储路径 */
  documentPath: string;
  /** 任务存储路径 */
  taskPath: string;
  /** 功能模块存储路径 */
  modulePath: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 根据章节类型返回重要性分数
 */
function sectionImportance(section: DevPlanSection): number {
  const importanceMap: Record<DevPlanSection, number> = {
    overview: 1.0,
    core_concepts: 0.95,
    api_design: 0.9,
    file_structure: 0.7,
    config: 0.7,
    examples: 0.6,
    technical_notes: 0.8,
    api_endpoints: 0.75,
    milestones: 0.85,
    changelog: 0.5,
    custom: 0.6,
  };
  return importanceMap[section] ?? 0.6;
}

/**
 * 获取默认的 DevPlan 存储基础路径
 *
 * 优先级：
 * 1. AIFASTDB_DEVPLAN_PATH 环境变量（显式指定）
 * 2. 项目内 .devplan/ 目录（天然跟随 Git 版本管理）
 * 3. 回退到用户目录 ~/.aifastdb/dev-plans/（兜底）
 */
function getDefaultBasePath(): string {
  if (process.env.AIFASTDB_DEVPLAN_PATH) {
    return process.env.AIFASTDB_DEVPLAN_PATH;
  }

  // 尝试定位项目根目录（查找 .git 或 package.json 所在目录）
  const projectRoot = findProjectRoot();
  if (projectRoot) {
    return path.join(projectRoot, '.devplan');
  }

  // 兜底：用户目录
  return path.join(os.homedir(), '.aifastdb', 'dev-plans');
}

/**
 * 从当前工作目录向上查找项目根目录
 * 通过 .git 目录或 package.json 文件来判断
 */
function findProjectRoot(): string | null {
  const fs = require('fs');
  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

// ============================================================================
// DevPlanStore Implementation
// ============================================================================

/**
 * 通用开发计划存储
 *
 * 管理项目的开发计划文档和任务，使用两个 EnhancedDocumentStore 实例：
 * - docStore: 文档片段 (Markdown 内容)
 * - taskStore: 任务 (主任务 + 子任务层级)
 */
export class DevPlanStore {
  private docStore: InstanceType<typeof EnhancedDocumentStore>;
  private taskStore: InstanceType<typeof EnhancedDocumentStore>;
  private moduleStore: InstanceType<typeof EnhancedDocumentStore>;
  private projectName: string;

  constructor(projectName: string, config: DevPlanStoreConfig) {
    this.projectName = projectName;
    this.docStore = new EnhancedDocumentStore(
      config.documentPath,
      documentStoreProductionConfig()
    );
    this.taskStore = new EnhancedDocumentStore(
      config.taskPath,
      documentStoreProductionConfig()
    );
    this.moduleStore = new EnhancedDocumentStore(
      config.modulePath,
      documentStoreProductionConfig()
    );
  }

  // ==========================================================================
  // Document Section Operations
  // ==========================================================================

  /**
   * 保存文档片段
   *
   * 如果同 section（+subSection）已存在，会覆盖旧版本。
   */
  saveSection(input: DevPlanDocInput): string {
    // 删除已有同类型文档，并确保新版本时间戳严格递增
    const existing = this.getSection(input.section, input.subSection);
    if (existing) {
      this.deleteAndEnsureTimestampAdvance(this.docStore, existing.id);
    }

    const version = input.version || '1.0.0';
    const now = Date.now();

    const finalModuleId = input.moduleId || existing?.moduleId;

    const tags = [
      `plan:${this.projectName}`,
      `section:${input.section}`,
      ...(input.subSection ? [`sub:${input.subSection}`] : []),
      `ver:${version}`,
    ];
    if (finalModuleId) {
      tags.push(`module:${finalModuleId}`);
    }

    const docInput: DocumentInput = {
      content: input.content,
      contentType: ContentType.Text,
      tags,
      metadata: {
        projectName: this.projectName,
        section: input.section,
        title: input.title,
        version,
        subSection: input.subSection || null,
        relatedSections: input.relatedSections || [],
        moduleId: finalModuleId || null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      },
      importance: sectionImportance(input.section),
    };

    const id = this.docStore.put(docInput);
    this.docStore.flush();
    return id;
  }

  /**
   * 获取文档片段
   */
  getSection(section: DevPlanSection, subSection?: string): DevPlanDoc | null {
    const planTag = `plan:${this.projectName}`;
    const sectionTag = `section:${section}`;

    const docs = this.docStore.findByTag(planTag)
      .filter((doc: any) => (doc.tags as string[]).includes(sectionTag));

    let filtered = docs;
    if (subSection) {
      const subTag = `sub:${subSection}`;
      filtered = docs.filter((doc: any) => (doc.tags as string[]).includes(subTag));
    } else if (section !== 'technical_notes' && section !== 'custom') {
      // 非多子文档类型，排除有 sub: tag 的
      filtered = docs.filter((doc: any) =>
        !(doc.tags as string[]).some((t: string) => t.startsWith('sub:'))
      );
    }

    if (filtered.length === 0) return null;

    // 返回最新版本（以 metadata.updatedAt 为判定依据）
    const latest = filtered.sort((a: any, b: any) =>
      this.getDocUpdatedAt(b) - this.getDocUpdatedAt(a)
    )[0];
    return this.docToDevPlanDoc(latest);
  }

  /**
   * 列出项目的所有文档片段
   *
   * 对同一 section(+subSection) 的多个历史版本做去重，仅保留最新版。
   */
  listSections(): DevPlanDoc[] {
    const planTag = `plan:${this.projectName}`;
    const docs = this.docStore.findByTag(planTag);

    // 按 section+subSection 去重，保留最新版本（以 metadata.updatedAt 判定）
    const latestMap = new Map<string, any>();
    for (const doc of docs) {
      const sectionTag = (doc.tags as string[]).find((t: string) => t.startsWith('section:'));
      const subTag = (doc.tags as string[]).find((t: string) => t.startsWith('sub:'));
      const key = `${sectionTag || 'unknown'}|${subTag || ''}`;

      const existing = latestMap.get(key);
      if (!existing || this.getDocUpdatedAt(doc) > this.getDocUpdatedAt(existing)) {
        latestMap.set(key, doc);
      }
    }

    return Array.from(latestMap.values()).map((doc: any) => this.docToDevPlanDoc(doc));
  }

  /**
   * 更新文档片段内容
   */
  updateSection(
    section: DevPlanSection,
    content: string,
    subSection?: string
  ): string {
    const existing = this.getSection(section, subSection);
    if (!existing) {
      throw new Error(
        `Section "${section}"${subSection ? ` (${subSection})` : ''} not found for project "${this.projectName}"`
      );
    }

    return this.saveSection({
      projectName: this.projectName,
      section,
      title: existing.title,
      content,
      version: existing.version,
      subSection,
      relatedSections: existing.relatedSections,
    });
  }

  /**
   * 搜索文档片段
   *
   * 先对历史版本去重（同 listSections），再做关键词过滤。
   */
  searchSections(query: string, limit: number = 10): DevPlanDoc[] {
    const planTag = `plan:${this.projectName}`;
    const allDocs = this.docStore.findByTag(planTag);

    // 按 section+subSection 去重，保留最新版本（以 metadata.updatedAt 判定）
    const latestMap = new Map<string, any>();
    for (const doc of allDocs) {
      const sectionTag = (doc.tags as string[]).find((t: string) => t.startsWith('section:'));
      const subTag = (doc.tags as string[]).find((t: string) => t.startsWith('sub:'));
      const key = `${sectionTag || 'unknown'}|${subTag || ''}`;

      const existing = latestMap.get(key);
      if (!existing || this.getDocUpdatedAt(doc) > this.getDocUpdatedAt(existing)) {
        latestMap.set(key, doc);
      }
    }

    const queryLower = query.toLowerCase();
    return Array.from(latestMap.values())
      .filter((doc: any) =>
        doc.content.toLowerCase().includes(queryLower) ||
        (doc.metadata?.title || '').toLowerCase().includes(queryLower)
      )
      .slice(0, limit)
      .map((doc: any) => this.docToDevPlanDoc(doc));
  }

  /**
   * 删除文档片段
   */
  deleteSection(section: DevPlanSection, subSection?: string): boolean {
    const existing = this.getSection(section, subSection);
    if (!existing) return false;
    this.docStore.delete(existing.id);
    this.docStore.flush();
    return true;
  }

  // ==========================================================================
  // Main Task Operations
  // ==========================================================================

  /**
   * 创建主任务（开发阶段）
   */
  createMainTask(input: MainTaskInput): MainTask {
    // 检查是否已存在
    const existing = this.getMainTask(input.taskId);
    if (existing) {
      throw new Error(`Main task "${input.taskId}" already exists for project "${this.projectName}"`);
    }

    const now = Date.now();
    const taskData = {
      taskId: input.taskId,
      title: input.title,
      priority: input.priority,
      description: input.description || '',
      estimatedHours: input.estimatedHours || 0,
      relatedSections: input.relatedSections || [],
      totalSubtasks: 0,
      completedSubtasks: 0,
    };

    const tags = [
      `plan:${this.projectName}`,
      'type:main-task',
      `mtask:${input.taskId}`,
      `priority:${input.priority}`,
      'status:pending',
    ];
    if (input.moduleId) {
      tags.push(`module:${input.moduleId}`);
    }

    const docInput: DocumentInput = {
      content: JSON.stringify(taskData),
      contentType: ContentType.Text,
      tags,
      metadata: {
        projectName: this.projectName,
        taskId: input.taskId,
        status: 'pending',
        moduleId: input.moduleId || null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
      importance: input.priority === 'P0' ? 0.95 : input.priority === 'P1' ? 0.8 : 0.6,
    };

    const id = this.taskStore.put(docInput);
    this.taskStore.flush();

    return {
      id,
      projectName: this.projectName,
      ...taskData,
      moduleId: input.moduleId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
  }

  /**
   * 幂等导入主任务（Upsert）
   *
   * - 如果主任务不存在 → 创建新任务
   * - 如果主任务已存在 → 更新标题/描述/优先级等字段，但保留已有的更高级状态
   *   （例如已完成的任务不会被重置为 pending）
   * - updatedAt 保证严格递增，不会与历史版本重复
   *
   * @param input 主任务输入
   * @param options.preserveStatus 若为 true（默认），则不覆盖已完成的状态
   * @param options.status 导入时的目标状态（默认 pending）
   * @returns 创建或更新后的主任务
   */
  upsertMainTask(input: MainTaskInput, options?: {
    preserveStatus?: boolean;
    status?: TaskStatus;
  }): MainTask {
    const preserveStatus = options?.preserveStatus !== false; // 默认 true
    const targetStatus = options?.status || 'pending';
    const existing = this.getMainTask(input.taskId);

    if (!existing) {
      // 新建
      const task = this.createMainTask(input);
      // 如果目标状态不是 pending，更新状态
      if (targetStatus !== 'pending') {
        return this.updateMainTaskStatus(task.taskId, targetStatus) || task;
      }
      return task;
    }

    // 已存在 — 决定最终状态
    let finalStatus = targetStatus;
    if (preserveStatus) {
      // 状态优先级: completed > in_progress > pending > cancelled
      const statusPriority: Record<TaskStatus, number> = {
        cancelled: 0,
        pending: 1,
        in_progress: 2,
        completed: 3,
      };
      if (statusPriority[existing.status] >= statusPriority[targetStatus]) {
        finalStatus = existing.status; // 保留更高级状态
      }
    }

    // 删除旧版本并确保时间戳递增
    this.deleteAndEnsureTimestampAdvance(this.taskStore, existing.id);

    const now = Date.now();
    const completedAt = finalStatus === 'completed' ? (existing.completedAt || now) : null;

    const finalModuleId = input.moduleId || existing.moduleId;

    const taskData = {
      taskId: input.taskId,
      title: input.title,
      priority: input.priority,
      description: input.description || existing.description || '',
      estimatedHours: input.estimatedHours || existing.estimatedHours || 0,
      relatedSections: input.relatedSections || existing.relatedSections || [],
      totalSubtasks: existing.totalSubtasks,
      completedSubtasks: existing.completedSubtasks,
    };

    const tags = [
      `plan:${this.projectName}`,
      'type:main-task',
      `mtask:${input.taskId}`,
      `priority:${input.priority}`,
      `status:${finalStatus}`,
    ];
    if (finalModuleId) {
      tags.push(`module:${finalModuleId}`);
    }

    const docInput: DocumentInput = {
      content: JSON.stringify(taskData),
      contentType: ContentType.Text,
      tags,
      metadata: {
        projectName: this.projectName,
        taskId: input.taskId,
        status: finalStatus,
        moduleId: finalModuleId || null,
        createdAt: existing.createdAt,
        updatedAt: now,
        completedAt,
      },
      importance: input.priority === 'P0' ? 0.95 : input.priority === 'P1' ? 0.8 : 0.6,
    };

    const id = this.taskStore.put(docInput);
    this.taskStore.flush();

    return {
      ...taskData,
      id,
      projectName: this.projectName,
      moduleId: finalModuleId,
      status: finalStatus,
      createdAt: existing.createdAt,
      updatedAt: now,
      completedAt,
    };
  }

  /**
   * 获取主任务
   *
   * 由于 JSONL append-only 存储会保留历史版本，
   * 需要按 metadata.updatedAt 降序取最新版本。
   */
  getMainTask(taskId: string): MainTask | null {
    const tag = `mtask:${taskId}`;
    const docs = this.taskStore.findByTag(tag)
      .filter((doc: any) =>
        (doc.tags as string[]).includes(`plan:${this.projectName}`)
      );

    if (docs.length === 0) return null;

    // 取最新版本（以 metadata.updatedAt 为判定依据）
    const latest = docs.sort((a: any, b: any) =>
      this.getDocUpdatedAt(b) - this.getDocUpdatedAt(a)
    )[0];
    return this.docToMainTask(latest);
  }

  /**
   * 列出主任务
   *
   * 对同一 taskId 的多个历史版本做去重，仅保留最新版。
   */
  listMainTasks(filter?: {
    status?: TaskStatus;
    priority?: TaskPriority;
    moduleId?: string;
  }): MainTask[] {
    let docs = this.taskStore.findByTag(`plan:${this.projectName}`)
      .filter((doc: any) => (doc.tags as string[]).includes('type:main-task'));

    // 按 taskId 去重，仅保留最新版本（created_at 最大）
    docs = this.deduplicateByTaskId(docs);

    if (filter?.status) {
      const statusTag = `status:${filter.status}`;
      docs = docs.filter((doc: any) => (doc.tags as string[]).includes(statusTag));
    }

    if (filter?.priority) {
      const priorityTag = `priority:${filter.priority}`;
      docs = docs.filter((doc: any) => (doc.tags as string[]).includes(priorityTag));
    }

    if (filter?.moduleId) {
      const moduleTag = `module:${filter.moduleId}`;
      docs = docs.filter((doc: any) => (doc.tags as string[]).includes(moduleTag));
    }

    return docs.map((doc: any) => this.docToMainTask(doc));
  }

  /**
   * 更新主任务状态
   */
  updateMainTaskStatus(taskId: string, status: TaskStatus): MainTask | null {
    const mainTask = this.getMainTask(taskId);
    if (!mainTask) return null;

    this.deleteAndEnsureTimestampAdvance(this.taskStore, mainTask.id);

    const now = Date.now();
    const completedAt = status === 'completed' ? now : mainTask.completedAt;

    const taskData = {
      taskId: mainTask.taskId,
      title: mainTask.title,
      priority: mainTask.priority,
      description: mainTask.description || '',
      estimatedHours: mainTask.estimatedHours || 0,
      relatedSections: mainTask.relatedSections || [],
      totalSubtasks: mainTask.totalSubtasks,
      completedSubtasks: mainTask.completedSubtasks,
    };

    const tags = [
      `plan:${this.projectName}`,
      'type:main-task',
      `mtask:${mainTask.taskId}`,
      `priority:${mainTask.priority}`,
      `status:${status}`,
    ];
    if (mainTask.moduleId) {
      tags.push(`module:${mainTask.moduleId}`);
    }

    const docInput: DocumentInput = {
      content: JSON.stringify(taskData),
      contentType: ContentType.Text,
      tags,
      metadata: {
        projectName: this.projectName,
        taskId: mainTask.taskId,
        status,
        moduleId: mainTask.moduleId || null,
        createdAt: mainTask.createdAt,
        updatedAt: now,
        completedAt,
      },
      importance: mainTask.priority === 'P0' ? 0.95 : mainTask.priority === 'P1' ? 0.8 : 0.6,
    };

    const id = this.taskStore.put(docInput);
    this.taskStore.flush();

    return {
      ...mainTask,
      id,
      status,
      updatedAt: now,
      completedAt,
    };
  }

  // ==========================================================================
  // Sub Task Operations
  // ==========================================================================

  /**
   * 添加子任务
   */
  addSubTask(input: SubTaskInput): SubTask {
    // 检查是否已存在
    const existing = this.getSubTask(input.taskId);
    if (existing) {
      throw new Error(`Sub task "${input.taskId}" already exists for project "${this.projectName}"`);
    }

    // 验证父任务存在
    const mainTask = this.getMainTask(input.parentTaskId);
    if (!mainTask) {
      throw new Error(`Parent main task "${input.parentTaskId}" not found for project "${this.projectName}"`);
    }

    const now = Date.now();
    const taskData = {
      taskId: input.taskId,
      title: input.title,
      estimatedHours: input.estimatedHours || 0,
      relatedFiles: input.relatedFiles || [],
      description: input.description || '',
    };

    const docInput: DocumentInput = {
      content: JSON.stringify(taskData),
      contentType: ContentType.Text,
      parentId: mainTask.id,
      tags: [
        `plan:${this.projectName}`,
        'type:sub-task',
        `stask:${input.taskId}`,
        `parent:${input.parentTaskId}`,
        'status:pending',
      ],
      metadata: {
        projectName: this.projectName,
        taskId: input.taskId,
        parentTaskId: input.parentTaskId,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
      importance: 0.7,
    };

    const id = this.taskStore.put(docInput);

    // 更新主任务的 totalSubtasks 计数
    this.refreshMainTaskCounts(input.parentTaskId);
    this.taskStore.flush();

    return {
      id,
      projectName: this.projectName,
      ...taskData,
      parentTaskId: input.parentTaskId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
  }

  /**
   * 幂等导入子任务（Upsert）
   *
   * - 如果子任务不存在 → 创建新子任务
   * - 如果子任务已存在 → 更新标题/描述等字段，但保留已有的更高级状态
   *   （例如已完成的任务不会被重置为 pending）
   * - updatedAt 保证严格递增，不会与历史版本重复
   *
   * @param input 子任务输入
   * @param options.preserveStatus 若为 true（默认），则不覆盖已完成的状态
   * @param options.status 导入时的目标状态（默认 pending）
   * @returns 创建或更新后的子任务
   */
  upsertSubTask(input: SubTaskInput, options?: {
    preserveStatus?: boolean;
    status?: TaskStatus;
  }): SubTask {
    const preserveStatus = options?.preserveStatus !== false; // 默认 true
    const targetStatus = options?.status || 'pending';
    const existing = this.getSubTask(input.taskId);

    if (!existing) {
      // 新建（验证父任务存在）
      const mainTask = this.getMainTask(input.parentTaskId);
      if (!mainTask) {
        throw new Error(`Parent main task "${input.parentTaskId}" not found for project "${this.projectName}"`);
      }

      const now = Date.now();
      const taskData = {
        taskId: input.taskId,
        title: input.title,
        estimatedHours: input.estimatedHours || 0,
        relatedFiles: input.relatedFiles || [],
        description: input.description || '',
      };

      const docInput: DocumentInput = {
        content: JSON.stringify(taskData),
        contentType: ContentType.Text,
        parentId: mainTask.id,
        tags: [
          `plan:${this.projectName}`,
          'type:sub-task',
          `stask:${input.taskId}`,
          `parent:${input.parentTaskId}`,
          `status:${targetStatus}`,
        ],
        metadata: {
          projectName: this.projectName,
          taskId: input.taskId,
          parentTaskId: input.parentTaskId,
          status: targetStatus,
          createdAt: now,
          updatedAt: now,
          completedAt: targetStatus === 'completed' ? now : null,
        },
        importance: 0.7,
      };

      const id = this.taskStore.put(docInput);
      this.refreshMainTaskCounts(input.parentTaskId);
      this.taskStore.flush();

      return {
        id,
        projectName: this.projectName,
        ...taskData,
        parentTaskId: input.parentTaskId,
        status: targetStatus,
        createdAt: now,
        updatedAt: now,
        completedAt: targetStatus === 'completed' ? now : null,
      };
    }

    // 已存在 — 决定最终状态
    let finalStatus = targetStatus;
    if (preserveStatus) {
      const statusPriority: Record<TaskStatus, number> = {
        cancelled: 0,
        pending: 1,
        in_progress: 2,
        completed: 3,
      };
      if (statusPriority[existing.status] >= statusPriority[targetStatus]) {
        finalStatus = existing.status;
      }
    }

    // 检查是否有实质性变化（避免无意义的更新，减少历史版本膨胀）
    if (
      existing.title === input.title &&
      existing.description === (input.description || '') &&
      existing.status === finalStatus &&
      existing.estimatedHours === (input.estimatedHours || 0)
    ) {
      // 无变化，直接返回
      return existing;
    }

    // 删除旧版本并确保时间戳递增
    this.deleteAndEnsureTimestampAdvance(this.taskStore, existing.id);

    const mainTask = this.getMainTask(input.parentTaskId);
    const now = Date.now();
    const completedAt = finalStatus === 'completed' ? (existing.completedAt || now) : null;

    const taskData = {
      taskId: input.taskId,
      title: input.title,
      estimatedHours: input.estimatedHours || existing.estimatedHours || 0,
      relatedFiles: input.relatedFiles || existing.relatedFiles || [],
      description: input.description || existing.description || '',
    };

    const docInput: DocumentInput = {
      content: JSON.stringify(taskData),
      contentType: ContentType.Text,
      parentId: mainTask?.id || undefined,
      tags: [
        `plan:${this.projectName}`,
        'type:sub-task',
        `stask:${input.taskId}`,
        `parent:${input.parentTaskId}`,
        `status:${finalStatus}`,
      ],
      metadata: {
        projectName: this.projectName,
        taskId: input.taskId,
        parentTaskId: input.parentTaskId,
        status: finalStatus,
        createdAt: existing.createdAt,
        updatedAt: now,
        completedAt,
        completedAtCommit: existing.completedAtCommit || null,
        revertReason: existing.revertReason || null,
      },
      importance: 0.7,
    };

    const id = this.taskStore.put(docInput);
    this.refreshMainTaskCounts(input.parentTaskId);
    this.taskStore.flush();

    return {
      ...existing,
      ...taskData,
      id,
      status: finalStatus,
      updatedAt: now,
      completedAt,
    };
  }

  /**
   * 获取子任务
   *
   * 取同一 taskId 的最新版本（以 metadata.updatedAt 判定）。
   */
  getSubTask(taskId: string): SubTask | null {
    const tag = `stask:${taskId}`;
    const docs = this.taskStore.findByTag(tag)
      .filter((doc: any) =>
        (doc.tags as string[]).includes(`plan:${this.projectName}`)
      );

    if (docs.length === 0) return null;

    // 取最新版本（以 metadata.updatedAt 为判定依据）
    const latest = docs.sort((a: any, b: any) =>
      this.getDocUpdatedAt(b) - this.getDocUpdatedAt(a)
    )[0];
    return this.docToSubTask(latest);
  }

  /**
   * 列出某主任务下的所有子任务
   *
   * 对同一 taskId 的多个历史版本做去重，仅保留最新版。
   */
  listSubTasks(parentTaskId: string, filter?: {
    status?: TaskStatus;
  }): SubTask[] {
    const parentTag = `parent:${parentTaskId}`;
    let docs = this.taskStore.findByTag(parentTag)
      .filter((doc: any) =>
        (doc.tags as string[]).includes(`plan:${this.projectName}`) &&
        (doc.tags as string[]).includes('type:sub-task')
      );

    // 按 taskId 去重，仅保留最新版本
    docs = this.deduplicateByTaskId(docs);

    if (filter?.status) {
      const statusTag = `status:${filter.status}`;
      docs = docs.filter((doc: any) => (doc.tags as string[]).includes(statusTag));
    }

    return docs.map((doc: any) => this.docToSubTask(doc));
  }

  /**
   * 更新子任务状态
   *
   * @param options.completedAtCommit - 完成时的 Git commit hash（仅 status=completed 时有效）
   * @param options.revertReason - 回退原因（仅 status 从 completed 变为 pending 时有效）
   */
  updateSubTaskStatus(taskId: string, status: TaskStatus, options?: {
    completedAtCommit?: string;
    revertReason?: string;
  }): SubTask | null {
    const subTask = this.getSubTask(taskId);
    if (!subTask) return null;

    // 获取父任务以保留 parentId
    const mainTask = this.getMainTask(subTask.parentTaskId);

    this.deleteAndEnsureTimestampAdvance(this.taskStore, subTask.id);

    const now = Date.now();
    const completedAt = status === 'completed' ? now : (status === 'pending' ? null : subTask.completedAt);
    const completedAtCommit = status === 'completed'
      ? (options?.completedAtCommit || subTask.completedAtCommit)
      : (status === 'pending' ? undefined : subTask.completedAtCommit);
    const revertReason = options?.revertReason || (status === 'pending' ? undefined : subTask.revertReason);

    const taskData = {
      taskId: subTask.taskId,
      title: subTask.title,
      estimatedHours: subTask.estimatedHours || 0,
      relatedFiles: subTask.relatedFiles || [],
      description: subTask.description || '',
    };

    const docInput: DocumentInput = {
      content: JSON.stringify(taskData),
      contentType: ContentType.Text,
      parentId: mainTask?.id || undefined,
      tags: [
        `plan:${this.projectName}`,
        'type:sub-task',
        `stask:${subTask.taskId}`,
        `parent:${subTask.parentTaskId}`,
        `status:${status}`,
      ],
      metadata: {
        projectName: this.projectName,
        taskId: subTask.taskId,
        parentTaskId: subTask.parentTaskId,
        status,
        createdAt: subTask.createdAt,
        updatedAt: now,
        completedAt,
        completedAtCommit: completedAtCommit || null,
        revertReason: revertReason || null,
      },
      importance: 0.7,
    };

    const id = this.taskStore.put(docInput);
    this.taskStore.flush();

    return {
      ...subTask,
      id,
      status,
      updatedAt: now,
      completedAt,
      completedAtCommit,
      revertReason,
    };
  }

  // ==========================================================================
  // Core: Task Completion Workflow
  // ==========================================================================

  /**
   * 完成子任务 — 核心自动化方法
   *
   * 自动处理：
   * 1. 获取当前 Git HEAD 的 short SHA 用于锚定
   * 2. 更新子任务状态为 completed，写入 completedAt 时间戳和 completedAtCommit
   * 3. 重新计算主任务的 completedSubtasks 计数
   * 4. 如果全部子任务完成，自动标记主任务为 completed
   * 5. 如果主任务完成，更新 milestones 文档
   */
  completeSubTask(taskId: string): CompleteSubTaskResult {
    // 1. 获取当前 Git commit hash
    const commitHash = this.getCurrentGitCommit();

    // 2. 更新子任务（带 Git commit 锚定）
    const updatedSubTask = this.updateSubTaskStatus(taskId, 'completed', {
      completedAtCommit: commitHash,
    });
    if (!updatedSubTask) {
      throw new Error(`Sub task "${taskId}" not found for project "${this.projectName}"`);
    }

    // 3. 刷新主任务计数
    const updatedMainTask = this.refreshMainTaskCounts(updatedSubTask.parentTaskId);
    if (!updatedMainTask) {
      throw new Error(`Parent main task "${updatedSubTask.parentTaskId}" not found`);
    }

    // 4. 检查主任务是否全部完成
    const mainTaskCompleted =
      updatedMainTask.totalSubtasks > 0 &&
      updatedMainTask.completedSubtasks >= updatedMainTask.totalSubtasks;

    if (mainTaskCompleted && updatedMainTask.status !== 'completed') {
      const completedMain = this.updateMainTaskStatus(updatedSubTask.parentTaskId, 'completed');
      if (completedMain) {
        // 5. 更新 milestones 文档（如果存在）
        this.autoUpdateMilestones(completedMain);
        return {
          subTask: updatedSubTask,
          mainTask: completedMain,
          mainTaskCompleted: true,
          completedAtCommit: commitHash,
        };
      }
    }

    return {
      subTask: updatedSubTask,
      mainTask: updatedMainTask,
      mainTaskCompleted,
      completedAtCommit: commitHash,
    };
  }

  /**
   * 手动完成主任务（跳过子任务检查）
   */
  completeMainTask(taskId: string): MainTask {
    const result = this.updateMainTaskStatus(taskId, 'completed');
    if (!result) {
      throw new Error(`Main task "${taskId}" not found for project "${this.projectName}"`);
    }
    this.autoUpdateMilestones(result);
    return result;
  }

  // ==========================================================================
  // Progress & Statistics
  // ==========================================================================

  /**
   * 获取项目整体进度
   */
  getProgress(): ProjectProgress {
    const sections = this.listSections();
    const mainTasks = this.listMainTasks();

    let totalSub = 0;
    let completedSub = 0;
    const taskProgressList: MainTaskProgress[] = [];

    for (const mt of mainTasks) {
      const subs = this.listSubTasks(mt.taskId);
      const subCompleted = subs.filter(s => s.status === 'completed').length;

      totalSub += subs.length;
      completedSub += subCompleted;

      taskProgressList.push({
        taskId: mt.taskId,
        title: mt.title,
        priority: mt.priority,
        status: mt.status,
        total: subs.length,
        completed: subCompleted,
        percent: subs.length > 0 ? Math.round((subCompleted / subs.length) * 100) : 0,
      });
    }

    const completedMainTasks = mainTasks.filter(mt => mt.status === 'completed').length;

    return {
      projectName: this.projectName,
      sectionCount: sections.length,
      mainTaskCount: mainTasks.length,
      completedMainTasks,
      subTaskCount: totalSub,
      completedSubTasks: completedSub,
      overallPercent: totalSub > 0 ? Math.round((completedSub / totalSub) * 100) : 0,
      tasks: taskProgressList,
    };
  }

  // ==========================================================================
  // Markdown Export
  // ==========================================================================

  /**
   * 导出完整的 Markdown 文档
   */
  exportToMarkdown(): string {
    const sections = this.listSections();
    const progress = this.getProgress();

    let md = `# ${this.projectName} - 开发计划\n\n`;
    md += `> 生成时间: ${new Date().toISOString()}\n`;
    md += `> 总体进度: ${progress.overallPercent}% (${progress.completedSubTasks}/${progress.subTaskCount})\n\n`;

    // 文档片段
    const sectionOrder: DevPlanSection[] = [
      'overview', 'core_concepts', 'api_design', 'file_structure',
      'config', 'examples', 'technical_notes', 'api_endpoints',
      'milestones', 'changelog', 'custom',
    ];

    for (const sectionType of sectionOrder) {
      const sectionDocs = sections.filter(s => s.section === sectionType);
      for (const doc of sectionDocs) {
        md += doc.content + '\n\n---\n\n';
      }
    }

    // 任务进度
    md += '## 开发任务进度\n\n';
    for (const taskProg of progress.tasks) {
      const statusIcon = taskProg.status === 'completed' ? '✅'
        : taskProg.status === 'in_progress' ? '🔄'
        : taskProg.status === 'cancelled' ? '❌' : '⬜';
      md += `### ${statusIcon} ${taskProg.title} (${taskProg.completed}/${taskProg.total})\n\n`;

      const subs = this.listSubTasks(taskProg.taskId);
      if (subs.length > 0) {
        md += '| 任务 | 描述 | 状态 | 完成日期 |\n';
        md += '|-----|------|------|--------|\n';
        for (const sub of subs) {
          const subIcon = sub.status === 'completed' ? '✅ 已完成'
            : sub.status === 'in_progress' ? '🔄 进行中'
            : sub.status === 'cancelled' ? '❌ 已取消' : '⬜ 待开始';
          const date = sub.completedAt
            ? new Date(sub.completedAt).toISOString().split('T')[0]
            : '-';
          md += `| ${sub.taskId} | ${sub.title} | ${subIcon} | ${date} |\n`;
        }
        md += '\n';
      }
    }

    return md;
  }

  /**
   * 导出仅任务进度的简洁 Markdown
   */
  exportTaskSummary(): string {
    const progress = this.getProgress();

    let md = `# ${this.projectName} - 任务进度总览\n\n`;
    md += `> 更新时间: ${new Date().toISOString()}\n`;
    md += `> 总体进度: **${progress.overallPercent}%** (${progress.completedSubTasks}/${progress.subTaskCount} 子任务完成)\n`;
    md += `> 主任务完成: ${progress.completedMainTasks}/${progress.mainTaskCount}\n\n`;

    for (const tp of progress.tasks) {
      const bar = this.progressBar(tp.percent);
      const statusIcon = tp.status === 'completed' ? '✅'
        : tp.status === 'in_progress' ? '🔄' : '⬜';
      md += `${statusIcon} **${tp.title}** [${tp.priority}]\n`;
      md += `   ${bar} ${tp.percent}% (${tp.completed}/${tp.total})\n\n`;
    }

    return md;
  }

  // ==========================================================================
  // Module Operations
  // ==========================================================================

  /**
   * 创建功能模块
   */
  createModule(input: ModuleInput): Module {
    const existing = this.getModule(input.moduleId);
    if (existing) {
      throw new Error(`Module "${input.moduleId}" already exists for project "${this.projectName}"`);
    }

    const now = Date.now();
    const status = input.status || 'active';

    const moduleData = {
      moduleId: input.moduleId,
      name: input.name,
      description: input.description || '',
    };

    const docInput: DocumentInput = {
      content: JSON.stringify(moduleData),
      contentType: ContentType.Text,
      tags: [
        `plan:${this.projectName}`,
        'type:module',
        `module:${input.moduleId}`,
        `status:${status}`,
      ],
      metadata: {
        projectName: this.projectName,
        moduleId: input.moduleId,
        status,
        createdAt: now,
        updatedAt: now,
      },
      importance: 0.85,
    };

    const id = this.moduleStore.put(docInput);
    this.moduleStore.flush();

    return {
      id,
      projectName: this.projectName,
      moduleId: input.moduleId,
      name: input.name,
      description: input.description,
      status,
      mainTaskCount: 0,
      subTaskCount: 0,
      completedSubTaskCount: 0,
      docCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 获取功能模块（含自动计算的 taskCount/docCount）
   */
  getModule(moduleId: string): Module | null {
    const tag = `module:${moduleId}`;
    const docs = this.moduleStore.findByTag(tag)
      .filter((doc: any) =>
        (doc.tags as string[]).includes(`plan:${this.projectName}`)
      );

    if (docs.length === 0) return null;

    const latest = docs.sort((a: any, b: any) =>
      this.getDocUpdatedAt(b) - this.getDocUpdatedAt(a)
    )[0];

    return this.docToModule(latest);
  }

  /**
   * 列出所有功能模块
   */
  listModules(filter?: { status?: ModuleStatus }): Module[] {
    let docs = this.moduleStore.findByTag(`plan:${this.projectName}`)
      .filter((doc: any) => (doc.tags as string[]).includes('type:module'));

    // 按 moduleId 去重
    const latestMap = new Map<string, any>();
    for (const doc of docs) {
      const data = JSON.parse(doc.content);
      const moduleId = data.moduleId;
      if (!moduleId) continue;
      const existing = latestMap.get(moduleId);
      if (!existing || this.getDocUpdatedAt(doc) > this.getDocUpdatedAt(existing)) {
        latestMap.set(moduleId, doc);
      }
    }
    docs = Array.from(latestMap.values());

    if (filter?.status) {
      const statusTag = `status:${filter.status}`;
      docs = docs.filter((doc: any) => (doc.tags as string[]).includes(statusTag));
    }

    return docs.map((doc: any) => this.docToModule(doc));
  }

  /**
   * 更新功能模块
   */
  updateModule(moduleId: string, updates: {
    name?: string;
    description?: string;
    status?: ModuleStatus;
  }): Module | null {
    const existing = this.getModule(moduleId);
    if (!existing) return null;

    this.deleteAndEnsureTimestampAdvance(this.moduleStore, existing.id);

    const now = Date.now();
    const newName = updates.name || existing.name;
    const newDescription = updates.description !== undefined ? updates.description : existing.description;
    const newStatus = updates.status || existing.status;

    const moduleData = {
      moduleId,
      name: newName,
      description: newDescription || '',
    };

    const docInput: DocumentInput = {
      content: JSON.stringify(moduleData),
      contentType: ContentType.Text,
      tags: [
        `plan:${this.projectName}`,
        'type:module',
        `module:${moduleId}`,
        `status:${newStatus}`,
      ],
      metadata: {
        projectName: this.projectName,
        moduleId,
        status: newStatus,
        createdAt: existing.createdAt,
        updatedAt: now,
      },
      importance: 0.85,
    };

    const id = this.moduleStore.put(docInput);
    this.moduleStore.flush();

    return {
      id,
      projectName: this.projectName,
      moduleId,
      name: newName,
      description: newDescription,
      status: newStatus,
      mainTaskCount: existing.mainTaskCount,
      subTaskCount: existing.subTaskCount,
      completedSubTaskCount: existing.completedSubTaskCount,
      docCount: existing.docCount,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  /**
   * 删除功能模块
   */
  deleteModule(moduleId: string): boolean {
    const existing = this.getModule(moduleId);
    if (!existing) return false;
    this.moduleStore.delete(existing.id);
    this.moduleStore.flush();
    return true;
  }

  /**
   * 获取模块详情 — 包含关联的任务和文档
   */
  getModuleDetail(moduleId: string): ModuleDetail | null {
    const mod = this.getModule(moduleId);
    if (!mod) return null;

    // 获取关联的主任务
    const moduleTag = `module:${moduleId}`;
    let taskDocs = this.taskStore.findByTag(moduleTag)
      .filter((doc: any) =>
        (doc.tags as string[]).includes(`plan:${this.projectName}`) &&
        (doc.tags as string[]).includes('type:main-task')
      );
    taskDocs = this.deduplicateByTaskId(taskDocs);
    const mainTasks = taskDocs.map((doc: any) => this.docToMainTask(doc));

    // 获取关联的所有子任务（通过主任务间接关联）
    const subTasks: SubTask[] = [];
    for (const mt of mainTasks) {
      const subs = this.listSubTasks(mt.taskId);
      subTasks.push(...subs);
    }

    // 获取关联的文档
    let docDocs = this.docStore.findByTag(moduleTag)
      .filter((doc: any) =>
        (doc.tags as string[]).includes(`plan:${this.projectName}`)
      );
    // 按 section+subSection 去重
    const latestDocMap = new Map<string, any>();
    for (const doc of docDocs) {
      const sectionTag = (doc.tags as string[]).find((t: string) => t.startsWith('section:'));
      const subTag = (doc.tags as string[]).find((t: string) => t.startsWith('sub:'));
      const key = `${sectionTag || 'unknown'}|${subTag || ''}`;
      const ex = latestDocMap.get(key);
      if (!ex || this.getDocUpdatedAt(doc) > this.getDocUpdatedAt(ex)) {
        latestDocMap.set(key, doc);
      }
    }
    const documents = Array.from(latestDocMap.values()).map((doc: any) => this.docToDevPlanDoc(doc));

    return { module: mod, mainTasks, subTasks, documents };
  }

  // ==========================================================================
  // Utility
  // ==========================================================================

  /**
   * 将存储的更改刷到磁盘
   */
  sync(): void {
    this.docStore.flush();
    this.taskStore.flush();
    this.moduleStore.flush();
  }

  /**
   * 获取项目名称
   */
  getProjectName(): string {
    return this.projectName;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * 获取文档的有效 updatedAt 时间戳。
   *
   * EnhancedDocumentStore 使用 append-only JSONL 存储，修改文档时实际上
   * 是 delete 旧文档 + put 新文档。因此同一逻辑文档可能存在多个物理版本。
   * 必须通过 metadata.updatedAt 来判断哪个是最新的"可用文档"，
   * 其余的都是"历史文档"。
   *
   * 优先级：metadata.updatedAt > metadata.createdAt > doc.createdAt
   */
  private getDocUpdatedAt(doc: any): number {
    return doc.metadata?.updatedAt || doc.metadata?.createdAt || doc.createdAt;
  }

  /**
   * 确保当前时间戳严格大于参考时间戳。
   *
   * EnhancedDocumentStore 使用 append-only JSONL 存储，保留所有历史版本。
   * 版本选择通过 metadata.updatedAt 判定最新文档。
   * 如果 delete+put 发生在同一毫秒内，新旧版本的 updatedAt 相同，
   * 会导致去重时可能选中旧版本（如 pending 状态），造成状态丢失。
   *
   * 本方法在 delete 之后、put 之前调用，自旋等待直到时间戳前进，
   * 从而保证新版本的 updatedAt 一定大于旧版本。
   */
  private ensureTimestampAfter(referenceTimestamp: number): void {
    while (Date.now() <= referenceTimestamp) {
      // 自旋等待直到当前时间严格大于参考时间戳
    }
  }

  /**
   * 删除文档并确保后续 put 的 updatedAt 严格大于被删文档。
   *
   * 使用 metadata.updatedAt 作为参考时间戳（而非 doc.createdAt），
   * 因为版本选择是基于 metadata.updatedAt 进行的。
   */
  private deleteAndEnsureTimestampAdvance(
    store: InstanceType<typeof EnhancedDocumentStore>,
    id: string
  ): void {
    const deleted = store.delete(id);
    if (deleted) {
      // 以 metadata.updatedAt 为基准，确保新文档的 updatedAt 严格递增
      const refTimestamp = this.getDocUpdatedAt(deleted);
      this.ensureTimestampAfter(refTimestamp);
    }
  }

  /**
   * 对同一 taskId 的多个历史版本做去重，仅保留最新版（metadata.updatedAt 最大）。
   *
   * 由于 EnhancedDocumentStore 使用 append-only JSONL 存储，
   * delete+put 操作会在文件中保留历史版本。重新加载时所有版本都会出现，
   * 因此需要在查询层面进行去重。
   *
   * 使用 metadata.updatedAt（而非 doc.createdAt）作为版本判定依据，
   * 确保"最近更新时间"的文档才是可用文档，其余为历史文档。
   */
  private deduplicateByTaskId(docs: any[]): any[] {
    const latestMap = new Map<string, any>();
    for (const doc of docs) {
      const data = JSON.parse(doc.content);
      const taskId = data.taskId;
      if (!taskId) continue;

      const existing = latestMap.get(taskId);
      if (!existing || this.getDocUpdatedAt(doc) > this.getDocUpdatedAt(existing)) {
        latestMap.set(taskId, doc);
      }
    }
    return Array.from(latestMap.values());
  }

  private docToDevPlanDoc(doc: any): DevPlanDoc {
    const sectionTag = (doc.tags as string[]).find((t: string) => t.startsWith('section:'));
    const section = (sectionTag?.replace('section:', '') || 'custom') as DevPlanSection;
    const subTag = (doc.tags as string[]).find((t: string) => t.startsWith('sub:'));
    const subSection = subTag?.replace('sub:', '');
    const moduleTag = (doc.tags as string[]).find((t: string) => t.startsWith('module:'));
    const moduleId = moduleTag?.replace('module:', '') || undefined;

    return {
      id: doc.id,
      projectName: this.projectName,
      section,
      title: doc.metadata?.title || '',
      content: doc.content,
      version: doc.metadata?.version || '1.0.0',
      subSection,
      relatedSections: doc.metadata?.relatedSections || [],
      moduleId,
      createdAt: doc.metadata?.createdAt || doc.createdAt,
      updatedAt: doc.metadata?.updatedAt || doc.createdAt,
    };
  }

  private docToMainTask(doc: any): MainTask {
    const data = JSON.parse(doc.content);
    const statusTag = (doc.tags as string[]).find((t: string) => t.startsWith('status:'));
    const status = (statusTag?.replace('status:', '') || 'pending') as TaskStatus;
    const moduleTag = (doc.tags as string[]).find((t: string) => t.startsWith('module:'));
    const moduleId = moduleTag?.replace('module:', '') || undefined;

    return {
      id: doc.id,
      projectName: this.projectName,
      taskId: data.taskId,
      title: data.title,
      priority: data.priority,
      description: data.description,
      estimatedHours: data.estimatedHours,
      relatedSections: data.relatedSections || [],
      moduleId,
      totalSubtasks: data.totalSubtasks || 0,
      completedSubtasks: data.completedSubtasks || 0,
      status,
      createdAt: doc.metadata?.createdAt || doc.createdAt,
      updatedAt: doc.metadata?.updatedAt || doc.createdAt,
      completedAt: doc.metadata?.completedAt || null,
    };
  }

  private docToModule(doc: any): Module {
    const data = JSON.parse(doc.content);
    const statusTag = (doc.tags as string[]).find((t: string) => t.startsWith('status:'));
    const status = (statusTag?.replace('status:', '') || 'active') as ModuleStatus;
    const moduleId = data.moduleId;

    // 计算关联的主任务数（去重）
    const moduleTag = `module:${moduleId}`;
    const taskDocs = this.taskStore.findByTag(moduleTag)
      .filter((d: any) =>
        (d.tags as string[]).includes(`plan:${this.projectName}`) &&
        (d.tags as string[]).includes('type:main-task')
      );
    const uniqueTaskIds = new Set<string>();
    for (const td of taskDocs) {
      try { uniqueTaskIds.add(JSON.parse(td.content).taskId); } catch {}
    }

    // 计算关联的子任务数（遍历关联主任务下的所有子任务）
    // 注意：findByTag 在 JSONL 重新加载后可能返回同一子任务的多个历史版本，
    // 必须按 taskId 去重并取 metadata.updatedAt 最新的版本，才能读到正确的状态。
    let subTaskCount = 0;
    let completedSubTaskCount = 0;
    for (const mainTaskId of uniqueTaskIds) {
      const subDocs = this.taskStore.findByTag(`parent:${mainTaskId}`)
        .filter((d: any) =>
          (d.tags as string[]).includes(`plan:${this.projectName}`) &&
          (d.tags as string[]).includes('type:sub-task')
        );
      // 按 taskId 去重，保留 updatedAt 最新的版本
      const latestSubMap = new Map<string, any>();
      for (const sd of subDocs) {
        try {
          const subData = JSON.parse(sd.content);
          const subId = subData.taskId;
          if (!subId) continue;
          const existing = latestSubMap.get(subId);
          if (!existing || this.getDocUpdatedAt(sd) > this.getDocUpdatedAt(existing)) {
            latestSubMap.set(subId, sd);
          }
        } catch {}
      }
      for (const sd of latestSubMap.values()) {
        subTaskCount++;
        const subStatusTag = (sd.tags as string[]).find((t: string) => t.startsWith('status:'));
        if (subStatusTag === 'status:completed') {
          completedSubTaskCount++;
        }
      }
    }

    // 计算关联的文档数（按 section+subSection 去重）
    const docDocs = this.docStore.findByTag(moduleTag)
      .filter((d: any) =>
        (d.tags as string[]).includes(`plan:${this.projectName}`)
      );
    const uniqueDocKeys = new Set<string>();
    for (const dd of docDocs) {
      const st = (dd.tags as string[]).find((t: string) => t.startsWith('section:'));
      const sub = (dd.tags as string[]).find((t: string) => t.startsWith('sub:'));
      uniqueDocKeys.add(`${st || ''}|${sub || ''}`);
    }

    return {
      id: doc.id,
      projectName: this.projectName,
      moduleId,
      name: data.name,
      description: data.description || undefined,
      status,
      mainTaskCount: uniqueTaskIds.size,
      subTaskCount,
      completedSubTaskCount,
      docCount: uniqueDocKeys.size,
      createdAt: doc.metadata?.createdAt || doc.createdAt,
      updatedAt: doc.metadata?.updatedAt || doc.createdAt,
    };
  }

  private docToSubTask(doc: any): SubTask {
    const data = JSON.parse(doc.content);
    const statusTag = (doc.tags as string[]).find((t: string) => t.startsWith('status:'));
    const status = (statusTag?.replace('status:', '') || 'pending') as TaskStatus;
    const parentTag = (doc.tags as string[]).find((t: string) => t.startsWith('parent:'));
    const parentTaskId = parentTag?.replace('parent:', '') || '';

    return {
      id: doc.id,
      projectName: this.projectName,
      taskId: data.taskId,
      parentTaskId,
      title: data.title,
      estimatedHours: data.estimatedHours,
      relatedFiles: data.relatedFiles || [],
      description: data.description,
      status,
      createdAt: doc.metadata?.createdAt || doc.createdAt,
      updatedAt: doc.metadata?.updatedAt || doc.createdAt,
      completedAt: doc.metadata?.completedAt || null,
      completedAtCommit: doc.metadata?.completedAtCommit || undefined,
      revertReason: doc.metadata?.revertReason || undefined,
    };
  }

  /**
   * 刷新主任务的子任务计数
   */
  private refreshMainTaskCounts(mainTaskId: string): MainTask | null {
    const mainTask = this.getMainTask(mainTaskId);
    if (!mainTask) return null;

    const subs = this.listSubTasks(mainTaskId);
    const completedCount = subs.filter(s => s.status === 'completed').length;

    // 如果计数没变，不需要更新
    if (mainTask.totalSubtasks === subs.length && mainTask.completedSubtasks === completedCount) {
      return mainTask;
    }

    this.deleteAndEnsureTimestampAdvance(this.taskStore, mainTask.id);

    const now = Date.now();
    const taskData = {
      taskId: mainTask.taskId,
      title: mainTask.title,
      priority: mainTask.priority,
      description: mainTask.description || '',
      estimatedHours: mainTask.estimatedHours || 0,
      relatedSections: mainTask.relatedSections || [],
      totalSubtasks: subs.length,
      completedSubtasks: completedCount,
    };

    const tags = [
      `plan:${this.projectName}`,
      'type:main-task',
      `mtask:${mainTask.taskId}`,
      `priority:${mainTask.priority}`,
      `status:${mainTask.status}`,
    ];
    if (mainTask.moduleId) {
      tags.push(`module:${mainTask.moduleId}`);
    }

    const docInput: DocumentInput = {
      content: JSON.stringify(taskData),
      contentType: ContentType.Text,
      tags,
      metadata: {
        projectName: this.projectName,
        taskId: mainTask.taskId,
        status: mainTask.status,
        moduleId: mainTask.moduleId || null,
        createdAt: mainTask.createdAt,
        updatedAt: now,
        completedAt: mainTask.completedAt,
      },
      importance: mainTask.priority === 'P0' ? 0.95 : mainTask.priority === 'P1' ? 0.8 : 0.6,
    };

    const id = this.taskStore.put(docInput);
    this.taskStore.flush();

    return {
      ...mainTask,
      id,
      totalSubtasks: subs.length,
      completedSubtasks: completedCount,
      updatedAt: now,
    };
  }

  /**
   * 当主任务完成时自动更新 milestones 文档
   */
  private autoUpdateMilestones(completedMainTask: MainTask): void {
    const milestonesDoc = this.getSection('milestones');
    if (!milestonesDoc) return;

    const dateStr = new Date().toISOString().split('T')[0];
    const appendLine = `\n| ${completedMainTask.taskId} | ${completedMainTask.title} | ${dateStr} | ✅ 已完成 |`;

    // 追加到 milestones 内容末尾
    const updatedContent = milestonesDoc.content + appendLine;
    this.saveSection({
      projectName: this.projectName,
      section: 'milestones',
      title: milestonesDoc.title,
      content: updatedContent,
      version: milestonesDoc.version,
      relatedSections: milestonesDoc.relatedSections,
    });
  }

  // ==========================================================================
  // Git Integration (Git Commit 锚定 + 同步检查)
  // ==========================================================================

  /**
   * 🆕 获取当前 Git HEAD 的 short SHA
   *
   * 在非 Git 仓库或 Git 不可用时返回 undefined，不阻断正常流程。
   */
  private getCurrentGitCommit(): string | undefined {
    try {
      const { execSync } = require('child_process');
      return execSync('git rev-parse --short HEAD', {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'], // 静默 stderr
      }).trim();
    } catch {
      return undefined; // 非 Git 仓库或 Git 不可用
    }
  }

  /**
   * 🆕 检查 commit 是否是 target 的祖先
   *
   * 使用 `git merge-base --is-ancestor` 命令。
   * 如果 commit 不存在或不可达，返回 false（视为需要回退）。
   */
  private isAncestor(commit: string, target: string): boolean {
    try {
      const { execSync } = require('child_process');
      execSync(`git merge-base --is-ancestor ${commit} ${target}`, {
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true; // exit code 0 = is ancestor
    } catch {
      return false; // exit code 1 = not ancestor, or error
    }
  }

  /**
   * 🆕 回退子任务状态
   *
   * 将已完成的子任务回退为 pending，记录回退原因，
   * 清空 completedAtCommit 和 completedAt。
   * 同时刷新父主任务的计数。
   */
  private revertSubTask(taskId: string, reason: string): SubTask | null {
    const result = this.updateSubTaskStatus(taskId, 'pending', {
      revertReason: reason,
    });

    if (result) {
      // 刷新父主任务计数
      this.refreshMainTaskCounts(result.parentTaskId);

      // 如果父主任务被标记为 completed，也需要回退
      const mainTask = this.getMainTask(result.parentTaskId);
      if (mainTask && mainTask.status === 'completed') {
        this.updateMainTaskStatus(result.parentTaskId, 'in_progress');
      }
    }

    return result;
  }

  /**
   * 🆕 同步检查所有已完成任务与 Git 历史的一致性
   *
   * 对每个 status=completed 且有 completedAtCommit 的子任务：
   * 1. 检查 completedAtCommit 是否是当前 HEAD 的祖先
   * 2. 如果不是（说明 Git 发生了回滚），回退任务状态为 pending
   * 3. 记录 revertReason
   *
   * @param dryRun 如果为 true，只返回哪些任务会被回退，不实际修改数据
   * @returns 同步结果，包含被回退的任务列表
   */
  syncWithGit(dryRun: boolean = false): SyncGitResult {
    const currentHead = this.getCurrentGitCommit();

    if (!currentHead) {
      return {
        checked: 0,
        reverted: [],
        currentHead: 'unknown',
        error: 'Git not available or not in a Git repository',
      };
    }

    const mainTasks = this.listMainTasks();
    const reverted: RevertedTask[] = [];
    let checked = 0;

    for (const mt of mainTasks) {
      const subs = this.listSubTasks(mt.taskId);
      for (const sub of subs) {
        if (sub.status !== 'completed' || !sub.completedAtCommit) continue;
        checked++;

        if (!this.isAncestor(sub.completedAtCommit, currentHead)) {
          const reason = `Commit ${sub.completedAtCommit} is not ancestor of HEAD ${currentHead}`;

          if (!dryRun) {
            this.revertSubTask(sub.taskId, reason);
          }

          reverted.push({
            taskId: sub.taskId,
            title: sub.title,
            parentTaskId: sub.parentTaskId,
            completedAtCommit: sub.completedAtCommit,
            reason: `Commit ${sub.completedAtCommit} not found in current branch (HEAD: ${currentHead})`,
          });
        }
      }
    }

    return { checked, reverted, currentHead };
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * 生成文本进度条
   */
  private progressBar(percent: number): string {
    const total = 20;
    const filled = Math.round((percent / 100) * total);
    const empty = total - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * 为项目创建 DevPlanStore
 *
 * @param projectName - 项目名称
 * @param basePath - 存储基础路径（默认优先使用项目内 .devplan/，回退到 ~/.aifastdb/dev-plans/）
 *
 * 存储路径解析优先级：
 * 1. 显式 basePath 参数
 * 2. AIFASTDB_DEVPLAN_PATH 环境变量
 * 3. 项目根目录/.devplan/（通过 .git 或 package.json 定位）
 * 4. ~/.aifastdb/dev-plans/（兜底）
 *
 * 最终路径：{basePath}/{projectName}/documents.jsonl + tasks.jsonl
 */
export function createDevPlan(
  projectName: string,
  basePath?: string
): DevPlanStore {
  const base = basePath || getDefaultBasePath();
  return new DevPlanStore(projectName, {
    documentPath: path.join(base, projectName, 'documents.jsonl'),
    taskPath: path.join(base, projectName, 'tasks.jsonl'),
    modulePath: path.join(base, projectName, 'modules.jsonl'),
  });
}

/**
 * 列出所有已有的 DevPlan 项目
 */
export function listDevPlans(basePath?: string): string[] {
  const base = basePath || getDefaultBasePath();
  try {
    const fs = require('fs');
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base).filter((name: string) => {
      const fullPath = path.join(base, name);
      return fs.statSync(fullPath).isDirectory();
    });
  } catch {
    return [];
  }
}

/**
 * 所有标准章节类型列表
 */
export const ALL_SECTIONS: DevPlanSection[] = [
  'overview', 'core_concepts', 'api_design', 'file_structure',
  'config', 'examples', 'technical_notes', 'api_endpoints',
  'milestones', 'changelog', 'custom',
];

/**
 * 标准章节说明
 */
export const SECTION_DESCRIPTIONS: Record<DevPlanSection, string> = {
  overview: '概述：项目背景、目标、架构图、版本说明',
  core_concepts: '核心概念：术语定义、数据模型、关键抽象',
  api_design: 'API 设计：接口定义、类型系统、使用方式',
  file_structure: '文件结构：目录树、模块划分、代码组织',
  config: '配置设计：配置文件格式、环境变量、示例',
  examples: '使用示例：代码片段、调用演示、最佳实践',
  technical_notes: '技术笔记：性能考虑、安全设计、错误处理等（支持多个子文档）',
  api_endpoints: 'API 端点汇总：REST/RPC 端点列表、请求/响应格式',
  milestones: '里程碑：版本目标、交付节点、时间线',
  changelog: '变更记录：版本历史、修改内容、作者',
  custom: '自定义章节：用户自行扩展的任意内容',
};
