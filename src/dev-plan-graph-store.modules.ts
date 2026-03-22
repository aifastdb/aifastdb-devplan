import type { Entity } from 'aifastdb';
import type {
  DevPlanDoc,
  MainTask,
  Module,
  ModuleDetail,
  ModuleInput,
  ModuleStatus,
  SubTask,
} from './types';
import { ET, RT } from './dev-plan-graph-store.shared';

export type ModuleStoreBindings = {
  graph: any;
  projectName: string;
  findEntityByProp(entityType: string, propKey: string, value: string): Entity | null;
  findEntitiesByType(entityType: string): Entity[];
  entityToDevPlanDoc(entity: Entity): DevPlanDoc;
  listMainTasks(filter?: { status?: string; priority?: string; moduleId?: string }): MainTask[];
  listSubTasks(parentTaskId: string, filter?: { status?: string }): SubTask[];
  listSections(): DevPlanDoc[];
  getOutRelations(entityId: string, relationType?: string): any[];
};

export function entityToModule(store: ModuleStoreBindings, entity: Entity): Module {
  const p = entity.properties as any;
  const moduleId = p.moduleId || '';

  const mainTasks = store.listMainTasks({ moduleId });
  let subTaskCount = 0;
  let completedSubTaskCount = 0;
  for (const mt of mainTasks) {
    const subs = store.listSubTasks(mt.taskId);
    subTaskCount += subs.length;
    completedSubTaskCount += subs.filter((s) => s.status === 'completed').length;
  }

  const docRelations = store.getOutRelations(entity.id, RT.MODULE_HAS_DOC);
  const docCount = docRelations.length;

  return {
    id: entity.id,
    projectName: store.projectName,
    moduleId,
    name: p.name || entity.name,
    description: p.description || undefined,
    status: p.status || 'active',
    mainTaskCount: mainTasks.length,
    subTaskCount,
    completedSubTaskCount,
    docCount,
    createdAt: p.createdAt || entity.created_at,
    updatedAt: p.updatedAt || entity.updated_at,
  };
}

export function getModule(store: ModuleStoreBindings, moduleId: string): Module | null {
  const entity = store.findEntityByProp(ET.MODULE, 'moduleId', moduleId);
  return entity ? entityToModule(store, entity) : null;
}

export function listModules(store: ModuleStoreBindings, filter?: { status?: ModuleStatus }): Module[] {
  let entities = store.findEntitiesByType(ET.MODULE);
  if (filter?.status) {
    entities = entities.filter((e) => (e.properties as any).status === filter.status);
  }
  return entities.map((e) => entityToModule(store, e));
}

export function createModule(store: ModuleStoreBindings, input: ModuleInput): Module {
  const existing = getModule(store, input.moduleId);
  if (existing) return existing;

  const now = Date.now();
  const status = input.status || 'active';

  const entity = store.graph.upsertEntityByProp(
    ET.MODULE,
    'moduleId',
    input.moduleId,
    input.name,
    {
      projectName: store.projectName,
      moduleId: input.moduleId,
      name: input.name,
      description: input.description || '',
      status,
      createdAt: now,
      updatedAt: now,
    },
  );

  store.graph.flush();

  return {
    id: entity.id,
    projectName: store.projectName,
    moduleId: input.moduleId,
    name: input.name,
    description: input.description,
    status,
    mainTaskCount: 0,
    subTaskCount: 0,
    completedSubTaskCount: 0,
    docCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateModule(
  store: ModuleStoreBindings,
  moduleId: string,
  updates: {
    name?: string;
    description?: string;
    status?: ModuleStatus;
  },
): Module | null {
  const existing = getModule(store, moduleId);
  if (!existing) return null;

  const now = Date.now();
  store.graph.updateEntity(existing.id, {
    name: updates.name || existing.name,
    properties: {
      name: updates.name || existing.name,
      description: updates.description !== undefined ? updates.description : existing.description,
      status: updates.status || existing.status,
      updatedAt: now,
    },
  });

  store.graph.flush();
  return getModule(store, moduleId);
}

export function deleteModule(store: ModuleStoreBindings, moduleId: string): boolean {
  const existing = getModule(store, moduleId);
  if (!existing) return false;
  store.graph.deleteEntity(existing.id);
  store.graph.flush();
  return true;
}

export function getModuleDetail(store: ModuleStoreBindings, moduleId: string): ModuleDetail | null {
  const mod = getModule(store, moduleId);
  if (!mod) return null;

  const mainTasks = store.listMainTasks({ moduleId });
  const subTasks: SubTask[] = [];
  for (const mt of mainTasks) {
    subTasks.push(...store.listSubTasks(mt.taskId));
  }

  const modEntity = store.findEntityByProp(ET.MODULE, 'moduleId', moduleId);
  let documents: DevPlanDoc[] = [];
  if (modEntity) {
    const docRelations = store.getOutRelations(modEntity.id, RT.MODULE_HAS_DOC);
    for (const rel of docRelations) {
      const docEntity = store.graph.getEntity(rel.target);
      if (docEntity) {
        documents.push(store.entityToDevPlanDoc(docEntity));
      }
    }
  }

  const allDocs = store.listSections().filter((d) => d.moduleId === moduleId);
  const docIds = new Set(documents.map((d) => d.id));
  for (const doc of allDocs) {
    if (!docIds.has(doc.id)) {
      documents.push(doc);
    }
  }

  return { module: mod, mainTasks, subTasks, documents };
}
