import type { DevPlanSection } from './types';

/** Entity 类型常量 */
export const ET = {
  PROJECT: 'devplan-project',
  DOC: 'devplan-doc',
  MAIN_TASK: 'devplan-main-task',
  SUB_TASK: 'devplan-sub-task',
  MODULE: 'devplan-module',
  PROMPT: 'devplan-prompt',
  MEMORY: 'devplan-memory',
} as const;

/** Relation 类型常量 */
export const RT = {
  HAS_DOCUMENT: 'has_document',
  HAS_MAIN_TASK: 'has_main_task',
  HAS_SUB_TASK: 'has_sub_task',
  HAS_MODULE: 'has_module',
  MODULE_HAS_TASK: 'module_has_task',
  MODULE_HAS_DOC: 'module_has_doc',
  TASK_HAS_DOC: 'task_has_doc',
  DOC_HAS_CHILD: 'doc_has_child',
  TASK_HAS_PROMPT: 'task_has_prompt',
  HAS_PROMPT: 'has_prompt',
  HAS_MEMORY: 'has_memory',
  MEMORY_FROM_TASK: 'memory_from_task',
  // ---- Phase-37: 记忆网络关系类型 ----
  /** 记忆 ↔ 记忆 语义关联（双向，带 similarity score 权重） */
  MEMORY_RELATES: 'memory_relates',
  /** 文档 → 记忆 来源关系（从文档提取的记忆） */
  MEMORY_FROM_DOC: 'memory_from_doc',
  /** 模块 → 记忆 归属关系（模块级记忆） */
  MODULE_MEMORY: 'module_memory',
  /** 记忆 → 记忆 替代/演化关系（新记忆替代旧记忆） */
  MEMORY_SUPERSEDES: 'memory_supersedes',
  /** 记忆 → 记忆 冲突关系（两条记忆互相矛盾，如 decision 冲突） */
  MEMORY_CONFLICTS: 'memory_conflicts',
} as const;

export type ResolvedRecallSearchTuning = {
  rrfK: number;
  vectorWeight: number;
  bm25Weight: number;
  graphWeight: number;
  bm25TermBoost: number;
  bm25DomainTerms: string[];
  bm25UserDictPath?: string;
};

/** 触点类型常量 */
export const ANCHOR_TYPES = {
  MODULE: 'module',
  CONCEPT: 'concept',
  API: 'api',
  ARCHITECTURE: 'architecture',
  FEATURE: 'feature',
  LIBRARY: 'library',
  PROTOCOL: 'protocol',
} as const;

/** 变更类型常量 */
export const CHANGE_TYPES = {
  CREATED: 'created',
  UPGRADED: 'upgraded',
  MODIFIED: 'modified',
  REMOVED: 'removed',
  DEPRECATED: 'deprecated',
} as const;

/** 触点信息（对应 Rust AnchorInfo） */
export interface NativeAnchorInfo {
  id: string;
  name: string;
  anchor_type: string;
  description: string;
  uri?: string;
  path?: string;
  /** L2 目录索引概览（Phase-63，inspired by OpenViking .overview.md） */
  overview?: string;
  version: number;
  status: string;
  flow_count: number;
  created_at: number;
  updated_at: number;
}

/** 记忆流条目（对应 Rust FlowEntry） */
export interface NativeFlowEntry {
  id: string;
  anchor_id: string;
  version: number;
  change_type: string;
  summary: string;
  detail: string;
  source_task?: string;
  prev_entry_id?: string;
  created_at: number;
}

/** 记忆流查询过滤器 */
export interface NativeFlowFilter {
  changeType?: string;
  minVersion?: number;
  maxVersion?: number;
  limit?: number;
  newestFirst?: boolean;
}

/** 组件引用 */
export interface NativeComponentRef {
  anchorId: string;
  role: string;
  versionHint?: string;
}

/** 结构快照 */
export interface NativeStructureSnapshot {
  id: string;
  anchor_id: string;
  flow_entry_id: string;
  version: number;
  components: NativeComponentRef[];
  created_at: number;
}

/** 结构差异 */
export interface NativeStructureDiff {
  anchor_id: string;
  from_version: number;
  to_version: number;
  added: NativeComponentRef[];
  removed: NativeComponentRef[];
  changed: [NativeComponentRef, NativeComponentRef][];
  unchanged: NativeComponentRef[];
}

/** 提取的触点候选 */
export interface NativeExtractedAnchor {
  name: string;
  suggested_type: string;
  confidence: number;
  offset: number;
  matched_anchor?: NativeAnchorInfo;
}

export function sectionImportance(section: DevPlanSection): number {
  const m: Record<DevPlanSection, number> = {
    overview: 1.0, core_concepts: 0.95, api_design: 0.9,
    file_structure: 0.7, config: 0.7, examples: 0.6,
    technical_notes: 0.8, api_endpoints: 0.75, milestones: 0.85,
    changelog: 0.5, custom: 0.6,
  };
  return m[section] ?? 0.6;
}

/** 生成 section+subSection 的唯一 key */
export function sectionKey(section: string, subSection?: string): string {
  return subSection ? `${section}|${subSection}` : section;
}
