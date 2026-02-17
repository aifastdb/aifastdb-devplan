/**
 * RenderPipeline — 视口裁剪 + 脏区域局部渲染
 *
 * 借鉴 LeaferJS Renderer 架构:
 * - 全量渲染 (fullRender): 清空并重绘所有可见内容
 * - 局部渲染 (partRender): 仅重绘脏区域内的节点/边
 * - 视口裁剪: 只遍历 SpatialIndex.search(viewport) 返回的节点
 *
 * 渲染顺序: 背景 → 边 → 节点 → 标签 → 覆盖层 (panel/debug)
 */

export function getRendererScript(): string {
  return `
// ============================================================================
// RenderPipeline — Viewport Culling + Dirty Rect Rendering
// ============================================================================

function RenderPipeline(engine) {
  this._engine = engine;
  this._bgColor = engine._options.backgroundColor || '#111827';

  // Cached visible items (refreshed each frame or on viewport change)
  this._visibleNodes = [];
  this._visibleEdges = [];
  this._lastViewportKey = '';  // For detecting viewport changes
}

/**
 * Main render entry point — called by GraphCanvas._renderFrame().
 * @param {CanvasRenderingContext2D} ctx
 * @param {boolean} fullRedraw — true = clear + redraw everything
 * @param {Array} dirtyRects — [{x,y,w,h}] in world coords (merged)
 */
RenderPipeline.prototype.render = function(ctx, fullRedraw, dirtyRects) {
  var engine = this._engine;

  // Partial render path: only redraw dirty regions
  if (!fullRedraw && dirtyRects && dirtyRects.length > 0) {
    this._partRender(ctx, dirtyRects);
    return;
  }

  // Full render path
  this._fullRender(ctx);
};

/**
 * Full render — clears everything and redraws all visible content.
 */
RenderPipeline.prototype._fullRender = function(ctx) {
  var engine = this._engine;
  var viewport = engine._viewport;
  var lod = engine._lod;

  // ── 1. Clear ──
  viewport.resetTransform(ctx);
  ctx.fillStyle = this._bgColor;
  ctx.fillRect(0, 0, engine._width, engine._height);

  // ── 2. Query visible nodes via spatial index ──
  var queryBounds = this._getExpandedViewportBounds();

  var visibleItems = engine._spatialIndex.search(queryBounds);
  this._visibleNodes = [];
  for (var i = 0; i < visibleItems.length; i++) {
    var item = visibleItems[i];
    if (item._node && item._node._visible) {
      this._visibleNodes.push(item._node);
    }
  }

  // ── 3. Collect visible edges via edge spatial index (O(log E) instead of O(E)) ──
  this._visibleEdges = [];
  var edgeItems = engine._spatialIndex.searchEdges(queryBounds);
  for (var i = 0; i < edgeItems.length; i++) {
    var ei = edgeItems[i];
    if (ei._edge && ei._edge._visible) {
      this._visibleEdges.push(ei._edge);
    }
  }

  // Update metrics
  engine._metrics.visibleNodes = this._visibleNodes.length;
  engine._metrics.visibleEdges = this._visibleEdges.length;

  // ── 4. Determine LOD level ──
  var lodLevel = lod.getLevel(viewport.getScale());

  // ── 5. Apply viewport transform ──
  viewport.applyTransform(ctx);

  // ── 5b. Cluster auto-management ──
  var clusterer = engine._clusterer;
  var clusterActive = clusterer && clusterer.isActive();
  if (clusterer && clusterer._enabled) {
    if (clusterActive && clusterer.needsRebuild()) {
      clusterer.rebuild();
      // Re-query visible nodes after cluster hides some
      visibleItems = engine._spatialIndex.search(queryBounds);
      this._visibleNodes = [];
      for (var i = 0; i < visibleItems.length; i++) {
        var item = visibleItems[i];
        if (item._node && item._node._visible) {
          this._visibleNodes.push(item._node);
        }
      }
    } else if (!clusterActive && clusterer._clusters.length > 0) {
      // Scale went above threshold → auto-expand all clusters
      clusterer._clearAllClusters();
      engine._spatialIndex.buildFromNodes(engine._nodes);
      engine._spatialIndex.buildEdgeIndex(engine._edges, engine._nodeMap);
      visibleItems = engine._spatialIndex.search(queryBounds);
      this._visibleNodes = [];
      for (var i = 0; i < visibleItems.length; i++) {
        var item = visibleItems[i];
        if (item._node && item._node._visible) {
          this._visibleNodes.push(item._node);
        }
      }
    }
  }

  // ── 6. Draw edges (skip during zoom/drag for performance — T11.8) ──
  var skipEdges = engine._isZooming || (engine._interaction && engine._interaction._isDraggingCanvas);
  if (!skipEdges) {
    this._drawEdges(ctx, lodLevel);
  }

  // ── 7. Draw nodes ──
  this._drawNodes(ctx, lodLevel);

  // ── 7b. Draw clusters (if active) ──
  if (clusterActive) {
    this._drawClusters(ctx, lodLevel);
  }

  // ── 8. Draw labels (if LOD permits) ──
  if (lodLevel >= 1) {
    this._drawLabels(ctx, lodLevel);
  }

  // ── 9. UI Overlays (in screen space) ──
  viewport.resetTransform(ctx);
  this._drawOverlays(ctx);

  // ── 10. Emit afterRender event (for afterDrawing compat) ──
  viewport.applyTransform(ctx);
  engine._emit('afterRender', { ctx: ctx });
  viewport.resetTransform(ctx);
};

/**
 * Partial render — only redraws dirty regions (LeaferJS-inspired partRender + clipRender).
 * For each dirty rect: clip → clear → query affected nodes/edges → redraw → restore.
 */
RenderPipeline.prototype._partRender = function(ctx, dirtyRects) {
  var engine = this._engine;
  var viewport = engine._viewport;
  var lod = engine._lod;
  var lodLevel = lod.getLevel(viewport.getScale());
  var scale = viewport.getScale();
  var pr = engine._options.pixelRatio;

  for (var r = 0; r < dirtyRects.length; r++) {
    var rect = dirtyRects[r];

    // Expand dirty rect slightly to avoid edge artifacts
    var spread = 4 / scale;
    var clipRect = {
      x: rect.x - spread,
      y: rect.y - spread,
      w: rect.w + spread * 2,
      h: rect.h + spread * 2,
    };

    // Convert dirty rect to query bounds for spatial index
    var queryBounds = {
      minX: clipRect.x,
      minY: clipRect.y,
      maxX: clipRect.x + clipRect.w,
      maxY: clipRect.y + clipRect.h,
    };

    // Query nodes in dirty region
    var nodeItems = engine._spatialIndex.search(queryBounds);
    var dirtyNodes = [];
    for (var i = 0; i < nodeItems.length; i++) {
      if (nodeItems[i]._node && nodeItems[i]._node._visible) {
        dirtyNodes.push(nodeItems[i]._node);
      }
    }

    // Query edges in dirty region via edge spatial index
    var edgeItems = engine._spatialIndex.searchEdges(queryBounds);
    var dirtyEdges = [];
    for (var i = 0; i < edgeItems.length; i++) {
      if (edgeItems[i]._edge && edgeItems[i]._edge._visible) {
        dirtyEdges.push(edgeItems[i]._edge);
      }
    }

    // Also include edges connected to dirty nodes (may extend beyond dirty rect)
    var dirtyNodeIds = {};
    for (var i = 0; i < dirtyNodes.length; i++) {
      dirtyNodeIds[dirtyNodes[i].id] = true;
    }
    var connectedEdges = engine._edges;
    for (var i = 0; i < connectedEdges.length; i++) {
      var e = connectedEdges[i];
      if (!e._visible) continue;
      if ((dirtyNodeIds[e.from] || dirtyNodeIds[e.to]) && !this._edgeInList(e, dirtyEdges)) {
        dirtyEdges.push(e);
      }
    }

    // ── clipRender: clip to dirty rect, clear, redraw ──
    ctx.save();

    // Apply viewport transform
    viewport.applyTransform(ctx);

    // Clip to dirty rect (world coordinates, transformed by viewport)
    ctx.beginPath();
    ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
    ctx.clip();

    // Clear the dirty region
    ctx.fillStyle = this._bgColor;
    ctx.fillRect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);

    // Draw affected edges
    var savedVisibleEdges = this._visibleEdges;
    this._visibleEdges = dirtyEdges;
    this._drawEdges(ctx, lodLevel);
    this._visibleEdges = savedVisibleEdges;

    // Draw affected nodes
    var savedVisibleNodes = this._visibleNodes;
    this._visibleNodes = dirtyNodes;
    this._drawNodes(ctx, lodLevel);
    if (lodLevel >= 1) {
      this._drawLabels(ctx, lodLevel);
    }
    this._visibleNodes = savedVisibleNodes;

    ctx.restore();
  }

  // Overlays always in screen space (redraw unconditionally — they're lightweight)
  viewport.resetTransform(ctx);
  this._drawOverlays(ctx);

  // Emit afterRender
  viewport.applyTransform(ctx);
  engine._emit('afterRender', { ctx: ctx });
  viewport.resetTransform(ctx);
};

/**
 * Check if an edge is already in the list (by id).
 */
RenderPipeline.prototype._edgeInList = function(edge, list) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === edge.id) return true;
  }
  return false;
};

/**
 * Get viewport bounds expanded with padding for edge overflow.
 */
RenderPipeline.prototype._getExpandedViewportBounds = function() {
  var viewport = this._engine._viewport;
  var worldBounds = viewport.getWorldBounds();
  var pad = 50 / viewport.getScale();
  return {
    minX: worldBounds.minX - pad,
    minY: worldBounds.minY - pad,
    maxX: worldBounds.maxX + pad,
    maxY: worldBounds.maxY + pad,
  };
};

// ── Edge Drawing ──────────────────────────────────────────────────────────

RenderPipeline.prototype._drawEdges = function(ctx, lodLevel) {
  var engine = this._engine;
  var nodeMap = engine._nodeMap;
  var edges = this._visibleEdges;
  var styles = engine._styles;

  ctx.lineCap = 'round';

  for (var i = 0; i < edges.length; i++) {
    var e = edges[i];
    var fromNode = nodeMap[e.from];
    var toNode = nodeMap[e.to];
    if (!fromNode || !toNode) continue;

    var style = e._style || styles.getEdgeStyle(e);
    var alpha = e._highlighted ? 1 : (lodLevel === 0 ? 0.15 : 0.4);

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = e._highlighted ? (style.highlightColor || '#93c5fd') : (style.color || '#4b5563');
    ctx.lineWidth = (style.width || 1) / engine._viewport.getScale();

    // Dash pattern
    if (style.dashes && lodLevel >= 1) {
      var scale = engine._viewport.getScale();
      var dashScale = 1 / scale;
      ctx.setLineDash(style.dashes.map(function(d) { return d * dashScale; }));
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();

    // Compute control point for quadratic Bezier curve (LOD >= 1)
    var cpX = null, cpY = null;
    if (lodLevel === 0) {
      // LOD 0: straight lines only (maximum performance)
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(toNode.x, toNode.y);
    } else {
      // LOD 1-2: smooth quadratic Bezier curve (T11.4)
      var edgeDx = toNode.x - fromNode.x;
      var edgeDy = toNode.y - fromNode.y;
      var edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
      if (edgeLen < 1) {
        ctx.moveTo(fromNode.x, fromNode.y);
        ctx.lineTo(toNode.x, toNode.y);
      } else {
        // Compute control point: perpendicular offset from midpoint
        var roundness = style.roundness || 0.15;
        var midX = (fromNode.x + toNode.x) / 2;
        var midY = (fromNode.y + toNode.y) / 2;
        var perpX = -edgeDy / edgeLen;
        var perpY = edgeDx / edgeLen;
        var offset = roundness * edgeLen * 0.15;
        cpX = midX + perpX * offset;
        cpY = midY + perpY * offset;
        ctx.moveTo(fromNode.x, fromNode.y);
        ctx.quadraticCurveTo(cpX, cpY, toNode.x, toNode.y);
      }
    }

    ctx.stroke();

    // ── Arrow head (LOD >= 1) ──
    if (lodLevel >= 1 && style.arrows) {
      this._drawArrowHead(ctx, fromNode, toNode, style, cpX, cpY);
    }
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
};

RenderPipeline.prototype._drawArrowHead = function(ctx, fromNode, toNode, style, cpX, cpY) {
  var scale = this._engine._viewport.getScale();
  var arrowSize = Math.max(4, 8 / scale);
  var toR = toNode._radius || 10;
  var angle;

  if (cpX != null && cpY != null) {
    // T11.4: Arrow direction along Bezier curve tangent at endpoint
    // For quadratic Bezier B(t) = (1-t)^2*P0 + 2(1-t)t*CP + t^2*P1
    // Tangent at t=1: B'(1) = 2*(P1 - CP)
    var tdx = toNode.x - cpX;
    var tdy = toNode.y - cpY;
    var tlen = Math.sqrt(tdx * tdx + tdy * tdy);
    if (tlen < 0.1) {
      tdx = toNode.x - fromNode.x;
      tdy = toNode.y - fromNode.y;
      tlen = Math.sqrt(tdx * tdx + tdy * tdy);
    }
    if (tlen < 0.1) return;
    angle = Math.atan2(tdy, tdx);
    // Arrow position: step back from toNode by toR along tangent direction
    var ax = toNode.x - (tdx / tlen) * toR;
    var ay = toNode.y - (tdy / tlen) * toR;
  } else {
    // Straight line: use direct vector
    var dx = toNode.x - fromNode.x;
    var dy = toNode.y - fromNode.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    angle = Math.atan2(dy, dx);
    var ratio = (len - toR) / len;
    var ax = fromNode.x + dx * ratio;
    var ay = fromNode.y + dy * ratio;
  }

  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(
    ax - arrowSize * Math.cos(angle - Math.PI / 6),
    ay - arrowSize * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    ax - arrowSize * Math.cos(angle + Math.PI / 6),
    ay - arrowSize * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
};

// ── Node Drawing ──────────────────────────────────────────────────────────

RenderPipeline.prototype._drawNodes = function(ctx, lodLevel) {
  var nodes = this._visibleNodes;
  var styles = this._engine._styles;
  var enableShadow = (lodLevel >= 2);

  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var style = n._style || styles.getNodeStyle(n);
    var r = n._radius || style.radius || 10;
    n._radius = r; // cache for hit-test

    // ── Selection / hover glow (T11.3 enhanced) ──
    if (n._selected || n._hovered) {
      var glowR = r * (n._selected ? 1.15 : 1.08);
      var glowPad = (n._selected ? 8 : 5) / this._engine._viewport.getScale();
      // Outer glow
      ctx.globalAlpha = n._selected ? 0.35 : 0.2;
      ctx.fillStyle = n._selected ? '#6366f1' : '#818cf8';
      ctx.beginPath();
      ctx.arc(n.x, n.y, glowR + glowPad, 0, Math.PI * 2);
      ctx.fill();
      // White border ring
      ctx.globalAlpha = n._selected ? 0.9 : 0.6;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = (n._selected ? 2.5 : 1.5) / this._engine._viewport.getScale();
      ctx.beginPath();
      ctx.arc(n.x, n.y, glowR + 1 / this._engine._viewport.getScale(), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Apply slight scale to the rendered radius for selected nodes
      if (n._selected) r = glowR;
    }

    // ── Shadow (LOD >= 2 only) ──
    if (enableShadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
    }

    // ── Compute box dimensions for 'box' shape (text-adaptive) ──
    var shape = style.shape || 'circle';
    if ((shape === 'box' || shape === 'square') && n.label && lodLevel >= 1) {
      var boxFontSize = (style.fontSize || 12) / this._engine._viewport.getScale();
      ctx.font = Math.max(boxFontSize, 2) + 'px -apple-system, sans-serif';
      if (!n._textWidth || n._textWidthScale !== this._engine._viewport.getScale()) {
        var maxChars = lodLevel >= 2 ? 30 : 15;
        var displayLabel = n.label.length > maxChars ? n.label.substring(0, maxChars) + '\u2026' : n.label;
        n._textWidth = ctx.measureText(displayLabel).width;
        n._textWidthScale = this._engine._viewport.getScale();
      }
      var pad = 8 / this._engine._viewport.getScale();
      n._boxW = Math.max(n._textWidth + pad * 2, r * 2);
      n._boxH = boxFontSize + pad * 2;
    }

    // ── Node shape ──
    ctx.fillStyle = style.bgColor || '#6b7280';
    ctx.strokeStyle = style.borderColor || '#4b5563';
    ctx.lineWidth = (style.borderWidth || 1) / this._engine._viewport.getScale();

    this._drawShape(ctx, n.x, n.y, r, shape, n);

    ctx.fill();
    if (lodLevel >= 1) ctx.stroke();

    // ── Reset shadow ──
    if (enableShadow) {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  }
};

RenderPipeline.prototype._drawShape = function(ctx, x, y, r, shape, node) {
  ctx.beginPath();

  switch (shape) {
    case 'star':
      this._drawStar(ctx, x, y, r, 5);
      break;
    case 'diamond':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case 'box':
    case 'square':
      // Text-adaptive rounded rectangle (T11.2)
      if (node && node._boxW && node._boxH) {
        var bw = node._boxW;
        var bh = node._boxH;
        var br = 4 / this._engine._viewport.getScale(); // border radius
        if (ctx.roundRect) {
          ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, br);
        } else {
          // Fallback for browsers without roundRect
          var rx = x - bw / 2, ry = y - bh / 2;
          ctx.moveTo(rx + br, ry);
          ctx.lineTo(rx + bw - br, ry);
          ctx.quadraticCurveTo(rx + bw, ry, rx + bw, ry + br);
          ctx.lineTo(rx + bw, ry + bh - br);
          ctx.quadraticCurveTo(rx + bw, ry + bh, rx + bw - br, ry + bh);
          ctx.lineTo(rx + br, ry + bh);
          ctx.quadraticCurveTo(rx, ry + bh, rx, ry + bh - br);
          ctx.lineTo(rx, ry + br);
          ctx.quadraticCurveTo(rx, ry, rx + br, ry);
          ctx.closePath();
        }
        // Update node radius for hit-test (use half of the larger dimension)
        node._radius = Math.max(bw, bh) / 2;
      } else {
        // Fallback: fixed-size box (LOD 0 or no label)
        ctx.rect(x - r, y - r * 0.7, r * 2, r * 1.4);
      }
      break;
    case 'triangle':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.866, y + r * 0.5);
      ctx.lineTo(x - r * 0.866, y + r * 0.5);
      ctx.closePath();
      break;
    case 'circle':
    default:
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
  }
};

RenderPipeline.prototype._drawStar = function(ctx, cx, cy, r, points) {
  var innerR = r * 0.4;
  var angle = -Math.PI / 2;
  var step = Math.PI / points;

  ctx.moveTo(
    cx + r * Math.cos(angle),
    cy + r * Math.sin(angle)
  );

  for (var i = 0; i < points; i++) {
    angle += step;
    ctx.lineTo(
      cx + innerR * Math.cos(angle),
      cy + innerR * Math.sin(angle)
    );
    angle += step;
    ctx.lineTo(
      cx + r * Math.cos(angle),
      cy + r * Math.sin(angle)
    );
  }

  ctx.closePath();
};

// ── Label Drawing ─────────────────────────────────────────────────────────

RenderPipeline.prototype._drawLabels = function(ctx, lodLevel) {
  var nodes = this._visibleNodes;
  var scale = this._engine._viewport.getScale();
  var styles = this._engine._styles;

  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (!n.label) continue;

    var style = n._style || styles.getNodeStyle(n);
    var fontSize = (style.fontSize || 12) / scale;

    // LOD 1: only show labels for larger nodes + skip sub-task/document (T11.10)
    if (lodLevel === 1) {
      var screenSize = (n._radius || 10) * scale;
      if (screenSize < 6) continue; // too small on screen
      var nodeType = n.type || '';
      if (nodeType === 'sub-task' || nodeType === 'document') continue;
    }

    // Truncate long labels
    var label = n.label;
    var maxChars = lodLevel >= 2 ? 30 : 15;
    if (label.length > maxChars) label = label.substring(0, maxChars) + '\u2026';

    ctx.font = Math.max(fontSize, 2) + 'px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var shape = style.shape || 'circle';
    if (shape === 'box' || shape === 'square') {
      // Label inside box (text-adaptive box already drawn in _drawNodes)
      ctx.fillStyle = style.fontColor || '#e5e7eb';
      ctx.fillText(label, n.x, n.y);
    } else {
      // Label below node with semi-transparent background (T11.5)
      var r = n._radius || 10;
      var labelY = n.y + r + fontSize * 0.8;
      var tw = ctx.measureText(label).width;
      var bgPadH = 3 / scale;
      var bgPadV = 2 / scale;
      // Draw background rectangle
      ctx.fillStyle = 'rgba(17, 24, 39, 0.75)';
      ctx.fillRect(
        n.x - tw / 2 - bgPadH,
        labelY - fontSize / 2 - bgPadV,
        tw + bgPadH * 2,
        fontSize + bgPadV * 2
      );
      // Draw label text
      ctx.fillStyle = style.fontColor || '#e5e7eb';
      ctx.fillText(label, n.x, labelY);
    }
  }
};

// ── Cluster Drawing ───────────────────────────────────────────────────────

RenderPipeline.prototype._drawClusters = function(ctx, lodLevel) {
  var engine = this._engine;
  var clusterer = engine._clusterer;
  if (!clusterer) return;

  var clusters = clusterer.getClusters();
  var viewport = engine._viewport;
  var scale = viewport.getScale();
  var worldBounds = viewport.getWorldBounds();

  for (var i = 0; i < clusters.length; i++) {
    var c = clusters[i];

    // Viewport culling for clusters
    if (c.x + c.radius < worldBounds.minX || c.x - c.radius > worldBounds.maxX ||
        c.y + c.radius < worldBounds.minY || c.y - c.radius > worldBounds.maxY) {
      continue;
    }

    var r = c.radius;

    // ── Outer glow ──
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = c.bgColor || '#6366f1';
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 1.3, 0, Math.PI * 2);
    ctx.fill();

    // ── Main circle ──
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = c.bgColor || '#6366f1';
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();

    // ── Border ──
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.borderColor || '#4f46e5';
    ctx.lineWidth = 2 / scale;
    ctx.stroke();

    // ── Status pie chart (mini) — only at higher LOD ──
    if (c.statusBreakdown && lodLevel >= 0) {
      this._drawStatusPie(ctx, c);
    }

    // ── Count label ──
    var fontSize = Math.max(r * 0.6, 8 / scale);
    ctx.font = 'bold ' + fontSize + 'px -apple-system, sans-serif';
    ctx.fillStyle = c.fontColor || '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.count.toString(), c.x, c.y);
  }

  // Update cluster count in metrics
  engine._metrics.visibleClusters = clusters.length;
};

/**
 * Draw a mini status pie chart ring around the cluster.
 */
RenderPipeline.prototype._drawStatusPie = function(ctx, cluster) {
  var breakdown = cluster.statusBreakdown;
  if (!breakdown) return;

  var STATUS_COLORS = {
    completed: '#059669',
    in_progress: '#7c3aed',
    pending: '#4b5563',
    cancelled: '#92400e',
  };

  var total = cluster.count;
  var r = cluster.radius;
  var ringR = r * 1.15;
  var ringWidth = Math.max(r * 0.15, 2 / this._engine._viewport.getScale());
  var startAngle = -Math.PI / 2;

  ctx.lineWidth = ringWidth;
  var keys = Object.keys(breakdown);
  for (var i = 0; i < keys.length; i++) {
    var status = keys[i];
    var count = breakdown[status];
    var sweepAngle = (count / total) * Math.PI * 2;

    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = STATUS_COLORS[status] || '#9ca3af';
    ctx.beginPath();
    ctx.arc(cluster.x, cluster.y, ringR, startAngle, startAngle + sweepAngle);
    ctx.stroke();

    startAngle += sweepAngle;
  }

  ctx.globalAlpha = 1;
};

// ── Overlay Drawing (screen space) ────────────────────────────────────────

RenderPipeline.prototype._drawOverlays = function(ctx) {
  var engine = this._engine;
  if (!engine._options.debugMode) return;

  // Debug info panel
  var m = engine._metrics;
  var clusterer = engine._clusterer;
  var clusterInfo = clusterer && clusterer.isActive() ? ' [C:' + (m.visibleClusters || 0) + ']' : '';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(8, 8, 260, 132);
  ctx.fillStyle = '#10b981';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('FPS: ' + m.fps + (engine._sleeping ? ' (sleeping)' : '') + clusterInfo, 14, 14);
  ctx.fillText('Visible: ' + m.visibleNodes + '/' + m.totalNodes + ' nodes', 14, 28);
  ctx.fillText('Edges: ' + m.visibleEdges + '/' + m.totalEdges, 14, 42);
  ctx.fillText('Render: ' + m.lastRenderMs + 'ms', 14, 56);
  ctx.fillText('Scale: ' + engine._viewport.getScale().toFixed(4), 14, 70);
  ctx.fillText('Culled: ' + (m.totalNodes - m.visibleNodes) + ' nodes', 14, 84);
  ctx.fillText('Idle: ' + engine._idleFrames + '/' + engine._idleThreshold, 14, 98);
  if (clusterer && clusterer._enabled) {
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('Clusters: ' + (clusterer._clusters.length) + (clusterer.isActive() ? ' (active)' : ' (off)'), 14, 112);
  }
  if (m.layoutAlgorithm) {
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('Layout: ' + m.layoutAlgorithm, 14, 126);
  }

  // ── Layout progress bar (shown during stabilization) ──
  this._drawLayoutProgress(ctx);
};
/**
 * Draw layout progress bar at top of canvas (screen space).
 */
RenderPipeline.prototype._drawLayoutProgress = function(ctx) {
  var engine = this._engine;
  var layout = engine._layoutEngine;
  if (!layout || !layout._isRunning) return;

  var m = engine._metrics;
  var progress = m.layoutProgress || 0;
  var algo = m.layoutAlgorithm || '';
  var eta = m.layoutEta || 0;

  var barWidth = engine._width * 0.6;
  var barHeight = 18;
  var barX = (engine._width - barWidth) / 2;
  var barY = engine._height - 40;

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(barX - 8, barY - 6, barWidth + 16, barHeight + 28);

  // Progress bar background
  ctx.fillStyle = '#374151';
  ctx.fillRect(barX, barY, barWidth, barHeight);

  // Progress bar fill
  var fillWidth = barWidth * (progress / 100);
  ctx.fillStyle = progress < 80 ? '#6366f1' : '#10b981';
  ctx.fillRect(barX, barY, fillWidth, barHeight);

  // Progress text
  ctx.fillStyle = '#fff';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    'Layout: ' + algo + '  ' + progress + '%' +
      (eta > 1000 ? '  ETA: ' + Math.round(eta / 1000) + 's' : ''),
    barX + barWidth / 2,
    barY + barHeight / 2
  );
};
`;
}
