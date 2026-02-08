/**
 * aifastdb-devplan — AI-powered development plan management
 *
 * 使用 aifastdb 作为存储引擎的通用开发计划管理系统。
 * 支持双引擎：SocialGraphV2（图结构，默认）和 EnhancedDocumentStore（文档存储）。
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
 * import { createDevPlan, type IDevPlanStore } from 'aifastdb-devplan';
 *
 * // 使用默认引擎（graph）
 * const plan = createDevPlan('my-project');
 *
 * // 使用指定引擎
 * const graphPlan = createDevPlan('my-project', undefined, 'graph');
 * const docPlan = createDevPlan('my-project', undefined, 'document');
 *
 * plan.createMainTask({ projectName: 'my-project', taskId: 'phase-1', title: '阶段一', priority: 'P0' });
 * plan.addSubTask({ projectName: 'my-project', taskId: 'T1.1', parentTaskId: 'phase-1', title: '初始化' });
 * plan.completeSubTask('T1.1');
 *
 * // 图引擎专属：导出图结构用于可视化
 * if (plan.exportGraph) {
 *   const graph = plan.exportGraph();
 *   // graph.nodes, graph.edges — 兼容 vis-network
 * }
 * ```
 */

// Interface & Types
export type { IDevPlanStore } from './dev-plan-interface';
export {
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
  type DevPlanGraphStoreConfig,
  type DevPlanGraphNode,
  type DevPlanGraphEdge,
  type DevPlanExportedGraph,
} from './types';

// Store Implementations
export { DevPlanDocumentStore } from './dev-plan-document-store';
export { DevPlanGraphStore } from './dev-plan-graph-store';

// Factory & Engine Selection
export {
  createDevPlan,
  listDevPlans,
  getDefaultBasePath,
  getProjectEngine,
  type DevPlanEngine,
} from './dev-plan-factory';

// Migration
export {
  migrateEngine,
  type MigrateResult,
  type MigrateOptions,
} from './dev-plan-migrate';
