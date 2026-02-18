/**
 * DevPlan 图可视化 — 统计弹层与刷新模块
 *
 * 包含: 统计弹层 (打开/关闭/渲染)、手动刷新 (F5/按钮)。
 */

export function getStatsModalScript(): string {
  return `
// ========== Stats Modal ==========
function showStatsModal(nodeType) {
  // 文档类型使用全局文档列表组件
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

// ========== 全局文档列表弹层 (Phase-18: 与文档浏览页共用同一组件) ==========

/** 显示文档弹层 — 复用文档浏览页的 UI 样式和搜索功能 */
function showDocModal() {
  document.getElementById('statsModalTitle').textContent = '📄 文档库';
  document.getElementById('statsModalCount').textContent = '';

  // 在 modal body 中渲染搜索栏 + 文档列表容器（复用文档浏览页 CSS 类名）
  var bodyHtml = '';
  // 置顶搜索栏
  bodyHtml += '<div class="doc-modal-search-sticky">';
  bodyHtml += '<div class="docs-search-wrap">';
  bodyHtml += '<input type="text" class="docs-search" id="docModalSearch" placeholder="搜索文档标题..." oninput="filterDocModal()">';
  bodyHtml += '<button class="docs-search-clear" id="docModalSearchClear" onclick="clearDocModalSearch()" title="清空搜索">✕</button>';
  bodyHtml += '</div></div>';
  // 文档分组列表容器
  bodyHtml += '<div id="docModalGroupList" style="padding:8px 0;">';
  bodyHtml += '<div style="text-align:center;padding:40px;color:#6b7280;font-size:12px;"><div class="spinner" style="margin:0 auto 12px;width:24px;height:24px;border-width:3px;"></div>加载文档列表...</div>';
  bodyHtml += '</div>';

  document.getElementById('statsModalBody').innerHTML = bodyHtml;
  updateStatsModalPosition();
  document.getElementById('statsModalOverlay').classList.add('active');

  // 加载文档数据（全局共享，已加载则直接使用缓存）
  loadDocsData(function(data, err) {
    if (err) {
      var list = document.getElementById('docModalGroupList');
      if (list) list.innerHTML = '<div style="text-align:center;padding:40px;color:#f87171;font-size:12px;">加载失败: ' + err.message + '</div>';
      return;
    }
    document.getElementById('statsModalCount').textContent = '(' + docsData.length + ')';
    renderDocsList(docsData, 'docModalGroupList', 'globalDocSelect');
  });
}

/** 文档弹层搜索过滤 */
function filterDocModal() {
  toggleSearchClear('docModalSearch', 'docModalSearchClear');
  filterDocs('docModalSearch', 'docModalGroupList', 'globalDocSelect');
}

/** 文档弹层清空搜索 */
function clearDocModalSearch() {
  clearDocsSearch('docModalSearch', 'docModalSearchClear', 'docModalGroupList', 'globalDocSelect');
}

/** 从图谱页文档弹层选中文档：关闭弹层 → 跳转文档浏览页 → 打开该文档 */
function globalDocSelect(docKey) {
  closeStatsModal();
  navTo('docs');
  // 确保文档浏览页数据已加载后再选中对应文档
  loadDocsData(function() {
    renderDocsList(docsData);   // 确保文档浏览页左侧列表已渲染
    setTimeout(function() { selectDoc(docKey); }, 50);
  });
}

/** 显示 Prompt 列表弹层（异步从 /api/prompts 加载） */
function showPromptModal() {
  document.getElementById('statsModalTitle').textContent = '💬 Prompt 日志';
  document.getElementById('statsModalCount').textContent = '(加载中...)';
  document.getElementById('statsModalBody').innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;"><div class="spinner" style="margin:0 auto 12px;width:24px;height:24px;border:2px solid #374151;border-top-color:#818cf8;border-radius:50%;animation:spin 0.6s linear infinite;"></div>加载 Prompt...</div>';
  updateStatsModalPosition();
  document.getElementById('statsModalOverlay').classList.add('active');

  fetch('/api/prompts').then(function(r) { return r.json(); }).then(function(data) {
    var prompts = data.prompts || [];
    document.getElementById('statsModalCount').textContent = '(' + prompts.length + ')';

    if (prompts.length === 0) {
      document.getElementById('statsModalBody').innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;">暂无 Prompt 记录</div>';
      return;
    }

    // 按日期分组（最新在前）
    var grouped = {};
    var dateOrder = [];
    for (var i = 0; i < prompts.length; i++) {
      var p = prompts[i];
      var date = p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : 'unknown';
      if (!grouped[date]) { grouped[date] = []; dateOrder.push(date); }
      grouped[date].push(p);
    }

    var html = '';
    for (var di = 0; di < dateOrder.length; di++) {
      var date = dateOrder[di];
      var items = grouped[date];
      html += '<div style="margin-bottom:4px;">';
      html += '<div style="padding:8px 20px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;display:flex;align-items:center;gap:6px;">';
      html += '<span>📅 ' + escHtml(date) + '</span>';
      html += '<span style="margin-left:auto;font-size:10px;color:#4b5563;">' + items.length + '</span>';
      html += '</div>';

      for (var ii = 0; ii < items.length; ii++) {
        var p = items[ii];
        var timeStr = p.createdAt ? new Date(p.createdAt).toLocaleTimeString() : '';
        var tagHtml = '';
        if (p.tags && p.tags.length > 0) {
          for (var ti = 0; ti < Math.min(p.tags.length, 3); ti++) {
            tagHtml += '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(139,92,246,0.15);color:#a78bfa;border:1px solid rgba(139,92,246,0.25);white-space:nowrap;">' + escHtml(p.tags[ti]) + '</span>';
          }
          if (p.tags.length > 3) tagHtml += '<span style="font-size:10px;color:#6b7280;">+' + (p.tags.length - 3) + '</span>';
        }

        // 用户原始输入（截取预览）
        var rawContent = (p.content || '').trim();
        var contentPreview = rawContent.length > 120 ? rawContent.substring(0, 117) + '...' : rawContent;
        // AI 理解
        var aiText = (p.aiInterpretation || '').trim();
        var aiPreview = aiText.length > 120 ? aiText.substring(0, 117) + '...' : aiText;
        // 摘要
        var summaryText = (p.summary || '').trim();

        // 唯一展开 ID
        var expandId = 'prompt-expand-' + date + '-' + ii;

        html += '<div class="stats-modal-item" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 20px;cursor:pointer;" onclick="togglePromptExpand(\\'' + expandId + '\\')">';

        // 第一行：序号 + 摘要/预览 + 时间
        html += '<div style="display:flex;align-items:center;gap:8px;width:100%;">';
        html += '<span style="font-size:12px;font-weight:700;color:#ec4899;flex-shrink:0;">#' + (p.promptIndex || (ii + 1)) + '</span>';
        html += '<span class="stats-modal-item-name" title="' + escHtml(summaryText || contentPreview) + '" style="font-size:13px;">' + escHtml(summaryText || contentPreview) + '</span>';
        html += '<span style="font-size:10px;color:#6b7280;flex-shrink:0;margin-left:auto;white-space:nowrap;">' + timeStr + '</span>';
        html += '</div>';

        // 标签行
        if (p.relatedTaskId || tagHtml) {
          html += '<div style="display:flex;align-items:center;gap:6px;padding-left:28px;flex-wrap:wrap;">';
          if (p.relatedTaskId) {
            html += '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.25);white-space:nowrap;">📌 ' + escHtml(p.relatedTaskId) + '</span>';
          }
          html += tagHtml;
          html += '</div>';
        }

        // 展开区域（默认隐藏）— 用户原始输入 + AI 理解
        html += '<div id="' + expandId + '" style="display:none;width:100%;padding-top:6px;border-top:1px solid rgba(75,85,99,0.3);margin-top:4px;">';

        // 用户原始输入
        html += '<div style="margin-bottom:8px;">';
        html += '<div style="font-size:10px;font-weight:600;color:#9ca3af;margin-bottom:3px;display:flex;align-items:center;gap:4px;">💬 用户原始输入</div>';
        html += '<div style="font-size:12px;color:#d1d5db;background:rgba(31,41,55,0.5);padding:8px 10px;border-radius:6px;border:1px solid rgba(75,85,99,0.3);white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;line-height:1.5;">' + escHtml(rawContent || '(未记录)') + '</div>';
        html += '</div>';

        // AI 理解
        if (aiText) {
          html += '<div style="margin-bottom:4px;">';
          html += '<div style="font-size:10px;font-weight:600;color:#9ca3af;margin-bottom:3px;display:flex;align-items:center;gap:4px;">🤖 AI 理解</div>';
          html += '<div style="font-size:12px;color:#a5b4fc;background:rgba(67,56,202,0.12);padding:8px 10px;border-radius:6px;border:1px solid rgba(99,102,241,0.2);white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;line-height:1.5;">' + escHtml(aiText) + '</div>';
          html += '</div>';
        }

        html += '</div>'; // end expand
        html += '</div>'; // end item
      }
      html += '</div>';
    }
    document.getElementById('statsModalBody').innerHTML = html;
  }).catch(function(err) {
    document.getElementById('statsModalBody').innerHTML = '<div style="text-align:center;padding:40px;color:#f87171;">加载失败: ' + escHtml(err.message) + '</div>';
  });
}

/** 切换 Prompt 展开/折叠 */
function togglePromptExpand(expandId) {
  var el = document.getElementById(expandId);
  if (!el) return;
  if (el.style.display === 'none') {
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
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
