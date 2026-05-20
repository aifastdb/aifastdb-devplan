import type { MainTask, RevertedTask, SubTask, SyncGitResult } from './types';
import { getCurrentGitCommit, isAncestor } from './dev-plan-graph-store.utils';

export type GitStoreBindings = {
  gitCwd?: string;
  listMainTasks(filter?: { status?: string; priority?: string; moduleId?: string }): MainTask[];
  listSubTasks(parentTaskId: string, filter?: { status?: string }): SubTask[];
  updateSubTaskStatus(
    taskId: string,
    status: string,
    options?: { completedAtCommit?: string; revertReason?: string },
  ): SubTask | null;
  refreshMainTaskCounts(mainTaskId: string): MainTask | null;
  getMainTask(taskId: string): MainTask | null;
  updateMainTaskStatus(taskId: string, status: string): MainTask | null;
};

export function syncWithGit(store: GitStoreBindings, dryRun: boolean = false): SyncGitResult {
  const currentHead = getCurrentGitCommit(store.gitCwd);

  if (!currentHead) {
    return {
      checked: 0,
      reverted: [],
      currentHead: 'unknown',
      error: 'Git not available or not in a Git repository',
    };
  }

  const mainTasks = store.listMainTasks();
  const reverted: RevertedTask[] = [];
  const affectedMainTaskIds = new Set<string>();
  let checked = 0;

  for (const mt of mainTasks) {
    const subs = store.listSubTasks(mt.taskId);
    for (const sub of subs) {
      if (sub.status !== 'completed' || !sub.completedAtCommit) continue;
      checked++;

      if (!isAncestor(sub.completedAtCommit, currentHead, store.gitCwd)) {
        const reason = `Commit ${sub.completedAtCommit} not found in current branch (HEAD: ${currentHead})`;

        if (!dryRun) {
          // 已完成的子任务因 Git 回滚失锚 → 状态置为 revoked（已撤销），与人工"撤销"语义保持一致
          store.updateSubTaskStatus(sub.taskId, 'revoked', { revertReason: reason });
          store.refreshMainTaskCounts(sub.parentTaskId);
          affectedMainTaskIds.add(sub.parentTaskId);
        }

        reverted.push({
          taskId: sub.taskId,
          title: sub.title,
          parentTaskId: sub.parentTaskId,
          completedAtCommit: sub.completedAtCommit,
          reason,
        });
      }
    }
  }

  // 子任务撤销后，对应的已完成主任务也要冒泡为 revoked
  if (!dryRun) {
    for (const parentTaskId of affectedMainTaskIds) {
      const parentMain = store.getMainTask(parentTaskId);
      if (parentMain && parentMain.status === 'completed') {
        store.updateMainTaskStatus(parentTaskId, 'revoked');
      }
    }
  }

  return { checked, reverted, currentHead };
}
