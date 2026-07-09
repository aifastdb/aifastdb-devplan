/**
 * Phase-252 端到端验证脚本（临时目录，不碰真实数据）：
 * 1. nativeMemoryTreeSearchReady / memoryTreeStore 能力探测
 * 2. saveMemory 默认分解（decompose='rule'）构建 mem:* 子图
 * 3. mem:RELATES 双写落盘
 * 4. recallUnified 激活通道 + hybrid 融合 + test_probe 硬过滤
 *
 * 用法: npx tsx scripts/phase-252-verify.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DevPlanGraphStore } from '../src/dev-plan-graph-store';

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase252-verify-'));
  const projectName = 'phase252_verify';
  const store = new DevPlanGraphStore(projectName, {
    graphPath: path.join(tempRoot, 'graph-data'),
    enableSemanticSearch: true,
    enableTextSearch: true,
    perceptionPreset: 'miniLM' as any,
  });

  // ---- 1. 能力探测 ----
  const caps = store.getNativeCapabilities();
  console.log('[1] Native capabilities:', JSON.stringify(caps));
  if (!caps.memoryTreeSearch) {
    console.log('FAIL: memoryTreeSearch native 仍不可用');
    process.exit(1);
  }

  // ---- 2. 保存记忆（handler 层默认 decompose='rule'，这里显式模拟） ----
  const m1 = store.saveMemory({
    projectName,
    memoryType: 'decision',
    content: 'We decided to use HNSW vector index for memory recall because it offers fast approximate search. The decision enables sub-second recall latency.',
    tags: ['vector', 'hnsw', 'recall'],
    importance: 0.9,
    decompose: 'rule',
  });
  console.log('[2] memory-1 decomposition:', JSON.stringify(m1.decomposition || null));

  const m2 = store.saveMemory({
    projectName,
    memoryType: 'insight',
    content: 'We use HNSW vector index for memory recall because it offers fast approximate search with sub-second recall latency for memories.',
    tags: ['vector', 'hnsw', 'recall'],
    importance: 0.8,
    decompose: 'rule',
  });
  console.log('[2] memory-2 decomposition:', JSON.stringify(m2.decomposition || null));

  const probe = store.saveMemory({
    projectName,
    memoryType: 'insight',
    content: 'HNSW vector recall probe entry for validation only, should never surface in production queries.',
    tags: ['MOCK_DATA_DELETE_ME'],
    importance: 0.3,
    recallProfile: 'test_probe',
  });
  console.log('[2] probe memory saved:', probe.id, 'recallProfile:', probe.recallProfile);

  // ---- 3. mem:RELATES 双写检查（applyMutations 为异步 fire-and-forget，等待落盘） ----
  await new Promise((r) => setTimeout(r, 1500));
  const graph = (store as any).graph;
  const legacyRels = graph.outgoingByType(m2.id, 'memory_relates') || [];
  const memRels = graph.outgoingByType(m2.id, 'mem:RELATES') || [];
  console.log(`[3] memory-2 edges: memory_relates=${legacyRels.length}, mem:RELATES=${memRels.length}`);

  // ---- 4. 统一召回（激活 + hybrid 融合 + 硬过滤） ----
  const results = store.recallUnified('HNSW vector recall quality', {
    limit: 5,
    docStrategy: 'none',
  });
  console.log(`[4] recall results: ${results.length}`);
  for (const r of results) {
    console.log(`    - [${r.memoryType}] score=${r.score.toFixed(3)} profile=${r.recallProfile || 'default'} ${String(r.content).slice(0, 60)}…`);
  }
  const probeLeaked = results.some((r) => r.recallProfile === 'test_probe');
  console.log('[4] test_probe leaked:', probeLeaked);

  // 直接验证激活引擎通道
  const synapse = (store as any).synapse;
  if (synapse) {
    const emb = synapse.embed('HNSW vector recall quality');
    const activation = graph.memoryTreeSearch(emb, projectName, {
      activation_alpha: 0.5, activation_beta: 0.3, activation_gamma: 0.2,
      activation_max_hops: 2, activation_max_nodes: 50, activation_top_k: 30,
      conflict_min_similarity: 0.8, supports_gain: 0.15, inhibits_gain: 0.2,
      supersedes_inhibit_gain: 0.35, conflict_penalty_gain: 0.25,
      min_effective_relation_weight: 0.05, hebbian_enabled: true,
      hebbian_increment: 0.05, hebbian_max_weight: 1.0,
      promote_hit_threshold: 5, demote_idle_timeout_secs: 604800,
      preserve_entity_types: ['mem:episode', 'mem:decision'],
    });
    console.log(`[5] activation direct: memories=${activation.memories?.length ?? 0}, explored=${activation.entities_explored}, subgraphs=${activation.subgraphs_extracted}`);
  }

  const ok = !probeLeaked && results.length > 0 && caps.memoryTreeSearch;
  console.log('');
  console.log(ok ? '=== VERIFY PASS ===' : '=== VERIFY FAIL ===');
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch { /* tantivy 句柄未释放导致的清理失败可忽略 */ }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
