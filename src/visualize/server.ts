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
import { createDevPlan, getDefaultBasePath, resolveBasePathForProject, readDevPlanConfig } from '../dev-plan-factory';
import type { IDevPlanStore } from '../dev-plan-interface';
import { getVisualizationHTML } from './template';
import { getGraphCanvasScript } from './graph-canvas/index';
import {
  getAutopilotStatus,
  getAutopilotNextAction,
  recordHeartbeat,
  getLastHeartbeat,
} from '../autopilot';
import type { ExecutorHeartbeat } from '../types';

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
    // 多项目路由：优先使用项目注册表路由的 basePath
    basePath = resolveBasePathForProject(project);
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
 * 由于项目图谱页面的 API 调用频率很低（仅刷新/加载时），
 * 每次重新创建 store 的性能开销完全可以接受。
 */
function createFreshStore(projectName: string, basePath: string): IDevPlanStore {
  return createDevPlan(projectName, basePath, 'graph');
}

// ============================================================================
// Meta Question Detection — 元信息智能问答
// ============================================================================

/**
 * 检测是否为元信息问题（关于项目/数据库本身的统计类问题）。
 * 如果是，直接生成回答文本；如果不是，返回 null 继续走搜索流程。
 */
function detectMetaQuestion(
  store: IDevPlanStore,
  projectName: string,
  query: string,
  qLower: string,
): string | null {
  // ---- 文档数量 ----
  if (matchAny(qLower, ['多少篇文档', '多少文档', '文档数量', '文档总数', '几篇文档', 'how many doc', 'document count'])) {
    const sections = store.listSections();
    const bySection: Record<string, number> = {};
    for (const s of sections) {
      bySection[s.section] = (bySection[s.section] || 0) + 1;
    }
    let detail = Object.entries(bySection)
      .sort((a, b) => b[1] - a[1])
      .map(([sec, cnt]) => `  • ${sec}: ${cnt} 篇`)
      .join('\n');
    return `📊 项目 **${projectName}** 共有 **${sections.length}** 篇文档。\n\n按类型分布：\n${detail}`;
  }

  // ---- 项目进度 ----
  if (matchAny(qLower, ['项目进度', '完成进度', '整体进度', '完成率', '完成了多少', '进展如何', 'progress', 'how much done'])) {
    const progress = store.getProgress();
    const tasks = progress.tasks || [];
    const completed = tasks.filter((t: any) => t.status === 'completed').length;
    const inProgress = tasks.filter((t: any) => t.status === 'in_progress').length;
    const pending = tasks.filter((t: any) => t.status === 'pending').length;
    return `📊 项目 **${projectName}** 整体进度：**${progress.overallPercent || 0}%**\n\n` +
      `• 主任务总数: ${progress.mainTaskCount || 0}\n` +
      `• ✅ 已完成: ${completed}\n` +
      `• 🔄 进行中: ${inProgress}\n` +
      `• ⬜ 待开始: ${pending}\n` +
      `• 子任务: ${progress.completedSubTasks || 0} / ${progress.subTaskCount || 0} 已完成`;
  }

  // ---- 主任务/阶段列表 ----
  if (matchAny(qLower, ['有哪些阶段', '有多少阶段', '阶段列表', '任务列表', '所有阶段', 'phase list', 'all phases', '有多少个phase'])) {
    const progress = store.getProgress();
    const tasks = progress.tasks || [];
    const statusIcon = (s: string) => s === 'completed' ? '✅' : s === 'in_progress' ? '🔄' : '⬜';
    let lines = tasks.map((t: any) =>
      `  ${statusIcon(t.status)} ${t.taskId}: ${t.title} (${t.completed}/${t.total})`
    ).join('\n');
    return `📋 项目 **${projectName}** 共有 **${tasks.length}** 个开发阶段：\n\n${lines}`;
  }

  // ---- 模块列表 ----
  if (matchAny(qLower, ['有哪些模块', '模块列表', '功能模块', 'module list', 'all modules', '有多少模块'])) {
    const modules = store.listModules();
    if (modules.length === 0) {
      return `📦 项目 **${projectName}** 暂未定义功能模块。`;
    }
    let lines = modules.map((m: any) =>
      `  • **${m.name}** (${m.moduleId}) — ${m.status} | ${m.completedSubTaskCount || 0}/${m.subTaskCount || 0} 子任务`
    ).join('\n');
    return `📦 项目 **${projectName}** 共有 **${modules.length}** 个功能模块：\n\n${lines}`;
  }

  // ---- 最近完成/更新 ----
  if (matchAny(qLower, ['最近完成', '最近更新', '最新完成', '最新的文档', '最新文档', 'recently completed', 'latest update'])) {
    const sections = store.listSections();
    const sorted = [...sections]
      .filter((s: any) => s.updatedAt)
      .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 8);
    if (sorted.length === 0) {
      return `📄 暂无文档更新记录。`;
    }
    let lines = sorted.map((s: any) => {
      const d = new Date(s.updatedAt);
      const dateStr = `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
      return `  • [${dateStr}] **${s.title}** (${s.section}${s.subSection ? '|' + s.subSection : ''})`;
    }).join('\n');
    return `📄 最近更新的文档：\n\n${lines}`;
  }

  // ---- 项目名称/是什么项目 ----
  if (matchAny(qLower, ['什么项目', '项目介绍', '项目名称', '这是什么', 'what project', 'project name', '项目是什么'])) {
    const sections = store.listSections();
    const progress = store.getProgress();
    const modules = store.listModules();
    return `📌 当前项目: **${projectName}**\n\n` +
      `• 文档总数: ${sections.length} 篇\n` +
      `• 开发阶段: ${progress.mainTaskCount || 0} 个 (${progress.overallPercent || 0}% 完成)\n` +
      `• 功能模块: ${modules.length} 个\n` +
      `• 子任务: ${progress.completedSubTasks || 0} / ${progress.subTaskCount || 0}\n\n` +
      `💡 你可以问我关于文档内容的问题，我会在文档库中搜索相关内容。`;
  }

  // ---- 搜索能力说明 ----
  if (matchAny(qLower, ['你能做什么', '你会什么', '怎么用', '使用说明', 'help', '帮助', '功能介绍'])) {
    const isSemanticEnabled = store.isSemanticSearchEnabled?.() || false;
    return `🤖 我是 **DevPlan 文档助手**，可以帮你：\n\n` +
      `📊 **回答项目统计问题**\n` +
      `  例如: "有多少篇文档"、"项目进度"、"有哪些阶段"\n\n` +
      `🔍 **搜索文档内容**\n` +
      `  例如: "向量搜索"、"GPU 加速"、"aifastdb vs LanceDB"\n` +
      `  搜索模式: ${isSemanticEnabled ? '语义+字面混合搜索 (Candle MiniLM)' : '字面匹配'}\n\n` +
      `📄 **查看文档**\n` +
      `  点击搜索结果卡片可直接查看完整文档\n\n` +
      `⚠️ 注意: 我没有 LLM 推理能力，无法"理解"和"推理"，` +
      `只能做文档检索和元信息查询。对于复杂问题建议直接搜索关键词。`;
  }

  return null; // 不是元信息问题，继续搜索流程
}

/** 检查 query 是否匹配任意关键词模式 */
function matchAny(qLower: string, patterns: string[]): boolean {
  return patterns.some(p => qLower.includes(p));
}

/**
 * 读取 HTTP POST 请求体并解析为 JSON
 */
function readRequestBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => {
      if (!data) { resolve({}); return; }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function startServer(projectName: string, basePath: string, port: number): void {
  const htmlContent = getVisualizationHTML(projectName);
  const graphCanvasJs = getGraphCanvasScript();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
        case '/graph':
        case '/stats':
        case '/docs':
        case '/memory':
        case '/md-viewer':
        case '/settings':
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
          // 项目图谱页面默认不渲染 Prompt 节点（通过顶部统计栏点击查看 Prompt 列表）
          const includePrompts = url.searchParams.get('includePrompts') === 'true';
          // Phase-68: 项目图谱页面默认不加载记忆节点，勾选记忆复选框后才加载
          const includeMemories = url.searchParams.get('includeMemories') !== 'false';

          if (store.exportGraph) {
            const graph = store.exportGraph({
              includeDocuments,
              includeModules,
              includeNodeDegree,
              enableBackendDegreeFallback,
              includePrompts,
              includeMemories,
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
          // 附加模块和文档计数（分层加载模式下 graph.nodes 不含全部类型，需从此处获取真实数量）
          const sections = store.listSections();
          const modules = store.listModules();
          // 附加 Prompt 计数
          let promptCount = 0;
          try {
            if (typeof store.listPrompts === 'function') {
              promptCount = store.listPrompts().length;
            }
          } catch (e) { /* listPrompts 不支持时忽略 */ }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            ...progress,
            moduleCount: modules.length,
            docCount: sections.length,
            promptCount,
          }));
          break;
        }

        case '/api/prompts': {
          // 列出所有 Prompt 日志
          const store = createFreshStore(projectName, basePath);
          let prompts: any[] = [];
          try {
            if (typeof store.listPrompts === 'function') {
              prompts = store.listPrompts();
            }
          } catch (e) {
            prompts = [];
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ prompts, count: prompts.length }));
          break;
        }

        case '/api/main-task': {
          // 获取单条主任务最新数据（用于主任务弹层行内刷新）
          const store = createFreshStore(projectName, basePath);
          const taskId = url.searchParams.get('taskId');
          if (!taskId) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少 taskId 参数' }));
            break;
          }

          const mainTask = store.getMainTask(taskId);
          if (!mainTask) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: `主任务 "${taskId}" 未找到` }));
            break;
          }

          const subTasks = store.listSubTasks(taskId).map((s: any) => ({
            taskId: s.taskId,
            title: s.title,
            status: s.status,
            completedAt: s.completedAt || null,
          }));
          const completedSubtasks = subTasks.filter((s: any) => s.status === 'completed').length;
          const relatedDocs = typeof (store as any).getTaskRelatedDocs === 'function'
            ? (store as any).getTaskRelatedDocs(taskId).map((d: any) => ({
              id: d.id,
              section: d.section,
              subSection: d.subSection || null,
              title: d.title,
            }))
            : [];

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            taskId: mainTask.taskId,
            title: mainTask.title,
            status: mainTask.status,
            totalSubtasks: subTasks.length,
            completedSubtasks,
            completedAt: (mainTask as any).completedAt || null,
            subTasks,
            relatedDocs,
          }));
          break;
        }

        case '/api/main-task/status': {
          // 手动更新主任务状态（仅允许 pending -> completed/cancelled）
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }
          const body = await readRequestBody(req);
          const taskId = body?.taskId;
          const targetStatus = body?.status;
          if (!taskId || !targetStatus) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少 taskId 或 status 参数' }));
            break;
          }
          if (targetStatus !== 'completed' && targetStatus !== 'cancelled') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'status 仅支持 completed 或 cancelled' }));
            break;
          }

          const store = createFreshStore(projectName, basePath);
          const mainTask = store.getMainTask(taskId);
          if (!mainTask) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: `主任务 "${taskId}" 未找到` }));
            break;
          }
          if (mainTask.status !== 'pending') {
            res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: `仅待开始(pending)任务可手动标记，当前状态为 ${mainTask.status}` }));
            break;
          }

          store.updateMainTaskStatus(taskId, targetStatus);
          const updated = store.getMainTask(taskId);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            taskId,
            status: (updated as any)?.status || targetStatus,
          }));
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

        case '/api/memories': {
          // 列出所有记忆（用于记忆浏览页面）
          const memStore = createFreshStore(projectName, basePath);
          let memories: any[] = [];
          if (typeof (memStore as any).listMemories === 'function') {
            const memoryType = url.searchParams.get('memoryType') || undefined;
            memories = (memStore as any).listMemories({
              memoryType,
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ memories }));
          break;
        }

        case '/api/memories/generate': {
          // 从文档/任务中生成记忆候选项
          const genStore = createFreshStore(projectName, basePath);
          if (typeof (genStore as any).generateMemoryCandidates !== 'function') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'generateMemoryCandidates not supported (requires graph engine)' }));
            break;
          }
          const genSource = url.searchParams.get('source') || 'both';
          const genTaskId = url.searchParams.get('taskId') || undefined;
          const genSection = url.searchParams.get('section') || undefined;
          const rawLimit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : 50;
          const genLimit = rawLimit <= 0 ? 99999 : rawLimit;

          const result = (genStore as any).generateMemoryCandidates({
            source: genSource,
            taskId: genTaskId,
            section: genSection,
            limit: genLimit,
          });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(result));
          break;
        }

        case '/api/memories/save': {
          // 保存一条记忆（POST）
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }
          const saveBody = await readRequestBody(req);
          const saveStore = createFreshStore(projectName, basePath);
          if (typeof (saveStore as any).saveMemory !== 'function') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'saveMemory not supported (requires graph engine)' }));
            break;
          }
          try {
            const saved = (saveStore as any).saveMemory({
              projectName,
              memoryType: saveBody.memoryType || 'insight',
              content: saveBody.content || '',
              tags: saveBody.tags || [],
              relatedTaskId: saveBody.relatedTaskId || undefined,
              sourceRef: saveBody.sourceRef || undefined,
              provenance: saveBody.provenance || undefined,
              importance: saveBody.importance ?? 0.5,
            });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ status: 'saved', memory: saved }));
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
          break;
        }

        case '/api/memories/relate': {
          // Phase-44: 建立记忆间关系（POST）
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }
          const relBody = await readRequestBody(req);
          const relStore = createFreshStore(projectName, basePath);
          try {
            // 使用 graph 的 put_relation 或 applyMutations 建立关系
            const graph = (relStore as any).graph;
            if (!graph) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: 'Graph engine not available' }));
              break;
            }
            const fromId = relBody.fromId;
            const toId = relBody.toId;
            const relationType = relBody.relationType || 'MEMORY_RELATES';
            const weight = relBody.weight ?? 0.5;

            // 尝试使用 applyMutations (Phase-44)，回退到 putRelation
            if (typeof graph.applyMutations === 'function') {
              graph.applyMutations([{
                type: 'PutRelation',
                relation: {
                  source_id: fromId,
                  target_id: toId,
                  relation_type: relationType,
                  weight: weight,
                }
              }]);
            } else if (typeof graph.putRelation === 'function') {
              graph.putRelation({
                source_id: fromId,
                target_id: toId,
                relation_type: relationType,
                weight: weight,
              });
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: 'No relation creation method available' }));
              break;
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ status: 'created', from: fromId, to: toId, relationType, weight }));
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
          break;
        }

        case '/api/memories/clear': {
          // 批量清除所有记忆（POST）
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }
          const clearBody = await readRequestBody(req);
          if (clearBody.confirm !== true) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Safety guard: confirm must be true' }));
            break;
          }
          const clearStore = createFreshStore(projectName, basePath);
          if (typeof (clearStore as any).clearAllMemories !== 'function') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'clearAllMemories not supported (requires graph engine)' }));
            break;
          }
          try {
            const clearResult = (clearStore as any).clearAllMemories(clearBody.memoryType || undefined);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ status: 'cleared', ...clearResult, memoryType: clearBody.memoryType || 'all' }));
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
          break;
        }

        // [Phase-77: /api/memories/graph route removed — memory page now list-only]

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
            parentDoc: s.parentDoc || null,
            childDocs: s.childDocs || [],
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

        case '/api/doc/save': {
          // POST /api/doc/save — 保存/更新文档片段（upsert 语义）
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }

          const docBody = await readRequestBody(req);
          if (!docBody || !docBody.section || !docBody.title || !docBody.content) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少必需参数: section, title, content' }));
            break;
          }

          try {
            const docStore = createFreshStore(projectName, basePath);
            const docId = docStore.saveSection({
              projectName,
              section: docBody.section,
              title: docBody.title,
              content: docBody.content,
              version: docBody.version || '1.0.0',
              subSection: docBody.subSection || undefined,
              moduleId: docBody.moduleId || undefined,
              parentDoc: docBody.parentDoc || undefined,
            });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, id: docId, message: '文档已保存' }));
          } catch (saveErr: any) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '保存文档失败: ' + (saveErr.message || String(saveErr)) }));
          }
          break;
        }

        case '/api/doc/add': {
          // POST /api/doc/add — 新增文档片段（insert 语义，已存在则报错 409）
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }

          const addDocBody = await readRequestBody(req);
          if (!addDocBody || !addDocBody.section || !addDocBody.title || !addDocBody.content) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少必需参数: section, title, content' }));
            break;
          }

          try {
            const addDocStore = createFreshStore(projectName, basePath);
            const addDocId = addDocStore.addSection({
              projectName,
              section: addDocBody.section,
              title: addDocBody.title,
              content: addDocBody.content,
              version: addDocBody.version || '1.0.0',
              subSection: addDocBody.subSection || undefined,
              moduleId: addDocBody.moduleId || undefined,
              parentDoc: addDocBody.parentDoc || undefined,
            });
            res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, id: addDocId, message: '文档已新增' }));
          } catch (addErr: any) {
            // 区分"已存在"错误（409）和其他错误（500）
            const isConflict = addErr.message && addErr.message.includes('已存在');
            res.writeHead(isConflict ? 409 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: addErr.message || String(addErr), conflict: isConflict }));
          }
          break;
        }

        case '/api/doc/delete': {
          // POST /api/doc/delete — 删除文档片段
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }

          const delDocBody = await readRequestBody(req);
          if (!delDocBody || !delDocBody.section) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少必需参数: section' }));
            break;
          }

          try {
            const delDocStore = createFreshStore(projectName, basePath);
            const deleted = delDocStore.deleteSection(delDocBody.section, delDocBody.subSection || undefined);
            if (deleted) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ success: true, message: '文档已删除' }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: '文档未找到或删除失败' }));
            }
          } catch (delErr: any) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '删除文档失败: ' + (delErr.message || String(delErr)) }));
          }
          break;
        }

        case '/api/chat': {
          // POST /api/chat — 智能文档对话（元信息问答 + 语义搜索 + 分数过滤）
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }

          const body = await readRequestBody(req);
          const query = body?.query;
          if (!query || typeof query !== 'string' || query.trim().length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少 query 参数' }));
            break;
          }

          const store = createFreshStore(projectName, basePath);
          const q = query.trim();
          const qLower = q.toLowerCase();

          // ================================================================
          // 第一步：检测元信息问题，直接回答
          // ================================================================
          const metaAnswer = detectMetaQuestion(store, projectName, q, qLower);
          if (metaAnswer) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              query: q,
              type: 'meta',
              answer: metaAnswer,
            }));
            break;
          }

          // ================================================================
          // 第二步：文档内容搜索（带分数过滤）
          // ================================================================
          const limit = body.limit || 5;
          const MIN_SCORE = 0.03; // 低于此分数视为不相关

          let results: any[] = [];
          let searchMode = 'literal';
          if (store.searchSectionsAdvanced) {
            const isSemanticEnabled = store.isSemanticSearchEnabled?.() || false;
            searchMode = isSemanticEnabled ? 'hybrid' : 'literal';
            const hits = store.searchSectionsAdvanced(q, {
              mode: searchMode as any,
              limit: limit * 2, // 多取一些，后面过滤
              minScore: 0,
            });
            results = hits
              .filter((doc: any) => doc.score == null || doc.score >= MIN_SCORE)
              .slice(0, limit)
              .map((doc: any) => ({
                section: doc.section,
                subSection: doc.subSection || null,
                title: doc.title,
                score: doc.score != null ? Math.round(doc.score * 1000) / 1000 : null,
                snippet: (doc.content || '').substring(0, 300).replace(/\n/g, ' ').trim(),
                updatedAt: doc.updatedAt || null,
                version: doc.version || null,
              }));
          } else {
            const hits = store.searchSections(q, limit);
            results = hits.map((doc: any) => ({
              section: doc.section,
              subSection: doc.subSection || null,
              title: doc.title,
              score: null,
              snippet: (doc.content || '').substring(0, 300).replace(/\n/g, ' ').trim(),
              updatedAt: doc.updatedAt || null,
              version: doc.version || null,
            }));
          }

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            query: q,
            type: 'search',
            mode: searchMode,
            count: results.length,
            results,
          }));
          break;
        }

        // ================================================================
        // Autopilot API Endpoints (/api/auto/*)
        // ================================================================

        case '/api/auto/next-action': {
          // GET /api/auto/next-action — 获取下一步该执行什么动作（executor 轮询）
          const store = createFreshStore(projectName, basePath);
          const nextAction = getAutopilotNextAction(store);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(nextAction));
          break;
        }

        case '/api/auto/current-phase': {
          // GET /api/auto/current-phase — 获取当前进行中阶段及全部子任务状态
          const store = createFreshStore(projectName, basePath);
          const status = getAutopilotStatus(store);

          if (!status.hasActivePhase || !status.activePhase) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              hasActivePhase: false,
              message: '当前无进行中的阶段',
            }));
            break;
          }

          // 获取活跃阶段的全部子任务详情
          const subTasks = store.listSubTasks(status.activePhase.taskId).map((s: any) => ({
            taskId: s.taskId,
            title: s.title,
            status: s.status,
            description: s.description || null,
            order: s.order,
            completedAt: s.completedAt || null,
          }));

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            hasActivePhase: true,
            activePhase: status.activePhase,
            currentSubTask: status.currentSubTask || null,
            nextPendingSubTask: status.nextPendingSubTask || null,
            subTasks,
          }));
          break;
        }

        case '/api/auto/complete-task': {
          // POST /api/auto/complete-task — 标记子任务完成
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }

          const body = await readRequestBody(req);
          const taskId = body?.taskId;
          if (!taskId || typeof taskId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少 taskId 参数' }));
            break;
          }

          const store = createFreshStore(projectName, basePath);
          try {
            const result = store.completeSubTask(taskId);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: true,
              subTask: {
                taskId: result.subTask.taskId,
                title: result.subTask.title,
                status: result.subTask.status,
              },
              mainTask: {
                taskId: result.mainTask.taskId,
                title: result.mainTask.title,
                status: result.mainTask.status,
                totalSubtasks: result.mainTask.totalSubtasks,
                completedSubtasks: result.mainTask.completedSubtasks,
              },
              mainTaskCompleted: result.mainTaskCompleted,
              completedAtCommit: result.completedAtCommit || null,
            }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message || String(err) }));
          }
          break;
        }

        case '/api/auto/start-phase': {
          // POST /api/auto/start-phase — 启动新阶段
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }

          const body = await readRequestBody(req);
          const taskId = body?.taskId;
          if (!taskId || typeof taskId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少 taskId 参数' }));
            break;
          }

          const store = createFreshStore(projectName, basePath);
          const mainTask = store.getMainTask(taskId);
          if (!mainTask) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: `主任务 "${taskId}" 不存在` }));
            break;
          }

          // 标记为 in_progress（幂等）
          if (mainTask.status === 'pending') {
            store.updateMainTaskStatus(taskId, 'in_progress');
          }

          const subTasks = store.listSubTasks(taskId).map((s: any) => ({
            taskId: s.taskId,
            title: s.title,
            status: s.status,
            description: s.description || null,
            order: s.order,
          }));

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            mainTask: {
              taskId: mainTask.taskId,
              title: mainTask.title,
              status: 'in_progress',
              totalSubtasks: subTasks.length,
              completedSubtasks: subTasks.filter((s: any) => s.status === 'completed').length,
            },
            subTasks,
            message: `阶段 ${taskId} 已启动，共 ${subTasks.length} 个子任务`,
          }));
          break;
        }

        case '/api/auto/heartbeat': {
          // POST /api/auto/heartbeat — executor 心跳上报
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }

          const body = await readRequestBody(req);
          if (!body?.executorId || !body?.status) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少 executorId 或 status 参数' }));
            break;
          }

          const heartbeat: ExecutorHeartbeat = {
            executorId: body.executorId,
            status: body.status,
            lastScreenState: body.lastScreenState || undefined,
            timestamp: body.timestamp || Date.now(),
          };

          recordHeartbeat(projectName, heartbeat);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            receivedAt: Date.now(),
            message: `心跳已接收: executor=${heartbeat.executorId}, status=${heartbeat.status}`,
          }));
          break;
        }

        case '/api/auto/status': {
          // GET /api/auto/status — 获取完整的 autopilot 状态（含心跳信息）
          const store = createFreshStore(projectName, basePath);
          const status = getAutopilotStatus(store);
          const heartbeatInfo = getLastHeartbeat(projectName);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            ...status,
            executor: {
              lastHeartbeat: heartbeatInfo.heartbeat,
              receivedAt: heartbeatInfo.receivedAt || null,
              isAlive: heartbeatInfo.isAlive,
            },
          }));
          break;
        }

        // ==================================================================
        // Autopilot API Endpoints (/api/auto/*)
        // ==================================================================

        case '/api/auto/next-action': {
          // GET — 获取下一步该执行什么动作（供 executor 轮询）
          const store = createFreshStore(projectName, basePath);
          const nextAction = getAutopilotNextAction(store);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(nextAction));
          break;
        }

        case '/api/auto/current-phase': {
          // GET — 获取当前进行中阶段及全部子任务状态
          const store = createFreshStore(projectName, basePath);
          const status = getAutopilotStatus(store);

          if (!status.hasActivePhase || !status.activePhase) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              hasActivePhase: false,
              message: '当前没有进行中的阶段',
            }));
            break;
          }

          // 获取活跃阶段的全部子任务详情
          const subTasks = store.listSubTasks(status.activePhase.taskId);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            hasActivePhase: true,
            phase: status.activePhase,
            currentSubTask: status.currentSubTask || null,
            nextPendingSubTask: status.nextPendingSubTask || null,
            subTasks: subTasks.map(s => ({
              taskId: s.taskId,
              title: s.title,
              status: s.status,
              description: s.description,
              order: s.order,
              completedAt: s.completedAt,
            })),
          }));
          break;
        }

        case '/api/auto/complete-task': {
          // POST — 标记子任务完成
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }
          const body = await readRequestBody(req);
          const { taskId } = body;
          if (!taskId || typeof taskId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少 taskId 参数' }));
            break;
          }
          const store = createFreshStore(projectName, basePath);
          try {
            const result = store.completeSubTask(taskId);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              success: true,
              taskId,
              mainTaskCompleted: result.mainTaskCompleted,
              completedAtCommit: result.completedAtCommit || null,
              mainTask: {
                taskId: result.mainTask.taskId,
                title: result.mainTask.title,
                totalSubtasks: result.mainTask.totalSubtasks,
                completedSubtasks: result.mainTask.completedSubtasks,
                status: result.mainTask.status,
              },
            }));
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message || String(err) }));
          }
          break;
        }

        case '/api/auto/start-phase': {
          // POST — 启动新阶段
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }
          const body = await readRequestBody(req);
          const { taskId } = body;
          if (!taskId || typeof taskId !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '缺少 taskId 参数' }));
            break;
          }
          const store = createFreshStore(projectName, basePath);
          const mainTask = store.getMainTask(taskId);
          if (!mainTask) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: `主任务 "${taskId}" 未找到` }));
            break;
          }
          if (mainTask.status === 'pending') {
            store.updateMainTaskStatus(taskId, 'in_progress');
          }
          const subTasks = store.listSubTasks(taskId);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            phase: {
              taskId: mainTask.taskId,
              title: mainTask.title,
              status: 'in_progress',
              totalSubtasks: subTasks.length,
              completedSubtasks: subTasks.filter(s => s.status === 'completed').length,
            },
            subTasks: subTasks.map(s => ({
              taskId: s.taskId,
              title: s.title,
              status: s.status,
              description: s.description,
              order: s.order,
            })),
          }));
          break;
        }

        case '/api/auto/heartbeat': {
          // POST — executor 心跳上报
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }
          const body = await readRequestBody(req);
          const heartbeat: ExecutorHeartbeat = {
            executorId: body.executorId || 'unknown',
            status: body.status || 'active',
            lastScreenState: body.lastScreenState,
            timestamp: body.timestamp || Date.now(),
          };
          recordHeartbeat(projectName, heartbeat);
          const hbInfo = getLastHeartbeat(projectName);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            received: heartbeat,
            isAlive: hbInfo.isAlive,
          }));
          break;
        }

        case '/api/graph/paged': {
          // ── Phase-9 T9.2: True pagination push-down to Rust layer ──
          // GET /api/graph/paged?offset=0&limit=5000
          // Returns a page of { nodes, edges, totalNodes, totalEdges, hasMore }
          // Now calls Rust SocialGraphV2.exportGraphPaginated() via NAPI
          // instead of full-loading + in-memory slicing.
          const pagedStore = createFreshStore(projectName, basePath);
          const offset = parseInt(url.searchParams.get('offset') || '0', 10);
          const limit = parseInt(url.searchParams.get('limit') || '5000', 10);
          const includeDocuments = url.searchParams.get('includeDocuments') !== 'false';
          const includeModules = url.searchParams.get('includeModules') !== 'false';
          // Phase-10 T10.1: Support entityTypes query param for tiered loading
          const entityTypesParam = url.searchParams.get('entityTypes');
          const entityTypes = entityTypesParam ? entityTypesParam.split(',').map(t => t.trim()).filter(Boolean) : undefined;

          // Use the new pagination push-down method if available
          if ((pagedStore as any).exportGraphPaginated) {
            try {
              const result = (pagedStore as any).exportGraphPaginated(offset, limit, {
                includeDocuments,
                includeModules,
                includeNodeDegree: true,
                entityTypes,
              });

              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({
                nodes: result.nodes,
                edges: result.edges,
                total: result.totalNodes,
                totalEdges: result.totalEdges,
                offset: result.offset,
                limit: result.limit,
                hasMore: result.hasMore,
                nextOffset: Math.min(offset + limit, result.totalNodes),
              }));
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: `分页导出失败: ${err?.message || err}` }));
            }
          } else if (pagedStore.exportGraph) {
            // Fallback: full load + in-memory slicing (pre-Phase-9 behavior)
            const fullGraph = pagedStore.exportGraph({
              includeDocuments,
              includeModules,
              includeNodeDegree: true,
              enableBackendDegreeFallback: true,
            });
            if (!fullGraph) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: '图数据导出失败' }));
              break;
            }

            const allNodes: any[] = fullGraph.nodes || [];
            const allEdges: any[] = fullGraph.edges || [];
            const pageNodes = allNodes.slice(offset, offset + limit);
            const pageNodeIds = new Set(pageNodes.map((n: any) => n.id));
            const pageEdges = allEdges.filter(
              (e: any) => pageNodeIds.has(e.from) && pageNodeIds.has(e.to)
            );

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              nodes: pageNodes,
              edges: pageEdges,
              total: allNodes.length,
              totalEdges: allEdges.length,
              offset,
              limit,
              hasMore: offset + limit < allNodes.length,
              nextOffset: Math.min(offset + limit, allNodes.length),
            }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '当前引擎不支持图导出' }));
          }
          break;
        }

        case '/api/graph/binary': {
          // ── Phase-9 T9.3: Binary compact export endpoint ──
          // GET /api/graph/binary
          // Returns ArrayBuffer with compact binary format (5x smaller than JSON)
          // Client can parse directly as TypedArray, no JSON.parse needed.
          const binaryStore = createFreshStore(projectName, basePath);
          if ((binaryStore as any).exportGraphCompact) {
            try {
              const buf = (binaryStore as any).exportGraphCompact();
              if (buf && buf.length > 0) {
                res.writeHead(200, {
                  'Content-Type': 'application/octet-stream',
                  'Content-Length': String(buf.length),
                  'X-Node-Count': String(new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(8, true)),
                  'X-Edge-Count': String(new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(12, true)),
                });
                res.end(buf);
              } else {
                // Fallback: return empty binary
                const emptyBuf = Buffer.alloc(16);
                emptyBuf.writeUInt32LE(0x41494647, 0); // magic
                emptyBuf.writeUInt32LE(1, 4);           // version
                emptyBuf.writeUInt32LE(0, 8);           // node_count
                emptyBuf.writeUInt32LE(0, 12);          // edge_count
                res.writeHead(200, {
                  'Content-Type': 'application/octet-stream',
                  'Content-Length': '16',
                  'X-Node-Count': '0',
                  'X-Edge-Count': '0',
                });
                res.end(emptyBuf);
              }
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: `二进制导出失败: ${err?.message || err}` }));
            }
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '当前引擎不支持二进制导出' }));
          }
          break;
        }

        case '/api/graph/clusters': {
          // ── Phase-9 T9.4: Server-side aggregation endpoint ──
          // GET /api/graph/clusters
          // Returns pre-aggregated entity group summaries.
          // Ideal for low-zoom cluster views — no need to transfer all nodes.
          const clusterStore = createFreshStore(projectName, basePath);
          if ((clusterStore as any).getEntityGroupSummary) {
            try {
              const agg = (clusterStore as any).getEntityGroupSummary();
              if (agg) {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(agg));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ groups: [], totalEntities: 0, totalRelations: 0 }));
              }
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: `聚合查询失败: ${err?.message || err}` }));
            }
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '当前引擎不支持聚合查询' }));
          }
          break;
        }

        case '/graph-canvas.js': {
          // Serve the GraphCanvas engine as a JavaScript file
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          });
          res.end(graphCanvasJs);
          break;
        }

        case '/api/batch/config': {
          // Phase-60: 获取 LLM 批量生成配置（供浏览器端直连 Ollama）
          const wsConfig = readDevPlanConfig() || {} as any;
          const llmCfg = (wsConfig as any)?.llmAnalyze || {};
          const ollamaBaseUrl = (llmCfg.ollamaBaseUrl || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
          const ollamaModel = llmCfg.ollamaModel || 'gemma3:27b';
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            ollamaBaseUrl,
            ollamaModel,
            systemPrompt: `你是一个记忆构建助手。请根据以下文档/任务内容生成多级记忆。
生成三个层级（必须以 JSON 返回）：
- L1（触点摘要）：一句话概括（15~30字），作为记忆的"入口"或"触点"
- L2（详细记忆）：3~8句话，包含关键技术细节、设计决策、实现方案。要保留重要的技术名词和架构关系
- L3_index（结构索引）：列出主要组件、依赖关系及其作用（如果内容是技术文档）。如果是非技术内容，则提供内容的结构化摘要；若存在原始材料入口（commit/diff/log），请保留这些线索
- memoryType：从 decision/pattern/bugfix/insight/preference/summary 中选择最合适的类型
- importance：重要性评分 0~1
- suggestedTags：建议标签数组
- anchorName：触点名称（该记忆关联的核心概念/模块/功能）
- anchorType：触点类型（module/concept/api/architecture/feature/library/protocol）
- anchorOverview：触点概览（3~5句话的目录索引式摘要，列出该触点包含的关键子项、核心 Flow 条目、主要结构组件等。类似文件夹的 README，帮助 Agent 快速判断是否需要深入查看详情）

请严格以 JSON 格式返回：
{"L1": "...", "L2": "...", "L3_index": "...", "memoryType": "...", "importance": 0.7, "suggestedTags": [...], "anchorName": "...", "anchorType": "...", "anchorOverview": "..."}`,
          }));
          break;
        }

        case '/api/batch/save': {
          // Phase-60: 批量保存一条带 L1/L2/L3 的记忆（浏览器端 LLM 生成后调用）
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }
          const batchSaveBody = await readRequestBody(req);
          const batchSaveStore = createFreshStore(projectName, basePath);
          if (typeof (batchSaveStore as any).saveMemory !== 'function') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'saveMemory not supported (requires graph engine)' }));
            break;
          }
          try {
            const saved = (batchSaveStore as any).saveMemory({
              projectName,
              memoryType: batchSaveBody.memoryType || 'insight',
              content: batchSaveBody.content || '',
              tags: batchSaveBody.tags || [],
              relatedTaskId: batchSaveBody.relatedTaskId || undefined,
              sourceRef: batchSaveBody.sourceRef || undefined,
              provenance: batchSaveBody.provenance || undefined,
              importance: batchSaveBody.importance ?? 0.5,
              source: 'batch_import_ui',
              contentL1: batchSaveBody.contentL1 || undefined,
              contentL2: batchSaveBody.contentL2 || undefined,
              contentL3: batchSaveBody.contentL3 || undefined,
              anchorName: batchSaveBody.anchorName || undefined,
              anchorType: batchSaveBody.anchorType || undefined,
              anchorOverview: batchSaveBody.anchorOverview || undefined,
              changeType: batchSaveBody.changeType || undefined,
            });
            // Phase-78B: shutdown 确保 HNSW 向量索引持久化到磁盘
            const batchGraph = (batchSaveStore as any).graph;
            if (batchGraph && typeof batchGraph.shutdown === 'function') {
              batchGraph.shutdown();
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ status: 'saved', memory: saved }));
          } catch (e: any) {
            // 即使出错也尝试 shutdown
            try {
              const errGraph = (batchSaveStore as any).graph;
              if (errGraph && typeof errGraph.shutdown === 'function') errGraph.shutdown();
            } catch { /* ignore */ }
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
          break;
        }

        case '/api/batch/verify': {
          // Phase-69/78/100: 记忆完整性检测端点（支持 sourceRefs / memoryIds / checkAll）
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }
          const verifyBody = await readRequestBody(req);
          const verifySourceRefs: string[] = verifyBody.sourceRefs || [];
          const verifyMemoryIds: string[] = verifyBody.memoryIds || [];
          const verifyAll: boolean = verifyBody.checkAll === true;  // Phase-78: 全量检测模式

          if (verifySourceRefs.length === 0 && verifyMemoryIds.length === 0 && !verifyAll) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Missing required: sourceRefs, memoryIds, or checkAll=true' }));
            break;
          }

          const verifyStore = createFreshStore(projectName, basePath);
          if (typeof (verifyStore as any).listMemories !== 'function') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'listMemories not supported (requires graph engine)' }));
            break;
          }

          try {
            // 获取所有记忆
            const allMemories: any[] = (verifyStore as any).listMemories({});
            const g = (verifyStore as any).graph;
            const synapse = (verifyStore as any).synapse;

            // Phase-78C: 诊断信息收集
            const vectorCount = (g && typeof g.vectorCount === 'function') ? g.vectorCount() : -1;
            const vectorDim = (g && typeof g.vectorDimension === 'function') ? g.vectorDimension() : null;
            const semanticSearchReady = !!(verifyStore as any).semanticSearchReady;
            const synapseAvailable = !!(synapse && typeof synapse.embed === 'function');
            const vectorSearchEnabled = !!(g && typeof g.isVectorSearchEnabled === 'function' && g.isVectorSearchEnabled());

            // Phase-78C: 预构建向量索引中已有向量的 entity ID 集合
            // 修复：probe search 不需要 synapse（probe 向量是手动创建的，不依赖 Ollama）
            // 只需要 searchEntitiesByVector 可用 + vectorSearch 已启用即可
            let embeddingCheckMode: 'search' | 'unavailable' = 'unavailable';
            const indexedEntityIds = new Set<string>();

            if (g && typeof g.searchEntitiesByVector === 'function' && vectorSearchEnabled) {
              try {
                if (vectorDim && vectorDim > 0 && vectorCount > 0) {
                  // 用多个 probe 向量提高覆盖率（HNSW 是近似搜索，单 probe 可能遗漏）
                  const probeVectors: number[][] = [];
                  // Probe 1: [1, 0, 0, ...]
                  const p1 = new Array(vectorDim).fill(0); p1[0] = 1.0;
                  probeVectors.push(p1);
                  // Probe 2: [0, 0, ..., 1]
                  const p2 = new Array(vectorDim).fill(0); p2[vectorDim - 1] = 1.0;
                  probeVectors.push(p2);
                  // Probe 3: 均匀向量 [1/√d, 1/√d, ...]（与所有向量都有一定相似度）
                  const val = 1.0 / Math.sqrt(vectorDim);
                  const p3 = new Array(vectorDim).fill(val);
                  probeVectors.push(p3);

                  const fetchK = Math.max(vectorCount * 2, 2000); // 冗余 k 确保覆盖
                  for (const probe of probeVectors) {
                    const hits = g.searchEntitiesByVector(probe, fetchK);
                    for (const hit of hits) {
                      if (hit.entityId) indexedEntityIds.add(hit.entityId);
                    }
                  }
                  embeddingCheckMode = 'search';
                }
              } catch {
                // 向量搜索不可用
              }
            }

            // 按 sourceRef.sourceId 和 id 建立索引（同源可多条）
            const bySourceRef = new Map<string, any[]>();
            const byId = new Map<string, any>();
            for (const mem of allMemories) {
              const sid = mem.sourceRef?.sourceId;
              if (sid) {
                if (!bySourceRef.has(sid)) bySourceRef.set(sid, []);
                bySourceRef.get(sid)!.push(mem);
              }
              byId.set(mem.id, mem);
            }

            // Phase-78C: 分类警告计数
            let warnEmbedding = 0;
            let warnAnchor = 0;
            let warnImportance = 0;
            let warnContentShort = 0;
            let errContent = 0;
            let errMemoryType = 0;

            // Phase-78/78C: 通用完整性检测函数
            const validTypes = ['decision', 'pattern', 'bugfix', 'insight', 'preference', 'summary'];
            function verifyOneMemory(mem: any): any {
              const issues: string[] = [];
              const warnings: string[] = [];

              // 检测 1: 内容非空
              if (!mem.content || mem.content.trim().length === 0) {
                issues.push('content 字段为空');
                errContent++;
              }

              // 检测 2: Embedding 向量
              let hasEmbedding = false;
              if (embeddingCheckMode === 'search') {
                hasEmbedding = indexedEntityIds.has(mem.id);
              }
              if (embeddingCheckMode === 'search' && !hasEmbedding) {
                warnings.push('未检测到 Embedding 向量');
                warnEmbedding++;
              }

              // 检测 3: Anchor 关联
              let hasAnchor = false;
              if (g && typeof g.outgoingByType === 'function') {
                try {
                  const anchorRels = g.outgoingByType(mem.id, 'anchored_by');
                  hasAnchor = anchorRels && anchorRels.length > 0;
                } catch { /* */ }
              }
              if (!hasAnchor) {
                warnings.push('无 Anchor 触点关联');
                warnAnchor++;
              }

              // 检测 4: memoryType 合法性
              if (!validTypes.includes(mem.memoryType)) {
                issues.push('memoryType 非法: ' + mem.memoryType);
                errMemoryType++;
              }

              // 检测 5: importance 范围
              if (typeof mem.importance !== 'number' || mem.importance < 0 || mem.importance > 1) {
                warnings.push('importance 值异常: ' + mem.importance);
                warnImportance++;
              }

              // 检测 6: 内容长度警告
              if (mem.content && mem.content.length < 20) {
                warnings.push('内容过短（' + mem.content.length + ' 字符）');
                warnContentShort++;
              }

              const status = issues.length > 0 ? 'error' : (warnings.length > 0 ? 'warning' : 'pass');
              return {
                memoryId: mem.id,
                sourceRef: mem.sourceRef?.sourceId || undefined,
                memoryType: mem.memoryType,
                contentLength: mem.content?.length || 0,
                hasEmbedding,
                hasAnchor,
                importance: mem.importance,
                status,
                issues,
                warnings,
              };
            }

            // 检测结果
            const results: any[] = [];
            let totalChecked = 0;
            let totalPassed = 0;
            let totalWarnings = 0;
            let totalErrors = 0;

            // Phase-78: 全量检测模式
            if (verifyAll) {
              for (const mem of allMemories) {
                totalChecked++;
                const result = verifyOneMemory(mem);
                if (result.status === 'pass') totalPassed++;
                else if (result.status === 'warning') totalWarnings++;
                else totalErrors++;
                results.push(result);
              }
            }

            // 检查 sourceRefs
            if (!verifyAll) {
              for (const sourceRef of verifySourceRefs) {
                totalChecked++;
                const mems = bySourceRef.get(sourceRef);
                if (!mems || mems.length === 0) {
                  results.push({ sourceRef, status: 'error', issues: ['记忆不存在（未找到 sourceRef）'], warnings: [] });
                  totalErrors++;
                  continue;
                }
                for (const mem of mems) {
                  const result = verifyOneMemory(mem);
                  result.sourceRef = sourceRef;
                  if (result.status === 'pass') totalPassed++;
                  else if (result.status === 'warning') totalWarnings++;
                  else totalErrors++;
                  results.push(result);
                }
              }
            }

            // Phase-78: memoryIds 分支
            if (!verifyAll && verifySourceRefs.length === 0) {
              for (const memId of verifyMemoryIds) {
                totalChecked++;
                const mem = byId.get(memId);
                if (!mem) {
                  results.push({ memoryId: memId, status: 'error', issues: ['记忆不存在（ID 未找到）'], warnings: [] });
                  totalErrors++;
                  continue;
                }
                const result = verifyOneMemory(mem);
                if (result.status === 'pass') totalPassed++;
                else if (result.status === 'warning') totalWarnings++;
                else totalErrors++;
                results.push(result);
              }
            }

            // Phase-78C: 关闭 verify store 释放资源（不要 shutdown，只读操作不需要持久化）
            // 注意：shutdown 会触发 HNSW 持久化写入，verify 是只读操作不应触发写入
            // 只需让 GC 回收即可

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              status: 'verified',
              summary: {
                total: totalChecked,
                passed: totalPassed,
                warnings: totalWarnings,
                errors: totalErrors,
                vectorCount,
                embeddingCheckMode,
                indexedMemoryCount: embeddingCheckMode === 'search'
                  ? [...indexedEntityIds].filter(id => byId.has(id)).length
                  : undefined,
                // Phase-78C: 分类警告计数 — 让用户明确看到每种问题的数量
                warningBreakdown: {
                  embedding: warnEmbedding,
                  anchor: warnAnchor,
                  importance: warnImportance,
                  contentShort: warnContentShort,
                },
                errorBreakdown: {
                  content: errContent,
                  memoryType: errMemoryType,
                },
              },
              // Phase-78C: 诊断信息 — 帮助定位修复失败的原因
              diagnostics: {
                vectorSearchEnabled,
                semanticSearchReady,
                synapseAvailable,
                vectorCount,
                vectorDimension: vectorDim,
                probeHits: indexedEntityIds.size,
                totalMemories: allMemories.length,
              },
              results,
            }));
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
          break;
        }

        // ======== Phase-78B: 批量修复记忆 ========
        case '/api/batch/repair': {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }
          const repairBody = await readRequestBody(req);
          const fixMemoryTypes: boolean = repairBody.fixMemoryTypes !== false;  // 默认修复
          const rebuildEmbeddings: boolean = repairBody.rebuildEmbeddings !== false;  // 默认修复
          const repairMemoryIds: string[] | undefined = repairBody.memoryIds;  // 可选：指定修复哪些记忆

          const repairStore = createFreshStore(projectName, basePath);
          if (typeof (repairStore as any).listMemories !== 'function') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'listMemories not supported (requires graph engine)' }));
            break;
          }

          try {
            const allMems: any[] = (repairStore as any).listMemories({});
            const rg = (repairStore as any).graph;
            const rSynapse = (repairStore as any).synapse;

            // Phase-78C: 详细诊断信息
            const rSemanticReady = !!(repairStore as any).semanticSearchReady;
            const rSynapseAvail = !!(rSynapse && typeof rSynapse.embed === 'function');
            const rVectorEnabled = !!(rg && typeof rg.isVectorSearchEnabled === 'function' && rg.isVectorSearchEnabled());
            const rVectorDim = (rg && typeof rg.vectorDimension === 'function') ? rg.vectorDimension() : null;
            const vectorCountBefore = (rg && typeof rg.vectorCount === 'function') ? rg.vectorCount() : -1;

            // 非法 memoryType → 合法 memoryType 映射表
            const validMemTypes = ['decision', 'pattern', 'bugfix', 'insight', 'preference', 'summary'];
            const typeMapping: Record<string, string> = {
              'feature': 'insight',
              'architecture': 'decision',
              'api': 'pattern',
              'module': 'summary',
              'concept': 'insight',
              'library': 'insight',
              'protocol': 'pattern',
              'idea': 'insight',
              'todo': 'insight',
              'note': 'insight',
              'reference': 'insight',
              'example': 'pattern',
            };

            // 筛选待修复记忆
            let targetMems = allMems;
            if (repairMemoryIds && repairMemoryIds.length > 0) {
              const idSet = new Set(repairMemoryIds);
              targetMems = allMems.filter(m => idSet.has(m.id));
            }

            let fixedTypeCount = 0;
            let rebuiltEmbeddingCount = 0;
            let failedEmbeddingCount = 0;
            let skippedEmbeddingCount = 0;
            const repairResults: any[] = [];
            let firstEmbedError: string | null = null;

            // Phase-78C: 如果 synapse 不可用但请求了重建 embedding，提前告知
            if (rebuildEmbeddings && !rSynapseAvail) {
              skippedEmbeddingCount = targetMems.length;
              firstEmbedError = 'VibeSynapse 不可用（semanticSearchReady=' + rSemanticReady +
                ', synapseAvailable=' + rSynapseAvail +
                '）。请确保 Ollama 正在运行且 qwen3-embedding:8b 模型已加载。';
            }

            for (const mem of targetMems) {
              const fixes: string[] = [];
              let newType: string | null = null;

              // --- 修复 1: memoryType ---
              if (fixMemoryTypes && !validMemTypes.includes(mem.memoryType)) {
                newType = typeMapping[mem.memoryType] || 'insight';
                const entity = rg.getEntity(mem.id);
                if (entity) {
                  rg.updateEntity(mem.id, {
                    properties: {
                      ...entity.properties,
                      memoryType: newType,
                      updatedAt: Date.now(),
                    },
                  });
                  fixes.push('memoryType: ' + mem.memoryType + ' → ' + newType);
                  fixedTypeCount++;
                }
              }

              // --- 修复 2: Embedding 向量 ---
              if (rebuildEmbeddings && rSynapseAvail && rg) {
                const content = mem.content || '';
                if (content.trim().length > 0) {
                  try {
                    // 先清除旧向量（indexEntity 是幂等的，已有时不更新）
                    if (typeof rg.removeEntityVector === 'function') {
                      try { rg.removeEntityVector(mem.id); } catch { /* 可能没有旧向量 */ }
                    }
                    const embedding = rSynapse.embed(content);
                    rg.indexEntity(mem.id, embedding);
                    fixes.push('Embedding 已重建 (dim=' + embedding.length + ')');
                    rebuiltEmbeddingCount++;
                  } catch (embErr: any) {
                    const errMsg = embErr.message || String(embErr);
                    fixes.push('Embedding 重建失败: ' + errMsg);
                    failedEmbeddingCount++;
                    if (!firstEmbedError) firstEmbedError = errMsg;
                  }
                }
              }

              if (fixes.length > 0) {
                repairResults.push({
                  memoryId: mem.id,
                  memoryType: newType || mem.memoryType,
                  fixes,
                });
              }
            }

            // Phase-78C: 持久化 — flush (WAL) + shutdown (HNSW → vector.wal)
            const vectorCountAfterRepair = (rg && typeof rg.vectorCount === 'function') ? rg.vectorCount() : -1;
            if (rg) {
              if (typeof rg.flush === 'function') rg.flush();
              if (typeof rg.shutdown === 'function') rg.shutdown();
            }

            // Phase-78C: 获取修复后向量计数（新 store 恢复后验证持久化是否成功）
            let vectorCountAfterReload = -1;
            try {
              const checkStore = createFreshStore(projectName, basePath);
              const cg = (checkStore as any).graph;
              if (cg && typeof cg.vectorCount === 'function') {
                vectorCountAfterReload = cg.vectorCount();
              }
              // 不 shutdown，让 GC 回收
            } catch { /* 检查失败不影响结果 */ }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              status: 'repaired',
              summary: {
                totalProcessed: targetMems.length,
                fixedTypes: fixedTypeCount,
                rebuiltEmbeddings: rebuiltEmbeddingCount,
                failedEmbeddings: failedEmbeddingCount,
                skippedEmbeddings: skippedEmbeddingCount,
                totalRepaired: repairResults.length,
                vectorCountBefore,
                vectorCountAfterRepair,
                vectorCountAfterReload,
              },
              // Phase-78C: 修复诊断 — 帮助理解修复是否真正生效
              diagnostics: {
                semanticSearchReady: rSemanticReady,
                synapseAvailable: rSynapseAvail,
                vectorSearchEnabled: rVectorEnabled,
                vectorDimension: rVectorDim,
                firstEmbedError,
              },
              results: repairResults,
            }));
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: e.message || String(e) }));
          }
          break;
        }

        // ======== Phase-111: 批量回填缺失 Anchor 触点 ========
        case '/api/batch/repair-anchor': {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
            break;
          }

          const repairBody = await readRequestBody(req);
          const repairMemoryIds: string[] | undefined = repairBody.memoryIds;
          const dryRun: boolean = repairBody.dryRun === true;

          const repairStore = createFreshStore(projectName, basePath);
          if (typeof (repairStore as any).listMemories !== 'function') {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'listMemories not supported (requires graph engine)' }));
            break;
          }

          try {
            const allMems: any[] = (repairStore as any).listMemories({});
            const rg = (repairStore as any).graph;

            const hasAnchorUpsert = !!(rg && typeof rg.anchorUpsert === 'function');
            const hasAnchorExtract = !!(rg && typeof rg.anchorExtractFromText === 'function');
            const hasFlowAppend = !!(rg && typeof rg.flowAppend === 'function');
            const hasOutgoingByType = !!(rg && typeof rg.outgoingByType === 'function');
            const hasPutRelation = !!(rg && typeof rg.putRelation === 'function');

            if (!hasAnchorUpsert || !hasOutgoingByType || !hasPutRelation) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({
                error: 'Anchor API unavailable in current runtime. Please align aifastdb native module and restart Cursor.',
                diagnostics: {
                  hasAnchorUpsert,
                  hasAnchorExtract,
                  hasFlowAppend,
                  hasOutgoingByType,
                  hasPutRelation,
                },
              }));
              break;
            }

            let targetMems = allMems;
            if (repairMemoryIds && repairMemoryIds.length > 0) {
              const idSet = new Set(repairMemoryIds);
              targetMems = allMems.filter(m => idSet.has(m.id));
            }

            const memoryHasAnchor = (memId: string): boolean => {
              try {
                const rels = rg.outgoingByType(memId, 'anchored_by');
                return !!(rels && rels.length > 0);
              } catch {
                return false;
              }
            };

            const inferAnchor = (mem: any): { anchorName: string; anchorType: string; strategy: string } => {
              const content = String(mem.content || '');
              const contentL3 = String(mem.contentL3 || '');
              const sourceId = mem.sourceRef?.sourceId ? String(mem.sourceRef.sourceId) : '';
              const tags = Array.isArray(mem.tags) ? mem.tags : [];

              if (hasAnchorExtract) {
                try {
                  const extracted = rg.anchorExtractFromText(contentL3 || content);
                  if (Array.isArray(extracted) && extracted.length > 0) {
                    const best = extracted.reduce((a: any, b: any) => (a.confidence || 0) >= (b.confidence || 0) ? a : b);
                    if (best?.name) {
                      return {
                        anchorName: String(best.name),
                        anchorType: String(best.suggested_type || 'concept'),
                        strategy: 'native_extract',
                      };
                    }
                  }
                } catch {
                  // ignore and fallback to heuristics
                }
              }

              if (sourceId) {
                if (!sourceId.startsWith('phase-') && !sourceId.startsWith('T')) {
                  const parts = sourceId.split('|').filter(Boolean);
                  if (parts.length > 0) {
                    const pick = parts.length > 1 ? parts[parts.length - 1] : parts[0];
                    return { anchorName: pick, anchorType: 'concept', strategy: 'sourceRef' };
                  }
                }
              }

              const usefulTag = tags.find((t: string) =>
                typeof t === 'string'
                && t.length >= 3
                && !['summary', 'memory', 'docs', 'task', 'tasks'].includes(t.toLowerCase()));
              if (usefulTag) {
                return { anchorName: usefulTag, anchorType: 'concept', strategy: 'tag' };
              }

              const codeName = content.match(/`([A-Za-z_][A-Za-z0-9_:\\/.-]{2,})`/);
              if (codeName?.[1]) {
                return { anchorName: codeName[1], anchorType: 'api', strategy: 'code_token' };
              }

              const fallback = (sourceId || `memory-${String(mem.id || '').slice(0, 8)}`).slice(0, 60);
              return { anchorName: fallback, anchorType: 'concept', strategy: 'fallback' };
            };

            const missingAnchorMems = targetMems.filter((m) => !memoryHasAnchor(m.id));
            const results: any[] = [];
            let repaired = 0;
            let failed = 0;

            for (const mem of missingAnchorMems) {
              const inferred = inferAnchor(mem);
              const anchorDesc = String(mem.contentL1 || mem.content || inferred.anchorName).replace(/\s+/g, ' ').slice(0, 120);
              if (dryRun) {
                results.push({
                  memoryId: mem.id,
                  sourceRef: mem.sourceRef?.sourceId || undefined,
                  anchorName: inferred.anchorName,
                  anchorType: inferred.anchorType,
                  strategy: inferred.strategy,
                  status: 'would_repair',
                });
                continue;
              }

              try {
                const anchor = rg.anchorUpsert(inferred.anchorName, inferred.anchorType, anchorDesc, undefined);
                rg.putRelation(mem.id, anchor.id, 'anchored_by');

                if (hasFlowAppend) {
                  try {
                    const flowSummary = String(mem.contentL1 || mem.content || inferred.anchorName).replace(/\s+/g, ' ').slice(0, 80);
                    const flowDetail = String(mem.contentL2 || mem.contentL3 || mem.content || '');
                    rg.flowAppend(anchor.id, 'modified', flowSummary, flowDetail, mem.relatedTaskId || null);
                  } catch {
                    // flow append is best-effort
                  }
                }

                repaired++;
                results.push({
                  memoryId: mem.id,
                  sourceRef: mem.sourceRef?.sourceId || undefined,
                  anchorId: anchor.id,
                  anchorName: anchor.name,
                  anchorType: anchor.anchor_type,
                  strategy: inferred.strategy,
                  status: 'repaired',
                });
              } catch (e: any) {
                failed++;
                results.push({
                  memoryId: mem.id,
                  sourceRef: mem.sourceRef?.sourceId || undefined,
                  anchorName: inferred.anchorName,
                  anchorType: inferred.anchorType,
                  strategy: inferred.strategy,
                  status: 'failed',
                  error: e?.message || String(e),
                });
              }
            }

            if (!dryRun && rg && typeof rg.flush === 'function') {
              rg.flush();
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              status: dryRun ? 'dry_run' : 'repaired',
              summary: {
                totalProcessed: targetMems.length,
                missingAnchor: missingAnchorMems.length,
                repaired,
                failed,
                skippedWithAnchor: targetMems.length - missingAnchorMems.length,
              },
              diagnostics: {
                hasAnchorUpsert,
                hasAnchorExtract,
                hasFlowAppend,
              },
              results,
            }));
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: e.message || String(e) }));
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
    console.log('║         DevPlan 项目图谱服务器已启动                    ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  项目:  ${projectName.padEnd(47)}║`);
    console.log(`║  地址:  ${url.padEnd(47)}║`);
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  API 端点:                                              ║');
    console.log(`║    GET  /                      项目图谱页面             ║`);
    console.log(`║    GET  /api/graph             图谱数据 (JSON)          ║`);
    console.log(`║    GET  /api/progress          项目进度 (JSON)          ║`);
    console.log(`║    GET  /api/auto/next-action  下一步动作               ║`);
    console.log(`║    GET  /api/auto/current-phase 当前阶段状态            ║`);
    console.log(`║    POST /api/auto/complete-task 完成子任务              ║`);
    console.log(`║    POST /api/auto/start-phase  启动新阶段               ║`);
    console.log(`║    POST /api/auto/heartbeat    心跳上报                 ║`);
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
