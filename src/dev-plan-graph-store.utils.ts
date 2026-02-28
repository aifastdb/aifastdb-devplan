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
      const preset = presetFn();
      return { ...preset, autoDownload: preset.autoDownload ?? true };
    }
    console.warn(
      `[DevPlan] Unknown perception preset "${config.perceptionPreset}", ` +
      `available: ${Object.keys(PerceptionPresets).join(', ')}. Falling back to miniLM.`
    );
  }

  return { ...PerceptionPresets.miniLM(), autoDownload: true };
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

export function getCurrentGitCommit(gitCwd?: string): string | undefined {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: gitCwd,
    }).trim();
  } catch {
    return undefined;
  }
}

export function isAncestor(commit: string, target: string, gitCwd?: string): boolean {
  try {
    const { execSync } = require('child_process');
    execSync(`git merge-base --is-ancestor ${commit} ${target}`, {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: gitCwd,
    });
    return true;
  } catch {
    return false;
  }
}

export function progressBar(percent: number): string {
  const total = 20;
  const filled = Math.round((percent / 100) * total);
  const empty = total - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}
