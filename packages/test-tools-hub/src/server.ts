#!/usr/bin/env node
import * as http from 'http';
import { URL } from 'url';
import { collectToolStatus } from './monitor';
import { getEnabledTools, loadRegistryFromFile } from './registry';

interface CliArgs {
  port: number;
  registryFile?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let port = 3321;
  let registryFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
        port = Number(args[++i] || 3321);
        break;
      case '--registry':
        registryFile = args[++i];
        break;
      default:
        break;
    }
  }
  return { port, registryFile };
}

function writeJson(res: http.ServerResponse, payload: unknown, code = 200): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload, null, 2));
}

async function createStatusMap(registryFile?: string) {
  const registry = loadRegistryFromFile(registryFile);
  const tools = getEnabledTools(registry);
  const items = await Promise.all(tools.map((t) => collectToolStatus(t)));
  return {
    updatedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
}

function htmlPage(): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>AiFastDb Test Tools Hub</title><style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;margin:16px;background:#0a122a;color:#e8eefc}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #233255;padding:8px;font-size:13px;text-align:left}.ok{color:#34d399}.warn{color:#fbbf24}.bad{color:#f87171}.muted{color:#94a3b8}</style></head><body><h2>AiFastDb Test Tools Hub</h2><div class="muted" id="ts">loading...</div><table><thead><tr><th>Tool</th><th>Project</th><th>State</th><th>Progress</th><th>Phase</th></tr></thead><tbody id="rows"></tbody></table><script>function cls(s){if(s==='completed'||s==='ok')return'ok';if(s==='unreachable'||s==='aborted'||s==='stalled')return'bad';return'warn'}async function refresh(){const r=await fetch('/api/status/all');const d=await r.json();document.getElementById('ts').textContent='更新时间: '+new Date().toLocaleString();const rows=(d.items||[]).map(function(x){var phase=x.phase?(x.phase.taskId+' ('+x.phase.percent+'%)'):'-';return '<tr><td>'+x.tool.name+'</td><td>'+x.tool.projectName+'</td><td class="'+cls(x.state)+'">'+x.state+(x.reachable?'':' ⚠')+'</td><td>'+(x.progress||0)+'%</td><td>'+phase+'</td></tr>'}).join('');document.getElementById('rows').innerHTML=rows||'<tr><td colspan="5" class="muted">no tools</td></tr>'}refresh();setInterval(refresh,3000);</script></body></html>`;
}

async function main() {
  const { port, registryFile } = parseArgs();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname === '/api/tools') {
        writeJson(res, loadRegistryFromFile(registryFile));
        return;
      }
      if (url.pathname === '/api/status/all') {
        writeJson(res, await createStatusMap(registryFile));
        return;
      }
      if (url.pathname.startsWith('/api/status/')) {
        const toolId = decodeURIComponent(url.pathname.replace('/api/status/', ''));
        const registry = loadRegistryFromFile(registryFile);
        const tool = getEnabledTools(registry).find((t) => t.id === toolId);
        if (!tool) {
          writeJson(res, { error: `tool not found: ${toolId}` }, 404);
          return;
        }
        writeJson(res, await collectToolStatus(tool));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(htmlPage());
    } catch (err) {
      writeJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`AiFastDb Test Tools Hub: http://localhost:${port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start AiFastDb Test Tools Hub:', err);
  process.exit(1);
});
