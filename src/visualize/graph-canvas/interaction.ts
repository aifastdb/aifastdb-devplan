/**
 * InteractionManager — 交互管理器
 *
 * 基于空间索引实现 O(log n) hit-test:
 * - hover: 鼠标悬停高亮 (脏区域重绘)
 * - click: 选中节点 (高亮连接边)
 * - drag (空白): 视口平移
 * - drag (节点): 节点拖拽
 * - 框选: 矩形范围选择
 * - 双击: 聚焦节点
 */

export function getInteractionScript(): string {
  return `
// ============================================================================
// InteractionManager — Hit-test + Mouse/Touch Events
// ============================================================================

function InteractionManager(engine) {
  this._engine = engine;

  // State
  this._hoveredNode = null;
  this._selectedNodes = [];
  this._selectedNodeMap = {};
  this._isDraggingNode = false;
  this._isDraggingCanvas = false;
  this._draggedNode = null;
  this._dragStartScreenX = 0;
  this._dragStartScreenY = 0;
  this._dragStartWorldX = 0;
  this._dragStartWorldY = 0;
  this._lastMouseScreenX = 0;
  this._lastMouseScreenY = 0;
  this._lastDragTime = 0;

  // Bind events
  this._bindEvents();
}

InteractionManager.prototype._bindEvents = function() {
  var self = this;
  var canvas = this._engine._canvas;

  // ── Mousemove → Hover ──
  canvas.addEventListener('mousemove', function(e) {
    var rect = canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left;
    var sy = e.clientY - rect.top;

    if (self._isDraggingNode) {
      self._handleNodeDrag(sx, sy);
    } else if (self._isDraggingCanvas) {
      self._handleCanvasDrag(sx, sy);
    } else {
      self._handleHover(sx, sy);
    }

    self._lastMouseScreenX = sx;
    self._lastMouseScreenY = sy;
  });

  // ── Mousedown → Start drag ──
  canvas.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return; // left button only
    var rect = canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left;
    var sy = e.clientY - rect.top;

    self._dragStartScreenX = sx;
    self._dragStartScreenY = sy;

    // Hit-test to see if we're clicking on a node
    var hitNode = self._hitTest(sx, sy);

    if (hitNode) {
      self._isDraggingNode = true;
      self._draggedNode = hitNode;
      hitNode._dragging = true;
      self._dragStartWorldX = hitNode.x;
      self._dragStartWorldY = hitNode.y;
      self._engine._emit('dragStart', { nodeId: hitNode.id, node: hitNode });
    } else {
      self._isDraggingCanvas = true;
      var viewport = self._engine._viewport;
      viewport._dragOffsetStartX = viewport._offsetX;
      viewport._dragOffsetStartY = viewport._offsetY;
    }

    self._lastDragTime = performance.now();
  });

  // ── Mouseup → End drag / Click ──
  canvas.addEventListener('mouseup', function(e) {
    var rect = canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left;
    var sy = e.clientY - rect.top;

    var wasDragging = self._isDraggingNode || self._isDraggingCanvas;
    var dragDist = Math.hypot(sx - self._dragStartScreenX, sy - self._dragStartScreenY);
    var isClick = dragDist < 5; // 5px threshold for distinguishing click from drag

    if (self._isDraggingNode && self._draggedNode) {
      self._draggedNode._dragging = false;
      self._engine._emit('dragEnd', { nodeId: self._draggedNode.id, node: self._draggedNode });
      // Update spatial indices after drag (final position)
      self._engine._spatialIndex.updateNode(self._draggedNode);
      self._engine._spatialIndex.updateEdgesForNode(
        self._draggedNode.id, self._engine._nodeEdges, self._engine._nodeMap
      );
    }

    if (self._isDraggingCanvas) {
      // Start inertia
      self._engine._viewport._startInertia();
    }

    self._isDraggingNode = false;
    self._isDraggingCanvas = false;
    self._draggedNode = null;

    // Handle click if it wasn't a drag
    if (isClick) {
      self._handleClick(sx, sy);
    }
  });

  // ── Mouse leave ──
  canvas.addEventListener('mouseleave', function() {
    if (self._hoveredNode) {
      self._hoveredNode._hovered = false;
      self._engine.markDirtyNode(self._hoveredNode);
      self._hoveredNode = null;
      canvas.style.cursor = 'default';
    }
  });

  // ── Double click → Focus / Cluster drill-down ──
  canvas.addEventListener('dblclick', function(e) {
    var rect = canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left;
    var sy = e.clientY - rect.top;
    var hitNode = self._hitTest(sx, sy);

    if (hitNode) {
      self._engine._emit('doubleClick', {
        nodeId: hitNode.id,
        node: hitNode,
        pointer: { screen: { x: sx, y: sy } },
      });
      // Zoom to node
      self._engine.focusNode(hitNode.id, {
        scale: Math.max(self._engine._viewport.getScale() * 2, 0.5),
        animation: { duration: 600 },
      });
    } else {
      // Check cluster double-click → expand + zoom
      var clusterer = self._engine._clusterer;
      if (clusterer && clusterer.isActive()) {
        var world = self._engine._viewport.screenToWorld(sx, sy);
        var hitCluster = clusterer.hitTest(world.x, world.y);
        if (hitCluster) {
          clusterer.expandCluster(hitCluster.id, { animation: true, fitAfter: false });
          // Zoom into expanded cluster area
          self._engine._viewport.fitToNodes(hitCluster.nodes, {
            padding: 80,
            animation: { duration: 700 },
          });
          self._engine._emit('clusterDoubleClick', {
            clusterId: hitCluster.id,
            nodeCount: hitCluster.count,
          });
          return;
        }
      }
      // Double click on empty → fit all
      self._engine.fit({ animation: { duration: 800 } });
    }
  });

  // ── Context menu (right click) ──
  canvas.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left;
    var sy = e.clientY - rect.top;
    var hitNode = self._hitTest(sx, sy);
    self._engine._emit('contextMenu', {
      nodeId: hitNode ? hitNode.id : null,
      node: hitNode,
      pointer: { screen: { x: sx, y: sy } },
      domEvent: e,
    });
  });
};

// ── Hit-Test ──────────────────────────────────────────────────────────────

/**
 * Find the topmost node at screen position (sx, sy).
 * Uses spatial index for O(log n) query.
 */
InteractionManager.prototype._hitTest = function(sx, sy) {
  var world = this._engine._viewport.screenToWorld(sx, sy);
  var candidates = this._engine._spatialIndex.pointQuery(world.x, world.y);

  if (candidates.length === 0) return null;

  // Find the closest node to the query point (by center distance)
  var best = null;
  var bestDist = Infinity;
  for (var i = 0; i < candidates.length; i++) {
    var node = candidates[i]._node;
    if (!node) continue;
    var dx = node.x - world.x;
    var dy = node.y - world.y;
    var dist = dx * dx + dy * dy;
    var r = node._radius || 10;
    // Check if point is inside the node shape
    if (dist <= r * r) {
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
  }

  // If no exact hit, check if we're close enough (expanded hit area)
  if (!best && candidates.length > 0) {
    var expandFactor = 1.5; // 50% larger hit area for easier clicking
    for (var i = 0; i < candidates.length; i++) {
      var node = candidates[i]._node;
      if (!node) continue;
      var dx = node.x - world.x;
      var dy = node.y - world.y;
      var dist = dx * dx + dy * dy;
      var r = (node._radius || 10) * expandFactor;
      if (dist <= r * r && dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
  }

  return best;
};

// ── Hover ─────────────────────────────────────────────────────────────────

InteractionManager.prototype._handleHover = function(sx, sy) {
  var hitNode = this._hitTest(sx, sy);
  var prevHovered = this._hoveredNode;

  // Check cluster hover if no node hit
  var clusterer = this._engine._clusterer;
  if (!hitNode && clusterer && clusterer.isActive()) {
    var world = this._engine._viewport.screenToWorld(sx, sy);
    var hitCluster = clusterer.hitTest(world.x, world.y);
    if (hitCluster) {
      // Show cluster tooltip
      this._engine._canvas.style.cursor = 'pointer';
      this._engine._canvas.title = hitCluster.count + ' nodes (' +
        (hitCluster.dominantType || 'mixed') + ', ' +
        (hitCluster.dominantStatus || 'mixed') + ')';
      if (prevHovered) {
        prevHovered._hovered = false;
        this._engine.markDirtyNode(prevHovered);
        this._hoveredNode = null;
      }
      this._engine._emit('hoverCluster', {
        clusterId: hitCluster.id,
        count: hitCluster.count,
        dominantType: hitCluster.dominantType,
      });
      return;
    }
  }

  // Clear cluster tooltip
  this._engine._canvas.title = '';

  if (hitNode === prevHovered) return; // no change

  if (prevHovered) {
    prevHovered._hovered = false;
    // Dirty only the old hovered node's region
    this._engine.markDirtyNode(prevHovered);
  }
  if (hitNode) {
    hitNode._hovered = true;
    this._engine._canvas.style.cursor = 'pointer';
    // Dirty only the new hovered node's region
    this._engine.markDirtyNode(hitNode);
  } else {
    this._engine._canvas.style.cursor = 'default';
  }

  this._hoveredNode = hitNode;

  this._engine._emit('hover', {
    nodeId: hitNode ? hitNode.id : null,
    node: hitNode,
    previousNodeId: prevHovered ? prevHovered.id : null,
  });
};

// ── Click ─────────────────────────────────────────────────────────────────

InteractionManager.prototype._handleClick = function(sx, sy) {
  var hitNode = this._hitTest(sx, sy);

  if (hitNode) {
    // Select this node
    this._selectNode(hitNode);
    this._engine._emit('click', {
      nodes: [hitNode.id],
      nodeId: hitNode.id,
      node: hitNode,
      pointer: { screen: { x: sx, y: sy }, canvas: this._engine._viewport.screenToWorld(sx, sy) },
    });
  } else {
    // Check if clicking on a cluster
    var clusterer = this._engine._clusterer;
    if (clusterer && clusterer.isActive()) {
      var world = this._engine._viewport.screenToWorld(sx, sy);
      var hitCluster = clusterer.hitTest(world.x, world.y);
      if (hitCluster) {
        // Click on cluster → expand it
        clusterer.expandCluster(hitCluster.id, { animation: true, fitAfter: true });
        this._engine._emit('clusterClick', {
          clusterId: hitCluster.id,
          nodeCount: hitCluster.count,
          pointer: { screen: { x: sx, y: sy }, canvas: world },
        });
        return;
      }
    }

    // Deselect all
    this._deselectAll();
    this._engine._emit('click', {
      nodes: [],
      nodeId: null,
      node: null,
      pointer: { screen: { x: sx, y: sy }, canvas: this._engine._viewport.screenToWorld(sx, sy) },
    });
  }
};

InteractionManager.prototype._selectNode = function(node) {
  // Deselect previous (dirties old selection's regions)
  this._deselectAll();

  node._selected = true;
  this._selectedNodes = [node];
  this._selectedNodeMap = {};
  this._selectedNodeMap[node.id] = true;

  // Highlight connected edges
  var edges = this._engine._nodeEdges[node.id] || [];
  for (var i = 0; i < edges.length; i++) {
    edges[i]._highlighted = true;
  }

  // Dirty the selected node and its connected nodes (for edge highlighting)
  this._engine.markDirtyNode(node);
  this._engine._emit('select', { nodeIds: [node.id] });
};

InteractionManager.prototype._deselectAll = function() {
  // Dirty each previously selected node's region
  for (var i = 0; i < this._selectedNodes.length; i++) {
    this._selectedNodes[i]._selected = false;
    this._engine.markDirtyNode(this._selectedNodes[i]);
  }
  // Reset all edge highlights
  var edges = this._engine._edges;
  for (var i = 0; i < edges.length; i++) {
    edges[i]._highlighted = false;
  }
  this._selectedNodes = [];
  this._selectedNodeMap = {};
  this._engine._emit('deselect', {});
};

// ── Node Drag ─────────────────────────────────────────────────────────────

InteractionManager.prototype._handleNodeDrag = function(sx, sy) {
  if (!this._draggedNode) return;

  var world = this._engine._viewport.screenToWorld(sx, sy);
  var prevPos = { x: this._draggedNode.x, y: this._draggedNode.y };
  this._draggedNode.x = world.x;
  this._draggedNode.y = world.y;

  // Update spatial indices for the dragged node + connected edges
  this._engine._spatialIndex.updateNode(this._draggedNode);
  this._engine._spatialIndex.updateEdgesForNode(
    this._draggedNode.id, this._engine._nodeEdges, this._engine._nodeMap
  );

  // Only dirty the affected regions (old + new position)
  this._engine.markDirtyNode(this._draggedNode, prevPos);
  this._engine._emit('dragging', {
    nodeId: this._draggedNode.id,
    node: this._draggedNode,
    x: world.x,
    y: world.y,
  });
};

// ── Canvas Drag (pan) ─────────────────────────────────────────────────────

InteractionManager.prototype._handleCanvasDrag = function(sx, sy) {
  var dx = sx - this._lastMouseScreenX;
  var dy = sy - this._lastMouseScreenY;

  var viewport = this._engine._viewport;
  viewport._offsetX += dx;
  viewport._offsetY += dy;

  // Track velocity for inertia
  var now = performance.now();
  var dt = now - this._lastDragTime;
  if (dt > 0) {
    viewport._velocityX = dx * (16 / dt); // normalize to ~60fps
    viewport._velocityY = dy * (16 / dt);
  }
  this._lastDragTime = now;

  this._engine.markDirty();
};

// ── Cleanup ───────────────────────────────────────────────────────────────

InteractionManager.prototype.destroy = function() {
  // Event listeners are on the canvas which will be removed
  this._hoveredNode = null;
  this._selectedNodes = [];
  this._draggedNode = null;
};
`;
}
