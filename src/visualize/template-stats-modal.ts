/**
 * DevPlan 图可视化 — 统计弹层与刷新模块
 *
 * 包含: 统计弹层 (打开/关闭/渲染)、手动刷新 (F5/按钮)。
 */

export function getStatsModalScript(): string {
  return `
// ========== Stats Modal ==========
/** 记录文档弹层中各文档的折叠状态（docKey → true 表示已展开） */
var docModalExpandedState = {};

function showStatsModal(nodeType) {
  // 文档类型使用专用渲染
  if (nodeType === 'document') {
    showDocModal();
    return;
  }

  var titleMap = { 'module': '功能模块', 'main-task': '主任务', 'sub-task': '子任务' };
  var iconMap = { 'module': '◆', 'main-task': '●', 'sub-task': '·' };
  var items = [];
  for (var i = 0; i < allNodes.length; i++) {
    if (allNodes[i].type === nodeType) items.push(allNodes[i]);
  }
  // 排序：进行中 > 待开始 > 已完成 > 已取消
  var statusOrder = { in_progress: 0, pending: 1, completed: 2, cancelled: 3, active: 1 };
  items.sort(function(a, b) {
    var sa = (a.properties || {}).status || 'pending';
    var sb = (b.properties || {}).status || 'pending';
    return (statusOrder[sa] !== undefined ? statusOrder[sa] : 5) - (statusOrder[sb] !== undefined ? statusOrder[sb] : 5);
  });

  document.getElementById('statsModalTitle').textContent = titleMap[nodeType] || nodeType;
  document.getElementById('statsModalCount').textContent = '(' + items.length + ')';

  var html = '';
  for (var i = 0; i < items.length; i++) {
    var n = items[i];
    var p = n.properties || {};
    var st = p.status || (nodeType === 'module' ? 'active' : 'pending');
    var icon = iconMap[nodeType] || '●';
    html += '<div class="stats-modal-item" onclick="statsModalGoToNode(\\x27' + n.id + '\\x27)">';
    html += '<span class="stats-modal-item-icon">' + icon + '</span>';
    html += '<span class="stats-modal-item-name" title="' + escHtml(n.label) + '">' + escHtml(n.label) + '</span>';
    if (nodeType === 'main-task') {
      var subCount = 0; var subDone = 0;
      for (var j = 0; j < allNodes.length; j++) {
        if (allNodes[j].type === 'sub-task' && (allNodes[j].properties || {}).parentTaskId === p.taskId) {
          subCount++;
          if ((allNodes[j].properties || {}).status === 'completed') subDone++;
        }
      }
      if (subCount > 0) {
        html += '<span class="stats-modal-item-sub">' + subDone + '/' + subCount + '</span>';
      }
    }
    if (nodeType === 'module' && p.mainTaskCount !== undefined) {
      html += '<span class="stats-modal-item-sub">' + p.mainTaskCount + ' 任务</span>';
    }
    html += '<span class="stats-modal-item-badge ' + st + '">' + statusText(st) + '</span>';
    html += '</div>';
  }
  if (items.length === 0) {
    html = '<div style="text-align:center;padding:40px;color:#6b7280;">暂无数据</div>';
  }
  document.getElementById('statsModalBody').innerHTML = html;
  // 根据侧边栏状态调整弹层位置
  updateStatsModalPosition();
  document.getElementById('statsModalOverlay').classList.add('active');
}

/** 获取文档节点的 docKey (section|subSection) */
function getDocNodeKey(node) {
  var p = node.properties || {};
  return p.section + (p.subSection ? '|' + p.subSection : '');
}

/** 构建文档层级树：{ node, children: [...] } */
function buildDocTree() {
  var docNodes = [];
  for (var i = 0; i < allNodes.length; i++) {
    if (allNodes[i].type === 'document') docNodes.push(allNodes[i]);
  }

  // 建立 parentDoc → children 映射
  var childrenMap = {};  // parentDocKey → [nodes]
  var childKeySet = {};  // 属于子文档的 nodeId 集合
  for (var i = 0; i < docNodes.length; i++) {
    var p = docNodes[i].properties || {};
    if (p.parentDoc) {
      if (!childrenMap[p.parentDoc]) childrenMap[p.parentDoc] = [];
      childrenMap[p.parentDoc].push(docNodes[i]);
      childKeySet[docNodes[i].id] = true;
    }
  }

  // 按 section 分组顶级文档
  var groups = {};
  var groupOrder = [];
  for (var i = 0; i < docNodes.length; i++) {
    if (childKeySet[docNodes[i].id]) continue;
    var sec = (docNodes[i].properties || {}).section || 'custom';
    if (!groups[sec]) { groups[sec] = []; groupOrder.push(sec); }
    groups[sec].push(docNodes[i]);
  }

  return { groups: groups, groupOrder: groupOrder, childrenMap: childrenMap };
}

/** 显示文档弹层（左侧列表） */
function showDocModal() {
  var docNodes = [];
  for (var i = 0; i < allNodes.length; i++) {
    if (allNodes[i].type === 'document') docNodes.push(allNodes[i]);
  }

  document.getElementById('statsModalTitle').textContent = '📄 文档列表';
  document.getElementById('statsModalCount').textContent = '(' + docNodes.length + ')';

  var tree = buildDocTree();
  var html = renderDocTreeHTML(tree);

  if (docNodes.length === 0) {
    html = '<div style="text-align:center;padding:40px;color:#6b7280;">暂无文档</div>';
  }

  document.getElementById('statsModalBody').innerHTML = html;
  // 根据侧边栏状态调整弹层位置
  updateStatsModalPosition();
  document.getElementById('statsModalOverlay').classList.add('active');
}

/** 渲染文档层级树 HTML */
function renderDocTreeHTML(tree) {
  var SECTION_NAMES_MODAL = {
    overview: '概述', core_concepts: '核心概念', api_design: 'API 设计',
    file_structure: '文件结构', config: '配置', examples: '使用示例',
    technical_notes: '技术笔记', api_endpoints: 'API 端点',
    milestones: '里程碑', changelog: '变更记录', custom: '自定义'
  };
  var SECTION_ICONS_MODAL = {
    overview: '▸', core_concepts: '▸', api_design: '▸',
    file_structure: '▸', config: '▸', examples: '▸',
    technical_notes: '▸', api_endpoints: '▸',
    milestones: '▸', changelog: '▸', custom: '▸'
  };

  var html = '';
  for (var gi = 0; gi < tree.groupOrder.length; gi++) {
    var sec = tree.groupOrder[gi];
    var items = tree.groups[sec];
    var secName = SECTION_NAMES_MODAL[sec] || sec;
    var secIcon = SECTION_ICONS_MODAL[sec] || '▸';

    html += '<div style="margin-bottom:4px;">';
    html += '<div style="padding:8px 20px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;display:flex;align-items:center;gap:6px;">';
    html += '<span>' + secName + '</span>';
    html += '<span style="margin-left:auto;font-size:10px;color:#4b5563;">' + items.length + '</span>';
    html += '</div>';

    for (var ii = 0; ii < items.length; ii++) {
      html += renderDocTreeItem(items[ii], tree.childrenMap, 0);
    }
    html += '</div>';
  }
  return html;
}

/** 递归渲染单个文档节点及其子文档 */
function renderDocTreeItem(node, childrenMap, depth) {
  var docKey = getDocNodeKey(node);
  var p = node.properties || {};
  var children = childrenMap[docKey] || [];
  var hasChildren = children.length > 0;
  var isExpanded = docModalExpandedState[docKey] === true;
  var paddingLeft = 20 + depth * 20;

  var html = '';

  // 文档项
  html += '<div class="stats-modal-item" style="padding-left:' + paddingLeft + 'px;gap:6px;" onclick="docModalSelectDoc(\\x27' + escHtml(docKey).replace(/'/g, "\\\\'") + '\\x27,\\x27' + escHtml(node.id).replace(/'/g, "\\\\'") + '\\x27)">';

  // 展开/折叠按钮
  if (hasChildren) {
    html += '<span class="doc-modal-toggle" onclick="event.stopPropagation();toggleDocModalExpand(\\x27' + escHtml(docKey).replace(/'/g, "\\\\'") + '\\x27)" style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#818cf8;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;transition:all 0.15s;line-height:1;">' + (isExpanded ? '−' : '+') + '</span>';
  } else {
    html += '<span style="width:18px;flex-shrink:0;"></span>';
  }

  html += '<span class="stats-modal-item-icon" style="font-size:13px;color:#6b7280;">▸</span>';
  html += '<span class="stats-modal-item-name" title="' + escHtml(node.label) + '" style="font-size:' + (depth > 0 ? '12' : '13') + 'px;' + (depth > 0 ? 'opacity:0.85;' : '') + '">' + escHtml(node.label) + '</span>';

  if (hasChildren) {
    html += '<span style="font-size:10px;color:#818cf8;flex-shrink:0;">' + children.length + '</span>';
  }
  if (p.subSection) {
    html += '<span style="font-size:10px;color:#6b7280;flex-shrink:0;font-family:monospace;">' + escHtml(p.subSection) + '</span>';
  }

  html += '</div>';

  // 子文档列表（仅展开时显示）
  if (hasChildren && isExpanded) {
    for (var ci = 0; ci < children.length; ci++) {
      html += renderDocTreeItem(children[ci], childrenMap, depth + 1);
    }
  }

  return html;
}

/** 展开/折叠文档弹层中的子文档 */
function toggleDocModalExpand(docKey) {
  docModalExpandedState[docKey] = !docModalExpandedState[docKey];
  // 重新渲染文档列表
  var tree = buildDocTree();
  var html = renderDocTreeHTML(tree);
  document.getElementById('statsModalBody').innerHTML = html;
}

/** 在文档弹层中选中文档 — 复用右侧图谱详情面板显示内容 */
function docModalSelectDoc(docKey, nodeId) {
  // 直接复用 statsModalGoToNode，聚焦图谱节点并打开已有的右侧详情面板
  statsModalGoToNode(nodeId);
}

function closeStatsModal() {
  document.getElementById('statsModalOverlay').classList.remove('active');
}

function statsModalGoToNode(nodeId) {
  // 兼容所有引擎: 优先 nodesDataSet，fallback 到 getNodeById (3D 等引擎)
  var nodeExists = (nodesDataSet && nodesDataSet.get(nodeId)) || getNodeById(nodeId);
  if (network && nodeExists) {
    if (typeof network.selectNodes === 'function') {
      network.selectNodes([nodeId]);
    }
    highlightConnectedEdges(nodeId);
    // 3D 模式下不触发摄像机聚焦 — 摄像机效果仅在画布双击节点时激发
    if (!USE_3D && typeof network.focus === 'function') {
      network.focus(nodeId, { scale: 1.2, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
    }
    panelHistory = [];
    currentPanelNodeId = null;
    showPanel(nodeId);
  }
}


// ========== Manual Refresh ==========
var _refreshing = false;

/** 手动刷新：点击刷新按钮或按 F5 时触发（带旋转动画反馈） */
function manualRefresh() {
  if (_refreshing) return;
  _refreshing = true;
  var btn = document.getElementById('legendRefreshBtn');
  if (btn) btn.classList.add('refreshing');
  log('手动刷新: 获取最新数据...', true);
  silentRefresh(function() {
    _refreshing = false;
    if (btn) btn.classList.remove('refreshing');
  });
}

/** 静默刷新：只更新数据，不重建图谱（避免布局跳动）。onDone 回调在请求完成后触发。 */
function silentRefresh(onDone) {
  // Phase-10: If in tiered mode, refresh only what's loaded
  var graphApiUrl;
  if (!USE_3D && tieredLoadState.l0l1Loaded && !tieredLoadState.l2Loaded) {
    // Only refresh L0+L1 nodes (tiered mode — not all loaded yet)
    var loadedTypes = TIER_L0L1_TYPES.slice();
    // Add types for expanded phases
    if (Object.keys(tieredLoadState.expandedPhases).length > 0) {
      loadedTypes = loadedTypes.concat(TIER_L2_TYPES).concat(TIER_L3_TYPES);
    }
    graphApiUrl = '/api/graph/paged?offset=0&limit=5000&entityTypes=' + loadedTypes.join(',');
  } else {
    graphApiUrl = '/api/graph?includeNodeDegree=' + (INCLUDE_NODE_DEGREE ? 'true' : 'false') +
    '&enableBackendDegreeFallback=' + (ENABLE_BACKEND_DEGREE_FALLBACK ? 'true' : 'false');
  }
  Promise.all([
    fetch(graphApiUrl).then(function(r) { return r.json(); }),
    fetch('/api/progress').then(function(r) { return r.json(); })
  ]).then(function(results) {
    var graphRes = results[0];
    var progressRes = results[1];
    var newNodes = graphRes.nodes || [];
    var newEdges = graphRes.edges || [];

    // 检查数据是否有变化（通过节点数量和状态快照比较）
    var changed = false;
    if (newNodes.length !== allNodes.length || newEdges.length !== allEdges.length) {
      changed = true;
    } else {
      // 比较每个节点的状态
      var oldStatusMap = {};
      for (var i = 0; i < allNodes.length; i++) {
        var n = allNodes[i];
        oldStatusMap[n.id] = (n.properties || {}).status || '';
      }
      for (var i = 0; i < newNodes.length; i++) {
        var n = newNodes[i];
        var oldStatus = oldStatusMap[n.id];
        var newStatus = (n.properties || {}).status || '';
        if (oldStatus !== newStatus) {
          changed = true;
          break;
        }
      }
    }

    if (changed) {
      log('检测到数据变化, 更新图谱...', true);
      allNodes = newNodes;
      allEdges = newEdges;
      renderStats(progressRes, graphRes);
      // 仅更新节点样式而非重建整个图谱，以保持当前布局
      if (nodesDataSet && network) {
        updateNodeStyles();
      } else {
        renderGraph();
      }
    } else {
      log('数据无变化 (' + new Date().toLocaleTimeString() + ')', true);
    }
    if (typeof onDone === 'function') onDone();
  }).catch(function(err) {
    log('刷新失败: ' + err.message, false);
    if (typeof onDone === 'function') onDone();
  });
}

/** 增量更新节点样式（不重建布局） */
function updateNodeStyles() {
  try {
    // 构建当前可见节点的 ID 和新数据映射
    var newNodeMap = {};
    for (var i = 0; i < allNodes.length; i++) {
      newNodeMap[allNodes[i].id] = allNodes[i];
    }

    // 更新已有节点的样式和大小
    var currentIds = nodesDataSet.getIds();
    for (var i = 0; i < currentIds.length; i++) {
      var id = currentIds[i];
      var newData = newNodeMap[id];
      if (newData && !hiddenTypes[newData.type]) {
        var deg = getNodeDegree(newData);
        var s = nodeStyle(newData, deg);
        nodesDataSet.update({
          id: id,
          label: newData.label,
          size: s.size,
          color: s.color,
          font: s.font,
          _props: newData.properties || {}
        });
      }
    }

    // 处理新增/删除的节点 — 如果有结构变化，完整重建
    var visibleNewNodes = allNodes.filter(function(n) { return !hiddenTypes[n.type]; });
    if (visibleNewNodes.length !== currentIds.length) {
      renderGraph();
    }

    // 增量更新后重新检查呼吸灯
    var updatedInProg = getInProgressMainTaskIds();
    if (updatedInProg.length > 0 && !breathAnimId) {
      startBreathAnimation();
    } else if (updatedInProg.length === 0 && breathAnimId) {
      stopBreathAnimation();
    }

    log('节点样式已更新 (' + new Date().toLocaleTimeString() + ')', true);
  } catch (err) {
    log('增量更新失败, 完整重建: ' + err.message, false);
    renderGraph();
  }
}

`;
}
