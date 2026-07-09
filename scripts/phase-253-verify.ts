/**
 * Phase-253 端到端验证脚本（临时目录，不碰真实数据）：
 * 1. anchor_entity_type_filter 生效 — 锚点只从 devplan-memory 实体中选取
 * 2. extra_relation_types 生效 — 激活引擎沿 memory_relates / memory_has_episode
 *    等自有关系扩展子图
 * 3. recallUnified depth='L2' 返回 mem:* 分解子实体（sourceKind='decomposed'）
 *
 * 依赖 ai_db Phase-467 二进制（MemoryTreeConfig 新增两个 serde(default) 字段）。
 *
 * 用法: npx tsx scripts/phase-253-verify.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DevPlanGraphStore } from '../src/dev-plan-graph-store';
import { buildActivationConfig } from '../src/dev-plan-graph-store.recall';

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase253-verify-'));
  const projectName = 'phase253_verify';
  const store = new DevPlanGraphStore(projectName, {
    graphPath: path.join(tempRoot, 'graph-data'),
    enableSemanticSearch: true,
    enableTextSearch: true,
    perceptionPreset: 'miniLM' as any,
  });

  const caps = store.getNativeCapabilities();
  console.log('[0] Native capabilities:', JSON.stringify(caps));
  if (!caps.memoryTreeSearch) {
    console.log('FAIL: memoryTreeSearch native 不可用');
    process.exit(1);
  }

  // ---- 准备数据：两条会分解的记忆 + 一条纯关联记忆 ----
  const m1 = store.saveMemory({
    projectName,
    memoryType: 'decision',
    content: 'We chose HNSW vector index for recall. The index gives sub-second latency. Graph edges boost related memories.',
    tags: ['vector', 'hnsw'],
    importance: 0.9,
    decompose: 'rule',
  });
  const m2 = store.saveMemory({
    projectName,
    memoryType: 'insight',
    content: 'HNSW vector recall works best with m=32 for dense clusters. Recall quality improved after tuning.',
    tags: ['vector', 'hnsw'],
    importance: 0.8,
    decompose: 'rule',
  });
  console.log('[1] saved:', m1.id, m1.decomposition?.entitiesStored, '|', m2.id, m2.decomposition?.entitiesStored);

  // applyMutations 异步落盘，等待
  await new Promise((r) => setTimeout(r, 1500));

  const graph = (store as any).graph;
  const synapse = (store as any).synapse;
  const emb = synapse.embed('HNSW vector recall latency');

  // ---- 2. 锚点过滤验证：带 filter 时 anchor 全部是 devplan-memory ----
  const cfg = buildActivationConfig(10);
  console.log('[2] config anchor filter:', cfg.anchor_entity_type_filter, 'extra rels:', JSON.stringify(cfg.extra_relation_types));

  const filtered = graph.memoryTreeSearch(emb, projectName, cfg);
  const anchorTypes = new Set<string>();
  for (const aid of filtered.anchor_ids || []) {
    const e = graph.getEntity(aid);
    if (e) anchorTypes.add(e.entity_type);
  }
  console.log(`[2] filtered anchors: ${(filtered.anchor_ids || []).length}, types: ${[...anchorTypes].join(', ')}`);
  const anchorFilterOk = (filtered.anchor_ids || []).length > 0
    && [...anchorTypes].every((t) => t === 'devplan-memory');

  // 对照组：无 filter 时锚点包含 mem:* 子实体（证明过滤确实起作用）
  const unfiltered = graph.memoryTreeSearch(emb, projectName, {
    ...cfg,
    anchor_entity_type_filter: null,
  });
  const unfilteredTypes = new Set<string>();
  for (const aid of unfiltered.anchor_ids || []) {
    const e = graph.getEntity(aid);
    if (e) unfilteredTypes.add(e.entity_type);
  }
  console.log(`[2] unfiltered anchors: ${(unfiltered.anchor_ids || []).length}, types: ${[...unfilteredTypes].join(', ')}`);

  // ---- 3. extra_relation_types 验证：激活结果沿 memory_has_episode 走到 mem:* 子图 ----
  const activatedTypes = new Set<string>();
  for (const mem of filtered.memories || []) {
    activatedTypes.add(mem.entity_type);
  }
  console.log(`[3] activated entity types: ${[...activatedTypes].join(', ')}`);
  // 锚点是 devplan-memory，能出现 mem:* 类型只能靠 memory_has_episode（extra）+ mem:CONTAINS 两跳
  const extraRelOk = [...activatedTypes].some((t) => t.startsWith('mem:'));

  // ---- 4. recallUnified L2 返回分解子实体 ----
  const results = store.recallUnified('HNSW vector recall latency', {
    limit: 5,
    docStrategy: 'none',
    depth: 'L2',
  });
  const decomposed = results.filter((r: any) => r.sourceKind === 'decomposed');
  console.log(`[4] recall results: ${results.length}, decomposed: ${decomposed.length}`);
  for (const r of results) {
    console.log(`    - [${(r as any).sourceKind}${(r as any).decomposedEntityType ? '/' + (r as any).decomposedEntityType : ''}] score=${r.score.toFixed(3)} ${String(r.content).slice(0, 55)}…`);
  }

  // L1 不应返回子实体
  const l1Results = store.recallUnified('HNSW vector recall latency', {
    limit: 5,
    docStrategy: 'none',
    depth: 'L1',
  });
  const l1Decomposed = l1Results.filter((r: any) => r.sourceKind === 'decomposed');
  console.log(`[4] L1 decomposed (expect 0): ${l1Decomposed.length}`);

  const ok = anchorFilterOk && extraRelOk && decomposed.length > 0 && l1Decomposed.length === 0;
  console.log('');
  console.log(`anchor filter: ${anchorFilterOk ? 'PASS' : 'FAIL'}`);
  console.log(`extra relation types: ${extraRelOk ? 'PASS' : 'FAIL'}`);
  console.log(`L2 decomposed returned: ${decomposed.length > 0 ? 'PASS' : 'FAIL'}`);
  console.log(`L1 decomposed suppressed: ${l1Decomposed.length === 0 ? 'PASS' : 'FAIL'}`);
  console.log(ok ? '=== VERIFY PASS ===' : '=== VERIFY FAIL ===');
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch { /* tantivy 句柄未释放导致的清理失败可忽略 */ }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
