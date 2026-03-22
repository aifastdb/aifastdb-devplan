import type { VectorSearchHit } from 'aifastdb';
import type { DevPlanDoc, MemoryType, ScoredDevPlanDoc, ScoredMemory } from './types';
import { literalSearchDocs as literalSearchDocsUtil } from './doc-search-utils';
import type { ResolvedRecallSearchTuning } from './dev-plan-graph-store.shared';

// ---------------------------------------------------------------------------
// Shared local types
// ---------------------------------------------------------------------------

export type TreeIndexRawCandidate = {
  id: string;
  title: string;
  content: string;
  score: number;
  section: string;
  subSection?: string;
  pathLabel: string;
};

export type SearchDocsForRecall = (opts: {
  mode: 'semantic' | 'hybrid' | 'literal';
  limit: number;
  minScore?: number;
  _skipRerank: true;
  _queryEmbedding?: number[];
}) => ScoredDevPlanDoc[];

// ---------------------------------------------------------------------------
// Generic recall helpers
// ---------------------------------------------------------------------------

function splitToSearchTokens(text: string): string[] {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const expanded = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[\\/]+/g, ' ');
  const tokens = new Set<string>();
  const pushToken = (token: string) => {
    const normalized = token.trim().toLowerCase();
    if (!normalized) return;
    const isChinese = /^[\u4e00-\u9fa5]+$/.test(normalized);
    if ((isChinese && normalized.length >= 1) || normalized.length >= 2) {
      tokens.add(normalized);
    }
  };

  const compoundMatches = raw.match(/[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*|[\u4e00-\u9fa5]+/g) || [];
  for (const match of compoundMatches) {
    pushToken(match);
    for (const part of match.split(/[_-]+/)) {
      pushToken(part);
    }
  }

  const expandedMatches = expanded.match(/[A-Za-z0-9]+|[\u4e00-\u9fa5]+/g) || [];
  for (const match of expandedMatches) {
    pushToken(match);
  }

  return Array.from(tokens);
}

export function tokenizeQuery(query: string): string[] {
  return splitToSearchTokens(query);
}

// ---------------------------------------------------------------------------
// Phase-215: Tag Boost — query token 与记忆 tags 交集加分
// ---------------------------------------------------------------------------

/**
 * 对召回结果应用 tag-query 交集加分。
 * 当 query 中的 token 命中记忆的 tags 时，每命中 1 个 tag 增加 `tagBoostFactor` 倍分数。
 *
 * @example
 *   query="anchor dedup upsert", tags=["anchor","dedup","fix"]
 *   matchedCount=2, boost = 1 + 2 * 0.15 = 1.3
 *   newScore = score * 1.3
 */
export function applyTagBoost(
  memories: ScoredMemory[],
  query: string,
  tagBoostFactor: number,
): ScoredMemory[] {
  if (tagBoostFactor <= 0) return memories;
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return memories;

  return memories.map(mem => {
    const tags = mem.tags;
    if (!tags || tags.length === 0) return mem;

    const tagTokens = new Set(tags.flatMap(tag => splitToSearchTokens(tag)));
    let matchCount = 0;
    for (const token of tokens) {
      if (tagTokens.has(token)) {
        matchCount++;
      }
    }

    if (matchCount === 0) return mem;
    const boost = 1 + matchCount * tagBoostFactor;
    return { ...mem, score: mem.score * boost };
  });
}

const TEST_LIKE_TOKENS = new Set([
  'test',
  'tests',
  'probe',
  'validation',
  'fixture',
  'smoke',
  'sandbox',
  'demo',
  'mock',
  'sample',
  'benchmark',
  'experiment',
]);

function buildMemorySearchText(memory: ScoredMemory): string {
  const parts = [
    memory.content,
    memory.docTitle,
    memory.relatedTaskId,
    memory.sourceRef?.sourceId,
    memory.sourceRef?.variant,
    memory.anchorInfo?.name,
    memory.anchorInfo?.description,
    memory.anchorInfo?.overview || '',
    (memory.tags || []).join(' '),
    (memory.guidedReasons || []).join(' '),
  ];
  return parts.filter(Boolean).join('\n');
}

function hasTestIntent(tokens: string[]): boolean {
  return tokens.some(token => TEST_LIKE_TOKENS.has(token));
}

function looksLikeTestMemory(memory: ScoredMemory): boolean {
  if (memory.recallProfile === 'test_probe') return true;
  const tokens = splitToSearchTokens(buildMemorySearchText(memory));
  return tokens.some(token => TEST_LIKE_TOKENS.has(token));
}

export function rerankMemoriesByQuery(
  memories: ScoredMemory[],
  query: string,
  tuning: Pick<ResolvedRecallSearchTuning, 'queryCoverageBoost' | 'relatedTaskBoost' | 'testMemoryPenalty'>,
): ScoredMemory[] {
  if (memories.length <= 1) return memories;

  const queryTokens = splitToSearchTokens(query);
  if (queryTokens.length === 0) return memories;
  const queryHasTestIntent = hasTestIntent(queryTokens);

  return memories
    .map((memory, index) => {
      if (memory.sourceKind === 'doc') {
        return {
          memory,
          adjustedScore: memory.score,
          index,
        };
      }

      const searchableTokens = new Set(splitToSearchTokens(buildMemorySearchText(memory)));
      let matched = 0;
      for (const token of queryTokens) {
        if (searchableTokens.has(token)) matched += 1;
      }
      const coverage = matched / queryTokens.length;
      const hasRelatedTask = Boolean(memory.relatedTaskId);
      const importanceBonus = Math.max(0, (memory.importance || 0.5) - 0.5) * 0.2;
      const coverageBonus = coverage * tuning.queryCoverageBoost;
      const taskBonus = hasRelatedTask ? tuning.relatedTaskBoost : 0;
      const testPenalty = !queryHasTestIntent && looksLikeTestMemory(memory)
        ? tuning.testMemoryPenalty
        : 0;
      const multiplier = Math.max(0.25, 1 + coverageBonus + taskBonus + importanceBonus - testPenalty);
      const adjustedScore = memory.score * multiplier
        + coverage * 0.01
        + (hasRelatedTask ? 0.002 : 0);

      return {
        memory,
        adjustedScore,
        index,
      };
    })
    .sort((a, b) => {
      if (b.adjustedScore !== a.adjustedScore) return b.adjustedScore - a.adjustedScore;
      if ((b.memory.importance || 0) !== (a.memory.importance || 0)) {
        return (b.memory.importance || 0) - (a.memory.importance || 0);
      }
      if (Boolean(b.memory.relatedTaskId) !== Boolean(a.memory.relatedTaskId)) {
        return Number(Boolean(b.memory.relatedTaskId)) - Number(Boolean(a.memory.relatedTaskId));
      }
      if ((b.memory.createdAt || 0) !== (a.memory.createdAt || 0)) {
        return (b.memory.createdAt || 0) - (a.memory.createdAt || 0);
      }
      return a.index - b.index;
    })
    .map(({ memory, adjustedScore }) => ({ ...memory, score: adjustedScore }));
}

// ---------------------------------------------------------------------------
// Phase-215: Score 归一化 — 将 RRF 分数映射到 [0, 1] 区间
// ---------------------------------------------------------------------------

/**
 * 对召回结果进行 min-max 归一化，将 score 映射到 [0, 1]。
 * 原始分数保留在 rawScore 字段中。
 *
 * 如果所有分数相同（maxScore == minScore），所有结果归一化为 1.0。
 */
export function normalizeScores(
  memories: ScoredMemory[],
): ScoredMemory[] {
  if (memories.length === 0) return memories;
  if (memories.length === 1) {
    return memories.map(m => ({ ...m, rawScore: m.score, score: 1.0 }));
  }

  const scores = memories.map(m => m.score);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore;

  if (range < 1e-10) {
    // 所有分数相同
    return memories.map(m => ({ ...m, rawScore: m.score, score: 1.0 }));
  }

  return memories.map(m => ({
    ...m,
    rawScore: m.score,
    score: (m.score - minScore) / range,
  }));
}

export function docSectionToMemoryType(section: string): MemoryType {
  const mapping: Record<string, MemoryType> = {
    overview: 'summary',
    core_concepts: 'insight',
    api_design: 'pattern',
    technical_notes: 'insight',
    config: 'preference',
    examples: 'pattern',
    changelog: 'summary',
    milestones: 'summary',
  };
  return mapping[section] || 'insight';
}

export function computeMemoryHotness(memory: {
  hitCount: number;
  lastAccessedAt: number | null;
  importance: number;
  createdAt: number;
}): number {
  const now = Date.now();
  const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7-day half-life
  const LN2 = Math.LN2;

  const lastAccess = memory.lastAccessedAt || memory.createdAt;
  const elapsed = Math.max(0, now - lastAccess);
  const timeDecay = Math.exp(-(LN2 / HALF_LIFE_MS) * elapsed);

  const freqScore = Math.min(1, Math.log2(1 + (memory.hitCount || 0)) / 5);
  const importanceBase = memory.importance || 0.5;

  return importanceBase * 0.4 + freqScore * 0.3 + timeDecay * 0.3;
}

export function rrfMergeResults(
  memoryResults: ScoredMemory[],
  docResults: ScoredMemory[],
  limit: number,
): ScoredMemory[] {
  const kMemory = 30;
  const kDoc = 50;

  const scoreMap = new Map<string, { item: ScoredMemory; rrfScore: number }>();

  for (let i = 0; i < memoryResults.length; i++) {
    const item = memoryResults[i];
    const rrfScore = 1.0 / (kMemory + i + 1);
    scoreMap.set(item.id, { item, rrfScore });
  }

  for (let i = 0; i < docResults.length; i++) {
    const item = docResults[i];
    const rrfScore = 1.0 / (kDoc + i + 1);
    const existing = scoreMap.get(item.id);
    if (existing) {
      existing.rrfScore += rrfScore;
    } else {
      scoreMap.set(item.id, { item, rrfScore });
    }
  }

  return Array.from(scoreMap.values())
    .map(({ item, rrfScore }) => {
      if (item.sourceKind === 'memory' || !item.sourceKind) {
        const hotness = computeMemoryHotness(item);
        const hotnessMultiplier = 0.5 + hotness; // [0.5, 1.5]
        return { item, rrfScore: rrfScore * hotnessMultiplier };
      }
      return { item, rrfScore };
    })
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map(({ item, rrfScore }) => ({ ...item, score: rrfScore }));
}

export function rrfMergeMemories(
  vectorResults: ScoredMemory[],
  graphResults: ScoredMemory[],
  limit: number,
  tuning: ResolvedRecallSearchTuning,
): ScoredMemory[] {
  const rrfK = tuning.rrfK;
  const vectorWeight = tuning.vectorWeight;
  const graphWeight = tuning.graphWeight;

  const scoreMap = new Map<string, { item: ScoredMemory; rrfScore: number }>();

  for (let i = 0; i < vectorResults.length; i++) {
    const item = vectorResults[i];
    const rrfScore = vectorWeight / (rrfK + i + 1);
    scoreMap.set(item.id, { item, rrfScore });
  }

  for (let i = 0; i < graphResults.length; i++) {
    const item = graphResults[i];
    const rrfScore = graphWeight / (rrfK + i + 1);
    const existing = scoreMap.get(item.id);
    if (existing) {
      existing.rrfScore += rrfScore;
    } else {
      scoreMap.set(item.id, { item, rrfScore });
    }
  }

  return Array.from(scoreMap.values())
    .map(({ item, rrfScore }) => {
      const hotness = computeMemoryHotness(item);
      const hotnessMultiplier = 0.5 + hotness; // [0.5, 1.5]
      return { item, rrfScore: rrfScore * hotnessMultiplier };
    })
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map(({ item, rrfScore }) => ({ ...item, score: rrfScore }));
}

export function literalSearchDocs(query: string, docs: DevPlanDoc[]): DevPlanDoc[] {
  return literalSearchDocsUtil(query, docs);
}

export function rrfFusion(
  semanticHits: VectorSearchHit[],
  literalResults: DevPlanDoc[],
  limit: number,
  minScore: number,
  resolveDocById: (id: string) => DevPlanDoc | undefined,
): ScoredDevPlanDoc[] {
  const rrfK = 60;
  const rrfScores = new Map<string, number>();
  const docMap = new Map<string, DevPlanDoc>();

  for (let i = 0; i < semanticHits.length; i++) {
    const hit = semanticHits[i];
    const rrf = 1 / (rrfK + i + 1);
    rrfScores.set(hit.entityId, (rrfScores.get(hit.entityId) || 0) + rrf);
  }

  for (let i = 0; i < literalResults.length; i++) {
    const doc = literalResults[i];
    const rrf = 1 / (rrfK + i + 1);
    rrfScores.set(doc.id, (rrfScores.get(doc.id) || 0) + rrf);
    docMap.set(doc.id, doc);
  }

  const sorted = Array.from(rrfScores.entries()).sort((a, b) => b[1] - a[1]);
  const results: ScoredDevPlanDoc[] = [];
  for (const [id, score] of sorted) {
    if (minScore > 0 && score < minScore) continue;
    if (results.length >= limit) break;

    const doc = docMap.get(id) || resolveDocById(id);
    if (doc) {
      results.push({ ...doc, score });
    }
  }
  return results;
}

export function rrfFusionThreeWay(
  semanticHits: VectorSearchHit[],
  textResults: Array<{ id: string; score?: number; doc?: DevPlanDoc }>,
  limit: number,
  minScore: number,
  tuning: Pick<ResolvedRecallSearchTuning, 'rrfK' | 'vectorWeight' | 'bm25Weight'>,
  resolveDocById: (id: string) => DevPlanDoc | undefined,
): ScoredDevPlanDoc[] {
  const rrfScores = new Map<string, number>();
  const docMap = new Map<string, DevPlanDoc>();

  for (let i = 0; i < semanticHits.length; i++) {
    const hit = semanticHits[i];
    const rrf = tuning.vectorWeight / (tuning.rrfK + i + 1);
    rrfScores.set(hit.entityId, (rrfScores.get(hit.entityId) || 0) + rrf);
  }

  for (let i = 0; i < textResults.length; i++) {
    const r = textResults[i];
    const rrf = tuning.bm25Weight / (tuning.rrfK + i + 1);
    rrfScores.set(r.id, (rrfScores.get(r.id) || 0) + rrf);
    if (r.doc) {
      docMap.set(r.id, r.doc);
    }
  }

  const sorted = Array.from(rrfScores.entries()).sort((a, b) => b[1] - a[1]);
  const results: ScoredDevPlanDoc[] = [];
  for (const [id, score] of sorted) {
    if (minScore > 0 && score < minScore) continue;
    if (results.length >= limit) break;

    const doc = docMap.get(id) || resolveDocById(id);
    if (doc) {
      results.push({ ...doc, score });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tree-index recall helpers
// ---------------------------------------------------------------------------

export function extractTreeIndexRawCandidates(
  docs: DevPlanDoc[],
  tokens: string[],
): TreeIndexRawCandidate[] {
  const rawCandidates: TreeIndexRawCandidate[] = [];

  for (const doc of docs) {
    const lines = (doc.content || '').split('\n');
    let currentHeading = doc.title;
    let currentDepth = 1;
    let buffer: string[] = [];
    let nodeIdx = 0;

    const pushNode = () => {
      const block = buffer.join('\n').trim();
      if (!block) return;
      const titleLower = currentHeading.toLowerCase();
      const blockLower = block.toLowerCase();
      let titleHits = 0;
      let contentHits = 0;
      for (const tk of tokens) {
        if (titleLower.includes(tk)) titleHits += 1;
        if (blockLower.includes(tk)) contentHits += 1;
      }
      if (titleHits === 0 && contentHits === 0) return;
      const base = titleHits * 3 + contentHits;
      const normalized = Math.min(1, base / Math.max(3, tokens.length * 2));
      const depthBonus = 1 / (currentDepth + 1);
      const score = Math.min(1, normalized * 0.85 + depthBonus * 0.15);
      const docKey = doc.subSection ? `${doc.section}|${doc.subSection}` : doc.section;
      rawCandidates.push({
        id: `doc:${docKey}#tree-${nodeIdx}`,
        title: `${doc.title} / ${currentHeading}`,
        content: block.slice(0, 1200),
        score,
        section: doc.section,
        subSection: doc.subSection,
        pathLabel: currentHeading,
      });
      nodeIdx += 1;
    };

    for (const line of lines) {
      const m = /^(#{1,6})\s+(.+)$/.exec(line.trim());
      if (m) {
        pushNode();
        buffer = [];
        currentDepth = m[1].length;
        currentHeading = m[2].trim();
      } else {
        buffer.push(line);
      }
    }
    pushNode();
  }

  return rawCandidates;
}

export function mapTreeIndexCandidatesToScoredMemories(
  rawCandidates: TreeIndexRawCandidate[],
  params: {
    minScore: number;
    limit: number;
    treeIndexMaxNodes: number;
    projectName: string;
  },
): ScoredMemory[] {
  return rawCandidates
    .filter(c => params.minScore <= 0 || c.score >= params.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(params.limit, params.treeIndexMaxNodes))
    .map((c): ScoredMemory => ({
      id: c.id,
      projectName: params.projectName,
      memoryType: docSectionToMemoryType(c.section),
      content: `## ${c.title}\n\n${c.content}`,
      importance: 0.5,
      tags: ['tree-index', c.section, ...(c.subSection ? [c.subSection] : [])],
      hitCount: 0,
      lastAccessedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      score: c.score,
      sourceKind: 'doc',
      guidedReasons: [`tree-index:${c.pathLabel}`],
    }));
}

// ---------------------------------------------------------------------------
// Doc -> memory mapping helpers
// ---------------------------------------------------------------------------

export function mapDocsToRecallMemories(
  docs: ScoredDevPlanDoc[],
  projectName: string,
): ScoredMemory[] {
  return docs.map((doc): ScoredMemory => {
    const contentSnippet = (doc.content || '').substring(0, 300);
    return {
      id: `doc:${doc.section}${doc.subSection ? '|' + doc.subSection : ''}`,
      projectName,
      memoryType: docSectionToMemoryType(doc.section),
      content: contentSnippet + (doc.content && doc.content.length > 300 ? '...' : ''),
      tags: [doc.section, ...(doc.subSection ? [doc.subSection] : [])],
      relatedTaskId: undefined,
      importance: 0.6,
      hitCount: 0,
      lastAccessedAt: null,
      createdAt: doc.updatedAt || 0,
      updatedAt: doc.updatedAt || 0,
      score: doc.score || 0.4,
      sourceKind: 'doc',
      docSection: doc.section,
      docSubSection: doc.subSection || undefined,
      docTitle: doc.title,
    };
  });
}

// ---------------------------------------------------------------------------
// Doc recall builders
// ---------------------------------------------------------------------------

export function buildTreeIndexRecallMemories(
  query: string,
  docs: DevPlanDoc[],
  params: {
    minScore: number;
    limit: number;
    treeIndexMaxNodes: number;
    projectName: string;
  },
): ScoredMemory[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];
  const rawCandidates = extractTreeIndexRawCandidates(docs, tokens);
  return mapTreeIndexCandidatesToScoredMemories(rawCandidates, params);
}

export function buildVectorRecallMemories(params: {
  query: string;
  limit: number;
  minScore: number;
  semanticSearchReady: boolean;
  projectName: string;
  searchDocs: SearchDocsForRecall;
}): ScoredMemory[] {
  const docHits = params.searchDocs({
    mode: params.semanticSearchReady ? 'semantic' : 'literal',
    limit: Math.max(5, Math.floor(params.limit / 2)),
    minScore: params.minScore > 0 ? params.minScore : undefined,
    _skipRerank: true,
  });

  return mapDocsToRecallMemories(docHits, params.projectName);
}

// ---------------------------------------------------------------------------
// Thin runners used by DevPlanGraphStore methods
// ---------------------------------------------------------------------------

export function runTreeIndexDocRecall(params: {
  enabled: boolean;
  query: string;
  limit: number;
  minScore: number;
  treeIndexMaxNodes: number;
  projectName: string;
  listDocs: () => DevPlanDoc[];
  rerank: (query: string, items: ScoredMemory[], limit: number) => ScoredMemory[];
}): ScoredMemory[] {
  if (!params.enabled) return [];
  const docs = params.listDocs();
  const sorted = buildTreeIndexRecallMemories(params.query, docs, {
    minScore: params.minScore,
    limit: params.limit,
    treeIndexMaxNodes: params.treeIndexMaxNodes,
    projectName: params.projectName,
  });
  return params.rerank(params.query, sorted, params.limit).slice(0, params.limit);
}

export function runVectorDocRecall(params: {
  query: string;
  limit: number;
  minScore: number;
  semanticSearchReady: boolean;
  projectName: string;
  searchDocs: SearchDocsForRecall;
}): ScoredMemory[] {
  return buildVectorRecallMemories({
    query: params.query,
    limit: params.limit,
    minScore: params.minScore,
    semanticSearchReady: params.semanticSearchReady,
    projectName: params.projectName,
    searchDocs: params.searchDocs,
  });
}
