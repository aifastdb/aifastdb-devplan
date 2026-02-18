/**
 * DevPlan 图可视化 — vis-network 渲染模块
 *
 * 包含: 边高亮、文档节点展开/收起、呼吸灯动画、节点样式、
 * 节点动态大小、vis-network 图渲染、节点类型筛选。
 */

export function getGraphVisScript(): string {
  return `
// ========== 边高亮：选中节点时关联边变色，取消选中时恢复灰色 ==========
function highlightConnectedEdges(nodeId) {
  if (!edgesDataSet || !network) return;
  var connectedEdgeIds = network.getConnectedEdges(nodeId);
  var connectedSet = {};
  for (var i = 0; i < connectedEdgeIds.length; i++) connectedSet[connectedEdgeIds[i]] = true;
  var updates = [];
  edgesDataSet.forEach(function(edge) {
    if (connectedSet[edge.id]) {
      // 关联边 → 使用高亮色
      updates.push({ id: edge.id, color: { color: edge._highlightColor || '#9ca3af', highlight: edge._highlightColor || '#9ca3af', hover: edge._highlightColor || '#9ca3af' }, width: (edge._origWidth || 1) < 2 ? 2 : (edge._origWidth || edge.width || 1) });
    } else {
      // 非关联边 → 变淡
      updates.push({ id: edge.id, color: { color: 'rgba(75,85,99,0.15)', highlight: edge._highlightColor || '#9ca3af', hover: edge._highlightColor || '#9ca3af' }, width: edge._origWidth || edge.width || 1 });
    }
  });
  edgesDataSet.update(updates);
}

function resetAllEdgeColors() {
  if (!edgesDataSet) return;
  var updates = [];
  edgesDataSet.forEach(function(edge) {
    updates.push({ id: edge.id, color: { color: EDGE_GRAY, highlight: edge._highlightColor || '#9ca3af', hover: edge._highlightColor || '#9ca3af' }, width: edge._origWidth || edge.width || 1 });
  });
  edgesDataSet.update(updates);
}


// ========== 文档节点展开/收起 ==========
/** 记录哪些父文档节点处于收起状态（nodeId → true 表示收起） */
var collapsedDocNodes = {};
/** 收起时被重定向的边信息: { edgeId: { origFrom, origTo } } */
var redirectedEdges = {};
/** 记录各父文档 +/- 按钮在 canvas 坐标系中的位置，用于点击检测 */
var docToggleBtnPositions = {};
/** 收起前保存子文档节点的位置: { nodeId: { x, y } } */
var savedChildPositions = {};

/** 获取节点 ID 对应的子文档节点 ID 列表（仅直接子文档） */
function getChildDocNodeIds(parentNodeId) {
  var childIds = [];
  for (var i = 0; i < allEdges.length; i++) {
    if (allEdges[i].from === parentNodeId && allEdges[i].label === 'doc_has_child') {
      childIds.push(allEdges[i].to);
    }
  }
  return childIds;
}

/** 递归获取所有后代文档节点 ID（含多层子文档） */
function getAllDescendantDocNodeIds(parentNodeId) {
  var result = [];
  var queue = [parentNodeId];
  while (queue.length > 0) {
    var current = queue.shift();
    var children = getChildDocNodeIds(current);
    for (var i = 0; i < children.length; i++) {
      result.push(children[i]);
      queue.push(children[i]);
    }
  }
  return result;
}

/** 检查节点是否为父文档（有子文档的文档节点） */
function isParentDocNode(node) {
  if (node.type !== 'document') return false;
  var props = node.properties || {};
  var childDocs = props.childDocs || [];
  if (childDocs.length > 0) return true;
  for (var i = 0; i < allEdges.length; i++) {
    if (allEdges[i].from === node.id && allEdges[i].label === 'doc_has_child') return true;
  }
  return false;
}

/** 通过 nodeId 在 allNodes 中查找节点数据 */
function findAllNode(nodeId) {
  for (var i = 0; i < allNodes.length; i++) {
    if (allNodes[i].id === nodeId) return allNodes[i];
  }
  return null;
}

/** 检查节点是否应被隐藏（因为其祖先父文档处于收起状态） */
function isNodeCollapsedByParent(nodeId) {
  for (var i = 0; i < allEdges.length; i++) {
    var e = allEdges[i];
    if (e.to === nodeId && e.label === 'doc_has_child') {
      if (collapsedDocNodes[e.from]) return true;
      if (isNodeCollapsedByParent(e.from)) return true;
    }
  }
  return false;
}

/** 切换父文档节点的展开/收起状态 */
function toggleDocNodeExpand(nodeId) {
  collapsedDocNodes[nodeId] = !collapsedDocNodes[nodeId];
  var childIds = getAllDescendantDocNodeIds(nodeId);
  var isCollapsed = collapsedDocNodes[nodeId];

  if (isCollapsed) {
    // ---- 收起 ----
    var removeNodeIds = {};
    for (var i = 0; i < childIds.length; i++) removeNodeIds[childIds[i]] = true;

    // 0) 保存子文档节点当前位置
    var childPositions = network.getPositions(childIds);
    for (var i = 0; i < childIds.length; i++) {
      if (childPositions[childIds[i]]) {
        savedChildPositions[childIds[i]] = { x: childPositions[childIds[i]].x, y: childPositions[childIds[i]].y };
      }
    }

    // 1) 将连接到子文档的非 doc_has_child 边重定向到父文档
    var edgesToRedirect = [];
    var edgesToRemove = [];
    edgesDataSet.forEach(function(edge) {
      var touchesChild = removeNodeIds[edge.from] || removeNodeIds[edge.to];
      if (!touchesChild) return;
      if (edge._label === 'doc_has_child') {
        // doc_has_child 边直接移除
        edgesToRemove.push(edge.id);
      } else {
        // 其他边（如 task_has_doc）重定向到父文档
        edgesToRedirect.push(edge);
      }
    });

    // 移除 doc_has_child 边
    if (edgesToRemove.length > 0) edgesDataSet.remove(edgesToRemove);

    // 重定向其他边到父文档
    for (var i = 0; i < edgesToRedirect.length; i++) {
      var edge = edgesToRedirect[i];
      var newFrom = removeNodeIds[edge.from] ? nodeId : edge.from;
      var newTo = removeNodeIds[edge.to] ? nodeId : edge.to;
      // 检查是否已存在相同的重定向边（避免重复）
      var duplicate = false;
      edgesDataSet.forEach(function(existing) {
        if (existing.from === newFrom && existing.to === newTo && existing._label === edge._label) duplicate = true;
      });
      if (newFrom === newTo) { duplicate = true; } // 不自连
      if (!duplicate) {
        redirectedEdges[edge.id] = { origFrom: edge.from, origTo: edge.to };
        edgesDataSet.update({ id: edge.id, from: newFrom, to: newTo });
      } else {
        // 重复则移除
        redirectedEdges[edge.id] = { origFrom: edge.from, origTo: edge.to };
        edgesDataSet.remove([edge.id]);
      }
    }

    // 2) 移除子文档节点
    nodesDataSet.remove(childIds);

    // 3) 更新父节点标签（加左侧留白和收起数量提示）
    var parentNode = nodesDataSet.get(nodeId);
    if (parentNode) {
      var origLabel = parentNode._origLabel || parentNode.label;
      var pad = '      ';
      nodesDataSet.update({ id: nodeId, label: pad + origLabel + '  [' + childIds.length + ']', _origLabel: origLabel });
    }
    log('收起文档: 隐藏 ' + childIds.length + ' 个子文档, 重定向 ' + edgesToRedirect.length + ' 条边', true);

  } else {
    // ---- 展开 ----
    // 1) 恢复被重定向的边
    var restoreEdgeIds = [];
    for (var eid in redirectedEdges) {
      var info = redirectedEdges[eid];
      // 检查 origFrom 或 origTo 是否属于此父文档的子孙
      var isRelated = false;
      for (var ci = 0; ci < childIds.length; ci++) {
        if (info.origFrom === childIds[ci] || info.origTo === childIds[ci]) { isRelated = true; break; }
      }
      if (!isRelated) continue;
      restoreEdgeIds.push(eid);
      // 恢复原始 from/to 或重新添加
      var existing = edgesDataSet.get(eid);
      if (existing) {
        edgesDataSet.update({ id: eid, from: info.origFrom, to: info.origTo });
      } else {
        // 边已被移除（因重复），需重新添加
        // 在 allEdges 中找到此边原始数据
        for (var ai = 0; ai < allEdges.length; ai++) {
          var ae = allEdges[ai];
          if (ae.from === info.origFrom && ae.to === info.origTo) {
            var es = edgeStyle(ae);
            edgesDataSet.add({ id: eid, from: ae.from, to: ae.to, width: es.width, _origWidth: es.width, color: es.color, dashes: es.dashes, arrows: es.arrows, _label: ae.label, _highlightColor: es._highlightColor || '#9ca3af' });
            break;
          }
        }
      }
    }
    for (var ri = 0; ri < restoreEdgeIds.length; ri++) {
      delete redirectedEdges[restoreEdgeIds[ri]];
    }

    // 2) 重新添加子文档节点（使用保存的位置或思维导图排列）
    var parentPos = network.getPositions([nodeId])[nodeId];
    var addNodes = [];
    var visibleChildIds = [];
    for (var ni = 0; ni < allNodes.length; ni++) {
      var n = allNodes[ni];
      for (var ci = 0; ci < childIds.length; ci++) {
        if (n.id === childIds[ci] && !isNodeCollapsedByParent(n.id)) {
          var deg = getNodeDegree(n);
          var s = nodeStyle(n, deg);
          var nodeData = { id: n.id, label: n.label, _origLabel: n.label, title: n.label + ' (连接: ' + deg + ')', shape: s.shape, size: s.size, color: s.color, font: s.font, borderWidth: s.borderWidth, _type: n.type, _props: n.properties || {} };
          // 使用保存的位置
          if (savedChildPositions[n.id]) {
            nodeData.x = savedChildPositions[n.id].x;
            nodeData.y = savedChildPositions[n.id].y;
          }
          addNodes.push(nodeData);
          visibleChildIds.push(n.id);
          break;
        }
      }
    }
    if (addNodes.length > 0) {
      nodesDataSet.add(addNodes);
      // 如果没有保存位置，按思维导图方式排列
      var needArrange = false;
      for (var i = 0; i < visibleChildIds.length; i++) {
        if (!savedChildPositions[visibleChildIds[i]]) { needArrange = true; break; }
      }
      if (needArrange && parentPos) {
        arrangeDocMindMap(nodeId, visibleChildIds);
      }
    }

    // 3) 重新添加 doc_has_child 边
    var addedNodeIds = {};
    nodesDataSet.forEach(function(n) { addedNodeIds[n.id] = true; });
    var addEdges = [];
    for (var ei = 0; ei < allEdges.length; ei++) {
      var e = allEdges[ei];
      if (!addedNodeIds[e.from] || !addedNodeIds[e.to]) continue;
      if (e.label !== 'doc_has_child') continue;
      var exists = false;
      edgesDataSet.forEach(function(existing) {
        if (existing.from === e.from && existing.to === e.to && existing._label === e.label) exists = true;
      });
      if (!exists) {
        var es = edgeStyle(e);
        addEdges.push({ id: 'e_expand_' + ei, from: e.from, to: e.to, width: es.width, _origWidth: es.width, color: es.color, dashes: es.dashes, arrows: es.arrows, _label: e.label, _highlightColor: es._highlightColor || '#9ca3af' });
      }
    }
    if (addEdges.length > 0) edgesDataSet.add(addEdges);

    // 4) 恢复父节点标签（保留左侧留白）
    var parentNode = nodesDataSet.get(nodeId);
    if (parentNode && parentNode._origLabel) {
      var pad = '      ';
      nodesDataSet.update({ id: nodeId, label: pad + parentNode._origLabel });
    }
    log('展开文档: 显示 ' + addNodes.length + ' 个子文档', true);
  }
}

/** 在 afterDrawing 中绘制父文档节点的 +/- 按钮 */
function drawDocToggleButtons(ctx) {
  docToggleBtnPositions = {};
  nodesDataSet.forEach(function(node) {
    if (node._type !== 'document') return;
    var allNode = findAllNode(node.id);
    if (!allNode || !isParentDocNode(allNode)) return;
    var pos = network.getPositions([node.id])[node.id];
    if (!pos) return;
    var isCollapsed = !!collapsedDocNodes[node.id];
    var btnRadius = 9;

    // 使用 getBoundingBox 获取节点精确边界，按钮放在节点内左侧留白区域中心
    var bbox = network.getBoundingBox(node.id);
    var btnX, btnY;
    if (bbox) {
      btnX = bbox.left + btnRadius + 1;     // 按钮完全在节点内，左侧留白区域居中
      btnY = (bbox.top + bbox.bottom) / 2;  // 垂直居中
    } else {
      btnX = pos.x;
      btnY = pos.y;
    }

    // 记录位置（canvas 坐标）
    docToggleBtnPositions[node.id] = { x: btnX, y: btnY, r: btnRadius };

    // 绘制圆形按钮背景（蓝色系配色）
    ctx.beginPath();
    ctx.arc(btnX, btnY, btnRadius, 0, Math.PI * 2);
    ctx.fillStyle = isCollapsed ? '#3b82f6' : '#1e40af';  // 收起:亮蓝 展开:深蓝
    ctx.fill();
    ctx.strokeStyle = '#ffffff'; // 白色描边
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.closePath();

    // 绘制 + 或 - 符号
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isCollapsed ? '+' : '−', btnX, btnY + 0.5);
  });
}

/** 检查 canvas 坐标是否点击了某个 +/- 按钮，返回 nodeId 或 null */
function hitTestDocToggleBtn(canvasX, canvasY) {
  for (var nodeId in docToggleBtnPositions) {
    var btn = docToggleBtnPositions[nodeId];
    var dx = canvasX - btn.x;
    var dy = canvasY - btn.y;
    if (dx * dx + dy * dy <= (btn.r + 4) * (btn.r + 4)) {
      return nodeId;
    }
  }
  return null;
}

/**
 * 将父文档及其子文档按思维导图方式排列：
 * 父文档在左，子文档在右侧垂直等距、左边缘对齐
 */
function arrangeDocMindMap(parentNodeId, childNodeIds) {
  if (!network || childNodeIds.length === 0) return;
  var parentPos = network.getPositions([parentNodeId])[parentNodeId];
  if (!parentPos) return;

  var parentBbox = network.getBoundingBox(parentNodeId);
  var parentRight = parentBbox ? parentBbox.right : (parentPos.x + 80);
  var leftEdgeX = parentRight + 40; // 子节点左边缘的目标 X
  var vGap = 45;
  var count = childNodeIds.length;
  var totalHeight = (count - 1) * vGap;
  var startY = parentPos.y - totalHeight / 2;

  // 先读取每个子节点当前的宽度（移动前 bbox 有效）
  var halfLefts = [];
  for (var i = 0; i < count; i++) {
    var cid = childNodeIds[i];
    var bbox = network.getBoundingBox(cid);
    var cpos = network.getPositions([cid])[cid];
    if (bbox && cpos) {
      halfLefts.push(cpos.x - bbox.left); // 节点中心到左边缘的距离（即半宽）
    } else {
      halfLefts.push(100); // 默认估算
    }
  }

  // 一次性移动所有子节点：左边缘对齐到 leftEdgeX
  for (var i = 0; i < count; i++) {
    var cx = leftEdgeX + halfLefts[i];
    var cy = startY + i * vGap;
    network.moveNode(childNodeIds[i], cx, cy);
    savedChildPositions[childNodeIds[i]] = { x: cx, y: cy };
  }
}

/** 初始化时将所有父文档-子文档按思维导图方式排列 */
function arrangeAllDocMindMaps() {
  // 找到所有父文档节点
  var parentDocIds = [];
  for (var i = 0; i < allNodes.length; i++) {
    var n = allNodes[i];
    if (isParentDocNode(n)) {
      // 检查该节点在当前可见节点集中
      var visible = nodesDataSet.get(n.id);
      if (visible) parentDocIds.push(n.id);
    }
  }
  for (var pi = 0; pi < parentDocIds.length; pi++) {
    var pid = parentDocIds[pi];
    var childIds = getChildDocNodeIds(pid);
    // 只排列当前可见的子节点
    var visibleChildIds = [];
    for (var ci = 0; ci < childIds.length; ci++) {
      if (nodesDataSet.get(childIds[ci])) visibleChildIds.push(childIds[ci]);
    }
    if (visibleChildIds.length > 0) {
      arrangeDocMindMap(pid, visibleChildIds);
    }
  }
  log('思维导图排列: ' + parentDocIds.length + ' 个父文档已排列', true);
}


// ========== 呼吸灯动画 (in_progress 主任务) ==========
var breathAnimId = null;  // requestAnimationFrame ID
var breathPhase = 0;      // 动画相位 [0, 2π)

/** 启动呼吸灯动画循环 */
function startBreathAnimation() {
  if (breathAnimId) return; // 已在运行
  function tick() {
    breathPhase += 0.03;  // 控制呼吸速度
    if (breathPhase > Math.PI * 2) breathPhase -= Math.PI * 2;
    if (network) network.redraw();
    breathAnimId = requestAnimationFrame(tick);
  }
  breathAnimId = requestAnimationFrame(tick);
}

/** 停止呼吸灯动画循环 */
function stopBreathAnimation() {
  if (breathAnimId) {
    cancelAnimationFrame(breathAnimId);
    breathAnimId = null;
  }
}

/** 获取所有 in_progress 的主任务节点 ID 列表 */
function getInProgressMainTaskIds() {
  var ids = [];
  if (!nodesDataSet) return ids;
  var all = nodesDataSet.get();
  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    if (n._type === 'main-task' && n._props && n._props.status === 'in_progress') {
      ids.push(n.id);
    }
  }
  return ids;
}

// 监听 Ctrl 按键状态
document.addEventListener('keydown', function(e) { if (e.key === 'Control') ctrlPressed = true; });
document.addEventListener('keyup', function(e) { if (e.key === 'Control') ctrlPressed = false; });
window.addEventListener('blur', function() { ctrlPressed = false; });


// ========== Node Styles (统一颜色配置) ==========
var _visUniStyle = getUnifiedNodeStyle();
var STATUS_COLORS = _visUniStyle.statusGeneric;


// ========== 节点动态大小规则 ==========
// 根据节点的连接数（度数）动态调整大小，连接越多节点越大
// min: 最小尺寸, max: 最大尺寸, baseFont: 基础字号, maxFont: 最大字号
// scale: 缩放系数 (越大增长越快)
var NODE_SIZE_RULES = {
  'project':   { min: 35, max: 65, baseFont: 16, maxFont: 22, scale: 3.5 },
  'module':    { min: 20, max: 45, baseFont: 12, maxFont: 16, scale: 2.8 },
  'main-task': { min: 14, max: 38, baseFont: 11, maxFont: 15, scale: 2.2 },
  'sub-task':  { min: 7,  max: 18, baseFont: 8,  maxFont: 11, scale: 1.5 },
  'document':  { min: 12, max: 30, baseFont: 9,  maxFont: 13, scale: 1.8 }
};

/** 获取节点度数：纯后端下发，缺失视为 0 */
function getNodeDegree(node) {
  if (typeof node.degree === 'number' && !isNaN(node.degree)) return node.degree;
  return 0;
}

/** 根据类型和度数计算节点尺寸与字号 */
function calcNodeSize(type, degree) {
  var rule = NODE_SIZE_RULES[type] || { min: 10, max: 22, baseFont: 10, maxFont: 13, scale: 1.0 };
  // 使用 sqrt 曲线：低度数时增长快，高度数时增长变缓
  var size = rule.min + rule.scale * Math.sqrt(degree);
  size = Math.max(rule.min, Math.min(size, rule.max));
  // 字号随尺寸线性插值
  var sizeRatio = (size - rule.min) / (rule.max - rule.min || 1);
  var fontSize = Math.round(rule.baseFont + sizeRatio * (rule.maxFont - rule.baseFont));
  return { size: Math.round(size), fontSize: fontSize };
}

function nodeStyle(node, degree) {
  var t = node.type;
  var p = node.properties || {};
  var status = p.status || 'pending';
  var sc = STATUS_COLORS[status] || STATUS_COLORS.pending;
  var ns = calcNodeSize(t, degree || 0);

  if (t === 'project') {
    var _pc = _visUniStyle.project;
    return { shape: 'star', size: ns.size, color: { background: _pc.bg, border: _pc.border, highlight: { background: _pc.bg, border: '#fff' } }, font: { size: ns.fontSize, color: _pc.font }, borderWidth: 3 };
  }
  if (t === 'module') {
    var _mc = _visUniStyle.module;
    return { shape: 'diamond', size: ns.size, color: { background: _mc.bg, border: _mc.border, highlight: { background: _mc.bg, border: '#fff' } }, font: { size: ns.fontSize, color: _mc.font }, borderWidth: 2 };
  }
  if (t === 'main-task') {
    // 主任务: 从统一配置读取状态颜色 (深绿色系)
    var mtc = _visUniStyle.mainTask[status] || _visUniStyle.mainTask.pending;
    return { shape: 'dot', size: ns.size, color: { background: mtc.bg, border: mtc.border, highlight: { background: mtc.bg, border: '#fff' } }, font: { size: ns.fontSize, color: mtc.font }, borderWidth: 2 };
  }
  if (t === 'sub-task') {
    // 子任务: 从统一配置读取状态颜色 (pending=暖肤色, completed=亮绿)
    var stc = _visUniStyle.subTask[status] || _visUniStyle.subTask.pending;
    return { shape: 'dot', size: ns.size, color: { background: stc.bg, border: stc.border, highlight: { background: stc.bg, border: '#fff' } }, font: { size: ns.fontSize, color: stc.font }, borderWidth: 1 };
  }
  if (t === 'document') {
    var _dc = _visUniStyle.document;
    return { shape: 'box', size: ns.size, color: { background: _dc.bg, border: _dc.border, highlight: { background: _dc.bg, border: '#fff' } }, font: { size: ns.fontSize, color: _dc.font }, borderWidth: 1 };
  }
  return { shape: 'dot', size: ns.size, color: { background: '#6b7280', border: '#4b5563' }, font: { size: ns.fontSize, color: '#9ca3af' } };
}

// 默认灰色 + 选中时高亮色（per-type）
var EDGE_GRAY = '#4b5563';

function edgeStyle(edge) {
  var label = edge.label || '';
  if (label === 'has_main_task') return { width: 2, color: { color: EDGE_GRAY, highlight: '#93c5fd', hover: '#93c5fd' }, dashes: false, arrows: { to: { enabled: true, scaleFactor: 0.6 } }, _highlightColor: '#93c5fd' };
  if (label === 'has_sub_task') return { width: 1, color: { color: EDGE_GRAY, highlight: '#818cf8', hover: '#818cf8' }, dashes: false, arrows: { to: { enabled: true, scaleFactor: 0.4 } }, _highlightColor: '#818cf8' };
  if (label === 'has_document') return { width: 1, color: { color: EDGE_GRAY, highlight: '#60a5fa', hover: '#60a5fa' }, dashes: [5, 5], arrows: { to: { enabled: true, scaleFactor: 0.4 } }, _highlightColor: '#60a5fa' };
  if (label === 'has_module') return { width: 1.5, color: { color: EDGE_GRAY, highlight: '#ff8533', hover: '#ff8533' }, dashes: [3, 3], arrows: { to: { enabled: true, scaleFactor: 0.5 } }, _highlightColor: '#ff8533' };
  if (label === 'module_has_task') return { width: 1.5, color: { color: EDGE_GRAY, highlight: '#ff8533', hover: '#ff8533' }, dashes: [2, 4], arrows: { to: { enabled: true, scaleFactor: 0.5 } }, _highlightColor: '#ff8533' };
  if (label === 'task_has_doc') return { width: 1.5, color: { color: EDGE_GRAY, highlight: '#f59e0b', hover: '#f59e0b' }, dashes: [4, 3], arrows: { to: { enabled: true, scaleFactor: 0.5 } }, _highlightColor: '#f59e0b' };
  if (label === 'doc_has_child') return { width: 1.5, color: { color: EDGE_GRAY, highlight: '#c084fc', hover: '#c084fc' }, dashes: [6, 3], arrows: { to: { enabled: true, scaleFactor: 0.5 } }, _highlightColor: '#c084fc' };
  return { width: 1, color: { color: EDGE_GRAY, highlight: '#9ca3af', hover: '#9ca3af' }, dashes: false, _highlightColor: '#9ca3af' };
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
    var DOC_BTN_PAD = '      ';  // 父文档标签左侧留白，为 +/- 按钮腾出空间
    for (var i = 0; i < allNodes.length; i++) {
      var n = allNodes[i];
      if (hiddenTypes[n.type]) continue;
      // 跳过被收起的子文档节点
      if (isNodeCollapsedByParent(n.id)) continue;
      var deg = getNodeDegree(n);
      var s = nodeStyle(n, deg);
      var label = n.label;
      var isParentDoc = isParentDocNode(n);
      if (isParentDoc) {
        // 父文档标签左侧加空格，为按钮腾位
        if (collapsedDocNodes[n.id]) {
          var childCount = getAllDescendantDocNodeIds(n.id).length;
          label = DOC_BTN_PAD + label + '  [' + childCount + ']';
        } else {
          label = DOC_BTN_PAD + label;
        }
      }
      // Phase-10 T10.5: Add double-click hint for main-task nodes in tiered mode
      var tooltip = n.label + ' (连接: ' + deg + ')';
      if (n.type === 'main-task' && !USE_3D && tieredLoadState.l0l1Loaded && !tieredLoadState.l2Loaded) {
        var phaseId = (n.properties || {}).taskId || n.id;
        tooltip += tieredLoadState.expandedPhases[phaseId] ? '\\n双击收起子任务' : '\\n双击展开子任务';
      }
      visibleNodes.push({ id: n.id, label: label, _origLabel: n.label, title: tooltip, shape: s.shape, size: s.size, color: s.color, font: s.font, borderWidth: s.borderWidth, _type: n.type, _props: n.properties || {}, _isParentDoc: isParentDoc });
    }

    var visibleIds = {};
    var _projectNodeIds = {}; // 收集所有 project 类型节点 ID
    for (var i = 0; i < visibleNodes.length; i++) {
      visibleIds[visibleNodes[i].id] = true;
      if (visibleNodes[i]._type === 'project') _projectNodeIds[visibleNodes[i].id] = true;
    }

    // 读取"主节点连线"设置
    var _graphSettings = getGraphSettings();
    var _hideProjectEdges = !_graphSettings.showProjectEdges;

    var visibleEdges = [];
    for (var i = 0; i < allEdges.length; i++) {
      var e = allEdges[i];
      if (!visibleIds[e.from] || !visibleIds[e.to]) continue;
      // 主节点连线: 标记为隐藏但保留在数据中（3D 力模拟仍需要这些边）
      var isProjectEdge = _hideProjectEdges && (_projectNodeIds[e.from] || _projectNodeIds[e.to]);
      var es = edgeStyle(e);
      visibleEdges.push({ id: 'e' + i, from: e.from, to: e.to, width: es.width, _origWidth: es.width, color: es.color, dashes: es.dashes, arrows: es.arrows, _label: e.label, _highlightColor: es._highlightColor || '#9ca3af', _projectEdgeHidden: !!isProjectEdge, hidden: !!isProjectEdge });
    }

    log('可见节点: ' + visibleNodes.length + ', 可见边: ' + visibleEdges.length, true);

    if (network) {
      network.destroy();
      network = null;
    }

    // ── 3D Force Graph 渲染路径 ──
    if (USE_3D) {
      nodesDataSet = new SimpleDataSet(visibleNodes);
      edgesDataSet = new SimpleDataSet(visibleEdges);
      render3DGraph(container, visibleNodes, visibleEdges);
      return; // 3D 有独立的事件绑定和生命周期
    }

    // ── vis-network 渲染路径 ──
    nodesDataSet = new vis.DataSet(visibleNodes);
    edgesDataSet = new vis.DataSet(visibleEdges);

    // ── Phase-10 T10.4: Adaptive physics config based on node count ──
    var nodeCount = visibleNodes.length;
    var physicsConfig;
    if (nodeCount > 2000) {
      physicsConfig = {
        enabled: false,
        stabilization: { enabled: false }
      };
      log('物理引擎: 已禁用 (节点 ' + nodeCount + ' > 2000)', true);
    } else if (nodeCount > 800) {
      physicsConfig = {
        enabled: true,
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -60,
          centralGravity: 0.02,
          springLength: 120,
          springConstant: 0.06,
          damping: 0.5,
          avoidOverlap: 0.8
        },
        stabilization: { enabled: true, iterations: 80, updateInterval: 20 }
      };
      log('物理引擎: 大图模式 iterations=80 (节点 ' + nodeCount + ')', true);
    } else if (nodeCount > 200) {
      physicsConfig = {
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
        stabilization: { enabled: true, iterations: 120, updateInterval: 25 }
      };
      log('物理引擎: 中等模式 iterations=120 (节点 ' + nodeCount + ')', true);
    } else {
      physicsConfig = {
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
        stabilization: { enabled: true, iterations: 150, updateInterval: 25 }
      };
    }

    // ── 性能优化: 根据节点数量自适应渲染配置 ──
    var isLargeGraph = nodeCount > 300;
    var isVeryLargeGraph = nodeCount > 800;

    var networkOptions = {
      nodes: {
        borderWidth: 2,
        shadow: isLargeGraph
          ? false
          : { enabled: true, color: 'rgba(0,0,0,0.3)', size: 5, x: 0, y: 2 }
      },
      edges: {
        smooth: isLargeGraph
          ? false
          : { enabled: true, type: 'continuous', roundness: 0.5 },
        shadow: false
      },
      physics: physicsConfig,
      interaction: {
        hover: !isVeryLargeGraph,
        tooltipDelay: 200,
        navigationButtons: false,
        keyboard: false,
        zoomView: true,
        dragView: true,
        hideEdgesOnDrag: isLargeGraph,
        hideEdgesOnZoom: isLargeGraph,
        zoomSpeed: isVeryLargeGraph ? 0.8 : 1,
      },
      layout: {
        improvedLayout: (nodeCount > 200 && nodeCount <= 800),
        hierarchical: false
      }
    };

    network = new vis.Network(container,
      { nodes: nodesDataSet, edges: edgesDataSet },
      networkOptions
    );

    // Phase-10 T10.3: Mark network as reusable for incremental updates
    networkReusable = true;

    // Phase-10 T10.4: When physics is disabled (large graph), immediately show result
    if (!physicsConfig.enabled) {
      document.getElementById('loading').style.display = 'none';
      log('图谱渲染完成 (无物理引擎)! ' + visibleNodes.length + ' 节点, ' + visibleEdges.length + ' 边', true);
      network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    } else {
    log('Network 实例已创建, 等待物理稳定化...', true);
    }

    network.on('stabilizationIterationsDone', function() {
      network.setOptions({ physics: { enabled: false } });
      document.getElementById('loading').style.display = 'none';
      log('图谱渲染完成! ' + visibleNodes.length + ' 节点, ' + visibleEdges.length + ' 边', true);
      // 稳定后将父文档-子文档按思维导图方式整齐排列
      arrangeAllDocMindMaps();
      network.fit({ animation: { duration: 800, easingFunction: 'easeInOutQuad' } });
    });

    // ── 性能优化: 缩放时根据 zoom level 自适应标签可见性 ──
    // 缩小到一定程度时隐藏子任务/文档标签（反正看不清），减少 canvas 文本绘制开销
    if (isLargeGraph) {
      var labelHidden = false;
      network.on('zoom', function() {
        var scale = network.getScale();
        if (scale < 0.4 && !labelHidden) {
          // 缩小时: 隐藏子任务和文档的标签
          labelHidden = true;
          var updates = [];
          nodesDataSet.forEach(function(n) {
            if (n._type === 'sub-task' || n._type === 'document') {
              updates.push({ id: n.id, font: { size: 0 } });
            }
          });
          if (updates.length > 0) nodesDataSet.update(updates);
        } else if (scale >= 0.4 && labelHidden) {
          // 放大时: 恢复标签
          labelHidden = false;
          var updates = [];
          nodesDataSet.forEach(function(n) {
            if (n._type === 'sub-task') {
              updates.push({ id: n.id, font: { size: 9, color: n.font ? n.font.color : '#9ca3af' } });
            } else if (n._type === 'document') {
              updates.push({ id: n.id, font: { size: 10, color: n.font ? n.font.color : '#dbeafe' } });
            }
          });
          if (updates.length > 0) nodesDataSet.update(updates);
        }
      });
    }

    // ── Phase-10 T10.5: Double-click to expand/collapse sub-tasks ──
    network.on('doubleClick', function(params) {
      if (params.nodes.length > 0) {
        var clickedId = params.nodes[0];
        var clickedNode = nodesDataSet.get(clickedId);
        if (clickedNode && clickedNode._type === 'main-task') {
          var taskId = (clickedNode._props || {}).taskId || clickedId;
          loadSubTasksForPhase(taskId);
        }
      }
    });

    network.on('click', function(params) {
      // 先检查是否点击了 +/- 按钮
      if (params.pointer && params.pointer.canvas) {
        var hitNodeId = hitTestDocToggleBtn(params.pointer.canvas.x, params.pointer.canvas.y);
        if (hitNodeId) {
          toggleDocNodeExpand(hitNodeId);
          return; // 消费此次点击，不触发节点选择
        }
      }
      if (params.nodes.length > 0) {
        // 直接点击图谱节点 → 清空历史栈，重新开始导航
        panelHistory = [];
        currentPanelNodeId = null;
        highlightConnectedEdges(params.nodes[0]);
        showPanel(params.nodes[0]);
      } else {
        resetAllEdgeColors();
        closePanel();
      }
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

    // ========== afterDrawing: 呼吸灯 + 文档展开/收起按钮 ==========
    network.on('afterDrawing', function(ctx) {
      // 绘制父文档的 +/- 按钮
      drawDocToggleButtons(ctx);

      var ids = getInProgressMainTaskIds();
      if (ids.length === 0) return;

      // 呼吸因子: 0 → 1 → 0 平滑循环
      var breath = (Math.sin(breathPhase) + 1) / 2; // [0, 1]

      for (var i = 0; i < ids.length; i++) {
        var pos = network.getPositions([ids[i]])[ids[i]];
        if (!pos) continue;
        var nodeData = nodesDataSet.get(ids[i]);
        var baseSize = (nodeData && nodeData.size) || 14;

        // 将网络坐标转换为 canvas 坐标
        var canvasPos = network.canvasToDOM(pos);
        // 再通过 DOMtoCanvas 获取正确的 canvas 上下文坐标
        // vis-network 的 afterDrawing ctx 已经在正确的坐标系中，直接用 pos 即可

        // 外层大范围弥散光晕（营造醒目的辉光感）
        var outerGlowRadius = baseSize + 20 + breath * baseSize * 2.5;
        var outerGrad = ctx.createRadialGradient(pos.x, pos.y, baseSize, pos.x, pos.y, outerGlowRadius);
        outerGrad.addColorStop(0, 'rgba(124, 58, 237, ' + (0.18 + breath * 0.12) + ')');
        outerGrad.addColorStop(0.5, 'rgba(139, 92, 246, ' + (0.08 + breath * 0.06) + ')');
        outerGrad.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, outerGlowRadius, 0, Math.PI * 2);
        ctx.fillStyle = outerGrad;
        ctx.fill();
        ctx.closePath();

        // 外圈脉冲光环（更粗、扩展范围更大）
        var maxExpand = baseSize * 2.2;
        var ringRadius = baseSize + 8 + breath * maxExpand;
        var ringAlpha = 0.55 * (1 - breath * 0.5);

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(139, 92, 246, ' + ringAlpha + ')';
        ctx.lineWidth = 3.5 + breath * 3;
        ctx.stroke();
        ctx.closePath();

        // 中圈脉冲光环（第二道更紧凑的环）
        var midRingRadius = baseSize + 4 + breath * baseSize * 1.2;
        var midRingAlpha = 0.4 * (1 - breath * 0.4);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, midRingRadius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(167, 139, 250, ' + midRingAlpha + ')';
        ctx.lineWidth = 2.5 + breath * 2;
        ctx.stroke();
        ctx.closePath();

        // 内圈柔光（更大范围的径向渐变）
        var glowRadius = baseSize + 10 + breath * 16;
        var gradient = ctx.createRadialGradient(pos.x, pos.y, baseSize * 0.3, pos.x, pos.y, glowRadius);
        gradient.addColorStop(0, 'rgba(124, 58, 237, ' + (0.25 + breath * 0.15) + ')');
        gradient.addColorStop(0.6, 'rgba(139, 92, 246, ' + (0.10 + breath * 0.08) + ')');
        gradient.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.closePath();
      }
    });

    // 检查是否有 in_progress 主任务，有则启动动画
    stopBreathAnimation();
    var inProgIds = getInProgressMainTaskIds();
    if (inProgIds.length > 0) {
      startBreathAnimation();
      log('呼吸灯: 检测到 ' + inProgIds.length + ' 个进行中主任务', true);
    }

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


// ========== Filters ==========
/** 保存筛选隐藏时各节点的 (x, y) 位置，重新显示时恢复 */
var savedFilterPositions = {};

function toggleFilter(type) {
  var el = document.querySelector('.legend-item.toggle[data-type="' + type + '"]');
  var cb = document.getElementById('cb-' + type);
  if (!el) return;

  var isCurrentlyActive = el.classList.contains('active');

  if (isCurrentlyActive) {
    // ── 分层模式: 该类型尚未加载 → 首次点击触发按需加载 ──
    if (!USE_3D && tieredLoadState.l0l1Loaded) {
      if (type === 'sub-task' && !tieredLoadState.l2Loaded) {
        loadTierDataByType('sub-task');
        return;
      }
      if (type === 'document' && !tieredLoadState.l3Loaded) {
        loadTierDataByType('document');
        return;
      }
    }
    // ── 正常隐藏此类型 ──
    el.classList.remove('active');
    if (cb) cb.checked = false;
    hiddenTypes[type] = true;
  } else {
    // ── 显示此类型 ──
    el.classList.add('active');
    if (cb) cb.checked = true;
    delete hiddenTypes[type];

    // 分层模式: 如果该类型数据尚未加载，触发按需加载
    if (!USE_3D && tieredLoadState.l0l1Loaded) {
      if (type === 'sub-task' && !tieredLoadState.l2Loaded) {
        loadTierDataByType('sub-task');
        return;
      }
      if (type === 'document' && !tieredLoadState.l3Loaded) {
        loadTierDataByType('document');
        return;
      }
    }
  }

  // Phase-10 T10.3: Incremental filter toggle — add/remove from DataSet
  if (networkReusable && nodesDataSet && edgesDataSet && network && !USE_3D) {
    if (isCurrentlyActive) {
      // ── 隐藏: 保存位置 → 移除节点 ──
      var removeNodeIds = [];
      nodesDataSet.forEach(function(n) {
        if (n._type === type) removeNodeIds.push(n.id);
      });
      if (removeNodeIds.length > 0) {
        // 保存当前位置，以便重新勾选时恢复
        var positions = network.getPositions(removeNodeIds);
        for (var k in positions) {
          savedFilterPositions[k] = positions[k];
        }
        // Remove edges connected to these nodes first
        var removeEdgeIds = [];
        var removeSet = {};
        for (var i = 0; i < removeNodeIds.length; i++) removeSet[removeNodeIds[i]] = true;
        edgesDataSet.forEach(function(edge) {
          if (removeSet[edge.from] || removeSet[edge.to]) removeEdgeIds.push(edge.id);
        });
        if (removeEdgeIds.length > 0) edgesDataSet.remove(removeEdgeIds);
        nodesDataSet.remove(removeNodeIds);
        log('类型筛选: 隐藏 ' + type + ' (-' + removeNodeIds.length + ' 节点, 位置已保存)', true);
      }
    } else {
      // ── 显示: 恢复节点到之前保存的位置 ──
      var addNodes = [];
      var addEdges = [];
      var currentIds = {};
      nodesDataSet.forEach(function(n) { currentIds[n.id] = true; });

      var restoredCount = 0;
      for (var i = 0; i < allNodes.length; i++) {
        var n = allNodes[i];
        if (n.type === type && !currentIds[n.id]) {
          var deg = getNodeDegree(n);
          var s = nodeStyle(n, deg);
          var nodeData = {
            id: n.id, label: n.label, _origLabel: n.label,
            title: n.label + ' (连接: ' + deg + ')',
            shape: s.shape, size: s.size, color: s.color, font: s.font,
            borderWidth: s.borderWidth, _type: n.type,
            _props: n.properties || {},
          };
          // 恢复之前保存的位置
          if (savedFilterPositions[n.id]) {
            nodeData.x = savedFilterPositions[n.id].x;
            nodeData.y = savedFilterPositions[n.id].y;
            delete savedFilterPositions[n.id];
            restoredCount++;
          }
          addNodes.push(nodeData);
          currentIds[n.id] = true;
        }
      }
      // Re-add edges for newly visible nodes
      for (var i = 0; i < allEdges.length; i++) {
        var e = allEdges[i];
        if (currentIds[e.from] && currentIds[e.to]) {
          var existing = edgesDataSet.get('e' + i);
          if (!existing) {
            var es = edgeStyle(e);
            addEdges.push({
              id: 'e' + i, from: e.from, to: e.to,
              width: es.width, _origWidth: es.width,
              color: es.color, dashes: es.dashes, arrows: es.arrows,
              _label: e.label, _highlightColor: es._highlightColor || '#9ca3af',
            });
          }
        }
      }
      if (addNodes.length > 0) nodesDataSet.add(addNodes);
      if (addEdges.length > 0) edgesDataSet.add(addEdges);
      log('类型筛选: 显示 ' + type + ' (+' + addNodes.length + ' 节点, ' + restoredCount + ' 位置已恢复)', true);

      // 仅对没有保存位置的新节点短暂开启物理引擎
      var unpositioned = addNodes.length - restoredCount;
      if (unpositioned > 0 && unpositioned < 200) {
        network.setOptions({ physics: { enabled: true, stabilization: { enabled: false } } });
        setTimeout(function() {
          if (network) network.setOptions({ physics: { enabled: false } });
        }, 1500);
      }
    }
    return;
  }

  // Fallback: full rebuild
  renderGraph();
}

/**
 * 分层模式: 按类型按需加载数据（子任务 / 文档）。
 * 当用户点击底部图例激活某类型时，如果该类型尚未加载，触发此函数。
 */
function loadTierDataByType(type) {
  var entityTypeMap = { 'sub-task': 'devplan-sub-task', 'document': 'devplan-document' };
  var entityType = entityTypeMap[type];
  if (!entityType) return;

  var el = document.querySelector('.legend-item.toggle[data-type="' + type + '"]');
  if (el) el.classList.add('loading');

  log('按需加载: ' + type + '...', true);
  var url = '/api/graph/paged?offset=0&limit=5000&entityTypes=' + entityType +
    '&includeDocuments=' + (type === 'document' ? 'true' : 'false') +
    '&includeModules=false';

  fetch(url).then(function(r) { return r.json(); }).then(function(result) {
    var newNodes = result.nodes || [];
    var newEdges = result.edges || [];

    // 合并到 allNodes/allEdges（去重）
    var existingIds = {};
    for (var i = 0; i < allNodes.length; i++) existingIds[allNodes[i].id] = true;

    var addedNodes = [];
    var addedEdges = [];
    for (var i = 0; i < newNodes.length; i++) {
      if (!existingIds[newNodes[i].id]) {
        allNodes.push(newNodes[i]);
        addedNodes.push(newNodes[i]);
        existingIds[newNodes[i].id] = true;
      }
    }
    // 也检查服务器返回的新边
    var existingEdgeSet = {};
    for (var i = 0; i < allEdges.length; i++) {
      existingEdgeSet[allEdges[i].from + '->' + allEdges[i].to] = true;
    }
    for (var i = 0; i < newEdges.length; i++) {
      var e = newEdges[i];
      var edgeKey = e.from + '->' + e.to;
      if (!existingEdgeSet[edgeKey] && existingIds[e.from] && existingIds[e.to]) {
        allEdges.push(e);
        addedEdges.push(e);
        existingEdgeSet[edgeKey] = true;
      }
    }

    if (type === 'sub-task') tieredLoadState.l2Loaded = true;
    if (type === 'document') tieredLoadState.l3Loaded = true;

    if (el) {
      el.classList.remove('loading');
      el.classList.remove('not-loaded');
      el.title = '点击切换' + type + '显隐';
    }
    log('按需加载完成: +' + addedNodes.length + ' ' + type + ' 节点, +' + addedEdges.length + ' 边', true);

    // 增量添加到图谱
    if (networkReusable && nodesDataSet && edgesDataSet && network) {
      incrementalAddNodes(addedNodes, addedEdges);
    } else {
      renderGraph();
    }
    updateTieredIndicator();
  }).catch(function(err) {
    if (el) el.classList.remove('loading');
    log('按需加载失败: ' + err.message, false);
  });
}

/**
 * 同步图例 toggle 状态与当前 hiddenTypes（页面初始化 / 分层加载后调用）。
 */
function syncLegendToggleState() {
  var types = ['module', 'main-task', 'sub-task', 'document'];
  for (var i = 0; i < types.length; i++) {
    var el = document.querySelector('.legend-item.toggle[data-type="' + types[i] + '"]');
    var cb = document.getElementById('cb-' + types[i]);
    if (!el) continue;
    if (hiddenTypes[types[i]]) {
      el.classList.remove('active');
      if (cb) cb.checked = false;
    } else {
      el.classList.add('active');
      if (cb) cb.checked = true;
    }
  }
}

/**
 * 分层模式: 标记尚未加载的节点类型（子任务 / 文档）在图例中显示"未加载"视觉提示。
 * 用户点击后会触发按需加载。
 */
function markUnloadedTypeLegends() {
  var subEl = document.querySelector('.legend-item.toggle[data-type="sub-task"]');
  var docEl = document.querySelector('.legend-item.toggle[data-type="document"]');
  if (subEl && !tieredLoadState.l2Loaded) {
    subEl.classList.add('not-loaded');
    subEl.title = '点击加载子任务';
  }
  if (docEl && !tieredLoadState.l3Loaded) {
    docEl.classList.add('not-loaded');
    docEl.title = '点击加载文档';
  }
}

/**
 * 全量加载后: 清除所有"未加载"标记，确保所有 toggle 为 active 状态。
 */
function clearUnloadedTypeLegends() {
  var els = document.querySelectorAll('.legend-item.toggle.not-loaded');
  for (var i = 0; i < els.length; i++) {
    els[i].classList.remove('not-loaded');
  }
  // 确保所有 toggle 为 active
  var toggles = document.querySelectorAll('.legend-item.toggle');
  for (var i = 0; i < toggles.length; i++) {
    if (!toggles[i].classList.contains('active')) {
      toggles[i].classList.add('active');
    }
    var tp = toggles[i].getAttribute('data-type');
    if (tp) toggles[i].title = '点击切换' + tp + '显隐';
  }
}

`;
}
