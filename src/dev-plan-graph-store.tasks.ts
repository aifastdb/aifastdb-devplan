import type { Entity } from 'aifastdb';
import {
  type CompleteSubTaskResult,
  type DeleteTaskResult,
  type DevPlanSection,
  type MainTask,
  type MainTaskInput,
  type MainTaskProgress,
  type ProjectProgress,
  type SubTask,
  type SubTaskInput,
  type TaskPriority,
  type TaskStatus,
  type UpdateTaskStatusResult,
} from './types';
import { ET, RT } from './dev-plan-graph-store.shared';
import { getCurrentGitCommit as getCurrentGitCommitUtil } from './dev-plan-graph-store.utils';
import { normalizeMainTaskTitle } from './task-title-utils';

export type TaskStoreBindings = {
  projectName: string;
  gitCwd?: string;
  graph: any;
  getProjectId(): string;
  findEntityByProp(entityType: string, propKey: string, value: string): Entity | null;
  findEntitiesByType(entityType: string): Entity[];
  entityToMainTask(entity: Entity): MainTask;
  entityToSubTask(entity: Entity): SubTask;
  sortByOrder<T extends { order?: number; createdAt: number }>(items: T[]): T[];
  getOutRelations(entityId: string, relationType?: string): any[];
  findDocEntityBySection(section: DevPlanSection, subSection?: string): Entity | null;
  updateModuleTaskRelation(taskEntityId: string, oldModuleId?: string | null, newModuleId?: string | null): void;
  autoUpdateMilestones(completedMainTask: MainTask): void;
  listSections(): any[];
  getSection(section: DevPlanSection, subSection?: string): any;
  saveSection(input: any): any;
};

export function createMainTask(store: TaskStoreBindings, input: MainTaskInput): MainTask {
  const existing = getMainTask(store, input.taskId);
  if (existing) return existing;

  const now = Date.now();
  const order = input.order != null ? input.order : getNextMainTaskOrder(store);
  const normalizedTitle = normalizeMainTaskTitle(input.taskId, input.title);
  const entity = store.graph.upsertEntityByProp(
    ET.MAIN_TASK, 'taskId', input.taskId, normalizedTitle, {
      projectName: store.projectName,
      taskId: input.taskId,
      title: normalizedTitle,
      priority: input.priority,
      description: input.description || '',
      estimatedHours: input.estimatedHours || 0,
      relatedSections: input.relatedSections || [],
      relatedPromptIds: input.relatedPromptIds || [],
      moduleId: input.moduleId || null,
      totalSubtasks: 0,
      completedSubtasks: 0,
      status: 'pending',
      order,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    },
  );

  store.graph.putRelation(store.getProjectId(), entity.id, RT.HAS_MAIN_TASK);

  if (input.moduleId) {
    const modEntity = store.findEntityByProp(ET.MODULE, 'moduleId', input.moduleId);
    if (modEntity) {
      store.graph.putRelation(modEntity.id, entity.id, RT.MODULE_HAS_TASK);
    }
  }

  if (input.relatedSections?.length) {
    for (const sk of input.relatedSections) {
      const [sec, sub] = sk.split('|');
      const docEntity = store.findDocEntityBySection(sec as DevPlanSection, sub);
      if (docEntity) {
        store.graph.putRelation(entity.id, docEntity.id, RT.TASK_HAS_DOC);
      }
    }
  }

  if (input.relatedPromptIds?.length) {
    for (const promptId of input.relatedPromptIds) {
      const promptEntity = store.graph.getEntity(promptId);
      if (promptEntity && promptEntity.entity_type === ET.PROMPT) {
        store.graph.putRelation(entity.id, promptEntity.id, RT.TASK_HAS_PROMPT);
      }
    }
  }

  store.graph.flush();
  return store.entityToMainTask(entity);
}

export function upsertMainTask(
  store: TaskStoreBindings,
  input: MainTaskInput,
  options?: { preserveStatus?: boolean; status?: TaskStatus },
): MainTask {
  const preserveStatus = options?.preserveStatus !== false;
  const targetStatus = options?.status || 'pending';
  const existing = getMainTask(store, input.taskId);

  if (!existing) {
    const task = createMainTask(store, input);
    if (targetStatus !== 'pending') {
      return updateMainTaskStatus(store, task.taskId, targetStatus) || task;
    }
    return task;
  }

  let finalStatus = targetStatus;
  if (preserveStatus) {
    const statusPriority: Record<TaskStatus, number> = {
      cancelled: 0, pending: 1, in_progress: 2, completed: 3,
    };
    if (statusPriority[existing.status] >= statusPriority[targetStatus]) {
      finalStatus = existing.status;
    }
  }

  const now = Date.now();
  const completedAt = finalStatus === 'completed' ? (existing.completedAt || now) : null;
  const finalModuleId = input.moduleId || existing.moduleId;
  const finalOrder = input.order != null ? input.order : existing.order;
  const normalizedTitle = normalizeMainTaskTitle(input.taskId, input.title);

  const upsertedEntity = store.graph.upsertEntityByProp(
    ET.MAIN_TASK, 'taskId', input.taskId, normalizedTitle, {
      projectName: store.projectName,
      taskId: input.taskId,
      title: normalizedTitle,
      priority: input.priority,
      description: input.description || existing.description || '',
      estimatedHours: input.estimatedHours || existing.estimatedHours || 0,
      relatedSections: input.relatedSections || existing.relatedSections || [],
      relatedPromptIds: input.relatedPromptIds || existing.relatedPromptIds || [],
      moduleId: finalModuleId || null,
      totalSubtasks: existing.totalSubtasks,
      completedSubtasks: existing.completedSubtasks,
      status: finalStatus,
      order: finalOrder,
      createdAt: existing.createdAt,
      updatedAt: now,
      completedAt,
    },
  );
  const upsertedId = upsertedEntity?.id || existing.id;

  if (finalModuleId && finalModuleId !== existing.moduleId) {
    store.updateModuleTaskRelation(upsertedId, existing.moduleId, finalModuleId);
  }

  const newRelatedSections = input.relatedSections || existing.relatedSections || [];
  if (newRelatedSections.length) {
    const oldDocRels = store.getOutRelations(upsertedId, RT.TASK_HAS_DOC);
    for (const rel of oldDocRels) {
      store.graph.deleteRelation(rel.id);
    }
    for (const sk of newRelatedSections) {
      const [sec, sub] = sk.split('|');
      const docEntity = store.findDocEntityBySection(sec as DevPlanSection, sub);
      if (docEntity) {
        store.graph.putRelation(upsertedId, docEntity.id, RT.TASK_HAS_DOC);
      }
    }
  }

  store.graph.flush();
  return getMainTask(store, input.taskId) || existing;
}

export function getMainTask(store: TaskStoreBindings, taskId: string): MainTask | null {
  const entity = store.findEntityByProp(ET.MAIN_TASK, 'taskId', taskId);
  return entity ? store.entityToMainTask(entity) : null;
}

export function listMainTasks(
  store: TaskStoreBindings,
  filter?: { status?: TaskStatus; priority?: TaskPriority; moduleId?: string },
): MainTask[] {
  let entities = store.findEntitiesByType(ET.MAIN_TASK);
  if (filter?.status) entities = entities.filter((e) => (e.properties as any).status === filter.status);
  if (filter?.priority) entities = entities.filter((e) => (e.properties as any).priority === filter.priority);
  if (filter?.moduleId) entities = entities.filter((e) => (e.properties as any).moduleId === filter.moduleId);
  const tasks = entities.map((e) => store.entityToMainTask(e));
  return store.sortByOrder(tasks);
}

export function updateMainTaskStatus(store: TaskStoreBindings, taskId: string, status: TaskStatus): MainTask | null {
  const mainTask = getMainTask(store, taskId);
  if (!mainTask) return null;

  const now = Date.now();
  const completedAt = status === 'completed' ? now : null;
  store.graph.upsertEntityByProp(
    ET.MAIN_TASK, 'taskId', taskId, mainTask.title, {
      projectName: store.projectName,
      taskId,
      title: mainTask.title,
      priority: mainTask.priority,
      description: mainTask.description || '',
      estimatedHours: mainTask.estimatedHours || 0,
      relatedSections: mainTask.relatedSections || [],
      relatedPromptIds: mainTask.relatedPromptIds || [],
      moduleId: mainTask.moduleId || null,
      totalSubtasks: mainTask.totalSubtasks,
      completedSubtasks: mainTask.completedSubtasks,
      status,
      order: mainTask.order,
      createdAt: mainTask.createdAt,
      updatedAt: now,
      completedAt,
    },
  );

  store.graph.flush();
  return getMainTask(store, taskId);
}

export function deleteTask(
  store: TaskStoreBindings,
  taskId: string,
  taskType?: 'main' | 'sub',
): DeleteTaskResult {
  const resolvedType = resolveTaskDeleteType(store, taskId, taskType);
  if (!resolvedType) {
    return { deleted: false, taskType: null, deletedSubTaskIds: [], deletedTaskIds: [], parentTaskId: null };
  }

  if (resolvedType === 'main') {
    const mainTask = getMainTask(store, taskId);
    if (!mainTask) {
      return { deleted: false, taskType: null, deletedSubTaskIds: [], deletedTaskIds: [], parentTaskId: null };
    }

    const subTasks = listSubTasks(store, taskId);
    for (const subTask of subTasks) {
      store.graph.deleteEntity(subTask.id);
    }
    store.graph.deleteEntity(mainTask.id);
    store.graph.flush();
    return {
      deleted: true,
      taskType: 'main',
      deletedMainTaskId: taskId,
      deletedSubTaskIds: subTasks.map((sub) => sub.taskId),
      deletedTaskIds: [taskId, ...subTasks.map((sub) => sub.taskId)],
      parentTaskId: null,
    };
  }

  const subTask = getSubTask(store, taskId);
  if (!subTask) {
    return { deleted: false, taskType: null, deletedSubTaskIds: [], deletedTaskIds: [], parentTaskId: null };
  }

  store.graph.deleteEntity(subTask.id);
  const reconciled = reconcileMainTaskAfterSubTaskDeletion(store, subTask.parentTaskId);
  store.graph.flush();
  return {
    deleted: true,
    taskType: 'sub',
    deletedSubTaskIds: [taskId],
    deletedTaskIds: [taskId],
    parentTaskId: reconciled?.taskId || subTask.parentTaskId,
  };
}

export function addSubTask(store: TaskStoreBindings, input: SubTaskInput): SubTask {
  const existing = getSubTask(store, input.taskId);
  if (existing) return existing;

  const mainTask = getMainTask(store, input.parentTaskId);
  if (!mainTask) {
    throw new Error(`Parent main task "${input.parentTaskId}" not found for project "${store.projectName}"`);
  }

  const now = Date.now();
  const order = input.order != null ? input.order : getNextSubTaskOrder(store, input.parentTaskId);
  const entity = store.graph.upsertEntityByProp(
    ET.SUB_TASK, 'taskId', input.taskId, input.title, {
      projectName: store.projectName,
      taskId: input.taskId,
      parentTaskId: input.parentTaskId,
      title: input.title,
      estimatedHours: input.estimatedHours || 0,
      relatedFiles: input.relatedFiles || [],
      description: input.description || '',
      status: 'pending',
      order,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    },
  );

  store.graph.putRelation(mainTask.id, entity.id, RT.HAS_SUB_TASK);
  refreshMainTaskCounts(store, input.parentTaskId);
  store.graph.flush();
  return store.entityToSubTask(entity);
}

export function upsertSubTask(
  store: TaskStoreBindings,
  input: SubTaskInput,
  options?: { preserveStatus?: boolean; status?: TaskStatus },
): SubTask {
  const preserveStatus = options?.preserveStatus !== false;
  const targetStatus = options?.status || 'pending';
  const existing = getSubTask(store, input.taskId);

  if (!existing) {
    const mainTask = getMainTask(store, input.parentTaskId);
    if (!mainTask) {
      throw new Error(`Parent main task "${input.parentTaskId}" not found for project "${store.projectName}"`);
    }
    const now = Date.now();
    const order = input.order != null ? input.order : getNextSubTaskOrder(store, input.parentTaskId);
    const entity = store.graph.upsertEntityByProp(
      ET.SUB_TASK, 'taskId', input.taskId, input.title, {
        projectName: store.projectName,
        taskId: input.taskId,
        parentTaskId: input.parentTaskId,
        title: input.title,
        estimatedHours: input.estimatedHours || 0,
        relatedFiles: input.relatedFiles || [],
        description: input.description || '',
        status: targetStatus,
        order,
        createdAt: now,
        updatedAt: now,
        completedAt: targetStatus === 'completed' ? now : null,
      },
    );

    store.graph.putRelation(mainTask.id, entity.id, RT.HAS_SUB_TASK);
    refreshMainTaskCounts(store, input.parentTaskId);
    store.graph.flush();
    return store.entityToSubTask(entity);
  }

  let finalStatus = targetStatus;
  if (preserveStatus) {
    const statusPriority: Record<TaskStatus, number> = {
      cancelled: 0, pending: 1, in_progress: 2, completed: 3,
    };
    if (statusPriority[existing.status] >= statusPriority[targetStatus]) {
      finalStatus = existing.status;
    }
  }

  const newOrder = input.order != null ? input.order : existing.order;
  if (
    existing.title === input.title &&
    existing.description === (input.description || '') &&
    existing.status === finalStatus &&
    existing.estimatedHours === (input.estimatedHours || 0) &&
    existing.order === newOrder
  ) {
    return existing;
  }

  const now = Date.now();
  const completedAt = finalStatus === 'completed' ? (existing.completedAt || now) : null;
  store.graph.updateEntity(existing.id, {
    name: input.title,
    properties: {
      title: input.title,
      estimatedHours: input.estimatedHours || existing.estimatedHours || 0,
      relatedFiles: input.relatedFiles || existing.relatedFiles || [],
      description: input.description || existing.description || '',
      status: finalStatus,
      order: newOrder,
      updatedAt: now,
      completedAt,
    },
  });

  refreshMainTaskCounts(store, input.parentTaskId);
  store.graph.flush();
  const updated = store.graph.getEntity(existing.id);
  return updated ? store.entityToSubTask(updated) : existing;
}

export function getSubTask(store: TaskStoreBindings, taskId: string): SubTask | null {
  const entity = store.findEntityByProp(ET.SUB_TASK, 'taskId', taskId);
  return entity ? store.entityToSubTask(entity) : null;
}

export function listSubTasks(
  store: TaskStoreBindings,
  parentTaskId: string,
  filter?: { status?: TaskStatus },
): SubTask[] {
  let entities = store.findEntitiesByType(ET.SUB_TASK).filter(
    (e) => (e.properties as any).parentTaskId === parentTaskId,
  );
  if (filter?.status) entities = entities.filter((e) => (e.properties as any).status === filter.status);
  const tasks = entities.map((e) => store.entityToSubTask(e));
  return store.sortByOrder(tasks);
}

export function updateSubTaskStatus(
  store: TaskStoreBindings,
  taskId: string,
  status: TaskStatus,
  options?: { completedAtCommit?: string; revertReason?: string },
): SubTask | null {
  const subTask = getSubTask(store, taskId);
  if (!subTask) return null;

  const now = Date.now();
  const completedAt = status === 'completed' ? now : null;
  const completedAtCommit = status === 'completed'
    ? (options?.completedAtCommit || subTask.completedAtCommit)
    : null;
  const revertReason = status === 'pending' ? (options?.revertReason || null) : null;

  store.graph.upsertEntityByProp(
    ET.SUB_TASK, 'taskId', taskId, subTask.title, {
      projectName: store.projectName,
      taskId,
      parentTaskId: subTask.parentTaskId,
      title: subTask.title,
      description: subTask.description || '',
      estimatedHours: subTask.estimatedHours || 0,
      relatedFiles: subTask.relatedFiles || [],
      status,
      order: subTask.order,
      createdAt: subTask.createdAt,
      updatedAt: now,
      completedAt,
      completedAtCommit: completedAtCommit || null,
      revertReason: revertReason || null,
    },
  );

  store.graph.flush();
  return getSubTask(store, taskId);
}

export function updateTaskStatus(
  store: TaskStoreBindings,
  taskId: string,
  taskType: 'main' | 'sub',
  status: TaskStatus,
): UpdateTaskStatusResult {
  if (status === 'completed') {
    throw new Error('Use completeSubTask/completeMainTask or devplan_complete_task for completed status');
  }

  if (taskType === 'main') {
    const mainTask = updateMainTaskStatus(store, taskId, status);
    return {
      updated: !!mainTask,
      taskType: mainTask ? 'main' : null,
      taskId,
      status: mainTask?.status,
      parentTaskId: null,
      mainTask: mainTask || undefined,
    };
  }

  const subTask = updateSubTaskStatus(store, taskId, status);
  if (!subTask) {
    return { updated: false, taskType: null, taskId, parentTaskId: null };
  }

  const parentMainTaskBefore = getMainTask(store, subTask.parentTaskId);
  let parentMainTask = refreshMainTaskCounts(store, subTask.parentTaskId);
  if (status === 'in_progress') {
    parentMainTask = updateMainTaskStatus(store, subTask.parentTaskId, 'in_progress') || parentMainTask;
  } else if (
    parentMainTaskBefore?.status === 'completed' &&
    parentMainTask &&
    parentMainTask.completedSubtasks < parentMainTask.totalSubtasks
  ) {
    parentMainTask = updateMainTaskStatus(store, subTask.parentTaskId, 'in_progress') || parentMainTask;
  }

  return {
    updated: true,
    taskType: 'sub',
    taskId,
    status: subTask.status,
    parentTaskId: subTask.parentTaskId,
    subTask,
    parentMainTask: parentMainTask || null,
  };
}

export function completeSubTask(store: TaskStoreBindings, taskId: string): CompleteSubTaskResult {
  const commitHash = getCurrentGitCommitUtil(store.gitCwd);
  const updatedSubTask = updateSubTaskStatus(store, taskId, 'completed', {
    completedAtCommit: commitHash,
  });
  if (!updatedSubTask) {
    throw new Error(`Sub task "${taskId}" not found for project "${store.projectName}"`);
  }

  const updatedMainTask = refreshMainTaskCounts(store, updatedSubTask.parentTaskId);
  if (!updatedMainTask) {
    throw new Error(`Parent main task "${updatedSubTask.parentTaskId}" not found`);
  }

  const mainTaskCompleted =
    updatedMainTask.totalSubtasks > 0 &&
    updatedMainTask.completedSubtasks >= updatedMainTask.totalSubtasks;

  if (mainTaskCompleted && updatedMainTask.status !== 'completed') {
    const completedMain = updateMainTaskStatus(store, updatedSubTask.parentTaskId, 'completed');
    if (completedMain) {
      store.autoUpdateMilestones(completedMain);
      return {
        subTask: updatedSubTask,
        mainTask: completedMain,
        mainTaskCompleted: true,
        completedAtCommit: commitHash,
      };
    }
  }

  return {
    subTask: updatedSubTask,
    mainTask: updatedMainTask,
    mainTaskCompleted,
    completedAtCommit: commitHash,
  };
}

export function completeMainTask(store: TaskStoreBindings, taskId: string): MainTask {
  const result = updateMainTaskStatus(store, taskId, 'completed');
  if (!result) {
    throw new Error(`Main task "${taskId}" not found for project "${store.projectName}"`);
  }
  store.autoUpdateMilestones(result);
  return result;
}

export function getProgress(store: TaskStoreBindings): ProjectProgress {
  const sections = store.listSections();
  const mainTasks = listMainTasks(store);

  let totalSub = 0;
  let completedSub = 0;
  const taskProgressList: MainTaskProgress[] = [];

  for (const mt of mainTasks) {
    let subTotal = mt.totalSubtasks;
    let subCompleted = mt.completedSubtasks;
    if (subTotal == null || subCompleted == null) {
      const subs = listSubTasks(store, mt.taskId);
      subTotal = subs.length;
      subCompleted = subs.filter((s) => s.status === 'completed').length;
    }

    totalSub += subTotal;
    completedSub += subCompleted;
    taskProgressList.push({
      taskId: mt.taskId,
      title: mt.title,
      priority: mt.priority,
      status: mt.status,
      order: mt.order,
      total: subTotal,
      completed: subCompleted,
      percent: subTotal > 0 ? Math.round((subCompleted / subTotal) * 100) : 0,
    });
  }

  return {
    projectName: store.projectName,
    sectionCount: sections.length,
    mainTaskCount: mainTasks.length,
    completedMainTasks: mainTasks.filter((mt) => mt.status === 'completed').length,
    subTaskCount: totalSub,
    completedSubTasks: completedSub,
    overallPercent: totalSub > 0 ? Math.round((completedSub / totalSub) * 100) : 0,
    tasks: taskProgressList,
  };
}

export function getNextMainTaskOrder(store: TaskStoreBindings): number {
  const entities = store.findEntitiesByType(ET.MAIN_TASK);
  let maxOrder = 0;
  for (const e of entities) {
    const o = (e.properties as any).order;
    if (typeof o === 'number' && o > maxOrder) maxOrder = o;
  }
  return maxOrder + 1;
}

export function getNextSubTaskOrder(store: TaskStoreBindings, parentTaskId: string): number {
  const entities = store.findEntitiesByType(ET.SUB_TASK).filter(
    (e) => (e.properties as any).parentTaskId === parentTaskId,
  );
  let maxOrder = 0;
  for (const e of entities) {
    const o = (e.properties as any).order;
    if (typeof o === 'number' && o > maxOrder) maxOrder = o;
  }
  return maxOrder + 1;
}

export function refreshMainTaskCounts(store: TaskStoreBindings, mainTaskId: string): MainTask | null {
  const mainTask = getMainTask(store, mainTaskId);
  if (!mainTask) return null;

  const subs = listSubTasks(store, mainTaskId);
  const completedCount = subs.filter((s) => s.status === 'completed').length;
  if (mainTask.totalSubtasks === subs.length && mainTask.completedSubtasks === completedCount) {
    return mainTask;
  }

  const now = Date.now();
  store.graph.upsertEntityByProp(
    ET.MAIN_TASK, 'taskId', mainTaskId, mainTask.title, {
      projectName: store.projectName,
      taskId: mainTaskId,
      title: mainTask.title,
      priority: mainTask.priority,
      description: mainTask.description || '',
      estimatedHours: mainTask.estimatedHours || 0,
      relatedSections: mainTask.relatedSections || [],
      relatedPromptIds: mainTask.relatedPromptIds || [],
      moduleId: mainTask.moduleId || null,
      totalSubtasks: subs.length,
      completedSubtasks: completedCount,
      status: mainTask.status,
      order: mainTask.order,
      createdAt: mainTask.createdAt,
      updatedAt: now,
      completedAt: mainTask.completedAt,
    },
  );

  store.graph.flush();
  return getMainTask(store, mainTaskId) || mainTask;
}

export function reconcileMainTaskAfterSubTaskDeletion(store: TaskStoreBindings, mainTaskId: string): MainTask | null {
  const refreshed = refreshMainTaskCounts(store, mainTaskId);
  if (!refreshed) return null;

  if (
    refreshed.status !== 'completed' &&
    refreshed.totalSubtasks > 0 &&
    refreshed.completedSubtasks >= refreshed.totalSubtasks
  ) {
    return updateMainTaskStatus(store, mainTaskId, 'completed');
  }

  return refreshed;
}

export function resolveTaskDeleteType(
  store: TaskStoreBindings,
  taskId: string,
  taskType?: 'main' | 'sub',
): 'main' | 'sub' | null {
  if (taskType === 'main') return getMainTask(store, taskId) ? 'main' : null;
  if (taskType === 'sub') return getSubTask(store, taskId) ? 'sub' : null;

  const hasMainTask = getMainTask(store, taskId) !== null;
  const hasSubTask = getSubTask(store, taskId) !== null;
  if (hasMainTask && hasSubTask) {
    throw new Error(`Task "${taskId}" exists as both main and sub task. Please provide taskType explicitly.`);
  }
  if (hasMainTask) return 'main';
  if (hasSubTask) return 'sub';
  return null;
}

export function repairAllMainTaskCounts(
  store: TaskStoreBindings,
): { repaired: number; autoCompleted: number; details: Array<{ taskId: string; action: string }> } {
  const allMainTasks = listMainTasks(store);
  const report = { repaired: 0, autoCompleted: 0, details: [] as Array<{ taskId: string; action: string }> };

  for (const mt of allMainTasks) {
    if (mt.status === 'cancelled') continue;

    const subs = listSubTasks(store, mt.taskId);
    const completedCount = subs.filter((s) => s.status === 'completed').length;
    const totalCount = subs.length;

    let needsRepair = false;
    let needsAutoComplete = false;
    if (mt.totalSubtasks !== totalCount || mt.completedSubtasks !== completedCount) needsRepair = true;
    if (totalCount > 0 && completedCount >= totalCount && mt.status !== 'completed') {
      needsAutoComplete = true;
      needsRepair = true;
    }
    if (!needsRepair) continue;

    const now = Date.now();
    const finalStatus = needsAutoComplete ? 'completed' as TaskStatus : mt.status;
    const finalCompletedAt = needsAutoComplete ? now : mt.completedAt;

    store.graph.upsertEntityByProp(
      ET.MAIN_TASK, 'taskId', mt.taskId, mt.title, {
        projectName: store.projectName,
        taskId: mt.taskId,
        title: mt.title,
        priority: mt.priority,
        description: mt.description || '',
        estimatedHours: mt.estimatedHours || 0,
        relatedSections: mt.relatedSections || [],
        relatedPromptIds: mt.relatedPromptIds || [],
        moduleId: mt.moduleId || null,
        totalSubtasks: totalCount,
        completedSubtasks: completedCount,
        status: finalStatus,
        order: mt.order,
        createdAt: mt.createdAt,
        updatedAt: now,
        completedAt: finalCompletedAt,
      },
    );

    report.repaired++;
    if (needsAutoComplete) {
      report.autoCompleted++;
      report.details.push({ taskId: mt.taskId, action: `auto-completed (${completedCount}/${totalCount} subtasks done)` });
    } else {
      report.details.push({ taskId: mt.taskId, action: `counts fixed: ${mt.completedSubtasks}→${completedCount}/${totalCount}` });
    }
  }

  if (report.repaired > 0) {
    store.graph.flush();
  }
  return report;
}
