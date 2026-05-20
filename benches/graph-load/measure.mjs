#!/usr/bin/env node
// @ts-check
/**
 * graph-load bench — measurement harness.
 *
 * 启动一次 dist/visualize/server.js，对 /api/graph + /api/progress 跑 N 次并行
 * 请求，测量 download + parse 总耗时，输出人类可读摘要并按需追加 results.tsv。
 *
 * 用法：
 *   node benches/graph-load/measure.mjs                       # 默认 baseline 测量
 *   node benches/graph-load/measure.mjs --label E2-gzip       # 自定义实验标签
 *   node benches/graph-load/measure.mjs --repeats 10          # 改测量轮数
 *   node benches/graph-load/measure.mjs --encoding gzip       # 在请求头加 Accept-Encoding
 *   node benches/graph-load/measure.mjs --endpoint binary     # 切到 /api/graph/binary 路径
 *   node benches/graph-load/measure.mjs --no-tsv              # 不写 results.tsv
 *
 * 默认假设：
 *   - 项目名 pythontoolbox（dev-plan-management.mdc 规则）
 *   - basePath  = D:/Project/git/aifastdb-devplan/.devplan
 *   - 端口     = 3998 （避开常用 3210/3215）
 *   - server   = dist/visualize/server.js （必须先 npm run build）
 */

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { execSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 大数据集场景下，server 处理可能 >10s。fetch 默认 keepalive 闲置超时太短，
// 第二次请求时旧 socket 已被对端 close —— ECONNRESET。bench 用 Connection: close
// 强制每次新建连接，配合长 AbortSignal 超时。
const FETCH_TIMEOUT_MS = 120_000;
function benchFetch(url, init = {}) {
  return fetch(url, {
    ...init,
    headers: { 'Connection': 'close', ...(init.headers || {}) },
    keepalive: false,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) return true;
  return next;
}
function boolFlag(name) {
  return argv.includes(name);
}

// basePath 默认不传给 server，让其通过 .devplan/config.json 注册表自行路由。
// 仅当用户显式传 --base-path 时才覆盖。这样 --project ai_db 会被 server
// 解析到 D:/Project/git/ai_db/.devplan/，无需 bench 知道路径细节。
const explicitBasePath = flag('--base-path', null);
const opts = {
  project: String(flag('--project', 'pythontoolbox')),
  basePath: explicitBasePath === null ? null : String(explicitBasePath),
  port: parseInt(String(flag('--port', '3998')), 10),
  repeats: parseInt(String(flag('--repeats', '5')), 10),
  label: String(flag('--label', 'baseline-json')),
  encoding: String(flag('--encoding', 'identity')), // identity | gzip | br | binary
  endpoint: String(flag('--endpoint', 'json')),     // json | binary
  serverBin: String(flag('--server-bin', path.join(repoRoot, 'dist', 'visualize', 'server.js'))),
  noTsv: boolFlag('--no-tsv'),
  outJson: flag('--out-json', ''),
  warmupBeforeCold: boolFlag('--warmup'),
  desc: String(flag('--desc', '')),
};

if (!existsSync(opts.serverBin)) {
  console.error(`✗ server bin 不存在: ${opts.serverBin}`);
  console.error('  请先执行: npm run build');
  process.exit(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function gitInfo() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: repoRoot }).toString().trim();
    let dirty = '';
    try {
      const status = execSync('git status --porcelain', { cwd: repoRoot }).toString().trim();
      if (status.length > 0) dirty = '+dirty';
    } catch { /* ignore */ }
    return sha + dirty;
  } catch {
    return 'unknown';
  }
}

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

async function waitForReady(port, timeoutMs = 60_000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    try {
      const r = await benchFetch(`http://127.0.0.1:${port}/api/progress`, {
        headers: { 'Accept': 'application/json' },
      });
      if (r.ok) {
        await r.arrayBuffer();
        return true;
      }
    } catch { /* not ready yet */ }
    await delay(250);
  }
  return false;
}

/**
 * 跑一次"并行 fetch graph + progress"，返回结构化指标。
 * @returns {Promise<{ totalMs: number, graphDownloadMs: number, progressDownloadMs: number, parseMs: number, payloadBytes: number, progressBytes: number, encoding: string, nodes: number, edges: number }>}
 */
async function probeOnce(port, { encoding, endpoint }) {
  const wantAccept =
    encoding === 'gzip' ? 'gzip'
    : encoding === 'br' ? 'br'
    : encoding === 'binary' ? 'identity'
    : 'identity';

  const graphUrl =
    endpoint === 'binary'
      ? `http://127.0.0.1:${port}/api/graph/binary`
      : `http://127.0.0.1:${port}/api/graph?includeNodeDegree=true&enableBackendDegreeFallback=true&includeMemories=false`;

  const progressUrl = `http://127.0.0.1:${port}/api/progress`;

  const t0 = performance.now();
  const [graphRes, progressRes] = await Promise.all([
    benchFetch(graphUrl, { headers: { 'Accept-Encoding': wantAccept } }),
    benchFetch(progressUrl, { headers: { 'Accept-Encoding': wantAccept } }),
  ]);

  // 拿 raw bytes
  const tDownloadStart = performance.now();
  const [graphBuf, progressBuf] = await Promise.all([
    graphRes.arrayBuffer(),
    progressRes.arrayBuffer(),
  ]);
  const tDownloadEnd = performance.now();

  // 解析（binary 路径下只解 progress，graph 用 DataView 简单读 header）
  const tParseStart = performance.now();
  let nodes = 0;
  let edges = 0;
  if (endpoint === 'binary') {
    // CompactGraphExport: magic(4)/version(4)/node_count(4)/edge_count(4)
    if (graphBuf.byteLength >= 16) {
      const dv = new DataView(graphBuf);
      nodes = dv.getUint32(8, true);
      edges = dv.getUint32(12, true);
    }
    // progress 仍是 JSON
    JSON.parse(new TextDecoder().decode(progressBuf));
  } else {
    const graphJson = JSON.parse(new TextDecoder().decode(graphBuf));
    JSON.parse(new TextDecoder().decode(progressBuf));
    nodes = Array.isArray(graphJson?.nodes) ? graphJson.nodes.length : 0;
    edges = Array.isArray(graphJson?.edges) ? graphJson.edges.length : 0;
  }
  const tParseEnd = performance.now();

  // 真实网络字节数：优先取 Content-Length（即压缩后字节）。fetch 在 gzip/br 下
  // 会自动解压，buffer.byteLength 反映的是解压后大小，会误导对比。
  const graphCL = parseInt(graphRes.headers.get('content-length') || '', 10);
  const graphWireBytes = Number.isFinite(graphCL) && graphCL > 0 ? graphCL : graphBuf.byteLength;
  const progressCL = parseInt(progressRes.headers.get('content-length') || '', 10);
  const progressWireBytes = Number.isFinite(progressCL) && progressCL > 0 ? progressCL : progressBuf.byteLength;

  return {
    totalMs: tParseEnd - t0,
    graphDownloadMs: tDownloadEnd - tDownloadStart,
    progressDownloadMs: tDownloadEnd - tDownloadStart, // 并行，记为同值
    parseMs: tParseEnd - tParseStart,
    payloadBytes: graphWireBytes,
    payloadBytesDecoded: graphBuf.byteLength,
    progressBytes: progressWireBytes,
    encoding: graphRes.headers.get('content-encoding') || 'identity',
    nodes,
    edges,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

const serverArgs = [
  opts.serverBin,
  '--project', opts.project,
  '--port', String(opts.port),
];
if (opts.basePath) {
  serverArgs.push('--base-path', opts.basePath);
}

console.log('┌─ graph-load bench ──────────────────────────────────────────');
console.log(`│ label    : ${opts.label}`);
console.log(`│ commit   : ${gitInfo()}`);
console.log(`│ project  : ${opts.project}`);
console.log(`│ basePath : ${opts.basePath || '(server resolves via config.json registry)'}`);
console.log(`│ port     : ${opts.port}`);
console.log(`│ endpoint : ${opts.endpoint}`);
console.log(`│ encoding : ${opts.encoding}`);
console.log(`│ repeats  : ${opts.repeats}`);
console.log(`│ server   : ${opts.serverBin}`);
console.log('└─────────────────────────────────────────────────────────────');

const serverProc = spawn(process.execPath, serverArgs, {
  cwd: repoRoot,
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverStderr = '';
serverProc.stderr.on('data', (chunk) => {
  const s = chunk.toString();
  serverStderr += s;
  if (process.env.BENCH_VERBOSE === '1') process.stderr.write(`[server] ${s}`);
});
serverProc.stdout.on('data', (chunk) => {
  if (process.env.BENCH_VERBOSE === '1') process.stdout.write(`[server] ${chunk}`);
});

const cleanup = () => {
  try { serverProc.kill('SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => { try { serverProc.kill('SIGKILL'); } catch { /* ignore */ } }, 2000).unref();
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

const ok = await waitForReady(opts.port, 60_000);
if (!ok) {
  console.error('✗ server 未在 30s 内就绪');
  console.error('---- server stderr ----');
  console.error(serverStderr);
  cleanup();
  process.exit(3);
}

// 预热：可选先打一次让缓存稳定（默认关闭，让第一轮就是真冷启动）
if (opts.warmupBeforeCold) {
  await probeOnce(opts.port, opts);
  await delay(100);
}

const samples = [];
for (let i = 0; i < opts.repeats; i++) {
  const r = await probeOnce(opts.port, opts);
  samples.push(r);
  const decoded = r.payloadBytesDecoded && r.payloadBytesDecoded !== r.payloadBytes
    ? `→${r.payloadBytesDecoded}`
    : '';
  console.log(
    `  [${String(i + 1).padStart(2)}/${opts.repeats}] total=${r.totalMs.toFixed(1)}ms `
    + `download=${r.graphDownloadMs.toFixed(1)}ms parse=${r.parseMs.toFixed(1)}ms `
    + `wire=${r.payloadBytes}${decoded} enc=${r.encoding} nodes=${r.nodes} edges=${r.edges}`,
  );
  await delay(50);
}

// 汇总：第一次是 cold，剩下做 warm 统计
const cold = samples[0];
const warm = samples.slice(1);
const warmTotals = warm.map(s => s.totalMs);
const warmParses = warm.map(s => s.parseMs);

const summary = {
  ts: new Date().toISOString(),
  commit: gitInfo(),
  label: opts.label,
  endpoint: opts.endpoint,
  encoding: cold.encoding, // 用实际生效的
  repeats: opts.repeats,
  nodes: cold.nodes,
  edges: cold.edges,
  payload_bytes: cold.payloadBytes,
  progress_bytes: cold.progressBytes,
  cold_ms: Math.round(cold.totalMs * 10) / 10,
  ready_ms_p50: Math.round(pct(warmTotals, 0.5) * 10) / 10,
  ready_ms_p95: Math.round(pct(warmTotals, 0.95) * 10) / 10,
  ready_ms_min: warmTotals.length ? Math.round(Math.min(...warmTotals) * 10) / 10 : 0,
  ready_ms_max: warmTotals.length ? Math.round(Math.max(...warmTotals) * 10) / 10 : 0,
  parse_ms_p50: Math.round(pct(warmParses, 0.5) * 10) / 10,
  status: 'pending',
  desc: opts.desc,
};

console.log('');
console.log('── summary ───────────────────────────────────────────────────');
console.log(`  nodes / edges     : ${summary.nodes} / ${summary.edges}`);
console.log(`  payload_bytes     : ${summary.payload_bytes} (encoding=${summary.encoding})`);
console.log(`  COLD_MS           : ${summary.cold_ms}`);
console.log(`  READY_MS_P50      : ${summary.ready_ms_p50}`);
console.log(`  READY_MS_P95      : ${summary.ready_ms_p95}`);
console.log(`  READY_MS_MIN/MAX  : ${summary.ready_ms_min} / ${summary.ready_ms_max}`);
console.log(`  parse_ms_p50      : ${summary.parse_ms_p50}`);
console.log('──────────────────────────────────────────────────────────────');

// 写 TSV
if (!opts.noTsv) {
  const tsvPath = path.join(__dirname, 'results.tsv');
  const header = 'ts\tcommit\tlabel\tencoding\trepeats\tnodes\tedges\tpayload_bytes\tcold_ms\tready_ms_p50\tready_ms_p95\tparse_ms_p50\tstatus\tdesc\n';
  if (!existsSync(tsvPath)) {
    await mkdir(path.dirname(tsvPath), { recursive: true });
    await writeFile(tsvPath, header, 'utf8');
  }
  const row = [
    summary.ts, summary.commit, summary.label, summary.encoding, summary.repeats,
    summary.nodes, summary.edges, summary.payload_bytes,
    summary.cold_ms, summary.ready_ms_p50, summary.ready_ms_p95, summary.parse_ms_p50,
    summary.status, summary.desc,
  ].join('\t') + '\n';
  await appendFile(tsvPath, row, 'utf8');
  console.log(`✓ appended to ${path.relative(repoRoot, tsvPath)}`);
}

if (opts.outJson && typeof opts.outJson === 'string') {
  await writeFile(opts.outJson, JSON.stringify({ summary, samples }, null, 2), 'utf8');
  console.log(`✓ wrote ${opts.outJson}`);
}

cleanup();
process.exit(0);
