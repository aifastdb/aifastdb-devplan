import type { Entity } from 'aifastdb';
import type { Prompt, PromptInput } from './types';
import { ET, RT } from './dev-plan-graph-store.shared';

export type PromptStoreBindings = {
  graph: any;
  projectName: string;
  getProjectId(): string;
  findEntitiesByType(entityType: string): Entity[];
  findEntityByProp(entityType: string, propKey: string, value: string): Entity | null;
  getOutRelations(entityId: string, relationType?: string): any[];
};

export function entityToPrompt(store: PromptStoreBindings, entity: Entity): Prompt {
  const p = entity.properties as any;
  return {
    id: entity.id,
    projectName: store.projectName,
    promptIndex: p.promptIndex || 0,
    content: p.content || '',
    aiInterpretation: p.aiInterpretation || undefined,
    summary: p.summary || undefined,
    relatedTaskId: p.relatedTaskId || undefined,
    tags: p.tags || [],
    createdAt: p.createdAt || entity.created_at,
  };
}

export function getTaskRelatedPrompts(store: PromptStoreBindings, taskId: string): Prompt[] {
  const taskEntity = store.findEntityByProp(ET.MAIN_TASK, 'taskId', taskId);
  if (!taskEntity) return [];

  const rels = store.getOutRelations(taskEntity.id, RT.TASK_HAS_PROMPT);
  const prompts: Prompt[] = [];
  for (const rel of rels) {
    const promptEntity = store.graph.getEntity(rel.target);
    if (promptEntity && promptEntity.entity_type === ET.PROMPT) {
      prompts.push(entityToPrompt(store, promptEntity));
    }
  }

  prompts.sort((a, b) => a.createdAt - b.createdAt);
  return prompts;
}

export function listPrompts(
  store: PromptStoreBindings,
  filter?: {
    date?: string;
    relatedTaskId?: string;
    limit?: number;
  },
): Prompt[] {
  if (filter?.relatedTaskId) {
    return getTaskRelatedPrompts(store, filter.relatedTaskId);
  }

  const entities = store.findEntitiesByType(ET.PROMPT);
  let prompts = entities
    .filter((e) => {
      const p = e.properties as any;
      if (p.projectName !== store.projectName) return false;
      if (filter?.date && p.date !== filter.date) return false;
      return true;
    })
    .map((e) => entityToPrompt(store, e));

  prompts.sort((a, b) => b.createdAt - a.createdAt);

  if (filter?.limit && filter.limit > 0) {
    prompts = prompts.slice(0, filter.limit);
  }

  return prompts;
}

export function savePrompt(store: PromptStoreBindings, input: PromptInput): Prompt {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  const existingToday = listPrompts(store, { date: today });
  const promptIndex = existingToday.length + 1;
  const entityName = `Prompt #${promptIndex} (${today})`;

  const entity = store.graph.addEntity(entityName, ET.PROMPT, {
    projectName: store.projectName,
    promptIndex,
    content: input.content,
    aiInterpretation: input.aiInterpretation || '',
    summary: input.summary || '',
    relatedTaskId: input.relatedTaskId || null,
    tags: input.tags || [],
    date: today,
    createdAt: now,
  });

  store.graph.putRelation(store.getProjectId(), entity.id, RT.HAS_PROMPT);

  if (input.relatedTaskId) {
    const taskEntity = store.findEntityByProp(ET.MAIN_TASK, 'taskId', input.relatedTaskId);
    if (taskEntity) {
      store.graph.putRelation(taskEntity.id, entity.id, RT.TASK_HAS_PROMPT);

      const taskProps = taskEntity.properties as any;
      const existingIds = taskProps.relatedPromptIds || [];
      if (!existingIds.includes(entity.id)) {
        store.graph.updateEntity(taskEntity.id, {
          properties: {
            ...taskProps,
            relatedPromptIds: [...existingIds, entity.id],
            updatedAt: now,
          },
        });
      }
    }
  }

  store.graph.flush();
  return entityToPrompt(store, entity);
}
