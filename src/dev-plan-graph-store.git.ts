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
  let checked = 0;

  for (const mt of mainTasks) {
    const subs = store.listSubTasks(mt.taskId);
    for (const sub of subs) {
      if (sub.status !== 'completed' || !sub.completedAtCommit) continue;
      checked++;

      if (!isAncestor(sub.completedAtCommit, currentHead, store.gitCwd)) {
        const reason = `Commit ${sub.completedAtCommit} not found in current branch (HEAD: ${currentHead})`;

        if (!dryRun) {
          store.updateSubTaskStatus(sub.taskId, 'pending', { revertReason: reason });
          store.refreshMainTaskCounts(sub.parentTaskId);

          const parentMain = store.getMainTask(sub.parentTaskId);
          if (parentMain && parentMain.status === 'completed') {
            store.updateMainTaskStatus(sub.parentTaskId, 'in_progress');
          }
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

  return { checked, reverted, currentHead };
}
