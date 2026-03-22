import type { Relation } from 'aifastdb';
import type {
  Memory,
  MemoryInput,
  RecallDepth,
  ScoredMemory,
} from './types';
import {
  ANCHOR_TYPES,
  CHANGE_TYPES,
  type NativeAnchorInfo,
  type NativeComponentRef,
  type NativeExtractedAnchor,
  type NativeFlowEntry,
  type NativeFlowFilter,
  type NativeStructureDiff,
  type NativeStructureSnapshot,
} from './dev-plan-graph-store.shared';

export type AnchorFlowStructureStoreBindings = {
  graph: any;
  nativeAnchorExtractReady: boolean;
};

export function integrateAnchorFlowStructure(
  store: AnchorFlowStructureStoreBindings,
  input: MemoryInput,
  memoryEntityId: string,
): {
  anchorInfo?: Memory['anchorInfo'];
  flowEntry?: Memory['flowEntry'];
  structureSnapshotId?: string;
} | null {
  const g = store.graph as any;
  if (typeof g.anchorUpsert !== 'function') {
    return null;
  }

  let anchorName = input.anchorName;
  let anchorType = input.anchorType || ANCHOR_TYPES.CONCEPT;

  if (!anchorName && store.nativeAnchorExtractReady) {
    try {
      const extracted: NativeExtractedAnchor[] = g.anchorExtractFromText(input.content);
      if (extracted && extracted.length > 0) {
        const best = extracted.reduce(
          (a: NativeExtractedAnchor, b: NativeExtractedAnchor) => a.confidence > b.confidence ? a : b,
        );
        anchorName = best.name;
        anchorType = best.suggested_type || anchorType;
      }
    } catch (e) {
      console.warn(`[DevPlan] anchorExtractFromText failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!anchorName) {
    return null;
  }

  const description = (input.contentL1 || input.content.slice(0, 100)).replace(/\n/g, ' ');
  const overview = input.anchorOverview || undefined;
  const anchorOptions = input.anchorMergeMode
    ? { mergeMode: input.anchorMergeMode }
    : undefined;
  let anchorInfo: NativeAnchorInfo;
  let isNew = false;

  try {
    const existing: NativeAnchorInfo | null = g.anchorFind(anchorName, anchorType);
    anchorInfo = g.anchorUpsert(anchorName, anchorType, description, overview, anchorOptions);
    isNew = !existing || existing.id !== anchorInfo.id;
  } catch (e) {
    console.warn(`[DevPlan] anchorUpsert failed for "${anchorName}": ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  if (overview && typeof g.anchorUpdateOverview === 'function') {
    try {
      g.anchorUpdateOverview(anchorInfo.id, overview);
    } catch (e) {
      console.warn(`[DevPlan] anchorUpdateOverview failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const changeType = input.changeType || (isNew ? CHANGE_TYPES.CREATED : CHANGE_TYPES.MODIFIED);
  const summary = (input.contentL1 || input.content.slice(0, 80)).replace(/\n/g, ' ');
  const detail = input.contentL2 || input.content;
  const sourceTask = input.relatedTaskId || undefined;

  let flowEntry: NativeFlowEntry | null = null;
  try {
    flowEntry = g.flowAppend(
      anchorInfo.id,
      changeType,
      summary,
      detail,
      sourceTask ?? null,
    );
  } catch (e) {
    console.warn(`[DevPlan] flowAppend failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    store.graph.putRelation(memoryEntityId, anchorInfo.id, 'anchored_by');
  } catch (e) {
    console.warn(`[DevPlan] putRelation anchored_by failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  let structureSnapshotId: string | undefined;
  if (input.structureComponents && input.structureComponents.length > 0 && flowEntry) {
    try {
      const components: NativeComponentRef[] = input.structureComponents.map((c) => ({
        anchorId: c.anchorId,
        role: c.role,
        versionHint: c.versionHint,
      }));
      const snapshot: NativeStructureSnapshot | null = g.structureSnapshot(
        flowEntry.id,
        anchorInfo.id,
        flowEntry.version,
        components,
      );
      if (snapshot) {
        structureSnapshotId = snapshot.id;
      }
    } catch (e) {
      console.warn(`[DevPlan] structureSnapshot failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    anchorInfo: {
      id: anchorInfo.id,
      name: anchorInfo.name,
      anchorType: anchorInfo.anchor_type,
      description: anchorInfo.description,
      version: anchorInfo.version,
      isNew,
    },
    flowEntry: flowEntry ? {
      id: flowEntry.id,
      version: flowEntry.version,
      changeType: flowEntry.change_type,
      summary: flowEntry.summary,
    } : undefined,
    structureSnapshotId,
  };
}

export function queryAnchorFlow(
  store: AnchorFlowStructureStoreBindings,
  anchorName: string,
  anchorType?: string,
  filter?: NativeFlowFilter,
): NativeFlowEntry[] {
  const g = store.graph as any;
  if (typeof g.anchorFind !== 'function') return [];

  const type = anchorType || ANCHOR_TYPES.CONCEPT;
  const anchor: NativeAnchorInfo | null = g.anchorFind(anchorName, type);
  if (!anchor) {
    const byName: NativeAnchorInfo | null = g.anchorFindByName(anchorName);
    if (!byName) return [];
    return g.flowQuery(byName.id, filter ?? null);
  }
  return g.flowQuery(anchor.id, filter ?? null);
}

export function listAnchors(
  store: AnchorFlowStructureStoreBindings,
  anchorTypeFilter?: string,
): NativeAnchorInfo[] {
  const g = store.graph as any;
  if (typeof g.anchorList !== 'function') return [];
  return g.anchorList(anchorTypeFilter ?? null);
}

export function getAnchorStructure(
  store: AnchorFlowStructureStoreBindings,
  anchorId: string,
): NativeStructureSnapshot | null {
  const g = store.graph as any;
  if (typeof g.structureCurrent !== 'function') return null;
  return g.structureCurrent(anchorId);
}

export function getStructureDiff(
  store: AnchorFlowStructureStoreBindings,
  anchorId: string,
  fromVersion: number,
  toVersion: number,
): NativeStructureDiff | null {
  const g = store.graph as any;
  if (typeof g.structureDiff !== 'function') return null;
  return g.structureDiff(anchorId, fromVersion, toVersion);
}

export function enrichMemoriesWithAnchorInfo(
  store: AnchorFlowStructureStoreBindings,
  results: ScoredMemory[],
  depth: RecallDepth = 'L1',
): void {
  const g = store.graph as any;
  if (typeof g.anchorGetById !== 'function') return;

  for (const mem of results) {
    if (mem.sourceKind !== 'memory') continue;

    try {
      const outgoing = store.graph.outgoingByType(mem.id, 'anchored_by') as Relation[];
      if (!outgoing || outgoing.length === 0) continue;

      const anchorId = outgoing[0].target;
      const anchor: NativeAnchorInfo | null = g.anchorGetById(anchorId);
      if (!anchor) continue;

      mem.anchorInfo = {
        id: anchor.id,
        name: anchor.name,
        anchorType: anchor.anchor_type,
        description: anchor.description,
        uri: anchor.uri,
        path: anchor.path,
        overview: anchor.overview || null,
        version: anchor.version,
        flowCount: anchor.flow_count,
      };

      if (depth === 'L2' || depth === 'L3') {
        try {
          const entries: NativeFlowEntry[] = g.flowQuery(anchorId, {
            limit: 5,
            newestFirst: true,
          });
          if (entries && entries.length > 0) {
            mem.flowEntries = entries.map((e) => ({
              id: e.id,
              version: e.version,
              changeType: e.change_type,
              summary: e.summary,
              detail: e.detail,
              sourceTask: e.source_task,
              createdAt: e.created_at,
            }));
          }
        } catch {
          // ignore L2 failures
        }
      }

      if (depth === 'L3') {
        try {
          const snapshot: NativeStructureSnapshot | null = g.structureCurrent(anchorId);
          if (snapshot && snapshot.components.length > 0) {
            mem.structureSnapshot = {
              id: snapshot.id,
              version: snapshot.version,
              components: snapshot.components.map((c) => ({
                anchorId: c.anchorId,
                role: c.role,
                versionHint: c.versionHint,
              })),
            };
          }
        } catch {
          // ignore L3 failures
        }
      }
    } catch {
      // ignore per-memory failures
    }
  }
}
