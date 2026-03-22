import type { Entity } from 'aifastdb';
import type {
  Memory,
  MemoryCandidate,
  MemoryGenerateResult,
  MemoryInput,
  MemoryRecallProfile,
  MemoryType,
  PromptInput,
} from './types';
import {
  ANCHOR_TYPES,
  CHANGE_TYPES,
  ET,
  RT,
} from './dev-plan-graph-store.shared';

export type MemoryWriteStoreBindings = {
  projectName: string;
  graph: any;
  synapse?: { embed(query: string): number[] } | null;
  semanticSearchReady: boolean;
  nativeApplyMutationsReady: boolean;
  nativeAnchorExtractReady: boolean;
  ensureSynapseReady(): boolean;
  getProjectId(): string;
  entityToMemory(entity: Entity): Memory;
  listMemories(filter?: any): Memory[];
  listMainTasks(filter?: any): any[];
  listSubTasks(taskId: string): any[];
  listModules(): any[];
  listSections(): any[];
  findEntityByProp(entityType: string, propName: string, propValue: string): Entity | null;
  findEntitiesByType(entityType: string): Entity[];
  decomposeAndStoreMemoryTree(
    memoryEntityId: string,
    content: string,
    mode: 'rule' | 'llm',
    context?: string,
    llmDecompositionJson?: string,
  ): Memory['decomposition'] | undefined;
  detectMemoryConflicts(newEntity: Entity, embedding: number[]): Memory['conflicts'] | undefined;
  integrateAnchorFlowStructure(input: MemoryInput, memoryEntityId: string): {
    anchorInfo?: Memory['anchorInfo'];
    flowEntry?: Memory['flowEntry'];
    structureSnapshotId?: string;
  } | null;
};

export function saveMemory(store: MemoryWriteStoreBindings, input: MemoryInput): Memory {
  const now = Date.now();
  const resolvedRecallProfile = resolveMemoryRecallProfile(store, input);

  const searchableContent = input.contentL2 || input.content;
  const entityName = `Memory: ${input.memoryType} — ${input.content.slice(0, 40)}`;
  const sourceRef = input.sourceRef || undefined;
  const sourceRefKey = sourceRef
    ? (sourceRef.variant ? `${sourceRef.sourceId}#${sourceRef.variant}` : sourceRef.sourceId)
    : undefined;

  let entity: Entity;
  let isUpdate = false;

  if (sourceRefKey) {
    entity = store.graph.upsertEntityByProp(
      ET.MEMORY,
      'sourceRefKey',
      sourceRefKey,
      entityName,
      {
        projectName: store.projectName,
        memoryType: input.memoryType,
        content: searchableContent,
        contentL3: input.contentL3 || null,
        tags: input.tags || [],
        relatedTaskId: input.relatedTaskId || null,
        recallProfile: resolvedRecallProfile,
        sourceRef: sourceRef || null,
        sourceRefKey,
        provenance: input.provenance || null,
        importance: input.importance ?? 0.5,
        hitCount: 0,
        lastAccessedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    );
    const ep = entity.properties as any;
    if (ep.createdAt && ep.createdAt < now - 1000) {
      isUpdate = true;
      store.graph.updateEntity(entity.id, {
        properties: {
          ...ep,
          content: searchableContent,
          contentL3: input.contentL3 || ep.contentL3 || null,
          memoryType: input.memoryType,
          tags: input.tags || ep.tags || [],
          recallProfile: input.recallProfile || ep.recallProfile || resolvedRecallProfile,
          sourceRef: sourceRef || ep.sourceRef || null,
          sourceRefKey,
          provenance: input.provenance || ep.provenance || null,
          importance: input.importance ?? ep.importance ?? 0.5,
          updatedAt: now,
        },
      });
    }
  } else {
    const existingDup = findDuplicateMemory(store, input);
    if (existingDup) {
      isUpdate = true;
      entity = existingDup;
      const oldProps = existingDup.properties as any;
      store.graph.updateEntity(existingDup.id, {
        properties: {
          ...oldProps,
          content: searchableContent,
          contentL3: input.contentL3 || oldProps.contentL3 || null,
          memoryType: input.memoryType,
          tags: input.tags || oldProps.tags || [],
          recallProfile: input.recallProfile || oldProps.recallProfile || resolvedRecallProfile,
          importance: input.importance ?? oldProps.importance ?? 0.5,
          sourceRef: sourceRef || oldProps.sourceRef || null,
          sourceRefKey: sourceRefKey || oldProps.sourceRefKey || null,
          provenance: input.provenance || oldProps.provenance || null,
          updatedAt: now,
        },
      });
    } else {
      entity = store.graph.addEntity(entityName, ET.MEMORY, {
        projectName: store.projectName,
        memoryType: input.memoryType,
        content: searchableContent,
        contentL3: input.contentL3 || null,
        tags: input.tags || [],
        relatedTaskId: input.relatedTaskId || null,
        recallProfile: resolvedRecallProfile,
        sourceRef: sourceRef || null,
        sourceRefKey: sourceRefKey || null,
        provenance: input.provenance || null,
        importance: input.importance ?? 0.5,
        hitCount: 0,
        lastAccessedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  store.graph.putRelation(store.getProjectId(), entity.id, RT.HAS_MEMORY);

  if (input.relatedTaskId) {
    const taskEntity = store.findEntityByProp(ET.MAIN_TASK, 'taskId', input.relatedTaskId);
    if (taskEntity) {
      store.graph.putRelation(entity.id, taskEntity.id, RT.MEMORY_FROM_TASK);
    }
  }

  let embedding: number[] | null = null;
  if (store.ensureSynapseReady() && store.synapse) {
    try {
      if (isUpdate && typeof store.graph.removeEntityVector === 'function') {
        try { store.graph.removeEntityVector(entity.id); } catch {}
      }
      embedding = store.synapse.embed(input.content);
      store.graph.indexEntity(entity.id, embedding);
    } catch (e) {
      console.warn(
        `[DevPlan] Failed to index memory ${entity.id}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  if (embedding && store.semanticSearchReady) {
    autoLinkSimilarMemories(store, entity.id, embedding);
  }

  if (sourceRef?.sourceId) {
    autoLinkMemoryToDoc(store, entity.id, sourceRef.sourceId);
  }

  if (input.moduleId) {
    autoLinkMemoryToModule(store, entity.id, input.moduleId);
  }

  let decompositionSummary: Memory['decomposition'] | undefined;
  const decomposeMode: 'rule' | 'llm' | undefined =
    input.decompose === true || input.decompose === 'rule' ? 'rule'
      : input.decompose === 'llm' ? 'llm'
        : undefined;
  if (decomposeMode) {
    decompositionSummary = store.decomposeAndStoreMemoryTree(
      entity.id,
      input.content,
      decomposeMode,
      input.decomposeContext,
      input.llmDecompositionJson,
    );
  }

  let conflictsDetected: Memory['conflicts'] | undefined;
  if (embedding) {
    conflictsDetected = store.detectMemoryConflicts(entity, embedding);
  }

  let anchorResult: Memory['anchorInfo'] | undefined;
  let flowResult: Memory['flowEntry'] | undefined;
  let structureSnapshotId: string | undefined;
  try {
    const anchorData = store.integrateAnchorFlowStructure(input, entity.id);
    if (anchorData) {
      anchorResult = anchorData.anchorInfo;
      flowResult = anchorData.flowEntry;
      structureSnapshotId = anchorData.structureSnapshotId;
    }
  } catch (e) {
    console.warn(`[DevPlan] Anchor/Flow/Structure integration failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }

  store.graph.flush();
  const result = store.entityToMemory(entity);
  if (decompositionSummary) result.decomposition = decompositionSummary;
  if (conflictsDetected && conflictsDetected.length > 0) result.conflicts = conflictsDetected;
  if (anchorResult) result.anchorInfo = anchorResult;
  if (flowResult) result.flowEntry = flowResult;
  if (structureSnapshotId) result.structureSnapshotId = structureSnapshotId;
  return result;
}

export function autoLinkSimilarMemories(
  store: MemoryWriteStoreBindings,
  newMemoryId: string,
  embedding: number[],
  maxLinks: number = 3,
  minScore: number = 0.7,
): void {
  try {
    const hits = store.graph.searchEntitiesByVector(embedding, maxLinks + 5, ET.MEMORY);
    const relationsToCreate: Array<{ targetId: string; score: number }> = [];
    for (const hit of hits) {
      if (relationsToCreate.length >= maxLinks) break;
      if (hit.entityId === newMemoryId) continue;
      if (hit.score < minScore) continue;

      const target = store.graph.getEntity(hit.entityId);
      if (!target) continue;
      const p = target.properties as any;
      if (p.projectName !== store.projectName) continue;

      relationsToCreate.push({ targetId: hit.entityId, score: hit.score });
    }

    if (relationsToCreate.length === 0) return;

    if (store.nativeApplyMutationsReady) {
      const mutations: any[] = [];
      for (const { targetId, score } of relationsToCreate) {
        mutations.push({
          type: 'PutRelation',
          relation: {
            source_id: newMemoryId,
            target_id: targetId,
            relation_type: RT.MEMORY_RELATES,
            weight: score,
          },
        });
        mutations.push({
          type: 'PutRelation',
          relation: {
            source_id: targetId,
            target_id: newMemoryId,
            relation_type: RT.MEMORY_RELATES,
            weight: score,
          },
        });
      }
      store.graph.applyMutations(mutations).catch((e: any) => {
        console.warn(`[DevPlan] applyMutations for memory links failed: ${e}`);
      });
    } else {
      for (const { targetId, score } of relationsToCreate) {
        store.graph.putRelation(newMemoryId, targetId, RT.MEMORY_RELATES, score, false);
        store.graph.putRelation(targetId, newMemoryId, RT.MEMORY_RELATES, score, false);
      }
    }
  } catch (e) {
    console.warn(`[DevPlan] autoLinkSimilarMemories failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function autoLinkMemoryToDoc(store: MemoryWriteStoreBindings, memoryId: string, sourceKey: string): void {
  try {
    if (sourceKey.startsWith('phase-') || sourceKey.startsWith('T')) return;

    const parts = sourceKey.split('|');
    const section = parts[0];
    const subSection = parts[1];
    const docs = store.findEntitiesByType(ET.DOC);
    const docEntity = docs.find((e) => {
      const p = e.properties as any;
      if (p.projectName !== store.projectName) return false;
      if (p.section !== section) return false;
      if (subSection && p.subSection !== subSection) return false;
      if (!subSection && p.subSection) return false;
      return true;
    });

    if (docEntity) {
      store.graph.putRelation(docEntity.id, memoryId, RT.MEMORY_FROM_DOC);
    }
  } catch (e) {
    console.warn(`[DevPlan] autoLinkMemoryToDoc failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function autoLinkMemoryToModule(store: MemoryWriteStoreBindings, memoryId: string, moduleId: string): void {
  try {
    const modEntity = store.findEntityByProp(ET.MODULE, 'moduleId', moduleId);
    if (modEntity) {
      store.graph.putRelation(modEntity.id, memoryId, RT.MODULE_MEMORY);
    }
  } catch (e) {
    console.warn(`[DevPlan] autoLinkMemoryToModule failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function findDuplicateMemory(store: MemoryWriteStoreBindings, input: MemoryInput): Entity | null {
  const allMemories = store.findEntitiesByType(ET.MEMORY);
  const inputFingerprint = input.content.slice(0, 80).toLowerCase().trim();

  for (const e of allMemories) {
    const p = e.properties as any;
    if (p.projectName !== store.projectName) continue;

    const sourceRefMatch = input.sourceRef?.sourceId
      && p.sourceRef?.sourceId
      && p.sourceRef.sourceId === input.sourceRef.sourceId
      && (p.sourceRef.variant || null) === (input.sourceRef.variant || null);
    if (sourceRefMatch) return e;

    const existingFingerprint = String(p.content || '').slice(0, 80).toLowerCase().trim();
    if (existingFingerprint === inputFingerprint && p.memoryType === input.memoryType) {
      return e;
    }
  }

  return null;
}

export function resolveMemoryRecallProfile(store: MemoryWriteStoreBindings, input: MemoryInput): MemoryRecallProfile {
  void store;
  if (input.recallProfile === 'test_probe') return 'test_probe';
  if (input.recallProfile === 'default') return 'default';

  const raw = [
    input.content,
    input.contentL1,
    input.contentL2,
    input.anchorName,
    input.anchorOverview,
    input.relatedTaskId,
    input.sourceRef?.sourceId,
    input.sourceRef?.variant,
    (input.tags || []).join(' '),
  ].filter(Boolean).join('\n').toLowerCase();

  const testLikeMarkers = [
    'probe',
    'test',
    'fixture',
    'mock',
    'smoke',
    'validation',
    'sandbox',
    'experiment',
    'benchmark',
  ];
  return testLikeMarkers.some((marker) => raw.includes(marker)) ? 'test_probe' : 'default';
}

export function generateMemoryCandidates(
  store: MemoryWriteStoreBindings,
  options?: {
    source?: 'tasks' | 'docs' | 'modules' | 'both';
    taskId?: string;
    section?: string;
    subSection?: string;
    limit?: number;
  },
): MemoryGenerateResult {
  const source = options?.source || 'both';
  const limit = options?.limit || 50;

  const existingMemories = store.listMemories ? store.listMemories() : [];
  const memoryByTaskId = new Set<string>();
  const memoryBySourceId = new Set<string>();
  const memoryContentSet = new Set<string>();
  for (const m of existingMemories) {
    if (m.relatedTaskId) memoryByTaskId.add(m.relatedTaskId);
    if (m.sourceRef?.sourceId) memoryBySourceId.add(m.sourceRef.sourceId);
    memoryContentSet.add(m.content.slice(0, 50).toLowerCase());
  }

  const allEligible: MemoryCandidate[] = [];
  let totalCompletedPhases = 0;
  let totalDocuments = 0;
  let totalModules = 0;
  let phasesWithMemory = 0;
  let docsWithMemory = 0;
  let modulesWithMemory = 0;
  let skippedWithMemory = 0;

  const buildSkillInstructions = (
    sourceType: 'task' | 'document',
    sourceKey: string,
    sourceTitle: string,
    memoryType: MemoryType,
    section?: string,
  ) => {
    const subject = sourceType === 'task'
      ? `任务ID：${sourceKey}\n任务标题：${sourceTitle}`
      : `文档标题：${sourceTitle}\n文档类型：${section || 'custom'}`;
    const commonRule = `粒度规则：
- decision/bugfix：L2 必须保留"关键代码片段 + 文件路径 + 决策/根因与修复"（若原文存在）
- summary：2~3句概要，避免堆叠细节
- pattern/insight/preference：1~3句核心结论 + 一个最小示例
- 不要使用旧版 L1/L2/L3 定义，使用当前规则输出`;
    return {
      l1Prompt: `请生成 L1 触点摘要（15~30字，仅入口）。\n${commonRule}\n\n建议 memoryType：${memoryType}\n${subject}`,
      l2Prompt: `请生成 L2 详细记忆。\n${commonRule}\n\n建议 memoryType：${memoryType}\n${subject}`,
      l3Prompt: `请生成 L3 完整内容（可较长，保留结构与可追溯信息）。\n${commonRule}\n\n建议 memoryType：${memoryType}\n${subject}`,
    };
  };

  if (source === 'tasks' || source === 'both') {
    const allTasks = store.listMainTasks();
    const completedTasks = options?.taskId
      ? allTasks.filter((t) => t.taskId === options.taskId)
      : allTasks.filter((t) => t.status === 'completed');

    totalCompletedPhases = completedTasks.length;

    for (const task of completedTasks) {
      const hasMemory = memoryBySourceId.has(task.taskId) || memoryByTaskId.has(task.taskId);
      if (hasMemory) {
        phasesWithMemory++;
        skippedWithMemory++;
        continue;
      }

      const subTasks = store.listSubTasks(task.taskId);
      const subTaskLines = subTasks
        .map((st) => `  - [${st.status === 'completed' ? '✅' : '⬜'}] ${st.taskId}: ${st.title}`)
        .join('\n');
      const commitHints = subTasks
        .map((st) => st.completedAtCommit)
        .filter((v): v is string => typeof v === 'string' && v.length > 0);
      const uniqueCommitHints = Array.from(new Set(commitHints));
      const evidenceLines = [
        uniqueCommitHints.length > 0 ? `- commit: ${uniqueCommitHints.join(', ')}` : '',
        `- diff 命令: git show <commit> --stat --patch`,
        `- 日志命令: git log --oneline --decorate --graph -- ${task.taskId}`,
      ].filter(Boolean);

      const content = [
        `## ${task.title}`,
        `- 状态: ${task.status}`,
        `- 优先级: ${task.priority}`,
        task.description ? `- 描述: ${task.description}` : '',
        task.estimatedHours ? `- 预计工时: ${task.estimatedHours}h` : '',
        task.completedAt ? `- 完成时间: ${new Date(task.completedAt).toISOString().slice(0, 10)}` : '',
        `- 子任务 (${task.completedSubtasks}/${task.totalSubtasks}):`,
        subTaskLines,
        '',
        '### 原始材料入口',
        ...evidenceLines,
      ].filter(Boolean).join('\n');

      const importanceMap: Record<string, number> = { P0: 0.8, P1: 0.6, P2: 0.5 };
      allEligible.push({
        sourceType: 'task',
        sourceRef: { sourceId: task.taskId },
        sourceTitle: task.title,
        content,
        contentL3: content,
        suggestedMemoryType: 'summary',
        suggestedImportance: importanceMap[task.priority] || 0.6,
        suggestedTags: [task.taskId, task.priority],
        hasExistingMemory: false,
        skillInstructions: buildSkillInstructions('task', task.taskId, task.title, 'summary'),
        rawEvidence: {
          commitIds: uniqueCommitHints,
          commandHints: [
            'git show <commit> --stat --patch',
            `git log --oneline --decorate --graph -- ${task.taskId}`,
          ],
          notes: [
            '若需高保真 L3，请结合 commit diff 与执行日志，而非仅依赖任务摘要。',
          ],
        },
      });
    }
  }

  if (source === 'modules' || source === 'both') {
    const modules = store.listModules();
    totalModules = modules.length;

    for (const mod of modules) {
      const moduleKey = `module:${mod.moduleId}`;
      const hasMemory = memoryBySourceId.has(moduleKey) || memoryBySourceId.has(mod.moduleId);
      if (hasMemory) {
        modulesWithMemory++;
        skippedWithMemory++;
        continue;
      }

      const moduleTasks = store.listMainTasks({ moduleId: mod.moduleId });
      const moduleDocs = store.listSections().filter((d) => d.moduleId === mod.moduleId);
      const taskLines = moduleTasks.slice(0, 8).map((t) => `  - ${t.taskId}: ${t.title}`);
      const docLines = moduleDocs.slice(0, 8).map((d) => {
        const docKey = d.subSection ? `${d.section}|${d.subSection}` : d.section;
        return `  - ${docKey}: ${d.title}`;
      });

      const content = [
        `## 模块：${mod.name}`,
        `- 模块ID: ${mod.moduleId}`,
        `- 状态: ${mod.status}`,
        mod.description ? `- 描述: ${mod.description}` : '',
        `- 关联主任务: ${mod.mainTaskCount}`,
        `- 关联子任务: ${mod.completedSubTaskCount}/${mod.subTaskCount}`,
        `- 关联文档: ${mod.docCount}`,
        '',
        '### 任务概览',
        taskLines.length > 0 ? taskLines.join('\n') : '  - （无）',
        '',
        '### 文档概览',
        docLines.length > 0 ? docLines.join('\n') : '  - （无）',
      ].filter(Boolean).join('\n');

      allEligible.push({
        sourceType: 'module',
        sourceRef: { sourceId: moduleKey },
        sourceTitle: mod.name,
        content,
        contentL3: content,
        suggestedMemoryType: 'summary',
        suggestedImportance: mod.status === 'completed' ? 0.7 : 0.6,
        suggestedTags: ['module', mod.moduleId, mod.status],
        hasExistingMemory: false,
        skillInstructions: buildSkillInstructions('document', moduleKey, mod.name, 'summary', 'core_concepts'),
      });
    }
  }

  if (source === 'docs' || source === 'both') {
    let docs = store.listSections();
    if (options?.section) {
      docs = docs.filter((d) => d.section === options.section);
      if (options?.subSection) {
        docs = docs.filter((d) => d.subSection === options.subSection);
      }
    }

    totalDocuments = docs.length;

    const sectionToMemoryType: Record<string, MemoryType> = {
      overview: 'summary',
      core_concepts: 'pattern',
      api_design: 'pattern',
      file_structure: 'pattern',
      config: 'preference',
      examples: 'pattern',
      technical_notes: 'insight',
      api_endpoints: 'pattern',
      milestones: 'summary',
      changelog: 'summary',
      custom: 'insight',
    };
    const sectionToImportance: Record<string, number> = {
      overview: 0.7,
      core_concepts: 0.8,
      api_design: 0.7,
      file_structure: 0.5,
      config: 0.5,
      examples: 0.4,
      technical_notes: 0.7,
      api_endpoints: 0.5,
      milestones: 0.6,
      changelog: 0.4,
      custom: 0.5,
    };

    for (const doc of docs) {
      const docKey = doc.subSection ? `${doc.section}|${doc.subSection}` : doc.section;
      const hasMemoryBySourceId = memoryBySourceId.has(docKey);
      const contentFingerprint = doc.content.slice(0, 50).toLowerCase();
      const hasMemoryByFingerprint = memoryContentSet.has(contentFingerprint);
      const hasMemory = hasMemoryBySourceId || hasMemoryByFingerprint;
      if (hasMemory) {
        docsWithMemory++;
        skippedWithMemory++;
        continue;
      }

      let contentPreview = doc.content;
      if (contentPreview.length > 800) {
        contentPreview = contentPreview.slice(0, 800);
        const lastNewline = contentPreview.lastIndexOf('\n');
        if (lastNewline > 400) contentPreview = contentPreview.slice(0, lastNewline);
        contentPreview += '\n... (内容截断，完整文档可通过 devplan_get_section 获取)';
      }

      const content = [
        `## ${doc.title}`,
        `- 文档类型: ${doc.section}${doc.subSection ? ' → ' + doc.subSection : ''}`,
        `- 版本: ${doc.version}`,
        doc.relatedTaskIds?.length ? `- 关联任务: ${doc.relatedTaskIds.join(', ')}` : '',
        `\n### 内容摘要\n`,
        contentPreview,
      ].filter(Boolean).join('\n');

      const suggestedType = sectionToMemoryType[doc.section] || 'insight';
      const suggestedImportance = sectionToImportance[doc.section] || 0.5;
      const titleLower = doc.title.toLowerCase();
      let refinedType = suggestedType;
      if (titleLower.includes('决策') || titleLower.includes('decision') || titleLower.includes('选择')) refinedType = 'decision';
      else if (titleLower.includes('修复') || titleLower.includes('fix') || titleLower.includes('bug')) refinedType = 'bugfix';
      else if (titleLower.includes('优化') || titleLower.includes('性能') || titleLower.includes('performance')) refinedType = 'insight';

      const tags: string[] = [doc.section];
      if (doc.subSection) tags.push(doc.subSection);
      if (doc.relatedTaskIds) tags.push(...doc.relatedTaskIds);

      allEligible.push({
        sourceType: 'document',
        sourceRef: { sourceId: docKey },
        sourceTitle: doc.title,
        content,
        contentL3: doc.content,
        suggestedMemoryType: refinedType,
        suggestedImportance,
        suggestedTags: tags,
        hasExistingMemory: false,
        skillInstructions: buildSkillInstructions('document', docKey, doc.title, refinedType, doc.section),
      });
    }
  }

  const candidateIdSet = new Set(allEligible.map((c) => c.sourceRef.sourceId));
  for (const candidate of allEligible) {
    const relations: Array<{ relationType: string; targetSourceRef: string; weight?: number; reason?: string }> = [];
    const candidateSourceId = candidate.sourceRef.sourceId;

    if (candidate.sourceType === 'task') {
      const taskEntity = store.listMainTasks().find((t) => t.taskId === candidateSourceId);
      if (taskEntity?.relatedSections) {
        for (const docRef of taskEntity.relatedSections) {
          if (candidateIdSet.has(docRef)) {
            relations.push({ targetSourceRef: docRef, relationType: 'mem:DERIVED_FROM', weight: 0.7, reason: 'task references this document' });
          }
        }
      }
      if (taskEntity?.moduleId) {
        for (const other of allEligible) {
          if (other.sourceRef.sourceId !== candidateSourceId && other.sourceType === 'task') {
            const otherTask = store.listMainTasks().find((t) => t.taskId === other.sourceRef.sourceId);
            if (otherTask?.moduleId === taskEntity.moduleId) {
              relations.push({ targetSourceRef: other.sourceRef.sourceId, relationType: 'mem:RELATES', weight: 0.5, reason: `same module: ${taskEntity.moduleId}` });
            }
          }
        }
      }
      const phaseMatch = candidateSourceId.match(/^phase-(\d+)/);
      if (phaseMatch) {
        const nextPhaseId = `phase-${parseInt(phaseMatch[1], 10) + 1}`;
        if (candidateIdSet.has(nextPhaseId)) {
          relations.push({ targetSourceRef: nextPhaseId, relationType: 'mem:TEMPORAL_NEXT', weight: 0.6, reason: 'consecutive phases' });
        }
      }
    } else if (candidate.sourceType === 'document') {
      const docEntity = store.listSections().find((d) => {
        const key = d.subSection ? `${d.section}|${d.subSection}` : d.section;
        return key === candidateSourceId;
      });
      if (docEntity?.relatedTaskIds) {
        for (const taskId of docEntity.relatedTaskIds) {
          if (candidateIdSet.has(taskId)) {
            relations.push({ targetSourceRef: taskId, relationType: 'mem:DERIVED_FROM', weight: 0.7, reason: 'document references this task' });
          }
        }
      }
      if (docEntity?.parentDoc && candidateIdSet.has(docEntity.parentDoc)) {
        relations.push({ targetSourceRef: docEntity.parentDoc, relationType: 'mem:CONTAINS', weight: 0.8, reason: 'child document of parent' });
      }
      if (docEntity) {
        for (const other of allEligible) {
          if (other.sourceRef.sourceId !== candidateSourceId && other.sourceType === 'document') {
            const otherDoc = store.listSections().find((d) => {
              const key = d.subSection ? `${d.section}|${d.subSection}` : d.section;
              return key === other.sourceRef.sourceId;
            });
            if (otherDoc && otherDoc.section === docEntity.section && otherDoc.subSection !== docEntity.subSection) {
              relations.push({ targetSourceRef: other.sourceRef.sourceId, relationType: 'mem:RELATES', weight: 0.4, reason: `same section: ${docEntity.section}` });
            }
          }
        }
      }
    }

    if (relations.length > 0) candidate.suggestedRelations = relations;
  }

  const g57 = store.graph as any;
  const hasAnchorApi = store.nativeAnchorExtractReady && typeof g57.anchorFindByName === 'function';
  if (hasAnchorApi) {
    for (const candidate of allEligible) {
      try {
        const extracted = g57.anchorExtractFromText(candidate.content);
        if (!extracted || extracted.length === 0) continue;
        const best = extracted.reduce((a: any, b: any) => a.confidence > b.confidence ? a : b);
        let existingAnchor: any | null = null;
        try {
          existingAnchor = g57.anchorFindByName(best.name);
        } catch {}

        candidate.suggestedAnchor = best.name;
        candidate.suggestedAnchorType = best.suggested_type || ANCHOR_TYPES.CONCEPT;
        candidate.hasExistingAnchor = !!existingAnchor;
        if (!existingAnchor) {
          candidate.suggestedChangeType = CHANGE_TYPES.CREATED;
        } else {
          const contentLower = candidate.content.toLowerCase();
          const upgradeKeywords = ['升级', 'upgrade', '增强', 'enhance', '重构', 'refactor', '新增', '扩展', 'extend', 'v2', 'v3'];
          const isUpgrade = upgradeKeywords.some((kw) => contentLower.includes(kw));
          candidate.suggestedChangeType = isUpgrade ? CHANGE_TYPES.UPGRADED : CHANGE_TYPES.MODIFIED;
        }
      } catch (e) {
        console.warn(`[DevPlan] anchor extraction failed for candidate ${candidate.sourceRef.sourceId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    for (const candidate of allEligible) {
      try {
        const title = candidate.sourceTitle;
        const phaseMatch = title.match(/^Phase\s*[-:]?\s*\d+[A-Za-z]?\s*[:：]\s*(.+)/i);
        const sectionMatch = title.match(/^(.+?)(?:\s*[-—]\s*.+)?$/);
        let anchorName: string | undefined;
        if (candidate.sourceType === 'task' && phaseMatch) anchorName = phaseMatch[1].trim();
        else if (candidate.sourceType === 'document' && sectionMatch) anchorName = sectionMatch[1].trim();

        if (anchorName && anchorName.length >= 2 && anchorName.length <= 50) {
          candidate.suggestedAnchor = anchorName;
          if (candidate.sourceType === 'task') {
            candidate.suggestedAnchorType = ANCHOR_TYPES.FEATURE;
            candidate.suggestedChangeType = CHANGE_TYPES.CREATED;
          } else {
            candidate.suggestedAnchorType = ANCHOR_TYPES.CONCEPT;
            candidate.suggestedChangeType = CHANGE_TYPES.CREATED;
          }
          candidate.hasExistingAnchor = false;
        }
      } catch {}
    }
  }

  const candidates = allEligible.slice(0, limit);
  const remaining = Math.max(0, allEligible.length - limit);
  return {
    candidates,
    stats: {
      totalCompletedPhases,
      totalDocuments,
      totalModules,
      phasesWithMemory,
      docsWithMemory,
      modulesWithMemory,
      skippedWithMemory,
      candidatesReturned: candidates.length,
      remaining,
    },
  };
}
