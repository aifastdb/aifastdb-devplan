/**
 * DevPlan 图可视化 HTML 模板
 *
 * 自包含的 HTML 页面，通过 CDN 引入 vis-network standalone 版本。
 * 支持 5 种节点类型和 4 种边类型的视觉映射，暗色主题。
 */

export function getVisualizationHTML(projectName: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevPlan - ${projectName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #111827; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; overflow: hidden; }

    /* Header */
    .header { background: #1f2937; border-bottom: 1px solid #374151; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; height: 56px; }
    .header h1 { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
    .header h1 .icon { font-size: 24px; }
    .header .project-name { color: #818cf8; }

    /* Stats Bar */
    .stats-bar { display: flex; gap: 24px; align-items: center; }
    .stat { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #9ca3af; }
    .stat .num { font-weight: 700; font-size: 16px; }
    .stat .num.green { color: #10b981; }
    .stat .num.blue { color: #3b82f6; }
    .stat .num.purple { color: #8b5cf6; }
    .stat .num.amber { color: #f59e0b; }
    .progress-bar { width: 120px; height: 8px; background: #374151; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #10b981, #3b82f6); border-radius: 4px; transition: width 0.5s; }

    /* Controls */
    .controls { background: #1f2937; border-bottom: 1px solid #374151; padding: 8px 24px; display: flex; align-items: center; gap: 16px; height: 44px; }
    .filter-group { display: flex; gap: 8px; align-items: center; }
    .filter-btn { padding: 4px 12px; border-radius: 6px; border: 1px solid #4b5563; background: transparent; color: #d1d5db; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s; }
    .filter-btn:hover { border-color: #6b7280; background: #374151; }
    .filter-btn.active { border-color: #6366f1; background: #312e81; color: #a5b4fc; }
    .filter-btn .dot { width: 8px; height: 8px; border-radius: 50%; }
    .sep { width: 1px; height: 20px; background: #374151; }
    .refresh-btn { padding: 6px 14px; border-radius: 6px; border: none; background: #4f46e5; color: #fff; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: background 0.2s; }
    .refresh-btn:hover { background: #4338ca; }

    /* Graph — 明确高度 = 视口 - header(56) - controls(44) - legend(40) */
    .graph-container { position: relative; height: calc(100vh - 140px); background: #111827; }
    #graph { width: 100%; height: 100%; }

    .loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(17,24,39,0.9); z-index: 20; }
    .spinner { width: 40px; height: 40px; border: 4px solid #4f46e5; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Detail Panel */
    .panel { position: absolute; top: 12px; right: 12px; width: 320px; background: #1f2937; border: 1px solid #374151; border-radius: 12px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); z-index: 10; overflow: hidden; display: none; }
    .panel.show { display: block; }
    .panel-header { padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; }
    .panel-header.project { background: linear-gradient(135deg, #d97706, #f59e0b); }
    .panel-header.module { background: linear-gradient(135deg, #059669, #10b981); }
    .panel-header.main-task { background: linear-gradient(135deg, #4f46e5, #6366f1); }
    .panel-header.sub-task { background: linear-gradient(135deg, #7c3aed, #8b5cf6); }
    .panel-header.document { background: linear-gradient(135deg, #7c3aed, #a78bfa); }
    .panel-title { font-weight: 600; font-size: 14px; color: #fff; }
    .panel-close { background: rgba(255,255,255,0.2); border: none; color: #fff; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; }
    .panel-close:hover { background: rgba(255,255,255,0.3); }
    .panel-body { padding: 16px; }
    .panel-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid #374151; }
    .panel-row:last-child { border-bottom: none; }
    .panel-label { color: #9ca3af; }
    .panel-value { color: #e5e7eb; font-weight: 500; }
    .status-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .status-completed { background: #064e3b; color: #6ee7b7; }
    .status-in_progress { background: #1e3a5f; color: #93c5fd; }
    .status-pending { background: #374151; color: #9ca3af; }
    .status-cancelled { background: #451a03; color: #fbbf24; }
    .priority-P0 { background: #7f1d1d; color: #fca5a5; }
    .priority-P1 { background: #78350f; color: #fde68a; }
    .priority-P2 { background: #1e3a5f; color: #93c5fd; }
    .panel-progress { margin-top: 8px; }
    .panel-progress-bar { width: 100%; height: 6px; background: #374151; border-radius: 3px; overflow: hidden; margin-top: 4px; }
    .panel-progress-fill { height: 100%; background: #10b981; border-radius: 3px; }

    /* Legend */
    .legend { background: #1f2937; border-top: 1px solid #374151; padding: 8px 24px; display: flex; align-items: center; justify-content: center; gap: 24px; height: 40px; font-size: 12px; color: #9ca3af; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-icon { width: 12px; height: 12px; }
    .legend-icon.star { background: #f59e0b; clip-path: polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%); }
    .legend-icon.diamond { background: #10b981; clip-path: polygon(50% 0%,100% 50%,50% 100%,0% 50%); }
    .legend-icon.circle { background: #6366f1; border-radius: 50%; }
    .legend-icon.dot { background: #8b5cf6; border-radius: 50%; width: 8px; height: 8px; }
    .legend-icon.square { background: #a78bfa; border-radius: 2px; width: 10px; height: 10px; }
    .legend-line { width: 24px; height: 2px; }
    .legend-line.solid { background: #6b7280; }
    .legend-line.thin { background: #6b7280; height: 1px; }
    .legend-line.dashed { border-top: 2px dashed #6b7280; background: none; height: 0; }
    .legend-line.dotted { border-top: 2px dotted #10b981; background: none; height: 0; }

    /* Debug bar */
    .debug { position: fixed; bottom: 40px; left: 12px; background: rgba(31,41,55,0.9); border: 1px solid #374151; border-radius: 8px; padding: 8px 12px; font-size: 11px; color: #9ca3af; z-index: 30; max-width: 400px; }
    .debug .ok { color: #10b981; }
    .debug .err { color: #f87171; }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <h1><span class="icon">📊</span> DevPlan 图谱 <span class="project-name">${projectName}</span></h1>
    <div class="stats-bar" id="statsBar">
      <div class="stat"><span>加载中...</span></div>
    </div>
  </div>

  <!-- Controls -->
  <div class="controls">
    <span style="font-size:12px;color:#6b7280;">显示：</span>
    <div class="filter-group">
      <button class="filter-btn active" data-type="module" onclick="toggleFilter('module')"><span class="dot" style="background:#10b981;"></span> 模块</button>
      <button class="filter-btn active" data-type="main-task" onclick="toggleFilter('main-task')"><span class="dot" style="background:#6366f1;"></span> 主任务</button>
      <button class="filter-btn active" data-type="sub-task" onclick="toggleFilter('sub-task')"><span class="dot" style="background:#8b5cf6;"></span> 子任务</button>
      <button class="filter-btn active" data-type="document" onclick="toggleFilter('document')"><span class="dot" style="background:#a78bfa;"></span> 文档</button>
    </div>
    <div class="sep"></div>
    <button class="refresh-btn" onclick="loadData()">&#8635; 刷新</button>
  </div>

  <!-- Graph -->
  <div class="graph-container">
    <div class="loading" id="loading"><div><div class="spinner"></div><p style="margin-top:12px;color:#9ca3af;">加载图谱数据...</p></div></div>
    <div id="graph"></div>
    <div class="panel" id="panel">
      <div class="panel-header" id="panelHeader">
        <span class="panel-title" id="panelTitle">节点详情</span>
        <button class="panel-close" onclick="closePanel()">✕</button>
      </div>
      <div class="panel-body" id="panelBody"></div>
    </div>
  </div>

  <!-- Legend -->
  <div class="legend">
    <div class="legend-item"><div class="legend-icon star"></div> 项目</div>
    <div class="legend-item"><div class="legend-icon diamond"></div> 模块</div>
    <div class="legend-item"><div class="legend-icon circle"></div> 主任务</div>
    <div class="legend-item"><div class="legend-icon dot"></div> 子任务</div>
    <div class="legend-item"><div class="legend-icon square"></div> 文档</div>
    <div style="width:1px;height:16px;background:#374151;"></div>
    <div class="legend-item"><div class="legend-line solid"></div> 主任务</div>
    <div class="legend-item"><div class="legend-line thin"></div> 子任务</div>
    <div class="legend-item"><div class="legend-line dashed"></div> 文档</div>
    <div class="legend-item"><div class="legend-line dotted"></div> 模块关联</div>
  </div>

  <!-- Debug info -->
  <div class="debug" id="debug">状态: 正在加载 vis-network...</div>

<script>
// ========== Debug ==========
var dbg = document.getElementById('debug');
function log(msg, ok) {
  console.log('[DevPlan]', msg);
  dbg.innerHTML = (ok ? '<span class="ok">✓</span> ' : '<span class="err">✗</span> ') + msg;
}

// ========== 动态加载 vis-network ==========
var VIS_URLS = [
  'https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js',
  'https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/vis-network/9.1.9/standalone/umd/vis-network.min.js'
];

function loadVisNetwork(index) {
  if (index >= VIS_URLS.length) {
    log('所有 CDN 均加载失败，请检查网络连接', false);
    document.getElementById('loading').innerHTML = '<div style="text-align:center"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><p style="color:#f87171;">vis-network 库加载失败</p><p style="color:#9ca3af;margin-top:8px;font-size:13px;">所有 CDN 源均不可用，请检查网络连接</p><button class="refresh-btn" onclick="location.reload()" style="margin-top:12px;">刷新页面</button></div>';
    return;
  }
  var url = VIS_URLS[index];
  log('尝试加载 CDN #' + (index+1) + ': ' + url.split('/')[2], true);
  var s = document.createElement('script');
  s.src = url;
  s.onload = function() {
    if (typeof vis !== 'undefined' && vis.Network && vis.DataSet) {
      log('vis-network 加载成功 (CDN #' + (index+1) + ')', true);
      startApp();
    } else {
      log('CDN #' + (index+1) + ' 加载但 vis 对象不完整, 尝试下一个', false);
      loadVisNetwork(index + 1);
    }
  };
  s.onerror = function() {
    log('CDN #' + (index+1) + ' 加载失败, 尝试下一个', false);
    loadVisNetwork(index + 1);
  };
  document.head.appendChild(s);
}

// ========== State ==========
var network = null;
var allNodes = [];
var allEdges = [];
var nodesDataSet = null;
var edgesDataSet = null;
var hiddenTypes = {};
var ctrlPressed = false;

// 监听 Ctrl 按键状态
document.addEventListener('keydown', function(e) { if (e.key === 'Control') ctrlPressed = true; });
document.addEventListener('keyup', function(e) { if (e.key === 'Control') ctrlPressed = false; });
window.addEventListener('blur', function() { ctrlPressed = false; });

// ========== Node Styles ==========
var STATUS_COLORS = {
  completed:   { bg: '#059669', border: '#047857', font: '#d1fae5' },
  in_progress: { bg: '#2563eb', border: '#1d4ed8', font: '#dbeafe' },
  pending:     { bg: '#4b5563', border: '#374151', font: '#d1d5db' },
  cancelled:   { bg: '#92400e', border: '#78350f', font: '#fde68a' }
};

function nodeStyle(node) {
  var t = node.type;
  var p = node.properties || {};
  var status = p.status || 'pending';
  var sc = STATUS_COLORS[status] || STATUS_COLORS.pending;

  if (t === 'project') {
    return { shape: 'star', size: 40, color: { background: '#f59e0b', border: '#d97706', highlight: { background: '#fbbf24', border: '#d97706' } }, font: { size: 18, color: '#fff' }, borderWidth: 3 };
  }
  if (t === 'module') {
    return { shape: 'diamond', size: 25, color: { background: '#059669', border: '#047857', highlight: { background: '#10b981', border: '#047857' } }, font: { size: 13, color: '#d1fae5' }, borderWidth: 2 };
  }
  if (t === 'main-task') {
    return { shape: 'dot', size: 22, color: { background: sc.bg, border: sc.border, highlight: { background: sc.bg, border: '#fff' } }, font: { size: 12, color: sc.font }, borderWidth: 2 };
  }
  if (t === 'sub-task') {
    return { shape: 'dot', size: 10, color: { background: sc.bg, border: sc.border, highlight: { background: sc.bg, border: '#fff' } }, font: { size: 9, color: sc.font }, borderWidth: 1 };
  }
  if (t === 'document') {
    return { shape: 'box', size: 16, color: { background: '#7c3aed', border: '#6d28d9', highlight: { background: '#8b5cf6', border: '#6d28d9' } }, font: { size: 10, color: '#ddd6fe' }, borderWidth: 1 };
  }
  return { shape: 'dot', size: 12, color: { background: '#6b7280', border: '#4b5563' }, font: { size: 10, color: '#9ca3af' } };
}

function edgeStyle(edge) {
  var label = edge.label || '';
  if (label === 'has_main_task') return { width: 2, color: { color: '#6b7280', highlight: '#93c5fd' }, dashes: false, arrows: { to: { enabled: true, scaleFactor: 0.6 } } };
  if (label === 'has_sub_task') return { width: 1, color: { color: '#4b5563', highlight: '#818cf8' }, dashes: false, arrows: { to: { enabled: true, scaleFactor: 0.4 } } };
  if (label === 'has_document') return { width: 1, color: { color: '#4b5563', highlight: '#a78bfa' }, dashes: [5, 5], arrows: { to: { enabled: true, scaleFactor: 0.4 } } };
  if (label === 'module_has_task') return { width: 1.5, color: { color: '#065f46', highlight: '#34d399' }, dashes: [2, 4], arrows: { to: { enabled: true, scaleFactor: 0.5 } } };
  return { width: 1, color: { color: '#374151' }, dashes: false };
}

// ========== Data Loading ==========
function loadData() {
  document.getElementById('loading').style.display = 'flex';
  log('正在获取图谱数据...', true);

  Promise.all([
    fetch('/api/graph').then(function(r) { return r.json(); }),
    fetch('/api/progress').then(function(r) { return r.json(); })
  ]).then(function(results) {
    var graphRes = results[0];
    var progressRes = results[1];
    allNodes = graphRes.nodes || [];
    allEdges = graphRes.edges || [];
    log('数据获取成功: ' + allNodes.length + ' 节点, ' + allEdges.length + ' 边', true);
    renderStats(progressRes, graphRes);
    renderGraph();
  }).catch(function(err) {
    log('数据获取失败: ' + err.message, false);
    document.getElementById('loading').innerHTML = '<div style="text-align:center"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><p style="color:#f87171;">数据加载失败: ' + err.message + '</p><button class="refresh-btn" onclick="loadData()" style="margin-top:12px;">重试</button></div>';
  });
}

function renderStats(progress, graph) {
  var bar = document.getElementById('statsBar');
  var pct = progress.overallPercent || 0;
  var moduleCount = 0;
  for (var i = 0; i < graph.nodes.length; i++) {
    if (graph.nodes[i].type === 'module') moduleCount++;
  }
  bar.innerHTML =
    '<div class="stat"><span class="num amber">' + moduleCount + '</span> 模块</div>' +
    '<div class="stat"><span class="num blue">' + progress.mainTaskCount + '</span> 主任务</div>' +
    '<div class="stat"><span class="num purple">' + progress.subTaskCount + '</span> 子任务</div>' +
    '<div class="stat"><span class="num green">' + progress.completedSubTasks + '/' + progress.subTaskCount + '</span> 已完成</div>' +
    '<div class="stat"><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div><span>' + pct + '%</span></div>';
}

// ========== Graph Rendering ==========
function renderGraph() {
  try {
    var container = document.getElementById('graph');
    var rect = container.getBoundingClientRect();
    log('容器尺寸: ' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ', 渲染中...', true);

    if (rect.height < 50) {
      container.style.height = (window.innerHeight - 140) + 'px';
      rect = container.getBoundingClientRect();
      log('容器高度修正为: ' + Math.round(rect.height) + 'px', true);
    }

    var visibleNodes = [];
    for (var i = 0; i < allNodes.length; i++) {
      var n = allNodes[i];
      if (hiddenTypes[n.type]) continue;
      var s = nodeStyle(n);
      visibleNodes.push({ id: n.id, label: n.label, title: n.label, shape: s.shape, size: s.size, color: s.color, font: s.font, borderWidth: s.borderWidth, _type: n.type, _props: n.properties || {} });
    }

    var visibleIds = {};
    for (var i = 0; i < visibleNodes.length; i++) visibleIds[visibleNodes[i].id] = true;

    var visibleEdges = [];
    for (var i = 0; i < allEdges.length; i++) {
      var e = allEdges[i];
      if (!visibleIds[e.from] || !visibleIds[e.to]) continue;
      var es = edgeStyle(e);
      visibleEdges.push({ id: 'e' + i, from: e.from, to: e.to, width: es.width, color: es.color, dashes: es.dashes, arrows: es.arrows, _label: e.label });
    }

    log('可见节点: ' + visibleNodes.length + ', 可见边: ' + visibleEdges.length, true);

    nodesDataSet = new vis.DataSet(visibleNodes);
    edgesDataSet = new vis.DataSet(visibleEdges);

    if (network) {
      network.destroy();
      network = null;
    }

    network = new vis.Network(container, { nodes: nodesDataSet, edges: edgesDataSet }, {
      nodes: {
        borderWidth: 2,
        shadow: { enabled: true, color: 'rgba(0,0,0,0.3)', size: 5, x: 0, y: 2 }
      },
      edges: {
        smooth: { enabled: true, type: 'continuous', roundness: 0.5 },
        shadow: false
      },
      physics: {
        enabled: true,
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -80,
          centralGravity: 0.015,
          springLength: 150,
          springConstant: 0.05,
          damping: 0.4,
          avoidOverlap: 0.8
        },
        stabilization: { enabled: true, iterations: 200, updateInterval: 25 }
      },
      interaction: {
        hover: true,
        tooltipDelay: 100,
        navigationButtons: false,
        keyboard: false,
        zoomView: true,
        dragView: true
      },
      layout: {
        improvedLayout: false,
        hierarchical: false
      }
    });

    log('Network 实例已创建, 等待物理稳定化...', true);

    network.on('stabilizationIterationsDone', function() {
      network.setOptions({ physics: { enabled: false } });
      document.getElementById('loading').style.display = 'none';
      log('图谱渲染完成! ' + visibleNodes.length + ' 节点, ' + visibleEdges.length + ' 边', true);
      network.fit({ animation: { duration: 800, easingFunction: 'easeInOutQuad' } });
    });

    network.on('click', function(params) {
      if (params.nodes.length > 0) showPanel(params.nodes[0]);
      else closePanel();
    });

    // ========== Ctrl+拖拽整体移动关联节点 ==========
    var groupDrag = { active: false, nodeId: null, connectedIds: [], startPositions: {} };

    network.on('dragStart', function(params) {
      if (!ctrlPressed || params.nodes.length === 0) {
        groupDrag.active = false;
        return;
      }
      var draggedId = params.nodes[0];
      // 获取所有直接关联的节点
      var connected = network.getConnectedNodes(draggedId);
      groupDrag.active = true;
      groupDrag.nodeId = draggedId;
      groupDrag.connectedIds = connected;
      // 记录所有关联节点的初始位置
      groupDrag.startPositions = {};
      var positions = network.getPositions([draggedId].concat(connected));
      groupDrag.startPositions = positions;
      groupDrag.dragStartPos = positions[draggedId];
      log('Ctrl+拖拽: 整体移动 ' + (connected.length + 1) + ' 个节点', true);
    });

    network.on('dragging', function(params) {
      if (!groupDrag.active || params.nodes.length === 0) return;
      var draggedId = groupDrag.nodeId;
      // 获取当前被拖拽节点的位置
      var currentPos = network.getPositions([draggedId])[draggedId];
      if (!currentPos || !groupDrag.dragStartPos) return;
      // 计算位移差
      var dx = currentPos.x - groupDrag.dragStartPos.x;
      var dy = currentPos.y - groupDrag.dragStartPos.y;
      // 移动所有关联节点
      for (var i = 0; i < groupDrag.connectedIds.length; i++) {
        var cid = groupDrag.connectedIds[i];
        var startPos = groupDrag.startPositions[cid];
        if (startPos) {
          network.moveNode(cid, startPos.x + dx, startPos.y + dy);
        }
      }
    });

    network.on('dragEnd', function(params) {
      if (groupDrag.active) {
        log('整体移动完成', true);
        groupDrag.active = false;
        groupDrag.nodeId = null;
        groupDrag.connectedIds = [];
        groupDrag.startPositions = {};
      }
    });

    // 超时回退
    setTimeout(function() {
      if (document.getElementById('loading').style.display !== 'none') {
        document.getElementById('loading').style.display = 'none';
        log('稳定化超时, 强制显示图谱', true);
        if (network) network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
      }
    }, 8000);

  } catch (err) {
    log('渲染错误: ' + err.message, false);
    console.error('[DevPlan] renderGraph error:', err);
    document.getElementById('loading').innerHTML = '<div style="text-align:center"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><p style="color:#f87171;">渲染失败: ' + err.message + '</p><button class="refresh-btn" onclick="loadData()" style="margin-top:12px;">重试</button></div>';
  }
}

// ========== Detail Panel ==========
function showPanel(nodeId) {
  var node = nodesDataSet.get(nodeId);
  if (!node) return;
  var panel = document.getElementById('panel');
  var header = document.getElementById('panelHeader');
  var title = document.getElementById('panelTitle');
  var body = document.getElementById('panelBody');

  header.className = 'panel-header ' + (node._type || '');
  var typeNames = { project: '项目', module: '模块', 'main-task': '主任务', 'sub-task': '子任务', document: '文档' };
  title.textContent = (typeNames[node._type] || '节点') + ' 详情';

  var p = node._props;
  var html = '<div class="panel-row"><span class="panel-label">名称</span><span class="panel-value">' + escHtml(node.label) + '</span></div>';

  if (node._type === 'main-task') {
    html += row('任务ID', p.taskId);
    html += row('优先级', '<span class="status-badge priority-' + (p.priority || 'P2') + '">' + (p.priority || 'P2') + '</span>');
    html += row('状态', statusBadge(p.status));
    if (p.totalSubtasks !== undefined) {
      var pct = p.totalSubtasks > 0 ? Math.round((p.completedSubtasks || 0) / p.totalSubtasks * 100) : 0;
      html += row('子任务', (p.completedSubtasks || 0) + '/' + p.totalSubtasks);
      html += '<div class="panel-progress"><div class="panel-progress-bar"><div class="panel-progress-fill" style="width:' + pct + '%"></div></div></div>';
    }
  } else if (node._type === 'sub-task') {
    html += row('任务ID', p.taskId);
    html += row('父任务', p.parentTaskId);
    html += row('状态', statusBadge(p.status));
  } else if (node._type === 'module') {
    html += row('模块ID', p.moduleId);
    html += row('状态', statusBadge(p.status || 'active'));
    html += row('主任务数', p.mainTaskCount);
  } else if (node._type === 'document') {
    html += row('类型', p.section);
    if (p.subSection) html += row('子类型', p.subSection);
    html += row('版本', p.version);
  } else if (node._type === 'project') {
    html += row('类型', '项目根节点');
  }

  body.innerHTML = html;
  panel.classList.add('show');
}

function closePanel() { document.getElementById('panel').classList.remove('show'); }

function row(label, value) { return '<div class="panel-row"><span class="panel-label">' + label + '</span><span class="panel-value">' + (value || '-') + '</span></div>'; }
function statusBadge(s) { return '<span class="status-badge status-' + (s || 'pending') + '">' + statusText(s) + '</span>'; }
function statusText(s) { var m = { completed: '已完成', in_progress: '进行中', pending: '待开始', cancelled: '已取消', active: '活跃', planning: '规划中', deprecated: '已废弃' }; return m[s] || s || '未知'; }
function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ========== Filters ==========
function toggleFilter(type) {
  var btn = document.querySelector('.filter-btn[data-type="' + type + '"]');
  if (hiddenTypes[type]) {
    delete hiddenTypes[type];
    btn.classList.add('active');
  } else {
    hiddenTypes[type] = true;
    btn.classList.remove('active');
  }
  renderGraph();
}

// ========== App Start ==========
function startApp() {
  log('vis-network 就绪, 开始加载数据...', true);
  loadData();
}

// ========== Init: 动态加载 vis-network ==========
loadVisNetwork(0);
</script>
</body>
</html>`;
}
