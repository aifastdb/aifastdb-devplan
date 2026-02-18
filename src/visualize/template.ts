/**
 * DevPlan 图可视化 HTML 模板 — 主入口
 *
 * 自包含的 HTML 页面，通过 CDN 引入渲染引擎。
 * 所有模块化代码通过 import 组合为完整页面。
 *
 * 模块结构:
 * - template-styles.ts       — CSS 样式
 * - template-html.ts         — HTML 结构
 * - template-core.ts         — 侧边栏、设置、引擎加载、状态
 * - template-graph-vis.ts    — vis-network 渲染、边高亮、文档展开、筛选
 * - template-graph-3d.ts     — 3D Force Graph 渲染
 * - template-data-loading.ts — 数据加载
 * - template-detail-panel.ts — 共享详情面板、Markdown 渲染
 * - template-stats-modal.ts  — 统计弹层、手动刷新
 * - template-pages.ts        — 文档浏览、RAG 聊天、统计仪表盘
 */

import { getStyles } from './template-styles';
import { getHTML } from './template-html';
import { getCoreScript } from './template-core';
import { getGraphVisScript } from './template-graph-vis';
import { getDataLoadingScript } from './template-data-loading';
import { getGraph3DScript } from './template-graph-3d';
import { getDetailPanelScript } from './template-detail-panel';
import { getStatsModalScript } from './template-stats-modal';
import { getPagesScript } from './template-pages';

export function getVisualizationHTML(projectName: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevPlan - ${projectName}</title>
  <style>
${getStyles()}
  </style>
</head>
${getHTML(projectName)}
<script>
${getCoreScript()}
${getGraphVisScript()}
${getDataLoadingScript()}
${getGraph3DScript()}
${getDetailPanelScript()}
${getStatsModalScript()}
${getPagesScript()}

// ========== App Start ==========
function startApp() {
  if (USE_3D) {
    log('3D Force Graph 引擎就绪 (Three.js WebGL), 开始加载数据...', true);
  } else {
    log('vis-network 就绪, 开始加载数据...', true);
  }
  loadData();
}


// ========== Init: 动态加载渲染引擎 ==========
loadRenderEngine();
</script>
</body>
</html>`;
}
