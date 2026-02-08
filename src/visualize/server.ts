#!/usr/bin/env node
/**
 * DevPlan 图可视化 HTTP 服务器
 *
 * 轻量级服务器，使用 Node.js 内置 http 模块，无需 Express/React。
 *
 * 端点：
 * - GET /            — 返回 vis-network 可视化 HTML 页面
 * - GET /api/graph   — 返回 { nodes, edges } JSON 数据
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
    console.error('  aifastdb-devplan-visual --project federation-db --base-path D:/Project/git/ai_db/.devplan');
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

function startServer(store: IDevPlanStore, projectName: string, port: number): void {
  const htmlContent = getVisualizationHTML(projectName);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
          const includeDocuments = url.searchParams.get('includeDocuments') !== 'false';
          const includeModules = url.searchParams.get('includeModules') !== 'false';

          if (store.exportGraph) {
            const graph = store.exportGraph({ includeDocuments, includeModules });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(graph));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '当前引擎不支持图导出' }));
          }
          break;
        }

        case '/api/progress': {
          const progress = store.getProgress();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(progress));
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

  const store = createStore(project, basePath);

  startServer(store, project, port);
}

main();
