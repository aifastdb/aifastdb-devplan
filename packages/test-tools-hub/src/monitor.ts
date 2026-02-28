import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import { execSync } from 'child_process';
import { URL } from 'url';
import { PhaseSnapshot, TestToolDefinition, TestToolStatus } from './types';

export interface CollectToolStatusOptions {
  getCurrentPhase?: (projectName: string) => PhaseSnapshot | undefined;
}

function getNowIso(): string {
  return new Date().toISOString();
}

function requestJson(urlString: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        method: 'GET',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          const statusCode = res.statusCode || 0;
          const text = Buffer.concat(chunks).toString('utf8');
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`HTTP ${statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(new Error(`Invalid JSON: ${(err as Error).message}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`Request timeout (${timeoutMs}ms)`)));
    req.on('error', reject);
    req.end();
  });
}

function safeRead(filePath: string): string {
  try {
    const buf = fs.readFileSync(filePath);
    if (!buf || buf.length === 0) return '';
    const hasUtf16Bom = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
    if (hasUtf16Bom) return buf.toString('utf16le');
    let nullCount = 0;
    const probe = Math.min(buf.length, 4096);
    for (let i = 0; i < probe; i += 1) {
      if (buf[i] === 0x00) nullCount += 1;
    }
    if (nullCount > probe * 0.2) return buf.toString('utf16le');
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

function readTailLines(filePath: string, maxLines = 120): string[] {
  const raw = safeRead(filePath);
  if (!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean).slice(-maxLines);
}

function getProcessSnapshot(): { cargoCount: number; rustcCount: number; benchCount: number } {
  try {
    if (os.platform() === 'win32') {
      const raw = execSync('tasklist /NH /FO CSV', { encoding: 'utf8' });
      const rows = raw
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter((x) => x && !x.includes('INFO:'));
      let cargoCount = 0;
      let rustcCount = 0;
      let benchCount = 0;
      for (const row of rows) {
        const m = row.match(/^"([^"]+)"/);
        const image = (m?.[1] || '').toLowerCase();
        if (!image) continue;
        if (image === 'cargo.exe') cargoCount += 1;
        if (image === 'rustc.exe') rustcCount += 1;
        if (image.includes('multimodal_dedup_bench')) benchCount += 1;
      }
      return { cargoCount, rustcCount, benchCount };
    }
    const psRaw = execSync('ps -A -o comm', { encoding: 'utf8' });
    const lines = psRaw.split(/\r?\n/).map((x) => x.trim().toLowerCase());
    return {
      cargoCount: lines.filter((x) => x === 'cargo').length,
      rustcCount: lines.filter((x) => x === 'rustc').length,
      benchCount: lines.filter((x) => x.includes('multimodal_dedup_bench')).length,
    };
  } catch {
    return { cargoCount: 0, rustcCount: 0, benchCount: 0 };
  }
}

function inferState(raw: any): { state: string; progress: number } {
  if (!raw || typeof raw !== 'object') return { state: 'unknown', progress: 0 };
  if (raw.bench && typeof raw.bench === 'object') {
    const state = String(raw.bench.state || 'unknown');
    const progress = Number(raw.bench.progress || 0);
    return { state, progress };
  }
  if (typeof raw.state === 'string') {
    return { state: raw.state, progress: Number(raw.progress || 0) };
  }
  return { state: 'ok', progress: 0 };
}

function inferAiDbBenchFromLog(
  lines: string[],
  proc: { cargoCount: number; rustcCount: number; benchCount: number },
  staleSeconds: number,
  staleSecondsThreshold: number,
): {
  state: string;
  progress: number;
  inserted: number;
  totalImages: number;
  metrics: Record<string, string>;
} {
  const text = lines.join('\n');
  const hasCompleted = /Phase-165 SHA256 Dedup Benchmark|SHA256 Dedup Benchmark/i.test(text);
  const hasAborted = /ABORTED by safety guard/i.test(text);
  const hasPreparing = /Preparing\s+\d+\s+image records/i.test(text);
  const hasCompiling = /Compiling\s+/i.test(text);
  const hasRunning = /Running\s+benches\\/i.test(text) || /running 0 tests/i.test(text);

  let state = 'idle';
  let progress = 0;
  if (hasAborted) {
    state = 'aborted';
    progress = 100;
  } else if (hasCompleted) {
    state = 'completed';
    progress = 100;
  } else if (hasPreparing) {
    state = 'preparing_data';
    progress = 70;
  } else if (hasCompiling || proc.rustcCount > 0) {
    state = 'compiling';
    progress = 35;
  } else if (hasRunning || proc.benchCount > 0 || proc.cargoCount > 0) {
    state = 'running';
    progress = 85;
  }

  if (state !== 'completed' && state !== 'aborted' && staleSeconds >= staleSecondsThreshold) {
    if (proc.benchCount > 0) state = 'running_no_output';
    else if (proc.cargoCount > 0 || proc.rustcCount > 0) state = 'compiling_no_output';
    else state = 'stalled';
  }

  const totalMatch = text.match(/Preparing\s+(\d+)\s+image records/i);
  const totalImages = totalMatch ? Number(totalMatch[1]) : 0;

  const insertedMatches = [...text.matchAll(/inserted\s+(\d+)\s*\/\s*(\d+)\s+records/gi)];
  let inserted = 0;
  if (insertedMatches.length) {
    const last = insertedMatches[insertedMatches.length - 1];
    inserted = Number(last[1]);
  } else {
    const legacyInserted = [...text.matchAll(/inserted\s+(\d+)\s+records\.\.\./gi)];
    inserted = legacyInserted.length ? Number(legacyInserted[legacyInserted.length - 1][1]) : 0;
  }

  if (!hasCompleted && !hasAborted && totalImages > 0 && inserted > 0) {
    const ingestPct = Math.min(99, Math.floor((inserted * 100) / totalImages));
    progress = Math.max(progress, ingestPct);
  }

  const metrics: Record<string, string> = {};
  for (const key of [
    'dataset_size',
    'payload_bytes',
    'ingest_ms',
    'backfill_ms',
    'indexed_lookup_ms',
    'legacy_scan_lookup_ms',
    'speedup_x',
  ]) {
    const m = text.match(new RegExp(`${key}:\\s*([^\\n\\r]+)`, 'i'));
    if (m) metrics[key] = m[1].trim();
  }
  return { state, progress, inserted, totalImages, metrics };
}

export async function collectToolStatus(
  tool: TestToolDefinition,
  options: CollectToolStatusOptions = {},
): Promise<TestToolStatus> {
  const phase = options.getCurrentPhase ? options.getCurrentPhase(tool.projectName) : undefined;

  if (tool.kind === 'ai_db_bench_local') {
    try {
      const logPath = String(tool.logPath || '');
      if (!logPath) throw new Error('ai_db_bench_local requires logPath');

      const proc = getProcessSnapshot();
      const lines = readTailLines(logPath, 120);
      const stat = fs.existsSync(logPath) ? fs.statSync(logPath) : null;
      const staleSeconds = stat ? Math.max(0, Math.floor((Date.now() - stat.mtimeMs) / 1000)) : 0;
      const staleSecondsThreshold = Number(tool.staleSecondsThreshold || 300);
      const inferred = inferAiDbBenchFromLog(lines, proc, staleSeconds, staleSecondsThreshold);

      return {
        tool,
        reachable: true,
        checkedAt: getNowIso(),
        state: inferred.state,
        progress: inferred.progress,
        phase,
        raw: {
          logPath,
          logExists: !!stat,
          logSizeBytes: stat ? stat.size : 0,
          logLastModified: stat ? stat.mtime.toISOString() : null,
          staleSeconds,
          process: proc,
          inserted: inferred.inserted,
          totalImages: inferred.totalImages,
          metrics: inferred.metrics,
          tail: lines,
        },
      };
    } catch (err) {
      return {
        tool,
        reachable: false,
        checkedAt: getNowIso(),
        state: 'unreachable',
        progress: 0,
        phase,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (tool.kind !== 'http_json_status') {
    return {
      tool,
      reachable: false,
      checkedAt: getNowIso(),
      state: 'unsupported_kind',
      progress: 0,
      phase,
      error: `Unsupported tool kind: ${tool.kind}`,
    };
  }

  const timeoutMs = Number(tool.timeoutMs || 3000);
  try {
    const endpoint = String(tool.endpoint || '');
    if (!endpoint) throw new Error('http_json_status requires endpoint');
    const raw = await requestJson(endpoint, timeoutMs);
    const inferred = inferState(raw as any);
    return {
      tool,
      reachable: true,
      checkedAt: getNowIso(),
      state: inferred.state,
      progress: inferred.progress,
      phase,
      raw,
    };
  } catch (err) {
    return {
      tool,
      reachable: false,
      checkedAt: getNowIso(),
      state: 'unreachable',
      progress: 0,
      phase,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
