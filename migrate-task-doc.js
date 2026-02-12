/**
 * 迁移脚本：为 ai_db 项目的历史数据建立 task_has_doc 关系
 * 
 * 直接使用编译后的 DevPlanGraphStore，绕过 MCP 服务器。
 * 
 * 用法: node migrate-task-doc.js
 */

const { DevPlanGraphStore } = require('./dist/dev-plan-graph-store');

const GRAPH_PATH = 'D:\\Project\\git\\ai_db\\.devplan\\ai_db\\graph-data';
const PROJECT_NAME = 'ai_db';

// ============================================================================
// 任务 -> 文档 的映射关系
// 格式: taskId -> [sectionKey, ...] (sectionKey = "section" 或 "section|subSection")
// ============================================================================
const TASK_DOC_MAP = {
  'phase-1':  ['overview', 'core_concepts', 'file_structure'],
  'phase-2':  ['core_concepts', 'api_design|typescript_v1'],
  'phase-3':  ['core_concepts', 'api_design|typescript_v1'],
  'phase-4':  ['api_endpoints', 'api_design|typescript_v1'],
  'phase-5':  ['api_design|typescript_v1'],
  'phase-6':  ['technical_notes|performance_limits'],
  'phase-7':  ['api_design|rust_v2', 'technical_notes|storage_analysis'],
  'phase-7A': ['api_design|rust_v2'],
  'phase-7B': ['api_design|rust_v2', 'technical_notes|error_handling'],
  'phase-8':  ['api_design|rust_v2', 'file_structure'],
  'phase-8C': ['technical_notes|monitoring', 'technical_notes|rate_limiting', 'technical_notes|backup', 'technical_notes|benchmark'],
  'phase-9':  ['api_design|rust_v2'],
  'phase-10': ['api_design|rust_v2'],
  'phase-11': ['technical_notes|transaction_lifecycle'],
  'phase-12': ['api_design|napi_v2'],
  'phase-13': ['api_design|napi_v2', 'examples'],
  'phase-14': ['technical_notes|vector_store'],
  'phase-15': ['technical_notes|security', 'custom|next_steps'],
  'phase-16': ['custom|carpool-overview', 'custom|carpool-data-model', 'custom|carpool-file-structure'],
  'phase-17': ['custom|carpool-api-design', 'custom|carpool-data-model'],
  'phase-18': ['technical_notes|carpool-technical-design'],
  'phase-19': ['custom|carpool-examples'],
  'phase-20': ['technical_notes|carpool-technical-design'],
  'phase-21': ['custom|carpool-vehicle-design', 'technical_notes|carpool-data-model-v2'],
  // phase-E: 无关联文档
};

// ============================================================================
// Main Migration
// ============================================================================

function main() {
  console.log('=== 开始迁移：建立 task_has_doc 关系 ===\n');
  console.log(`项目: ${PROJECT_NAME}`);
  console.log(`图数据路径: ${GRAPH_PATH}\n`);

  // 创建 store 实例
  const store = new DevPlanGraphStore(PROJECT_NAME, {
    graphPath: GRAPH_PATH,
    shardCount: 4,
  });

  // 1. 先验证数据存在
  const tasks = store.listMainTasks();
  const docs = store.listSections();
  console.log(`发现 ${tasks.length} 个主任务, ${docs.length} 个文档\n`);

  if (tasks.length === 0 || docs.length === 0) {
    console.error('错误：没有找到任务或文档数据！');
    process.exit(1);
  }

  // 2. 构建 sectionKey -> doc 映射（用于验证）
  const docMap = {};
  for (const doc of docs) {
    const key = doc.subSection ? `${doc.section}|${doc.subSection}` : doc.section;
    docMap[key] = doc;
  }
  console.log('文档 sectionKey 列表:');
  for (const key of Object.keys(docMap).sort()) {
    console.log(`  ${key} -> "${docMap[key].title}"`);
  }
  console.log('');

  // 3. 对每个任务执行 upsertMainTask，传入 relatedSections
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const task of tasks) {
    const relatedSections = TASK_DOC_MAP[task.taskId];

    if (!relatedSections || relatedSections.length === 0) {
      console.log(`跳过 ${task.taskId}: "${task.title}" (无关联文档映射)`);
      skipCount++;
      continue;
    }

    // 验证 sectionKey 有效
    const validSections = [];
    const invalidSections = [];
    for (const sk of relatedSections) {
      if (docMap[sk]) {
        validSections.push(sk);
      } else {
        invalidSections.push(sk);
      }
    }

    if (invalidSections.length > 0) {
      console.warn(`  警告: ${task.taskId} 有无效的 sectionKey: ${invalidSections.join(', ')}`);
    }

    if (validSections.length === 0) {
      console.log(`跳过 ${task.taskId}: 所有 sectionKey 无效`);
      skipCount++;
      continue;
    }

    try {
      // 使用 upsertMainTask 更新任务并建立关系
      const updated = store.upsertMainTask(
        {
          projectName: PROJECT_NAME,
          taskId: task.taskId,
          title: task.title,
          priority: task.priority,
          description: task.description,
          estimatedHours: task.estimatedHours,
          moduleId: task.moduleId,
          relatedSections: validSections,
        },
        { preserveStatus: true, status: task.status }
      );

      console.log(`✓ ${task.taskId}: "${task.title}" -> [${validSections.join(', ')}]`);
      successCount++;
    } catch (err) {
      console.error(`✗ ${task.taskId}: ${err.message}`);
      errorCount++;
    }
  }

  console.log(`\n=== 迁移完成 ===`);
  console.log(`成功: ${successCount}, 跳过: ${skipCount}, 失败: ${errorCount}`);

  // 4. 验证：导出图并检查 task_has_doc 边
  console.log('\n=== 验证 task_has_doc 关系 ===');
  const graph = store.exportGraph();
  const taskDocEdges = graph.edges.filter(e => e.label === 'task_has_doc');
  console.log(`task_has_doc 边数量: ${taskDocEdges.length}`);
  for (const edge of taskDocEdges) {
    const fromNode = graph.nodes.find(n => n.id === edge.from);
    const toNode = graph.nodes.find(n => n.id === edge.to);
    console.log(`  ${fromNode?.label || edge.from} -> ${toNode?.label || edge.to}`);
  }
}

main();
