/**
 * Tier 2 microbenchmark — sync (旧) vs async/applyMutations (新) 直接对比。
 *
 * 通过直接 require dist 编译产物的 DevPlanGraphStore，跑足够轮数测每条热路径的
 * NAPI 边界穿越成本，避免被 MCP RPC 序列化、Cursor RTT 噪声干扰。
 *
 * 用法: node scripts/bench-tier2.js
 */
const { createDevPlan } = require('../dist/dev-plan-factory');
const { rmSync, mkdirSync } = require('fs');
const path = require('path');
const os = require('os');

const ROUNDS = 100;
const WARMUP = 10;
const PROJECT_SYNC = 'bench-sync';
const PROJECT_ASYNC = 'bench-async';

function fmtMs(ms) {
  return ms.toFixed(2).padStart(8) + ' ms';
}

function pct(after, before) {
  if (before === 0) return 'N/A';
  const delta = ((after - before) / before) * 100;
  const sign = delta < 0 ? '' : '+';
  return `${sign}${delta.toFixed(1)}%`;
}

async function timeIt(fn) {
  const t0 = process.hrtime.bigint();
  await fn();
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6;
}

async function runRound(fn, rounds) {
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    samples.push(await timeIt(() => fn(i)));
  }
  return samples;
}

function summary(label, samples) {
  const total = samples.reduce((a, b) => a + b, 0);
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const avg = total / samples.length;
  console.log(`  ${label.padEnd(28)} total=${fmtMs(total)}  avg=${fmtMs(avg)}  p50=${fmtMs(p50)}  p95=${fmtMs(p95)}`);
  return { avg, total, p50, p95 };
}

async function main() {
  const tmpRoot = path.join(os.tmpdir(), 'aifastdb-devplan-bench-' + Date.now());
  console.log(`\nbench root: ${tmpRoot}\nrounds: ${ROUNDS}  warmup: ${WARMUP}\n`);
  mkdirSync(tmpRoot, { recursive: true });

  const planSync = createDevPlan(PROJECT_SYNC, tmpRoot, 'graph');
  const planAsync = createDevPlan(PROJECT_ASYNC, tmpRoot, 'graph');

  const caps = typeof planAsync.getNativeCapabilities === 'function'
    ? planAsync.getNativeCapabilities()
    : null;
  console.log('native capabilities:', JSON.stringify(caps, null, 2));
  console.log('saveSectionAsync available:    ', typeof planAsync.saveSectionAsync === 'function');
  console.log('createMainTaskAsync available: ', typeof planAsync.createMainTaskAsync === 'function');
  console.log('addSubTaskAsync available:     ', typeof planAsync.addSubTaskAsync === 'function');
  console.log('deleteTaskAsync available:     ', typeof planAsync.deleteTaskAsync === 'function');
  console.log('');

  planSync.createMainTask({
    projectName: PROJECT_SYNC, taskId: 'phase-host', title: 'host main', priority: 'P2',
  });
  planAsync.createMainTask({
    projectName: PROJECT_ASYNC, taskId: 'phase-host', title: 'host main', priority: 'P2',
  });

  for (let i = 0; i < WARMUP; i++) {
    planSync.saveSection({
      projectName: PROJECT_SYNC, section: 'technical_notes',
      title: 'w', content: 'w', subSection: 'warmup-sync-' + i,
    });
    await planAsync.saveSectionAsync({
      projectName: PROJECT_ASYNC, section: 'technical_notes',
      title: 'w', content: 'w', subSection: 'warmup-async-' + i,
    });
  }

  console.log('======== saveSection (含 doc entity + module + relatedTask 关系) ========');
  const sSync = await runRound((i) => {
    planSync.saveSection({
      projectName: PROJECT_SYNC, section: 'technical_notes',
      title: 'bench-' + i, content: 'body sync',
      subSection: 'sync-' + i + '-' + Date.now(),
      moduleId: 'core',
      relatedTaskIds: ['phase-host'],
    });
  }, ROUNDS);
  const sAsync = await runRound(async (i) => {
    await planAsync.saveSectionAsync({
      projectName: PROJECT_ASYNC, section: 'technical_notes',
      title: 'bench-' + i, content: 'body async',
      subSection: 'async-' + i + '-' + Date.now(),
      moduleId: 'core',
      relatedTaskIds: ['phase-host'],
    });
  }, ROUNDS);
  const ss = summary('saveSection (sync)     ', sSync);
  const sa = summary('saveSectionAsync (new) ', sAsync);
  console.log(`  delta avg: ${pct(sa.avg, ss.avg)}   p95: ${pct(sa.p95, ss.p95)}\n`);

  console.log('======== createMainTask (含 project + module 关系) ========');
  const cSync = await runRound((i) => {
    planSync.createMainTask({
      projectName: PROJECT_SYNC, taskId: 'phase-s-bench-' + i,
      title: 'bench main sync', priority: 'P2', moduleId: 'core',
    });
  }, ROUNDS);
  const cAsync = await runRound(async (i) => {
    await planAsync.createMainTaskAsync({
      projectName: PROJECT_ASYNC, taskId: 'phase-a-bench-' + i,
      title: 'bench main async', priority: 'P2', moduleId: 'core',
    });
  }, ROUNDS);
  const cs = summary('createMainTask (sync)  ', cSync);
  const ca = summary('createMainTaskAsync    ', cAsync);
  console.log(`  delta avg: ${pct(ca.avg, cs.avg)}   p95: ${pct(ca.p95, cs.p95)}\n`);

  console.log('======== addSubTask (含 HAS_SUB_TASK 关系) ========');
  const aSync = await runRound((i) => {
    planSync.addSubTask({
      projectName: PROJECT_SYNC, parentTaskId: 'phase-host',
      taskId: 'Ts-' + i, title: 'bench sub sync',
    });
  }, ROUNDS);
  const aAsync = await runRound(async (i) => {
    await planAsync.addSubTaskAsync({
      projectName: PROJECT_ASYNC, parentTaskId: 'phase-host',
      taskId: 'Ta-' + i, title: 'bench sub async',
    });
  }, ROUNDS);
  const as_ = summary('addSubTask (sync)      ', aSync);
  const aa = summary('addSubTaskAsync        ', aAsync);
  console.log(`  delta avg: ${pct(aa.avg, as_.avg)}   p95: ${pct(aa.p95, as_.p95)}\n`);

  console.log('======== deleteTask main (1 main + 5 sub = 6 个 DeleteEntity) ========');
  const prepared = [];
  for (let i = 0; i < ROUNDS; i++) {
    const idS = 'phase-del-s-' + i;
    planSync.createMainTask({
      projectName: PROJECT_SYNC, taskId: idS, title: 'to-del-' + i, priority: 'P2',
    });
    for (let k = 0; k < 5; k++) {
      planSync.addSubTask({
        projectName: PROJECT_SYNC, parentTaskId: idS,
        taskId: `Tds-${i}-${k}`, title: 'sub',
      });
    }
    prepared.push({ tag: 'sync', mainId: idS });
    const idA = 'phase-del-a-' + i;
    await planAsync.createMainTaskAsync({
      projectName: PROJECT_ASYNC, taskId: idA, title: 'to-del-' + i, priority: 'P2',
    });
    for (let k = 0; k < 5; k++) {
      await planAsync.addSubTaskAsync({
        projectName: PROJECT_ASYNC, parentTaskId: idA,
        taskId: `Tda-${i}-${k}`, title: 'sub',
      });
    }
    prepared.push({ tag: 'async', mainId: idA });
  }
  const dSync = [];
  const dAsync = [];
  for (const p of prepared) {
    if (p.tag === 'sync') {
      dSync.push(await timeIt(() => planSync.deleteTask(p.mainId, 'main')));
    } else {
      dAsync.push(await timeIt(() => planAsync.deleteTaskAsync(p.mainId, 'main')));
    }
  }
  const ds = summary('deleteTask main (sync) ', dSync);
  const da = summary('deleteTaskAsync main   ', dAsync);
  console.log(`  delta avg: ${pct(da.avg, ds.avg)}   p95: ${pct(da.p95, ds.p95)}\n`);

  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  console.log('cleanup done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
