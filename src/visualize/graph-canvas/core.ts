/**
 * GraphCanvas Core — Canvas2D 渲染器骨架
 *
 * 职责:
 * - 创建/管理 Canvas 元素
 * - 维护节点/边数据
 * - requestAnimationFrame 渲染循环
 * - 协调各子模块 (Viewport, SpatialIndex, Renderer, etc.)
 */

export function getCoreScript(): string {
  return `
// ============================================================================
// GraphCanvas Core
// ============================================================================

/**
 * GraphCanvas — 高性能 Canvas2D 图谱渲染引擎
 *
 * @param {HTMLElement} container - 容器 DOM 元素
 * @param {Object} options - 配置选项
 */
function GraphCanvas(container, options) {
  if (!container) throw new Error('GraphCanvas: container is required');

  this._container = container;
  this._options = Object.assign({
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    backgroundColor: '#111827',
    maxFPS: 60,
    debugMode: false,
  }, options || {});

  // ── Canvas Setup ──────────────────────────────────────────────────────
  this._canvas = document.createElement('canvas');
  this._canvas.style.cssText = 'width:100%;height:100%;display:block;outline:none;';
  this._canvas.tabIndex = 0; // focusable for keyboard events
  container.appendChild(this._canvas);
  this._ctx = this._canvas.getContext('2d');

  // ── Data ──────────────────────────────────────────────────────────────
  this._nodes = [];           // GraphNode[] — all nodes
  this._edges = [];           // GraphEdge[] — all edges
  this._nodeMap = {};         // id → node  (O(1) lookup)
  this._edgeMap = {};         // id → edge
  this._nodeEdges = {};       // nodeId → [edge, ...] (adjacency list)
  this._nodeCount = 0;
  this._edgeCount = 0;

  // ── Sub-modules (created lazily or during init) ───────────────────────
  this._viewport = new ViewportManager(this);
  this._spatialIndex = new SpatialIndex();
  this._renderer = new RenderPipeline(this);
  this._lod = new LODManager(this);
  this._interaction = new InteractionManager(this);
  this._layoutEngine = null;  // Created on demand
  this._clusterer = null;     // Created on demand
  this._styles = new StyleManager();

  // ── Render Loop State ─────────────────────────────────────────────────
  this._rafId = null;
  this._dirty = true;         // needs full redraw
  this._dirtyRects = [];      // partial redraw regions [{x,y,w,h}, ...]
  this._lastFrameTime = 0;
  this._frameInterval = 1000 / this._options.maxFPS;
  this._running = false;
  this._sleeping = false;     // true = render loop paused (no rAF)
  this._frameCount = 0;
  this._fpsTimer = 0;
  this._currentFPS = 0;
  this._idleFrames = 0;       // consecutive frames with nothing to draw
  this._idleThreshold = 30;   // sleep after N idle frames (~0.5s at 60fps)

  // ── Event Callbacks ───────────────────────────────────────────────────
  this._eventHandlers = {};   // eventName → [callback, ...]

  // ── Performance Metrics ───────────────────────────────────────────────
  this._metrics = {
    lastRenderMs: 0,
    visibleNodes: 0,
    visibleEdges: 0,
    fps: 0,
    totalNodes: 0,
    totalEdges: 0,
    visibleClusters: 0,
    layoutProgress: 0,
    layoutAlgorithm: '',
    layoutEta: 0,
  };

  // Listen for layout progress events to store in metrics
  var self = this;
  this.on('layoutProgress', function(data) {
    self._metrics.layoutProgress = data.percent || 0;
    self._metrics.layoutAlgorithm = data.algorithm || '';
    self._metrics.layoutEta = data.eta || 0;
    self.markDirty(); // Ensure progress bar redraws
  });
  this.on('stabilizationDone', function() {
    self._metrics.layoutProgress = 0;
    self._metrics.layoutAlgorithm = '';
    self._metrics.layoutEta = 0;
    self.markDirty();
  });

  // ── Initialize ────────────────────────────────────────────────────────
  this._resizeObserver = null;
  this._handleResize();
  this._setupResizeObserver();
}

// ── Canvas Sizing ─────────────────────────────────────────────────────────
GraphCanvas.prototype._handleResize = function() {
  var rect = this._container.getBoundingClientRect();
  var pr = this._options.pixelRatio;
  var w = Math.max(rect.width, 1);
  var h = Math.max(rect.height, 1);

  this._canvas.width = w * pr;
  this._canvas.height = h * pr;
  this._width = w;
  this._height = h;

  // Scale context for HiDPI
  this._ctx.setTransform(pr, 0, 0, pr, 0, 0);

  this.markDirty();
};

GraphCanvas.prototype._setupResizeObserver = function() {
  var self = this;
  if (typeof ResizeObserver !== 'undefined') {
    this._resizeObserver = new ResizeObserver(function() {
      self._handleResize();
    });
    this._resizeObserver.observe(this._container);
  } else {
    // Fallback for older browsers
    window.addEventListener('resize', function() { self._handleResize(); });
  }
};

// ── Data Management ───────────────────────────────────────────────────────

/**
 * Set graph data (bulk load).
 * @param {{ nodes: Array, edges: Array }} data
 */
GraphCanvas.prototype.setData = function(data) {
  var nodes = data.nodes || [];
  var edges = data.edges || [];

  // Clear previous data
  this._nodes = [];
  this._edges = [];
  this._nodeMap = {};
  this._edgeMap = {};
  this._nodeEdges = {};
  this._nodeIndexMap = {};  // id → array index (for TypedArray)

  // ── TypedArray backing store (Phase-8C) ──
  // Float32Array for positions: [x0, y0, x1, y1, ...] (stride=2)
  // Float32Array for properties: [radius0, degree0, radius1, degree1, ...] (stride=2)
  var nodeCount = nodes.length;
  this._positionArray = new Float32Array(nodeCount * 2);
  this._propertyArray = new Float32Array(nodeCount * 2);

  // Process nodes
  for (var i = 0; i < nodeCount; i++) {
    var n = nodes[i];
    var px = n.x != null ? n.x : 0;
    var py = n.y != null ? n.y : 0;
    this._positionArray[i * 2] = px;
    this._positionArray[i * 2 + 1] = py;
    this._propertyArray[i * 2] = 10; // default radius
    this._propertyArray[i * 2 + 1] = n.degree || 0;

    var node = {
      id: n.id,
      label: n.label || n.id,
      type: n.type || 'default',
      x: px,
      y: py,
      _idx: i,              // TypedArray index
      // Computed fields
      _screenX: 0,
      _screenY: 0,
      _radius: 10,
      _visible: true,
      _lodLevel: 2,        // 0=minimal, 1=standard, 2=detailed
      _hovered: false,
      _selected: false,
      _dragging: false,
      _clustered: false,
      _style: null,         // cached style
      _aabb: null,          // { minX, minY, maxX, maxY } for R-tree
      // Original data
      properties: n.properties || {},
      degree: n.degree || 0,
      _origData: n,
    };
    this._nodes.push(node);
    this._nodeMap[node.id] = node;
    this._nodeIndexMap[node.id] = i;
    this._nodeEdges[node.id] = [];
  }

  // Process edges
  for (var i = 0; i < edges.length; i++) {
    var e = edges[i];
    var eid = e.id || ('e_' + i);
    var edge = {
      id: eid,
      from: e.from,
      to: e.to,
      label: e.label || '',
      _visible: true,
      _highlighted: false,
      _style: null,
      _origData: e,
    };
    this._edges.push(edge);
    this._edgeMap[eid] = edge;
    if (this._nodeEdges[e.from]) this._nodeEdges[e.from].push(edge);
    if (this._nodeEdges[e.to]) this._nodeEdges[e.to].push(edge);
  }

  this._nodeCount = this._nodes.length;
  this._edgeCount = this._edges.length;
  this._metrics.totalNodes = this._nodeCount;
  this._metrics.totalEdges = this._edgeCount;

  // Apply styles to all nodes/edges
  this._styles.applyAllStyles(this._nodes, this._edges);

  // Build spatial index (nodes + edges)
  this._spatialIndex.buildFromNodes(this._nodes);
  this._spatialIndex.buildEdgeIndex(this._edges, this._nodeMap);

  // Auto-enable clusterer for larger datasets (>500 nodes)
  if (this._nodeCount > 500) {
    if (!this._clusterer) {
      this._clusterer = new Clusterer(this);
    }
    this._clusterer.setEnabled(true);
  } else if (this._clusterer) {
    this._clusterer.setEnabled(false);
  }

  // Assign initial positions if not set (random layout as starting point)
  var hasPositions = false;
  for (var i = 0; i < this._nodes.length; i++) {
    if (this._nodes[i].x !== 0 || this._nodes[i].y !== 0) {
      hasPositions = true;
      break;
    }
  }
  if (!hasPositions && this._nodes.length > 0) {
    this._assignRandomPositions();
  }

  this.markDirty();
  this._emit('dataLoaded', { nodeCount: this._nodeCount, edgeCount: this._edgeCount });
};

/**
 * Assign random initial positions for layout bootstrapping.
 */
GraphCanvas.prototype._assignRandomPositions = function() {
  var spread = Math.sqrt(this._nodeCount) * 80;
  for (var i = 0; i < this._nodes.length; i++) {
    this._nodes[i].x = (Math.random() - 0.5) * spread;
    this._nodes[i].y = (Math.random() - 0.5) * spread;
  }
  this._spatialIndex.buildFromNodes(this._nodes);
  this._spatialIndex.buildEdgeIndex(this._edges, this._nodeMap);
};

// ── TypedArray Accessors (Phase-8C) ────────────────────────────────────────

/**
 * Get node position from TypedArray (fast path for Worker sync).
 * @param {number} index — node array index
 * @returns {{ x: number, y: number }}
 */
GraphCanvas.prototype.getNodePos = function(index) {
  return {
    x: this._positionArray[index * 2],
    y: this._positionArray[index * 2 + 1],
  };
};

/**
 * Set node position in both TypedArray and node object.
 * @param {number} index — node array index
 * @param {number} x
 * @param {number} y
 */
GraphCanvas.prototype.setNodePos = function(index, x, y) {
  this._positionArray[index * 2] = x;
  this._positionArray[index * 2 + 1] = y;
  if (this._nodes[index]) {
    this._nodes[index].x = x;
    this._nodes[index].y = y;
  }
};

/**
 * Bulk sync: copy positions from TypedArray → node objects.
 * Called after Worker returns Transferable ArrayBuffer.
 */
GraphCanvas.prototype._syncFromPositionArray = function() {
  var arr = this._positionArray;
  var nodes = this._nodes;
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].x = arr[i * 2];
    nodes[i].y = arr[i * 2 + 1];
  }
};

/**
 * Bulk sync: copy positions from node objects → TypedArray.
 * Called before sending to Worker.
 */
GraphCanvas.prototype._syncToPositionArray = function() {
  var arr = this._positionArray;
  var nodes = this._nodes;
  for (var i = 0; i < nodes.length; i++) {
    arr[i * 2] = nodes[i].x;
    arr[i * 2 + 1] = nodes[i].y;
  }
};

/**
 * Get a transferable copy of the position array for Worker.
 * @returns {Float32Array} — new copy (original stays usable)
 */
GraphCanvas.prototype.getPositionBuffer = function() {
  return new Float32Array(this._positionArray);
};

// ── Incremental Data API (Phase-8C T8C.5) ─────────────────────────────────

/**
 * Incrementally add nodes (batch).
 * Appends to existing data without full rebuild.
 * @param {Array} newNodes — [{id, label, type, x, y, ...}, ...]
 */
GraphCanvas.prototype.addNodes = function(newNodes) {
  if (!newNodes || newNodes.length === 0) return;

  var oldCount = this._nodeCount;
  var totalCount = oldCount + newNodes.length;

  // Grow TypedArrays
  var newPosArray = new Float32Array(totalCount * 2);
  var newPropArray = new Float32Array(totalCount * 2);
  newPosArray.set(this._positionArray);
  newPropArray.set(this._propertyArray);

  for (var i = 0; i < newNodes.length; i++) {
    var n = newNodes[i];
    var idx = oldCount + i;
    var px = n.x != null ? n.x : (Math.random() - 0.5) * Math.sqrt(totalCount) * 80;
    var py = n.y != null ? n.y : (Math.random() - 0.5) * Math.sqrt(totalCount) * 80;
    newPosArray[idx * 2] = px;
    newPosArray[idx * 2 + 1] = py;
    newPropArray[idx * 2] = 10;
    newPropArray[idx * 2 + 1] = n.degree || 0;

    var node = {
      id: n.id,
      label: n.label || n.id,
      type: n.type || 'default',
      x: px, y: py,
      _idx: idx,
      _screenX: 0, _screenY: 0,
      _radius: 10, _visible: true, _lodLevel: 2,
      _hovered: false, _selected: false, _dragging: false, _clustered: false,
      _style: null, _aabb: null,
      properties: n.properties || {},
      degree: n.degree || 0,
      _origData: n,
    };
    this._nodes.push(node);
    this._nodeMap[node.id] = node;
    this._nodeIndexMap[node.id] = idx;
    this._nodeEdges[node.id] = [];

    // Incremental R-tree insert
    this._spatialIndex.insertNode(node);
  }

  this._positionArray = newPosArray;
  this._propertyArray = newPropArray;
  this._nodeCount = totalCount;
  this._metrics.totalNodes = totalCount;

  // Apply styles to new nodes
  this._styles.applyAllStyles(this._nodes, this._edges);

  this.markDirty();
  this._emit('nodesAdded', { count: newNodes.length, total: totalCount });
};

/**
 * Incrementally add edges (batch).
 * @param {Array} newEdges — [{id, from, to, label, ...}, ...]
 */
GraphCanvas.prototype.addEdges = function(newEdges) {
  if (!newEdges || newEdges.length === 0) return;

  for (var i = 0; i < newEdges.length; i++) {
    var e = newEdges[i];
    var eid = e.id || ('e_' + (this._edgeCount + i));
    var edge = {
      id: eid,
      from: e.from,
      to: e.to,
      label: e.label || '',
      _visible: true,
      _highlighted: false,
      _style: null,
      _origData: e,
    };
    this._edges.push(edge);
    this._edgeMap[eid] = edge;
    if (this._nodeEdges[e.from]) this._nodeEdges[e.from].push(edge);
    if (this._nodeEdges[e.to]) this._nodeEdges[e.to].push(edge);

    // Incremental edge R-tree insert
    var fromNode = this._nodeMap[e.from];
    var toNode = this._nodeMap[e.to];
    if (fromNode && toNode) {
      this._spatialIndex.insertEdge(edge, fromNode, toNode);
    }
  }

  this._edgeCount = this._edges.length;
  this._metrics.totalEdges = this._edgeCount;
  this._styles.applyAllStyles(this._nodes, this._edges);
  this.markDirty();
  this._emit('edgesAdded', { count: newEdges.length, total: this._edgeCount });
};

// ── Dirty Marking ─────────────────────────────────────────────────────────

/**
 * Mark the entire canvas as needing redraw.
 */
GraphCanvas.prototype.markDirty = function() {
  this._dirty = true;
  this._idleFrames = 0;
  this._wakeRenderLoop();
};

/**
 * Mark a specific rectangular region as dirty (world coordinates).
 * @param {number} x - World X
 * @param {number} y - World Y
 * @param {number} w - Width
 * @param {number} h - Height
 */
GraphCanvas.prototype.markDirtyRect = function(x, y, w, h) {
  this._dirtyRects.push({ x: x, y: y, w: w, h: h });
  this._idleFrames = 0;
  this._wakeRenderLoop();
};

/**
 * Mark a node's region as dirty — automatically computes AABB with padding.
 * Also marks connected edges' regions as dirty.
 * @param {Object} node — graph node with .x, .y, ._radius
 * @param {Object} [prevPos] — { x, y } previous position (for drag, to dirty old + new area)
 */
GraphCanvas.prototype.markDirtyNode = function(node, prevPos) {
  if (!node) return;
  var r = (node._radius || 10);
  // Padding accounts for glow/shadow, labels, and edge connection changes
  var pad = r * 0.8 + 20 / Math.max(this._viewport.getScale(), 0.01);
  var totalR = r + pad;

  // Dirty the current node area
  this._dirtyRects.push({
    x: node.x - totalR,
    y: node.y - totalR,
    w: totalR * 2,
    h: totalR * 2,
  });

  // If node moved, also dirty the old position
  if (prevPos) {
    this._dirtyRects.push({
      x: prevPos.x - totalR,
      y: prevPos.y - totalR,
      w: totalR * 2,
      h: totalR * 2,
    });
  }

  // Dirty connected edges — mark each connected node's area too
  var connEdges = this._nodeEdges[node.id] || [];
  for (var i = 0; i < connEdges.length; i++) {
    var e = connEdges[i];
    var otherId = e.from === node.id ? e.to : e.from;
    var otherNode = this._nodeMap[otherId];
    if (otherNode) {
      var oR = (otherNode._radius || 10) + pad;
      this._dirtyRects.push({
        x: otherNode.x - oR,
        y: otherNode.y - oR,
        w: oR * 2,
        h: oR * 2,
      });
    }
  }

  this._idleFrames = 0;
  this._wakeRenderLoop();
};

/**
 * Merge overlapping/adjacent dirty rects to reduce clip operations.
 * Uses a greedy merge: merge any two rects that overlap or are close together.
 * @returns {Array} merged rects [{x,y,w,h}, ...]
 */
GraphCanvas.prototype._mergeDirtyRects = function() {
  var rects = this._dirtyRects;
  if (rects.length <= 1) return rects;

  // If too many dirty rects, just do a full redraw — cheaper than many clips
  if (rects.length > 16) {
    this._dirty = true;
    return [];
  }

  // Convert to minX/minY/maxX/maxY for easier merging
  var merged = [];
  for (var i = 0; i < rects.length; i++) {
    var r = rects[i];
    merged.push({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h });
  }

  // Greedy merge pass
  var changed = true;
  while (changed) {
    changed = false;
    for (var i = 0; i < merged.length; i++) {
      for (var j = i + 1; j < merged.length; j++) {
        var a = merged[i], b = merged[j];
        // Check if rects overlap or are very close (within merge gap)
        var gap = 20 / Math.max(this._viewport.getScale(), 0.01);
        if (a.minX - gap <= b.maxX && a.maxX + gap >= b.minX &&
            a.minY - gap <= b.maxY && a.maxY + gap >= b.minY) {
          // Merge b into a
          a.minX = Math.min(a.minX, b.minX);
          a.minY = Math.min(a.minY, b.minY);
          a.maxX = Math.max(a.maxX, b.maxX);
          a.maxY = Math.max(a.maxY, b.maxY);
          merged.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  // Convert back to {x,y,w,h}
  var result = [];
  for (var i = 0; i < merged.length; i++) {
    var m = merged[i];
    result.push({ x: m.minX, y: m.minY, w: m.maxX - m.minX, h: m.maxY - m.minY });
  }
  return result;
};

// ── Render Loop ───────────────────────────────────────────────────────────

GraphCanvas.prototype._startRenderLoop = function() {
  if (this._running) return;
  this._running = true;
  this._sleeping = false;
  this._idleFrames = 0;
  this._lastFrameTime = performance.now();
  this._fpsTimer = this._lastFrameTime;
  this._frameCount = 0;
  var self = this;
  function loop(now) {
    self._rafId = requestAnimationFrame(loop);
    // FPS throttle
    var elapsed = now - self._lastFrameTime;
    if (elapsed < self._frameInterval) return;
    self._lastFrameTime = now - (elapsed % self._frameInterval);

    // FPS counter
    self._frameCount++;
    if (now - self._fpsTimer >= 1000) {
      self._currentFPS = self._frameCount;
      self._metrics.fps = self._currentFPS;
      self._frameCount = 0;
      self._fpsTimer = now;
    }

    // Render frame if needed
    if (self._dirty || self._dirtyRects.length > 0) {
      var t0 = performance.now();
      self._renderFrame();
      self._metrics.lastRenderMs = Math.round((performance.now() - t0) * 100) / 100;
      self._idleFrames = 0;
    } else {
      // No work this frame — increment idle counter
      self._idleFrames++;
      if (self._idleFrames >= self._idleThreshold) {
        // Go to sleep: stop rAF loop to save CPU/battery
        self._sleep();
      }
    }
  }
  this._rafId = requestAnimationFrame(loop);
};

/**
 * Put the render loop to sleep (stop rAF). Wakes on markDirty/markDirtyNode.
 */
GraphCanvas.prototype._sleep = function() {
  if (this._rafId) {
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }
  this._sleeping = true;
  this._running = false;
  this._metrics.fps = 0;
};

/**
 * Wake the render loop from sleep (triggered by markDirty/markDirtyNode).
 */
GraphCanvas.prototype._wakeRenderLoop = function() {
  if (!this._running) {
    this._startRenderLoop();
  }
};

GraphCanvas.prototype._stopRenderLoop = function() {
  if (this._rafId) {
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }
  this._running = false;
  this._sleeping = false;
};

/**
 * Render one frame.
 * Delegates to RenderPipeline for viewport culling + draw.
 * Uses merged dirty rects for partial rendering when possible.
 */
GraphCanvas.prototype._renderFrame = function() {
  var mergedRects = [];
  if (!this._dirty && this._dirtyRects.length > 0) {
    mergedRects = this._mergeDirtyRects();
    // If merge decided it's too many → _dirty was set to true
  }
  this._renderer.render(this._ctx, this._dirty, mergedRects);
  this._dirty = false;
  this._dirtyRects = [];
};

// ── Event System ──────────────────────────────────────────────────────────

/**
 * Register event handler.
 * Supported events: click, doubleClick, hover, dragStart, dragging, dragEnd,
 *   select, deselect, viewportChanged, stabilizationDone, dataLoaded
 */
GraphCanvas.prototype.on = function(event, callback) {
  if (!this._eventHandlers[event]) this._eventHandlers[event] = [];
  this._eventHandlers[event].push(callback);
  return this;
};

GraphCanvas.prototype.off = function(event, callback) {
  var handlers = this._eventHandlers[event];
  if (!handlers) return this;
  if (callback) {
    for (var i = handlers.length - 1; i >= 0; i--) {
      if (handlers[i] === callback) handlers.splice(i, 1);
    }
  } else {
    this._eventHandlers[event] = [];
  }
  return this;
};

GraphCanvas.prototype._emit = function(event, data) {
  var handlers = this._eventHandlers[event];
  if (!handlers) return;
  for (var i = 0; i < handlers.length; i++) {
    try {
      handlers[i](data);
    } catch (e) {
      console.error('GraphCanvas event handler error (' + event + '):', e);
    }
  }
};

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Fit view to show all nodes with padding.
 */
GraphCanvas.prototype.fit = function(options) {
  this._viewport.fitToNodes(this._nodes, options);
  this.markDirty();
};

/**
 * Center view on a specific node.
 */
GraphCanvas.prototype.focusNode = function(nodeId, options) {
  var node = this._nodeMap[nodeId];
  if (!node) return;
  this._viewport.centerOn(node.x, node.y, options);
  this.markDirty();
};

/**
 * Get current viewport bounds in world coordinates.
 */
GraphCanvas.prototype.getViewportBounds = function() {
  return this._viewport.getWorldBounds();
};

/**
 * Get node positions.
 */
GraphCanvas.prototype.getPositions = function(nodeIds) {
  var result = {};
  if (nodeIds) {
    for (var i = 0; i < nodeIds.length; i++) {
      var n = this._nodeMap[nodeIds[i]];
      if (n) result[nodeIds[i]] = { x: n.x, y: n.y };
    }
  } else {
    for (var i = 0; i < this._nodes.length; i++) {
      var n = this._nodes[i];
      result[n.id] = { x: n.x, y: n.y };
    }
  }
  return result;
};

/**
 * Move a node to new coordinates.
 */
GraphCanvas.prototype.moveNode = function(nodeId, x, y) {
  var node = this._nodeMap[nodeId];
  if (!node) return;
  var prevPos = { x: node.x, y: node.y };
  node.x = x;
  node.y = y;
  // Update spatial index (node + connected edges)
  this._spatialIndex.updateNode(node);
  this._spatialIndex.updateEdgesForNode(node.id, this._nodeEdges, this._nodeMap);
  this.markDirtyNode(node, prevPos);
};

/**
 * Get connected edges for a node.
 */
GraphCanvas.prototype.getConnectedEdges = function(nodeId) {
  var edges = this._nodeEdges[nodeId] || [];
  var ids = [];
  for (var i = 0; i < edges.length; i++) ids.push(edges[i].id);
  return ids;
};

/**
 * Get connected nodes for a node.
 */
GraphCanvas.prototype.getConnectedNodes = function(nodeId) {
  var edges = this._nodeEdges[nodeId] || [];
  var result = [];
  var seen = {};
  for (var i = 0; i < edges.length; i++) {
    var otherId = edges[i].from === nodeId ? edges[i].to : edges[i].from;
    if (!seen[otherId]) {
      result.push(otherId);
      seen[otherId] = true;
    }
  }
  return result;
};

/**
 * Get performance metrics.
 */
GraphCanvas.prototype.getMetrics = function() {
  return Object.assign({}, this._metrics);
};

/**
 * Force a full redraw.
 */
GraphCanvas.prototype.redraw = function() {
  this.markDirty();
};

/**
 * Destroy the engine, clean up all resources.
 */
GraphCanvas.prototype.destroy = function() {
  this._stopRenderLoop();
  this._interaction.destroy();
  if (this._resizeObserver) this._resizeObserver.disconnect();
  if (this._layoutEngine) this._layoutEngine.destroy();
  if (this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
  this._nodes = [];
  this._edges = [];
  this._nodeMap = {};
  this._edgeMap = {};
  this._nodeEdges = {};
  this._eventHandlers = {};
};

/**
 * Convert screen coordinates to world coordinates.
 */
GraphCanvas.prototype.screenToWorld = function(sx, sy) {
  return this._viewport.screenToWorld(sx, sy);
};

/**
 * Convert world coordinates to screen coordinates.
 */
GraphCanvas.prototype.worldToScreen = function(wx, wy) {
  return this._viewport.worldToScreen(wx, wy);
};
`;
}
