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
  // Phase-160: 添加 cache: 'no-store' 确保绕过浏览器缓存
  fetch('/api/docs', { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(data) {
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
  fetch('/api/docs/all', { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(data) {
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

  // Phase-160: 添加 cache: 'no-store' 确保绕过浏览器缓存
  fetch('/api/docs', { cache: 'no-store' }).then(function(r) {
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

/** Phase-159: 后台静默刷新文档列表（stale-while-revalidate）
 *  Phase-160: 检测数据变化（数量或最新更新时间）并自动重新渲染列表
 */
function _silentRefreshDocsList() {
  var prevCount = docsData.length;
  var prevNewest = 0;
  for (var pi = 0; pi < docsData.length; pi++) {
    if ((docsData[pi].updatedAt || 0) > prevNewest) prevNewest = docsData[pi].updatedAt || 0;
  }
  fetch('/api/docs', { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(data) {
    var allDocs = (data && data.docs) ? data.docs : [];
    docsData = allDocs;
    docsLoaded = true;
    docsDataIsPartial = false;
    docsCacheUpdatedAt = Date.now();
    // Phase-160: 检测是否有变化（文档数量或最新更新时间不同）
    var newNewest = 0;
    for (var ni = 0; ni < allDocs.length; ni++) {
      if ((allDocs[ni].updatedAt || 0) > newNewest) newNewest = allDocs[ni].updatedAt || 0;
    }
    if (allDocs.length !== prevCount || newNewest !== prevNewest) {
      var searchInput = document.getElementById('docsSearch');
      var searching = !!(searchInput && (searchInput.value || '').trim());
      if (!searching) {
        renderDocsList(docsData);
      } else {
        filterDocs();
      }
    }
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
  // Phase-160: 先建立所有文档的 key 集合，用于校验 parentDoc 是否有效
  var allDocKeys = {};
  for (var i = 0; i < docs.length; i++) {
    allDocKeys[docItemKey(docs[i])] = true;
  }
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i];
    if (d.parentDoc) {
      // Phase-160: 校验 parentDoc 指向的父文档是否存在
      // 如果父文档不存在（孤儿文档），将其作为顶级文档处理
      if (allDocKeys[d.parentDoc]) {
        if (!childrenMap[d.parentDoc]) childrenMap[d.parentDoc] = [];
        childrenMap[d.parentDoc].push(d);
        childKeySet[docItemKey(d)] = true;
      }
      // else: parentDoc 无效，不加入 childKeySet，后续作为顶级文档渲染
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

// ========== Code Intelligence ==========
var codeIntelLoaded = false;
var codeIntelGraphData = { nodes: [], edges: [] };
var codeIntelRenderedGraphData = { nodes: [], edges: [] };
var codeIntelNetwork = null;
var codeIntelMapNodesDataSet = null;
var codeIntelMapEdgesDataSet = null;
var codeIntelMapEdges = [];
var codeIntelAtlasDeck = null;
var codeIntelAtlasState = null;
var codeIntelAtlasViewState = null;
var codeIntelAtlasHoverNodeId = null;
var codeIntelAtlasLoading = false;
var codeIntelAtlasCallbacks = [];
var codeIntelStatusData = null;
var codeIntelRegressionData = null;
var codeIntelBridgeData = null;
var codeIntelBridgeOverviewData = null;
var codeIntelBridgeFocusNodeId = null;
var codeIntelSelectedNodeId = null;
var codeIntelBottomSheetExpanded = false;
var codeIntelVisLoading = false;
var codeIntelVisCallbacks = [];
var CODE_INTEL_VIS_LOAD_TIMEOUT_MS = 4000;
var CODE_INTEL_ATLAS_LOAD_TIMEOUT_MS = 5000;
var CODE_INTEL_FETCH_TIMEOUT_MS = 15000;
var CODE_INTEL_2D_NODE_LIMIT = 1800;

function currentCodeIntelQuery() {
  var input = document.getElementById('codeIntelRepoPath');
  var repoPath = input ? String(input.value || '').trim() : '';
  return repoPath ? ('?repoPath=' + encodeURIComponent(repoPath)) : '';
}

function currentCodeIntelRegressionFixturePath() {
  var input = document.getElementById('codeIntelRegressionFixturePath');
  return input ? String(input.value || '').trim() : '';
}

function currentCodeIntelRegressionExpectedPath() {
  var input = document.getElementById('codeIntelRegressionExpectedPath');
  return input ? String(input.value || '').trim() : '';
}

function loadCodeIntelPage(forceRefresh) {
  forceRefresh = !!forceRefresh;
  var graphMeta = document.getElementById('codeIntelGraphMeta');
  var clustersEl = document.getElementById('codeIntelClusters');
  var processesEl = document.getElementById('codeIntelProcesses');
  var warningsEl = document.getElementById('codeIntelWarnings');
  var cardsEl = document.getElementById('codeIntelStatusCards');
  var regressionEl = document.getElementById('codeIntelRegression');
  var bridgeEl = document.getElementById('codeIntelBridge');
  if (!graphMeta || !clustersEl || !processesEl || !warningsEl || !cardsEl || !regressionEl || !bridgeEl) return;
  setCodeIntelBottomSheetExpanded(false);

  if (!forceRefresh && codeIntelLoaded && codeIntelStatusData) {
    renderCodeIntelStatus(codeIntelStatusData);
    renderCodeIntelGraph(codeIntelGraphData);
    return;
  }

  cardsEl.innerHTML = statCard('🧠', '...', 'Code Intelligence', '正在加载', 'blue');
  graphMeta.textContent = '加载中...';
  clustersEl.innerHTML = '<div style="text-align:center;padding:32px 0;color:#6b7280;"><div class="spinner" style="margin:0 auto 10px;"></div>加载 communities...</div>';
  processesEl.innerHTML = '<div style="text-align:center;padding:32px 0;color:#6b7280;"><div class="spinner" style="margin:0 auto 10px;"></div>加载 processes...</div>';
  warningsEl.innerHTML = '正在读取代码图状态...';
  regressionEl.innerHTML = '输入 fixturePath 后可执行原生回归校验并查看差异诊断。';
  bridgeEl.innerHTML = '输入 <code>moduleId</code> 后可查看当前映射和推荐候选。';

  var query = currentCodeIntelQuery();
  Promise.all([
    fetchCodeIntelJson('/api/code-intel/status' + query, 'status'),
    fetchCodeIntelJson('/api/code-intel/graph' + query, 'graph'),
    fetchCodeIntelJson('/api/code-intel/clusters' + query, 'clusters'),
    fetchCodeIntelJson('/api/code-intel/processes' + query, 'processes')
  ]).then(function(results) {
    codeIntelStatusData = unwrapCodeIntelData(results[0]);
    codeIntelGraphData = unwrapCodeIntelData(results[1]) || { nodes: [], edges: [] };
    var clusterPayload = unwrapCodeIntelData(results[2]) || {};
    var processPayload = unwrapCodeIntelData(results[3]) || {};
    codeIntelLoaded = true;
    renderCodeIntelStatus(codeIntelStatusData);
    renderCodeIntelGraph(codeIntelGraphData);
    renderCodeIntelClusters(clusterPayload.clusters || []);
    renderCodeIntelProcesses(processPayload.processes || []);
    renderCodeIntelRegressionPanel(codeIntelRegressionData);
    loadCodeIntelBridgePanel(false);
  }).catch(function(err) {
    cardsEl.innerHTML = statCard('⚠️', '0', 'Code Intelligence', '加载失败', 'rose');
    graphMeta.textContent = '加载失败';
    warningsEl.innerHTML = '<div style="color:#fca5a5;">' + escHtml(err.message || String(err)) + '</div>';
    clustersEl.innerHTML = '<div style="color:#fca5a5;">加载失败</div>';
    processesEl.innerHTML = '<div style="color:#fca5a5;">加载失败</div>';
    regressionEl.innerHTML = '<div style="color:#94a3b8;">页面初始化失败后，暂时无法运行 regression 检查</div>';
    bridgeEl.innerHTML = '<div style="color:#fca5a5;">页面初始化失败后，暂时无法加载 bridge 面板</div>';
  });
}

function refreshCodeIntelPage() {
  codeIntelLoaded = false;
  loadCodeIntelPage(true);
}

function fetchCodeIntelJson(url, label) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error('Code Intelligence ' + label + ' 请求超时'));
    }, CODE_INTEL_FETCH_TIMEOUT_MS);

    fetch(url).then(function(r) {
      if (!r.ok) {
        return r.json().catch(function() { return {}; }).then(function(payload) {
          throw new Error((payload && (payload.message || (payload.error && payload.error.message))) || ('HTTP ' + r.status));
        });
      }
      return r.json();
    }).then(function(payload) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (payload && payload.ok === false) {
        reject(new Error((payload.message || (payload.error && payload.error.message))) || ('Code Intelligence ' + label + ' 请求失败'));
        return;
      }
      resolve(payload);
    }).catch(function(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function postCodeIntelJson(url, payload, label) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error('Code Intelligence ' + label + ' 请求超时'));
    }, CODE_INTEL_FETCH_TIMEOUT_MS);

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }).then(function(r) {
      if (!r.ok) {
        return r.json().catch(function() { return {}; }).then(function(resp) {
          throw new Error((resp && (resp.message || (resp.error && resp.error.message))) || ('HTTP ' + r.status));
        });
      }
      return r.json();
    }).then(function(resp) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (resp && resp.ok === false) {
        reject(new Error((resp.message || (resp.error && resp.error.message))) || ('Code Intelligence ' + label + ' 请求失败'));
        return;
      }
      resolve(resp);
    }).catch(function(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function unwrapCodeIntelData(payload) {
  if (payload && typeof payload === 'object' && payload.data) return payload.data;
  return payload;
}

function setCodeIntelBottomSheetExpanded(expanded) {
  codeIntelBottomSheetExpanded = !!expanded;
  var sheet = document.getElementById('codeIntelBottomSheet');
  var subtitle = document.getElementById('codeIntelBottomSheetSubtitle');
  if (sheet) {
    if (codeIntelBottomSheetExpanded) sheet.classList.remove('collapsed');
    else sheet.classList.add('collapsed');
  }
  if (!subtitle) return;
  if (codeIntelBottomSheetExpanded) {
    subtitle.textContent = '点击标题可再次收起';
    return;
  }
  if (codeIntelSelectedNodeId && codeIntelRenderedGraphData && codeIntelRenderedGraphData.nodes) {
    for (var i = 0; i < codeIntelRenderedGraphData.nodes.length; i++) {
      var node = codeIntelRenderedGraphData.nodes[i];
      if (node.id === codeIntelSelectedNodeId) {
        subtitle.textContent = '当前: ' + String(node.label || codeIntelSelectedNodeId);
        return;
      }
    }
  }
  subtitle.textContent = '默认收起，点击后向上展开';
}

function toggleCodeIntelBottomSheet() {
  setCodeIntelBottomSheetExpanded(!codeIntelBottomSheetExpanded);
}

function selectCodeIntelNode(nodeId) {
  codeIntelSelectedNodeId = nodeId ? String(nodeId) : null;
  renderCodeIntelSelection(codeIntelSelectedNodeId, codeIntelRenderedGraphData);
  updateCodeIntelMapEdgeVisibility(codeIntelSelectedNodeId);
  setCodeIntelBottomSheetExpanded(codeIntelBottomSheetExpanded);
  if (codeIntelAtlasDeck) {
    updateCodeIntelAtlasSelection();
    focusCodeIntelAtlasNode(codeIntelSelectedNodeId);
  }
  if (codeIntelNetwork && codeIntelSelectedNodeId && typeof codeIntelNetwork.focus === 'function') {
    try {
      codeIntelNetwork.focus(codeIntelSelectedNodeId, {
        scale: 1.1,
        animation: { duration: 350, easingFunction: 'easeInOutQuad' }
      });
    } catch (e) {}
  }
}

function renderCodeIntelSelection(nodeId, graph) {
  var el = document.getElementById('codeIntelSelection');
  if (!el) return;
  if (!graph || !graph.nodes || !graph.nodes.length) {
    el.innerHTML = '<div class="code-intel-selection-empty">当前没有可展示的代码图节点。</div>';
    return;
  }
  if (!nodeId) {
    el.innerHTML = '<div class="code-intel-selection-empty">点击图中的文件 / 符号 / community / process 节点后，在这里查看详情。</div>';
    return;
  }

  var node = null;
  var nodeMap = {};
  for (var i = 0; i < graph.nodes.length; i++) {
    var candidate = graph.nodes[i];
    nodeMap[candidate.id] = candidate;
    if (candidate.id === nodeId) node = candidate;
  }
  if (!node) {
    el.innerHTML = '<div class="code-intel-selection-empty">当前视图中未找到该节点，请重新点击图中的节点。</div>';
    return;
  }

  var props = node.properties || {};
  var incoming = 0;
  var outgoing = 0;
  var neighbors = [];
  for (var j = 0; j < (graph.edges || []).length; j++) {
    var edge = graph.edges[j];
    if (edge.from === nodeId) {
      outgoing++;
      if (nodeMap[edge.to]) neighbors.push(nodeMap[edge.to].label || edge.to);
    } else if (edge.to === nodeId) {
      incoming++;
      if (nodeMap[edge.from]) neighbors.push(nodeMap[edge.from].label || edge.from);
    }
  }

  var kvs = [
    ['类型', node.type || '-'],
    ['ID', node.id || '-'],
    ['路径', props.filePath || props.repoPath || props.entryFile || '-'],
    ['语言', props.language || props.kind || props.processType || '-'],
    ['Community', props.communityId || '-'],
    ['入边 / 出边', incoming + ' / ' + outgoing]
  ];

  var html = '';
  html += '<div class="code-intel-selection-title">' + escHtml(node.label || node.id) + '</div>';
  html += '<div class="code-intel-selection-badges">';
  html += '<span>' + escHtml(String(node.type || 'node')) + '</span>';
  if (props.kind) html += '<span>' + escHtml(String(props.kind)) + '</span>';
  if (props.processType) html += '<span>' + escHtml(String(props.processType)) + '</span>';
  html += '</div>';
  html += '<div class="code-intel-selection-grid">';
  for (var k = 0; k < kvs.length; k++) {
    html += '<div class="code-intel-selection-kv">';
    html += '<div class="code-intel-selection-k">' + escHtml(kvs[k][0]) + '</div>';
    html += '<div class="code-intel-selection-v">' + escHtml(String(kvs[k][1])) + '</div>';
    html += '</div>';
  }
  html += '</div>';

  var extraKeys = ['symbolCount', 'memberCount', 'fileCount', 'stepCount', 'subSection', 'section'];
  var extraHtml = '';
  for (var x = 0; x < extraKeys.length; x++) {
    var key = extraKeys[x];
    if (typeof props[key] === 'undefined' || props[key] === null || props[key] === '') continue;
    extraHtml += '<span>' + escHtml(key + ': ' + String(props[key])) + '</span>';
  }
  if (extraHtml) {
    html += '<div class="code-intel-selection-list">' + extraHtml + '</div>';
  }

  if (neighbors.length) {
    html += '<div style="margin-top:10px;color:#94a3b8;font-size:11px;">相邻节点</div>';
    html += '<div class="code-intel-selection-list" style="margin-top:6px;">';
    for (var n = 0; n < Math.min(8, neighbors.length); n++) {
      html += '<span>' + escHtml(String(neighbors[n])) + '</span>';
    }
    if (neighbors.length > 8) {
      html += '<span>+' + (neighbors.length - 8) + ' more</span>';
    }
    html += '</div>';
  }

  el.innerHTML = html;
}

function runCodeIntelRegressionCheck() {
  var el = document.getElementById('codeIntelRegression');
  var fixturePath = currentCodeIntelRegressionFixturePath();
  var expectedPath = currentCodeIntelRegressionExpectedPath();
  if (!el) return;
  if (!fixturePath) {
    el.innerHTML = '<div style="color:#fca5a5;">请先输入 fixturePath</div>';
    return;
  }
  el.innerHTML = '<div style="color:#94a3b8;"><div class="spinner" style="display:inline-block;vertical-align:middle;margin-right:8px;width:14px;height:14px;border-width:2px;"></div>正在执行原生 regression 检查...</div>';
  postCodeIntelJson('/api/code-intel/regression-check', {
    fixturePath: fixturePath,
    expectedPath: expectedPath || undefined
  }, 'regression-check').then(function(resp) {
    codeIntelRegressionData = unwrapCodeIntelData(resp) || resp || null;
    renderCodeIntelRegressionPanel(codeIntelRegressionData);
  }).catch(function(err) {
    el.innerHTML = '<div style="color:#fca5a5;">' + escHtml(err.message || String(err)) + '</div>';
  });
}

function renderCodeIntelRegressionPanel(result) {
  var el = document.getElementById('codeIntelRegression');
  if (!el) return;
  if (!result) {
    el.innerHTML = '输入 fixturePath 后可执行原生回归校验并查看差异诊断。';
    return;
  }

  var summary = result.summary || {};
  var metrics = result.metrics || {};
  var performance = result.performance || {};
  var stability = result.stability || {};
  var diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
  function metricPct(metric) {
    return Math.round(Number(metric && metric.rate != null ? metric.rate : 1) * 100);
  }
  var html = '';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">';
  html += '<span style="padding:3px 8px;border-radius:999px;background:' + (result.ok ? '#052e16' : '#3f0d0d') + ';color:' + (result.ok ? '#86efac' : '#fca5a5') + ';font-size:11px;font-weight:600;">' + (result.ok ? 'PASS' : 'FAIL') + '</span>';
  html += '<span style="padding:3px 8px;border-radius:999px;background:#172554;color:#93c5fd;font-size:11px;">checks ' + Number(summary.checksTotal || 0) + '</span>';
  html += '<span style="padding:3px 8px;border-radius:999px;background:#1f2937;color:#cbd5e1;font-size:11px;">passed ' + Number(summary.passed || 0) + '</span>';
  html += '<span style="padding:3px 8px;border-radius:999px;background:#3f0d0d;color:#fca5a5;font-size:11px;">failed ' + Number(summary.failed || 0) + '</span>';
  html += '</div>';
  html += '<div style="margin-bottom:8px;color:#9fb0d1;font-size:11px;line-height:1.6;">';
  html += '<div><strong>fixture:</strong> ' + escHtml(String(result.fixturePath || '-')) + '</div>';
  html += '<div><strong>expected:</strong> ' + escHtml(String(result.expectedPath || '-')) + '</div>';
  if (result.comparedAt) {
    html += '<div><strong>comparedAt:</strong> ' + escHtml(new Date(result.comparedAt).toLocaleString()) + '</div>';
  }
  html += '</div>';
  if (metrics && typeof metrics === 'object') {
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="margin-bottom:6px;color:#cbd5e1;font-size:11px;font-weight:600;">质量指标</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    if (metrics.requiredNodeRecall) {
      html += '<span style="padding:3px 8px;border-radius:999px;background:#172554;color:#93c5fd;font-size:11px;">node recall ' + metricPct(metrics.requiredNodeRecall) + '% (' + Number(metrics.requiredNodeRecall.matched || 0) + '/' + Number(metrics.requiredNodeRecall.total || 0) + ')</span>';
    }
    if (metrics.importRecall) {
      html += '<span style="padding:3px 8px;border-radius:999px;background:#0f3d2e;color:#86efac;font-size:11px;">import recall ' + metricPct(metrics.importRecall) + '% (' + Number(metrics.importRecall.matched || 0) + '/' + Number(metrics.importRecall.total || 0) + ')</span>';
    }
    if (metrics.requiredEdgeRecall) {
      html += '<span style="padding:3px 8px;border-radius:999px;background:#3b2f0e;color:#fde68a;font-size:11px;">edge recall ' + metricPct(metrics.requiredEdgeRecall) + '% (' + Number(metrics.requiredEdgeRecall.matched || 0) + '/' + Number(metrics.requiredEdgeRecall.total || 0) + ')</span>';
    }
    if (metrics.queryTop1HitRate) {
      html += '<span style="padding:3px 8px;border-radius:999px;background:#1f2937;color:#cbd5e1;font-size:11px;">query top-1 ' + metricPct(metrics.queryTop1HitRate) + '% (' + Number(metrics.queryTop1HitRate.matched || 0) + '/' + Number(metrics.queryTop1HitRate.total || 0) + ')</span>';
    }
    if (metrics.contextNeighborExactRate) {
      html += '<span style="padding:3px 8px;border-radius:999px;background:#3f0d0d;color:#fca5a5;font-size:11px;">context exact ' + metricPct(metrics.contextNeighborExactRate) + '% (' + Number(metrics.contextNeighborExactRate.matched || 0) + '/' + Number(metrics.contextNeighborExactRate.total || 0) + ')</span>';
    }
    if (metrics.impactRequiredNodeCoverage) {
      html += '<span style="padding:3px 8px;border-radius:999px;background:#172554;color:#bfdbfe;font-size:11px;">impact coverage ' + metricPct(metrics.impactRequiredNodeCoverage) + '% (' + Number(metrics.impactRequiredNodeCoverage.matched || 0) + '/' + Number(metrics.impactRequiredNodeCoverage.total || 0) + ')</span>';
    }
    html += '</div>';
    html += '</div>';
  }
  if (performance && typeof performance === 'object') {
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="margin-bottom:6px;color:#cbd5e1;font-size:11px;font-weight:600;">性能基线</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<span style="padding:3px 8px;border-radius:999px;background:#172554;color:#93c5fd;font-size:11px;">index ' + Number(performance.indexMs || 0) + 'ms</span>';
    html += '<span style="padding:3px 8px;border-radius:999px;background:#0f3d2e;color:#86efac;font-size:11px;">graph ' + Number(performance.graphMs || 0) + 'ms</span>';
    html += '<span style="padding:3px 8px;border-radius:999px;background:#1f2937;color:#cbd5e1;font-size:11px;">query avg ' + Number(performance.queryAvgMs || 0).toFixed(1) + 'ms</span>';
    html += '<span style="padding:3px 8px;border-radius:999px;background:#1f2937;color:#cbd5e1;font-size:11px;">context avg ' + Number(performance.contextAvgMs || 0).toFixed(1) + 'ms</span>';
    html += '<span style="padding:3px 8px;border-radius:999px;background:#1f2937;color:#cbd5e1;font-size:11px;">impact avg ' + Number(performance.impactAvgMs || 0).toFixed(1) + 'ms</span>';
    html += '<span style="padding:3px 8px;border-radius:999px;background:#3b2f0e;color:#fde68a;font-size:11px;">graph bytes ' + Number(performance.graphBytes || 0) + '</span>';
    html += '<span style="padding:3px 8px;border-radius:999px;background:#172554;color:#bfdbfe;font-size:11px;">nodes ' + Number(performance.nodeCount || 0) + ' / edges ' + Number(performance.edgeCount || 0) + '</span>';
    html += '</div>';
    html += '</div>';
  }
  if (stability && typeof stability === 'object' && typeof stability.rebuildStable !== 'undefined') {
    html += '<div style="margin-bottom:10px;">';
    html += '<div style="margin-bottom:6px;color:#cbd5e1;font-size:11px;font-weight:600;">稳定性基线</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    html += '<span style="padding:3px 8px;border-radius:999px;background:' + (stability.rebuildStable ? '#052e16' : '#3f0d0d') + ';color:' + (stability.rebuildStable ? '#86efac' : '#fca5a5') + ';font-size:11px;">rebuild ' + (stability.rebuildStable ? 'stable' : 'mismatch') + '</span>';
    html += '<span style="padding:3px 8px;border-radius:999px;background:#1f2937;color:#cbd5e1;font-size:11px;">rebuild ' + Number(stability.rebuildMs || 0) + 'ms</span>';
    html += '<span style="padding:3px 8px;border-radius:999px;background:#1f2937;color:#cbd5e1;font-size:11px;">delta n/e/c/p = ' + Number(stability.nodeDelta || 0) + '/' + Number(stability.edgeDelta || 0) + '/' + Number(stability.clusterDelta || 0) + '/' + Number(stability.processDelta || 0) + '</span>';
    html += '</div>';
    html += '</div>';
  }

  if (!diagnostics.length) {
    html += '<div style="color:#86efac;">当前没有发现回归差异。</div>';
    el.innerHTML = html;
    return;
  }

  html += '<div style="max-height:220px;overflow:auto;border:1px solid #1f2a44;border-radius:8px;background:#0b1220;padding:8px;">';
  for (var i = 0; i < diagnostics.length; i++) {
    var item = diagnostics[i] || {};
    html += '<div style="padding:8px 0;' + (i > 0 ? 'border-top:1px solid #1f2a44;' : '') + '">';
    html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">';
    html += '<span style="font-size:10px;padding:2px 6px;border-radius:999px;background:' + (item.severity === 'error' ? '#3f0d0d' : '#3b2f0e') + ';color:' + (item.severity === 'error' ? '#fca5a5' : '#fde68a') + ';">' + escHtml(String(item.severity || 'info')) + '</span>';
    html += '<span style="font-size:10px;padding:2px 6px;border-radius:999px;background:#172554;color:#93c5fd;">' + escHtml(String(item.scope || '-')) + '</span>';
    html += '<span style="font-size:10px;color:#94a3b8;font-family:monospace;">' + escHtml(String(item.code || '-')) + '</span>';
    html += '</div>';
    html += '<div style="color:#e2e8f0;margin-bottom:4px;">' + escHtml(String(item.message || '')) + '</div>';
    if (typeof item.expected !== 'undefined') {
      html += '<div style="font-size:11px;color:#94a3b8;"><strong>expected:</strong> ' + escHtml(JSON.stringify(item.expected)) + '</div>';
    }
    if (typeof item.actual !== 'undefined') {
      html += '<div style="font-size:11px;color:#94a3b8;"><strong>actual:</strong> ' + escHtml(JSON.stringify(item.actual)) + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

function currentCodeIntelBridgeModuleId() {
  var input = document.getElementById('codeIntelBridgeModuleId');
  return input ? String(input.value || '').trim() : '';
}

function isCodeIntelBridgeShowAllEnabled() {
  var input = document.getElementById('codeIntelBridgeShowAll');
  return !!(input && input.checked);
}

function getCodeIntelBridgeFilters() {
  var moduleFamilyInput = document.getElementById('codeIntelBridgeModuleFamily');
  var communityInput = document.getElementById('codeIntelBridgeCommunityFilter');
  var linkedInput = document.getElementById('codeIntelBridgeFilterLinked');
  var recommendedInput = document.getElementById('codeIntelBridgeFilterRecommended');
  var recommendedProcessInput = document.getElementById('codeIntelBridgeFilterRecommendedProcess');
  return {
    moduleFamily: moduleFamilyInput ? String(moduleFamilyInput.value || '').trim().toLowerCase() : '',
    communityQuery: communityInput ? String(communityInput.value || '').trim().toLowerCase() : '',
    showLinked: !linkedInput || !!linkedInput.checked,
    showRecommended: !recommendedInput || !!recommendedInput.checked,
    showRecommendedProcess: !recommendedProcessInput || !!recommendedProcessInput.checked,
  };
}

function applyCodeIntelBridgeFilters() {
  renderCodeIntelGraph(codeIntelGraphData);
}

function toggleCodeIntelBridgeShowAll() {
  if (isCodeIntelBridgeShowAllEnabled()) {
    loadCodeIntelBridgeOverview();
  } else {
    codeIntelBridgeOverviewData = null;
    renderCodeIntelGraph(codeIntelGraphData);
  }
}

function loadCodeIntelBridgeOverview() {
  var query = currentCodeIntelQuery();
  fetchCodeIntelJson('/api/code-intel/bridge/modules' + query, 'bridge-modules')
    .then(function(resp) {
      codeIntelBridgeOverviewData = unwrapCodeIntelData(resp) || null;
      renderCodeIntelGraph(codeIntelGraphData);
    })
    .catch(function() {
      codeIntelBridgeOverviewData = null;
      renderCodeIntelGraph(codeIntelGraphData);
    });
}

function loadCodeIntelBridgePanel(forceRecommend) {
  var moduleId = currentCodeIntelBridgeModuleId();
  var el = document.getElementById('codeIntelBridge');
  if (!el) return;
  if (!moduleId) {
    el.innerHTML = '输入 <code>moduleId</code> 后可查看当前映射和推荐候选。';
    return;
  }

  el.innerHTML = '<div style="color:#94a3b8;">正在读取 bridge 映射...</div>';
  var query = currentCodeIntelQuery();
  fetchCodeIntelJson('/api/code-intel/module/resolve?moduleId=' + encodeURIComponent(moduleId) + (query ? ('&' + query.slice(1)) : ''), 'bridge-resolve')
    .then(function(resp) {
      var resolved = unwrapCodeIntelData(resp) || {};
      codeIntelBridgeData = { resolved: resolved, recommended: null };
      codeIntelBridgeFocusNodeId = resolved && resolved.module && resolved.module.moduleId
        ? ('module-overlay:' + String(resolved.module.moduleId))
        : null;
      renderCodeIntelBridgePanel(codeIntelBridgeData);
      renderCodeIntelGraph(codeIntelGraphData);
      if (forceRecommend !== false) {
        recommendCodeIntelBridge();
      }
    })
    .catch(function(err) {
      el.innerHTML = '<div style="color:#fca5a5;">' + escHtml(err.message || String(err)) + '</div>';
    });
}

function recommendCodeIntelBridge() {
  var moduleId = currentCodeIntelBridgeModuleId();
  var el = document.getElementById('codeIntelBridge');
  if (!el || !moduleId) return;

  var query = currentCodeIntelQuery();
  fetchCodeIntelJson('/api/code-intel/recommend/module?moduleId=' + encodeURIComponent(moduleId) + '&limit=5' + (query ? ('&' + query.slice(1)) : ''), 'bridge-recommend')
    .then(function(resp) {
      var recommended = unwrapCodeIntelData(resp) || {};
      codeIntelBridgeData = codeIntelBridgeData || {};
      codeIntelBridgeData.recommended = recommended;
      renderCodeIntelBridgePanel(codeIntelBridgeData);
      renderCodeIntelGraph(codeIntelGraphData);
    })
    .catch(function(err) {
      el.innerHTML = '<div style="color:#fca5a5;">' + escHtml(err.message || String(err)) + '</div>';
    });
}

function applyCodeIntelModuleRecommendation(communityId) {
  var moduleId = currentCodeIntelBridgeModuleId();
  var el = document.getElementById('codeIntelBridge');
  if (!el || !moduleId || !communityId) return;
  el.innerHTML = '<div style="color:#94a3b8;">正在应用推荐映射...</div>';
  postCodeIntelJson('/api/code-intel/link/module', {
    moduleId: moduleId,
    communityId: communityId
  }, 'bridge-link-module').then(function() {
    loadCodeIntelBridgePanel(true);
  }).catch(function(err) {
    el.innerHTML = '<div style="color:#fca5a5;">' + escHtml(err.message || String(err)) + '</div>';
  });
}

function focusCurrentCodeIntelBridgeModule() {
  var moduleId = currentCodeIntelBridgeModuleId();
  if (!moduleId) return;
  codeIntelBridgeFocusNodeId = 'module-overlay:' + moduleId;
  if (codeIntelNetwork && typeof codeIntelNetwork.focus === 'function') {
    try {
      codeIntelNetwork.focus(codeIntelBridgeFocusNodeId, {
        scale: 1.2,
        animation: { duration: 600, easingFunction: 'easeInOutQuad' }
      });
      return;
    } catch (e) {}
  }
  renderCodeIntelGraph(codeIntelGraphData);
}

function renderCodeIntelBridgePanel(data) {
  var el = document.getElementById('codeIntelBridge');
  if (!el) return;
  if (!data || !data.resolved) {
    el.innerHTML = '暂无 bridge 数据';
    return;
  }

  var resolved = data.resolved || {};
  var recommended = data.recommended || null;
  var html = '';
  var moduleInfo = resolved.module || {};
  html += '<div style="margin-bottom:10px;"><strong>模块:</strong> ' + escHtml(String(moduleInfo.name || moduleInfo.moduleId || '-')) + ' <span style="color:#64748b;">(' + escHtml(String(moduleInfo.moduleId || '-')) + ')</span></div>';

  var links = resolved.links || [];
  html += '<div style="margin-bottom:10px;"><strong>当前映射:</strong></div>';
  if (!links.length) {
    html += '<div style="color:#94a3b8;margin-bottom:10px;">尚未建立 module → community 映射</div>';
  } else {
    for (var i = 0; i < links.length; i++) {
      html += '<div style="margin-bottom:6px;color:#86efac;">• ' + escHtml(String(links[i].communityId || '')) + '</div>';
    }
  }

  if (recommended) {
    var communities = recommended.recommendedCommunities || [];
    var processes = recommended.recommendedProcesses || [];
    html += '<div style="margin:10px 0 6px;"><strong>推荐 Communities:</strong></div>';
    if (!communities.length) {
      html += '<div style="color:#94a3b8;">暂无推荐 community</div>';
    } else {
      for (var c = 0; c < communities.length; c++) {
        var item = communities[c];
        html += '<div style="margin-bottom:8px;padding:8px;border:1px solid #1f2a44;border-radius:8px;background:#0b1220;">';
        html += '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">';
        html += '<div><div style="color:#dbe7ff;font-weight:600;">' + escHtml(String((item.community && item.community.label) || '-')) + '</div>';
        html += '<div style="color:#64748b;">' + escHtml(String((item.community && item.community.id) || '-')) + ' · score ' + escHtml(String(item.score || 0)) + '</div></div>';
        html += '<button class="refresh-btn" data-community-id="' + escHtml(encodeURIComponent(String((item.community && item.community.id) || ''))) + '" onclick="applyCodeIntelModuleRecommendation(decodeURIComponent(this.getAttribute(\\x27data-community-id\\x27) || \\x27\\x27))" style="padding:6px 10px;">应用</button>';
        html += '</div>';
        if (item.reasons && item.reasons.length) {
          html += '<div style="margin-top:6px;color:#94a3b8;">' + escHtml(item.reasons.join(' | ')) + '</div>';
        }
        html += '</div>';
      }
    }
    html += '<div style="margin:10px 0 6px;"><strong>推荐 Processes:</strong></div>';
    if (!processes.length) {
      html += '<div style="color:#94a3b8;">暂无推荐 process</div>';
    } else {
      for (var p = 0; p < processes.length; p++) {
        var proc = processes[p];
        html += '<div style="margin-bottom:6px;">• <span style="color:#dbe7ff;">' + escHtml(String((proc.process && proc.process.label) || '-')) + '</span> <span style="color:#64748b;">(score ' + escHtml(String(proc.score || 0)) + ')</span></div>';
      }
    }
  }

  el.innerHTML = html;
}

function buildCodeIntelBridgeOverlay(graph) {
  if (!graph || !graph.nodes || !graph.edges) {
    return { graph: graph, overlayMeta: '' };
  }

  var filters = getCodeIntelBridgeFilters();
  var nodes = graph.nodes.slice();
  var edges = graph.edges.slice();
  var nodeIdSet = {};
  for (var i = 0; i < nodes.length; i++) nodeIdSet[nodes[i].id] = true;
  var nodeById = {};
  for (var ni = 0; ni < nodes.length; ni++) nodeById[nodes[ni].id] = nodes[ni];
  var edgeKeySet = {};
  for (var j = 0; j < edges.length; j++) {
    edgeKeySet[edges[j].from + '|' + edges[j].to + '|' + edges[j].label] = true;
  }

  function moduleMatchesFilter(moduleInfo) {
    if (!filters.moduleFamily) return true;
    var moduleId = String((moduleInfo && moduleInfo.moduleId) || '').toLowerCase();
    var moduleName = String((moduleInfo && moduleInfo.name) || '').toLowerCase();
    return moduleId.indexOf(filters.moduleFamily) === 0 || moduleName.indexOf(filters.moduleFamily) !== -1;
  }

  function communityMatchesFilter(communityId) {
    if (!filters.communityQuery) return true;
    var node = nodeById[communityId] || {};
    var idText = String(communityId || '').toLowerCase();
    var labelText = String(node.label || '').toLowerCase();
    return idText.indexOf(filters.communityQuery) !== -1 || labelText.indexOf(filters.communityQuery) !== -1;
  }

  function ensureOverlayNode(moduleInfo) {
    var moduleId = String((moduleInfo && moduleInfo.moduleId) || '').trim();
    if (!moduleId) return null;
    var overlayNodeId = 'module-overlay:' + moduleId;
    if (!nodeIdSet[overlayNodeId]) {
      nodeIdSet[overlayNodeId] = true;
      nodes.push({
        id: overlayNodeId,
        label: String((moduleInfo && (moduleInfo.name || moduleInfo.moduleId)) || moduleId),
        type: 'module',
        properties: {
          moduleId: moduleId,
          bridgeOverlay: true,
          focused: codeIntelBridgeFocusNodeId === overlayNodeId
        }
      });
    }
    return overlayNodeId;
  }

  function appendOverlayLinks(moduleInfo, links, recommendedCommunities, recommendedProcesses) {
    if (!moduleMatchesFilter(moduleInfo)) return;
    var overlayNodeId = null;
    var addedAny = false;

    var currentLinks = links || [];
    for (var k = 0; k < currentLinks.length; k++) {
      var linkedCommunityId = String(currentLinks[k].communityId || '');
      var key = overlayNodeId + '|' + linkedCommunityId + '|BRIDGE_LINK';
      if (!filters.showLinked) continue;
      if (!linkedCommunityId || !communityMatchesFilter(linkedCommunityId)) continue;
      if (!overlayNodeId) overlayNodeId = ensureOverlayNode(moduleInfo);
      key = overlayNodeId + '|' + linkedCommunityId + '|BRIDGE_LINK';
      if (!edgeKeySet[key]) {
        edgeKeySet[key] = true;
        edges.push({
          from: overlayNodeId,
          to: linkedCommunityId,
          label: 'BRIDGE_LINK',
          confidence: 1,
          properties: { bridgeOverlay: true, bridgeKind: 'linked' }
        });
        addedAny = true;
      }
    }

    var recCommunities = recommendedCommunities || [];
    for (var c = 0; c < recCommunities.length; c++) {
      var community = recCommunities[c] && recCommunities[c].community;
      var recommendedCommunityId = String((community && community.id) || '');
      var recKey = overlayNodeId + '|' + recommendedCommunityId + '|BRIDGE_RECOMMEND';
      var linkedKey = overlayNodeId + '|' + recommendedCommunityId + '|BRIDGE_LINK';
      if (!filters.showRecommended) continue;
      if (!recommendedCommunityId || !communityMatchesFilter(recommendedCommunityId)) continue;
      if (!overlayNodeId) overlayNodeId = ensureOverlayNode(moduleInfo);
      recKey = overlayNodeId + '|' + recommendedCommunityId + '|BRIDGE_RECOMMEND';
      linkedKey = overlayNodeId + '|' + recommendedCommunityId + '|BRIDGE_LINK';
      if (!edgeKeySet[linkedKey] && !edgeKeySet[recKey]) {
        edgeKeySet[recKey] = true;
        edges.push({
          from: overlayNodeId,
          to: recommendedCommunityId,
          label: 'BRIDGE_RECOMMEND',
          confidence: 0.75,
          properties: { bridgeOverlay: true, bridgeKind: 'recommended' }
        });
        addedAny = true;
      }
    }

    var recProcesses = recommendedProcesses || [];
    for (var p = 0; p < recProcesses.length; p++) {
      var process = recProcesses[p] && recProcesses[p].process;
      var processId = String((process && process.id) || '');
      var processKey = overlayNodeId + '|' + processId + '|BRIDGE_RECOMMEND';
      var processNode = nodeById[processId] || {};
      var processCommunityId = String((processNode.properties && processNode.properties.communityId) || '');
      if (!filters.showRecommendedProcess) continue;
      if (!processId) continue;
      if (filters.communityQuery && processCommunityId && !communityMatchesFilter(processCommunityId)) continue;
      if (!overlayNodeId) overlayNodeId = ensureOverlayNode(moduleInfo);
      processKey = overlayNodeId + '|' + processId + '|BRIDGE_RECOMMEND';
      if (!edgeKeySet[processKey]) {
        edgeKeySet[processKey] = true;
        edges.push({
          from: overlayNodeId,
          to: processId,
          label: 'BRIDGE_RECOMMEND',
          confidence: 0.55,
          properties: { bridgeOverlay: true, bridgeKind: 'recommended-process' }
        });
        addedAny = true;
      }
    }

    if (!addedAny && overlayNodeId) {
      for (var idx = nodes.length - 1; idx >= 0; idx--) {
        if (nodes[idx].id === overlayNodeId) {
          nodes.splice(idx, 1);
          break;
        }
      }
      delete nodeIdSet[overlayNodeId];
    }
  }

  if (codeIntelBridgeData && codeIntelBridgeData.resolved) {
    var resolved = codeIntelBridgeData.resolved || {};
    var recommended = codeIntelBridgeData.recommended || {};
    appendOverlayLinks(
      resolved.module || {},
      resolved.links || [],
      recommended.recommendedCommunities || [],
      recommended.recommendedProcesses || [],
    );
  }

  if (isCodeIntelBridgeShowAllEnabled() && codeIntelBridgeOverviewData && codeIntelBridgeOverviewData.modules) {
    for (var m = 0; m < codeIntelBridgeOverviewData.modules.length; m++) {
      var item = codeIntelBridgeOverviewData.modules[m] || {};
      appendOverlayLinks(item.module || {}, item.links || [], [], []);
    }
  }

  return {
    graph: { nodes: nodes, edges: edges },
    overlayMeta: ' + bridge overlay'
  };
}

function ensureCodeIntelAtlasLoaded(callback) {
  if (typeof deck !== 'undefined' && deck.Deck && deck.TextLayer && deck.PolygonLayer) {
    callback();
    return;
  }
  codeIntelAtlasCallbacks.push(callback);
  if (codeIntelAtlasLoading) return;
  codeIntelAtlasLoading = true;

  var atlasUrls = [
    'https://cdn.jsdelivr.net/npm/deck.gl@8.9.36/dist.min.js',
    'https://unpkg.com/deck.gl@8.9.36/dist.min.js'
  ];

  function flushCallbacks() {
    var callbacks = codeIntelAtlasCallbacks.slice();
    codeIntelAtlasCallbacks = [];
    codeIntelAtlasLoading = false;
    for (var i = 0; i < callbacks.length; i++) {
      try { callbacks[i](); } catch (e) {}
    }
  }

  function failCallbacks() {
    codeIntelAtlasCallbacks = [];
    codeIntelAtlasLoading = false;
  }

  function loadOne(index) {
    if (typeof deck !== 'undefined' && deck.Deck && deck.TextLayer && deck.PolygonLayer) {
      flushCallbacks();
      return;
    }
    if (index >= atlasUrls.length) {
      failCallbacks();
      return;
    }
    var s = document.createElement('script');
    var settled = false;
    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;
      try { s.remove(); } catch (e) {}
      loadOne(index + 1);
    }, CODE_INTEL_ATLAS_LOAD_TIMEOUT_MS);
    s.src = atlasUrls[index];
    s.onload = function() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof deck !== 'undefined' && deck.Deck && deck.TextLayer && deck.PolygonLayer) {
        flushCallbacks();
      } else {
        loadOne(index + 1);
      }
    };
    s.onerror = function() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      loadOne(index + 1);
    };
    document.head.appendChild(s);
  }

  loadOne(0);
}

function ensureCodeIntelVisLoaded(callback) {
  if (typeof vis !== 'undefined' && vis.Network && vis.DataSet) {
    callback();
    return;
  }
  codeIntelVisCallbacks.push(callback);
  if (codeIntelVisLoading) return;
  codeIntelVisLoading = true;

  function flushCallbacks() {
    var callbacks = codeIntelVisCallbacks.slice();
    codeIntelVisCallbacks = [];
    codeIntelVisLoading = false;
    for (var i = 0; i < callbacks.length; i++) {
      try { callbacks[i](); } catch (e) {}
    }
  }

  function failCallbacks(message) {
    codeIntelVisCallbacks = [];
    codeIntelVisLoading = false;
    var container = document.getElementById('codeIntelGraph');
    if (container) {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#fca5a5;">' + escHtml(message) + '</div>';
    }
  }

  function loadOne(index) {
    if (typeof vis !== 'undefined' && vis.Network && vis.DataSet) {
      flushCallbacks();
      return;
    }
    if (!VIS_URLS || index >= VIS_URLS.length) {
      failCallbacks('vis-network CDN 加载失败');
      return;
    }
    var s = document.createElement('script');
    var settled = false;
    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;
      try { s.remove(); } catch (e) {}
      loadOne(index + 1);
    }, CODE_INTEL_VIS_LOAD_TIMEOUT_MS);
    s.src = VIS_URLS[index];
    s.onload = function() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof vis !== 'undefined' && vis.Network && vis.DataSet) {
        flushCallbacks();
      } else {
        loadOne(index + 1);
      }
    };
    s.onerror = function() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      loadOne(index + 1);
    };
    document.head.appendChild(s);
  }

  loadOne(0);
}

function renderCodeIntelGraph3D(graph, container) {
  function hashString(input) {
    var h = 2166136261;
    for (var i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function hashUnit(input, salt) {
    var h = hashString(String(input) + '|' + String(salt || ''));
    return (h % 1000000) / 1000000;
  }

  function gridClusterPoint(index, total, spacing) {
    if (total <= 1) return { x: 0, y: 0, z: 0 };
    var side = Math.ceil(Math.pow(total, 1 / 3));
    var layerSize = side * side;
    var zIndex = Math.floor(index / layerSize);
    var rem = index % layerSize;
    var yIndex = Math.floor(rem / side);
    var xIndex = rem % side;
    var x = (xIndex - (side - 1) / 2) * spacing;
    var y = (yIndex - (side - 1) / 2) * spacing * 0.82;
    var z = (zIndex - (side - 1) / 2) * spacing;
    return { x: x, y: y, z: z };
  }

  function seededClusterOffset(id, radius) {
    var u = hashUnit(id, 'phi');
    var v = hashUnit(id, 'theta');
    var w = hashUnit(id, 'rr');
    var theta = u * Math.PI * 2;
    var phi = Math.acos(2 * v - 1);
    var rr = Math.max(6, Math.pow(w, 0.72) * radius);
    return {
      x: Math.sin(phi) * Math.cos(theta) * rr,
      y: Math.cos(phi) * rr * 0.72,
      z: Math.sin(phi) * Math.sin(theta) * rr
    };
  }

  var nodeById = {};
  for (var n0 = 0; n0 < graph.nodes.length; n0++) nodeById[graph.nodes[n0].id] = graph.nodes[n0];

  var fileToCommunity = {};
  var symbolToFile = {};
  var folderCounts = {};
  for (var e0 = 0; e0 < graph.edges.length; e0++) {
    var e = graph.edges[e0];
    if (e.label === 'MEMBER_OF' && String(e.to || '').indexOf('community:') === 0) fileToCommunity[e.from] = e.to;
    if (e.label === 'DEFINES') symbolToFile[e.to] = e.from;
  }

  for (var fileId in fileToCommunity) {
    var fileNode = nodeById[fileId];
    if (!fileNode || !fileNode.properties || !fileNode.properties.filePath) continue;
    var relPath = String(fileNode.properties.filePath);
    var segments = relPath.split(/[\\/]/).filter(Boolean);
    var current = '';
    for (var s = 0; s < Math.max(0, segments.length - 1); s++) {
      current = current ? (current + '/' + segments[s]) : segments[s];
      if (!folderCounts[current]) folderCounts[current] = {};
      folderCounts[current][fileToCommunity[fileId]] = (folderCounts[current][fileToCommunity[fileId]] || 0) + 1;
    }
  }

  function dominantCommunityForFolder(folderPath) {
    var counts = folderCounts[folderPath];
    if (!counts) return null;
    var bestId = null;
    var bestCount = -1;
    for (var communityId in counts) {
      if (counts[communityId] > bestCount) {
        bestCount = counts[communityId];
        bestId = communityId;
      }
    }
    return bestId;
  }

  var communityNodes = graph.nodes.filter(function(n) { return n.type === 'community'; });
  communityNodes.sort(function(a, b) {
    return String(a.label || a.id).localeCompare(String(b.label || b.id));
  });

  var clusterSpacing = Math.max(240, Math.min(360, 180 + communityNodes.length * 1.8));
  var clusterCenters = {};
  for (var c = 0; c < communityNodes.length; c++) {
    clusterCenters[communityNodes[c].id] = gridClusterPoint(c, communityNodes.length, clusterSpacing);
  }

  function resolveClusterId(node) {
    if (!node) return null;
    if (node.type === 'project') return null;
    if (node.type === 'community') return node.id;
    if (node.type === 'process' && node.properties && node.properties.communityId) return node.properties.communityId;
    if (node.type === 'file') return fileToCommunity[node.id] || null;
    if (node.type === 'symbol') {
      var parentFileId = symbolToFile[node.id];
      return parentFileId ? (fileToCommunity[parentFileId] || null) : null;
    }
    if (node.type === 'folder' && node.properties && node.properties.filePath) {
      return dominantCommunityForFolder(String(node.properties.filePath));
    }
    return null;
  }

  var nodes3d = [];
  for (var i = 0; i < graph.nodes.length; i++) {
    var n = graph.nodes[i];
    var clusterId = resolveClusterId(n);
    var center = clusterId ? clusterCenters[clusterId] : null;
    var radius = 26;
    if (n.type === 'community') radius = 4;
    else if (n.type === 'process') radius = 18;
    else if (n.type === 'folder') radius = 22;
    else if (n.type === 'file') radius = 44;
    else if (n.type === 'symbol') radius = 70;
    var offset = center ? seededClusterOffset(n.id, radius) : { x: 0, y: 0, z: 0 };
    nodes3d.push({
      id: n.id,
      label: n.label,
      _origLabel: n.label,
      _type: n.type,
      _props: n.properties || {},
      _clusterId: clusterId,
      _clusterCx: center ? center.x : 0,
      _clusterCy: center ? center.y : 0,
      _clusterCz: center ? center.z : 0,
      x: n.type === 'project' ? 0 : (center ? center.x + offset.x : offset.x),
      y: n.type === 'project' ? 0 : (center ? center.y + offset.y : offset.y),
      z: n.type === 'project' ? 0 : (center ? center.z + offset.z : offset.z)
    });
  }

  var edges3d = [];
  for (var j = 0; j < graph.edges.length; j++) {
    var e = graph.edges[j];
    var fromNode = nodeById[e.from];
    var toNode = nodeById[e.to];
    var fromClusterId = fromNode ? resolveClusterId(fromNode) : null;
    var toClusterId = toNode ? resolveClusterId(toNode) : null;
    var isProjectEdge = !!(
      e.label === 'CONTAINS' &&
      ((fromNode && fromNode.type === 'project') || (toNode && toNode.type === 'project'))
    );
    var isCrossCluster = !!(fromClusterId && toClusterId && fromClusterId !== toClusterId);
    edges3d.push({
      from: e.from,
      to: e.to,
      _label: e.label,
      _props: e.properties || {},
      width: 1,
      _projectEdgeHidden: isProjectEdge,
      _crossCluster: isCrossCluster,
      _linkStrengthFactor: isProjectEdge ? 0.003 : (isCrossCluster ? 0.045 : 1),
      _linkDistanceFactor: isProjectEdge ? 2.8 : (isCrossCluster ? 1.7 : 1)
    });
  }

  render3DGraph(container, nodes3d, edges3d);
  codeIntelNetwork = network;
  if (codeIntelBridgeFocusNodeId && codeIntelNetwork && typeof codeIntelNetwork.focus === 'function') {
    try {
      codeIntelNetwork.focus(codeIntelBridgeFocusNodeId, {
        scale: 1.15,
        animation: { duration: 700, easingFunction: 'easeInOutQuad' }
      });
    } catch (e) {}
  }
}

function renderCodeIntelStatus(status) {
  var cardsEl = document.getElementById('codeIntelStatusCards');
  var warningsEl = document.getElementById('codeIntelWarnings');
  if (!cardsEl || !warningsEl || !status) return;

  cardsEl.innerHTML =
    statCard('📁', status.stats ? (status.stats.fileCount || 0) : 0, '代码文件', status.indexStatus || '-', 'blue') +
    statCard('🔣', status.stats ? (status.stats.symbolCount || 0) : 0, '符号', status.available ? '可用' : '不可用', 'green') +
    statCard('🧩', status.stats ? (status.stats.communityCount || 0) : 0, 'Communities', status.mode || '-', 'purple') +
    statCard('🔄', status.stats ? (status.stats.processCount || 0) : 0, 'Processes', status.source || '-', 'amber');

  var warningList = status.warnings || [];
  var repoText = '<div><strong>repoPath:</strong> ' + escHtml(status.repoPath || '-') + '</div>';
  if (!warningList.length) {
    warningsEl.innerHTML = repoText + '<div style="margin-top:8px;color:#86efac;">当前已启用内嵌源码扫描模式。</div>';
    return;
  }

  var html = repoText + '<div style="margin-top:8px;">';
  for (var i = 0; i < warningList.length; i++) {
    html += '<div style="margin-bottom:6px;">• ' + escHtml(String(warningList[i])) + '</div>';
  }
  html += '</div>';
  warningsEl.innerHTML = html;
}

function codeIntelMapHash(input, salt) {
  var str = String(input || '') + '::' + String(salt || '');
  var hash = 2166136261;
  for (var i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function codeIntelMapUnit(input, salt) {
  return codeIntelMapHash(input, salt) / 4294967295;
}

function codeIntelBaseName(filePath) {
  var parts = String(filePath || '').split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(filePath || '');
}

function codeIntelShortPath(filePath) {
  var parts = String(filePath || '').split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return parts.join('/');
  return parts.slice(parts.length - 2).join('/');
}

function codeIntelFamilyKeyFromPath(filePath) {
  var parts = String(filePath || '').split(/[\\/]/).filter(Boolean);
  if (!parts.length) return '__root__';
  var head = parts[0];
  if ((head === 'extensions' || head === 'apps' || head === 'packages' || head === 'crates') && parts.length > 1) {
    return head + '/' + parts[1];
  }
  return head;
}

function buildCodeIntelMapLayout(graph) {
  if (!graph || !graph.nodes || !graph.edges) return { nodes: [], edges: [], initialScale: 0.6 };

  var nodeById = {};
  for (var i = 0; i < graph.nodes.length; i++) nodeById[graph.nodes[i].id] = graph.nodes[i];

  var fileToCommunity = {};
  var communityFamilyCounts = {};
  for (var e0 = 0; e0 < graph.edges.length; e0++) {
    var edge0 = graph.edges[e0];
    if (edge0.label === 'MEMBER_OF' && String(edge0.to || '').indexOf('community:') === 0) {
      fileToCommunity[edge0.from] = edge0.to;
    }
  }

  for (var fileId in fileToCommunity) {
    var fileNode = nodeById[fileId];
    if (!fileNode || !fileNode.properties || !fileNode.properties.filePath) continue;
    var communityId = fileToCommunity[fileId];
    var familyKey = codeIntelFamilyKeyFromPath(String(fileNode.properties.filePath || ''));
    if (!communityFamilyCounts[communityId]) communityFamilyCounts[communityId] = {};
    communityFamilyCounts[communityId][familyKey] = (communityFamilyCounts[communityId][familyKey] || 0) + 1;
  }

  function dominantFamilyForCommunity(communityId) {
    var counts = communityFamilyCounts[communityId];
    if (!counts) return '__root__';
    var bestId = '__root__';
    var bestCount = -1;
    for (var familyId in counts) {
      if (counts[familyId] > bestCount) {
        bestCount = counts[familyId];
        bestId = familyId;
      }
    }
    return bestId;
  }

  function resolveClusterId(node) {
    if (!node) return null;
    if (node.type === 'community') return node.id;
    if (node.type === 'file') return fileToCommunity[node.id] || null;
    if (String(node.id || '').indexOf('module-overlay:') === 0) {
      var links = node.properties && node.properties.communityLinks;
      if (links && links.length) return String(links[0].communityId || '') || null;
    }
    return null;
  }

  function resolveFamilyId(node, clusterId) {
    if (!node) return '__root__';
    if (node.type === 'file' && node.properties && node.properties.filePath) {
      return codeIntelFamilyKeyFromPath(String(node.properties.filePath || ''));
    }
    if (clusterId && clusterId !== '__misc__') return dominantFamilyForCommunity(clusterId);
    return '__root__';
  }

  var keptNodes = [];
  var keptNodeIds = {};
  var basenameCounts = {};
  for (var n0 = 0; n0 < graph.nodes.length; n0++) {
    var rawNode = graph.nodes[n0];
    if (
      rawNode.type !== 'community' &&
      rawNode.type !== 'file' &&
      String(rawNode.id || '').indexOf('module-overlay:') !== 0
    ) continue;
    var nextNode = {
      id: rawNode.id,
      label: rawNode.label,
      type: rawNode.type,
      properties: rawNode.properties || {}
    };
    if (nextNode.type === 'file') {
      var filePath0 = String(nextNode.properties.filePath || nextNode.label || nextNode.id);
      var baseName0 = codeIntelBaseName(filePath0);
      basenameCounts[baseName0] = (basenameCounts[baseName0] || 0) + 1;
    }
    nextNode._clusterId = resolveClusterId(nextNode) || '__misc__';
    nextNode._familyId = resolveFamilyId(nextNode, nextNode._clusterId);
    keptNodes.push(nextNode);
    keptNodeIds[nextNode.id] = true;
  }

  var keptEdges = [];
  for (var j0 = 0; j0 < graph.edges.length; j0++) {
    var edge = graph.edges[j0];
    if (!keptNodeIds[edge.from] || !keptNodeIds[edge.to]) continue;
    if (edge.label === 'CONTAINS') continue;
    if (
      edge.label !== 'IMPORTS' &&
      edge.label !== 'MEMBER_OF' &&
      edge.label !== 'BRIDGE_LINK' &&
      edge.label !== 'BRIDGE_RECOMMEND'
    ) continue;
    keptEdges.push({
      from: edge.from,
      to: edge.to,
      label: edge.label,
      properties: edge.properties || {}
    });
  }

  var familyOrder = [];
  var familySeen = {};
  var familyToClusters = {};
  for (var c = 0; c < keptNodes.length; c++) {
    var familyId0 = keptNodes[c]._familyId || '__root__';
    var clusterId0 = keptNodes[c]._clusterId || '__misc__';
    if (!familySeen[familyId0]) {
      familySeen[familyId0] = true;
      familyOrder.push(familyId0);
    }
    if (!familyToClusters[familyId0]) familyToClusters[familyId0] = [];
    if (clusterId0 !== '__misc__' && familyToClusters[familyId0].indexOf(clusterId0) === -1) {
      familyToClusters[familyId0].push(clusterId0);
    }
  }
  familyOrder.sort();

  var familyCenters = {};
  var familyColumns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, familyOrder.length))));
  var familyRows = Math.max(1, Math.ceil(familyOrder.length / familyColumns));
  for (var f = 0; f < familyOrder.length; f++) {
    var familyCol = f % familyColumns;
    var familyRow = Math.floor(f / familyColumns);
    familyCenters[familyOrder[f]] = {
      x: (familyCol - (familyColumns - 1) / 2) * 1380,
      y: (familyRow - (familyRows - 1) / 2) * 980
    };
  }

  var clusterCenters = {};
  for (var f0 = 0; f0 < familyOrder.length; f0++) {
    var familyKey = familyOrder[f0];
    var familyCenter = familyCenters[familyKey] || { x: 0, y: 0 };
    var clusters = (familyToClusters[familyKey] || []).slice().sort();
    if (!clusters.length) continue;
    var localCols = Math.max(1, Math.ceil(Math.sqrt(clusters.length)));
    var localRows = Math.max(1, Math.ceil(clusters.length / localCols));
    for (var k = 0; k < clusters.length; k++) {
      var localCol = k % localCols;
      var localRow = Math.floor(k / localCols);
      clusterCenters[clusters[k]] = {
        x: familyCenter.x + (localCol - (localCols - 1) / 2) * 360,
        y: familyCenter.y + (localRow - (localRows - 1) / 2) * 240
      };
    }
  }

  var buckets = {};
  function ensureBucket(key, familyId) {
    if (!buckets[key]) buckets[key] = { familyId: familyId || '__root__', community: [], file: [], overlay: [] };
    return buckets[key];
  }

  for (var n1 = 0; n1 < keptNodes.length; n1++) {
    var node = keptNodes[n1];
    var bucket = ensureBucket(node._clusterId, node._familyId);
    if (node.type === 'community') bucket.community.push(node);
    else if (node.type === 'file') bucket.file.push(node);
    else if (String(node.id || '').indexOf('module-overlay:') === 0) bucket.overlay.push(node);
  }

  function placeFileGrid(nodes, center) {
    var cols = Math.max(2, Math.ceil(Math.sqrt(Math.max(1, nodes.length) * 1.35)));
    for (var i2 = 0; i2 < nodes.length; i2++) {
      var col = i2 % cols;
      var row = Math.floor(i2 / cols);
      nodes[i2].x = center.x + (col - (cols - 1) / 2) * 122 + (codeIntelMapUnit(nodes[i2].id, 'x') - 0.5) * 14;
      nodes[i2].y = center.y + 48 + row * 32 + (codeIntelMapUnit(nodes[i2].id, 'y') - 0.5) * 10;
    }
  }

  var layoutNodes = [];
  for (var clusterKey in buckets) {
    var center = clusterCenters[clusterKey] || familyCenters[buckets[clusterKey].familyId] || { x: 0, y: 0 };
    var parts = buckets[clusterKey];
    parts.community.sort(function(a, b) { return String(a.label || a.id).localeCompare(String(b.label || b.id)); });
    parts.file.sort(function(a, b) { return String((a.properties && a.properties.filePath) || a.label || a.id).localeCompare(String((b.properties && b.properties.filePath) || b.label || b.id)); });
    parts.overlay.sort(function(a, b) { return String(a.label || a.id).localeCompare(String(b.label || b.id)); });

    for (var i3 = 0; i3 < parts.community.length; i3++) {
      parts.community[i3].x = center.x;
      parts.community[i3].y = center.y - i3 * 42;
    }
    for (var o = 0; o < parts.overlay.length; o++) {
      parts.overlay[o].x = center.x + 180 + o * 44;
      parts.overlay[o].y = center.y - 18;
    }
    placeFileGrid(parts.file, center);

    Array.prototype.push.apply(layoutNodes, parts.community);
    Array.prototype.push.apply(layoutNodes, parts.file);
    Array.prototype.push.apply(layoutNodes, parts.overlay);
  }

  for (var n2 = 0; n2 < layoutNodes.length; n2++) {
    var mappedNode = layoutNodes[n2];
    if (mappedNode.type === 'file') {
      var filePath = String(mappedNode.properties.filePath || mappedNode.label || mappedNode.id);
      var baseName = codeIntelBaseName(filePath);
      mappedNode._mapLabel = basenameCounts[baseName] > 1 ? codeIntelShortPath(filePath) : baseName;
    } else {
      mappedNode._mapLabel = mappedNode.label;
    }
  }

  var initialScale = familyOrder.length > 12 ? 0.34 : (familyOrder.length > 8 ? 0.42 : (familyOrder.length > 4 ? 0.52 : 0.68));
  return { nodes: layoutNodes, edges: keptEdges, initialScale: initialScale };
}

function buildCodeIntelAtlasLayout(graph) {
  var mapLayout = buildCodeIntelMapLayout(graph);
  var nodes = mapLayout.nodes || [];
  var edges = mapLayout.edges || [];
  var nodeById = {};
  var districtById = {};
  var blocks = [];
  var fileLabels = [];
  var communityLabels = [];
  var overlayLabels = [];
  var importEdges = [];
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  var palette = [
    [99, 102, 241],
    [16, 185, 129],
    [245, 158, 11],
    [168, 85, 247],
    [59, 130, 246],
    [236, 72, 153]
  ];

  function expandBounds(x, y) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  function polygonRect(cx, cy, width, height) {
    var hw = width / 2;
    var hh = height / 2;
    return [
      [cx - hw, cy - hh],
      [cx + hw, cy - hh],
      [cx + hw, cy + hh],
      [cx - hw, cy + hh]
    ];
  }

  function rgba(rgb, alpha) {
    return [rgb[0], rgb[1], rgb[2], Math.round(alpha * 255)];
  }

  for (var i = 0; i < nodes.length; i++) nodeById[nodes[i].id] = nodes[i];

  var filesByDistrictAndFolder = {};
  for (var j = 0; j < nodes.length; j++) {
    var node = nodes[j];
    var districtId = String(node._clusterId || '__misc__');
    if (!districtById[districtId]) {
      var color = palette[codeIntelMapHash(districtId, 'district') % palette.length];
      districtById[districtId] = {
        id: districtId,
        color: color,
        files: [],
        communities: [],
        overlays: [],
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
      };
    }
    var district = districtById[districtId];
    if (node.type === 'file') {
      district.files.push(node);
      var filePath = String((node.properties && node.properties.filePath) || '');
      var folderKey = filePath.split(/[\\/]/).slice(0, -1).join('/') || '__root__';
      var bucketKey = districtId + '::' + folderKey;
      if (!filesByDistrictAndFolder[bucketKey]) filesByDistrictAndFolder[bucketKey] = [];
      filesByDistrictAndFolder[bucketKey].push(node);
    } else if (node.type === 'community') {
      district.communities.push(node);
    } else if (String(node.id || '').indexOf('module-overlay:') === 0) {
      district.overlays.push(node);
    }
    if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
      if (node.x < district.minX) district.minX = node.x;
      if (node.y < district.minY) district.minY = node.y;
      if (node.x > district.maxX) district.maxX = node.x;
      if (node.y > district.maxY) district.maxY = node.y;
      expandBounds(node.x, node.y);
    }
  }

  var districts = [];
  for (var districtId in districtById) {
    var district = districtById[districtId];
    if (!isFinite(district.minX)) continue;
    var width = Math.max(260, district.maxX - district.minX + 180);
    var height = Math.max(180, district.maxY - district.minY + 140);
    var cx = (district.minX + district.maxX) / 2;
    var cy = (district.minY + district.maxY) / 2 + 12;
    district.centerX = cx;
    district.centerY = cy;
    district.polygon = polygonRect(cx, cy, width, height);
    districts.push({
      id: district.id,
      polygon: district.polygon,
      fillColor: rgba(district.color, 0.12),
      lineColor: rgba(district.color, 0.46)
    });
    communityLabels.push({
      id: district.id,
      nodeId: district.communities.length ? district.communities[0].id : district.id,
      text: district.communities.length ? String(district.communities[0].label || district.id) : district.id,
      position: [cx, cy - height / 2 + 26],
      size: 16,
      color: [226, 232, 240, 255]
    });
    expandBounds(cx - width / 2, cy - height / 2);
    expandBounds(cx + width / 2, cy + height / 2);
  }

  for (var folderBucket in filesByDistrictAndFolder) {
    var files = filesByDistrictAndFolder[folderBucket];
    if (!files || !files.length) continue;
    var blockMinX = Infinity, blockMinY = Infinity, blockMaxX = -Infinity, blockMaxY = -Infinity;
    for (var f = 0; f < files.length; f++) {
      if (files[f].x < blockMinX) blockMinX = files[f].x;
      if (files[f].y < blockMinY) blockMinY = files[f].y;
      if (files[f].x > blockMaxX) blockMaxX = files[f].x;
      if (files[f].y > blockMaxY) blockMaxY = files[f].y;
    }
    var districtId0 = folderBucket.split('::')[0];
    var district0 = districtById[districtId0];
    var folderPath0 = folderBucket.slice(districtId0.length + 2);
    if (!district0) continue;
    blocks.push({
      id: folderBucket,
      polygon: polygonRect((blockMinX + blockMaxX) / 2, (blockMinY + blockMaxY) / 2, Math.max(110, blockMaxX - blockMinX + 44), Math.max(54, blockMaxY - blockMinY + 20)),
      fillColor: rgba(district0.color, 0.08),
      lineColor: rgba(district0.color, 0.2),
      label: codeIntelBaseName(folderPath0 || '__root__')
    });
  }

  for (var n = 0; n < nodes.length; n++) {
    var item = nodes[n];
    if (item.type === 'file') {
      fileLabels.push({
        id: item.id,
        nodeId: item.id,
        text: String(item._mapLabel || item.label || item.id),
        position: [item.x || 0, item.y || 0],
        size: 14,
        color: [191, 219, 254, 255]
      });
    } else if (String(item.id || '').indexOf('module-overlay:') === 0) {
      overlayLabels.push({
        id: item.id,
        nodeId: item.id,
        text: String(item.label || item.id),
        position: [item.x || 0, item.y || 0],
        size: 12,
        color: [253, 186, 116, 255]
      });
    }
  }

  for (var e = 0; e < edges.length; e++) {
    var edge = edges[e];
    if (edge.label !== 'IMPORTS' && edge.label !== 'BRIDGE_LINK' && edge.label !== 'BRIDGE_RECOMMEND') continue;
    var fromNode = nodeById[edge.from];
    var toNode = nodeById[edge.to];
    if (!fromNode || !toNode) continue;
    importEdges.push({
      id: 'atlas-edge-' + e,
      from: edge.from,
      to: edge.to,
      sourcePosition: [fromNode.x || 0, fromNode.y || 0],
      targetPosition: [toNode.x || 0, toNode.y || 0],
      color: edge.label === 'BRIDGE_LINK' ? [251, 146, 60, 220] : (edge.label === 'BRIDGE_RECOMMEND' ? [250, 204, 21, 200] : [96, 165, 250, 190]),
      width: edge.label === 'BRIDGE_LINK' ? 2.5 : 1.4
    });
  }

  if (!isFinite(minX)) {
    minX = -200; minY = -120; maxX = 200; maxY = 120;
  }

  return {
    mapLayout: mapLayout,
    districts: districts,
    blocks: blocks,
    fileLabels: fileLabels,
    communityLabels: communityLabels,
    overlayLabels: overlayLabels,
    edges: importEdges,
    nodeById: nodeById,
    bounds: { minX: minX - 180, minY: minY - 140, maxX: maxX + 180, maxY: maxY + 180 }
  };
}

function computeCodeIntelAtlasViewState(bounds, width, height) {
  var spanX = Math.max(1, (bounds.maxX || 0) - (bounds.minX || 0));
  var spanY = Math.max(1, (bounds.maxY || 0) - (bounds.minY || 0));
  var usableW = Math.max(320, Number(width || 0));
  var usableH = Math.max(240, Number(height || 0));
  var scaleX = usableW / spanX;
  var scaleY = usableH / spanY;
  var zoom = Math.log(Math.max(0.0001, Math.min(scaleX, scaleY))) / Math.LN2;
  return {
    target: [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0],
    zoom: Math.max(-4.5, Math.min(1.2, zoom - 0.18))
  };
}

function renderCodeIntelAtlasLayers() {
  if (!codeIntelAtlasDeck || !codeIntelAtlasState || typeof deck === 'undefined') return;
  var hovered = codeIntelAtlasHoverNodeId ? String(codeIntelAtlasHoverNodeId) : '';
  var selected = codeIntelSelectedNodeId ? String(codeIntelSelectedNodeId) : '';
  var activeNodeId = selected || hovered;
  var activeEdges = [];
  for (var i = 0; i < codeIntelAtlasState.edges.length; i++) {
    var edge = codeIntelAtlasState.edges[i];
    if (activeNodeId && (edge.from === activeNodeId || edge.to === activeNodeId)) activeEdges.push(edge);
  }
  var highlight = [];
  if (activeNodeId && codeIntelAtlasState.nodeById[activeNodeId]) {
    var n = codeIntelAtlasState.nodeById[activeNodeId];
    highlight.push({
      position: [n.x || 0, n.y || 0],
      radius: n.type === 'community' ? 42 : 26
    });
  }

  codeIntelAtlasDeck.setProps({
    layers: [
      new deck.PolygonLayer({
        id: 'code-intel-atlas-districts',
        data: codeIntelAtlasState.districts,
        getPolygon: function(d) { return d.polygon; },
        getFillColor: function(d) { return d.fillColor; },
        getLineColor: function(d) { return d.lineColor; },
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        stroked: true,
        filled: true,
        pickable: false
      }),
      new deck.PolygonLayer({
        id: 'code-intel-atlas-blocks',
        data: codeIntelAtlasState.blocks,
        getPolygon: function(d) { return d.polygon; },
        getFillColor: function(d) { return d.fillColor; },
        getLineColor: function(d) { return d.lineColor; },
        getLineWidth: 1,
        lineWidthUnits: 'pixels',
        stroked: true,
        filled: true,
        pickable: false
      }),
      new deck.LineLayer({
        id: 'code-intel-atlas-edges',
        data: activeEdges,
        getSourcePosition: function(d) { return d.sourcePosition; },
        getTargetPosition: function(d) { return d.targetPosition; },
        getColor: function(d) { return d.color; },
        getWidth: function(d) { return d.width; },
        widthUnits: 'pixels',
        pickable: false
      }),
      new deck.ScatterplotLayer({
        id: 'code-intel-atlas-highlight',
        data: highlight,
        getPosition: function(d) { return d.position; },
        getRadius: function(d) { return d.radius; },
        radiusUnits: 'pixels',
        getFillColor: [99, 102, 241, 45],
        getLineColor: [165, 180, 252, 180],
        lineWidthUnits: 'pixels',
        getLineWidth: 2,
        stroked: true,
        filled: true,
        pickable: false
      }),
      new deck.TextLayer({
        id: 'code-intel-atlas-community-labels',
        data: codeIntelAtlasState.communityLabels,
        getText: function(d) { return d.text; },
        getPosition: function(d) { return d.position; },
        getColor: function(d) { return d.color; },
        getSize: function(d) { return d.size; },
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'Inter, Segoe UI, sans-serif',
        background: true,
        getBackgroundColor: [15, 23, 42, 180],
        getBorderColor: [99, 102, 241, 120],
        getBorderWidth: 1,
        billboard: false,
        pickable: true,
        onClick: function(info) { if (info && info.object) selectCodeIntelNode(info.object.nodeId); }
      }),
      new deck.TextLayer({
        id: 'code-intel-atlas-file-labels',
        data: codeIntelAtlasState.fileLabels,
        getText: function(d) { return d.text; },
        getPosition: function(d) { return d.position; },
        getColor: function(d) { return d.color; },
        getSize: function(d) { return d.size; },
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'center',
        fontFamily: 'Inter, Segoe UI, sans-serif',
        background: true,
        getBackgroundColor: [10, 14, 26, 150],
        billboard: false,
        pickable: true,
        onHover: function(info) {
          codeIntelAtlasHoverNodeId = info && info.object ? info.object.nodeId : null;
          renderCodeIntelAtlasLayers();
        },
        onClick: function(info) { if (info && info.object) selectCodeIntelNode(info.object.nodeId); }
      }),
      new deck.TextLayer({
        id: 'code-intel-atlas-overlay-labels',
        data: codeIntelAtlasState.overlayLabels,
        getText: function(d) { return d.text; },
        getPosition: function(d) { return d.position; },
        getColor: function(d) { return d.color; },
        getSize: function(d) { return d.size; },
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        fontFamily: 'Inter, Segoe UI, sans-serif',
        background: true,
        getBackgroundColor: [124, 45, 18, 110],
        billboard: false,
        pickable: true,
        onClick: function(info) { if (info && info.object) selectCodeIntelNode(info.object.nodeId); }
      })
    ]
  });
}

function focusCodeIntelAtlasNode(nodeId) {
  if (!codeIntelAtlasDeck || !codeIntelAtlasState || !nodeId) return;
  var targetNode = codeIntelAtlasState.nodeById[String(nodeId)];
  if (!targetNode) return;
  codeIntelAtlasViewState = Object.assign({}, codeIntelAtlasViewState || codeIntelAtlasState.initialViewState, {
    target: [targetNode.x || 0, targetNode.y || 0, 0],
    zoom: Math.min(2.2, Math.max((codeIntelAtlasViewState && codeIntelAtlasViewState.zoom) || 0, 0.5)),
    transitionDuration: 350
  });
  codeIntelAtlasDeck.setProps({ viewState: codeIntelAtlasViewState });
}

function updateCodeIntelAtlasSelection() {
  renderCodeIntelAtlasLayers();
}

function destroyCodeIntelAtlas() {
  if (codeIntelAtlasDeck && typeof codeIntelAtlasDeck.finalize === 'function') {
    try { codeIntelAtlasDeck.finalize(); } catch (e) {}
  }
  codeIntelAtlasDeck = null;
  codeIntelAtlasState = null;
  codeIntelAtlasViewState = null;
  codeIntelAtlasHoverNodeId = null;
}

function renderCodeIntelAtlasGraph(graph, container) {
  if (typeof deck === 'undefined' || !deck.Deck) return false;
  destroyCodeIntelAtlas();
  container.innerHTML = '';
  var atlasState = buildCodeIntelAtlasLayout(graph);
  atlasState.initialViewState = computeCodeIntelAtlasViewState(atlasState.bounds, container.clientWidth || 1200, container.clientHeight || 700);
  codeIntelAtlasState = atlasState;
  codeIntelAtlasViewState = Object.assign({}, atlasState.initialViewState);
  codeIntelAtlasDeck = new deck.Deck({
    parent: container,
    views: [new deck.OrthographicView({ id: 'code-intel-atlas-view' })],
    initialViewState: codeIntelAtlasViewState,
    controller: true,
    getCursor: function(state) { return state && state.isDragging ? 'grabbing' : 'grab'; },
    parameters: { clearColor: [10 / 255, 14 / 255, 26 / 255, 1] },
    onViewStateChange: function(params) {
      codeIntelAtlasViewState = params.viewState;
      if (codeIntelAtlasDeck) codeIntelAtlasDeck.setProps({ viewState: codeIntelAtlasViewState });
    },
    onClick: function(info) {
      if (!info || !info.object) {
        codeIntelSelectedNodeId = null;
        renderCodeIntelSelection(null, codeIntelRenderedGraphData);
        renderCodeIntelAtlasLayers();
      }
    },
    getTooltip: function(info) {
      if (!info || !info.object) return null;
      return { text: info.object.text || info.object.id || '' };
    }
  });
  renderCodeIntelAtlasLayers();
  return true;
}

function buildCodeIntelDegreeMap(graph) {
  var degreeMap = {};
  if (!graph || !graph.edges) return degreeMap;
  for (var i = 0; i < graph.edges.length; i++) {
    var edge = graph.edges[i];
    degreeMap[edge.from] = (degreeMap[edge.from] || 0) + 1;
    degreeMap[edge.to] = (degreeMap[edge.to] || 0) + 1;
  }
  return degreeMap;
}

function codeIntelNodeStyle(node, degree) {
  var size = Math.max(12, Math.min(28, 12 + Math.sqrt(Math.max(0, degree || 0)) * 2.4));
  if (node.type === 'community') {
    return {
      shape: 'hexagon',
      size: Math.max(size, 22),
      color: { background: '#4f46e5', border: '#a5b4fc', highlight: { background: '#4f46e5', border: '#ffffff' } },
      font: { color: '#eef2ff', size: 14, face: 'Inter, Segoe UI, sans-serif' },
      borderWidth: 2
    };
  }
  if (node.type === 'folder') {
    return {
      shape: 'diamond',
      size: Math.max(size - 1, 16),
      color: { background: '#0f766e', border: '#5eead4', highlight: { background: '#0f766e', border: '#ffffff' } },
      font: { color: '#ccfbf1', size: 12, face: 'Inter, Segoe UI, sans-serif' },
      borderWidth: 2
    };
  }
  if (node.type === 'process') {
    return {
      shape: 'star',
      size: Math.max(size, 18),
      color: { background: '#7c3aed', border: '#d8b4fe', highlight: { background: '#7c3aed', border: '#ffffff' } },
      font: { color: '#f5f3ff', size: 13, face: 'Inter, Segoe UI, sans-serif' },
      borderWidth: 2
    };
  }
  if (String(node.id || '').indexOf('module-overlay:') === 0) {
    return {
      shape: 'triangle',
      size: Math.max(size, 18),
      color: { background: '#ea580c', border: '#fdba74', highlight: { background: '#ea580c', border: '#ffffff' } },
      font: { color: '#ffedd5', size: 12, face: 'Inter, Segoe UI, sans-serif' },
      borderWidth: 2
    };
  }
  return {
    shape: 'box',
    size: Math.max(size, 14),
    color: { background: '#1d4ed8', border: '#93c5fd', highlight: { background: '#1d4ed8', border: '#ffffff' } },
    font: { color: '#dbeafe', size: 12, face: 'Inter, Segoe UI, sans-serif' },
    borderWidth: 1.5
  };
}

function codeIntelEdgeStyle(edge) {
  var label = String(edge.label || '');
  var bridgeKind = String((edge.properties && edge.properties.bridgeKind) || '');
  if (label === 'IMPORTS') {
    return { width: 1.6, color: { color: '#4b5563', highlight: '#60a5fa', hover: '#60a5fa' }, dashes: false, arrows: { to: { enabled: true, scaleFactor: 0.45 } }, _highlightColor: '#60a5fa' };
  }
  if (label === 'MEMBER_OF') {
    return { width: 1.2, color: { color: '#4b5563', highlight: '#f59e0b', hover: '#f59e0b' }, dashes: [4, 3], arrows: { to: { enabled: true, scaleFactor: 0.4 } }, _highlightColor: '#f59e0b' };
  }
  if (label === 'STEP_IN_PROCESS') {
    return { width: 1.2, color: { color: '#4b5563', highlight: '#c084fc', hover: '#c084fc' }, dashes: [5, 4], arrows: { to: { enabled: true, scaleFactor: 0.4 } }, _highlightColor: '#c084fc' };
  }
  if (label === 'BRIDGE_LINK') {
    return { width: 2.2, color: { color: '#4b5563', highlight: '#fb923c', hover: '#fb923c' }, dashes: false, arrows: { to: { enabled: true, scaleFactor: 0.5 } }, _highlightColor: '#fb923c' };
  }
  if (label === 'BRIDGE_RECOMMEND') {
    var recommendColor = bridgeKind === 'recommended-process' ? '#38bdf8' : '#facc15';
    return { width: 1.8, color: { color: '#4b5563', highlight: recommendColor, hover: recommendColor }, dashes: [6, 4], arrows: { to: { enabled: true, scaleFactor: 0.45 } }, _highlightColor: recommendColor };
  }
  return { width: 1, color: { color: '#4b5563', highlight: '#9ca3af', hover: '#9ca3af' }, dashes: false, arrows: { to: { enabled: false } }, _highlightColor: '#9ca3af' };
}

function buildCodeIntelPhysicsOptions(nodeCount) {
  if (nodeCount > 2000) {
    return {
      enabled: false,
      stabilization: { enabled: false }
    };
  }
  if (nodeCount > 800) {
    return {
      enabled: true,
      solver: 'forceAtlas2Based',
      forceAtlas2Based: {
        gravitationalConstant: -58,
        centralGravity: 0.03,
        springLength: 125,
        springConstant: 0.055,
        damping: 0.52,
        avoidOverlap: 0.85
      },
      stabilization: { enabled: true, iterations: 80, updateInterval: 20 }
    };
  }
  if (nodeCount > 200) {
    return {
      enabled: true,
      solver: 'forceAtlas2Based',
      forceAtlas2Based: {
        gravitationalConstant: -74,
        centralGravity: 0.018,
        springLength: 145,
        springConstant: 0.05,
        damping: 0.42,
        avoidOverlap: 0.8
      },
      stabilization: { enabled: true, iterations: 120, updateInterval: 25 }
    };
  }
  return {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: {
      gravitationalConstant: -82,
      centralGravity: 0.015,
      springLength: 150,
      springConstant: 0.05,
      damping: 0.4,
      avoidOverlap: 0.8
    },
    stabilization: { enabled: true, iterations: 150, updateInterval: 25 }
  };
}

function updateCodeIntelMapEdgeVisibility(selectedNodeId) {
  if (!codeIntelMapEdgesDataSet || !codeIntelMapEdges || !codeIntelMapEdges.length) return;
  var selected = selectedNodeId ? String(selectedNodeId) : '';
  var updates = [];
  for (var i = 0; i < codeIntelMapEdges.length; i++) {
    var edge = codeIntelMapEdges[i];
    var active = !!selected && (edge.from === selected || edge.to === selected);
    updates.push({
      id: edge.id,
      hidden: false,
      width: selected ? (active ? edge._activeWidth : edge._baseWidth) : edge._baseWidth,
      color: selected
        ? { color: active ? edge._highlightColor : 'rgba(75,85,99,0.16)', highlight: edge._highlightColor, hover: edge._highlightColor }
        : edge._baseColor,
      dashes: edge._dashed
    });
  }
  codeIntelMapEdgesDataSet.update(updates);
}

function renderCodeIntelGraph(graph) {
  var container = document.getElementById('codeIntelGraph');
  var meta = document.getElementById('codeIntelGraphMeta');
  if (!container || !meta) return;

  if (!graph || !graph.nodes || !graph.edges) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6b7280;">暂无代码图数据</div>';
    meta.textContent = '无数据';
    codeIntelRenderedGraphData = { nodes: [], edges: [] };
    renderCodeIntelSelection(codeIntelSelectedNodeId, codeIntelRenderedGraphData);
    setCodeIntelBottomSheetExpanded(codeIntelBottomSheetExpanded);
    return;
  }

  var overlay = buildCodeIntelBridgeOverlay(graph);
  var view = prepareCodeIntelGraphView(overlay.graph);
  var renderGraph = view.graph;
  codeIntelRenderedGraphData = renderGraph;
  meta.textContent = view.metaText + (overlay.overlayMeta || '');
  renderCodeIntelSelection(codeIntelSelectedNodeId, renderGraph);
  setCodeIntelBottomSheetExpanded(codeIntelBottomSheetExpanded);

  if (codeIntelNetwork) {
    codeIntelNetwork.destroy();
    codeIntelNetwork = null;
  }
  destroyCodeIntelAtlas();
  codeIntelMapNodesDataSet = null;
  codeIntelMapEdgesDataSet = null;
  codeIntelMapEdges = [];

  if (typeof vis === 'undefined' || !vis.Network) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;">正在加载 vis-network...</div>';
    ensureCodeIntelVisLoaded(function() { renderCodeIntelGraph(renderGraph); });
    return;
  }

  var degreeMap = buildCodeIntelDegreeMap(renderGraph);
  var nodeCount = renderGraph.nodes.length;
  var isLargeGraph = nodeCount > 300;
  var isVeryLargeGraph = nodeCount > 800;
  var initLabelCompact = nodeCount > 180;
  var nodes = [];
  for (var i = 0; i < renderGraph.nodes.length; i++) {
    var n = renderGraph.nodes[i];
    var s = codeIntelNodeStyle(n, degreeMap[n.id] || 0);
    var origFontSize = (s.font && s.font.size) || 12;
    var nodeFont = s.font;
    if (initLabelCompact && (n.type === 'file' || n.type === 'folder')) {
      nodeFont = { size: 0, color: (s.font && s.font.color) || '#dbeafe' };
    }
    nodes.push({
      id: n.id,
      label: n.label,
      title: escHtml(n.label + ' (' + n.type + ')'),
      shape: s.shape,
      color: s.color,
      font: nodeFont,
      size: s.size,
      borderWidth: s.borderWidth,
      _type: n.type,
      _origFontSize: origFontSize,
      _origLabel: n.label,
      _props: n.properties || {}
    });
  }

  var edges = [];
  for (var j = 0; j < renderGraph.edges.length; j++) {
    var e = renderGraph.edges[j];
    var es = codeIntelEdgeStyle(e);
    edges.push({
      id: 'code-intel-edge-' + j,
      from: e.from,
      to: e.to,
      arrows: es.arrows,
      width: es.width,
      _baseWidth: es.width,
      _activeWidth: Math.max(es.width + 0.8, es.width * 1.35),
      _dashed: es.dashes,
      _baseColor: es.color,
      _highlightColor: es._highlightColor || '#9ca3af',
      color: es.color,
      dashes: es.dashes,
      title: e.label,
      hidden: false
    });
  }

  codeIntelMapNodesDataSet = new vis.DataSet(nodes);
  codeIntelMapEdgesDataSet = new vis.DataSet(edges);
  codeIntelMapEdges = edges.slice();
  codeIntelNetwork = new vis.Network(
    container,
    { nodes: codeIntelMapNodesDataSet, edges: codeIntelMapEdgesDataSet },
    {
      nodes: {
        borderWidth: 2,
        chosen: false,
        shadow: isLargeGraph ? false : { enabled: true, color: 'rgba(0,0,0,0.3)', size: 5, x: 0, y: 2 }
      },
      edges: {
        chosen: false,
        selectionWidth: 0,
        smooth: isLargeGraph ? false : { enabled: true, type: 'continuous', roundness: 0.45 },
        shadow: false
      },
      physics: buildCodeIntelPhysicsOptions(nodeCount),
      interaction: {
        hover: !isVeryLargeGraph,
        tooltipDelay: 200,
        zoomView: true,
        dragView: true,
        dragNodes: false,
        multiselect: false,
        hideEdgesOnDrag: isLargeGraph,
        hideEdgesOnZoom: isLargeGraph,
        zoomSpeed: isVeryLargeGraph ? 0.8 : 1
      },
      layout: {
        improvedLayout: (nodeCount > 200 && nodeCount <= 800),
        randomSeed: 7
      }
    }
  );

  codeIntelNetwork.on('click', function(params) {
    if (!params || !params.nodes || !params.nodes.length) {
      codeIntelSelectedNodeId = null;
      renderCodeIntelSelection(null, renderGraph);
      updateCodeIntelMapEdgeVisibility(null);
      return;
    }
    var nodeId = String(params.nodes[0] || '');
    codeIntelSelectedNodeId = nodeId;
    renderCodeIntelSelection(nodeId, renderGraph);
    updateCodeIntelMapEdgeVisibility(nodeId);
    if (nodeId.indexOf('module-overlay:') !== 0) return;
    var moduleId = nodeId.slice('module-overlay:'.length);
    var input = document.getElementById('codeIntelBridgeModuleId');
    if (input) input.value = moduleId;
    codeIntelBridgeFocusNodeId = nodeId;
    loadCodeIntelBridgePanel(false);
  });

  codeIntelNetwork.on('stabilizationIterationsDone', function() {
    try { codeIntelNetwork.setOptions({ physics: { enabled: false } }); } catch (e) {}
    try { codeIntelNetwork.fit({ animation: { duration: 700, easingFunction: 'easeInOutQuad' } }); } catch (e) {}
  });

  if (isLargeGraph) {
    var labelHidden = initLabelCompact;
    codeIntelNetwork.on('zoom', function() {
      var scale = codeIntelNetwork.getScale();
      if (scale < 0.55 && !labelHidden) {
        labelHidden = true;
        var shrinkUpdates = [];
        codeIntelMapNodesDataSet.forEach(function(node) {
          if (node._type === 'file' || node._type === 'folder') {
            shrinkUpdates.push({ id: node.id, font: { size: 0, color: (node.font && node.font.color) || '#dbeafe' } });
          }
        });
        if (shrinkUpdates.length) codeIntelMapNodesDataSet.update(shrinkUpdates);
      } else if (scale >= 0.55 && labelHidden) {
        labelHidden = false;
        var expandUpdates = [];
        codeIntelMapNodesDataSet.forEach(function(node) {
          if (node._type === 'file' || node._type === 'folder') {
            expandUpdates.push({ id: node.id, font: { size: node._origFontSize || 12, color: (node.font && node.font.color) || '#dbeafe' } });
          }
        });
        if (expandUpdates.length) codeIntelMapNodesDataSet.update(expandUpdates);
      }
    });
  }

  updateCodeIntelMapEdgeVisibility(codeIntelSelectedNodeId || codeIntelBridgeFocusNodeId);
  if (codeIntelBridgeFocusNodeId && typeof codeIntelNetwork.focus === 'function') {
    try {
      codeIntelNetwork.focus(codeIntelBridgeFocusNodeId, {
        scale: 1.15,
        animation: { duration: 500, easingFunction: 'easeInOutQuad' }
      });
    } catch (e) {}
  }
}

function prepareCodeIntelGraphView(graph) {
  if (!graph || !graph.nodes || !graph.edges) {
    return {
      graph: { nodes: [], edges: [] },
      metaText: '0 节点 / 0 边'
    };
  }

  var keptNodes = [];
  var keptNodeIds = {};
  for (var i = 0; i < graph.nodes.length; i++) {
    var n = graph.nodes[i];
    if (n.type === 'project' || n.type === 'symbol') continue;
    keptNodes.push(n);
    keptNodeIds[n.id] = true;
  }

  var keptEdges = [];
  for (var j = 0; j < graph.edges.length; j++) {
    var e = graph.edges[j];
    if (!keptNodeIds[e.from] || !keptNodeIds[e.to]) continue;
    if (e.label === 'CONTAINS') continue;
    keptEdges.push(e);
  }

  return {
    graph: {
      nodes: keptNodes,
      edges: keptEdges
    },
    metaText: graph.nodes.length + ' 节点 / ' + graph.edges.length + ' 边 (代码关系图: ' + keptNodes.length + ' / ' + keptEdges.length + '，已过滤 project/symbol 与 project contains 噪音)'
  };
}

function renderCodeIntelClusters(clusters) {
  var el = document.getElementById('codeIntelClusters');
  if (!el) return;
  if (!clusters || !clusters.length) {
    el.innerHTML = '<div style="color:#6b7280;">暂无 community 数据</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < clusters.length; i++) {
    var c = clusters[i];
    var clusterId = String(c.id || '').replace(/'/g, "\\'");
    html += '<div class="code-intel-list-item" onclick="selectCodeIntelNode(\\x27' + clusterId + '\\x27)">';
    html += '<div class="code-intel-list-item-title">' + escHtml(c.label || c.id) + '</div>';
    html += '<div class="code-intel-list-item-sub">文件 ' + (c.fileCount || 0) + ' / 符号 ' + (c.symbolCount || 0) + '</div>';
    if (c.members && c.members.length) {
      html += '<div class="code-intel-list-item-meta">' + escHtml(c.members.slice(0, 4).join(', ')) + (c.members.length > 4 ? ' ...' : '') + '</div>';
    }
    html += '</div>';
  }
  el.innerHTML = html;
}

function renderCodeIntelProcesses(processes) {
  var el = document.getElementById('codeIntelProcesses');
  if (!el) return;
  if (!processes || !processes.length) {
    el.innerHTML = '<div style="color:#6b7280;">暂无 process 数据</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < processes.length; i++) {
    var p = processes[i];
    var processId = String(p.id || '').replace(/'/g, "\\'");
    html += '<div class="code-intel-list-item" onclick="selectCodeIntelNode(\\x27' + processId + '\\x27)">';
    html += '<div class="code-intel-list-item-title">' + escHtml(p.label || p.id) + '</div>';
    html += '<div class="code-intel-list-item-sub">stepCount: ' + (p.stepCount || 0) + '</div>';
    if (p.steps && p.steps.length) {
      html += '<div class="code-intel-list-item-meta">' + escHtml(p.steps.slice(0, 4).join(' -> ')) + (p.steps.length > 4 ? ' ...' : '') + '</div>';
    }
    html += '</div>';
  }
  el.innerHTML = html;
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
