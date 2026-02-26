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
  DevPlanDocTree,
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
  SearchMode,
  ScoredDevPlanDoc,
  RebuildIndexResult,
  PromptInput,
  Prompt,
  MemoryInput,
  Memory,
  MemoryType,
  ScoredMemory,
  MemoryContext,
  MemoryGenerateResult,
  RecallDepth,
  RecallScope,
  DocStrategy,
  UnifiedRecallOptions,
  RecallFeatureFlags,
  RecallFeatureFlagsPatch,
  RecallObservability,
} from './types';

// ============================================================================
// IDevPlanStore Interface
// ============================================================================

export interface IDevPlanStore {
  // ==========================================================================
  // Document Section Operations
  // ==========================================================================

  /**
   * 保存文档片段（如果同 section+subSection 已存在则覆盖 — upsert 语义）
   */
  saveSection(input: DevPlanDocInput): string;

  /**
   * 新增文档片段（纯新增，如果同 section+subSection 已存在则抛错）
   *
   * 与 saveSection 的区别：
   * - saveSection: upsert 语义，已存在则覆盖
   * - addSection:  insert 语义，已存在则报错，防止意外覆盖
   */
  addSection(input: DevPlanDocInput): string;

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
  // Prompt Operations (用户 Prompt 日志)
  // ==========================================================================

  /**
   * 保存一条 Prompt
   *
   * 自动分配 promptIndex (当天内自增序号)。
   * 如果指定了 relatedTaskId，自动建立 task_has_prompt 关系。
   */
  savePrompt(input: PromptInput): Prompt;

  /**
   * 列出 Prompt（支持按日期、关联任务过滤）
   */
  listPrompts(filter?: {
    /** 按日期过滤 (格式 YYYY-MM-DD) */
    date?: string;
    /** 按关联主任务 ID 过滤 */
    relatedTaskId?: string;
    /** 最大返回条数 */
    limit?: number;
  }): Prompt[];

  /**
   * 获取主任务关联的所有 Prompt
   */
  getTaskRelatedPrompts?(taskId: string): Prompt[];

  // ==========================================================================
  // Memory Operations (Cursor 长期记忆)
  // ==========================================================================

  /**
   * 保存一条记忆
   *
   * 记忆内容会自动生成 embedding 并索引到 HNSW 向量索引（如已启用语义搜索）。
   * 如果指定了 relatedTaskId，自动建立 memory_from_task 关系。
   */
  saveMemory?(input: MemoryInput): Memory;

  /**
   * 智能召回记忆 — 基于语义向量搜索
   *
   * DEPRECATED: 推荐使用 `recallUnified()` 统一入口。
   *
   * 将 query 文本 embed 后，通过 HNSW 向量搜索找到最相关的记忆。
   * 命中的记忆自动 +1 hitCount。
   *
   * @param query - 查询文本
   * @param options - 过滤选项
   */
  recallMemory?(query: string, options?: {
    /** 按记忆类型过滤 */
    memoryType?: MemoryType;
    /** 最大返回数 */
    limit?: number;
    /** 最低分数阈值 (0~1) */
    minScore?: number;
    /** 是否包含文档搜索（统一召回，默认 true）。当 docStrategy 有值时此参数被忽略。 */
    includeDocs?: boolean;
    /** Phase-38: 是否启用图谱关联扩展（默认 true） */
    graphExpand?: boolean;
    /** Phase-124: 分层召回深度（默认 "L1"） */
    depth?: RecallDepth;
    /** Phase-124: 范围限定检索 */
    scope?: RecallScope;
    /** Phase-125: 文档检索策略 — 'vector'(默认) | 'guided'(记忆驱动) | 'none'(不检索) */
    docStrategy?: DocStrategy;
  }): ScoredMemory[];

  /**
   * Unified Recall（Phase-79）— 统一召回入口
   */
  recallUnified?(query: string, options?: UnifiedRecallOptions): ScoredMemory[];

  /**
   * 获取 Recall Feature Flags（Phase-79）
   */
  getFeatureFlags?(): RecallFeatureFlags;

  /**
   * 更新 Recall Feature Flags（Phase-79）
   */
  setFeatureFlags?(patch: RecallFeatureFlagsPatch): RecallFeatureFlags;

  /**
   * 获取 Recall 可观测性指标（Phase-79）
   */
  getRecallObservability?(): RecallObservability;

  /**
   * 重置 Recall 可观测性指标（Phase-79）
   */
  resetRecallObservability?(): RecallObservability;

  /**
   * 获取底层 Native 能力探测结果（用于 ABI/版本对齐诊断）
   */
  getNativeCapabilities?(): {
    memoryTreeSearch: boolean;
    anchorExtractFromText: boolean;
    applyMutations: boolean;
  };

  /**
   * 列出记忆（支持过滤）
   */
  listMemories?(filter?: {
    /** 按记忆类型过滤 */
    memoryType?: MemoryType;
    /** 按关联任务过滤 */
    relatedTaskId?: string;
    /** 最大返回数 */
    limit?: number;
  }): Memory[];

  /**
   * 删除一条记忆
   */
  deleteMemory?(memoryId: string): boolean;

  /**
   * 批量清除当前项目的所有记忆
   * @param memoryType - 可选：仅清除指定类型
   */
  clearAllMemories?(memoryType?: string): { deleted: number };

  /**
   * 获取新会话上下文 — 核心工具
   *
   * 聚合最近任务、相关记忆、项目偏好、最近决策，
   * 为 Cursor 新会话提供全面的项目上下文。
   *
   * @param query - 可选查询文本（用于语义召回相关记忆）
   * @param maxMemories - 最大返回记忆数（默认 10）
   */
  getMemoryContext?(query?: string, maxMemories?: number): MemoryContext;

  /**
   * 记忆生成器 — 从已有文档和任务历史中提取记忆候选项
   *
   * MCP 工具聚合已有数据，返回结构化的 "记忆候选项" 列表。
   * AI 分析候选项内容后，选择性调用 devplan_memory_save 批量生成记忆。
   *
   * @param options - 过滤选项
   */
  generateMemoryCandidates?(options?: {
    /** 数据源：tasks=已完成任务, docs=文档, both=全部 (默认 both) */
    source?: 'tasks' | 'docs' | 'both';
    /** 指定阶段 ID (仅从该阶段提取) */
    taskId?: string;
    /** 指定文档 section (仅从该章节提取) */
    section?: string;
    /** 指定文档 subSection */
    subSection?: string;
    /** 最大返回候选项数 (默认 50) */
    limit?: number;
  }): MemoryGenerateResult;

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

  /**
   * Phase-21: 清理 WAL 中的重复 Entity
   *
   * 扫描所有实体类型，按业务键去重，删除多余（低优先级）的 Entity。
   * 仅 DevPlanGraphStore（SocialGraphV2 模式）实现。
   *
   * @param dryRun - 若为 true，仅报告而不实际删除
   */
  cleanupDuplicates?(dryRun?: boolean): {
    cleaned: number;
    details: Array<{ entityType: string; propKey: string; duplicateId: string; keptId: string }>;
  };

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
    includeNodeDegree?: boolean;
    enableBackendDegreeFallback?: boolean;
    includePrompts?: boolean;
    includeMemories?: boolean;
  }): DevPlanExportedGraph | null;

  // ==========================================================================
  // Document Hierarchy (文档层级关系)
  // ==========================================================================

  /**
   * 获取文档的子文档列表
   *
   * 返回指定文档的直接子文档（通过 parentDoc 字段关联）。
   */
  getChildDocs?(section: DevPlanSection, subSection?: string): DevPlanDoc[];

  /**
   * 获取文档树（递归，含所有后代文档）
   *
   * 返回以指定文档为根的完整文档树结构。
   * 仅 DevPlanGraphStore 支持完整的递归查询。
   */
  getDocTree?(section: DevPlanSection, subSection?: string): DevPlanDocTree | null;

  // ==========================================================================
  // Semantic Search (仅 DevPlanGraphStore + enableSemanticSearch 支持)
  // ==========================================================================

  /**
   * 高级搜索：支持 literal / semantic / hybrid 三种模式
   *
   * - literal: 纯字面匹配
   * - semantic: 纯语义向量搜索
   * - hybrid: 字面 + 语义 RRF 融合
   *
   * 仅 DevPlanGraphStore 启用 enableSemanticSearch 时可用。
   */
  searchSectionsAdvanced?(query: string, options?: {
    mode?: SearchMode;
    limit?: number;
    minScore?: number;
  }): ScoredDevPlanDoc[];

  /**
   * 重建所有文档的向量索引
   *
   * 适用于：首次启用语义搜索、模型切换、索引损坏修复。
   */
  rebuildIndex?(): RebuildIndexResult;

  /**
   * 检查语义搜索是否可用
   */
  isSemanticSearchEnabled?(): boolean;
}
