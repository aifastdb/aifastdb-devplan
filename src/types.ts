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
  /** Git 操作的工作目录（多项目路由时指向项目根目录，默认 process.cwd()） */
  gitCwd?: string;
}

/**
 * DevPlanStore 配置（SocialGraphV2 模式）
 */
export interface DevPlanGraphStoreConfig {
  /** SocialGraphV2 数据目录路径 */
  graphPath: string;
  /** 分片数（0 = 自动） */
  shardCount?: number;
  /** 是否启用语义搜索（需要 VibeSynapse Embedding + SocialGraphV2 向量索引） */
  enableSemanticSearch?: boolean;
  /** Embedding 向量维度（默认 384，MiniLM-L6-v2） */
  embeddingDimension?: number;
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
  type: 'project' | 'main-task' | 'sub-task' | 'document' | 'module';
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
