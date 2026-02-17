/**
 * Clusterer — 节点聚合器 (完整实现)
 *
 * 在极低缩放级别时，将空间邻近的节点聚合为 cluster 节点。
 * 使用网格聚合 (grid-based clustering) 算法:
 * 1. 将世界空间划分为网格
 * 2. 每个网格内的多个节点聚合为一个 cluster
 * 3. cluster 显示计数标签、主类型颜色、状态饼图
 * 4. 缩放到阈值以上时自动展开
 * 5. Spring 展开/收起过渡动画
 * 6. 多级递归聚合
 *
 * Phase 8B 完整实现
 */

export function getClustererScript(): string {
  return `
// ============================================================================
// Clusterer — Grid-based Node Aggregation (Full Implementation)
// ============================================================================

function Clusterer(engine) {
  this._engine = engine;
  this._enabled = false;
  this._clusters = [];         // [{id, nodes, x, y, count, radius, ...}, ...]
  this._clusterMap = {};       // clusterId → cluster
  this._nodeToCluster = {};    // nodeId → clusterId
  this._gridSize = 200;        // world-space grid cell size (base)
  this._clusterThreshold = 0.08; // scale below which clustering activates
  this._minClusterSize = 2;    // minimum nodes to form a cluster
  this._lastRebuildScale = -1; // last scale at which clusters were rebuilt
  this._rebuildThresholdRatio = 1.5; // rebuild when scale changes by this factor

  // Animation state
  this._animating = false;
  this._animations = [];       // [{node, startX, startY, targetX, targetY, t, duration}, ...]
  this._animRafId = null;

  // Multi-level: clusters of clusters
  this._level = 0;             // current aggregation level
  this._parentClusters = [];   // level-2 super-clusters
}

/**
 * Enable/disable clustering.
 */
Clusterer.prototype.setEnabled = function(enabled) {
  this._enabled = enabled;
  if (enabled) {
    this.rebuild();
  } else {
    this._clearAllClusters();
  }
};

Clusterer.prototype._clearAllClusters = function() {
  // Restore visibility to all nodes
  var nodes = this._engine._nodes;
  for (var i = 0; i < nodes.length; i++) {
    nodes[i]._visible = true;
    nodes[i]._clustered = false;
  }
  this._clusters = [];
  this._clusterMap = {};
  this._nodeToCluster = {};
  this._parentClusters = [];
  this._level = 0;
  this._lastRebuildScale = -1;
};

/**
 * Check if clustering should be active at the current zoom level.
 */
Clusterer.prototype.isActive = function() {
  if (!this._enabled) return false;
  return this._engine._viewport.getScale() < this._clusterThreshold;
};

/**
 * Check if clusters need rebuilding based on scale change.
 */
Clusterer.prototype.needsRebuild = function() {
  if (!this._enabled) return false;
  var scale = this._engine._viewport.getScale();
  if (this._lastRebuildScale <= 0) return true;
  var ratio = Math.max(scale / this._lastRebuildScale, this._lastRebuildScale / scale);
  return ratio > this._rebuildThresholdRatio;
};

/**
 * Rebuild clusters based on current node positions and zoom level.
 * Uses adaptive grid-based clustering for O(n) performance.
 * Grid size adapts to zoom: zoomed further out → larger grids → more aggregation.
 */
Clusterer.prototype.rebuild = function() {
  if (!this._enabled) return;

  var engine = this._engine;
  var nodes = engine._nodes;
  var scale = engine._viewport.getScale();
  this._lastRebuildScale = scale;

  // Adaptive grid size: smaller scale → larger grid → more aggregation
  var baseGrid = this._gridSize;
  var adaptiveGrid = baseGrid / Math.max(scale * 5, 0.01);
  adaptiveGrid = Math.max(adaptiveGrid, 100);  // minimum grid size
  adaptiveGrid = Math.min(adaptiveGrid, 5000); // maximum grid size

  var grid = {};  // "gx:gy" → [node, ...]

  // Assign nodes to grid cells
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var gx = Math.floor(n.x / adaptiveGrid);
    var gy = Math.floor(n.y / adaptiveGrid);
    var key = gx + ':' + gy;
    if (!grid[key]) grid[key] = [];
    grid[key].push(n);
  }

  // Reset old state
  for (var i = 0; i < nodes.length; i++) {
    nodes[i]._visible = true;
    nodes[i]._clustered = false;
  }
  this._clusters = [];
  this._clusterMap = {};
  this._nodeToCluster = {};
  var clusterId = 0;

  var keys = Object.keys(grid);
  for (var i = 0; i < keys.length; i++) {
    var cellNodes = grid[keys[i]];
    if (cellNodes.length < this._minClusterSize) continue; // too few, show individually

    // Compute centroid
    var cx = 0, cy = 0;
    for (var j = 0; j < cellNodes.length; j++) {
      cx += cellNodes[j].x;
      cy += cellNodes[j].y;
    }
    cx /= cellNodes.length;
    cy /= cellNodes.length;

    // Determine dominant type and status
    var typeCount = {};
    var statusCount = {};
    for (var j = 0; j < cellNodes.length; j++) {
      var t = cellNodes[j].type || 'default';
      var s = (cellNodes[j].properties || {}).status || 'pending';
      typeCount[t] = (typeCount[t] || 0) + 1;
      statusCount[s] = (statusCount[s] || 0) + 1;
    }
    var dominantType = this._getDominant(typeCount);
    var dominantStatus = this._getDominant(statusCount);

    // Get style for the cluster based on dominant type
    var styles = engine._styles;
    var mockNode = { type: dominantType, properties: { status: dominantStatus }, degree: cellNodes.length };
    var clusterStyle = styles.getNodeStyle(mockNode);

    var cluster = {
      id: 'cluster_' + (clusterId++),
      nodes: cellNodes,
      nodeIds: [],
      x: cx,
      y: cy,
      count: cellNodes.length,
      radius: Math.max(18, Math.min(Math.sqrt(cellNodes.length) * 6, 60)),
      dominantType: dominantType,
      dominantStatus: dominantStatus,
      bgColor: clusterStyle.bgColor,
      borderColor: clusterStyle.borderColor,
      fontColor: clusterStyle.fontColor || '#fff',
      statusBreakdown: statusCount,
      _aabb: null, // will be set below
    };

    for (var j = 0; j < cellNodes.length; j++) {
      cluster.nodeIds.push(cellNodes[j].id);
      this._nodeToCluster[cellNodes[j].id] = cluster.id;
      cellNodes[j]._visible = false;  // hide individual nodes
      cellNodes[j]._clustered = true;
    }

    // Set AABB for cluster hit-test
    cluster._aabb = {
      minX: cx - cluster.radius,
      minY: cy - cluster.radius,
      maxX: cx + cluster.radius,
      maxY: cy + cluster.radius,
    };

    this._clusters.push(cluster);
    this._clusterMap[cluster.id] = cluster;
  }

  // Multi-level: if there are still too many clusters, create super-clusters
  this._parentClusters = [];
  if (this._clusters.length > 200 && scale < this._clusterThreshold * 0.3) {
    this._buildSuperClusters(adaptiveGrid * 3);
  }
};

/**
 * Build level-2 super-clusters (clusters of clusters).
 */
Clusterer.prototype._buildSuperClusters = function(superGridSize) {
  var grid = {};
  for (var i = 0; i < this._clusters.length; i++) {
    var c = this._clusters[i];
    var gx = Math.floor(c.x / superGridSize);
    var gy = Math.floor(c.y / superGridSize);
    var key = gx + ':' + gy;
    if (!grid[key]) grid[key] = [];
    grid[key].push(c);
  }

  this._parentClusters = [];
  var keys = Object.keys(grid);
  for (var i = 0; i < keys.length; i++) {
    var subClusters = grid[keys[i]];
    if (subClusters.length < 2) continue;

    var cx = 0, cy = 0, totalCount = 0;
    for (var j = 0; j < subClusters.length; j++) {
      cx += subClusters[j].x * subClusters[j].count;
      cy += subClusters[j].y * subClusters[j].count;
      totalCount += subClusters[j].count;
    }
    cx /= totalCount;
    cy /= totalCount;

    this._parentClusters.push({
      id: 'super_' + i,
      subClusters: subClusters,
      x: cx,
      y: cy,
      count: totalCount,
      radius: Math.max(25, Math.min(Math.sqrt(totalCount) * 4, 80)),
      bgColor: '#6366f1',
      borderColor: '#4f46e5',
      fontColor: '#fff',
    });

    // Mark sub-clusters as hidden
    for (var j = 0; j < subClusters.length; j++) {
      subClusters[j]._superClustered = true;
    }
  }
};

Clusterer.prototype._getDominant = function(countMap) {
  var maxKey = null, maxCount = 0;
  var keys = Object.keys(countMap);
  for (var i = 0; i < keys.length; i++) {
    if (countMap[keys[i]] > maxCount) {
      maxCount = countMap[keys[i]];
      maxKey = keys[i];
    }
  }
  return maxKey;
};

/**
 * Get clusters for rendering (filters out super-clustered ones).
 */
Clusterer.prototype.getClusters = function() {
  if (this._parentClusters.length > 0) {
    // Return only non-super-clustered clusters + super-clusters
    var visible = [];
    for (var i = 0; i < this._clusters.length; i++) {
      if (!this._clusters[i]._superClustered) visible.push(this._clusters[i]);
    }
    return visible.concat(this._parentClusters);
  }
  return this._clusters;
};

/**
 * Check if a node is currently inside a cluster.
 */
Clusterer.prototype.isNodeClustered = function(nodeId) {
  return !!this._nodeToCluster[nodeId];
};

/**
 * Hit-test: find cluster at world coordinates.
 */
Clusterer.prototype.hitTest = function(worldX, worldY) {
  var clusters = this.getClusters();
  for (var i = clusters.length - 1; i >= 0; i--) {
    var c = clusters[i];
    var dx = worldX - c.x;
    var dy = worldY - c.y;
    if (dx * dx + dy * dy <= c.radius * c.radius) {
      return c;
    }
  }
  return null;
};

/**
 * Expand a cluster with Spring animation.
 * @param {string} clusterId
 * @param {Object} [options] — { animation: boolean, fitAfter: boolean }
 */
Clusterer.prototype.expandCluster = function(clusterId, options) {
  var cluster = this._clusterMap[clusterId];
  if (!cluster) return;

  var opts = options || {};
  var animate = opts.animation !== false;
  var fitAfter = opts.fitAfter !== false;
  var engine = this._engine;

  // Remove cluster
  var idx = this._clusters.indexOf(cluster);
  if (idx >= 0) this._clusters.splice(idx, 1);
  delete this._clusterMap[clusterId];

  // Restore nodes
  for (var i = 0; i < cluster.nodes.length; i++) {
    var node = cluster.nodes[i];
    delete this._nodeToCluster[node.id];
    node._visible = true;
    node._clustered = false;

    if (animate) {
      // Start all nodes at cluster center, animate to their real positions
      var realX = node.x;
      var realY = node.y;
      node.x = cluster.x;
      node.y = cluster.y;
      this._animations.push({
        node: node,
        startX: cluster.x,
        startY: cluster.y,
        targetX: realX,
        targetY: realY,
        t: 0,
        duration: 400 + Math.random() * 200, // stagger slightly
      });
    }
  }

  if (animate && this._animations.length > 0) {
    this._startAnimation();
  }

  // Rebuild spatial index with restored nodes
  engine._spatialIndex.buildFromNodes(engine._nodes);
  engine._spatialIndex.buildEdgeIndex(engine._edges, engine._nodeMap);
  engine.markDirty();

  // Emit event
  engine._emit('clusterExpanded', { clusterId: clusterId, nodeCount: cluster.nodes.length });

  // Fit to expanded nodes after animation
  if (fitAfter && !animate) {
    engine._viewport.fitToNodes(cluster.nodes, { padding: 80, animation: { duration: 600 } });
  }
};

/**
 * Collapse nodes back into cluster (reverse of expand).
 * @param {Array} nodeIds — nodes to re-cluster
 */
Clusterer.prototype.collapseNodes = function(nodeIds) {
  // Simply rebuild clusters — the auto-clustering will re-aggregate
  this.rebuild();
  this._engine.markDirty();
};

// ── Spring Animation ──────────────────────────────────────────────────────

/**
 * Start the expand/collapse animation loop.
 */
Clusterer.prototype._startAnimation = function() {
  if (this._animating) return;
  this._animating = true;

  var self = this;
  var engine = this._engine;
  var startTime = performance.now();

  function animate(now) {
    var allDone = true;
    var elapsed = now - startTime;

    for (var i = self._animations.length - 1; i >= 0; i--) {
      var a = self._animations[i];
      a.t = Math.min(elapsed / a.duration, 1);

      // Spring easing function
      var progress = self._springEase(a.t);

      a.node.x = a.startX + (a.targetX - a.startX) * progress;
      a.node.y = a.startY + (a.targetY - a.startY) * progress;

      if (a.t >= 1) {
        // Ensure final position
        a.node.x = a.targetX;
        a.node.y = a.targetY;
        self._animations.splice(i, 1);
      } else {
        allDone = false;
      }
    }

    // Rebuild spatial index during animation
    engine._spatialIndex.buildFromNodes(engine._nodes);
    engine._spatialIndex.buildEdgeIndex(engine._edges, engine._nodeMap);
    engine.markDirty();

    if (allDone) {
      self._animating = false;
      self._animRafId = null;
      // Fit to expanded nodes
      var expandedNodes = engine._nodes.filter(function(n) { return n._visible; });
      // Don't auto-fit — let user control viewport
    } else {
      self._animRafId = requestAnimationFrame(animate);
    }
  }

  this._animRafId = requestAnimationFrame(animate);
};

/**
 * Spring easing: overshoot + settle.
 * Based on a critically damped spring model.
 */
Clusterer.prototype._springEase = function(t) {
  // Spring parameters
  var frequency = 4.5;  // oscillation frequency
  var damping = 0.7;    // damping ratio
  if (t >= 1) return 1;
  return 1 - Math.exp(-damping * t * 10) * Math.cos(frequency * t * Math.PI);
};

/**
 * Set clustering threshold.
 */
Clusterer.prototype.setThreshold = function(threshold) {
  this._clusterThreshold = threshold;
};

/**
 * Set grid size.
 */
Clusterer.prototype.setGridSize = function(size) {
  this._gridSize = size;
};
`;
}
