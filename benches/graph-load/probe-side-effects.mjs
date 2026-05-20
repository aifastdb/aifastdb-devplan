#!/usr/bin/env node
// @ts-check
/**
 * Probe: does /api/graph (i.e. exportGraph) mutate WAL .gwal file mtimes?
 *
 * 我们怀疑 store.exportGraph() 这条"读"路径在 aifastdb NAPI 层有副作用
 * （触摸 WAL / index 文件），导致 Phase-4 的 mtime-based cache invalidation
 * 永远失效。本脚本独立验证这一假设。
 *
 * 流程：
 *   1. 启动 dist/visualize/server.js（aifastdb-devplan 的 visualize server）
 *   2. snapshot 所有 .gwal 文件 mtime（A）
 *   3. 调一次 /api/progress（不触发 exportGraph）→ snapshot mtime（B）
 *   4. 调一次 /api/graph → snapshot mtime（C）
 *   5. 再调一次 /api/graph → snapshot mtime（D）
 *   6. 报告：B vs A、C vs A、D vs C 是否相同
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const project = process.argv[2] || 'ai_db';
const port = 4001;
const serverBin = path.join(repoRoot, 'dist', 'visualize', 'server.js');
const dataRootGuess = project === 'ai_db'
  ? 'D:/Project/git/ai_db/.devplan/ai_db/graph-data/wal'
  : path.join(repoRoot, '.devplan', project, 'graph-data', 'wal');

function snapshotWal(walDir) {
  const out = {};
  try {
    for (const shard of readdirSync(walDir, { withFileTypes: true })) {
      if (!shard.isDirectory()) continue;
      const shardPath = path.join(walDir, shard.name);
      try {
        for (const f of readdirSync(shardPath, { withFileTypes: true })) {
          if (!f.isFile()) continue;
          const p = path.join(shardPath, f.name);
          try {
            const st = statSync(p);
            out[`${shard.name}/${f.name}`] = {
              mtimeMs: st.mtimeMs,
              size: st.size,
            };
          } catch { /* gone */ }
        }
      } catch { /* shard gone */ }
    }
  } catch (e) {
    console.error('snapshot failed:', e.message);
  }
  return out;
}

function diffSnapshots(a, b, label) {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes = [];
  for (const k of allKeys) {
    const av = a[k];
    const bv = b[k];
    if (!av) { changes.push(`+ ${k} (new, size=${bv.size})`); continue; }
    if (!bv) { changes.push(`- ${k} (gone)`); continue; }
    const mtimeDelta = bv.mtimeMs - av.mtimeMs;
    const sizeDelta = bv.size - av.size;
    if (mtimeDelta !== 0 || sizeDelta !== 0) {
      changes.push(`  ${k}: mtime+${mtimeDelta.toFixed(0)}ms size+${sizeDelta}`);
    }
  }
  console.log(`\n── ${label} ──`);
  if (changes.length === 0) {
    console.log('  no changes ✓');
  } else {
    for (const c of changes) console.log(c);
  }
  return changes.length;
}

console.log(`probe: project=${project}, walDir=${dataRootGuess}`);

const serverProc = spawn(process.execPath, [
  serverBin, '--project', project, '--port', String(port),
], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
serverProc.stderr.on('data', d => { stderr += d; });

const cleanup = () => { try { serverProc.kill('SIGKILL'); } catch {} };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// 等 server 就绪
async function waitReady() {
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/progress`, {
        headers: { 'Connection': 'close' },
        signal: AbortSignal.timeout(120_000),
      });
      if (r.ok) { await r.arrayBuffer(); return; }
    } catch {}
    await delay(250);
  }
  console.error('server not ready');
  console.error(stderr);
  process.exit(2);
}
await waitReady();
console.log('server ready, beginning probe…');

// 给 server 处理完启动期 WAL flush 的余响（如果有）
await delay(2000);

const A = snapshotWal(dataRootGuess);
console.log(`\nA (before any request): ${Object.keys(A).length} files`);

// 1) /api/progress — 不应该触发 exportGraph
await fetch(`http://127.0.0.1:${port}/api/progress`, {
  headers: { 'Connection': 'close' },
  signal: AbortSignal.timeout(120_000),
}).then(r => r.arrayBuffer());
const B = snapshotWal(dataRootGuess);

// 2) /api/graph — 第一次，触发 exportGraph
console.log('\ncalling /api/graph (1st)…');
const t1 = Date.now();
await fetch(`http://127.0.0.1:${port}/api/graph?includeNodeDegree=true&enableBackendDegreeFallback=true&includeMemories=false`, {
  headers: { 'Connection': 'close' },
  signal: AbortSignal.timeout(120_000),
}).then(r => r.arrayBuffer());
console.log(`  done in ${Date.now() - t1}ms`);
// 给 fs 一点时间让 mtime 更新可见
await delay(500);
const C = snapshotWal(dataRootGuess);

// 3) /api/graph — 第二次，如果是纯读 mtime 不应再变；如果有副作用又会变
console.log('\ncalling /api/graph (2nd)…');
const t2 = Date.now();
await fetch(`http://127.0.0.1:${port}/api/graph?includeNodeDegree=true&enableBackendDegreeFallback=true&includeMemories=false`, {
  headers: { 'Connection': 'close' },
  signal: AbortSignal.timeout(120_000),
}).then(r => r.arrayBuffer());
console.log(`  done in ${Date.now() - t2}ms`);
await delay(500);
const D = snapshotWal(dataRootGuess);

diffSnapshots(A, B, '/api/progress side-effects (A → B)');
diffSnapshots(A, C, '/api/graph 1st call side-effects (A → C)');
diffSnapshots(C, D, '/api/graph 2nd call side-effects (C → D)');

console.log('\n────────────────────────────────────────');
console.log('CONCLUSION:');
const progEffects = diffSnapshots(A, B, '(silent recount)');
const graph1Effects = diffSnapshots(A, C, '(silent recount)');
const graph2Effects = diffSnapshots(C, D, '(silent recount)');
if (graph1Effects > 0 || graph2Effects > 0) {
  console.log('  ❌ /api/graph (i.e. exportGraph) DOES mutate WAL files.');
  console.log('     → mtime-based cache invalidation cannot work.');
  console.log('     → Need fix in aifastdb NAPI layer (ai_db) or a different invalidation key.');
} else {
  console.log('  ✓ /api/graph does NOT touch WAL files. Bug is elsewhere.');
}

cleanup();
process.exit(0);
