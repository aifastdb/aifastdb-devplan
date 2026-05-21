import * as fs from 'fs';
import * as path from 'path';
import type { DevPlanGraphStoreConfig, DevPlanGraphNode, RecallSearchTuningConfig } from './types';
import type { PerceptionConfig } from 'aifastdb';
import { PerceptionPresets } from 'aifastdb';
import { DEVPLAN_EXPECTED_SHARD_DIRS } from './shard-config';
export type ResolvedRecallSearchTuningLike = {
  rrfK: number;
  vectorWeight: number;
  bm25Weight: number;
  graphWeight: number;
  bm25TermBoost: number;
  bm25DomainTerms: string[];
  bm25UserDictPath?: string;
  /** Phase-215: 记忆标签匹配加分因子 */
  tagBoostFactor: number;
  /** 技术关键词覆盖率加分 */
  queryCoverageBoost: number;
  /** 带 phase/task 语境的记忆额外加分 */
  relatedTaskBoost: number;
  /** 非测试查询下对 probe/test 记忆的降权幅度 */
  testMemoryPenalty: number;
};

export const DEFAULT_BM25_DOMAIN_TERMS = [
  'WAL',
  'HNSW',
  'NAPI',
  'MCP',
  'RRF',
  'BM25',
  'VibeSynapse',
  'SocialGraphV2',
];

export function resolvePerceptionConfig(config: DevPlanGraphStoreConfig): PerceptionConfig {
  if (config.perceptionConfig) {
    return {
      ...config.perceptionConfig,
      autoDownload: config.perceptionConfig.autoDownload ?? true,
    };
  }

  if (config.perceptionPreset) {
    const presetFn = PerceptionPresets[config.perceptionPreset];
    if (presetFn) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- preset signatures vary (some accept optional args)
      const preset = (presetFn as (...args: any[]) => PerceptionConfig)();
      return { ...preset, autoDownload: preset.autoDownload ?? true };
    }
    console.warn(
      `[DevPlan] Unknown perception preset "${config.perceptionPreset}", ` +
      `available: ${Object.keys(PerceptionPresets).join(', ')}. Falling back to qwen3Hybrid06b.`
    );
  }

  // Ollama 优先使用 qwen3-embedding (0.6b)，不可用时自动降级到本地 qwen3Local06b
  const defaultPreset = PerceptionPresets.qwen3Hybrid06b?.() ?? PerceptionPresets.qwen3Local06b?.() ?? PerceptionPresets.miniLM();
  return { ...defaultPreset, autoDownload: true };
}

export function resolveRecallSearchTuning(
  config?: RecallSearchTuningConfig,
): ResolvedRecallSearchTuningLike {
  const safeNumber = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const domainTermsRaw = Array.isArray(config?.bm25DomainTerms)
    ? config!.bm25DomainTerms!
    : DEFAULT_BM25_DOMAIN_TERMS;
  const bm25DomainTerms = Array.from(
    new Set(
      domainTermsRaw
        .map(t => String(t || '').trim())
        .filter(Boolean),
    ),
  );
  return {
    rrfK: Math.floor(safeNumber(config?.rrfK, 60)),
    vectorWeight: safeNumber(config?.vectorWeight, 1),
    bm25Weight: safeNumber(config?.bm25Weight, 1),
    graphWeight: safeNumber(config?.graphWeight, 1),
    bm25TermBoost: safeNumber(config?.bm25TermBoost, 2),
    bm25DomainTerms,
    bm25UserDictPath: config?.bm25UserDictPath,
    tagBoostFactor: safeNumber(config?.tagBoostFactor, 0.15),
    queryCoverageBoost: safeNumber(config?.queryCoverageBoost, 0.35),
    relatedTaskBoost: safeNumber(config?.relatedTaskBoost, 0.12),
    testMemoryPenalty: safeNumber(config?.testMemoryPenalty, 0.3),
  };
}

export function resolveBm25UserDictPath(
  graphPath: string,
  domainTerms: string[],
  preferredPath?: string,
): string | undefined {
  const preferred = (preferredPath || '').trim();
  if (preferred) return preferred;
  if (domainTerms.length === 0) return undefined;
  const dictDir = path.resolve(graphPath, '..', 'tantivy-dict');
  fs.mkdirSync(dictDir, { recursive: true });
  const dictPath = path.join(dictDir, 'user-dict.txt');
  fs.writeFileSync(dictPath, `${domainTerms.join('\n')}\n`, 'utf8');
  return dictPath;
}

export function migrateWalDirNames(graphPath: string): void {
  const walBase = path.join(graphPath, 'wal');
  if (!fs.existsSync(walBase)) return;

  const renames: Array<[string, string]> = [
    ['shard_0_entities', 'shard_0_tasks'],
    ['shard_2_index', 'shard_2_docs'],
    ['shard_3_meta', 'shard_3_modules'],
  ];

  for (const [oldName, newName] of renames) {
    const oldDir = path.join(walBase, oldName);
    const newDir = path.join(walBase, newName);

    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      try {
        fs.renameSync(oldDir, newDir);
        console.error(`[DevPlan] WAL dir migrated: ${oldName} → ${newName}`);
      } catch (e) {
        console.warn(
          `[DevPlan] Failed to migrate WAL dir ${oldName} → ${newName}: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }
  }

  for (const shardName of DEVPLAN_EXPECTED_SHARD_DIRS) {
    const shardDir = path.join(walBase, shardName);
    if (!fs.existsSync(shardDir)) {
      try {
        fs.mkdirSync(shardDir, { recursive: true });
        console.error(`[DevPlan] Created missing shard dir: ${shardName}`);
      } catch (e) {
        console.warn(
          `[DevPlan] Failed to create shard dir ${shardName}: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }
  }
}

export function getBm25BoostTermsForQuery(query: string, domainTerms: string[]): string[] {
  const q = query.toLowerCase();
  if (!q) return [];
  return domainTerms.filter(term => q.includes(term.toLowerCase()));
}

export function applyBm25TermBoost(
  baseScore: number,
  query: string,
  haystack: string,
  tuning: ResolvedRecallSearchTuningLike,
): number {
  if (tuning.bm25TermBoost <= 1) return baseScore;
  const boostTerms = getBm25BoostTermsForQuery(query, tuning.bm25DomainTerms);
  if (boostTerms.length === 0) return baseScore;
  const text = haystack.toLowerCase();
  if (!boostTerms.some(term => text.includes(term.toLowerCase()))) return baseScore;
  return baseScore * tuning.bm25TermBoost;
}

export function mapGroupToDevPlanType(group: string | number): DevPlanGraphNode['type'] {
  if (typeof group === 'string') {
    if (group.includes('project')) return 'project';
    if (group.includes('main-task') || group.includes('main_task')) return 'main-task';
    if (group.includes('sub-task') || group.includes('sub_task')) return 'sub-task';
    if (group.includes('doc')) return 'document';
    if (group.includes('module')) return 'module';
  }
  return 'sub-task';
}

/**
 * Phase-237 P1：完成任务 (devplan_complete_task) 的 wall-clock 瓶颈是这里的
 * `execSync('git rev-parse')`。Windows 上 fork git 进程 ~200ms / 次，连续 complete
 * 多个 sub-task 时累计可达数秒（实测两次 complete 间隔 5.16s）。
 *
 * 优化手段：
 *  1) **进程级 TTL 缓存**（默认 5s）：批量 complete / save 短时间内复用 HEAD 哈希。
 *     缓存 key 为 gitCwd，进程退出失效；TTL 短到不可能跨越用户的真实 git commit。
 *  2) **AIFASTDB_DEVPLAN_GIT_ANCHOR_DISABLED 全局开关**：CI / 无 git 项目 / 极致延迟敏感
 *     场景下完全跳过 spawn，commit hash 返回 undefined。
 */
const GIT_HEAD_CACHE_TTL_MS = (() => {
  const raw = process.env.AIFASTDB_DEVPLAN_GIT_ANCHOR_TTL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 5000;
})();

function gitAnchorDisabled(): boolean {
  const raw = String(process.env.AIFASTDB_DEVPLAN_GIT_ANCHOR_DISABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

const gitHeadCache = new Map<string, { value: string | undefined; expiresAt: number }>();

export function getCurrentGitCommit(gitCwd?: string): string | undefined {
  if (gitAnchorDisabled()) return undefined;

  const cacheKey = gitCwd || '__default__';
  if (GIT_HEAD_CACHE_TTL_MS > 0) {
    const entry = gitHeadCache.get(cacheKey);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value;
    }
  }

  let value: string | undefined;
  try {
    const { execSync } = require('child_process');
    value = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: gitCwd,
    }).trim();
  } catch {
    value = undefined;
  }

  if (GIT_HEAD_CACHE_TTL_MS > 0) {
    gitHeadCache.set(cacheKey, { value, expiresAt: Date.now() + GIT_HEAD_CACHE_TTL_MS });
  }
  return value;
}

/** 测试 / debug hook：手动清空 HEAD 缓存（例如 syncWithGit 检测到回滚后） */
export function invalidateGitHeadCache(gitCwd?: string): void {
  if (gitCwd) {
    gitHeadCache.delete(gitCwd);
  } else {
    gitHeadCache.clear();
  }
}

const ancestorCache = new Map<string, { value: boolean; expiresAt: number }>();

export function isAncestor(commit: string, target: string, gitCwd?: string): boolean {
  if (gitAnchorDisabled()) return false;

  const cacheKey = `${gitCwd || '__default__'}|${commit}|${target}`;
  if (GIT_HEAD_CACHE_TTL_MS > 0) {
    const entry = ancestorCache.get(cacheKey);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value;
    }
  }

  let value = false;
  try {
    const { execSync } = require('child_process');
    execSync(`git merge-base --is-ancestor ${commit} ${target}`, {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: gitCwd,
    });
    value = true;
  } catch {
    value = false;
  }

  if (GIT_HEAD_CACHE_TTL_MS > 0) {
    ancestorCache.set(cacheKey, { value, expiresAt: Date.now() + GIT_HEAD_CACHE_TTL_MS });
  }
  return value;
}

export function progressBar(percent: number): string {
  const total = 20;
  const filled = Math.round((percent / 100) * total);
  const empty = total - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}
