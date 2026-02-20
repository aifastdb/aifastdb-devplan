/**
 * DevPlan 分片配置 — 单一数据源 (Single Source of Truth)
 *
 * 所有分片相关的配置集中在此文件。新增分片只需在 DEVPLAN_SHARDS 数组中添加一行，
 * shardCount、shardNames、typeShardMapping 等全部自动推导，避免多处硬编码不同步。
 *
 * 使用示例：
 * ```ts
 * import {
 *   DEVPLAN_SHARD_COUNT,
 *   DEVPLAN_SHARD_NAMES,
 *   DEVPLAN_TYPE_SHARD_MAPPING,
 *   DEVPLAN_RELATION_SHARD_ID,
 *   DEVPLAN_EXPECTED_SHARD_DIRS,
 * } from './shard-config';
 * ```
 *
 * @module shard-config
 * @since Phase-36
 */

// ============================================================================
// Shard Definition
// ============================================================================

/**
 * 单个分片的定义。
 *
 * - `index` 与数组下标一致（用于 typeShardMapping）
 * - `name` 用作 WAL 目录后缀（如 `shard_0_tasks`）
 * - `entityTypes` 列出路由到此分片的所有实体类型
 * - `isRelationShard` 如果为 true，所有 Relation 都路由到此分片
 */
export interface DevPlanShardDefinition {
  /** 分片索引（必须与数组下标一致） */
  index: number;
  /** 分片名称（WAL 目录后缀，如 'tasks' → shard_0_tasks） */
  name: string;
  /** 路由到此分片的 Entity 类型列表 */
  entityTypes: string[];
  /** 是否为专用关系分片（默认 false） */
  isRelationShard?: boolean;
}

// ============================================================================
// ⭐ 单一数据源：所有分片定义
// ============================================================================

/**
 * DevPlan 分片定义数组。
 *
 * **新增分片只需在此处添加一行。**
 * 所有下游配置（shardCount、shardNames、typeShardMapping 等）自动推导。
 */
export const DEVPLAN_SHARDS: readonly DevPlanShardDefinition[] = [
  {
    index: 0,
    name: 'tasks',
    entityTypes: ['devplan-project', 'devplan-main-task', 'devplan-sub-task'],
  },
  {
    index: 1,
    name: 'relations',
    entityTypes: [],
    isRelationShard: true,
  },
  {
    index: 2,
    name: 'docs',
    entityTypes: ['devplan-doc'],
  },
  {
    index: 3,
    name: 'modules',
    entityTypes: ['devplan-module'],
  },
  {
    index: 4,
    name: 'prompts',
    entityTypes: ['devplan-prompt'],
  },
  {
    index: 5,
    name: 'memory',
    entityTypes: ['devplan-memory'],
  },
] as const;

// ============================================================================
// 自动推导的配置值（不要手动修改！）
// ============================================================================

/** 分片总数（从 DEVPLAN_SHARDS.length 自动推导） */
export const DEVPLAN_SHARD_COUNT: number = DEVPLAN_SHARDS.length;

/** 分片名称数组（传给 SocialGraphV2 的 shardNames） */
export const DEVPLAN_SHARD_NAMES: string[] = DEVPLAN_SHARDS.map(s => s.name);

/** 专用关系分片 ID（所有 Relation 路由到此分片） */
export const DEVPLAN_RELATION_SHARD_ID: number = (() => {
  const shard = DEVPLAN_SHARDS.find(s => s.isRelationShard);
  if (!shard) throw new Error('[shard-config] No relation shard defined (isRelationShard: true)');
  return shard.index;
})();

/**
 * Entity 类型 → 分片 ID 的映射表（传给 SocialGraphV2 的 typeShardMapping）。
 *
 * 自动从 DEVPLAN_SHARDS 的 entityTypes 推导，另加 `_default → 0` 作为 fallback。
 */
export const DEVPLAN_TYPE_SHARD_MAPPING: Record<string, number> = (() => {
  const mapping: Record<string, number> = { '_default': 0 };
  for (const shard of DEVPLAN_SHARDS) {
    for (const type of shard.entityTypes) {
      mapping[type] = shard.index;
    }
  }
  return mapping;
})();

/**
 * 期望的 WAL 分片目录名列表（用于 migrateWalDirNames 预创建缺失目录）。
 *
 * 格式：`shard_{index}_{name}`
 */
export const DEVPLAN_EXPECTED_SHARD_DIRS: string[] = DEVPLAN_SHARDS.map(
  s => `shard_${s.index}_${s.name}`
);

// ============================================================================
// 启动时的自检（防止数组 index 与 shard.index 不一致）
// ============================================================================

for (let i = 0; i < DEVPLAN_SHARDS.length; i++) {
  if (DEVPLAN_SHARDS[i].index !== i) {
    throw new Error(
      `[shard-config] DEVPLAN_SHARDS[${i}].index is ${DEVPLAN_SHARDS[i].index}, expected ${i}. ` +
      `Array index must match shard.index.`
    );
  }
}
