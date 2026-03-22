import {
  type RecallDepth,
  type RecallScope,
  type RecallFeatureFlags,
  type RecallFeatureFlagsPatch,
  type RecallObservability,
  type ScoredMemory,
  type UnifiedRecallOptions,
  type MemoryType,
} from './types';
import { ET, RT } from './dev-plan-graph-store.shared';
import {
  applyTagBoost as applyTagBoostUtil,
  normalizeScores as normalizeScoresUtil,
  rerankMemoriesByQuery as rerankMemoriesByQueryUtil,
  rrfMergeMemories as rrfMergeMemoriesUtil,
  rrfMergeResults as rrfMergeResultsUtil,
  runTreeIndexDocRecall as runTreeIndexDocRecallUtil,
  runVectorDocRecall as runVectorDocRecallUtil,
} from './dev-plan-graph-store.recall-utils';
import { applyBm25TermBoost as applyBm25TermBoostUtil } from './dev-plan-graph-store.utils';

type GraphEntityLike = {
  id: string;
  entity_type: string;
  properties?: Record<string, any>;
};

type GraphRelationLike = {
  id: string;
  source: string;
  target: string;
  weight?: number;
};

type RecallGatewayAdapterLike = {
  recallUnified(
    query: string,
    options: UnifiedRecallOptions | undefined,
    fallback: (query: string, options?: UnifiedRecallOptions) => ScoredMemory[],
    context: { projectName: string },
  ): ScoredMemory[];
  getTelemetry(): any;
  getFallbackAlertThreshold?(): number;
};

type RecallGraphLike = {
  getEntity(entityId: string): GraphEntityLike | null;
  updateEntity(entityId: string, update: { properties: Record<string, any> }): void;
  flush(): void;
  memoryTreeSearch(embedding: number[], userId: string): any;
  memoryTreeStrengthen(entityIds: string[]): void;
  hybridSearchTantivy(embedding: number[], query: string, entityType: string, topK: number, rrfK: number): any[];
  searchEntitiesByVector(embedding: number[], topK: number, entityType: string): Array<{ entityId: string; score: number }>;
  searchEntitiesByText(query: string, entityType: string, topK: number): any[];
  extractSubgraph(entityId: string, options: Record<string, any>): any;
  adjustRelationWeight(relationId: string, sourceId: string, delta: number): Promise<void>;
};

export type RecallStoreBindings = {
  projectName: string;
  graph: RecallGraphLike;
  synapse?: { embed(query: string): number[] } | null;
  semanticSearchReady: boolean;
  textSearchReady: boolean;
  semanticSearchConfigured?: boolean;
  nativeMemoryTreeSearchReady: boolean;
  treeIndexRetrievalEnabled: boolean;
  treeIndexMaxNodes: number;
  recallFeatureFlags: RecallFeatureFlags;
  recallSearchTuning: any;
  recallObservabilityRaw: {
    totalCalls: number;
    totalFallbacks: number;
    totalLatencyMs: number;
    lastLatencyMs: number;
    lastError?: string;
  };
  memoryGatewayAdapter?: RecallGatewayAdapterLike | null;
  ensureSynapseReady(): boolean;
  filterMemoriesByScope(memories: ScoredMemory[], scope: RecallScope): ScoredMemory[];
  enrichMemoriesWithAnchorInfo(results: ScoredMemory[], depth?: RecallDepth): void;
  rerankSearchResults(query: string, items: ScoredMemory[], limit: number): ScoredMemory[];
  findGuidedDocuments(memories: ScoredMemory[], limit: number): ScoredMemory[];
  searchSectionsAdvanced(query: string, options: Record<string, any>): any[];
  listSections(): any[];
  entityToMemory(entity: GraphEntityLike): ScoredMemory;
  findEntitiesByType(entityType: string): GraphEntityLike[];
  getOutRelations(entityId: string, relationType?: string): GraphRelationLike[];
  getInRelations(entityId: string, relationType?: string): GraphRelationLike[];
};

export function recallUnified(store: RecallStoreBindings, query: string, options?: UnifiedRecallOptions): ScoredMemory[] {
  const t0 = Date.now();
  const limit = options?.limit || 10;
  const minScore = options?.minScore || 0;
  const depth: RecallDepth = options?.depth || 'L1';
  const scope = options?.scope;
  const now = Date.now();

  const graphExpand = (options?.recursive ?? true) && store.recallFeatureFlags.recursiveRecall;
  const useActivation = graphExpand;

  let augmentedQuery = query;
  if (options?.uri && store.recallFeatureFlags.uriIndex) {
    augmentedQuery = `${query} uri:${options.uri}`;
  }

  let sharedQueryEmbedding: number[] | undefined;
  const getSharedQueryEmbedding = (): number[] | undefined => {
    if (!store.ensureSynapseReady() || !store.synapse) return undefined;
    if (!sharedQueryEmbedding) {
      sharedQueryEmbedding = store.synapse.embed(augmentedQuery);
    }
    return sharedQueryEmbedding;
  };

  const docStrategy = options?.docStrategy
    ? options.docStrategy
    : options?.includeDocs === false
      ? 'none'
      : 'vector';

  let memoryResults: ScoredMemory[] = [];
  let activationUsed = false;
  let fallbackTriggered = false;
  let lastError: string | undefined;

  try {
    if (useActivation && store.nativeMemoryTreeSearchReady && store.ensureSynapseReady() && store.synapse) {
      try {
        memoryResults = recallViaActivationEngine(
          store,
          augmentedQuery,
          limit,
          minScore,
          options?.memoryType,
          now,
        );
        activationUsed = memoryResults.length > 0;
      } catch (e) {
        fallbackTriggered = true;
        lastError = e instanceof Error ? e.message : String(e);
        console.warn(`[DevPlan] Activation engine recall failed, falling back: ${lastError}`);
      }
    }

    if (!activationUsed) {
      memoryResults = recallViaLegacySearch(
        store,
        augmentedQuery,
        limit,
        minScore,
        options?.memoryType,
        now,
        getSharedQueryEmbedding(),
      );

      if (graphExpand && memoryResults.length > 0) {
        const graphExpanded = expandMemoriesByGraph(store, memoryResults, options?.memoryType, limit);
        if (graphExpanded.length > 0) {
          memoryResults = rrfMergeMemoriesUtil(memoryResults, graphExpanded, limit, store.recallSearchTuning);
        }
      }

      if (memoryResults.length >= 2) {
        hebbianStrengthen(store, memoryResults.filter((m: ScoredMemory) => m.sourceKind === 'memory'));
      }
    }

    if (scope) {
      memoryResults = store.filterMemoriesByScope(memoryResults, scope);
    }
    if (options?.deterministicFirst) {
      memoryResults = applyDeterministicRecallFilter(store, memoryResults, options);
    }

    memoryResults = applyTagBoostUtil(
      memoryResults,
      augmentedQuery,
      store.recallSearchTuning.tagBoostFactor,
    );

    const finalizeResults = (results: ScoredMemory[]): ScoredMemory[] => {
      store.enrichMemoriesWithAnchorInfo(results, depth);
      const heuristicallyRanked = rerankMemoriesByQueryUtil(
        results,
        augmentedQuery,
        store.recallSearchTuning,
      );
      const reranked = store.rerankSearchResults(augmentedQuery, heuristicallyRanked, limit);
      return normalizeScoresUtil(reranked);
    };

    if (docStrategy === 'none' || options?.memoryType) {
      return finalizeResults(memoryResults);
    }

    if (docStrategy === 'guided') {
      let guidedDocs = store.findGuidedDocuments(memoryResults, Math.max(3, Math.floor(limit / 2)));
      if (guidedDocs.length === 0) {
        guidedDocs = vectorSearchDocuments(store, augmentedQuery, limit, minScore, getSharedQueryEmbedding());
      }
      const treeDocs = treeIndexSearchDocuments(
        store,
        augmentedQuery,
        Math.max(3, Math.floor(limit / 2)),
        minScore,
      );
      if (treeDocs.length > 0) {
        guidedDocs = guidedDocs.length > 0
          ? rrfMergeResultsUtil(guidedDocs, treeDocs, limit)
          : treeDocs.slice(0, limit);
      }

      const finalResults = guidedDocs.length === 0
        ? memoryResults
        : memoryResults.length === 0
          ? guidedDocs.slice(0, limit)
          : [...memoryResults, ...guidedDocs].slice(0, limit);

      return finalizeResults(finalResults);
    }

    const docResults = vectorSearchDocuments(store, augmentedQuery, limit, minScore, getSharedQueryEmbedding());
    const treeDocResults = treeIndexSearchDocuments(
      store,
      augmentedQuery,
      Math.max(3, Math.floor(limit / 2)),
      minScore,
    );
    const mergedDocResults = treeDocResults.length > 0
      ? (docResults.length > 0
        ? rrfMergeResultsUtil(docResults, treeDocResults, limit)
        : treeDocResults.slice(0, limit))
      : docResults;

    const finalResults = mergedDocResults.length === 0
      ? memoryResults
      : memoryResults.length === 0
        ? mergedDocResults.slice(0, limit)
        : rrfMergeResultsUtil(memoryResults, mergedDocResults, limit);

    return finalizeResults(finalResults);
  } finally {
    const elapsed = Date.now() - t0;
    store.recallObservabilityRaw.totalCalls += 1;
    store.recallObservabilityRaw.totalLatencyMs += elapsed;
    store.recallObservabilityRaw.lastLatencyMs = elapsed;
    if (fallbackTriggered) {
      store.recallObservabilityRaw.totalFallbacks += 1;
    }
    if (lastError) {
      store.recallObservabilityRaw.lastError = lastError;
    }
  }
}

export function recallUnifiedViaAdapter(store: RecallStoreBindings, query: string, options?: UnifiedRecallOptions): ScoredMemory[] {
  if (!store.memoryGatewayAdapter) {
    return recallUnified(store, query, options);
  }
  return store.memoryGatewayAdapter.recallUnified(
    query,
    options,
    (q: string, opts?: UnifiedRecallOptions) => recallUnified(store, q, opts),
    { projectName: store.projectName },
  );
}

export function applyDeterministicRecallFilter(
  store: RecallStoreBindings,
  results: ScoredMemory[],
  options: UnifiedRecallOptions,
): ScoredMemory[] {
  const projectFilter = (options.filterProject || '').trim().toLowerCase();
  const typeFilter = (options.filterMemoryType || '').toString().trim().toLowerCase();
  const after = options.filterCreatedAfterMs;
  const before = options.filterCreatedBeforeMs;
  return results.filter((m) => {
    if (projectFilter) {
      const p = String((m as any).projectName || store.projectName).toLowerCase();
      if (!p.includes(projectFilter)) return false;
    }
    if (typeFilter) {
      const t = String((m as any).memoryType || '').toLowerCase();
      if (t !== typeFilter) return false;
    }
    const createdAt = Number((m as any).createdAt || 0);
    if (typeof after === 'number' && createdAt < after) return false;
    if (typeof before === 'number' && createdAt > before) return false;
    return true;
  });
}

export function recallMemory(store: RecallStoreBindings, query: string, options?: {
  memoryType?: MemoryType;
  limit?: number;
  minScore?: number;
  includeDocs?: boolean;
  graphExpand?: boolean;
  useActivation?: boolean;
  depth?: RecallDepth;
  scope?: RecallScope;
  docStrategy?: 'vector' | 'guided' | 'none';
}): ScoredMemory[] {
  return recallUnified(store, query, {
    memoryType: options?.memoryType,
    limit: options?.limit,
    minScore: options?.minScore,
    includeDocs: options?.includeDocs,
    recursive: options?.graphExpand ?? options?.useActivation ?? true,
    depth: options?.depth,
    scope: options?.scope,
    docStrategy: options?.docStrategy,
  });
}

export function getFeatureFlags(store: RecallStoreBindings): RecallFeatureFlags {
  return { ...store.recallFeatureFlags };
}

export function setFeatureFlags(store: RecallStoreBindings, patch: RecallFeatureFlagsPatch): RecallFeatureFlags {
  store.recallFeatureFlags = {
    ...store.recallFeatureFlags,
    ...patch,
  };
  return getFeatureFlags(store);
}

export function getRecallObservability(store: RecallStoreBindings): RecallObservability {
  const calls = Math.max(1, store.recallObservabilityRaw.totalCalls);
  const fallbackRate = store.recallObservabilityRaw.totalFallbacks / calls;
  const avgLatencyMs = store.recallObservabilityRaw.totalLatencyMs / calls;
  let alert = false;
  let alertReason: string | undefined;
  if (fallbackRate > 0.2) {
    alert = true;
    alertReason = `Fallback rate too high: ${(fallbackRate * 100).toFixed(2)}% (>20%)`;
  } else if (avgLatencyMs > 500) {
    alert = true;
    alertReason = `Average recall latency too high: ${avgLatencyMs.toFixed(1)}ms (>500ms)`;
  }
  const gatewayAdapter = store.memoryGatewayAdapter ? store.memoryGatewayAdapter.getTelemetry() : undefined;
  const threshold = store.memoryGatewayAdapter?.getFallbackAlertThreshold?.() ?? 0.2;
  const opRates = gatewayAdapter ? [
    { op: 'recallUnified' as const, rate: gatewayAdapter.recallUnified.fallbackRate },
    { op: 'getOutboxEntries' as const, rate: gatewayAdapter.getOutboxEntries.fallbackRate },
    { op: 'retryOutboxEntry' as const, rate: gatewayAdapter.retryOutboxEntry.fallbackRate },
  ] : [];
  const triggeredOps = opRates.filter((x) => x.rate > threshold).map((x) => x.op);
  const maxFallbackRate = opRates.length > 0
    ? Math.max(...opRates.map((x) => x.rate))
    : 0;
  const gatewayAlert = gatewayAdapter ? {
    alerted: triggeredOps.length > 0,
    threshold,
    triggeredOps,
    maxFallbackRate,
    reason: triggeredOps.length > 0
      ? `Gateway fallback rate exceeded threshold ${(threshold * 100).toFixed(1)}% on: ${triggeredOps.join(', ')}`
      : undefined,
  } : undefined;

  return {
    totalCalls: store.recallObservabilityRaw.totalCalls,
    totalFallbacks: store.recallObservabilityRaw.totalFallbacks,
    fallbackRate,
    avgLatencyMs,
    lastLatencyMs: store.recallObservabilityRaw.lastLatencyMs,
    alert,
    alertReason,
    lastError: store.recallObservabilityRaw.lastError,
    gatewayAdapter,
    gatewayAlert,
  };
}

export function resetRecallObservability(store: RecallStoreBindings): RecallObservability {
  store.recallObservabilityRaw = {
    totalCalls: 0,
    totalFallbacks: 0,
    totalLatencyMs: 0,
    lastLatencyMs: 0,
    lastError: undefined,
  };
  return getRecallObservability(store);
}

export function treeIndexSearchDocuments(
  store: RecallStoreBindings,
  query: string,
  limit: number,
  minScore: number,
): ScoredMemory[] {
  return runTreeIndexDocRecallUtil({
    enabled: store.treeIndexRetrievalEnabled,
    query,
    limit,
    minScore,
    treeIndexMaxNodes: store.treeIndexMaxNodes,
    projectName: store.projectName,
    listDocs: () => store.listSections(),
    rerank: (q: string, items: ScoredMemory[], n: number) => store.rerankSearchResults(q, items, n),
  });
}

export function vectorSearchDocuments(
  store: RecallStoreBindings,
  query: string,
  limit: number,
  minScore: number,
  queryEmbedding?: number[],
): ScoredMemory[] {
  const docResults: ScoredMemory[] = [];
  try {
    docResults.push(...runVectorDocRecallUtil({
      query,
      limit,
      minScore,
      semanticSearchReady: store.ensureSynapseReady(),
      projectName: store.projectName,
      searchDocs: (opts) => store.searchSectionsAdvanced(query, { ...opts, _queryEmbedding: queryEmbedding }),
    }));
  } catch (e) {
    console.warn(`[DevPlan] Document recall failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (docResults.length === 0) {
    try {
      const treeResults = treeIndexSearchDocuments(
        store,
        query,
        Math.max(3, Math.floor(limit / 2)),
        minScore,
      );
      if (treeResults.length > 0) {
        docResults.push(...treeResults);
      }
    } catch (e) {
      console.warn(`[DevPlan] Tree-index doc fallback failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return docResults;
}

export function recallViaActivationEngine(
  store: RecallStoreBindings,
  query: string,
  limit: number,
  minScore: number,
  memoryType: MemoryType | undefined,
  now: number,
): ScoredMemory[] {
  if (!store.synapse) return [];
  if (!store.nativeMemoryTreeSearchReady) return [];

  const embedding = store.synapse.embed(query);
  let activation: any;
  try {
    activation = store.graph.memoryTreeSearch(
      embedding,
      store.projectName,
    );
  } catch (e) {
    console.warn(
      `[DevPlan] memoryTreeSearch unavailable, fallback to legacy search: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return [];
  }

  if (!activation || !activation.memories || activation.memories.length === 0) {
    return [];
  }

  const results: ScoredMemory[] = [];
  let hasPersistedAccessUpdate = false;

  for (const mem of activation.memories) {
    if (minScore > 0 && mem.score.combined < minScore) continue;

    const entity = store.graph.getEntity(mem.entity_id);
    if (!entity) continue;

    const p = entity.properties as any;
    if (p.projectName !== store.projectName) continue;
    if (memoryType && p.memoryType !== memoryType) continue;

    if (shouldPersistRecallAccessUpdate(store, p, now)) {
      store.graph.updateEntity(entity.id, {
        properties: {
          ...p,
          hitCount: (p.hitCount || 0) + 1,
          lastAccessedAt: now,
        },
      });
      hasPersistedAccessUpdate = true;
    }

    if (entity.entity_type === ET.MEMORY) {
      results.push({
        ...store.entityToMemory(entity),
        hitCount: (p.hitCount || 0) + 1,
        lastAccessedAt: now,
        score: mem.score.combined,
        sourceKind: 'memory',
      });
    }

    if (results.length >= limit) break;
  }

  if (hasPersistedAccessUpdate) {
    store.graph.flush();
    try {
      const activatedIds = results.map((m) => m.id);
      if (activatedIds.length >= 2) {
        store.graph.memoryTreeStrengthen(activatedIds);
      }
    } catch (e) {
      console.warn(`[DevPlan] memoryTreeStrengthen failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return results;
}

export function recallViaLegacySearch(
  store: RecallStoreBindings,
  query: string,
  limit: number,
  minScore: number,
  memoryType: MemoryType | undefined,
  now: number,
  queryEmbedding?: number[],
): ScoredMemory[] {
  let memoryResults: ScoredMemory[] = [];
  const fetchLimit = limit * 3;

  if (store.semanticSearchReady && store.textSearchReady && store.synapse) {
    try {
      const embedding = queryEmbedding || store.synapse.embed(query);
      const hits = store.graph.hybridSearchTantivy(
        embedding,
        query,
        ET.MEMORY,
        fetchLimit,
        store.recallSearchTuning.rrfK,
      );

      memoryResults = processMemorySearchHits(
        store,
        hits.map((h: any) => ({ entityId: h.entityId, score: h.score })),
        memoryType, minScore, limit, now,
      );
      if (memoryResults.length > 0) return memoryResults;
    } catch (e) {
      console.warn(`[DevPlan] Hybrid memory recall failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (memoryResults.length === 0 && store.semanticSearchReady && store.synapse) {
    try {
      const embedding = queryEmbedding || store.synapse.embed(query);
      const hits = store.graph.searchEntitiesByVector(embedding, fetchLimit, ET.MEMORY);

      memoryResults = processMemorySearchHits(
        store,
        hits,
        memoryType, minScore, limit, now,
      );
      if (memoryResults.length > 0) return memoryResults;
    } catch (e) {
      console.warn(`[DevPlan] Semantic memory recall failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (memoryResults.length === 0 && store.textSearchReady) {
    try {
      const hits = store.graph.searchEntitiesByText(query, ET.MEMORY, fetchLimit);
      const boostedHits = hits
        .map((h: any) => {
          const p = h.entity.properties as any;
          const score = applyBm25TermBoostUtil(
            Number(h.score || 0),
            query,
            `${h.snippet || ''}\n${p?.content || ''}\n${(p?.tags || []).join(' ')}`,
            store.recallSearchTuning,
          );
          return { entityId: h.entityId, score };
        })
        .sort((a: any, b: any) => b.score - a.score);

      memoryResults = processMemorySearchHits(
        store,
        boostedHits,
        memoryType, minScore, limit, now,
      );
      if (memoryResults.length > 0) return memoryResults;
    } catch (e) {
      console.warn(`[DevPlan] BM25 memory recall failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (memoryResults.length === 0) {
    const entities = store.findEntitiesByType(ET.MEMORY);
    const queryLower = query.toLowerCase();
    let hasPersistedAccessUpdate = false;

    for (const e of entities) {
      const p = e.properties as any;
      if (p.projectName !== store.projectName) continue;
      if (memoryType && p.memoryType !== memoryType) continue;

      const content = (p.content || '').toLowerCase();
      const tags = (p.tags || []).join(' ').toLowerCase();
      if (content.includes(queryLower) || tags.includes(queryLower)) {
        if (shouldPersistRecallAccessUpdate(store, p, now)) {
          store.graph.updateEntity(e.id, {
            properties: {
              ...p,
              hitCount: (p.hitCount || 0) + 1,
              lastAccessedAt: now,
            },
          });
          hasPersistedAccessUpdate = true;
        }

        memoryResults.push({
          ...store.entityToMemory(e),
          hitCount: (p.hitCount || 0) + 1,
          lastAccessedAt: now,
          score: 0.5,
          sourceKind: 'memory',
        });
      }
    }

    memoryResults.sort((a, b) => b.importance - a.importance);
    memoryResults = memoryResults.slice(0, limit);
    if (hasPersistedAccessUpdate) {
      store.graph.flush();
    }
  }

  return memoryResults;
}

export function shouldPersistRecallAccessUpdate(store: RecallStoreBindings, props: any, now: number): boolean {
  void store;
  const lastAccessedAt = Number(props?.lastAccessedAt || 0);
  if (!lastAccessedAt) return true;
  return now - lastAccessedAt >= 5 * 60 * 1000;
}

export function processMemorySearchHits(
  store: RecallStoreBindings,
  hits: Array<{ entityId: string; score: number }>,
  memoryType: MemoryType | undefined,
  minScore: number,
  limit: number,
  now: number,
): ScoredMemory[] {
  const results: ScoredMemory[] = [];
  let hasPersistedAccessUpdate = false;

  for (const hit of hits) {
    if (minScore > 0 && hit.score < minScore) continue;
    const entity = store.graph.getEntity(hit.entityId);
    if (!entity) continue;
    const p = entity.properties as any;
    if (p.projectName !== store.projectName) continue;
    if (memoryType && p.memoryType !== memoryType) continue;

    if (shouldPersistRecallAccessUpdate(store, p, now)) {
      store.graph.updateEntity(entity.id, {
        properties: {
          ...p,
          hitCount: (p.hitCount || 0) + 1,
          lastAccessedAt: now,
        },
      });
      hasPersistedAccessUpdate = true;
    }

    results.push({
      ...store.entityToMemory(entity),
      hitCount: (p.hitCount || 0) + 1,
      lastAccessedAt: now,
      score: hit.score,
      sourceKind: 'memory',
    });
    if (results.length >= limit) break;
  }

  if (hasPersistedAccessUpdate) {
    store.graph.flush();
  }

  return results;
}

export function expandMemoriesByGraph(
  store: RecallStoreBindings,
  seedMemories: ScoredMemory[],
  memoryType?: MemoryType,
  limit: number = 10,
): ScoredMemory[] {
  return expandMemoriesBySubgraph(store, seedMemories, memoryType, limit);
}

export function expandMemoriesBySubgraph(
  store: RecallStoreBindings,
  seedMemories: ScoredMemory[],
  memoryType?: MemoryType,
  limit: number = 10,
): ScoredMemory[] {
  const seenIds = new Set(seedMemories.map((m) => m.id));
  const expanded: ScoredMemory[] = [];
  const hopDecay = 0.7;

  for (const seed of seedMemories.slice(0, 5)) {
    try {
      const subgraph = store.graph.extractSubgraph(seed.id, {
        max_hops: 2,
        direction: 'both',
        relation_type_filter: [RT.MEMORY_RELATES],
        entity_type_filter: [ET.MEMORY],
        max_nodes: limit * 2,
      });

      if (!subgraph || !subgraph.entities || !subgraph.depth_map) continue;

      const entityEntries = Object.entries(subgraph.entities) as [string, any][];
      for (const [entityId, entity] of entityEntries) {
        if (seenIds.has(entityId)) continue;
        if (!entity) continue;

        const p = entity.properties || {};
        if (p.projectName !== store.projectName) continue;
        if (memoryType && p.memoryType !== memoryType) continue;

        seenIds.add(entityId);
        const depth = subgraph.depth_map[entityId] || 1;
        const expandedScore = seed.score * Math.pow(hopDecay, depth);

        expanded.push({
          ...store.entityToMemory(entity),
          score: expandedScore,
          sourceKind: 'memory',
        });

        if (expanded.length >= limit) break;
      }
    } catch (e) {
      console.warn(`[DevPlan] extractSubgraph failed for ${seed.id}: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (expanded.length >= limit) break;
  }

  return expanded;
}

export function expandMemoriesByManualTraversal(
  store: RecallStoreBindings,
  seedMemories: ScoredMemory[],
  memoryType?: MemoryType,
  limit: number = 10,
): ScoredMemory[] {
  const seenIds = new Set(seedMemories.map((m) => m.id));
  const expanded: ScoredMemory[] = [];
  const hopDecay = 0.7;

  for (const seed of seedMemories.slice(0, 5)) {
    const outRels = store.getOutRelations(seed.id, RT.MEMORY_RELATES);
    const inRels = store.getInRelations(seed.id, RT.MEMORY_RELATES);
    const allRels = [...outRels, ...inRels];

    for (const rel of allRels) {
      const neighborId = rel.source === seed.id ? rel.target : rel.source;
      if (seenIds.has(neighborId)) continue;

      const neighbor = store.graph.getEntity(neighborId);
      if (!neighbor) continue;
      const p = neighbor.properties as any;
      if (p.projectName !== store.projectName) continue;
      if (memoryType && p.memoryType !== memoryType) continue;

      seenIds.add(neighborId);
      const relWeight = rel.weight || 0.5;
      const expandedScore = seed.score * relWeight * hopDecay;

      expanded.push({
        ...store.entityToMemory(neighbor),
        score: expandedScore,
        sourceKind: 'memory',
      });

      if (expanded.length >= limit) break;

      const hop2OutRels = store.getOutRelations(neighborId, RT.MEMORY_RELATES);
      const hop2InRels = store.getInRelations(neighborId, RT.MEMORY_RELATES);
      for (const hop2Rel of [...hop2OutRels, ...hop2InRels]) {
        const hop2Id = hop2Rel.source === neighborId ? hop2Rel.target : hop2Rel.source;
        if (seenIds.has(hop2Id)) continue;

        const hop2Entity = store.graph.getEntity(hop2Id);
        if (!hop2Entity) continue;
        const hp = hop2Entity.properties as any;
        if (hp.projectName !== store.projectName) continue;
        if (memoryType && hp.memoryType !== memoryType) continue;

        seenIds.add(hop2Id);
        const hop2Weight = hop2Rel.weight || 0.5;
        const hop2Score = expandedScore * hop2Weight * hopDecay;

        expanded.push({
          ...store.entityToMemory(hop2Entity),
          score: hop2Score,
          sourceKind: 'memory',
        });

        if (expanded.length >= limit) break;
      }
    }
    if (expanded.length >= limit) break;
  }

  return expanded;
}

export function hebbianStrengthen(store: RecallStoreBindings, coActivatedMemories: ScoredMemory[]): void {
  if (coActivatedMemories.length < 2) return;
  const top = coActivatedMemories.slice(0, 5);
  const ids = top.map((m) => m.id);

  try {
    store.graph.memoryTreeStrengthen(ids);
    return;
  } catch {
    // fall through
  }

  const HEBBIAN_DELTA = 0.05;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];

      const outRels = store.getOutRelations(a, RT.MEMORY_RELATES);
      const rel = outRels.find((r: any) => r.target === b);
      if (rel) {
        store.graph.adjustRelationWeight(rel.id, a, HEBBIAN_DELTA).catch(() => { /* silent */ });
      }

      const reverseRels = store.getOutRelations(b, RT.MEMORY_RELATES);
      const reverseRel = reverseRels.find((r: any) => r.target === a);
      if (reverseRel) {
        store.graph.adjustRelationWeight(reverseRel.id, b, HEBBIAN_DELTA).catch(() => { /* silent */ });
      }
    }
  }
}
