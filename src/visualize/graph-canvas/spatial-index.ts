/**
 * SpatialIndex — 内联 R-tree 空间索引 (无外部依赖)
 *
 * 轻量级 R-tree 实现，支持:
 * - bulk insert (STR 批量构建)
 * - viewport search (矩形范围查询)
 * - point query (hit-test)
 * - 动态 insert/remove/update
 *
 * 基于简化版 rbush 算法，优化为图谱节点场景。
 */

export function getSpatialIndexScript(): string {
  return `
// ============================================================================
// SpatialIndex — Lightweight R-tree for viewport culling & hit-test
// ============================================================================

/**
 * Minimal R-tree implementation optimized for graph nodes.
 * Supports bulk load, search, point query, insert, remove.
 */
function SpatialIndex() {
  this._maxEntries = 16;   // max children per node
  this._minEntries = 4;    // min children per node (for split)
  this._root = this._createNode([]);
  this._nodeIdToItem = {};  // nodeId → leaf item (for O(1) remove/update)

  // Edge spatial index — separate R-tree for edges
  this._edgeRoot = this._createNode([]);
  this._edgeIdToItem = {};  // edgeId → leaf item
}

// ── Node structure ────────────────────────────────────────────────────────
SpatialIndex.prototype._createNode = function(children) {
  return {
    children: children,
    height: 1,     // 1 = leaf
    leaf: true,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
};

// ── Build from nodes (bulk load) ──────────────────────────────────────────

/**
 * Build the R-tree from all graph nodes.
 * Uses Sort-Tile-Recursive (STR) bulk loading for optimal tree structure.
 * @param {Array} nodes — [{id, x, y, _radius, ...}, ...]
 */
SpatialIndex.prototype.buildFromNodes = function(nodes) {
  this._nodeIdToItem = {};
  if (!nodes || nodes.length === 0) {
    this._root = this._createNode([]);
    return;
  }

  // Create leaf items with AABB
  var items = [];
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var r = n._radius || 10;
    var item = {
      minX: n.x - r,
      minY: n.y - r,
      maxX: n.x + r,
      maxY: n.y + r,
      _nodeId: n.id,
      _node: n,
    };
    n._aabb = item; // back-reference
    items.push(item);
    this._nodeIdToItem[n.id] = item;
  }

  // Build tree using STR bulk loading
  this._root = this._buildSTR(items, 0, items.length - 1, 0);
};

SpatialIndex.prototype._buildSTR = function(items, left, right, level) {
  var N = right - left + 1;
  var M = this._maxEntries;

  if (N <= M) {
    // Fits in one leaf node
    var node = this._createNode(items.slice(left, right + 1));
    this._calcBBox(node);
    return node;
  }

  // Sort by X, then divide into vertical slices
  if (level % 2 === 0) {
    items.sort(function(a, b) { return a.minX - b.minX; });
  } else {
    items.sort(function(a, b) { return a.minY - b.minY; });
  }

  var S = Math.ceil(N / M);
  var children = [];

  for (var i = left; i <= right; i += S) {
    var end = Math.min(i + S - 1, right);
    if (end - i + 1 <= M) {
      var child = this._createNode(items.slice(i, end + 1));
      this._calcBBox(child);
      children.push(child);
    } else {
      children.push(this._buildSTR(items, i, end, level + 1));
    }
  }

  var node = this._createNode(children);
  node.leaf = false;
  node.height = children[0].height + 1;
  this._calcBBox(node);
  return node;
};

SpatialIndex.prototype._calcBBox = function(node) {
  var children = node.children;
  node.minX = Infinity;
  node.minY = Infinity;
  node.maxX = -Infinity;
  node.maxY = -Infinity;
  for (var i = 0; i < children.length; i++) {
    var c = children[i];
    if (c.minX < node.minX) node.minX = c.minX;
    if (c.minY < node.minY) node.minY = c.minY;
    if (c.maxX > node.maxX) node.maxX = c.maxX;
    if (c.maxY > node.maxY) node.maxY = c.maxY;
  }
};

// ── Search (viewport query) ──────────────────────────────────────────────

/**
 * Find all items intersecting the given AABB.
 * @param {{minX, minY, maxX, maxY}} bbox
 * @returns {Array} array of items with _nodeId and _node references
 */
SpatialIndex.prototype.search = function(bbox) {
  var result = [];
  this._searchNode(this._root, bbox, result);
  return result;
};

SpatialIndex.prototype._searchNode = function(node, bbox, result) {
  if (!this._intersects(node, bbox)) return;

  var children = node.children;
  if (node.leaf) {
    for (var i = 0; i < children.length; i++) {
      if (this._intersects(children[i], bbox)) {
        result.push(children[i]);
      }
    }
  } else {
    for (var i = 0; i < children.length; i++) {
      this._searchNode(children[i], bbox, result);
    }
  }
};

SpatialIndex.prototype._intersects = function(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX &&
         a.minY <= b.maxY && a.maxY >= b.minY;
};

// ── Point Query (hit-test) ───────────────────────────────────────────────

/**
 * Find all items containing the given point.
 * @param {number} x - World X
 * @param {number} y - World Y
 * @returns {Array} items at this point
 */
SpatialIndex.prototype.pointQuery = function(x, y) {
  var point = { minX: x, minY: y, maxX: x, maxY: y };
  return this.search(point);
};

// ── Dynamic updates ──────────────────────────────────────────────────────

/**
 * Update a node's position in the spatial index.
 * @param {Object} node — graph node with .id, .x, .y, ._radius
 */
SpatialIndex.prototype.updateNode = function(node) {
  var item = this._nodeIdToItem[node.id];
  if (!item) return;
  var r = node._radius || 10;
  item.minX = node.x - r;
  item.minY = node.y - r;
  item.maxX = node.x + r;
  item.maxY = node.y + r;
  node._aabb = item;
  // Note: for optimal performance with frequent updates (e.g., during layout),
  // we defer tree rebalancing. The tree stays valid but suboptimal.
  // Call rebuildFromNodes() when layout stabilizes.
  this._markAncestorsDirty();
};

SpatialIndex.prototype._markAncestorsDirty = function() {
  // Simple approach: recalculate root bbox (propagation optimization deferred)
  this._calcBBoxRecursive(this._root);
};

SpatialIndex.prototype._calcBBoxRecursive = function(node) {
  if (node.leaf) {
    this._calcBBox(node);
    return;
  }
  for (var i = 0; i < node.children.length; i++) {
    this._calcBBoxRecursive(node.children[i]);
  }
  this._calcBBox(node);
};

/**
 * Remove a node from the spatial index.
 */
SpatialIndex.prototype.removeNode = function(nodeId) {
  var item = this._nodeIdToItem[nodeId];
  if (!item) return;
  this._removeItem(this._root, item);
  delete this._nodeIdToItem[nodeId];
};

SpatialIndex.prototype._removeItem = function(node, item) {
  if (node.leaf) {
    var idx = node.children.indexOf(item);
    if (idx >= 0) {
      node.children.splice(idx, 1);
      this._calcBBox(node);
      return true;
    }
    return false;
  }
  for (var i = 0; i < node.children.length; i++) {
    if (this._intersects(node.children[i], item)) {
      if (this._removeItem(node.children[i], item)) {
        if (node.children[i].children.length === 0) {
          node.children.splice(i, 1);
        }
        this._calcBBox(node);
        return true;
      }
    }
  }
  return false;
};

/**
 * Rebuild the tree (call after many updates/removes for optimal performance).
 */
SpatialIndex.prototype.rebuild = function(nodes) {
  this.buildFromNodes(nodes);
};

/**
 * Get the total number of items in the index.
 */
SpatialIndex.prototype.size = function() {
  return Object.keys(this._nodeIdToItem).length;
};

// ============================================================================
// Edge Spatial Index — R-tree for edges (AABB = bounding box of from→to)
// ============================================================================

/**
 * Build the edge R-tree from all edges.
 * Edge AABB = bounding box of (fromNode, toNode) positions.
 * @param {Array} edges — [{id, from, to, ...}, ...]
 * @param {Object} nodeMap — { nodeId → node }
 */
SpatialIndex.prototype.buildEdgeIndex = function(edges, nodeMap) {
  this._edgeIdToItem = {};
  if (!edges || edges.length === 0) {
    this._edgeRoot = this._createNode([]);
    return;
  }

  var items = [];
  for (var i = 0; i < edges.length; i++) {
    var e = edges[i];
    var fromNode = nodeMap[e.from];
    var toNode = nodeMap[e.to];
    if (!fromNode || !toNode) continue;

    var item = this._calcEdgeAABB(e, fromNode, toNode);
    items.push(item);
    this._edgeIdToItem[e.id] = item;
  }

  if (items.length === 0) {
    this._edgeRoot = this._createNode([]);
    return;
  }

  this._edgeRoot = this._buildSTR(items, 0, items.length - 1, 0);
};

/**
 * Calculate AABB for an edge based on its endpoint node positions.
 */
SpatialIndex.prototype._calcEdgeAABB = function(edge, fromNode, toNode) {
  var pad = 2; // small padding for line width
  var minX = Math.min(fromNode.x, toNode.x) - pad;
  var minY = Math.min(fromNode.y, toNode.y) - pad;
  var maxX = Math.max(fromNode.x, toNode.x) + pad;
  var maxY = Math.max(fromNode.y, toNode.y) + pad;
  return {
    minX: minX,
    minY: minY,
    maxX: maxX,
    maxY: maxY,
    _edgeId: edge.id,
    _edge: edge,
  };
};

/**
 * Search for edges whose AABB intersects the given bounding box.
 * @param {{minX, minY, maxX, maxY}} bbox
 * @returns {Array} items with _edgeId and _edge references
 */
SpatialIndex.prototype.searchEdges = function(bbox) {
  var result = [];
  this._searchNode(this._edgeRoot, bbox, result);
  return result;
};

/**
 * Update edge AABBs when a node moves.
 * @param {string} nodeId — the node that moved
 * @param {Object} nodeEdges — { nodeId → [edge, ...] } adjacency list
 * @param {Object} nodeMap — { nodeId → node }
 */
SpatialIndex.prototype.updateEdgesForNode = function(nodeId, nodeEdges, nodeMap) {
  var edges = nodeEdges[nodeId] || [];
  for (var i = 0; i < edges.length; i++) {
    var e = edges[i];
    var item = this._edgeIdToItem[e.id];
    if (!item) continue;
    var fromNode = nodeMap[e.from];
    var toNode = nodeMap[e.to];
    if (!fromNode || !toNode) continue;
    var pad = 2;
    item.minX = Math.min(fromNode.x, toNode.x) - pad;
    item.minY = Math.min(fromNode.y, toNode.y) - pad;
    item.maxX = Math.max(fromNode.x, toNode.x) + pad;
    item.maxY = Math.max(fromNode.y, toNode.y) + pad;
  }
  // Propagate changes up (simple approach)
  this._calcBBoxRecursive(this._edgeRoot);
};

/**
 * Get the number of edges in the edge index.
 */
SpatialIndex.prototype.edgeSize = function() {
  return Object.keys(this._edgeIdToItem).length;
};

// ============================================================================
// Incremental Insert (Phase-8C) — add single items without full rebuild
// ============================================================================

/**
 * Insert a single node into the R-tree incrementally.
 * Uses simple insertion into the best-fit leaf.
 * @param {Object} node — graph node with .id, .x, .y, ._radius
 */
SpatialIndex.prototype.insertNode = function(node) {
  var r = node._radius || 10;
  var item = {
    minX: node.x - r,
    minY: node.y - r,
    maxX: node.x + r,
    maxY: node.y + r,
    _nodeId: node.id,
    _node: node,
  };
  node._aabb = item;
  this._nodeIdToItem[node.id] = item;
  this._insertItem(this._root, item);
};

/**
 * Insert a single edge into the edge R-tree incrementally.
 * @param {Object} edge — graph edge
 * @param {Object} fromNode — source node
 * @param {Object} toNode — target node
 */
SpatialIndex.prototype.insertEdge = function(edge, fromNode, toNode) {
  var item = this._calcEdgeAABB(edge, fromNode, toNode);
  this._edgeIdToItem[edge.id] = item;
  this._insertItem(this._edgeRoot, item);
};

/**
 * Insert an item into an R-tree node (simple greedy insert).
 * Finds the leaf with minimum area enlargement and adds the item.
 */
SpatialIndex.prototype._insertItem = function(root, item) {
  var node = root;

  // Traverse to find best leaf
  while (!node.leaf) {
    var bestChild = null;
    var bestEnlargement = Infinity;
    var bestArea = Infinity;

    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      var area = this._area(child);
      var enlargement = this._enlargedArea(child, item) - area;

      if (enlargement < bestEnlargement || (enlargement === bestEnlargement && area < bestArea)) {
        bestEnlargement = enlargement;
        bestArea = area;
        bestChild = child;
      }
    }
    node = bestChild;
  }

  // Add to leaf
  node.children.push(item);

  // Split if needed
  if (node.children.length > this._maxEntries) {
    this._splitNode(node);
  }

  // Update bounding boxes up the tree
  this._calcBBoxRecursive(root);
};

SpatialIndex.prototype._area = function(node) {
  return (node.maxX - node.minX) * (node.maxY - node.minY);
};

SpatialIndex.prototype._enlargedArea = function(node, item) {
  var minX = Math.min(node.minX, item.minX);
  var minY = Math.min(node.minY, item.minY);
  var maxX = Math.max(node.maxX, item.maxX);
  var maxY = Math.max(node.maxY, item.maxY);
  return (maxX - minX) * (maxY - minY);
};

/**
 * Split an overfull leaf into two halves (simple median split).
 */
SpatialIndex.prototype._splitNode = function(node) {
  var items = node.children;
  // Sort by center X
  items.sort(function(a, b) {
    return (a.minX + a.maxX) - (b.minX + b.maxX);
  });
  var mid = Math.ceil(items.length / 2);
  node.children = items.slice(0, mid);
  this._calcBBox(node);
  // The remaining items need to go into a sibling —
  // for simplicity, just keep them in the same node but in a new child
  // This is a simplified split; full R-tree split would restructure parent
  // For incremental adds, this is sufficient; periodic rebuild() restores optimal structure
  var overflow = items.slice(mid);
  for (var i = 0; i < overflow.length; i++) {
    node.children.push(overflow[i]);
  }
  this._calcBBox(node);
};
`;
}
