#!/usr/bin/env node
/**
 * aifastdb-devplan MCP Server
 *
 * 通用开发计划管理 MCP Server，使用 aifastdb 作为存储引擎。
 *
 * Tools (DevPlan — 通用开发计划管理):
 * - devplan_init: Initialize a dev plan for a project
 * - devplan_save_section: Save/update a document section
 * - devplan_get_section: Read a document section
 * - devplan_list_sections: List all document sections
 * - devplan_create_main_task: Create a main task (development phase)
 * - devplan_add_sub_task: Add a sub task under a main task
 * - devplan_upsert_task: Idempotent import (upsert) main/sub tasks — prevents duplicates
 * - devplan_complete_task: Complete a task (auto-updates progress, anchors Git commit)
 * - devplan_list_tasks: List tasks with optional filters
 * - devplan_get_progress: Get project progress overview
 * - devplan_export_markdown: Export plan as Markdown
 * - devplan_sync_git: Sync task statuses with Git history (revert rolled-back tasks)
 * - devplan_create_module: Create/register a feature module
 * - devplan_list_modules: List all feature modules
 * - devplan_get_module: Get module details with associated tasks and docs
 * - devplan_update_module: Update module info
 * - devplan_start_visual: Start the graph visualization HTTP server
 * - devplan_auto_status: Query autopilot execution status
 * - devplan_auto_next: Intelligently recommend the next autopilot action
 * - devplan_auto_config: Get or update autopilot configuration
 */

// @ts-ignore - MCP SDK types will be available after npm install
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
// @ts-ignore - MCP SDK types will be available after npm install
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// @ts-ignore - MCP SDK types will be available after npm install
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import {
  createDevPlan,
  type DevPlanEngine,
} from '../dev-plan-factory';
import type { IDevPlanStore } from '../dev-plan-interface';
import { TOOLS, type ToolArgs } from './tool-definitions';
import { resolveProjectName } from './tool-utils';
import { handleTaskToolCall } from './handlers/task-tools';
import { handleMemoryToolCall } from './handlers/memory-tools';
import { handleAnchorToolCall } from './handlers/anchor-tools';
import { handleSectionToolCall } from './handlers/section-tools';
import { handleModuleToolCall } from './handlers/module-tools';
import { handleAutopilotToolCall } from './handlers/autopilot-tools';
import { handleBatchToolCall } from './handlers/batch-tools';
import { handleCapabilitiesToolCall } from './handlers/capabilities-tools';
import { handleInitToolCall } from './handlers/init-tools';
import { handlePromptToolCall } from './handlers/prompt-tools';
import { handleLlmAnalyzeToolCall } from './handlers/llm-analyze-tools';

// ============================================================================
// Async Mutex — 串行化重型操作（embedding + decompose），防止并发过载崩溃
// ============================================================================

/**
 * 简易异步互斥锁。
 *
 * 当 Cursor 对同一 MCP Server 并行发送多个 tool call 时，
 * 每个 memory_save 会执行 N 次同步 NAPI embed 调用（阻塞事件循环）。
 * 5 条并行 × 5 次 embed = 25 次连续阻塞 → Cursor 心跳超时 → 连接断开。
 *
 * AsyncMutex 将并发请求串行化，并在两次操作之间通过 setImmediate
 * 让出事件循环，允许 MCP SDK 处理心跳/ping 消息，保持连接稳定。
 */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  /** 获取锁。如锁已被占用，返回的 Promise 会挂起直到前一个操作完成。 */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  /** 释放锁。如队列中有等待者，通过 setImmediate 在下一 tick 唤醒，给事件循环喘息空间。 */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // 让出事件循环，允许 MCP SDK 处理 keepalive/heartbeat
      setImmediate(next);
    } else {
      this.locked = false;
    }
  }
}

/** 全局互斥锁 — 所有 memory_save 操作共享，保证串行执行 */
const memorySaveMutex = new AsyncMutex();

// ============================================================================
// DevPlan Store Cache
// ============================================================================

const devPlanCache = new Map<string, IDevPlanStore>();

function getDevPlan(projectName: string, engine?: DevPlanEngine): IDevPlanStore {
  const cacheKey = projectName;
  if (engine) {
    // 显式指定引擎时，清除缓存以使用新引擎
    devPlanCache.delete(cacheKey);
    const plan = createDevPlan(projectName, undefined, engine);
    devPlanCache.set(cacheKey, plan);
    return plan;
  }
  if (!devPlanCache.has(cacheKey)) {
    devPlanCache.set(cacheKey, createDevPlan(projectName));
  }
  return devPlanCache.get(cacheKey)!;
}

// ============================================================================
// Tool Definitions
// ============================================================================


// ============================================================================
// Tool Handlers
// ============================================================================



async function handleToolCall(name: string, args: ToolArgs): Promise<string> {
  // 统一解析 projectName 默认值（devplan_init 例外）
  args.projectName = resolveProjectName(args, name);

  const dispatchers: Array<(name: string, args: ToolArgs) => Promise<string | null>> = [
    (n, a) => handleTaskToolCall(n, a, { getDevPlan }),
    (n, a) => handleMemoryToolCall(n, a, { getDevPlan, memorySaveMutex }),
    (n, a) => handleAnchorToolCall(n, a, { getDevPlan }),
    (n, a) => handleSectionToolCall(n, a, { getDevPlan }),
    (n, a) => handleModuleToolCall(n, a, { getDevPlan, clearDevPlanCache: (projectName: string) => devPlanCache.delete(projectName) }),
    (n, a) => handleAutopilotToolCall(n, a, { getDevPlan }),
    (n, a) => handleBatchToolCall(n, a, { getDevPlan, memorySaveMutex }),
    (n, a) => handleCapabilitiesToolCall(n, a, { getDevPlan }),
    (n, a) => handleInitToolCall(n, a, { getDevPlan, clearDevPlanCache: (projectName: string) => devPlanCache.delete(projectName) }),
    (n, a) => handlePromptToolCall(n, a, { getDevPlan }),
    (n, a) => handleLlmAnalyzeToolCall(n, a, { getDevPlan }),
  ];

  for (const dispatch of dispatchers) {
    const result = await dispatch(name, args);
    if (result !== null) return result;
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
}

// ============================================================================
// Server Setup
// ============================================================================

async function main() {
  const server = new Server(
    {
      name: 'aifastdb-devplan',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(name, args as ToolArgs);
      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('aifastdb-devplan MCP Server started');
}

// Run
main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
