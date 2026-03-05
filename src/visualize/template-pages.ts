/**
 * DevPlan 图可视化 — 页面模块
 *
 * 包含: 文档浏览页、RAG 聊天、统计仪表盘。
 */

export function getPagesScript(): string {
  return `
// ========== Docs Browser ==========
var docsLoaded = false;
var docsData = [];       // 全部文档列表（元数据，不含 content）
var currentDocKey = '';  // 当前选中文档的 key (section|subSection)
var docsDataIsPartial = false; // Phase-158 兼容标志
var docsCacheUpdatedAt = 0;
var DOCS_CACHE_TTL_MS = 300000; // Phase-159: 5分钟缓存（从 60s 延长）

// Phase-157: 统一文档内容缓存（docKey → full doc object with content）
var docContentCache = {};
var docContentCacheUpdatedAt = 0;

// Phase-159: 内容预加载状态
var _docsContentPreloading = false;

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

/** 加载文档数据（全局共享，仅请求一次）
 *  Phase-159: 改为 /api/docs（轻量，不含 content），列表秒加载。
 *  内容通过 _preloadDocsContent() 异步后台填充 docContentCache。
 */
function loadDocsData(callback) {
  if (docsLoaded && docsData.length > 0 && !docsDataIsPartial) {
    if (callback) callback(docsData, null);
    return;
  }
  // Phase-159: 使用轻量 /api/docs（不含 content，仅元数据）
  fetch('/api/docs').then(function(r) { return r.json(); }).then(function(data) {
    var allDocs = data.docs || [];
    docsData = allDocs;
    docsLoaded = true;
    docsDataIsPartial = false;
    docsCacheUpdatedAt = Date.now();

    if (callback) callback(docsData, null);

    // Phase-159: 列表渲染后，后台异步预加载文档内容
    _preloadDocsContent();
  }).catch(function(err) {
    if (callback) callback(null, err);
  });
}

/** Phase-159: 后台异步预加载全部文档内容到 docContentCache */
function _preloadDocsContent() {
  if (_docsContentPreloading) return;
  // 如果内容缓存已经新鲜（5分钟内），跳过
  if (docContentCacheUpdatedAt > 0 && (Date.now() - docContentCacheUpdatedAt) <= DOCS_CACHE_TTL_MS) return;
  _docsContentPreloading = true;
  fetch('/api/docs/all').then(function(r) { return r.json(); }).then(function(data) {
    var allDocs = data.docs || [];
    docContentCache = {};
    for (var i = 0; i < allDocs.length; i++) {
      var d = allDocs[i];
      var key = d.section + (d.subSection ? '|' + d.subSection : '');
      docContentCache[key] = d;
    }
    docContentCacheUpdatedAt = Date.now();
    _docsContentPreloading = false;
  }).catch(function() {
    _docsContentPreloading = false;
  });
}

// Phase-158: fetchDocsPage 已移除 — 现在统一使用 /api/docs/all

function hasFreshDocsCache() {
  return docsLoaded &&
    docsData.length > 0 &&
    (Date.now() - docsCacheUpdatedAt) <= DOCS_CACHE_TTL_MS;
}

// Phase-158: applyFirstPageData / silentRefreshDocsFirstPage / updateDocsLoadMoreUI / loadMoreDocs 已移除
// 现在统一使用 /api/docs/all 一次加载全部文档，分页加载逻辑不再需要

function loadDocsPage() {
  var list = document.getElementById('docsGroupList');

  // Phase-157: 有完整缓存时直接渲染，无需再请求
  if (hasFreshDocsCache() && !docsDataIsPartial) {
    var searchInput = document.getElementById('docsSearch');
    var searching = !!(searchInput && (searchInput.value || '').trim());
    if (!searching) {
      renderDocsList(docsData);
    } else {
      filterDocs();
    }
    return;
  }

  // Phase-159: Stale-while-revalidate — 有旧数据时先显示旧数据，后台刷新
  if (docsLoaded && docsData.length > 0) {
    var searchInput2 = document.getElementById('docsSearch');
    var searching2 = !!(searchInput2 && (searchInput2.value || '').trim());
    if (!searching2) {
      renderDocsList(docsData);
    } else {
      filterDocs();
    }
    // 后台静默刷新列表
    _silentRefreshDocsList();
    return;
  }

  // 首次加载 — 使用轻量 /api/docs（不含 content，秒加载）
  docsData = [];
  docsLoaded = false;
  docsCacheUpdatedAt = 0;
  if (list) list.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;font-size:12px;"><div class="spinner" style="margin:0 auto 12px;width:24px;height:24px;border-width:3px;"></div>加载文档列表...</div>';

  fetch('/api/docs').then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(data) {
    var allDocs = (data && data.docs) ? data.docs : [];
    docsData = allDocs;
    docsLoaded = true;
    docsDataIsPartial = false;
    docsCacheUpdatedAt = Date.now();

    renderDocsList(docsData);

    // Phase-159: 列表渲染后，后台异步预加载文档内容
    _preloadDocsContent();
  }).catch(function(err) {
    if (list) list.innerHTML = '<div style="text-align:center;padding:40px;color:#f87171;font-size:12px;">加载失败: ' + escHtml(err.message) + '<br><span style="cursor:pointer;color:#818cf8;text-decoration:underline;" onclick="docsLoaded=false;loadDocsPage();">重试</span></div>';
  });
}

/** Phase-159: 后台静默刷新文档列表（stale-while-revalidate） */
function _silentRefreshDocsList() {
  fetch('/api/docs').then(function(r) { return r.json(); }).then(function(data) {
    var allDocs = (data && data.docs) ? data.docs : [];
    docsData = allDocs;
    docsLoaded = true;
    docsDataIsPartial = false;
    docsCacheUpdatedAt = Date.now();
    // 不重新渲染列表，避免闪烁（数据通常没变，变了的话下次交互会自然更新）
    // 同时刷新内容缓存
    _preloadDocsContent();
  }).catch(function() { /* 静默失败 */ });
}

/** 获取文档的 key（唯一标识） */
function docItemKey(item) {
  return item.section + (item.subSection ? '|' + item.subSection : '');
}

/** 记录哪些父文档处于折叠状态（key → true 表示折叠） */
var docsCollapsedState = {};

/** 渲染单个文档分组的 HTML（内部辅助函数）
 *  @returns HTML 字符串
 */
function renderDocGroupHtml(sec, items, allDocs, childrenMap, selectFn) {
  var secName = SECTION_NAMES[sec] || sec;
  var secIcon = SECTION_ICONS[sec] || '▸';

  // 计算此分组下文档总数（含子文档）
  var totalCount = 0;
  for (var ci = 0; ci < allDocs.length; ci++) {
    if (allDocs[ci].section === sec) totalCount++;
  }

  var html = '<div class="docs-group" data-section="' + sec + '">';
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
  return html;
}

/** 将文档列表按 section 分组渲染，支持 parentDoc 层级 + 渐进式渲染
 *  Phase-158: 大文档列表先渲染首批 ~30 条文档（立即可见），剩余分批追加
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

  // Phase-158: 渐进式渲染 — 先渲染前 ~30 条文档的分组，剩余异步追加
  var FIRST_BATCH_ITEMS = 30;
  var itemCount = 0;
  var firstBatchEnd = groupOrder.length; // 默认全部渲染（小列表不分批）

  if (docs.length > FIRST_BATCH_ITEMS) {
    for (var gi = 0; gi < groupOrder.length; gi++) {
      itemCount += (groups[groupOrder[gi]] || []).length;
      if (itemCount >= FIRST_BATCH_ITEMS && gi < groupOrder.length - 1) {
        firstBatchEnd = gi + 1;
        break;
      }
    }
  }

  // 首批立即渲染
  var html = '';
  for (var gi = 0; gi < firstBatchEnd; gi++) {
    var sec = groupOrder[gi];
    html += renderDocGroupHtml(sec, groups[sec], docs, childrenMap, selectFn);
  }
  list.innerHTML = html;

  // 剩余分组异步追加（每批最多 5 个分组，避免长帧）
  if (firstBatchEnd < groupOrder.length) {
    var remaining = groupOrder.slice(firstBatchEnd);
    var BATCH_SIZE = 5;
    (function appendBatch(start) {
      if (start >= remaining.length) return;
      var end = Math.min(start + BATCH_SIZE, remaining.length);
      setTimeout(function() {
        var batchHtml = '';
        for (var bi = start; bi < end; bi++) {
          var sec = remaining[bi];
          batchHtml += renderDocGroupHtml(sec, groups[sec], docs, childrenMap, selectFn);
        }
        // 使用临时容器插入 DOM，避免 innerHTML 覆盖已有内容
        var temp = document.createElement('div');
        temp.innerHTML = batchHtml;
        while (temp.firstChild) {
          list.appendChild(temp.firstChild);
        }
        appendBatch(end);
      }, 0);
    })(0);
  }
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
  // 更多按钮
  html += '<button class="docs-item-more" onclick="event.stopPropagation();openDocManageModal(\\x27' + docKey.replace(/'/g, "\\\\'") + '\\x27)" title="更多操作">⋯</button>';
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

// ========== Document Management Modal ==========
var _docManageKey = '';  // 当前管理弹层的文档 key

/** 打开文档管理弹层 */
function openDocManageModal(docKey) {
  _docManageKey = docKey;
  var overlay = document.getElementById('docManageOverlay');
  var titleEl = document.getElementById('docManageTitle');
  var metaEl = document.getElementById('docManageMeta');
  if (!overlay) return;

  // 从 docsData 中查找文档信息
  var doc = null;
  for (var i = 0; i < docsData.length; i++) {
    if (docItemKey(docsData[i]) === docKey) { doc = docsData[i]; break; }
  }

  if (titleEl) titleEl.textContent = doc ? doc.title : docKey;
  if (metaEl) {
    var meta = '';
    if (doc) {
      meta = doc.section + (doc.subSection ? ' | ' + doc.subSection : '');
      if (doc.updatedAt) meta += ' · ' + fmtDateShort(doc.updatedAt);
    }
    metaEl.textContent = meta;
  }

  // 重置删除按钮状态
  var delBtn = document.getElementById('docManageDeleteBtn');
  if (delBtn) { delBtn.disabled = false; delBtn.querySelector('.doc-manage-btn-text').textContent = '删除文档'; }

  overlay.classList.add('active');
}

/** 关闭文档管理弹层 */
function closeDocManageModal() {
  var overlay = document.getElementById('docManageOverlay');
  if (overlay) overlay.classList.remove('active');
  _docManageKey = '';
}

/** 确认并执行删除文档 */
function confirmDeleteDoc() {
  if (!_docManageKey) return;
  var parts = _docManageKey.split('|');
  var section = parts[0];
  var subSection = parts[1] || null;

  // 从 docsData 查找文档标题用于确认
  var docTitle = '';
  for (var i = 0; i < docsData.length; i++) {
    if (docItemKey(docsData[i]) === _docManageKey) { docTitle = docsData[i].title; break; }
  }

  if (!confirm('确定要删除文档「' + (docTitle || _docManageKey) + '」吗？\\n\\n此操作不可恢复！')) return;

  var delBtn = document.getElementById('docManageDeleteBtn');
  if (delBtn) { delBtn.disabled = true; delBtn.querySelector('.doc-manage-btn-text').textContent = '删除中...'; }

  fetch('/api/doc/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section: section, subSection: subSection })
  }).then(function(r) { return r.json().then(function(d) { return { status: r.status, body: d }; }); })
  .then(function(resp) {
    if (resp.status === 200 && resp.body.success) {
      // 删除成功：关闭弹层，刷新列表
      closeDocManageModal();
      // 从本地数据中移除
      docsData = docsData.filter(function(d) { return docItemKey(d) !== _docManageKey; });
      delete docContentCache[_docManageKey]; // Phase-159: 同步清除内容缓存
      renderDocsList(docsData);
      // 如果当前正在查看被删除的文档，清空右侧内容
      if (currentDocKey === _docManageKey) {
        currentDocKey = '';
        var contentInner = document.getElementById('docsContentInner');
        if (contentInner) contentInner.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#6b7280;font-size:13px;">文档已删除</div>';
        var contentTitle = document.getElementById('docsContentTitle');
        if (contentTitle) contentTitle.textContent = '';
      }
    } else {
      alert('删除失败: ' + (resp.body.error || '未知错误'));
      if (delBtn) { delBtn.disabled = false; delBtn.querySelector('.doc-manage-btn-text').textContent = '删除文档'; }
    }
  }).catch(function(err) {
    alert('删除失败: ' + err.message);
    if (delBtn) { delBtn.disabled = false; delBtn.querySelector('.doc-manage-btn-text').textContent = '删除文档'; }
  });
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

  // Phase-157: 缓存命中 → 零延迟渲染
  var cached = docContentCache[docKey];
  if (cached && cached.content !== undefined) {
    renderDocContent(cached, section, subSection);
    return;
  }

  // 缓存未命中 → 显示加载状态 + 请求 API
  document.getElementById('docsContentTitle').textContent = '加载中...';
  document.getElementById('docsContentMeta').innerHTML = '';
  document.getElementById('docsContentInner').innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;"><div class="spinner" style="margin:0 auto 12px;width:24px;height:24px;border-width:3px;"></div></div>';

  var url = '/api/doc?section=' + encodeURIComponent(section);
  if (subSection) url += '&subSection=' + encodeURIComponent(subSection);

  fetch(url).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(doc) {
    // 回填缓存
    docContentCache[docKey] = doc;
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

// ========== Add Document ==========

/** 显示添加文档表单 */
function showAddDocForm() {
  var overlay = document.getElementById('addDocOverlay');
  if (overlay) {
    overlay.style.display = 'flex';
    // 重置表单
    var titleInput = document.getElementById('addDocTitle');
    var contentArea = document.getElementById('addDocContent');
    var subSection = document.getElementById('addDocSubSection');
    var sectionSel = document.getElementById('addDocSection');
    if (titleInput) titleInput.value = '';
    if (contentArea) { contentArea.value = ''; updateAddDocCharCount(); }
    if (subSection) subSection.value = '';
    if (sectionSel) sectionSel.value = 'technical_notes';
    // 聚焦标题输入框
    setTimeout(function() { if (titleInput) titleInput.focus(); }, 100);
  }
}

/** 隐藏添加文档表单 */
function hideAddDocForm() {
  var overlay = document.getElementById('addDocOverlay');
  if (overlay) overlay.style.display = 'none';
}

/** 更新字符计数 */
function updateAddDocCharCount() {
  var ta = document.getElementById('addDocContent');
  var counter = document.getElementById('addDocCharCount');
  if (!ta || !counter) return;
  var text = ta.value || '';
  var chars = text.length;
  var lines = text ? text.split('\\n').length : 0;
  counter.textContent = chars + ' 字符 · ' + lines + ' 行';
}

/** 预览文档（在右侧内容区显示渲染结果） */
function previewAddDoc() {
  var content = (document.getElementById('addDocContent').value || '').trim();
  var title = (document.getElementById('addDocTitle').value || '').trim() || '未命名文档';
  if (!content) {
    document.getElementById('addDocContent').focus();
    return;
  }
  // 隐藏添加面板，显示内容区预览
  hideAddDocForm();
  document.getElementById('docsEmptyState').style.display = 'none';
  var contentView = document.getElementById('docsContentView');
  contentView.style.display = 'flex';
  document.getElementById('docsContentTitle').textContent = '[预览] ' + title;
  document.getElementById('docsContentMeta').innerHTML = '<span class="docs-content-tag" style="background:rgba(245,158,11,0.15);color:#fbbf24;">预览模式 — 未保存</span>';
  var inner = document.getElementById('docsContentInner');
  if (typeof renderMarkdown === 'function') {
    inner.innerHTML = renderMarkdown(content);
  } else if (typeof marked !== 'undefined') {
    inner.innerHTML = marked.parse(content);
  } else {
    inner.innerHTML = '<pre>' + escHtml(content) + '</pre>';
  }
  if (typeof mdEnhanceContent === 'function') mdEnhanceContent(inner);
}

/** 将标题转为 slug（用作 subSection 唯一标识） */
function titleToSlug(title) {
  // 保留中文、英文字母、数字，其余替换为连字符
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\\u4e00-\\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60) || ('doc-' + Date.now());
}

/** 提交添加文档 */
function submitAddDoc() {
  var section = document.getElementById('addDocSection').value;
  var subSectionInput = (document.getElementById('addDocSubSection').value || '').trim();
  var title = (document.getElementById('addDocTitle').value || '').trim();
  var content = (document.getElementById('addDocContent').value || '').trim();

  // 校验必填字段
  if (!title) {
    alert('请输入文档标题');
    document.getElementById('addDocTitle').focus();
    return;
  }
  if (!content) {
    alert('请输入 Markdown 内容');
    document.getElementById('addDocContent').focus();
    return;
  }

  // 自动生成 subSection：用户未填时从标题生成 slug，确保每篇文档有唯一的 section|subSection 键
  var subSection = subSectionInput || titleToSlug(title);

  // 禁用提交按钮
  var submitBtn = document.querySelector('.add-doc-btn-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ 提交中...'; }

  var payload = {
    section: section,
    subSection: subSection,
    title: title,
    content: content
  };

  // 使用 /api/doc/add（纯新增 API），后端会在文档已存在时返回 409 冲突
  fetch('/api/doc/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(r) {
    return r.json().then(function(body) { return { status: r.status, body: body }; });
  }).then(function(resp) {
    if (resp.status === 409) {
      // 文档已存在 — 询问用户是否覆盖
      if (confirm('已存在同名文档，是否覆盖更新？\\n' + (resp.body.error || ''))) {
        // 用户确认覆盖 → 走 /api/doc/save（upsert 语义）
        return fetch('/api/doc/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function(r2) {
          if (!r2.ok) throw new Error('HTTP ' + r2.status);
          return r2.json();
        }).then(function(result) {
          if (result.error) throw new Error(result.error);
          return { success: true };
        });
      } else {
        // 用户取消
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '📤 发布文档'; }
        return { cancelled: true };
      }
    }
    if (resp.body.error) throw new Error(resp.body.error);
    return { success: true };
  }).then(function(outcome) {
    if (!outcome || outcome.cancelled) return;
    // 成功
    hideAddDocForm();
    // 刷新文档列表 + 内容缓存
    docsLoaded = false;
    docContentCacheUpdatedAt = 0; // Phase-159: 强制内容缓存过期
    loadDocsData(function(data) {
      renderDocsList(docsData);
      // 自动选中刚添加的文档
      var newKey = section + '|' + subSection;
      selectDoc(newKey);
    });
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '📤 发布文档'; }
  }).catch(function(err) {
    alert('保存失败: ' + (err.message || err));
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '📤 发布文档'; }
  });
}

// 添加文档 textarea 事件绑定（在 DOM 就绪后）
(function() {
  var ta = document.getElementById('addDocContent');
  if (ta) {
    ta.addEventListener('input', updateAddDocCharCount);
    // Ctrl+Enter 提交
    ta.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); submitAddDoc(); }
      // Tab 缩进
      if (e.key === 'Tab') {
        e.preventDefault();
        var start = ta.selectionStart;
        var end = ta.selectionEnd;
        ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = start + 2;
        updateAddDocCharCount();
      }
    });
  }
  // 点击 overlay 背景关闭
  var overlay = document.getElementById('addDocOverlay');
  if (overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) hideAddDocForm();
    });
  }
})();

// ========== Batch Import ==========

/** 触发文件夹选择器 */
function triggerBatchImport() {
  var input = document.getElementById('batchImportInput');
  if (input) {
    input.value = ''; // 重置以支持重复选择同一文件夹
    input.click();
  }
}

/** 处理选中的文件夹文件 */
function handleBatchImportFiles(files) {
  if (!files || files.length === 0) return;

  // 过滤 .md 文件
  var mdFiles = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var name = f.name || '';
    if (name.toLowerCase().endsWith('.md') && f.size > 0) {
      mdFiles.push(f);
    }
  }

  if (mdFiles.length === 0) {
    alert('选中的文件夹中没有找到 .md 文件');
    return;
  }

  // 按相对路径排序
  mdFiles.sort(function(a, b) {
    var pa = a.webkitRelativePath || a.name;
    var pb = b.webkitRelativePath || b.name;
    return pa.localeCompare(pb);
  });

  // 确认导入
  if (!confirm('发现 ' + mdFiles.length + ' 个 .md 文件，确定批量导入吗？\\n\\n已存在的同名文档将被自动覆盖更新。')) return;

  // 隐藏添加表单，打开进度弹层
  hideAddDocForm();
  startBatchImport(mdFiles);
}

/** 从 Markdown 内容中提取标题（第一个 # 标题或文件名） */
function extractMdTitle(content, fileName) {
  // 匹配第一个 # 标题
  var match = content.match(/^#\\s+(.+)/m);
  if (match && match[1].trim()) return match[1].trim();
  // 回退到文件名（去掉 .md 扩展名）
  return (fileName || 'untitled').replace(/\\.md$/i, '');
}

/** 从相对路径推断 section 和 subSection */
function inferDocMeta(relativePath, fileName) {
  // relativePath 格式: "folder/subfolder/file.md" 或 "folder/file.md"
  var parts = relativePath.split('/');
  // 去掉最外层文件夹名和最后的文件名
  // e.g. "docs/api/auth.md" → parts = ["docs", "api", "auth.md"]
  var pathParts = parts.slice(1, -1); // 中间的子文件夹路径
  var baseName = (fileName || parts[parts.length - 1] || '').replace(/\\.md$/i, '');

  // section: 从子文件夹名映射到 DevPlan section 类型
  var sectionMap = {
    'overview': 'overview', 'api': 'api_design', 'api_design': 'api_design',
    'api_endpoints': 'api_endpoints', 'core': 'core_concepts', 'core_concepts': 'core_concepts',
    'config': 'config', 'examples': 'examples', 'notes': 'technical_notes',
    'technical_notes': 'technical_notes', 'tech': 'technical_notes',
    'file_structure': 'file_structure', 'structure': 'file_structure',
    'milestones': 'milestones', 'changelog': 'changelog', 'custom': 'custom'
  };

  var section = 'technical_notes'; // 默认 section
  if (pathParts.length > 0) {
    var firstDir = pathParts[0].toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (sectionMap[firstDir]) {
      section = sectionMap[firstDir];
    }
  }

  // subSection: 文件名转 slug
  var subSection = baseName.toLowerCase()
    .replace(/[^a-z0-9\\u4e00-\\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60) || ('doc-' + Date.now());

  // 如果有多层子文件夹，将中间路径也加入 subSection 作前缀
  if (pathParts.length > 1) {
    var prefix = pathParts.slice(sectionMap[pathParts[0].toLowerCase().replace(/[^a-z0-9_]/g, '_')] ? 1 : 0)
      .join('-').toLowerCase().replace(/[^a-z0-9\\u4e00-\\u9fff-]+/g, '-').replace(/^-+|-+$/g, '');
    if (prefix) subSection = prefix + '-' + subSection;
  }

  return { section: section, subSection: subSection };
}

/** 开始批量导入流程 */
function startBatchImport(mdFiles) {
  var overlay = document.getElementById('batchImportOverlay');
  var progressFill = document.getElementById('batchImportProgressFill');
  var progressText = document.getElementById('batchImportProgressText');
  var logEl = document.getElementById('batchImportLog');
  var summaryEl = document.getElementById('batchImportSummary');
  var closeBtn = document.getElementById('batchImportCloseBtn');
  var titleEl = document.getElementById('batchImportTitle');

  if (!overlay) return;

  // 重置 UI
  progressFill.style.width = '0%';
  progressText.textContent = '准备导入 ' + mdFiles.length + ' 个文件...';
  logEl.innerHTML = '';
  summaryEl.style.display = 'none';
  summaryEl.innerHTML = '';
  closeBtn.style.display = 'none';
  titleEl.textContent = '📂 批量导入文档';
  overlay.classList.add('active');

  var total = mdFiles.length;
  var done = 0;
  var successCount = 0;
  var errorCount = 0;
  var skipCount = 0;
  var cancelled = false;

  function addLog(icon, text, cls) {
    var item = document.createElement('div');
    item.className = 'batch-import-log-item' + (cls ? ' ' + cls : '');
    item.innerHTML = '<span class="batch-import-log-icon">' + icon + '</span><span>' + text + '</span>';
    logEl.appendChild(item);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function updateProgress() {
    var pct = Math.round(done / total * 100);
    progressFill.style.width = pct + '%';
    progressText.textContent = done + ' / ' + total + ' (' + pct + '%)';
  }

  function finish() {
    closeBtn.style.display = '';
    titleEl.textContent = cancelled ? '📂 导入已中断' : '📂 导入完成';
    summaryEl.style.display = '';
    summaryEl.innerHTML = '<div style="font-weight:600;margin-bottom:6px;">' + (cancelled ? '⚠️ 导入中断' : '✅ 导入完成') + '</div>'
      + '成功: <strong style="color:#6ee7b7;">' + successCount + '</strong> · '
      + '失败: <strong style="color:#fca5a5;">' + errorCount + '</strong> · '
      + '总计: <strong>' + total + '</strong>';

    // 刷新文档列表
    if (successCount > 0) {
      docsLoaded = false;
      docContentCacheUpdatedAt = 0; // Phase-159: 强制内容缓存过期
      loadDocsData(function() {
        renderDocsList(docsData);
      });
    }
  }

  // 逐个读取并上传
  function processNext(index) {
    if (cancelled || index >= total) {
      finish();
      return;
    }

    var file = mdFiles[index];
    var relativePath = file.webkitRelativePath || file.name;

    var reader = new FileReader();
    reader.onload = function(e) {
      var content = e.target.result || '';
      if (!content.trim()) {
        addLog('⏭', escHtml(relativePath) + ' — <em>空文件，已跳过</em>', 'skip');
        done++;
        skipCount++;
        updateProgress();
        processNext(index + 1);
        return;
      }

      var title = extractMdTitle(content, file.name);
      var meta = inferDocMeta(relativePath, file.name);

      var payload = {
        section: meta.section,
        subSection: meta.subSection,
        title: title,
        content: content
      };

      // 使用 /api/doc/save（upsert 语义）直接覆盖
      fetch('/api/doc/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function(r) {
        return r.json().then(function(body) { return { status: r.status, body: body }; });
      }).then(function(resp) {
        done++;
        if (resp.body.success || resp.status === 200) {
          successCount++;
          addLog('✅', escHtml(relativePath), 'success');
        } else {
          errorCount++;
          addLog('❌', escHtml(relativePath) + ' — ' + escHtml(resp.body.error || '未知错误'), 'error');
        }
        updateProgress();
        // 使用 setTimeout 避免阻塞 UI
        setTimeout(function() { processNext(index + 1); }, 50);
      }).catch(function(err) {
        done++;
        errorCount++;
        addLog('❌', escHtml(relativePath) + ' — ' + escHtml(err.message), 'error');
        updateProgress();
        setTimeout(function() { processNext(index + 1); }, 50);
      });
    };

    reader.onerror = function() {
      done++;
      errorCount++;
      addLog('❌', escHtml(relativePath) + ' — 读取文件失败', 'error');
      updateProgress();
      processNext(index + 1);
    };

    reader.readAsText(file, 'UTF-8');
  }

  addLog('📂', '开始导入 ' + total + ' 个 .md 文件...', '');
  processNext(0);
}

/** 关闭批量导入弹层 */
function closeBatchImport() {
  var overlay = document.getElementById('batchImportOverlay');
  if (overlay) overlay.classList.remove('active');
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

// ========== Test Tools ==========
var testToolsLoaded = false;
var testToolsTimer = null;
var testToolsLatestData = { items: [] };
var testToolsSelectedToolId = '';

function loadTestToolsPage() {
  if (!testToolsLoaded) {
    var content = document.getElementById('testToolsContent');
    if (content) {
      content.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280;"><div class="spinner" style="margin:0 auto 12px;"></div>加载测试工具状态...</div>';
    }
  }
  refreshTestTools();

  if (testToolsTimer) return;
  testToolsTimer = setInterval(function() {
    if (currentPage === 'test-tools') {
      refreshTestTools();
    }
  }, 10000);
}

function refreshTestTools() {
  fetch('/api/test-tools/status?includeRaw=true')
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) {
      testToolsLoaded = true;
      testToolsLatestData = data || { items: [] };
      renderTestToolsPage(data || {});
    })
    .catch(function(err) {
      var content = document.getElementById('testToolsContent');
      if (content) {
        content.innerHTML = '<div style="text-align:center;padding:60px;color:#f87171;">加载失败: ' +
          escHtml(err.message || String(err)) +
          '<br><button class="refresh-btn" style="margin-top:12px;" onclick="refreshTestTools()">重试</button></div>';
      }
    });
}

function openTestToolDetail(toolId) {
  testToolsSelectedToolId = String(toolId || '');
  renderTestToolsPage(testToolsLatestData || { items: [] });
}

function openTestToolDetailByIndex(idx) {
  var items = (testToolsLatestData && testToolsLatestData.items) ? testToolsLatestData.items : [];
  var it = items[idx];
  var toolId = it && it.tool && it.tool.id ? String(it.tool.id) : '';
  if (!toolId) return;
  openTestToolDetail(toolId);
}

function closeTestToolDetail() {
  testToolsSelectedToolId = '';
  renderTestToolsPage(testToolsLatestData || { items: [] });
}

function fmtNum(n) {
  var x = Number(n || 0);
  if (!isFinite(x)) return '0';
  return x.toLocaleString('en-US');
}

function formatProgressWithCount(it) {
  var pct = Number(it && it.progress || 0);
  var raw = it && it.raw ? it.raw : null;
  var inserted = raw && raw.inserted != null ? Number(raw.inserted) : NaN;
  var total = raw && raw.totalImages != null ? Number(raw.totalImages) : NaN;
  if (isFinite(inserted) && isFinite(total) && total > 0) {
    return pct + '% (' + fmtNum(inserted) + '/' + fmtNum(total) + ')';
  }
  return pct + '%';
}

function renderTestToolsPage(data) {
  var summary = document.getElementById('testToolsSummary');
  var content = document.getElementById('testToolsContent');
  if (!summary || !content) return;

  var items = data.items || [];
  var reachable = 0;
  var running = 0;
  var stalled = 0;
  var completed = 0;
  for (var i = 0; i < items.length; i++) {
    var st = String(items[i].state || '');
    if (items[i].reachable) reachable++;
    if (
      st === 'running' ||
      st === 'compiling' ||
      st === 'preparing_data' ||
      st === 'compile_active' ||
      st === 'build_planning' ||
      st === 'build_handoff_to_run'
    ) running++;
    if (st === 'stalled' || st === 'aborted' || st === 'unreachable') stalled++;
    if (st === 'completed') completed++;
  }

  summary.innerHTML =
    statCard('🧩', items.length, '已注册工具', '', 'blue') +
    statCard('🟢', reachable, '可达', '', 'green') +
    statCard('🔄', running, '运行中', '', 'amber') +
    statCard('⏸', stalled, '异常/卡住', '', 'rose') +
    statCard('✅', completed, '已完成', '', 'purple');

  if (items.length === 0) {
    content.innerHTML = '<div style="text-align:center;padding:60px;color:#6b7280;">暂无已注册测试工具</div>';
    return;
  }

  var html = '';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<thead><tr style="color:#93a4c7;border-bottom:1px solid #263655;">' +
    '<th style="text-align:left;padding:8px;">工具</th>' +
    '<th style="text-align:left;padding:8px;">项目</th>' +
    '<th style="text-align:left;padding:8px;">状态</th>' +
    '<th style="text-align:left;padding:8px;">进度</th>' +
    '<th style="text-align:left;padding:8px;">当前阶段</th>' +
    '<th style="text-align:left;padding:8px;">入口</th>' +
    '</tr></thead><tbody>';

  for (var j = 0; j < items.length; j++) {
    var it = items[j];
    var state = String(it.state || 'unknown');
    var stateColor = '#fbbf24';
    if (state === 'completed' || state === 'ok') stateColor = '#34d399';
    if (state === 'stalled' || state === 'aborted' || state === 'unreachable') stateColor = '#f87171';
    var phase = it.phase ? (it.phase.taskId + ' (' + (it.phase.percent || 0) + '%)') : '-';
    var endpoint = it.tool && it.tool.endpoint ? String(it.tool.endpoint) : '';
    var openAction = endpoint
      ? '<a href="' + escHtml(endpoint) + '" target="_blank" style="color:#818cf8;text-decoration:none;">打开</a>'
      : '<a href="javascript:void(0)" onclick="openTestToolDetailByIndex(' + j + ')" style="color:#818cf8;text-decoration:none;">打开</a>';
    html += '<tr style="border-bottom:1px solid #1e2b46;">' +
      '<td style="padding:8px;">' + escHtml((it.tool && it.tool.name) || '-') + '</td>' +
      '<td style="padding:8px;color:#9fb0d1;">' + escHtml((it.tool && it.tool.projectName) || '-') + '</td>' +
      '<td style="padding:8px;color:' + stateColor + ';font-weight:600;">' + escHtml(state) + '</td>' +
      '<td style="padding:8px;">' + formatProgressWithCount(it) + '</td>' +
      '<td style="padding:8px;color:#9fb0d1;">' + escHtml(phase) + '</td>' +
      '<td style="padding:8px;">' + openAction + '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';

  var selected = null;
  if (testToolsSelectedToolId) {
    for (var k = 0; k < items.length; k++) {
      var cur = items[k];
      if (cur && cur.tool && String(cur.tool.id || '') === testToolsSelectedToolId) {
        selected = cur;
        break;
      }
    }
  }

  if (selected && selected.raw) {
    var raw = selected.raw || {};
    var inserted = fmtNum(raw.inserted || 0);
    var total = fmtNum(raw.totalImages || 0);
    var stale = Number(raw.staleSeconds || 0);
    var logTail = (raw.tail && raw.tail.join) ? raw.tail.join(String.fromCharCode(10)) : '';
    html += '<div style="margin-top:14px;border:1px solid #223150;border-radius:12px;background:rgba(14,22,45,.5);padding:14px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<div style="font-size:13px;font-weight:700;color:#dbe7ff;">内置详情 · ' + escHtml((selected.tool && selected.tool.name) || '-') + '</div>' +
      '<a href="javascript:void(0)" onclick="closeTestToolDetail()" style="color:#8da2d6;text-decoration:none;font-size:12px;">关闭</a>' +
      '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;margin-bottom:10px;">' +
      '<div style="background:#111d39;border:1px solid #223150;border-radius:8px;padding:8px;"><div style="font-size:11px;color:#8da2d6;">progress</div><div style="font-size:14px;color:#e9f2ff;font-weight:700;">' + Number(selected.progress || 0) + '%</div></div>' +
      '<div style="background:#111d39;border:1px solid #223150;border-radius:8px;padding:8px;"><div style="font-size:11px;color:#8da2d6;">inserted</div><div style="font-size:14px;color:#e9f2ff;font-weight:700;">' + inserted + '</div></div>' +
      '<div style="background:#111d39;border:1px solid #223150;border-radius:8px;padding:8px;"><div style="font-size:11px;color:#8da2d6;">total</div><div style="font-size:14px;color:#e9f2ff;font-weight:700;">' + total + '</div></div>' +
      '<div style="background:#111d39;border:1px solid #223150;border-radius:8px;padding:8px;"><div style="font-size:11px;color:#8da2d6;">staleSeconds</div><div style="font-size:14px;color:#e9f2ff;font-weight:700;">' + stale + '</div></div>' +
      '</div>';
    html += '<div style="font-size:11px;color:#8da2d6;margin-bottom:6px;">log tail</div>';
    html += '<pre style="margin:0;max-height:260px;overflow:auto;background:#0a1430;border:1px solid #223150;border-radius:8px;padding:10px;color:#c6d5f3;font-size:11px;line-height:1.45;">' + escHtml(logTail || '(empty)') + '</pre>';
    html += '</div>';
  }

  content.innerHTML = html;
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

    h += '<div class="memory-card type-' + type + '" id="memCard_' + mem.id + '">';

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

    // footer: tags + meta + Phase-78 verify button
    h += '<div class="memory-card-footer">';
    var tags = mem.tags || [];
    for (var t = 0; t < tags.length; t++) {
      h += '<span class="memory-tag">#' + escHtml(tags[t]) + '</span>';
    }
    // Phase-78: 逐条完整性检测按钮
    h += '<button class="mem-verify-single-btn" onclick="checkSingleMemoryIntegrity(\\x27' + mem.id + '\\x27)" title="检测此记忆的完整性">🔍 检测</button>';
    h += '<span class="memory-meta">';
    if (mem.hitCount > 0) {
      h += '<span title="被召回次数">🔍 ' + mem.hitCount + '</span>';
    }
    if (mem.createdAt) {
      h += '<span>' + formatMemoryTime(mem.createdAt) + '</span>';
    }
    h += '</span>';
    h += '</div>';

    // Phase-78: 内联检测结果占位
    h += '<div id="memVerify_' + mem.id + '"></div>';

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

// [Phase-77: Memory 3D graph removed, list-only view]
// Memory page now only supports list view — renderMemoryGraph3D and all graph code removed.
// ========== Phase-60: AI 批量生成（浏览器直连 Ollama） ==========
var _aiBatchCancelled = false;
var _aiBatchRunning = false;
var _aiBatchConfig = null; // { llmEngine, isExternalModel, ollamaBaseUrl, ollamaModel, systemPrompt }
var _BATCH_CACHE_KEY = 'aiBatch_phaseA_cache';  // Phase-65: localStorage key
var _aiBatchRepairContext = null; // { sourceRefs: string[], memoryIds: string[] }

// ─── Phase-65: localStorage 断点续传辅助函数 ───
function _batchCacheLoad() {
  try {
    var raw = localStorage.getItem(_BATCH_CACHE_KEY);
    if (!raw) return null;
    var cache = JSON.parse(raw);
    if (!cache || !Array.isArray(cache.results)) return null;
    return cache; // { timestamp, model, source, limit, results: [{sourceRef, ...saveBody}] }
  } catch(e) { return null; }
}

function _batchCacheSave(model, source, limit, results) {
  try {
    localStorage.setItem(_BATCH_CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      model: model,
      source: source,
      limit: limit,
      results: results
    }));
  } catch(e) {
    // localStorage full or unavailable — silent fail
    console.warn('[BatchCache] localStorage save failed:', e);
  }
}

function _batchCacheClear() {
  try { localStorage.removeItem(_BATCH_CACHE_KEY); } catch(e) {}
}

function _batchCacheSourceIds(cache) {
  var set = {};
  if (cache && cache.results) {
    for (var i = 0; i < cache.results.length; i++) {
      var sid = cache.results[i].sourceRef && cache.results[i].sourceRef.sourceId;
      if (sid) set[sid] = true;
    }
  }
  return set;
}

function startAiBatchGenerate() {
  // close dropdown
  var dd = document.getElementById('memGenDropdown');
  if (dd) dd.classList.remove('show');

  var overlay = document.getElementById('aiBatchOverlay');
  if (overlay) overlay.style.display = 'flex';

  // reset UI
  var statusEl = document.getElementById('aiBatchStatus');
  var detailEl = document.getElementById('aiBatchDetail');
  var progressEl = document.getElementById('aiBatchProgress');
  var streamArea = document.getElementById('aiBatchStreamArea');
  var summaryEl = document.getElementById('aiBatchSummary');
  var configArea = document.getElementById('aiBatchConfigArea');
  var startBtn = document.getElementById('aiBatchStartBtn');
  var cancelBtn = document.getElementById('aiBatchCancelBtn');
  if (statusEl) statusEl.textContent = '正在加载配置...';
  if (detailEl) detailEl.textContent = '';
  if (progressEl) progressEl.style.width = '0%';
  if (streamArea) { streamArea.style.display = 'none'; streamArea.textContent = ''; }
  if (summaryEl) summaryEl.style.display = 'none';
  // Phase-69: 重置完整性检测区域
  var verifyArea = document.getElementById('aiBatchVerifyArea');
  if (verifyArea) { verifyArea.style.display = 'none'; verifyArea.innerHTML = ''; }
  if (configArea) configArea.style.display = 'flex';
  if (startBtn) { startBtn.disabled = false; startBtn.textContent = '开始'; }
  if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.textContent = '取消'; cancelBtn.onclick = function() { cancelAiBatch(); }; }

  // Phase-65: 移除旧的续传按钮（如果有）
  var oldResumeBtn = document.getElementById('aiBatchResumeBtn');
  if (oldResumeBtn) oldResumeBtn.remove();
  var oldClearBtn = document.getElementById('aiBatchClearCacheBtn');
  if (oldClearBtn) oldClearBtn.remove();
  var oldCacheInfo = document.getElementById('aiBatchCacheInfo');
  if (oldCacheInfo) oldCacheInfo.remove();

  // fetch config from server
  fetch('/api/batch/config').then(function(r) { return r.json(); }).then(function(cfg) {
    _aiBatchConfig = cfg;
    var urlInput = document.getElementById('aiBatchOllamaUrl');
    var modelInput = document.getElementById('aiBatchModel');
    if (urlInput) urlInput.value = cfg.ollamaBaseUrl || 'http://localhost:11434';
    if (modelInput) modelInput.value = cfg.ollamaModel || 'gemma3:27b';

    // Phase-65: 检测 localStorage 缓存
    var existingCache = _batchCacheLoad();
    if (existingCache && existingCache.results.length > 0) {
      var cacheAge = Date.now() - (existingCache.timestamp || 0);
      var cacheAgeMin = Math.round(cacheAge / 60000);
      var cacheAgeStr = cacheAgeMin < 60
        ? cacheAgeMin + ' 分钟前'
        : Math.round(cacheAgeMin / 60) + ' 小时前';

      // 显示缓存信息
      if (statusEl) statusEl.textContent = '🔄 发现未完成的批量任务';

      var cacheInfo = document.createElement('div');
      cacheInfo.id = 'aiBatchCacheInfo';
      cacheInfo.style.cssText = 'margin:8px 0 12px;padding:10px 14px;background:rgba(96,165,250,0.15);border:1px solid rgba(96,165,250,0.3);border-radius:8px;font-size:13px;color:#93c5fd;';
      var cacheLimit = existingCache.limit || 'all';
      var cacheLimitLabel = cacheLimit === 'all' ? '全部' : (cacheLimit + ' 条');
      cacheInfo.innerHTML = '📦 Phase A 缓存: <b>' + existingCache.results.length + ' 条</b> LLM 结果'
        + '<br><span style="color:#9ca3af;font-size:12px;">模型: ' + (existingCache.model || '?') + ' · 来源: ' + (existingCache.source || 'both') + ' · 批次: ' + cacheLimitLabel + ' · ' + cacheAgeStr + '</span>';

      // 续传按钮
      var resumeBtn = document.createElement('button');
      resumeBtn.id = 'aiBatchResumeBtn';
      resumeBtn.textContent = '⚡ 续传（跳过已缓存，继续 Phase A → Phase B）';
      resumeBtn.style.cssText = 'padding:8px 16px;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;margin:4px 8px 4px 0;';
      resumeBtn.onclick = function() { startAiBatchProcess(true); };

      // 仅 Phase B 按钮（跳过所有 Phase A，直接保存已缓存的）
      var phaseBOnlyBtn = document.createElement('button');
      phaseBOnlyBtn.id = 'aiBatchPhaseBOnlyBtn';
      phaseBOnlyBtn.textContent = '💾 仅 Phase B（直接保存 ' + existingCache.results.length + ' 条缓存）';
      phaseBOnlyBtn.style.cssText = 'padding:8px 16px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;margin:4px 8px 4px 0;';
      phaseBOnlyBtn.onclick = function() { startAiBatchProcess('phaseB_only'); };

      // 清除缓存按钮
      var clearCacheBtn = document.createElement('button');
      clearCacheBtn.id = 'aiBatchClearCacheBtn';
      clearCacheBtn.textContent = '🗑 清除缓存，重新开始';
      clearCacheBtn.style.cssText = 'padding:8px 16px;background:rgba(239,68,68,0.2);color:#f87171;border:1px solid rgba(239,68,68,0.3);border-radius:6px;cursor:pointer;font-size:13px;margin:4px 0;';
      clearCacheBtn.onclick = function() {
        _batchCacheClear();
        cacheInfo.remove();
        resumeBtn.remove();
        phaseBOnlyBtn.remove();
        clearCacheBtn.remove();
        if (statusEl) statusEl.textContent = '就绪 — 缓存已清除，点击"开始"重新启动';
      };

      // 插入到 configArea 前面
      var configArea2 = document.getElementById('aiBatchConfigArea');
      if (configArea2 && configArea2.parentNode) {
        configArea2.parentNode.insertBefore(cacheInfo, configArea2);
        configArea2.parentNode.insertBefore(resumeBtn, configArea2);
        configArea2.parentNode.insertBefore(phaseBOnlyBtn, configArea2);
        configArea2.parentNode.insertBefore(clearCacheBtn, configArea2);
      }
    } else {
      if (statusEl) statusEl.textContent = '就绪 — 点击"开始"启动';
    }
  }).catch(function(err) {
    if (statusEl) statusEl.textContent = '⚠️ 加载配置失败，使用默认值';
    _aiBatchConfig = { llmEngine: 'ollama', isExternalModel: false, ollamaBaseUrl: 'http://localhost:11434', ollamaModel: 'gemma3:27b', systemPrompt: '' };
  });
}

function cancelAiBatch() {
  if (_aiBatchRunning) {
    _aiBatchCancelled = true;
    var cancelBtn = document.getElementById('aiBatchCancelBtn');
    if (cancelBtn) { cancelBtn.disabled = true; cancelBtn.textContent = '取消中...'; }
  } else {
    closeAiBatch();
  }
}

function closeAiBatch() {
  var overlay = document.getElementById('aiBatchOverlay');
  if (overlay) overlay.style.display = 'none';
  _aiBatchRunning = false;
  _aiBatchCancelled = false;
}

// Phase-65: resumeMode 参数:
//   false/undefined = 重新开始（清除缓存 → Phase A → Phase B）
//   true = 续传（从缓存续传 Phase A 剩余 → Phase B）
//   'phaseB_only' = 仅执行 Phase B（跳过 Phase A，直接保存缓存）
function startAiBatchProcess(resumeMode) {
  var urlInput = document.getElementById('aiBatchOllamaUrl');
  var modelInput = document.getElementById('aiBatchModel');
  var sourceSelect = document.getElementById('aiBatchSource');
  var limitSelect = document.getElementById('aiBatchLimit');
  var ollamaUrl = urlInput ? urlInput.value.trim() : 'http://localhost:11434';
  var model = modelInput ? modelInput.value.trim() : 'gemma3:27b';
  var source = sourceSelect ? sourceSelect.value : 'both';
  var batchLimitValue = limitSelect ? String(limitSelect.value || 'all') : 'all';
  var batchLimit = batchLimitValue === 'all' ? 99999 : parseInt(batchLimitValue, 10);
  if (!(batchLimit > 0)) batchLimit = 99999;
  if (batchLimit >= 99999) batchLimitValue = 'all';
  var forcedSourceRefs = (_aiBatchRepairContext && _aiBatchRepairContext.sourceRefs && _aiBatchRepairContext.sourceRefs.length > 0)
    ? _aiBatchRepairContext.sourceRefs.slice()
    : null;

  // get systemPrompt from config or use default
  var systemPrompt = (_aiBatchConfig && _aiBatchConfig.systemPrompt) ? _aiBatchConfig.systemPrompt : '你是一个记忆构建助手。请根据以下文档/任务内容生成多级记忆。\\n生成三个层级（必须以 JSON 返回）：\\n- L1（触点摘要）：一句话概括（15~30字）\\n- L2（详细记忆）：默认 3~8句话，包含关键技术细节\\n- L3_index（结构索引）：列出主要组件、依赖关系\\n- memoryType：从 decision/pattern/bugfix/insight/preference/summary 选择\\n- importance：0~1\\n- suggestedTags：标签数组\\n- anchorName：触点名称\\n- anchorType：触点类型（module/concept/api/architecture/feature/library/protocol）\\n- anchorOverview：触点概览（3~5句话目录索引式摘要，列出关键子项、核心 Flow、主要组件）\\n\\n粒度策略（必须遵守）：\\n- decision/bugfix：L2 必须保留决策/根因+修复思路+关键代码片段+文件路径（若原文存在）\\n- summary：仅保留 2~3 句概要\\n- pattern/insight/preference：保留 1~3 句结论 + 一个最小示例\\n- 若输入包含原始材料入口（commit/diff/log），L2 与 L3_index 必须保留这些追溯线索\\n- 不要沿用旧版 L1/L2/L3 定义\\n\\n请严格以 JSON 格式返回：\\n{"L1": "...", "L2": "...", "L3_index": "...", "memoryType": "...", "importance": 0.7, "suggestedTags": [...], "anchorName": "...", "anchorType": "...", "anchorOverview": "..."}';

  _aiBatchCancelled = false;
  _aiBatchRunning = true;

  var configArea = document.getElementById('aiBatchConfigArea');
  var startBtn = document.getElementById('aiBatchStartBtn');
  if (configArea) configArea.style.display = 'none';
  if (startBtn) startBtn.disabled = true;

  // Phase-65: 隐藏续传相关按钮
  var resumeBtn = document.getElementById('aiBatchResumeBtn');
  var phaseBOnlyBtn = document.getElementById('aiBatchPhaseBOnlyBtn');
  var clearCacheBtn = document.getElementById('aiBatchClearCacheBtn');
  var cacheInfoEl = document.getElementById('aiBatchCacheInfo');
  if (resumeBtn) resumeBtn.style.display = 'none';
  if (phaseBOnlyBtn) phaseBOnlyBtn.style.display = 'none';
  if (clearCacheBtn) clearCacheBtn.style.display = 'none';
  if (cacheInfoEl) cacheInfoEl.style.display = 'none';

  var titleEl = document.getElementById('aiBatchTitle');
  var statusEl = document.getElementById('aiBatchStatus');
  var detailEl = document.getElementById('aiBatchDetail');
  var progressEl = document.getElementById('aiBatchProgress');
  var streamArea = document.getElementById('aiBatchStreamArea');
  var summaryEl = document.getElementById('aiBatchSummary');
  var cancelBtn = document.getElementById('aiBatchCancelBtn');

  var modeLabel = resumeMode === 'phaseB_only' ? '仅 Phase B' : (resumeMode ? '续传模式' : '分相模式');
  if (titleEl) titleEl.textContent = '🚀 AI 批量生成记忆（' + modeLabel + '）';
  if (statusEl) statusEl.textContent = '正在获取候选项...';
  if (streamArea) { streamArea.style.display = 'block'; streamArea.textContent = ''; }

  var totalSaved = 0;
  var totalFailed = 0;
  var totalSkipped = 0;
  var phaseASkipped = 0;
  var phaseACached = 0;  // Phase-65: 从缓存恢复的数量
  var phaseAIntegrityRetries = 0;
  var phaseAIntegrityDropped = 0;
  var startTime = Date.now();
  var cursorBatchSeed = String(startTime);
  var cursorContentSessionId = 'visual-batch-content-' + cursorBatchSeed;
  var cursorMemorySessionId = 'visual-batch-memory-' + cursorBatchSeed;
  var fetchProgressTimer = null;
  var fetchProgressValue = 0;
  var PHASE_A_MAX_RETRIES = ((_aiBatchConfig && _aiBatchConfig.phaseAIntegrityMaxRetries) || 3);
  var VALID_MEMORY_TYPES = {
    decision: true,
    pattern: true,
    bugfix: true,
    insight: true,
    preference: true,
    summary: true
  };

  function stopCandidateFetchProgress() {
    if (fetchProgressTimer) {
      clearInterval(fetchProgressTimer);
      fetchProgressTimer = null;
    }
  }

  // Phase-112: 第一步“获取候选项”增加可见进度反馈（伪进度，避免静态等待）
  function startCandidateFetchProgress() {
    stopCandidateFetchProgress();
    fetchProgressValue = 2;
    if (progressEl) progressEl.style.width = fetchProgressValue + '%';
    if (detailEl) detailEl.textContent = '🔎 正在扫描文档与任务，准备候选项...';
    fetchProgressTimer = setInterval(function() {
      if (!_aiBatchRunning) {
        stopCandidateFetchProgress();
        return;
      }
      fetchProgressValue = Math.min(14, fetchProgressValue + Math.random() * 1.6 + 0.7);
      if (progressEl) progressEl.style.width = fetchProgressValue.toFixed(1) + '%';
    }, 220);
  }

  function normalizeMemoryType(v) {
    if (typeof v !== 'string') return '';
    return v.toLowerCase().replace(/[^a-z]/g, '');
  }

  function buildPreparedEntry(candidate, rawContent, candidateSourceId, candidateTitle, parsed) {
    var memContent = '';
    var memContentL1 = '';
    var memContentL2 = '';
    var memContentL3 = rawContent;
    var memType = candidate.suggestedMemoryType || 'summary';
    var memImportance = candidate.suggestedImportance || 0.5;
    var memTags = candidate.suggestedTags || [];
    var anchorName = null;
    var anchorType = null;
    var anchorOverview = null;

    if (parsed) {
      memContentL1 = parsed.L1 || rawContent.slice(0, 100);
      memContentL2 = parsed.L2 || parsed.L3_index || parsed.L3_summary || rawContent.slice(0, 500);
      memContent = parsed.L2 || parsed.L1 || rawContent.slice(0, 500);
      memType = parsed.memoryType || memType;
      memImportance = parsed.importance || memImportance;
      if (parsed.suggestedTags && parsed.suggestedTags.length > 0) memTags = parsed.suggestedTags;
      anchorName = parsed.anchorName || null;
      anchorType = parsed.anchorType || null;
      anchorOverview = parsed.anchorOverview || null;
    } else {
      // Fallback: no valid JSON from LLM
      memContentL1 = rawContent.slice(0, 100);
      memContentL2 = rawContent.slice(0, 500);
      memContent = rawContent.slice(0, 500);
    }

    return {
      memoryType: memType,
      content: memContent,
      tags: memTags,
      relatedTaskId: candidate.sourceType === 'task' ? candidateSourceId : undefined,
      sourceRef: candidate.sourceRef || (candidateSourceId ? { sourceId: candidateSourceId } : undefined),
      provenance: {
        origin: 'batch_import_ui',
        evidences: []
      },
      importance: memImportance,
      contentL1: memContentL1,
      contentL2: memContentL2,
      contentL3: memContentL3,
      anchorName: anchorName,
      anchorType: anchorType,
      anchorOverview: anchorOverview,
      _title: candidateTitle
    };
  }

  function validatePreparedEntry(entry) {
    var issues = [];
    var normType = normalizeMemoryType(entry.memoryType);
    if (!VALID_MEMORY_TYPES[normType]) {
      issues.push('memoryType 非法');
    }

    var imp = Number(entry.importance);
    if (!(imp >= 0 && imp <= 1)) {
      issues.push('importance 异常');
    }

    var content = String(entry.content || '');
    if (content.trim().length < 30) {
      issues.push('content 过短');
    }

    var l1 = String(entry.contentL1 || '');
    if (l1.trim().length < 8) {
      issues.push('L1 过短');
    }

    var l2 = String(entry.contentL2 || '');
    if (l2.trim().length < 30) {
      issues.push('L2 过短');
    }

    var anchorName = String(entry.anchorName || '').trim();
    if (!anchorName) {
      issues.push('缺少 anchorName');
    }

    return { pass: issues.length === 0, issues: issues };
  }

  // Phase-64: 分相缓存 — Phase A 的 LLM 结果暂存在 JS 数组中
  var preparedResults = [];

  // Phase-65: 加载已有缓存（如果是续传模式）
  var existingCache = (resumeMode) ? _batchCacheLoad() : null;
  var cachedSourceIds = existingCache ? _batchCacheSourceIds(existingCache) : {};

  if (resumeMode && existingCache && existingCache.results.length > 0) {
    // 恢复已缓存的 Phase A 结果
    preparedResults = existingCache.results.slice();
    phaseACached = preparedResults.length;
    // 使用缓存中的 source 配置
    if (existingCache.source) source = existingCache.source;
    if (existingCache.limit) {
      batchLimitValue = String(existingCache.limit);
      batchLimit = batchLimitValue === 'all' ? 99999 : parseInt(batchLimitValue, 10);
      if (!(batchLimit > 0)) batchLimit = 99999;
      if (limitSelect) limitSelect.value = batchLimitValue;
    }
  } else if (!resumeMode) {
    // 重新开始：清除旧缓存
    _batchCacheClear();
  }

  // phaseB_only 模式：跳过 Phase A，直接 Phase B
  if (resumeMode === 'phaseB_only') {
    if (preparedResults.length === 0) {
      if (statusEl) statusEl.textContent = '❌ 没有缓存数据可用';
      _aiBatchRunning = false;
      if (cancelBtn) { cancelBtn.textContent = '关闭'; cancelBtn.onclick = function() { closeAiBatch(); }; }
      return;
    }
    if (statusEl) statusEl.textContent = '📦 从缓存加载 ' + preparedResults.length + ' 条 → 直接进入 Phase B...';
    if (streamArea) {
      streamArea.textContent = '⚡ 跳过 Phase A（使用 ' + preparedResults.length + ' 条缓存结果）\\n🔄 切换到 Phase B: 保存记忆 + Embedding ...\\n   （Ollama 将切换到 embedding 模型，请稍候）';
    }
    setTimeout(function() { processPhaseB(); }, 1000);
    return;
  }

  // Step 1: Get all candidates
  startCandidateFetchProgress();
  var genUrl = '/api/memories/generate?source=' + encodeURIComponent(source) + '&limit=' + encodeURIComponent(String(batchLimit));
  if (forcedSourceRefs && forcedSourceRefs.length > 0) {
    genUrl += '&sourceRefs=' + encodeURIComponent(forcedSourceRefs.join(','));
  }
  fetch(genUrl)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      stopCandidateFetchProgress();
      if (progressEl) progressEl.style.width = '15%';
      var candidates = data.candidates || [];
      totalSkipped = (data.stats && data.stats.skippedWithMemory) || 0;

      if (candidates.length === 0 && preparedResults.length === 0) {
        if (statusEl) statusEl.textContent = '✅ 没有可处理的候选项' + (totalSkipped > 0 ? '（已跳过 ' + totalSkipped + ' 条已有记忆）' : '');
        if (progressEl) progressEl.style.width = '100%';
        _aiBatchRunning = false;
        _batchCacheClear();
        if (cancelBtn) { cancelBtn.textContent = '关闭'; cancelBtn.onclick = function() { closeAiBatch(); }; }
        return;
      }

      // Phase-65: 如果没有新候选但有缓存 → 直接 Phase B
      if (candidates.length === 0 && preparedResults.length > 0) {
        if (statusEl) statusEl.textContent = '✅ 无新候选项，直接保存 ' + preparedResults.length + ' 条缓存结果';
        if (progressEl) progressEl.style.width = '60%';
        if (streamArea) {
          streamArea.textContent = '📦 无需 Phase A（全部已缓存: ' + preparedResults.length + ' 条）\\n🔄 切换到 Phase B: 保存记忆 + Embedding ...';
        }
        setTimeout(function() { processPhaseB(); }, 1000);
        return;
      }

      // Phase-65: 过滤已缓存的候选项
      var newCandidates = [];
      var cacheHits = 0;
      for (var ci = 0; ci < candidates.length; ci++) {
        var candidateSourceId = candidates[ci].sourceRef && candidates[ci].sourceRef.sourceId;
        if (candidateSourceId && cachedSourceIds[candidateSourceId]) {
          cacheHits++;
        } else {
          newCandidates.push(candidates[ci]);
        }
      }

      var totalCandidates = newCandidates.length + phaseACached;
      if (resumeMode && cacheHits > 0) {
        if (statusEl) statusEl.textContent = '📦 缓存命中: ' + phaseACached + ' 条 · 新增: ' + newCandidates.length + ' 条 — Phase A: LLM 生成开始...';
      } else {
        var targetedHint = (forcedSourceRefs && forcedSourceRefs.length > 0) ? '（定向修复模式）' : '';
        if (statusEl) statusEl.textContent = '共 ' + newCandidates.length + ' 条候选项' + targetedHint + (totalSkipped > 0 ? '（跳过 ' + totalSkipped + ' 条已有）' : '') + ' — Phase A: LLM 生成开始...';
      }

      // 如果没有新候选需要处理 → 直接 Phase B
      if (newCandidates.length === 0) {
        if (progressEl) progressEl.style.width = '60%';
        if (streamArea) {
          streamArea.textContent = '✅ Phase A: 全部 ' + phaseACached + ' 条已在缓存中，无需重新生成\\n🔄 切换到 Phase B: 保存记忆 + Embedding ...';
        }
        setTimeout(function() { processPhaseB(); }, 1000);
        return;
      }

      // ═══════════════════════════════════════════════════
      // Phase A: 新候选 → callOllamaStream(gemma3:27b) → 缓存到 preparedResults
      //   gemma3:27b 全程保持加载，不会触发 Embedding 模型
      // ═══════════════════════════════════════════════════
      var idxA = 0;
      function processPhaseA() {
        if (_aiBatchCancelled || idxA >= newCandidates.length) {
          onPhaseADone();
          return;
        }

        var c = newCandidates[idxA];
        var rawContent = c.contentL3 || c.content || '';
        var candidateSourceId = (c.sourceRef && c.sourceRef.sourceId) || c.sourceId;
        var candidateTitle = c.sourceTitle || c.title || candidateSourceId || 'unknown';

        // Skip very short content
        if (!rawContent || rawContent.length < 50) {
          idxA++;
          phaseASkipped++;
          if (detailEl) detailEl.textContent = '跳过过短内容: ' + candidateTitle;
          setTimeout(processPhaseA, 50);
          return;
        }

        var truncated = rawContent.length > 12000
          ? rawContent.slice(0, 12000) + '\\n\\n[... 内容已截断，共 ' + rawContent.length + ' 字符]'
          : rawContent;

        var doneCount = phaseACached + idxA;
        var pct = 15 + Math.round(((doneCount + 1) / totalCandidates) * 45);  // Phase A 占 15~60%
        if (progressEl) progressEl.style.width = pct + '%';
        if (statusEl) statusEl.textContent = 'Phase A (' + model + '): ' + (doneCount + 1) + '/' + totalCandidates + ' — LLM 生成 L1/L2/L3...' + (phaseACached > 0 ? ' (缓存: ' + phaseACached + ')' : '');
        if (detailEl) {
          var elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          var speed = idxA > 0 ? ((Date.now() - startTime) / idxA / 1000).toFixed(1) + 's/条' : '';
          detailEl.textContent = '📝 ' + candidateTitle + ' · 已缓存: ' + preparedResults.length + ' · 已用: ' + elapsed + 's' + (speed ? ' · ' + speed : '');
        }
        if (streamArea) { streamArea.textContent = ''; streamArea.style.display = 'block'; }

        function runPhaseAAttempt(attempt, reason) {
          if (_aiBatchCancelled) { onPhaseADone(); return; }
          var retryHint = '';
          if (reason && reason.length > 0) {
            retryHint = '\\n\\n【完整性修复要求】\\n上一轮未通过项：' + reason.join('、') + '。\\n请严格按 JSON 输出并修复上述问题。';
          }
          var userPrompt = '标题：' + candidateTitle + '\\n\\n' + truncated + retryHint;

          // Call Ollama native /api/chat with streaming (gemma3:27b stays loaded)
          callOllamaStream(ollamaUrl, model, systemPrompt, userPrompt, streamArea, function(llmResult) {
            if (_aiBatchCancelled) { onPhaseADone(); return; }

            // Parse JSON from LLM output
            var parsed = parseJsonFromLlmOutput(llmResult);
            var entry = buildPreparedEntry(c, rawContent, candidateSourceId, candidateTitle, parsed);
            var check = validatePreparedEntry(entry);

            if (check.pass) {
              preparedResults.push(entry);
              // Phase-65: 增量保存到 localStorage（每条 LLM 完成后立即持久化）
              _batchCacheSave(model, source, batchLimitValue, preparedResults);
              idxA++;
              setTimeout(processPhaseA, 100);
              return;
            }

            if (attempt < PHASE_A_MAX_RETRIES) {
              phaseAIntegrityRetries++;
              if (statusEl) statusEl.textContent = 'Phase A (' + model + '): ' + (doneCount + 1) + '/' + totalCandidates + ' — 完整性未通过，正在重试 ' + attempt + '/' + PHASE_A_MAX_RETRIES + '...';
              if (detailEl) detailEl.textContent = '🛠 重试 ' + attempt + '/' + PHASE_A_MAX_RETRIES + ' · ' + candidateTitle + ' · 问题: ' + check.issues.join('、');
              runPhaseAAttempt(attempt + 1, check.issues);
              return;
            }

            // 超过重试次数后，丢弃该候选，不写入缓存，确保缓存内均为通过项
            phaseAIntegrityDropped++;
            idxA++;
            if (detailEl) detailEl.textContent = '❌ 已丢弃: ' + candidateTitle + '（完整性重试失败: ' + check.issues.join('、') + '）';
            setTimeout(processPhaseA, 120);
          });
        }

        runPhaseAAttempt(1, []);
      }

      // ═══════════════════════════════════════════════════
      // Phase A 完成回调 → 启动 Phase B
      // ═══════════════════════════════════════════════════
      function onPhaseADone() {
        // Phase-65: 确保最终状态也保存到 localStorage
        _batchCacheSave(model, source, batchLimitValue, preparedResults);

        if (_aiBatchCancelled && preparedResults.length === 0) {
          finishAiBatch(totalCandidates);
          return;
        }

        var phaseATime = ((Date.now() - startTime) / 1000).toFixed(1);
        if (progressEl) progressEl.style.width = '60%';
        if (streamArea) {
          streamArea.textContent = '✅ Phase A 完成: ' + preparedResults.length + ' 条 LLM 结果已缓存 (' + phaseATime + 's)'
            + (phaseACached > 0 ? '\\n   （其中 ' + phaseACached + ' 条来自断点续传缓存）' : '')
            + (_aiBatchCancelled ? '\\n⚠ 已取消，将保存已缓存的 ' + preparedResults.length + ' 条' : '')
            + '\\n\\n🔄 切换到 Phase B: 保存记忆 + Embedding ...\\n   （Ollama 将切换到 embedding 模型，请稍候）';
        }

        if (preparedResults.length === 0) {
          finishAiBatch(totalCandidates);
          return;
        }

        // Phase-78B: Phase B 开始前，先 unload gemma3 释放 Ollama VRAM
        // 否则 qwen3-embedding:8b 无法加载，所有 embedding 会失败
        var unloadUrl = ollamaUrl.replace(/\\/v1\\/?$/, '').replace(/\\/+$/, '') + '/api/chat';
        if (streamArea) {
          streamArea.textContent += '\\n\\n⏳ 正在卸载 ' + model + ' 释放 GPU 显存...';
        }
        fetch(unloadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model,
            messages: [],
            keep_alive: 0
          })
        }).then(function() {
          if (streamArea) {
            streamArea.textContent += '\\n✅ ' + model + ' 已卸载，显存已释放';
            streamArea.textContent += '\\n🔄 等待 Ollama 加载 embedding 模型...';
          }
          // 给 Ollama 2 秒时间完成模型卸载
          setTimeout(function() { processPhaseB(); }, 2000);
        }).catch(function() {
          // 卸载失败也继续，可能 Ollama 有足够 VRAM
          if (streamArea) {
            streamArea.textContent += '\\n⚠️ 模型卸载失败，继续尝试 Phase B...';
          }
          setTimeout(function() { processPhaseB(); }, 1500);
        });
      }

      // 启动 Phase A
      processPhaseA();
    })
    .catch(function(err) {
      stopCandidateFetchProgress();
      if (statusEl) statusEl.textContent = '❌ 获取候选项失败: ' + (err.message || err);
      _aiBatchRunning = false;
      if (cancelBtn) { cancelBtn.textContent = '关闭'; cancelBtn.onclick = function() { closeAiBatch(); }; }
    });

  // ═══════════════════════════════════════════════════
  // Phase B: 全部缓存结果 → /api/batch/save → Embedding (qwen3-embedding:8b)
  //   embedding 模型全程保持加载，不会再触发 gemma3:27b
  // ═══════════════════════════════════════════════════
  var idxB = 0;
  var phaseBStart = 0;
  function processPhaseB() {
    phaseBStart = Date.now();
    processNextB();
  }

  function processNextB() {
    if (_aiBatchCancelled || idxB >= preparedResults.length) {
      finishAiBatch(preparedResults.length);
      return;
    }

    var entry = preparedResults[idxB];
    var pct = 60 + Math.round(((idxB + 1) / preparedResults.length) * 40);  // Phase B 占 60~100%
    if (progressEl) progressEl.style.width = pct + '%';
    if (statusEl) statusEl.textContent = 'Phase B (Embedding): ' + (idxB + 1) + '/' + preparedResults.length + ' — 保存记忆 + 向量化...';
    if (detailEl) {
      var elapsed = ((Date.now() - phaseBStart) / 1000).toFixed(0);
      var speed = idxB > 0 ? ((Date.now() - phaseBStart) / idxB / 1000).toFixed(1) + 's/条' : '';
      detailEl.textContent = '💾 ' + (entry._title || (entry.sourceRef && entry.sourceRef.sourceId) || 'unknown') + ' · 已保存: ' + totalSaved + '/' + preparedResults.length + ' · Phase B 用时: ' + elapsed + 's' + (speed ? ' · ' + speed : '');
    }

    var saveBody = {
      memoryType: entry.memoryType,
      content: entry.content,
      tags: entry.tags,
      relatedTaskId: entry.relatedTaskId,
      sourceRef: entry.sourceRef,
      provenance: entry.provenance,
      importance: entry.importance,
      contentL1: entry.contentL1,
      contentL2: entry.contentL2,
      contentL3: entry.contentL3,
      anchorName: entry.anchorName,
      anchorType: entry.anchorType,
      anchorOverview: entry.anchorOverview,
      profile: 'cursor',
      contentSessionId: cursorContentSessionId,
      memorySessionId: cursorMemorySessionId,
      hookPhase: 'manual',
      hookName: 'ai_batch_generate',
    };

    fetch('/api/batch/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(saveBody)
    }).then(function(r) { return r.json(); }).then(function(result) {
      totalSaved++;
      idxB++;
      setTimeout(processNextB, 50);
    }).catch(function(err) {
      totalFailed++;
      idxB++;
      setTimeout(processNextB, 50);
    });
  }

  function finishAiBatch(total) {
    _aiBatchRunning = false;
    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    var progressEl = document.getElementById('aiBatchProgress');
    if (progressEl) progressEl.style.width = '100%';

    var reason = _aiBatchCancelled ? '已取消' : '完成';
    var titleEl = document.getElementById('aiBatchTitle');
    if (titleEl) titleEl.textContent = _aiBatchCancelled ? '⏹ 已取消' : '✅ 全部完成！';
    if (statusEl) statusEl.textContent = reason + ' — Phase A 缓存: ' + preparedResults.length + ' 条'
      + (phaseACached > 0 ? ' (续传: ' + phaseACached + ')' : '')
      + ' · 重试: ' + phaseAIntegrityRetries + ' 次'
      + (phaseAIntegrityDropped > 0 ? ' · 丢弃: ' + phaseAIntegrityDropped + ' 条' : '')
      + ' · Phase B 保存: ' + (totalSaved + totalFailed) + ' 条';

    var summaryEl = document.getElementById('aiBatchSummary');
    if (summaryEl) {
      summaryEl.style.display = 'block';
      summaryEl.innerHTML = '<div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">'
        + '<span style="color:#22c55e;">✅ 保存: ' + totalSaved + '</span>'
        + (totalFailed > 0 ? '<span style="color:#f87171;">❌ 失败: ' + totalFailed + '</span>' : '')
        + '<span style="color:#6b7280;">⏭ 跳过: ' + (totalSkipped + phaseASkipped) + '</span>'
        + (phaseAIntegrityRetries > 0 ? '<span style="color:#fbbf24;">🔁 重试: ' + phaseAIntegrityRetries + '</span>' : '')
        + (phaseAIntegrityDropped > 0 ? '<span style="color:#f87171;">🗑 丢弃: ' + phaseAIntegrityDropped + '</span>' : '')
        + '<span style="color:#60a5fa;">📦 缓存: ' + preparedResults.length + (phaseACached > 0 ? ' (续传' + phaseACached + ')' : '') + '</span>'
        + '<span style="color:#6b7280;">⏱ 总用时: ' + elapsed + 's</span>'
        + '</div>'
        + '<div style="margin-top:8px;font-size:12px;color:#9ca3af;">模型切换: ' + model + ' → embedding · 仅 1 次 VRAM 切换</div>';
    }

    // Phase-65: 全部完成 → 清除 localStorage 缓存；取消 → 保留缓存以供续传
    if (!_aiBatchCancelled && totalFailed === 0) {
      _batchCacheClear();
    }
    // 定向修复上下文只使用一次，完成后清空
    _aiBatchRepairContext = null;
    // 如果有失败的，也保留缓存（用户可能想重试）

    // Phase-69: 自动触发完整性检测（仅在有成功保存时）
    if (totalSaved > 0 && !_aiBatchCancelled) {
      runBatchIntegrityCheck(preparedResults, summaryEl);
    }

    if (cancelBtn) {
      cancelBtn.textContent = '关闭';
      cancelBtn.disabled = false;
      cancelBtn.onclick = function() {
        closeAiBatch();
        memoryLoaded = false;
        loadMemoryPage();
      };
    }
  }
}

// ========== Phase-69: 批量导入完整性检测 ==========

/**
 * Phase-69: 批量导入完成后自动执行完整性检测
 * 调用 /api/batch/verify 验证每条记忆的保存状态
 */
function runBatchIntegrityCheck(preparedResults, summaryEl) {
  // 收集所有 sourceRef.sourceId
  var sourceRefs = [];
  for (var i = 0; i < preparedResults.length; i++) {
    var sid = preparedResults[i].sourceRef && preparedResults[i].sourceRef.sourceId;
    if (sid) {
      sourceRefs.push(sid);
    }
  }

  if (sourceRefs.length === 0) return;

  // 在 summaryEl 下方添加检测状态
  var verifyEl = document.getElementById('aiBatchVerifyArea');
  if (!verifyEl) return;
  verifyEl.style.display = 'block';
  verifyEl.innerHTML = '<div style="text-align:center;padding:12px;"><div class="spinner" style="display:inline-block;width:18px;height:18px;border-width:2px;vertical-align:middle;margin-right:8px;"></div><span style="color:#6b7280;font-size:12px;">正在检测导入完整性...</span></div>';

  var statusEl = document.getElementById('aiBatchStatus');
  if (statusEl) statusEl.textContent = '🔍 正在执行完整性检测 (' + sourceRefs.length + ' 条记忆)...';

  fetch('/api/batch/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceRefs: sourceRefs })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data || !data.summary) {
      verifyEl.innerHTML = '<div style="color:#f87171;font-size:12px;text-align:center;padding:8px;">❌ 完整性检测失败：无效响应</div>';
      return;
    }

    var s = data.summary;
    var results = data.results || [];

    // 更新状态
    if (statusEl) {
      if (s.errors > 0) {
        statusEl.textContent = '⚠️ 完整性检测发现 ' + s.errors + ' 个错误';
      } else if (s.warnings > 0) {
        statusEl.textContent = '✅ 导入完成，检测发现 ' + s.warnings + ' 个警告';
      } else {
        statusEl.textContent = '✅ 导入完成，完整性检测全部通过！';
      }
    }

    // 构建检测报告
    var html = '<div class="batch-verify-report">';

    // 摘要栏
    var passColor = s.passed === s.total ? '#22c55e' : '#6b7280';
    html += '<div class="batch-verify-summary">';
    html += '<span style="color:' + passColor + ';">✅ 通过: ' + s.passed + '</span>';
    if (s.warnings > 0) html += '<span style="color:#f59e0b;">⚠️ 警告: ' + s.warnings + '</span>';
    if (s.errors > 0) html += '<span style="color:#ef4444;">❌ 错误: ' + s.errors + '</span>';
    html += '<span style="color:#6b7280;">📊 总计: ' + s.total + '</span>';
    html += '</div>';

    // 如果有问题，展示详细列表（仅展示非 pass 的项）
    var problemResults = [];
    for (var pi = 0; pi < results.length; pi++) {
      if (results[pi].status !== 'pass') {
        problemResults.push(results[pi]);
      }
    }

    if (problemResults.length > 0) {
      html += '<div class="batch-verify-details">';
      html += '<div class="batch-verify-toggle" onclick="toggleBatchVerifyDetails()">';
      html += '📋 查看详情 (' + problemResults.length + ' 条有问题) <span id="batchVerifyArrow">▶</span>';
      html += '</div>';
      html += '<div id="batchVerifyDetailList" style="display:none;">';

      for (var qi = 0; qi < problemResults.length; qi++) {
        var r = problemResults[qi];
        var statusIcon = r.status === 'error' ? '❌' : '⚠️';
        var statusClass = r.status === 'error' ? 'verify-error' : 'verify-warning';

        html += '<div class="batch-verify-item ' + statusClass + '">';
        html += '<div class="batch-verify-item-header">';
        html += '<span class="batch-verify-icon">' + statusIcon + '</span>';
        html += '<span class="batch-verify-source">' + (r.sourceRef || r.memoryId || 'unknown') + '</span>';
        if (r.memoryType) {
          html += '<span class="batch-verify-type">' + r.memoryType + '</span>';
        }
        html += '</div>';

        // Issues (errors)
        if (r.issues && r.issues.length > 0) {
          for (var ii = 0; ii < r.issues.length; ii++) {
            html += '<div class="batch-verify-issue error">❌ ' + r.issues[ii] + '</div>';
          }
        }
        // Warnings
        if (r.warnings && r.warnings.length > 0) {
          for (var wi = 0; wi < r.warnings.length; wi++) {
            html += '<div class="batch-verify-issue warning">⚠️ ' + r.warnings[wi] + '</div>';
          }
        }

        // 检测指标摘要行
        if (r.contentLength !== undefined) {
          html += '<div class="batch-verify-metrics">';
          html += '<span title="内容长度">📝 ' + r.contentLength + ' 字符</span>';
          html += '<span title="Embedding">' + (r.hasEmbedding ? '🧬 有向量' : '⬜ 无向量') + '</span>';
          html += '<span title="Anchor 关联">' + (r.hasAnchor ? '⚓ 有触点' : '⬜ 无触点') + '</span>';
          html += '<span title="重要性">⭐ ' + ((r.importance || 0) * 100).toFixed(0) + '%</span>';
          html += '</div>';
        }

        html += '</div>';
      }

      html += '</div>';
      html += '</div>';
    } else if (s.total > 0) {
      html += '<div style="text-align:center;padding:8px;color:#22c55e;font-size:12px;">🎉 所有 ' + s.total + ' 条记忆完整性检测全部通过！</div>';
    }

    html += '</div>';
    verifyEl.innerHTML = html;

  }).catch(function(err) {
    verifyEl.innerHTML = '<div style="color:#f87171;font-size:12px;text-align:center;padding:8px;">❌ 完整性检测请求失败: ' + (err.message || err) + '</div>';
  });
}

/** Phase-69: 切换检测详情的折叠/展开 */
function toggleBatchVerifyDetails() {
  var list = document.getElementById('batchVerifyDetailList');
  var arrow = document.getElementById('batchVerifyArrow');
  if (!list) return;
  if (list.style.display === 'none') {
    list.style.display = 'block';
    if (arrow) arrow.textContent = '▼';
  } else {
    list.style.display = 'none';
    if (arrow) arrow.textContent = '▶';
  }
}

// ========== Phase-78: 独立完整性检测功能 ==========

/**
 * Phase-78: 检测单条记忆的完整性
 * 在卡片内联显示检测结果
 */
function checkSingleMemoryIntegrity(memoryId) {
  var resultEl = document.getElementById('memVerify_' + memoryId);
  if (!resultEl) return;

  // 显示检测中状态
  resultEl.innerHTML = '<div class="mem-verify-inline warning" style="border-color:rgba(107,114,128,0.3);color:#9ca3af;"><span class="spinner" style="display:inline-block;width:12px;height:12px;border-width:1.5px;vertical-align:middle;margin-right:6px;"></span>检测中...</div>';

  fetch('/api/batch/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memoryIds: [memoryId] })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data || !data.results || data.results.length === 0) {
      resultEl.innerHTML = '<div class="mem-verify-inline error">❌ 检测失败：无效响应</div>';
      return;
    }

    var r = data.results[0];
    var statusClass = r.status || 'pass';
    var statusIcon = r.status === 'error' ? '❌' : (r.status === 'warning' ? '⚠️' : '✅');
    var statusText = r.status === 'error' ? '有错误' : (r.status === 'warning' ? '有警告' : '完整性通过');

    var html = '<div class="mem-verify-inline ' + statusClass + '">';
    html += '<strong>' + statusIcon + ' ' + statusText + '</strong>';

    // 显示指标
    if (r.contentLength !== undefined) {
      html += '<div class="verify-metrics">';
      html += '<span title="内容长度">📝 ' + r.contentLength + ' 字</span>';
      html += '<span title="Embedding">' + (r.hasEmbedding ? '🧬 有向量' : '⬜ 无向量') + '</span>';
      html += '<span title="Anchor 关联">' + (r.hasAnchor ? '⚓ 有触点' : '⬜ 无触点') + '</span>';
      html += '<span title="重要性">⭐ ' + ((r.importance || 0) * 100).toFixed(0) + '%</span>';
      html += '</div>';
    }

    // 显示问题
    if (r.issues && r.issues.length > 0) {
      for (var i = 0; i < r.issues.length; i++) {
        html += '<div class="verify-issue">❌ ' + r.issues[i] + '</div>';
      }
    }
    if (r.warnings && r.warnings.length > 0) {
      for (var i = 0; i < r.warnings.length; i++) {
        html += '<div class="verify-issue">⚠️ ' + r.warnings[i] + '</div>';
      }
    }

    html += '<div style="text-align:right;margin-top:4px;"><button onclick="this.parentElement.parentElement.innerHTML=\\x27\\x27" style="background:transparent;border:none;color:#4b5563;font-size:10px;cursor:pointer;">收起 ✕</button></div>';
    html += '</div>';
    resultEl.innerHTML = html;

  }).catch(function(err) {
    resultEl.innerHTML = '<div class="mem-verify-inline error">❌ 请求失败: ' + (err.message || err) + '</div>';
  });
}

/**
 * Phase-78: 全局检测所有记忆的完整性
 * 在记忆列表上方显示汇总报告
 */
function checkAllMemoriesIntegrity() {
  var btn = document.querySelector('.memory-verify-btn');
  var resultArea = document.getElementById('memoryVerifyResultArea');
  if (!resultArea) return;

  // 禁用按钮 + 显示检测中
  if (btn) { btn.classList.add('verifying'); btn.textContent = '🔍 检测中...'; btn.disabled = true; }
  resultArea.style.display = 'block';
  resultArea.innerHTML = '<div style="text-align:center;padding:16px;"><div class="spinner" style="display:inline-block;width:20px;height:20px;border-width:2px;vertical-align:middle;margin-right:8px;"></div><span style="color:#9ca3af;font-size:13px;">正在检测所有记忆的完整性...</span></div>';

  fetch('/api/batch/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkAll: true })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (btn) { btn.classList.remove('verifying'); btn.textContent = '🔍 完整性检测'; btn.disabled = false; }

    if (!data || !data.summary) {
      resultArea.innerHTML = '<div style="color:#f87171;font-size:12px;text-align:center;padding:12px;">❌ 完整性检测失败：无效响应</div>';
      return;
    }

    var s = data.summary;
    var diag = data.diagnostics || {};
    var results = data.results || [];
    var wb = s.warningBreakdown || {};
    var eb = s.errorBreakdown || {};

    // 构建报告
    var html = '<div class="batch-verify-report">';

    // 摘要栏
    var passColor = s.passed === s.total ? '#22c55e' : '#6b7280';
    html += '<div class="batch-verify-summary">';
    html += '<span style="color:' + passColor + ';">✅ 通过: ' + s.passed + '</span>';
    if (s.warnings > 0) html += '<span style="color:#f59e0b;">⚠️ 警告: ' + s.warnings + '</span>';
    if (s.errors > 0) html += '<span style="color:#ef4444;">❌ 错误: ' + s.errors + '</span>';
    html += '<span style="color:#6b7280;">📊 总计: ' + s.total + '</span>';
    // 拆分修复入口：Anchor 缺失单独回填，其它问题引导重新批量生成记忆
    var anchorFixableCount = wb.anchor || 0;
    var regenerateFixableCount = (wb.embedding || 0) + (eb.memoryType || 0) + (wb.importance || 0) + (wb.contentShort || 0) + (eb.content || 0);
    if (anchorFixableCount > 0) {
      html += '<button onclick="batchRepairAnchors()" style="background:#7c2d12;color:#fed7aa;border:1px solid #c2410c;border-radius:6px;padding:3px 12px;font-size:11px;font-weight:600;cursor:pointer;margin-left:8px;transition:all 0.2s;" onmouseover="this.style.background=\\x279a3412\\x27" onmouseout="this.style.background=\\x277c2d12\\x27">⚓ Anchor触点修复 (' + anchorFixableCount + ')</button>';
    }
    if (regenerateFixableCount > 0) {
      html += '<button onclick="repairByBatchRegenerate(\\x27targeted_errors\\x27)" style="background:#312e81;color:#a5b4fc;border:1px solid #6366f1;border-radius:6px;padding:3px 12px;font-size:11px;font-weight:600;cursor:pointer;margin-left:8px;transition:all 0.2s;" onmouseover="this.style.background=\\x273731a3\\x27" onmouseout="this.style.background=\\x27312e81\\x27">♻ 批量重新生成修复 (' + regenerateFixableCount + ')</button>';
    }
    html += '<button onclick="document.getElementById(\\x27memoryVerifyResultArea\\x27).style.display=\\x27none\\x27" style="background:transparent;border:1px solid #374151;border-radius:4px;padding:2px 8px;color:#6b7280;font-size:11px;cursor:pointer;margin-left:auto;">收起 ✕</button>';
    html += '</div>';

    // Phase-78C: 分类警告明细栏
    if (s.warnings > 0 || s.errors > 0) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:12px;padding:6px 12px;background:#1a1a2e;border-radius:6px;margin-top:6px;font-size:11px;">';
      if (wb.embedding > 0) html += '<span style="color:#f59e0b;">🧬 缺 Embedding: <strong>' + wb.embedding + '</strong> <span style="color:#6b7280;">(可修复)</span></span>';
      if (eb.memoryType > 0) html += '<span style="color:#ef4444;">🏷️ 非法 Type: <strong>' + eb.memoryType + '</strong> <span style="color:#6b7280;">(可修复)</span></span>';
      if (wb.anchor > 0) html += '<span style="color:#fbbf24;">⚓ 缺 Anchor: <strong>' + wb.anchor + '</strong> <span style="color:#6b7280;">(可回填)</span></span>';
      if (wb.importance > 0) html += '<span style="color:#9ca3af;">⭐ importance 异常: <strong>' + wb.importance + '</strong></span>';
      if (wb.contentShort > 0) html += '<span style="color:#9ca3af;">📝 内容过短: <strong>' + wb.contentShort + '</strong></span>';
      if (eb.content > 0) html += '<span style="color:#ef4444;">📝 内容为空: <strong>' + eb.content + '</strong></span>';
      html += '</div>';
    }

    // Phase-78C: 诊断信息栏
    html += '<div style="display:flex;flex-wrap:wrap;gap:10px;padding:4px 12px;font-size:10px;color:#6b7280;margin-top:4px;">';
    html += '<span>🔢 HNSW向量: ' + (s.vectorCount >= 0 ? s.vectorCount : 'N/A') + '</span>';
    if (s.indexedMemoryCount !== undefined) {
      html += '<span>🧬 记忆已索引: ' + s.indexedMemoryCount + '/' + s.total + '</span>';
    }
    html += '<span>检测模式: ' + (s.embeddingCheckMode === 'search' ? '✅ 向量搜索' : '⚠ 不可用') + '</span>';
    if (diag.vectorSearchEnabled !== undefined) {
      html += '<span>向量引擎: ' + (diag.vectorSearchEnabled ? '✅' : '❌') + '</span>';
    }
    if (diag.synapseAvailable !== undefined) {
      html += '<span>Synapse: ' + (diag.synapseAvailable ? '✅' : '❌ (Ollama?)') + '</span>';
    }
    if (diag.probeHits !== undefined) {
      html += '<span>探针命中: ' + diag.probeHits + '</span>';
    }
    html += '</div>';

    // 筛选有问题的条目
    var problemResults = [];
    for (var pi = 0; pi < results.length; pi++) {
      if (results[pi].status !== 'pass') {
        problemResults.push(results[pi]);
      }
    }
    var verifySourceRefSet = {};
    var verifyMemoryIdSet = {};
    for (var vsi = 0; vsi < problemResults.length; vsi++) {
      var vr = problemResults[vsi];
      if (vr.sourceRef) verifySourceRefSet[String(vr.sourceRef)] = true;
      if (vr.memoryId) verifyMemoryIdSet[String(vr.memoryId)] = true;
    }
    _aiBatchRepairContext = {
      sourceRefs: Object.keys(verifySourceRefSet),
      memoryIds: Object.keys(verifyMemoryIdSet),
    };

    if (problemResults.length > 0) {
      html += '<div class="batch-verify-details">';
      html += '<div class="batch-verify-toggle" onclick="toggleGlobalVerifyDetails()">';
      html += '📋 查看详情 (' + problemResults.length + ' 条有问题) <span id="globalVerifyArrow">▶</span>';
      html += '</div>';
      html += '<div id="globalVerifyDetailList" style="display:none;max-height:400px;overflow-y:auto;">';

      for (var qi = 0; qi < problemResults.length; qi++) {
        var r = problemResults[qi];
        var statusIcon = r.status === 'error' ? '❌' : '⚠️';
        var statusClass = r.status === 'error' ? 'verify-error' : 'verify-warning';

        html += '<div class="batch-verify-item ' + statusClass + '">';
        html += '<div class="batch-verify-item-header">';
        html += '<span class="batch-verify-icon">' + statusIcon + '</span>';
        html += '<span class="batch-verify-source">' + (r.memoryId || r.sourceRef || 'unknown').substring(0, 12) + '...</span>';
        if (r.memoryType) {
          html += '<span class="batch-verify-type">' + r.memoryType + '</span>';
        }
        // 跳转到对应卡片
        if (r.memoryId) {
          html += '<button onclick="scrollToMemCard(\\x27memCard_' + r.memoryId + '\\x27)" style="background:transparent;border:none;color:#6366f1;font-size:10px;cursor:pointer;margin-left:auto;" title="跳转到此记忆">📍 定位</button>';
        }
        html += '</div>';

        // Issues
        if (r.issues && r.issues.length > 0) {
          for (var ii = 0; ii < r.issues.length; ii++) {
            html += '<div class="batch-verify-issue error">❌ ' + r.issues[ii] + '</div>';
          }
        }
        // Warnings
        if (r.warnings && r.warnings.length > 0) {
          for (var wi = 0; wi < r.warnings.length; wi++) {
            html += '<div class="batch-verify-issue warning">⚠️ ' + r.warnings[wi] + '</div>';
          }
        }

        // 指标摘要行
        if (r.contentLength !== undefined) {
          html += '<div class="batch-verify-metrics">';
          html += '<span title="内容长度">📝 ' + r.contentLength + ' 字符</span>';
          html += '<span title="Embedding">' + (r.hasEmbedding ? '🧬 有向量' : '⬜ 无向量') + '</span>';
          html += '<span title="Anchor 关联">' + (r.hasAnchor ? '⚓ 有触点' : '⬜ 无触点') + '</span>';
          html += '<span title="重要性">⭐ ' + ((r.importance || 0) * 100).toFixed(0) + '%</span>';
          html += '</div>';
        }

        html += '</div>';
      }

      html += '</div>';
      html += '</div>';
    } else if (s.total > 0) {
      html += '<div style="text-align:center;padding:12px;color:#22c55e;font-size:13px;">🎉 所有 ' + s.total + ' 条记忆完整性检测全部通过！';
      html += '<button onclick="document.getElementById(\\x27memoryVerifyResultArea\\x27).style.display=\\x27none\\x27" style="background:transparent;border:none;color:#4b5563;font-size:10px;cursor:pointer;margin-left:12px;">收起 ✕</button>';
      html += '</div>';
    }

    html += '</div>';
    resultArea.innerHTML = html;

  }).catch(function(err) {
    if (btn) { btn.classList.remove('verifying'); btn.textContent = '🔍 完整性检测'; btn.disabled = false; }
    resultArea.innerHTML = '<div style="color:#f87171;font-size:12px;text-align:center;padding:12px;">❌ 完整性检测请求失败: ' + (err.message || err) + '</div>';
  });
}

/** Phase-78: 切换全局检测详情的折叠/展开 */
function toggleGlobalVerifyDetails() {
  var list = document.getElementById('globalVerifyDetailList');
  var arrow = document.getElementById('globalVerifyArrow');
  if (!list) return;
  if (list.style.display === 'none') {
    list.style.display = 'block';
    if (arrow) arrow.textContent = '▼';
  } else {
    list.style.display = 'none';
    if (arrow) arrow.textContent = '▶';
  }
}

/** Phase-78: 滚动到指定记忆卡片并高亮 */
function scrollToMemCard(cardId) {
  var card = document.getElementById(cardId);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.style.transition = 'box-shadow 0.3s';
  card.style.boxShadow = '0 0 0 2px #6366f1';
  setTimeout(function() { card.style.boxShadow = ''; }, 2000);
}

/**
 * 将非 Anchor 问题引导到批量生成页面，通过重新生成记忆进行修复
 */
function repairByBatchRegenerate(mode) {
  var resultArea = document.getElementById('memoryVerifyResultArea');
  if (!resultArea) return;

  var progressEl = document.getElementById('repairProgressArea');
  if (!progressEl) {
    progressEl = document.createElement('div');
    progressEl.id = 'repairProgressArea';
    progressEl.style.cssText = 'margin-top:12px;padding:12px;background:#1e1b4b;border:1px solid #4338ca;border-radius:8px;';
    var reportEl = resultArea.querySelector('.batch-verify-report');
    if (reportEl) reportEl.appendChild(progressEl);
  }
  if (mode === 'targeted_errors') {
    var ctx = _aiBatchRepairContext || { sourceRefs: [], memoryIds: [] };
    if ((!ctx.sourceRefs || ctx.sourceRefs.length === 0) && (!ctx.memoryIds || ctx.memoryIds.length === 0)) {
      if (progressEl) {
        progressEl.innerHTML = '<div style="color:#fbbf24;font-size:12px;line-height:1.8;">'
          + '<div style="font-weight:600;font-size:13px;margin-bottom:6px;">⚠ 无可定向修复数据</div>'
          + '<div>请先执行一次<strong>完整性检测</strong>，再点击“批量重新生成修复”。</div>'
          + '</div>';
      }
      return;
    }
    if (progressEl) {
      progressEl.innerHTML = '<div style="text-align:center;"><div class="spinner" style="display:inline-block;width:16px;height:16px;border-width:2px;vertical-align:middle;margin-right:8px;"></div><span style="color:#a5b4fc;font-size:12px;">正在清除问题记忆并准备定向重生成...</span></div>';
    }
    fetch('/api/memories/repair-regenerate-prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceRefs: ctx.sourceRefs || [],
        memoryIds: ctx.memoryIds || []
      })
    }).then(function(r) { return r.json(); }).then(function(data) {
      var targetSourceRefs = (data && data.targetSourceRefs) ? data.targetSourceRefs : [];
      if (!targetSourceRefs || targetSourceRefs.length === 0) {
        if (progressEl) progressEl.innerHTML = '<div style="color:#f87171;font-size:12px;">❌ 定向修复准备失败：未找到可重生成的来源。</div>';
        return;
      }
      _aiBatchRepairContext = { sourceRefs: targetSourceRefs, memoryIds: [] };
      if (progressEl) {
        progressEl.innerHTML = '<div style="color:#c4b5fd;font-size:12px;line-height:1.8;">'
          + '<div style="font-weight:600;font-size:13px;margin-bottom:6px;">♻ 定向重生成已准备</div>'
          + '<div>已清除问题记忆 <strong>' + (data.deleted || 0) + '</strong> 条，将仅针对 <strong>' + targetSourceRefs.length + '</strong> 个来源重新生成。</div>'
          + '<div style="margin-top:6px;">已为你打开 <strong>AI 批量生成记忆</strong> 弹层。</div>'
          + '</div>';
      }
      startAiBatchGenerate();
    }).catch(function(err) {
      if (progressEl) progressEl.innerHTML = '<div style="color:#f87171;font-size:12px;">❌ 定向修复准备失败: ' + (err.message || err) + '</div>';
    });
    return;
  }

  var titleText = '♻ 其它错误修复入口';
  var descText = '这些错误通常来自历史批量导入质量问题（如非法 type、缺 embedding、内容质量异常）。';
  if (mode === 'anchor_external') {
    titleText = '♻ Anchor 修复入口（外接模型模式）';
    descText = '当前配置为外接模型，Anchor 触点修复将改用批量重新生成流程，避免依赖本地回填接口能力。';
  }

  if (progressEl) {
    progressEl.innerHTML = '<div style="color:#c4b5fd;font-size:12px;line-height:1.8;">'
      + '<div style="font-weight:600;font-size:13px;margin-bottom:6px;">' + titleText + '</div>'
      + '<div>' + descText + '</div>'
      + '<div style="margin-top:6px;">已为你打开 <strong>AI 批量生成记忆</strong> 弹层，请重新执行一轮生成后再点击 <strong>完整性检测</strong> 验证结果。</div>'
      + '</div>';
  }
  startAiBatchGenerate();
}

/**
 * Phase-111: 批量回填缺失 Anchor
 * 调用 /api/batch/repair-anchor，对无 Anchor 记忆进行二次抽取并回填 anchored_by 关系
 */
function batchRepairAnchors() {
  // 外接模型模式：Anchor 修复统一走“批量生成记忆”流程
  if (!_aiBatchConfig || (!_aiBatchConfig.llmEngine && _aiBatchConfig.isExternalModel === undefined)) {
    fetch('/api/batch/config').then(function(r) { return r.json(); }).then(function(cfg) {
      _aiBatchConfig = cfg || _aiBatchConfig;
      batchRepairAnchors();
    }).catch(function() {
      // 配置获取失败时，回退本地 Anchor 修复
      continueBatchRepairAnchors();
    });
    return;
  }
  if (_aiBatchConfig.isExternalModel === true || _aiBatchConfig.llmEngine === 'models_online') {
    repairByBatchRegenerate('anchor_external');
    return;
  }
  continueBatchRepairAnchors();
}

function continueBatchRepairAnchors() {
  var resultArea = document.getElementById('memoryVerifyResultArea');
  if (!resultArea) return;
  var progressEl = document.getElementById('repairProgressArea');
  if (!progressEl) {
    progressEl = document.createElement('div');
    progressEl.id = 'repairProgressArea';
    progressEl.style.cssText = 'margin-top:12px;padding:12px;background:#1e1b4b;border:1px solid #4338ca;border-radius:8px;';
    var reportEl = resultArea.querySelector('.batch-verify-report');
    if (reportEl) {
      reportEl.appendChild(progressEl);
    } else {
      resultArea.appendChild(progressEl);
    }
  }

  progressEl.innerHTML = '<div style="text-align:center;"><div class="spinner" style="display:inline-block;width:16px;height:16px;border-width:2px;vertical-align:middle;margin-right:8px;"></div><span style="color:#fdba74;font-size:12px;">正在回填缺失 Anchor 触点...</span></div>';

  fetch('/api/batch/repair-anchor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }).then(function(r) {
    return r.json().then(function(data) {
      if (!r.ok) {
        var errMsg = data && data.error ? data.error : ('HTTP ' + r.status);
        throw { message: errMsg, diagnostics: data && data.diagnostics ? data.diagnostics : null };
      }
      return data;
    });
  }).then(function(data) {
    if (!data || !data.summary) {
      progressEl.innerHTML = '<div style="color:#f87171;font-size:12px;line-height:1.8;">'
        + '<div>❌ Anchor 回填失败：响应中缺少 summary 字段</div>'
        + '<div style="color:#6b7280;margin-top:4px;">请检查服务端日志或重启可视化服务。</div>'
        + '</div>';
      return;
    }

    var sm = data.summary;
    var dg = data.diagnostics || {};
    var html = '<div style="color:#ffedd5;font-size:12px;line-height:1.8;">';
    html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">⚓ Anchor 回填完成</div>';
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;">';
    html += '<span>📊 处理总数: <strong>' + sm.totalProcessed + '</strong></span>';
    html += '<span style="color:#fde68a;">⚠ 缺 Anchor: <strong>' + sm.missingAnchor + '</strong></span>';
    html += '<span style="color:#86efac;">✅ 已回填: <strong>' + sm.repaired + '</strong></span>';
    if (sm.failed > 0) html += '<span style="color:#fca5a5;">❌ 失败: <strong>' + sm.failed + '</strong></span>';
    if (sm.skippedWithAnchor > 0) html += '<span style="color:#9ca3af;">⏭ 已有 Anchor: <strong>' + sm.skippedWithAnchor + '</strong></span>';
    html += '</div>';
    html += '<div style="margin-top:4px;font-size:10px;color:#6b7280;">';
    html += 'anchorUpsert: ' + (dg.hasAnchorUpsert ? '✅' : '❌') + ' | ';
    html += 'anchorExtract: ' + (dg.hasAnchorExtract ? '✅' : '❌') + ' | ';
    html += 'flowAppend: ' + (dg.hasFlowAppend ? '✅' : '❌');
    html += '</div>';
    html += '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #4338ca;">';
    html += '<button onclick="checkAllMemoriesIntegrity()" style="background:#312e81;color:#a5b4fc;border:1px solid #6366f1;border-radius:6px;padding:5px 14px;font-size:11px;font-weight:600;cursor:pointer;">🔍 重新检测</button>';
    html += '<span style="color:#6b7280;font-size:10px;margin-left:12px;">回填后建议立即重新检测</span>';
    html += '</div>';
    html += '</div>';
    progressEl.innerHTML = html;
  }).catch(function(err) {
    var diag = err && err.diagnostics ? err.diagnostics : null;
    var diagLine = '';
    if (diag) {
      diagLine = '<div style="margin-top:6px;font-size:10px;color:#9ca3af;">'
        + 'anchorUpsert: ' + (diag.hasAnchorUpsert ? '✅' : '❌') + ' | '
        + 'anchorExtract: ' + (diag.hasAnchorExtract ? '✅' : '❌') + ' | '
        + 'flowAppend: ' + (diag.hasFlowAppend ? '✅' : '❌') + ' | '
        + 'outgoingByType: ' + (diag.hasOutgoingByType ? '✅' : '❌') + ' | '
        + 'putRelation: ' + (diag.hasPutRelation ? '✅' : '❌')
        + '</div>';
    }
    progressEl.innerHTML = '<div style="color:#f87171;font-size:12px;line-height:1.8;">'
      + '<div>❌ Anchor 回填请求失败: ' + (err.message || err) + '</div>'
      + diagLine
      + '</div>';
  });
}

/** 浏览器端调用 Ollama 原生 /api/chat 流式 API */
function callOllamaStream(baseUrl, model, systemPrompt, userContent, streamEl, callback) {
  var nativeUrl = baseUrl.replace(/\\/v1\\/?$/, '').replace(/\\/+$/, '') + '/api/chat';

  fetch(nativeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      stream: true,
      think: false,
      keep_alive: '5m',  // Phase-78B: 从 30m 减至 5m，减少 VRAM 占用时间
      options: { temperature: 0.3, num_predict: 1200 }
    })
  }).then(function(response) {
    if (!response.ok || !response.body) {
      if (streamEl) streamEl.textContent = '❌ Ollama 返回 ' + response.status;
      callback('');
      return;
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var result = '';
    var buffer = '';

    function readChunk() {
      reader.read().then(function(chunk) {
        if (chunk.done) {
          // process remaining buffer
          if (buffer.trim()) {
            try {
              var c = JSON.parse(buffer);
              if (c.message && c.message.content) result += c.message.content;
            } catch(e) {}
          }
          callback(result);
          return;
        }

        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\\n');
        buffer = lines.pop() || '';

        for (var i = 0; i < lines.length; i++) {
          if (!lines[i].trim()) continue;
          try {
            var parsed = JSON.parse(lines[i]);
            if (parsed.message && parsed.message.content) {
              result += parsed.message.content;
              if (streamEl) {
                streamEl.textContent = result;
                streamEl.scrollTop = streamEl.scrollHeight;
              }
            }
          } catch(e) {}
        }

        readChunk();
      }).catch(function(err) {
        if (streamEl) streamEl.textContent += '\\n❌ 流读取错误: ' + (err.message || err);
        callback(result);
      });
    }

    readChunk();
  }).catch(function(err) {
    if (streamEl) streamEl.textContent = '❌ 连接 Ollama 失败: ' + (err.message || err) + '\\n请确认 Ollama 正在运行：' + baseUrl;
    callback('');
  });
}

/** 从 LLM 输出中解析 JSON */
function parseJsonFromLlmOutput(raw) {
  if (!raw) return null;
  var cleaned = raw;
  // 尝试从 json code block 中提取
  var tick3 = String.fromCharCode(96,96,96);
  var jsonMatch = cleaned.match(new RegExp(tick3 + '(?:json)?\\\\s*\\\\n?([\\\\s\\\\S]*?)\\\\n?' + tick3));
  if (jsonMatch) cleaned = jsonMatch[1].trim();
  // 尝试从 { 开始到 } 结束
  if (!jsonMatch) {
    var firstBrace = cleaned.indexOf('{');
    var lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }
  try {
    return JSON.parse(cleaned);
  } catch(e) {
    return null;
  }
}


`;
}
