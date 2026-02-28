import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { getProjectEngine, type DevPlanEngine } from '../../dev-plan-factory';
import { migrateEngine } from '../../dev-plan-migrate';
import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';

type GetDevPlan = (projectName: string) => IDevPlanStore;

export async function handleModuleToolCall(name: string, args: ToolArgs, deps: { getDevPlan: GetDevPlan; clearDevPlanCache: (projectName: string) => void }): Promise<string | null> {
  const { getDevPlan, clearDevPlanCache } = deps;
  switch (name) {
    case 'devplan_create_module': {
      if (!args.projectName || !args.moduleId || !args.name) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, moduleId, name');
      }

      const plan = getDevPlan(args.projectName);
      try {
        const mod = plan.createModule({
          projectName: args.projectName,
          moduleId: args.moduleId,
          name: args.name,
          description: args.description,
          status: args.status as any,
        });
        return JSON.stringify({ success: true, module: mod });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }


    case 'devplan_list_modules': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const modules = plan.listModules({
        status: args.status as any,
      });
      return JSON.stringify({
        projectName: args.projectName,
        count: modules.length,
        modules: modules.map(m => ({
          moduleId: m.moduleId,
          name: m.name,
          description: m.description,
          status: m.status,
          mainTaskCount: m.mainTaskCount,
          subTaskCount: m.subTaskCount,
          completedSubTaskCount: m.completedSubTaskCount,
          docCount: m.docCount,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        })),
      });
    }


    case 'devplan_get_module': {
      if (!args.projectName || !args.moduleId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, moduleId');
      }

      const plan = getDevPlan(args.projectName);
      const detail = plan.getModuleDetail(args.moduleId);
      if (!detail) {
        return JSON.stringify({ error: `Module "${args.moduleId}" not found` });
      }

      return JSON.stringify({
        projectName: args.projectName,
        module: {
          moduleId: detail.module.moduleId,
          name: detail.module.name,
          description: detail.module.description,
          status: detail.module.status,
          mainTaskCount: detail.module.mainTaskCount,
          subTaskCount: detail.module.subTaskCount,
          completedSubTaskCount: detail.module.completedSubTaskCount,
          docCount: detail.module.docCount,
        },
        mainTasks: detail.mainTasks.map(mt => ({
          taskId: mt.taskId,
          title: mt.title,
          priority: mt.priority,
          status: mt.status,
          totalSubtasks: mt.totalSubtasks,
          completedSubtasks: mt.completedSubtasks,
        })),
        subTasks: detail.subTasks.map(st => ({
          taskId: st.taskId,
          title: st.title,
          status: st.status,
          parentTaskId: st.parentTaskId,
        })),
        documents: detail.documents.map(doc => ({
          section: doc.section,
          subSection: doc.subSection,
          title: doc.title,
        })),
      });
    }


    case 'devplan_update_module': {
      if (!args.projectName || !args.moduleId) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, moduleId');
      }

      const plan = getDevPlan(args.projectName);
      const updated = plan.updateModule(args.moduleId, {
        name: args.name,
        description: args.description,
        status: args.status as any,
      });

      if (!updated) {
        return JSON.stringify({ error: `Module "${args.moduleId}" not found` });
      }

      return JSON.stringify({ success: true, module: updated });
    }


    case 'devplan_export_graph': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const plan = getDevPlan(args.projectName);
      const engine = getProjectEngine(args.projectName);

      if (engine !== 'graph' || !plan.exportGraph) {
        return JSON.stringify({
          error: `Graph export is only available for projects using the "graph" engine. Project "${args.projectName}" uses "${engine || 'document'}" engine.`,
          hint: 'Re-initialize the project with engine "graph" to enable graph export.',
        });
      }

      try {
        const graph = plan.exportGraph({
          includeDocuments: args.includeDocuments,
          includeModules: args.includeModules,
          includeNodeDegree: args.includeNodeDegree,
          enableBackendDegreeFallback: args.enableBackendDegreeFallback,
        });

        return JSON.stringify({
          success: true,
          projectName: args.projectName,
          engine: 'graph',
          nodeCount: graph?.nodes.length || 0,
          edgeCount: graph?.edges.length || 0,
          graph,
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }


    case 'devplan_migrate_engine': {
      if (!args.projectName || !args.targetEngine) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName, targetEngine');
      }

      const validEngines = ['graph', 'document'];
      if (!validEngines.includes(args.targetEngine)) {
        throw new McpError(ErrorCode.InvalidParams,
          `Invalid targetEngine "${args.targetEngine}". Must be one of: ${validEngines.join(', ')}`);
      }

      try {
        const result = migrateEngine(
          args.projectName,
          args.targetEngine as DevPlanEngine,
          undefined,
          {
            backup: args.backup,
            dryRun: args.dryRun,
          }
        );

        // 迁移成功后清除缓存，下次访问时使用新引擎
        if (result.success && !args.dryRun) {
          clearDevPlanCache(args.projectName);
        }

        const statusIcon = result.success ? '✅' : '⚠️';
        const modeLabel = args.dryRun ? ' (dry run)' : '';

        return JSON.stringify({
          ...result,
          summary: result.fromEngine === result.toEngine
            ? `ℹ️ Project "${args.projectName}" already uses "${result.toEngine}" engine. No migration needed.`
            : result.success
              ? `${statusIcon} Successfully migrated "${args.projectName}" from "${result.fromEngine}" to "${result.toEngine}"${modeLabel}. ` +
                `Stats: ${result.stats.modules} modules, ${result.stats.documents} documents, ` +
                `${result.stats.mainTasks} main tasks, ${result.stats.subTasks} sub-tasks. ` +
                `Duration: ${result.durationMs}ms.` +
                (result.backupPath ? ` Backup: ${result.backupPath}` : '')
              : `${statusIcon} Migration failed with ${result.errors.length} error(s): ${result.errors.join('; ')}`,
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }


    case 'devplan_start_visual': {
      if (!args.projectName) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
      }

      const engine = getProjectEngine(args.projectName);
      if (engine !== 'graph') {
        return JSON.stringify({
          success: false,
          error: `Graph visualization requires "graph" engine. Project "${args.projectName}" uses "${engine || 'document'}" engine.`,
          hint: 'Use devplan_migrate_engine to migrate to "graph" engine first.',
        });
      }

      const port = args.port || 3210;

      try {
        const { spawn } = require('child_process');
        const serverScript = require('path').resolve(__dirname, '../visualize/server.js');

        const child = spawn(process.execPath, [
          serverScript,
          '--project', args.projectName,
          '--port', String(port),
        ], {
          detached: true,
          stdio: 'ignore',
        });

        child.unref();

        const url = `http://localhost:${port}`;

        // 尝试自动打开浏览器
        const platform = process.platform;
        let openCmd: string;
        let openArgs: string[];
        if (platform === 'win32') {
          openCmd = 'cmd';
          openArgs = ['/c', 'start', '', url];
        } else if (platform === 'darwin') {
          openCmd = 'open';
          openArgs = [url];
        } else {
          openCmd = 'xdg-open';
          openArgs = [url];
        }

        const browser = spawn(openCmd, openArgs, {
          detached: true,
          stdio: 'ignore',
        });
        browser.unref();

        return JSON.stringify({
          success: true,
          projectName: args.projectName,
          port,
          url,
          pid: child.pid,
          message: `Visualization server started at ${url} (PID: ${child.pid}). Browser should open automatically. Use Ctrl+Click to drag connected nodes together.`,
        });
      } catch (err) {
        throw new McpError(ErrorCode.InternalError,
          err instanceof Error ? err.message : String(err));
      }
    }


    default:
      return null;
  }
}
