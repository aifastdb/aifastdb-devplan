/**
 * GraphCanvas — 高性能图谱渲染引擎
 *
 * 替换 vis-network 的自研 Canvas2D 渲染器。
 * 导出为内联 JavaScript 字符串，由 template.ts 嵌入 HTML。
 *
 * 核心架构 (借鉴 LeaferJS):
 * - GraphCanvas: 主引擎，管理 Canvas、渲染循环、数据
 * - ViewportManager: 平移/缩放/坐标变换
 * - SpatialIndex: R-tree 空间索引 (O(log n) 视口查询)
 * - RenderPipeline: 视口裁剪 + 脏区域局部渲染
 * - LODManager: 多级细节渲染
 * - LayoutEngine: Web Worker 力导向布局
 * - Clusterer: 节点聚合
 * - InteractionManager: 高效 hit-test + hover/click/drag
 */

import { getCoreScript } from './core';
import { getViewportScript } from './viewport';
import { getSpatialIndexScript } from './spatial-index';
import { getRendererScript } from './renderer';
import { getLODScript } from './lod';
import { getInteractionScript } from './interaction';
import { getLayoutWorkerScript } from './layout-worker';
import { getClustererScript } from './clusterer';
import { getStylesScript } from './styles';
import { getApiCompatScript } from './api-compat';

/**
 * 返回完整的 GraphCanvas 引擎 JavaScript 代码。
 * 嵌入方式: `<script>${getGraphCanvasScript()}</script>`
 */
export function getGraphCanvasScript(): string {
  return `
// ============================================================================
// GraphCanvas Engine — 高性能图谱渲染引擎 v1.0
// ============================================================================
(function(global) {
'use strict';

${getCoreScript()}

${getViewportScript()}

${getSpatialIndexScript()}

${getRendererScript()}

${getLODScript()}

${getInteractionScript()}

${getLayoutWorkerScript()}

${getClustererScript()}

${getStylesScript()}

${getApiCompatScript()}

// Export to global
global.GraphCanvas = GraphCanvas;
global.DevPlanGraph = DevPlanGraph;

})(typeof window !== 'undefined' ? window : this);
`;
}
