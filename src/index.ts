/**
 * aifastdb-devplan — AI-powered development plan management
 *
 * 使用 aifastdb 作为存储引擎的通用开发计划管理系统。
 * 可作为 MCP Server 使用，也可作为 npm 包编程使用。
 *
 * MCP Server 使用方式：
 * ```json
 * {
 *   "mcpServers": {
 *     "aifastdb-devplan": {
 *       "command": "npx",
 *       "args": ["aifastdb-devplan"]
 *     }
 *   }
 * }
 * ```
 *
 * 编程使用方式：
 * ```typescript
 * import { DevPlanStore, createDevPlan } from 'aifastdb-devplan';
 *
 * const plan = createDevPlan('my-project');
 * plan.createMainTask({ projectName: 'my-project', taskId: 'phase-1', title: '阶段一', priority: 'P0' });
 * plan.addSubTask({ projectName: 'my-project', taskId: 'T1.1', parentTaskId: 'phase-1', title: '初始化' });
 * plan.completeSubTask('T1.1');
 * ```
 */

// DevPlan Store API
export {
  DevPlanStore,
  createDevPlan,
  listDevPlans,
  ALL_SECTIONS,
  SECTION_DESCRIPTIONS,
  type DevPlanSection,
  type TaskStatus,
  type TaskPriority,
  type DevPlanDocInput,
  type DevPlanDoc,
  type MainTaskInput,
  type MainTask,
  type SubTaskInput,
  type SubTask,
  type CompleteSubTaskResult,
  type MainTaskProgress,
  type ProjectProgress,
  type DevPlanStoreConfig,
  type SyncGitResult,
  type RevertedTask,
  type ModuleStatus,
  type ModuleInput,
  type Module,
  type ModuleDetail,
} from './dev-plan-store';
