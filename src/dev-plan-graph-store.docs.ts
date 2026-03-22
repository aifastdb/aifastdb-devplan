import type { Entity, TextSearchHit, VectorSearchHit } from 'aifastdb';
import type {
  DevPlanDoc,
  DevPlanDocTree,
  DevPlanSection,
  MainTask,
  ScoredDevPlanDoc,
  SearchMode,
} from './types';
import { ET, RT, type ResolvedRecallSearchTuning } from './dev-plan-graph-store.shared';
import { isUuidLikeQuery, rankLiteralDocMatches } from './doc-search-utils';
import {
  applyBm25TermBoost as applyBm25TermBoostUtil,
} from './dev-plan-graph-store.utils';
import { rrfFusionThreeWay as rrfFusionThreeWayUtil } from './dev-plan-graph-store.recall-utils';

function sectionKeyLocal(section: string, subSection?: string): string {
  return subSection ? `${section}|${subSection}` : section;
}

export type DocStoreBindings = {
  projectName: string;
  graph: any;
  synapse?: { embed(query: string): number[] } | null;
  textSearchReady: boolean;
  recallSearchTuning: ResolvedRecallSearchTuning;
  ensureSynapseReady(): boolean;
  findEntitiesByType(entityType: string): Entity[];
  findEntityByProp(entityType: string, propKey: string, value: string): Entity | null;
  entityToDevPlanDoc(entity: Entity): DevPlanDoc;
  entityToMainTask(entity: Entity): MainTask;
  rerankSearchResults<T extends { id: string; content?: string; title?: string }>(query: string, items: T[], limit: number): T[];
  getOutRelations(entityId: string, relationType?: string): any[];
  getInRelations(entityId: string, relationType?: string): any[];
};

export function findDocEntityBySection(
  store: DocStoreBindings,
  section: string,
  subSection?: string,
): Entity | null {
  const key = sectionKeyLocal(section, subSection);
  const docs = store.findEntitiesByType(ET.DOC);
  return docs.find((e) => {
    const p = e.properties as any;
    return sectionKeyLocal(p.section, p.subSection || undefined) === key;
  }) || null;
}

export function getSection(
  store: DocStoreBindings,
  section: DevPlanSection,
  subSection?: string,
): DevPlanDoc | null {
  const docs = store.findEntitiesByType(ET.DOC);
  const key = sectionKeyLocal(section, subSection);
  for (const doc of docs) {
    const p = doc.properties as any;
    const docKey = sectionKeyLocal(p.section, p.subSection || undefined);
    if (docKey === key) {
      return store.entityToDevPlanDoc(doc);
    }
  }
  return null;
}

export function listSections(store: DocStoreBindings): DevPlanDoc[] {
  const entities = store.findEntitiesByType(ET.DOC);
  return entities.map((e) => store.entityToDevPlanDoc(e));
}

export function searchSections(
  store: DocStoreBindings,
  query: string,
  limit: number = 10,
): DevPlanDoc[] {
  const mode: SearchMode = store.ensureSynapseReady() ? 'hybrid' : 'literal';
  return searchSectionsAdvanced(store, query, { mode, limit }).map(({ score, ...doc }) => doc);
}

export function searchSectionsAdvanced(
  store: DocStoreBindings,
  query: string,
  options?: {
    mode?: SearchMode;
    limit?: number;
    minScore?: number;
    _skipRerank?: boolean;
    _queryEmbedding?: number[];
  },
): ScoredDevPlanDoc[] {
  const mode = options?.mode || 'hybrid';
  const limit = options?.limit || 10;
  const minScore = options?.minScore || 0;
  const skipRerank = options?._skipRerank === true;
  const sharedQueryEmbedding = options?._queryEmbedding;
  const semanticReady = mode !== 'literal' ? store.ensureSynapseReady() : false;

  const maybeRerank = <T extends { id: string; content?: string; title?: string }>(results: T[]): T[] =>
    skipRerank ? results : store.rerankSearchResults(query, results, limit);

  let cachedTextResults: Array<{ id: string; score?: number; doc?: DevPlanDoc }> | null = null;
  const getTextResults = (): Array<{ id: string; score?: number; doc?: DevPlanDoc }> => {
    if (cachedTextResults) return cachedTextResults;

    const allDocs = listSections(store);
    const literalMatches = rankLiteralDocMatches(query, allDocs, limit * 3);
    const exactIdMatch = isUuidLikeQuery(query)
      ? literalMatches.find((match) => match.doc.id.toLowerCase() === query.trim().toLowerCase())
      : undefined;
    const preferredLiteralMatches = literalMatches.filter(
      (match) => match.matchedFields.includes('id') || match.matchedFields.includes('title'),
    );
    const secondaryLiteralMatches = literalMatches.filter(
      (match) => !match.matchedFields.includes('id') && !match.matchedFields.includes('title'),
    );

    let textResults: Array<{ id: string; score?: number; doc?: DevPlanDoc }> = [];
    if (store.textSearchReady) {
      try {
        const bm25Hits: TextSearchHit[] = store.graph.searchEntitiesByText(query, ET.DOC, limit * 2);
        const bm25Results = bm25Hits
          .filter((h) => (h.entity.properties as any)?.projectName === store.projectName)
          .map((h) => {
            const doc = store.entityToDevPlanDoc(h.entity);
            const score = applyBm25TermBoostUtil(
              Number(h.score || 0),
              query,
              `${h.snippet || ''}\n${doc.title}\n${doc.content}`,
              store.recallSearchTuning,
            );
            return {
              id: h.entityId,
              score,
              doc,
            };
          })
          .sort((a, b) => (b.score || 0) - (a.score || 0));

        const merged = new Map<string, { id: string; score?: number; doc?: DevPlanDoc }>();
        const pushResult = (item: { id: string; score?: number; doc?: DevPlanDoc }) => {
          if (!merged.has(item.id)) merged.set(item.id, item);
        };
        if (exactIdMatch) pushResult({ id: exactIdMatch.doc.id, score: exactIdMatch.score, doc: exactIdMatch.doc });
        for (const match of preferredLiteralMatches) pushResult({ id: match.doc.id, score: match.score, doc: match.doc });
        for (const item of bm25Results) pushResult(item);
        for (const match of secondaryLiteralMatches) pushResult({ id: match.doc.id, score: match.score, doc: match.doc });
        textResults = Array.from(merged.values());
      } catch (e) {
        console.warn(`[DevPlan] Tantivy BM25 search failed: ${e instanceof Error ? e.message : String(e)}. Falling back to literal.`);
        textResults = literalMatches.map((match) => ({ id: match.doc.id, score: match.score, doc: match.doc }));
      }
    } else {
      textResults = literalMatches.map((match) => ({ id: match.doc.id, score: match.score, doc: match.doc }));
    }

    cachedTextResults = textResults;
    return textResults;
  };

  if (mode === 'literal' || !semanticReady || !store.synapse) {
    const textResults = getTextResults();
    const results = textResults.slice(0, limit).map((r) => ({
      ...(r.doc || store.entityToDevPlanDoc(store.graph.getEntity(r.id)!)),
      score: r.score,
    }));
    return maybeRerank(results);
  }

  let semanticHits: VectorSearchHit[] = [];
  try {
    const embedding = sharedQueryEmbedding || store.synapse.embed(query);
    semanticHits = store.graph.searchEntitiesByVector(embedding, limit * 2, ET.DOC);
  } catch (e) {
    console.warn(`[DevPlan] Semantic search failed: ${e instanceof Error ? e.message : String(e)}`);
    const textResults = getTextResults();
    const results = textResults.slice(0, limit).map((r) => ({
      ...(r.doc || store.entityToDevPlanDoc(store.graph.getEntity(r.id)!)),
      score: r.score,
    }));
    return maybeRerank(results);
  }

  if (mode === 'semantic') {
    const docs: ScoredDevPlanDoc[] = [];
    for (const hit of semanticHits) {
      if (minScore > 0 && hit.score < minScore) continue;
      const entity = store.graph.getEntity(hit.entityId);
      if (entity && (entity.properties as any)?.projectName === store.projectName) {
        docs.push({ ...store.entityToDevPlanDoc(entity), score: hit.score });
      }
      if (docs.length >= limit) break;
    }
    return maybeRerank(docs);
  }

  const textResults = getTextResults();
  const rrfResults = rrfFusionThreeWayUtil(
    semanticHits,
    textResults,
    limit,
    minScore,
    store.recallSearchTuning,
    (id) => {
      const entity = store.graph.getEntity(id);
      if (entity && (entity.properties as any)?.projectName === store.projectName) {
        return store.entityToDevPlanDoc(entity);
      }
      return undefined;
    },
  );
  return maybeRerank(rrfResults);
}

export function getTaskRelatedDocs(store: DocStoreBindings, taskId: string): DevPlanDoc[] {
  const taskEntity = store.findEntityByProp(ET.MAIN_TASK, 'taskId', taskId);
  if (!taskEntity) return [];

  const rels = store.getOutRelations(taskEntity.id, RT.TASK_HAS_DOC);
  const docs: DevPlanDoc[] = [];
  for (const rel of rels) {
    const docEntity = store.graph.getEntity(rel.target);
    if (docEntity) docs.push(store.entityToDevPlanDoc(docEntity));
  }
  return docs;
}

export function getDocRelatedTasks(
  store: DocStoreBindings,
  section: DevPlanSection,
  subSection?: string,
): MainTask[] {
  const doc = getSection(store, section, subSection);
  if (!doc) return [];

  const rels = store.getInRelations(doc.id, RT.TASK_HAS_DOC);
  const tasks: MainTask[] = [];
  for (const rel of rels) {
    const taskEntity = store.graph.getEntity(rel.source);
    if (taskEntity) tasks.push(store.entityToMainTask(taskEntity));
  }
  return tasks;
}

export function getChildDocs(
  store: DocStoreBindings,
  section: DevPlanSection,
  subSection?: string,
): DevPlanDoc[] {
  const docEntity = findDocEntityBySection(store, section, subSection);
  if (!docEntity) return [];

  const rels = store.getOutRelations(docEntity.id, RT.DOC_HAS_CHILD);
  const children: DevPlanDoc[] = [];
  for (const rel of rels) {
    const childEntity = store.graph.getEntity(rel.target);
    if (childEntity) children.push(store.entityToDevPlanDoc(childEntity));
  }
  return children;
}

export function getDocTree(
  store: DocStoreBindings,
  section: DevPlanSection,
  subSection?: string,
): DevPlanDocTree | null {
  const doc = getSection(store, section, subSection);
  if (!doc) return null;
  return buildDocTree(store, doc);
}

export function buildDocTree(store: DocStoreBindings, doc: DevPlanDoc): DevPlanDocTree {
  const children = getChildDocs(store, doc.section, doc.subSection);
  return {
    doc,
    children: children.map((child) => buildDocTree(store, child)),
  };
}
