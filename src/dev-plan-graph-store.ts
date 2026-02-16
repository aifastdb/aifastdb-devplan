/**
 * DevPlanGraphStore — 基于 SocialGraphV2 的开发计划存储实现
 *
 * 使用 aifastdb 的 SocialGraphV2（图结构存储）作为存储引擎。
 * 实现 IDevPlanStore 接口，是 DevPlan 系统的两个存储后端之一。
 *
 * 特性：
 * - 图结构存储，天然支持实体间关系
 * - exportGraph() 输出 vis-network 兼容的 { nodes, edges }，可在 aifastdb_admin 中可视化
 * - 原地更新（updateEntity），无需 delete+put 去重
 * - 分片并发存储，高性能
 *
 * 数据模型：
 * - Entity 类型: devplan-project, devplan-doc, devplan-main-task, devplan-sub-task, devplan-module
 * - Relation 类型: has_document, has_main_task, has_sub_task, module_has_task, module_has_doc
 */

import {
  SocialGraphV2,
  type Entity,
  type Relation,
  type VectorSearchConfig,
  type VectorSearchHit,
  VibeSynapse,
} from 'aifastdb';

import * as path from 'path';
import type { IDevPlanStore } from './dev-plan-interface';
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
  MainTaskProgress,
  ModuleInput,
  Module,
  ModuleDetail,
  ModuleStatus,
  TaskStatus,
  TaskPriority,
  SyncGitResult,
  RevertedTask,
  DevPlanGraphStoreConfig,
  DevPlanExportedGraph,
  DevPlanGraphNode,
  DevPlanGraphEdge,
  SearchMode,
  ScoredDevPlanDoc,
  RebuildIndexResult,
} from './types';

// ============================================================================
// Constants
// ============================================================================

/** Entity 类型常量 */
const ET = {
  PROJECT: 'devplan-project',
  DOC: 'devplan-doc',
  MAIN_TASK: 'devplan-main-task',
  SUB_TASK: 'devplan-sub-task',
  MODULE: 'devplan-module',
} as const;

/** Relation 类型常量 */
const RT = {
  HAS_DOCUMENT: 'has_document',
  HAS_MAIN_TASK: 'has_main_task',
  HAS_SUB_TASK: 'has_sub_task',
  MODULE_HAS_TASK: 'module_has_task',
  MODULE_HAS_DOC: 'module_has_doc',
  TASK_HAS_DOC: 'task_has_doc',
  DOC_HAS_CHILD: 'doc_has_child',
} as const;

// ============================================================================
// Helper
// ============================================================================

function sectionImportance(section: DevPlanSection): number {
  const m: Record<DevPlanSection, number> = {
    overview: 1.0, core_concepts: 0.95, api_design: 0.9,
    file_structure: 0.7, config: 0.7, examples: 0.6,
    technical_notes: 0.8, api_endpoints: 0.75, milestones: 0.85,
    changelog: 0.5, custom: 0.6,
  };
  return m[section] ?? 0.6;
}

/** 生成 section+subSection 的唯一 key */
function sectionKey(section: string, subSection?: string): string {
  return subSection ? `${section}|${subSection}` : section;
}

// ============================================================================
// DevPlanGraphStore Implementation
// ============================================================================

/**
 * 基于 SocialGraphV2 的开发计划存储
 *
 * 将 DevPlan 的实体（文档、任务、模块）映射为图节点（Entity），
 * 层级关系（项目→主任务→子任务、模块→任务）映射为图边（Relation）。
 */
export class DevPlanGraphStore implements IDevPlanStore {
  private graph: SocialGraphV2;
  private projectName: string;
  /** Git 操作的工作目录（多项目路由时指向项目根目录） */
  private gitCwd: string | undefined;
  /** 缓存的项目根实体 ID */
  private projectEntityId: string | null = null;
  /** VibeSynapse 实例（用于 Embedding 生成），仅启用语义搜索时可用 */
  private synapse: VibeSynapse | null = null;
  /** 语义搜索是否成功初始化 */
  private semanticSearchReady: boolean = false;

  constructor(projectName: string, config: DevPlanGraphStoreConfig) {
    this.projectName = projectName;
    this.gitCwd = config.gitCwd;

    // 构建 SocialGraphV2 配置
    const graphConfig: any = {
      path: config.graphPath,
      shardCount: config.shardCount || 4,
      walEnabled: true,
      mode: 'balanced',
      shardNames: ['entities', 'relations', 'index', 'meta'],
    };

    // 如果启用语义搜索，配置 SocialGraphV2 的向量搜索
    const dimension = config.embeddingDimension || 384;
    if (config.enableSemanticSearch) {
      graphConfig.vectorSearch = {
        dimension,
        m: 16,
        efConstruction: 200,
        efSearch: 50,
        maxElements: 100_000,
        shardCount: 1,
      } satisfies VectorSearchConfig;
    }

    this.graph = new SocialGraphV2(graphConfig);

    // 恢复 WAL 数据（包括向量 WAL）
    this.graph.recover();

    // 初始化 VibeSynapse（用于 Embedding 生成）
    if (config.enableSemanticSearch) {
      this.initSynapse(config.graphPath, dimension);
    }

    // 确保项目根实体存在
    this.ensureProjectEntity();
  }

  /**
   * 初始化 VibeSynapse Embedding 引擎
   *
   * 使用 Candle MiniLM (384维) 作为默认模型，支持零配置离线使用。
   * 初始化失败时降级为纯字面搜索（graceful degradation）。
   */
  private initSynapse(graphPath: string, dimension: number): void {
    try {
      const synapsePath = path.resolve(graphPath, '..', 'synapse-data');
      this.synapse = new VibeSynapse({
        storage: synapsePath,
        dimension,
        perception: {
          engineType: 'candle',
          modelId: 'sentence-transformers/all-MiniLM-L6-v2',
          autoDownload: true,
        },
      });

      // 验证 perception engine 是否真正可用
      if (!this.synapse.hasPerception) {
        console.warn(
          '[DevPlan] VibeSynapse created but perception engine not available. ' +
          'Candle MiniLM may not be installed. Falling back to literal search.'
        );
        this.synapse = null;
        this.semanticSearchReady = false;
        return;
      }

      // 测试 embed 是否可用（dry run）
      try {
        this.synapse.embed('test');
        this.semanticSearchReady = true;
        console.error('[DevPlan] Semantic search initialized (Candle MiniLM)');
      } catch {
        console.warn('[DevPlan] VibeSynapse embed() dry-run failed. Falling back to literal search.');
        this.synapse = null;
        this.semanticSearchReady = false;
      }
    } catch (e) {
      console.warn(
        `[DevPlan] Failed to initialize VibeSynapse for semantic search: ${
          e instanceof Error ? e.message : String(e)
        }. Falling back to literal search.`
      );
      this.synapse = null;
      this.semanticSearchReady = false;
    }
  }

  // ==========================================================================
  // Project Entity
  // ==========================================================================

  private ensureProjectEntity(): void {
    const existing = this.findProjectEntity();
    if (existing) {
      this.projectEntityId = existing.id;
    } else {
      const entity = this.graph.addEntity(this.projectName, ET.PROJECT, {
        projectName: this.projectName,
        createdAt: Date.now(),
      });
      this.projectEntityId = entity.id;
      this.graph.flush();
    }
  }

  private findProjectEntity(): Entity | null {
    const entities = this.graph.listEntitiesByType(ET.PROJECT);
    return entities.find(
      (e) => (e.properties as any)?.projectName === this.projectName
    ) || null;
  }

  private getProjectId(): string {
    if (!this.projectEntityId) {
      this.ensureProjectEntity();
    }
    return this.projectEntityId!;
  }

  // ==========================================================================
  // Generic Entity Helpers
  // ==========================================================================

  /** 按 entityType 列出所有实体并按属性过滤 */
  private findEntitiesByType(entityType: string): Entity[] {
    return this.graph.listEntitiesByType(entityType).filter(
      (e) => (e.properties as any)?.projectName === this.projectName
    );
  }

  /** 按属性在指定类型中查找唯一实体 */
  private findEntityByProp(entityType: string, key: string, value: string): Entity | null {
    const entities = this.findEntitiesByType(entityType);
    return entities.find((e) => (e.properties as any)?.[key] === value) || null;
  }

  /** 获取实体的出向关系 */
  private getOutRelations(entityId: string, relationType?: string): Relation[] {
    const filter: any = { sourceId: entityId };
    if (relationType) filter.relationType = relationType;
    return this.graph.listRelations(filter);
  }

  /** 获取实体的入向关系 */
  private getInRelations(entityId: string, relationType?: string): Relation[] {
    const filter: any = { targetId: entityId };
    if (relationType) filter.relationType = relationType;
    return this.graph.listRelations(filter);
  }

  /** 按 section + subSection 查找文档实体（返回原始 Entity） */
  private findDocEntityBySection(section: string, subSection?: string): Entity | null {
    const key = sectionKey(section, subSection);
    const docs = this.findEntitiesByType(ET.DOC);
    return docs.find((e) => {
      const p = e.properties as any;
      return sectionKey(p.section, p.subSection || undefined) === key;
    }) || null;
  }

  // ==========================================================================
  // Entity <-> DevPlan Type Conversion
  // ==========================================================================

  private entityToDevPlanDoc(e: Entity): DevPlanDoc {
    const p = e.properties as any;

    // 获取 parentDoc：从属性读取
    const parentDoc = p.parentDoc || undefined;

    // 获取 childDocs：通过 DOC_HAS_CHILD 出向关系查询
    const childDocRels = this.getOutRelations(e.id, RT.DOC_HAS_CHILD);
    const childDocs = childDocRels.length > 0
      ? childDocRels.map((rel) => {
          const childEntity = this.graph.getEntity(rel.target);
          if (!childEntity) return undefined;
          const cp = childEntity.properties as any;
          return sectionKey(cp.section, cp.subSection || undefined);
        }).filter((k): k is string => k !== undefined)
      : undefined;

    return {
      id: e.id,
      projectName: this.projectName,
      section: p.section || 'custom',
      title: p.title || e.name,
      content: p.content || '',
      version: p.version || '1.0.0',
      subSection: p.subSection || undefined,
      relatedSections: p.relatedSections || [],
      moduleId: p.moduleId || undefined,
      relatedTaskIds: p.relatedTaskIds || [],
      parentDoc,
      childDocs,
      createdAt: p.createdAt || e.created_at,
      updatedAt: p.updatedAt || e.updated_at,
    };
  }

  private entityToMainTask(e: Entity): MainTask {
    const p = e.properties as any;
    return {
      id: e.id,
      projectName: this.projectName,
      taskId: p.taskId || '',
      title: p.title || e.name,
      priority: p.priority || 'P2',
      description: p.description || undefined,
      estimatedHours: p.estimatedHours || undefined,
      relatedSections: p.relatedSections || [],
      moduleId: p.moduleId || undefined,
      totalSubtasks: p.totalSubtasks || 0,
      completedSubtasks: p.completedSubtasks || 0,
      status: p.status || 'pending',
      order: p.order != null ? p.order : undefined,
      createdAt: p.createdAt || e.created_at,
      updatedAt: p.updatedAt || e.updated_at,
      completedAt: p.completedAt || null,
    };
  }

  private entityToSubTask(e: Entity): SubTask {
    const p = e.properties as any;
    return {
      id: e.id,
      projectName: this.projectName,
      taskId: p.taskId || '',
      parentTaskId: p.parentTaskId || '',
      title: p.title || e.name,
      estimatedHours: p.estimatedHours || undefined,
      relatedFiles: p.relatedFiles || [],
      description: p.description || undefined,
      status: p.status || 'pending',
      order: p.order != null ? p.order : undefined,
      createdAt: p.createdAt || e.created_at,
      updatedAt: p.updatedAt || e.updated_at,
      completedAt: p.completedAt || null,
      completedAtCommit: p.completedAtCommit || undefined,
      revertReason: p.revertReason || undefined,
    };
  }

  private entityToModule(e: Entity): Module {
    const p = e.properties as any;
    const moduleId = p.moduleId || '';

    // 计算关联计数
    const mainTasks = this.listMainTasks({ moduleId });
    let subTaskCount = 0;
    let completedSubTaskCount = 0;
    for (const mt of mainTasks) {
      const subs = this.listSubTasks(mt.taskId);
      subTaskCount += subs.length;
      completedSubTaskCount += subs.filter((s) => s.status === 'completed').length;
    }

    const docRelations = this.getOutRelations(e.id, RT.MODULE_HAS_DOC);
    const docCount = docRelations.length;

    return {
      id: e.id,
      projectName: this.projectName,
      moduleId,
      name: p.name || e.name,
      description: p.description || undefined,
      status: p.status || 'active',
      mainTaskCount: mainTasks.length,
      subTaskCount,
      completedSubTaskCount,
      docCount,
      createdAt: p.createdAt || e.created_at,
      updatedAt: p.updatedAt || e.updated_at,
    };
  }

  // ==========================================================================
  // Document Section Operations
  // ==========================================================================

  saveSection(input: DevPlanDocInput): string {
    const existing = this.getSection(input.section, input.subSection);
    const now = Date.now();
    const version = input.version || '1.0.0';
    const finalModuleId = input.moduleId || existing?.moduleId;

    // 确定最终的 parentDoc 值（显式传入 > 已有值）
    const finalParentDoc = input.parentDoc !== undefined ? input.parentDoc : existing?.parentDoc;

    if (existing) {
      // 更新已有文档
      const finalRelatedTaskIds = input.relatedTaskIds || existing.relatedTaskIds || [];
      this.graph.updateEntity(existing.id, {
        properties: {
          title: input.title,
          content: input.content,
          version,
          subSection: input.subSection || null,
          relatedSections: input.relatedSections || [],
          relatedTaskIds: finalRelatedTaskIds,
          moduleId: finalModuleId || null,
          parentDoc: finalParentDoc || null,
          updatedAt: now,
        },
      });

      // 如果模块关联变化，更新关系
      if (finalModuleId && finalModuleId !== existing.moduleId) {
        this.updateModuleDocRelation(existing.id, existing.moduleId, finalModuleId);
      }

      // 更新 parentDoc 关系（DOC_HAS_CHILD）
      this.updateParentDocRelation(existing.id, existing.parentDoc, finalParentDoc);

      // 更新 task -> doc 关系
      if (finalRelatedTaskIds.length) {
        // 删除旧的 TASK_HAS_DOC 入向关系（指向本文档的）
        const oldTaskRels = this.getInRelations(existing.id, RT.TASK_HAS_DOC);
        for (const rel of oldTaskRels) {
          this.graph.deleteRelation(rel.id);
        }
        // 建立新的 TASK_HAS_DOC 关系
        for (const taskId of finalRelatedTaskIds) {
          const taskEntity = this.findEntityByProp(ET.MAIN_TASK, 'taskId', taskId);
          if (taskEntity) {
            this.graph.putRelation(taskEntity.id, existing.id, RT.TASK_HAS_DOC);
          }
        }
      }

      // 语义搜索：自动为更新的文档生成 Embedding 并索引
      this.autoIndexDocument(existing.id, input.title, input.content);

      this.graph.flush();
      return existing.id;
    }

    // 新建文档
    const entity = this.graph.addEntity(input.title, ET.DOC, {
      projectName: this.projectName,
      section: input.section,
      title: input.title,
      content: input.content,
      version,
      subSection: input.subSection || null,
      relatedSections: input.relatedSections || [],
      relatedTaskIds: input.relatedTaskIds || [],
      moduleId: finalModuleId || null,
      parentDoc: finalParentDoc || null,
      createdAt: now,
      updatedAt: now,
    });

    // 子文档不直接连接项目节点，仅通过 doc_has_child 连接父文档
    if (finalParentDoc) {
      // 有 parentDoc → 创建 DOC_HAS_CHILD 关系（parent -> child），不创建 project -> doc
      const [parentSection, parentSubSection] = finalParentDoc.split('|');
      const parentEntity = this.findDocEntityBySection(parentSection, parentSubSection || undefined);
      if (parentEntity) {
        this.graph.putRelation(parentEntity.id, entity.id, RT.DOC_HAS_CHILD);
      }
    } else {
      // 无 parentDoc → 创建 project -> doc 关系（顶级文档）
      this.graph.putRelation(this.getProjectId(), entity.id, RT.HAS_DOCUMENT);
    }

    // 如果有模块关联，创建 module -> doc 关系
    if (finalModuleId) {
      const modEntity = this.findEntityByProp(ET.MODULE, 'moduleId', finalModuleId);
      if (modEntity) {
        this.graph.putRelation(modEntity.id, entity.id, RT.MODULE_HAS_DOC);
      }
    }

    // task -> doc 关系（从文档侧建立）
    if (input.relatedTaskIds?.length) {
      for (const taskId of input.relatedTaskIds) {
        const taskEntity = this.findEntityByProp(ET.MAIN_TASK, 'taskId', taskId);
        if (taskEntity) {
          this.graph.putRelation(taskEntity.id, entity.id, RT.TASK_HAS_DOC);
        }
      }
    }

    // 语义搜索：自动为新文档生成 Embedding 并索引
    this.autoIndexDocument(entity.id, input.title, input.content);

    this.graph.flush();
    return entity.id;
  }

  getSection(section: DevPlanSection, subSection?: string): DevPlanDoc | null {
    const docs = this.findEntitiesByType(ET.DOC);
    const key = sectionKey(section, subSection);

    for (const doc of docs) {
      const p = doc.properties as any;
      const docKey = sectionKey(p.section, p.subSection || undefined);
      if (docKey === key) {
        return this.entityToDevPlanDoc(doc);
      }
    }
    return null;
  }

  listSections(): DevPlanDoc[] {
    return this.findEntitiesByType(ET.DOC).map((e) => this.entityToDevPlanDoc(e));
  }

  updateSection(section: DevPlanSection, content: string, subSection?: string): string {
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

  searchSections(query: string, limit: number = 10): DevPlanDoc[] {
    // 默认使用 hybrid 模式（语义+字面），无语义搜索时回退字面
    const mode: SearchMode = this.semanticSearchReady ? 'hybrid' : 'literal';
    return this.searchSectionsAdvanced(query, { mode, limit }).map(({ score, ...doc }) => doc);
  }

  /**
   * 高级搜索：支持 literal / semantic / hybrid 三种模式
   *
   * - literal: 纯字面匹配（标题+内容包含查询词）
   * - semantic: 纯语义搜索（embed(query) → searchEntitiesByVector）
   * - hybrid: 字面+语义 RRF 融合排序
   *
   * 当 VibeSynapse 不可用时，semantic/hybrid 模式自动降级为 literal。
   */
  searchSectionsAdvanced(query: string, options?: {
    mode?: SearchMode;
    limit?: number;
    minScore?: number;
  }): ScoredDevPlanDoc[] {
    const mode = options?.mode || 'hybrid';
    const limit = options?.limit || 10;
    const minScore = options?.minScore || 0;

    // ---- Literal Search ----
    const literalResults = this.literalSearch(query);

    // ---- If no semantic search or literal-only mode ----
    if (mode === 'literal' || !this.semanticSearchReady || !this.synapse) {
      return literalResults.slice(0, limit).map((doc) => ({ ...doc, score: undefined }));
    }

    // ---- Semantic Search ----
    let semanticHits: VectorSearchHit[] = [];
    try {
      const embedding = this.synapse.embed(query);
      semanticHits = this.graph.searchEntitiesByVector(embedding, limit * 2, ET.DOC);
    } catch (e) {
      console.warn(`[DevPlan] Semantic search failed: ${e instanceof Error ? e.message : String(e)}`);
      // 降级为字面搜索
      return literalResults.slice(0, limit).map((doc) => ({ ...doc, score: undefined }));
    }

    if (mode === 'semantic') {
      // 纯语义模式：直接返回语义搜索结果
      const docs: ScoredDevPlanDoc[] = [];
      for (const hit of semanticHits) {
        if (minScore > 0 && hit.score < minScore) continue;
        const entity = this.graph.getEntity(hit.entityId);
        if (entity && (entity.properties as any)?.projectName === this.projectName) {
          docs.push({ ...this.entityToDevPlanDoc(entity), score: hit.score });
        }
        if (docs.length >= limit) break;
      }
      return docs;
    }

    // ---- Hybrid Mode: RRF Fusion ----
    return this.rrfFusion(semanticHits, literalResults, limit, minScore);
  }

  /**
   * 重建所有文档的向量索引
   *
   * 适用于：首次启用语义搜索、模型切换、索引损坏修复。
   */
  rebuildIndex(): RebuildIndexResult {
    const startTime = Date.now();
    const docs = this.listSections();
    let indexed = 0;
    let failed = 0;
    const failedDocIds: string[] = [];

    if (!this.semanticSearchReady || !this.synapse) {
      return {
        total: docs.length,
        indexed: 0,
        failed: docs.length,
        durationMs: Date.now() - startTime,
        failedDocIds: docs.map((d) => d.id),
      };
    }

    for (const doc of docs) {
      try {
        const text = `${doc.title}\n${doc.content}`;
        const embedding = this.synapse.embed(text);
        this.graph.indexEntity(doc.id, embedding);
        indexed++;
      } catch (e) {
        failed++;
        failedDocIds.push(doc.id);
      }
    }

    this.graph.flush();

    return {
      total: docs.length,
      indexed,
      failed,
      durationMs: Date.now() - startTime,
      failedDocIds: failedDocIds.length > 0 ? failedDocIds : undefined,
    };
  }

  /**
   * 检查语义搜索是否可用
   */
  isSemanticSearchEnabled(): boolean {
    return this.semanticSearchReady;
  }

  deleteSection(section: DevPlanSection, subSection?: string): boolean {
    const existing = this.getSection(section, subSection);
    if (!existing) return false;

    // 断开 DOC_HAS_CHILD 入向关系（从父文档指向本文档的）
    const parentRels = this.getInRelations(existing.id, RT.DOC_HAS_CHILD);
    for (const rel of parentRels) {
      this.graph.deleteRelation(rel.id);
    }

    // 断开 DOC_HAS_CHILD 出向关系（本文档指向子文档的），子文档的 parentDoc 属性清空
    const childRels = this.getOutRelations(existing.id, RT.DOC_HAS_CHILD);
    for (const rel of childRels) {
      this.graph.deleteRelation(rel.id);
      // 清除子文档的 parentDoc 属性
      const childEntity = this.graph.getEntity(rel.target);
      if (childEntity) {
        this.graph.updateEntity(childEntity.id, {
          properties: { parentDoc: null },
        });
      }
    }

    // 语义搜索：删除文档对应的向量索引
    if (this.semanticSearchReady) {
      try {
        this.graph.removeEntityVector(existing.id);
      } catch {
        // 向量可能不存在，忽略错误
      }
    }

    this.graph.deleteEntity(existing.id);
    this.graph.flush();
    return true;
  }

  // ==========================================================================
  // Main Task Operations
  // ==========================================================================

  createMainTask(input: MainTaskInput): MainTask {
    const existing = this.getMainTask(input.taskId);
    if (existing) {
      throw new Error(`Main task "${input.taskId}" already exists for project "${this.projectName}"`);
    }

    const now = Date.now();
    // 如果未指定 order，自动分配为当前最大 order + 1
    const order = input.order != null ? input.order : this.getNextMainTaskOrder();
    const entity = this.graph.addEntity(input.title, ET.MAIN_TASK, {
      projectName: this.projectName,
      taskId: input.taskId,
      title: input.title,
      priority: input.priority,
      description: input.description || '',
      estimatedHours: input.estimatedHours || 0,
      relatedSections: input.relatedSections || [],
      moduleId: input.moduleId || null,
      totalSubtasks: 0,
      completedSubtasks: 0,
      status: 'pending',
      order,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });

    // project -> main task 关系
    this.graph.putRelation(this.getProjectId(), entity.id, RT.HAS_MAIN_TASK);

    // module -> main task 关系
    if (input.moduleId) {
      const modEntity = this.findEntityByProp(ET.MODULE, 'moduleId', input.moduleId);
      if (modEntity) {
        this.graph.putRelation(modEntity.id, entity.id, RT.MODULE_HAS_TASK);
      }
    }

    // task -> doc 关系（通过 relatedSections 建立）
    if (input.relatedSections?.length) {
      for (const sk of input.relatedSections) {
        const [sec, sub] = sk.split('|');
        const docEntity = this.findDocEntityBySection(sec, sub);
        if (docEntity) {
          this.graph.putRelation(entity.id, docEntity.id, RT.TASK_HAS_DOC);
        }
      }
    }

    this.graph.flush();
    return this.entityToMainTask(entity);
  }

  upsertMainTask(input: MainTaskInput, options?: {
    preserveStatus?: boolean;
    status?: TaskStatus;
  }): MainTask {
    const preserveStatus = options?.preserveStatus !== false;
    const targetStatus = options?.status || 'pending';
    const existing = this.getMainTask(input.taskId);

    if (!existing) {
      const task = this.createMainTask(input);
      if (targetStatus !== 'pending') {
        return this.updateMainTaskStatus(task.taskId, targetStatus) || task;
      }
      return task;
    }

    // 决定最终状态
    let finalStatus = targetStatus;
    if (preserveStatus) {
      const statusPriority: Record<TaskStatus, number> = {
        cancelled: 0, pending: 1, in_progress: 2, completed: 3,
      };
      if (statusPriority[existing.status] >= statusPriority[targetStatus]) {
        finalStatus = existing.status;
      }
    }

    const now = Date.now();
    const completedAt = finalStatus === 'completed' ? (existing.completedAt || now) : null;
    const finalModuleId = input.moduleId || existing.moduleId;
    const finalOrder = input.order != null ? input.order : existing.order;

    this.graph.updateEntity(existing.id, {
      name: input.title,
      properties: {
        title: input.title,
        priority: input.priority,
        description: input.description || existing.description || '',
        estimatedHours: input.estimatedHours || existing.estimatedHours || 0,
        relatedSections: input.relatedSections || existing.relatedSections || [],
        moduleId: finalModuleId || null,
        status: finalStatus,
        order: finalOrder,
        updatedAt: now,
        completedAt,
      },
    });

    // 更新模块关系
    if (finalModuleId && finalModuleId !== existing.moduleId) {
      this.updateModuleTaskRelation(existing.id, existing.moduleId, finalModuleId);
    }

    // 更新 task -> doc 关系
    const newRelatedSections = input.relatedSections || existing.relatedSections || [];
    if (newRelatedSections.length) {
      // 删除旧的 TASK_HAS_DOC 关系
      const oldDocRels = this.getOutRelations(existing.id, RT.TASK_HAS_DOC);
      for (const rel of oldDocRels) {
        this.graph.deleteRelation(rel.id);
      }
      // 建立新的 TASK_HAS_DOC 关系
      for (const sk of newRelatedSections) {
        const [sec, sub] = sk.split('|');
        const docEntity = this.findDocEntityBySection(sec, sub);
        if (docEntity) {
          this.graph.putRelation(existing.id, docEntity.id, RT.TASK_HAS_DOC);
        }
      }
    }

    this.graph.flush();

    const updated = this.graph.getEntity(existing.id);
    return updated ? this.entityToMainTask(updated) : existing;
  }

  getMainTask(taskId: string): MainTask | null {
    const entity = this.findEntityByProp(ET.MAIN_TASK, 'taskId', taskId);
    return entity ? this.entityToMainTask(entity) : null;
  }

  listMainTasks(filter?: {
    status?: TaskStatus;
    priority?: TaskPriority;
    moduleId?: string;
  }): MainTask[] {
    let entities = this.findEntitiesByType(ET.MAIN_TASK);

    if (filter?.status) {
      entities = entities.filter((e) => (e.properties as any).status === filter.status);
    }
    if (filter?.priority) {
      entities = entities.filter((e) => (e.properties as any).priority === filter.priority);
    }
    if (filter?.moduleId) {
      entities = entities.filter((e) => (e.properties as any).moduleId === filter.moduleId);
    }

    const tasks = entities.map((e) => this.entityToMainTask(e));
    return this.sortByOrder(tasks);
  }

  updateMainTaskStatus(taskId: string, status: TaskStatus): MainTask | null {
    const mainTask = this.getMainTask(taskId);
    if (!mainTask) return null;

    const now = Date.now();
    const completedAt = status === 'completed' ? now : mainTask.completedAt;

    this.graph.updateEntity(mainTask.id, {
      properties: {
        status,
        updatedAt: now,
        completedAt,
      },
    });

    this.graph.flush();
    const updated = this.graph.getEntity(mainTask.id);
    return updated ? this.entityToMainTask(updated) : null;
  }

  // ==========================================================================
  // Sub Task Operations
  // ==========================================================================

  addSubTask(input: SubTaskInput): SubTask {
    const existing = this.getSubTask(input.taskId);
    if (existing) {
      throw new Error(`Sub task "${input.taskId}" already exists for project "${this.projectName}"`);
    }

    const mainTask = this.getMainTask(input.parentTaskId);
    if (!mainTask) {
      throw new Error(`Parent main task "${input.parentTaskId}" not found for project "${this.projectName}"`);
    }

    const now = Date.now();
    // 如果未指定 order，自动分配为当前父任务下最大 order + 1
    const order = input.order != null ? input.order : this.getNextSubTaskOrder(input.parentTaskId);
    const entity = this.graph.addEntity(input.title, ET.SUB_TASK, {
      projectName: this.projectName,
      taskId: input.taskId,
      parentTaskId: input.parentTaskId,
      title: input.title,
      estimatedHours: input.estimatedHours || 0,
      relatedFiles: input.relatedFiles || [],
      description: input.description || '',
      status: 'pending',
      order,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });

    // main task -> sub task 关系
    this.graph.putRelation(mainTask.id, entity.id, RT.HAS_SUB_TASK);

    // 更新主任务计数
    this.refreshMainTaskCounts(input.parentTaskId);
    this.graph.flush();

    return this.entityToSubTask(entity);
  }

  upsertSubTask(input: SubTaskInput, options?: {
    preserveStatus?: boolean;
    status?: TaskStatus;
  }): SubTask {
    const preserveStatus = options?.preserveStatus !== false;
    const targetStatus = options?.status || 'pending';
    const existing = this.getSubTask(input.taskId);

    if (!existing) {
      const mainTask = this.getMainTask(input.parentTaskId);
      if (!mainTask) {
        throw new Error(`Parent main task "${input.parentTaskId}" not found for project "${this.projectName}"`);
      }

      const now = Date.now();
      const order = input.order != null ? input.order : this.getNextSubTaskOrder(input.parentTaskId);
      const entity = this.graph.addEntity(input.title, ET.SUB_TASK, {
        projectName: this.projectName,
        taskId: input.taskId,
        parentTaskId: input.parentTaskId,
        title: input.title,
        estimatedHours: input.estimatedHours || 0,
        relatedFiles: input.relatedFiles || [],
        description: input.description || '',
        status: targetStatus,
        order,
        createdAt: now,
        updatedAt: now,
        completedAt: targetStatus === 'completed' ? now : null,
      });

      this.graph.putRelation(mainTask.id, entity.id, RT.HAS_SUB_TASK);
      this.refreshMainTaskCounts(input.parentTaskId);
      this.graph.flush();

      return this.entityToSubTask(entity);
    }

    // 决定最终状态
    let finalStatus = targetStatus;
    if (preserveStatus) {
      const statusPriority: Record<TaskStatus, number> = {
        cancelled: 0, pending: 1, in_progress: 2, completed: 3,
      };
      if (statusPriority[existing.status] >= statusPriority[targetStatus]) {
        finalStatus = existing.status;
      }
    }

    // 检查是否有实质变化
    const newOrder = input.order != null ? input.order : existing.order;
    if (
      existing.title === input.title &&
      existing.description === (input.description || '') &&
      existing.status === finalStatus &&
      existing.estimatedHours === (input.estimatedHours || 0) &&
      existing.order === newOrder
    ) {
      return existing;
    }

    const now = Date.now();
    const completedAt = finalStatus === 'completed' ? (existing.completedAt || now) : null;

    this.graph.updateEntity(existing.id, {
      name: input.title,
      properties: {
        title: input.title,
        estimatedHours: input.estimatedHours || existing.estimatedHours || 0,
        relatedFiles: input.relatedFiles || existing.relatedFiles || [],
        description: input.description || existing.description || '',
        status: finalStatus,
        order: newOrder,
        updatedAt: now,
        completedAt,
      },
    });

    this.refreshMainTaskCounts(input.parentTaskId);
    this.graph.flush();

    const updated = this.graph.getEntity(existing.id);
    return updated ? this.entityToSubTask(updated) : existing;
  }

  getSubTask(taskId: string): SubTask | null {
    const entity = this.findEntityByProp(ET.SUB_TASK, 'taskId', taskId);
    return entity ? this.entityToSubTask(entity) : null;
  }

  listSubTasks(parentTaskId: string, filter?: {
    status?: TaskStatus;
  }): SubTask[] {
    let entities = this.findEntitiesByType(ET.SUB_TASK).filter(
      (e) => (e.properties as any).parentTaskId === parentTaskId
    );

    if (filter?.status) {
      entities = entities.filter((e) => (e.properties as any).status === filter.status);
    }

    const tasks = entities.map((e) => this.entityToSubTask(e));
    return this.sortByOrder(tasks);
  }

  updateSubTaskStatus(taskId: string, status: TaskStatus, options?: {
    completedAtCommit?: string;
    revertReason?: string;
  }): SubTask | null {
    const subTask = this.getSubTask(taskId);
    if (!subTask) return null;

    const now = Date.now();
    const completedAt = status === 'completed' ? now : (status === 'pending' ? null : subTask.completedAt);
    const completedAtCommit = status === 'completed'
      ? (options?.completedAtCommit || subTask.completedAtCommit)
      : (status === 'pending' ? null : subTask.completedAtCommit);
    const revertReason = options?.revertReason || (status === 'pending' ? null : subTask.revertReason);

    this.graph.updateEntity(subTask.id, {
      properties: {
        status,
        updatedAt: now,
        completedAt,
        completedAtCommit: completedAtCommit || null,
        revertReason: revertReason || null,
      },
    });

    this.graph.flush();
    const updated = this.graph.getEntity(subTask.id);
    return updated ? this.entityToSubTask(updated) : null;
  }

  // ==========================================================================
  // Completion Workflow
  // ==========================================================================

  completeSubTask(taskId: string): CompleteSubTaskResult {
    const commitHash = this.getCurrentGitCommit();

    const updatedSubTask = this.updateSubTaskStatus(taskId, 'completed', {
      completedAtCommit: commitHash,
    });
    if (!updatedSubTask) {
      throw new Error(`Sub task "${taskId}" not found for project "${this.projectName}"`);
    }

    const updatedMainTask = this.refreshMainTaskCounts(updatedSubTask.parentTaskId);
    if (!updatedMainTask) {
      throw new Error(`Parent main task "${updatedSubTask.parentTaskId}" not found`);
    }

    const mainTaskCompleted =
      updatedMainTask.totalSubtasks > 0 &&
      updatedMainTask.completedSubtasks >= updatedMainTask.totalSubtasks;

    if (mainTaskCompleted && updatedMainTask.status !== 'completed') {
      const completedMain = this.updateMainTaskStatus(updatedSubTask.parentTaskId, 'completed');
      if (completedMain) {
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

  completeMainTask(taskId: string): MainTask {
    const result = this.updateMainTaskStatus(taskId, 'completed');
    if (!result) {
      throw new Error(`Main task "${taskId}" not found for project "${this.projectName}"`);
    }
    this.autoUpdateMilestones(result);
    return result;
  }

  // ==========================================================================
  // Progress & Export
  // ==========================================================================

  getProgress(): ProjectProgress {
    const sections = this.listSections();
    const mainTasks = this.listMainTasks();

    let totalSub = 0;
    let completedSub = 0;
    const taskProgressList: MainTaskProgress[] = [];

    for (const mt of mainTasks) {
      const subs = this.listSubTasks(mt.taskId);
      const subCompleted = subs.filter((s) => s.status === 'completed').length;

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

    return {
      projectName: this.projectName,
      sectionCount: sections.length,
      mainTaskCount: mainTasks.length,
      completedMainTasks: mainTasks.filter((mt) => mt.status === 'completed').length,
      subTaskCount: totalSub,
      completedSubTasks: completedSub,
      overallPercent: totalSub > 0 ? Math.round((completedSub / totalSub) * 100) : 0,
      tasks: taskProgressList,
    };
  }

  exportToMarkdown(): string {
    const sections = this.listSections();
    const progress = this.getProgress();

    let md = `# ${this.projectName} - 开发计划\n\n`;
    md += `> 生成时间: ${new Date().toISOString()}\n`;
    md += `> 总体进度: ${progress.overallPercent}% (${progress.completedSubTasks}/${progress.subTaskCount})\n`;
    md += `> 存储引擎: SocialGraphV2\n\n`;

    const sectionOrder: DevPlanSection[] = [
      'overview', 'core_concepts', 'api_design', 'file_structure',
      'config', 'examples', 'technical_notes', 'api_endpoints',
      'milestones', 'changelog', 'custom',
    ];

    for (const sectionType of sectionOrder) {
      const sectionDocs = sections.filter((s) => s.section === sectionType);
      for (const doc of sectionDocs) {
        md += doc.content + '\n\n---\n\n';
      }
    }

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

  exportTaskSummary(): string {
    const progress = this.getProgress();

    let md = `# ${this.projectName} - 任务进度总览\n\n`;
    md += `> 更新时间: ${new Date().toISOString()}\n`;
    md += `> 总体进度: **${progress.overallPercent}%** (${progress.completedSubTasks}/${progress.subTaskCount} 子任务完成)\n`;
    md += `> 主任务完成: ${progress.completedMainTasks}/${progress.mainTaskCount}\n`;
    md += `> 存储引擎: SocialGraphV2\n\n`;

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

  createModule(input: ModuleInput): Module {
    const existing = this.getModule(input.moduleId);
    if (existing) {
      throw new Error(`Module "${input.moduleId}" already exists for project "${this.projectName}"`);
    }

    const now = Date.now();
    const status = input.status || 'active';

    const entity = this.graph.addEntity(input.name, ET.MODULE, {
      projectName: this.projectName,
      moduleId: input.moduleId,
      name: input.name,
      description: input.description || '',
      status,
      createdAt: now,
      updatedAt: now,
    });

    // project -> module (通过类型区分即可，不需要额外关系)
    this.graph.flush();

    return {
      id: entity.id,
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

  getModule(moduleId: string): Module | null {
    const entity = this.findEntityByProp(ET.MODULE, 'moduleId', moduleId);
    return entity ? this.entityToModule(entity) : null;
  }

  listModules(filter?: { status?: ModuleStatus }): Module[] {
    let entities = this.findEntitiesByType(ET.MODULE);
    if (filter?.status) {
      entities = entities.filter((e) => (e.properties as any).status === filter.status);
    }
    return entities.map((e) => this.entityToModule(e));
  }

  updateModule(moduleId: string, updates: {
    name?: string;
    description?: string;
    status?: ModuleStatus;
  }): Module | null {
    const existing = this.getModule(moduleId);
    if (!existing) return null;

    const now = Date.now();
    this.graph.updateEntity(existing.id, {
      name: updates.name || existing.name,
      properties: {
        name: updates.name || existing.name,
        description: updates.description !== undefined ? updates.description : existing.description,
        status: updates.status || existing.status,
        updatedAt: now,
      },
    });

    this.graph.flush();
    return this.getModule(moduleId);
  }

  deleteModule(moduleId: string): boolean {
    const existing = this.getModule(moduleId);
    if (!existing) return false;
    this.graph.deleteEntity(existing.id);
    this.graph.flush();
    return true;
  }

  getModuleDetail(moduleId: string): ModuleDetail | null {
    const mod = this.getModule(moduleId);
    if (!mod) return null;

    const mainTasks = this.listMainTasks({ moduleId });
    const subTasks: SubTask[] = [];
    for (const mt of mainTasks) {
      subTasks.push(...this.listSubTasks(mt.taskId));
    }

    // 获取关联文档
    const modEntity = this.findEntityByProp(ET.MODULE, 'moduleId', moduleId);
    let documents: DevPlanDoc[] = [];
    if (modEntity) {
      const docRelations = this.getOutRelations(modEntity.id, RT.MODULE_HAS_DOC);
      for (const rel of docRelations) {
        const docEntity = this.graph.getEntity(rel.target);
        if (docEntity) {
          documents.push(this.entityToDevPlanDoc(docEntity));
        }
      }
    }

    // 同时包含按 moduleId 属性关联的文档
    const allDocs = this.listSections().filter((d) => d.moduleId === moduleId);
    const docIds = new Set(documents.map((d) => d.id));
    for (const d of allDocs) {
      if (!docIds.has(d.id)) {
        documents.push(d);
      }
    }

    return { module: mod, mainTasks, subTasks, documents };
  }

  // ==========================================================================
  // Document-Task Relationship Queries
  // ==========================================================================

  /**
   * 获取主任务关联的文档列表（通过 TASK_HAS_DOC 出向关系）
   */
  getTaskRelatedDocs(taskId: string): DevPlanDoc[] {
    const taskEntity = this.findEntityByProp(ET.MAIN_TASK, 'taskId', taskId);
    if (!taskEntity) return [];

    const rels = this.getOutRelations(taskEntity.id, RT.TASK_HAS_DOC);
    const docs: DevPlanDoc[] = [];
    for (const rel of rels) {
      const docEntity = this.graph.getEntity(rel.target);
      if (docEntity) {
        docs.push(this.entityToDevPlanDoc(docEntity));
      }
    }
    return docs;
  }

  /**
   * 获取文档关联的主任务列表（通过 TASK_HAS_DOC 入向关系）
   */
  getDocRelatedTasks(section: DevPlanSection, subSection?: string): MainTask[] {
    const doc = this.getSection(section, subSection);
    if (!doc) return [];

    const rels = this.getInRelations(doc.id, RT.TASK_HAS_DOC);
    const tasks: MainTask[] = [];
    for (const rel of rels) {
      const taskEntity = this.graph.getEntity(rel.source);
      if (taskEntity) {
        tasks.push(this.entityToMainTask(taskEntity));
      }
    }
    return tasks;
  }

  // ==========================================================================
  // Document Hierarchy (文档层级关系)
  // ==========================================================================

  /**
   * 获取文档的直接子文档列表（通过 DOC_HAS_CHILD 出向关系）
   */
  getChildDocs(section: DevPlanSection, subSection?: string): DevPlanDoc[] {
    const docEntity = this.findDocEntityBySection(section, subSection);
    if (!docEntity) return [];

    const rels = this.getOutRelations(docEntity.id, RT.DOC_HAS_CHILD);
    const children: DevPlanDoc[] = [];
    for (const rel of rels) {
      const childEntity = this.graph.getEntity(rel.target);
      if (childEntity) {
        children.push(this.entityToDevPlanDoc(childEntity));
      }
    }
    return children;
  }

  /**
   * 获取文档树（递归，含所有后代文档）
   */
  getDocTree(section: DevPlanSection, subSection?: string): DevPlanDocTree | null {
    const doc = this.getSection(section, subSection);
    if (!doc) return null;

    return this.buildDocTree(doc);
  }

  /**
   * 递归构建文档树
   */
  private buildDocTree(doc: DevPlanDoc): DevPlanDocTree {
    const children = this.getChildDocs(doc.section, doc.subSection);
    return {
      doc,
      children: children.map((child) => this.buildDocTree(child)),
    };
  }

  // ==========================================================================
  // Utility
  // ==========================================================================

  sync(): void {
    this.graph.flush();
  }

  getProjectName(): string {
    return this.projectName;
  }

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
          const reason = `Commit ${sub.completedAtCommit} not found in current branch (HEAD: ${currentHead})`;

          if (!dryRun) {
            this.updateSubTaskStatus(sub.taskId, 'pending', { revertReason: reason });
            this.refreshMainTaskCounts(sub.parentTaskId);

            const parentMain = this.getMainTask(sub.parentTaskId);
            if (parentMain && parentMain.status === 'completed') {
              this.updateMainTaskStatus(sub.parentTaskId, 'in_progress');
            }
          }

          reverted.push({
            taskId: sub.taskId,
            title: sub.title,
            parentTaskId: sub.parentTaskId,
            completedAtCommit: sub.completedAtCommit,
            reason,
          });
        }
      }
    }

    return { checked, reverted, currentHead };
  }

  // ==========================================================================
  // Graph Export (核心差异能力)
  // ==========================================================================

  /**
   * 导出 DevPlan 的图结构用于可视化
   *
   * 返回 vis-network 兼容的 { nodes, edges } 格式。
   */
  exportGraph(options?: {
    includeDocuments?: boolean;
    includeModules?: boolean;
    includeNodeDegree?: boolean;
    enableBackendDegreeFallback?: boolean;
  }): DevPlanExportedGraph {
    const includeDocuments = options?.includeDocuments !== false;
    const includeModules = options?.includeModules !== false;
    const includeNodeDegree = options?.includeNodeDegree !== false;
    const enableBackendDegreeFallback = options?.enableBackendDegreeFallback !== false;

    const nodes: DevPlanGraphNode[] = [];
    const edges: DevPlanGraphEdge[] = [];

    // 项目根节点
    nodes.push({
      id: this.getProjectId(),
      label: this.projectName,
      type: 'project',
      properties: { entityType: ET.PROJECT },
    });

    // 主任务节点
    const mainTasks = this.listMainTasks();
    for (const mt of mainTasks) {
      nodes.push({
        id: mt.id,
        label: mt.title,
        type: 'main-task',
        properties: {
          taskId: mt.taskId,
          priority: mt.priority,
          status: mt.status,
          totalSubtasks: mt.totalSubtasks,
          completedSubtasks: mt.completedSubtasks,
          completedAt: mt.completedAt || null,
        },
      });
      edges.push({
        from: this.getProjectId(),
        to: mt.id,
        label: RT.HAS_MAIN_TASK,
      });

      // 子任务节点
      const subTasks = this.listSubTasks(mt.taskId);
      for (const st of subTasks) {
        nodes.push({
          id: st.id,
          label: st.title,
          type: 'sub-task',
          properties: {
            taskId: st.taskId,
            parentTaskId: st.parentTaskId,
            status: st.status,
            completedAt: st.completedAt || null,
          },
        });
        edges.push({
          from: mt.id,
          to: st.id,
          label: RT.HAS_SUB_TASK,
        });
      }

      // task -> doc 关系
      const taskDocRels = this.getOutRelations(mt.id, RT.TASK_HAS_DOC);
      for (const rel of taskDocRels) {
        edges.push({
          from: mt.id,
          to: rel.target,
          label: RT.TASK_HAS_DOC,
        });
      }
    }

    // 文档节点
    if (includeDocuments) {
      const docs = this.listSections();
      for (const doc of docs) {
        nodes.push({
          id: doc.id,
          label: doc.title,
          type: 'document',
          properties: {
            section: doc.section,
            subSection: doc.subSection,
            version: doc.version,
            parentDoc: doc.parentDoc || null,
            childDocs: doc.childDocs || [],
          },
        });

        // 子文档不连接项目节点，仅通过 doc_has_child 连接父文档
        if (!doc.parentDoc) {
          edges.push({
            from: this.getProjectId(),
            to: doc.id,
            label: RT.HAS_DOCUMENT,
          });
        }

        // doc_has_child 关系（文档 → 子文档）
        if (doc.childDocs?.length) {
          const docEntity = this.findDocEntityBySection(doc.section, doc.subSection);
          if (docEntity) {
            const childRels = this.getOutRelations(docEntity.id, RT.DOC_HAS_CHILD);
            for (const rel of childRels) {
              edges.push({
                from: doc.id,
                to: rel.target,
                label: RT.DOC_HAS_CHILD,
              });
            }
          }
        }
      }
    }

    // 模块节点
    if (includeModules) {
      const modules = this.listModules();
      for (const mod of modules) {
        nodes.push({
          id: mod.id,
          label: mod.name,
          type: 'module',
          properties: {
            moduleId: mod.moduleId,
            status: mod.status,
            mainTaskCount: mod.mainTaskCount,
          },
        });

        // 模块→主任务 关系
        const moduleTasks = this.listMainTasks({ moduleId: mod.moduleId });
        for (const mt of moduleTasks) {
          edges.push({
            from: mod.id,
            to: mt.id,
            label: RT.MODULE_HAS_TASK,
          });
        }
      }
    }

    if (includeNodeDegree) {
      // 优先走 SocialGraphV2 原生 exportGraph(includeNodeDegree) 的 degree 结果
      const nativeDegreeMap: Record<string, number> = {};
      try {
        const nativeGraph = this.graph.exportGraph({
          includeNodeDegree: true,
          includeEdgeMeta: false,
          // 适当放大导出上限，避免默认上限导致节点被截断
          maxNodes: Math.max(nodes.length * 2, 2000),
          maxEdges: Math.max(edges.length * 2, 4000),
        } as any) as any;

        const nativeNodes = Array.isArray(nativeGraph?.nodes) ? nativeGraph.nodes : [];
        for (const n of nativeNodes) {
          if (typeof n?.id !== 'string') continue;
          if (typeof n?.degree === 'number' && Number.isFinite(n.degree)) {
            nativeDegreeMap[n.id] = n.degree;
          }
        }
      } catch {
        // 当原生导出异常时，交给后续兜底逻辑处理
      }

      const edgeDegreeMap: Record<string, number> = {};
      if (enableBackendDegreeFallback) {
        for (const node of nodes) edgeDegreeMap[node.id] = 0;
        for (const edge of edges) {
          if (edgeDegreeMap[edge.from] !== undefined) edgeDegreeMap[edge.from] += 1;
          if (edgeDegreeMap[edge.to] !== undefined) edgeDegreeMap[edge.to] += 1;
        }
      }

      for (const node of nodes) {
        const nativeDegree = nativeDegreeMap[node.id];
        if (typeof nativeDegree === 'number' && Number.isFinite(nativeDegree)) {
          node.degree = nativeDegree;
          continue;
        }
        node.degree = enableBackendDegreeFallback ? (edgeDegreeMap[node.id] || 0) : 0;
      }
    }

    return { nodes, edges };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * 获取下一个主任务的 order 值（当前最大 order + 1）
   */
  private getNextMainTaskOrder(): number {
    const entities = this.findEntitiesByType(ET.MAIN_TASK);
    let maxOrder = 0;
    for (const e of entities) {
      const o = (e.properties as any).order;
      if (typeof o === 'number' && o > maxOrder) {
        maxOrder = o;
      }
    }
    return maxOrder + 1;
  }

  /**
   * 获取下一个子任务的 order 值（当前父任务下最大 order + 1）
   */
  private getNextSubTaskOrder(parentTaskId: string): number {
    const entities = this.findEntitiesByType(ET.SUB_TASK).filter(
      (e) => (e.properties as any).parentTaskId === parentTaskId
    );
    let maxOrder = 0;
    for (const e of entities) {
      const o = (e.properties as any).order;
      if (typeof o === 'number' && o > maxOrder) {
        maxOrder = o;
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
    const completedCount = subs.filter((s) => s.status === 'completed').length;

    if (mainTask.totalSubtasks === subs.length && mainTask.completedSubtasks === completedCount) {
      return mainTask;
    }

    this.graph.updateEntity(mainTask.id, {
      properties: {
        totalSubtasks: subs.length,
        completedSubtasks: completedCount,
        updatedAt: Date.now(),
      },
    });

    this.graph.flush();
    const updated = this.graph.getEntity(mainTask.id);
    return updated ? this.entityToMainTask(updated) : mainTask;
  }

  private autoUpdateMilestones(completedMainTask: MainTask): void {
    const milestonesDoc = this.getSection('milestones');
    if (!milestonesDoc) return;

    const dateStr = new Date().toISOString().split('T')[0];
    const appendLine = `\n| ${completedMainTask.taskId} | ${completedMainTask.title} | ${dateStr} | ✅ 已完成 |`;
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

  private updateModuleDocRelation(docEntityId: string, oldModuleId?: string, newModuleId?: string): void {
    // 移除旧模块关系
    if (oldModuleId) {
      const oldMod = this.findEntityByProp(ET.MODULE, 'moduleId', oldModuleId);
      if (oldMod) {
        const rel = this.graph.getRelationBetween(oldMod.id, docEntityId);
        if (rel) this.graph.deleteRelation(rel.id);
      }
    }
    // 添加新模块关系
    if (newModuleId) {
      const newMod = this.findEntityByProp(ET.MODULE, 'moduleId', newModuleId);
      if (newMod) {
        this.graph.putRelation(newMod.id, docEntityId, RT.MODULE_HAS_DOC);
      }
    }
  }

  private updateModuleTaskRelation(taskEntityId: string, oldModuleId?: string, newModuleId?: string): void {
    if (oldModuleId) {
      const oldMod = this.findEntityByProp(ET.MODULE, 'moduleId', oldModuleId);
      if (oldMod) {
        const rel = this.graph.getRelationBetween(oldMod.id, taskEntityId);
        if (rel) this.graph.deleteRelation(rel.id);
      }
    }
    if (newModuleId) {
      const newMod = this.findEntityByProp(ET.MODULE, 'moduleId', newModuleId);
      if (newMod) {
        this.graph.putRelation(newMod.id, taskEntityId, RT.MODULE_HAS_TASK);
      }
    }
  }

  /**
   * 更新文档的父文档关系（DOC_HAS_CHILD）
   *
   * 移除旧的父文档关系，建立新的父文档关系。
   */
  private updateParentDocRelation(docEntityId: string, oldParentDoc?: string, newParentDoc?: string): void {
    const projectId = this.getProjectId();

    // 移除旧的父文档关系（入向 DOC_HAS_CHILD）
    if (oldParentDoc) {
      const [oldSection, oldSub] = oldParentDoc.split('|');
      const oldParentEntity = this.findDocEntityBySection(oldSection, oldSub || undefined);
      if (oldParentEntity) {
        const rel = this.graph.getRelationBetween(oldParentEntity.id, docEntityId);
        if (rel) this.graph.deleteRelation(rel.id);
      }
    }

    // 建立新的父文档关系
    if (newParentDoc) {
      const [newSection, newSub] = newParentDoc.split('|');
      const newParentEntity = this.findDocEntityBySection(newSection, newSub || undefined);
      if (newParentEntity) {
        this.graph.putRelation(newParentEntity.id, docEntityId, RT.DOC_HAS_CHILD);
      }
      // 从顶级变为子文档 → 移除 project -> doc 的 has_document 关系
      if (!oldParentDoc) {
        const hasDocRels = this.getInRelations(docEntityId, RT.HAS_DOCUMENT);
        for (const rel of hasDocRels) {
          if (rel.source === projectId) {
            this.graph.deleteRelation(rel.id);
          }
        }
      }
    } else if (oldParentDoc && !newParentDoc) {
      // 从子文档变为顶级 → 添加 project -> doc 关系
      this.graph.putRelation(projectId, docEntityId, RT.HAS_DOCUMENT);
    }
  }

  private getCurrentGitCommit(): string | undefined {
    try {
      const { execSync } = require('child_process');
      return execSync('git rev-parse --short HEAD', {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.gitCwd,
      }).trim();
    } catch {
      return undefined;
    }
  }

  private isAncestor(commit: string, target: string): boolean {
    try {
      const { execSync } = require('child_process');
      execSync(`git merge-base --is-ancestor ${commit} ${target}`, {
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.gitCwd,
      });
      return true;
    } catch {
      return false;
    }
  }

  private progressBar(percent: number): string {
    const total = 20;
    const filled = Math.round((percent / 100) * total);
    const empty = total - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  // ==========================================================================
  // Semantic Search Helpers
  // ==========================================================================

  /**
   * 自动为文档生成 Embedding 并索引到 SocialGraphV2 向量搜索层
   *
   * 将 title + content 拼接后生成 Embedding，以 entity.id 为 key 存入 HNSW 索引。
   * 失败时仅输出警告，不影响文档保存。
   */
  private autoIndexDocument(entityId: string, title: string, content: string): void {
    if (!this.semanticSearchReady || !this.synapse) return;

    try {
      const text = `${title}\n${content}`;
      const embedding = this.synapse.embed(text);
      this.graph.indexEntity(entityId, embedding);
    } catch (e) {
      console.warn(
        `[DevPlan] Failed to index document ${entityId}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }

  /**
   * 字面搜索（标题/内容包含查询词）
   */
  private literalSearch(query: string): DevPlanDoc[] {
    const queryLower = query.toLowerCase();
    return this.listSections().filter(
      (doc) =>
        doc.content.toLowerCase().includes(queryLower) ||
        doc.title.toLowerCase().includes(queryLower)
    );
  }

  /**
   * RRF (Reciprocal Rank Fusion) 融合排序
   *
   * 将语义搜索和字面搜索的结果通过 RRF 公式融合：
   *   score(d) = Σ 1/(k + rank_i(d))
   * 其中 k=60 是标准 RRF 常数。
   */
  private rrfFusion(
    semanticHits: VectorSearchHit[],
    literalResults: DevPlanDoc[],
    limit: number,
    minScore: number,
  ): ScoredDevPlanDoc[] {
    const RRF_K = 60;
    const rrfScores = new Map<string, number>();
    const docMap = new Map<string, DevPlanDoc>();

    // 语义搜索结果贡献
    for (let i = 0; i < semanticHits.length; i++) {
      const hit = semanticHits[i];
      const rrf = 1 / (RRF_K + i + 1);
      rrfScores.set(hit.entityId, (rrfScores.get(hit.entityId) || 0) + rrf);
    }

    // 字面搜索结果贡献
    for (let i = 0; i < literalResults.length; i++) {
      const doc = literalResults[i];
      const rrf = 1 / (RRF_K + i + 1);
      rrfScores.set(doc.id, (rrfScores.get(doc.id) || 0) + rrf);
      docMap.set(doc.id, doc);
    }

    // 按 RRF 评分排序
    const sorted = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1]);

    // 组装结果
    const results: ScoredDevPlanDoc[] = [];
    for (const [id, score] of sorted) {
      if (minScore > 0 && score < minScore) continue;
      if (results.length >= limit) break;

      // 优先从 docMap 获取（字面搜索已解析过的），否则从图中获取
      let doc = docMap.get(id);
      if (!doc) {
        const entity = this.graph.getEntity(id);
        if (entity && (entity.properties as any)?.projectName === this.projectName) {
          doc = this.entityToDevPlanDoc(entity);
        }
      }

      if (doc) {
        results.push({ ...doc, score });
      }
    }

    return results;
  }
}
