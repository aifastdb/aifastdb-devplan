import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { getAutopilotStatus, getAutopilotNextAction, getAutopilotConfig, updateAutopilotConfig, getLastHeartbeat } from '../../autopilot';
import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';

type GetDevPlan = (projectName: string) => IDevPlanStore;

export async function handleAutopilotToolCall(name: string, args: ToolArgs, deps: { getDevPlan: GetDevPlan }): Promise<string | null> {
  const { getDevPlan } = deps;
  switch (name) {
    case 'devplan_start_phase': {
      if (!args.projectName) throw new McpError(ErrorCode.InvalidParams, 'projectName is required');
      if (!args.taskId) throw new McpError(ErrorCode.InvalidParams, 'taskId is required');

      const plan = getDevPlan(args.projectName);
      const mainTask = plan.getMainTask(args.taskId);
      if (!mainTask) {
        throw new McpError(ErrorCode.InvalidParams, `Main task "${args.taskId}" not found in project "${args.projectName}"`);
      }

      // Mark main task as in_progress (if still pending)
      if (mainTask.status === 'pending') {
        plan.updateMainTaskStatus(args.taskId, 'in_progress');
      }

      // Fetch all sub-tasks
      const subTasks = plan.listSubTasks(args.taskId);

      // Get related document sections (if any)
      const relatedDocs = mainTask.relatedSections || [];

      // Return structured result optimized for Cursor TodoList creation
      return JSON.stringify({
        mainTask: {
          taskId: mainTask.taskId,
          title: mainTask.title,
          priority: mainTask.priority,
          status: 'in_progress',
          description: mainTask.description,
          estimatedHours: mainTask.estimatedHours,
          moduleId: mainTask.moduleId,
          order: mainTask.order,
          totalSubtasks: subTasks.length,
          completedSubtasks: subTasks.filter(s => s.status === 'completed').length,
        },
        subTasks: subTasks.map(s => ({
          taskId: s.taskId,
          title: s.title,
          status: s.status,
          description: s.description,
          estimatedHours: s.estimatedHours,
          order: s.order,
        })),
        relatedDocSections: relatedDocs,
        message: `Phase ${args.taskId} started. ${subTasks.length} sub-tasks total, ${subTasks.filter(s => s.status === 'completed').length} already completed.`,
      }, null, 2);
    }


    case 'devplan_auto_status': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }
      const plan = getDevPlan(args.projectName);
      const status = getAutopilotStatus(plan);
      const hbInfo = getLastHeartbeat(args.projectName);

      return JSON.stringify({
        ...status,
        executor: {
          isAlive: hbInfo.isAlive,
          lastHeartbeat: hbInfo.heartbeat,
          lastHeartbeatReceivedAt: hbInfo.receivedAt || null,
        },
      }, null, 2);
    }


    case 'devplan_auto_next': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }
      const plan = getDevPlan(args.projectName);
      const nextAction = getAutopilotNextAction(plan);

      return JSON.stringify(nextAction, null, 2);
    }


    case 'devplan_auto_config': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      if (args.config && typeof args.config === 'object') {
        // 更新配置
        const updated = updateAutopilotConfig(args.projectName, args.config);
        return JSON.stringify({
          action: 'updated',
          config: updated,
        }, null, 2);
      } else {
        // 读取配置
        const current = getAutopilotConfig(args.projectName);
        return JSON.stringify({
          action: 'read',
          config: current,
        }, null, 2);
      }
    }

    // ==================================================================
    // Prompt Logging
    // ==================================================================


    default:
      return null;
  }
}
