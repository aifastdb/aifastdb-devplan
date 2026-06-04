import * as fs from 'node:fs';
import * as path from 'node:path';

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';

/**
 * Phase-435 T435.9 — Cursor hook dump consumer.
 *
 * Drains the `.cursor/.hooks-autosave/` directory produced by the
 * Cursor lifecycle hooks installed in T435.5 (preCompact / stop /
 * sessionEnd dispatchers in the `ai_db` repo) and writes one
 * "lifecycle marker" memory per consumed dump file through the
 * existing `gatewayMemorizeWithCursorProfile` path. This is the
 * intentional choice (vs. calling `plan.saveMemory` directly) so we
 * keep a single canonical write pipeline — including the kernel's
 * `attach_cursor_binding` + `normalize_hook_phase` plumbing landed in
 * T435.5 — and avoid splitting Cursor-originated memories across two
 * different code paths.
 *
 * The handler is deliberately tolerant:
 *   - Missing fields in the dump → fall back to the caller-provided
 *     `defaultConversationId` / `defaultUserId` (or skip with a
 *     structured reason if neither is available).
 *   - User / assistant content are filled with structured placeholder
 *     strings derived from the dump so the marker memory is searchable
 *     by phase / timestamp / conversation, even without verbatim
 *     conversation text (which Cursor hook payloads don't yet expose).
 *   - Successful dumps are archived to a `processed/` sibling folder
 *     so re-runs are idempotent.
 *   - Failures are appended to `errors.log` and the source dump is
 *     left in place so the next drain can retry.
 *   - `dryRun: true` performs the full scan + parse but skips writes
 *     and archival; the result still reports what *would* happen.
 */

type GetDevPlan = (projectName: string) => IDevPlanStore;

type Deps = {
  getDevPlan: GetDevPlan;
  memorySaveMutex: { acquire(): Promise<void>; release(): void };
};

const DEFAULT_HOOKS_DIR = path.join('.cursor', '.hooks-autosave');
const DEFAULT_MAX_ENTRIES = 50;
const PROCESSED_SUBDIR = 'processed';
const ERRORS_LOG_NAME = 'errors.log';
const DUMP_FILE_PATTERN = /^(\d+)-([a-z_]+)\.json$/i;

interface DumpRecord {
  phase: string;
  timestamp_ms: number;
  recorded_at: string;
  event: Record<string, unknown>;
}

interface DrainEntryResult {
  file: string;
  phase: string;
  status: 'written' | 'skipped_no_id' | 'failed' | 'invalid';
  reason?: string;
  memoryId?: string;
  archivedTo?: string;
}

interface DrainSummary {
  status: string;
  projectName: string;
  hooksDir: string;
  resolvedHooksDir: string;
  scanned: number;
  written: number;
  skippedNoId: number;
  failed: number;
  invalid: number;
  dryRun: boolean;
  archivedDir: string;
  entries: DrainEntryResult[];
}

function pickString(...vals: Array<unknown>): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) return t;
    }
  }
  return undefined;
}

function extractIdsFromEvent(
  event: Record<string, unknown>,
  defaults: { conversationId?: string; userId?: string },
): {
  conversationId?: string;
  userId?: string;
  contentSessionId?: string;
  memorySessionId?: string;
} {
  const flatConv = pickString(
    (event as any).conversationId,
    (event as any).conversation_id,
    (event as any).conversation?.id,
    (event as any).sessionId,
    (event as any).session_id,
    (event as any).session?.id,
    defaults.conversationId,
  );
  const flatUser = pickString(
    (event as any).userId,
    (event as any).user_id,
    (event as any).user?.id,
    defaults.userId,
  );
  const contentSession = pickString(
    (event as any).contentSessionId,
    (event as any).content_session_id,
    (event as any).contentSession?.id,
  );
  const memorySession = pickString(
    (event as any).memorySessionId,
    (event as any).memory_session_id,
    (event as any).memorySession?.id,
  );
  return {
    conversationId: flatConv,
    userId: flatUser,
    contentSessionId: contentSession,
    memorySessionId: memorySession,
  };
}

function buildMarkerContents(record: DumpRecord, sourceFile: string): {
  userContent: string;
  assistantContent: string;
} {
  // Keep the user-side placeholder short and stable so duplicate-dedup
  // (content prefix hashing in `saveMemory`) doesn't collapse legitimately
  // distinct lifecycle markers together — the assistant-side body carries
  // the per-event uniqueness.
  const userContent = `[cursor-lifecycle-marker:${record.phase}]`;
  const eventJson = (() => {
    try {
      return JSON.stringify(record.event, null, 2);
    } catch {
      return String(record.event);
    }
  })();
  const assistantContent = [
    `Cursor lifecycle event captured by T435.5 hook dispatcher.`,
    `phase: ${record.phase}`,
    `recorded_at: ${record.recorded_at}`,
    `timestamp_ms: ${record.timestamp_ms}`,
    `source_dump: ${path.basename(sourceFile)}`,
    `event:`,
    eventJson,
  ].join('\n');
  return { userContent, assistantContent };
}

function safeListDumpFiles(dir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => DUMP_FILE_PATTERN.test(n))
    .sort((a, b) => {
      const ma = DUMP_FILE_PATTERN.exec(a);
      const mb = DUMP_FILE_PATTERN.exec(b);
      const ta = ma ? parseInt(ma[1], 10) : 0;
      const tb = mb ? parseInt(mb[1], 10) : 0;
      return ta - tb;
    });
}

function appendError(errorsLog: string, file: string, err: unknown): void {
  try {
    const line =
      `[${new Date().toISOString()}] ${file}: ` +
      `${err && (err as any).stack ? (err as any).stack : String(err)}\n`;
    fs.appendFileSync(errorsLog, line, 'utf-8');
  } catch {
    /* best effort */
  }
}

export async function handleCursorHooksToolCall(
  name: string,
  args: ToolArgs,
  deps: Deps,
): Promise<string | null> {
  if (name !== 'devplan_cursor_hooks_drain') {
    return null;
  }

  const { getDevPlan, memorySaveMutex } = deps;
  const projectName = args.projectName!;
  const hooksDir = args.hooksDir || DEFAULT_HOOKS_DIR;
  const maxEntries = Math.max(
    1,
    typeof args.maxEntries === 'number' && Number.isFinite(args.maxEntries)
      ? Math.floor(args.maxEntries)
      : DEFAULT_MAX_ENTRIES,
  );
  const dryRun = args.dryRun === true;
  const resolvedHooksDir = path.isAbsolute(hooksDir)
    ? hooksDir
    : path.resolve(process.cwd(), hooksDir);
  const processedDir = path.join(resolvedHooksDir, PROCESSED_SUBDIR);
  const errorsLog = path.join(resolvedHooksDir, ERRORS_LOG_NAME);

  const plan = getDevPlan(projectName);
  if (typeof (plan as any).gatewayMemorizeWithCursorProfile !== 'function') {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Gateway cursor-profile memorize is unavailable in project "${projectName}". ` +
        `T435.9 drain requires the graph engine with LlmGateway bound.`,
    );
  }

  const files = safeListDumpFiles(resolvedHooksDir).slice(0, maxEntries);
  const entries: DrainEntryResult[] = [];
  let written = 0;
  let skippedNoId = 0;
  let failed = 0;
  let invalid = 0;

  for (const file of files) {
    const fullPath = path.join(resolvedHooksDir, file);
    let record: DumpRecord;
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.phase !== 'string' ||
        typeof parsed.timestamp_ms !== 'number'
      ) {
        invalid += 1;
        entries.push({
          file,
          phase: typeof parsed?.phase === 'string' ? parsed.phase : 'unknown',
          status: 'invalid',
          reason: 'dump missing required fields phase / timestamp_ms',
        });
        appendError(errorsLog, file, 'invalid dump shape');
        continue;
      }
      record = {
        phase: parsed.phase,
        timestamp_ms: parsed.timestamp_ms,
        recorded_at:
          typeof parsed.recorded_at === 'string'
            ? parsed.recorded_at
            : new Date(parsed.timestamp_ms).toISOString(),
        event:
          parsed.event && typeof parsed.event === 'object'
            ? (parsed.event as Record<string, unknown>)
            : {},
      };
    } catch (err) {
      invalid += 1;
      entries.push({
        file,
        phase: 'unknown',
        status: 'invalid',
        reason: `parse error: ${(err as Error).message}`,
      });
      appendError(errorsLog, file, err);
      continue;
    }

    const ids = extractIdsFromEvent(record.event, {
      conversationId: args.defaultConversationId || args.conversationId,
      userId: args.defaultUserId || args.userId,
    });
    if (!ids.conversationId || !ids.userId) {
      skippedNoId += 1;
      entries.push({
        file,
        phase: record.phase,
        status: 'skipped_no_id',
        reason:
          'dump does not carry conversationId/userId and neither ' +
          'defaultConversationId nor defaultUserId was provided',
      });
      continue;
    }

    if (dryRun) {
      entries.push({
        file,
        phase: record.phase,
        status: 'written',
        reason: 'dry-run: skipped actual gateway write and archival',
      });
      written += 1;
      continue;
    }

    const { userContent, assistantContent } = buildMarkerContents(record, file);

    await memorySaveMutex.acquire();
    let entryArchivedTo: string | undefined;
    let entryMemoryId: string | undefined;
    let entryFailed: unknown;
    try {
      const result: any = await (plan as any).gatewayMemorizeWithCursorProfile({
        conversationId: ids.conversationId,
        userId: ids.userId,
        userContent,
        assistantContent,
        scope: args.writeScope,
        roleId: args.roleId,
        profile: args.profile || 'cursor',
        contentSessionId: ids.contentSessionId,
        memorySessionId: ids.memorySessionId,
        hookPhase: record.phase,
        hookName: pickString(
          (record.event as any).hookName,
          (record.event as any).hook_name,
          (record.event as any).trigger,
        ),
      });

      entryMemoryId =
        (result && typeof result === 'object'
          ? (result.id || result.memoryId || result.memory?.id)
          : undefined) || undefined;

      try {
        fs.mkdirSync(processedDir, { recursive: true });
        const archivedPath = path.join(processedDir, file);
        fs.renameSync(fullPath, archivedPath);
        entryArchivedTo = path.relative(resolvedHooksDir, archivedPath);
      } catch (archiveErr) {
        // Write succeeded but archival failed: still count as written
        // (the marker memory is durable) but log so we don't silently
        // duplicate on the next drain.
        appendError(
          errorsLog,
          file,
          `archive failed after successful write: ${(archiveErr as Error).message}`,
        );
      }
      written += 1;
    } catch (err) {
      entryFailed = err;
      failed += 1;
      appendError(errorsLog, file, err);
    } finally {
      memorySaveMutex.release();
    }

    entries.push({
      file,
      phase: record.phase,
      status: entryFailed ? 'failed' : 'written',
      reason: entryFailed
        ? `gateway memorize failed: ${(entryFailed as Error).message}`
        : undefined,
      memoryId: entryMemoryId,
      archivedTo: entryArchivedTo,
    });
  }

  const summary: DrainSummary = {
    status: 'drained',
    projectName,
    hooksDir,
    resolvedHooksDir,
    scanned: files.length,
    written,
    skippedNoId,
    failed,
    invalid,
    dryRun,
    archivedDir: path.relative(resolvedHooksDir, processedDir) || PROCESSED_SUBDIR,
    entries,
  };
  return JSON.stringify(summary, null, 2);
}
