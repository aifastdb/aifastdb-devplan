/**
 * Phase-59: 分相批量记忆导入 — 缓存文件管理
 *
 * 将 LLM 生成的 L1/L2/L3 内容缓存到本地 JSON 文件，
 * 避免 gemma3 和 qwen3-embedding 反复交换。
 *
 * 缓存文件位置: .devplan/{project}/memory-batch-cache.json
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface BatchCacheEntry {
  /** 候选项的 sourceId (用于去重) */
  sourceId: string;
  /** 候选项来源类型 */
  sourceType: 'task' | 'doc';
  /** AI 提炼的记忆类型 */
  memoryType: string;
  /** L1 触点摘要（LLM 生成） */
  contentL1: string;
  /** L2 详细记忆（LLM 生成） */
  contentL2: string;
  /** L3 原始完整内容 */
  contentL3: string;
  /** 记忆主内容（用于 saveMemory 的 content 字段） */
  content: string;
  /** 重要性评分 */
  importance: number;
  /** 标签 */
  tags: string[];
  /** 关联任务 ID */
  relatedTaskId?: string;
  /** 触点名称 */
  anchorName?: string;
  /** 触点类型 */
  anchorType?: string;
  /** 触点概览（L2 目录索引，类似 OpenViking .overview.md） */
  anchorOverview?: string;
  /** 变更类型 */
  changeType?: string;
  /** 候选项的原始标题（用于日志） */
  title: string;
  /** Phase A 生成时间戳 */
  preparedAt: number;
  /** Phase B 是否已提交（保存完成） */
  committed: boolean;
  /** Phase B 提交时间戳 */
  committedAt?: number;
  /** 提交时的错误信息 */
  commitError?: string;
}

/** 精简版候选项（只保存必要字段，避免每次调用 generateMemoryCandidates） */
export interface CachedCandidate {
  sourceId: string;
  sourceType: 'task' | 'doc';
  title: string;
  content: string;
  contentL3?: string;
  suggestedMemoryType?: string;
  suggestedTags?: string[];
}

export interface BatchCacheFile {
  /** 缓存文件版本 */
  version: 1;
  /** 项目名 */
  projectName: string;
  /** Phase A 开始时间 */
  prepareStartedAt: number;
  /** Phase A 完成时间 */
  prepareCompletedAt?: number;
  /** Phase B 开始时间 */
  commitStartedAt?: number;
  /** Phase B 完成时间 */
  commitCompletedAt?: number;
  /** 使用的 LLM 引擎 */
  engine: string;
  /** 使用的 LLM 模型 */
  model: string;
  /** 缓存条目列表（已 LLM 生成的） */
  entries: BatchCacheEntry[];
  /** 全量候选项列表（首次扫描后缓存，后续调用直接复用） */
  candidates?: CachedCandidate[];
}

export interface BatchCacheStats {
  /** 缓存中总条目数 */
  totalEntries: number;
  /** 已提交（Phase B 完成） */
  committed: number;
  /** 未提交（等待 Phase B） */
  pending: number;
  /** 提交失败 */
  failed: number;
  /** Phase A 是否完成 */
  prepareCompleted: boolean;
  /** Phase B 是否完成 */
  commitCompleted: boolean;
  /** 使用的引擎/模型 */
  engine?: string;
  model?: string;
  /** 项目名 */
  projectName?: string;
}

// ============================================================================
// Cache File Operations
// ============================================================================

/**
 * 获取缓存文件路径
 */
export function getCachePath(basePath: string, projectName: string): string {
  return path.join(basePath, projectName, 'memory-batch-cache.json');
}

/**
 * 读取缓存文件，不存在则返回 null
 */
export function readBatchCache(cachePath: string): BatchCacheFile | null {
  try {
    if (!fs.existsSync(cachePath)) {
      return null;
    }
    const raw = fs.readFileSync(cachePath, 'utf-8');
    return JSON.parse(raw) as BatchCacheFile;
  } catch {
    return null;
  }
}

/**
 * 写入缓存文件（原子写入）
 */
export function writeBatchCache(cachePath: string, cache: BatchCacheFile): void {
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // 原子写入：先写临时文件再重命名
  const tmpPath = cachePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf-8');
  fs.renameSync(tmpPath, cachePath);
}

/**
 * 创建新缓存
 */
export function createBatchCache(
  projectName: string,
  engine: string,
  model: string,
): BatchCacheFile {
  return {
    version: 1,
    projectName,
    prepareStartedAt: Date.now(),
    engine,
    model,
    entries: [],
  };
}

/**
 * 追加条目到缓存
 */
export function appendEntry(cache: BatchCacheFile, entry: BatchCacheEntry): void {
  // 去重：同一 sourceId 不重复添加
  const existing = cache.entries.findIndex(e => e.sourceId === entry.sourceId);
  if (existing >= 0) {
    cache.entries[existing] = entry; // 更新
  } else {
    cache.entries.push(entry);
  }
}

/**
 * 获取缓存统计
 */
export function getCacheStats(cache: BatchCacheFile | null): BatchCacheStats {
  if (!cache) {
    return {
      totalEntries: 0,
      committed: 0,
      pending: 0,
      failed: 0,
      prepareCompleted: false,
      commitCompleted: false,
    };
  }

  const committed = cache.entries.filter(e => e.committed && !e.commitError).length;
  const failed = cache.entries.filter(e => e.committed && !!e.commitError).length;
  const pending = cache.entries.filter(e => !e.committed).length;

  return {
    totalEntries: cache.entries.length,
    committed,
    pending,
    failed,
    prepareCompleted: !!cache.prepareCompletedAt,
    commitCompleted: !!cache.commitCompletedAt,
    engine: cache.engine,
    model: cache.model,
    projectName: cache.projectName,
  };
}

/**
 * 删除缓存文件
 */
export function deleteBatchCache(cachePath: string): boolean {
  try {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
