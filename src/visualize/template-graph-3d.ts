/**
 * DevPlan 图可视化 — 3D Force Graph 渲染模块
 *
 * 包含: Three.js WebGL 3D 图渲染、力导向布局、节点交互。
 */

export function getGraph3DScript(): string {
  return `
// ========== 3D Force Graph Rendering ==========
// 从自定义设置中加载颜色和大小 (用户可在项目设置页修改)
function load3DColorsFromSettings() {
  var s = get3DSettings();
  return {
    'project':   s.colorProject,
    'module':    s.colorModule,
    'main-task': s.colorMainTask,
    'sub-task':  s.colorSubTask,
    'document':  s.colorDocument
  };
}
function load3DSizesFromSettings() {
  var s = get3DSettings();
  return {
    'project':   s.sizeProject,
    'module':    s.sizeModule,
    'main-task': s.sizeMainTask,
    'sub-task':  s.sizeSubTask,
    'document':  s.sizeDocument
  };
}
var NODE_3D_COLORS = load3DColorsFromSettings();
var NODE_3D_SIZES = load3DSizesFromSettings();
// 状态 → 颜色覆盖 (主任务/子任务)
var STATUS_3D_COLORS = {
  'completed':   '#22c55e',
  'in_progress': '#f59e0b',
  'pending':     null,  // 使用默认类型色
  'cancelled':   '#6b7280'
};

function get3DNodeColor(node) {
  var t = node._type || 'sub-task';
  // 任务类型根据状态着色
  if (t === 'main-task' || t === 'sub-task') {
    var status = (node._props || {}).status || 'pending';
    var sc = STATUS_3D_COLORS[status];
    if (sc) return sc;
  }
  return NODE_3D_COLORS[t] || '#6b7280';
}

function get3DLinkColor(link) {
  var label = link._label || '';
  if (label === 'has_main_task') return 'rgba(147,197,253,0.18)';
  if (label === 'has_sub_task')  return 'rgba(129,140,248,0.12)';
  if (label === 'has_document')  return 'rgba(96,165,250,0.10)';
  if (label === 'has_module')    return 'rgba(52,211,153,0.18)';
  if (label === 'module_has_task') return 'rgba(52,211,153,0.15)';
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

// 缓存 glow 纹理 (避免每个节点重复创建)
var _glowTextureCache = {};

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
  // 重新加载颜色和大小（确保使用最新设置）
  NODE_3D_COLORS = load3DColorsFromSettings();
  NODE_3D_SIZES = load3DSizesFromSettings();

  // ── 高亮状态追踪 ──
  var _3dSelectedNodeId = null;       // 当前选中节点 ID
  var _3dHighlightLinks = new Set();  // 选中节点的关联边 Set
  var _3dHighlightNodes = new Set();  // 选中节点 + 邻居节点 Set

  // 边类型 → 高亮色映射（与 vis-network edgeStyle 对齐）
  var LINK_HIGHLIGHT_COLORS = {
    'has_main_task':   '#93c5fd',
    'has_sub_task':    '#818cf8',
    'has_document':    '#60a5fa',
    'has_module':      '#34d399',
    'module_has_task': '#34d399',
    'task_has_doc':    '#f59e0b',
    'doc_has_child':   '#c084fc'
  };

  // 转换数据格式: vis-network edges → 3d-force-graph links
  var links3d = [];
  for (var i = 0; i < visibleEdges.length; i++) {
    var e = visibleEdges[i];
    links3d.push({
      source: e.from,
      target: e.to,
      _label: e._label,
      _width: e.width || 1,
      _color: get3DLinkColor(e),
      _highlightColor: LINK_HIGHLIGHT_COLORS[e._label] || '#a5b4fc',
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
      _color: get3DNodeColor(n)
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
      // 有选中节点时: 选中节点+邻居正常颜色，其他节点变暗
      if (_3dSelectedNodeId) {
        if (_3dHighlightNodes.has(n.id)) return n._color;
        return 'rgba(60,60,80,0.4)'; // 未关联节点变暗
      }
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
      var isDimmed = _3dSelectedNodeId && !_3dHighlightNodes.has(n.id);
      if (isDimmed) color = 'rgba(60,60,80,0.4)';

      // ── 创建容器 Group ──
      var group = new THREE.Group();

      // ── 节点几何体 (核心实体) ──
      var coreMesh;
      if (t === 'module') {
        var size = 7;
        var geo = new THREE.BoxGeometry(size, size, size);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity, emissive: color, emissiveIntensity: 0.3 });
        coreMesh = new THREE.Mesh(geo, mat);
      } else if (t === 'project') {
        var geo = new THREE.OctahedronGeometry(10);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity, emissive: color, emissiveIntensity: 0.4 });
        coreMesh = new THREE.Mesh(geo, mat);
      } else if (t === 'document') {
        var geo = new THREE.BoxGeometry(5, 6, 1.5);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity * 0.92, emissive: color, emissiveIntensity: 0.25 });
        coreMesh = new THREE.Mesh(geo, mat);
      } else {
        // 主任务 / 子任务 → 球体
        var radius = t === 'main-task' ? 3.5 : 1.8;
        var geo = new THREE.SphereGeometry(radius, 16, 12);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity, emissive: color, emissiveIntensity: 0.3 });
        coreMesh = new THREE.Mesh(geo, mat);
      }
      group.add(coreMesh);

      // ── 发光光晕 Sprite (Glow Aura) ──
      if (!isDimmed) {
        var glowSize = { 'project': 50, 'module': 30, 'main-task': 18, 'sub-task': 10, 'document': 16 }[t] || 12;

        // 获取或创建缓存的 glow texture
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
    // ── 交互事件 ──
    .onNodeClick(function(node, event) {
      // 更新高亮状态并触发重绘
      update3DHighlight(node ? node.id : null);
      refresh3DStyles();
      handle3DNodeClick(node);
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

  /** 刷新所有视觉样式（节点颜色/形状/光晕、边颜色/宽度/粒子） */
  function refresh3DStyles() {
    // 清空 glow 纹理缓存，以便重新生成（高亮/暗化需要不同纹理）
    _glowTextureCache = {};
    graph3d.nodeColor(graph3d.nodeColor())
           .nodeThreeObject(graph3d.nodeThreeObject()) // 刷新自定义形状 + 光晕
           .linkColor(graph3d.linkColor())
           .linkWidth(graph3d.linkWidth())
           .linkOpacity(graph3d.linkOpacity())
           .linkDirectionalParticles(graph3d.linkDirectionalParticles())
           .linkDirectionalParticleWidth(graph3d.linkDirectionalParticleWidth())
           .linkDirectionalParticleColor(graph3d.linkDirectionalParticleColor());
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

  // 设置力导向参数 (来自自定义设置)
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
    if (label === 'has_main_task') return _linkDist * 1.25;
    if (label === 'has_module') return _linkDist * 1.12;
    if (label === 'has_sub_task') return _linkDist * 0.625;
    if (label === 'module_has_task') return _linkDist * 1.0;
    if (label === 'has_document') return _linkDist * 0.875;
    return _linkDist * 0.75;
  }).strength(function(l) {
    var label = l._label || '';
    if (label === 'has_main_task' || label === 'has_module' || label === 'module_has_task') return 0.7;
    return 0.5;
  });

  // ── 中心引力 (来自自定义设置) ──
  try {
    var fg = graph3d.d3Force;
    if (fg('x')) fg('x').strength(_s3d.gravity);
    if (fg('y')) fg('y').strength(_s3d.gravity);
    if (fg('z')) fg('z').strength(_s3d.gravity);
  } catch(e) { /* 可能不支持，忽略 */ }

  // 注入数据
  graph3d.graphData({ nodes: nodes3d, links: links3d });

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

  // 创建兼容性 network wrapper（供其他代码使用 network.fit/destroy 等）
  network = {
    _graph3d: graph3d,
    _container: container,
    destroy: function() {
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
    on: function(event, cb) {
      // 将 vis-network 事件映射到 3D 事件
      if (event === 'stabilizationIterationsDone') {
        // 3D 力导向约 3 秒后模拟稳定
        setTimeout(function() {
          try { cb(); } catch(e) {}
        }, 3000);
      }
    },
    off: function() {}
  };

  networkReusable = false; // 3D 模式不支持增量更新

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

/** 处理 3D 模式下的节点点击 */
function handle3DNodeClick(node) {
  if (!node) return;
  var type = node._type || 'unknown';
  var props = node._props || {};
  var panelTitle = document.getElementById('panelTitle');
  var panelBody = document.getElementById('panelBody');
  var panel = document.getElementById('detailPanel');
  if (!panel || !panelTitle || !panelBody) return;

  panelTitle.textContent = node.label || node.id;

  var html = '<div style="font-size:12px;color:#9ca3af;margin-bottom:8px;">类型: ' + type + '</div>';

  if (props.status) {
    var statusLabel = { completed: '✅ 已完成', in_progress: '🔄 进行中', pending: '⏳ 待处理', cancelled: '❌ 已取消' };
    html += '<div style="margin-bottom:8px;">' + (statusLabel[props.status] || props.status) + '</div>';
  }
  if (props.taskId) html += '<div style="margin-bottom:4px;color:#94a3b8;font-size:11px;">任务ID: ' + props.taskId + '</div>';
  if (props.description) html += '<div style="margin-top:8px;padding:8px;background:#1e293b;border-radius:6px;font-size:12px;color:#cbd5e1;">' + props.description + '</div>';
  if (props.title) html += '<div style="margin-bottom:4px;font-size:12px;color:#e2e8f0;">' + props.title + '</div>';
  if (props.priority) html += '<div style="margin-bottom:4px;font-size:11px;color:#f59e0b;">优先级: ' + props.priority + '</div>';

  panelBody.innerHTML = html;
  panel.classList.add('open');

  // 高亮效果: 聚焦到该节点
  if (network && network._graph3d) {
    var dist = 120;
    network._graph3d.cameraPosition(
      { x: node.x + dist, y: node.y + dist, z: node.z + dist },
      { x: node.x, y: node.y, z: node.z },
      1000
    );
  }
}

`;
}
