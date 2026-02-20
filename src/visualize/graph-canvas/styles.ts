/**
 * StyleManager — DevPlan 节点/边样式系统
 *
 * 迁移自 vis-network 的样式规则:
 * - 5 种节点类型样式 (project/module/main-task/sub-task/document)
 * - 4 种状态颜色 (completed/in_progress/pending/cancelled)
 * - 动态大小规则 (基于度数 sqrt 曲线)
 * - 6 种边类型样式
 */

export function getStylesScript(): string {
  return `
// ============================================================================
// StyleManager — Node & Edge Styles
// ============================================================================

function StyleManager() {
  // 从统一配置加载颜色 (如果 getUnifiedNodeStyle 可用)
  var _uni = (typeof getUnifiedNodeStyle === 'function') ? getUnifiedNodeStyle() : null;

  // Status colors
  this.STATUS_COLORS = _uni ? _uni.statusGeneric : {
    completed:   { bg: '#059669', border: '#047857', font: '#d1fae5' },
    in_progress: { bg: '#7c3aed', border: '#6d28d9', font: '#ddd6fe' },
    pending:     { bg: '#4b5563', border: '#374151', font: '#d1d5db' },
    cancelled:   { bg: '#92400e', border: '#78350f', font: '#fde68a' },
  };

  // 统一样式缓存 (供 getNodeStyle 使用)
  this._uniStyle = _uni;

  // Node sizing rules by type
  this.NODE_SIZE_RULES = {
    'project':   { min: 35, max: 65, baseFont: 16, maxFont: 22, scale: 3.5 },
    'module':    { min: 20, max: 45, baseFont: 12, maxFont: 16, scale: 2.8 },
    'main-task': { min: 14, max: 38, baseFont: 11, maxFont: 15, scale: 2.2 },
    'sub-task':  { min: 7,  max: 18, baseFont: 8,  maxFont: 11, scale: 1.5 },
    'document':  { min: 12, max: 30, baseFont: 9,  maxFont: 13, scale: 1.8 },
    'memory':    { min: 6,  max: 20, baseFont: 7,  maxFont: 11, scale: 1.2 },
  };

  // Node type shapes
  this.NODE_SHAPES = {
    'project': 'star',
    'module': 'diamond',
    'main-task': 'circle',
    'sub-task': 'circle',
    'document': 'box',
    'memory': 'hexagon',
  };

  // Node type colors (for non-status-based types) — 从统一配置读取
  this.NODE_COLORS = _uni ? {
    'project': _uni.project,
    'module':  _uni.module,
    'document': _uni.document,
    'memory':  _uni.memory,
  } : {
    'project': { bg: '#f59e0b', border: '#d97706', font: '#fff' },
    'module':  { bg: '#ff6600', border: '#cc5200', font: '#fff3e0' },
    'document': { bg: '#2563eb', border: '#1d4ed8', font: '#dbeafe' },
    'memory':  { bg: '#e879f9', border: '#a21caf', font: '#fdf4ff' },
  };

  // Edge styles by label
  this.EDGE_STYLES = {
    'has_main_task':  { width: 2, color: '#4b5563', highlightColor: '#93c5fd', dashes: null, arrows: true },
    'has_sub_task':   { width: 1, color: '#4b5563', highlightColor: '#818cf8', dashes: null, arrows: true },
    'has_document':   { width: 1, color: '#4b5563', highlightColor: '#60a5fa', dashes: [5, 5], arrows: true },
    'module_has_task':{ width: 1.5, color: '#4b5563', highlightColor: '#ff8533', dashes: [2, 4], arrows: true },
    'task_has_doc':   { width: 1.5, color: '#4b5563', highlightColor: '#f59e0b', dashes: [4, 3], arrows: true },
    'doc_has_child':  { width: 1.5, color: '#4b5563', highlightColor: '#c084fc', dashes: [6, 3], arrows: true },
    'has_memory':     { width: 1, color: '#581c87', highlightColor: '#e879f9', dashes: [3, 3], arrows: true },
    'memory_relates': { width: 1.5, color: '#86198f', highlightColor: '#f0abfc', dashes: null, arrows: false },
    'memory_from_task':{ width: 1, color: '#581c87', highlightColor: '#c084fc', dashes: [4, 2], arrows: true },
    'memory_from_doc':{ width: 1, color: '#581c87', highlightColor: '#a78bfa', dashes: [2, 3], arrows: true },
    'module_memory':  { width: 1, color: '#581c87', highlightColor: '#d946ef', dashes: [3, 2], arrows: true },
    'memory_supersedes':{ width: 1, color: '#701a75', highlightColor: '#f472b6', dashes: [6, 2], arrows: true },
  };

  this.EDGE_DEFAULT = { width: 1, color: '#4b5563', highlightColor: '#9ca3af', dashes: null, arrows: false };
}

/**
 * Compute node size and font size based on type and degree.
 */
StyleManager.prototype._calcNodeSize = function(type, degree) {
  var rule = this.NODE_SIZE_RULES[type] || { min: 10, max: 22, baseFont: 10, maxFont: 13, scale: 1.0 };
  var size = rule.min + rule.scale * Math.sqrt(degree || 0);
  size = Math.max(rule.min, Math.min(size, rule.max));
  var sizeRatio = (size - rule.min) / (rule.max - rule.min || 1);
  var fontSize = Math.round(rule.baseFont + sizeRatio * (rule.maxFont - rule.baseFont));
  return { size: Math.round(size), fontSize: fontSize };
};

/**
 * Get style for a node.
 * @param {Object} node
 * @returns {Object} { shape, radius, bgColor, borderColor, borderWidth, fontColor, fontSize }
 */
StyleManager.prototype.getNodeStyle = function(node) {
  var type = node.type || 'default';
  var props = node.properties || {};
  var status = props.status || 'pending';
  var degree = node.degree || 0;

  var ns = this._calcNodeSize(type, degree);
  var shape = this.NODE_SHAPES[type] || 'circle';

  // Determine colors — 从统一配置读取
  var colors;
  if (type === 'project' || type === 'module' || type === 'document') {
    colors = this.NODE_COLORS[type] || this.STATUS_COLORS.pending;
  } else if (type === 'main-task') {
    // 主任务: 从统一配置读取状态颜色
    var _mt = this._uniStyle ? this._uniStyle.mainTask : null;
    colors = (_mt && _mt[status]) || (_mt && _mt.pending) || this.STATUS_COLORS[status] || this.STATUS_COLORS.pending;
  } else {
    // 子任务: 从统一配置读取状态颜色 (completed=亮绿色)
    var _st = this._uniStyle ? this._uniStyle.subTask : null;
    colors = (_st && _st[status]) || (_st && _st.pending) || this.STATUS_COLORS[status] || this.STATUS_COLORS.pending;
  }

  return {
    shape: shape,
    radius: ns.size,
    bgColor: colors.bg,
    borderColor: colors.border,
    borderWidth: type === 'project' ? 3 : (type === 'sub-task' ? 1 : 2),
    fontColor: colors.font,
    fontSize: ns.fontSize,
  };
};

/**
 * Get style for an edge.
 * @param {Object} edge
 * @returns {Object} { width, color, highlightColor, dashes, arrows }
 */
StyleManager.prototype.getEdgeStyle = function(edge) {
  var label = edge.label || edge._label || '';
  return this.EDGE_STYLES[label] || this.EDGE_DEFAULT;
};

/**
 * Apply styles to all nodes and edges (batch).
 */
StyleManager.prototype.applyAllStyles = function(nodes, edges) {
  for (var i = 0; i < nodes.length; i++) {
    var style = this.getNodeStyle(nodes[i]);
    nodes[i]._style = style;
    nodes[i]._radius = style.radius;
  }
  for (var i = 0; i < edges.length; i++) {
    edges[i]._style = this.getEdgeStyle(edges[i]);
  }
};
`;
}
