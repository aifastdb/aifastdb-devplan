/**
 * IDevPlanStore — 通用开发计划存储接口
 *
 * 定义 DevPlan 的全部存储操作，供两个实现共用：
 * - DevPlanDocumentStore（基于 EnhancedDocumentStore，JSONL 持久化）
 * - DevPlanGraphStore（基于 SocialGraphV2，图结构存储 + 可视化）
 */

import type {
  DevPlanSection,
  DevPlanDocInput,
  DevPlanDoc,
  MainTaskInput,
  MainTask,
  SubTaskInput,
  SubTask,
  CompleteSubTaskResult,
  ProjectProgress,
  ModuleInput,
  Module,
  ModuleDetail,
  ModuleStatus,
  TaskStatus,
  TaskPriority,
  SyncGitResult,
  DevPlanExportedGraph,
} from './types';

// ============================================================================
// IDevPlanStore Interface
// ============================================================================

export interface IDevPlanStore {
  // ==========================================================================
  // Document Section Operations
  // ==========================================================================

  /**
   * 保存文档片段（如果同 section+subSection 已存在则覆盖）
   */
  saveSection(input: DevPlanDocInput): string;

  /**
   * 获取文档片段
   */
  getSection(section: DevPlanSection, subSection?: string): DevPlanDoc | null;

  /**
   * 列出项目的所有文档片段（去重后）
   */
  listSections(): DevPlanDoc[];

  /**
   * 更新文档片段内容
   */
  updateSection(section: DevPlanSection, content: string, subSection?: string): string;

  /**
   * 搜索文档片段
   */
  searchSections(query: string, limit?: number): DevPlanDoc[];

  /**
   * 删除文档片段
   */
  deleteSection(section: DevPlanSection, subSection?: string): boolean;

  // ==========================================================================
  // Main Task Operations
  // ==========================================================================

  /**
   * 创建主任务（开发阶段）
   */
  createMainTask(input: MainTaskInput): MainTask;

  /**
   * 幂等导入主任务（Upsert）
   */
  upsertMainTask(input: MainTaskInput, options?: {
    preserveStatus?: boolean;
    status?: TaskStatus;
  }): MainTask;

  /**
   * 获取主任务
   */
  getMainTask(taskId: string): MainTask | null;

  /**
   * 列出主任务
   */
  listMainTasks(filter?: {
    status?: TaskStatus;
    priority?: TaskPriority;
    moduleId?: string;
  }): MainTask[];

  /**
   * 更新主任务状态
   */
  updateMainTaskStatus(taskId: string, status: TaskStatus): MainTask | null;

  // ==========================================================================
  // Sub Task Operations
  // ==========================================================================

  /**
   * 添加子任务
   */
  addSubTask(input: SubTaskInput): SubTask;

  /**
   * 幂等导入子任务（Upsert）
   */
  upsertSubTask(input: SubTaskInput, options?: {
    preserveStatus?: boolean;
    status?: TaskStatus;
  }): SubTask;

  /**
   * 获取子任务
   */
  getSubTask(taskId: string): SubTask | null;

  /**
   * 列出某主任务下的所有子任务
   */
  listSubTasks(parentTaskId: string, filter?: {
    status?: TaskStatus;
  }): SubTask[];

  /**
   * 更新子任务状态
   */
  updateSubTaskStatus(taskId: string, status: TaskStatus, options?: {
    completedAtCommit?: string;
    revertReason?: string;
  }): SubTask | null;

  // ==========================================================================
  // Completion Workflow
  // ==========================================================================

  /**
   * 完成子任务 — 核心自动化方法
   *
   * 自动处理：更新状态、锚定 Git commit、刷新主任务计数、
   * 全部完成时自动标记主任务、更新 milestones 文档
   */
  completeSubTask(taskId: string): CompleteSubTaskResult;

  /**
   * 手动完成主任务（跳过子任务检查）
   */
  completeMainTask(taskId: string): MainTask;

  // ==========================================================================
  // Progress & Export
  // ==========================================================================

  /**
   * 获取项目整体进度
   */
  getProgress(): ProjectProgress;

  /**
   * 导出完整的 Markdown 文档
   */
  exportToMarkdown(): string;

  /**
   * 导出仅任务进度的简洁 Markdown
   */
  exportTaskSummary(): string;

  // ==========================================================================
  // Module Operations
  // ==========================================================================

  /**
   * 创建功能模块
   */
  createModule(input: ModuleInput): Module;

  /**
   * 获取功能模块（含自动计算的 taskCount/docCount）
   */
  getModule(moduleId: string): Module | null;

  /**
   * 列出所有功能模块
   */
  listModules(filter?: { status?: ModuleStatus }): Module[];

  /**
   * 更新功能模块
   */
  updateModule(moduleId: string, updates: {
    name?: string;
    description?: string;
    status?: ModuleStatus;
  }): Module | null;

  /**
   * 删除功能模块
   */
  deleteModule(moduleId: string): boolean;

  /**
   * 获取模块详情 — 包含关联的任务和文档
   */
  getModuleDetail(moduleId: string): ModuleDetail | null;

  // ==========================================================================
  // Utility
  // ==========================================================================

  /**
   * 将存储的更改刷到磁盘
   */
  sync(): void;

  /**
   * 获取项目名称
   */
  getProjectName(): string;

  /**
   * 同步检查所有已完成任务与 Git 历史的一致性
   */
  syncWithGit(dryRun?: boolean): SyncGitResult;

  // ==========================================================================
  // Document-Task Relationship Queries (仅 SocialGraphV2 实现完整支持)
  // ==========================================================================

  /**
   * 获取主任务关联的文档列表
   */
  getTaskRelatedDocs?(taskId: string): DevPlanDoc[];

  /**
   * 获取文档关联的主任务列表
   */
  getDocRelatedTasks?(section: DevPlanSection, subSection?: string): MainTask[];

  // ==========================================================================
  // Graph Export (仅 SocialGraphV2 实现支持)
  // ==========================================================================

  /**
   * 导出 DevPlan 的图结构用于可视化
   *
   * 仅 DevPlanGraphStore（SocialGraphV2 模式）支持。
   * DevPlanDocumentStore 实现返回 null。
   */
  exportGraph?(options?: {
    includeDocuments?: boolean;
    includeModules?: boolean;
  }): DevPlanExportedGraph | null;
}
