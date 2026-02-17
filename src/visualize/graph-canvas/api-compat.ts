/**
 * DevPlanGraph — vis-network API 兼容层
 *
 * 提供与 vis-network 兼容的 API 接口，使 template.ts 可以
 * 无缝切换到 GraphCanvas 引擎，最小化集成工作。
 *
 * 主要兼容方法:
 * - constructor(container, data, options) — 初始化
 * - on(event, callback) — 事件绑定
 * - fit(options) — 自适应视口
 * - getPositions(nodeIds) — 获取节点位置
 * - moveNode(id, x, y) — 移动节点
 * - getConnectedEdges(id) — 获取关联边
 * - getConnectedNodes(id) — 获取关联节点
 * - canvasToDOM(pos) — 坐标转换
 * - redraw() — 强制重绘
 * - destroy() — 销毁
 */

export function getApiCompatScript(): string {
  return `
// ============================================================================
// DevPlanGraph — vis-network API Compatibility Layer
// ============================================================================

/**
 * DevPlanGraph — Drop-in replacement for vis.Network.
 *
 * @param {HTMLElement} container
 * @param {{ nodes: Array, edges: Array }} data
 * @param {Object} options — vis-network style options (adapted)
 */
function DevPlanGraph(container, data, options) {
  var opts = options || {};

  // Parse vis-network options into GraphCanvas options
  var gcOptions = {
    backgroundColor: '#111827',
    debugMode: opts.debugMode || false,
  };

  // Create the underlying GraphCanvas engine
  this._gc = new GraphCanvas(container, gcOptions);
  this._container = container;
  this._stabilized = false;

  // ── Store references for compatibility ──
  this._nodesDataSet = data.nodes || [];
  this._edgesDataSet = data.edges || [];

  // Convert DataSet-style arrays to plain arrays if needed
  var nodesArray = Array.isArray(this._nodesDataSet) ? this._nodesDataSet :
    (this._nodesDataSet.get ? this._nodesDataSet.get() : []);
  var edgesArray = Array.isArray(this._edgesDataSet) ? this._edgesDataSet :
    (this._edgesDataSet.get ? this._edgesDataSet.get() : []);

  // Load data
  this._gc.setData({ nodes: nodesArray, edges: edgesArray });

  // ── Start layout ──
  this._gc._layoutEngine = new LayoutEngine(this._gc);
  var self = this;
  this._gc._layoutEngine._onStabilized = function() {
    self._stabilized = true;
    self._gc._emit('stabilizationIterationsDone', {});
  };

  // Extract physics params from vis-network-style options
  var fa2 = (opts.physics && opts.physics.forceAtlas2Based) || {};
  var stab = (opts.physics && opts.physics.stabilization) || {};

  // GraphCanvas runs layout in a Web Worker (non-blocking), so we can
  // afford 3x more iterations than vis-network for better convergence.
  var visIterations = stab.iterations || 200;
  var gcIterations = Math.max(visIterations * 3, 500);

  // Stronger gravity for GraphCanvas to keep the graph compact
  var baseGravity = fa2.centralGravity || 0.015;
  var gcGravity = baseGravity * 1.5;

  this._gc._layoutEngine.start({
    gravity: gcGravity,
    repulsion: fa2.gravitationalConstant || -80,
    springLength: fa2.springLength || 150,
    springConstant: fa2.springConstant || 0.05,
    damping: fa2.damping || 0.4,
    maxIterations: gcIterations,
    avoidOverlap: fa2.avoidOverlap || 0.8,
    batchSize: 15,  // More iterations per batch for faster convergence
  });
}

// ── Event binding (vis-network compatible) ────────────────────────────────

DevPlanGraph.prototype.on = function(event, callback) {
  // Map vis-network event names to GraphCanvas event names
  var self = this;

  if (event === 'stabilizationIterationsDone') {
    this._gc.on('stabilizationDone', callback);
    return this;
  }

  if (event === 'afterDrawing') {
    // afterDrawing provides canvas context — we emit this after each render
    this._gc.on('afterRender', function(data) {
      // Provide ctx in world-coordinate space (after viewport transform)
      callback(self._gc._ctx);
    });
    return this;
  }

  // Map click events to include vis-network-compatible params
  if (event === 'click') {
    this._gc.on('click', function(data) {
      callback({
        nodes: data.nodes || [],
        edges: [],
        pointer: data.pointer || { screen: { x: 0, y: 0 }, canvas: { x: 0, y: 0 } },
        event: data,
      });
    });
    return this;
  }

  // Map drag events to include vis-network-compatible params.nodes
  if (event === 'dragStart') {
    this._gc.on('dragStart', function(data) {
      callback({
        nodes: data.nodeId ? [data.nodeId] : [],
        pointer: { canvas: { x: data.node ? data.node.x : 0, y: data.node ? data.node.y : 0 } },
      });
    });
    return this;
  }

  if (event === 'dragging') {
    this._gc.on('dragging', function(data) {
      callback({
        nodes: data.nodeId ? [data.nodeId] : [],
        pointer: { canvas: { x: data.x, y: data.y } },
      });
    });
    return this;
  }

  if (event === 'dragEnd') {
    this._gc.on('dragEnd', function(data) {
      callback({
        nodes: data.nodeId ? [data.nodeId] : [],
      });
    });
    return this;
  }

  // Default: pass through
  this._gc.on(event, callback);
  return this;
};

// ── Viewport operations ──────────────────────────────────────────────────

DevPlanGraph.prototype.fit = function(options) {
  this._gc.fit(options);
};

DevPlanGraph.prototype.redraw = function() {
  this._gc.redraw();
};

// ── Node/Edge queries ────────────────────────────────────────────────────

DevPlanGraph.prototype.getPositions = function(nodeIds) {
  return this._gc.getPositions(nodeIds);
};

DevPlanGraph.prototype.moveNode = function(nodeId, x, y) {
  this._gc.moveNode(nodeId, x, y);
};

DevPlanGraph.prototype.getConnectedEdges = function(nodeId) {
  return this._gc.getConnectedEdges(nodeId);
};

DevPlanGraph.prototype.getConnectedNodes = function(nodeId) {
  return this._gc.getConnectedNodes(nodeId);
};

/**
 * Get bounding box of a node (vis-network compatible).
 */
DevPlanGraph.prototype.getBoundingBox = function(nodeId) {
  var node = this._gc._nodeMap[nodeId];
  if (!node) return null;
  var r = node._radius || 10;
  return {
    top: node.y - r,
    bottom: node.y + r,
    left: node.x - r,
    right: node.x + r,
  };
};

// ── Coordinate conversion ────────────────────────────────────────────────

/**
 * Convert canvas/world coordinates to DOM/screen coordinates (vis-network compat).
 */
DevPlanGraph.prototype.canvasToDOM = function(pos) {
  return this._gc.worldToScreen(pos.x, pos.y);
};

/**
 * Convert DOM/screen coordinates to canvas/world coordinates (vis-network compat).
 */
DevPlanGraph.prototype.DOMtoCanvas = function(pos) {
  return this._gc.screenToWorld(pos.x, pos.y);
};

// ── Physics control ──────────────────────────────────────────────────────

/**
 * Set options (vis-network compatible).
 * Mainly used for: network.setOptions({ physics: { enabled: false } })
 */
DevPlanGraph.prototype.setOptions = function(opts) {
  if (opts && opts.physics && opts.physics.enabled === false) {
    if (this._gc._layoutEngine) {
      this._gc._layoutEngine.stop();
    }
  }
};

// ── Destroy ──────────────────────────────────────────────────────────────

DevPlanGraph.prototype.destroy = function() {
  this._gc.destroy();
};

// ── Selection (vis-network compat) ───────────────────────────────────────

DevPlanGraph.prototype.getSelectedNodes = function() {
  return this._gc._interaction._selectedNodes.map(function(n) { return n.id; });
};

DevPlanGraph.prototype.selectNodes = function(nodeIds) {
  // Basic implementation
  this._gc._interaction._deselectAll();
  for (var i = 0; i < nodeIds.length; i++) {
    var node = this._gc._nodeMap[nodeIds[i]];
    if (node) {
      node._selected = true;
      this._gc._interaction._selectedNodes.push(node);
    }
  }
  this._gc.markDirty();
};

/**
 * Get the underlying GraphCanvas engine.
 */
DevPlanGraph.prototype.getEngine = function() {
  return this._gc;
};

/**
 * Get performance metrics.
 */
DevPlanGraph.prototype.getMetrics = function() {
  return this._gc.getMetrics();
};

// ── Cluster control (Phase-8B) ───────────────────────────────────────────

/**
 * Enable/disable clustering.
 */
DevPlanGraph.prototype.setClusterEnabled = function(enabled) {
  var gc = this._gc;
  if (!gc._clusterer) {
    gc._clusterer = new Clusterer(gc);
  }
  gc._clusterer.setEnabled(enabled);
  gc.markDirty();
};

/**
 * Set cluster threshold (scale below which clustering activates).
 */
DevPlanGraph.prototype.setClusterThreshold = function(threshold) {
  if (this._gc._clusterer) {
    this._gc._clusterer.setThreshold(threshold);
  }
};

/**
 * Get cluster information.
 */
DevPlanGraph.prototype.getClusters = function() {
  if (this._gc._clusterer) {
    return this._gc._clusterer.getClusters();
  }
  return [];
};

/**
 * Expand a specific cluster.
 */
DevPlanGraph.prototype.expandCluster = function(clusterId, options) {
  if (this._gc._clusterer) {
    this._gc._clusterer.expandCluster(clusterId, options);
  }
};

// ── Incremental Data API (Phase-8C) ──────────────────────────────────────

/**
 * Incrementally add nodes without full rebuild.
 * @param {Array} nodes — array of node objects
 */
DevPlanGraph.prototype.addNodes = function(nodes) {
  this._gc.addNodes(nodes);
};

/**
 * Incrementally add edges without full rebuild.
 * @param {Array} edges — array of edge objects
 */
DevPlanGraph.prototype.addEdges = function(edges) {
  this._gc.addEdges(edges);
};

/**
 * Get the position TypedArray (for zero-copy Worker exchange).
 * @returns {Float32Array}
 */
DevPlanGraph.prototype.getPositionBuffer = function() {
  return this._gc.getPositionBuffer();
};
`;
}
