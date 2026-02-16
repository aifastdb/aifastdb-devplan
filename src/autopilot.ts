/**
 * Autopilot 核心逻辑模块
 *
 * 提供 getAutopilotStatus() 和 getAutopilotNextAction() 两个核心函数，
 * 供 HTTP API（visualize/server.ts）和 MCP 工具（mcp-server/index.ts）共用。
 *
 * 设计原则：
 * - 纯逻辑函数，接收 IDevPlanStore 实例，不涉及 HTTP/MCP 传输层
 * - 无副作用（读取任务状态，不修改）
 * - 返回强类型结构，调用方直接 JSON.stringify 即可
 */

import type { IDevPlanStore } from './dev-plan-interface';
import type {
  AutopilotStatus,
  AutopilotNextAction,
  AutopilotConfig,
  ExecutorHeartbeat,
} from './types';
import { DEFAULT_AUTOPILOT_CONFIG } from './types';

// ============================================================================
// In-memory State (per-project)
// ============================================================================

/** 每个项目的 Autopilot 运行时状态 */
interface AutopilotRuntime {
  config: AutopilotConfig;
  lastHeartbeat: ExecutorHeartbeat | null;
  lastHeartbeatTime: number;
}

const runtimeMap = new Map<string, AutopilotRuntime>();

function getRuntime(projectName: string): AutopilotRuntime {
  if (!runtimeMap.has(projectName)) {
    runtimeMap.set(projectName, {
      config: { ...DEFAULT_AUTOPILOT_CONFIG },
      lastHeartbeat: null,
      lastHeartbeatTime: 0,
    });
  }
  return runtimeMap.get(projectName)!;
}

// ============================================================================
// Core Logic: getAutopilotStatus
// ============================================================================

/**
 * 获取 Autopilot 执行状态
 *
 * 分析项目的任务状态，返回：
 * - 是否有进行中的阶段
 * - 当前活跃阶段的进度
 * - 当前进行中的子任务
 * - 下一个待执行的子任务
 * - 下一个待启动的阶段
 * - 剩余未完成阶段数
 */
export function getAutopilotStatus(store: IDevPlanStore): AutopilotStatus {
  const progress = store.getProgress();
  const tasks = progress.tasks;

  // 找到 in_progress 状态的主任务（活跃阶段）
  const activePhaseProgress = tasks.find(t => t.status === 'in_progress');

  // 剩余未完成阶段（pending + in_progress）
  const remainingPhases = tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled').length;

  const result: AutopilotStatus = {
    hasActivePhase: !!activePhaseProgress,
    remainingPhases,
  };

  if (activePhaseProgress) {
    result.activePhase = {
      taskId: activePhaseProgress.taskId,
      title: activePhaseProgress.title,
      totalSubtasks: activePhaseProgress.total,
      completedSubtasks: activePhaseProgress.completed,
      percent: activePhaseProgress.percent,
    };

    // 获取活跃阶段的子任务列表
    const subTasks = store.listSubTasks(activePhaseProgress.taskId);

    // 当前 in_progress 的子任务
    const currentSub = subTasks.find(s => s.status === 'in_progress');
    if (currentSub) {
      result.currentSubTask = {
        taskId: currentSub.taskId,
        title: currentSub.title,
        status: currentSub.status,
      };
    }

    // 下一个 pending 的子任务
    const nextPending = subTasks.find(s => s.status === 'pending');
    if (nextPending) {
      result.nextPendingSubTask = {
        taskId: nextPending.taskId,
        title: nextPending.title,
      };
    }
  }

  // 下一个待启动的阶段（pending 状态，按 order 排序取第一个）
  const nextPendingPhaseProgress = tasks.find(t => t.status === 'pending');
  if (nextPendingPhaseProgress) {
    const mainTask = store.getMainTask(nextPendingPhaseProgress.taskId);
    result.nextPendingPhase = {
      taskId: nextPendingPhaseProgress.taskId,
      title: nextPendingPhaseProgress.title,
      priority: mainTask?.priority || 'P0',
    };
  }

  return result;
}

// ============================================================================
// Core Logic: getAutopilotNextAction
// ============================================================================

/**
 * 智能推荐下一步动作
 *
 * 决策逻辑（优先级从高到低）：
 * 1. 所有阶段已完成 → all_done
 * 2. 有活跃阶段 + 有 in_progress 子任务 → wait（AI 正在工作）
 * 3. 有活跃阶段 + 有 pending 子任务 → send_task（发送下一个子任务）
 * 4. 有活跃阶段 + 全部子任务完成 → start_phase（启动下一个阶段）
 * 5. 无活跃阶段 + 有 pending 阶段 → start_phase（启动第一个待开始阶段）
 * 6. 无活跃阶段 + 无 pending 阶段 → all_done
 */
export function getAutopilotNextAction(store: IDevPlanStore): AutopilotNextAction {
  const status = getAutopilotStatus(store);
  const progress = store.getProgress();
  const tasks = progress.tasks;

  // Case 1: 所有阶段已完成
  if (status.remainingPhases === 0) {
    return {
      action: 'all_done',
      message: `项目所有 ${tasks.length} 个阶段已全部完成！`,
    };
  }

  // Case 2~4: 有活跃阶段
  if (status.hasActivePhase && status.activePhase) {
    const phase = status.activePhase;
    const subTasks = store.listSubTasks(phase.taskId);

    // 有 in_progress 子任务 → wait
    if (status.currentSubTask) {
      return {
        action: 'wait',
        phase: {
          taskId: phase.taskId,
          title: phase.title,
          status: 'in_progress',
          totalSubtasks: phase.totalSubtasks,
          completedSubtasks: phase.completedSubtasks,
        },
        subTask: {
          taskId: status.currentSubTask.taskId,
          title: status.currentSubTask.title,
          status: status.currentSubTask.status,
        },
        message: `${status.currentSubTask.taskId} — ${status.currentSubTask.title} 正在执行中，等待完成`,
      };
    }

    // 有 pending 子任务 → send_task
    const nextPending = subTasks.find(s => s.status === 'pending');
    if (nextPending) {
      return {
        action: 'send_task',
        phase: {
          taskId: phase.taskId,
          title: phase.title,
          status: 'in_progress',
          totalSubtasks: phase.totalSubtasks,
          completedSubtasks: phase.completedSubtasks,
        },
        subTask: {
          taskId: nextPending.taskId,
          title: nextPending.title,
          description: nextPending.description,
          status: nextPending.status,
        },
        message: `当前阶段有 ${phase.totalSubtasks - phase.completedSubtasks} 个待完成子任务，下一个: ${nextPending.taskId} — ${nextPending.title}`,
      };
    }

    // 活跃阶段的子任务全部完成 → 查找下一个阶段
    const nextPhase = tasks.find(t => t.status === 'pending');
    if (nextPhase) {
      return {
        action: 'start_phase',
        phase: {
          taskId: nextPhase.taskId,
          title: nextPhase.title,
          status: 'pending',
          totalSubtasks: nextPhase.total,
          completedSubtasks: nextPhase.completed,
        },
        message: `${phase.taskId} 全部子任务已完成，建议启动下一阶段: ${nextPhase.taskId} — ${nextPhase.title}`,
      };
    }

    // 无更多阶段
    return {
      action: 'all_done',
      message: `${phase.taskId} 全部子任务已完成，且无更多待启动阶段。项目开发完毕！`,
    };
  }

  // Case 5: 无活跃阶段 + 有 pending 阶段
  if (status.nextPendingPhase) {
    const nextPhase = tasks.find(t => t.taskId === status.nextPendingPhase!.taskId);
    return {
      action: 'start_phase',
      phase: {
        taskId: status.nextPendingPhase.taskId,
        title: status.nextPendingPhase.title,
        status: 'pending',
        totalSubtasks: nextPhase?.total || 0,
        completedSubtasks: nextPhase?.completed || 0,
      },
      message: `无进行中阶段，建议启动: ${status.nextPendingPhase.taskId} — ${status.nextPendingPhase.title}`,
    };
  }

  // Case 6: 全部完成
  return {
    action: 'all_done',
    message: `项目所有阶段已全部完成！`,
  };
}

// ============================================================================
// Config Management
// ============================================================================

/**
 * 获取项目的 Autopilot 配置
 */
export function getAutopilotConfig(projectName: string): AutopilotConfig {
  return { ...getRuntime(projectName).config };
}

/**
 * 更新项目的 Autopilot 配置（合并更新）
 */
export function updateAutopilotConfig(
  projectName: string,
  updates: Partial<AutopilotConfig>
): AutopilotConfig {
  const runtime = getRuntime(projectName);
  runtime.config = { ...runtime.config, ...updates };
  return { ...runtime.config };
}

// ============================================================================
// Heartbeat Management
// ============================================================================

/**
 * 记录 executor 心跳
 */
export function recordHeartbeat(projectName: string, heartbeat: ExecutorHeartbeat): void {
  const runtime = getRuntime(projectName);
  runtime.lastHeartbeat = heartbeat;
  runtime.lastHeartbeatTime = Date.now();
}

/**
 * 获取最近的心跳信息
 */
export function getLastHeartbeat(projectName: string): {
  heartbeat: ExecutorHeartbeat | null;
  receivedAt: number;
  isAlive: boolean;
} {
  const runtime = getRuntime(projectName);
  const timeoutMs = runtime.config.pollIntervalSeconds * 3 * 1000; // 3 倍轮询间隔视为超时
  const isAlive = runtime.lastHeartbeat !== null &&
    (Date.now() - runtime.lastHeartbeatTime) < timeoutMs;

  return {
    heartbeat: runtime.lastHeartbeat,
    receivedAt: runtime.lastHeartbeatTime,
    isAlive,
  };
}
