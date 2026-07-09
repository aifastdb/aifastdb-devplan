/**
 * Phase-252 一次性迁移脚本：召回质量治理 + memory_tree 激活引擎对齐
 *
 * 做两件事：
 * 1. 清理存量 MOCK 记忆 — 删除 tags 含 MOCK_DATA_DELETE_ME 的记忆实体
 *    （其余 recallProfile=test_probe 的记忆不物理删除，由召回层硬过滤兜底）
 * 2. 存量关系补边 — 为已有的 memory_relates / memory_supersedes / memory_conflicts
 *    边补写对应的 mem:RELATES / mem:SUPERSEDES / mem:CONFLICTS 边，
 *    让 ai_db memory_tree 激活引擎（只遍历 mem:* 关系）能看到记忆网络。
 *
 * 用法:
 *   npx tsx scripts/phase-252-memory-migration.ts [--project <name>] [--dry-run]
 *
 * ⚠️ 注意：请勿在 MCP server 正在写入同一项目数据时运行本脚本；
 *    运行完成后需重启 MCP server 以避免其内存态覆盖本次变更。
 */

import { createDevPlan } from '../src/dev-plan-factory';
import type { DevPlanGraphStore } from '../src/dev-plan-graph-store';

const MOCK_TAG = 'MOCK_DATA_DELETE_ME';

// 旧关系类型 → mem:* 激活引擎关系类型
const RELATION_BACKFILL_MAP: Record<string, string> = {
  memory_relates: 'mem:RELATES',
  memory_supersedes: 'mem:SUPERSEDES',
  memory_conflicts: 'mem:CONFLICTS',
};

function parseArgs(): { projectName: string; dryRun: boolean } {
  const argv = process.argv.slice(2);
  let projectName = 'aifastdb-devplan';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project' && argv[i + 1]) {
      projectName = argv[++i];
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    }
  }
  return { projectName, dryRun };
}

async function main() {
  const { projectName, dryRun } = parseArgs();
  console.log(`=== Phase-252 记忆迁移 ===`);
  console.log(`项目: ${projectName}${dryRun ? '（dry-run，不落盘）' : ''}`);
  console.log('');

  // 注意 createDevPlan 签名是 (projectName, basePath?, engine?) —
  // engine 是第三个参数，第二个参数传 'graph' 会被当成 basePath 路由到
  // ./graph/ 空目录，导致读到 0 条数据。
  const store = createDevPlan(projectName, undefined, 'graph') as DevPlanGraphStore;
  const graph = (store as any).graph;

  // --------------------------------------------------------------------
  // Step 1: 清理 MOCK 记忆
  // --------------------------------------------------------------------
  const memories = store.listMemories();
  console.log(`记忆总数: ${memories.length}`);

  const mockMemories = memories.filter((m) => (m.tags || []).includes(MOCK_TAG));
  const testProbeCount = memories.filter((m) => m.recallProfile === 'test_probe').length;
  console.log(`待删除 MOCK 记忆（tag=${MOCK_TAG}）: ${mockMemories.length}`);
  console.log(`test_probe 记忆（保留，召回层硬过滤）: ${testProbeCount}`);

  let deleted = 0;
  for (const mem of mockMemories) {
    const label = (mem.content || '').slice(0, 50).replace(/\n/g, ' ');
    if (dryRun) {
      console.log(`  [dry-run] 将删除 ${mem.id}: ${label}…`);
      deleted++;
      continue;
    }
    const ok = store.deleteMemory(mem.id);
    if (ok) {
      deleted++;
      console.log(`  ✓ 删除 ${mem.id}: ${label}…`);
    } else {
      console.log(`  ✗ 删除失败 ${mem.id}: ${label}…`);
    }
  }
  console.log(`已删除: ${deleted}/${mockMemories.length}`);
  console.log('');

  // --------------------------------------------------------------------
  // Step 2: 存量关系补边 mem:*
  // --------------------------------------------------------------------
  const remaining = store.listMemories();
  let scanned = 0;
  let created = 0;
  let alreadyPresent = 0;

  for (const mem of remaining) {
    for (const [legacyType, memType] of Object.entries(RELATION_BACKFILL_MAP)) {
      let legacyRels: any[] = [];
      try {
        legacyRels = graph.outgoingByType(mem.id, legacyType) || [];
      } catch {
        continue;
      }
      if (legacyRels.length === 0) continue;

      // 已有的 mem:* 出边目标集合，避免重复补边
      let existingTargets = new Set<string>();
      try {
        const existing = graph.outgoingByType(mem.id, memType) || [];
        existingTargets = new Set(existing.map((r: any) => r.target));
      } catch { /* 视为无 */ }

      for (const rel of legacyRels) {
        scanned++;
        if (existingTargets.has(rel.target)) {
          alreadyPresent++;
          continue;
        }
        if (dryRun) {
          created++;
          continue;
        }
        try {
          graph.putRelation(mem.id, rel.target, memType, rel.weight ?? 0.7, false);
          created++;
        } catch (e) {
          console.log(`  ✗ 补边失败 ${mem.id} -[${memType}]-> ${rel.target}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  if (!dryRun) {
    graph.flush();
  }

  console.log(`=== 补边完成 ===`);
  console.log(`扫描旧边: ${scanned}`);
  console.log(`新建 mem:* 边: ${created}`);
  console.log(`已存在跳过: ${alreadyPresent}`);
  console.log('');
  console.log(dryRun
    ? 'dry-run 结束，未写入任何数据。'
    : '迁移完成。请重启 MCP server 以加载最新数据状态。');
}

main().catch((e) => {
  console.error('迁移失败:', e);
  process.exit(1);
});
