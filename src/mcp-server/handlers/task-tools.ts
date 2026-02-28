import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { TaskPriority, TaskStatus } from '../../types';

import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';

type GetDevPlan = (projectName: string) => IDevPlanStore;

export async function handleTaskToolCall(name: string, args: ToolArgs, deps: { getDevPlan: GetDevPlan }): Promise<string | null> {
  const { getDevPlan } = deps;

  switch (name) {
    case 'devplan_create_main_task': {
      if (!args.projectName || !args.taskId || !args.title || !args.priority) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, taskId, title, priority');
      }

      const plan = getDevPlan(args.projectName);
      try {
        // Phase-23: createMainTask 内部已幂等处理（upsertEntityByProp），无需额外检查
        const mainTask = plan.createMainTask({
          projectName: args.projectName,
          taskId: args.taskId,
          title: args.title,
          priority: args.priority as TaskPriority,
          description: args.description,
          estimatedHours: args.estimatedHours,
          moduleId: args.moduleId,
          relatedSections: args.relatedDocSections,
          relatedPromptIds: args.relatedPromptIds,
          order: args.order,
        });

        return JSON.stringify({
          success: true,
          mainTask: {
            id: mainTask.id,
            taskId: mainTask.taskId,
            title: mainTask.title,
            priority: mainTask.priority,
            status: mainTask.status,
          },
        });
      } catch (err) {
        throw new McpError(ErrorCode.InvalidParams,
          err instanceof Error ? err.message : String(err));
      }
    }


    case 'devplan_add_sub_task': {
      if (!args.projectName || !args.taskId || !args.parentTaskId || !args.title) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, taskId, parentTaskId, title');
      }

      const plan = getDevPlan(args.projectName);
      try {
        // Phase-23: addSubTask 内部已幂等处理（upsertEntityByProp），无需额外检查
        const subTask = plan.addSubTask({
          projectName: args.projectName,
          taskId: args.taskId,
          parentTaskId: args.parentTaskId,
          title: args.title,
          estimatedHours: args.estimatedHours,
          description: args.description,
          order: args.order,
        });

        return JSON.stringify({
          success: true,
          subTask: {
            id: subTask.id,
            taskId: subTask.taskId,
            parentTaskId: subTask.parentTaskId,
            title: subTask.title,
            status: subTask.status,
          },
        });
      } catch (err) {
        throw new McpError(ErrorCode.InvalidParams,
          err instanceof Error ? err.message : String(err));
      }
    }


    case 'devplan_upsert_task': {
      if (!args.projectName || !args.taskType || !args.taskId || !args.title) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, taskType, taskId, title');
      }

      const plan = getDevPlan(args.projectName);
      const upsertTaskType = args.taskType;
      const targetStatus = (args.status as TaskStatus) || 'pending';
      const preserveStatus = args.preserveStatus !== false; // 默认 true

      try {
        if (upsertTaskType === 'main') {
          if (!args.priority) {
            throw new McpError(ErrorCode.InvalidParams, 'Missing required for main task: priority');
          }
          const mainTask = plan.upsertMainTask(
            {
              projectName: args.projectName,
              taskId: args.taskId,
              title: args.title,
              priority: args.priority as TaskPriority,
              description: args.description,
              estimatedHours: args.estimatedHours,
              moduleId: args.moduleId,
              relatedSections: args.relatedDocSections,
              relatedPromptIds: args.relatedPromptIds,
              order: args.order,
            },
            { preserveStatus, status: targetStatus }
          );
          return JSON.stringify({
            success: true,
            taskType: 'main',
            mainTask: {
              id: mainTask.id,
              taskId: mainTask.taskId,
              title: mainTask.title,
              priority: mainTask.priority,
              status: mainTask.status,
              updatedAt: mainTask.updatedAt,
            },
          });
        } else {
          if (!args.parentTaskId) {
            throw new McpError(ErrorCode.InvalidParams, 'Missing required for sub-task: parentTaskId');
          }
          const subTask = plan.upsertSubTask(
            {
              projectName: args.projectName,
              taskId: args.taskId,
              parentTaskId: args.parentTaskId,
              title: args.title,
              estimatedHours: args.estimatedHours,
              description: args.description,
              order: args.order,
            },
            { preserveStatus, status: targetStatus }
          );
          return JSON.stringify({
            success: true,
            taskType: 'sub',
            subTask: {
              id: subTask.id,
              taskId: subTask.taskId,
              parentTaskId: subTask.parentTaskId,
              title: subTask.title,
              status: subTask.status,
              updatedAt: subTask.updatedAt,
            },
          });
        }
      } catch (err) {
        throw new McpError(ErrorCode.InvalidParams,
          err instanceof Error ? err.message : String(err));
      }
    }


    case 'devplan_complete_task': {
      if (!args.projectName || !args.taskId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, taskId');
      }

      const plan = getDevPlan(args.projectName);
      const taskType = args.taskType || 'sub';

      /**
       * 查找下一个待处理的主任务（按 order 排序）
       * 优先返回 in_progress 的，其次是 pending 的
       */
      const findNextPendingPhase = () => {
        const allMainTasks = plan.listMainTasks();
        // 优先找 in_progress 的主任务
        const inProgress = allMainTasks.find(t => t.status === 'in_progress');
        if (inProgress) {
          return { taskId: inProgress.taskId, title: inProgress.title, status: inProgress.status, priority: inProgress.priority };
        }
        // 其次找 pending 的主任务（已按 order 排序）
        const pending = allMainTasks.find(t => t.status === 'pending');
        if (pending) {
          return { taskId: pending.taskId, title: pending.title, status: pending.status, priority: pending.priority };
        }
        return null;
      };

      /**
       * 统计剩余未完成的主任务数量
       */
      const countRemainingPhases = () => {
        const allMainTasks = plan.listMainTasks();
        return allMainTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
      };

      try {
        if (taskType === 'main') {
          const mainTask = plan.completeMainTask(args.taskId);
          const nextPhase = findNextPendingPhase();
          const remainingCount = countRemainingPhases();
          const response: Record<string, unknown> = {
            success: true,
            taskType: 'main',
            mainTask: {
              taskId: mainTask.taskId,
              title: mainTask.title,
              status: mainTask.status,
              completedAt: mainTask.completedAt,
              totalSubtasks: mainTask.totalSubtasks,
              completedSubtasks: mainTask.completedSubtasks,
            },
          };
          if (nextPhase) {
            response.nextPhase = nextPhase;
            response.remainingPhases = remainingCount;
            response.hint = `🎉 阶段 "${mainTask.title}" 已完成！还有 ${remainingCount} 个待处理阶段。下一个：${nextPhase.taskId} "${nextPhase.title}"。是否继续？（说"开始 ${nextPhase.taskId}"即可启动）`;
          } else {
            response.remainingPhases = 0;
            response.hint = `🎉🎉🎉 所有阶段全部完成！项目开发计划已圆满结束。`;
          }
          return JSON.stringify(response);
        } else {
          const result = plan.completeSubTask(args.taskId);
          const response: Record<string, unknown> = {
            success: true,
            taskType: 'sub',
            subTask: {
              taskId: result.subTask.taskId,
              title: result.subTask.title,
              status: result.subTask.status,
              completedAt: result.subTask.completedAt,
              completedAtCommit: result.completedAtCommit || null,
            },
            mainTask: {
              taskId: result.mainTask.taskId,
              title: result.mainTask.title,
              status: result.mainTask.status,
              totalSubtasks: result.mainTask.totalSubtasks,
              completedSubtasks: result.mainTask.completedSubtasks,
            },
            mainTaskCompleted: result.mainTaskCompleted,
            completedAtCommit: result.completedAtCommit || null,
          };
          // 当主任务也随之完成时，查询下一个待处理阶段
          if (result.mainTaskCompleted) {
            const nextPhase = findNextPendingPhase();
            const remainingCount = countRemainingPhases();
            if (nextPhase) {
              response.nextPhase = nextPhase;
              response.remainingPhases = remainingCount;
              response.hint = `🎉 阶段 "${result.mainTask.title}" 全部完成！还有 ${remainingCount} 个待处理阶段。下一个：${nextPhase.taskId} "${nextPhase.title}"。是否继续？（说"开始 ${nextPhase.taskId}"即可启动）`;
            } else {
              response.remainingPhases = 0;
              response.hint = `🎉🎉🎉 所有阶段全部完成！项目开发计划已圆满结束。`;
            }
          }
          return JSON.stringify(response);
        }
      } catch (err) {
        throw new McpError(ErrorCode.InvalidParams,
          err instanceof Error ? err.message : String(err));
      }
    }


    case 'devplan_list_tasks': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);

      if (args.parentTaskId) {
        // Mode 1: List sub-tasks of a specific main task
        const subTasks = plan.listSubTasks(args.parentTaskId, {
          status: args.status as TaskStatus | undefined,
        });
        return JSON.stringify({
          projectName: args.projectName,
          parentTaskId: args.parentTaskId,
          count: subTasks.length,
          subTasks: subTasks.map(st => ({
            taskId: st.taskId,
            title: st.title,
            status: st.status,
            estimatedHours: st.estimatedHours,
            completedAt: st.completedAt,
            order: st.order,
          })),
        });
      } else if (args.status && !args.priority && !args.moduleId) {
        // Mode 2: Aggregate sub-tasks across ALL main tasks matching the status filter
        const mainTasks = plan.listMainTasks();
        const allSubTasks: Array<{
          taskId: string;
          title: string;
          status: string;
          estimatedHours?: number;
          completedAt?: number | null;
          parentTaskId: string;
          parentTitle: string;
          order?: number;
        }> = [];
        for (const mt of mainTasks) {
          const subs = plan.listSubTasks(mt.taskId, {
            status: args.status as TaskStatus | undefined,
          });
          for (const sub of subs) {
            allSubTasks.push({
              taskId: sub.taskId,
              title: sub.title,
              status: sub.status,
              estimatedHours: sub.estimatedHours,
              completedAt: sub.completedAt,
              parentTaskId: mt.taskId,
              parentTitle: mt.title,
              order: sub.order,
            });
          }
        }
        return JSON.stringify({
          projectName: args.projectName,
          status: args.status,
          count: allSubTasks.length,
          subTasks: allSubTasks,
        });
      } else {
        // Mode 3: List main tasks (supports moduleId filter)
        const mainTasks = plan.listMainTasks({
          status: args.status as TaskStatus | undefined,
          priority: args.priority as TaskPriority | undefined,
          moduleId: args.moduleId,
        });
        return JSON.stringify({
          projectName: args.projectName,
          count: mainTasks.length,
          mainTasks: mainTasks.map(mt => ({
            taskId: mt.taskId,
            title: mt.title,
            priority: mt.priority,
            status: mt.status,
            totalSubtasks: mt.totalSubtasks,
            completedSubtasks: mt.completedSubtasks,
            estimatedHours: mt.estimatedHours,
            completedAt: mt.completedAt,
            order: mt.order,
          })),
        });
      }
    }


    case 'devplan_get_progress': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const progress = plan.getProgress();

      return JSON.stringify(progress);
    }


    case 'devplan_export_markdown': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const scope = args.scope || 'tasks';
      const markdown = scope === 'full'
        ? plan.exportToMarkdown()
        : plan.exportTaskSummary();

      return JSON.stringify({
        projectName: args.projectName,
        scope,
        markdown,
      });
    }


    case 'devplan_sync_git': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const dryRun = args.dryRun ?? false;

      try {
        const result = plan.syncWithGit(dryRun);

        return JSON.stringify({
          success: true,
          dryRun,
          ...result,
          summary: result.error
            ? `⚠️ ${result.error}`
            : result.reverted.length === 0
              ? `✅ All ${result.checked} completed tasks are consistent with Git HEAD (${result.currentHead})`
              : dryRun
                ? `⚠️ ${result.reverted.length} of ${result.checked} tasks would be reverted (dry run, no changes made)`
                : `🔄 ${result.reverted.length} of ${result.checked} tasks reverted to pending due to Git rollback`,
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }


    default:
      return null;
  }
}
