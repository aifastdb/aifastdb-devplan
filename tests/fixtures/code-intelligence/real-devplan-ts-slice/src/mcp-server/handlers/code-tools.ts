import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { createDevPlan, resolveBasePathForProject } from '../../dev-plan-factory';
import { CodeBridgeStore, EmbeddedCodeIntelligenceStore } from '../../code-intelligence';
import { runCodeIntelRegressionCheck } from '../../code-intelligence/regression';
import type { ToolArgs } from '../tool-definitions';

function createCodeStore(projectName: string): EmbeddedCodeIntelligenceStore {
  const basePath = resolveBasePathForProject(projectName);
  return new EmbeddedCodeIntelligenceStore(projectName, basePath);
}

function createBridgeStore(projectName: string): CodeBridgeStore {
  const basePath = resolveBasePathForProject(projectName);
  return new CodeBridgeStore(
    projectName,
    basePath,
    new EmbeddedCodeIntelligenceStore(projectName, basePath),
    createDevPlan(projectName, basePath, 'graph'),
  );
}

async function buildCodeMeta(
  store: EmbeddedCodeIntelligenceStore,
  projectName: string,
  repoPath?: string,
) {
  const status = await store.getStatus(repoPath);
  return {
    ok: true,
    projectName,
    repoPath: repoPath || status.repoPath || null,
    source: status.source,
    mode: status.mode,
    status,
  };
}

export async function handleCodeToolCall(name: string, args: ToolArgs): Promise<string | null> {
  const projectName = args.projectName;
  if (!projectName) return null;

  switch (name) {
    case 'devplan_code_status': {
      const store = createCodeStore(projectName);
      const meta = await buildCodeMeta(store, projectName, args.repoPath);
      return JSON.stringify(meta, null, 2);
    }

    case 'devplan_code_graph': {
      const store = createCodeStore(projectName);
      const graph = await store.getGraph(args.repoPath);
      const meta = await buildCodeMeta(store, projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: {
          nodes: graph.nodes,
          edges: graph.edges,
        },
        nodes: graph.nodes,
        edges: graph.edges,
      }, null, 2);
    }

    case 'devplan_code_clusters': {
      const store = createCodeStore(projectName);
      const clusters = await store.getClusters(args.repoPath);
      const meta = await buildCodeMeta(store, projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: {
          count: clusters.length,
          clusters,
        },
        count: clusters.length,
        clusters,
      }, null, 2);
    }

    case 'devplan_code_processes': {
      const store = createCodeStore(projectName);
      const processes = await store.getProcesses(args.repoPath);
      const meta = await buildCodeMeta(store, projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: {
          count: processes.length,
          processes,
        },
        count: processes.length,
        processes,
      }, null, 2);
    }

    case 'devplan_code_query': {
      if (!args.query) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: query');
      }
      const store = createCodeStore(projectName);
      const result = await store.query(args.query, args.repoPath, args.limit || 10);
      const meta = await buildCodeMeta(store, projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: result,
        ...result,
      }, null, 2);
    }

    case 'devplan_code_context': {
      if (!args.symbol) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: symbol');
      }
      const store = createCodeStore(projectName);
      const result = await store.getContext(args.symbol, args.repoPath);
      const meta = await buildCodeMeta(store, projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        query: args.symbol,
        data: result,
        ...result,
      }, null, 2);
    }

    case 'devplan_code_impact': {
      if (!args.target) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: target');
      }
      const direction = (args.direction as 'upstream' | 'downstream' | 'both' | undefined) || 'both';
      if (!['upstream', 'downstream', 'both'].includes(direction)) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid direction: must be upstream, downstream, or both');
      }
      const store = createCodeStore(projectName);
      const result = await store.getImpact(args.target, direction, args.repoPath, args.limit || 20);
      const meta = await buildCodeMeta(store, projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: result,
        ...result,
      }, null, 2);
    }

    case 'devplan_code_detect_changes': {
      const store = createCodeStore(projectName);
      const result = await store.detectChanges(args.repoPath, args.limit || 50);
      const meta = await buildCodeMeta(store, projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: result,
        ...result,
      }, null, 2);
    }

    case 'devplan_code_rename': {
      const query = typeof args.symbolId === 'string' && args.symbolId.trim()
        ? args.symbolId
        : args.symbol;
      if (!query) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: symbol or symbolId');
      }
      if (!args.newName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: newName');
      }
      const store = createCodeStore(projectName);
      const result = await store.renameSymbol(query, args.newName, args.repoPath, args.apply === true);
      const meta = await buildCodeMeta(store, projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: result,
        ...result,
      }, null, 2);
    }

    case 'devplan_code_graph_query': {
      const store = createCodeStore(projectName);
      const result = await store.queryGraph({
        query: args.query,
        nodeTypes: Array.isArray(args.nodeTypes) ? args.nodeTypes as any : undefined,
        edgeLabels: Array.isArray(args.edgeLabels) ? args.edgeLabels as any : undefined,
        filePathPrefix: args.filePathPrefix,
        communityId: args.communityId,
        processId: args.processId,
        limit: args.limit,
      }, args.repoPath);
      const meta = await buildCodeMeta(store, projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: result,
        ...result,
      }, null, 2);
    }

    case 'devplan_code_refactor_guardrails': {
      const store = createCodeStore(projectName);
      const result = store.getRefactorGuardrails();
      const meta = await buildCodeMeta(store, projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: result,
        ...result,
      }, null, 2);
    }

    case 'devplan_code_rebuild_index': {
      const store = createCodeStore(projectName);
      const status = await store.rebuildIndex(args.repoPath);
      return JSON.stringify({
        ok: true,
        projectName,
        repoPath: args.repoPath || status.repoPath || null,
        source: status.source,
        mode: status.mode,
        status,
        data: {
          rebuilt: true,
        },
        success: true,
      }, null, 2);
    }

    case 'devplan_code_regression_check': {
      if (!args.fixturePath) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: fixturePath');
      }
      const result = await runCodeIntelRegressionCheck({
        fixturePath: args.fixturePath,
        expectedPath: args.expectedPath,
      });
      return JSON.stringify({
        ok: result.ok,
        projectName,
        repoPath: args.fixturePath,
        source: result.status.source,
        mode: result.status.mode,
        status: result.status,
        data: result,
        fixturePath: result.fixturePath,
        expectedPath: result.expectedPath,
        comparedAt: result.comparedAt,
        summary: result.summary,
        diagnostics: result.diagnostics,
      }, null, 2);
    }

    case 'devplan_code_link_module': {
      if (!args.moduleId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: moduleId');
      }
      if (!args.communityId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: communityId');
      }
      const bridge = createBridgeStore(projectName);
      const link = await bridge.linkModuleToCommunity(args.moduleId, args.communityId, args.note);
      const meta = await buildCodeMeta(createCodeStore(projectName), projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: { link },
        link,
      }, null, 2);
    }

    case 'devplan_code_resolve_module': {
      if (!args.moduleId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: moduleId');
      }
      const bridge = createBridgeStore(projectName);
      const result = await bridge.resolveModuleCodeContext(args.moduleId);
      const meta = await buildCodeMeta(createCodeStore(projectName), projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: result,
        ...result,
      }, null, 2);
    }

    case 'devplan_code_link_task': {
      if (!args.taskId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: taskId');
      }
      const bridge = createBridgeStore(projectName);
      const link = await bridge.linkTaskToCode(
        args.taskId,
        Array.isArray(args.symbolIds) ? args.symbolIds : [],
        Array.isArray(args.processIds) ? args.processIds : [],
        args.note,
      );
      const meta = await buildCodeMeta(createCodeStore(projectName), projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: { link },
        link,
      }, null, 2);
    }

    case 'devplan_code_link_doc': {
      if (!args.section) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: section');
      }
      if (!args.processId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: processId');
      }
      const bridge = createBridgeStore(projectName);
      const link = await bridge.linkDocToProcess(args.section, args.subSection, args.processId, args.note);
      const meta = await buildCodeMeta(createCodeStore(projectName), projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: { link },
        link,
      }, null, 2);
    }

    case 'devplan_code_link_anchor': {
      if (!args.anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: anchorName');
      }
      if (!args.symbolId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: symbolId');
      }
      const bridge = createBridgeStore(projectName);
      const link = await bridge.linkAnchorToSymbol(args.anchorName, args.symbolId, args.note);
      const meta = await buildCodeMeta(createCodeStore(projectName), projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: { link },
        link,
      }, null, 2);
    }

    case 'devplan_code_recommend_module': {
      if (!args.moduleId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: moduleId');
      }
      const bridge = createBridgeStore(projectName);
      const result = await bridge.recommendModuleMappings(args.moduleId, args.limit || 5);
      const meta = await buildCodeMeta(createCodeStore(projectName), projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: result,
        ...result,
      }, null, 2);
    }

    case 'devplan_code_recommend_task': {
      if (!args.taskId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: taskId');
      }
      const bridge = createBridgeStore(projectName);
      const result = await bridge.recommendTaskMappings(args.taskId, args.limit || 8);
      const meta = await buildCodeMeta(createCodeStore(projectName), projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: result,
        ...result,
      }, null, 2);
    }

    case 'devplan_code_recommend_doc': {
      if (!args.section) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: section');
      }
      const bridge = createBridgeStore(projectName);
      const result = await bridge.recommendDocMappings(args.section, args.subSection, args.limit || 8);
      const meta = await buildCodeMeta(createCodeStore(projectName), projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: result,
        ...result,
      }, null, 2);
    }

    case 'devplan_code_recommend_anchor': {
      if (!args.anchorName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: anchorName');
      }
      const bridge = createBridgeStore(projectName);
      const result = await bridge.recommendAnchorMappings(args.anchorName, args.limit || 8);
      const meta = await buildCodeMeta(createCodeStore(projectName), projectName, args.repoPath);
      return JSON.stringify({
        ...meta,
        data: result,
        ...result,
      }, null, 2);
    }

    default:
      return null;
  }
}
