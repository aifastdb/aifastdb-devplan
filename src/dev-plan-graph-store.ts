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
  // Phase-52: Perception 预设 + 配置类型（Embedding 模型可配置化）
  PerceptionPresets,
  type PerceptionConfig,
  resolveModelDimension,
  // Phase-52: TextSearch 类型（Tantivy BM25 三路混合搜索）
  type TextSearchHit,
  type TextSearchConfig,
  // Phase-46: 导入 Phase-109 Memory Tree 类型接口（供 Phase-47~51 使用）
  type MemoryTreeConfig,
  // DecomposedEntity — 仅 Rust 层 memoryTreeDetectConflicts 使用，TS 层冲突检测不再需要
  type DecomposedRelation,
  type DecompositionResult,
  type MemoryTreeEmbeddingInput,
  type MemoryTreeStoreResult,
  type ActivatedMemory as RustActivatedMemory,
  type MemoryScanReport,
  // ConflictResult — TS 层冲突检测已重写为直接向量搜索，不再委托 Rust 层
} from 'aifastdb';
import { randomUUID } from 'crypto';

import * as path from 'path';
import * as fs from 'fs';
import type { IDevPlanStore, VectorSearchStatus } from './dev-plan-interface';
import {
  DEVPLAN_SHARD_NAMES,
  DEVPLAN_TYPE_SHARD_MAPPING,
  DEVPLAN_RELATION_SHARD_ID,
  DEVPLAN_EXPECTED_SHARD_DIRS,
} from './shard-config';
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
  DeleteTaskResult,
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
  DevPlanPaginatedGraph,
  DevPlanGraphNode,
  DevPlanGraphEdge,
  EntityGroupAggregation,
  SearchMode,
  ScoredDevPlanDoc,
  RebuildIndexResult,
  PromptInput,
  Prompt,
  MemoryInput,
  Memory,
  MemoryType,
  MemoryRecallProfile,
  ScoredMemory,
  MemoryContext,
  MemoryCandidate,
  MemoryGenerateResult,
  PerceptionPresetName,
  RecallDepth,
  RecallScope,
  DocStrategy,
  UnifiedRecallOptions,
  RecallSearchTuningConfig,
  RecallFeatureFlags,
  RecallFeatureFlagsPatch,
  RecallObservability,
} from './types';
import {
  mapGroupToDevPlanType as mapGroupToDevPlanTypeUtil,
  progressBar as progressBarUtil,
  DEFAULT_BM25_DOMAIN_TERMS,
  resolvePerceptionConfig,
  resolveRecallSearchTuning as resolveRecallSearchTuningUtil,
  resolveBm25UserDictPath,
  migrateWalDirNames,
  applyBm25TermBoost as applyBm25TermBoostUtil,
} from './dev-plan-graph-store.utils';
import {
  ET,
  RT,
  ANCHOR_TYPES,
  CHANGE_TYPES,
  sectionImportance,
  sectionKey,
  type ResolvedRecallSearchTuning,
  type NativeAnchorInfo,
  type NativeFlowEntry,
  type NativeFlowFilter,
  type NativeComponentRef,
  type NativeStructureSnapshot,
  type NativeStructureDiff,
  type NativeExtractedAnchor,
} from './dev-plan-graph-store.shared';
import {
  docSectionToMemoryType as docSectionToMemoryTypeUtil,
  rrfFusionThreeWay as rrfFusionThreeWayUtil,
} from './dev-plan-graph-store.recall-utils';
import {
  applyDeterministicRecallFilter as applyDeterministicRecallFilterImpl,
  expandMemoriesByGraph as expandMemoriesByGraphImpl,
  expandMemoriesByManualTraversal as expandMemoriesByManualTraversalImpl,
  expandMemoriesBySubgraph as expandMemoriesBySubgraphImpl,
  getFeatureFlags as getFeatureFlagsImpl,
  getRecallObservability as getRecallObservabilityImpl,
  hebbianStrengthen as hebbianStrengthenImpl,
  processMemorySearchHits as processMemorySearchHitsImpl,
  recallMemory as recallMemoryImpl,
  recallUnified as recallUnifiedImpl,
  recallUnifiedViaAdapter as recallUnifiedViaAdapterImpl,
  recallViaActivationEngine as recallViaActivationEngineImpl,
  recallViaLegacySearch as recallViaLegacySearchImpl,
  resetRecallObservability as resetRecallObservabilityImpl,
  setFeatureFlags as setFeatureFlagsImpl,
  shouldPersistRecallAccessUpdate as shouldPersistRecallAccessUpdateImpl,
  treeIndexSearchDocuments as treeIndexSearchDocumentsImpl,
  vectorSearchDocuments as vectorSearchDocumentsImpl,
  type RecallStoreBindings,
} from './dev-plan-graph-store.recall';
import {
  autoLinkMemoryToDoc as autoLinkMemoryToDocImpl,
  autoLinkMemoryToModule as autoLinkMemoryToModuleImpl,
  autoLinkSimilarMemories as autoLinkSimilarMemoriesImpl,
  findDuplicateMemory as findDuplicateMemoryImpl,
  generateMemoryCandidates as generateMemoryCandidatesImpl,
  resolveMemoryRecallProfile as resolveMemoryRecallProfileImpl,
  saveMemory as saveMemoryImpl,
  type MemoryWriteStoreBindings,
} from './dev-plan-graph-store.memory-write';
import {
  enrichMemoriesWithAnchorInfo as enrichMemoriesWithAnchorInfoImpl,
  getAnchorStructure as getAnchorStructureImpl,
  getStructureDiff as getStructureDiffImpl,
  integrateAnchorFlowStructure as integrateAnchorFlowStructureImpl,
  listAnchors as listAnchorsImpl,
  queryAnchorFlow as queryAnchorFlowImpl,
  type AnchorFlowStructureStoreBindings,
} from './dev-plan-graph-store.anchor';
import {
  addSubTask as addSubTaskImpl,
  completeMainTask as completeMainTaskImpl,
  completeSubTask as completeSubTaskImpl,
  createMainTask as createMainTaskImpl,
  deleteTask as deleteTaskImpl,
  getMainTask as getMainTaskImpl,
  getNextMainTaskOrder as getNextMainTaskOrderImpl,
  getNextSubTaskOrder as getNextSubTaskOrderImpl,
  getProgress as getProgressImpl,
  getSubTask as getSubTaskImpl,
  listMainTasks as listMainTasksImpl,
  listSubTasks as listSubTasksImpl,
  reconcileMainTaskAfterSubTaskDeletion as reconcileMainTaskAfterSubTaskDeletionImpl,
  refreshMainTaskCounts as refreshMainTaskCountsImpl,
  repairAllMainTaskCounts as repairAllMainTaskCountsImpl,
  resolveTaskDeleteType as resolveTaskDeleteTypeImpl,
  updateMainTaskStatus as updateMainTaskStatusImpl,
  updateSubTaskStatus as updateSubTaskStatusImpl,
  updateTaskStatus as updateTaskStatusImpl,
  upsertMainTask as upsertMainTaskImpl,
  upsertSubTask as upsertSubTaskImpl,
  type TaskStoreBindings,
} from './dev-plan-graph-store.tasks';
import {
  buildDocTree as buildDocTreeImpl,
  findDocEntityBySection as findDocEntityBySectionImpl,
  getChildDocs as getChildDocsImpl,
  getDocRelatedTasks as getDocRelatedTasksImpl,
  getDocTree as getDocTreeImpl,
  getSection as getSectionImpl,
  getTaskRelatedDocs as getTaskRelatedDocsImpl,
  listSections as listSectionsImpl,
  searchSections as searchSectionsImpl,
  searchSectionsAdvanced as searchSectionsAdvancedImpl,
  type DocStoreBindings,
} from './dev-plan-graph-store.docs';
import {
  entityToPrompt as entityToPromptImpl,
  getTaskRelatedPrompts as getTaskRelatedPromptsImpl,
  listPrompts as listPromptsImpl,
  savePrompt as savePromptImpl,
  type PromptStoreBindings,
} from './dev-plan-graph-store.prompts';
import {
  createModule as createModuleImpl,
  deleteModule as deleteModuleImpl,
  entityToModule as entityToModuleImpl,
  getModule as getModuleImpl,
  getModuleDetail as getModuleDetailImpl,
  listModules as listModulesImpl,
  updateModule as updateModuleImpl,
  type ModuleStoreBindings,
} from './dev-plan-graph-store.modules';
import {
  exportGraph as exportGraphImpl,
  exportGraphCompact as exportGraphCompactImpl,
  exportGraphPaginated as exportGraphPaginatedImpl,
  exportTaskSummary as exportTaskSummaryImpl,
  exportToMarkdown as exportToMarkdownImpl,
  getEntityGroupSummary as getEntityGroupSummaryImpl,
  type VisualizeStoreBindings,
} from './dev-plan-graph-store.visualize';
import {
  syncWithGit as syncWithGitImpl,
  type GitStoreBindings,
} from './dev-plan-graph-store.git';
import { isUuidLikeQuery, rankLiteralDocMatches } from './doc-search-utils';
import { MemoryGatewayAdapter, type MemoryGatewayTelemetry } from './memory-gateway-adapter';

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
  /** 语义搜索是否在配置上启用（懒初始化前为 true，ready 仍可能为 false） */
  private semanticSearchConfigured: boolean = false;
  /** 语义搜索是否成功初始化 */
  private semanticSearchReady: boolean = false;
  /** 是否已经尝试过初始化 Synapse（避免失败后每次请求都重复冷启动） */
  private synapseInitAttempted: boolean = false;
  /** 懒初始化 Synapse 时复用的配置 */
  private synapseConfig: DevPlanGraphStoreConfig | null = null;
  /** Phase-52: Tantivy BM25 全文搜索是否可用 */
  private textSearchReady: boolean = false;
  /** Phase-54: LlmGateway 实例（用于 LLM Reranking），仅启用重排时可用 */
  private llmGateway: any | null = null;
  /** Phase-54: LLM Reranking 是否就绪 */
  private rerankReady: boolean = false;
  /** Phase-54: 重排使用的模型名称 */
  private rerankModel: string = 'gemma3:4b';
  /** Phase-140: 统一记忆 API 适配器（统一 API 优先，支持回退） */
  private memoryGatewayAdapter: MemoryGatewayAdapter | null = null;
  /** NAPI 能力探测：memoryTreeSearch 是否可用（避免 wrapper 存在但 native 缺失时报错） */
  private nativeMemoryTreeSearchReady: boolean = false;
  /** NAPI 能力探测：anchorExtractFromText 是否可用 */
  private nativeAnchorExtractReady: boolean = false;
  /** NAPI 能力探测：applyMutations 是否可用 */
  private nativeApplyMutationsReady: boolean = false;
  /** Phase-216: 向量搜索诊断快照（构造时写入，getVectorStatus 时读取） */
  private vectorDiag: {
    configSource: 'preset' | 'perceptionConfig' | 'default';
    configValue: string | null;
    hasFallback: boolean;
    fallbackInfo: string | null;
  } = { configSource: 'default', configValue: null, hasFallback: false, fallbackInfo: null };
  /** Phase-52/T52.5: 文档 TreeIndex 检索是否启用（需 LLM Gateway 可用） */
  private treeIndexRetrievalEnabled: boolean = false;
  /** TreeIndex 候选节点上限 */
  private treeIndexMaxNodes: number = 10;
  /** Phase-79: Unified Recall Feature Flags */
  private recallFeatureFlags: RecallFeatureFlags = {
    autoSession: false,
    recursiveRecall: true,
    uriIndex: true,
  };
  /** Phase-79: Unified Recall Observability 累计指标 */
  private recallObservabilityRaw = {
    totalCalls: 0,
    totalFallbacks: 0,
    totalLatencyMs: 0,
    lastLatencyMs: 0,
    lastError: undefined as string | undefined,
  };
  /** Phase-52: Recall/BM25 调优参数（可通过 .devplan/config.json 外部化） */
  private recallSearchTuning: ResolvedRecallSearchTuning = {
    rrfK: 60,
    vectorWeight: 1,
    bm25Weight: 1,
    graphWeight: 1,
    bm25TermBoost: 2,
    bm25DomainTerms: [...DEFAULT_BM25_DOMAIN_TERMS],
    tagBoostFactor: 0.15,
    queryCoverageBoost: 0.35,
    relatedTaskBoost: 0.12,
    testMemoryPenalty: 0.3,
  };

  /**
   * Provide an explicit typed binding view for extracted modules.
   * This avoids structural typing friction from DevPlanGraphStore private fields.
   */
  private get recallStoreBindings(): RecallStoreBindings {
    return this as unknown as RecallStoreBindings;
  }

  private get memoryWriteStoreBindings(): MemoryWriteStoreBindings {
    return this as unknown as MemoryWriteStoreBindings;
  }

  private get anchorFlowStructureBindings(): AnchorFlowStructureStoreBindings {
    return this as unknown as AnchorFlowStructureStoreBindings;
  }

  private get taskStoreBindings(): TaskStoreBindings {
    return this as unknown as TaskStoreBindings;
  }

  private get docStoreBindings(): DocStoreBindings {
    return this as unknown as DocStoreBindings;
  }

  private get promptStoreBindings(): PromptStoreBindings {
    return this as unknown as PromptStoreBindings;
  }

  private get moduleStoreBindings(): ModuleStoreBindings {
    return this as unknown as ModuleStoreBindings;
  }

  private get visualizeStoreBindings(): VisualizeStoreBindings {
    return this as unknown as VisualizeStoreBindings;
  }

  private get gitStoreBindings(): GitStoreBindings {
    return this as unknown as GitStoreBindings;
  }

  constructor(projectName: string, config: DevPlanGraphStoreConfig) {
    this.projectName = projectName;
    this.gitCwd = config.gitCwd;
    this.semanticSearchConfigured = Boolean(config.enableSemanticSearch);
    this.synapseConfig = this.semanticSearchConfigured ? config : null;

    // ── WAL 目录迁移：旧名 → 语义化新名 ──
    // 必须在 SocialGraphV2 构造之前执行，否则 recover() 会找不到旧数据
    migrateWalDirNames(config.graphPath);

    // 构建 SocialGraphV2 配置
    // shardCount 由 SocialGraphV2 自动从 shardNames.length 推导（aifastdb >= 2.7.0）
    // 所有分片定义集中在 shard-config.ts（单一数据源）
    const graphConfig: any = {
      path: config.graphPath,
      walEnabled: true,
      mode: 'balanced',
      shardNames: DEVPLAN_SHARD_NAMES,
      typeShardMapping: DEVPLAN_TYPE_SHARD_MAPPING,
      relationShardId: DEVPLAN_RELATION_SHARD_ID,
    };
    const recallSearchTuning = resolveRecallSearchTuningUtil(config.recallSearchTuning);

    // 如果启用语义搜索，配置 SocialGraphV2 的向量搜索
    // 维度自动解析: explicitDimension > perception.dimension > MODEL_DIMENSION_REGISTRY[modelId] > 384
    const perception = config.enableSemanticSearch
      ? resolvePerceptionConfig(config) : null;
    const dimension = resolveModelDimension(
      perception?.modelId,
      config.embeddingDimension ?? perception?.dimension,
    );
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

    // Phase-52: 如果启用 Tantivy BM25 全文搜索，配置 textSearch
    if (config.enableTextSearch) {
      const userDictPath = resolveBm25UserDictPath(
        config.graphPath,
        recallSearchTuning.bm25DomainTerms,
        recallSearchTuning.bm25UserDictPath,
      );
      graphConfig.textSearch = {
        enableChinese: true,  // DevPlan 面向中文开发者，默认启用中文分词
        autoCommit: true,     // 自动提交索引更新
        ...(userDictPath ? { userDictPath } : {}),
      } satisfies TextSearchConfig;
    }

    this.graph = new SocialGraphV2(graphConfig);
    this.detectNativeCapabilities();

    // SocialStoreV2::new() 已在构造函数内自动调用 recover()（包括实体 WAL + 向量 WAL）
    // ⚠️ 不要再手动调用 graph.recover()！第二次 recover() 会导致 HNSW 向量索引被清空
    // 原因：recover_vector_index 在已有向量的 HNSW 上重复 insert_sync 引起状态混乱
    // See: SocialStoreV2::new() → store.recover() (packages/core/src/social/store_v2/mod.rs:152)

    // Phase-52: 检测 Tantivy 全文搜索是否就绪
    if (config.enableTextSearch) {
      try {
        this.textSearchReady = this.graph.hasTextSearch();
        if (this.textSearchReady) {
          console.error('[DevPlan] Tantivy BM25 full-text search initialized');
        } else {
          console.warn('[DevPlan] Tantivy BM25 requested but hasTextSearch() returned false. ' +
            'Ensure aifastdb was built with full-text-search feature.');
        }
      } catch {
        console.warn('[DevPlan] Tantivy BM25 initialization check failed. Falling back to literal search.');
        this.textSearchReady = false;
      }
    }
    this.recallSearchTuning = recallSearchTuning;

    // 记录向量诊断快照；Synapse 改为首次使用时懒初始化
    if (config.enableSemanticSearch) {
      this.setVectorDiag(config);
    }

    // Phase-52: 向量索引启动诊断
    if (config.enableSemanticSearch) {
      try {
        const vc = this.graph.vectorCount();
        const vd = this.graph.vectorDimension();
        if (vc > 0) {
          console.error(`[DevPlan] Vector index recovered: ${vc} vectors (dim=${vd})`);
        } else if (this.semanticSearchConfigured) {
          console.warn(
            `[DevPlan] Vector index is empty (dim=${vd}). ` +
            'Run devplan_rebuild_index to populate vectors for semantic search.'
          );
        }
      } catch { /* vectorCount may not be available */ }
    }

    // 确保项目根实体存在
    this.ensureProjectEntity();

    // Phase-54 + T52.5: 初始化 LLM Gateway（重排或 TreeIndex 推理检索任一启用即可尝试初始化）
    if (config.enableReranking || config.enableTreeIndexRetrieval) {
      this.initLlmReranking(config);
    }
    this.initMemoryGatewayAdapter(config);
    this.treeIndexMaxNodes = Math.max(3, Math.min(50, Number(config.treeIndexMaxNodes || 10)));
    this.treeIndexRetrievalEnabled = Boolean(config.enableTreeIndexRetrieval) && this.rerankReady;
    if (config.enableTreeIndexRetrieval && !this.treeIndexRetrievalEnabled) {
      console.warn('[DevPlan] TreeIndex retrieval requested but LLM Gateway is unavailable. TreeIndex channel disabled.');
    }
  }

  /**
   * 检测当前加载的 NAPI 二进制能力，避免 JS wrapper 存在但 native 方法缺失时反复抛错。
   */
  private detectNativeCapabilities(): void {
    try {
      const native = (this.graph as any).native as Record<string, unknown> | undefined;
      const hasNativeFn = (name: string): boolean => Boolean(native && typeof native[name] === 'function');

      this.nativeMemoryTreeSearchReady = hasNativeFn('memoryTreeSearch');
      this.nativeAnchorExtractReady = hasNativeFn('anchorExtractFromText');
      this.nativeApplyMutationsReady = hasNativeFn('applyMutations');

      const missing: string[] = [];
      if (!this.nativeMemoryTreeSearchReady) missing.push('memoryTreeSearch');
      if (!this.nativeAnchorExtractReady) missing.push('anchorExtractFromText');
      if (!this.nativeApplyMutationsReady) missing.push('applyMutations');

      if (missing.length > 0) {
        console.warn(
          `[DevPlan] Native capability gap detected (likely aifastdb JS/native mismatch): ` +
          `missing [${missing.join(', ')}]. Falling back to compatible paths.`
        );
      }
    } catch (e) {
      console.warn(
        `[DevPlan] Failed to probe native capabilities: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  /**
   * 导出 Native 能力探测结果（供 MCP devplan_capabilities 诊断输出）。
   */
  getNativeCapabilities(): {
    memoryTreeSearch: boolean;
    anchorExtractFromText: boolean;
    applyMutations: boolean;
  } {
    return {
      memoryTreeSearch: this.nativeMemoryTreeSearchReady,
      anchorExtractFromText: this.nativeAnchorExtractReady,
      applyMutations: this.nativeApplyMutationsReady,
    };
  }

  /**
   * 记录向量搜索诊断配置（不触发 Synapse 初始化）
   */
  private setVectorDiag(config: DevPlanGraphStoreConfig): void {
    const perception = resolvePerceptionConfig(config);
    this.vectorDiag = {
      configSource: config.perceptionConfig ? 'perceptionConfig'
        : config.perceptionPreset ? 'preset' : 'default',
      configValue: config.perceptionConfig
        ? `${perception.engineType}/${perception.modelId} (dim=${perception.dimension ?? 'auto'})`
        : config.perceptionPreset ?? null,
      hasFallback: !!(perception as any).fallbackEngineType,
      fallbackInfo: (perception as any).fallbackEngineType
        ? `${(perception as any).fallbackEngineType}/${(perception as any).fallbackModelId}`
        : null,
    };
  }

  /**
   * 首次需要语义能力时再初始化 Synapse，避免 store 冷启动即加载 embedding 模型。
   */
  private ensureSynapseReady(): boolean {
    if (this.semanticSearchReady && this.synapse) return true;
    if (!this.semanticSearchConfigured || !this.synapseConfig) return false;
    if (this.synapseInitAttempted) return false;
    this.synapseInitAttempted = true;
    this.initSynapse(this.synapseConfig);
    return Boolean(this.semanticSearchReady && this.synapse);
  }

  /**
   * 初始化 VibeSynapse Embedding 引擎
   *
   * Phase-52: 支持通过 perceptionPreset / perceptionConfig 配置不同模型。
   * 默认使用 Candle MiniLM (384维)，支持零配置离线使用。
   * 初始化失败时降级为纯字面搜索（graceful degradation）。
   */
  private initSynapse(config: DevPlanGraphStoreConfig): void {
    const perception = resolvePerceptionConfig(config);
    // 维度自动解析: explicitDimension > perception.dimension > MODEL_DIMENSION_REGISTRY[modelId] > 384
    // ⚠️ 维度一旦初始化不可变更，否则 HNSW 索引与向量维度不匹配
    const dimension = resolveModelDimension(
      perception.modelId,
      config.embeddingDimension ?? perception.dimension,
    );
    const modelLabel = perception.modelId || perception.engineType || 'unknown';

    try {
      const synapsePath = path.resolve(config.graphPath, '..', 'synapse-data');
      this.synapse = new VibeSynapse({
        storage: synapsePath,
        // dimension 由 VibeSynapse 从 perception.modelId 自动解析，无需显式传递
        // 但如果用户在 config 中显式指定了 embeddingDimension，则作为 Matryoshka 截断维度
        ...(config.embeddingDimension ? { dimension: config.embeddingDimension } : {}),
        perception,
      });

      // 验证 perception engine 是否真正可用
      if (!this.synapse.hasPerception) {
        console.warn(
          `[DevPlan] VibeSynapse created but perception engine not available (model: ${modelLabel}). ` +
          'Falling back to literal search.'
        );
        this.synapse = null;
        this.semanticSearchReady = false;
        return;
      }

      // 测试 embed 是否可用（dry run）
      try {
        this.synapse.embed('test');
        this.semanticSearchReady = true;
        console.error(`[DevPlan] Semantic search initialized (model: ${modelLabel}, dim: ${dimension})`);
      } catch {
        console.warn(`[DevPlan] VibeSynapse embed() dry-run failed (model: ${modelLabel}). Falling back to literal search.`);
        this.synapse = null;
        this.semanticSearchReady = false;
      }
    } catch (e) {
      console.warn(
        `[DevPlan] Failed to initialize VibeSynapse (model: ${modelLabel}): ${
          e instanceof Error ? e.message : String(e)
        }. Falling back to literal search.`
      );
      this.synapse = null;
      this.semanticSearchReady = false;
    }
  }

  /**
   * Phase-54: 初始化 LLM Reranking
   *
   * 优雅降级策略（三层保护）：
   * 1. LlmGateway 导入失败（aifastdb 版本过低）→ 跳过
   * 2. LlmGateway 构造 / Provider 注册失败 → 跳过
   * 3. rerankWithLlm 调用失败（Ollama 未运行）→ 返回原始结果
   */
  private initLlmReranking(config: DevPlanGraphStoreConfig): void {
    const model = config.rerankModel || 'gemma3:4b';
    const baseUrl = config.rerankBaseUrl || 'http://localhost:11434/v1';
    this.rerankModel = model;

    try {
      // 动态导入 LlmGateway — 如果 aifastdb 版本不含 LlmGateway 则优雅降级
      const { LlmGateway } = require('aifastdb');
      if (!LlmGateway) {
        console.warn('[DevPlan] LlmGateway not available in current aifastdb version. LLM reranking disabled.');
        return;
      }

      // 创建 LlmGateway 实例（使用 graph-data 同级的 llm-gateway-data 目录）
      const gwPath = path.resolve(config.graphPath, '..', 'llm-gateway-data');
      this.llmGateway = new LlmGateway(gwPath);
      // Optional: initialize gateway memory for ai_db-compatible recall/dedup/outbox ops.
      // Some aifastdb versions expose enableMemory() as an async API. We must
      // attach a rejection handler explicitly; otherwise a delayed rejection can
      // surface as an unhandled promise and terminate the MCP stdio process.
      if (config.llmGatewayMemory?.enable && typeof this.llmGateway.enableMemory === 'function') {
        try {
          const enableResult = this.llmGateway.enableMemory({
            graphDataDir: config.llmGatewayMemory.graphDataDir,
            enableDedupWindow: config.llmGatewayMemory.enableDedupWindow,
            dedupWindowMs: config.llmGatewayMemory.dedupWindowMs,
            dedupScope: config.llmGatewayMemory.dedupScope,
            enableCursorMemoryProfile: config.llmGatewayMemory.enableCursorMemoryProfile,
          });
          if (enableResult && typeof enableResult.then === 'function') {
            void enableResult.catch((e: unknown) => {
              console.warn(
                `[DevPlan] LlmGateway.enableMemory initialization failed (non-fatal): ${
                  e instanceof Error ? e.message : String(e)
                }`
              );
            });
          }
        } catch (e) {
          console.warn(
            `[DevPlan] LlmGateway.enableMemory initialization failed (non-fatal): ${
              e instanceof Error ? e.message : String(e)
            }`
          );
        }
      }

      // 注册 Ollama Provider（幂等 — 已存在则从 store hydrate）
      try {
        this.llmGateway.registerProvider(
          'ollama-rerank',     // id
          'Ollama (Rerank)',   // name
          'ollama',            // brand
          baseUrl,             // baseUrl
          undefined,           // apiKey
          'openai_compat',     // protocol
        );
      } catch {
        // 可能已存在，忽略
      }

      // 注册模型（幂等）
      try {
        this.llmGateway.registerModel(
          model,               // id
          'ollama-rerank',     // providerId
          model,               // name
          undefined,           // displayName
        );
      } catch {
        // 可能已存在，忽略
      }

      this.rerankReady = true;
      console.error(`[DevPlan] LLM reranking initialized (model: ${model}, endpoint: ${baseUrl})`);
    } catch (e) {
      console.warn(
        `[DevPlan] Failed to initialize LLM reranking: ${
          e instanceof Error ? e.message : String(e)
        }. Reranking disabled — search results will use RRF ordering.`
      );
      this.llmGateway = null;
      this.rerankReady = false;
    }
  }

  private initMemoryGatewayAdapter(config: DevPlanGraphStoreConfig): void {
    this.memoryGatewayAdapter = new MemoryGatewayAdapter(this.llmGateway, config.memoryGatewayAdapter);
  }

  /**
   * Phase-54: 使用 LLM 对搜索结果进行语义重排
   *
   * @param query - 用户查询
   * @param results - 搜索结果（需要有 id 和 content/title 字段）
   * @param topK - 返回 top-K 结果（0 = 全部）
   * @returns 重排后的结果（失败时返回原始顺序）
   */
  private rerankSearchResults<T extends { id: string; content?: string; title?: string }>(
    query: string,
    results: T[],
    topK: number = 0,
  ): T[] {
    if (!this.rerankReady || !this.llmGateway || results.length <= 1) {
      return results;
    }

    try {
      // 构建候选列表：id + content（截取前 300 字符）
      const candidates = results.map(r => ({
        id: r.id,
        content: ((r.title ? r.title + '\n' : '') + (r.content || '')).substring(0, 300),
      }));

      const output = this.llmGateway.rerankWithLlm(
        query,
        candidates,
        this.rerankModel,
        undefined,       // systemPrompt (use built-in)
        0.1,             // temperature
        512,             // maxTokens
        topK > 0 ? topK : undefined,  // topK
        300,             // maxContentLen
      );

      // LLM 失败时 Rust 层已返回 isFallback 排序 — 仍然是有效排序
      if (output && output.items && output.items.length > 0) {
        // 按 LLM 重排顺序重新排列结果
        const idToResult = new Map<string, T>();
        for (const r of results) {
          idToResult.set(r.id, r);
        }

        const reranked: T[] = [];
        for (const item of output.items) {
          const original = idToResult.get(item.id);
          if (original) {
            reranked.push(original);
          }
        }

        // 安全兜底：如果 reranked 比 results 少（id 丢失），追加遗漏项
        if (reranked.length < results.length) {
          const rerankedIds = new Set(reranked.map(r => r.id));
          for (const r of results) {
            if (!rerankedIds.has(r.id)) {
              reranked.push(r);
            }
          }
        }

        const fallbackLabel = output.isFallback ? ' (fallback)' : '';
        console.error(
          `[DevPlan] LLM reranked ${reranked.length} results in ${output.durationMs}ms` +
          `${fallbackLabel} (model: ${output.model})`
        );
        return reranked;
      }
    } catch (e) {
      // 优雅降级：Ollama 不可用、超时等 → 返回原始排序
      console.warn(
        `[DevPlan] LLM reranking failed: ${e instanceof Error ? e.message : String(e)}. ` +
        'Using original RRF ordering.'
      );
    }

    return results;
  }

  // ==========================================================================
  // Project Entity
  // ==========================================================================

  private ensureProjectEntity(): void {
    const entity = this.graph.upsertEntityByProp(
      ET.PROJECT, 'projectName', this.projectName, this.projectName, {
        projectName: this.projectName,
        createdAt: Date.now(),
      }
    );
      this.projectEntityId = entity.id;
      this.graph.flush();
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

  /** 任务状态优先级映射（用于去重时选择"胜出"实体） */
  private static readonly STATUS_PRIORITY: Record<string, number> = {
    cancelled: 0,
    pending: 1,
    in_progress: 2,
    completed: 3,
  };

  /**
   * 通用 Entity 去重：按指定 property key 分组，每组只保留"最优"实体。
   *
   * 胜出规则：
   * 1. status 优先级高者胜（completed > in_progress > pending > cancelled）
   * 2. 同 status 时 updatedAt 最新者胜
   *
   * 适用于 mainTask（按 taskId 去重）、subTask（按 taskId 去重）、
   * module（按 moduleId 去重）等场景。
   */
  private deduplicateEntities(entities: Entity[], propKey: string): Entity[] {
    const bestMap = new Map<string, Entity>();
    for (const e of entities) {
      const key = (e.properties as any)?.[propKey] as string;
      if (!key) {
        // 无 key 的 entity 直接保留
        bestMap.set(e.id, e);
        continue;
      }
      const existing = bestMap.get(key);
      if (!existing) {
        bestMap.set(key, e);
        continue;
      }
      // 比较状态优先级
      const existStatus = DevPlanGraphStore.STATUS_PRIORITY[(existing.properties as any)?.status] ?? 1;
      const newStatus = DevPlanGraphStore.STATUS_PRIORITY[(e.properties as any)?.status] ?? 1;
      if (newStatus > existStatus) {
        bestMap.set(key, e);
      } else if (newStatus === existStatus) {
        // 同状态：updatedAt 更大者胜
        const existUpdated = Number((existing.properties as any)?.updatedAt) || 0;
        const newUpdated = Number((e.properties as any)?.updatedAt) || 0;
        if (newUpdated > existUpdated) {
          bestMap.set(key, e);
        }
      }
    }
    return Array.from(bestMap.values());
  }

  /**
   * 查找所有重复 Entity（按指定 property key 分组，返回非胜出者列表）。
   * 用于清理 WAL 中的冗余记录。
   */
  private findDuplicateEntities(entityType: string, propKey: string): Entity[] {
    const entities = this.findEntitiesByType(entityType);
    const groups = new Map<string, Entity[]>();
    for (const e of entities) {
      const key = (e.properties as any)?.[propKey] as string;
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }

    const duplicates: Entity[] = [];
    for (const [, group] of groups) {
      if (group.length <= 1) continue;
      // 找出胜者（deduplicateEntities 返回的唯一值）
      const winner = this.deduplicateEntities(group, propKey)[0];
      for (const e of group) {
        if (e.id !== winner.id) {
          duplicates.push(e);
        }
      }
    }
    return duplicates;
  }

  /** 按 entityType 列出所有实体并按属性过滤 */
  private findEntitiesByType(entityType: string): Entity[] {
    return this.graph.listEntitiesByType(entityType).filter(
      (e) => (e.properties as any)?.projectName === this.projectName
    );
  }

  /**
   * 按属性在指定类型中查找唯一实体。
   *
   * Phase-21 改进：当同一 key+value 有多个 Entity（WAL 重复），
   * 选择状态优先级最高 + updatedAt 最新的那个（而非随机第一个）。
   */
  private findEntityByProp(entityType: string, key: string, value: string): Entity | null {
    const entities = this.findEntitiesByType(entityType);
    const matches = entities.filter((e) => (e.properties as any)?.[key] === value);
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    // 多个匹配 → 去重取最优
    return this.deduplicateEntities(matches, key)[0] || null;
  }

  /** 获取实体的出向关系 */
  private getOutRelations(entityId: string, relationType?: string): Relation[] {
    // Phase-44: 优先使用 outgoingByType（直接查询分片，O(出度)），
    //           避免 listRelations 的全量扫描 O(关系总数)
    // Phase-46: 移除 as any 断言 — aifastdb ≥2.8.0 已有正式类型
    if (relationType) {
      return this.graph.outgoingByType(entityId, relationType) as Relation[];
    }
    const filter: any = { source: entityId };
    return this.graph.listRelations(filter);
  }

  /** 获取实体的入向关系 */
  private getInRelations(entityId: string, relationType?: string): Relation[] {
    // Phase-44: 优先使用 incomingByType（直接查询分片，O(入度)），
    //           避免 listRelations 的全量扫描 O(关系总数)
    // Phase-46: 移除 as any 断言 — aifastdb ≥2.8.0 已有正式类型
    if (relationType) {
      return this.graph.incomingByType(entityId, relationType) as Relation[];
    }
    const filter: any = { targetId: entityId };
    return this.graph.listRelations(filter);
  }

  /** 按 section + subSection 查找文档实体（返回原始 Entity） */
  private findDocEntityBySection(section: string, subSection?: string): Entity | null {
    return findDocEntityBySectionImpl(this.docStoreBindings, section, subSection);
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
      relatedPromptIds: p.relatedPromptIds || [],
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
    return entityToModuleImpl(this.moduleStoreBindings, e);
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
    this.validateParentDocAssignment(input.section, input.subSection, existing?.id, finalParentDoc);

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

    // 新建文档 — upsert by sectionKey 防止重复
    const sectionKey = input.subSection
      ? `${input.section}|${input.subSection}`
      : input.section;
    const entity = this.graph.upsertEntityByProp(
      ET.DOC, 'sectionKey', sectionKey, input.title, {
      projectName: this.projectName,
      section: input.section,
        sectionKey,
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
      }
    );

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

  addSection(input: DevPlanDocInput): string {
    // 纯新增语义：如果同 section+subSection 已存在，抛出错误而非覆盖
    const existing = this.getSection(input.section, input.subSection);
    if (existing) {
      const key = sectionKey(input.section, input.subSection);
      throw new Error(
        `文档 "${key}" 已存在（标题: "${existing.title}"）。如需更新请使用 saveSection/updateSection。`
      );
    }

    const now = Date.now();
    const version = input.version || '1.0.0';
    const finalModuleId = input.moduleId || null;
    const finalParentDoc = input.parentDoc !== undefined ? input.parentDoc : null;
    const sk = sectionKey(input.section, input.subSection);
    this.validateParentDocAssignment(input.section, input.subSection, undefined, finalParentDoc);

    // 使用 addEntity（纯新增，每次生成新 UUID），不使用 upsertEntityByProp
    const entity = this.graph.addEntity(input.title, ET.DOC, {
      projectName: this.projectName,
      section: input.section,
      sectionKey: sk,
      title: input.title,
      content: input.content,
      version,
      subSection: input.subSection || null,
      relatedSections: input.relatedSections || [],
      relatedTaskIds: input.relatedTaskIds || [],
      moduleId: finalModuleId,
      parentDoc: finalParentDoc,
      createdAt: now,
      updatedAt: now,
    });

    // 子文档不直接连接项目节点，仅通过 doc_has_child 连接父文档
    if (finalParentDoc) {
      const [parentSection, parentSubSection] = finalParentDoc.split('|');
      const parentEntity = this.findDocEntityBySection(parentSection, parentSubSection || undefined);
      if (parentEntity) {
        this.graph.putRelation(parentEntity.id, entity.id, RT.DOC_HAS_CHILD);
      }
    } else {
      this.graph.putRelation(this.getProjectId(), entity.id, RT.HAS_DOCUMENT);
    }

    // 模块关联
    if (finalModuleId) {
      const modEntity = this.findEntityByProp(ET.MODULE, 'moduleId', finalModuleId);
      if (modEntity) {
        this.graph.putRelation(modEntity.id, entity.id, RT.MODULE_HAS_DOC);
      }
    }

    // task -> doc 关系
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
    return getSectionImpl(this.docStoreBindings, section, subSection);
  }

  listSections(): DevPlanDoc[] {
    return listSectionsImpl(this.docStoreBindings);
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
    return searchSectionsImpl(this.docStoreBindings, query, limit);
  }

  /**
   * 高级搜索：支持 literal / semantic / hybrid 三种模式
   *
   * - literal: 纯字面匹配（标题+内容包含查询词），当 Tantivy 可用时自动升级为 BM25
   * - semantic: 纯语义搜索（embed(query) → searchEntitiesByVector）
   * - hybrid: 三路 RRF 融合（vector + BM25/literal + graph）
   *
   * Phase-52: 当 Tantivy BM25 可用时，literal 通道自动升级为 BM25 搜索，
   * 提供更精准的全文匹配（支持中文分词、同义词、TF-IDF 评分）。
   *
   * 当 VibeSynapse 不可用时，semantic/hybrid 模式自动降级为 literal/BM25。
   */
  searchSectionsAdvanced(query: string, options?: {
    mode?: SearchMode;
    limit?: number;
    minScore?: number;
    /** @internal Phase-54: 跳过 LLM 重排（recallMemory 内部调用时设为 true，避免双重重排） */
    _skipRerank?: boolean;
    /** @internal Phase-201E: 复用上层已生成的 query embedding，避免重复 embed */
    _queryEmbedding?: number[];
  }): ScoredDevPlanDoc[] {
    return searchSectionsAdvancedImpl(this.docStoreBindings, query, options);
  }

  /**
   * 重建所有文档 + 记忆的向量索引
   *
   * Phase-78B: 扩展支持 memory 向量重建。批量导入时 Ollama VRAM 被 LLM 模型占用，
   * 导致 embedding 模型无法加载，所有记忆缺失向量。此方法一次性重建全部向量。
   *
   * 适用于：首次启用语义搜索、模型切换、索引损坏修复、批量导入后向量补全。
   */
  rebuildIndex(): RebuildIndexResult {
    const startTime = Date.now();
    const docs = this.listSections();
    let indexed = 0;
    let failed = 0;
    const failedDocIds: string[] = [];

    if (!this.ensureSynapseReady() || !this.synapse) {
      return {
        total: docs.length,
        indexed: 0,
        failed: docs.length,
        durationMs: Date.now() - startTime,
        failedDocIds: docs.map((d) => d.id),
      };
    }

    // ---- 文档向量重建 ----
    // Phase-78B: 先 removeEntityVector 再 indexEntity，确保替换旧向量
    for (const doc of docs) {
      try {
        const text = `${doc.title}\n${doc.content}`;
        if (typeof this.graph.removeEntityVector === 'function') {
          try { this.graph.removeEntityVector(doc.id); } catch { /* 可能没有旧向量 */ }
        }
        const embedding = this.synapse.embed(text);
        this.graph.indexEntity(doc.id, embedding);
        indexed++;
      } catch (e) {
        failed++;
        failedDocIds.push(doc.id);
      }
    }

    // ---- Phase-78B: 记忆向量重建 ----
    let memIndexed = 0;
    let memFailed = 0;
    const memFailedIds: string[] = [];
    const memories = this.listMemories ? this.listMemories() : [];

    for (const mem of memories) {
      try {
        const content = mem.content || '';
        if (content.trim().length === 0) {
          memFailed++;
          memFailedIds.push(mem.id);
          continue;
        }
        // Phase-78B: 先清除旧向量再重建
        if (typeof this.graph.removeEntityVector === 'function') {
          try { this.graph.removeEntityVector(mem.id); } catch { /* 可能没有旧向量 */ }
        }
        const embedding = this.synapse.embed(content);
        this.graph.indexEntity(mem.id, embedding);
        // 补建记忆间语义关联（如果之前缺失）
        this.autoLinkSimilarMemories(mem.id, embedding);
        memIndexed++;
      } catch (e) {
        memFailed++;
        memFailedIds.push(mem.id);
      }
    }

    this.graph.flush();

    return {
      total: docs.length,
      indexed,
      failed,
      durationMs: Date.now() - startTime,
      failedDocIds: failedDocIds.length > 0 ? failedDocIds : undefined,
      memories: {
        total: memories.length,
        indexed: memIndexed,
        failed: memFailed,
        failedIds: memFailedIds.length > 0 ? memFailedIds : undefined,
      },
    };
  }

  /**
   * 检查语义搜索是否可用
   */
  isSemanticSearchEnabled(): boolean {
    return this.semanticSearchConfigured;
  }

  /**
   * Phase-216: 获取向量搜索完整诊断状态
   */
  getVectorStatus(): VectorSearchStatus {
    let vectorCount = 0;
    let vectorDim = 0;
    try { vectorCount = this.graph.vectorCount?.() ?? 0; } catch { /* may not be available */ }
    try { vectorDim = this.graph.vectorDimension?.() ?? 0; } catch { /* may not be available */ }

    // 统计文档和记忆数量
    const docCount = this.listSections?.().length ?? 0;
    const memCount = this.listMemories?.().length ?? 0;

    const notes: string[] = [];
    if (this.semanticSearchConfigured && vectorCount === 0) {
      notes.push('Vector index is empty. Run devplan_rebuild_index to populate.');
    }
    if (this.semanticSearchConfigured && !this.synapseInitAttempted) {
      notes.push('Semantic search is configured and will initialize lazily on first semantic request.');
    }
    if (!this.semanticSearchConfigured && this.textSearchReady) {
      notes.push('Semantic search disabled; using BM25 text search only.');
    }
    if (!this.semanticSearchConfigured && !this.textSearchReady) {
      notes.push('Both semantic and text search unavailable; using literal matching.');
    }
    if (this.vectorDiag.hasFallback) {
      notes.push(`Fallback engine: ${this.vectorDiag.fallbackInfo}. Dimension-safe if both produce ${vectorDim}d.`);
    }
    if (vectorCount > 0 && vectorCount < (docCount + memCount)) {
      notes.push(`${docCount + memCount - vectorCount} entities missing vectors. Consider devplan_rebuild_index.`);
    }

    return {
      semanticSearchReady: this.semanticSearchReady,
      textSearchReady: this.textSearchReady,
      perceptionModel: this.synapse?.perceptionModel ?? null,
      dimension: vectorDim || (this.synapse?.dimension ?? null),
      hasPerception: this.synapse?.hasPerception ?? false,
      configSource: this.vectorDiag.configSource,
      configValue: this.vectorDiag.configValue,
      hasFallback: this.vectorDiag.hasFallback,
      fallbackInfo: this.vectorDiag.fallbackInfo,
      indexedDocCount: docCount,
      indexedMemoryCount: memCount,
      notes,
    };
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
    if (this.semanticSearchConfigured) {
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
    return createMainTaskImpl(this.taskStoreBindings, input);
  }

  upsertMainTask(input: MainTaskInput, options?: {
    preserveStatus?: boolean;
    status?: TaskStatus;
  }): MainTask {
    return upsertMainTaskImpl(this.taskStoreBindings, input, options);
  }

  getMainTask(taskId: string): MainTask | null {
    return getMainTaskImpl(this.taskStoreBindings, taskId);
  }

  listMainTasks(filter?: {
    status?: TaskStatus;
    priority?: TaskPriority;
    moduleId?: string;
  }): MainTask[] {
    return listMainTasksImpl(this.taskStoreBindings, filter);
  }

  updateMainTaskStatus(taskId: string, status: TaskStatus): MainTask | null {
    return updateMainTaskStatusImpl(this.taskStoreBindings, taskId, status);
  }

  deleteTask(taskId: string, taskType?: 'main' | 'sub'): DeleteTaskResult {
    return deleteTaskImpl(this.taskStoreBindings, taskId, taskType);
  }

  // ==========================================================================
  // Sub Task Operations
  // ==========================================================================

  addSubTask(input: SubTaskInput): SubTask {
    return addSubTaskImpl(this.taskStoreBindings, input);
  }

  upsertSubTask(input: SubTaskInput, options?: {
    preserveStatus?: boolean;
    status?: TaskStatus;
  }): SubTask {
    return upsertSubTaskImpl(this.taskStoreBindings, input, options);
  }

  getSubTask(taskId: string): SubTask | null {
    return getSubTaskImpl(this.taskStoreBindings, taskId);
  }

  listSubTasks(parentTaskId: string, filter?: {
    status?: TaskStatus;
  }): SubTask[] {
    return listSubTasksImpl(this.taskStoreBindings, parentTaskId, filter);
  }

  updateSubTaskStatus(taskId: string, status: TaskStatus, options?: {
    completedAtCommit?: string;
    revertReason?: string;
  }): SubTask | null {
    return updateSubTaskStatusImpl(this.taskStoreBindings, taskId, status, options);
  }

  updateTaskStatus(taskId: string, taskType: 'main' | 'sub', status: TaskStatus): import('./types').UpdateTaskStatusResult {
    return updateTaskStatusImpl(this.taskStoreBindings, taskId, taskType, status);
  }

  // ==========================================================================
  // Completion Workflow
  // ==========================================================================

  completeSubTask(taskId: string): CompleteSubTaskResult {
    return completeSubTaskImpl(this.taskStoreBindings, taskId);
  }

  completeMainTask(taskId: string): MainTask {
    return completeMainTaskImpl(this.taskStoreBindings, taskId);
  }

  // ==========================================================================
  // Progress & Export
  // ==========================================================================

  getProgress(): ProjectProgress {
    return getProgressImpl(this.taskStoreBindings);
  }

  exportToMarkdown(): string {
    return exportToMarkdownImpl(this.visualizeStoreBindings);
  }

  exportTaskSummary(): string {
    return exportTaskSummaryImpl(this.visualizeStoreBindings);
  }

  // ==========================================================================
  // Module Operations
  // ==========================================================================

  createModule(input: ModuleInput): Module {
    return createModuleImpl(this.moduleStoreBindings, input);
  }

  getModule(moduleId: string): Module | null {
    return getModuleImpl(this.moduleStoreBindings, moduleId);
  }

  listModules(filter?: { status?: ModuleStatus }): Module[] {
    return listModulesImpl(this.moduleStoreBindings, filter);
  }

  updateModule(moduleId: string, updates: {
    name?: string;
    description?: string;
    status?: ModuleStatus;
  }): Module | null {
    return updateModuleImpl(this.moduleStoreBindings, moduleId, updates);
  }

  deleteModule(moduleId: string): boolean {
    return deleteModuleImpl(this.moduleStoreBindings, moduleId);
  }

  getModuleDetail(moduleId: string): ModuleDetail | null {
    return getModuleDetailImpl(this.moduleStoreBindings, moduleId);
  }

  // ==========================================================================
  // Document-Task Relationship Queries
  // ==========================================================================

  /**
   * 获取主任务关联的文档列表（通过 TASK_HAS_DOC 出向关系）
   */
  getTaskRelatedDocs(taskId: string): DevPlanDoc[] {
    return getTaskRelatedDocsImpl(this.docStoreBindings, taskId);
  }

  /**
   * 获取文档关联的主任务列表（通过 TASK_HAS_DOC 入向关系）
   */
  getDocRelatedTasks(section: DevPlanSection, subSection?: string): MainTask[] {
    return getDocRelatedTasksImpl(this.docStoreBindings, section, subSection);
  }

  // ==========================================================================
  // Document Hierarchy (文档层级关系)
  // ==========================================================================

  /**
   * 获取文档的直接子文档列表（通过 DOC_HAS_CHILD 出向关系）
   */
  getChildDocs(section: DevPlanSection, subSection?: string): DevPlanDoc[] {
    return getChildDocsImpl(this.docStoreBindings, section, subSection);
  }

  /**
   * 获取文档树（递归，含所有后代文档）
   */
  getDocTree(section: DevPlanSection, subSection?: string): DevPlanDocTree | null {
    return getDocTreeImpl(this.docStoreBindings, section, subSection);
  }

  /**
   * 递归构建文档树
   */
  private buildDocTree(doc: DevPlanDoc): DevPlanDocTree {
    return buildDocTreeImpl(this.docStoreBindings, doc);
  }

  // ==========================================================================
  // Prompt Operations (用户 Prompt 日志)
  // ==========================================================================

  /**
   * 保存一条 Prompt
   *
   * 自动分配 promptIndex (当天内自增序号)。
   * 如果指定了 relatedTaskId，自动建立 task_has_prompt 关系。
   */
  savePrompt(input: PromptInput): Prompt {
    return savePromptImpl(this.promptStoreBindings, input);
  }

  /**
   * 列出 Prompt（支持按日期、关联任务过滤）
   */
  listPrompts(filter?: {
    date?: string;
    relatedTaskId?: string;
    limit?: number;
  }): Prompt[] {
    return listPromptsImpl(this.promptStoreBindings, filter);
  }

  /**
   * 获取主任务关联的所有 Prompt
   */
  getTaskRelatedPrompts(taskId: string): Prompt[] {
    return getTaskRelatedPromptsImpl(this.promptStoreBindings, taskId);
  }

  /**
   * Entity → Prompt 转换
   */
  private entityToPrompt(e: Entity): Prompt {
    return entityToPromptImpl(this.promptStoreBindings, e);
  }

  // ==========================================================================
  // Memory Operations (Cursor 长期记忆)
  // ==========================================================================

  /**
   * 保存一条记忆
   *
   * - 记忆存储为 devplan-memory 实体
   * - 如启用语义搜索，自动 embed content 并索引到 HNSW
   * - 关联 project → memory 和可选的 memory → task 关系
   */
  saveMemory(input: MemoryInput): Memory {
    return saveMemoryImpl(this.memoryWriteStoreBindings, input);
  }

  /**
   * Phase-37→44: 自动建立记忆间语义关联
   *
   * 用向量搜索找到最相似的 N 条已有记忆（minScore >= 0.7），
   * 建立 MEMORY_RELATES 双向关系，权重为 similarity score。
   *
   * Phase-44: 使用 applyMutations 批量创建关系（单次 Rust 调用），
   * 替代逐条 putRelation 的多次跨层调用。
   */
  private autoLinkSimilarMemories(
    newMemoryId: string,
    embedding: number[],
    maxLinks: number = 3,
    minScore: number = 0.7,
  ): void {
    autoLinkSimilarMemoriesImpl(this.memoryWriteStoreBindings, newMemoryId, embedding, maxLinks, minScore);
  }

  /**
   * Phase-37: 从文档生成的记忆自动建立 MEMORY_FROM_DOC 关系
   *
   * 当 sourceRef.sourceId 格式为 "section" 或 "section|subSection" 时，
   * 找到对应的文档 Entity 并建立 MEMORY_FROM_DOC 关系。
   */
  private autoLinkMemoryToDoc(memoryId: string, sourceKey: string): void {
    autoLinkMemoryToDocImpl(this.memoryWriteStoreBindings, memoryId, sourceKey);
  }

  /**
   * Phase-37: 模块级记忆自动建立 MODULE_MEMORY 关系
   */
  private autoLinkMemoryToModule(memoryId: string, moduleId: string): void {
    autoLinkMemoryToModuleImpl(this.memoryWriteStoreBindings, memoryId, moduleId);
  }

  // ==========================================================================
  // Phase-57: 三维记忆集成 — Anchor / Flow / Structure
  // ==========================================================================

  /**
   * Phase-57: 集成触点(Anchor) + 记忆流(Flow) + 结构链(Structure)
   *
   * 在 saveMemory 时自动执行：
   * 1. 从 content 中提取或使用显式指定的触点名称
   * 2. upsert Anchor（去重，不会创建重复触点）
   * 3. 追加 FlowEntry 到 Anchor 的记忆流
   * 4. 如有组件信息则创建 StructureSnapshot
   * 5. 建立 memory → anchor 的 ANCHORED_BY 关系
   *
   * 所有操作都是优雅降级的 — 如果 NAPI 方法不可用，静默跳过。
   */
  private integrateAnchorFlowStructure(
    input: MemoryInput,
    memoryEntityId: string,
  ): {
    anchorInfo?: Memory['anchorInfo'];
    flowEntry?: Memory['flowEntry'];
    structureSnapshotId?: string;
  } | null {
    return integrateAnchorFlowStructureImpl(this.anchorFlowStructureBindings, input, memoryEntityId);
  }

  /**
   * Phase-57: 查询指定触点的记忆流历史
   */
  queryAnchorFlow(anchorName: string, anchorType?: string, filter?: NativeFlowFilter): NativeFlowEntry[] {
    return queryAnchorFlowImpl(this.anchorFlowStructureBindings, anchorName, anchorType, filter);
  }

  /**
   * Phase-57: 列出项目中的所有触点
   */
  listAnchors(anchorTypeFilter?: string): NativeAnchorInfo[] {
    return listAnchorsImpl(this.anchorFlowStructureBindings, anchorTypeFilter);
  }

  /**
   * Phase-57: 获取触点的当前结构
   */
  getAnchorStructure(anchorId: string): NativeStructureSnapshot | null {
    return getAnchorStructureImpl(this.anchorFlowStructureBindings, anchorId);
  }

  /**
   * Phase-57: 计算两个版本之间的结构差异
   */
  getStructureDiff(anchorId: string, fromVersion: number, toVersion: number): NativeStructureDiff | null {
    return getStructureDiffImpl(this.anchorFlowStructureBindings, anchorId, fromVersion, toVersion);
  }

  /**
   * Phase-57: 为召回的记忆结果附加三维信息（Anchor / Flow / Structure）
   *
   * 层级下钻逻辑：
   * - L1 (触点): 通过 anchored_by 关系找到关联的 Anchor，附加 anchorInfo
   * - L2 (记忆流): 查询 Anchor 的最近 5 条 FlowEntry，附加 flowEntries
   * - L3 (结构): 查询 Anchor 的当前 StructureSnapshot，附加 structureSnapshot
   *
   * 仅处理 sourceKind='memory' 的结果（文档类型不需要下钻）。
   * 所有操作都是优雅降级的 — NAPI 不可用时静默跳过。
   */
  /**
   * Phase-57→124: 三维记忆层级下钻 — 为记忆附加 Anchor/Flow/Structure 信息
   *
   * Phase-124 增强: 支持 depth 参数控制信息层级，避免不必要的 Token 消耗。
   *
   * @param results - 待增强的记忆召回结果
   * @param depth - 信息层级: L1(摘要) / L2(详情) / L3(完整)，默认 L1
   */
  private enrichMemoriesWithAnchorInfo(results: ScoredMemory[], depth: RecallDepth = 'L1'): void {
    enrichMemoriesWithAnchorInfoImpl(this.anchorFlowStructureBindings, results, depth);
  }

  /**
   * Phase-124: 范围限定过滤（Scope-based Filtering）
   *
   * 根据 scope 条件过滤记忆列表。支持四种过滤维度：
   * - moduleId: 通过 MODULE_MEMORY 关系匹配
   * - taskId: 通过 relatedTaskId 属性匹配
   * - anchorType: 通过 anchored_by 关系 + Anchor.anchor_type 匹配
   * - anchorName: 通过 anchored_by 关系 + Anchor.name 匹配
   *
   * 多个条件为 AND 关系。
   *
   * @param memories - 待过滤的记忆列表
   * @param scope - 范围限定条件
   * @returns 过滤后的记忆列表
   */
  private filterMemoriesByScope(memories: ScoredMemory[], scope: RecallScope): ScoredMemory[] {
    if (!scope.moduleId && !scope.taskId && !scope.anchorType && !scope.anchorName) {
      return memories; // 无 scope 条件，原样返回
    }

    const g = this.graph as any;

    // ---- 预计算模块关联的记忆 ID 集合（避免逐条查询） ----
    let moduleMemoryIds: Set<string> | null = null;
    if (scope.moduleId) {
      moduleMemoryIds = new Set<string>();
      const modEntity = this.findEntityByProp(ET.MODULE, 'moduleId', scope.moduleId);
      if (modEntity) {
        try {
          // MODULE_MEMORY 关系: module → memory
          const rels = this.graph.outgoingByType(modEntity.id, RT.MODULE_MEMORY) as Relation[];
          for (const rel of rels || []) {
            moduleMemoryIds.add(rel.target);
          }
        } catch {
          // 关系查询失败，保持空集合（会过滤掉所有结果）
        }
      }
      // 如果模块不存在或无关联记忆，moduleMemoryIds 为空集 → 所有记忆都被过滤
    }

    return memories.filter(mem => {
      // 仅对 memory 类型应用 scope 过滤，doc 类型不受影响
      if (mem.sourceKind === 'doc') return true;

      // 1. moduleId 过滤
      if (moduleMemoryIds !== null && !moduleMemoryIds.has(mem.id)) {
        return false;
      }

      // 2. taskId 过滤（直接检查属性）
      if (scope.taskId && mem.relatedTaskId !== scope.taskId) {
        return false;
      }

      // 3. anchorType / anchorName 过滤（需要查询 anchored_by 关系）
      if (scope.anchorType || scope.anchorName) {
        try {
          const outgoing = this.graph.outgoingByType(mem.id, 'anchored_by') as Relation[];
          if (!outgoing || outgoing.length === 0) return false;

          const anchorId = outgoing[0].target;

          if (typeof g.anchorGetById === 'function') {
            const anchor: NativeAnchorInfo | null = g.anchorGetById(anchorId);
            if (!anchor) return false;

            if (scope.anchorType && anchor.anchor_type !== scope.anchorType) return false;
            if (scope.anchorName && anchor.name !== scope.anchorName) return false;
          } else {
            // NAPI 不可用时，尝试从 Entity 属性中获取
            const anchorEntity = this.graph.getEntity(anchorId);
            if (!anchorEntity) return false;
            const ap = anchorEntity.properties as any;
            if (scope.anchorType && ap.anchor_type !== scope.anchorType) return false;
            if (scope.anchorName && ap.name !== scope.anchorName) return false;
          }
        } catch {
          return false; // 查询失败视为不匹配
        }
      }

      return true;
    });
  }

  // ============================================================================
  // Phase-125: Memory-Guided Document Retrieval（记忆驱动文档检索）
  // ============================================================================

  /**
   * Phase-125: 基于记忆的图遍历查找关联文档
   *
   * 三条图遍历路径：
   * 1. memory ──MEMORY_FROM_DOC──→ doc         （记忆的来源文档）
   * 2. memory.relatedTaskId → task ──TASK_HAS_DOC──→ doc （任务关联文档）
   * 3. memory ←─MODULE_MEMORY─── module ──MODULE_HAS_DOC──→ doc （模块关联文档）
   *
   * 每篇发现的文档附带 guidedReasons 说明选取理由。
   * 如果同一文档被多条路径命中，累计得分更高。
   *
   * @param memories - 已召回的记忆列表（作为图遍历的种子）
   * @param maxDocs  - 最多返回的文档数（默认 5）
   * @returns 按累计得分排序的文档列表（ScoredMemory 格式，sourceKind='doc'）
   */
  private findGuidedDocuments(memories: ScoredMemory[], maxDocs: number = 5): ScoredMemory[] {
    // 只处理真正的记忆（跳过 doc 类型）
    const realMemories = memories.filter(m => m.sourceKind === 'memory' || !m.sourceKind);
    if (realMemories.length === 0) return [];

    // docEntityId → { score, reasons, entity }
    const docMap = new Map<string, { score: number; reasons: string[]; entity: any }>();

    const addDoc = (docEntityId: string, score: number, reason: string) => {
      const existing = docMap.get(docEntityId);
      if (existing) {
        existing.score += score;
        if (!existing.reasons.includes(reason)) {
          existing.reasons.push(reason);
        }
      } else {
        const entity = this.graph.getEntity(docEntityId);
        if (entity && (entity.entity_type === ET.DOC)) {
          docMap.set(docEntityId, { score, reasons: [reason], entity });
        }
      }
    };

    for (const mem of realMemories) {
      const memLabel = (mem.content || '').substring(0, 30).replace(/\n/g, ' ');

      // ---- 路径 1: MEMORY_FROM_DOC → 直接来源文档（权重最高）----
      try {
        const fromDocRels = this.getOutRelations(mem.id, RT.MEMORY_FROM_DOC);
        for (const rel of fromDocRels) {
          addDoc(rel.target, 1.0, `记忆「${memLabel}…」的来源文档`);
        }
      } catch { /* 关系查询失败，继续 */ }

      // ---- 路径 2: relatedTaskId → task ──TASK_HAS_DOC──→ doc ----
      if (mem.relatedTaskId) {
        try {
          const taskEntity = this.findEntityByProp(ET.MAIN_TASK, 'taskId', mem.relatedTaskId);
          if (taskEntity) {
            const taskDocRels = this.getOutRelations(taskEntity.id, RT.TASK_HAS_DOC);
            for (const rel of taskDocRels) {
              addDoc(rel.target, 0.8, `与任务 ${mem.relatedTaskId} 关联`);
            }
          }
        } catch { /* 继续 */ }
      }

      // ---- 路径 3: MODULE_MEMORY(反向) → module ──MODULE_HAS_DOC──→ doc ----
      try {
        const moduleRels = this.getInRelations(mem.id, RT.MODULE_MEMORY);
        for (const modRel of moduleRels) {
          const modEntity = this.graph.getEntity(modRel.source);
          if (!modEntity) continue;
          const modProps = modEntity.properties as any;
          const modLabel = modProps?.moduleId || modProps?.name || modRel.source;

          const modDocRels = this.getOutRelations(modRel.source, RT.MODULE_HAS_DOC);
          for (const rel of modDocRels) {
            addDoc(rel.target, 0.6, `同属模块「${modLabel}」`);
          }
        }
      } catch { /* 继续 */ }
    }

    if (docMap.size === 0) return [];

    // 按累计得分排序，取 top N
    const sorted = Array.from(docMap.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, maxDocs);

    // 转换为 ScoredMemory 格式（与现有统一召回输出兼容）
    const results: ScoredMemory[] = [];
    for (const [docEntityId, { score, reasons, entity }] of sorted) {
      const p = entity.properties as any;
      const section = p.section || '';
      const subSection = p.subSection || undefined;
      const contentSnippet = (p.content || '').substring(0, 300);

      results.push({
        id: `doc:${section}${subSection ? '|' + subSection : ''}`,
        projectName: this.projectName,
        memoryType: docSectionToMemoryTypeUtil(section),
        content: contentSnippet + (p.content && p.content.length > 300 ? '...' : ''),
        tags: [section, ...(subSection ? [subSection] : [])],
        relatedTaskId: undefined,
        importance: 0.6,
        hitCount: 0,
        lastAccessedAt: null,
        createdAt: p.updatedAt || 0,
        updatedAt: p.updatedAt || 0,
        score: Math.min(score, 1.0), // 归一化到 0~1
        sourceKind: 'doc',
        docSection: section,
        docSubSection: subSection,
        docTitle: p.title || '',
        guidedReasons: reasons,
      });
    }

    return results;
  }

  /**
   * Phase-51: 冲突检测 — 检测新记忆与已有记忆的语义矛盾
   *
   * 在 TypeScript 层实现 devplan-memory 实体级别的冲突检测。
   * 使用向量搜索找到高度相似的已有记忆，根据 memoryType 分类冲突：
   *
   * 冲突分类逻辑:
   * - decision vs decision (similarity ≥ 0.85) → "Conflicts"：决策冲突，自动建立 MEMORY_CONFLICTS 关系
   * - 同 memoryType (similarity ≥ 0.90) → "Supersedes"：内容替代，自动建立 MEMORY_SUPERSEDES 关系
   * - 同 memoryType (similarity ≥ 0.80) → "HighSimilarity"：高相似度警告，仅报告不建立关系
   *
   * 设计原则：不删除旧记忆，只通过关系标记演化链条。
   *
   * 注意：此方法不依赖 Rust 层 memoryTreeDetectConflicts（那只处理 FACT/DECISION 子实体）。
   * 分解子图的冲突检测由 decomposeAndStoreMemoryTree → memoryTreeStore 内部处理。
   *
   * @param newEntity - 刚创建的记忆实体
   * @param embedding - 新记忆的向量嵌入
   * @returns 冲突列表，或 undefined 如果检测失败或无冲突
   */
  private detectMemoryConflicts(
    newEntity: Entity,
    embedding: number[],
  ): Memory['conflicts'] | undefined {
    try {
      if (!this.semanticSearchConfigured) return undefined;

      const newProps = newEntity.properties as any;
      const newMemoryType: string = newProps?.memoryType || '';

      // 向量搜索：找到最相似的 devplan-memory 实体（top-6，多取 1 个用于排除自身）
      const hits = this.graph.searchEntitiesByVector(embedding, 6, ET.MEMORY);
      if (!hits || hits.length === 0) return undefined;

      const conflicts: NonNullable<Memory['conflicts']> = [];
      const SUPERSEDES_THRESHOLD = 0.90;
      const CONFLICTS_THRESHOLD = 0.85;
      const HIGH_SIM_THRESHOLD = 0.80;

      for (const hit of hits) {
        // 排除自身
        if (hit.entityId === newEntity.id) continue;
        // 最多检测 5 个候选
        if (conflicts.length >= 5) break;

        const existing = this.graph.getEntity(hit.entityId);
        if (!existing) continue;
        const existProps = existing.properties as any;
        // 只比较同一项目的记忆
        if (existProps.projectName !== this.projectName) continue;

        const existMemoryType: string = existProps?.memoryType || '';
        const similarity = hit.score;

        // ---- 冲突分类 ----
        let conflictType: string | null = null;
        let shouldCreateRelation = false;

        if (newMemoryType === 'decision' && existMemoryType === 'decision' && similarity >= CONFLICTS_THRESHOLD) {
          // 决策 vs 决策 → 冲突（可能矛盾）
          conflictType = 'Conflicts';
          shouldCreateRelation = true;
        } else if (newMemoryType === existMemoryType && similarity >= SUPERSEDES_THRESHOLD) {
          // 同类型 + 极高相似度 → 替代
          conflictType = 'Supersedes';
          shouldCreateRelation = true;
        } else if (newMemoryType === existMemoryType && similarity >= HIGH_SIM_THRESHOLD) {
          // 同类型 + 高相似度 → 仅警告
          conflictType = 'HighSimilarity';
          shouldCreateRelation = false;
        }

        if (!conflictType) continue;

        // ---- 建立关系（如需） ----
        let relationCreated: string | undefined;
        if (shouldCreateRelation) {
          if (conflictType === 'Supersedes') {
            // new → old (MEMORY_SUPERSEDES)
            this.graph.putRelation(newEntity.id, existing.id, RT.MEMORY_SUPERSEDES, similarity, false);
            relationCreated = RT.MEMORY_SUPERSEDES;
          } else if (conflictType === 'Conflicts') {
            // new → old (MEMORY_CONFLICTS)
            this.graph.putRelation(newEntity.id, existing.id, RT.MEMORY_CONFLICTS, similarity, false);
            relationCreated = RT.MEMORY_CONFLICTS;
          }
        }

        conflicts.push({
          existingEntityId: existing.id,
          similarity,
          conflictType,
          relationCreated,
        });
      }

      if (conflicts.length === 0) return undefined;

      return conflicts;
    } catch (e) {
      // 冲突检测失败不应阻止记忆保存
      console.warn(`[DevPlan] detectMemoryConflicts failed: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  }

  /**
   * Phase-47: 记忆分解器 — 将记忆内容分解为 Episode + Entities + Relations 子图
   *
   * 调用 Rust 层 memoryTreeDecompose（rule-based）或 memoryTreeParseLlmDecomposition（LLM），
   * 然后通过 memoryTreeStore 将分解后的子图一次性写入图引擎。
   *
   * 分解后的子图通过 CONTAINS 关系连接到原始记忆实体，
   * 实现"记忆树"结构：Memory → Episode → [Fact, Concept, Decision, Actor...]
   *
   * @param memoryEntityId - 已创建的记忆实体 ID（作为子图的锚点）
   * @param content - 记忆内容文本
   * @param mode - 分解模式: 'rule' | 'llm'
   * @param context - 可选的分解上下文
   * @param llmJson - 可选的 LLM 分解 JSON（仅 mode='llm' 时使用）
   * @returns 分解结果摘要，或 undefined 如果分解失败
   */
  private decomposeAndStoreMemoryTree(
    memoryEntityId: string,
    content: string,
    mode: 'rule' | 'llm',
    context?: string,
    llmJson?: string,
  ): Memory['decomposition'] | undefined {
    try {
      // Step 1: 分解文本
      let decomposition: DecompositionResult;

      if (mode === 'llm' && llmJson) {
        // LLM 模式: 解析外部 LLM 生成的 JSON
        decomposition = this.graph.memoryTreeParseLlmDecomposition(
          llmJson,
          this.projectName, // userId = projectName
          context,
          content,          // sourceText = original content
        );
      } else {
        // Rule-based 模式: 使用 TypeScript 安全分解器（替代 Rust 层）
        // 原因: Rust RuleBasedDecomposer 中 &text[..100] 按字节截断，
        //        对中文等多字节 UTF-8 文本会导致 panic → 进程崩溃。
        //        TypeScript 原生支持 Unicode，不存在此问题。
        decomposition = this.ruleBasedDecomposeTS(content, context);
      }

      // 分解结果校验 — 至少需要 episode + 1 个实体才值得存储
      if (!decomposition || !decomposition.episode || decomposition.entities.length === 0) {
        return undefined;
      }

      // Step 2: 为分解出的实体生成向量嵌入
      // 优化: 使用 embedBatch 批量生成向量，将 N+1 次同步 NAPI 调用合并为 1 次
      // 典型 3 句记忆: 6 次 embed(~3s) → 1 次 embedBatch(~0.8s)
      const embeddings: MemoryTreeEmbeddingInput[] = [];
      if (this.ensureSynapseReady() && this.synapse) {
        try {
          // 收集所有需要 embed 的文本和对应的实体 ID
          const textsToEmbed: string[] = [];
          const entityIds: string[] = [];

          // Episode 文本
          textsToEmbed.push(decomposition.episode.content || content);
          entityIds.push(decomposition.episode.id);

          // 子实体文本
          for (const ent of decomposition.entities) {
            const text = ent.content || ent.name || '';
            if (text) {
              textsToEmbed.push(text);
              entityIds.push(ent.id);
            }
          }

          // 一次性批量 embed
          const batchEmbeddings = this.synapse.embedBatch(textsToEmbed);

          // 映射回实体
          for (let i = 0; i < batchEmbeddings.length; i++) {
            if (batchEmbeddings[i] && batchEmbeddings[i].length > 0) {
              embeddings.push({ entityId: entityIds[i], embedding: batchEmbeddings[i] });
            }
          }
        } catch (e) {
          // embedBatch 失败时回退到逐条 embed（兼容旧版 native 模块）
          console.warn(`[DevPlan] embedBatch failed, falling back to individual embed: ${
            e instanceof Error ? e.message : String(e)
          }`);
        try {
          const epEmb = this.synapse.embed(decomposition.episode.content || content);
          embeddings.push({ entityId: decomposition.episode.id, embedding: epEmb });
        } catch { /* skip */ }
        for (const ent of decomposition.entities) {
          try {
            const entEmb = this.synapse.embed(ent.content || ent.name || '');
            embeddings.push({ entityId: ent.id, embedding: entEmb });
            } catch { /* skip */ }
          }
        }
      }

      // Step 3: 一次性存储子图（Rust 层处理实体+关系+向量+冲突检测）
      const storeResult = this.graph.memoryTreeStore(
        decomposition,
        embeddings,
      );

      // Step 4: 建立原始记忆实体 → Episode 的关联
      // 让传统的记忆查询仍能通过图遍历发现分解出的子图
      if (storeResult && storeResult.episode_id) {
        this.graph.putRelation(
          memoryEntityId,
          storeResult.episode_id,
          'memory_has_episode', // 自定义关系类型
          1.0,
          false,               // 非双向
        );
      }

      const summary: NonNullable<Memory['decomposition']> = {
        episodeId: storeResult.episode_id,
        entitiesStored: storeResult.entities_stored,
        relationsStored: storeResult.relations_stored,
        vectorsIndexed: storeResult.vectors_indexed,
        conflictsDetected: storeResult.conflicts_detected,
      };

      // Step 5: 将分解统计持久化到原始记忆实体 properties
      // 这样 entityToMemory 查询时能直接恢复 decomposition 字段
      try {
        const memEntity = this.graph.getEntity(memoryEntityId);
        if (memEntity) {
          const props = { ...(memEntity.properties as Record<string, unknown>) };
          props._decomp_episodeId = summary.episodeId;
          props._decomp_entitiesStored = summary.entitiesStored;
          props._decomp_relationsStored = summary.relationsStored;
          props._decomp_vectorsIndexed = summary.vectorsIndexed;
          props._decomp_conflictsDetected = summary.conflictsDetected;
          this.graph.updateEntity(memoryEntityId, { properties: props });
        }
      } catch {
        // 非致命 — 统计丢失不影响核心功能
      }

      return summary;
    } catch (e) {
      console.warn(
        `[DevPlan] decomposeAndStoreMemoryTree failed (mode=${mode}): ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      return undefined;
    }
  }

  // ==========================================================================
  // TypeScript Rule-Based Decomposer (UTF-8 安全版)
  // ==========================================================================

  /**
   * TypeScript 层规则分解器 — 替代 Rust 层 RuleBasedDecomposer
   *
   * 产生与 Rust 版本完全相同格式的 DecompositionResult：
   * - Episode 根实体（内容截断到前 100 字符，UTF-8 安全）
   * - 按句子拆分为 FACT 子实体
   * - CONTAINS 关系（Episode → Fact）
   * - RELATES 关系（顺序 Fact 间）
   *
   * 替代原因: Rust RuleBasedDecomposer 中 `&text[..100]` 按字节截断，
   * 对中文/日文等多字节 UTF-8 文本会导致 byte boundary panic → Node.js 进程崩溃。
   * TypeScript 的 string.slice() 天然按字符操作，不存在此问题。
   */
  private ruleBasedDecomposeTS(
    text: string,
    context?: string,
  ): DecompositionResult {
    const now = Date.now();
    const rand = ((now & 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
    const episodeId = `ep-${rand}`;
    const ctx = context || 'unknown';

    // Episode 根实体 — UTF-8 安全截断（按字符，非字节）
    const episodeContent = text.length > 100
      ? `${text.slice(0, 100)}...`
      : text;

    const episode = {
      id: episodeId,
      entity_type: 'mem:episode',
      content: episodeContent,
      name: undefined as string | undefined,
      confidence: 1.0,
      properties: {
        timestamp: now,
        context: ctx,
        user_id: this.projectName,
      } as Record<string, unknown>,
    };

    const entities: Array<{
      id: string;
      entity_type: string;
      content: string;
      name?: string;
      confidence: number;
      properties: Record<string, unknown>;
    }> = [];

    const relations: Array<{
      id: string;
      source: string;
      target: string;
      relation_type: string;
      weight: number;
      metadata: Record<string, unknown>;
    }> = [];

    // 按句子分割（与 Rust 版本一致的分隔符）
    const sentences = text
      .split(/[.。！？\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 5);

    for (let i = 0; i < sentences.length; i++) {
      const factId = `${episodeId}-fact-${i + 1}`;

      entities.push({
        id: factId,
        entity_type: 'mem:fact',
        content: sentences[i],
        confidence: 0.7,
        properties: {},
      });

      // Episode -[CONTAINS]-> Fact
      relations.push({
        id: `rel-${episodeId}-${i + 1}`,
        source: episodeId,
        target: factId,
        relation_type: 'mem:CONTAINS',
        weight: 1.0,
        metadata: {},
      });

      // 相邻 Fact 间 -[RELATES]-> 顺序关系
      if (i > 0) {
        const prevFactId = `${episodeId}-fact-${i}`;
        relations.push({
          id: `rel-seq-${episodeId}-${i}`,
          source: prevFactId,
          target: factId,
          relation_type: 'mem:RELATES',
          weight: 0.5,
          metadata: { sequence: true },
        });
      }
    }

    // 无法拆分时，整段作为单条 Fact
    if (entities.length === 0) {
      const factId = `${episodeId}-fact-1`;
      entities.push({
        id: factId,
        entity_type: 'mem:fact',
        content: text,
        confidence: 0.5,
        properties: {},
      });
      relations.push({
        id: `rel-${episodeId}-1`,
        source: episodeId,
        target: factId,
        relation_type: 'mem:CONTAINS',
        weight: 1.0,
        metadata: {},
      });
    }

    return {
      episode,
      entities,
      relations,
      source_text: text,
    } as DecompositionResult;
  }

  /**
   * 查找重复记忆 — 按 relatedTaskId + memoryType 或内容指纹去重
   *
   * 匹配规则（任一命中即视为重复）：
   * 1. 相同 relatedTaskId + 相同 memoryType
   * 2. 内容前 80 字符指纹相同 + 相同 memoryType
   */
  private findDuplicateMemory(input: MemoryInput): Entity | null {
    return findDuplicateMemoryImpl(this.memoryWriteStoreBindings, input);
  }

  /**
   * Unified Recall（Phase-79）— 对齐 ai_db phase132~136 的统一召回入口
   *
   * 统一接收 URI/depth/scope/docStrategy/recursive 等参数，并输出可观测指标。
   */
  recallUnified(query: string, options?: UnifiedRecallOptions): ScoredMemory[] {
    return recallUnifiedImpl(this.recallStoreBindings, query, options);
  }

  recallUnifiedViaAdapter(query: string, options?: UnifiedRecallOptions): ScoredMemory[] {
    return recallUnifiedViaAdapterImpl(this.recallStoreBindings, query, options);
  }

  private applyDeterministicRecallFilter(
    results: ScoredMemory[],
    options: UnifiedRecallOptions,
  ): ScoredMemory[] {
    return applyDeterministicRecallFilterImpl(this.recallStoreBindings, results, options);
  }

  private getGatewayOutboxEntriesLegacy(): any[] {
    if (!this.llmGateway || typeof this.llmGateway.getOutboxEntries !== 'function') {
      return [];
    }
    try {
      return this.llmGateway.getOutboxEntries();
    } catch {
      return [];
    }
  }

  getGatewayOutboxEntries(): any[] {
    if (!this.memoryGatewayAdapter) {
      return this.getGatewayOutboxEntriesLegacy();
    }
    return this.memoryGatewayAdapter.getOutboxEntries(() => this.getGatewayOutboxEntriesLegacy());
  }

  getGatewayOutboxEntriesViaAdapter(): any[] {
    return this.getGatewayOutboxEntries();
  }

  private async retryGatewayOutboxEntryLegacy(entryId: string, forceReady: boolean = true): Promise<any> {
    if (!this.llmGateway || typeof this.llmGateway.retryOutboxEntry !== 'function') {
      throw new Error('LlmGateway.retryOutboxEntry unavailable. Please upgrade aifastdb package.');
    }
    return this.llmGateway.retryOutboxEntry(entryId, forceReady);
  }

  async retryGatewayOutboxEntry(entryId: string, forceReady: boolean = true): Promise<any> {
    if (!this.memoryGatewayAdapter) {
      return this.retryGatewayOutboxEntryLegacy(entryId, forceReady);
    }
    return this.memoryGatewayAdapter.retryOutboxEntry(
      entryId,
      forceReady,
      (id, ready) => this.retryGatewayOutboxEntryLegacy(id, ready),
    );
  }

  async retryGatewayOutboxEntryViaAdapter(entryId: string, forceReady: boolean = true): Promise<any> {
    return this.retryGatewayOutboxEntry(entryId, forceReady);
  }

  async gatewayMemorizeWithCursorProfile(params: {
    conversationId: string;
    userId: string;
    userContent: string;
    assistantContent: string;
    scope?: string;
    roleId?: string;
    profile?: string;
    contentSessionId?: string;
    memorySessionId?: string;
    hookPhase?: string;
    hookName?: string;
  }): Promise<{ stored: boolean; scoped: boolean }> {
    if (!this.llmGateway) {
      throw new Error('LlmGateway unavailable. Please enable reranking/gateway initialization first.');
    }
    const binding = {
      profile: params.profile,
      contentSessionId: params.contentSessionId,
      memorySessionId: params.memorySessionId,
      hookPhase: params.hookPhase,
      hookName: params.hookName,
    };
    const useScoped = Boolean(params.scope || params.roleId);
    if (useScoped) {
      if (typeof this.llmGateway.memorizeScopedWithCursorProfile !== 'function') {
        throw new Error('LlmGateway.memorizeScopedWithCursorProfile unavailable. Please upgrade aifastdb package.');
      }
      await this.llmGateway.memorizeScopedWithCursorProfile(
        params.conversationId,
        params.userId,
        params.userContent,
        params.assistantContent,
        {
          scope: params.scope,
          roleId: params.roleId,
        },
        binding,
      );
      return { stored: true, scoped: true };
    }
    if (typeof this.llmGateway.memorizeWithCursorProfile !== 'function') {
      throw new Error('LlmGateway.memorizeWithCursorProfile unavailable. Please upgrade aifastdb package.');
    }
    await this.llmGateway.memorizeWithCursorProfile(
      params.conversationId,
      params.userId,
      params.userContent,
      params.assistantContent,
      binding,
    );
    return { stored: true, scoped: false };
  }

  getMemoryGatewayTelemetry(): MemoryGatewayTelemetry | null {
    if (!this.memoryGatewayAdapter) return null;
    return this.memoryGatewayAdapter.getTelemetry();
  }

  /**
   * DEPRECATED: 请使用 recallUnified()
   */
  recallMemory(query: string, options?: {
    memoryType?: MemoryType;
    limit?: number;
    minScore?: number;
    includeDocs?: boolean;
    graphExpand?: boolean;
    useActivation?: boolean;
    depth?: RecallDepth;
    scope?: RecallScope;
    docStrategy?: DocStrategy;
  }): ScoredMemory[] {
    return recallMemoryImpl(this.recallStoreBindings, query, options);
  }

  /** Phase-79: 获取 Unified Recall feature flags */
  getFeatureFlags(): RecallFeatureFlags {
    return getFeatureFlagsImpl(this.recallStoreBindings);
  }

  /** Phase-79: 更新 Unified Recall feature flags */
  setFeatureFlags(patch: RecallFeatureFlagsPatch): RecallFeatureFlags {
    return setFeatureFlagsImpl(this.recallStoreBindings, patch);
  }

  /** Phase-79: 获取 Unified Recall 可观测性指标 */
  getRecallObservability(): RecallObservability {
    return getRecallObservabilityImpl(this.recallStoreBindings);
  }

  /** Phase-79: 重置 Unified Recall 可观测性指标 */
  resetRecallObservability(): RecallObservability {
    return resetRecallObservabilityImpl(this.recallStoreBindings);
  }

  private treeIndexSearchDocuments(query: string, limit: number, minScore: number): ScoredMemory[] {
    return treeIndexSearchDocumentsImpl(this.recallStoreBindings, query, limit, minScore);
  }

  /**
   * Phase-125: 提取的向量搜索文档方法（从 recallMemory 中分离，供 vector/fallback 复用）
   */
  private vectorSearchDocuments(query: string, limit: number, minScore: number, queryEmbedding?: number[]): ScoredMemory[] {
    return vectorSearchDocumentsImpl(this.recallStoreBindings, query, limit, minScore, queryEmbedding);
  }

  /**
   * Phase-38→44: 沿 MEMORY_RELATES 图谱关系扩展发现关联记忆
   *
   * Phase-44 增强: 优先使用 extractSubgraph 在 Rust 层完成 N-hop 遍历，
   * Phase-49: 使用 Rust 记忆树激活引擎搜索
   *
   * 调用 memoryTreeSearch 实现三维激活搜索:
   * 1. Vector: embedding 相似度
   * 2. Proximity: 图谱 N-hop 近邻
   * 3. Weight: 关系权重积累
   *
   * 搜索完成后自动调用 memoryTreeStrengthen 进行 Hebbian 共激活强化。
   */
  private recallViaActivationEngine(
    query: string,
    limit: number,
    minScore: number,
    memoryType: MemoryType | undefined,
    now: number,
  ): ScoredMemory[] {
    return recallViaActivationEngineImpl(this.recallStoreBindings, query, limit, minScore, memoryType, now);
  }

  /**
   * Phase-49/52: 传统向量搜索回退路径（增强版）
   *
   * 当激活引擎不可用或搜索失败时使用。
   * Phase-52: 三路搜索策略（按可用性自动选择最优路径）：
   *   1. vector + BM25 → hybridSearchTantivy（Rust 层融合，最优）
   *   2. vector only → searchEntitiesByVector（纯语义）
   *   3. BM25 only → searchEntitiesByText（纯全文）
   *   4. neither → 朴素字面 includes 匹配（最终兜底）
   */
  private recallViaLegacySearch(
    query: string,
    limit: number,
    minScore: number,
    memoryType: MemoryType | undefined,
    now: number,
    queryEmbedding?: number[],
  ): ScoredMemory[] {
    return recallViaLegacySearchImpl(this.recallStoreBindings, query, limit, minScore, memoryType, now, queryEmbedding);
    }

  /**
   * Recall/read paths should not rewrite the same memory entity on every access.
   * Throttle persistence of access stats to avoid turning a read into N writes.
   */
  private shouldPersistRecallAccessUpdate(props: any, now: number): boolean {
    return shouldPersistRecallAccessUpdateImpl(this.recallStoreBindings, props, now);
  }

  /**
   * Phase-52: 统一处理搜索命中结果 → ScoredMemory[]
   *
   * 将向量/BM25/混合搜索返回的 { entityId, score } 列表
   * 过滤、更新访问统计、转换为 ScoredMemory。
   */
  private processMemorySearchHits(
    hits: Array<{ entityId: string; score: number }>,
    memoryType: MemoryType | undefined,
    minScore: number,
    limit: number,
    now: number,
  ): ScoredMemory[] {
    return processMemorySearchHitsImpl(this.recallStoreBindings, hits, memoryType, minScore, limit, now);
  }

  /**
   * 避免 JS 层逐跳手动查询的 N 次跨层调用开销。
   *
   * 从向量搜索命中的记忆出发，沿 MEMORY_RELATES 关系探索 1-2 跳，
   * 发现未被向量搜索直接命中但图谱关联的记忆。
   * 关联分数 = 原始记忆分数 × 关系权重^depth × 衰减因子
   */
  private expandMemoriesByGraph(
    seedMemories: ScoredMemory[],
    memoryType?: MemoryType,
    limit: number = 10,
  ): ScoredMemory[] {
    return expandMemoriesByGraphImpl(this.recallStoreBindings, seedMemories, memoryType, limit);
  }

  /**
   * Phase-44: 用 extractSubgraph 实现高效图谱扩展
   *
   * 对每个种子记忆调用 extractSubgraph(seedId, {max_hops:2, direction:'both',
   * relation_type_filter:['memory_relates'], entity_type_filter:['devplan-memory']}),
   * Rust 层在分片内一次性完成 BFS 遍历，返回子图的 entities + depth_map。
   */
  private expandMemoriesBySubgraph(
    seedMemories: ScoredMemory[],
    memoryType?: MemoryType,
    limit: number = 10,
  ): ScoredMemory[] {
    return expandMemoriesBySubgraphImpl(this.recallStoreBindings, seedMemories, memoryType, limit);
  }

  /**
   * Phase-38 原始实现: 手动逐跳遍历（Fallback）
   */
  private expandMemoriesByManualTraversal(
    seedMemories: ScoredMemory[],
    memoryType?: MemoryType,
    limit: number = 10,
  ): ScoredMemory[] {
    return expandMemoriesByManualTraversalImpl(this.recallStoreBindings, seedMemories, memoryType, limit);
  }

  /**
   * Phase-44: 赫布学习 — 共同激活的记忆自动增强连接权重
   *
   * "Neurons that fire together, wire together."
   * 当多条记忆在同一次召回中被共同激活，增强它们之间 MEMORY_RELATES 关系的权重。
   *
   * - 使用 adjustRelationWeight（Rust 原子操作），delta = +0.05
   * - 仅增强已有 MEMORY_RELATES 连接（不创建新连接）
   * - 上限 top5 记忆的 C(5,2) = 10 对，避免大量关系更新
   */
  /**
   * Phase-50: Hebbian 共激活强化
   *
   * 优先使用 Rust 原生 memoryTreeStrengthen（批量处理所有共激活对）;
   * 不可用时回退到 TS 层逐对 adjustRelationWeight。
   */
  private hebbianStrengthen(coActivatedMemories: ScoredMemory[]): void {
    hebbianStrengthenImpl(this.recallStoreBindings, coActivatedMemories);
  }

  /**
   * 列出记忆（支持过滤）
   */
  listMemories(filter?: {
    memoryType?: MemoryType;
    relatedTaskId?: string;
    limit?: number;
  }): Memory[] {
    // 如果按关联任务过滤，通过关系查询
    if (filter?.relatedTaskId) {
      return this.getTaskRelatedMemories(filter.relatedTaskId, filter);
    }

    const entities = this.findEntitiesByType(ET.MEMORY);
    let memories = entities
      .filter((e) => {
        const p = e.properties as any;
        if (p.projectName !== this.projectName) return false;
        if (filter?.memoryType && p.memoryType !== filter.memoryType) return false;
        return true;
      })
      .map((e) => this.entityToMemory(e));

    // 按 updatedAt 降序排列（最新的在前）
    memories.sort((a, b) => b.updatedAt - a.updatedAt);

    if (filter?.limit && filter.limit > 0) {
      memories = memories.slice(0, filter.limit);
    }

    return memories;
  }

  /**
   * 删除一条记忆
   */
  deleteMemory(memoryId: string): boolean {
    try {
      const entity = this.graph.getEntity(memoryId);
      if (!entity || entity.entity_type !== ET.MEMORY) return false;
      const p = entity.properties as any;
      if (p.projectName !== this.projectName) return false;

      this.graph.deleteEntity(memoryId);
      this.graph.flush();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 批量清除当前项目的所有记忆
   *
   * @param memoryType - 可选：仅清除指定类型的记忆。省略则清除所有。
   * @returns { deleted: number } 实际删除的数量
   */
  clearAllMemories(memoryType?: MemoryType): { deleted: number } {
    const entities = this.findEntitiesByType(ET.MEMORY);
    const toDelete = entities.filter((e) => {
      const p = e.properties as any;
      if (p.projectName !== this.projectName) return false;
      if (memoryType && p.memoryType !== memoryType) return false;
      return true;
    });

    let deleted = 0;
    for (const e of toDelete) {
      try {
        this.graph.deleteEntity(e.id);
        deleted++;
      } catch {
        // 跳过单条删除失败
      }
    }

    if (deleted > 0) {
      this.graph.flush();
    }

    return { deleted };
  }

  /**
   * 获取新会话上下文 — 核心工具
   *
   * 聚合以下信息为 Cursor 提供全面的项目上下文：
   * 1. 最近的 in_progress / completed 主任务
   * 2. 与查询相关的记忆（语义召回）
   * 3. 所有 preference 类型记忆
   * 4. 最近的 decision 类型记忆
   */
  getMemoryContext(query?: string, maxMemories?: number): MemoryContext {
    const limit = maxMemories || 10;

    // 1. 最近任务
    const allTasks = this.listMainTasks();
    const recentTasks = allTasks
      .filter((t) => t.status === 'in_progress' || t.status === 'completed')
      .sort((a, b) => (b.completedAt || b.updatedAt) - (a.completedAt || a.updatedAt))
      .slice(0, 5)
      .map((t) => ({
        taskId: t.taskId,
        title: t.title,
        status: t.status,
        completedAt: t.completedAt,
      }));

    // 2. 相关记忆（统一召回：同时搜索记忆 + 文档）
    let relevantMemories: ScoredMemory[] = [];
    if (query) {
      relevantMemories = this.recallUnifiedViaAdapter(query, { limit, docStrategy: 'vector' });
    }

    // 3. 项目偏好
    const projectPreferences = this.listMemories({ memoryType: 'preference' });

    // 4. 最近决策
    const recentDecisions = this.listMemories({ memoryType: 'decision', limit: 5 });

    // 5. 总记忆数
    const allMemories = this.findEntitiesByType(ET.MEMORY);
    const totalMemories = allMemories.filter(
      (e) => (e.properties as any).projectName === this.projectName
    ).length;

    // 6. 关键文档摘要（自动纳入 overview / core_concepts）
    const relatedDocs: MemoryContext['relatedDocs'] = [];
    const KEY_SECTIONS = ['overview', 'core_concepts'];
    const DOC_SUMMARY_MAX_LEN = 500;

    try {
      const allSections = this.listSections();
      for (const sec of allSections) {
        if (KEY_SECTIONS.includes(sec.section)) {
          const doc = this.getSection(sec.section, sec.subSection);
          if (doc && doc.content) {
            const summary = doc.content.length > DOC_SUMMARY_MAX_LEN
              ? doc.content.substring(0, DOC_SUMMARY_MAX_LEN) + '...'
              : doc.content;
            relatedDocs.push({
              section: doc.section,
              subSection: doc.subSection || undefined,
              title: doc.title,
              summary,
            });
          }
        }
      }
    } catch (e) {
      // 非关键路径，忽略错误
    }

    // 7. Phase-38: 模块级关联记忆 — 图谱遍历 in_progress 任务 → 模块 → MODULE_MEMORY
    const moduleMemories = this.getModuleMemoriesFromActiveTasks(recentTasks);

    // 8. Phase-40: 记忆主题集群概览（仅摘要，不含完整记忆）
    let memoryClusters: MemoryContext['memoryClusters'];
    try {
      const clusters = this.getMemoryClusters();
      // 只保留有意义的集群（2条以上记忆，排除 uncategorized）
      const significantClusters = clusters
        .filter((c) => c.clusterId > 0 && c.memoryCount >= 2)
        .map((c) => ({
          clusterId: c.clusterId,
          theme: c.theme,
          memoryCount: c.memoryCount,
          topMemoryTypes: c.topMemoryTypes,
        }));
      if (significantClusters.length > 0) {
        memoryClusters = significantClusters;
      }
    } catch (_e) {
      // 非关键路径，忽略错误
    }

    // 9. Phase-57: 触点索引 — 列出项目中所有已注册的记忆触点
    let anchorIndex: MemoryContext['anchorIndex'];
    try {
      const g57 = this.graph as any;
      if (typeof g57.anchorList === 'function') {
        // 列出所有类型的触点
        const anchorTypes = ['module', 'concept', 'api', 'architecture', 'feature', 'library', 'protocol'];
        const allAnchors: Array<{ id: string; name: string; type: string; description: string; version: number; status: string; flowCount: number }> = [];

        for (const aType of anchorTypes) {
          try {
            const anchors: NativeAnchorInfo[] = g57.anchorList(aType);
            if (anchors && anchors.length > 0) {
              for (const a of anchors) {
                allAnchors.push({
                  id: a.id,
                  name: a.name,
                  type: a.anchor_type,
                  description: a.description,
                  version: a.version,
                  status: a.status,
                  flowCount: a.flow_count,
                });
              }
            }
          } catch {
            // 该类型无触点，静默跳过
          }
        }

        if (allAnchors.length > 0) {
          // 按 flowCount 降序排列（活跃的触点优先）
          allAnchors.sort((a, b) => b.flowCount - a.flowCount);
          anchorIndex = allAnchors;
        }
      }
    } catch (_e) {
      // NAPI 不可用，静默忽略
    }

    // 10. Phase-57: 结构概览 — 展示关键触点的当前结构组成
    let structureOverview: MemoryContext['structureOverview'];
    try {
      const g57 = this.graph as any;
      if (typeof g57.structureCurrent === 'function' && anchorIndex) {
        const overviews: NonNullable<MemoryContext['structureOverview']> = [];
        // 只展示 feature/module 类型且有组件结构的触点
        const structuralAnchors = anchorIndex.filter(
          a => (a.type === 'feature' || a.type === 'module') && a.status === 'active',
        ).slice(0, 10); // 最多展示 10 个

        for (const anchor of structuralAnchors) {
          try {
            const snapshot: NativeStructureSnapshot | null = g57.structureCurrent(anchor.id);
            if (snapshot && snapshot.components && snapshot.components.length > 0) {
              overviews.push({
                anchorName: anchor.name,
                anchorType: anchor.type,
                version: snapshot.version,
                components: snapshot.components.map(c => ({
                  anchorId: c.anchorId,
                  role: c.role,
                  versionHint: c.versionHint,
                })),
              });
            }
          } catch {
            // 该触点无结构快照，静默跳过
          }
        }

        if (overviews.length > 0) {
          structureOverview = overviews;
        }
      }
    } catch (_e) {
      // NAPI 不可用，静默忽略
    }

    return {
      projectName: this.projectName,
      recentTasks,
      relevantMemories,
      projectPreferences,
      recentDecisions,
      totalMemories,
      relatedDocs: relatedDocs.length > 0 ? relatedDocs : undefined,
      moduleMemories: moduleMemories.length > 0 ? moduleMemories : undefined,
      memoryClusters,
      anchorIndex,
      structureOverview,
    };
  }

  /**
   * Phase-38: 从进行中的任务出发，通过图谱遍历获取模块级记忆
   *
   * 路径: in_progress task → MODULE_HAS_TASK(反向) → module → MODULE_MEMORY → memories
   */
  private getModuleMemoriesFromActiveTasks(
    recentTasks: Array<{ taskId: string; status: string }>,
  ): Array<{ moduleId: string; moduleName: string; memories: Memory[] }> {
    const results: Array<{ moduleId: string; moduleName: string; memories: Memory[] }> = [];
    const seenModuleIds = new Set<string>();

    // 只从 in_progress 任务出发
    const activeTasks = recentTasks.filter((t) => t.status === 'in_progress');

    for (const task of activeTasks) {
      const taskEntity = this.findEntityByProp(ET.MAIN_TASK, 'taskId', task.taskId);
      if (!taskEntity) continue;

      // 查找该任务所属的模块（反向: module → MODULE_HAS_TASK → task）
      const inRels = this.getInRelations(taskEntity.id, RT.MODULE_HAS_TASK);
      for (const rel of inRels) {
        const moduleEntity = this.graph.getEntity(rel.source);
        if (!moduleEntity) continue;
        const mp = moduleEntity.properties as any;
        const moduleId = mp.moduleId;
        if (!moduleId || seenModuleIds.has(moduleId)) continue;
        seenModuleIds.add(moduleId);

        // 获取模块下的所有记忆（module → MODULE_MEMORY → memory）
        const memRels = this.getOutRelations(moduleEntity.id, RT.MODULE_MEMORY);
        const memories: Memory[] = [];
        for (const memRel of memRels) {
          const memEntity = this.graph.getEntity(memRel.target);
          if (!memEntity) continue;
          const memP = memEntity.properties as any;
          if (memP.projectName !== this.projectName) continue;
          memories.push(this.entityToMemory(memEntity));
        }

        if (memories.length > 0) {
          results.push({
            moduleId,
            moduleName: mp.name || moduleId,
            memories: memories.slice(0, 10), // 每模块最多10条
          });
        }
      }
    }

    return results;
  }

  // ============================================================================
  // Phase-40: 记忆主题集群 — 基于 MEMORY_RELATES 连通分量聚类
  // ============================================================================

  /**
   * Phase-40: 获取记忆主题集群
   *
   * 基于 MEMORY_RELATES 关系图的连通分量检测，自动将语义关联的记忆
   * 聚合为主题集群。每个集群包含一个自动生成的主题标签和成员记忆列表。
   *
   * 算法：BFS 连通分量检测（适合中小规模记忆网络）
   */
  getMemoryClusters(): Array<{
    clusterId: number;
    theme: string;
    memoryCount: number;
    topMemoryTypes: string[];
    memories: Memory[];
  }> {
    // 1. 获取所有本项目的记忆
    const allEntities = this.findEntitiesByType(ET.MEMORY);
    const projectMemories = allEntities.filter(
      (e) => (e.properties as any).projectName === this.projectName
    );

    if (projectMemories.length === 0) return [];

    // 2. 构建邻接表（基于 MEMORY_RELATES 关系）
    const adjacency = new Map<string, Set<string>>();
    for (const mem of projectMemories) {
      adjacency.set(mem.id, new Set());
    }

    for (const mem of projectMemories) {
      const outRels = this.getOutRelations(mem.id, RT.MEMORY_RELATES);
      const inRels = this.getInRelations(mem.id, RT.MEMORY_RELATES);
      for (const rel of [...outRels, ...inRels]) {
        const neighborId = rel.source === mem.id ? rel.target : rel.source;
        if (adjacency.has(neighborId)) {
          adjacency.get(mem.id)!.add(neighborId);
          adjacency.get(neighborId)!.add(mem.id);
        }
      }
    }

    // 3. BFS 连通分量检测
    const visited = new Set<string>();
    const components: string[][] = [];

    for (const mem of projectMemories) {
      if (visited.has(mem.id)) continue;

      const component: string[] = [];
      const queue = [mem.id];
      visited.add(mem.id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);

        const neighbors = adjacency.get(current) || new Set();
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      components.push(component);
    }

    // 4. 转化为集群结果（按大小降序排列，孤立记忆归入"未分类"）
    const clusters: Array<{
      clusterId: number;
      theme: string;
      memoryCount: number;
      topMemoryTypes: string[];
      memories: Memory[];
    }> = [];

    // 实体 ID → Memory 的快速查找
    const entityMap = new Map(projectMemories.map((e) => [e.id, e]));

    let clusterId = 0;
    const isolatedMemories: Memory[] = [];

    for (const component of components.sort((a, b) => b.length - a.length)) {
      const memories = component
        .map((id) => entityMap.get(id))
        .filter(Boolean)
        .map((e) => this.entityToMemory(e!));

      if (component.length <= 1) {
        // 孤立记忆收集，后续归入"未分类"集群
        isolatedMemories.push(...memories);
        continue;
      }

      clusterId++;

      // 统计 memoryType 分布，取出现最多的类型
      const typeCounts = new Map<string, number>();
      for (const m of memories) {
        typeCounts.set(m.memoryType, (typeCounts.get(m.memoryType) || 0) + 1);
      }
      const topMemoryTypes = Array.from(typeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t);

      // 自动主题：取高频 tags + 高频 memoryType
      const tagCounts = new Map<string, number>();
      for (const m of memories) {
        for (const tag of m.tags || []) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
      const topTags = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t);

      const theme = topTags.length > 0
        ? topTags.join(' / ')
        : `${topMemoryTypes[0] || 'mixed'} cluster`;

      clusters.push({
        clusterId,
        theme,
        memoryCount: memories.length,
        topMemoryTypes,
        memories,
      });
    }

    // 孤立记忆归入"未分类"集群（如果有的话）
    if (isolatedMemories.length > 0) {
      clusters.push({
        clusterId: 0,
        theme: 'uncategorized',
        memoryCount: isolatedMemories.length,
        topMemoryTypes: ['mixed'],
        memories: isolatedMemories,
      });
    }

    return clusters;
  }

  /**
   * 获取任务关联的记忆
   */
  private getTaskRelatedMemories(taskId: string, filter?: { memoryType?: MemoryType }): Memory[] {
    const taskEntity = this.findEntityByProp(ET.MAIN_TASK, 'taskId', taskId);
    if (!taskEntity) return [];

    // 查找所有指向该任务的 memory_from_task 关系（反向查询）
    const allMemories = this.findEntitiesByType(ET.MEMORY);
    const memories: Memory[] = [];

    for (const e of allMemories) {
      const p = e.properties as any;
      if (p.projectName !== this.projectName) continue;
      if (p.relatedTaskId !== taskId) continue;
      if (filter?.memoryType && p.memoryType !== filter.memoryType) continue;
      memories.push(this.entityToMemory(e));
    }

    memories.sort((a, b) => b.updatedAt - a.updatedAt);
    return memories;
  }

  /**
   * Entity → Memory 转换
   */
  private entityToMemory(e: Entity): Memory {
    const p = e.properties as any;
    const mem: Memory = {
      id: e.id,
      projectName: this.projectName,
      memoryType: p.memoryType || 'insight',
      content: p.content || '',
      tags: p.tags || [],
      relatedTaskId: p.relatedTaskId || undefined,
      recallProfile: p.recallProfile || undefined,
      sourceRef: p.sourceRef || undefined,
      provenance: p.provenance || undefined,
      importance: p.importance ?? 0.5,
      hitCount: p.hitCount || 0,
      lastAccessedAt: p.lastAccessedAt || null,
      createdAt: p.createdAt || e.created_at,
      updatedAt: p.updatedAt || p.createdAt || e.created_at,
      // Phase-58: L3 完整内容
      contentL3: p.contentL3 || undefined,
    };

    // Phase-48: 恢复分解摘要 — 从实体 properties 读取
    if (p._decomp_episodeId) {
      mem.decomposition = {
        episodeId: p._decomp_episodeId,
        entitiesStored: p._decomp_entitiesStored ?? 0,
        relationsStored: p._decomp_relationsStored ?? 0,
        vectorsIndexed: p._decomp_vectorsIndexed ?? 0,
        conflictsDetected: p._decomp_conflictsDetected ?? 0,
      };
    }

    return mem;
  }

  private resolveMemoryRecallProfile(input: MemoryInput): MemoryRecallProfile {
    return resolveMemoryRecallProfileImpl(this.memoryWriteStoreBindings, input);
  }

  // ==========================================================================
  // Memory Generation (从文档/任务提取记忆候选项)
  // ==========================================================================

  /**
   * 记忆生成器 — 从已有文档和已完成任务中提取记忆候选项
   *
   * 聚合逻辑：
   * 1. 任务: 每个已完成阶段 → 1 条 summary 候选项（phase 标题 + 子任务列表）
   * 2. 文档: 每篇文档 → 1 条候选项（section 类型 → 建议 memoryType 映射）
   * 3. 去重: 检查已有记忆，已有记忆的候选项直接跳过不返回
   *
   * AI 收到候选项后，分析 content 并调用 devplan_memory_save 批量生成记忆。
   */

  // ============================================================================
  // Phase-44: 记忆生命周期管理 — DynamicNode promote/demote
  // ============================================================================

  /**
   * Phase-50: 运行记忆生命周期扫描
   *
   * 优先使用 Rust 原生 memoryTreeLifecycle（内置 memory-tree-aware 的 promote/demote/summary 逻辑）;
   * 不可用时回退到 TS 层 dynamicScan 实现。
   *
   * Rust 原生实现的优势：
   * - promote/demote 同时感知记忆子图（episode/entity），而非仅处理顶层记忆
   * - 自动为 demoted 记忆创建摘要（summariesCreated）
   * - 包含 Hebbian 权重更新（hebbian_updates）
   *
   * @param config 配置选项
   * @returns 扫描报告（promoted/demoted/scanned 计数）
   */
  runMemoryLifecycle(config?: {
    /** shadow 状态之前的闲置秒数（默认 30 天 = 2592000） */
    demoteIdleTimeoutSecs?: number;
    /** 从 shadow 恢复所需的最小 hitCount（默认 3） */
    promoteHitThreshold?: number;
  }): { promoted: number; demoted: number; scanned: number; durationMs: number; summariesCreated?: number; hebbianUpdates?: number } | null {
    // Phase-50: 优先使用 Rust 原生 memoryTreeLifecycle
    try {
      const report: MemoryScanReport = this.graph.memoryTreeLifecycle({
        demoteIdleTimeoutSecs: config?.demoteIdleTimeoutSecs ?? 2592000,
        promoteHitThreshold: config?.promoteHitThreshold ?? 3,
        preserveEntityTypes: [ET.PROJECT, ET.DOC, ET.MAIN_TASK, ET.SUB_TASK, ET.MODULE],
      });

      return {
        promoted: report.promoted ?? 0,
        demoted: report.demoted ?? 0,
        scanned: report.entities_scanned ?? 0,
        durationMs: 0,
        summariesCreated: report.summaries_created ?? 0,
        hebbianUpdates: report.hebbian_updates ?? 0,
      };
    } catch (rustErr) {
      // Rust API 不可用，回退到 TS 层 dynamicScan
      console.warn(`[DevPlan] memoryTreeLifecycle failed, falling back to dynamicScan: ${rustErr instanceof Error ? rustErr.message : String(rustErr)}`);
    }

    // 回退: TS 层 dynamicScan 实现
    try {
      const result = this.graph.dynamicScan({
        promote_hit_threshold: config?.promoteHitThreshold ?? 3,
        demote_idle_timeout_secs: config?.demoteIdleTimeoutSecs ?? 2592000,
        scan_entity_types: [ET.MEMORY],
        preserve_entity_types: [ET.PROJECT, ET.DOC, ET.MAIN_TASK, ET.SUB_TASK, ET.MODULE],
      });

      if (result && result.demoted > 0) {
        const allMemories = this.findEntitiesByType(ET.MEMORY);
        for (const mem of allMemories) {
          const p = mem.properties as any;
          if (p.projectName !== this.projectName) continue;
          if (typeof (this.graph as any).isShadowEntity === 'function' && (this.graph as any).isShadowEntity(mem.id)) {
            try {
              this.graph.removeEntityVector(mem.id);
            } catch { /* entity might not have vector */ }
          }
        }
      }

      return {
        promoted: result?.promoted ?? 0,
        demoted: result?.demoted ?? 0,
        scanned: result?.scanned ?? 0,
        durationMs: result?.duration_ms ?? 0,
      };
    } catch (e) {
      console.warn(`[DevPlan] runMemoryLifecycle fallback (dynamicScan) failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  generateMemoryCandidates(options?: {
    source?: 'tasks' | 'docs' | 'modules' | 'both';
    taskId?: string;
    section?: string;
    subSection?: string;
    limit?: number;
  }): MemoryGenerateResult {
    return generateMemoryCandidatesImpl(this.memoryWriteStoreBindings, options);
  }

  // ==========================================================================
  // Utility
  // ==========================================================================

  /**
   * Phase-21: 清理 WAL 中的重复 Entity。
   *
   * 扫描所有实体类型，按业务键去重，删除多余（低优先级）的 Entity。
   * 返回被清理的 Entity 数量和详情。
   *
   * @param dryRun - 若为 true，仅报告而不实际删除
   */
  cleanupDuplicates(dryRun: boolean = false): {
    cleaned: number;
    details: Array<{ entityType: string; propKey: string; duplicateId: string; keptId: string }>;
  } {
    const details: Array<{ entityType: string; propKey: string; duplicateId: string; keptId: string }> = [];

    // 定义各实体类型的去重键
    const typeKeyMap: Array<{ entityType: string; propKey: string }> = [
      { entityType: ET.MAIN_TASK, propKey: 'taskId' },
      { entityType: ET.SUB_TASK, propKey: 'taskId' },
      { entityType: ET.MODULE, propKey: 'moduleId' },
    ];

    for (const { entityType, propKey } of typeKeyMap) {
      const duplicates = this.findDuplicateEntities(entityType, propKey);
      for (const dup of duplicates) {
        const propVal = (dup.properties as any)?.[propKey] || 'unknown';
        // 找出胜者
        const entities = this.findEntitiesByType(entityType).filter(
          (e) => (e.properties as any)?.[propKey] === propVal
        );
        const winner = this.deduplicateEntities(entities, propKey)[0];

        details.push({
          entityType,
          propKey: `${propKey}=${propVal}`,
          duplicateId: dup.id,
          keptId: winner?.id || 'unknown',
        });

        if (!dryRun) {
          // 删除重复 Entity 的所有关系
          const relations = this.graph.getEntityRelations(dup.id);
          for (const rel of relations) {
            this.graph.deleteRelation(rel.id);
          }
          // 删除重复 Entity
          this.graph.deleteEntity(dup.id);
        }
      }
    }

    // 文档去重（按 section+subSection 组合键）
    const docEntities = this.findEntitiesByType(ET.DOC);
    const docGroups = new Map<string, Entity[]>();
    for (const e of docEntities) {
      const p = e.properties as any;
      const key = sectionKey(p.section, p.subSection || undefined);
      if (!docGroups.has(key)) docGroups.set(key, []);
      docGroups.get(key)!.push(e);
    }
    for (const [key, group] of docGroups) {
      if (group.length <= 1) continue;
      // 保留 updatedAt 最新的
      group.sort((a, b) => (Number((b.properties as any)?.updatedAt) || 0) - (Number((a.properties as any)?.updatedAt) || 0));
      const winner = group[0];
      for (let i = 1; i < group.length; i++) {
        details.push({
          entityType: ET.DOC,
          propKey: `section=${key}`,
          duplicateId: group[i].id,
          keptId: winner.id,
        });
        if (!dryRun) {
          const relations = this.graph.getEntityRelations(group[i].id);
          for (const rel of relations) {
            this.graph.deleteRelation(rel.id);
          }
          this.graph.deleteEntity(group[i].id);
        }
      }
    }

    if (!dryRun && details.length > 0) {
      this.graph.flush();
    }

    return { cleaned: details.length, details };
  }

  sync(): void {
    this.graph.flush();
  }

  getProjectName(): string {
    return this.projectName;
  }

  syncWithGit(dryRun: boolean = false): SyncGitResult {
    return syncWithGitImpl(this.gitStoreBindings, dryRun);
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
    includePrompts?: boolean;
    includeMemories?: boolean;
  }): DevPlanExportedGraph {
    return exportGraphImpl(this.visualizeStoreBindings, options);
  }

  /**
   * 分页导出图谱数据 (Phase-9 T9.1)
   *
   * 利用 Rust 层 SocialGraphV2 的 exportGraphPaginated() 分页 API，
   * 避免全量加载 + 内存切片。真正的分页下推到数据库层。
   *
   * @param offset 分页偏移量
   * @param limit 每页节点数
   * @param options 可选参数
   * @returns 分页图谱数据
   */
  exportGraphPaginated(
    offset: number,
    limit: number,
    options?: {
      includeDocuments?: boolean;
      includeModules?: boolean;
      includeNodeDegree?: boolean;
      entityTypes?: string[];
    }
  ): DevPlanPaginatedGraph {
    return exportGraphPaginatedImpl(this.visualizeStoreBindings, offset, limit, options);
  }

  /**
   * 导出紧凑二进制格式 (Phase-9 T9.3)
   *
   * 利用 Rust 层 CompactGraphExport 格式，返回 Buffer。
   * 比 JSON 小 5x+，解析速度接近零。
   *
   * @returns Node.js Buffer 或 null (如果 NAPI 方法不可用)
   */
  exportGraphCompact(): Buffer | null {
    return exportGraphCompactImpl(this.visualizeStoreBindings);
  }

  /**
   * 获取实体组聚合摘要 (Phase-9 T9.4)
   *
   * 利用 Rust 层 group_entities_summary() 返回按类型分组的统计信息。
   * 远比加载全部实体开销小，适合低缩放级别的集群视图。
   *
   * @returns 聚合结果或 null (如果 NAPI 方法不可用)
   */
  getEntityGroupSummary(): EntityGroupAggregation | null {
    return getEntityGroupSummaryImpl(this.visualizeStoreBindings);
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * 获取下一个主任务的 order 值（当前最大 order + 1）
   */
  private getNextMainTaskOrder(): number {
    return getNextMainTaskOrderImpl(this.taskStoreBindings);
  }

  /**
   * 获取下一个子任务的 order 值（当前父任务下最大 order + 1）
   */
  private getNextSubTaskOrder(parentTaskId: string): number {
    return getNextSubTaskOrderImpl(this.taskStoreBindings, parentTaskId);
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
    return refreshMainTaskCountsImpl(this.taskStoreBindings, mainTaskId);
  }

  private reconcileMainTaskAfterSubTaskDeletion(mainTaskId: string): MainTask | null {
    return reconcileMainTaskAfterSubTaskDeletionImpl(this.taskStoreBindings, mainTaskId);
  }

  private resolveTaskDeleteType(taskId: string, taskType?: 'main' | 'sub'): 'main' | 'sub' | null {
    return resolveTaskDeleteTypeImpl(this.taskStoreBindings, taskId, taskType);
  }

  /**
   * Phase-45: 修复存量数据 — 遍历所有主任务，重新计算子任务计数和自动完成状态。
   * 用于修复因 updateEntity 路由不一致导致的 completedSubtasks=0 和 status=in_progress 的 Bug。
   * @returns 修复报告
   */
  repairAllMainTaskCounts(): { repaired: number; autoCompleted: number; details: Array<{ taskId: string; action: string }> } {
    return repairAllMainTaskCountsImpl(this.taskStoreBindings);
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

  private validateParentDocAssignment(
    docSection: string,
    docSubSection: string | undefined,
    docEntityId: string | undefined,
    newParentDoc?: string | null,
  ): void {
    if (!newParentDoc) return;

    const docKey = sectionKey(docSection as DevPlanSection, docSubSection || undefined);
    if (newParentDoc === docKey) {
      throw new Error(`Invalid parentDoc: document "${docKey}" cannot be its own parent.`);
    }

    if (!docEntityId) return;

    const [parentSection, parentSubSection] = newParentDoc.split('|');
    const parentEntity = this.findDocEntityBySection(parentSection, parentSubSection || undefined);
    if (!parentEntity) return;

    if (parentEntity.id === docEntityId) {
      throw new Error(`Invalid parentDoc: document "${docKey}" cannot be its own parent.`);
    }

    if (this.hasDescendantDocEntity(docEntityId, parentEntity.id)) {
      throw new Error(
        `Invalid parentDoc: assigning "${newParentDoc}" as parent of "${docKey}" would create a document hierarchy cycle.`
      );
    }
  }

  private hasDescendantDocEntity(rootDocEntityId: string, candidateDocEntityId: string): boolean {
    const visited = new Set<string>([rootDocEntityId]);
    const queue: string[] = [rootDocEntityId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const childRels = this.getOutRelations(currentId, RT.DOC_HAS_CHILD);
      for (const rel of childRels) {
        const childId = rel.target;
        if (childId === candidateDocEntityId) {
          return true;
        }
        if (visited.has(childId)) continue;
        visited.add(childId);
        queue.push(childId);
      }
    }

    return false;
  }

  /**
   * 更新文档的父文档关系（DOC_HAS_CHILD）
   *
   * 移除旧的父文档关系，建立新的父文档关系。
   */
  private updateParentDocRelation(docEntityId: string, oldParentDoc?: string, newParentDoc?: string): void {
    const projectId = this.getProjectId();
    const docEntity = this.graph.getEntity(docEntityId);
    if (docEntity) {
      const props = docEntity.properties as any;
      this.validateParentDocAssignment(props.section, props.subSection || undefined, docEntityId, newParentDoc);
    }

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
    if (!this.ensureSynapseReady() || !this.synapse) return;

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

}
