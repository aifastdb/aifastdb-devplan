/**
 * DevPlan 图可视化 — 数据加载模块
 *
 * 包含: API 数据获取、分层加载、概览模式、节点/边数据处理。
 */

export function getDataLoadingScript(): string {
  return `
// ========== Data Loading ==========
// ── Phase-8C: Chunked loading configuration ──
var CHUNK_SIZE = 5000;       // nodes per page
var CHUNK_THRESHOLD = 3000;  // use chunked loading if total > this

function loadData() {
  document.getElementById('loading').style.display = 'flex';
  log('正在获取图谱数据...', true);
  loadDataFull();
}

// Phase-75: 分阶段渲染已移除 (全量一次渲染更稳定可靠)
// 增量注入函数保留 (供按需加载子任务、记忆节点等场景使用)

/**
 * Phase-75 T75.3: 3D Force Graph 增量注入。
 * 将 API 原始格式 (type/properties) 转换为 3D 格式 (_type/_props/_val/_color)，
 * 然后通过 network._addData 合并到 graph3d.graphData()。
 */
function incremental3DAddNodes(rawNodes, rawEdges) {
  if (!network || !network._graph3d || !network._addData) return;

  // 转换节点为 3D 格式
  var newNodes3d = [];
  for (var i = 0; i < rawNodes.length; i++) {
    var n = rawNodes[i];
    if (hiddenTypes[n.type]) continue;
    var n3d = {
      id: n.id,
      label: n.label,
      _type: n.type,
      _props: n.properties || {},
      _val: NODE_3D_SIZES[n.type] || 5,
      _color: get3DNodeColor({ _type: n.type, _props: n.properties || {} })
    };
    newNodes3d.push(n3d);
  }

  // 转换边为 3D 格式
  var curData = network._graph3d.graphData();
  var knownIds = {};
  for (var i = 0; i < curData.nodes.length; i++) knownIds[curData.nodes[i].id] = true;
  for (var i = 0; i < newNodes3d.length; i++) knownIds[newNodes3d[i].id] = true;

  var _graphSettings = getGraphSettings();
  var _hideProjectEdges = !_graphSettings.showProjectEdges;
  var _projIds = {};
  for (var i = 0; i < curData.nodes.length; i++) {
    if (curData.nodes[i]._type === 'project') _projIds[curData.nodes[i].id] = true;
  }

  var newLinks3d = [];
  for (var i = 0; i < rawEdges.length; i++) {
    var e = rawEdges[i];
    if (!knownIds[e.from] || !knownIds[e.to]) continue;
    var isProjectEdge = _hideProjectEdges && (_projIds[e.from] || _projIds[e.to]);
    newLinks3d.push({
      source: e.from,
      target: e.to,
      _label: e.label,
      _width: e.width || 1,
      _color: get3DLinkColor(e),
      _highlightColor: LINK_3D_HIGHLIGHT_COLORS[e.label] || '#a5b4fc',
      _projectEdgeHidden: !!isProjectEdge
    });
  }

  if (newNodes3d.length > 0 || newLinks3d.length > 0) {
    network._addData(newNodes3d, newLinks3d);
  }
  log('3D 增量注入: +' + newNodes3d.length + ' 节点, +' + newLinks3d.length + ' 边', true);
}

/**
 * Phase-75 T75.3: 3D Force Graph 增量移除。
 */
function incremental3DRemoveNodes(removeNodeIds) {
  if (!network || !network._graph3d || !network._removeData) return;
  network._removeData(removeNodeIds);
  log('3D 增量移除: -' + removeNodeIds.length + ' 节点', true);
}

/**
 * Phase-10 T10.1: Tiered loading for vis-network.
 * First loads L0+L1 (project, module, main-task) → fast first screen.
 * Sub-tasks and documents loaded on demand via double-click or filter toggle.
 */
function loadDataTiered() {
  log('分层加载: 首屏仅加载核心节点 (project/module/main-task)...', true);
  tieredLoadState = { l0l1Loaded: false, l2Loaded: false, l3Loaded: false, memoryLoaded: false, expandedPhases: {}, totalNodes: 0 };
  networkReusable = false;

  // Fetch L0+L1 nodes + progress in parallel
  var pagedUrl = '/api/graph/paged?offset=0&limit=500' +
    '&entityTypes=' + TIER_L0L1_TYPES.join(',') +
    '&includeDocuments=false&includeModules=true';

  Promise.all([
    fetch(pagedUrl).then(function(r) { return r.json(); }),
    fetch('/api/progress').then(function(r) { return r.json(); })
  ]).then(function(results) {
    var graphRes = results[0];
    var progressRes = results[1];
    allNodes = graphRes.nodes || [];
    allEdges = graphRes.edges || [];
    tieredLoadState.l0l1Loaded = true;
    tieredLoadState.totalNodes = graphRes.total || allNodes.length;

    log('首屏数据: ' + allNodes.length + ' 核心节点, ' + allEdges.length + ' 边 (总计 ' + tieredLoadState.totalNodes + ')', true);
    renderStats(progressRes, graphRes);
    renderGraph();
    updateTieredIndicator();
    // 分层模式: 子任务和文档尚未加载，在图例上给出视觉提示
    markUnloadedTypeLegends();
    // Phase-159: 后台预加载文档列表数据，点击文档统计时零延迟
    if (typeof loadDocsData === 'function') setTimeout(function() { loadDocsData(); }, 100);
  }).catch(function(err) {
    log('分层加载失败: ' + err.message + ', 回退全量加载', false);
    // Fallback: full load
    loadDataFull();
  });
}

/** Phase-10: Full load fallback (same as original loadData for vis-network) */
function loadDataFull() {
  // Phase-68: 初始加载不包含记忆节点（includeMemories=false），勾选后懒加载
  var graphApiUrl = '/api/graph?includeNodeDegree=' + (INCLUDE_NODE_DEGREE ? 'true' : 'false') +
    '&enableBackendDegreeFallback=' + (ENABLE_BACKEND_DEGREE_FALLBACK ? 'true' : 'false') +
    '&includeMemories=false';
  Promise.all([
    fetch(graphApiUrl).then(function(r) { return r.json(); }),
    fetch('/api/progress').then(function(r) { return r.json(); })
  ]).then(function(results) {
    var graphRes = results[0];
    var progressRes = results[1];
    allNodes = graphRes.nodes || [];
    allEdges = graphRes.edges || [];
    tieredLoadState.l0l1Loaded = true;
    tieredLoadState.l2Loaded = true;
    tieredLoadState.l3Loaded = true;
    tieredLoadState.memoryLoaded = false; // Phase-68: 记忆尚未加载
    tieredLoadState.totalNodes = allNodes.length;
    networkReusable = false; // Force full rebuild
    // 全量加载完成：清除所有隐藏状态 + 未加载标记，同步图例为全部激活
    // Phase-68: 保留 memory 的隐藏状态
    hiddenTypes = { memory: true };
    clearUnloadedTypeLegends();
    syncLegendToggleState();
    log('全量数据: ' + allNodes.length + ' 节点, ' + allEdges.length + ' 边', true);
    renderStats(progressRes, graphRes);
    renderGraph();
    updateTieredIndicator();
    // Phase-159: 后台预加载文档列表数据，点击文档统计时零延迟
    if (typeof loadDocsData === 'function') setTimeout(function() { loadDocsData(); }, 100);
  }).catch(function(err) {
    log('数据获取失败: ' + err.message, false);
    document.getElementById('loading').innerHTML = '<div style="text-align:center"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><p style="color:#f87171;">数据加载失败: ' + err.message + '</p><button class="refresh-btn" onclick="loadData()" style="margin-top:12px;">重试</button></div>';
  });
}

/**
 * Phase-10 T10.1+T10.5: Load sub-tasks for a specific main-task (on demand).
 * Called when user double-clicks a main-task node to expand it.
 */
function loadSubTasksForPhase(phaseTaskId) {
  if (tieredLoadState.expandedPhases[phaseTaskId]) {
    // Already expanded → collapse (remove sub-task nodes)
    collapsePhaseSubTasks(phaseTaskId);
    return;
  }
  log('加载子任务: ' + phaseTaskId + '...', true);

  // Fetch sub-tasks: use full paged API with entity type filter
  var pagedUrl = '/api/graph/paged?offset=0&limit=2000' +
    '&entityTypes=' + TIER_L2_TYPES.concat(TIER_L3_TYPES).join(',');

  fetch(pagedUrl).then(function(r) { return r.json(); }).then(function(result) {
    var newNodes = result.nodes || [];
    var newEdges = result.edges || [];

    // Filter to only sub-tasks/docs connected to this phase
    var phaseNodeIds = {};
    phaseNodeIds[phaseTaskId] = true;
    // Find edges from this phase to sub-tasks
    var childIds = {};
    for (var i = 0; i < newEdges.length; i++) {
      if (newEdges[i].from === phaseTaskId) {
        childIds[newEdges[i].to] = true;
      }
    }
    // Also get docs linked to this phase
    for (var i = 0; i < newEdges.length; i++) {
      if (childIds[newEdges[i].from]) {
        childIds[newEdges[i].to] = true;
      }
    }

    var addedNodes = [];
    var addedEdges = [];
    var existingIds = {};
    for (var i = 0; i < allNodes.length; i++) existingIds[allNodes[i].id] = true;

    for (var i = 0; i < newNodes.length; i++) {
      var n = newNodes[i];
      if (childIds[n.id] && !existingIds[n.id]) {
        allNodes.push(n);
        addedNodes.push(n);
        existingIds[n.id] = true;
      }
    }
    for (var i = 0; i < newEdges.length; i++) {
      var e = newEdges[i];
      if (existingIds[e.from] && existingIds[e.to]) {
        // Check if edge already exists
        var edgeExists = false;
        for (var j = 0; j < allEdges.length; j++) {
          if (allEdges[j].from === e.from && allEdges[j].to === e.to) { edgeExists = true; break; }
        }
        if (!edgeExists) {
          allEdges.push(e);
          addedEdges.push(e);
        }
      }
    }

    tieredLoadState.expandedPhases[phaseTaskId] = true;
    log('已展开 ' + phaseTaskId + ': +' + addedNodes.length + ' 节点, +' + addedEdges.length + ' 边', true);

    // Phase-10 T10.3: Incremental update instead of full rebuild
    // Phase-74: 3D 引擎使用专用增量注入
    if (USE_3D && network && network._graph3d) {
      incremental3DAddNodes(addedNodes, addedEdges);
    } else if (networkReusable && nodesDataSet && edgesDataSet && network) {
      incrementalAddNodes(addedNodes, addedEdges);
    } else {
      renderGraph();
    }
    updateTieredIndicator();
  }).catch(function(err) {
    log('加载子任务失败: ' + err.message, false);
  });
}

/**
 * Phase-10 T10.5: Collapse sub-tasks of a phase (remove from graph).
 */
function collapsePhaseSubTasks(phaseTaskId) {
  var removeIds = {};
  // Find sub-task/document nodes that were added for this phase
  for (var i = 0; i < allEdges.length; i++) {
    if (allEdges[i].from === phaseTaskId) {
      var targetType = getNodeTypeById(allEdges[i].to);
      if (targetType === 'sub-task' || targetType === 'document') {
        removeIds[allEdges[i].to] = true;
      }
    }
  }
  // Also remove documents connected to removed sub-tasks
  for (var i = 0; i < allEdges.length; i++) {
    if (removeIds[allEdges[i].from]) {
      var targetType = getNodeTypeById(allEdges[i].to);
      if (targetType === 'document') {
        removeIds[allEdges[i].to] = true;
      }
    }
  }

  // Remove from allNodes/allEdges
  allNodes = allNodes.filter(function(n) { return !removeIds[n.id]; });
  allEdges = allEdges.filter(function(e) { return !removeIds[e.from] && !removeIds[e.to]; });

  delete tieredLoadState.expandedPhases[phaseTaskId];
  log('已收起 ' + phaseTaskId + ': 移除 ' + Object.keys(removeIds).length + ' 节点', true);

  // Phase-10 T10.3: Incremental remove
  // Phase-74: 3D 引擎使用专用增量移除
  if (USE_3D && network && network._graph3d) {
    incremental3DRemoveNodes(Object.keys(removeIds));
  } else if (networkReusable && nodesDataSet && edgesDataSet && network) {
    incrementalRemoveNodes(Object.keys(removeIds));
  } else {
    renderGraph();
  }
  updateTieredIndicator();
}

/** Phase-10: Helper to get node type by ID from allNodes */
function getNodeTypeById(nodeId) {
  for (var i = 0; i < allNodes.length; i++) {
    if (allNodes[i].id === nodeId) return allNodes[i].type;
  }
  return '';
}

/**
 * Phase-10 T10.3: Incrementally add styled nodes/edges to DataSet (no rebuild).
 */
function incrementalAddNodes(rawNodes, rawEdges) {
  if (!nodesDataSet || !edgesDataSet) return;
  var addedVisNodes = [];
  for (var i = 0; i < rawNodes.length; i++) {
    var n = rawNodes[i];
    if (hiddenTypes[n.type]) continue;
    var deg = getNodeDegree(n);
    var s = nodeStyle(n, deg);
    addedVisNodes.push({
      id: n.id, label: n.label, _origLabel: n.label,
      title: n.label + ' (连接: ' + deg + ')',
      shape: s.shape, size: s.size, color: s.color, font: s.font,
      borderWidth: s.borderWidth, _type: n.type,
      _props: n.properties || {},
    });
  }
  var addedVisEdges = [];
  var existingNodeIds = {};
  var currentIds = nodesDataSet.getIds();
  for (var i = 0; i < currentIds.length; i++) existingNodeIds[currentIds[i]] = true;
  for (var i = 0; i < addedVisNodes.length; i++) existingNodeIds[addedVisNodes[i].id] = true;

  for (var i = 0; i < rawEdges.length; i++) {
    var e = rawEdges[i];
    if (!existingNodeIds[e.from] || !existingNodeIds[e.to]) continue;
    var es = edgeStyle(e);
    addedVisEdges.push({
      id: 'e_inc_' + Date.now() + '_' + i, from: e.from, to: e.to,
      width: es.width, _origWidth: es.width,
      color: es.color, dashes: es.dashes, arrows: es.arrows,
      _label: e.label, _highlightColor: es._highlightColor || '#9ca3af',
    });
  }

  if (addedVisNodes.length > 0) nodesDataSet.add(addedVisNodes);
  if (addedVisEdges.length > 0) edgesDataSet.add(addedVisEdges);

  // Brief physics to settle new nodes, then stop
  if (network && addedVisNodes.length > 0) {
    network.setOptions({ physics: { enabled: true, stabilization: { enabled: false } } });
    setTimeout(function() {
      if (network) network.setOptions({ physics: { enabled: false } });
    }, 1500);
  }
  log('增量添加: +' + addedVisNodes.length + ' 节点, +' + addedVisEdges.length + ' 边', true);
}

/**
 * Phase-10 T10.3: Incrementally remove nodes/edges from DataSet (no rebuild).
 */
function incrementalRemoveNodes(nodeIds) {
  if (!nodesDataSet || !edgesDataSet) return;
  // Remove edges first
  var removeEdgeIds = [];
  var removeSet = {};
  for (var i = 0; i < nodeIds.length; i++) removeSet[nodeIds[i]] = true;
  edgesDataSet.forEach(function(edge) {
    if (removeSet[edge.from] || removeSet[edge.to]) {
      removeEdgeIds.push(edge.id);
    }
  });
  if (removeEdgeIds.length > 0) edgesDataSet.remove(removeEdgeIds);
  if (nodeIds.length > 0) nodesDataSet.remove(nodeIds);
  log('增量移除: -' + nodeIds.length + ' 节点, -' + removeEdgeIds.length + ' 边', true);
}

/**
 * Phase-10 T10.2+T10.1: Load all nodes (switch from tiered to full mode).
 */
function loadAllNodes() {
  var btn = document.getElementById('loadAllBtn');
  if (btn) btn.textContent = '加载中...';
  log('加载全部节点...', true);

  loadDataFull();
}

/** Phase-10: Update tiered loading indicator in the UI */
function updateTieredIndicator() {
  var indicator = document.getElementById('tieredIndicator');
  var loadAllBtn = document.getElementById('loadAllBtn');
  if (!indicator || !loadAllBtn) return;

  if (tieredLoadState.l0l1Loaded && !tieredLoadState.l2Loaded) {
    // Tiered mode active
    var expandedCount = Object.keys(tieredLoadState.expandedPhases).length;
    indicator.style.display = 'inline';
    indicator.textContent = '分层 ' + allNodes.length + '/' + tieredLoadState.totalNodes;
    if (expandedCount > 0) {
      indicator.textContent += ' (展开' + expandedCount + ')';
    }
    loadAllBtn.style.display = 'inline-flex';
    loadAllBtn.textContent = '全部';
  } else {
    indicator.style.display = 'none';
    loadAllBtn.style.display = 'none';
  }
}

/**
 * Phase-10 T10.2: Overview mode — show one super-node per entity type.
 * Uses /api/graph/clusters for aggregated data.
 */
var overviewModeActive = false;
var overviewSavedState = null; // { allNodes, allEdges, nodesDataSet, edgesDataSet }

function toggleOverviewMode() {
  var btn = document.getElementById('overviewBtn');
  if (overviewModeActive) {
    // Exit overview → restore saved state
    exitOverviewMode();
    if (btn) btn.textContent = '概览';
    if (btn) btn.style.color = '';
    return;
  }
  // Enter overview
  if (btn) btn.textContent = '退出概览';
  if (btn) btn.style.color = '#f59e0b';
  enterOverviewMode();
}

function enterOverviewMode() {
  log('概览模式: 获取聚合数据...', true);
  // Save current state
  overviewSavedState = { allNodes: allNodes, allEdges: allEdges };

  fetch('/api/graph/clusters').then(function(r) { return r.json(); }).then(function(data) {
    if (!data || !data.groups) {
      log('聚合数据为空, 保持当前视图', false);
      return;
    }

    overviewModeActive = true;

    // Build super-nodes: one per entity type group
    var groups = data.groups;
    var typeNames = { 'devplan-project': '项目', 'devplan-module': '模块', 'devplan-main-task': '主任务', 'devplan-sub-task': '子任务', 'devplan-document': '文档' };
    var typeColors = { 'devplan-project': '#f59e0b', 'devplan-module': '#ff6600', 'devplan-main-task': '#047857', 'devplan-sub-task': '#e8956a', 'devplan-document': '#2563eb' };
    var typeShapes = { 'devplan-project': 'star', 'devplan-module': 'diamond', 'devplan-main-task': 'dot', 'devplan-sub-task': 'dot', 'devplan-document': 'box' };

    var overviewNodes = [];
    var typeIds = Object.keys(groups);
    for (var i = 0; i < typeIds.length; i++) {
      var typeId = typeIds[i];
      var g = groups[typeId];
      var count = g.count || 0;
      if (count === 0) continue;
      var displayName = typeNames[typeId] || typeId;
      var color = typeColors[typeId] || '#6b7280';
      overviewNodes.push({
        id: 'overview_' + typeId,
        label: displayName + '\\n(' + count + ')',
        _origLabel: displayName,
        title: displayName + ': ' + count + ' 个节点\\n点击展开此类型',
        shape: typeShapes[typeId] || 'dot',
        size: Math.min(20 + Math.sqrt(count) * 3, 60),
        color: { background: color, border: color, highlight: { background: color, border: '#fff' } },
        font: { size: 14, color: '#e5e7eb' },
        borderWidth: 3,
        _type: typeId,
        _props: { status: 'active', count: count, sampleIds: g.sample_ids || [] },
      });
    }

    // Edges: connect project to modules, modules to main-tasks, etc.
    var overviewEdges = [];
    var edgeIdx = 0;
    if (groups['devplan-project'] && groups['devplan-module']) {
      overviewEdges.push({ id: 'oe' + (edgeIdx++), from: 'overview_devplan-project', to: 'overview_devplan-module', width: 2, color: { color: '#4b5563' }, arrows: { to: { enabled: true, scaleFactor: 0.5 } } });
    }
    if (groups['devplan-module'] && groups['devplan-main-task']) {
      overviewEdges.push({ id: 'oe' + (edgeIdx++), from: 'overview_devplan-module', to: 'overview_devplan-main-task', width: 2, color: { color: '#4b5563' }, arrows: { to: { enabled: true, scaleFactor: 0.5 } } });
    }
    if (groups['devplan-main-task'] && groups['devplan-sub-task']) {
      overviewEdges.push({ id: 'oe' + (edgeIdx++), from: 'overview_devplan-main-task', to: 'overview_devplan-sub-task', width: 1.5, color: { color: '#4b5563' }, arrows: { to: { enabled: true, scaleFactor: 0.4 } } });
    }
    if (groups['devplan-main-task'] && groups['devplan-document']) {
      overviewEdges.push({ id: 'oe' + (edgeIdx++), from: 'overview_devplan-main-task', to: 'overview_devplan-document', width: 1, color: { color: '#4b5563' }, dashes: [5, 5], arrows: { to: { enabled: true, scaleFactor: 0.4 } } });
    }

    log('概览模式: ' + overviewNodes.length + ' 类型节点', true);

    // Replace the current graph
    allNodes = [];
    allEdges = [];
    if (nodesDataSet) {
      var allIds = nodesDataSet.getIds();
      if (allIds.length > 0) nodesDataSet.remove(allIds);
      nodesDataSet.add(overviewNodes);
    }
    if (edgesDataSet) {
      var allEIds = edgesDataSet.getIds();
      if (allEIds.length > 0) edgesDataSet.remove(allEIds);
      edgesDataSet.add(overviewEdges);
    }

    // Brief physics to arrange
    if (network) {
      network.setOptions({
        physics: { enabled: true, solver: 'forceAtlas2Based',
          forceAtlas2Based: { gravitationalConstant: -50, centralGravity: 0.05, springLength: 200, springConstant: 0.08, damping: 0.5 },
          stabilization: { enabled: true, iterations: 50, updateInterval: 10 }
        }
      });
    }
  }).catch(function(err) {
    log('概览模式失败: ' + err.message, false);
    overviewModeActive = false;
    var btn = document.getElementById('overviewBtn');
    if (btn) { btn.textContent = '概览'; btn.style.color = ''; }
  });
}

function exitOverviewMode() {
  overviewModeActive = false;
  if (overviewSavedState) {
    allNodes = overviewSavedState.allNodes;
    allEdges = overviewSavedState.allEdges;
    overviewSavedState = null;
  }
  // Force full rebuild to restore normal view
  networkReusable = false;
  renderGraph();
  updateTieredIndicator();
  log('已退出概览模式', true);
}

/**
 * Phase-8C T8C.3+T8C.4: Chunked progressive rendering for large datasets.
 * Renders the first CHUNK_SIZE nodes immediately, then loads remaining chunks
 * in the background using addNodes/addEdges incremental API.
 */
function renderGraphChunked() {
  try {
    var container = document.getElementById('graph');
    var rect = container.getBoundingClientRect();
    if (rect.height < 50) {
      container.style.height = (window.innerHeight - 140) + 'px';
    }

    // Sort nodes: center-priority (closest to centroid first)
    var cx = 0, cy = 0;
    for (var i = 0; i < allNodes.length; i++) {
      cx += (allNodes[i].x || 0);
      cy += (allNodes[i].y || 0);
    }
    if (allNodes.length > 0) { cx /= allNodes.length; cy /= allNodes.length; }
    var sortedNodes = allNodes.slice().sort(function(a, b) {
      var da = Math.pow(((a.x||0) - cx), 2) + Math.pow(((a.y||0) - cy), 2);
      var db = Math.pow(((b.x||0) - cx), 2) + Math.pow(((b.y||0) - cy), 2);
      return da - db;
    });

    // First chunk
    var firstChunkNodes = sortedNodes.slice(0, CHUNK_SIZE);
    var firstChunkIds = {};
    for (var i = 0; i < firstChunkNodes.length; i++) firstChunkIds[firstChunkNodes[i].id] = true;
    var firstChunkEdges = [];
    for (var i = 0; i < allEdges.length; i++) {
      if (firstChunkIds[allEdges[i].from] && firstChunkIds[allEdges[i].to]) {
        firstChunkEdges.push(allEdges[i]);
      }
    }

    // Prepare first chunk visible nodes/edges (same transform as renderGraph)
    var visibleNodes = [];
    for (var i = 0; i < firstChunkNodes.length; i++) {
      var n = firstChunkNodes[i];
      if (hiddenTypes[n.type]) continue;
      if (isNodeCollapsedByParent(n.id)) continue;
      var deg = getNodeDegree(n);
      var s = nodeStyle(n, deg);
      visibleNodes.push({
        id: n.id, label: n.label, _origLabel: n.label,
        title: n.label + ' (连接: ' + deg + ')',
        shape: s.shape, size: s.size, color: s.color, font: s.font,
        borderWidth: s.borderWidth, _type: n.type,
        _props: n.properties || {}, _isParentDoc: isParentDocNode(n),
      });
    }
    var visibleIds = {};
    var _chunkProjectIds = {};
    for (var i = 0; i < visibleNodes.length; i++) {
      visibleIds[visibleNodes[i].id] = true;
      if (visibleNodes[i]._type === 'project') _chunkProjectIds[visibleNodes[i].id] = true;
    }
    var _chunkGraphSettings = getGraphSettings();
    var _chunkHideProjectEdges = !_chunkGraphSettings.showProjectEdges;
    var visibleEdges = [];
    for (var i = 0; i < firstChunkEdges.length; i++) {
      var e = firstChunkEdges[i];
      if (!visibleIds[e.from] || !visibleIds[e.to]) continue;
      var _chunkIsProjectEdge = _chunkHideProjectEdges && (_chunkProjectIds[e.from] || _chunkProjectIds[e.to]);
      var es = edgeStyle(e);
      visibleEdges.push({
        id: 'e' + i, from: e.from, to: e.to,
        width: es.width, _origWidth: es.width,
        color: es.color, dashes: es.dashes, arrows: es.arrows,
        _label: e.label, _highlightColor: es._highlightColor || '#9ca3af',
        _projectEdgeHidden: !!_chunkIsProjectEdge, hidden: !!_chunkIsProjectEdge,
      });
    }

    log('分块加载: 首批 ' + visibleNodes.length + '/' + allNodes.length + ' 节点', true);

    if (network) { network.destroy(); network = null; }

    // Create network with first chunk
    nodesDataSet = new SimpleDataSet(visibleNodes);
    edgesDataSet = new SimpleDataSet(visibleEdges);

    var networkOptions = {
      nodes: { borderWidth: 2, shadow: { enabled: true, color: 'rgba(0,0,0,0.3)', size: 5, x: 0, y: 2 } },
      edges: { smooth: { enabled: true, type: 'continuous', roundness: 0.5 }, shadow: false },
      physics: { enabled: true, solver: 'forceAtlas2Based',
        forceAtlas2Based: { gravitationalConstant: -80, centralGravity: 0.015, springLength: 150, springConstant: 0.05, damping: 0.4, avoidOverlap: 0.8 },
        stabilization: { enabled: true, iterations: 200, updateInterval: 25 }
      },
      interaction: { hover: true, tooltipDelay: 100, navigationButtons: false, keyboard: false, zoomView: true, dragView: true },
      layout: { improvedLayout: false, hierarchical: false }
    };

    network = new DevPlanGraph(container, { nodes: visibleNodes, edges: visibleEdges }, networkOptions);

    // Show loading indicator with progress
    document.getElementById('loading').style.display = 'none';
    log('首批数据已渲染，后台加载剩余 ' + (sortedNodes.length - CHUNK_SIZE) + ' 节点...', true);

    // ── Progressive background loading ──
    var loadedNodeIds = Object.assign({}, firstChunkIds);
    var chunkIndex = 1;
    var totalChunks = Math.ceil(sortedNodes.length / CHUNK_SIZE);

    function loadNextChunk() {
      var start = chunkIndex * CHUNK_SIZE;
      var end = Math.min(start + CHUNK_SIZE, sortedNodes.length);
      if (start >= sortedNodes.length) {
        log('✅ 全部数据加载完成: ' + allNodes.length + ' 节点, ' + allEdges.length + ' 边', true);
        return;
      }

      var chunkNodes = [];
      for (var i = start; i < end; i++) {
        var n = sortedNodes[i];
        if (hiddenTypes[n.type]) continue;
        if (isNodeCollapsedByParent(n.id)) continue;
        var deg = getNodeDegree(n);
        var s = nodeStyle(n, deg);
        chunkNodes.push({
          id: n.id, label: n.label, _origLabel: n.label,
          title: n.label, shape: s.shape, size: s.size,
          color: s.color, font: s.font, borderWidth: s.borderWidth,
          _type: n.type, _props: n.properties || {},
          x: n.x || 0, y: n.y || 0,
        });
        loadedNodeIds[n.id] = true;
        if (n.type === 'project') _chunkProjectIds[n.id] = true;
      }

      // Edges for this chunk (both endpoints must be loaded)
      var chunkEdges = [];
      for (var i = 0; i < allEdges.length; i++) {
        var e = allEdges[i];
        if (loadedNodeIds[e.from] && loadedNodeIds[e.to]) {
          var _chkIsProjectEdge = _chunkHideProjectEdges && (_chunkProjectIds[e.from] || _chunkProjectIds[e.to]);
          var es = edgeStyle(e);
          chunkEdges.push({
            id: 'ec' + chunkIndex + '_' + i, from: e.from, to: e.to,
            width: es.width, _origWidth: es.width,
            color: es.color, dashes: es.dashes, arrows: es.arrows,
            _label: e.label, _highlightColor: es._highlightColor || '#9ca3af',
            _projectEdgeHidden: !!_chkIsProjectEdge, hidden: !!_chkIsProjectEdge,
          });
        }
      }

      // Use incremental API (Phase-8C T8C.5)
      if (network && network._gc) {
        network._gc.addNodes(chunkNodes);
        network._gc.addEdges(chunkEdges);
      }

      chunkIndex++;
      var pct = Math.min(100, Math.round(chunkIndex / totalChunks * 100));
      log('加载进度: ' + pct + '% (' + (chunkIndex * CHUNK_SIZE) + '/' + sortedNodes.length + ')', true);

      // Schedule next chunk (yield to main thread for rendering)
      if (chunkIndex < totalChunks) {
        setTimeout(loadNextChunk, 50);
      } else {
        log('✅ 全部数据加载完成: ' + Object.keys(loadedNodeIds).length + ' 节点', true);
      }
    }

    // Start loading remaining chunks after first render stabilizes
    network.on('stabilizationIterationsDone', function() {
      network.setOptions({ physics: { enabled: false } });
      log('首批渲染稳定，开始后台增量加载...', true);
      setTimeout(loadNextChunk, 100);
    });

    // Wire up click handler (same as renderGraph)
    network.on('click', function(params) {
      if (params.pointer && params.pointer.canvas) {
        var hitNodeId = hitTestDocToggleBtn(params.pointer.canvas.x, params.pointer.canvas.y);
        if (hitNodeId) { toggleDocNodeExpand(hitNodeId); return; }
      }
      if (params.nodes.length > 0) {
        panelHistory = [];
        currentPanelNodeId = null;
        highlightConnectedEdges(params.nodes[0]);
        showPanel(params.nodes[0]);
      } else {
        resetAllEdgeColors();
        closePanel();
      }
    });

  } catch (e) {
    log('分块渲染失败: ' + e.message, false);
    log('回退到标准渲染模式', true);
    renderGraph();
  }
}

function renderStats(progress, graph) {
  var bar = document.getElementById('statsBar');
  var pct = progress.overallPercent || 0;
  // 优先使用 /api/progress 返回的真实计数（分层加载时 graph.nodes 不含全部类型）
  var moduleCount = progress.moduleCount;
  var docCount = progress.docCount;
  if (moduleCount == null || docCount == null) {
    moduleCount = moduleCount || 0;
    docCount = docCount || 0;
    for (var i = 0; i < (graph.nodes || []).length; i++) {
    if (graph.nodes[i].type === 'module') moduleCount++;
    if (graph.nodes[i].type === 'document') docCount++;
    }
  }
  var promptCount = progress.promptCount || 0;
  bar.innerHTML =
    '<div class="stat clickable" onclick="showStatsModal(\\x27module\\x27)" title="查看所有模块"><span class="num amber">' + moduleCount + '</span> 模块</div>' +
    '<div class="stat clickable" onclick="showStatsModal(\\x27main-task\\x27)" title="查看所有主任务"><span class="num blue">' + progress.mainTaskCount + '</span> 主任务</div>' +
    '<div class="stat clickable" onclick="showStatsModal(\\x27sub-task\\x27)" title="查看所有子任务"><span class="num purple">' + progress.subTaskCount + '</span> 子任务</div>' +
    '<div class="stat clickable" onclick="showStatsModal(\\x27document\\x27)" title="查看所有文档"><span class="num" style="color:#3b82f6;">📄 ' + docCount + '</span> 文档</div>' +
    '<div class="stat clickable" onclick="showPromptModal()" title="查看所有 Prompt"><span class="num" style="color:#ec4899;">💬 ' + promptCount + '</span> Prompt</div>' +
    '<div class="stat"><span class="num green">' + progress.completedSubTasks + '/' + progress.subTaskCount + '</span> 已完成</div>' +
    '<div class="stat"><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div><span>' + pct + '%</span></div>';
}

`;
}
