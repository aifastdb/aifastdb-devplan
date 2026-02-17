/**
 * DevPlanDocumentStore — 基于 EnhancedDocumentStore 的开发计划存储实现
 *
 * 使用 aifastdb 的 EnhancedDocumentStore（JSONL 持久化）作为存储引擎。
 * 实现 IDevPlanStore 接口，是 DevPlan 系统的两个存储后端之一。
 *
 * 特性：
 * - JSONL 格式存储，人类可读，利于 Git 版本管理
 * - 通过 tags 做索引查询
 * - Append-only 存储，更新通过 delete + put 实现
 */

import {
  EnhancedDocumentStore,
  documentStoreProductionConfig,
  ContentType,
  type DocumentInput,
} from 'aifastdb';
import type { IDevPlanStore } from './dev-plan-interface';
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
  MainTaskProgress,
  ModuleInput,
  Module,
  ModuleDetail,
  ModuleStatus,
  TaskStatus,
  TaskPriority,
  SyncGitResult,
  RevertedTask,
  DevPlanStoreConfig,
  DevPlanExportedGraph,
  PromptInput,
  Prompt,
} from './types';

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

// ============================================================================
// DevPlanDocumentStore Implementation
// ============================================================================

/**
 * 基于 EnhancedDocumentStore 的开发计划存储
 *
 * 管理项目的开发计划文档和任务，使用三个 EnhancedDocumentStore 实例：
 * - docStore: 文档片段 (Markdown 内容)
 * - taskStore: 任务 (主任务 + 子任务层级)
 * - moduleStore: 功能模块
 * - promptStore: Prompt 日志
 */
export class DevPlanDocumentStore implements IDevPlanStore {
  private docStore: InstanceType<typeof EnhancedDocumentStore>;
  private taskStore: InstanceType<typeof EnhancedDocumentStore>;
  private moduleStore: InstanceType<typeof EnhancedDocumentStore>;
  private promptStore: InstanceType<typeof EnhancedDocumentStore>;
  private projectName: string;
  /** Git 操作的工作目录（多项目路由时指向项目根目录） */
  private gitCwd: string | undefined;

  constructor(projectName: string, config: DevPlanStoreConfig) {
    this.projectName = projectName;
    this.gitCwd = config.gitCwd;
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
    this.promptStore = new EnhancedDocumentStore(
      config.promptPath,
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
    const finalRelatedTaskIds = input.relatedTaskIds || existing?.relatedTaskIds || [];
    const finalParentDoc = input.parentDoc !== undefined ? input.parentDoc : existing?.parentDoc;

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
        relatedTaskIds: finalRelatedTaskIds,
        moduleId: finalModuleId || null,
        parentDoc: finalParentDoc || null,
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
    const order = input.order != null ? input.order : this.getNextMainTaskOrder();
    const taskData = {
      taskId: input.taskId,
      title: input.title,
      priority: input.priority,
      description: input.description || '',
      estimatedHours: input.estimatedHours || 0,
      relatedSections: input.relatedSections || [],
      totalSubtasks: 0,
      completedSubtasks: 0,
      order,
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
        order,
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
    const finalOrder = input.order != null ? input.order : existing.order;

    const taskData = {
      taskId: input.taskId,
      title: input.title,
      priority: input.priority,
      description: input.description || existing.description || '',
      estimatedHours: input.estimatedHours || existing.estimatedHours || 0,
      relatedSections: input.relatedSections || existing.relatedSections || [],
      totalSubtasks: existing.totalSubtasks,
      completedSubtasks: existing.completedSubtasks,
      order: finalOrder,
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
        order: finalOrder,
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

    const tasks = docs.map((doc: any) => this.docToMainTask(doc));
    return this.sortByOrder(tasks);
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
    const order = input.order != null ? input.order : this.getNextSubTaskOrder(input.parentTaskId);
    const taskData = {
      taskId: input.taskId,
      title: input.title,
      estimatedHours: input.estimatedHours || 0,
      relatedFiles: input.relatedFiles || [],
      description: input.description || '',
      order,
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
        order,
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
      const order = input.order != null ? input.order : this.getNextSubTaskOrder(input.parentTaskId);
      const taskData = {
        taskId: input.taskId,
        title: input.title,
        estimatedHours: input.estimatedHours || 0,
        relatedFiles: input.relatedFiles || [],
        description: input.description || '',
        order,
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
          order,
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
    const newOrder = input.order != null ? input.order : existing.order;
    if (
      existing.title === input.title &&
      existing.description === (input.description || '') &&
      existing.status === finalStatus &&
      existing.estimatedHours === (input.estimatedHours || 0) &&
      existing.order === newOrder
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
      order: newOrder,
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
        order: newOrder,
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

    const tasks = docs.map((doc: any) => this.docToSubTask(doc));
    return this.sortByOrder(tasks);
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
        order: mt.order,
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
  // Prompt Operations (Prompt 日志)
  // ==========================================================================

  savePrompt(input: PromptInput): Prompt {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD

    // 获取当天已有 prompt 数量，分配自增序号
    const existingToday = this.listPrompts({ date: today });
    const promptIndex = existingToday.length + 1;

    const promptData = {
      content: input.content,
      summary: input.summary || '',
      relatedTaskId: input.relatedTaskId || null,
    };

    const tags = [
      `plan:${this.projectName}`,
      'type:prompt',
      `date:${today}`,
    ];

    // 关联主任务 tag
    if (input.relatedTaskId) {
      tags.push(`task:${input.relatedTaskId}`);
    }

    // 用户自定义 tags
    if (input.tags?.length) {
      for (const t of input.tags) {
        tags.push(`custom:${t}`);
      }
    }

    const docInput: DocumentInput = {
      content: JSON.stringify(promptData),
      contentType: ContentType.Text,
      tags,
      metadata: {
        projectName: this.projectName,
        promptIndex,
        date: today,
        relatedTaskId: input.relatedTaskId || null,
        tags: input.tags || [],
        createdAt: now,
      },
      importance: 0.5,
    };

    const id = this.promptStore.put(docInput);
    this.promptStore.flush();

    return {
      id,
      projectName: this.projectName,
      promptIndex,
      content: input.content,
      summary: input.summary,
      relatedTaskId: input.relatedTaskId,
      tags: input.tags || [],
      createdAt: now,
    };
  }

  listPrompts(filter?: { date?: string; relatedTaskId?: string; limit?: number }): Prompt[] {
    let docs: any[];

    if (filter?.relatedTaskId) {
      // 按关联任务查询
      docs = this.promptStore.findByTag(`task:${filter.relatedTaskId}`)
        .filter((doc: any) =>
          (doc.tags as string[]).includes(`plan:${this.projectName}`) &&
          (doc.tags as string[]).includes('type:prompt')
        );
    } else if (filter?.date) {
      // 按日期查询
      docs = this.promptStore.findByTag(`date:${filter.date}`)
        .filter((doc: any) =>
          (doc.tags as string[]).includes(`plan:${this.projectName}`) &&
          (doc.tags as string[]).includes('type:prompt')
        );
    } else {
      // 全量查询
      docs = this.promptStore.findByTag(`plan:${this.projectName}`)
        .filter((doc: any) =>
          (doc.tags as string[]).includes('type:prompt')
        );
    }

    // 去重（保留最新）
    const latestMap = new Map<string, any>();
    for (const doc of docs) {
      latestMap.set(doc.id, doc);
    }

    let prompts = Array.from(latestMap.values())
      .map((doc: any) => this.docToPrompt(doc))
      .sort((a, b) => b.createdAt - a.createdAt);

    if (filter?.limit && filter.limit > 0) {
      prompts = prompts.slice(0, filter.limit);
    }

    return prompts;
  }

  /**
   * 将 DocumentStore 文档转为 Prompt 对象
   */
  private docToPrompt(doc: any): Prompt {
    const meta = doc.metadata || {};
    let data: any = {};
    try {
      data = JSON.parse(doc.content || '{}');
    } catch { /* ignore */ }

    // 从 tags 中提取自定义标签
    const customTags = ((doc.tags || []) as string[])
      .filter((t: string) => t.startsWith('custom:'))
      .map((t: string) => t.slice(7));

    return {
      id: doc.id,
      projectName: this.projectName,
      promptIndex: meta.promptIndex || 0,
      content: data.content || '',
      summary: data.summary || undefined,
      relatedTaskId: data.relatedTaskId || meta.relatedTaskId || undefined,
      tags: customTags.length > 0 ? customTags : (meta.tags || []),
      createdAt: meta.createdAt || doc.created_at || Date.now(),
    };
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
    this.promptStore.flush();
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
    const parentDoc = doc.metadata?.parentDoc || undefined;

    return {
      id: doc.id,
      projectName: this.projectName,
      section,
      title: doc.metadata?.title || '',
      content: doc.content,
      version: doc.metadata?.version || '1.0.0',
      subSection,
      relatedSections: doc.metadata?.relatedSections || [],
      relatedTaskIds: doc.metadata?.relatedTaskIds || [],
      moduleId,
      parentDoc,
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
    const order = data.order != null ? data.order : (doc.metadata?.order != null ? doc.metadata.order : undefined);

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
      order,
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
    const order = data.order != null ? data.order : (doc.metadata?.order != null ? doc.metadata.order : undefined);

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
      order,
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
  /**
   * 获取下一个主任务的 order 值（当前最大 order + 1）
   */
  private getNextMainTaskOrder(): number {
    const tasks = this.listMainTasks();
    let maxOrder = 0;
    for (const t of tasks) {
      if (typeof t.order === 'number' && t.order > maxOrder) {
        maxOrder = t.order;
      }
    }
    return maxOrder + 1;
  }

  /**
   * 获取下一个子任务的 order 值（当前父任务下最大 order + 1）
   */
  private getNextSubTaskOrder(parentTaskId: string): number {
    const tasks = this.listSubTasks(parentTaskId);
    let maxOrder = 0;
    for (const t of tasks) {
      if (typeof t.order === 'number' && t.order > maxOrder) {
        maxOrder = t.order;
      }
    }
    return maxOrder + 1;
  }

  /**
   * 按 order 字段排序（order 为空的排到最后，order 相同则按 createdAt 排）
   */
  private sortByOrder<T extends { order?: number; createdAt: number }>(items: T[]): T[] {
    return items.sort((a, b) => {
      const oa = a.order != null ? a.order : Number.MAX_SAFE_INTEGER;
      const ob = b.order != null ? b.order : Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return a.createdAt - b.createdAt;
    });
  }

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
        cwd: this.gitCwd,
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
        cwd: this.gitCwd,
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

  // ==========================================================================
  // Document Hierarchy (文档层级关系 — 基于 metadata 扫描)
  // ==========================================================================

  /**
   * 获取文档的直接子文档列表
   *
   * Document 引擎通过扫描所有文档的 parentDoc 属性实现。
   */
  getChildDocs(section: DevPlanSection, subSection?: string): DevPlanDoc[] {
    const parentKey = subSection ? `${section}|${subSection}` : section;
    return this.listSections().filter((doc) => doc.parentDoc === parentKey);
  }

  // ==========================================================================
  // Graph Export (不支持 — 返回 null)
  // ==========================================================================

  /**
   * EnhancedDocumentStore 不支持图谱导出，返回 null。
   * 如需图谱可视化，请使用 SocialGraphV2 引擎（DevPlanGraphStore）。
   */
  exportGraph(_options?: {
    includeDocuments?: boolean;
    includeModules?: boolean;
    includeNodeDegree?: boolean;
    enableBackendDegreeFallback?: boolean;
  }): DevPlanExportedGraph | null {
    return null;
  }
}
