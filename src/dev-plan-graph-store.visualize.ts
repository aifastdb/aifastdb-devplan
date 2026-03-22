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
      : taskProg.status === 'cancelled' ? '❌' : '⬜';
    md += `### ${statusIcon} ${taskProg.title} (${taskProg.completed}/${taskProg.total})\n\n`;

    const subs = store.listSubTasks(taskProg.taskId);
    if (subs.length > 0) {
      md += '| 任务 | 描述 | 状态 | 完成日期 |\n';
      md += '|-----|------|------|--------|\n';
      for (const sub of subs) {
        const subIcon = sub.status === 'completed' ? '✅ 已完成'
          : sub.status === 'in_progress' ? '🔄 进行中'
          : sub.status === 'cancelled' ? '❌ 已取消' : '⬜ 待开始';
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

  nodes.push({
    id: projectId,
    label: store.projectName,
    type: 'project',
    properties: { entityType: ET.PROJECT },
  });

  const mainTasks = store.listMainTasks();
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
    edges.push({
      from: projectId,
      to: mt.id,
      label: RT.HAS_MAIN_TASK,
    });

    const subTasks = store.listSubTasks(mt.taskId);
    for (const st of subTasks) {
      nodes.push({
        id: st.id,
        label: st.title,
        type: 'sub-task',
        properties: {
          taskId: st.taskId,
          parentTaskId: st.parentTaskId,
          status: st.status,
          completedAt: st.completedAt || null,
        },
      });
      edges.push({
        from: mt.id,
        to: st.id,
        label: RT.HAS_SUB_TASK,
      });
    }

    const taskDocRels = store.getOutRelations(mt.id, RT.TASK_HAS_DOC);
    for (const rel of taskDocRels) {
      edges.push({
        from: mt.id,
        to: rel.target,
        label: RT.TASK_HAS_DOC,
      });
    }

    if (includePrompts) {
      const taskPromptRels = store.getOutRelations(mt.id, RT.TASK_HAS_PROMPT);
      for (const rel of taskPromptRels) {
        edges.push({
          from: mt.id,
          to: rel.target,
          label: RT.TASK_HAS_PROMPT,
        });
      }
    }
  }

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
      edges.push({
        from: projectId,
        to: prompt.id,
        label: RT.HAS_PROMPT,
      });
    }
  }

  if (includeMemories) {
    const memories = store.listMemories ? store.listMemories() : [];
    const memoryIdSet = new Set<string>();
    for (const mem of memories) {
      memoryIdSet.add(mem.id);
      const label = `${mem.memoryType}: ${mem.content.slice(0, 30)}...`;
      nodes.push({
        id: mem.id,
        label,
        type: 'memory',
        properties: {
          memoryType: mem.memoryType,
          importance: mem.importance,
          hitCount: mem.hitCount,
          tags: mem.tags || [],
          createdAt: mem.createdAt,
        },
      });
      edges.push({
        from: projectId,
        to: mem.id,
        label: RT.HAS_MEMORY,
      });
      if (mem.relatedTaskId) {
        const taskEntity = store.findEntityByProp(ET.MAIN_TASK, 'taskId', mem.relatedTaskId);
        if (taskEntity) {
          edges.push({
            from: mem.id,
            to: taskEntity.id,
            label: RT.MEMORY_FROM_TASK,
          });
        }
      }
    }

    const memoryRelTypes = [RT.MEMORY_RELATES, RT.MEMORY_FROM_DOC, RT.MODULE_MEMORY, RT.MEMORY_SUPERSEDES, RT.MEMORY_CONFLICTS];
    const edgeDedup = new Set<string>();
    for (const memId of memoryIdSet) {
      for (const relType of memoryRelTypes) {
        const rels = store.getOutRelations(memId, relType);
        for (const rel of rels) {
          const key = `${rel.source}-${rel.target}-${relType}`;
          if (edgeDedup.has(key)) continue;
          edgeDedup.add(key);
          edges.push({
            from: rel.source,
            to: rel.target,
            label: relType,
            properties: rel.weight != null ? { weight: rel.weight } : undefined,
          });
        }
        const inRels = store.getInRelations(memId, relType);
        for (const rel of inRels) {
          const key = `${rel.source}-${rel.target}-${relType}`;
          if (edgeDedup.has(key)) continue;
          edgeDedup.add(key);
          edges.push({
            from: rel.source,
            to: rel.target,
            label: relType,
            properties: rel.weight != null ? { weight: rel.weight } : undefined,
          });
        }
      }
    }
  }

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
        edges.push({
          from: projectId,
          to: doc.id,
          label: RT.HAS_DOCUMENT,
        });
      }

      if (doc.childDocs?.length) {
        const docEntity = store.findDocEntityBySection(doc.section, doc.subSection);
        if (docEntity) {
          const childRels = store.getOutRelations(docEntity.id, RT.DOC_HAS_CHILD);
          for (const rel of childRels) {
            edges.push({
              from: doc.id,
              to: rel.target,
              label: RT.DOC_HAS_CHILD,
            });
          }
        }
      }
    }
  }

  if (includeModules) {
    const modules = store.listModules();
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

      edges.push({
        from: projectId,
        to: mod.id,
        label: RT.HAS_MODULE,
      });

      const moduleTasks = store.listMainTasks({ moduleId: mod.moduleId });
      for (const mt of moduleTasks) {
        edges.push({
          from: mod.id,
          to: mt.id,
          label: RT.MODULE_HAS_TASK,
        });
      }
    }
  }

  const allMemoryEntities = store.findEntitiesByType(ET.MEMORY)
    .filter((e) => (e.properties as any).projectName === store.projectName);

  for (const memEntity of allMemoryEntities) {
    const mem = store.entityToMemory(memEntity);
    nodes.push({
      id: mem.id,
      label: `${mem.memoryType}: ${mem.content.slice(0, 30)}...`,
      type: 'memory',
      properties: {
        memoryType: mem.memoryType,
        content: mem.content.length > 120 ? mem.content.slice(0, 120) + '...' : mem.content,
        importance: mem.importance,
        hitCount: mem.hitCount,
        tags: mem.tags,
        relatedTaskId: mem.relatedTaskId || null,
        sourceRef: mem.sourceRef || null,
        provenance: mem.provenance || null,
      },
    });

    edges.push({
      from: projectId,
      to: mem.id,
      label: RT.HAS_MEMORY,
    });

    if (mem.relatedTaskId) {
      const taskEntity = store.findEntityByProp(ET.MAIN_TASK, 'taskId', mem.relatedTaskId);
      if (taskEntity) {
        edges.push({
          from: mem.id,
          to: taskEntity.id,
          label: RT.MEMORY_FROM_TASK,
        });
      }
    }

    const memRelates = store.getOutRelations(mem.id, RT.MEMORY_RELATES);
    for (const rel of memRelates) {
      if (mem.id < rel.target) {
        edges.push({
          from: mem.id,
          to: rel.target,
          label: RT.MEMORY_RELATES,
          properties: rel.weight != null ? { weight: rel.weight } : undefined,
        });
      }
    }

    const fromDocRels = store.getInRelations(mem.id, RT.MEMORY_FROM_DOC);
    for (const rel of fromDocRels) {
      edges.push({
        from: rel.source,
        to: mem.id,
        label: RT.MEMORY_FROM_DOC,
      });
    }

    const moduleMemRels = store.getInRelations(mem.id, RT.MODULE_MEMORY);
    for (const rel of moduleMemRels) {
      edges.push({
        from: rel.source,
        to: mem.id,
        label: RT.MODULE_MEMORY,
      });
    }

    const supersedesRels = store.getOutRelations(mem.id, RT.MEMORY_SUPERSEDES);
    for (const rel of supersedesRels) {
      edges.push({
        from: mem.id,
        to: rel.target,
        label: RT.MEMORY_SUPERSEDES,
      });
    }

    const conflictsRels = store.getOutRelations(mem.id, RT.MEMORY_CONFLICTS);
    for (const rel of conflictsRels) {
      edges.push({
        from: mem.id,
        to: rel.target,
        label: RT.MEMORY_CONFLICTS,
      });
    }
  }

  if (includeNodeDegree) {
    const nativeDegreeMap: Record<string, number> = {};
    try {
      const nativeGraph = store.graph.exportGraph({
        includeNodeDegree: true,
        includeEdgeMeta: false,
        maxNodes: Math.max(nodes.length * 2, 2000),
        maxEdges: Math.max(edges.length * 2, 4000),
      } as any) as any;

      const nativeNodes = Array.isArray(nativeGraph?.nodes) ? nativeGraph.nodes : [];
      for (const n of nativeNodes) {
        if (typeof n?.id !== 'string') continue;
        if (typeof n?.degree === 'number' && Number.isFinite(n.degree)) {
          nativeDegreeMap[n.id] = n.degree;
        }
      }
    } catch {
      // noop
    }

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
