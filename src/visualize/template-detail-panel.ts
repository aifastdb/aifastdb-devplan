/**
 * DevPlan 图可视化 — 共享详情面板模块
 *
 * 包含: 节点详情面板 (showPanel)、面板缩放、面板导航历史、
 * 工具函数 (row/statusBadge/escHtml/fmtTime)、文档内容加载、
 * Markdown 渲染、Phase 展开。
 *
 * 【共享设计】此面板同时服务于:
 * - vis-network 点击节点
 * - 3D Force Graph 点击节点
 * - 统计弹层列表点击
 */

export function getDetailPanelScript(): string {
  return `
// ========== Detail Panel ==========

/** 面板导航历史栈：存储节点 ID，用于"返回"功能 */
var panelHistory = [];
var currentPanelNodeId = null;

/** 从关联链接跳转到新面板（将当前节点压入历史栈）— 引擎无关 */
function navigateToPanel(nodeId) {
  if (currentPanelNodeId) {
    panelHistory.push(currentPanelNodeId);
  }
  // 选中节点（兼容所有引擎: vis-network / 3D wrapper / GraphCanvas）
  if (network && typeof network.selectNodes === 'function') {
    network.selectNodes([nodeId]);
  }
  highlightConnectedEdges(nodeId);
  showPanel(nodeId);
}

/** 返回上一个面板 — 引擎无关 */
function panelGoBack() {
  if (panelHistory.length === 0) return;
  var prevNodeId = panelHistory.pop();
  if (network && typeof network.selectNodes === 'function') {
    network.selectNodes([prevNodeId]);
  }
  highlightConnectedEdges(prevNodeId);
  showPanel(prevNodeId);
}

/** 更新返回按钮的可见性 */
function updateBackButton() {
  var btn = document.getElementById('panelBack');
  if (!btn) return;
  if (panelHistory.length > 0) {
    btn.classList.add('visible');
  } else {
    btn.classList.remove('visible');
  }
}

/** 根据主任务节点 ID，从 allNodes/allEdges 中查找其所有子任务节点 */
function getSubTasksForMainTask(mainTaskNodeId) {
  var subTaskIds = [];
  for (var i = 0; i < allEdges.length; i++) {
    var e = allEdges[i];
    if (e.from === mainTaskNodeId && e.label === 'has_sub_task') {
      subTaskIds.push(e.to);
    }
  }
  var subTasks = [];
  var idSet = {};
  for (var i = 0; i < subTaskIds.length; i++) idSet[subTaskIds[i]] = true;
  for (var i = 0; i < allNodes.length; i++) {
    if (idSet[allNodes[i].id]) {
      subTasks.push(allNodes[i]);
    }
  }
  return subTasks;
}

function getRelatedDocsForTask(taskNodeId) {
  var docIds = [];
  for (var i = 0; i < allEdges.length; i++) {
    var e = allEdges[i];
    if (e.from === taskNodeId && e.label === 'task_has_doc') {
      docIds.push(e.to);
    }
  }
  var docs = [];
  var idSet = {};
  for (var i = 0; i < docIds.length; i++) idSet[docIds[i]] = true;
  for (var i = 0; i < allNodes.length; i++) {
    if (idSet[allNodes[i].id]) docs.push(allNodes[i]);
  }
  return docs;
}

function getRelatedTasksForDoc(docNodeId) {
  var taskIds = [];
  for (var i = 0; i < allEdges.length; i++) {
    var e = allEdges[i];
    if (e.to === docNodeId && e.label === 'task_has_doc') {
      taskIds.push(e.from);
    }
  }
  var tasks = [];
  var idSet = {};
  for (var i = 0; i < taskIds.length; i++) idSet[taskIds[i]] = true;
  for (var i = 0; i < allNodes.length; i++) {
    if (idSet[allNodes[i].id]) tasks.push(allNodes[i]);
  }
  return tasks;
}

/** 跨引擎通用: 根据 nodeId 获取节点数据 */
function getNodeById(nodeId) {
  // 1. 优先从 nodesDataSet (vis-network DataSet / SimpleDataSet) 获取
  if (nodesDataSet) {
    var dsNode = nodesDataSet.get(nodeId);
    if (dsNode) return dsNode;
  }
  // 2. fallback: 从全局 allNodes 搜索并适配格式
  for (var i = 0; i < allNodes.length; i++) {
    if (allNodes[i].id === nodeId) {
      var n = allNodes[i];
      return {
        id: n.id,
        label: n.label || n._origLabel || '',
        _type: n._type || n.type || '',
        _props: n._props || n.properties || {}
      };
    }
  }
  return null;
}

function showPanel(nodeId) {
  var node = getNodeById(nodeId);
  if (!node) return;
  var panel = document.getElementById('panel');
  var header = document.getElementById('panelHeader');
  var title = document.getElementById('panelTitle');
  var body = document.getElementById('panelBody');

  header.className = 'panel-header ' + (node._type || '');
  var typeNames = { project: '项目', module: '模块', 'main-task': '主任务', 'sub-task': '子任务', document: '文档', memory: '记忆' };
  title.textContent = (typeNames[node._type] || '节点') + ' 详情';

  var p = node._props;
  var html = '<div class="panel-row"><span class="panel-label">名称</span><span class="panel-value">' + escHtml(node.label) + '</span></div>';

  if (node._type === 'main-task') {
    html += row('任务ID', p.taskId);
    html += row('优先级', '<span class="status-badge priority-' + (p.priority || 'P2') + '">' + (p.priority || 'P2') + '</span>');
    html += row('状态', statusBadge(p.status));
    if (p.completedAt) { html += row('完成时间', '<span style="color:#6ee7b7;">' + fmtTime(p.completedAt) + '</span>'); }
    if (p.totalSubtasks !== undefined) {
      var pct = p.totalSubtasks > 0 ? Math.round((p.completedSubtasks || 0) / p.totalSubtasks * 100) : 0;
      html += row('子任务', (p.completedSubtasks || 0) + '/' + p.totalSubtasks);
      html += '<div class="panel-progress"><div class="panel-progress-bar"><div class="panel-progress-fill" style="width:' + pct + '%"></div></div></div>';
    }

    // 查找并显示子任务列表
    var subTasks = getSubTasksForMainTask(nodeId);
    if (subTasks.length > 0) {
      var completedCount = 0;
      for (var si = 0; si < subTasks.length; si++) {
        if ((subTasks[si].properties || {}).status === 'completed') completedCount++;
      }
      html += '<div class="subtask-section">';
      html += '<div class="subtask-section-title"><span>子任务列表</span><span style="color:#6b7280;">' + completedCount + '/' + subTasks.length + '</span></div>';
      html += '<ul class="subtask-list">';
      // 排序：进行中 > 待开始 > 已完成 > 已取消
      var statusOrder = { in_progress: 0, pending: 1, completed: 2, cancelled: 3 };
      subTasks.sort(function(a, b) {
        var sa = (a.properties || {}).status || 'pending';
        var sb = (b.properties || {}).status || 'pending';
        return (statusOrder[sa] || 1) - (statusOrder[sb] || 1);
      });
      for (var si = 0; si < subTasks.length; si++) {
        var st = subTasks[si];
        var stProps = st.properties || {};
        var stStatus = stProps.status || 'pending';
        var stIcon = stStatus === 'completed' ? '✓' : stStatus === 'in_progress' ? '▶' : stStatus === 'cancelled' ? '✗' : '○';
        var stTime = stProps.completedAt ? fmtTime(stProps.completedAt) : '';
        html += '<li class="subtask-item">';
        html += '<span class="subtask-icon ' + stStatus + '">' + stIcon + '</span>';
        html += '<span class="subtask-name ' + stStatus + '" title="' + escHtml(st.label) + '">' + escHtml(st.label) + '</span>';
        if (stTime) { html += '<span class="subtask-time">' + stTime + '</span>'; }
        html += '<span class="subtask-id">' + escHtml(stProps.taskId || '') + '</span>';
        html += '</li>';
      }
      html += '</ul>';
      html += '</div>';
    }

    // 查找并显示关联文档
    var relDocs = getRelatedDocsForTask(nodeId);
    if (relDocs.length > 0) {
      html += '<div class="subtask-section">';
      html += '<div class="subtask-section-title"><span style="color:#f59e0b;">关联文档</span><span style="color:#6b7280;">' + relDocs.length + '</span></div>';
      html += '<ul class="subtask-list">';
      for (var di = 0; di < relDocs.length; di++) {
        var doc = relDocs[di];
        var docProps = doc.properties || {};
        var docLabel = docProps.section || '';
        if (docProps.subSection) docLabel += ' / ' + docProps.subSection;
        html += '<li class="subtask-item" style="cursor:pointer;" onclick="navigateToPanel(\\x27' + doc.id + '\\x27)">';
        html += '<span class="subtask-icon" style="color:#f59e0b;">&#x1F4C4;</span>';
        html += '<span class="subtask-name" title="' + escHtml(doc.label) + '">' + escHtml(doc.label) + '</span>';
        html += '<span class="subtask-id">' + escHtml(docLabel) + '</span>';
        html += '</li>';
      }
      html += '</ul>';
      html += '</div>';
    }
  } else if (node._type === 'sub-task') {
    html += row('任务ID', p.taskId);
    html += row('父任务', p.parentTaskId);
    html += row('状态', statusBadge(p.status));
    if (p.completedAt) { html += row('完成时间', '<span style="color:#6ee7b7;">' + fmtTime(p.completedAt) + '</span>'); }
  } else if (node._type === 'module') {
    html += row('模块ID', p.moduleId);
    html += row('状态', statusBadge(p.status || 'active'));
    html += row('主任务数', p.mainTaskCount);
  } else if (node._type === 'document') {
    html += row('类型', p.section);
    if (p.subSection) html += row('子类型', p.subSection);
    html += row('版本', p.version);

    // 查找并显示关联任务
    var relTasks = getRelatedTasksForDoc(nodeId);
    if (relTasks.length > 0) {
      html += '<div class="subtask-section">';
      html += '<div class="subtask-section-title"><span style="color:#6366f1;">关联任务</span><span style="color:#6b7280;">' + relTasks.length + '</span></div>';
      html += '<ul class="subtask-list">';
      for (var ti = 0; ti < relTasks.length; ti++) {
        var task = relTasks[ti];
        var tProps = task.properties || {};
        var tStatus = tProps.status || 'pending';
        var tIcon = tStatus === 'completed' ? '✓' : tStatus === 'in_progress' ? '▶' : '○';
        html += '<li class="subtask-item" style="cursor:pointer;" onclick="navigateToPanel(\\x27' + task.id + '\\x27)">';
        html += '<span class="subtask-icon ' + tStatus + '">' + tIcon + '</span>';
        html += '<span class="subtask-name" title="' + escHtml(task.label) + '">' + escHtml(task.label) + '</span>';
        html += '<span class="subtask-id">' + escHtml(tProps.taskId || '') + '</span>';
        html += '</li>';
      }
      html += '</ul>';
      html += '</div>';
    }

    // 文档内容区域 — 先显示加载中，稍后异步填充
    html += '<div class="doc-section">';
    html += '<div class="doc-section-title"><span>文档内容</span><button class="doc-toggle" id="docToggleBtn" onclick="toggleDocContent()">收起</button></div>';
    html += '<div id="docContentArea"><div class="doc-loading">加载中...</div></div>';
    html += '</div>';
  } else if (node._type === 'memory') {
    html += row('类型', '<span style="color:#e879f9;">' + escHtml(p.memoryType || '') + '</span>');
    html += row('重要性', '<span style="color:#fbbf24;">' + (p.importance != null ? p.importance : 0.5) + '</span>');
    html += row('访问次数', p.hitCount || 0);
    if (p.tags && p.tags.length > 0) {
      html += row('标签', p.tags.map(function(t) { return '<span style="background:#334155;padding:1px 6px;border-radius:4px;font-size:11px;margin-right:4px;">' + escHtml(t) + '</span>'; }).join(''));
    }
    if (p.relatedTaskId) { html += row('关联任务', p.relatedTaskId); }
    if (p.sourceId) { html += row('来源ID', p.sourceId); }
    html += '<div class="doc-section" style="margin-top:8px;">';
    html += '<div class="doc-section-title"><span>记忆内容</span></div>';
    html += '<div style="padding:8px;background:#0f172a;border-radius:8px;font-size:12px;line-height:1.6;color:#cbd5e1;white-space:pre-wrap;">' + escHtml(p.content || '') + '</div>';
    html += '</div>';
  } else if (node._type === 'project') {
    html += row('类型', '项目根节点');
  }

  body.innerHTML = html;
  panel.classList.add('show');
  currentPanelNodeId = nodeId;
  updateBackButton();

  // 如果是文档节点，异步加载内容
  if (node._type === 'document') {
    loadDocContent(p.section, p.subSection);
  }
}

function closePanel() {
  document.getElementById('panel').classList.remove('show');
  panelHistory = [];
  currentPanelNodeId = null;
  updateBackButton();
  resetAllEdgeColors();
}


// ========== Panel Resize ==========
var panelDefaultWidth = 340;
var panelExpandedWidth = 680;
var panelIsExpanded = false;
var panelResizing = false;

// 双击标题栏切换宽度
(function() {
  var header = document.getElementById('panelHeader');
  if (!header) return;
  header.addEventListener('dblclick', function(e) {
    // 不要在关闭按钮上触发
    if (e.target.closest && e.target.closest('.panel-close')) return;
    var panel = document.getElementById('panel');
    if (!panel) return;
    panelIsExpanded = !panelIsExpanded;
    var targetWidth = panelIsExpanded ? panelExpandedWidth : panelDefaultWidth;
    panel.style.transition = 'width 0.25s ease';
    panel.style.width = targetWidth + 'px';
    setTimeout(function() { panel.style.transition = 'none'; }, 260);
  });
})();

// 拖拽左边线调整宽度
(function() {
  var handle = document.getElementById('panelResizeHandle');
  var panel = document.getElementById('panel');
  if (!handle || !panel) return;

  var startX = 0;
  var startWidth = 0;

  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    e.stopPropagation();
    panelResizing = true;
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMouseMove(ev) {
      if (!panelResizing) return;
      // 面板在右侧，向左拖 = 增大宽度
      var dx = startX - ev.clientX;
      var newWidth = Math.max(280, Math.min(startWidth + dx, window.innerWidth - 40));
      panel.style.width = newWidth + 'px';
      panelIsExpanded = newWidth > (panelDefaultWidth + 50);
    }

    function onMouseUp() {
      panelResizing = false;
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
})();

function row(label, value) { return '<div class="panel-row"><span class="panel-label">' + label + '</span><span class="panel-value">' + (value || '-') + '</span></div>'; }
function statusBadge(s) { return '<span class="status-badge status-' + (s || 'pending') + '">' + statusText(s) + '</span>'; }
function statusText(s) { var m = { completed: '已完成', in_progress: '进行中', pending: '待开始', cancelled: '已取消', active: '活跃', planning: '规划中', deprecated: '已废弃' }; return m[s] || s || '未知'; }
function escHtml(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// 格式化时间戳（毫秒）为可读日期时间，当年省略年份
function fmtTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  var h = String(d.getHours()).padStart(2, '0');
  var min = String(d.getMinutes()).padStart(2, '0');
  var time = m + '-' + day + ' ' + h + ':' + min;
  if (d.getFullYear() !== new Date().getFullYear()) {
    time = d.getFullYear() + '-' + time;
  }
  return time;
}

/** 文档列表用的短日期格式：MM-DD 或 YYYY-MM-DD */
function fmtDateShort(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  if (d.getFullYear() !== new Date().getFullYear()) {
    return d.getFullYear() + '-' + m + '-' + day;
  }
  return m + '-' + day;
}


// ========== Phase Expand (Stats page) ==========
function togglePhaseExpand(el) {
  var wrap = el.closest('.phase-item-wrap');
  if (wrap) wrap.classList.toggle('expanded');
}


// ========== Document Content ==========
var docContentVisible = true;

function toggleDocContent() {
  var area = document.getElementById('docContentArea');
  var btn = document.getElementById('docToggleBtn');
  if (!area) return;
  docContentVisible = !docContentVisible;
  area.style.display = docContentVisible ? 'block' : 'none';
  if (btn) btn.textContent = docContentVisible ? '收起' : '展开';
}

function loadDocContent(section, subSection) {
  var area = document.getElementById('docContentArea');
  if (!area) return;
  var url = '/api/doc?section=' + encodeURIComponent(section || '');
  if (subSection) url += '&subSection=' + encodeURIComponent(subSection);

  fetch(url).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(doc) {
    if (!doc || !doc.content) {
      area.innerHTML = '<div class="doc-error">文档内容为空</div>';
      return;
    }
    area.innerHTML = '<div class="doc-content mdv-body">' + renderMarkdown(doc.content) + '</div>';
    // 后处理：代码高亮、复制按钮、表格包裹等
    var mdvEl = area.querySelector('.mdv-body');
    if (mdvEl && typeof mdEnhanceContent === 'function') mdEnhanceContent(mdvEl);
    docContentVisible = true;
    var btn = document.getElementById('docToggleBtn');
    if (btn) btn.textContent = '收起';
  }).catch(function(err) {
    area.innerHTML = '<div class="doc-error">加载失败: ' + escHtml(err.message) + '</div>';
  });
}

/** 预处理：修复无表头的孤立管道行块 → 合法 Markdown 表格 */
function fixOrphanPipeRows(md) {
  var lines = md.split('\\n');
  var result = [];
  var pipeBlock = [];

  function flushBlock() {
    if (pipeBlock.length < 1) return;
    // 检查此块前方是否紧跟分隔行（说明已有表头）
    var prevIdx = result.length - 1;
    var hasSep = false;
    // 块内是否已有分隔行
    for (var k = 0; k < pipeBlock.length; k++) {
      if (/^\\|[\\s\\-:|]+\\|\\s*$/.test(pipeBlock[k])) { hasSep = true; break; }
    }
    if (!hasSep) {
      // 计算列数并生成分隔行
      var cols = pipeBlock[0].split('|').filter(function(c, i, a) { return i > 0 && i < a.length - 1; }).length;
      var sep = '|' + Array(cols).fill(' --- ').join('|') + '|';
      // 第一行当表头，插入分隔行
      result.push(pipeBlock[0]);
      result.push(sep);
      for (var k = 1; k < pipeBlock.length; k++) result.push(pipeBlock[k]);
    } else {
      for (var k = 0; k < pipeBlock.length; k++) result.push(pipeBlock[k]);
    }
    pipeBlock = [];
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\\|.+\\|\\s*$/.test(line)) {
      pipeBlock.push(line);
    } else {
      if (pipeBlock.length > 0) flushBlock();
      result.push(line);
    }
  }
  if (pipeBlock.length > 0) flushBlock();
  return result.join('\\n');
}

/** Markdown 渲染 — 优先使用 marked.js（CDN），降级到简易解析器 */
function renderMarkdown(md) {
  if (!md) return '';

  // 预处理：修复字面 \\n 文本为真实换行符（部分文档存储时换行被转义）
  if (md.indexOf('\\\\n') !== -1) {
    md = md.replace(/\\\\n/g, '\\n');
  }

  // 预处理：修复孤立管道行
  md = fixOrphanPipeRows(md);

  // 优先使用 marked.js（由 MD Viewer CDN 加载）
  if (typeof marked !== 'undefined') {
    try { return marked.parse(md); } catch(e) { console.warn('marked.parse fallback:', e); }
  }

  // 先处理代码块（防止内部被其他规则干扰）
  var codeBlocks = [];
  md = md.replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, function(m, lang, code) {
    var idx = codeBlocks.length;
    codeBlocks.push('<pre><code>' + escHtml(code.replace(/\\n$/, '')) + '</code></pre>');
    return '%%CODEBLOCK_' + idx + '%%';
  });

  // 按行处理
  var lines = md.split('\\n');
  var html = '';
  var inTable = false;
  var inList = false;
  var listType = '';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // 代码块占位符
    var cbMatch = line.match(/^%%CODEBLOCK_(\\d+)%%$/);
    if (cbMatch) {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      if (inTable) { html += '</table>'; inTable = false; }
      html += codeBlocks[parseInt(cbMatch[1])];
      continue;
    }

    // 表格行
    if (line.match(/^\\|(.+)\\|\\s*$/)) {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      // 跳过分隔行
      if (line.match(/^\\|[\\s\\-:|]+\\|\\s*$/)) continue;
      var cells = line.split('|').filter(function(c, idx, arr) { return idx > 0 && idx < arr.length - 1; });
      if (!inTable) {
        html += '<table>';
        html += '<tr>' + cells.map(function(c) { return '<th>' + inlineFormat(c.trim()) + '</th>'; }).join('') + '</tr>';
        inTable = true;
      } else {
        html += '<tr>' + cells.map(function(c) { return '<td>' + inlineFormat(c.trim()) + '</td>'; }).join('') + '</tr>';
      }
      continue;
    } else if (inTable) {
      html += '</table>';
      inTable = false;
    }

    // 空行
    if (line.trim() === '') {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      continue;
    }

    // 标题
    var hMatch = line.match(/^(#{1,4})\\s+(.+)$/);
    if (hMatch) {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      var level = hMatch[1].length;
      html += '<h' + level + '>' + inlineFormat(hMatch[2]) + '</h' + level + '>';
      continue;
    }

    // 分隔线
    if (line.match(/^(\\*{3,}|-{3,}|_{3,})\\s*$/)) {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      html += '<hr>';
      continue;
    }

    // 引用
    if (line.match(/^>\\s?/)) {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      html += '<blockquote>' + inlineFormat(line.replace(/^>\\s?/, '')) + '</blockquote>';
      continue;
    }

    // 无序列表
    var ulMatch = line.match(/^\\s*[-*+]\\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) html += '</' + listType + '>';
        html += '<ul>';
        inList = true;
        listType = 'ul';
      }
      html += '<li>' + inlineFormat(ulMatch[1]) + '</li>';
      continue;
    }

    // 有序列表
    var olMatch = line.match(/^\\s*\\d+\\.\\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) html += '</' + listType + '>';
        html += '<ol>';
        inList = true;
        listType = 'ol';
      }
      html += '<li>' + inlineFormat(olMatch[1]) + '</li>';
      continue;
    }

    // 普通段落
    if (inList) { html += '</' + listType + '>'; inList = false; }
    html += '<p>' + inlineFormat(line) + '</p>';
  }

  if (inList) html += '</' + listType + '>';
  if (inTable) html += '</table>';

  return html;
}

/** 行内格式化：粗体、斜体、行内代码、链接 */
function inlineFormat(text) {
  if (!text) return '';
  // 行内代码
  text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  // 粗体
  text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // 斜体
  text = text.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
  text = text.replace(/_(.+?)_/g, '<em>$1</em>');
  // 链接
  text = text.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');
  return text;
}

`;
}
