/**
 * DevPlan 图可视化 — 3D Force Graph 渲染模块
 *
 * 包含: Three.js WebGL 3D 图渲染、力导向布局、节点交互。
 */

export function getGraph3DScript(): string {
  return `
// ========== 3D Force Graph Rendering (统一颜色配置) ==========
// 从统一节点颜色配置加载 (适用于所有引擎)
var _3dUniStyle = getUnifiedNodeStyle();
var _3dNodeColors = getNodeColors();
function load3DColorsFromSettings() {
  var nc = getNodeColors();
  return {
    'project':   nc.colorProject,
    'module':    nc.colorModule,
    'main-task': nc.colorMainTask,
    'sub-task':  nc.colorSubTask,
    'document':  nc.colorDocument,
    'memory':    nc.colorMemory
  };
}
function load3DSizesFromSettings() {
  var s = get3DSettings();
  return {
    'project':   s.sizeProject,
    'module':    s.sizeModule,
    'main-task': s.sizeMainTask,
    'sub-task':  s.sizeSubTask,
    'document':  s.sizeDocument,
    'memory':    s.sizeMemory || 8,
    'file':      7,
    'folder':    9,
    'symbol':    5,
    'community': 11,
    'process':   10
  };
}
var NODE_3D_COLORS = load3DColorsFromSettings();
var NODE_3D_SIZES = load3DSizesFromSettings();
// 主任务状态颜色 (从统一配置)
var MAIN_TASK_STATUS_COLORS = {
  'pending':     _3dUniStyle.mainTask.pending.bg,
  'completed':   _3dUniStyle.mainTask.completed.bg,
  'in_progress': _3dUniStyle.mainTask.in_progress.bg,
  'cancelled':   _3dUniStyle.mainTask.cancelled.bg
};
// 子任务状态颜色 (从统一配置, completed=亮绿色)
var SUB_TASK_STATUS_COLORS = {
  'pending':     _3dUniStyle.subTask.pending.bg,
  'completed':   _3dUniStyle.subTask.completed.bg,
  'in_progress': _3dUniStyle.subTask.in_progress.bg,
  'cancelled':   _3dUniStyle.subTask.cancelled.bg
};

// ========== 3D 呼吸灯动画 (in_progress 主任务) ==========
var _3dBreathPhase = 0;
var _3dBreathAnimId = null;
var _3dBreathItems = []; // { sprite, ring1, ring2: THREE.Sprite, baseScale, ring1Base, ring2Base }

/** 启动 3D 呼吸灯动画循环 */
function start3DBreathAnimation() {
  if (_3dBreathAnimId) return;
  function tick() {
    _3dBreathPhase += 0.025;
    if (_3dBreathPhase > Math.PI * 2) _3dBreathPhase -= Math.PI * 2;
    var breath = (Math.sin(_3dBreathPhase) + 1) / 2; // [0, 1]

    for (var i = 0; i < _3dBreathItems.length; i++) {
      var item = _3dBreathItems[i];
      // 脉冲光晕 Sprite: 缩放 + 透明度振荡
      if (item.sprite && item.sprite.material) {
        var s = item.baseScale * (0.8 + breath * 1.5);
        item.sprite.scale.set(s, s, 1);
        item.sprite.material.opacity = 0.10 + breath * 0.30;
      }
      // 外圈脉冲环 Sprite: 扩展 + 淡出 (始终面向相机)
      if (item.ring1 && item.ring1.material) {
        var r1 = (item.ring1Base || 35) * (0.85 + breath * 0.8);
        item.ring1.scale.set(r1, r1, 1);
        item.ring1.material.opacity = 0.55 * (1 - breath * 0.55);
      }
      // 内圈脉冲环 Sprite: 反向节奏 (呼吸感更强)
      if (item.ring2 && item.ring2.material) {
        var invBreath = 1 - breath;
        var r2 = (item.ring2Base || 22) * (0.9 + invBreath * 0.6);
        item.ring2.scale.set(r2, r2, 1);
        item.ring2.material.opacity = 0.40 * (1 - invBreath * 0.45);
      }
    }

    _3dBreathAnimId = requestAnimationFrame(tick);
  }
  _3dBreathAnimId = requestAnimationFrame(tick);
}

/** 停止 3D 呼吸灯动画循环 */
function stop3DBreathAnimation() {
  if (_3dBreathAnimId) {
    cancelAnimationFrame(_3dBreathAnimId);
    _3dBreathAnimId = null;
  }
}

function get3DNodeColor(node) {
  var t = node._type || 'sub-task';
  var status = (node._props || {}).status || 'pending';
  // 主任务: 深绿色系
  if (t === 'main-task') {
    return MAIN_TASK_STATUS_COLORS[status] || MAIN_TASK_STATUS_COLORS.pending;
  }
  // 子任务: pending=暖肤色, completed=亮绿色
  if (t === 'sub-task') {
    return SUB_TASK_STATUS_COLORS[status] || SUB_TASK_STATUS_COLORS.pending;
  }
  if (t === 'file') return '#3b82f6';
  if (t === 'folder') return '#64748b';
  if (t === 'symbol') return '#22c55e';
  if (t === 'community') return '#f59e0b';
  if (t === 'process') return '#a855f7';
  return NODE_3D_COLORS[t] || '#6b7280';
}

function get3DLinkColor(link) {
  var _s = get3DSettings();
  var _eff = _s.visualEffect;
  if (_eff === 'influencer') _eff = 'blur'; // 兼容旧值
  // Blur Effect: 对齐 AI_Influencers_X 的默认灰白细线
  if (_eff === 'blur') return 'rgba(255,255,255,0.07)';
  var label = link._label || '';
  var bridgeKind = String(((link._props || {}).bridgeKind) || '');
  if (label === 'BRIDGE_LINK') return 'rgba(251,146,60,0.82)';
  if (label === 'BRIDGE_RECOMMEND') {
    if (bridgeKind === 'recommended-process') return 'rgba(56,189,248,0.68)';
    return 'rgba(250,204,21,0.55)';
  }
  if (label === 'has_main_task') return 'rgba(147,197,253,0.18)';
  if (label === 'has_sub_task')  return 'rgba(129,140,248,0.12)';
  if (label === 'has_document')  return 'rgba(96,165,250,0.10)';
  if (label === 'has_module')    return 'rgba(255,102,0,0.18)';
  if (label === 'module_has_task') return 'rgba(255,102,0,0.15)';
  if (label === 'doc_has_child') return 'rgba(192,132,252,0.12)';
  return 'rgba(75,85,99,0.10)';
}

/** 创建发光纹理 (radial gradient → 用于 Sprite 的光晕效果) */
function createGlowTexture(color, size) {
  var canvas = document.createElement('canvas');
  canvas.width = size || 64;
  canvas.height = size || 64;
  var ctx = canvas.getContext('2d');
  var cx = canvas.width / 2, cy = canvas.height / 2, r = canvas.width / 2;
  var gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gradient.addColorStop(0, color || 'rgba(255,255,255,0.8)');
  gradient.addColorStop(0.15, color ? colorWithAlpha(color, 0.5) : 'rgba(255,255,255,0.5)');
  gradient.addColorStop(0.4, color ? colorWithAlpha(color, 0.15) : 'rgba(255,255,255,0.15)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** 从 hex/rgb 颜色生成带 alpha 的 rgba 字符串 */
function colorWithAlpha(hex, alpha) {
  if (hex.startsWith('rgba')) return hex; // 已经是 rgba
  // hex → rgb
  var r = 0, g = 0, b = 0;
  if (hex.startsWith('#')) {
    if (hex.length === 4) {
      r = parseInt(hex[1]+hex[1], 16); g = parseInt(hex[2]+hex[2], 16); b = parseInt(hex[3]+hex[3], 16);
    } else {
      r = parseInt(hex.slice(1,3), 16); g = parseInt(hex.slice(3,5), 16); b = parseInt(hex.slice(5,7), 16);
    }
  }
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/** 创建环形纹理 (用于呼吸灯脉冲环 Sprite, 始终面向相机) */
function createRingTexture(color, size) {
  var canvas = document.createElement('canvas');
  canvas.width = size || 128;
  canvas.height = size || 128;
  var ctx = canvas.getContext('2d');
  var cx = canvas.width / 2, cy = canvas.height / 2;
  var r = cx * 0.75;
  // 外圈辉光
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = color ? colorWithAlpha(color, 0.15) : 'rgba(139,92,246,0.15)';
  ctx.lineWidth = cx * 0.35;
  ctx.stroke();
  // 主环
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = color || '#8b5cf6';
  ctx.lineWidth = cx * 0.1;
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  return canvas;
}

// 缓存 glow 纹理 (避免每个节点重复创建)
var _glowTextureCache = {};
// 缓存标签纹理 (label + color)
var _labelTextureCache = {};

function trimLabelText(text, maxLen) {
  if (!text) return '';
  var s = String(text);
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(1, maxLen - 1)) + '…';
}

function createLabelTexture(text, color) {
  var key = String(text) + '|' + String(color || '#e5e7eb');
  if (_labelTextureCache[key]) return _labelTextureCache[key];
  var canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 40px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 10;
  ctx.strokeText(text, 256, 64);
  ctx.fillStyle = color || '#e5e7eb';
  ctx.fillText(text, 256, 64);
  var tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  _labelTextureCache[key] = tex;
  return tex;
}

// Phase-75: 边类型 → 高亮色映射 (提升为全局，供增量注入使用)
var LINK_3D_HIGHLIGHT_COLORS = {
  'has_main_task':   '#93c5fd',
  'has_sub_task':    '#818cf8',
  'has_document':    '#60a5fa',
  'has_module':      '#ff8533',
  'module_has_task': '#ff8533',
  'task_has_doc':    '#f59e0b',
  'doc_has_child':   '#c084fc'
};

/**
 * 3D Force Graph 渲染器
 * 使用 Three.js WebGL + d3-force-3d 实现 3D 球体力导向可视化
 */
function render3DGraph(container, visibleNodes, visibleEdges) {
  log('正在创建 3D Force Graph (Three.js WebGL)...', true);

  // 清空容器
  container.innerHTML = '';

  // ── 从自定义设置加载参数 ──
  var _s3d = get3DSettings();
  var _effectPreset = (_s3d.visualEffect === 'blur' || _s3d.visualEffect === 'influencer') ? 'blur' : 'classic';
  // 重新加载颜色和大小（确保使用最新设置）
  NODE_3D_COLORS = load3DColorsFromSettings();
  NODE_3D_SIZES = load3DSizesFromSettings();

  // ── 高亮状态追踪 ──
  var _3dSelectedNodeId = null;       // 当前选中节点 ID
  var _3dHighlightLinks = new Set();  // 选中节点的关联边 Set
  var _3dHighlightNodes = new Set();  // 选中节点 + 邻居节点 Set

  // 使用全局 LINK_3D_HIGHLIGHT_COLORS (Phase-75: 提升为全局供增量注入使用)

  // 转换数据格式: vis-network edges → 3d-force-graph links
  var links3d = [];
  for (var i = 0; i < visibleEdges.length; i++) {
    var e = visibleEdges[i];
    links3d.push({
      source: e.from,
      target: e.to,
      _label: e._label,
      _props: e._props || {},
      _width: e.width || 1,
      _color: get3DLinkColor(e),
      _highlightColor: (e._label === 'BRIDGE_RECOMMEND' && e._props && e._props.bridgeKind === 'recommended-process')
        ? '#38bdf8'
        : (LINK_3D_HIGHLIGHT_COLORS[e._label] || '#a5b4fc'),
      _projectEdgeHidden: !!e._projectEdgeHidden  // 主节点连线: 参与力模拟但不渲染
    });
  }

  // 复制节点数据（3d-force-graph 会修改节点对象，添加 x/y/z/vx/vy/vz）
  var nodes3d = [];
  for (var i = 0; i < visibleNodes.length; i++) {
    var n = visibleNodes[i];
    nodes3d.push({
      id: n.id,
      label: n._origLabel || n.label,
      _type: n._type,
      _props: n._props || {},
      _val: NODE_3D_SIZES[n._type] || 5,
      _color: get3DNodeColor(n),
      _clusterId: n._clusterId,
      _clusterCx: n._clusterCx,
      _clusterCy: n._clusterCy,
      _clusterCz: n._clusterCz,
      x: n.x,
      y: n.y,
      z: n.z
    });
  }

  // 构建邻接表（用于快速查找节点的关联边和邻居节点）
  var _3dNodeNeighbors = {};  // nodeId → Set of neighbor nodeIds
  var _3dNodeLinks = {};      // nodeId → Set of link references
  for (var i = 0; i < links3d.length; i++) {
    var l = links3d[i];
    var srcId = typeof l.source === 'object' ? l.source.id : l.source;
    var tgtId = typeof l.target === 'object' ? l.target.id : l.target;
    if (!_3dNodeNeighbors[srcId]) _3dNodeNeighbors[srcId] = new Set();
    if (!_3dNodeNeighbors[tgtId]) _3dNodeNeighbors[tgtId] = new Set();
    _3dNodeNeighbors[srcId].add(tgtId);
    _3dNodeNeighbors[tgtId].add(srcId);
    if (!_3dNodeLinks[srcId]) _3dNodeLinks[srcId] = new Set();
    if (!_3dNodeLinks[tgtId]) _3dNodeLinks[tgtId] = new Set();
    _3dNodeLinks[srcId].add(l);
    _3dNodeLinks[tgtId].add(l);
  }

  // ── 单击/双击判定状态 ──
  var _3dClickTimer = null;
  var _3dClickCount = 0;
  var _3dPendingClickNode = null;

  /** 双击聚焦: 计算节点及其所有关联节点的包围球, 将摄像机拉到刚好能完整显示的位置 */
  function focus3DNodeWithNeighbors(node) {
    // 收集目标节点 + 所有邻居节点的坐标
    var points = [{ x: node.x || 0, y: node.y || 0, z: node.z || 0 }];
    var neighbors = _3dNodeNeighbors[node.id];
    if (neighbors) {
      neighbors.forEach(function(nId) {
        for (var i = 0; i < nodes3d.length; i++) {
          if (nodes3d[i].id === nId) {
            points.push({ x: nodes3d[i].x || 0, y: nodes3d[i].y || 0, z: nodes3d[i].z || 0 });
            break;
          }
        }
      });
    }

    // 计算质心
    var cx = 0, cy = 0, cz = 0;
    for (var i = 0; i < points.length; i++) {
      cx += points[i].x; cy += points[i].y; cz += points[i].z;
    }
    cx /= points.length; cy /= points.length; cz /= points.length;

    // 计算包围球半径 (到质心的最大距离)
    var maxR = 0;
    for (var i = 0; i < points.length; i++) {
      var dx = points[i].x - cx, dy = points[i].y - cy, dz = points[i].z - cz;
      var r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r > maxR) maxR = r;
    }

    // 摄像机距离: 包围球半径 × 系数, 确保所有节点都在视锥内
    // 系数 2.8 ~ 3.2 可保证 FOV ≈ 70° 时完整可见, 加 padding 余量
    var camDist = Math.max(maxR * 3.0, 80);

    // 摄像机位于质心的斜上方偏移, 提供良好的 3D 视角
    try {
      graph3d.cameraPosition(
        { x: cx + camDist * 0.58, y: cy + camDist * 0.42, z: cz + camDist * 0.68 },
        { x: cx, y: cy, z: cz },
        1200
      );
    } catch(e) {}
  }

  /** 更新高亮集合 */
  function update3DHighlight(nodeId) {
    _3dHighlightLinks.clear();
    _3dHighlightNodes.clear();
    _3dSelectedNodeId = nodeId;

    if (nodeId) {
      _3dHighlightNodes.add(nodeId);
      // 添加所有邻居节点
      var neighbors = _3dNodeNeighbors[nodeId];
      if (neighbors) neighbors.forEach(function(nId) { _3dHighlightNodes.add(nId); });
      // 添加所有关联边
      var links = _3dNodeLinks[nodeId];
      if (links) links.forEach(function(link) { _3dHighlightLinks.add(link); });
    }
  }

  var rect = container.getBoundingClientRect();

  // 创建 3D 图实例
  var graph3d = ForceGraph3D({ controlType: 'orbit' })(container)
    .width(rect.width)
    .height(rect.height)
    .backgroundColor(_s3d.bgColor)
    .showNavInfo(false)
    // ── 节点样式 ──
    .nodeLabel(function(n) {
      var status = (n._props || {}).status || '';
      var statusBadge = '';
      if (status === 'completed') statusBadge = '<span style="color:#22c55e;font-size:10px;">✓ 已完成</span>';
      else if (status === 'in_progress') statusBadge = '<span style="color:#f59e0b;font-size:10px;">● 进行中</span>';
      return '<div style="background:rgba(15,23,42,0.92);color:#e2e8f0;padding:6px 10px;border-radius:6px;font-size:12px;border:1px solid rgba(99,102,241,0.3);backdrop-filter:blur(4px);max-width:280px;">'
        + '<div style="font-weight:600;margin-bottom:2px;">' + (n.label || n.id) + '</div>'
        + (statusBadge ? '<div>' + statusBadge + '</div>' : '')
        + '<div style="color:#94a3b8;font-size:10px;">' + (n._type || '') + '</div>'
        + '</div>';
    })
    .nodeColor(function(n) {
      // 所有节点始终保持原色（不变暗），仅通过连线变化体现选中关系
      return n._color;
    })
    .nodeVal(function(n) { return n._val; })
    .nodeOpacity(_s3d.nodeOpacity)
    .nodeResolution(16)
    // ── 自定义节点: 几何体 + 发光光晕 Sprite (mitbunny 风格) ──
    .nodeThreeObject(function(n) {
      if (typeof THREE === 'undefined') return false;

      var t = n._type || 'sub-task';
      var color = n._color;
      // 节点始终保持原色（不变暗），仅通过连线变化体现选中关系
      var isHighlighted = _3dSelectedNodeId && _3dHighlightNodes.has(n.id);

      // ── 创建容器 Group ──
      var group = new THREE.Group();

      // ── 节点几何体 + 视觉预设 ──
      var coreMesh;
      if (_effectPreset === 'blur') {
        // Influencer 预设: 多层球体发光（参考 AI_Influencers_X）
        var nodeSize = { 'project': 10, 'module': 8, 'main-task': 6, 'sub-task': 4.4, 'document': 4.8, 'memory': 4.6 }[t] || 4.2;
        var layerCount = 12;
        for (var li = layerCount - 1; li >= 0; li--) {
          var lt = li / layerCount;
          var lscale = 1.0 + (lt * 1.0);
          var lopacity = 0.05 + (Math.pow(1 - lt, 3) * 0.32);
          var layerGeo = new THREE.SphereGeometry(nodeSize * lscale, 18, 16);
          var layerMat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: lopacity,
            depthWrite: false
          });
          group.add(new THREE.Mesh(layerGeo, layerMat));
        }
        var blurCoreGeo = new THREE.SphereGeometry(nodeSize * 0.82, 16, 14);
        var blurCoreMat = new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: Math.min(1, _s3d.nodeOpacity + 0.06)
        });
        coreMesh = new THREE.Mesh(blurCoreGeo, blurCoreMat);
        group.add(coreMesh);
      } else {
        // Classic 预设: 现有 DevPlan 视觉
        if (t === 'module') {
          var size = 10;
          var geo = new THREE.BoxGeometry(size, size, size);
          var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity, emissive: color, emissiveIntensity: 0.3 });
          coreMesh = new THREE.Mesh(geo, mat);
        } else if (t === 'project') {
          var geo = new THREE.OctahedronGeometry(14);
          var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity, emissive: color, emissiveIntensity: 0.4 });
          coreMesh = new THREE.Mesh(geo, mat);
        } else if (t === 'document') {
          var geo = new THREE.BoxGeometry(7, 8.5, 2);
          var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity * 0.92, emissive: color, emissiveIntensity: 0.25 });
          coreMesh = new THREE.Mesh(geo, mat);
        } else {
          // 主任务 / 子任务 → 球体
          var radius = t === 'main-task' ? 5.5 : 3.5;
          var geo = new THREE.SphereGeometry(radius, 16, 12);
          var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity, emissive: color, emissiveIntensity: 0.3 });
          coreMesh = new THREE.Mesh(geo, mat);
        }
        group.add(coreMesh);

        // ── 发光光晕 Sprite (Glow Aura) ──
        var glowSize = { 'project': 60, 'module': 40, 'main-task': 26, 'sub-task': 18, 'document': 22 }[t] || 16;
        var cacheKey = color + '_' + glowSize;
        if (!_glowTextureCache[cacheKey]) {
          var canvas = createGlowTexture(color, 128);
          _glowTextureCache[cacheKey] = new THREE.CanvasTexture(canvas);
        }
        var glowTex = _glowTextureCache[cacheKey];
        var spriteMat = new THREE.SpriteMaterial({
          map: glowTex,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        var sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(glowSize, glowSize, 1);
        group.add(sprite);
      }

      // ── showLabels: 真实 3D 标签渲染 (Sprite Billboard) ──
      if (_s3d.showLabels) {
        var maxLabelLen = _effectPreset === 'blur' ? 26 : 20;
        var labelText = trimLabelText(n.label || n.id, maxLabelLen);
        if (labelText) {
          var isHugeGraph = nodes3d.length > 1500;
          var isLowPriorityType = (t === 'sub-task' || t === 'document' || t === 'memory');
          if (!(isHugeGraph && isLowPriorityType && !isHighlighted)) {
            var labelTex = createLabelTexture(labelText, '#e5e7eb');
            var labelMat = new THREE.SpriteMaterial({
              map: labelTex,
              transparent: true,
              opacity: isHighlighted ? 1 : 0.84,
              depthWrite: false
            });
            var labelSprite = new THREE.Sprite(labelMat);
            var labelScale = _effectPreset === 'blur' ? 28 : 22;
            labelSprite.scale.set(labelScale, labelScale * 0.28, 1);
            var yOffset = { 'project': 18, 'module': 14, 'main-task': 10, 'sub-task': 8, 'document': 9, 'memory': 9 }[t] || 8;
            labelSprite.position.set(0, -yOffset, 0);
            group.add(labelSprite);
          }
        }
      }

      // ── in_progress 主任务: 呼吸脉冲光效 (参考 vis-network 发光效果) ──
      var nodeStatus = (n._props || {}).status || 'pending';
      if (t === 'main-task' && nodeStatus === 'in_progress') {
        // 增强核心球体自发光强度
        if (coreMesh && coreMesh.material) {
          coreMesh.material.emissiveIntensity = 0.6;
        }

        // 1) 外层脉冲光晕 Sprite (大范围弥散辉光, 类似 vis-network outerGlow)
        var pulseGlowSize = 55;
        var pulseColor = '#7c3aed';
        var pulseCacheKey = pulseColor + '_pulse';
        if (!_glowTextureCache[pulseCacheKey]) {
          _glowTextureCache[pulseCacheKey] = new THREE.CanvasTexture(createGlowTexture(pulseColor, 128));
        }
        var pulseSpriteMat = new THREE.SpriteMaterial({
          map: _glowTextureCache[pulseCacheKey],
          transparent: true,
          opacity: 0.25,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        var pulseSprite = new THREE.Sprite(pulseSpriteMat);
        pulseSprite.scale.set(pulseGlowSize, pulseGlowSize, 1);
        group.add(pulseSprite);

        // 2) 外圈脉冲环 Sprite (billboard, 始终面向相机)
        var outerRingSize = 35;
        var outerRingCacheKey = '#8b5cf6_ring';
        if (!_glowTextureCache[outerRingCacheKey]) {
          _glowTextureCache[outerRingCacheKey] = new THREE.CanvasTexture(createRingTexture('#8b5cf6', 128));
        }
        var outerRingMat = new THREE.SpriteMaterial({
          map: _glowTextureCache[outerRingCacheKey],
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        var outerRingSprite = new THREE.Sprite(outerRingMat);
        outerRingSprite.scale.set(outerRingSize, outerRingSize, 1);
        group.add(outerRingSprite);

        // 3) 内圈脉冲环 Sprite (更紧凑)
        var innerRingSize = 22;
        var innerRingCacheKey = '#a78bfa_ring';
        if (!_glowTextureCache[innerRingCacheKey]) {
          _glowTextureCache[innerRingCacheKey] = new THREE.CanvasTexture(createRingTexture('#a78bfa', 128));
        }
        var innerRingMat = new THREE.SpriteMaterial({
          map: _glowTextureCache[innerRingCacheKey],
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        var innerRingSprite = new THREE.Sprite(innerRingMat);
        innerRingSprite.scale.set(innerRingSize, innerRingSize, 1);
        group.add(innerRingSprite);

        // 记录到呼吸灯列表
        _3dBreathItems.push({
          sprite: pulseSprite,
          ring1: outerRingSprite,
          ring2: innerRingSprite,
          baseScale: pulseGlowSize,
          ring1Base: outerRingSize,
          ring2Base: innerRingSize
        });
      }

      return group;
    })
    .nodeThreeObjectExtend(false)
    // ── 边可见性: 主节点连线隐藏但保留力模拟 ──
    .linkVisibility(function(l) {
      return !l._projectEdgeHidden; // 隐藏的主节点连线不渲染，但仍参与力导向计算
    })
    // ── 边样式 (支持高亮) ──
    .linkColor(function(l) {
      if (_3dSelectedNodeId) {
        if (_3dHighlightLinks.has(l)) return l._highlightColor; // 关联边高亮
        return 'rgba(30,30,50,0.08)'; // 非关联边几乎隐藏
      }
      return l._color || 'rgba(75,85,99,0.2)';
    })
    .linkWidth(function(l) {
      if (_3dSelectedNodeId && _3dHighlightLinks.has(l)) {
        return 1.5; // 高亮边加粗
      }
      // 极细的蛛网风格 (mitbunny style)
      var label = l._label || '';
      if (label === 'has_main_task') return 0.2;
      if (label === 'has_module') return 0.2;
      if (label === 'module_has_task') return 0.15;
      return 0.1;
    })
    .linkOpacity(function(l) {
      if (_3dSelectedNodeId) {
        return _3dHighlightLinks.has(l) ? 0.9 : 0.03;
      }
      return Math.min(_s3d.linkOpacity, 0.35); // 更透明的蛛网效果
    })
    .linkDirectionalArrowLength(_s3d.arrows ? 1.5 : 0)
    .linkDirectionalArrowRelPos(1)
    .linkDirectionalParticles(function(l) {
      if (!_s3d.particles) return 0;
      // 选中时: 高亮边显示流动粒子
      if (_3dSelectedNodeId && _3dHighlightLinks.has(l)) return 2;
      // 默认: 仅项目级连接少量粒子
      var label = l._label || '';
      if (label === 'has_main_task' || label === 'has_module') return 1;
      return 0;
    })
    .linkDirectionalParticleWidth(function(l) {
      if (_3dSelectedNodeId && _3dHighlightLinks.has(l)) return 1.2;
      return 0.5;
    })
    .linkDirectionalParticleColor(function(l) {
      if (_3dSelectedNodeId && _3dHighlightLinks.has(l)) return l._highlightColor;
      return null; // 默认颜色
    })
    .linkDirectionalParticleSpeed(0.005)
    // ── 力导向参数 (来自自定义设置) ──
    .d3AlphaDecay(_s3d.alphaDecay)
    .d3VelocityDecay(_s3d.velocityDecay)
    // ── 交互事件: 单击/双击区分 ──
    .onNodeClick(function(node, event) {
      if (!node) return;
      _3dPendingClickNode = node;
      _3dClickCount++;
      if (_3dClickCount === 1) {
        // 第一次点击: 等待判定是否双击
        _3dClickTimer = setTimeout(function() {
          _3dClickCount = 0;
          // 单击: 高亮 + 面板
          update3DHighlight(node.id);
          refresh3DStyles();
          panelHistory = [];
          currentPanelNodeId = null;
          showPanel(node.id);
        }, 280);
      } else if (_3dClickCount >= 2) {
        // 双击: 取消单击定时器
        clearTimeout(_3dClickTimer);
        _3dClickCount = 0;
        // 高亮 + 面板 + 聚焦到节点及其关联节点
        update3DHighlight(node.id);
        refresh3DStyles();
        panelHistory = [];
        currentPanelNodeId = null;
        showPanel(node.id);
        focus3DNodeWithNeighbors(node);
      }
    })
    .onNodeDragEnd(function(node) {
      // 拖拽结束后固定节点位置
      node.fx = node.x;
      node.fy = node.y;
      node.fz = node.z;
    })
    .onBackgroundClick(function() {
      // 点击背景: 取消选中 + 关闭面板
      update3DHighlight(null);
      refresh3DStyles();
      closePanel();
    });

  /** 刷新连线视觉样式（节点不变，仅刷新边的颜色/宽度/粒子） */
  function refresh3DStyles() {
    graph3d.linkColor(graph3d.linkColor())
           .linkWidth(graph3d.linkWidth())
           .linkOpacity(graph3d.linkOpacity())
           .linkDirectionalParticles(graph3d.linkDirectionalParticles())
           .linkDirectionalParticleWidth(graph3d.linkDirectionalParticleWidth())
           .linkDirectionalParticleColor(graph3d.linkDirectionalParticleColor());
  }

  function mount3DFloatingControls(effectPreset) {
    var old = container.querySelector('.s3d-float-controls');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (effectPreset !== 'blur') return;

    var wrap = document.createElement('div');
    wrap.className = 's3d-float-controls';
    wrap.style.position = 'absolute';
    wrap.style.bottom = '20px';
    wrap.style.left = '50%';
    wrap.style.transform = 'translateX(-50%)';
    wrap.style.zIndex = '36';
    wrap.style.display = 'flex';
    wrap.style.background = 'rgba(0,0,0,0.4)';
    wrap.style.backdropFilter = 'blur(8px)';
    wrap.style.border = '1px solid rgba(255,255,255,0.12)';
    wrap.style.borderRadius = '10px';
    wrap.style.overflow = 'hidden';
    wrap.style.boxShadow = '0 6px 24px rgba(0,0,0,0.35)';

    function mkBtn(text, title, onClick, withRightBorder) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = text;
      btn.title = title;
      btn.style.padding = '8px 14px';
      btn.style.background = 'transparent';
      btn.style.color = '#fff';
      btn.style.border = 'none';
      if (withRightBorder) btn.style.borderRight = '1px solid rgba(255,255,255,0.12)';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '14px';
      btn.onmouseenter = function() { btn.style.background = 'rgba(255,255,255,0.1)'; };
      btn.onmouseleave = function() { btn.style.background = 'transparent'; };
      btn.onclick = onClick;
      return btn;
    }

    var zoomOutBtn = mkBtn('−', '缩小', function() {
      try {
        var cam = graph3d.camera();
        if (!cam) return;
        var dist = cam.position.length();
        var nd = dist * 1.35;
        var dir = cam.position.clone().normalize();
        cam.position.copy(dir.multiplyScalar(nd));
      } catch(e) {}
    }, true);

    var resetBtn = mkBtn('⟲', '重置视角', function() {
      try { graph3d.zoomToFit(700); } catch(e) {}
      update3DHighlight(null);
      refresh3DStyles();
      closePanel();
    }, true);

    var zoomInBtn = mkBtn('+', '放大', function() {
      try {
        var cam = graph3d.camera();
        if (!cam) return;
        var dist = cam.position.length();
        var nd = dist * 0.72;
        var dir = cam.position.clone().normalize();
        cam.position.copy(dir.multiplyScalar(nd));
      } catch(e) {}
    }, false);

    wrap.appendChild(zoomOutBtn);
    wrap.appendChild(resetBtn);
    wrap.appendChild(zoomInBtn);
    container.appendChild(wrap);
  }

  // ── 增强场景光照 (mitbunny 风格: 柔和环境光 + 点光源) ──
  try {
    var scene = graph3d.scene();
    if (scene && typeof THREE !== 'undefined') {
      // 移除默认光源，用更柔和的光照
      var toRemove = [];
      scene.children.forEach(function(child) {
        if (child.isLight) toRemove.push(child);
      });
      toRemove.forEach(function(l) { scene.remove(l); });

      // 柔和环境光（整体照亮）
      var ambientLight = new THREE.AmbientLight(0x334466, 1.5);
      scene.add(ambientLight);

      // 暖色点光源（从上方照射，类似太阳光）
      var pointLight1 = new THREE.PointLight(0xffffff, 0.8, 0);
      pointLight1.position.set(200, 300, 200);
      scene.add(pointLight1);

      // 冷色辅助光（从下方，增加立体感）
      var pointLight2 = new THREE.PointLight(0x6366f1, 0.4, 0);
      pointLight2.position.set(-200, -200, -100);
      scene.add(pointLight2);
    }
  } catch(e) { console.warn('Scene lighting setup error:', e); }

  // ========== 布局模式分支 ==========
  var _isOrbital = (_s3d.layoutMode === 'orbital');

  if (_isOrbital) {
    // ╔══════════════════════════════════════════════════════╗
    // ║  🪐 行星轨道布局 (Solar System Orbital Layout)      ║
    // ║  节点按类型排列在固定间距的同心轨道上                ║
    // ╚══════════════════════════════════════════════════════╝
    var _orbitSpacing = _s3d.orbitSpacing;     // 轨道间距
    var _orbitStrength = _s3d.orbitStrength;   // 轨道引力
    var _orbitFlatten = _s3d.orbitFlatten;     // Z 轴压平力度

    // 节点类型 → 轨道编号 (类似: 太阳→水星→金星→地球→火星)
    var ORBIT_MAP = {
      'project':   0,   // ☀ 太阳 — 中心
      'module':    1,   // ☿ 水星 — 第 1 轨道
      'main-task': 2,   // ♀ 金星 — 第 2 轨道
      'sub-task':  3,   // ♂ 火星 — 第 3 轨道
      'document':  4    // ♃ 木星 — 第 4 轨道
    };
    var _maxOrbit = 4;

    // 为每个节点计算目标轨道半径
    for (var i = 0; i < nodes3d.length; i++) {
      var orbitIdx = ORBIT_MAP[nodes3d[i]._type] || 3;
      nodes3d[i]._orbitRadius = orbitIdx * _orbitSpacing;
      nodes3d[i]._orbitIndex = orbitIdx;
    }

    // ── 减弱排斥力 (轨道模式下不需要强排斥) ──
    graph3d.d3Force('charge').strength(function(n) {
      var t = n._type || 'sub-task';
      if (t === 'project') return -5;   // 几乎不排斥
      if (t === 'module') return -15;
      return -8;
    });

    // ── 连接距离使用轨道间距 ──
    graph3d.d3Force('link').distance(function(l) {
      return _orbitSpacing * 0.8;
    }).strength(function(l) {
      if (l && l._projectEdgeHidden) return 0.002;
      if (l && l._linkStrengthFactor !== undefined) return 0.3 * l._linkStrengthFactor;
      return 0.3;
    }); // 较弱的连接力，让轨道力主导

    // ── 关闭默认中心引力 (由轨道力取代) ──
    try {
      var fg = graph3d.d3Force;
      if (fg('x')) fg('x').strength(0);
      if (fg('y')) fg('y').strength(0);
      if (fg('z')) fg('z').strength(0);
    } catch(e) {}

    // ── 自定义行星轨道力 ──
    // 将节点拉向其目标轨道半径，同时压平 Z 轴形成太阳系圆盘
    var orbitalForce = (function() {
      var _nodes;
      function force(alpha) {
        for (var i = 0; i < _nodes.length; i++) {
          var n = _nodes[i];
          var targetR = n._orbitRadius || 0;
          var dx = n.x || 0;
          var dy = n.y || 0;
          var dz = n.z || 0;

          if (targetR === 0) {
            // 项目节点 (太阳): 强力拉向原点
            n.vx = (n.vx || 0) - dx * 0.1 * alpha;
            n.vy = (n.vy || 0) - dy * 0.1 * alpha;
            n.vz = (n.vz || 0) - dz * 0.1 * alpha;
            continue;
          }

          // XY 平面径向距离
          var xyDist = Math.sqrt(dx * dx + dy * dy);
          if (xyDist > 0.001) {
            // 径向力: 将节点拉向目标轨道半径
            var radialK = (targetR - xyDist) / xyDist * _orbitStrength * alpha;
            n.vx = (n.vx || 0) + dx * radialK;
            n.vy = (n.vy || 0) + dy * radialK;
          } else {
            // 节点几乎在原点: 给一个随机方向的推力
            var angle = Math.random() * Math.PI * 2;
            n.vx = (n.vx || 0) + Math.cos(angle) * _orbitStrength * alpha * targetR * 0.1;
            n.vy = (n.vy || 0) + Math.sin(angle) * _orbitStrength * alpha * targetR * 0.1;
          }

          // Z 轴压平力: 越大越扁 (0=球壳, 1=完全平面)
          n.vz = (n.vz || 0) - dz * _orbitFlatten * _orbitStrength * alpha * 2;
        }
      }
      force.initialize = function(nodes) { _nodes = nodes; };
      return force;
    })();

    graph3d.d3Force('orbital', orbitalForce);

    log('🪐 行星轨道布局: 间距=' + _orbitSpacing + ', 强度=' + _orbitStrength + ', 压平=' + _orbitFlatten, true);

  } else {
    // ╔══════════════════════════════════════════════════════╗
    // ║  ⚡ 力导向布局 (默认 Force-directed)                ║
    // ╚══════════════════════════════════════════════════════╝
    var _repulsion = _s3d.repulsion; // 基准排斥力 (负数)
    graph3d.d3Force('charge').strength(function(n) {
      // 大节点排斥力按比例放大
      var t = n._type || 'sub-task';
      if (t === 'project') return _repulsion * 5;      // 项目: 5x
      if (t === 'module') return _repulsion * 2;        // 模块: 2x
      if (t === 'main-task') return _repulsion * 1;     // 主任务: 1x (基准)
      return _repulsion * 0.35;                         // 子任务/文档: 0.35x
    });
    var _linkDist = _s3d.linkDistance; // 基准连接距离
    graph3d.d3Force('link').distance(function(l) {
      var label = l._label || '';
      var factor = (l && l._linkDistanceFactor !== undefined) ? l._linkDistanceFactor : 1;
      if (label === 'has_main_task') return _linkDist * 1.25;
      if (label === 'has_module') return _linkDist * 1.12;
      if (label === 'has_sub_task') return _linkDist * 0.625;
      if (label === 'module_has_task') return _linkDist * 1.0;
      if (label === 'has_document') return _linkDist * 0.875;
      return _linkDist * 0.75 * factor;
    }).strength(function(l) {
      var label = l._label || '';
      if (l && l._projectEdgeHidden) return 0.002;
      var factor = (l && l._linkStrengthFactor !== undefined) ? l._linkStrengthFactor : 1;
      if (label === 'has_main_task' || label === 'has_module' || label === 'module_has_task') return 0.7;
      return 0.5 * factor;
    });

    // ── 中心引力 (来自自定义设置) ──
    try {
      var fg = graph3d.d3Force;
      if (fg('x')) fg('x').strength(_s3d.gravity);
      if (fg('y')) fg('y').strength(_s3d.gravity);
      if (fg('z')) fg('z').strength(_s3d.gravity);
    } catch(e) { /* 可能不支持，忽略 */ }

    // ── 🌍 类型分层力 (Type Separation) ──
    // 不同类型节点按固定间距分布在不同轨道层上，类似天体间距
    // project(中心) → module(层1) → document(层2) → main-task(层3) → sub-task(层4)
    if (_s3d.typeSeparation && _s3d.typeSepStrength > 0) {
      var _typeSepSpacing = _s3d.typeSepSpacing;
      var _typeSepK = _s3d.typeSepStrength;  // 0~1 控制力强度

      // 节点类型 → 轨道层编号
      var TYPE_BAND = {
        'project':   0,   // ☀ 中心
        'module':    1,   // 层 1 — 功能模块 (最近)
        'document':  2,   // 层 2 — 文档
        'main-task': 3,   // 层 3 — 主任务
        'sub-task':  4    // 层 4 — 子任务 (最远)
      };

      // 为每个节点计算目标轨道半径
      for (var i = 0; i < nodes3d.length; i++) {
        var band = TYPE_BAND[nodes3d[i]._type];
        if (band === undefined) band = 4;
        nodes3d[i]._targetBand = band;
        nodes3d[i]._targetRadius = band * _typeSepSpacing;
      }

      // 开启分层时: 保留较强排斥力让同层节点互相散开（尤其子任务数量多）
      // 分层力控制径向距离，排斥力控制同层内散布
      graph3d.d3Force('charge').strength(function(n) {
        var t = n._type || 'sub-task';
        if (t === 'project') return _repulsion * 3;      // 项目: 3x
        if (t === 'module') return _repulsion * 1.5;      // 模块: 1.5x
        if (t === 'main-task') return _repulsion * 1;     // 主任务: 1x
        if (t === 'sub-task') return _repulsion * 0.8;    // 子任务: 0.8x (数量多，需要足够散开)
        return _repulsion * 0.6;                          // 文档: 0.6x
      });

      // 削弱连接力，避免连线把不同层的节点拽到一起
      graph3d.d3Force('link').strength(function(l) {
        var label = l._label || '';
        if (l && l._projectEdgeHidden) return 0.002;
        var factor = (l && l._linkStrengthFactor !== undefined) ? l._linkStrengthFactor : 1;
        if (label === 'has_main_task' || label === 'has_module' || label === 'module_has_task') return 0.15;
        return 0.1 * factor;
      });

      // 自定义 D3 力: 强径向弹簧，将节点拉向目标轨道半径
      var typeSepForce = (function() {
        var _nodes;
        function force(alpha) {
          // 找到项目节点（太阳/中心）
          var cx = 0, cy = 0, cz = 0, projectFound = false;
          for (var i = 0; i < _nodes.length; i++) {
            if (_nodes[i]._type === 'project') {
              cx = _nodes[i].x || 0;
              cy = _nodes[i].y || 0;
              cz = _nodes[i].z || 0;
              projectFound = true;
              break;
            }
          }
          if (!projectFound) {
            // 无项目节点: 使用质心
            for (var i = 0; i < _nodes.length; i++) {
              cx += (_nodes[i].x || 0);
              cy += (_nodes[i].y || 0);
              cz += (_nodes[i].z || 0);
            }
            cx /= _nodes.length; cy /= _nodes.length; cz /= _nodes.length;
          }

          for (var i = 0; i < _nodes.length; i++) {
            var n = _nodes[i];
            var targetR = n._targetRadius || 0;

            if (targetR === 0) {
              // 项目节点: 强力锚定在原点
              n.vx = (n.vx || 0) - (n.x || 0) * 0.1 * alpha;
              n.vy = (n.vy || 0) - (n.y || 0) * 0.1 * alpha;
              n.vz = (n.vz || 0) - (n.z || 0) * 0.1 * alpha;
              continue;
            }

            var dx = (n.x || 0) - cx;
            var dy = (n.y || 0) - cy;
            var dz = (n.z || 0) - cz;
            var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < 0.5) {
              // 节点太靠近中心: 随机方向推出去
              var angle = Math.random() * Math.PI * 2;
              var phi = (Math.random() - 0.5) * Math.PI * 0.3;
              n.vx = (n.vx || 0) + Math.cos(angle) * Math.cos(phi) * targetR * _typeSepK * alpha * 0.5;
              n.vy = (n.vy || 0) + Math.sin(angle) * Math.cos(phi) * targetR * _typeSepK * alpha * 0.5;
              n.vz = (n.vz || 0) + Math.sin(phi) * targetR * _typeSepK * alpha * 0.2;
              continue;
            }

            // 径向弹簧力: F = k * (targetR - dist) / dist * direction
            // 这是一个真正的弹簧——偏差越大推力越大，没有上限截断
            var diff = targetR - dist;
            var k = _typeSepK * alpha;
            var radialAccel = diff * k;

            var invDist = 1 / dist;
            n.vx = (n.vx || 0) + dx * invDist * radialAccel;
            n.vy = (n.vy || 0) + dy * invDist * radialAccel;
            n.vz = (n.vz || 0) + dz * invDist * radialAccel;
          }
        }
        force.initialize = function(nodes) { _nodes = nodes; };
        return force;
      })();

      graph3d.d3Force('typeSeparation', typeSepForce);
      log('🌍 类型分层: 模块@' + _typeSepSpacing + ' 文档@' + (_typeSepSpacing*2) + ' 主任务@' + (_typeSepSpacing*3) + ' 子任务@' + (_typeSepSpacing*4) + ' 强度=' + _typeSepK, true);
    }
  }

  if (nodes3d.some(function(n) { return !!n._clusterId; })) {
    var codeIntelClusterForce = (function() {
      var _nodes;
      function force(alpha) {
        for (var i = 0; i < _nodes.length; i++) {
          var n = _nodes[i];
          if (!n._clusterId || n._type === 'project') continue;
          var tx = n._clusterCx || 0;
          var ty = n._clusterCy || 0;
          var tz = n._clusterCz || 0;
          var dx = tx - (n.x || 0);
          var dy = ty - (n.y || 0);
          var dz = tz - (n.z || 0);
          var strength = 0.045;
          if (n._type === 'community') strength = 0.16;
          else if (n._type === 'process') strength = 0.08;
          else if (n._type === 'file' || n._type === 'folder') strength = 0.06;
          n.vx = (n.vx || 0) + dx * strength * alpha;
          n.vy = (n.vy || 0) + dy * strength * alpha;
          n.vz = (n.vz || 0) + dz * strength * alpha;
        }
      }
      force.initialize = function(nodes) { _nodes = nodes; };
      return force;
    })();

    graph3d.d3Force('codeIntelCluster', codeIntelClusterForce);
    log('🫧 代码图多球簇布局已启用: 按 community 聚类', true);
  }

  // 注入数据
  _3dBreathItems = []; // 重置呼吸灯列表 (nodeThreeObject 回调会填充)
  graph3d.graphData({ nodes: nodes3d, links: links3d });

  // ── 3D 呼吸灯: nodeThreeObject 回调在下一帧才执行, 需延迟检测 ──
  stop3DBreathAnimation();
  function _checkAndStartBreath() {
    if (_3dBreathItems.length > 0 && !_3dBreathAnimId) {
      start3DBreathAnimation();
      log('3D 呼吸灯: 检测到 ' + _3dBreathItems.length + ' 个进行中主任务', true);
    }
  }
  // 多次检测: 300ms (首帧渲染后) + 1500ms (大数据集延迟)
  setTimeout(_checkAndStartBreath, 300);
  setTimeout(_checkAndStartBreath, 1500);

  // ── 🪐 行星轨道: 绘制轨道环线 (Three.js) ──
  if (_isOrbital && _s3d.showOrbits) {
    try {
      var scene = graph3d.scene();
      if (scene && typeof THREE !== 'undefined') {
        var orbitColors = [
          null,          // orbit 0 (project = center, no ring)
          '#ff6600',     // orbit 1 (module) — 橙色
          '#2563eb',     // orbit 2 (document) — 蓝色
          '#047857',     // orbit 3 (main-task) — 深绿
          '#e8956a'      // orbit 4 (sub-task) — 暖肤色
        ];
        var orbitLabels = ['', '模块', '文档', '主任务', '子任务'];
        for (var oi = 1; oi <= _maxOrbit; oi++) {
          var radius = oi * _s3d.orbitSpacing;
          // 使用 THREE.RingGeometry 创建环形 (内径 略小于 外径)
          var ringGeo = new THREE.RingGeometry(radius - 0.3, radius + 0.3, 128);
          var ringColor = orbitColors[oi] || '#334466';
          var ringMat = new THREE.MeshBasicMaterial({
            color: ringColor,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          var ringMesh = new THREE.Mesh(ringGeo, ringMat);
          // 将环放到 XY 平面 (z=0)，不需要旋转因为 RingGeometry 默认在 XY 平面
          ringMesh.renderOrder = -1; // 渲染在节点之后
          scene.add(ringMesh);

          // 添加虚线发光效果 (第二层更宽的半透明环)
          var glowGeo = new THREE.RingGeometry(radius - 1.5, radius + 1.5, 128);
          var glowMat = new THREE.MeshBasicMaterial({
            color: ringColor,
            transparent: true,
            opacity: 0.04,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          var glowMesh = new THREE.Mesh(glowGeo, glowMat);
          glowMesh.renderOrder = -2;
          scene.add(glowMesh);
        }
        log('轨道环线: ' + _maxOrbit + ' 条轨道已绘制', true);
      }
    } catch(e) {
      console.warn('Orbit rings error:', e);
    }
  }

  // ── 离群节点修正: 力导向稳定后检查并拉回远离的节点 ──
  setTimeout(function() {
    try {
      var data = graph3d.graphData();
      var ns = data.nodes;
      if (!ns || ns.length === 0) return;

      // 计算所有节点位置的质心和标准差
      var cx = 0, cy = 0, cz = 0;
      for (var i = 0; i < ns.length; i++) {
        cx += (ns[i].x || 0); cy += (ns[i].y || 0); cz += (ns[i].z || 0);
      }
      cx /= ns.length; cy /= ns.length; cz /= ns.length;

      // 计算平均距离
      var avgDist = 0;
      for (var i = 0; i < ns.length; i++) {
        var dx = (ns[i].x || 0) - cx, dy = (ns[i].y || 0) - cy, dz = (ns[i].z || 0) - cz;
        avgDist += Math.sqrt(dx*dx + dy*dy + dz*dz);
      }
      avgDist /= ns.length;

      // 离群阈值: 超过平均距离 3 倍的节点
      var threshold = Math.max(avgDist * 3, 200);
      var outlierFixed = 0;

      for (var i = 0; i < ns.length; i++) {
        var n = ns[i];
        var dx = (n.x || 0) - cx, dy = (n.y || 0) - cy, dz = (n.z || 0) - cz;
        var dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist > threshold) {
          // 将离群节点拉到质心附近（阈值距离处）
          var scale = threshold / dist;
          n.x = cx + dx * scale * 0.5;
          n.y = cy + dy * scale * 0.5;
          n.z = cz + dz * scale * 0.5;
          n.fx = n.x; n.fy = n.y; n.fz = n.z; // 固定位置
          outlierFixed++;
          log('离群节点修正: ' + (n.label || n.id) + ' (距离 ' + Math.round(dist) + ' → ' + Math.round(threshold * 0.5) + ')', true);
        }
      }

      if (outlierFixed > 0) {
        log('已修正 ' + outlierFixed + ' 个离群节点', true);
        // 短暂释放固定，让力导向微调
        setTimeout(function() {
          var ns2 = graph3d.graphData().nodes;
          for (var i = 0; i < ns2.length; i++) {
            if (ns2[i].fx !== undefined) {
              ns2[i].fx = undefined;
              ns2[i].fy = undefined;
              ns2[i].fz = undefined;
            }
          }
          // 轻微 reheat 让节点自然融入
          graph3d.d3ReheatSimulation();
        }, 2000);
      }
    } catch(e) {
      console.warn('Outlier correction error:', e);
    }
  }, 5000); // 5 秒后执行（等力导向基本稳定）

  // Blur Effect 预设: 底部浮动控件
  mount3DFloatingControls(_effectPreset);

  // 创建兼容性 network wrapper（供其他代码使用 network.fit/destroy 等）
  network = {
    _graph3d: graph3d,
    _container: container,
    destroy: function() {
      // 停止 3D 呼吸灯动画
      stop3DBreathAnimation();
      _3dBreathItems = [];
      try {
        if (graph3d && graph3d._destructor) graph3d._destructor();
        else if (graph3d && graph3d.scene) {
          // 手动清理 Three.js 资源
          var scene = graph3d.scene();
          if (scene && scene.children) {
            while (scene.children.length > 0) scene.remove(scene.children[0]);
          }
          var renderer = graph3d.renderer();
          if (renderer) renderer.dispose();
        }
      } catch(e) { console.warn('3D cleanup error:', e); }
      container.innerHTML = '';
    },
    fit: function(opts) {
      try {
        graph3d.zoomToFit(opts && opts.animation ? opts.animation.duration || 500 : 500);
      } catch(e) {}
    },
    redraw: function() { /* 3D auto-renders */ },
    setOptions: function() { /* no-op for 3D */ },
    getPositions: function(ids) {
      var result = {};
      var nodes = graph3d.graphData().nodes;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!ids || ids.indexOf(n.id) >= 0) {
          result[n.id] = { x: n.x || 0, y: n.y || 0 };
        }
      }
      return result;
    },
    moveNode: function(id, x, y) { /* no-op for 3D */ },
    getScale: function() { return 1; },
    focus: function(nodeId, opts) {
      // vis-network 兼容: 聚焦到指定节点（3D 版本 — 平滑移动摄像机）
      if (!graph3d) return;
      var nodes3dAll = graph3d.graphData().nodes;
      var target = null;
      for (var i = 0; i < nodes3dAll.length; i++) {
        if (nodes3dAll[i].id === nodeId) { target = nodes3dAll[i]; break; }
      }
      if (!target || target.x === undefined) return;
      var dur = (opts && opts.animation && opts.animation.duration) || 600;
      var dist = 200; // 合理的聚焦距离
      graph3d.cameraPosition(
        { x: target.x, y: target.y, z: (target.z || 0) + dist },
        { x: target.x, y: target.y, z: target.z || 0 },
        dur
      );
    },
    selectNodes: function(ids) {
      if (ids && ids.length > 0) {
        update3DHighlight(ids[0]);
        refresh3DStyles();
      } else {
        update3DHighlight(null);
        refresh3DStyles();
      }
    },
    getConnectedEdges: function(nodeId) {
      // 返回关联边 ID 列表（用于 highlightConnectedEdges 兼容）
      var edgeIds = [];
      if (_3dNodeLinks[nodeId]) {
        _3dNodeLinks[nodeId].forEach(function(l) {
          if (l._id) edgeIds.push(l._id);
        });
      }
      return edgeIds;
    },
    on: function(event, cb) {
      // 将 vis-network 事件映射到 3D 事件
      if (event === 'stabilizationIterationsDone') {
        // 3D 力导向约 3 秒后模拟稳定
        setTimeout(function() {
          try { cb(); } catch(e) {}
        }, 3000);
      }
    },
    off: function() {},
    // Phase-75: 增量数据注入 (供渐进式加载 Stage 2/3 使用)
    _addData: function(newNodes3d, newLinks3d) {
      // ── 0) 检测当前布局模式 ──
      var _isOrb = (_s3d.layoutMode === 'orbital');

      // 行星轨道: 类型→轨道编号 (与初始化 ORBIT_MAP 一致)
      var _ORBIT_MAP = { 'project': 0, 'module': 1, 'main-task': 2, 'sub-task': 3, 'document': 4 };
      var _orbSpacing = _s3d.orbitSpacing || 80;

      // 力导向分层: 类型→轨道层 (与初始化 TYPE_BAND 一致)
      var _TYPE_BAND = { 'project': 0, 'module': 1, 'document': 2, 'main-task': 3, 'sub-task': 4 };
      var _sepSpacing = _s3d.typeSepSpacing || 80;
      var _doTypeSep = !_isOrb && _s3d.typeSeparation && _s3d.typeSepStrength > 0;

      // ── 建立已有节点索引 ──
      var curData = graph3d.graphData();
      var existNodeMap = {};
      for (var ei = 0; ei < curData.nodes.length; ei++) {
        existNodeMap[curData.nodes[ei].id] = curData.nodes[ei];
      }

      // ── 建立新边的父子关系映射 ──
      var newNodeParent = {};
      for (var li = 0; li < newLinks3d.length; li++) {
        var lnk = newLinks3d[li];
        var srcId = typeof lnk.source === 'object' ? lnk.source.id : lnk.source;
        var tgtId = typeof lnk.target === 'object' ? lnk.target.id : lnk.target;
        if (existNodeMap[srcId] && !existNodeMap[tgtId]) {
          newNodeParent[tgtId] = existNodeMap[srcId];
        } else if (existNodeMap[tgtId] && !existNodeMap[srcId]) {
          newNodeParent[srcId] = existNodeMap[tgtId];
        }
      }

      // ── 为每个新节点设置布局属性 + 初始位置 ──
      for (var ni = 0; ni < newNodes3d.length; ni++) {
        var nn = newNodes3d[ni];
        var nodeTargetR = 200; // 默认目标半径

        if (_isOrb) {
          // ★ 行星轨道模式: 设置 _orbitRadius / _orbitIndex
          var orbIdx = _ORBIT_MAP[nn._type];
          if (orbIdx === undefined) orbIdx = 3;
          nn._orbitIndex = orbIdx;
          nn._orbitRadius = orbIdx * _orbSpacing;
          nodeTargetR = nn._orbitRadius;
        } else if (_doTypeSep) {
          // ★ 力导向分层模式: 设置 _targetBand / _targetRadius
          var band = _TYPE_BAND[nn._type];
          if (band === undefined) band = 4;
          nn._targetBand = band;
          nn._targetRadius = band * _sepSpacing;
          nodeTargetR = nn._targetRadius;
        }

        // ── 智能初始位置 ──
        var parent = newNodeParent[nn.id];
        if (_isOrb && nodeTargetR > 0) {
          // 行星轨道模式: 直接放置在目标轨道上 (XY 平面圆环 + 微小 Z 偏移)
          // 这样轨道力只需微调，不用从远处飞入
          var orbAngle = Math.random() * Math.PI * 2;
          var orbJitter = nodeTargetR * 0.1; // 10% 抖动
          nn.x = Math.cos(orbAngle) * (nodeTargetR + (Math.random() - 0.5) * orbJitter);
          nn.y = Math.sin(orbAngle) * (nodeTargetR + (Math.random() - 0.5) * orbJitter);
          nn.z = (Math.random() - 0.5) * nodeTargetR * 0.05; // 极小的 Z 偏移 (扁平)
        } else if (parent && parent.x !== undefined) {
          // 力导向模式: 从父节点向外延伸
          var px = parent.x || 0, py = parent.y || 0, pz = parent.z || 0;
          var pDist = Math.sqrt(px*px + py*py + pz*pz);
          var spread = (_doTypeSep ? _sepSpacing : 50) * (0.5 + Math.random() * 0.5);
          if (pDist > 1) {
            nn.x = px + (px / pDist) * spread + (Math.random() - 0.5) * spread * 0.6;
            nn.y = py + (py / pDist) * spread + (Math.random() - 0.5) * spread * 0.6;
            nn.z = pz + (pz / pDist) * spread * 0.3 + (Math.random() - 0.5) * spread * 0.3;
          } else {
            var randA = Math.random() * Math.PI * 2;
            nn.x = Math.cos(randA) * spread;
            nn.y = Math.sin(randA) * spread;
            nn.z = (Math.random() - 0.5) * spread * 0.3;
          }
        } else {
          // 无父节点 → 按目标半径随机放置
          var trFallback = nodeTargetR > 0 ? nodeTargetR : 200;
          var rJitter = trFallback * (0.8 + Math.random() * 0.4);
          var aFallback = Math.random() * Math.PI * 2;
          var pFallback = (Math.random() - 0.5) * Math.PI * 0.3;
          nn.x = Math.cos(aFallback) * Math.cos(pFallback) * rJitter;
          nn.y = Math.sin(aFallback) * Math.cos(pFallback) * rJitter;
          nn.z = Math.sin(pFallback) * rJitter * 0.3;
        }
      }

      // ── 1) 更新邻接表 ──
      for (var ai = 0; ai < newLinks3d.length; ai++) {
        var al = newLinks3d[ai];
        var aSrcId = typeof al.source === 'object' ? al.source.id : al.source;
        var aTgtId = typeof al.target === 'object' ? al.target.id : al.target;
        if (!_3dNodeNeighbors[aSrcId]) _3dNodeNeighbors[aSrcId] = new Set();
        if (!_3dNodeNeighbors[aTgtId]) _3dNodeNeighbors[aTgtId] = new Set();
        _3dNodeNeighbors[aSrcId].add(aTgtId);
        _3dNodeNeighbors[aTgtId].add(aSrcId);
        if (!_3dNodeLinks[aSrcId]) _3dNodeLinks[aSrcId] = new Set();
        if (!_3dNodeLinks[aTgtId]) _3dNodeLinks[aTgtId] = new Set();
        _3dNodeLinks[aSrcId].add(al);
        _3dNodeLinks[aTgtId].add(al);
      }
      // ── 2) 合并到 graph3d 数据 ──
      var mNodes = curData.nodes.concat(newNodes3d);
      var mLinks = curData.links.concat(newLinks3d);
      graph3d.graphData({ nodes: mNodes, links: mLinks });
      // ── 3) reheat 让力模拟推动新节点到正确轨道/层 ──
      setTimeout(function() {
        try { graph3d.d3ReheatSimulation(); } catch(e) {}
      }, 100);
    },
    // Phase-75: 增量移除 (供折叠等操作使用)
    _removeData: function(removeNodeIds) {
      var removeSet = {};
      for (var ri = 0; ri < removeNodeIds.length; ri++) removeSet[removeNodeIds[ri]] = true;
      // 清理邻接表
      for (var ri = 0; ri < removeNodeIds.length; ri++) {
        delete _3dNodeNeighbors[removeNodeIds[ri]];
        delete _3dNodeLinks[removeNodeIds[ri]];
      }
      // 从图数据中移除
      var curData = graph3d.graphData();
      var fNodes = curData.nodes.filter(function(n) { return !removeSet[n.id]; });
      var fLinks = curData.links.filter(function(l) {
        var sId = typeof l.source === 'object' ? l.source.id : l.source;
        var tId = typeof l.target === 'object' ? l.target.id : l.target;
        return !removeSet[sId] && !removeSet[tId];
      });
      graph3d.graphData({ nodes: fNodes, links: fLinks });
    }
  };

  networkReusable = true; // Phase-75: 3D 模式支持增量更新 (via _addData)

  // 隐藏加载指示器
  document.getElementById('loading').style.display = 'none';
  log('3D 图谱渲染完成! ' + nodes3d.length + ' 节点, ' + links3d.length + ' 边 (Three.js WebGL)', true);

  // 自动聚焦视图
  setTimeout(function() {
    try { graph3d.zoomToFit(800); } catch(e) {}
  }, 2000);

  // 窗口大小变化时自适应
  window.addEventListener('resize', function() {
    var newRect = container.getBoundingClientRect();
    if (newRect.width > 0 && newRect.height > 0) {
      graph3d.width(newRect.width).height(newRect.height);
    }
  });
}

/* handle3DNodeClick 已移除 — 3D 引擎现在使用共享的 showPanel() */

`;
}
