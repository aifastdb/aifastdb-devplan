/**
 * DevPlan 图可视化 — 页面模块
 *
 * 包含: 文档浏览页、RAG 聊天、统计仪表盘。
 */

export function getPagesScript(): string {
  return `
// ========== Docs Browser ==========
var docsLoaded = false;
var docsData = [];       // 全部文档列表
var currentDocKey = '';  // 当前选中文档的 key (section|subSection)

/** 根据 docKey 从 docsData 中查找文档标题 */
function findDocTitle(docKey) {
  for (var i = 0; i < docsData.length; i++) {
    var d = docsData[i];
    var key = d.section + (d.subSection ? '|' + d.subSection : '');
    if (key === docKey) return d.title;
  }
  return null;
}

/** Section 类型的中文名称映射 */
var SECTION_NAMES = {
  overview: '概述', core_concepts: '核心概念', api_design: 'API 设计',
  file_structure: '文件结构', config: '配置', examples: '使用示例',
  technical_notes: '技术笔记', api_endpoints: 'API 端点',
  milestones: '里程碑', changelog: '变更记录', custom: '自定义'
};

/** Section 图标映射（使用简洁符号替代 emoji） */
var SECTION_ICONS = {
  overview: '▸', core_concepts: '▸', api_design: '▸',
  file_structure: '▸', config: '▸', examples: '▸',
  technical_notes: '▸', api_endpoints: '▸',
  milestones: '▸', changelog: '▸', custom: '▸'
};

/** 加载文档数据（全局共享，仅请求一次） */
function loadDocsData(callback) {
  if (docsLoaded && docsData.length > 0) {
    if (callback) callback(docsData, null);
    return;
  }
  fetch('/api/docs').then(function(r) { return r.json(); }).then(function(data) {
    docsData = data.docs || [];
    docsLoaded = true;
    if (callback) callback(docsData, null);
  }).catch(function(err) {
    if (callback) callback(null, err);
  });
}

function loadDocsPage() {
  var list = document.getElementById('docsGroupList');
  // 数据已加载（可能由全局文档弹层预先加载），直接渲染到侧边栏
  if (docsLoaded && docsData.length > 0) {
    renderDocsList(docsData);
    return;
  }
  if (list) list.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;font-size:12px;"><div class="spinner" style="margin:0 auto 12px;width:24px;height:24px;border-width:3px;"></div>加载文档列表...</div>';

  loadDocsData(function(data, err) {
    if (err) {
      if (list) list.innerHTML = '<div style="text-align:center;padding:40px;color:#f87171;font-size:12px;">加载失败: ' + err.message + '<br><span style="cursor:pointer;color:#818cf8;text-decoration:underline;" onclick="docsLoaded=false;loadDocsPage();">重试</span></div>';
      return;
    }
    renderDocsList(docsData);
  });
}

/** 获取文档的 key（唯一标识） */
function docItemKey(item) {
  return item.section + (item.subSection ? '|' + item.subSection : '');
}

/** 记录哪些父文档处于折叠状态（key → true 表示折叠） */
var docsCollapsedState = {};

/** 将文档列表按 section 分组渲染，支持 parentDoc 层级
 *  @param docs      - 文档数组
 *  @param targetId  - 渲染目标容器 ID (默认 'docsGroupList')
 *  @param selectFn  - 点击文档时调用的函数名 (默认 'selectDoc')
 */
function renderDocsList(docs, targetId, selectFn) {
  var list = document.getElementById(targetId || 'docsGroupList');
  if (!list) return;
  selectFn = selectFn || 'selectDoc';

  // 建立 parentDoc → children 映射，区分顶级和子文档
  var childrenMap = {};  // parentDocKey → [child items]
  var childKeySet = {};  // 属于子文档的 key 集合
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i];
    if (d.parentDoc) {
      if (!childrenMap[d.parentDoc]) childrenMap[d.parentDoc] = [];
      childrenMap[d.parentDoc].push(d);
      childKeySet[docItemKey(d)] = true;
    }
  }

  // 按 section 分组（只放顶级文档）
  var groups = {};
  var groupOrder = [];
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i];
    var key = docItemKey(d);
    if (childKeySet[key]) continue; // 跳过子文档（由父文档渲染）
    var sec = d.section;
    if (!groups[sec]) {
      groups[sec] = [];
      groupOrder.push(sec);
    }
    groups[sec].push(d);
  }

  // 每组内按 updatedAt 倒序排列（最新的在上方）
  for (var gi = 0; gi < groupOrder.length; gi++) {
    groups[groupOrder[gi]].sort(function(a, b) {
      var ta = a.updatedAt || 0;
      var tb = b.updatedAt || 0;
      return tb - ta; // 降序
    });
  }

  // 子文档也按 updatedAt 倒序
  var parentKeys = Object.keys(childrenMap);
  for (var pi = 0; pi < parentKeys.length; pi++) {
    childrenMap[parentKeys[pi]].sort(function(a, b) {
      var ta = a.updatedAt || 0;
      var tb = b.updatedAt || 0;
      return tb - ta;
    });
  }

  // 分组按最新文档日期排序（最新的分组在上）
  groupOrder.sort(function(secA, secB) {
    var maxA = 0, maxB = 0;
    var itemsA = groups[secA] || [];
    var itemsB = groups[secB] || [];
    for (var k = 0; k < itemsA.length; k++) {
      if ((itemsA[k].updatedAt || 0) > maxA) maxA = itemsA[k].updatedAt || 0;
    }
    for (var k = 0; k < itemsB.length; k++) {
      if ((itemsB[k].updatedAt || 0) > maxB) maxB = itemsB[k].updatedAt || 0;
    }
    return maxB - maxA;
  });

  if (groupOrder.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;font-size:12px;">暂无文档</div>';
    return;
  }

  var html = '';
  for (var gi = 0; gi < groupOrder.length; gi++) {
    var sec = groupOrder[gi];
    var items = groups[sec];
    var secName = SECTION_NAMES[sec] || sec;
    var secIcon = SECTION_ICONS[sec] || '▸';

    // 计算此分组下文档总数（含子文档）
    var totalCount = 0;
    for (var ci = 0; ci < docs.length; ci++) {
      if (docs[ci].section === sec) totalCount++;
    }

    html += '<div class="docs-group" data-section="' + sec + '">';
    html += '<div class="docs-group-title" onclick="toggleDocsGroup(this)">';
    html += '<span class="docs-group-arrow">▼</span>';
    html += '<span>' + secName + '</span>';
    html += '<span class="docs-group-count">' + totalCount + '</span>';
    html += '</div>';
    html += '<div class="docs-group-items">';

    for (var ii = 0; ii < items.length; ii++) {
      html += renderDocItemWithChildren(items[ii], childrenMap, secIcon, selectFn);
    }

    html += '</div></div>';
  }

  list.innerHTML = html;
}

/** 递归渲染文档项及其子文档
 *  @param selectFn - 点击时调用的函数名 (默认 'selectDoc')
 */
function renderDocItemWithChildren(item, childrenMap, secIcon, selectFn) {
  selectFn = selectFn || 'selectDoc';
  var docKey = docItemKey(item);
  var isActive = docKey === currentDocKey ? ' active' : '';
  var children = childrenMap[docKey] || [];
  var hasChildren = children.length > 0;
  var isCollapsed = docsCollapsedState[docKey] === true;

  var html = '<div class="docs-item-wrapper">';

  // 文档项本身
  html += '<div class="docs-item' + isActive + '" data-key="' + escHtml(docKey) + '" onclick="' + selectFn + '(\\x27' + docKey.replace(/'/g, "\\\\'") + '\\x27)">';

  if (hasChildren) {
    var toggleIcon = isCollapsed ? '+' : '−';
    html += '<span class="docs-item-toggle" onclick="event.stopPropagation();toggleDocChildren(\\x27' + docKey.replace(/'/g, "\\\\'") + '\\x27)" title="' + (isCollapsed ? '展开子文档' : '收起子文档') + '">' + toggleIcon + '</span>';
  }

  // 不显示 emoji 图标，仅保留标题
  html += '<span class="docs-item-text" title="' + escHtml(item.title) + '">' + escHtml(item.title) + '</span>';
  if (hasChildren) {
    html += '<span class="docs-item-sub" style="color:#818cf8;">' + children.length + ' 子文档</span>';
  }
  // 右侧显示日期（替代原来的 subSection 标签）
  if (item.updatedAt) {
    html += '<span class="docs-item-sub">' + fmtDateShort(item.updatedAt) + '</span>';
  }
  html += '</div>';

  // 子文档列表
  if (hasChildren) {
    html += '<div class="docs-children' + (isCollapsed ? ' collapsed' : '') + '" data-parent="' + escHtml(docKey) + '">';
    for (var ci = 0; ci < children.length; ci++) {
      html += renderDocItemWithChildren(children[ci], childrenMap, secIcon, selectFn);
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

/** 展开/折叠子文档 */
function toggleDocChildren(docKey) {
  docsCollapsedState[docKey] = !docsCollapsedState[docKey];
  var container = document.querySelector('.docs-children[data-parent="' + docKey + '"]');
  if (!container) return;
  container.classList.toggle('collapsed');
  // 更新切换按钮图标
  var wrapper = container.previousElementSibling;
  if (wrapper) {
    var toggle = wrapper.querySelector('.docs-item-toggle');
    if (toggle) {
      toggle.textContent = docsCollapsedState[docKey] ? '+' : '−';
      toggle.title = docsCollapsedState[docKey] ? '展开子文档' : '收起子文档';
    }
  }
}

/** 展开/折叠文档分组 */
function toggleDocsGroup(el) {
  var group = el.closest('.docs-group');
  if (group) group.classList.toggle('collapsed');
}

/** 控制搜索框清除按钮的显示/隐藏
 *  @param searchId   - 搜索输入框 ID (默认 'docsSearch')
 *  @param clearBtnId - 清除按钮 ID (默认 'docsSearchClear')
 */
function toggleSearchClear(searchId, clearBtnId) {
  var input = document.getElementById(searchId || 'docsSearch');
  var btn = document.getElementById(clearBtnId || 'docsSearchClear');
  if (input && btn) {
    if (input.value.length > 0) { btn.classList.add('show'); } else { btn.classList.remove('show'); }
  }
}

/** 清空搜索框并重置列表
 *  @param searchId   - 搜索输入框 ID (默认 'docsSearch')
 *  @param clearBtnId - 清除按钮 ID (默认 'docsSearchClear')
 *  @param targetId   - 渲染目标容器 ID (默认 'docsGroupList')
 *  @param selectFn   - 点击文档时调用的函数名 (默认 'selectDoc')
 */
function clearDocsSearch(searchId, clearBtnId, targetId, selectFn) {
  var input = document.getElementById(searchId || 'docsSearch');
  if (input) { input.value = ''; input.focus(); }
  toggleSearchClear(searchId, clearBtnId);
  filterDocs(searchId, targetId, selectFn);
}

/** 搜索过滤文档列表
 *  @param searchId  - 搜索输入框 ID (默认 'docsSearch')
 *  @param targetId  - 渲染目标容器 ID (默认 'docsGroupList')
 *  @param selectFn  - 点击文档时调用的函数名 (默认 'selectDoc')
 */
function filterDocs(searchId, targetId, selectFn) {
  var input = document.getElementById(searchId || 'docsSearch');
  var query = (input ? input.value || '' : '').toLowerCase().trim();
  if (!query) {
    renderDocsList(docsData, targetId, selectFn);
    return;
  }
  var filtered = [];
  for (var i = 0; i < docsData.length; i++) {
    var d = docsData[i];
    var text = (d.title || '') + ' ' + (d.section || '') + ' ' + (d.subSection || '');
    if (text.toLowerCase().indexOf(query) >= 0) {
      filtered.push(d);
    }
  }
  renderDocsList(filtered, targetId, selectFn);
}

/** 选中并加载文档内容 */
function selectDoc(docKey) {
  currentDocKey = docKey;

  // 更新左侧选中状态
  var items = document.querySelectorAll('.docs-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove('active');
    if (items[i].getAttribute('data-key') === docKey) {
      items[i].classList.add('active');
    }
  }

  // 解析 key
  var parts = docKey.split('|');
  var section = parts[0];
  var subSection = parts[1] || null;

  // 显示内容区，隐藏空状态
  document.getElementById('docsEmptyState').style.display = 'none';
  var contentView = document.getElementById('docsContentView');
  contentView.style.display = 'flex';

  // 显示加载状态
  document.getElementById('docsContentTitle').textContent = '加载中...';
  document.getElementById('docsContentMeta').innerHTML = '';
  document.getElementById('docsContentInner').innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;"><div class="spinner" style="margin:0 auto 12px;width:24px;height:24px;border-width:3px;"></div></div>';

  // 请求文档内容
  var url = '/api/doc?section=' + encodeURIComponent(section);
  if (subSection) url += '&subSection=' + encodeURIComponent(subSection);

  fetch(url).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(doc) {
    renderDocContent(doc, section, subSection);
  }).catch(function(err) {
    document.getElementById('docsContentTitle').textContent = '加载失败';
    document.getElementById('docsContentInner').innerHTML = '<div style="text-align:center;padding:40px;color:#f87171;">加载失败: ' + escHtml(err.message) + '</div>';
  });
}

/** 渲染文档内容到右侧面板 */
function renderDocContent(doc, section, subSection) {
  var secName = SECTION_NAMES[section] || section;

  // 标题
  document.getElementById('docsContentTitle').textContent = doc.title || secName;

  // 元信息标签
  var metaHtml = '<span class="docs-content-tag section">' + secName + '</span>';
  if (subSection) {
    metaHtml += '<span class="docs-content-tag section">' + escHtml(subSection) + '</span>';
  }
  if (doc.version) {
    metaHtml += '<span class="docs-content-tag version">v' + escHtml(doc.version) + '</span>';
  }
  if (doc.updatedAt) {
    metaHtml += '<span class="docs-content-tag">' + fmtTime(doc.updatedAt) + '</span>';
  }
  if (doc.id) {
    metaHtml += '<span class="docs-content-tag docs-id-tag" title="点击复制 ID" style="cursor:pointer;font-family:monospace;font-size:10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" onclick="navigator.clipboard.writeText(\\x27' + escHtml(doc.id) + '\\x27).then(function(){var t=event.target;t.textContent=\\x27✓ 已复制\\x27;setTimeout(function(){t.textContent=\\x27ID: ' + escHtml(doc.id.slice(0,8)) + '…\\x27},1200)})">ID: ' + escHtml(doc.id.slice(0,8)) + '…</span>';
  }
  document.getElementById('docsContentMeta').innerHTML = metaHtml;

  // Markdown 内容
  var contentHtml = '';
  if (doc.content) {
    contentHtml = renderMarkdown(doc.content);
  } else {
    contentHtml = '<div style="text-align:center;padding:40px;color:#6b7280;">文档内容为空</div>';
  }

  // 父文档链接
  if (doc.parentDoc) {
    var parentTitle = findDocTitle(doc.parentDoc);
    contentHtml += '<div class="docs-related" style="margin-top: 12px;">';
    contentHtml += '<div class="docs-related-title">⬆️ 父文档</div>';
    contentHtml += '<div class="docs-related-item" style="cursor:pointer;" onclick="selectDoc(\\x27' + doc.parentDoc.replace(/'/g, "\\\\'") + '\\x27)">';
    contentHtml += '<span class="rel-icon" style="background:#1e3a5f;color:#93c5fd;">📄</span>';
    contentHtml += '<span style="flex:1;color:#818cf8;">' + escHtml(parentTitle || doc.parentDoc) + '</span>';
    contentHtml += '<span style="font-size:10px;color:#6b7280;font-family:monospace;">' + escHtml(doc.parentDoc) + '</span>';
    contentHtml += '</div></div>';
  }

  // 子文档列表
  var childDocs = doc.childDocs || [];
  if (childDocs.length > 0) {
    contentHtml += '<div class="docs-related" style="margin-top: 12px;">';
    contentHtml += '<div class="docs-related-title">⬇️ 子文档 (' + childDocs.length + ')</div>';
    for (var ci = 0; ci < childDocs.length; ci++) {
      var childKey = childDocs[ci];
      var childTitle = findDocTitle(childKey);
      contentHtml += '<div class="docs-related-item" style="cursor:pointer;" onclick="selectDoc(\\x27' + childKey.replace(/'/g, "\\\\'") + '\\x27)">';
      contentHtml += '<span class="rel-icon" style="background:#1e1b4b;color:#c084fc;">📄</span>';
      contentHtml += '<span style="flex:1;color:#c084fc;">' + escHtml(childTitle || childKey) + '</span>';
      contentHtml += '<span style="font-size:10px;color:#6b7280;font-family:monospace;">' + escHtml(childKey) + '</span>';
      contentHtml += '</div>';
    }
    contentHtml += '</div>';
  }

  // 关联任务
  var relatedTasks = doc.relatedTasks || [];
  if (relatedTasks.length > 0) {
    contentHtml += '<div class="docs-related">';
    contentHtml += '<div class="docs-related-title">🔗 关联任务 (' + relatedTasks.length + ')</div>';
    for (var i = 0; i < relatedTasks.length; i++) {
      var t = relatedTasks[i];
      var tStatus = t.status || 'pending';
      var tIcon = tStatus === 'completed' ? '✓' : tStatus === 'in_progress' ? '▶' : '○';
      var iconBg = tStatus === 'completed' ? '#064e3b' : tStatus === 'in_progress' ? '#1e3a5f' : '#374151';
      var iconColor = tStatus === 'completed' ? '#6ee7b7' : tStatus === 'in_progress' ? '#93c5fd' : '#6b7280';
      contentHtml += '<div class="docs-related-item">';
      contentHtml += '<span class="rel-icon" style="background:' + iconBg + ';color:' + iconColor + ';">' + tIcon + '</span>';
      contentHtml += '<span style="flex:1;">' + escHtml(t.title) + '</span>';
      contentHtml += '<span style="font-size:10px;color:#6b7280;font-family:monospace;">' + escHtml(t.taskId) + '</span>';
      if (t.priority) {
        contentHtml += '<span class="status-badge priority-' + t.priority + '" style="font-size:10px;">' + t.priority + '</span>';
      }
      contentHtml += '</div>';
    }
    contentHtml += '</div>';
  }

  var innerEl = document.getElementById('docsContentInner');
  innerEl.innerHTML = contentHtml;
  // 后处理：代码高亮、复制按钮、表格包裹等
  if (typeof mdEnhanceContent === 'function') mdEnhanceContent(innerEl);
  // 生成右侧目录导航
  docsBuildToc();
}

// ========== Docs TOC ==========
var _docsTocCleanup = null;

function docsBuildToc() {
  var tocList = document.getElementById('docsTocList');
  var tocPanel = document.getElementById('docsTocPanel');
  var inner = document.getElementById('docsContentInner');
  if (!tocList || !tocPanel || !inner) return;
  tocList.innerHTML = '';

  var headings = inner.querySelectorAll('h1,h2,h3,h4,h5,h6');
  if (headings.length < 2) {
    tocPanel.style.display = 'none';
    return;
  }

  var minLv = 6;
  for (var i = 0; i < headings.length; i++) {
    var lv = parseInt(headings[i].tagName[1]);
    if (lv < minLv) minLv = lv;
  }

  for (var i = 0; i < headings.length; i++) {
    var h = headings[i];
    var indent = parseInt(h.tagName[1]) - minLv;
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    a.dataset.tid = h.id;
    if (indent > 0) a.className = 'indent-' + Math.min(indent, 4);
    a.onclick = (function(target) {
      return function(e) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    })(h);
    li.appendChild(a);
    tocList.appendChild(li);
  }

  tocPanel.style.display = '';
  docsSetupScrollSpy(headings);
}

function docsSetupScrollSpy(headings) {
  var scrollArea = document.getElementById('docsContentBody');
  var tocList = document.getElementById('docsTocList');
  if (!scrollArea || !tocList) return;

  // 清理之前的监听器
  if (_docsTocCleanup) { _docsTocCleanup(); _docsTocCleanup = null; }

  var links = tocList.querySelectorAll('a');
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function() {
      var cur = '';
      for (var i = 0; i < headings.length; i++) {
        var rect = headings[i].getBoundingClientRect();
        if (rect.top <= 120) cur = headings[i].id;
      }
      for (var i = 0; i < links.length; i++) {
        links[i].classList.toggle('active', links[i].dataset.tid === cur);
      }
      ticking = false;
    });
  }

  scrollArea.addEventListener('scroll', onScroll, { passive: true });
  _docsTocCleanup = function() {
    scrollArea.removeEventListener('scroll', onScroll);
  };
  onScroll();
}

// ========== RAG Chat ==========
var chatHistory = []; // [{role:'user'|'assistant', content:string, results?:array}]
var chatBusy = false;

/** 点击推荐话题 */
function chatSendTip(el) {
  var input = document.getElementById('docsChatInput');
  if (input) { input.value = el.textContent; chatSend(); }
}

/** Enter 发送（Shift+Enter 换行） */
function chatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatSend();
  }
}

/** 自动调整 textarea 高度 */
function chatAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

/** 发送消息并搜索 */
function chatSend() {
  if (chatBusy) return;
  var input = document.getElementById('docsChatInput');
  var query = (input.value || '').trim();
  if (!query) return;

  // 隐藏欢迎信息
  var welcome = document.getElementById('docsChatWelcome');
  if (welcome) welcome.style.display = 'none';

  // 添加用户消息
  chatHistory.push({ role: 'user', content: query });
  chatRenderBubble('user', query);
  input.value = '';
  chatAutoResize(input);

  // 显示加载动画
  chatBusy = true;
  document.getElementById('docsChatSend').disabled = true;
  var loadingId = 'chat-loading-' + Date.now();
  var msgBox = document.getElementById('docsChatMessages');
  var loadingHtml = '<div class="chat-bubble assistant" id="' + loadingId + '"><div class="chat-bubble-inner"><div class="chat-typing"><div class="chat-typing-dot"></div><div class="chat-typing-dot"></div><div class="chat-typing-dot"></div></div></div></div>';
  msgBox.insertAdjacentHTML('beforeend', loadingHtml);
  msgBox.scrollTop = msgBox.scrollHeight;

  // 调用搜索 API
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query, limit: 5 })
  }).then(function(r) { return r.json(); }).then(function(data) {
    // 移除加载动画
    var loadEl = document.getElementById(loadingId);
    if (loadEl) loadEl.remove();

    var replyHtml = '';

    if (data.type === 'meta') {
      // ---- 元信息直接回答 ----
      replyHtml = chatFormatMarkdown(data.answer || '');
    } else {
      // ---- 文档搜索结果 ----
      var results = data.results || [];
      if (results.length > 0) {
        replyHtml += '<div style="margin-bottom:8px;color:#9ca3af;font-size:12px;">找到 <strong style="color:#a5b4fc;">' + results.length + '</strong> 篇相关文档';
        if (data.mode === 'hybrid') replyHtml += ' <span style="font-size:10px;color:#6b7280;">(语义+字面混合)</span>';
        else if (data.mode === 'semantic') replyHtml += ' <span style="font-size:10px;color:#6b7280;">(语义搜索)</span>';
        else replyHtml += ' <span style="font-size:10px;color:#6b7280;">(字面搜索)</span>';
        replyHtml += '</div>';

        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          var docKey = r.section + (r.subSection ? '|' + r.subSection : '');
          replyHtml += '<div class="chat-result-card" onclick="chatOpenDoc(\\x27' + docKey.replace(/'/g, "\\\\'") + '\\x27)">';
          replyHtml += '<div class="chat-result-title">';
          replyHtml += '<span>📄 ' + escHtml(r.title) + '</span>';
          if (r.score != null) replyHtml += '<span class="chat-result-score">' + r.score.toFixed(3) + '</span>';
          replyHtml += '</div>';
          if (r.snippet) replyHtml += '<div class="chat-result-snippet">' + escHtml(r.snippet) + '</div>';
          var metaParts = [];
          if (r.section) metaParts.push(r.section);
          if (r.updatedAt) metaParts.push(fmtDateShort(r.updatedAt));
          if (r.version) metaParts.push('v' + r.version);
          if (metaParts.length > 0) replyHtml += '<div class="chat-result-meta">' + metaParts.join(' · ') + '</div>';
          replyHtml += '</div>';
        }
      } else {
        replyHtml += '<div class="chat-no-result">🤔 未找到高度相关的文档。</div>';
        replyHtml += '<div style="margin-top:8px;font-size:12px;color:#6b7280;line-height:1.6;">';
        replyHtml += '建议：<br>';
        replyHtml += '• 尝试使用更具体的 <strong>关键词</strong>（如 "向量搜索"、"GPU"、"LanceDB"）<br>';
        replyHtml += '• 问项目统计问题（如 "有多少篇文档"、"项目进度"、"有哪些阶段"）<br>';
        replyHtml += '• 输入 <strong>"帮助"</strong> 查看我的全部能力';
        replyHtml += '</div>';
      }
    }

    chatHistory.push({ role: 'assistant', content: replyHtml, results: data.results || [] });
    chatRenderBubble('assistant', replyHtml, true);

  }).catch(function(err) {
    var loadEl = document.getElementById(loadingId);
    if (loadEl) loadEl.remove();
    chatRenderBubble('assistant', '<span style="color:#f87171;">搜索出错: ' + escHtml(err.message) + '</span>', true);
  }).finally(function() {
    chatBusy = false;
    document.getElementById('docsChatSend').disabled = false;
    document.getElementById('docsChatInput').focus();
  });
}

/** 简单 Markdown → HTML 转换（用于元信息回答） */
function chatFormatMarkdown(text) {
  return text
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong style="color:#a5b4fc;">$1</strong>')
    .replace(/\\n/g, '<br>');
}

/** 渲染一条消息气泡 */
function chatRenderBubble(role, content, isHtml) {
  var msgBox = document.getElementById('docsChatMessages');
  var bubble = document.createElement('div');
  bubble.className = 'chat-bubble ' + role;
  var inner = document.createElement('div');
  inner.className = 'chat-bubble-inner';
  if (isHtml) { inner.innerHTML = content; }
  else { inner.textContent = content; }
  bubble.appendChild(inner);
  msgBox.appendChild(bubble);
  msgBox.scrollTop = msgBox.scrollHeight;
}

/** 从聊天结果中点击打开文档 */
function chatOpenDoc(docKey) {
  selectDoc(docKey);
}

/** 返回聊天视图 */
function backToChat() {
  document.getElementById('docsContentView').style.display = 'none';
  document.getElementById('docsEmptyState').style.display = 'flex';
  // 取消左侧选中
  currentDocKey = '';
  var items = document.querySelectorAll('.docs-item');
  for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
  // 聚焦输入框
  var input = document.getElementById('docsChatInput');
  if (input) input.focus();
}


// ========== Stats Dashboard ==========
var statsLoaded = false;

function loadStatsPage() {
  var container = document.getElementById('statsContent');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280;"><div class="spinner" style="margin:0 auto 12px;"></div>加载统计数据...</div>';

  fetch('/api/stats').then(function(r) { return r.json(); }).then(function(data) {
    statsLoaded = true;
    renderStatsPage(data);
  }).catch(function(err) {
    container.innerHTML = '<div style="text-align:center;padding:60px;color:#f87171;">加载失败: ' + err.message + '<br><button class="refresh-btn" onclick="loadStatsPage()" style="margin-top:12px;">重试</button></div>';
  });
}

function renderStatsPage(data) {
  var container = document.getElementById('statsContent');
  if (!container) return;

  var pct = data.overallPercent || 0;
  var totalSub = data.subTaskCount || 0;
  var doneSub = data.completedSubTasks || 0;
  var totalMain = data.mainTaskCount || 0;
  var doneMain = data.completedMainTasks || 0;
  var docCount = data.docCount || 0;
  var modCount = data.moduleCount || 0;

  // 激励语
  var motivate = '';
  if (pct >= 100) motivate = '🎉 项目已全部完成！太棒了！';
  else if (pct >= 75) motivate = '🚀 即将大功告成，冲刺阶段！';
  else if (pct >= 50) motivate = '💪 已过半程，保持节奏！';
  else if (pct >= 25) motivate = '🌱 稳步推进中，继续加油！';
  else if (pct > 0) motivate = '🏗️ 万事开头难，已迈出第一步！';
  else motivate = '📋 项目已规划就绪，开始行动吧！';

  var html = '';

  // ===== 总体进度环 =====
  var ringR = 54;
  var ringC = 2 * Math.PI * ringR;
  var ringOffset = ringC - (pct / 100) * ringC;
  html += '<div class="progress-ring-wrap">';
  html += '<svg class="ring-svg" width="140" height="140" viewBox="0 0 140 140">';
  html += '<circle cx="70" cy="70" r="' + ringR + '" stroke="#374151" stroke-width="10" fill="none"/>';
  html += '<circle cx="70" cy="70" r="' + ringR + '" stroke="url(#ringGrad)" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="' + ringC + '" stroke-dashoffset="' + ringOffset + '" transform="rotate(-90 70 70)" style="transition:stroke-dashoffset 1s ease;"/>';
  html += '<defs><linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#10b981"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient></defs>';
  html += '<text x="70" y="65" text-anchor="middle" fill="#f3f4f6" font-size="28" font-weight="800">' + pct + '%</text>';
  html += '<text x="70" y="84" text-anchor="middle" fill="#6b7280" font-size="11">完成率</text>';
  html += '</svg>';
  html += '<div class="progress-ring-info">';
  html += '<h3>项目总体进度</h3>';
  html += '<p>子任务完成 <strong style="color:#10b981;">' + doneSub + '</strong> / ' + totalSub + '，主任务完成 <strong style="color:#3b82f6;">' + doneMain + '</strong> / ' + totalMain + '</p>';
  html += '<div class="motivate">' + motivate + '</div>';
  html += '</div></div>';

  // ===== 概览卡片 =====
  html += '<div class="stats-grid">';
  html += statCard('📋', totalMain, '主任务', doneMain + ' 已完成', 'blue');
  html += statCard('✅', doneSub, '已完成子任务', '共 ' + totalSub + ' 个子任务', 'green');
  html += statCard('📄', docCount, '文档', Object.keys(data.docBySection || {}).length + ' 种类型', 'purple');
  html += statCard('🧩', modCount, '功能模块', '', 'amber');
  var remainSub = totalSub - doneSub;
  html += statCard('⏳', remainSub, '待完成子任务', remainSub > 0 ? '继续努力！' : '全部完成！', 'rose');
  html += '</div>';

  // ===== 按优先级统计 =====
  var bp = data.byPriority || {};
  html += '<div class="stats-section">';
  html += '<div class="stats-section-title"><span class="sec-icon">🎯</span> 按优先级统计</div>';
  html += '<div class="priority-bars">';
  var priorities = ['P0', 'P1', 'P2'];
  for (var pi = 0; pi < priorities.length; pi++) {
    var pk = priorities[pi];
    var pd = bp[pk] || { total: 0, completed: 0 };
    var ppct = pd.total > 0 ? Math.round(pd.completed / pd.total * 100) : 0;
    html += '<div class="priority-row">';
    html += '<span class="priority-label ' + pk + '">' + pk + '</span>';
    html += '<div class="priority-bar-track"><div class="priority-bar-fill ' + pk + '" style="width:' + ppct + '%"></div></div>';
    html += '<span class="priority-nums">' + pd.completed + '/' + pd.total + ' (' + ppct + '%)</span>';
    html += '</div>';
  }
  html += '</div></div>';

  // ===== 进行中的任务 =====
  var inProg = data.inProgressPhases || [];
  if (inProg.length > 0) {
    html += '<div class="stats-section">';
    html += '<div class="stats-section-title"><span class="sec-icon">🔄</span> 进行中 (' + inProg.length + ')</div>';
    html += '<div class="phase-list">';
    for (var ii = 0; ii < inProg.length; ii++) {
      html += phaseItem(inProg[ii], 'in_progress', '▶');
    }
    html += '</div></div>';
  }

  // ===== 已完成的里程碑 =====
  var done = data.completedPhases || [];
  if (done.length > 0) {
    html += '<div class="stats-section">';
    html += '<div class="stats-section-title"><span class="sec-icon">🏆</span> 已完成里程碑 (' + done.length + ')</div>';
    html += '<div class="phase-list">';
    for (var di = 0; di < done.length; di++) {
      html += phaseItem(done[di], 'completed', '✓');
    }
    html += '</div></div>';
  }

  // ===== 待开始的任务 =====
  var pending = data.pendingPhases || [];
  if (pending.length > 0) {
    html += '<div class="stats-section">';
    html += '<div class="stats-section-title"><span class="sec-icon">📌</span> 待开始 (' + pending.length + ')</div>';
    html += '<div class="phase-list">';
    for (var qi = 0; qi < pending.length; qi++) {
      html += phaseItem(pending[qi], 'pending', '○');
    }
    html += '</div></div>';
  }

  // ===== 模块概览 =====
  var mods = data.moduleStats || [];
  if (mods.length > 0) {
    html += '<div class="stats-section">';
    html += '<div class="stats-section-title"><span class="sec-icon">🧩</span> 模块概览</div>';
    html += '<div class="module-grid">';
    for (var mi = 0; mi < mods.length; mi++) {
      var mod = mods[mi];
      var mpct = mod.subTaskCount > 0 ? Math.round(mod.completedSubTaskCount / mod.subTaskCount * 100) : 0;
      html += '<div class="module-card">';
      html += '<div class="module-card-header"><div class="module-card-dot" style="background:' + (mpct >= 100 ? '#10b981' : mpct > 0 ? '#3b82f6' : '#4b5563') + ';"></div><span class="module-card-name">' + escHtml(mod.name) + '</span></div>';
      html += '<div class="module-card-bar"><div class="module-card-bar-fill" style="width:' + mpct + '%"></div></div>';
      html += '<div class="module-card-stats"><span>' + mod.completedSubTaskCount + '/' + mod.subTaskCount + ' 子任务</span><span>' + mpct + '%</span></div>';
      html += '</div>';
    }
    html += '</div></div>';
  }

  // ===== 文档分布 =====
  var docSec = data.docBySection || {};
  var docKeys = Object.keys(docSec);
  if (docKeys.length > 0) {
    html += '<div class="stats-section">';
    html += '<div class="stats-section-title"><span class="sec-icon">📚</span> 文档分布</div>';
    html += '<div class="stats-grid">';
    var secNames = { overview: '概述', core_concepts: '核心概念', api_design: 'API 设计', file_structure: '文件结构', config: '配置', examples: '示例', technical_notes: '技术笔记', api_endpoints: 'API 端点', milestones: '里程碑', changelog: '变更日志', custom: '自定义' };
    for (var si = 0; si < docKeys.length; si++) {
      var sk = docKeys[si];
      html += '<div class="stat-card purple" style="padding:14px;">';
      html += '<div style="font-size:20px;font-weight:800;color:#a5b4fc;">' + docSec[sk] + '</div>';
      html += '<div style="font-size:11px;color:#9ca3af;margin-top:4px;">' + (secNames[sk] || sk) + '</div>';
      html += '</div>';
    }
    html += '</div></div>';
  }

  container.innerHTML = html;
}

function statCard(icon, value, label, sub, color) {
  return '<div class="stat-card ' + color + '"><div class="stat-card-icon">' + icon + '</div><div class="stat-card-value">' + value + '</div><div class="stat-card-label">' + label + '</div>' + (sub ? '<div class="stat-card-sub">' + sub + '</div>' : '') + '</div>';
}

function phaseItem(task, status, icon) {
  var ppct = task.percent || 0;
  var subText = task.total !== undefined ? (task.completed || 0) + '/' + task.total + ' 子任务' : task.taskId;
  var subs = task.subTasks || [];
  var rDocsCheck = task.relatedDocs || [];
  var hasSubs = subs.length > 0 || rDocsCheck.length > 0;
  var subIcons = { completed: '✓', in_progress: '◉', pending: '○', cancelled: '⊘' };
  var mainTime = task.completedAt ? fmtTime(task.completedAt) : '';
  var h = '<div class="phase-item-wrap">';
  h += '<div class="phase-item-main" ' + (hasSubs ? 'onclick="togglePhaseExpand(this)"' : '') + '>';
  if (hasSubs) { h += '<div class="phase-expand-icon">▶</div>'; }
  h += '<div class="phase-status-icon ' + status + '">' + icon + '</div>';
  h += '<div class="phase-info" style="flex:1;min-width:0;"><div class="phase-info-title">' + escHtml(task.title) + '</div>';
  h += '<div class="phase-info-sub">' + escHtml(task.taskId) + ' · ' + subText;
  if (mainTime) { h += ' · <span class="phase-time">✓ ' + mainTime + '</span>'; }
  h += '</div></div>';
  h += '<div class="phase-bar-mini"><div class="phase-bar-mini-fill" style="width:' + ppct + '%"></div></div>';
  h += '<div class="phase-pct">' + ppct + '%</div>';
  h += '</div>';
  var rDocs = task.relatedDocs || [];
  if (hasSubs || rDocs.length > 0) {
    h += '<div class="phase-subtasks">';
    for (var si = 0; si < subs.length; si++) {
      var s = subs[si];
      var ss = s.status || 'pending';
      var subTime = s.completedAt ? fmtTime(s.completedAt) : '';
      h += '<div class="phase-sub-item">';
      h += '<div class="phase-sub-icon ' + ss + '">' + (subIcons[ss] || '○') + '</div>';
      h += '<span class="phase-sub-name ' + ss + '">' + escHtml(s.title) + '</span>';
      if (subTime) { h += '<span class="phase-sub-time">' + subTime + '</span>'; }
      h += '<span class="phase-sub-id">' + escHtml(s.taskId) + '</span>';
      h += '</div>';
    }
    if (rDocs.length > 0) {
      h += '<div style="padding:6px 0 2px 8px;font-size:11px;color:#f59e0b;font-weight:600;">关联文档</div>';
      for (var rd = 0; rd < rDocs.length; rd++) {
        var rdoc = rDocs[rd];
        var rdLabel = rdoc.section || '';
        if (rdoc.subSection) rdLabel += ' / ' + rdoc.subSection;
        h += '<div class="phase-sub-item">';
        h += '<div class="phase-sub-icon" style="color:#f59e0b;">📄</div>';
        h += '<span class="phase-sub-name">' + escHtml(rdoc.title) + '</span>';
        h += '<span class="phase-sub-id">' + escHtml(rdLabel) + '</span>';
        h += '</div>';
      }
    }
    h += '</div>';
  }
  h += '</div>';
  return h;
}

// ========== Memory Browser ==========
var memoryLoaded = false;
var memoryData = [];
var memoryFilterType = 'all';

var MEMORY_TYPE_ICONS = {
  decision: '🏗️',
  bugfix: '🐛',
  pattern: '📐',
  insight: '💡',
  preference: '⚙️',
  summary: '📝'
};

var MEMORY_TYPE_LABELS = {
  decision: '决策',
  bugfix: 'Bug 修复',
  pattern: '模式',
  insight: '洞察',
  preference: '偏好',
  summary: '摘要'
};

function loadMemoryPage() {
  var list = document.getElementById('memoryList');
  if (memoryLoaded && memoryData.length > 0) {
    renderMemoryList(memoryData);
    return;
  }
  if (list) list.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280;font-size:12px;"><div class="spinner" style="margin:0 auto 12px;width:24px;height:24px;border-width:3px;"></div>加载记忆数据...</div>';

  fetch('/api/memories').then(function(r) { return r.json(); }).then(function(data) {
    memoryData = data.memories || [];
    memoryLoaded = true;
    renderMemoryList(memoryData);
  }).catch(function(err) {
    if (list) list.innerHTML = '<div style="text-align:center;padding:60px;color:#f87171;font-size:12px;">加载失败: ' + (err.message || err) + '<br><span style="cursor:pointer;color:#818cf8;text-decoration:underline;" onclick="memoryLoaded=false;loadMemoryPage();">重试</span></div>';
  });
}

function filterMemories(type) {
  memoryFilterType = type;
  // update button active states
  var btns = document.querySelectorAll('.memory-filter-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.remove('active');
    if (btns[i].getAttribute('data-type') === type) btns[i].classList.add('active');
  }
  renderMemoryList(memoryData);
}

function renderMemoryList(data) {
  var list = document.getElementById('memoryList');
  var countEl = document.getElementById('memoryCount');
  if (!list) return;

  // filter
  var filtered = data;
  if (memoryFilterType !== 'all') {
    filtered = [];
    for (var i = 0; i < data.length; i++) {
      if (data[i].memoryType === memoryFilterType) filtered.push(data[i]);
    }
  }

  if (countEl) {
    countEl.textContent = filtered.length + ' / ' + data.length + ' 条记忆';
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="memory-empty"><div class="memory-empty-icon">🧠</div>' +
      (data.length === 0 ? '还没有保存任何记忆<br><span style="color:#4b5563;font-size:11px;margin-top:8px;display:block;">Cursor 在开发过程中会自动积累决策、Bug 修复、代码模式等知识</span>' : '没有 "' + (MEMORY_TYPE_LABELS[memoryFilterType] || memoryFilterType) + '" 类型的记忆') +
      '</div>';
    return;
  }

  // sort by importance desc, then by createdAt desc
  filtered.sort(function(a, b) {
    var ia = (a.importance || 0.5);
    var ib = (b.importance || 0.5);
    if (ib !== ia) return ib - ia;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  var h = '';
  for (var i = 0; i < filtered.length; i++) {
    var mem = filtered[i];
    var type = mem.memoryType || 'insight';
    var icon = MEMORY_TYPE_ICONS[type] || '💭';
    var importance = mem.importance || 0.5;
    var pct = Math.round(importance * 100);

    h += '<div class="memory-card type-' + type + '">';

    // header
    h += '<div class="memory-card-header">';
    h += '<span class="memory-type-badge ' + type + '">' + icon + ' ' + (MEMORY_TYPE_LABELS[type] || type) + '</span>';
    if (mem.relatedTaskId) {
      h += '<span style="font-size:10px;color:#4b5563;background:#111827;padding:2px 6px;border-radius:3px;">' + escHtml(mem.relatedTaskId) + '</span>';
    }
    h += '<span class="memory-importance">';
    h += '<span class="memory-importance-bar"><span class="memory-importance-fill" style="width:' + pct + '%"></span></span>';
    h += ' ' + pct + '%';
    h += '</span>';
    h += '</div>';

    // content
    h += '<div class="memory-card-content">' + escHtml(mem.content || '') + '</div>';

    // footer: tags + meta
    h += '<div class="memory-card-footer">';
    var tags = mem.tags || [];
    for (var t = 0; t < tags.length; t++) {
      h += '<span class="memory-tag">#' + escHtml(tags[t]) + '</span>';
    }
    h += '<span class="memory-meta">';
    if (mem.hitCount > 0) {
      h += '<span title="被召回次数">🔍 ' + mem.hitCount + '</span>';
    }
    if (mem.createdAt) {
      h += '<span>' + formatMemoryTime(mem.createdAt) + '</span>';
    }
    h += '</span>';
    h += '</div>';

    h += '</div>';
  }

  list.innerHTML = h;
}

function formatMemoryTime(ts) {
  try {
    var d = new Date(ts);
    var now = new Date();
    var diff = now.getTime() - d.getTime();
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  } catch(e) { return ''; }
}

// ========== Memory View Switch (List / 3D Graph) ==========
var memoryViewMode = 'list';
var memoryGraph3dInstance = null;
var memoryGraphLoaded = false;
var memoryGraphData = null;

function switchMemoryView(mode) {
  if (mode === memoryViewMode) return;
  memoryViewMode = mode;

  // Toggle button active state
  var btns = document.querySelectorAll('.memory-view-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.remove('active');
    if (btns[i].getAttribute('data-view') === mode) btns[i].classList.add('active');
  }

  var listEl = document.getElementById('memoryList');
  var filtersEl = document.getElementById('memoryFilters');
  var graphEl = document.getElementById('memoryGraphContainer');
  var genGroup = document.querySelector('.memory-generate-group');

  if (mode === 'graph') {
    if (listEl) listEl.style.display = 'none';
    if (filtersEl) filtersEl.style.display = 'none';
    if (graphEl) graphEl.style.display = 'block';
    if (genGroup) genGroup.style.display = 'none';
    loadMemoryGraph();
  } else {
    if (listEl) listEl.style.display = 'flex';
    if (filtersEl) filtersEl.style.display = 'flex';
    if (graphEl) graphEl.style.display = 'none';
    if (genGroup) genGroup.style.display = 'flex';
    // Destroy 3D graph to free memory
    if (memoryGraph3dInstance) {
      try { memoryGraph3dInstance._destructor && memoryGraph3dInstance._destructor(); } catch(e) {}
      memoryGraph3dInstance = null;
    }
  }
}

function loadMemoryGraph() {
  var loadingEl = document.getElementById('memoryGraphLoading');
  var graph3dEl = document.getElementById('memoryGraph3D');
  var statsEl = document.getElementById('memoryGraphStats');

  if (loadingEl) loadingEl.style.display = 'block';
  if (graph3dEl) graph3dEl.innerHTML = '';

  fetch('/api/memories/graph').then(function(r) { return r.json(); }).then(function(data) {
    if (data.error) {
      if (loadingEl) loadingEl.innerHTML = '<div style="color:#f87171;">加载失败: ' + data.error + '</div>';
      return;
    }
    memoryGraphData = data;
    memoryGraphLoaded = true;

    if (statsEl) {
      var s = data.stats || {};
      statsEl.innerHTML = '🧠 ' + (s.memoryCount || 0) + ' 记忆 · ' + (s.contextCount || 0) + ' 上下文 · ' + (s.edgeCount || 0) + ' 关系';
    }

    renderMemoryGraph3D(data);
  }).catch(function(err) {
    if (loadingEl) loadingEl.innerHTML = '<div style="color:#f87171;">加载失败: ' + (err.message || err) + '<br><span style="cursor:pointer;color:#818cf8;text-decoration:underline;" onclick="loadMemoryGraph();">重试</span></div>';
  });
}

function renderMemoryGraph3D(data) {
  var container = document.getElementById('memoryGraph3D');
  var loadingEl = document.getElementById('memoryGraphLoading');
  if (!container) return;

  // Check if ForceGraph3D is available
  if (typeof ForceGraph3D === 'undefined') {
    // Fallback message
    if (loadingEl) loadingEl.innerHTML = '<div style="color:#f59e0b;">3D 引擎未加载（需要 Three.js + 3D Force Graph）<br><span style="font-size:11px;color:#6b7280;">请在设置中切换到 3D 引擎后刷新页面</span></div>';
    return;
  }

  if (loadingEl) loadingEl.style.display = 'none';

  // Node color map
  var NODE_COLORS = {
    'memory': '#c026d3',
    'main-task': '#3b82f6',
    'sub-task': '#818cf8',
    'doc': '#60a5fa',
    'module': '#ff8533',
    'project': '#6366f1'
  };

  // Edge color map
  var EDGE_COLORS = {
    'memory_relates': '#d946ef',
    'memory_from_task': '#60a5fa',
    'memory_from_doc': '#38bdf8',
    'module_memory': '#fb923c',
    'has_memory': '#a78bfa',
    'memory_supersedes': '#f87171'
  };

  // Build nodes
  var nodes3d = [];
  for (var i = 0; i < data.nodes.length; i++) {
    var n = data.nodes[i];
    var t = n.type || 'memory';
    var isMem = (t === 'memory');
    var memType = (n.properties && n.properties.memoryType) || '';
    var label = n.label || '';
    // Memory type colors
    var memTypeColors = {
      'decision': '#6366f1', 'bugfix': '#ef4444', 'pattern': '#06b6d4',
      'insight': '#f59e0b', 'preference': '#8b5cf6', 'summary': '#10b981'
    };
    var color = isMem ? (memTypeColors[memType] || NODE_COLORS.memory) : (NODE_COLORS[t] || '#64748b');
    var val = isMem ? (3 + ((n.properties && n.properties.importance) || 0.5) * 6) : (t === 'project' ? 12 : 5);

    nodes3d.push({
      id: n.id,
      label: label,
      _type: t,
      _props: n.properties || {},
      _val: val,
      _color: color,
      _isMem: isMem
    });
  }

  // Build links
  var links3d = [];
  for (var i = 0; i < data.edges.length; i++) {
    var e = data.edges[i];
    var edgeLabel = e.label || '';
    var edgeColor = EDGE_COLORS[edgeLabel] || '#374151';
    var w = (edgeLabel === 'memory_relates') ? 2 : 1;
    links3d.push({
      source: e.from,
      target: e.to,
      _label: edgeLabel,
      _color: edgeColor,
      _width: w
    });
  }

  // Build adjacency for highlighting
  var _mgNeighbors = {};
  var _mgLinks = {};
  for (var i = 0; i < links3d.length; i++) {
    var l = links3d[i];
    var sId = typeof l.source === 'object' ? l.source.id : l.source;
    var tId = typeof l.target === 'object' ? l.target.id : l.target;
    if (!_mgNeighbors[sId]) _mgNeighbors[sId] = new Set();
    if (!_mgNeighbors[tId]) _mgNeighbors[tId] = new Set();
    _mgNeighbors[sId].add(tId);
    _mgNeighbors[tId].add(sId);
    if (!_mgLinks[sId]) _mgLinks[sId] = new Set();
    if (!_mgLinks[tId]) _mgLinks[tId] = new Set();
    _mgLinks[sId].add(l);
    _mgLinks[tId].add(l);
  }

  var _mgSelectedId = null;
  var _mgHighlightNodes = new Set();
  var _mgHighlightLinks = new Set();

  function updateMGHighlight(nodeId) {
    _mgHighlightLinks.clear();
    _mgHighlightNodes.clear();
    _mgSelectedId = nodeId;
    if (nodeId) {
      _mgHighlightNodes.add(nodeId);
      var nb = _mgNeighbors[nodeId];
      if (nb) nb.forEach(function(nId) { _mgHighlightNodes.add(nId); });
      var lks = _mgLinks[nodeId];
      if (lks) lks.forEach(function(link) { _mgHighlightLinks.add(link); });
    }
  }

  var rect = container.getBoundingClientRect();

  // Destroy previous instance
  if (memoryGraph3dInstance) {
    try { memoryGraph3dInstance._destructor && memoryGraph3dInstance._destructor(); } catch(e) {}
  }

  var graph3d = ForceGraph3D({ controlType: 'orbit' })(container)
    .width(rect.width)
    .height(rect.height)
    .backgroundColor('#0f172a')
    .showNavInfo(false)
    .nodeLabel(function(n) {
      var memType = (n._props || {}).memoryType || '';
      var content = (n._props || {}).content || n.label || '';
      var importance = (n._props || {}).importance;
      var isMem = n._isMem;
      var typeBadge = '';
      if (isMem && memType) {
        var typeIcons = { decision:'🏗️', bugfix:'🐛', pattern:'📐', insight:'💡', preference:'⚙️', summary:'📝' };
        typeBadge = '<span style="font-size:10px;background:rgba(99,102,241,0.3);padding:1px 6px;border-radius:3px;">' + (typeIcons[memType] || '') + ' ' + memType + '</span>';
      }
      var impBar = '';
      if (isMem && importance != null) {
        var pct = Math.round(importance * 100);
        impBar = '<div style="margin-top:4px;"><span style="font-size:9px;color:#6b7280;">重要性: </span><span style="display:inline-block;width:50px;height:3px;background:#374151;border-radius:2px;vertical-align:middle;"><span style="display:block;height:100%;width:' + pct + '%;background:linear-gradient(90deg,#6366f1,#a78bfa);border-radius:2px;"></span></span> <span style="font-size:9px;color:#9ca3af;">' + pct + '%</span></div>';
      }
      return '<div style="background:rgba(15,23,42,0.92);color:#e2e8f0;padding:8px 12px;border-radius:8px;font-size:12px;border:1px solid rgba(192,38,211,0.3);backdrop-filter:blur(4px);max-width:320px;">'
        + '<div style="font-weight:600;margin-bottom:3px;">' + (n.label || n.id) + '</div>'
        + (typeBadge ? '<div style="margin-bottom:3px;">' + typeBadge + '</div>' : '')
        + (isMem && content ? '<div style="color:#94a3b8;font-size:11px;line-height:1.4;max-height:80px;overflow:hidden;">' + content + '</div>' : '')
        + impBar
        + '<div style="color:#4b5563;font-size:9px;margin-top:3px;">' + (n._type || '') + '</div>'
        + '</div>';
    })
    .nodeColor(function(n) { return n._color; })
    .nodeVal(function(n) { return n._val; })
    .nodeOpacity(0.92)
    .nodeResolution(16)
    .nodeThreeObject(function(n) {
      if (typeof THREE === 'undefined') return false;
      var color = n._color;
      var group = new THREE.Group();
      var coreMesh;

      if (n._isMem) {
        // Memory nodes: dodecahedron (多面体)
        var size = 2 + (n._val || 5) * 0.5;
        var geo = new THREE.DodecahedronGeometry(size);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: 0.92, emissive: color, emissiveIntensity: 0.35 });
        coreMesh = new THREE.Mesh(geo, mat);
      } else if (n._type === 'project') {
        var geo = new THREE.OctahedronGeometry(10);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: 0.92, emissive: color, emissiveIntensity: 0.4 });
        coreMesh = new THREE.Mesh(geo, mat);
      } else if (n._type === 'module') {
        var size = 6;
        var geo = new THREE.BoxGeometry(size, size, size);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: 0.92, emissive: color, emissiveIntensity: 0.3 });
        coreMesh = new THREE.Mesh(geo, mat);
      } else {
        // Tasks, docs: sphere
        var radius = 3 + (n._val || 5) * 0.2;
        var geo = new THREE.SphereGeometry(radius, 12, 12);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: 0.85, emissive: color, emissiveIntensity: 0.2 });
        coreMesh = new THREE.Mesh(geo, mat);
      }
      group.add(coreMesh);

      // Glow sprite for memory nodes
      if (n._isMem) {
        var spriteMat = new THREE.SpriteMaterial({
          map: createGlowTexture_mg(color),
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        });
        var sprite = new THREE.Sprite(spriteMat);
        var spriteSize = (n._val || 5) * 2.5;
        sprite.scale.set(spriteSize, spriteSize, 1);
        group.add(sprite);
      }

      return group;
    })
    .nodeThreeObjectExtend(false)
    // Link styles
    .linkColor(function(l) {
      if (_mgSelectedId && !_mgHighlightLinks.has(l)) return 'rgba(55,65,81,0.15)';
      return l._color;
    })
    .linkWidth(function(l) {
      return _mgHighlightLinks.has(l) ? l._width * 2 : l._width;
    })
    .linkOpacity(0.7)
    .linkDirectionalParticles(function(l) {
      return _mgHighlightLinks.has(l) ? 3 : 0;
    })
    .linkDirectionalParticleWidth(2)
    .linkDirectionalParticleSpeed(0.006)
    .linkDirectionalParticleColor(function(l) { return l._color; })
    // Interactions
    .onNodeClick(function(node) {
      if (_mgSelectedId === node.id) {
        updateMGHighlight(null);
      } else {
        updateMGHighlight(node.id);
      }
      graph3d.nodeColor(graph3d.nodeColor()); // trigger refresh

      // Show detail in panel if available
      if (typeof showPanel === 'function') {
        var panelNode = {
          id: node.id,
          label: node.label,
          _type: node._type,
          _props: node._props
        };
        showPanel(panelNode);
      }
    })
    .onBackgroundClick(function() {
      updateMGHighlight(null);
      graph3d.nodeColor(graph3d.nodeColor());
      if (typeof closePanel === 'function') closePanel();
    })
    .graphData({ nodes: nodes3d, links: links3d });

  // Force simulation tuning for memory network
  graph3d.d3Force('charge').strength(-120).distanceMax(300);
  graph3d.d3Force('link').distance(function(l) {
    return l._label === 'memory_relates' ? 40 : 80;
  });

  memoryGraph3dInstance = graph3d;

  // Auto-zoom to fit
  setTimeout(function() {
    try { graph3d.zoomToFit(800, 40); } catch(e) {}
  }, 1500);
}

// Glow texture generator for memory nodes
function createGlowTexture_mg(colorHex) {
  if (typeof document === 'undefined') return null;
  var size = 128;
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');
  if (!ctx) return null;
  var gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, colorHex);
  gradient.addColorStop(0.3, colorHex + 'aa');
  gradient.addColorStop(0.7, colorHex + '33');
  gradient.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  var tex = new THREE.CanvasTexture(canvas);
  return tex;
}

// ========== Memory Generate ==========
var memGenCandidates = [];
var memGenSelected = {};
var memGenLastSource = 'both';
var memGenLastTaskId = null;
var memGenTotalSaved = 0;

function toggleMemGenDropdown(e) {
  if (e) e.stopPropagation();
  var dd = document.getElementById('memGenDropdown');
  if (dd) dd.classList.toggle('show');
}

// close dropdown on body click
document.addEventListener('click', function(e) {
  var dd = document.getElementById('memGenDropdown');
  if (dd && dd.classList.contains('show')) {
    var group = dd.closest('.memory-generate-group');
    if (group && !group.contains(e.target)) dd.classList.remove('show');
  }
});

function getMemGenLimit() {
  var sel = document.getElementById('memGenLimitSelect');
  var v = sel ? parseInt(sel.value, 10) : 50;
  return v === 0 ? 99999 : v;
}

function isAutoNextEnabled() {
  var cb = document.getElementById('memGenAutoNext');
  return cb ? cb.checked : false;
}

function onMemGenLimitChange() {
  // When user changes limit, toggle auto-next visibility hint
}

function generateMemories(source, taskId) {
  // close dropdown
  var dd = document.getElementById('memGenDropdown');
  if (dd) dd.classList.remove('show');

  // track source for auto-continue
  memGenLastSource = source || 'both';
  memGenLastTaskId = taskId || null;
  memGenTotalSaved = 0;

  // show overlay
  var overlay = document.getElementById('memGenOverlay');
  if (overlay) overlay.style.display = 'flex';

  loadMemGenBatch();
}

function loadMemGenBatch() {
  var listEl = document.getElementById('memGenCandidateList');
  var limit = getMemGenLimit();
  var sourceLabel = memGenLastSource === 'both' ? '文档+任务' : memGenLastSource === 'tasks' ? '任务' : '文档';
  var batchInfo = memGenTotalSaved > 0 ? '（已累计保存 ' + memGenTotalSaved + ' 条，加载下一批...）' : '';
  if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;font-size:12px;"><div class="spinner" style="margin:0 auto 12px;width:24px;height:24px;border-width:3px;"></div>正在从 ' + sourceLabel + ' 中提取候选项...' + batchInfo + '</div>';

  var url = '/api/memories/generate?source=' + encodeURIComponent(memGenLastSource) + '&limit=' + limit;
  if (memGenLastTaskId) url += '&taskId=' + encodeURIComponent(memGenLastTaskId);

  // reset save button
  var btn = document.getElementById('memGenSaveBtn');
  if (btn) { btn.disabled = false; btn.innerHTML = '💾 保存选中 (<span id="memGenSelectedCount">0</span>)'; }

  fetch(url).then(function(r) { return r.json(); }).then(function(data) {
    memGenCandidates = data.candidates || [];
    memGenSelected = {};
    // auto-select all candidates (已有记忆的候选项已被服务端过滤)
    for (var i = 0; i < memGenCandidates.length; i++) {
      memGenSelected[i] = true;
    }
    renderCandidateList();
    updateGenStats(data);
  }).catch(function(err) {
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:40px;color:#f87171;font-size:12px;">生成失败: ' + (err.message || err) + '</div>';
  });
}

function closeMemGenOverlay() {
  var overlay = document.getElementById('memGenOverlay');
  if (overlay) overlay.style.display = 'none';
  memGenCandidates = [];
  memGenSelected = {};
  memGenTotalSaved = 0;
}

function updateGenStats(data) {
  var statsEl = document.getElementById('memGenStats');
  if (statsEl) {
    var total = (data.candidates || []).length;
    var fromTasks = 0, fromDocs = 0;
    for (var i = 0; i < total; i++) {
      if (data.candidates[i].sourceType === 'task') fromTasks++;
      else fromDocs++;
    }
    var skipped = (data.stats && data.stats.skippedWithMemory) || 0;
    var txt = '共 ' + total + ' 条 (任务: ' + fromTasks + ', 文档: ' + fromDocs + ')';
    if (skipped > 0) txt += ' · 已跳过 ' + skipped + ' 条已有记忆';
    if (memGenTotalSaved > 0) txt += ' · 已累计保存 ' + memGenTotalSaved + ' 条';
    var limit = getMemGenLimit();
    if (total === 0 && memGenTotalSaved > 0) {
      txt = '🎉 全部处理完毕！累计保存 ' + memGenTotalSaved + ' 条记忆';
    } else if (limit < 99999) {
      txt += ' (每批 ' + limit + ')';
    }
    statsEl.textContent = txt;
  }
  updateSelectedCount();
  // If no candidates returned and auto-next was running, auto-close
  if ((data.candidates || []).length === 0 && memGenTotalSaved > 0) {
    var btn = document.getElementById('memGenSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = '🎉 全部完成！共保存 ' + memGenTotalSaved + ' 条'; }
    memoryLoaded = false;
    setTimeout(function() { closeMemGenOverlay(); loadMemoryPage(); }, 2000);
  }
}

function updateSelectedCount() {
  var cnt = 0;
  for (var k in memGenSelected) { if (memGenSelected[k]) cnt++; }
  var el = document.getElementById('memGenSelectedCount');
  if (el) el.textContent = cnt;
  var btn = document.getElementById('memGenSaveBtn');
  if (btn) btn.disabled = cnt === 0;
}

function toggleCandidate(idx) {
  memGenSelected[idx] = !memGenSelected[idx];
  // update card UI
  var card = document.querySelector('.mem-gen-candidate[data-idx="' + idx + '"]');
  if (card) {
    card.classList.toggle('selected', !!memGenSelected[idx]);
    var check = card.querySelector('.mem-gen-candidate-check');
    if (check) check.textContent = memGenSelected[idx] ? '✓' : '';
  }
  updateSelectedCount();
}

function toggleAllCandidates(state) {
  // state: true=all, false=none (已有记忆的候选项已被服务端过滤，无需客户端二次判断)
  for (var i = 0; i < memGenCandidates.length; i++) {
    memGenSelected[i] = !!state;
  }
  renderCandidateList();
}

function renderCandidateList() {
  var listEl = document.getElementById('memGenCandidateList');
  if (!listEl) return;

  if (memGenCandidates.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;font-size:13px;">没有找到可以提取的候选项</div>';
    updateSelectedCount();
    return;
  }

  var h = '';
  for (var i = 0; i < memGenCandidates.length; i++) {
    var c = memGenCandidates[i];
    var sel = !!memGenSelected[i];
    var cls = 'mem-gen-candidate' + (sel ? ' selected' : '');
    var typeIcon = MEMORY_TYPE_ICONS[c.suggestedMemoryType] || '💭';
    var typeLabel = MEMORY_TYPE_LABELS[c.suggestedMemoryType] || c.suggestedMemoryType;

    h += '<div class="' + cls + '" data-idx="' + i + '" onclick="toggleCandidate(' + i + ')">';
    h += '<div class="mem-gen-candidate-check">' + (sel ? '✓' : '') + '</div>';
    h += '<div class="mem-gen-candidate-body">';

    // title row
    h += '<div class="mem-gen-candidate-title">';
    h += '<span class="mem-gen-candidate-source ' + c.sourceType + '">' + (c.sourceType === 'task' ? '✅ 任务' : '📄 文档') + '</span>';
    h += escHtml(c.sourceTitle);
    h += '</div>';

    // content preview (truncate)
    var preview = (c.content || '').substring(0, 200);
    if ((c.content || '').length > 200) preview += '...';
    h += '<div class="mem-gen-candidate-preview">' + escHtml(preview) + '</div>';

    // meta
    h += '<div class="mem-gen-candidate-meta">';
    h += '<span class="mem-gen-candidate-type ' + c.suggestedMemoryType + '">' + typeIcon + ' ' + typeLabel + '</span>';
    h += '<span class="mem-gen-candidate-importance">重要性: ' + Math.round((c.suggestedImportance || 0.5) * 100) + '%</span>';
    h += '</div>';

    h += '</div>';
    h += '</div>';
  }
  listEl.innerHTML = h;
  updateSelectedCount();
}

function saveSelectedCandidates() {
  var toSave = [];
  for (var i = 0; i < memGenCandidates.length; i++) {
    if (memGenSelected[i]) toSave.push(memGenCandidates[i]);
  }
  if (toSave.length === 0) return;

  var btn = document.getElementById('memGenSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '💾 保存中...'; }

  var saved = 0, failed = 0;
  var total = toSave.length;
  var batchLimit = getMemGenLimit();
  var batchSize = memGenCandidates.length;

  function saveNext(idx) {
    if (idx >= total) {
      // batch done
      memGenTotalSaved += saved;
      var doneMsg = '✅ 本批保存 ' + saved + ' 条' + (failed > 0 ? ' (失败 ' + failed + ')' : '');
      if (memGenTotalSaved > saved) doneMsg += ' · 累计 ' + memGenTotalSaved + ' 条';

      // Check if we should auto-load next batch:
      // - auto-next is enabled
      // - batch was full (batchSize >= limit), meaning there might be more
      // - limit is not "unlimited" (99999)
      var shouldContinue = isAutoNextEnabled() && batchLimit < 99999 && batchSize >= batchLimit;

      if (shouldContinue) {
        if (btn) btn.textContent = doneMsg + ' — 加载下一批...';
        setTimeout(function() { loadMemGenBatch(); }, 800);
      } else {
        if (btn) btn.textContent = doneMsg;
        if (batchSize < batchLimit || batchLimit >= 99999) {
          if (btn) btn.textContent = '✅ 全部完成！共保存 ' + memGenTotalSaved + ' 条';
        }
        // refresh memories list
        memoryLoaded = false;
        setTimeout(function() {
          closeMemGenOverlay();
          loadMemoryPage();
        }, 1500);
      }
      return;
    }

    var c = toSave[idx];
    // Build content: use sourceTitle + content snippet
    var memContent = c.content || c.sourceTitle || '';
    if (memContent.length > 500) memContent = memContent.substring(0, 500) + '...';

    fetch('/api/memories/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memoryType: c.suggestedMemoryType || 'summary',
        content: memContent,
        tags: c.suggestedTags || [],
        relatedTaskId: c.sourceType === 'task' ? c.sourceId : undefined,
        sourceId: c.sourceId,
        importance: c.suggestedImportance || 0.5,
      })
    }).then(function(r) { return r.json(); }).then(function() {
      saved++;
      if (btn) btn.textContent = '💾 保存中... (' + saved + '/' + total + ')';
      saveNext(idx + 1);
    }).catch(function() {
      failed++;
      saveNext(idx + 1);
    });
  }

  saveNext(0);
}

function showPhasePickerForGenerate() {
  // close dropdown first
  var dd = document.getElementById('memGenDropdown');
  if (dd) dd.classList.remove('show');

  // fetch progress to get completed phases
  fetch('/api/progress').then(function(r) { return r.json(); }).then(function(data) {
    var phases = (data.completedPhases || []);
    if (phases.length === 0) {
      alert('没有已完成的阶段');
      return;
    }
    var overlay = document.getElementById('memGenOverlay');
    if (overlay) overlay.style.display = 'flex';
    var listEl = document.getElementById('memGenCandidateList');
    var statsEl = document.getElementById('memGenStats');
    if (statsEl) statsEl.textContent = '请选择一个阶段';

    var h = '<div style="padding:8px;">';
    h += '<div style="font-size:13px;color:#9ca3af;margin-bottom:12px;">选择要提取记忆的阶段：</div>';
    for (var i = 0; i < phases.length; i++) {
      var p = phases[i];
      h += '<div class="mem-gen-candidate" onclick="generateMemories(\\'tasks\\',\\'' + escHtml(p.taskId) + '\\')" style="cursor:pointer;">';
      h += '<div class="mem-gen-candidate-body">';
      h += '<div class="mem-gen-candidate-title">';
      h += '<span class="mem-gen-candidate-source task">' + escHtml(p.taskId) + '</span>';
      h += escHtml(p.title);
      h += '</div>';
      var desc = '';
      if (p.completedSubTasks !== undefined) desc = '子任务: ' + p.completedSubTasks + '/' + p.totalSubTasks;
      h += '<div class="mem-gen-candidate-preview">' + escHtml(desc) + '</div>';
      h += '</div>';
      h += '</div>';
    }
    h += '</div>';
    if (listEl) listEl.innerHTML = h;
  }).catch(function() {
    alert('获取阶段列表失败');
  });
}

// ========== 一键全量导入 ==========
var _autoImportCancelled = false;

function autoImportAllMemories() {
  // close dropdown
  var dd = document.getElementById('memGenDropdown');
  if (dd) dd.classList.remove('show');

  _autoImportCancelled = false;

  // show progress overlay
  var overlay = document.getElementById('memAutoImportOverlay');
  if (overlay) overlay.style.display = 'flex';

  var titleEl = document.getElementById('memAutoImportTitle');
  var statusEl = document.getElementById('memAutoImportStatus');
  var detailEl = document.getElementById('memAutoImportDetail');
  var progressEl = document.getElementById('memAutoImportProgress');
  var cancelBtn = document.getElementById('memAutoImportCancelBtn');
  if (titleEl) titleEl.textContent = '⚡ 一键全量导入';
  if (statusEl) statusEl.textContent = '正在获取候选项...';
  if (detailEl) detailEl.textContent = '';
  if (progressEl) progressEl.style.width = '0%';
  if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.textContent = '取消'; }

  var totalSaved = 0;
  var totalFailed = 0;
  var totalSkipped = 0;
  var batchNum = 0;
  // Phase-44: Memory Tree — 记录 sourceId → entityId 映射，用于建立 suggestedRelations
  var sourceIdToEntityId = {};
  var pendingRelations = [];
  var totalRelationsCreated = 0;

  function loadAndSaveBatch() {
    if (_autoImportCancelled) { finishImport('已取消'); return; }

    batchNum++;
    if (statusEl) statusEl.textContent = '第 ' + batchNum + ' 批 — 获取候选项...';
    if (detailEl) detailEl.textContent = '已累计保存: ' + totalSaved + ' 条' + (totalSkipped > 0 ? ' · 跳过: ' + totalSkipped : '');

    fetch('/api/memories/generate?source=both&limit=50').then(function(r) { return r.json(); }).then(function(data) {
      var candidates = data.candidates || [];
      var skipped = (data.stats && data.stats.skippedWithMemory) || 0;
      totalSkipped = skipped;

      if (candidates.length === 0) {
        finishImport('完成');
        return;
      }

      if (statusEl) statusEl.textContent = '第 ' + batchNum + ' 批 — 保存 ' + candidates.length + ' 条...';

      var batchSaved = 0;
      var batchFailed = 0;

      function saveOne(idx) {
        if (_autoImportCancelled) { totalSaved += batchSaved; totalFailed += batchFailed; finishImport('已取消'); return; }
        if (idx >= candidates.length) {
          totalSaved += batchSaved;
          totalFailed += batchFailed;
          // continue to next batch
          setTimeout(loadAndSaveBatch, 300);
          return;
        }

        var c = candidates[idx];
        var memContent = c.content || c.sourceTitle || '';
        if (memContent.length > 500) memContent = memContent.substring(0, 500) + '...';

        // progress within batch
        var pctBatch = Math.round(((idx + 1) / candidates.length) * 100);
        if (progressEl) progressEl.style.width = pctBatch + '%';
        var relCount = (c.suggestedRelations || []).length;
        if (detailEl) detailEl.textContent = '批次 ' + batchNum + ': ' + (idx + 1) + '/' + candidates.length + ' · 累计保存: ' + (totalSaved + batchSaved) + ' 条' + (relCount > 0 ? ' · 关系: ' + relCount : '');

        fetch('/api/memories/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            memoryType: c.suggestedMemoryType || 'summary',
            content: memContent,
            tags: c.suggestedTags || [],
            relatedTaskId: c.sourceType === 'task' ? c.sourceId : undefined,
            sourceId: c.sourceId,
            importance: c.suggestedImportance || 0.5,
          })
        }).then(function(r) { return r.json(); }).then(function(result) {
          batchSaved++;
          // Phase-44: 记录 sourceId → entityId 映射，用于后续建立 suggestedRelations
          if (result && result.memory && result.memory.id && c.sourceId) {
            sourceIdToEntityId[c.sourceId] = result.memory.id;
          }
          // 收集 suggestedRelations 待后续处理
          if (c.suggestedRelations && c.suggestedRelations.length > 0) {
            pendingRelations.push({ sourceId: c.sourceId, relations: c.suggestedRelations });
          }
          saveOne(idx + 1);
        }).catch(function() {
          batchFailed++;
          saveOne(idx + 1);
        });
      }

      saveOne(0);
    }).catch(function(err) {
      if (statusEl) statusEl.textContent = '获取候选项失败';
      if (detailEl) detailEl.textContent = err.message || String(err);
      if (cancelBtn) { cancelBtn.textContent = '关闭'; cancelBtn.disabled = false; }
    });
  }

  function finishImport(reason) {
    if (progressEl) progressEl.style.width = '100%';
    if (reason === '已取消') {
      if (statusEl) statusEl.textContent = '已取消 — 保存了 ' + totalSaved + ' 条';
      if (titleEl) titleEl.textContent = '⚡ 导入已取消';
      showFinalStats();
      return;
    }

    // Phase-44: 第二阶段 — 用 suggestedRelations 建立记忆间关系
    if (pendingRelations.length > 0) {
      if (statusEl) statusEl.textContent = '🔗 正在建立记忆关系...';
      if (detailEl) detailEl.textContent = '已保存 ' + totalSaved + ' 条记忆，正在处理 ' + pendingRelations.length + ' 组关系建议';

      var relIdx = 0;
      function processNextRelation() {
        if (relIdx >= pendingRelations.length) {
          if (titleEl) titleEl.textContent = '✅ 导入完成（含记忆树）';
          if (statusEl) statusEl.textContent = '🎉 记忆 + 关系全部导入完成！';
          showFinalStats();
          return;
        }
        var item = pendingRelations[relIdx];
        var fromEntityId = sourceIdToEntityId[item.sourceId];
        if (!fromEntityId) { relIdx++; processNextRelation(); return; }

        var rels = item.relations || [];
        var rIdx = 0;
        function createNextRel() {
          if (rIdx >= rels.length) { relIdx++; processNextRelation(); return; }
          var rel = rels[rIdx];
          var toEntityId = sourceIdToEntityId[rel.targetSourceId];
          if (!toEntityId) { rIdx++; createNextRel(); return; }

          fetch('/api/memories/relate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromId: fromEntityId,
              toId: toEntityId,
              relationType: rel.relationType || 'MEMORY_RELATES',
              weight: rel.weight || 0.5,
            })
          }).then(function() {
            totalRelationsCreated++;
            if (detailEl) detailEl.textContent = '关系: ' + totalRelationsCreated + ' 条已建立';
            rIdx++;
            createNextRel();
          }).catch(function() {
            rIdx++;
            createNextRel();
          });
        }
        createNextRel();
      }
      processNextRelation();
    } else {
      if (titleEl) titleEl.textContent = '✅ 导入完成';
      if (statusEl) statusEl.textContent = '🎉 全部导入完成！';
      showFinalStats();
    }
  }

  function showFinalStats() {
    var failTxt = totalFailed > 0 ? ' · 失败: ' + totalFailed : '';
    var relTxt = totalRelationsCreated > 0 ? ' · 关系: ' + totalRelationsCreated + ' 条' : '';
    if (detailEl) detailEl.textContent = '共保存 ' + totalSaved + ' 条记忆' + failTxt + relTxt + ' · 跳过已有: ' + totalSkipped;
    if (cancelBtn) { cancelBtn.textContent = '关闭'; cancelBtn.onclick = function() { closeAutoImport(); }; }

    // refresh memory list
    memoryLoaded = false;
    setTimeout(function() {
      closeAutoImport();
      loadMemoryPage();
    }, 2000);
  }

  loadAndSaveBatch();
}

function cancelAutoImport() {
  _autoImportCancelled = true;
  var cancelBtn = document.getElementById('memAutoImportCancelBtn');
  if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.textContent = '取消中...'; }
}

function closeAutoImport() {
  var overlay = document.getElementById('memAutoImportOverlay');
  if (overlay) overlay.style.display = 'none';
}

`;
}
