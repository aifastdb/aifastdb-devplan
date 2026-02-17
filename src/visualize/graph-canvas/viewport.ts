/**
 * ViewportManager — 平移/缩放/手势 + 世界↔屏幕坐标变换
 *
 * 管理 2D 视口变换矩阵:
 * screenX = worldX * scale + offsetX
 * screenY = worldY * scale + offsetY
 *
 * 支持:
 * - 鼠标拖拽平移
 * - 滚轮缩放 (以鼠标位置为中心)
 * - 触摸双指缩放
 * - fit() 自适应视口
 * - zoomTo() 定位到特定坐标
 * - 惯性平移 (inertia)
 */

export function getViewportScript(): string {
  return `
// ============================================================================
// ViewportManager
// ============================================================================

/**
 * ViewportManager — 管理世界到屏幕的坐标变换
 * @param {GraphCanvas} engine - 父引擎实例
 */
function ViewportManager(engine) {
  this._engine = engine;

  // Transform state
  this._offsetX = 0;    // 屏幕平移 X (pixels)
  this._offsetY = 0;    // 屏幕平移 Y (pixels)
  this._scale = 1;      // 缩放比例 (1 = 100%)

  // Constraints
  this._minScale = 0.001;   // 支持百万级节点需要极小缩放
  this._maxScale = 20;
  this._zoomSpeed = 0.001;  // 滚轮灵敏度

  // Drag state
  this._isDragging = false;
  this._dragStartX = 0;
  this._dragStartY = 0;
  this._dragOffsetStartX = 0;
  this._dragOffsetStartY = 0;

  // Inertia
  this._velocityX = 0;
  this._velocityY = 0;
  this._lastDragTime = 0;
  this._inertiaRafId = null;

  // Touch zoom state
  this._touchStartDist = 0;
  this._touchStartScale = 1;
  this._touchStartMidX = 0;
  this._touchStartMidY = 0;

  // Animation
  this._animationRafId = null;

  // Bind event handlers
  this._bindEvents();
}

// ── Coordinate Transforms ─────────────────────────────────────────────────

/**
 * Convert world coordinates to screen coordinates.
 */
ViewportManager.prototype.worldToScreen = function(wx, wy) {
  return {
    x: wx * this._scale + this._offsetX,
    y: wy * this._scale + this._offsetY,
  };
};

/**
 * Convert screen coordinates to world coordinates.
 */
ViewportManager.prototype.screenToWorld = function(sx, sy) {
  return {
    x: (sx - this._offsetX) / this._scale,
    y: (sy - this._offsetY) / this._scale,
  };
};

/**
 * Get current world-space bounds visible in the viewport.
 */
ViewportManager.prototype.getWorldBounds = function() {
  var w = this._engine._width;
  var h = this._engine._height;
  var tl = this.screenToWorld(0, 0);
  var br = this.screenToWorld(w, h);
  return {
    minX: Math.min(tl.x, br.x),
    minY: Math.min(tl.y, br.y),
    maxX: Math.max(tl.x, br.x),
    maxY: Math.max(tl.y, br.y),
    width: Math.abs(br.x - tl.x),
    height: Math.abs(br.y - tl.y),
  };
};

// ── Apply Transform to Canvas Context ─────────────────────────────────────

/**
 * Apply the current viewport transform to a Canvas2D context.
 */
ViewportManager.prototype.applyTransform = function(ctx) {
  ctx.setTransform(
    this._scale * this._engine._options.pixelRatio,
    0, 0,
    this._scale * this._engine._options.pixelRatio,
    this._offsetX * this._engine._options.pixelRatio,
    this._offsetY * this._engine._options.pixelRatio
  );
};

/**
 * Reset transform to screen space (for UI overlays).
 */
ViewportManager.prototype.resetTransform = function(ctx) {
  var pr = this._engine._options.pixelRatio;
  ctx.setTransform(pr, 0, 0, pr, 0, 0);
};

// ── Viewport Operations ───────────────────────────────────────────────────

/**
 * Pan the viewport by screen-space delta.
 */
ViewportManager.prototype.pan = function(dx, dy) {
  this._offsetX += dx;
  this._offsetY += dy;
  this._engine.markDirty();
  this._engine._emit('viewportChanged', this._getState());
};

/**
 * Zoom centered on a screen-space point.
 * @param {number} factor - Zoom multiplier (>1 = zoom in, <1 = zoom out)
 * @param {number} centerX - Screen X to zoom around
 * @param {number} centerY - Screen Y to zoom around
 */
ViewportManager.prototype.zoom = function(factor, centerX, centerY) {
  var newScale = this._scale * factor;
  newScale = Math.max(this._minScale, Math.min(newScale, this._maxScale));

  // Zoom around center point:
  // The world point under the center should stay in the same screen position
  var worldBefore = this.screenToWorld(centerX, centerY);
  this._scale = newScale;
  var screenAfter = this.worldToScreen(worldBefore.x, worldBefore.y);
  this._offsetX += centerX - screenAfter.x;
  this._offsetY += centerY - screenAfter.y;

  this._engine.markDirty();
  this._engine._emit('viewportChanged', this._getState());
};

/**
 * Set absolute zoom level.
 */
ViewportManager.prototype.setScale = function(scale) {
  var cx = this._engine._width / 2;
  var cy = this._engine._height / 2;
  this.zoom(scale / this._scale, cx, cy);
};

/**
 * Fit viewport to show all given nodes.
 * @param {Array} nodes - Array of {x, y, _radius} objects
 * @param {Object} [options] - { padding, animation }
 */
ViewportManager.prototype.fitToNodes = function(nodes, options) {
  if (!nodes || nodes.length === 0) return;

  var opts = options || {};
  var padding = opts.padding || 60;

  // Compute bounding box of all nodes
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var r = n._radius || 10;
    if (n.x - r < minX) minX = n.x - r;
    if (n.y - r < minY) minY = n.y - r;
    if (n.x + r > maxX) maxX = n.x + r;
    if (n.y + r > maxY) maxY = n.y + r;
  }

  var bw = maxX - minX;
  var bh = maxY - minY;
  if (bw < 1) bw = 1;
  if (bh < 1) bh = 1;

  var w = this._engine._width - padding * 2;
  var h = this._engine._height - padding * 2;
  if (w < 1) w = 1;
  if (h < 1) h = 1;

  var scale = Math.min(w / bw, h / bh);
  scale = Math.max(this._minScale, Math.min(scale, this._maxScale));

  var centerX = (minX + maxX) / 2;
  var centerY = (minY + maxY) / 2;

  var targetOffsetX = this._engine._width / 2 - centerX * scale;
  var targetOffsetY = this._engine._height / 2 - centerY * scale;

  if (opts.animation !== false && opts.animation) {
    this._animateTo(scale, targetOffsetX, targetOffsetY, opts.animation);
  } else {
    this._scale = scale;
    this._offsetX = targetOffsetX;
    this._offsetY = targetOffsetY;
    this._engine.markDirty();
    this._engine._emit('viewportChanged', this._getState());
  }
};

/**
 * Center the view on a world coordinate.
 */
ViewportManager.prototype.centerOn = function(worldX, worldY, options) {
  var targetOffsetX = this._engine._width / 2 - worldX * this._scale;
  var targetOffsetY = this._engine._height / 2 - worldY * this._scale;

  var opts = options || {};
  if (opts.animation) {
    this._animateTo(opts.scale || this._scale, targetOffsetX, targetOffsetY, opts.animation);
  } else {
    this._offsetX = targetOffsetX;
    this._offsetY = targetOffsetY;
    if (opts.scale) this._scale = opts.scale;
    this._engine.markDirty();
    this._engine._emit('viewportChanged', this._getState());
  }
};

// ── Animation ─────────────────────────────────────────────────────────────

ViewportManager.prototype._animateTo = function(targetScale, targetOffsetX, targetOffsetY, animOptions) {
  if (this._animationRafId) cancelAnimationFrame(this._animationRafId);

  var duration = (typeof animOptions === 'object' && animOptions.duration) || 800;
  var startScale = this._scale;
  var startOffsetX = this._offsetX;
  var startOffsetY = this._offsetY;
  var startTime = performance.now();
  var self = this;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(now) {
    var t = Math.min((now - startTime) / duration, 1);
    var e = easeInOutCubic(t);

    self._scale = startScale + (targetScale - startScale) * e;
    self._offsetX = startOffsetX + (targetOffsetX - startOffsetX) * e;
    self._offsetY = startOffsetY + (targetOffsetY - startOffsetY) * e;
    self._engine.markDirty();

    if (t < 1) {
      self._animationRafId = requestAnimationFrame(step);
    } else {
      self._animationRafId = null;
      self._engine._emit('viewportChanged', self._getState());
    }
  }

  this._animationRafId = requestAnimationFrame(step);
};

// ── Inertia (drag momentum) ──────────────────────────────────────────────

ViewportManager.prototype._startInertia = function() {
  if (Math.abs(this._velocityX) < 0.5 && Math.abs(this._velocityY) < 0.5) return;
  if (this._inertiaRafId) cancelAnimationFrame(this._inertiaRafId);

  var self = this;
  var friction = 0.95;

  function step() {
    self._velocityX *= friction;
    self._velocityY *= friction;
    if (Math.abs(self._velocityX) < 0.1 && Math.abs(self._velocityY) < 0.1) {
      self._inertiaRafId = null;
      return;
    }
    self.pan(self._velocityX, self._velocityY);
    self._inertiaRafId = requestAnimationFrame(step);
  }

  this._inertiaRafId = requestAnimationFrame(step);
};

// ── Event Binding ─────────────────────────────────────────────────────────

ViewportManager.prototype._bindEvents = function() {
  var self = this;
  var canvas = this._engine._canvas;

  // ── Mouse Wheel → Zoom ──
  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    var delta = -e.deltaY;
    var factor = 1 + delta * self._zoomSpeed;
    factor = Math.max(0.5, Math.min(factor, 2)); // clamp per-event
    self.zoom(factor, x, y);
  }, { passive: false });

  // ── Mouse drag → Pan (delegated to InteractionManager for node drag priority) ──
  // Pan events are handled by InteractionManager which calls viewport.pan()
  // when dragging on empty space.

  // ── Touch events → Pan/Zoom ──
  canvas.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      var t0 = e.touches[0], t1 = e.touches[1];
      self._touchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      self._touchStartScale = self._scale;
      var rect = canvas.getBoundingClientRect();
      self._touchStartMidX = ((t0.clientX + t1.clientX) / 2) - rect.left;
      self._touchStartMidY = ((t0.clientY + t1.clientY) / 2) - rect.top;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      var t0 = e.touches[0], t1 = e.touches[1];
      var dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      if (self._touchStartDist > 0) {
        var factor = dist / self._touchStartDist;
        var newScale = self._touchStartScale * factor;
        newScale = Math.max(self._minScale, Math.min(newScale, self._maxScale));
        var zoomFactor = newScale / self._scale;
        self.zoom(zoomFactor, self._touchStartMidX, self._touchStartMidY);
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchend', function(e) {
    self._touchStartDist = 0;
  });
};

// ── State ─────────────────────────────────────────────────────────────────

ViewportManager.prototype._getState = function() {
  return {
    scale: this._scale,
    offsetX: this._offsetX,
    offsetY: this._offsetY,
    worldBounds: this.getWorldBounds(),
  };
};

ViewportManager.prototype.getScale = function() {
  return this._scale;
};
`;
}
