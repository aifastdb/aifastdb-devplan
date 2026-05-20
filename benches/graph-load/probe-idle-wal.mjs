#!/usr/bin/env node
// @ts-check
/**
 * Probe 2: 在 server 启动后完全不发请求，静置一段时间，看 WAL 是否还在增长。
 *
 *  - 如果 WAL 仍在长 → 后台线程在写（例如 metric flusher、checkpoint）。
 *    缓存失效不能用 mtime，需改用别的 key（如显式版本号/写计数）。
 *  - 如果 WAL 不动 → 之前 probe 看到的增长一定是 read 路径触发的。
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const project = process.argv[2] || 'ai_db';
const port = 4002;
const serverBin = path.join(repoRoot, 'dist', 'visualize', 'server.js');
const walDir = project === 'ai_db'
  ? 'D:/Project/git/ai_db/.devplan/ai_db/graph-data/wal'
  : path.join(repoRoot, '.devplan', project, 'graph-data', 'wal');

function snapshotWal() {
  const out = {};
  try {
    for (const shard of readdirSync(walDir, { withFileTypes: true })) {
      if (!shard.isDirectory()) continue;
      const sp = path.join(walDir, shard.name);
      try {
        for (const f of readdirSync(sp, { withFileTypes: true })) {
          if (!f.isFile()) continue;
          try {
            const st = statSync(path.join(sp, f.name));
            out[`${shard.name}/${f.name}`] = { mtimeMs: st.mtimeMs, size: st.size };
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return out;
}

function diff(a, b, label) {
  console.log(`\n── ${label} ──`);
  let changed = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k]; const bv = b[k];
    if (!av) { console.log(`  + ${k} size=${bv.size}`); changed++; continue; }
    if (!bv) { console.log(`  - ${k}`); changed++; continue; }
    if (av.mtimeMs !== bv.mtimeMs || av.size !== bv.size) {
      console.log(`    ${k}: mtime+${(bv.mtimeMs - av.mtimeMs).toFixed(0)}ms size+${bv.size - av.size}`);
      changed++;
    }
  }
  if (changed === 0) console.log('  no changes ✓');
  return changed;
}

console.log(`probe-idle: walDir=${walDir}`);
const sp = spawn(process.execPath, [
  serverBin, '--project', project, '--port', String(port),
], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
sp.stderr.on('data', d => { stderr += d; });
process.on('exit', () => { try { sp.kill('SIGKILL'); } catch {} });

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
  console.error('not ready');
  console.error(stderr);
  process.exit(2);
}
await waitReady();
console.log('server ready. waiting 2s for startup WAL settle…');
await delay(2000);

const T0 = snapshotWal();
console.log('T0 captured. now SILENT for 12s (no requests at all)…');
await delay(12_000);
const T1 = snapshotWal();

diff(T0, T1, 'IDLE 12s (no requests)');

console.log('\n── verdict ──');
const idleEffects = diff(T0, T1, '(silent recount)');
if (idleEffects > 0) {
  console.log('  ⚠ WAL grows while idle → background flusher is writing.');
  console.log('    mtime-based cache invalidation is fundamentally broken under default config.');
  console.log('    Fix options:');
  console.log('      a) cache key = entity_count + relation_count (cheap counter not WAL touched)');
  console.log('      b) disable WAL background ticker on a read-mostly visualize server');
  console.log('      c) ai_db config flag to suppress idle WAL writes');
} else {
  console.log('  ✓ WAL stable while idle → growth in probe-side-effects is caused by READ requests.');
  console.log('    Fix is in read paths themselves (likely list_persons / get_entity / get_progress).');
}

try { sp.kill('SIGKILL'); } catch {}
process.exit(0);
