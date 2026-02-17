/**
 * LODManager — 多级细节渲染
 *
 * 3 级 LOD:
 * - Level 0 (全景, zoom < thresholds[0]): 彩色圆点，无标签，直线边
 * - Level 1 (标准, thresholds[0] ~ thresholds[1]): 形状 + 标签 + 虚线边
 * - Level 2 (特写, > thresholds[1]): 阴影 + 详情 + 曲线边
 */

export function getLODScript(): string {
  return `
// ============================================================================
// LODManager — Level of Detail
// ============================================================================

function LODManager(engine) {
  this._engine = engine;

  // LOD thresholds (scale values)
  this._thresholds = [0.15, 0.5];
  // [0, 0.15) → level 0 (minimal)
  // [0.15, 0.5) → level 1 (standard)
  // [0.5, ∞) → level 2 (detailed)
}

/**
 * Get the LOD level for the current zoom scale.
 * @param {number} scale - Current viewport scale
 * @returns {number} 0, 1, or 2
 */
LODManager.prototype.getLevel = function(scale) {
  if (scale < this._thresholds[0]) return 0;
  if (scale < this._thresholds[1]) return 1;
  return 2;
};

/**
 * Get opacity factor for smooth LOD transitions.
 * Returns a value between 0 and 1 for smooth crossfade.
 * @param {number} scale
 * @param {number} fromLevel
 * @returns {number} opacity 0~1
 */
LODManager.prototype.getTransitionAlpha = function(scale, fromLevel) {
  var t0 = this._thresholds[0];
  var t1 = this._thresholds[1];
  var blend = 0.3; // 30% of threshold range for smooth transition

  if (fromLevel === 0) {
    // Transitioning from level 0 → 1
    var low = t0 * (1 - blend);
    var high = t0 * (1 + blend);
    if (scale <= low) return 0;
    if (scale >= high) return 1;
    return (scale - low) / (high - low);
  }
  if (fromLevel === 1) {
    // Transitioning from level 1 → 2
    var low = t1 * (1 - blend);
    var high = t1 * (1 + blend);
    if (scale <= low) return 0;
    if (scale >= high) return 1;
    return (scale - low) / (high - low);
  }
  return 1;
};

/**
 * Set custom LOD thresholds.
 * @param {Array<number>} thresholds - [level0_max, level1_max]
 */
LODManager.prototype.setThresholds = function(thresholds) {
  if (thresholds && thresholds.length >= 2) {
    this._thresholds = thresholds.slice(0, 2);
  }
};

/**
 * Should labels be rendered at this scale?
 */
LODManager.prototype.shouldRenderLabels = function(scale) {
  return scale >= this._thresholds[0];
};

/**
 * Should arrows be rendered at this scale?
 */
LODManager.prototype.shouldRenderArrows = function(scale) {
  return scale >= this._thresholds[0] * 0.8;
};

/**
 * Should shadows be rendered at this scale?
 */
LODManager.prototype.shouldRenderShadows = function(scale) {
  return scale >= this._thresholds[1];
};

/**
 * Get the maximum label characters for the current LOD level.
 */
LODManager.prototype.getMaxLabelChars = function(lodLevel) {
  if (lodLevel === 0) return 0;
  if (lodLevel === 1) return 15;
  return 40;
};
`;
}
