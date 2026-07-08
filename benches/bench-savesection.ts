/**
 * Phase-251 micro-bench: saveSection 三种 docIndexing.mode 对比
 *
 * 目的：实测 'sync' / 'async' / 'async-worker' 三种模式下：
 * - saveSection 调用立即返回的耗时（用户感知）
 * - 完整 embed + HNSW 写入流水线的耗时（drainDocIndexQueue 后）
 *
 * 约定：
 * - 用同一份 perception 配置（用户当前 config.json 的 qwen3Hybrid06b）
 * - 三轮各自跑独立的临时目录，避免历史数据干扰
 * - 每轮先跑 1 次预热（触发 perception 初始化 + worker spawn 冷启动）
 * - 然后跑 N=20 次 saveSection，记录每次耗时
 *
 * 用法：
 *   npx tsx benches/bench-savesection.ts
 *   或：npx tsx benches/bench-savesection.ts --doc-size short
 *      npx tsx benches/bench-savesection.ts --doc-size long
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';

import { DevPlanGraphStore } from '../src/dev-plan-graph-store';
import type { DevPlanGraphStoreConfig } from '../src/types';

type Mode = 'sync' | 'async' | 'async-worker';

interface BenchOptions {
  N: number;
  warmupCount: number;
  contentSize: 'short' | 'medium' | 'long';
  perceptionPreset: 'qwen3Hybrid06b' | 'miniLM';
}

interface SampleStats {
  mode: Mode;
  docSize: 'short' | 'medium' | 'long';
  N: number;
  warmupMs: number;
  saveCallSamples: number[];
  totalSaveMs: number;
  drainMs: number;
  endToEndMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function fmt(n: number, digits = 2): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function makeContent(size: 'short' | 'medium' | 'long'): string {
  const para = '本文档讨论 phase-251 worker_threads 化与 indexEntityAsync 升级的验证流程，' +
    '覆盖 sync / async / async-worker 三种调度模式下的 saveSection 实测耗时分布，' +
    '并对比 graph.indexEntity 与 graph.indexEntityAsync 的主线程占用差异。';
  // 短：~1KB；中：~4KB（典型 saveSection 场景）；长：~30KB（贴近 phase-244 T244.6 端到端验证）
  const target = size === 'short' ? 1024 : size === 'medium' ? 4 * 1024 : 30 * 1024;
  let buf = '';
  while (buf.length < target) buf += para;
  return buf.slice(0, target);
}

async function runOnce(mode: Mode, opts: BenchOptions): Promise<SampleStats> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `devplan-bench-${mode}-`));
  const projectName = `bench_${mode.replace('-', '_')}`;
  const graphPath = path.join(tempRoot, projectName, 'graph-data');
  fs.mkdirSync(graphPath, { recursive: true });

  // tsx 直接跑 src/ 时 __dirname 不在 dist/，要显式指向编译产物
  const distWorkerScript = path.resolve(__dirname, '..', 'dist', 'embed-worker.js');

  const config: DevPlanGraphStoreConfig = {
    graphPath,
    enableSemanticSearch: true,
    perceptionPreset: opts.perceptionPreset,
    docIndexing: {
      mode,
      drainOnSync: true,
      worker:
        mode === 'async-worker'
          ? {
              embedTimeoutMs: 60000,
              startTimeoutMs: 120000,
              workerScript: distWorkerScript,
            }
          : undefined,
    },
  };

  const store = new DevPlanGraphStore(projectName, config);

  const content = makeContent(opts.contentSize);
  const titlePrefix = `Bench-${mode}-${opts.contentSize}`;

  // ── 预热（触发 perception 初始化 / worker spawn / 模型冷加载） ──
  const warmStart = performance.now();
  for (let i = 0; i < opts.warmupCount; i++) {
    store.saveSection({
      projectName,
      section: 'technical_notes',
      subSection: `warmup-${i}`,
      title: `${titlePrefix} warmup ${i}`,
      content,
    });
  }
  // 等所有预热都索引完，再开始正式测量
  if (typeof store.drainDocIndexQueue === 'function') {
    await store.drainDocIndexQueue();
  }
  const warmupMs = performance.now() - warmStart;

  // ── 正式测量：N 次 saveSection ──
  const saveCallSamples: number[] = [];
  const startAll = performance.now();
  for (let i = 0; i < opts.N; i++) {
    const t0 = performance.now();
    store.saveSection({
      projectName,
      section: 'technical_notes',
      subSection: `measured-${i}`,
      title: `${titlePrefix} measured ${i}`,
      content,
    });
    saveCallSamples.push(performance.now() - t0);
  }
  const totalSaveMs = performance.now() - startAll;

  // ── drain：等队列里所有 embed + HNSW 落盘 ──
  const drainStart = performance.now();
  if (typeof store.drainDocIndexQueue === 'function') {
    await store.drainDocIndexQueue();
  }
  const drainMs = performance.now() - drainStart;
  const endToEndMs = performance.now() - startAll;

  // ── 拉一下队列状态做诊断 ──
  if (typeof store.getDocIndexStatus === 'function') {
    const status = store.getDocIndexStatus();
    console.error(
      `[${mode}] queue status: enqueued=${status.queue?.enqueued ?? 'n/a'} ` +
      `processed=${status.queue?.processed ?? 'n/a'} ` +
      `failed=${status.queue?.failed ?? 'n/a'} ` +
      `lastEmbedMs=${status.queue?.lastEmbedMs ?? 'n/a'}`
    );
  }

  // 清理临时目录（worker 还在的话先 terminate）——这里最简单：让进程退出 hook 处理
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return {
    mode,
    docSize: opts.contentSize,
    N: opts.N,
    warmupMs,
    saveCallSamples,
    totalSaveMs,
    drainMs,
    endToEndMs,
  };
}

function reportRow(s: SampleStats): string {
  const sorted = [...s.saveCallSamples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1] ?? 0;
  const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
  return [
    s.mode.padEnd(14),
    s.docSize.padEnd(6),
    fmt(p50).padStart(10),
    fmt(p95).padStart(10),
    fmt(max).padStart(10),
    fmt(mean).padStart(10),
    fmt(s.totalSaveMs).padStart(12),
    fmt(s.drainMs).padStart(12),
    fmt(s.endToEndMs).padStart(12),
    fmt(s.warmupMs / 1000, 2).padStart(10),
  ].join('  ');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const docSizeArg = args.indexOf('--doc-size');
  const sizeStr = docSizeArg >= 0 ? args[docSizeArg + 1] : 'short';
  const contentSize: 'short' | 'medium' | 'long' =
    sizeStr === 'long' ? 'long' : sizeStr === 'medium' ? 'medium' : 'short';
  const N = Number(process.env.BENCH_N || '20');
  const warmupCount = Number(process.env.BENCH_WARMUP || '2');

  const opts: BenchOptions = {
    N,
    warmupCount,
    contentSize,
    perceptionPreset: 'qwen3Hybrid06b',
  };

  console.log('────────────────────────────────────────────────────────────────────────────────');
  console.log(`Phase-251 saveSection bench  |  N=${N}  warmup=${warmupCount}  docSize=${contentSize}  perception=${opts.perceptionPreset}`);
  console.log('────────────────────────────────────────────────────────────────────────────────');
  console.log('注：Ollama qwen3-embedding:0.6b 路径，纯本地推理');
  console.log('saveCall = saveSection 调用本身（用户感知）；endToEnd = N 次保存 + 队列 drain 完成');
  console.log('');
  console.log(
    [
      'mode'.padEnd(14),
      'doc'.padEnd(6),
      'p50/ms'.padStart(10),
      'p95/ms'.padStart(10),
      'max/ms'.padStart(10),
      'mean/ms'.padStart(10),
      `total${N}/ms`.padStart(12),
      'drain/ms'.padStart(12),
      'endToEnd/ms'.padStart(12),
      'warmup/s'.padStart(10),
    ].join('  '),
  );
  console.log('─'.repeat(120));

  const modes: Mode[] = ['sync', 'async', 'async-worker'];
  const results: SampleStats[] = [];
  for (const mode of modes) {
    try {
      const r = await runOnce(mode, opts);
      results.push(r);
      console.log(reportRow(r));
    } catch (e) {
      console.error(`[${mode}] FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log('');
  console.log('解读：');
  console.log('  - p50/p95/max/mean 是 saveSection **调用本身**的耗时（毫秒）');
  console.log('  - sync 模式：包含 embed + HNSW 写入；async/async-worker：只 enqueue 立即返回');
  console.log('  - drain 是 N 次保存后等队列清空（实际 embed 完成）的额外耗时');
  console.log('  - endToEnd 是端到端总耗时，三种模式应当大致相当（embed 计算总量一样）');

  // 强制退出，避免 worker 还活着挡住进程
  setTimeout(() => process.exit(0), 500).unref();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
