import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test, jest } from '@jest/globals';

import { handleCursorHooksToolCall } from '../src/mcp-server/handlers/cursor-hooks-tools';

/**
 * Phase-435 T435.9 — Unit tests for the `devplan_cursor_hooks_drain` handler.
 *
 * These tests run entirely against the filesystem with an in-memory `plan`
 * mock; we do not boot the MCP server, do not require ai_db's NAPI, and do
 * not touch any real `.devplan/` data store. The handler's contract is:
 *
 *   1. scan dump files matching `<unix_ms>-<phase>.json`,
 *   2. extract conversationId/userId (event payload first, defaults next),
 *   3. call `plan.gatewayMemorizeWithCursorProfile` ONCE per dump,
 *   4. archive successful dumps to `processed/`, leave failures in place,
 *   5. record summary counts + per-entry status.
 */

interface MutexLike {
  acquire(): Promise<void>;
  release(): void;
  callOrder: string[];
}

function makeMutex(): MutexLike {
  return {
    callOrder: [],
    async acquire() {
      this.callOrder.push('acquire');
    },
    release() {
      this.callOrder.push('release');
    },
  };
}

function writeDump(dir: string, payload: unknown, fileName: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(payload, null, 2), 'utf-8');
}

describe('handleCursorHooksToolCall — devplan_cursor_hooks_drain', () => {
  const tempDirs: string[] = [];
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test('writes one marker memory per dump and archives the source file', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-cursor-hooks-'));
    tempDirs.push(workspace);
    process.chdir(workspace);

    const hooksDir = path.join(workspace, '.cursor', '.hooks-autosave');
    writeDump(hooksDir, {
      phase: 'precompact',
      timestamp_ms: 1000,
      recorded_at: '2026-06-04T00:00:01.000Z',
      event: {
        conversationId: 'conv-1',
        userId: 'user-1',
        contentSessionId: 'cs-1',
        memorySessionId: 'ms-1',
        trigger: 'preCompact',
      },
    }, '1000-precompact.json');

    const gateway = jest.fn(async () => ({ id: 'mem-precompact-1' }));
    const plan = { gatewayMemorizeWithCursorProfile: gateway } as any;
    const getDevPlan = jest.fn(() => plan);
    const memorySaveMutex = makeMutex();

    const out = await handleCursorHooksToolCall(
      'devplan_cursor_hooks_drain',
      { projectName: 'demo' } as any,
      { getDevPlan, memorySaveMutex },
    );
    expect(out).not.toBeNull();
    const summary = JSON.parse(out as string);

    expect(summary.status).toBe('drained');
    expect(summary.projectName).toBe('demo');
    expect(summary.scanned).toBe(1);
    expect(summary.written).toBe(1);
    expect(summary.skippedNoId).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.invalid).toBe(0);
    expect(summary.dryRun).toBe(false);
    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0]).toMatchObject({
      file: '1000-precompact.json',
      phase: 'precompact',
      status: 'written',
      memoryId: 'mem-precompact-1',
    });

    expect(gateway).toHaveBeenCalledTimes(1);
    const callArg = (gateway.mock.calls[0] as any[])[0];
    expect(callArg.conversationId).toBe('conv-1');
    expect(callArg.userId).toBe('user-1');
    expect(callArg.contentSessionId).toBe('cs-1');
    expect(callArg.memorySessionId).toBe('ms-1');
    expect(callArg.hookPhase).toBe('precompact');
    expect(callArg.hookName).toBe('preCompact');
    expect(callArg.profile).toBe('cursor');
    expect(typeof callArg.userContent).toBe('string');
    expect(callArg.userContent).toContain('cursor-lifecycle-marker:precompact');
    expect(callArg.assistantContent).toContain('phase: precompact');
    expect(callArg.assistantContent).toContain('source_dump: 1000-precompact.json');

    // Archival
    expect(fs.existsSync(path.join(hooksDir, '1000-precompact.json'))).toBe(false);
    expect(fs.existsSync(path.join(hooksDir, 'processed', '1000-precompact.json'))).toBe(true);

    // Mutex was acquired/released in pairs
    expect(memorySaveMutex.callOrder).toEqual(['acquire', 'release']);
  });

  test('falls back to defaultConversationId / defaultUserId when dump lacks both', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-cursor-hooks-fallback-'));
    tempDirs.push(workspace);
    process.chdir(workspace);

    const hooksDir = path.join(workspace, '.cursor', '.hooks-autosave');
    writeDump(hooksDir, {
      phase: 'stop',
      timestamp_ms: 2000,
      recorded_at: '2026-06-04T00:00:02.000Z',
      event: { trigger: 'stop' },
    }, '2000-stop.json');

    const gateway = jest.fn(async () => ({ id: 'mem-stop-1' }));
    const plan = { gatewayMemorizeWithCursorProfile: gateway } as any;
    const memorySaveMutex = makeMutex();

    const out = await handleCursorHooksToolCall(
      'devplan_cursor_hooks_drain',
      {
        projectName: 'demo',
        defaultConversationId: 'fallback-conv',
        defaultUserId: 'fallback-user',
      } as any,
      { getDevPlan: () => plan, memorySaveMutex },
    );
    const summary = JSON.parse(out as string);
    expect(summary.written).toBe(1);
    expect(summary.skippedNoId).toBe(0);

    const callArg = (gateway.mock.calls[0] as any[])[0];
    expect(callArg.conversationId).toBe('fallback-conv');
    expect(callArg.userId).toBe('fallback-user');
    expect(callArg.hookPhase).toBe('stop');
  });

  test('skips dumps with no IDs available and leaves them on disk', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-cursor-hooks-noid-'));
    tempDirs.push(workspace);
    process.chdir(workspace);

    const hooksDir = path.join(workspace, '.cursor', '.hooks-autosave');
    writeDump(hooksDir, {
      phase: 'session_end',
      timestamp_ms: 3000,
      recorded_at: '2026-06-04T00:00:03.000Z',
      event: {},
    }, '3000-session_end.json');

    const gateway = jest.fn();
    const plan = { gatewayMemorizeWithCursorProfile: gateway } as any;

    const out = await handleCursorHooksToolCall(
      'devplan_cursor_hooks_drain',
      { projectName: 'demo' } as any,
      { getDevPlan: () => plan, memorySaveMutex: makeMutex() },
    );
    const summary = JSON.parse(out as string);
    expect(summary.scanned).toBe(1);
    expect(summary.written).toBe(0);
    expect(summary.skippedNoId).toBe(1);
    expect(summary.entries[0].status).toBe('skipped_no_id');
    expect(summary.entries[0].reason).toContain('defaultConversationId');

    expect(gateway).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(hooksDir, '3000-session_end.json'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'processed'))).toBe(false);
  });

  test('dryRun previews without calling gateway or archiving', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-cursor-hooks-dryrun-'));
    tempDirs.push(workspace);
    process.chdir(workspace);

    const hooksDir = path.join(workspace, '.cursor', '.hooks-autosave');
    writeDump(hooksDir, {
      phase: 'precompact',
      timestamp_ms: 4000,
      recorded_at: '2026-06-04T00:00:04.000Z',
      event: { conversationId: 'conv-dry', userId: 'user-dry' },
    }, '4000-precompact.json');

    const gateway = jest.fn();
    const plan = { gatewayMemorizeWithCursorProfile: gateway } as any;

    const out = await handleCursorHooksToolCall(
      'devplan_cursor_hooks_drain',
      { projectName: 'demo', dryRun: true } as any,
      { getDevPlan: () => plan, memorySaveMutex: makeMutex() },
    );
    const summary = JSON.parse(out as string);
    expect(summary.dryRun).toBe(true);
    expect(summary.written).toBe(1);
    expect(summary.entries[0].status).toBe('written');
    expect(summary.entries[0].reason).toContain('dry-run');

    expect(gateway).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(hooksDir, '4000-precompact.json'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'processed'))).toBe(false);
  });

  test('marks invalid dumps as invalid and writes an entry into errors.log', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-cursor-hooks-invalid-'));
    tempDirs.push(workspace);
    process.chdir(workspace);

    const hooksDir = path.join(workspace, '.cursor', '.hooks-autosave');
    fs.mkdirSync(hooksDir, { recursive: true });
    // Corrupt JSON
    fs.writeFileSync(path.join(hooksDir, '5000-precompact.json'), '{ not a valid json', 'utf-8');
    // Missing required fields
    fs.writeFileSync(
      path.join(hooksDir, '5001-stop.json'),
      JSON.stringify({ foo: 'bar' }, null, 2),
      'utf-8',
    );

    const gateway = jest.fn();
    const plan = { gatewayMemorizeWithCursorProfile: gateway } as any;

    const out = await handleCursorHooksToolCall(
      'devplan_cursor_hooks_drain',
      { projectName: 'demo' } as any,
      { getDevPlan: () => plan, memorySaveMutex: makeMutex() },
    );
    const summary = JSON.parse(out as string);
    expect(summary.scanned).toBe(2);
    expect(summary.invalid).toBe(2);
    expect(summary.written).toBe(0);

    const errorsLog = path.join(hooksDir, 'errors.log');
    expect(fs.existsSync(errorsLog)).toBe(true);
    const errBody = fs.readFileSync(errorsLog, 'utf-8');
    expect(errBody).toContain('5000-precompact.json');
    expect(errBody).toContain('5001-stop.json');

    expect(gateway).not.toHaveBeenCalled();
  });

  test('keeps failed dumps in place and writes an entry into errors.log on gateway failure', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-cursor-hooks-fail-'));
    tempDirs.push(workspace);
    process.chdir(workspace);

    const hooksDir = path.join(workspace, '.cursor', '.hooks-autosave');
    writeDump(hooksDir, {
      phase: 'precompact',
      timestamp_ms: 6000,
      recorded_at: '2026-06-04T00:00:06.000Z',
      event: { conversationId: 'conv-fail', userId: 'user-fail' },
    }, '6000-precompact.json');

    const gateway = jest.fn(async () => {
      throw new Error('gateway is sad');
    });
    const plan = { gatewayMemorizeWithCursorProfile: gateway } as any;

    const out = await handleCursorHooksToolCall(
      'devplan_cursor_hooks_drain',
      { projectName: 'demo' } as any,
      { getDevPlan: () => plan, memorySaveMutex: makeMutex() },
    );
    const summary = JSON.parse(out as string);
    expect(summary.failed).toBe(1);
    expect(summary.written).toBe(0);
    expect(summary.entries[0].status).toBe('failed');
    expect(summary.entries[0].reason).toContain('gateway is sad');

    expect(fs.existsSync(path.join(hooksDir, '6000-precompact.json'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'processed'))).toBe(false);
    expect(fs.existsSync(path.join(hooksDir, 'errors.log'))).toBe(true);
    const errBody = fs.readFileSync(path.join(hooksDir, 'errors.log'), 'utf-8');
    expect(errBody).toContain('gateway is sad');
  });

  test('respects maxEntries and drains oldest-first', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devplan-cursor-hooks-max-'));
    tempDirs.push(workspace);
    process.chdir(workspace);

    const hooksDir = path.join(workspace, '.cursor', '.hooks-autosave');
    // Intentionally write out of order
    writeDump(hooksDir, {
      phase: 'precompact', timestamp_ms: 9000, recorded_at: '2026-06-04T00:00:09.000Z',
      event: { conversationId: 'c1', userId: 'u1' },
    }, '9000-precompact.json');
    writeDump(hooksDir, {
      phase: 'stop', timestamp_ms: 7000, recorded_at: '2026-06-04T00:00:07.000Z',
      event: { conversationId: 'c2', userId: 'u2' },
    }, '7000-stop.json');
    writeDump(hooksDir, {
      phase: 'session_end', timestamp_ms: 8000, recorded_at: '2026-06-04T00:00:08.000Z',
      event: { conversationId: 'c3', userId: 'u3' },
    }, '8000-session_end.json');

    const gateway = jest.fn(async () => ({ id: 'mem-x' }));
    const plan = { gatewayMemorizeWithCursorProfile: gateway } as any;

    const out = await handleCursorHooksToolCall(
      'devplan_cursor_hooks_drain',
      { projectName: 'demo', maxEntries: 2 } as any,
      { getDevPlan: () => plan, memorySaveMutex: makeMutex() },
    );
    const summary = JSON.parse(out as string);
    expect(summary.scanned).toBe(2);
    expect(summary.written).toBe(2);
    expect(summary.entries.map((e: any) => e.file)).toEqual([
      '7000-stop.json',
      '8000-session_end.json',
    ]);
    expect(fs.existsSync(path.join(hooksDir, '9000-precompact.json'))).toBe(true);
  });

  test('returns null for non-target tool names', async () => {
    const out = await handleCursorHooksToolCall(
      'devplan_memory_save',
      { projectName: 'demo' } as any,
      { getDevPlan: jest.fn(() => ({} as any)), memorySaveMutex: makeMutex() },
    );
    expect(out).toBeNull();
  });
});
