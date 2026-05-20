import type { Entity } from 'aifastdb';
import type {
  DevPlanExportedGraph,
  DevPlanGraphEdge,
  DevPlanGraphNode,
  DevPlanPaginatedGraph,
  DevPlanSection,
  EntityGroupAggregation,
  MainTask,
  Memory,
  ProjectProgress,
  Prompt,
  ScoredMemory,
  SubTask,
} from './types';
import { mapGroupToDevPlanType, progressBar } from './dev-plan-graph-store.utils';
import { ET, RT } from './dev-plan-graph-store.shared';

export type VisualizeStoreBindings = {
  graph: any;
  projectName: string;
  getProjectId(): string;
  getProgress(): ProjectProgress;
  listSubTasks(parentTaskId: string, filter?: { status?: string }): SubTask[];
  listMainTasks(filter?: { status?: string; priority?: string; moduleId?: string }): MainTask[];
  listSections(): any[];
  listPrompts(filter?: { date?: string; relatedTaskId?: string; limit?: number }): Prompt[];
  listModules(filter?: { status?: string }): any[];
  listMemories?(): Memory[];
  entityToMemory(entity: Entity): Memory;
  findEntitiesByType(entityType: string): Entity[];
  findEntityByProp(entityType: string, propKey: string, value: string): Entity | null;
  findDocEntityBySection(section: string, subSection?: string): Entity | null;
  getOutRelations(entityId: string, relationType?: string): any[];
  getInRelations(entityId: string, relationType?: string): any[];
};

export function exportToMarkdown(store: VisualizeStoreBindings): string {
  const sections = store.listSections();
  const progress = store.getProgress();

  let md = `# ${store.projectName} - 开发计划\n\n`;
  md += `> 生成时间: ${new Date().toISOString()}\n`;
  md += `> 总体进度: ${progress.overallPercent}% (${progress.completedSubTasks}/${progress.subTaskCount})\n`;
  md += `> 存储引擎: SocialGraphV2\n\n`;

  const sectionOrder: DevPlanSection[] = [
    'overview', 'core_concepts', 'api_design', 'file_structure',
    'config', 'examples', 'technical_notes', 'api_endpoints',
    'milestones', 'changelog', 'custom',
  ];

  for (const sectionType of sectionOrder) {
    const sectionDocs = sections.filter((s) => s.section === sectionType);
    for (const doc of sectionDocs) {
      md += doc.content + '\n\n---\n\n';
    }
  }

  md += '## 开发任务进度\n\n';
  for (const taskProg of progress.tasks) {
    const statusIcon = taskProg.status === 'completed' ? '✅'
      : taskProg.status === 'in_progress' ? '🔄'
      : taskProg.status === 'cancelled' ? '❌'
      : taskProg.status === 'revoked' ? '↩️' : '⬜';
    md += `### ${statusIcon} ${taskProg.title} (${taskProg.completed}/${taskProg.total})\n\n`;

    const subs = store.listSubTasks(taskProg.taskId);
    if (subs.length > 0) {
      md += '| 任务 | 描述 | 状态 | 完成日期 |\n';
      md += '|-----|------|------|--------|\n';
      for (const sub of subs) {
        const subIcon = sub.status === 'completed' ? '✅ 已完成'
          : sub.status === 'in_progress' ? '🔄 进行中'
          : sub.status === 'cancelled' ? '❌ 已取消'
          : sub.status === 'revoked' ? '↩️ 已撤销' : '⬜ 待开始';
        const date = sub.completedAt
          ? new Date(sub.completedAt).toISOString().split('T')[0]
          : '-';
        md += `| ${sub.taskId} | ${sub.title} | ${subIcon} | ${date} |\n`;
      }
      md += '\n';
    }
  }

  return md;
}

export function exportTaskSummary(store: VisualizeStoreBindings): string {
  const progress = store.getProgress();

  let md = `# ${store.projectName} - 任务进度总览\n\n`;
  md += `> 更新时间: ${new Date().toISOString()}\n`;
  md += `> 总体进度: **${progress.overallPercent}%** (${progress.completedSubTasks}/${progress.subTaskCount} 子任务完成)\n`;
  md += `> 主任务完成: ${progress.completedMainTasks}/${progress.mainTaskCount}\n`;
  md += `> 存储引擎: SocialGraphV2\n\n`;

  for (const tp of progress.tasks) {
    const bar = progressBar(tp.percent);
    const statusIcon = tp.status === 'completed' ? '✅'
      : tp.status === 'in_progress' ? '🔄' : '⬜';
    md += `${statusIcon} **${tp.title}** [${tp.priority}]\n`;
    md += `   ${bar} ${tp.percent}% (${tp.completed}/${tp.total})\n\n`;
  }

  return md;
}

export function exportGraph(
  store: VisualizeStoreBindings,
  options?: {
    includeDocuments?: boolean;
    includeModules?: boolean;
    includeNodeDegree?: boolean;
    enableBackendDegreeFallback?: boolean;
    includePrompts?: boolean;
    includeMemories?: boolean;
  },
): DevPlanExportedGraph {
  const includeDocuments = options?.includeDocuments !== false;
  const includeModules = options?.includeModules !== false;
  const includeNodeDegree = options?.includeNodeDegree !== false;
  const enableBackendDegreeFallback = options?.enableBackendDegreeFallback !== false;
  const includePrompts = options?.includePrompts !== false;
  const includeMemories = options?.includeMemories !== false;

  const nodes: DevPlanGraphNode[] = [];
  const edges: DevPlanGraphEdge[] = [];
  const projectId = store.getProjectId();
  const projectName = store.projectName;

  // 用于按 (entityId, label) 索引原生边的 key，避免逐条 getOutRelations / getInRelations 调用
  const outKey = (id: string, label: string) => `o|${id}|${label}`;
  const inKey = (id: string, label: string) => `i|${id}|${label}`;

  // ── 1. 一次性批量加载所有需要的数据 ──
  const mainTasks = store.listMainTasks();

  // 主任务的 entity-id 索引（用于 memory.relatedTaskId 反查 taskEntity.id，替代 N 次 findEntityByProp）
  const mainTaskEntityIdByTaskId = new Map<string, string>();
  for (const mt of mainTasks) {
    if (mt.taskId) mainTaskEntityIdByTaskId.set(mt.taskId, mt.id);
  }

  // 批量获取所有子任务（一次 findEntitiesByType 代替 M 次 listSubTasks 全表扫描）
  const allSubTaskEntities = store.findEntitiesByType(ET.SUB_TASK).filter(
    (e) => (e.properties as any).projectName === projectName,
  );
  const subTasksByParent = new Map<string, Array<{
    entityId: string;
    title: string;
    taskId: string;
    parentTaskId: string;
    status: string;
    completedAt: number | null;
    order: number | undefined;
    createdAt: number;
  }>>();
  for (const e of allSubTaskEntities) {
    const p = e.properties as any;
    const parentTaskId: string = p.parentTaskId || '';
    if (!parentTaskId) continue;
    const arr = subTasksByParent.get(parentTaskId);
    const item = {
      entityId: e.id,
      title: p.title || (e as any).name || '',
      taskId: p.taskId || '',
      parentTaskId,
      status: p.status || 'pending',
      completedAt: p.completedAt || null,
      order: p.order != null ? p.order : undefined,
      createdAt: p.createdAt || (e as any).created_at || 0,
    };
    if (arr) {
      arr.push(item);
    } else {
      subTasksByParent.set(parentTaskId, [item]);
    }
  }
  // 与 listSubTasks 等价的排序（按 order/createdAt 升序）
  for (const arr of subTasksByParent.values()) {
    arr.sort((a, b) => {
      const ao = a.order != null ? a.order : Number.MAX_SAFE_INTEGER;
      const bo = b.order != null ? b.order : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.createdAt - b.createdAt;
    });
  }

  // 一次原生 exportGraph 拿到 degree + 全部边，替代后续的 getOutRelations/getInRelations N+1 循环
  let nativeNodes: any[] = [];
  let nativeEdges: any[] = [];
  try {
    // 估算上限：节点 = 主任务 + 子任务 + 项目/模块/文档/Prompt/记忆 缓冲
    const estimatedNodes = Math.max(2000, (mainTasks.length + allSubTaskEntities.length) * 2 + 4000);
    const nativeGraph = store.graph.exportGraph({
      includeNodeDegree,
      includeEdgeMeta: false,
      maxNodes: estimatedNodes,
      maxEdges: estimatedNodes * 4,
    } as any) as any;
    nativeNodes = Array.isArray(nativeGraph?.nodes) ? nativeGraph.nodes : [];
    nativeEdges = Array.isArray(nativeGraph?.edges) ? nativeGraph.edges : [];
  } catch {
    // noop
  }

  const nativeDegreeMap: Record<string, number> = {};
  for (const n of nativeNodes) {
    if (typeof n?.id !== 'string') continue;
    if (typeof n?.degree === 'number' && Number.isFinite(n.degree)) {
      nativeDegreeMap[n.id] = n.degree;
    }
  }

  // (fromId|label) -> toId[]，(toId|label) -> fromId[]，再附带可选 weight
  type EdgeMeta = { otherId: string; weight?: number };
  const outIndex = new Map<string, EdgeMeta[]>();
  const inIndex = new Map<string, EdgeMeta[]>();
  for (const e of nativeEdges) {
    const from = typeof e?.from === 'string' ? e.from : '';
    const to = typeof e?.to === 'string' ? e.to : '';
    const label = (typeof e?.label === 'string' && e.label)
      || (typeof e?.relation_type === 'string' && e.relation_type)
      || '';
    if (!from || !to || !label) continue;
    const weight = typeof e?.weight === 'number' ? e.weight : undefined;
    const oArr = outIndex.get(outKey(from, label));
    if (oArr) oArr.push({ otherId: to, weight });
    else outIndex.set(outKey(from, label), [{ otherId: to, weight }]);
    const iArr = inIndex.get(inKey(to, label));
    if (iArr) iArr.push({ otherId: from, weight });
    else inIndex.set(inKey(to, label), [{ otherId: from, weight }]);
  }
  const getOutTargets = (id: string, label: string): EdgeMeta[] => outIndex.get(outKey(id, label)) || [];
  const getInSources = (id: string, label: string): EdgeMeta[] => inIndex.get(inKey(id, label)) || [];

  // ── 2. 项目根节点 ──
  nodes.push({
    id: projectId,
    label: projectName,
    type: 'project',
    properties: { entityType: ET.PROJECT },
  });

  // ── 3. 主任务 + 子任务 + task→doc / task→prompt 边 ──
  for (const mt of mainTasks) {
    nodes.push({
      id: mt.id,
      label: mt.title,
      type: 'main-task',
      properties: {
        taskId: mt.taskId,
        priority: mt.priority,
        status: mt.status,
        totalSubtasks: mt.totalSubtasks,
        completedSubtasks: mt.completedSubtasks,
        completedAt: mt.completedAt || null,
      },
    });
    edges.push({ from: projectId, to: mt.id, label: RT.HAS_MAIN_TASK });

    const subs = subTasksByParent.get(mt.taskId);
    if (subs) {
      for (const st of subs) {
        nodes.push({
          id: st.entityId,
          label: st.title,
          type: 'sub-task',
          properties: {
            taskId: st.taskId,
            parentTaskId: st.parentTaskId,
            status: st.status,
            completedAt: st.completedAt,
          },
        });
        edges.push({ from: mt.id, to: st.entityId, label: RT.HAS_SUB_TASK });
      }
    }

    // task → doc 边（来自原生 edges 索引，避免 N+1）
    for (const meta of getOutTargets(mt.id, RT.TASK_HAS_DOC)) {
      edges.push({ from: mt.id, to: meta.otherId, label: RT.TASK_HAS_DOC });
    }

    if (includePrompts) {
      for (const meta of getOutTargets(mt.id, RT.TASK_HAS_PROMPT)) {
        edges.push({ from: mt.id, to: meta.otherId, label: RT.TASK_HAS_PROMPT });
      }
    }
  }

  // ── 4. Prompts ──
  if (includePrompts) {
    const prompts = store.listPrompts();
    for (const prompt of prompts) {
      nodes.push({
        id: prompt.id,
        label: `Prompt #${prompt.promptIndex}`,
        type: 'prompt',
        properties: {
          promptIndex: prompt.promptIndex,
          summary: prompt.summary || '',
          relatedTaskId: prompt.relatedTaskId || null,
          createdAt: prompt.createdAt,
        },
      });
      edges.push({ from: projectId, to: prompt.id, label: RT.HAS_PROMPT });
    }
  }

  // ── 5. Documents（doc→child 边来自原生 edges 索引，不再 findDocEntityBySection + getOutRelations）──
  if (includeDocuments) {
    const docs = store.listSections();
    for (const doc of docs) {
      nodes.push({
        id: doc.id,
        label: doc.title,
        type: 'document',
        properties: {
          section: doc.section,
          subSection: doc.subSection,
          version: doc.version,
          parentDoc: doc.parentDoc || null,
          childDocs: doc.childDocs || [],
        },
      });

      if (!doc.parentDoc) {
        edges.push({ from: projectId, to: doc.id, label: RT.HAS_DOCUMENT });
      }

      if (doc.childDocs?.length) {
        for (const meta of getOutTargets(doc.id, RT.DOC_HAS_CHILD)) {
          edges.push({ from: doc.id, to: meta.otherId, label: RT.DOC_HAS_CHILD });
        }
      }
    }
  }

  // ── 6. Modules（按 moduleId 分组主任务，避免 listMainTasks({moduleId}) × Mod）──
  if (includeModules) {
    const modules = store.listModules();
    const tasksByModuleId = new Map<string, MainTask[]>();
    for (const mt of mainTasks) {
      const modId = (mt as any).moduleId as string | undefined;
      if (!modId) continue;
      const arr = tasksByModuleId.get(modId);
      if (arr) arr.push(mt);
      else tasksByModuleId.set(modId, [mt]);
    }

    for (const mod of modules) {
      nodes.push({
        id: mod.id,
        label: mod.name,
        type: 'module',
        properties: {
          moduleId: mod.moduleId,
          status: mod.status,
          mainTaskCount: mod.mainTaskCount,
        },
      });
      edges.push({ from: projectId, to: mod.id, label: RT.HAS_MODULE });

      const moduleTasks = tasksByModuleId.get(mod.moduleId) || [];
      for (const mt of moduleTasks) {
        edges.push({ from: mod.id, to: mt.id, label: RT.MODULE_HAS_TASK });
      }
    }
  }

  // ── 7. Memories（单次扫描，所有 memory 关系都从原生 edges 索引获取）──
  // 修复原实现 bug：第二段 memory 扫描原本不受 includeMemories 守门，会导致默认情况下 memory 节点被 push 两次
  if (includeMemories) {
    const memoryEntities = store.findEntitiesByType(ET.MEMORY).filter(
      (e) => (e.properties as any).projectName === projectName,
    );

    const memEdgeDedup = new Set<string>();
    const dedupPushEdge = (
      from: string,
      to: string,
      label: string,
      weight?: number,
    ): void => {
      const k = `${from}-${to}-${label}`;
      if (memEdgeDedup.has(k)) return;
      memEdgeDedup.add(k);
      edges.push({
        from,
        to,
        label,
        properties: weight != null ? { weight } : undefined,
      });
    };

    for (const memEntity of memoryEntities) {
      const mem = store.entityToMemory(memEntity);
      const content = mem.content || '';
      nodes.push({
        id: mem.id,
        label: `${mem.memoryType}: ${content.slice(0, 30)}...`,
        type: 'memory',
        properties: {
          memoryType: mem.memoryType,
          content: content.length > 120 ? content.slice(0, 120) + '...' : content,
          importance: mem.importance,
          hitCount: mem.hitCount,
          tags: mem.tags || [],
          relatedTaskId: mem.relatedTaskId || null,
          sourceRef: mem.sourceRef || null,
          provenance: mem.provenance || null,
          createdAt: mem.createdAt,
        },
      });
      edges.push({ from: projectId, to: mem.id, label: RT.HAS_MEMORY });

      // memory → main task（用 taskId 索引替代 N 次 findEntityByProp）
      if (mem.relatedTaskId) {
        const taskEntityId = mainTaskEntityIdByTaskId.get(mem.relatedTaskId);
        if (taskEntityId) {
          edges.push({ from: mem.id, to: taskEntityId, label: RT.MEMORY_FROM_TASK });
        }
      }

      // MEMORY_RELATES：保留 mem.id < target 的去重策略
      for (const meta of getOutTargets(mem.id, RT.MEMORY_RELATES)) {
        if (mem.id < meta.otherId) {
          dedupPushEdge(mem.id, meta.otherId, RT.MEMORY_RELATES, meta.weight);
        }
      }

      // doc → memory
      for (const meta of getInSources(mem.id, RT.MEMORY_FROM_DOC)) {
        dedupPushEdge(meta.otherId, mem.id, RT.MEMORY_FROM_DOC);
      }
      // module → memory
      for (const meta of getInSources(mem.id, RT.MODULE_MEMORY)) {
        dedupPushEdge(meta.otherId, mem.id, RT.MODULE_MEMORY);
      }
      for (const meta of getOutTargets(mem.id, RT.MEMORY_SUPERSEDES)) {
        dedupPushEdge(mem.id, meta.otherId, RT.MEMORY_SUPERSEDES);
      }
      for (const meta of getOutTargets(mem.id, RT.MEMORY_CONFLICTS)) {
        dedupPushEdge(mem.id, meta.otherId, RT.MEMORY_CONFLICTS);
      }
    }
  }

  // ── 8. Node degree（复用上面已经拿到的 nativeDegreeMap）──
  if (includeNodeDegree) {
    const edgeDegreeMap: Record<string, number> = {};
    if (enableBackendDegreeFallback) {
      for (const node of nodes) edgeDegreeMap[node.id] = 0;
      for (const edge of edges) {
        if (edgeDegreeMap[edge.from] !== undefined) edgeDegreeMap[edge.from] += 1;
        if (edgeDegreeMap[edge.to] !== undefined) edgeDegreeMap[edge.to] += 1;
      }
    }

    for (const node of nodes) {
      const nativeDegree = nativeDegreeMap[node.id];
      if (typeof nativeDegree === 'number' && Number.isFinite(nativeDegree)) {
        node.degree = nativeDegree;
        continue;
      }
      node.degree = enableBackendDegreeFallback ? (edgeDegreeMap[node.id] || 0) : 0;
    }
  }

  return { nodes, edges };
}

export function exportGraphPaginated(
  store: VisualizeStoreBindings,
  offset: number,
  limit: number,
  options?: {
    includeDocuments?: boolean;
    includeModules?: boolean;
    includeNodeDegree?: boolean;
    entityTypes?: string[];
  },
): DevPlanPaginatedGraph {
  const includeDocuments = options?.includeDocuments !== false;
  const includeModules = options?.includeModules !== false;
  const includeNodeDegree = options?.includeNodeDegree !== false;

  const entityTypes: string[] = [];
  entityTypes.push(ET.PROJECT, ET.MAIN_TASK, ET.SUB_TASK);
  if (includeDocuments) entityTypes.push(ET.DOC);
  if (includeModules) entityTypes.push(ET.MODULE);
  if (options?.entityTypes?.length) {
    entityTypes.length = 0;
    entityTypes.push(...options.entityTypes);
  }

  try {
    const result = store.graph.exportGraphPaginated({
      offset,
      limit,
      entityTypes,
      includeNodeDegree,
      includeEdgeMeta: false,
    });

    if (result && typeof result === 'object') {
      const rustNodes: any[] = result.nodes || [];
      const rustEdges: any[] = result.edges || [];
      const currentProjectId = store.getProjectId();
      const nodes: DevPlanGraphNode[] = [];

      for (const n of rustNodes) {
        const data = n.data || {};
        let etStr: string | undefined = n.entity_type || n.entityType || data.entity_type || data.entityType;
        if (!etStr || typeof etStr !== 'string') {
          try {
            const entity = store.graph.getEntity(n.id);
            if (entity) etStr = entity.entity_type;
          } catch {}
        }
        const devPlanType = mapGroupToDevPlanType(etStr || n.group);
        if (devPlanType === 'project' && n.id !== currentProjectId) {
          continue;
        }
        nodes.push({
          id: n.id,
          label: n.label || n.id,
          type: devPlanType,
          degree: includeNodeDegree ? (n.degree ?? 0) : undefined,
          properties: data,
        });
      }

      const edges: DevPlanGraphEdge[] = rustEdges.map((e: any) => ({
        from: e.from,
        to: e.to,
        label: e.label || e.relation_type || '',
      }));

      return {
        nodes,
        edges,
        totalNodes: result.totalNodes ?? nodes.length,
        totalEdges: result.totalEdges ?? edges.length,
        offset: result.offset ?? offset,
        limit: result.limit ?? limit,
        hasMore: result.hasMore ?? false,
      };
    }
  } catch {
    // noop
  }

  const fullGraph = exportGraph(store, {
    includeDocuments,
    includeModules,
    includeNodeDegree,
    enableBackendDegreeFallback: true,
  });

  const allNodes = fullGraph.nodes;
  const pageNodes = allNodes.slice(offset, offset + limit);
  const pageNodeIds = new Set(pageNodes.map((n) => n.id));
  const pageEdges = fullGraph.edges.filter((e) => pageNodeIds.has(e.from) && pageNodeIds.has(e.to));

  return {
    nodes: pageNodes,
    edges: pageEdges,
    totalNodes: allNodes.length,
    totalEdges: fullGraph.edges.length,
    offset,
    limit,
    hasMore: offset + limit < allNodes.length,
  };
}

export function exportGraphCompact(store: VisualizeStoreBindings): Buffer | null {
  try {
    const buf = store.graph.exportGraphCompact({
      maxNodes: 1000000,
      includeTags: true,
      includeCompanies: true,
      includeNodeDegree: true,
      includeEdgeMeta: false,
    });
    if (buf && buf.length > 16) {
      return buf;
    }
  } catch {
    // noop
  }
  return null;
}

export function getEntityGroupSummary(store: VisualizeStoreBindings): EntityGroupAggregation | null {
  try {
    const result = store.graph.getEntityGroupSummary();
    if (result && typeof result === 'object') {
      const groupEntries = Object.entries(result.groups || {});
      return {
        groups: groupEntries.map(([entityType, summary]: [string, any]) => ({
          entityType,
          count: summary.count ?? 0,
          sampleIds: summary.sampleIds ?? [],
        })),
        totalEntities: result.totalEntities ?? 0,
        totalRelations: result.totalRelations ?? 0,
      };
    }
  } catch {
    // noop
  }
  return null;
}
