#!/usr/bin/env node
/**
 * DevPlan 图可视化 HTTP 服务器
 *
 * 轻量级服务器，使用 Node.js 内置 http 模块，无需 Express/React。
 *
 * 端点：
 * - GET /            — 返回 vis-network 可视化 HTML 页面
 * - GET /api/graph   — 返回 { nodes, edges } JSON 数据（默认包含 node.degree）
 * - GET /api/progress — 返回项目进度统计
 *
 * 启动参数：
 * --project <name>     项目名称（必需）
 * --port <number>      监听端口（默认 3210）
 * --base-path <path>   DevPlan 数据存储路径
 */

import * as http from 'http';
import * as path from 'path';
import { DevPlanGraphStore } from '../dev-plan-graph-store';
import { createDevPlan, getDefaultBasePath } from '../dev-plan-factory';
import type { IDevPlanStore } from '../dev-plan-interface';
import { getVisualizationHTML } from './template';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliArgs {
  project: string;
  port: number;
  basePath: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let project = '';
  let port = 3210;
  let basePath = '';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--project':
        project = args[++i] || '';
        break;
      case '--port':
        port = parseInt(args[++i] || '3210', 10);
        break;
      case '--base-path':
        basePath = args[++i] || '';
        break;
    }
  }

  if (!project) {
    console.error('错误: 缺少 --project 参数');
    console.error('');
    console.error('用法: aifastdb-devplan-visual --project <项目名称> [--port <端口>] [--base-path <路径>]');
    console.error('');
    console.error('参数:');
    console.error('  --project <name>     项目名称（必需）');
    console.error('  --port <number>      监听端口（默认 3210）');
    console.error('  --base-path <path>   DevPlan 数据存储路径');
    console.error('');
    console.error('示例:');
    console.error('  aifastdb-devplan-visual --project ai_db --base-path D:/Project/git/ai_db/.devplan');
    process.exit(1);
  }

  if (!basePath) {
    basePath = getDefaultBasePath();
  }

  return { project, port, basePath };
}

// ============================================================================
// Store Initialization
// ============================================================================

function createStore(project: string, basePath: string): IDevPlanStore {
  const store = createDevPlan(project, basePath, 'graph');

  if (!(store instanceof DevPlanGraphStore)) {
    console.error(`错误: 项目 "${project}" 未使用 graph 引擎。`);
    console.error('图可视化仅支持使用 SocialGraphV2 引擎的项目。');
    console.error('请先使用 devplan_migrate_engine 工具将项目迁移到 graph 引擎。');
    process.exit(1);
  }

  return store;
}

// ============================================================================
// HTTP Server
// ============================================================================

/**
 * 为每次 API 请求创建新的 store 实例，以确保读取磁盘上最新的 WAL 数据。
 *
 * 背景：MCP 工具在另一个进程中更新任务状态（写入 WAL 文件），
 * 如果复用启动时创建的 store，内存中的数据不会自动同步磁盘变化，
 * 导致 /api/graph 和 /api/progress 返回过时数据。
 *
 * 由于可视化页面的 API 调用频率很低（仅刷新/加载时），
 * 每次重新创建 store 的性能开销完全可以接受。
 */
function createFreshStore(projectName: string, basePath: string): IDevPlanStore {
  return createDevPlan(projectName, basePath, 'graph');
}

function startServer(projectName: string, basePath: string, port: number): void {
  const htmlContent = getVisualizationHTML(projectName);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // 禁止浏览器缓存 API 响应，确保 F5 刷新时总是获取最新数据
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      switch (url.pathname) {
        case '/':
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(htmlContent);
          break;

        case '/api/graph': {
          // 每次请求重新创建 store，确保读取最新数据
          const store = createFreshStore(projectName, basePath);
          const includeDocuments = url.searchParams.get('includeDocuments') !== 'false';
          const includeModules = url.searchParams.get('includeModules') !== 'false';
          const includeNodeDegree = url.searchParams.get('includeNodeDegree') !== 'false';
          const enableBackendDegreeFallback = url.searchParams.get('enableBackendDegreeFallback') !== 'false';

          if (store.exportGraph) {
            const graph = store.exportGraph({
              includeDocuments,
              includeModules,
              includeNodeDegree,
              enableBackendDegreeFallback,
            });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(graph));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '当前引擎不支持图导出' }));
          }
          break;
        }

        case '/api/progress': {
          // 每次请求重新创建 store，确保读取最新数据
          const store = createFreshStore(projectName, basePath);
          const progress = store.getProgress();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(progress));
          break;
        }

        case '/api/stats': {
          // 详细统计数据 — 用于仪表盘页面
          const store = createFreshStore(projectName, basePath);
          const progress = store.getProgress();
          const sections = store.listSections();
          const modules = store.listModules();

          // 按优先级统计
          const byPriority: Record<string, { total: number; completed: number }> = {};
          for (const t of progress.tasks) {
            if (!byPriority[t.priority]) byPriority[t.priority] = { total: 0, completed: 0 };
            byPriority[t.priority].total += t.total;
            byPriority[t.priority].completed += t.completed;
          }

          // 按状态统计主任务
          const mainTaskByStatus: Record<string, number> = {};
          for (const t of progress.tasks) {
            mainTaskByStatus[t.status] = (mainTaskByStatus[t.status] || 0) + 1;
          }

          // 为每个主任务附带子任务详情（含完成时间）
          function getSubTasksForPhase(taskId: string) {
            return store.listSubTasks(taskId).map((s: any) => ({
              taskId: s.taskId,
              title: s.title,
              status: s.status,
              completedAt: s.completedAt || null,
            }));
          }

          // 获取主任务的完成时间
          function getMainTaskCompletedAt(taskId: string): number | null {
            const mt = store.getMainTask(taskId);
            return mt ? (mt as any).completedAt || null : null;
          }

          // 获取主任务关联的文档
          function getRelatedDocs(taskId: string) {
            if (store.getTaskRelatedDocs) {
              return store.getTaskRelatedDocs(taskId).map((d: any) => ({
                id: d.id,
                section: d.section,
                subSection: d.subSection || null,
                title: d.title,
              }));
            }
            return [];
          }

          // 构建带完成时间的阶段数据
          function buildPhase(t: any) {
            return {
              taskId: t.taskId,
              title: t.title,
              total: t.total,
              completed: t.completed,
              percent: t.percent,
              completedAt: getMainTaskCompletedAt(t.taskId),
              subTasks: getSubTasksForPhase(t.taskId),
              relatedDocs: getRelatedDocs(t.taskId),
            };
          }

          // 最近完成的任务（从 tasks 中提取已完成的阶段）
          const completedPhases = progress.tasks
            .filter((t: any) => t.status === 'completed')
            .map(buildPhase);

          // 进行中的任务
          const inProgressPhases = progress.tasks
            .filter((t: any) => t.status === 'in_progress')
            .map(buildPhase);

          // 待开始的任务
          const pendingPhases = progress.tasks
            .filter((t: any) => t.status === 'pending')
            .map(buildPhase);

          // 模块统计
          const moduleStats = modules.map((m: any) => ({
            moduleId: m.moduleId,
            name: m.name,
            status: m.status,
            mainTaskCount: m.mainTaskCount,
            subTaskCount: m.subTaskCount,
            completedSubTaskCount: m.completedSubTaskCount,
          }));

          // 文档按类型分组统计
          const docBySection: Record<string, number> = {};
          for (const s of sections) {
            docBySection[s.section] = (docBySection[s.section] || 0) + 1;
          }

          const stats = {
            ...progress,
            docCount: sections.length,
            moduleCount: modules.length,
            byPriority,
            mainTaskByStatus,
            completedPhases,
            inProgressPhases,
            pendingPhases,
            moduleStats,
            docBySection,
          };

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(stats));
          break;
        }

        case '/api/docs': {
          // 列出所有文档片段（不含内容，用于文档浏览页面左侧列表）
          const store = createFreshStore(projectName, basePath);
          const allSections = store.listSections();
          const docList = allSections.map((s: any) => ({
            section: s.section,
            subSection: s.subSection || null,
            title: s.title,
            version: s.version || null,
            moduleId: s.moduleId || null,
            updatedAt: s.updatedAt || null,
          }));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ docs: docList }));
          break;
        }

        case '/api/doc': {
          // 获取文档内容 — 按 section + subSection 查询
          const store = createFreshStore(projectName, basePath);
          const section = url.searchParams.get('section');
          const subSection = url.searchParams.get('subSection') || undefined;

          if (!section) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少 section 参数' }));
            break;
          }

          const doc = store.getSection(section as any, subSection);
          if (doc) {
            // 附加关联主任务信息
            let relatedTasks: any[] = [];
            if (store.getDocRelatedTasks) {
              relatedTasks = store.getDocRelatedTasks(section as any, subSection).map((mt: any) => ({
                id: mt.id,
                taskId: mt.taskId,
                title: mt.title,
                status: mt.status,
                priority: mt.priority,
              }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ...doc, relatedTasks }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '文档未找到' }));
          }
          break;
        }

        case '/favicon.ico':
          res.writeHead(204);
          res.end();
          break;

        default:
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Not Found' }));
      }
    } catch (err: any) {
      console.error('请求处理错误:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║         DevPlan 图谱可视化服务器已启动                  ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  项目:  ${projectName.padEnd(47)}║`);
    console.log(`║  地址:  ${url.padEnd(47)}║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  API 端点:                                              ║');
    console.log(`║    GET /             可视化页面                         ║`);
    console.log(`║    GET /api/graph    图谱数据 (JSON)                    ║`);
    console.log(`║    GET /api/progress 项目进度 (JSON)                    ║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  按 Ctrl+C 停止服务器                                   ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');

    // 尝试自动打开浏览器
    tryOpenBrowser(url);
  });

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    server.close(() => {
      console.log('服务器已停止');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}

// ============================================================================
// Browser Auto-Open
// ============================================================================

function tryOpenBrowser(url: string): void {
  const { exec } = require('child_process');
  const platform = process.platform;

  let cmd: string;
  if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err: Error | null) => {
    if (err) {
      console.log(`提示: 无法自动打开浏览器，请手动访问 ${url}`);
    }
  });
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const { project, port, basePath } = parseArgs();

  console.log(`正在加载项目 "${project}" 的数据...`);
  console.log(`数据路径: ${path.resolve(basePath)}`);

  // 验证 store 可以正常创建（启动时检查一次）
  createStore(project, basePath);

  // 启动服务器，每次 API 请求时会重新创建 store 以获取最新数据
  startServer(project, basePath, port);
}

main();
