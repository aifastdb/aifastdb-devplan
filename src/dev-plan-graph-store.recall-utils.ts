import type { VectorSearchHit } from 'aifastdb';
import type { DevPlanDoc, MemoryType, ScoredDevPlanDoc, ScoredMemory } from './types';
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
  mode: 'hybrid' | 'literal';
  limit: number;
  minScore?: number;
  _skipRerank: true;
}) => ScoredDevPlanDoc[];

// ---------------------------------------------------------------------------
// Generic recall helpers
// ---------------------------------------------------------------------------

export function tokenizeQuery(query: string): string[] {
  const tokens = (query.toLowerCase().match(/[a-z0-9_\-\u4e00-\u9fa5]+/g) || [])
    .filter((t) => t.length >= 2);
  return Array.from(new Set(tokens));
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
  const queryLower = query.toLowerCase();
  return docs.filter(
    (doc) =>
      doc.content.toLowerCase().includes(queryLower) ||
      doc.title.toLowerCase().includes(queryLower)
  );
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
    mode: params.semanticSearchReady ? 'hybrid' : 'literal',
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
