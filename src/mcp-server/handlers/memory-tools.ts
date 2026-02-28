import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';

type GetDevPlan = (projectName: string) => IDevPlanStore;

export async function handleMemoryToolCall(name: string, args: ToolArgs, deps: { getDevPlan: GetDevPlan; memorySaveMutex: { acquire(): Promise<void>; release(): void } }): Promise<string | null> {
  const { getDevPlan, memorySaveMutex } = deps;

  switch (name) {
    case 'devplan_memory_save': {
      // ======================================================================
      // 并发控制：通过 AsyncMutex 串行化 memory_save 操作
      //
      // 每次 saveMemory 会执行多次同步 NAPI embed 调用（各 ~200-500ms）。
      // 5 条并行请求会导致 10-25 秒连续事件循环阻塞 → Cursor 断连。
      // 互斥锁保证同一时刻只有 1 条 save 在执行，两条之间让出事件循环。
      // ======================================================================
      await memorySaveMutex.acquire();
      try {
        const projectName = args.projectName!;
        const content = args.content;
        const memoryType = args.memoryType;

        if (!content) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing required: content');
        }
        if (!memoryType) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing required: memoryType');
        }

        const validTypes = ['decision', 'pattern', 'bugfix', 'insight', 'preference', 'summary'];
        if (!validTypes.includes(memoryType)) {
          throw new McpError(ErrorCode.InvalidParams,
            `Invalid memoryType: "${memoryType}". Must be one of: ${validTypes.join(', ')}`);
        }

        const plan = getDevPlan(projectName);
        if (typeof (plan as any).saveMemory !== 'function') {
          throw new McpError(ErrorCode.InvalidRequest,
            `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
        }

        // Phase-47: 解析 decompose 参数
        let decompose: boolean | 'rule' | 'llm' | undefined;
        const decomposeArg = args.decompose as string | undefined;
        if (decomposeArg === 'true' || decomposeArg === 'rule') {
          decompose = 'rule';
        } else if (decomposeArg === 'llm') {
          decompose = 'llm';
        }

        const memory = (plan as any).saveMemory({
          projectName,
          content,
          memoryType: memoryType as any,
          importance: args.importance,
          tags: args.tags,
          relatedTaskId: args.relatedTaskId,
          sourceRef: args.sourceRef,
          provenance: args.provenance,
          moduleId: args.moduleId,
          source: args.source || 'cursor',
          decompose,
          llmDecompositionJson: args.llmDecompositionJson,
          decomposeContext: args.decomposeContext,
          // Phase-58: 三层差异化内容
          contentL1: args.contentL1,
          contentL2: args.contentL2,
          contentL3: args.contentL3,
          // Phase-57: 三维记忆参数
          anchorName: args.anchorName,
          anchorType: args.anchorType,
          anchorOverview: args.anchorOverview,
          changeType: args.changeType,
          structureComponents: args.structureComponents,
        });

        // Phase-51: 冲突信息摘要
        const result: Record<string, unknown> = {
          status: 'saved',
          memory,
        };
        if (memory.conflicts && memory.conflicts.length > 0) {
          result.conflictSummary = `⚠️ Detected ${memory.conflicts.length} conflict(s) with existing memories: ${
            memory.conflicts.map((c: any) =>
              `${c.conflictType} with ${c.existingEntityId} (similarity: ${(c.similarity * 100).toFixed(0)}%)`
            ).join('; ')
          }. Rust layer has automatically created SUPERSEDES/CONFLICTS relations.`;
        }

        return JSON.stringify(result, null, 2);
      } finally {
        memorySaveMutex.release();
      }
    }


    case 'devplan_recall_unified': {
      const projectName = args.projectName!;
      const query = args.query;

      if (!query) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: query');
      }

      const plan = getDevPlan(projectName);
      if (
        typeof (plan as any).recallUnifiedViaAdapter !== 'function'
        && typeof (plan as any).recallUnified !== 'function'
        && typeof (plan as any).recallMemory !== 'function'
      ) {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const includeDocs = args.includeDocs !== undefined ? args.includeDocs : true;
      const graphExpand = args.graphExpand !== undefined ? args.graphExpand : true;
      const recursive = args.recursive !== undefined ? args.recursive : graphExpand;
      const depth = args.depth || 'L1'; // Phase-124: 分层召回深度
      const scope = args.scope as { moduleId?: string; taskId?: string; anchorType?: string; anchorName?: string } | undefined;
      const docStrategy = args.docStrategy as 'vector' | 'guided' | 'none' | undefined; // Phase-125

      const recallFn = typeof (plan as any).recallUnifiedViaAdapter === 'function'
        ? (plan as any).recallUnifiedViaAdapter.bind(plan)
        : (typeof (plan as any).recallUnified === 'function' ? (plan as any).recallUnified.bind(plan) : null);
      const memories = recallFn
        ? recallFn(query, {
          uri: args.uri,
          memoryType: args.memoryType as any,
          limit: args.limit,
          minScore: args.minScore,
          includeDocs,
          recursive,
          depth,
          scope,
          docStrategy,
          deterministicFirst: args.deterministicFirst,
          filterProject: args.filterProject,
          filterMemoryType: args.filterMemoryType,
          filterCreatedAfterMs: args.filterCreatedAfterMs,
          filterCreatedBeforeMs: args.filterCreatedBeforeMs,
          filterScope: args.filterScope,
          filterRoleId: args.filterRoleId,
          filterIncludeGlobalFallback: args.filterIncludeGlobalFallback,
        })
        : (plan as any).recallMemory(query, {
          memoryType: args.memoryType as any,
          limit: args.limit,
          minScore: args.minScore,
          includeDocs,
          graphExpand: recursive,
          depth,
          scope,
          docStrategy,
        });

      // 统计来源分布
      const memoryCount = memories.filter((m: any) => m.sourceKind === 'memory' || !m.sourceKind).length;
      const docCount = memories.filter((m: any) => m.sourceKind === 'doc').length;
      // Phase-125: 统计 guided 文档数量
      const guidedDocCount = memories.filter((m: any) => m.sourceKind === 'doc' && m.guidedReasons?.length > 0).length;

      // Phase-125: 解析实际使用的 docStrategy
      const effectiveDocStrategy = docStrategy || (includeDocs ? 'vector' : 'none');
      const gatewayTelemetry = typeof (plan as any).getMemoryGatewayTelemetry === 'function'
        ? (plan as any).getMemoryGatewayTelemetry()
        : null;

      return JSON.stringify({
        projectName,
        query,
        count: memories.length,
        memoryCount,
        docCount,
        guidedDocCount,  // Phase-125: guided 文档数
        uri: args.uri || null,
        recursive,
        unifiedRecall: effectiveDocStrategy !== 'none',
        docStrategy: effectiveDocStrategy, // Phase-125: 实际使用的策略
        depth,   // Phase-124: 返回当前使用的层级
        scope: scope || null,  // Phase-124: 返回当前使用的范围
        gatewayTelemetry,
        memories,
      }, null, 2);
    }

    case 'devplan_gateway_outbox_entries': {
      const projectName = args.projectName!;
      const plan = getDevPlan(projectName);
      if (
        typeof (plan as any).getGatewayOutboxEntriesViaAdapter !== 'function'
        && typeof (plan as any).getGatewayOutboxEntries !== 'function'
      ) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Gateway outbox operations are unavailable in project "${projectName}".`
        );
      }
      const entries = typeof (plan as any).getGatewayOutboxEntriesViaAdapter === 'function'
        ? (plan as any).getGatewayOutboxEntriesViaAdapter()
        : (plan as any).getGatewayOutboxEntries();
      const gatewayTelemetry = typeof (plan as any).getMemoryGatewayTelemetry === 'function'
        ? (plan as any).getMemoryGatewayTelemetry()
        : null;
      return JSON.stringify({
        projectName,
        count: Array.isArray(entries) ? entries.length : 0,
        gatewayTelemetry,
        entries: Array.isArray(entries) ? entries : [],
      }, null, 2);
    }

    case 'devplan_gateway_retry_outbox_entry': {
      const projectName = args.projectName!;
      const entryId = args.entryId;
      const forceReady = args.forceReady !== undefined ? args.forceReady : true;
      if (!entryId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: entryId');
      }
      const plan = getDevPlan(projectName);
      if (
        typeof (plan as any).retryGatewayOutboxEntryViaAdapter !== 'function'
        && typeof (plan as any).retryGatewayOutboxEntry !== 'function'
      ) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Gateway outbox operations are unavailable in project "${projectName}".`
        );
      }
      const result = typeof (plan as any).retryGatewayOutboxEntryViaAdapter === 'function'
        ? await (plan as any).retryGatewayOutboxEntryViaAdapter(entryId, forceReady)
        : await (plan as any).retryGatewayOutboxEntry(entryId, forceReady);
      const gatewayTelemetry = typeof (plan as any).getMemoryGatewayTelemetry === 'function'
        ? (plan as any).getMemoryGatewayTelemetry()
        : null;
      return JSON.stringify({
        status: 'retried',
        projectName,
        entryId,
        forceReady,
        gatewayTelemetry,
        result,
      }, null, 2);
    }

    case 'devplan_gateway_memorize_cursor_profile':
    case 'devplan_memory_save_cursor_profile': {
      const projectName = args.projectName!;
      if (!args.conversationId || !args.userId || !args.userContent || !args.assistantContent) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Missing required: conversationId, userId, userContent, assistantContent',
        );
      }
      const plan = getDevPlan(projectName);
      if (typeof (plan as any).gatewayMemorizeWithCursorProfile !== 'function') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Gateway cursor-profile memorize is unavailable in project "${projectName}".`,
        );
      }
      const result = await (plan as any).gatewayMemorizeWithCursorProfile({
        conversationId: args.conversationId,
        userId: args.userId,
        userContent: args.userContent,
        assistantContent: args.assistantContent,
        scope: args.writeScope,
        roleId: args.roleId,
        profile: args.profile,
        contentSessionId: args.contentSessionId,
        memorySessionId: args.memorySessionId,
        hookPhase: args.hookPhase,
        hookName: args.hookName,
      });
      const gatewayTelemetry = typeof (plan as any).getMemoryGatewayTelemetry === 'function'
        ? (plan as any).getMemoryGatewayTelemetry()
        : null;
      return JSON.stringify({
        status: 'stored',
        tool: name,
        projectName,
        gatewayTelemetry,
        result,
      }, null, 2);
    }


    case 'devplan_get_feature_flags': {
      const projectName = args.projectName!;
      const plan = getDevPlan(projectName);
      if (typeof (plan as any).getFeatureFlags !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest, `Feature flags require "graph" engine. Project "${projectName}" uses a different engine.`);
      }
      const featureFlags = (plan as any).getFeatureFlags();
      return JSON.stringify({ projectName, featureFlags }, null, 2);
    }


    case 'devplan_set_feature_flags': {
      const projectName = args.projectName!;
      const plan = getDevPlan(projectName);
      if (typeof (plan as any).setFeatureFlags !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest, `Feature flags require "graph" engine. Project "${projectName}" uses a different engine.`);
      }
      if (!args.featureFlags || typeof args.featureFlags !== 'object') {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: featureFlags');
      }
      const featureFlags = (plan as any).setFeatureFlags(args.featureFlags);
      return JSON.stringify({ status: 'updated', projectName, featureFlags }, null, 2);
    }


    case 'devplan_get_recall_observability': {
      const projectName = args.projectName!;
      const plan = getDevPlan(projectName);
      if (typeof (plan as any).getRecallObservability !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest, `Recall observability requires "graph" engine. Project "${projectName}" uses a different engine.`);
      }
      const observability = (plan as any).getRecallObservability();
      const gateway = observability?.gatewayAdapter;
      const gatewayAlert = observability?.gatewayAlert || null;
      const gatewaySummary = gateway ? {
        recallGatewayHitRate: gateway.recallUnified.gatewayHitRate,
        recallFallbackRate: gateway.recallUnified.fallbackRate,
        outboxListGatewayHitRate: gateway.getOutboxEntries.gatewayHitRate,
        outboxRetryGatewayHitRate: gateway.retryOutboxEntry.gatewayHitRate,
      } : null;
      return JSON.stringify({ projectName, observability, gatewaySummary, gatewayAlert }, null, 2);
    }


    case 'devplan_reset_recall_observability': {
      const projectName = args.projectName!;
      const plan = getDevPlan(projectName);
      if (typeof (plan as any).resetRecallObservability !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest, `Recall observability requires "graph" engine. Project "${projectName}" uses a different engine.`);
      }
      const observability = (plan as any).resetRecallObservability();
      return JSON.stringify({ status: 'reset', projectName, observability }, null, 2);
    }


    case 'devplan_memory_list': {
      const projectName = args.projectName!;

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).listMemories !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const memories = (plan as any).listMemories({
        memoryType: args.memoryType as any,
        limit: args.limit,
      });

      return JSON.stringify({
        projectName,
        count: memories.length,
        filter: {
          memoryType: args.memoryType || null,
          limit: args.limit || null,
        },
        memories,
      }, null, 2);
    }


    case 'devplan_memory_delete': {
      const projectName = args.projectName!;
      const memoryId = args.memoryId;

      if (!memoryId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: memoryId');
      }

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).deleteMemory !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const success = (plan as any).deleteMemory(memoryId);
      return JSON.stringify({
        status: success ? 'deleted' : 'not_found',
        memoryId,
      }, null, 2);
    }


    case 'devplan_memory_clear': {
      const projectName = args.projectName!;
      const confirm = args.confirm;

      if (confirm !== true) {
        throw new McpError(ErrorCode.InvalidParams,
          'Safety guard: confirm must be true to clear memories. Set confirm: true to proceed.');
      }

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).clearAllMemories !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const memoryType = args.memoryType as string | undefined;
      const result = (plan as any).clearAllMemories(memoryType);
      return JSON.stringify({
        status: 'cleared',
        ...result,
        memoryType: memoryType || 'all',
        projectName,
      }, null, 2);
    }


    case 'devplan_memory_clusters': {
      const projectName = args.projectName!;

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).getMemoryClusters !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory clusters require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const clusters = (plan as any).getMemoryClusters();
      const totalMemories = clusters.reduce(
        (sum: number, c: any) => sum + c.memoryCount, 0
      );

      return JSON.stringify({
        projectName,
        totalClusters: clusters.length,
        totalMemories,
        clusters: clusters.map((c: any) => ({
          clusterId: c.clusterId,
          theme: c.theme,
          memoryCount: c.memoryCount,
          topMemoryTypes: c.topMemoryTypes,
          memories: c.memories.map((m: any) => ({
            id: m.id,
            memoryType: m.memoryType,
            content: m.content.length > 100 ? m.content.slice(0, 100) + '...' : m.content,
            importance: m.importance,
            tags: m.tags,
          })),
        })),
      }, null, 2);
    }


    case 'devplan_memory_context': {
      const projectName = args.projectName!;

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).getMemoryContext !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory features require "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const context = (plan as any).getMemoryContext(
        args.query,
        args.maxMemories,
      );

      return JSON.stringify({
        projectName,
        context,
      }, null, 2);
    }


    case 'devplan_memory_generate': {
      const projectName = args.projectName!;

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).generateMemoryCandidates !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory generation requires "graph" engine. Project "${projectName}" uses a different engine.`);
      }

      const result = (plan as any).generateMemoryCandidates({
        source: args.source as any,
        taskId: args.taskId,
        section: args.section,
        subSection: args.subSection,
        limit: args.limit,
      });

      return JSON.stringify(result, null, 2);
    }


    case 'devplan_memory_lifecycle': {
      const projectName = args.projectName!;

      const plan = getDevPlan(projectName);
      if (typeof (plan as any).runMemoryLifecycle !== 'function') {
        throw new McpError(ErrorCode.InvalidRequest,
          `Memory lifecycle requires "graph" engine with dynamicScan support. Project "${projectName}" may use a different engine or older aifastdb version.`);
      }

      const report = (plan as any).runMemoryLifecycle({
        demoteIdleTimeoutSecs: (args as any).demoteIdleTimeoutSecs,
        promoteHitThreshold: (args as any).promoteHitThreshold,
      });

      if (report === null) {
        return JSON.stringify({
          status: 'unsupported',
          message: 'Memory lifecycle scan not available. Please upgrade to aifastdb >= 2.8.0.',
        });
      }

      // Phase-50: 包含 Rust 原生 memoryTreeLifecycle 的额外字段
      const extras: string[] = [];
      if (report.summariesCreated) extras.push(`${report.summariesCreated} summaries created`);
      if (report.hebbianUpdates) extras.push(`${report.hebbianUpdates} Hebbian updates`);
      const extrasStr = extras.length > 0 ? `, ${extras.join(', ')}` : '';

      return JSON.stringify({
        status: 'completed',
        projectName,
        report,
        message: `Scanned ${report.scanned} memories: ${report.promoted} promoted, ${report.demoted} demoted${extrasStr} (${report.durationMs}ms)`,
      });
    }

    // ========== Phase-57: 三维记忆 MCP 工具处理器 ==========


    default:
      return null;
  }
}
