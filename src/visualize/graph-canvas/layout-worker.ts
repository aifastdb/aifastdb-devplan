/**
 * LayoutEngine — Web Worker 力导向布局
 *
 * 将力导向布局移入 Web Worker，避免阻塞 UI 主线程。
 * Worker 每迭代一批后通过 postMessage 发送节点位置。
 * 主线程增量更新渲染。
 *
 * Phase 8B 升级:
 * - Barnes-Hut 四叉树: O(n log n) 排斥力近似 (θ=0.8)
 * - 自适应算法: <1K 用原始 FR, >1K 用 Barnes-Hut
 * - 提前终止: 能量阈值收敛检测
 * - 进度报告: 百分比 + 剩余时间估算
 *
 * 当前版本: 内联 Worker (Blob URL)，无外部依赖。
 */

export function getLayoutWorkerScript(): string {
  return `
// ============================================================================
// LayoutEngine — Web Worker Force-Directed Layout (Barnes-Hut Optimized)
// ============================================================================

function LayoutEngine(engine) {
  this._engine = engine;
  this._worker = null;
  this._isRunning = false;
  this._iterationCount = 0;
  this._maxIterations = 300;
  this._onStabilized = null;
  this._startTime = 0;

  // Layout parameters
  this._options = {
    gravity: 0.015,
    repulsion: -80,
    springLength: 150,
    springConstant: 0.05,
    damping: 0.4,
    batchSize: 10,        // iterations per message
    idealEdgeLength: 120,
    theta: 0.8,           // Barnes-Hut approximation parameter
    earlyTerminationThreshold: 0.3, // stop when energy below this (lowered for better convergence)
    avoidOverlap: 0.8,    // overlap avoidance strength (0=off, 1=full)
  };
}

/**
 * Start the force-directed layout.
 * Automatically selects Barnes-Hut for >1000 nodes.
 */
LayoutEngine.prototype.start = function(options) {
  if (this._isRunning) this.stop();

  var opts = Object.assign({}, this._options, options || {});
  this._maxIterations = opts.maxIterations || 300;
  this._iterationCount = 0;
  this._isRunning = true;
  this._startTime = performance.now();

  var engine = this._engine;
  var nodes = engine._nodes;
  var edges = engine._edges;

  // Auto-select algorithm based on node count
  var useBarnesHut = nodes.length > 500; // Lower threshold: BH is better for 500+ nodes
  opts.useBarnesHut = useBarnesHut;

  // Adapt max iterations based on graph size
  if (nodes.length > 10000) {
    opts.maxIterations = Math.min(opts.maxIterations, 100);
    opts.batchSize = 3;
  } else if (nodes.length > 5000) {
    opts.maxIterations = Math.min(opts.maxIterations, 200);
    opts.batchSize = 5;
  } else if (nodes.length > 2000) {
    opts.maxIterations = Math.min(opts.maxIterations, 300);
    opts.batchSize = 8;
  }
  // For medium graphs (<2000), keep higher iteration count for quality
  this._maxIterations = opts.maxIterations;

  // Prepare node/edge data for worker
  var nodeData = [];
  for (var i = 0; i < nodes.length; i++) {
    nodeData.push({
      id: nodes[i].id,
      x: nodes[i].x,
      y: nodes[i].y,
      radius: nodes[i]._radius || 10,
      degree: nodes[i].degree || 0,
      type: nodes[i].type,
    });
  }
  var edgeData = [];
  for (var i = 0; i < edges.length; i++) {
    edgeData.push({ from: edges[i].from, to: edges[i].to });
  }

  // Create inline Worker
  var workerCode = this._getWorkerCode();
  var blob = new Blob([workerCode], { type: 'application/javascript' });
  var workerUrl = URL.createObjectURL(blob);
  this._worker = new Worker(workerUrl);
  URL.revokeObjectURL(workerUrl);

  var self = this;

  this._worker.onmessage = function(e) {
    var msg = e.data;

    if (msg.type === 'positions') {
      // ── Phase-8C: Zero-copy Float32Array path ──
      if (msg.positionBuffer && msg.positionBuffer instanceof Float32Array) {
        var buf = msg.positionBuffer;
        // Bulk update from typed array (stride=2: x0,y0,x1,y1,...)
        for (var i = 0; i < engine._nodes.length && i * 2 + 1 < buf.length; i++) {
          engine._nodes[i].x = buf[i * 2];
          engine._nodes[i].y = buf[i * 2 + 1];
        }
        // Sync to engine's own TypedArray
        if (engine._positionArray && engine._positionArray.length === buf.length) {
          engine._positionArray.set(buf);
        }
      } else {
        // Legacy JS object array path
        var positions = msg.positions;
        for (var i = 0; i < positions.length; i++) {
          var p = positions[i];
          var node = engine._nodeMap[p.id];
          if (node) {
            node.x = p.x;
            node.y = p.y;
          }
        }
      }

      // Rebuild spatial indices (nodes + edges)
      engine._spatialIndex.buildFromNodes(engine._nodes);
      engine._spatialIndex.buildEdgeIndex(engine._edges, engine._nodeMap);
      engine.markDirty();
      self._iterationCount = msg.iteration;

      // Calculate elapsed time and ETA
      var elapsed = performance.now() - self._startTime;
      var progress = msg.iteration / self._maxIterations;
      var eta = progress > 0.01 ? (elapsed / progress - elapsed) : 0;

      engine._emit('layoutProgress', {
        iteration: msg.iteration,
        maxIterations: self._maxIterations,
        percent: Math.round(progress * 100),
        energy: msg.energy,
        algorithm: msg.algorithm || 'unknown',
        elapsed: Math.round(elapsed),
        eta: Math.round(eta),
      });
    }

    if (msg.type === 'done') {
      self._isRunning = false;
      var totalTime = Math.round(performance.now() - self._startTime);
      engine._emit('stabilizationDone', {
        iterations: msg.iteration,
        totalTimeMs: totalTime,
        algorithm: msg.algorithm || 'unknown',
        reason: msg.reason || 'maxIterations',
      });
      if (self._onStabilized) {
        self._onStabilized();
        self._onStabilized = null;
      }
    }
  };

  // ── Phase-8C: Send initial positions as Float32Array (Transferable) ──
  var initPositionBuf = new Float32Array(nodeData.length * 2);
  for (var i = 0; i < nodeData.length; i++) {
    initPositionBuf[i * 2] = nodeData[i].x;
    initPositionBuf[i * 2 + 1] = nodeData[i].y;
  }

  this._worker.postMessage({
    type: 'init',
    nodes: nodeData,
    edges: edgeData,
    options: opts,
    positionBuffer: initPositionBuf,
  }, [initPositionBuf.buffer]); // Transferable — zero-copy
};

/**
 * Stop the layout simulation.
 */
LayoutEngine.prototype.stop = function() {
  if (this._worker) {
    this._worker.terminate();
    this._worker = null;
  }
  this._isRunning = false;
};

/**
 * Destroy the layout engine.
 */
LayoutEngine.prototype.destroy = function() {
  this.stop();
};

/**
 * Generate the Web Worker code as a string.
 * Includes Barnes-Hut QuadTree and adaptive algorithm selection.
 */
LayoutEngine.prototype._getWorkerCode = function() {
  return \`
    var nodes = [];
    var edges = [];
    var nodeMap = {};
    var options = {};
    var iteration = 0;
    var maxIterations = 300;

    self.onmessage = function(e) {
      var msg = e.data;
      if (msg.type === 'init') {
        nodes = msg.nodes;
        edges = msg.edges;
        options = msg.options || {};
        maxIterations = options.maxIterations || 300;
        nodeMap = {};

        // Accept Float32Array positions (Phase-8C zero-copy)
        var posBuf = msg.positionBuffer;

        for (var i = 0; i < nodes.length; i++) {
          if (posBuf && i * 2 + 1 < posBuf.length) {
            nodes[i].x = posBuf[i * 2];
            nodes[i].y = posBuf[i * 2 + 1];
          }
          nodes[i].vx = 0;
          nodes[i].vy = 0;
          nodes[i].fx = 0;
          nodes[i].fy = 0;
          nodes[i].mass = 1 + (nodes[i].degree || 0) * 0.1;
          nodeMap[nodes[i].id] = nodes[i];
        }
        iteration = 0;
        runSimulation();
      }
    };

    // ================================================================
    // QuadTree for Barnes-Hut approximation
    // ================================================================

    function QuadTree(x, y, w, h) {
      this.x = x;       // center X
      this.y = y;       // center Y
      this.w = w;       // half-width
      this.h = h;       // half-height
      this.body = null;  // single body (leaf)
      this.mass = 0;     // total mass
      this.cx = 0;       // center of mass X
      this.cy = 0;       // center of mass Y
      this.nw = null;    // children
      this.ne = null;
      this.sw = null;
      this.se = null;
      this.isLeaf = true;
      this.isEmpty = true;
    }

    /**
     * Insert a body into the quadtree.
     */
    QuadTree.prototype.insert = function(body) {
      if (this.isEmpty) {
        this.body = body;
        this.mass = body.mass;
        this.cx = body.x;
        this.cy = body.y;
        this.isEmpty = false;
        return;
      }

      if (this.isLeaf) {
        // Subdivide
        this._subdivide();
        // Re-insert existing body
        this._insertIntoChild(this.body);
        this.body = null;
        this.isLeaf = false;
      }

      // Insert new body into appropriate child
      this._insertIntoChild(body);

      // Update mass and center of mass
      var totalMass = this.mass + body.mass;
      this.cx = (this.cx * this.mass + body.x * body.mass) / totalMass;
      this.cy = (this.cy * this.mass + body.y * body.mass) / totalMass;
      this.mass = totalMass;
    };

    QuadTree.prototype._subdivide = function() {
      var hw = this.w / 2;
      var hh = this.h / 2;
      this.nw = new QuadTree(this.x - hw, this.y - hh, hw, hh);
      this.ne = new QuadTree(this.x + hw, this.y - hh, hw, hh);
      this.sw = new QuadTree(this.x - hw, this.y + hh, hw, hh);
      this.se = new QuadTree(this.x + hw, this.y + hh, hw, hh);
    };

    QuadTree.prototype._insertIntoChild = function(body) {
      if (body.x <= this.x) {
        if (body.y <= this.y) this.nw.insert(body);
        else this.sw.insert(body);
      } else {
        if (body.y <= this.y) this.ne.insert(body);
        else this.se.insert(body);
      }
    };

    /**
     * Calculate repulsive force on a body using Barnes-Hut approximation.
     * theta: opening angle parameter (0.8 is typical)
     */
    QuadTree.prototype.calculateForce = function(body, repulsion, theta) {
      if (this.isEmpty) return;

      var dx = this.cx - body.x;
      var dy = this.cy - body.y;
      var distSq = dx * dx + dy * dy;
      if (distSq < 1) distSq = 1;

      // If this is a leaf with a single body
      if (this.isLeaf) {
        if (this.body === body) return; // skip self
        var dist = Math.sqrt(distSq);
        var force = repulsion * body.mass * this.mass / distSq;
        body.fx -= (dx / dist) * force;
        body.fy -= (dy / dist) * force;
        return;
      }

      // Barnes-Hut criterion: s/d < theta → treat as single body
      var s = this.w * 2; // cell size
      if (s * s / distSq < theta * theta) {
        var dist = Math.sqrt(distSq);
        var force = repulsion * body.mass * this.mass / distSq;
        body.fx -= (dx / dist) * force;
        body.fy -= (dy / dist) * force;
        return;
      }

      // Otherwise, recurse into children
      if (this.nw) this.nw.calculateForce(body, repulsion, theta);
      if (this.ne) this.ne.calculateForce(body, repulsion, theta);
      if (this.sw) this.sw.calculateForce(body, repulsion, theta);
      if (this.se) this.se.calculateForce(body, repulsion, theta);
    };

    /**
     * Build a QuadTree from all nodes.
     */
    function buildQuadTree(nodes) {
      // Find bounds
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].x < minX) minX = nodes[i].x;
        if (nodes[i].y < minY) minY = nodes[i].y;
        if (nodes[i].x > maxX) maxX = nodes[i].x;
        if (nodes[i].y > maxY) maxY = nodes[i].y;
      }

      var cx = (minX + maxX) / 2;
      var cy = (minY + maxY) / 2;
      var hw = Math.max((maxX - minX) / 2, (maxY - minY) / 2) + 1;

      var qt = new QuadTree(cx, cy, hw, hw);
      for (var i = 0; i < nodes.length; i++) {
        qt.insert(nodes[i]);
      }
      return qt;
    }

    // ================================================================
    // Simulation Loop
    // ================================================================

    function runSimulation() {
      var batchSize = options.batchSize || 10;
      var springLength = options.springLength || 150;
      var springK = options.springConstant || 0.05;
      var repulsion = Math.abs(options.repulsion || 80);
      var gravity = options.gravity || 0.015;
      var damping = options.damping || 0.4;
      var theta = options.theta || 0.8;
      var useBarnesHut = options.useBarnesHut || false;
      var earlyTermThreshold = options.earlyTerminationThreshold || 0.3;
      var avoidOverlap = options.avoidOverlap || 0.8;
      var algorithm = useBarnesHut ? 'barnes-hut' : 'fruchterman-reingold';

      // Track energy for early termination
      var lastEnergies = [];
      var stableCount = 0;

      function tick() {
        var batchEnd = Math.min(iteration + batchSize, maxIterations);
        var totalEnergy = 0;

        while (iteration < batchEnd) {
          var temperature = 1 - iteration / maxIterations; // cooling
          temperature = Math.max(temperature, 0.01);

          // Reset forces
          for (var i = 0; i < nodes.length; i++) {
            nodes[i].fx = 0;
            nodes[i].fy = 0;
          }

          // ── Repulsion ──
          if (useBarnesHut) {
            // Barnes-Hut: O(n log n)
            var qt = buildQuadTree(nodes);
            for (var i = 0; i < nodes.length; i++) {
              qt.calculateForce(nodes[i], repulsion, theta);
            }
          } else {
            // Classic: O(n²) — only for small graphs
            for (var i = 0; i < nodes.length; i++) {
              for (var j = i + 1; j < nodes.length; j++) {
                var dx = nodes[j].x - nodes[i].x;
                var dy = nodes[j].y - nodes[i].y;
                var distSq = dx * dx + dy * dy;
                if (distSq < 1) distSq = 1;
                var dist = Math.sqrt(distSq);
                var force = repulsion / distSq;
                var fx = (dx / dist) * force;
                var fy = (dy / dist) * force;
                nodes[i].fx -= fx;
                nodes[i].fy -= fy;
                nodes[j].fx += fx;
                nodes[j].fy += fy;
              }
            }
          }

          // ── Attraction (edges) ──
          for (var i = 0; i < edges.length; i++) {
            var from = nodeMap[edges[i].from];
            var to = nodeMap[edges[i].to];
            if (!from || !to) continue;
            var dx = to.x - from.x;
            var dy = to.y - from.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1) dist = 1;
            var force = (dist - springLength) * springK;
            var fx = (dx / dist) * force;
            var fy = (dy / dist) * force;
            from.fx += fx;
            from.fy += fy;
            to.fx -= fx;
            to.fy -= fy;
          }

          // ── Gravity (pull toward center) ──
          for (var i = 0; i < nodes.length; i++) {
            nodes[i].fx -= nodes[i].x * gravity;
            nodes[i].fy -= nodes[i].y * gravity;
          }

          // ── Overlap avoidance ──
          // For Barnes-Hut mode, only check within local neighborhood (using spatial hash)
          if (avoidOverlap > 0) {
            if (!useBarnesHut || nodes.length < 2000) {
              // O(n²) check — acceptable for <2000 nodes
              for (var i = 0; i < nodes.length; i++) {
                var ri = (nodes[i].radius || 10);
                for (var j = i + 1; j < nodes.length; j++) {
                  var rj = (nodes[j].radius || 10);
                  var minDist = (ri + rj) * avoidOverlap * 1.5;
                  var odx = nodes[j].x - nodes[i].x;
                  var ody = nodes[j].y - nodes[i].y;
                  var oDist = Math.sqrt(odx * odx + ody * ody);
                  if (oDist < minDist && oDist > 0.1) {
                    var pushForce = (minDist - oDist) * 0.3 * temperature;
                    var opx = (odx / oDist) * pushForce;
                    var opy = (ody / oDist) * pushForce;
                    nodes[i].fx -= opx;
                    nodes[i].fy -= opy;
                    nodes[j].fx += opx;
                    nodes[j].fy += opy;
                  }
                }
              }
            } else {
              // For very large graphs, skip full O(n²) overlap check
              // The repulsion force from Barnes-Hut already separates nodes reasonably
            }
          }

          // ── Apply forces with damping and temperature ──
          totalEnergy = 0;
          for (var i = 0; i < nodes.length; i++) {
            nodes[i].vx = (nodes[i].vx + nodes[i].fx) * damping * temperature;
            nodes[i].vy = (nodes[i].vy + nodes[i].fy) * damping * temperature;

            // Clamp velocity
            var speed = Math.sqrt(nodes[i].vx * nodes[i].vx + nodes[i].vy * nodes[i].vy);
            var maxSpeed = 50 * temperature;
            if (speed > maxSpeed) {
              nodes[i].vx *= maxSpeed / speed;
              nodes[i].vy *= maxSpeed / speed;
            }

            nodes[i].x += nodes[i].vx;
            nodes[i].y += nodes[i].vy;
            totalEnergy += speed;
          }

          iteration++;
        }

        // ── Early termination check ──
        lastEnergies.push(totalEnergy);
        if (lastEnergies.length > 5) lastEnergies.shift();

        // Check if energy has stabilized
        if (lastEnergies.length >= 5) {
          var avgEnergy = 0;
          for (var i = 0; i < lastEnergies.length; i++) avgEnergy += lastEnergies[i];
          avgEnergy /= lastEnergies.length;
          if (avgEnergy < earlyTermThreshold * nodes.length) {
            stableCount++;
          } else {
            stableCount = 0;
          }
        }

        // Send positions back to main thread via Float32Array (zero-copy)
        var posBuf = new Float32Array(nodes.length * 2);
        for (var i = 0; i < nodes.length; i++) {
          posBuf[i * 2] = nodes[i].x;
          posBuf[i * 2 + 1] = nodes[i].y;
        }

        self.postMessage({
          type: 'positions',
          positionBuffer: posBuf,
          iteration: iteration,
          energy: totalEnergy,
          algorithm: algorithm,
        }, [posBuf.buffer]); // Transferable — zero-copy to main thread

        // Check termination conditions
        var earlyDone = stableCount >= 3;
        if (iteration >= maxIterations || earlyDone) {
          self.postMessage({
            type: 'done',
            iteration: iteration,
            algorithm: algorithm,
            reason: earlyDone ? 'converged' : 'maxIterations',
          });
        } else {
          setTimeout(tick, 0); // yield to message queue
        }
      }

      tick();
    }
  \`;
};
`;
}
