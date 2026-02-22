/**
 * DevPlan 类型定义
 *
 * 所有 DevPlan 系统使用的类型、接口、枚举定义。
 * 供 IDevPlanStore 接口及其两个实现（DevPlanDocumentStore / DevPlanGraphStore）共用。
 */

// ============================================================================
// Section & Status Types
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
 * 功能模块状态
 */
export type ModuleStatus = 'planning' | 'active' | 'completed' | 'deprecated';

// ============================================================================
// Document Section Types
// ============================================================================

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
  /** 关联的主任务 ID 列表 */
  relatedTaskIds?: string[];
  /** 父文档标识（section 或 section|subSection 格式，可选） */
  parentDoc?: string;
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
  /** 关联的主任务 ID 列表 */
  relatedTaskIds?: string[];
  /** 父文档标识（section 或 section|subSection 格式） */
  parentDoc?: string;
  /** 子文档标识列表（自动计算，仅 Graph 引擎支持） */
  childDocs?: string[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

// ============================================================================
// Task Types
// ============================================================================

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
  /** 关联的 Prompt ID 列表 */
  relatedPromptIds?: string[];
  /** 排序序号（数值越小越靠前，不填则自动追加到末尾） */
  order?: number;
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
  /** 关联的 Prompt ID 列表 */
  relatedPromptIds?: string[];
  /** 子任务总数 */
  totalSubtasks: number;
  /** 已完成子任务数 */
  completedSubtasks: number;
  /** 任务状态 */
  status: TaskStatus;
  /** 排序序号（数值越小越靠前） */
  order?: number;
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
  /** 排序序号（数值越小越靠前，不填则自动追加到末尾） */
  order?: number;
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
  /** 排序序号（数值越小越靠前） */
  order?: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt: number | null;
  /** 完成时的 Git commit hash (short SHA)，用于 Git 同步检查 */
  completedAtCommit?: string;
  /** 被自动回退的原因（当 syncWithGit 检测到 commit 不在当前分支时） */
  revertReason?: string;
}

// ============================================================================
// Result Types
// ============================================================================

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
  /** 完成时锚定的 Git commit hash */
  completedAtCommit?: string;
}

/**
 * devplan_sync_git 返回结果
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
 * 被回退的单个任务信息
 */
export interface RevertedTask {
  taskId: string;
  title: string;
  parentTaskId: string;
  completedAtCommit: string;
  reason: string;
}

// ============================================================================
// Module Types
// ============================================================================

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

// ============================================================================
// Progress Types
// ============================================================================

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
  /** 排序序号 */
  order?: number;
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

// ============================================================================
// Config Types
// ============================================================================

/**
 * DevPlanStore 配置（EnhancedDocumentStore 模式）
 */
export interface DevPlanStoreConfig {
  /** 文档片段存储路径 */
  documentPath: string;
  /** 任务存储路径 */
  taskPath: string;
  /** 功能模块存储路径 */
  modulePath: string;
  /** Prompt 日志存储路径 */
  promptPath: string;
  /** Git 操作的工作目录（多项目路由时指向项目根目录，默认 process.cwd()） */
  gitCwd?: string;
}

/**
 * Perception 预设模型名称（对应 aifastdb PerceptionPresets 的键名）
 *
 * | 预设名 | 模型 | 维度 | 后端 | 适用场景 |
 * |--------|------|------|------|---------|
 * | miniLM | all-MiniLM-L6-v2 | 384 | candle | 轻量英文（默认） |
 * | bgeSmall | bge-small-en-v1.5 | 384 | candle | 高质量英文 |
 * | multilingualE5 | multilingual-e5-small | 384 | candle | 多语言 |
 * | embeddingGemma | embedding-gemma | 768 | candle | 高维度 |
 * | ollamaEmbeddingGemma | embeddinggemma | 768 | ollama | Ollama EmbeddingGemma |
 * | ollamaQwen3Embedding | qwen3-embedding | 1024 | ollama | Ollama Qwen3 0.6B |
 * | ollamaQwen3Embedding8b | qwen3-embedding:8b | 4096 | ollama | Ollama Qwen3 8B（最高质量） |
 * | none | — | — | — | 禁用感知引擎 |
 */
export type PerceptionPresetName =
  | 'miniLM'
  | 'bgeSmall'
  | 'multilingualE5'
  | 'embeddingGemma'
  | 'ollamaEmbeddingGemma'
  | 'ollamaQwen3Embedding'
  | 'ollamaQwen3Embedding8b'
  | 'none';

/**
 * DevPlanStore 配置（SocialGraphV2 模式）
 */
export interface DevPlanGraphStoreConfig {
  /** SocialGraphV2 数据目录路径 */
  graphPath: string;
  /**
   * @deprecated 分片数现在由 shard-config.ts 的 DEVPLAN_SHARD_NAMES.length 自动推导，
   * 且 SocialGraphV2 会从 shardNames.length 自动设置 shardCount。此字段已无效。
   */
  shardCount?: number;
  /** 是否启用语义搜索（需要 VibeSynapse Embedding + SocialGraphV2 向量索引） */
  enableSemanticSearch?: boolean;
  /**
   * Embedding 向量维度覆盖（Matryoshka 截断）
   *
   * - **通常不需要设置**：维度会从 modelId 自动解析（如 qwen3-embedding:8b → 4096d）
   * - **仅在需要 Matryoshka 截断时设置**：如将 4096d 截断为 1024d 以节省 HNSW 存储
   *
   * ⚠️ **IMMUTABLE AFTER INIT**: 此值在数据库首次初始化后不可变更。
   * 变更会导致 HNSW 向量索引与已有数据维度不匹配，造成搜索失败或数据损坏。
   * 如需变更，必须删除旧数据并重新导入。
   */
  embeddingDimension?: number;

  /**
   * Phase-52: Perception 预设名称 — 快捷选择 Embedding 模型
   *
   * 优先级：perceptionConfig > perceptionPreset > 默认 miniLM
   *
   * 在 .devplan/config.json 中配置：
   * ```json
   * { "perceptionPreset": "bgeSmall" }
   * ```
   */
  perceptionPreset?: PerceptionPresetName;

  /**
   * Phase-52: 完整的 Perception 配置 — 自定义 Embedding 引擎
   *
   * 当需要使用非预设模型时，提供完整配置。优先级高于 perceptionPreset。
   *
   * 示例（本地 Candle）:
   * ```json
   * { "perceptionConfig": { "engineType": "candle", "modelId": "BAAI/bge-small-en-v1.5", "autoDownload": true } }
   * ```
   *
   * 示例（Ollama qwen3-embedding:8b，维度自动解析为 4096d）:
   * ```json
   * { "perceptionConfig": {
   *     "engineType": "ollama",
   *     "modelId": "qwen3-embedding:8b",
   *     "endpoint": "http://localhost:11434/v1"
   *   }
   * }
   * ```
   *
   * 示例（Matryoshka 截断到 1024d + Ollama fallback）:
   * ```json
   * { "perceptionConfig": {
   *     "engineType": "ollama",
   *     "modelId": "qwen3-embedding:8b",
   *     "dimension": 1024,
   *     "endpoint": "http://localhost:11434/v1",
   *     "fallbackEngineType": "candle",
   *     "fallbackModelId": "sentence-transformers/all-MiniLM-L6-v2"
   *   }
   * }
   * ```
   */
  perceptionConfig?: {
    engineType?: string;
    modelId?: string;
    dimension?: number;
    device?: string;
    autoDownload?: boolean;
    cacheDir?: string;
    // Phase-110: Remote embedding fields (Ollama/HTTP)
    endpoint?: string;
    apiKey?: string;
    timeoutSecs?: number;
    fallbackEngineType?: string;
    fallbackModelId?: string;
  };

  /**
   * Phase-52: 是否启用 Tantivy BM25 全文搜索
   *
   * 启用后，SocialGraphV2 将初始化 Tantivy 索引，
   * 支持三路混合搜索 (vector + BM25 + graph)。
   * 需要 aifastdb >= 2.9.0（含 full-text-search feature）。
   *
   * 在 .devplan/config.json 中配置：
   * ```json
   * { "enableTextSearch": true }
   * ```
   */
  enableTextSearch?: boolean;

  /**
   * Phase-54: 是否启用 LLM Reranking（搜索结果精排）
   *
   * 启用后，searchSectionsAdvanced 和 recallMemory 的搜索结果
   * 会经过 LLM 语义重排，提升相关性。需要本地 Ollama 或其他 LLM 服务。
   *
   * ⚠️ 优雅降级：Ollama 不可用时自动跳过重排，返回原始 RRF 排序结果。
   *
   * 在 .devplan/config.json 中配置：
   * ```json
   * {
   *   "enableReranking": true,
   *   "rerankModel": "gemma3:4b",
   *   "rerankBaseUrl": "http://localhost:11434/v1"
   * }
   * ```
   */
  enableReranking?: boolean;

  /**
   * Phase-54: LLM Reranking 使用的模型名称
   *
   * 默认 "gemma3:4b"（轻量快速，适合重排任务）。
   */
  rerankModel?: string;

  /**
   * Phase-54: LLM 服务的 Base URL
   *
   * 默认 "http://localhost:11434/v1"（本地 Ollama）。
   */
  rerankBaseUrl?: string;

  /**
   * Phase-57B: LLM 分析提供者配置
   *
   * 控制 devplan_llm_analyze 工具使用的 LLM 后端。
   * 通过 `engine` 参数一键切换分析模式，切换时只需修改此字段。
   *
   * engine 可选值：
   * - `"cursor"` — 由 Cursor 自己完成分析（devplan_llm_analyze 返回 engine=cursor 提示）
   * - `"ollama"` — 通过 LlmGateway 连接本机 Ollama（免费，需运行 Ollama）
   * - `"models_online"` — 通过 LlmGateway 连接在线模型（DeepSeek 等，需 API Key）
   *
   * 在 .devplan/config.json 中配置：
   * ```json
   * {
   *   "llmAnalyze": {
   *     "engine": "models_online",
   *     "ollamaModel": "gemma3:27b",
   *     "ollamaBaseUrl": "http://localhost:11434/v1",
   *     "onlineProvider": "deepseek",
   *     "onlineModel": "deepseek-chat",
   *     "onlineBaseUrl": "https://api.deepseek.com/v1",
   *     "onlineApiKey": "sk-..."
   *   }
   * }
   * ```
   *
   * 切换到 Ollama：只需改 `"engine": "ollama"`
   * 切换到 Cursor：只需改 `"engine": "cursor"`
   * 不配置 llmAnalyze：默认 engine="cursor"
   */
  llmAnalyze?: {
    /**
     * 分析引擎选择（一键切换）
     * - "cursor": Cursor 自己分析（不调用 LLM，工具返回提示）
     * - "ollama": LlmGateway → 本机 Ollama
     * - "models_online": LlmGateway → 在线模型（DeepSeek 等）
     * 默认: "cursor"
     */
    engine?: 'cursor' | 'ollama' | 'models_online';

    // ---- Ollama 配置 ----
    /** 本机 Ollama 模型（默认 "gemma3:27b"） */
    ollamaModel?: string;
    /** 本机 Ollama API 地址（默认 "http://localhost:11434/v1"） */
    ollamaBaseUrl?: string;

    // ---- 在线模型配置 ----
    /** 在线提供者标识：deepseek / openai / 自定义（默认 "deepseek"） */
    onlineProvider?: string;
    /** 在线模型名称（默认 "deepseek-chat"） */
    onlineModel?: string;
    /** 在线 API Base URL（默认 "https://api.deepseek.com/v1"） */
    onlineBaseUrl?: string;
    /** 在线 API Key（首次注册后持久化到 LlmGateway store） */
    onlineApiKey?: string;
    /** 协议类型：openai_compat（默认） / anthropic */
    onlineProtocol?: string;
  };

  /** Git 操作的工作目录（多项目路由时指向项目根目录，默认 process.cwd()） */
  gitCwd?: string;
}

/**
 * 语义搜索模式
 */
export type SearchMode = 'literal' | 'semantic' | 'hybrid';

/**
 * 带评分的文档搜索结果
 */
export interface ScoredDevPlanDoc extends DevPlanDoc {
  /** 相关性评分（0~1），literal 模式不提供 */
  score?: number;
}

/**
 * 重建索引结果
 */
export interface RebuildIndexResult {
  /** 文档总数 */
  total: number;
  /** 成功索引数 */
  indexed: number;
  /** 失败数 */
  failed: number;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 失败的文档 ID（如果有） */
  failedDocIds?: string[];
}

// ============================================================================
// Document Tree Types
// ============================================================================

/**
 * 文档树节点 — 递归结构，包含文档及其所有子文档
 */
export interface DevPlanDocTree {
  /** 当前文档 */
  doc: DevPlanDoc;
  /** 子文档树 */
  children: DevPlanDocTree[];
}

// ============================================================================
// Graph Export Types
// ============================================================================

/**
 * 图谱导出的节点
 */
export interface DevPlanGraphNode {
  /** 节点 ID */
  id: string;
  /** 节点名称 */
  label: string;
  /** 节点类型 */
  type: 'project' | 'main-task' | 'sub-task' | 'document' | 'module' | 'prompt' | 'memory';
  /** 节点度数（连接边数量），由后端导出时计算 */
  degree?: number;
  /** 节点属性 */
  properties?: Record<string, unknown>;
}

/**
 * 图谱导出的边
 */
export interface DevPlanGraphEdge {
  /** 源节点 ID */
  from: string;
  /** 目标节点 ID */
  to: string;
  /** 关系类型 */
  label: string;
  /** 附加属性（如 MEMORY_RELATES 的 similarity weight） */
  properties?: Record<string, any>;
}

/**
 * DevPlan 图谱导出结果
 */
export interface DevPlanExportedGraph {
  /** 所有节点 */
  nodes: DevPlanGraphNode[];
  /** 所有边 */
  edges: DevPlanGraphEdge[];
}

/**
 * DevPlan 分页图谱导出结果 (Phase-9)
 */
export interface DevPlanPaginatedGraph {
  /** 当前页的节点 */
  nodes: DevPlanGraphNode[];
  /** 当前页节点的相关边 */
  edges: DevPlanGraphEdge[];
  /** 节点总数 */
  totalNodes: number;
  /** 边总数 */
  totalEdges: number;
  /** 偏移量 */
  offset: number;
  /** 每页大小 */
  limit: number;
  /** 是否还有更多数据 */
  hasMore: boolean;
}

/**
 * 实体组聚合摘要 (Phase-9)
 */
export interface EntityGroupSummary {
  /** 实体类型名称 */
  entityType: string;
  /** 该类型的实体数量 */
  count: number;
  /** 样本 ID (最多 5 个) */
  sampleIds: string[];
}

/**
 * 完整聚合结果 (Phase-9)
 */
export interface EntityGroupAggregation {
  /** 按类型分组的摘要列表 */
  groups: EntityGroupSummary[];
  /** 所有类型的总实体数 */
  totalEntities: number;
  /** 总关系数 */
  totalRelations: number;
}

// ============================================================================
// Constants
// ============================================================================

// ============================================================================
// Autopilot Types
// ============================================================================

/** Autopilot 自动化配置 */
export interface AutopilotConfig {
  /** 是否启用 autopilot */
  enabled: boolean;
  /** executor 轮询间隔（秒） */
  pollIntervalSeconds: number;
  /** 阶段完成后自动启动下一个 */
  autoStartNextPhase: boolean;
  /** 发送"请继续"的最大连续重试次数 */
  maxContinueRetries: number;
  /** 子任务卡住超时时间（分钟） */
  stuckTimeoutMinutes: number;
}

/** Autopilot 下一步动作类型 */
export type AutopilotAction =
  | 'send_task'       // 发送新的子任务内容给 Cursor
  | 'send_continue'   // 发送"请继续"（AI 被中断/限速）
  | 'start_phase'     // 启动新阶段
  | 'wait'            // 等待（任务进行中，无需操作）
  | 'all_done';       // 全部任务完成

/** Autopilot 动作建议 */
export interface AutopilotNextAction {
  action: AutopilotAction;
  phase?: {
    taskId: string;
    title: string;
    status: TaskStatus;
    totalSubtasks: number;
    completedSubtasks: number;
  };
  subTask?: {
    taskId: string;
    title: string;
    description?: string;
    status: TaskStatus;
  };
  message: string;
}

/** Autopilot 执行状态 */
export interface AutopilotStatus {
  hasActivePhase: boolean;
  activePhase?: {
    taskId: string;
    title: string;
    totalSubtasks: number;
    completedSubtasks: number;
    percent: number;
  };
  currentSubTask?: {
    taskId: string;
    title: string;
    status: TaskStatus;
  };
  nextPendingSubTask?: {
    taskId: string;
    title: string;
  };
  nextPendingPhase?: {
    taskId: string;
    title: string;
    priority: string;
  };
  remainingPhases: number;
}

/** Executor 心跳数据 */
export interface ExecutorHeartbeat {
  executorId: string;
  status: 'active' | 'paused' | 'stopped';
  lastScreenState?: string;
  timestamp: number;
}

// ============================================================================
// Prompt Types (用户 Prompt 日志)
// ============================================================================

/**
 * Prompt 输入
 */
export interface PromptInput {
  /** 项目名称 */
  projectName: string;
  /** 用户在 Cursor 对话框中输入的原始内容（逐字复制，不做任何修改） */
  content: string;
  /** AI 对用户输入的理解和解读（可选，AI 用自己的话描述用户想做什么） */
  aiInterpretation?: string;
  /** AI 生成的摘要（可选，简要描述做了什么） */
  summary?: string;
  /** 关联的主任务 ID（可选） */
  relatedTaskId?: string;
  /** 自定义标签（可选） */
  tags?: string[];
}

/**
 * 存储的 Prompt
 */
export interface Prompt {
  /** 文档 ID (图引擎实体 ID) */
  id: string;
  /** 项目名称 */
  projectName: string;
  /** 自增序号（当天内序号） */
  promptIndex: number;
  /** 用户在 Cursor 对话框中输入的原始内容（逐字复制） */
  content: string;
  /** AI 对用户输入的理解和解读 */
  aiInterpretation?: string;
  /** AI 生成的摘要 */
  summary?: string;
  /** 关联的主任务 ID */
  relatedTaskId?: string;
  /** 自定义标签 */
  tags?: string[];
  /** 创建时间 */
  createdAt: number;
}

// ============================================================================
// Memory Types (Cursor 长期记忆)
// ============================================================================

/**
 * 记忆类型 — 对标 ai_db LLM Gateway 的三层记忆
 *
 * | memoryType | ai_db 对标 | 说明 |
 * |---|---|---|
 * | decision  | memory_semantic (决策类) | 架构/设计决策及理由 |
 * | pattern   | memory_semantic (模式类) | 代码模式、命名约定、项目结构偏好 |
 * | bugfix    | memory_semantic (修复类) | Bug 模式和修复方案 |
 * | insight   | memory_semantic (洞察类) | 开发经验和技术洞察 |
 * | preference| memory_profile           | 用户偏好和项目约定 |
 * | summary   | memory_summary           | 会话/阶段摘要 |
 */
export type MemoryType =
  | 'decision'    // 架构/设计决策及理由
  | 'pattern'     // 代码模式、命名约定
  | 'bugfix'      // Bug 模式和修复方案
  | 'insight'     // 开发经验和技术洞察
  | 'preference'  // 用户偏好和项目约定
  | 'summary';    // 会话/阶段摘要

/**
 * 记忆输入
 */
export interface MemoryInput {
  /** 项目名称 */
  projectName: string;
  /** 记忆类型 */
  memoryType: MemoryType;
  /** 记忆内容（Markdown 支持） */
  content: string;
  /** 自定义标签 */
  tags?: string[];
  /** 关联的主任务 ID（可选） */
  relatedTaskId?: string;
  /** 重要性 (0~1，默认 0.5) */
  importance?: number;
  /**
   * 记忆来源 ID（可选）— 用于批量生成记忆时追踪已处理的候选项
   *
   * 格式约定：
   * - 任务来源: taskId (如 "phase-7")
   * - 文档来源: "section" 或 "section|subSection" (如 "overview", "technical_notes|security")
   *
   * generateMemoryCandidates 通过此字段去重，确保同一来源不会重复生成候选项。
   */
  sourceId?: string;
  /**
   * 关联的模块 ID（可选）— Phase-37 新增
   *
   * 当指定 moduleId 时，自动建立 MODULE_MEMORY 关系，
   * 让记忆融入模块级知识图谱。
   */
  moduleId?: string;

  /**
   * 记忆分解模式（可选）— Phase-47 新增
   *
   * 启用后，content 会通过 Rust 层记忆树分解器拆解为
   * Episode + Entities + Relations 子图，而非单一实体存储。
   *
   * - `false` (默认): 传统单实体存储（向后兼容）
   * - `'rule'`: 使用内置规则分解器（RuleBasedDecomposer）
   * - `'llm'`: 返回 LLM 提示模板，外部 LLM 生成 JSON 后用
   *            memoryTreeParseLlmDecomposition 解析
   * - `true`: 等同于 `'rule'`
   */
  decompose?: boolean | 'rule' | 'llm';

  /**
   * LLM 分解结果 JSON（仅当 decompose='llm' 时使用）— Phase-47 新增
   *
   * 外部 LLM 生成的分解 JSON 字符串，配合 decompose='llm' 使用。
   * 如果提供了此字段，将直接调用 memoryTreeParseLlmDecomposition 解析。
   */
  llmDecompositionJson?: string;

  /**
   * 分解上下文（可选）— Phase-47 新增
   *
   * 为分解器提供额外上下文信息，帮助更准确地分解记忆内容。
   * 例如: 当前任务描述、项目背景等。
   */
  decomposeContext?: string;

  // ---- Phase-57: 三维记忆 Anchor / Flow / Structure ----

  /**
   * 触点名称（可选）— Phase-57 新增
   *
   * 显式指定记忆关联的触点（Anchor）名称。
   * 如果不提供，saveMemory 会使用 AnchorExtractor 从 content 中自动提取。
   */
  anchorName?: string;

  /**
   * 触点类型（可选）— Phase-57 新增
   *
   * 触点分类：module | concept | api | architecture | feature | library | protocol
   * 不提供时默认为 'concept'。
   */
  anchorType?: string;

  /**
   * 触点概览（可选）— Phase-63 新增
   *
   * L2 目录索引层，类似 OpenViking 的 `.overview.md`。
   * 3~5 句话的目录索引式摘要，列出该触点的关键子项、核心 Flow 条目、
   * 主要结构组件等。帮助 Agent 快速判断是否需要深入查看触点详情。
   *
   * 在批量导入中由 LLM 自动生成。
   */
  anchorOverview?: string;

  /**
   * 变更类型（可选）— Phase-57 新增
   *
   * 描述此记忆对应的变更性质：
   * - 'created': 新功能/概念首次出现
   * - 'upgraded': 功能升级/增强
   * - 'modified': 小修改/调整
   * - 'removed': 功能移除
   * - 'deprecated': 功能弃用
   *
   * 不提供时默认为 'modified'。
   */
  changeType?: string;

  /**
   * 结构组件列表（可选）— Phase-57 新增
   *
   * 当记忆描述的功能由多个子组件组成时，可以指定其结构。
   * 每个组件引用一个已有的 Anchor ID + 角色。
   * 示例: [{ anchorId: "xxx", role: "core", versionHint: "v2" }]
   */
  structureComponents?: Array<{
    anchorId: string;
    role: string;
    versionHint?: string;
  }>;

  // ---- Phase-58: Claude Skills 三层内容分离 ----

  /**
   * L1 触点摘要（可选）— Phase-58 新增
   *
   * 一句话概括，作为记忆的"入口"触点描述（~50字）。
   * 用于 Anchor.description 字段。
   * 如果不提供，从 content 前 100 字符截取。
   */
  contentL1?: string;

  /**
   * L2 详细记忆（可选）— Phase-58 新增
   *
   * 3~5句话，包含关键技术细节、设计决策、API 签名等（~500字）。
   * 用于 FlowEntry.detail 字段和向量索引。
   * 如果不提供，使用 content 全文。
   */
  contentL2?: string;

  /**
   * L3 完整内容（可选）— Phase-58 新增
   *
   * 原始文档全文或近全文内容（~5000字）。
   * 存储在 Memory 实体的 contentL3 属性中，供深度检索和引用。
   * 如果不提供，不额外存储 L3 内容。
   */
  contentL3?: string;
}

/**
 * 存储的记忆
 */
export interface Memory {
  /** 记忆 ID (图引擎实体 ID) */
  id: string;
  /** 项目名称 */
  projectName: string;
  /** 记忆类型 */
  memoryType: MemoryType;
  /** 记忆内容 */
  content: string;
  /** 自定义标签 */
  tags?: string[];
  /** 关联的主任务 ID */
  relatedTaskId?: string;
  /** 重要性 (0~1) */
  importance: number;
  /** 访问次数（每次 recall 命中 +1） */
  hitCount: number;
  /** 最后访问时间 */
  lastAccessedAt: number | null;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /**
   * 记忆来源 ID — 追踪该记忆由哪个文档/任务生成
   *
   * 格式：taskId (如 "phase-7") 或 "section|subSection" (如 "overview", "technical_notes|security")
   */
  sourceId?: string;

  /**
   * Phase-47: 分解结果摘要（当使用 decompose 模式时返回）
   *
   * 包含分解后的 episode ID、实体数、关系数等统计。
   * 仅当 saveMemory 调用时启用了 decompose 选项时有值。
   */
  decomposition?: {
    /** Episode 根实体 ID */
    episodeId: string;
    /** 分解出的实体数量 */
    entitiesStored: number;
    /** 分解出的关系数量 */
    relationsStored: number;
    /** 已索引的向量数量 */
    vectorsIndexed: number;
    /** 检测到的冲突数量 */
    conflictsDetected: number;
  };

  /**
   * Phase-51: 冲突检测结果（saveMemory 后自动运行）
   *
   * 当新记忆与已有记忆存在语义矛盾或替代关系时，
   * Rust 层 memoryTreeDetectConflicts 自动建立 SUPERSEDES/CONFLICTS 关系，
   * 并将冲突信息返回给 AI 供决策。
   */
  conflicts?: Array<{
    /** 已有记忆实体 ID */
    existingEntityId: string;
    /** 语义相似度 (0~1) */
    similarity: number;
    /** 冲突类型: supersedes（新记忆替代旧记忆）/ contradicts（互相矛盾）/ supplements（补充） */
    conflictType: string;
    /** 自动创建的关系 ID（如有） */
    relationCreated?: string;
  }>;

  // ---- Phase-58: Claude Skills 三层内容 ----

  /**
   * L3 完整内容（Phase-58 新增）
   *
   * 当 saveMemory 提供 contentL3 时存储在此字段。
   * 原始文档全文或近全文内容，供深度检索和引用。
   */
  contentL3?: string;

  // ---- Phase-57: 三维记忆 Anchor / Flow / Structure ----

  /**
   * 关联的触点信息（当 saveMemory 自动/手动触发触点关联时返回）
   */
  anchorInfo?: {
    /** Anchor 实体 ID */
    id: string;
    /** 触点名称 */
    name: string;
    /** 触点类型 */
    anchorType: string;
    /** 描述 (L1 层) */
    description: string;
    /**
     * L2 目录索引概览（Phase-124 新增，借鉴 OpenViking .overview.md）
     *
     * 3~5 句话的目录索引式摘要，列出关键子项、核心流程入口和结构组件。
     * 帮助 Agent 快速决定是否需要深入加载 L3 详情。
     * `null` 表示尚未生成 overview。
     */
    overview?: string | null;
    /** 当前版本 */
    version: number;
    /** 是否为新创建的触点（saveMemory 时返回） */
    isNew?: boolean;
    /** 记忆流条目数量（recallMemory 时返回） */
    flowCount?: number;
  };

  /**
   * 关联的记忆流条目（当追加到记忆流时返回）
   */
  flowEntry?: {
    /** FlowEntry 实体 ID */
    id: string;
    /** 版本号 */
    version: number;
    /** 变更类型 */
    changeType: string;
    /** 摘要 */
    summary: string;
  };

  /**
   * 结构快照 ID（当创建了结构快照时返回）
   */
  structureSnapshotId?: string;
}

// ============================================================================
// Phase-124: 分层召回 + 范围限定检索 (借鉴 OpenViking L0/L1/L2 渐进加载)
// ============================================================================

/**
 * 分层召回深度（Phase-124 新增）
 *
 * 借鉴 OpenViking 的 L0/L1/L2 分层上下文加载策略，
 * 控制 `recallMemory` 返回的信息层级，减少 Token 消耗。
 *
 * - `"L1"` (默认): 摘要层 — 仅返回记忆内容 + Anchor.description + Anchor.overview。
 *   Token 消耗 ~30/条。适用于导航、发现阶段。
 *
 * - `"L2"`: 详情层 — 额外返回 FlowEntry 列表（每条含 summary + detail）。
 *   Token 消耗 ~200/条。适用于需要了解演进历史时。
 *
 * - `"L3"`: 完整层 — 额外返回 Structure Snapshot（组件组合关系）。
 *   Token 消耗 ~500/条。适用于需要完整上下文时。
 *
 * Token 节省估算：100 条记忆的 L1 摘要 ~3000 token vs L3 完整 ~50000 token ≈ 16x 节省
 */
export type RecallDepth = 'L1' | 'L2' | 'L3';

/**
 * 文档检索策略（Phase-125 新增）
 *
 * 控制 recallMemory 如何检索相关文档：
 *
 * - `"vector"` (默认): 传统模式 — 对文档库独立执行向量搜索，与记忆搜索并行，结果 RRF 融合。
 *   全量搜索，token 消耗较高但覆盖面广。
 *
 * - `"guided"`: 记忆驱动模式 — 先召回记忆，再基于记忆中的图谱关系（MEMORY_FROM_DOC、
 *   TASK_HAS_DOC、MODULE_HAS_DOC）反向遍历找到关联文档。精准、token 省，每篇文档
 *   附带 guidedReason 说明选取理由。如果图遍历结果为空，自动降级到 vector 模式。
 *
 * - `"none"`: 不检索文档（等价于 includeDocs=false）。
 *
 * @example
 * ```typescript
 * // 传统全量搜索（向后兼容）
 * recallMemory(query, { docStrategy: 'vector' })
 *
 * // 记忆驱动精准检索
 * recallMemory(query, { docStrategy: 'guided' })
 *
 * // 仅搜索记忆，不返回文档
 * recallMemory(query, { docStrategy: 'none' })
 * ```
 */
export type DocStrategy = 'vector' | 'guided' | 'none';

/**
 * 范围限定检索（Phase-124 新增）
 *
 * 参考 OpenViking 的 `target_uri` 限制检索范围，
 * 避免返回与当前任务无关的记忆，提高检索精度。
 *
 * 多个 scope 条件为 AND 关系（全部满足才返回）。
 * 不提供 scope 时搜索全部记忆。
 *
 * @example
 * ```typescript
 * // 只搜索 vector-store 模块相关的记忆
 * recallMemory(query, { scope: { moduleId: 'vector-store' } })
 *
 * // 只搜索 phase-14 相关的记忆
 * recallMemory(query, { scope: { taskId: 'phase-14' } })
 *
 * // 只搜索 API 类型触点关联的记忆
 * recallMemory(query, { scope: { anchorType: 'api' } })
 *
 * // 组合: vector-store 模块 + api 类型
 * recallMemory(query, { scope: { moduleId: 'vector-store', anchorType: 'api' } })
 * ```
 */
export interface RecallScope {
  /**
   * 按模块 ID 过滤（通过 MODULE_MEMORY 关系匹配）
   *
   * 只返回属于指定模块的记忆。
   * 模块通过 `devplan_memory_save` 的 `moduleId` 参数关联。
   */
  moduleId?: string;

  /**
   * 按主任务 ID 过滤（通过 relatedTaskId 属性匹配）
   *
   * 只返回与指定主任务关联的记忆。
   */
  taskId?: string;

  /**
   * 按触点类型过滤（通过 anchored_by 关系 + Anchor.anchor_type 匹配）
   *
   * 可选值: module | concept | api | architecture | feature | library | protocol
   */
  anchorType?: string;

  /**
   * 按触点名称过滤（通过 anchored_by 关系 + Anchor.name 匹配）
   *
   * 精确匹配指定触点关联的记忆。
   */
  anchorName?: string;
}

/**
 * 带评分的记忆召回结果
 */
export interface ScoredMemory extends Memory {
  /** 相关性评分 (0~1) */
  score: number;
  /** 来源类型（统一召回时区分 memory / doc） */
  sourceKind?: 'memory' | 'doc';
  /** 当 sourceKind='doc' 时，文档的 section */
  docSection?: string;
  /** 当 sourceKind='doc' 时，文档的 subSection */
  docSubSection?: string;
  /** 当 sourceKind='doc' 时，文档标题 */
  docTitle?: string;

  // ---- Phase-125: 记忆驱动文档检索 ----
  /**
   * 当 docStrategy='guided' 时，说明该文档被选取的理由。
   * 每条理由描述一条图遍历路径（如 "记忆 X 的来源文档"、"与任务 phase-7 同属"）。
   */
  guidedReasons?: string[];

  // ---- Phase-57: 三维记忆召回增强 ----
  // anchorInfo 继承自 Memory（不重定义）

  /**
   * 记忆流条目（L2 层：该触点的演进历史，最近 N 条）
   * 仅在 recallMemory 层级下钻时填充。
   */
  flowEntries?: Array<{
    id: string;
    version: number;
    changeType: string;
    summary: string;
    detail: string;
    sourceTask?: string;
    createdAt: number;
  }>;

  /**
   * 结构快照（L3 层：该触点当前的组成结构）
   * 仅在 recallMemory 层级下钻时填充。
   */
  structureSnapshot?: {
    id: string;
    version: number;
    components: Array<{
      anchorId: string;
      role: string;
      versionHint?: string;
    }>;
  };
}

/**
 * 记忆上下文 — 新会话启动时的综合上下文
 */
export interface MemoryContext {
  /** 项目名称 */
  projectName: string;
  /** 最近的进行中/已完成主任务 */
  recentTasks: Array<{
    taskId: string;
    title: string;
    status: TaskStatus;
    completedAt?: number | null;
  }>;
  /** 与查询相关的记忆（按相关性排序，统一召回含文档） */
  relevantMemories: ScoredMemory[];
  /** 项目偏好/约定 (memoryType=preference) */
  projectPreferences: Memory[];
  /** 最近的决策记忆 (memoryType=decision) */
  recentDecisions: Memory[];
  /** 总记忆数 */
  totalMemories: number;
  /** 关键文档摘要（overview / core_concepts 等自动纳入） */
  relatedDocs?: Array<{
    section: string;
    subSection?: string;
    title: string;
    /** 内容摘要（截取前 N 字符） */
    summary: string;
  }>;
  /**
   * Phase-38: 模块级关联记忆 — 通过图谱遍历 in_progress 任务 → 模块 → MODULE_MEMORY 获取
   *
   * 当存在进行中的任务时，自动沿图谱关系链路获取对应模块的记忆，
   * 为 AI 提供当前工作上下文的深层知识。
   */
  moduleMemories?: Array<{
    moduleId: string;
    moduleName: string;
    memories: Memory[];
  }>;
  /**
   * Phase-40: 记忆主题集群概览 — 基于 MEMORY_RELATES 连通分量自动聚类
   *
   * 提供记忆网络的主题结构鸟瞰，帮助 AI 快速理解项目知识分布。
   * 仅包含集群主题和大小信息（不含完整记忆内容，避免上下文爆炸）。
   */
  memoryClusters?: Array<{
    clusterId: number;
    theme: string;
    memoryCount: number;
    topMemoryTypes: string[];
  }>;

  /**
   * Phase-57: 触点索引 — 项目中已注册的记忆触点列表
   *
   * 触点（Anchor）是记忆系统中同一实体的唯一标识/入口，
   * 每个触点关联一个记忆流（Memory Flow）记录实体的演变历程。
   * 帮助 AI 快速了解项目中有哪些核心概念/模块/功能已被跟踪。
   */
  anchorIndex?: Array<{
    /** 触点 ID */
    id: string;
    /** 触点名称 */
    name: string;
    /** 触点类型 (module | concept | api | architecture | feature 等) */
    type: string;
    /** 触点描述 */
    description: string;
    /** 当前版本号 */
    version: number;
    /** 状态 (active | deprecated | removed) */
    status: string;
    /** 关联的记忆流条目数 */
    flowCount: number;
  }>;

  /**
   * Phase-57: 结构概览 — 项目核心实体的组成结构快照
   *
   * 展示关键触点（如 feature/module 类型）的当前结构组成，
   * 帮助 AI 理解各模块的依赖和组件关系。
   */
  structureOverview?: Array<{
    /** 触点名称 */
    anchorName: string;
    /** 触点类型 */
    anchorType: string;
    /** 当前结构版本 */
    version: number;
    /** 组件列表 */
    components: Array<{
      /** 组件触点 ID */
      anchorId: string;
      /** 组件角色 (core | dependency | plugin 等) */
      role: string;
      /** 版本提示 */
      versionHint?: string;
    }>;
  }>;
}

// ============================================================================
// Memory Generation Types (从文档/任务提取记忆)
// ============================================================================

/**
 * 记忆候选项 — 从已有文档或任务中聚合的原始数据
 *
 * MCP 工具返回候选项，AI 分析后调用 devplan_memory_save 批量生成记忆。
 */
export interface MemoryCandidate {
  /** 来源类型 */
  sourceType: 'task' | 'document';
  /** 来源 ID (taskId 或 section|subSection) */
  sourceId: string;
  /** 来源标题 */
  sourceTitle: string;
  /** 聚合的内容（任务: phase 标题+子任务列表; 文档: 标题+内容摘要） */
  content: string;
  /** 建议的记忆类型 */
  suggestedMemoryType: MemoryType;
  /** 建议的重要性 (0~1) */
  suggestedImportance: number;
  /** 建议的标签 */
  suggestedTags: string[];
  /** 此来源是否已有关联记忆 */
  hasExistingMemory: boolean;

  // ---- Phase-44: Memory Tree 子图建议 ----
  /**
   * 建议的关系列表 — 引导 AI 在生成记忆时同时建立子图结构
   *
   * AI 可在 devplan_memory_save 后使用 applyMutations 批量创建这些关系。
   * 每条建议包含 relationType（如 memory_relates）和 targetSourceId（目标候选项的 sourceId）。
   */
  suggestedRelations?: Array<{
    /** 关系类型 */
    relationType: string;
    /** 目标候选项的 sourceId（AI 保存后需替换为实际 entity ID） */
    targetSourceId: string;
    /** 建议的关系权重 */
    weight?: number;
    /** 关系说明 */
    reason?: string;
  }>;

  // ---- Phase-57: 三维记忆触点匹配建议 ----

  /**
   * 建议的触点名称（从内容中自动提取或匹配已有触点）
   *
   * AI 在调用 devplan_memory_save 时可将此值传入 anchorName 参数。
   */
  suggestedAnchor?: string;

  /**
   * 建议的触点类型（module | concept | api | architecture | feature 等）
   */
  suggestedAnchorType?: string;

  /**
   * 建议的变更类型（created | upgraded | modified | removed | deprecated）
   *
   * 基于是否已有同名触点来判断：
   * - 无已有触点 → 'created'
   * - 有已有触点 → 'modified' 或 'upgraded'（根据内容推断）
   */
  suggestedChangeType?: string;

  /**
   * 是否已有同名触点（帮助 AI 判断是新功能还是升级）
   */
  hasExistingAnchor?: boolean;

  // ---- Phase-58: Claude Skills 三层差异化内容 ----

  /**
   * Phase-58: 原始文档的完整内容（用于 LLM 分层生成）
   *
   * 对于文档来源，这是完整的文档内容（不截断）。
   * 对于任务来源，这是聚合的任务+子任务内容。
   * AI 可将此传入 devplan_memory_save 的 contentL3 参数。
   */
  contentL3?: string;

  /**
   * Phase-58: Claude Skills 指令 — 指导 AI 如何生成 L1/L2/L3 内容
   *
   * 包含针对不同层级的 Prompt 模板或具体指令，
   * 供 AI 在调用 devplan_llm_analyze 时使用。
   */
  skillInstructions?: {
    /** L1 触点摘要生成指令 */
    l1Prompt?: string;
    /** L2 详细记忆生成指令 */
    l2Prompt?: string;
    /** L3 结构化摘要生成指令 */
    l3Prompt?: string;
  };
}

/**
 * 记忆生成结果
 */
export interface MemoryGenerateResult {
  /** 候选项列表 */
  candidates: MemoryCandidate[];
  /** 统计摘要 */
  stats: {
    /** 已完成阶段总数 */
    totalCompletedPhases: number;
    /** 文档总数 */
    totalDocuments: number;
    /** 已有记忆的阶段数 */
    phasesWithMemory: number;
    /** 已有记忆的文档数 */
    docsWithMemory: number;
    /** 因已有记忆而被跳过的候选项数 */
    skippedWithMemory: number;
    /** 返回的候选项数（已排除有记忆的） */
    candidatesReturned: number;
    /** 超出 limit 但仍有待处理的候选项数（用于 AI 批量工作流判断是否需继续） */
    remaining: number;
  };
}

/** Autopilot 配置的默认值 */
export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
  enabled: false,
  pollIntervalSeconds: 15,
  autoStartNextPhase: true,
  maxContinueRetries: 5,
  stuckTimeoutMinutes: 30,
};

// ============================================================================
// Constants
// ============================================================================

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
