/**
 * 一次性迁移脚本：为 ai_db 项目的历史数据建立 task_has_doc 关系
 * 
 * 用法: npx tsx scripts/migrate-relations.ts
 */

import { createDevPlan } from '../src/dev-plan-factory';
import type { DevPlanGraphStore } from '../src/dev-plan-graph-store';

const basePath = 'D:\\Project\\git\\ai_db\\.devplan';
const projectName = 'ai_db';

// 任务 → 文档片段的映射关系
const taskDocMap: Record<string, string[]> = {
  'phase-1':  ['overview', 'core_concepts', 'config'],
  'phase-2':  ['core_concepts'],
  'phase-3':  ['core_concepts'],
  'phase-4':  ['api_endpoints', 'technical_notes|transaction_lifecycle', 'technical_notes|rate_limiting'],
  'phase-5':  ['api_design|typescript_v1'],
  'phase-6':  ['technical_notes|performance_limits', 'technical_notes|benchmark'],
  'phase-7':  ['api_design|rust_v2', 'technical_notes|storage_analysis'],
  'phase-7A': ['technical_notes|storage_analysis'],
  'phase-7B': ['technical_notes|performance_limits'],
  'phase-8':  ['api_design|rust_v2', 'file_structure'],
  'phase-8C': ['technical_notes|error_handling', 'technical_notes|monitoring', 'technical_notes|backup'],
  'phase-9':  ['core_concepts'],
  'phase-10': ['technical_notes|performance_limits'],
  'phase-11': ['technical_notes|transaction_lifecycle'],
  'phase-12': ['api_design|napi_v2'],
  'phase-13': ['api_design|typescript_v1'],
  'phase-14': ['technical_notes|vector_store'],
  'phase-15': ['technical_notes|security', 'custom|next_steps'],
  'phase-16': ['custom|carpool-overview', 'custom|carpool-data-model', 'custom|carpool-file-structure', 'technical_notes|social-graph-v2-architecture'],
  'phase-17': ['custom|carpool-api-design', 'technical_notes|carpool-technical-design'],
  'phase-18': ['technical_notes|carpool-technical-design'],
  'phase-19': ['custom|carpool-examples'],
  'phase-20': ['technical_notes|carpool-technical-design'],
  'phase-21': ['custom|carpool-vehicle-design', 'technical_notes|carpool-data-model-v2'],
};

async function main() {
  console.log(`=== 开始迁移 task_has_doc 关系 ===`);
  console.log(`项目: ${projectName}`);
  console.log(`数据路径: ${basePath}`);
  console.log('');

  const store = createDevPlan(projectName, 'graph', basePath) as DevPlanGraphStore;

  // 验证数据
  const tasks = store.listMainTasks();
  const docs = store.listSections();
  console.log(`主任务数: ${tasks.length}`);
  console.log(`文档数: ${docs.length}`);
  console.log('');

  let totalRelations = 0;
  let failedRelations = 0;

  for (const [taskId, docSections] of Object.entries(taskDocMap)) {
    const task = store.getMainTask(taskId);
    if (!task) {
      console.log(`[跳过] 主任务 ${taskId} 不存在`);
      continue;
    }

    // 使用 upsertMainTask 建立关系
    console.log(`[处理] ${taskId}: ${task.title}`);
    
    store.upsertMainTask(
      {
        projectName,
        taskId,
        title: task.title,
        priority: task.priority,
        relatedSections: docSections,
      },
      { preserveStatus: true }
    );

    for (const ds of docSections) {
      const relatedDocs = store.getTaskRelatedDocs?.(taskId) || [];
      const found = relatedDocs.length > 0;
      if (found) {
        totalRelations++;
        console.log(`  ✓ → ${ds}`);
      } else {
        failedRelations++;
        console.log(`  ✗ → ${ds} (未找到文档实体)`);
      }
    }
  }

  // 最终验证
  console.log('');
  console.log(`=== 迁移完成 ===`);

  // 重新导出图验证
  if (store.exportGraph) {
    const graph = store.exportGraph({ includeDocuments: true, includeModules: false });
    const taskDocEdges = graph.edges.filter(e => e.label === 'task_has_doc');
    console.log(`task_has_doc 边数量: ${taskDocEdges.length}`);
    
    if (taskDocEdges.length > 0) {
      console.log('部分示例:');
      for (const edge of taskDocEdges.slice(0, 5)) {
        const fromNode = graph.nodes.find(n => n.id === edge.from);
        const toNode = graph.nodes.find(n => n.id === edge.to);
        console.log(`  ${fromNode?.label || edge.from} → ${toNode?.label || edge.to}`);
      }
      if (taskDocEdges.length > 5) {
        console.log(`  ... 还有 ${taskDocEdges.length - 5} 条`);
      }
    }
  }
}

main().catch(console.error);
