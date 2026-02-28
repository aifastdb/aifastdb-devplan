

// ========== Sidebar ==========
function toggleSidebar() {
  var sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('expanded');
  var isExpanded = sidebar.classList.contains('expanded');
  // 记住偏好
  try { localStorage.setItem('devplan_sidebar_expanded', isExpanded ? '1' : '0'); } catch(e) {}
  // 同步更新左侧弹层位置
  updateStatsModalPosition();
  // 通知 vis-network 重新适配尺寸
  setTimeout(function() { if (network) network.redraw(); }, 300);
}

/** 根据侧边栏状态更新左侧弹层位置 */
function updateStatsModalPosition() {
  var modal = document.querySelector('.stats-modal');
  var sidebar = document.getElementById('sidebar');
  if (modal && sidebar) {
    modal.style.left = (sidebar.classList.contains('expanded') ? 200 : 48) + 'px';
  }
}

var currentPage = 'graph';
var pageMap = { graph: 'pageGraph', stats: 'pageStats', docs: 'pageDocs', 'test-tools': 'pageTestTools', memory: 'pageMemory', 'md-viewer': 'pageMdViewer', settings: 'pageSettings' };
var routePages = { '/': 'graph', '/graph': 'graph', '/stats': 'stats', '/docs': 'docs', '/test-tools': 'test-tools', '/memory': 'memory', '/md-viewer': 'md-viewer', '/settings': 'settings' };

function getPageFromPath(pathname) {
  if (!pathname) return 'graph';
  return routePages[pathname] || 'graph';
}

function getPathFromPage(page) {
  if (page === 'graph') return '/graph';
  if (page === 'stats') return '/stats';
  if (page === 'docs') return '/docs';
  if (page === 'test-tools') return '/test-tools';
  if (page === 'memory') return '/memory';
  if (page === 'md-viewer') return '/md-viewer';
  if (page === 'settings') return '/settings';
  return '/graph';
}

function syncBrowserRoute(page, replace) {
  try {
    var targetPath = getPathFromPage(page);
    if (window.location.pathname === targetPath) return;
    var st = { page: page };
    if (replace) history.replaceState(st, '', targetPath);
    else history.pushState(st, '', targetPath);
  } catch (e) {}
}

function navTo(page, options) {
  options = options || {};
  var fromRoute = !!options.fromRoute;
  var replaceRoute = !!options.replaceRoute;
  // 仅支持已实现的页面
  if (!pageMap[page]) return;
  if (page === currentPage) return;

  // 切换页面视图
  var oldView = document.getElementById(pageMap[currentPage]);
  var newView = document.getElementById(pageMap[page]);
  if (oldView) oldView.classList.remove('active');
  if (newView) newView.classList.add('active');

  // 切换导航高亮
  var items = document.querySelectorAll('.nav-item[data-page]');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove('active');
    if (items[i].getAttribute('data-page') === page) items[i].classList.add('active');
  }

  currentPage = page;
  if (!fromRoute) {
    syncBrowserRoute(page, replaceRoute);
  }

  // 离开项目图谱页面时关闭左侧弹层
  if (page !== 'graph') closeStatsModal();

  // 按需加载页面数据
  if (page === 'stats') loadStatsPage();
  if (page === 'docs') loadDocsPage();
  if (page === 'test-tools') loadTestToolsPage();
  if (page === 'memory') loadMemoryPage();
  if (page === 'md-viewer') loadMdViewerPage();
  if (page === 'settings') loadGatewayAlertPanel();
  if (page === 'graph' && network) {
    setTimeout(function() { network.redraw(); network.fit(); }, 100);
  }
}

function initRoutingFromLocation() {
  var initialPage = getPageFromPath(window.location.pathname);
  if (!routePages[window.location.pathname]) {
    syncBrowserRoute(initialPage, true);
  }
  if (initialPage !== currentPage) {
    navTo(initialPage, { fromRoute: true, replaceRoute: true });
  } else {
    // 确保首页也统一到 /graph
    syncBrowserRoute(initialPage, true);
  }
}

window.addEventListener('popstate', function() {
  var page = getPageFromPath(window.location.pathname);
  if (page !== currentPage) {
    navTo(page, { fromRoute: true });
  }
});

// 恢复 sidebar 偏好
(function() {
  try {
    var saved = localStorage.getItem('devplan_sidebar_expanded');
    if (saved === '1') {
      var sidebar = document.getElementById('sidebar');
      if (sidebar) { sidebar.classList.add('expanded'); }
      // 同步弹层初始位置
      updateStatsModalPosition();
    }
  } catch(e) {}
})();

// ========== Settings Page ==========
function selectRenderer(value) {
  // Skip if already the current engine
  if (value === RENDERER_ENGINE) return;

  var cards = document.querySelectorAll('#rendererOptions .settings-radio-card');
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var radio = card.querySelector('input[type="radio"]');
    if (card.getAttribute('data-value') === value) {
      card.classList.add('selected');
      if (radio) radio.checked = true;
    } else {
      card.classList.remove('selected');
      if (radio) radio.checked = false;
    }
  }
  // Persist to localStorage
  try { localStorage.setItem('devplan_renderer_engine', value); } catch(e) {}
  // Show/hide 3D settings section
  var sec = document.getElementById('settings3dSection');
  if (sec) sec.style.display = (value === '3d') ? 'block' : 'none';
  // Show toast then auto-reload
  var engineLabel = value === '3d' ? '3D Force Graph' : 'vis-network';
  showSettingsToast('✅ 引擎已切换为 ' + engineLabel + '，正在重新加载...');
  // Auto-reload after a short delay so user can see the toast
  setTimeout(function() { location.reload(); }, 1200);
}

function showSettingsToast(message) {
  var toast = document.getElementById('settingsSavedToast');
  if (!toast) return;
  if (message) toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() { toast.classList.remove('show'); }, 3000);
}

// Initialize settings page state on load
(function() {
  try {
    var saved = localStorage.getItem('devplan_renderer_engine');
    // 兼容旧值 graphcanvas → 3d
    if (saved === 'graphcanvas') saved = '3d';
    if (saved === '3d' || saved === 'vis') {
      // Sync radio cards to saved value
      var cards = document.querySelectorAll('#rendererOptions .settings-radio-card');
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var radio = card.querySelector('input[type="radio"]');
        if (card.getAttribute('data-value') === saved) {
          card.classList.add('selected');
          if (radio) radio.checked = true;
        } else {
          card.classList.remove('selected');
          if (radio) radio.checked = false;
        }
      }
    }
  } catch(e) {}
})();

function loadGatewayAlertPanel() {
  var panel = document.getElementById('gatewayAlertPanel');
  if (!panel) return;
  panel.innerHTML = '<div style="text-align:center;padding:12px;color:#6b7280;font-size:12px;"><div class="spinner" style="margin:0 auto 8px;"></div>加载告警状态...</div>';
  fetch('/api/recall-observability').then(function(r) { return r.json(); }).then(function(data) {
    var alertObj = data && data.gatewayAlert ? data.gatewayAlert : null;
    if (!alertObj) {
      panel.innerHTML = '<div class="ga-card"><div class="ga-title">未启用 Recall Observability</div><div class="ga-meta">当前项目未提供 gatewayAlert 数据。</div><button class="ga-refresh" onclick="loadGatewayAlertPanel()">刷新</button></div>';
      return;
    }
    var warned = !!alertObj.alerted;
    var lampClass = warned ? 'yellow' : 'green';
    var cardClass = warned ? 'warn' : 'ok';
    var thresholdPct = Math.round((Number(alertObj.threshold || 0) * 1000)) / 10;
    var maxRatePct = Math.round((Number(alertObj.maxFallbackRate || 0) * 1000)) / 10;
    var ops = (alertObj.triggeredOps && alertObj.triggeredOps.length > 0)
      ? alertObj.triggeredOps.join(', ')
      : '无';
    var html = '';
    html += '<div class="ga-card ' + cardClass + '">';
    html += '<div class="ga-head">';
    html += '<div class="ga-title"><span class="ga-lamp ' + lampClass + '"></span>' + (warned ? '告警中' : '正常') + '</div>';
    html += '<div style="font-size:11px;color:#94a3b8;">阈值: ' + thresholdPct + '%</div>';
    html += '</div>';
    html += '<div class="ga-meta">最大回退率: <strong>' + maxRatePct + '%</strong></div>';
    html += '<div class="ga-meta">触发操作: ' + escHtml(String(ops)) + '</div>';
    if (warned && alertObj.reason) {
      html += '<div class="ga-reason">' + escHtml(String(alertObj.reason)) + '</div>';
    }
    html += '<button class="ga-refresh" onclick="loadGatewayAlertPanel()">刷新</button>';
    html += '</div>';
    panel.innerHTML = html;
  }).catch(function(err) {
    panel.innerHTML = '<div class="ga-card"><div class="ga-title">加载失败</div><div class="ga-meta">' + escHtml(err.message || String(err)) + '</div><button class="ga-refresh" onclick="loadGatewayAlertPanel()">重试</button></div>';
  });
}

// ========== 通用图谱显示设置 ==========
var GRAPH_SETTINGS_KEY = 'devplan_graph_settings';
var GRAPH_SETTINGS_DEFAULTS = {
  showProjectEdges: false  // 默认隐藏主节点连线
};

function getGraphSettings() {
  var settings = {};
  for (var k in GRAPH_SETTINGS_DEFAULTS) settings[k] = GRAPH_SETTINGS_DEFAULTS[k];
  try {
    var saved = localStorage.getItem(GRAPH_SETTINGS_KEY);
    if (saved) {
      var parsed = JSON.parse(saved);
      for (var k in parsed) {
        if (GRAPH_SETTINGS_DEFAULTS.hasOwnProperty(k)) settings[k] = parsed[k];
      }
    }
  } catch(e) {}
  return settings;
}

function saveGraphSettings(settings) {
  try { localStorage.setItem(GRAPH_SETTINGS_KEY, JSON.stringify(settings)); } catch(e) {}
}

function updateGraphSetting(key, value) {
  var settings = getGraphSettings();
  if (typeof GRAPH_SETTINGS_DEFAULTS[key] === 'boolean') value = !!value;
  settings[key] = value;
  saveGraphSettings(settings);
  showSettingsToast('✅ 显示设置已保存，刷新项目图谱页面生效');
}

// Initialize general graph settings UI
(function() {
  var s = getGraphSettings();
  var el = document.getElementById('settingShowProjectEdges');
  if (el) el.checked = !!s.showProjectEdges;
})();

// ========== 统一节点颜色配置 (适用于所有渲染引擎) ==========
function darkenHex(hex, amount) {
  try {
    var r = parseInt(hex.slice(1,3), 16);
    var g = parseInt(hex.slice(3,5), 16);
    var b = parseInt(hex.slice(5,7), 16);
    r = Math.max(0, Math.round(r * (1 - amount)));
    g = Math.max(0, Math.round(g * (1 - amount)));
    b = Math.max(0, Math.round(b * (1 - amount)));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  } catch(e) { return hex; }
}

var NODE_COLORS_KEY = 'devplan_node_colors';
var NODE_COLORS_VERSION_KEY = 'devplan_node_colors_v';
var NODE_COLORS_VERSION = 2;  // 递增此值可强制重置用户缓存到新默认值
var NODE_COLORS_DEFAULTS = {
  colorProject: '#f59e0b',
  colorModule: '#ff6600',
  colorMainTask: '#22c55e',
  colorSubTask: '#047857',
  colorDocument: '#3b82f6',
  colorMemory: '#e879f9'
};

function getNodeColors() {
  var colors = {};
  for (var k in NODE_COLORS_DEFAULTS) colors[k] = NODE_COLORS_DEFAULTS[k];
  try {
    // 版本检查: 默认值变更时强制重置缓存
    var savedVer = parseInt(localStorage.getItem(NODE_COLORS_VERSION_KEY) || '0', 10);
    if (savedVer < NODE_COLORS_VERSION) {
      // 默认值已更新, 清除旧缓存
      localStorage.removeItem(NODE_COLORS_KEY);
      localStorage.setItem(NODE_COLORS_VERSION_KEY, String(NODE_COLORS_VERSION));
      return colors;
    }
    var saved = localStorage.getItem(NODE_COLORS_KEY);
    if (saved) {
      var parsed = JSON.parse(saved);
      for (var k in parsed) {
        if (NODE_COLORS_DEFAULTS.hasOwnProperty(k)) colors[k] = parsed[k];
      }
    }
  } catch(e) {}
  return colors;
}

function saveNodeColors(colors) {
  try { localStorage.setItem(NODE_COLORS_KEY, JSON.stringify(colors)); } catch(e) {}
}

function updateNodeColor(nodeType, colorValue) {
  var keyMap = { 'project': 'colorProject', 'module': 'colorModule', 'main-task': 'colorMainTask', 'sub-task': 'colorSubTask', 'document': 'colorDocument', 'memory': 'colorMemory' };
  var key = keyMap[nodeType];
  if (!key) return;
  var colors = getNodeColors();
  colors[key] = colorValue;
  saveNodeColors(colors);
  // Update hex display
  var hexMap = { 'project': 'ncColorProjectHex', 'module': 'ncColorModuleHex', 'main-task': 'ncColorMainTaskHex', 'sub-task': 'ncColorSubTaskHex', 'document': 'ncColorDocumentHex', 'memory': 'ncColorMemoryHex' };
  var hexEl = document.getElementById(hexMap[nodeType]);
  if (hexEl) hexEl.textContent = colorValue;
  // Update dot color
  var dotMap = { 'project': 'ncColorProject', 'module': 'ncColorModule', 'main-task': 'ncColorMainTask', 'sub-task': 'ncColorSubTask', 'document': 'ncColorDocument', 'memory': 'ncColorMemory' };
  var input = document.getElementById(dotMap[nodeType]);
  if (input) {
    var dot = input.parentElement.querySelector('.s3d-dot');
    if (dot) dot.style.background = colorValue;
  }
  showSettingsToast('✅ 节点颜色已保存 (适用于所有渲染引擎)，刷新项目图谱页面生效');
}

/** 获取统一节点样式配置 — 所有渲染引擎共享 */
function getUnifiedNodeStyle() {
  var nc = getNodeColors();
  return {
    project:  { bg: nc.colorProject, border: darkenHex(nc.colorProject, 0.15), font: '#fff' },
    module:   { bg: nc.colorModule, border: darkenHex(nc.colorModule, 0.2), font: '#fff3e0' },
    document: { bg: nc.colorDocument, border: darkenHex(nc.colorDocument, 0.15), font: '#dbeafe' },
    // 主任务: 亮绿色系 (pending=亮绿, completed=略深)
    mainTask: {
      'pending':     { bg: nc.colorMainTask, border: darkenHex(nc.colorMainTask, 0.15), font: '#052e16' },
      'completed':   { bg: darkenHex(nc.colorMainTask, 0.20), border: darkenHex(nc.colorMainTask, 0.35), font: '#d1fae5' },
      'in_progress': { bg: '#7c3aed', border: '#6d28d9', font: '#ddd6fe' },
      'cancelled':   { bg: '#92400e', border: '#78350f', font: '#fde68a' }
    },
    // 子任务: 深绿色系 (pending=深绿, completed=更深)
    subTask: {
      'pending':     { bg: nc.colorSubTask, border: darkenHex(nc.colorSubTask, 0.15), font: '#d1fae5' },
      'completed':   { bg: darkenHex(nc.colorSubTask, 0.20), border: darkenHex(nc.colorSubTask, 0.35), font: '#a7f3d0' },
      'in_progress': { bg: '#7c3aed', border: '#6d28d9', font: '#ddd6fe' },
      'cancelled':   { bg: '#92400e', border: '#78350f', font: '#fde68a' }
    },
    // 记忆节点: 紫粉色系
    memory: { bg: nc.colorMemory, border: darkenHex(nc.colorMemory, 0.15), font: '#fdf4ff' },
    // 通用状态颜色 (用于状态饼图等)
    statusGeneric: {
      completed:   { bg: '#059669', border: '#047857', font: '#d1fae5' },
      in_progress: { bg: '#7c3aed', border: '#6d28d9', font: '#ddd6fe' },
      pending:     { bg: '#4b5563', border: '#374151', font: '#d1d5db' },
      cancelled:   { bg: '#92400e', border: '#78350f', font: '#fde68a' }
    }
  };
}

function initNodeColorsUI() {
  var nc = getNodeColors();
  var colorMap = {
    'ncColorProject': 'colorProject',
    'ncColorModule': 'colorModule',
    'ncColorMainTask': 'colorMainTask',
    'ncColorSubTask': 'colorSubTask',
    'ncColorDocument': 'colorDocument',
    'ncColorMemory': 'colorMemory'
  };
  for (var id in colorMap) {
    var el = document.getElementById(id);
    var hexEl = document.getElementById(id + 'Hex');
    var v = nc[colorMap[id]];
    if (el) el.value = v;
    if (hexEl) hexEl.textContent = v;
    if (el) {
      var dot = el.parentElement.querySelector('.s3d-dot');
      if (dot) dot.style.background = v;
    }
  }
}

function resetNodeColors() {
  try { localStorage.removeItem(NODE_COLORS_KEY); } catch(e) {}
  initNodeColorsUI();
  showSettingsToast('↩ 已恢复默认节点颜色，刷新项目图谱页面生效');
}

initNodeColorsUI();

// ========== 3D Force Graph 自定义设置 ==========
var S3D_DEFAULTS = {
  gravity: 0.05,
  repulsion: -30,
  linkDistance: 40,
  velocityDecay: 0.30,
  alphaDecay: 0.020,
  // 类型分层 (力导向模式): 不同类型节点保持不同轨道距离
  typeSeparation: true,         // 启用类型间空间分层
  typeSepStrength: 0.8,         // 分层力强度 (0=关闭, 1=强)
  typeSepSpacing: 80,           // 层间间距 (模块@80, 文档@160, 主任务@240, 子任务@320)
  // 布局模式: 'force' (力导向) | 'orbital' (行星轨道)
  layoutMode: 'force',
  orbitSpacing: 80,       // 轨道间距 (行星轨道模式)
  orbitStrength: 0.8,     // 轨道吸引力强度
  orbitFlatten: 0.6,      // Z 轴压平力度 (0=不压平/球壳, 1=完全压平/圆盘)
  showOrbits: true,       // 显示轨道环线
  showLabels: true,       // 显示节点文字标签
  sizeProject: 50,
  sizeModule: 25,
  sizeMainTask: 15,
  sizeSubTask: 8,
  sizeDocument: 10,
  sizeMemory: 8,
  particles: true,
  arrows: false,
  nodeOpacity: 0.90,
  linkOpacity: 0.25,
  bgColor: '#0a0e1a'
};
var S3D_KEY = 'devplan_3d_settings';

function get3DSettings() {
  var settings = {};
  for (var k in S3D_DEFAULTS) settings[k] = S3D_DEFAULTS[k];
  try {
    var saved = localStorage.getItem(S3D_KEY);
    if (saved) {
      var parsed = JSON.parse(saved);
      for (var k in parsed) {
        if (S3D_DEFAULTS.hasOwnProperty(k)) settings[k] = parsed[k];
      }
    }
  } catch(e) {}
  return settings;
}

function save3DSettings(settings) {
  try { localStorage.setItem(S3D_KEY, JSON.stringify(settings)); } catch(e) {}
}

function update3DSetting(key, value) {
  var settings = get3DSettings();
  // Parse numeric values
  if (typeof S3D_DEFAULTS[key] === 'number') {
    value = parseFloat(value);
  } else if (typeof S3D_DEFAULTS[key] === 'boolean') {
    value = !!value;
  }
  settings[key] = value;
  save3DSettings(settings);
  // Update the display value
  var valEl = document.getElementById('s3d' + key.charAt(0).toUpperCase() + key.slice(1) + 'Val');
  if (valEl) {
    if (typeof value === 'number') valEl.textContent = value.toFixed ? (Number.isInteger(value) ? value : value.toFixed(key === 'alphaDecay' ? 3 : 2)) : value;
    else valEl.textContent = value;
  }
  showSettingsToast('✅ 3D 参数已保存，刷新项目图谱页面生效');
}

// 兼容旧调用: 重定向到统一颜色管理
function update3DColor(nodeType, colorValue) {
  updateNodeColor(nodeType, colorValue);
}

function updateLayoutMode(mode) {
  var settings = get3DSettings();
  var oldMode = settings.layoutMode;
  settings.layoutMode = mode;
  save3DSettings(settings);
  var orbitalSettings = document.getElementById('s3dOrbitalSettings');
  if (orbitalSettings) orbitalSettings.style.display = mode === 'orbital' ? 'block' : 'none';
  // 布局模式切换: 自动重新加载图谱 (无需手动刷新)
  if (oldMode !== mode && typeof loadData === 'function') {
    showSettingsToast('✅ 切换至 ' + (mode === 'orbital' ? '🪐 行星轨道' : '⚡ 力导向') + '，正在重新加载...');
    setTimeout(function() { loadData(); }, 300);
  } else {
    showSettingsToast('✅ 布局模式: ' + (mode === 'orbital' ? '🪐 行星轨道' : '⚡ 力导向'));
  }
}

function reset3DSettings() {
  try { localStorage.removeItem(S3D_KEY); } catch(e) {}
  init3DSettingsUI();
  showSettingsToast('↩ 已恢复 3D 默认设置，刷新项目图谱页面生效');
}

function toggle3DPanel(panelId) {
  var panel = document.getElementById(panelId);
  if (panel) panel.classList.toggle('collapsed');
}

function init3DSettingsUI() {
  var s = get3DSettings();
  // Show/hide 3D section based on engine
  var sec = document.getElementById('settings3dSection');
  if (sec) {
    var engine = 'vis';
    try { engine = localStorage.getItem('devplan_renderer_engine') || 'vis'; } catch(e) {}
    if (engine === 'graphcanvas') engine = '3d';
    sec.style.display = (engine === '3d') ? 'block' : 'none';
  }

  // Physics
  var sliderMap = {
    's3dGravity': { key: 'gravity', fmt: 2 },
    's3dRepulsion': { key: 'repulsion', fmt: 0 },
    's3dLinkDist': { key: 'linkDistance', fmt: 0 },
    's3dVelocityDecay': { key: 'velocityDecay', fmt: 2 },
    's3dAlphaDecay': { key: 'alphaDecay', fmt: 3 },
    's3dSizeProject': { key: 'sizeProject', fmt: 0 },
    's3dSizeModule': { key: 'sizeModule', fmt: 0 },
    's3dSizeMainTask': { key: 'sizeMainTask', fmt: 0 },
    's3dSizeSubTask': { key: 'sizeSubTask', fmt: 0 },
    's3dSizeDocument': { key: 'sizeDocument', fmt: 0 },
    's3dNodeOpacity': { key: 'nodeOpacity', fmt: 2 },
    's3dLinkOpacity': { key: 'linkOpacity', fmt: 2 },
    's3dTypeSepStrength': { key: 'typeSepStrength', fmt: 2 },
    's3dTypeSepSpacing': { key: 'typeSepSpacing', fmt: 0 },
    's3dOrbitSpacing': { key: 'orbitSpacing', fmt: 0 },
    's3dOrbitStrength': { key: 'orbitStrength', fmt: 2 },
    's3dOrbitFlatten': { key: 'orbitFlatten', fmt: 2 }
  };
  for (var id in sliderMap) {
    var el = document.getElementById(id);
    var valEl = document.getElementById(id + 'Val');
    var cfg = sliderMap[id];
    var v = s[cfg.key];
    if (el) el.value = v;
    if (valEl) valEl.textContent = cfg.fmt > 0 ? parseFloat(v).toFixed(cfg.fmt) : Math.round(v);
  }

  // Background color (3D only)
  var bgEl = document.getElementById('s3dBgColor');
  var bgHexEl = document.getElementById('s3dBgColorHex');
  if (bgEl) bgEl.value = s.bgColor || '#0a0e1a';
  if (bgHexEl) bgHexEl.textContent = s.bgColor || '#0a0e1a';

  // Toggles
  var toggleMap = { 's3dParticles': 'particles', 's3dArrows': 'arrows', 's3dShowOrbits': 'showOrbits', 's3dTypeSeparation': 'typeSeparation', 's3dShowLabels': 'showLabels' };
  for (var id in toggleMap) {
    var el = document.getElementById(id);
    if (el) el.checked = !!s[toggleMap[id]];
  }

  // Layout mode radio
  var layoutRadios = document.querySelectorAll('input[name="s3dLayoutMode"]');
  for (var i = 0; i < layoutRadios.length; i++) {
    layoutRadios[i].checked = (layoutRadios[i].value === s.layoutMode);
  }
  // Show/hide orbital-specific settings
  var orbitalSettings = document.getElementById('s3dOrbitalSettings');
  if (orbitalSettings) orbitalSettings.style.display = s.layoutMode === 'orbital' ? 'block' : 'none';
}

// Initialize 3D settings UI on page load
init3DSettingsUI();

// ========== Debug ==========
var dbg = document.getElementById('debug');
function log(msg, ok) {
  console.log('[DevPlan]', msg);
  dbg.innerHTML = (ok ? '<span class="ok">✓</span> ' : '<span class="err">✗</span> ') + msg;
}

// ========== 渲染引擎选择: vis-network (默认) vs 3D Force Graph ==========
// 优先级: URL 参数 > localStorage (项目设置页) > 默认值 (vis)
var RENDERER_ENGINE = 'vis'; // 'vis' (默认) | '3d' (3D 球体可视化)
(function() {
  // 1. 先从 localStorage 读取用户在项目设置页的选择
  try {
    var saved = localStorage.getItem('devplan_renderer_engine');
    if (saved === '3d' || saved === 'vis') RENDERER_ENGINE = saved;
    // 兼容旧值 graphcanvas → 自动迁移为 3d
    if (saved === 'graphcanvas') { RENDERER_ENGINE = '3d'; try { localStorage.setItem('devplan_renderer_engine', '3d'); } catch(e2) {} }
  } catch(e) {}
  // 2. URL 参数优先级最高（覆盖 localStorage）
  var params = new URLSearchParams(window.location.search);
  var r = params.get('renderer');
  if (r === '3d' || r === '3d-force' || r === 'graphcanvas' || r === 'gc') RENDERER_ENGINE = '3d';
  else if (r === 'vis') RENDERER_ENGINE = 'vis';
})();
var USE_3D = false; // set after 3d-force-graph engine loads

// Update engine badge label
(function() {
  var label = document.getElementById('engineNameLabel');
  if (label) label.textContent = RENDERER_ENGINE === '3d' ? '3D Force Graph' : 'vis-network';
})();

// ========== SimpleDataSet — vis.DataSet shim for non-vis-network modes ==========
function SimpleDataSet(items) {
  this._data = {};
  this._ids = [];
  if (items) {
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      this._data[item.id] = item;
      this._ids.push(item.id);
    }
  }
}
SimpleDataSet.prototype.get = function(id) {
  if (id === undefined || id === null) {
    // Return all items as array
    var result = [];
    for (var i = 0; i < this._ids.length; i++) result.push(this._data[this._ids[i]]);
    return result;
  }
  return this._data[id] || null;
};
SimpleDataSet.prototype.getIds = function() {
  return this._ids.slice();
};
SimpleDataSet.prototype.forEach = function(callback) {
  for (var i = 0; i < this._ids.length; i++) {
    callback(this._data[this._ids[i]], this._ids[i]);
  }
};
SimpleDataSet.prototype.update = function(itemOrArray) {
  var items = Array.isArray(itemOrArray) ? itemOrArray : [itemOrArray];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (this._data[item.id]) {
      for (var key in item) {
        if (item.hasOwnProperty(key)) this._data[item.id][key] = item[key];
      }
    }
  }
};
SimpleDataSet.prototype.add = function(itemOrArray) {
  var items = Array.isArray(itemOrArray) ? itemOrArray : [itemOrArray];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    this._data[item.id] = item;
    if (this._ids.indexOf(item.id) === -1) this._ids.push(item.id);
  }
};
SimpleDataSet.prototype.remove = function(idOrArray) {
  var ids = Array.isArray(idOrArray) ? idOrArray : [idOrArray];
  for (var i = 0; i < ids.length; i++) {
    var id = typeof ids[i] === 'object' ? ids[i].id : ids[i];
    delete this._data[id];
    var idx = this._ids.indexOf(id);
    if (idx >= 0) this._ids.splice(idx, 1);
  }
};
// ========== 动态加载渲染引擎 ==========
function loadRenderEngine() {
  if (RENDERER_ENGINE === '3d') {
    log('正在加载 3D Force Graph 引擎 (Three.js + d3-force-3d)...', true);
    load3DForceGraph(0);
    return;
  }

  // 默认: 使用 vis-network 渲染器（成熟稳定、形状丰富）
  log('使用 vis-network 渲染器 (默认)', true);
  loadVisNetwork(0);
}

// ── Three.js CDN URLs (必须在 3d-force-graph 之前加载) ──
var THREE_JS_URLS = [
  'https://unpkg.com/three@0.160.0/build/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js'
];

// ── 3D Force Graph CDN URLs ──
var THREE_D_URLS = [
  'https://unpkg.com/3d-force-graph@1/dist/3d-force-graph.min.js',
  'https://cdn.jsdelivr.net/npm/3d-force-graph@1/dist/3d-force-graph.min.js'
];

function load3DForceGraph(index) {
  // Step 1: 先加载 Three.js (3d-force-graph 依赖 window.THREE)
  log('Step 1/2: 加载 Three.js...', true);
  loadThreeJS(0);
}

function loadThreeJS(index) {
  if (index >= THREE_JS_URLS.length) {
    log('Three.js CDN 均加载失败, 回退到 vis-network', false);
    loadVisNetwork(0);
    return;
  }
  var url = THREE_JS_URLS[index];
  log('尝试加载 Three.js CDN #' + (index+1) + ': ' + url.split('/')[2], true);
  var s = document.createElement('script');
  s.src = url;
  s.onload = function() {
    if (typeof THREE !== 'undefined') {
      log('Three.js 加载成功 ✓ (r' + (THREE.REVISION || '?') + ')', true);
      // Step 2: 加载 3d-force-graph
      log('Step 2/2: 加载 3D Force Graph...', true);
      loadForceGraph3D(0);
    } else {
      log('Three.js CDN #' + (index+1) + ' 加载但 THREE 不存在, 尝试下一个', false);
      loadThreeJS(index + 1);
    }
  };
  s.onerror = function() {
    log('Three.js CDN #' + (index+1) + ' 加载失败, 尝试下一个', false);
    loadThreeJS(index + 1);
  };
  document.head.appendChild(s);
}

function loadForceGraph3D(index) {
  if (index >= THREE_D_URLS.length) {
    log('3D Force Graph CDN 均加载失败, 回退到 vis-network', false);
    loadVisNetwork(0);
    return;
  }
  var url = THREE_D_URLS[index];
  log('尝试加载 3D Force Graph CDN #' + (index+1) + ': ' + url.split('/')[2], true);
  var s = document.createElement('script');
  s.src = url;
  s.onload = function() {
    if (typeof ForceGraph3D !== 'undefined') {
      log('3D Force Graph 引擎加载成功 ✓ (Three.js WebGL)', true);
      USE_3D = true;
      startApp();
    } else {
      log('3D CDN #' + (index+1) + ' 加载但 ForceGraph3D 不存在, 尝试下一个', false);
      loadForceGraph3D(index + 1);
    }
  };
  s.onerror = function() {
    log('3D CDN #' + (index+1) + ' 加载失败, 尝试下一个', false);
    loadForceGraph3D(index + 1);
  };
  document.head.appendChild(s);
}

// ── vis-network CDN URLs ──
var VIS_URLS = [
  'https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js',
  'https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/vis-network/9.1.9/standalone/umd/vis-network.min.js'
];

function loadVisNetwork(index) {
  if (index >= VIS_URLS.length) {
    log('所有 CDN 均加载失败，请检查网络连接', false);
    document.getElementById('loading').innerHTML = '<div style="text-align:center"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><p style="color:#f87171;">渲染引擎加载失败</p><p style="color:#9ca3af;margin-top:8px;font-size:13px;">所有 CDN 均不可用</p><button class="refresh-btn" onclick="location.reload()" style="margin-top:12px;">刷新页面</button></div>';
    return;
  }
  var url = VIS_URLS[index];
  log('尝试加载 vis-network CDN #' + (index+1) + ': ' + url.split('/')[2], true);
  var s = document.createElement('script');
  s.src = url;
  s.onload = function() {
    if (typeof vis !== 'undefined' && vis.Network && vis.DataSet) {
      log('vis-network 加载成功 (CDN #' + (index+1) + ')', true);
      USE_3D = false;
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
var hiddenTypes = { memory: true }; // Phase-68: 记忆默认隐藏，勾选后懒加载
var ctrlPressed = false;
var INCLUDE_NODE_DEGREE = true;
var ENABLE_BACKEND_DEGREE_FALLBACK = true;

// ── Phase-10: Tiered loading state ──
// L0: project, module  |  L1: main-task  |  L2: sub-task  |  L3: document
var TIER_L0L1_TYPES = ['devplan-project', 'devplan-module', 'devplan-main-task'];
var TIER_L2_TYPES = ['devplan-sub-task'];
var TIER_L3_TYPES = ['devplan-document'];
var tieredLoadState = {
  l0l1Loaded: false,     // L0+L1 core nodes loaded
  l2Loaded: false,       // L2 sub-tasks loaded
  l3Loaded: false,       // L3 documents loaded
  memoryLoaded: false,   // Phase-68: 记忆节点是否已加载
  expandedPhases: {},    // phase-X -> true: which main-tasks have been expanded
  totalNodes: 0,         // total node count from server
};
// Phase-10 T10.3: Track if network instance should be reused
var networkReusable = false;


// ========== 边高亮：选中节点时关联边变色，取消选中时恢复灰色 ==========
function highlightConnectedEdges(nodeId) {
  if (!edgesDataSet || !network || typeof network.getConnectedEdges !== 'function') return;
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
  'document':  { min: 12, max: 30, baseFont: 9,  maxFont: 13, scale: 1.8 },
  'memory':    { min: 6,  max: 20, baseFont: 7,  maxFont: 11, scale: 1.2 }
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
  if (t === 'memory') {
    var _mc = _visUniStyle.memory;
    return { shape: 'hexagon', size: ns.size, color: { background: _mc.bg, border: _mc.border, highlight: { background: _mc.bg, border: '#fff' } }, font: { size: ns.fontSize, color: _mc.font }, borderWidth: 1 };
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
  if (label === 'has_memory') return { width: 1, color: { color: '#581c87', highlight: '#e879f9', hover: '#e879f9' }, dashes: [3, 3], arrows: { to: { enabled: true, scaleFactor: 0.3 } }, _highlightColor: '#e879f9' };
  if (label === 'memory_relates') return { width: 1.5, color: { color: '#86198f', highlight: '#f0abfc', hover: '#f0abfc' }, dashes: false, arrows: { to: { enabled: false } }, _highlightColor: '#f0abfc' };
  if (label === 'memory_from_task') return { width: 1, color: { color: '#581c87', highlight: '#c084fc', hover: '#c084fc' }, dashes: [4, 2], arrows: { to: { enabled: true, scaleFactor: 0.3 } }, _highlightColor: '#c084fc' };
  if (label === 'memory_from_doc') return { width: 1, color: { color: '#581c87', highlight: '#a78bfa', hover: '#a78bfa' }, dashes: [2, 3], arrows: { to: { enabled: true, scaleFactor: 0.3 } }, _highlightColor: '#a78bfa' };
  if (label === 'module_memory') return { width: 1, color: { color: '#581c87', highlight: '#d946ef', hover: '#d946ef' }, dashes: [3, 2], arrows: { to: { enabled: true, scaleFactor: 0.3 } }, _highlightColor: '#d946ef' };
  if (label === 'memory_supersedes') return { width: 1, color: { color: '#701a75', highlight: '#f472b6', hover: '#f472b6' }, dashes: [6, 2], arrows: { to: { enabled: true, scaleFactor: 0.4 } }, _highlightColor: '#f472b6' };
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

    // 预计算大图标志: 文档/子任务节点初始不显示文字 (缩放放大后才显示)
    // 这样 document 的 box 形状在初始视图中显示为蓝色正方体，而不是超长长方体
    var _totalVisible = 0;
    for (var ci = 0; ci < allNodes.length; ci++) {
      if (!hiddenTypes[allNodes[ci].type] && !isNodeCollapsedByParent(allNodes[ci].id)) _totalVisible++;
    }
    var _initLabelCompact = _totalVisible > 100; // 100+ 节点时文档/子任务初始隐藏文字

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

      // 文档/子任务: 初始隐藏文字 → box 显示为正方体, dot 更小更清爽
      // 保存原始字号到 _origFontSize 供缩放时恢复
      var nodeFont = s.font;
      var origFontSize = (s.font && s.font.size) || 10;
      if (_initLabelCompact && (n.type === 'document' || n.type === 'sub-task' || n.type === 'memory')) {
        nodeFont = { size: 0, color: (s.font && s.font.color) || '#9ca3af' };
      }

      // Phase-10 T10.5: Add double-click hint for main-task nodes in tiered mode
      var tooltip = n.label + ' (连接: ' + deg + ')';
      if (n.type === 'main-task' && !USE_3D && tieredLoadState.l0l1Loaded && !tieredLoadState.l2Loaded) {
        var phaseId = (n.properties || {}).taskId || n.id;
        tooltip += tieredLoadState.expandedPhases[phaseId] ? '\n双击收起子任务' : '\n双击展开子任务';
      }
      visibleNodes.push({ id: n.id, label: label, _origLabel: n.label, _origFontSize: origFontSize, title: tooltip, shape: s.shape, size: s.size, color: s.color, font: nodeFont, borderWidth: s.borderWidth, _type: n.type, _props: n.properties || {}, _isParentDoc: isParentDoc });
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
    // 文档/子任务初始隐藏文字 (正方体显示)，放大到一定程度后显示文字 (长方体带标题)
    // _initLabelCompact: 在节点准备阶段已将 document/sub-task font.size 设为 0
    if (isLargeGraph) {
      var labelHidden = _initLabelCompact; // 与初始渲染状态同步
      network.on('zoom', function() {
        var scale = network.getScale();
        if (scale < 0.5 && !labelHidden) {
          // 缩小时: 隐藏子任务和文档的标签 → 文档显示为正方体
          labelHidden = true;
          var updates = [];
          nodesDataSet.forEach(function(n) {
            if (n._type === 'sub-task' || n._type === 'document' || n._type === 'memory') {
              updates.push({ id: n.id, font: { size: 0 } });
            }
          });
          if (updates.length > 0) nodesDataSet.update(updates);
        } else if (scale >= 0.5 && labelHidden) {
          // 放大时: 恢复标签 → 文档显示为带标题的长方体
          labelHidden = false;
          var updates = [];
          nodesDataSet.forEach(function(n) {
            if (n._type === 'sub-task' || n._type === 'document' || n._type === 'memory') {
              var restoreSize = n._origFontSize || 10;
              var restoreColor = (n.font && n.font.color) || '#9ca3af';
              updates.push({ id: n.id, font: { size: restoreSize, color: restoreColor } });
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

    // Phase-68: 记忆懒加载 — 首次勾选时从后端获取记忆数据
    if (type === 'memory' && !tieredLoadState.memoryLoaded) {
      loadMemoryNodesLazy();
      return;
    }

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
 * Phase-68: 记忆节点懒加载。
 * 首次勾选记忆复选框时触发，从后端获取仅包含记忆节点的图数据并合并。
 */
function loadMemoryNodesLazy() {
  var el = document.querySelector('.legend-item.toggle[data-type="memory"]');
  if (el) {
    el.classList.add('loading');
    el.title = '正在加载记忆数据...';
  }
  log('按需加载: 记忆节点...', true);

  // 请求仅包含记忆的图数据（不含文档、模块等，避免重复）
  var url = '/api/graph?includeMemories=true&includeDocuments=false&includeModules=false&includeNodeDegree=false';
  fetch(url).then(function(r) { return r.json(); }).then(function(result) {
    var newNodes = result.nodes || [];
    var newEdges = result.edges || [];

    // 只保留 memory 类型节点（API 也会返回 project / main-task 等已存在的节点）
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

    tieredLoadState.memoryLoaded = true;
    if (el) {
      el.classList.remove('loading');
      el.classList.remove('not-loaded');
      el.title = '点击切换记忆显隐';
    }
    log('记忆加载完成: +' + addedNodes.length + ' 记忆节点, +' + addedEdges.length + ' 边', true);

    // 增量添加到图谱
    if (networkReusable && nodesDataSet && edgesDataSet && network && !USE_3D) {
      incrementalAddNodes(addedNodes, addedEdges);
    } else {
      renderGraph();
    }
  }).catch(function(err) {
    if (el) {
      el.classList.remove('loading');
      el.title = '加载失败，点击重试';
    }
    // 恢复隐藏状态以便重试
    hiddenTypes['memory'] = true;
    if (el) el.classList.remove('active');
    var cb = document.getElementById('cb-memory');
    if (cb) cb.checked = false;
    log('记忆加载失败: ' + err.message, false);
  });
}

/**
 * 同步图例 toggle 状态与当前 hiddenTypes（页面初始化 / 分层加载后调用）。
 */
function syncLegendToggleState() {
  var types = ['module', 'main-task', 'sub-task', 'document', 'memory'];
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
  // Phase-68: 记忆默认未加载
  var memEl = document.querySelector('.legend-item.toggle[data-type="memory"]');
  if (memEl && !tieredLoadState.memoryLoaded) {
    memEl.classList.add('not-loaded');
    memEl.title = '点击加载记忆';
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
  // 确保所有 toggle 为 active（Phase-68: 跳过 hiddenTypes 中的类型）
  var toggles = document.querySelectorAll('.legend-item.toggle');
  for (var i = 0; i < toggles.length; i++) {
    var tp = toggles[i].getAttribute('data-type');
    if (tp && hiddenTypes[tp]) continue; // Phase-68: 不强制激活被隐藏的类型
    if (!toggles[i].classList.contains('active')) {
      toggles[i].classList.add('active');
    }
    if (tp) toggles[i].title = '点击切换' + tp + '显隐';
  }
}



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
        label: displayName + '\n(' + count + ')',
        _origLabel: displayName,
        title: displayName + ': ' + count + ' 个节点\n点击展开此类型',
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
    '<div class="stat clickable" onclick="showStatsModal(\x27module\x27)" title="查看所有模块"><span class="num amber">' + moduleCount + '</span> 模块</div>' +
    '<div class="stat clickable" onclick="showStatsModal(\x27main-task\x27)" title="查看所有主任务"><span class="num blue">' + progress.mainTaskCount + '</span> 主任务</div>' +
    '<div class="stat clickable" onclick="showStatsModal(\x27sub-task\x27)" title="查看所有子任务"><span class="num purple">' + progress.subTaskCount + '</span> 子任务</div>' +
    '<div class="stat clickable" onclick="showStatsModal(\x27document\x27)" title="查看所有文档"><span class="num" style="color:#3b82f6;">📄 ' + docCount + '</span> 文档</div>' +
    '<div class="stat clickable" onclick="showPromptModal()" title="查看所有 Prompt"><span class="num" style="color:#ec4899;">💬 ' + promptCount + '</span> Prompt</div>' +
    '<div class="stat"><span class="num green">' + progress.completedSubTasks + '/' + progress.subTaskCount + '</span> 已完成</div>' +
    '<div class="stat"><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div><span>' + pct + '%</span></div>';
}



// ========== 3D Force Graph Rendering (统一颜色配置) ==========
// 从统一节点颜色配置加载 (适用于所有引擎)
var _3dUniStyle = getUnifiedNodeStyle();
var _3dNodeColors = getNodeColors();
function load3DColorsFromSettings() {
  var nc = getNodeColors();
  return {
    'project':   nc.colorProject,
    'module':    nc.colorModule,
    'main-task': nc.colorMainTask,
    'sub-task':  nc.colorSubTask,
    'document':  nc.colorDocument,
    'memory':    nc.colorMemory
  };
}
function load3DSizesFromSettings() {
  var s = get3DSettings();
  return {
    'project':   s.sizeProject,
    'module':    s.sizeModule,
    'main-task': s.sizeMainTask,
    'sub-task':  s.sizeSubTask,
    'document':  s.sizeDocument,
    'memory':    s.sizeMemory || 8
  };
}
var NODE_3D_COLORS = load3DColorsFromSettings();
var NODE_3D_SIZES = load3DSizesFromSettings();
// 主任务状态颜色 (从统一配置)
var MAIN_TASK_STATUS_COLORS = {
  'pending':     _3dUniStyle.mainTask.pending.bg,
  'completed':   _3dUniStyle.mainTask.completed.bg,
  'in_progress': _3dUniStyle.mainTask.in_progress.bg,
  'cancelled':   _3dUniStyle.mainTask.cancelled.bg
};
// 子任务状态颜色 (从统一配置, completed=亮绿色)
var SUB_TASK_STATUS_COLORS = {
  'pending':     _3dUniStyle.subTask.pending.bg,
  'completed':   _3dUniStyle.subTask.completed.bg,
  'in_progress': _3dUniStyle.subTask.in_progress.bg,
  'cancelled':   _3dUniStyle.subTask.cancelled.bg
};

// ========== 3D 呼吸灯动画 (in_progress 主任务) ==========
var _3dBreathPhase = 0;
var _3dBreathAnimId = null;
var _3dBreathItems = []; // { sprite, ring1, ring2: THREE.Sprite, baseScale, ring1Base, ring2Base }

/** 启动 3D 呼吸灯动画循环 */
function start3DBreathAnimation() {
  if (_3dBreathAnimId) return;
  function tick() {
    _3dBreathPhase += 0.025;
    if (_3dBreathPhase > Math.PI * 2) _3dBreathPhase -= Math.PI * 2;
    var breath = (Math.sin(_3dBreathPhase) + 1) / 2; // [0, 1]

    for (var i = 0; i < _3dBreathItems.length; i++) {
      var item = _3dBreathItems[i];
      // 脉冲光晕 Sprite: 缩放 + 透明度振荡
      if (item.sprite && item.sprite.material) {
        var s = item.baseScale * (0.8 + breath * 1.5);
        item.sprite.scale.set(s, s, 1);
        item.sprite.material.opacity = 0.10 + breath * 0.30;
      }
      // 外圈脉冲环 Sprite: 扩展 + 淡出 (始终面向相机)
      if (item.ring1 && item.ring1.material) {
        var r1 = (item.ring1Base || 35) * (0.85 + breath * 0.8);
        item.ring1.scale.set(r1, r1, 1);
        item.ring1.material.opacity = 0.55 * (1 - breath * 0.55);
      }
      // 内圈脉冲环 Sprite: 反向节奏 (呼吸感更强)
      if (item.ring2 && item.ring2.material) {
        var invBreath = 1 - breath;
        var r2 = (item.ring2Base || 22) * (0.9 + invBreath * 0.6);
        item.ring2.scale.set(r2, r2, 1);
        item.ring2.material.opacity = 0.40 * (1 - invBreath * 0.45);
      }
    }

    _3dBreathAnimId = requestAnimationFrame(tick);
  }
  _3dBreathAnimId = requestAnimationFrame(tick);
}

/** 停止 3D 呼吸灯动画循环 */
function stop3DBreathAnimation() {
  if (_3dBreathAnimId) {
    cancelAnimationFrame(_3dBreathAnimId);
    _3dBreathAnimId = null;
  }
}

function get3DNodeColor(node) {
  var t = node._type || 'sub-task';
  var status = (node._props || {}).status || 'pending';
  // 主任务: 深绿色系
  if (t === 'main-task') {
    return MAIN_TASK_STATUS_COLORS[status] || MAIN_TASK_STATUS_COLORS.pending;
  }
  // 子任务: pending=暖肤色, completed=亮绿色
  if (t === 'sub-task') {
    return SUB_TASK_STATUS_COLORS[status] || SUB_TASK_STATUS_COLORS.pending;
  }
  return NODE_3D_COLORS[t] || '#6b7280';
}

function get3DLinkColor(link) {
  var label = link._label || '';
  if (label === 'has_main_task') return 'rgba(147,197,253,0.18)';
  if (label === 'has_sub_task')  return 'rgba(129,140,248,0.12)';
  if (label === 'has_document')  return 'rgba(96,165,250,0.10)';
  if (label === 'has_module')    return 'rgba(255,102,0,0.18)';
  if (label === 'module_has_task') return 'rgba(255,102,0,0.15)';
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

/** 创建环形纹理 (用于呼吸灯脉冲环 Sprite, 始终面向相机) */
function createRingTexture(color, size) {
  var canvas = document.createElement('canvas');
  canvas.width = size || 128;
  canvas.height = size || 128;
  var ctx = canvas.getContext('2d');
  var cx = canvas.width / 2, cy = canvas.height / 2;
  var r = cx * 0.75;
  // 外圈辉光
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = color ? colorWithAlpha(color, 0.15) : 'rgba(139,92,246,0.15)';
  ctx.lineWidth = cx * 0.35;
  ctx.stroke();
  // 主环
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = color || '#8b5cf6';
  ctx.lineWidth = cx * 0.1;
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  return canvas;
}

// 缓存 glow 纹理 (避免每个节点重复创建)
var _glowTextureCache = {};

// Phase-75: 边类型 → 高亮色映射 (提升为全局，供增量注入使用)
var LINK_3D_HIGHLIGHT_COLORS = {
  'has_main_task':   '#93c5fd',
  'has_sub_task':    '#818cf8',
  'has_document':    '#60a5fa',
  'has_module':      '#ff8533',
  'module_has_task': '#ff8533',
  'task_has_doc':    '#f59e0b',
  'doc_has_child':   '#c084fc'
};

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

  // 使用全局 LINK_3D_HIGHLIGHT_COLORS (Phase-75: 提升为全局供增量注入使用)

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
      _highlightColor: LINK_3D_HIGHLIGHT_COLORS[e._label] || '#a5b4fc',
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

  // ── 单击/双击判定状态 ──
  var _3dClickTimer = null;
  var _3dClickCount = 0;
  var _3dPendingClickNode = null;

  /** 双击聚焦: 计算节点及其所有关联节点的包围球, 将摄像机拉到刚好能完整显示的位置 */
  function focus3DNodeWithNeighbors(node) {
    // 收集目标节点 + 所有邻居节点的坐标
    var points = [{ x: node.x || 0, y: node.y || 0, z: node.z || 0 }];
    var neighbors = _3dNodeNeighbors[node.id];
    if (neighbors) {
      neighbors.forEach(function(nId) {
        for (var i = 0; i < nodes3d.length; i++) {
          if (nodes3d[i].id === nId) {
            points.push({ x: nodes3d[i].x || 0, y: nodes3d[i].y || 0, z: nodes3d[i].z || 0 });
            break;
          }
        }
      });
    }

    // 计算质心
    var cx = 0, cy = 0, cz = 0;
    for (var i = 0; i < points.length; i++) {
      cx += points[i].x; cy += points[i].y; cz += points[i].z;
    }
    cx /= points.length; cy /= points.length; cz /= points.length;

    // 计算包围球半径 (到质心的最大距离)
    var maxR = 0;
    for (var i = 0; i < points.length; i++) {
      var dx = points[i].x - cx, dy = points[i].y - cy, dz = points[i].z - cz;
      var r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r > maxR) maxR = r;
    }

    // 摄像机距离: 包围球半径 × 系数, 确保所有节点都在视锥内
    // 系数 2.8 ~ 3.2 可保证 FOV ≈ 70° 时完整可见, 加 padding 余量
    var camDist = Math.max(maxR * 3.0, 80);

    // 摄像机位于质心的斜上方偏移, 提供良好的 3D 视角
    try {
      graph3d.cameraPosition(
        { x: cx + camDist * 0.58, y: cy + camDist * 0.42, z: cz + camDist * 0.68 },
        { x: cx, y: cy, z: cz },
        1200
      );
    } catch(e) {}
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
      // 所有节点始终保持原色（不变暗），仅通过连线变化体现选中关系
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
      // 节点始终保持原色（不变暗），仅通过连线变化体现选中关系
      var isHighlighted = _3dSelectedNodeId && _3dHighlightNodes.has(n.id);

      // ── 创建容器 Group ──
      var group = new THREE.Group();

      // ── 节点几何体 (核心实体) ──
      var coreMesh;
      if (t === 'module') {
        var size = 10;
        var geo = new THREE.BoxGeometry(size, size, size);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity, emissive: color, emissiveIntensity: 0.3 });
        coreMesh = new THREE.Mesh(geo, mat);
      } else if (t === 'project') {
        var geo = new THREE.OctahedronGeometry(14);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity, emissive: color, emissiveIntensity: 0.4 });
        coreMesh = new THREE.Mesh(geo, mat);
      } else if (t === 'document') {
        var geo = new THREE.BoxGeometry(7, 8.5, 2);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity * 0.92, emissive: color, emissiveIntensity: 0.25 });
        coreMesh = new THREE.Mesh(geo, mat);
      } else {
        // 主任务 / 子任务 → 球体
        var radius = t === 'main-task' ? 5.5 : 3.5;
        var geo = new THREE.SphereGeometry(radius, 16, 12);
        var mat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: _s3d.nodeOpacity, emissive: color, emissiveIntensity: 0.3 });
        coreMesh = new THREE.Mesh(geo, mat);
      }
      group.add(coreMesh);

      // ── 发光光晕 Sprite (Glow Aura) ──
      if (true) {
        var glowSize = { 'project': 60, 'module': 40, 'main-task': 26, 'sub-task': 18, 'document': 22 }[t] || 16;

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

      // ── in_progress 主任务: 呼吸脉冲光效 (参考 vis-network 发光效果) ──
      var nodeStatus = (n._props || {}).status || 'pending';
      if (t === 'main-task' && nodeStatus === 'in_progress') {
        // 增强核心球体自发光强度
        if (coreMesh && coreMesh.material) {
          coreMesh.material.emissiveIntensity = 0.6;
        }

        // 1) 外层脉冲光晕 Sprite (大范围弥散辉光, 类似 vis-network outerGlow)
        var pulseGlowSize = 55;
        var pulseColor = '#7c3aed';
        var pulseCacheKey = pulseColor + '_pulse';
        if (!_glowTextureCache[pulseCacheKey]) {
          _glowTextureCache[pulseCacheKey] = new THREE.CanvasTexture(createGlowTexture(pulseColor, 128));
        }
        var pulseSpriteMat = new THREE.SpriteMaterial({
          map: _glowTextureCache[pulseCacheKey],
          transparent: true,
          opacity: 0.25,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        var pulseSprite = new THREE.Sprite(pulseSpriteMat);
        pulseSprite.scale.set(pulseGlowSize, pulseGlowSize, 1);
        group.add(pulseSprite);

        // 2) 外圈脉冲环 Sprite (billboard, 始终面向相机)
        var outerRingSize = 35;
        var outerRingCacheKey = '#8b5cf6_ring';
        if (!_glowTextureCache[outerRingCacheKey]) {
          _glowTextureCache[outerRingCacheKey] = new THREE.CanvasTexture(createRingTexture('#8b5cf6', 128));
        }
        var outerRingMat = new THREE.SpriteMaterial({
          map: _glowTextureCache[outerRingCacheKey],
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        var outerRingSprite = new THREE.Sprite(outerRingMat);
        outerRingSprite.scale.set(outerRingSize, outerRingSize, 1);
        group.add(outerRingSprite);

        // 3) 内圈脉冲环 Sprite (更紧凑)
        var innerRingSize = 22;
        var innerRingCacheKey = '#a78bfa_ring';
        if (!_glowTextureCache[innerRingCacheKey]) {
          _glowTextureCache[innerRingCacheKey] = new THREE.CanvasTexture(createRingTexture('#a78bfa', 128));
        }
        var innerRingMat = new THREE.SpriteMaterial({
          map: _glowTextureCache[innerRingCacheKey],
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        var innerRingSprite = new THREE.Sprite(innerRingMat);
        innerRingSprite.scale.set(innerRingSize, innerRingSize, 1);
        group.add(innerRingSprite);

        // 记录到呼吸灯列表
        _3dBreathItems.push({
          sprite: pulseSprite,
          ring1: outerRingSprite,
          ring2: innerRingSprite,
          baseScale: pulseGlowSize,
          ring1Base: outerRingSize,
          ring2Base: innerRingSize
        });
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
    // ── 交互事件: 单击/双击区分 ──
    .onNodeClick(function(node, event) {
      if (!node) return;
      _3dPendingClickNode = node;
      _3dClickCount++;
      if (_3dClickCount === 1) {
        // 第一次点击: 等待判定是否双击
        _3dClickTimer = setTimeout(function() {
          _3dClickCount = 0;
          // 单击: 高亮 + 面板
          update3DHighlight(node.id);
          refresh3DStyles();
          panelHistory = [];
          currentPanelNodeId = null;
          showPanel(node.id);
        }, 280);
      } else if (_3dClickCount >= 2) {
        // 双击: 取消单击定时器
        clearTimeout(_3dClickTimer);
        _3dClickCount = 0;
        // 高亮 + 面板 + 聚焦到节点及其关联节点
        update3DHighlight(node.id);
        refresh3DStyles();
        panelHistory = [];
        currentPanelNodeId = null;
        showPanel(node.id);
        focus3DNodeWithNeighbors(node);
      }
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

  /** 刷新连线视觉样式（节点不变，仅刷新边的颜色/宽度/粒子） */
  function refresh3DStyles() {
    graph3d.linkColor(graph3d.linkColor())
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

  // ========== 布局模式分支 ==========
  var _isOrbital = (_s3d.layoutMode === 'orbital');

  if (_isOrbital) {
    // ╔══════════════════════════════════════════════════════╗
    // ║  🪐 行星轨道布局 (Solar System Orbital Layout)      ║
    // ║  节点按类型排列在固定间距的同心轨道上                ║
    // ╚══════════════════════════════════════════════════════╝
    var _orbitSpacing = _s3d.orbitSpacing;     // 轨道间距
    var _orbitStrength = _s3d.orbitStrength;   // 轨道引力
    var _orbitFlatten = _s3d.orbitFlatten;     // Z 轴压平力度

    // 节点类型 → 轨道编号 (类似: 太阳→水星→金星→地球→火星)
    var ORBIT_MAP = {
      'project':   0,   // ☀ 太阳 — 中心
      'module':    1,   // ☿ 水星 — 第 1 轨道
      'main-task': 2,   // ♀ 金星 — 第 2 轨道
      'sub-task':  3,   // ♂ 火星 — 第 3 轨道
      'document':  4    // ♃ 木星 — 第 4 轨道
    };
    var _maxOrbit = 4;

    // 为每个节点计算目标轨道半径
    for (var i = 0; i < nodes3d.length; i++) {
      var orbitIdx = ORBIT_MAP[nodes3d[i]._type] || 3;
      nodes3d[i]._orbitRadius = orbitIdx * _orbitSpacing;
      nodes3d[i]._orbitIndex = orbitIdx;
    }

    // ── 减弱排斥力 (轨道模式下不需要强排斥) ──
    graph3d.d3Force('charge').strength(function(n) {
      var t = n._type || 'sub-task';
      if (t === 'project') return -5;   // 几乎不排斥
      if (t === 'module') return -15;
      return -8;
    });

    // ── 连接距离使用轨道间距 ──
    graph3d.d3Force('link').distance(function(l) {
      return _orbitSpacing * 0.8;
    }).strength(0.3); // 较弱的连接力，让轨道力主导

    // ── 关闭默认中心引力 (由轨道力取代) ──
    try {
      var fg = graph3d.d3Force;
      if (fg('x')) fg('x').strength(0);
      if (fg('y')) fg('y').strength(0);
      if (fg('z')) fg('z').strength(0);
    } catch(e) {}

    // ── 自定义行星轨道力 ──
    // 将节点拉向其目标轨道半径，同时压平 Z 轴形成太阳系圆盘
    var orbitalForce = (function() {
      var _nodes;
      function force(alpha) {
        for (var i = 0; i < _nodes.length; i++) {
          var n = _nodes[i];
          var targetR = n._orbitRadius || 0;
          var dx = n.x || 0;
          var dy = n.y || 0;
          var dz = n.z || 0;

          if (targetR === 0) {
            // 项目节点 (太阳): 强力拉向原点
            n.vx = (n.vx || 0) - dx * 0.1 * alpha;
            n.vy = (n.vy || 0) - dy * 0.1 * alpha;
            n.vz = (n.vz || 0) - dz * 0.1 * alpha;
            continue;
          }

          // XY 平面径向距离
          var xyDist = Math.sqrt(dx * dx + dy * dy);
          if (xyDist > 0.001) {
            // 径向力: 将节点拉向目标轨道半径
            var radialK = (targetR - xyDist) / xyDist * _orbitStrength * alpha;
            n.vx = (n.vx || 0) + dx * radialK;
            n.vy = (n.vy || 0) + dy * radialK;
          } else {
            // 节点几乎在原点: 给一个随机方向的推力
            var angle = Math.random() * Math.PI * 2;
            n.vx = (n.vx || 0) + Math.cos(angle) * _orbitStrength * alpha * targetR * 0.1;
            n.vy = (n.vy || 0) + Math.sin(angle) * _orbitStrength * alpha * targetR * 0.1;
          }

          // Z 轴压平力: 越大越扁 (0=球壳, 1=完全平面)
          n.vz = (n.vz || 0) - dz * _orbitFlatten * _orbitStrength * alpha * 2;
        }
      }
      force.initialize = function(nodes) { _nodes = nodes; };
      return force;
    })();

    graph3d.d3Force('orbital', orbitalForce);

    log('🪐 行星轨道布局: 间距=' + _orbitSpacing + ', 强度=' + _orbitStrength + ', 压平=' + _orbitFlatten, true);

  } else {
    // ╔══════════════════════════════════════════════════════╗
    // ║  ⚡ 力导向布局 (默认 Force-directed)                ║
    // ╚══════════════════════════════════════════════════════╝
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

    // ── 🌍 类型分层力 (Type Separation) ──
    // 不同类型节点按固定间距分布在不同轨道层上，类似天体间距
    // project(中心) → module(层1) → document(层2) → main-task(层3) → sub-task(层4)
    if (_s3d.typeSeparation && _s3d.typeSepStrength > 0) {
      var _typeSepSpacing = _s3d.typeSepSpacing;
      var _typeSepK = _s3d.typeSepStrength;  // 0~1 控制力强度

      // 节点类型 → 轨道层编号
      var TYPE_BAND = {
        'project':   0,   // ☀ 中心
        'module':    1,   // 层 1 — 功能模块 (最近)
        'document':  2,   // 层 2 — 文档
        'main-task': 3,   // 层 3 — 主任务
        'sub-task':  4    // 层 4 — 子任务 (最远)
      };

      // 为每个节点计算目标轨道半径
      for (var i = 0; i < nodes3d.length; i++) {
        var band = TYPE_BAND[nodes3d[i]._type];
        if (band === undefined) band = 4;
        nodes3d[i]._targetBand = band;
        nodes3d[i]._targetRadius = band * _typeSepSpacing;
      }

      // 开启分层时: 保留较强排斥力让同层节点互相散开（尤其子任务数量多）
      // 分层力控制径向距离，排斥力控制同层内散布
      graph3d.d3Force('charge').strength(function(n) {
        var t = n._type || 'sub-task';
        if (t === 'project') return _repulsion * 3;      // 项目: 3x
        if (t === 'module') return _repulsion * 1.5;      // 模块: 1.5x
        if (t === 'main-task') return _repulsion * 1;     // 主任务: 1x
        if (t === 'sub-task') return _repulsion * 0.8;    // 子任务: 0.8x (数量多，需要足够散开)
        return _repulsion * 0.6;                          // 文档: 0.6x
      });

      // 削弱连接力，避免连线把不同层的节点拽到一起
      graph3d.d3Force('link').strength(function(l) {
        var label = l._label || '';
        if (label === 'has_main_task' || label === 'has_module' || label === 'module_has_task') return 0.15;
        return 0.1;
      });

      // 自定义 D3 力: 强径向弹簧，将节点拉向目标轨道半径
      var typeSepForce = (function() {
        var _nodes;
        function force(alpha) {
          // 找到项目节点（太阳/中心）
          var cx = 0, cy = 0, cz = 0, projectFound = false;
          for (var i = 0; i < _nodes.length; i++) {
            if (_nodes[i]._type === 'project') {
              cx = _nodes[i].x || 0;
              cy = _nodes[i].y || 0;
              cz = _nodes[i].z || 0;
              projectFound = true;
              break;
            }
          }
          if (!projectFound) {
            // 无项目节点: 使用质心
            for (var i = 0; i < _nodes.length; i++) {
              cx += (_nodes[i].x || 0);
              cy += (_nodes[i].y || 0);
              cz += (_nodes[i].z || 0);
            }
            cx /= _nodes.length; cy /= _nodes.length; cz /= _nodes.length;
          }

          for (var i = 0; i < _nodes.length; i++) {
            var n = _nodes[i];
            var targetR = n._targetRadius || 0;

            if (targetR === 0) {
              // 项目节点: 强力锚定在原点
              n.vx = (n.vx || 0) - (n.x || 0) * 0.1 * alpha;
              n.vy = (n.vy || 0) - (n.y || 0) * 0.1 * alpha;
              n.vz = (n.vz || 0) - (n.z || 0) * 0.1 * alpha;
              continue;
            }

            var dx = (n.x || 0) - cx;
            var dy = (n.y || 0) - cy;
            var dz = (n.z || 0) - cz;
            var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < 0.5) {
              // 节点太靠近中心: 随机方向推出去
              var angle = Math.random() * Math.PI * 2;
              var phi = (Math.random() - 0.5) * Math.PI * 0.3;
              n.vx = (n.vx || 0) + Math.cos(angle) * Math.cos(phi) * targetR * _typeSepK * alpha * 0.5;
              n.vy = (n.vy || 0) + Math.sin(angle) * Math.cos(phi) * targetR * _typeSepK * alpha * 0.5;
              n.vz = (n.vz || 0) + Math.sin(phi) * targetR * _typeSepK * alpha * 0.2;
              continue;
            }

            // 径向弹簧力: F = k * (targetR - dist) / dist * direction
            // 这是一个真正的弹簧——偏差越大推力越大，没有上限截断
            var diff = targetR - dist;
            var k = _typeSepK * alpha;
            var radialAccel = diff * k;

            var invDist = 1 / dist;
            n.vx = (n.vx || 0) + dx * invDist * radialAccel;
            n.vy = (n.vy || 0) + dy * invDist * radialAccel;
            n.vz = (n.vz || 0) + dz * invDist * radialAccel;
          }
        }
        force.initialize = function(nodes) { _nodes = nodes; };
        return force;
      })();

      graph3d.d3Force('typeSeparation', typeSepForce);
      log('🌍 类型分层: 模块@' + _typeSepSpacing + ' 文档@' + (_typeSepSpacing*2) + ' 主任务@' + (_typeSepSpacing*3) + ' 子任务@' + (_typeSepSpacing*4) + ' 强度=' + _typeSepK, true);
    }
  }

  // 注入数据
  _3dBreathItems = []; // 重置呼吸灯列表 (nodeThreeObject 回调会填充)
  graph3d.graphData({ nodes: nodes3d, links: links3d });

  // ── 3D 呼吸灯: nodeThreeObject 回调在下一帧才执行, 需延迟检测 ──
  stop3DBreathAnimation();
  function _checkAndStartBreath() {
    if (_3dBreathItems.length > 0 && !_3dBreathAnimId) {
      start3DBreathAnimation();
      log('3D 呼吸灯: 检测到 ' + _3dBreathItems.length + ' 个进行中主任务', true);
    }
  }
  // 多次检测: 300ms (首帧渲染后) + 1500ms (大数据集延迟)
  setTimeout(_checkAndStartBreath, 300);
  setTimeout(_checkAndStartBreath, 1500);

  // ── 🪐 行星轨道: 绘制轨道环线 (Three.js) ──
  if (_isOrbital && _s3d.showOrbits) {
    try {
      var scene = graph3d.scene();
      if (scene && typeof THREE !== 'undefined') {
        var orbitColors = [
          null,          // orbit 0 (project = center, no ring)
          '#ff6600',     // orbit 1 (module) — 橙色
          '#2563eb',     // orbit 2 (document) — 蓝色
          '#047857',     // orbit 3 (main-task) — 深绿
          '#e8956a'      // orbit 4 (sub-task) — 暖肤色
        ];
        var orbitLabels = ['', '模块', '文档', '主任务', '子任务'];
        for (var oi = 1; oi <= _maxOrbit; oi++) {
          var radius = oi * _s3d.orbitSpacing;
          // 使用 THREE.RingGeometry 创建环形 (内径 略小于 外径)
          var ringGeo = new THREE.RingGeometry(radius - 0.3, radius + 0.3, 128);
          var ringColor = orbitColors[oi] || '#334466';
          var ringMat = new THREE.MeshBasicMaterial({
            color: ringColor,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          var ringMesh = new THREE.Mesh(ringGeo, ringMat);
          // 将环放到 XY 平面 (z=0)，不需要旋转因为 RingGeometry 默认在 XY 平面
          ringMesh.renderOrder = -1; // 渲染在节点之后
          scene.add(ringMesh);

          // 添加虚线发光效果 (第二层更宽的半透明环)
          var glowGeo = new THREE.RingGeometry(radius - 1.5, radius + 1.5, 128);
          var glowMat = new THREE.MeshBasicMaterial({
            color: ringColor,
            transparent: true,
            opacity: 0.04,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          var glowMesh = new THREE.Mesh(glowGeo, glowMat);
          glowMesh.renderOrder = -2;
          scene.add(glowMesh);
        }
        log('轨道环线: ' + _maxOrbit + ' 条轨道已绘制', true);
      }
    } catch(e) {
      console.warn('Orbit rings error:', e);
    }
  }

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
      // 停止 3D 呼吸灯动画
      stop3DBreathAnimation();
      _3dBreathItems = [];
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
    focus: function(nodeId, opts) {
      // vis-network 兼容: 聚焦到指定节点（3D 版本 — 平滑移动摄像机）
      if (!graph3d) return;
      var nodes3dAll = graph3d.graphData().nodes;
      var target = null;
      for (var i = 0; i < nodes3dAll.length; i++) {
        if (nodes3dAll[i].id === nodeId) { target = nodes3dAll[i]; break; }
      }
      if (!target || target.x === undefined) return;
      var dur = (opts && opts.animation && opts.animation.duration) || 600;
      var dist = 200; // 合理的聚焦距离
      graph3d.cameraPosition(
        { x: target.x, y: target.y, z: (target.z || 0) + dist },
        { x: target.x, y: target.y, z: target.z || 0 },
        dur
      );
    },
    selectNodes: function(ids) {
      if (ids && ids.length > 0) {
        update3DHighlight(ids[0]);
        refresh3DStyles();
      } else {
        update3DHighlight(null);
        refresh3DStyles();
      }
    },
    getConnectedEdges: function(nodeId) {
      // 返回关联边 ID 列表（用于 highlightConnectedEdges 兼容）
      var edgeIds = [];
      if (_3dNodeLinks[nodeId]) {
        _3dNodeLinks[nodeId].forEach(function(l) {
          if (l._id) edgeIds.push(l._id);
        });
      }
      return edgeIds;
    },
    on: function(event, cb) {
      // 将 vis-network 事件映射到 3D 事件
      if (event === 'stabilizationIterationsDone') {
        // 3D 力导向约 3 秒后模拟稳定
        setTimeout(function() {
          try { cb(); } catch(e) {}
        }, 3000);
      }
    },
    off: function() {},
    // Phase-75: 增量数据注入 (供渐进式加载 Stage 2/3 使用)
    _addData: function(newNodes3d, newLinks3d) {
      // ── 0) 检测当前布局模式 ──
      var _isOrb = (_s3d.layoutMode === 'orbital');

      // 行星轨道: 类型→轨道编号 (与初始化 ORBIT_MAP 一致)
      var _ORBIT_MAP = { 'project': 0, 'module': 1, 'main-task': 2, 'sub-task': 3, 'document': 4 };
      var _orbSpacing = _s3d.orbitSpacing || 80;

      // 力导向分层: 类型→轨道层 (与初始化 TYPE_BAND 一致)
      var _TYPE_BAND = { 'project': 0, 'module': 1, 'document': 2, 'main-task': 3, 'sub-task': 4 };
      var _sepSpacing = _s3d.typeSepSpacing || 80;
      var _doTypeSep = !_isOrb && _s3d.typeSeparation && _s3d.typeSepStrength > 0;

      // ── 建立已有节点索引 ──
      var curData = graph3d.graphData();
      var existNodeMap = {};
      for (var ei = 0; ei < curData.nodes.length; ei++) {
        existNodeMap[curData.nodes[ei].id] = curData.nodes[ei];
      }

      // ── 建立新边的父子关系映射 ──
      var newNodeParent = {};
      for (var li = 0; li < newLinks3d.length; li++) {
        var lnk = newLinks3d[li];
        var srcId = typeof lnk.source === 'object' ? lnk.source.id : lnk.source;
        var tgtId = typeof lnk.target === 'object' ? lnk.target.id : lnk.target;
        if (existNodeMap[srcId] && !existNodeMap[tgtId]) {
          newNodeParent[tgtId] = existNodeMap[srcId];
        } else if (existNodeMap[tgtId] && !existNodeMap[srcId]) {
          newNodeParent[srcId] = existNodeMap[tgtId];
        }
      }

      // ── 为每个新节点设置布局属性 + 初始位置 ──
      for (var ni = 0; ni < newNodes3d.length; ni++) {
        var nn = newNodes3d[ni];
        var nodeTargetR = 200; // 默认目标半径

        if (_isOrb) {
          // ★ 行星轨道模式: 设置 _orbitRadius / _orbitIndex
          var orbIdx = _ORBIT_MAP[nn._type];
          if (orbIdx === undefined) orbIdx = 3;
          nn._orbitIndex = orbIdx;
          nn._orbitRadius = orbIdx * _orbSpacing;
          nodeTargetR = nn._orbitRadius;
        } else if (_doTypeSep) {
          // ★ 力导向分层模式: 设置 _targetBand / _targetRadius
          var band = _TYPE_BAND[nn._type];
          if (band === undefined) band = 4;
          nn._targetBand = band;
          nn._targetRadius = band * _sepSpacing;
          nodeTargetR = nn._targetRadius;
        }

        // ── 智能初始位置 ──
        var parent = newNodeParent[nn.id];
        if (_isOrb && nodeTargetR > 0) {
          // 行星轨道模式: 直接放置在目标轨道上 (XY 平面圆环 + 微小 Z 偏移)
          // 这样轨道力只需微调，不用从远处飞入
          var orbAngle = Math.random() * Math.PI * 2;
          var orbJitter = nodeTargetR * 0.1; // 10% 抖动
          nn.x = Math.cos(orbAngle) * (nodeTargetR + (Math.random() - 0.5) * orbJitter);
          nn.y = Math.sin(orbAngle) * (nodeTargetR + (Math.random() - 0.5) * orbJitter);
          nn.z = (Math.random() - 0.5) * nodeTargetR * 0.05; // 极小的 Z 偏移 (扁平)
        } else if (parent && parent.x !== undefined) {
          // 力导向模式: 从父节点向外延伸
          var px = parent.x || 0, py = parent.y || 0, pz = parent.z || 0;
          var pDist = Math.sqrt(px*px + py*py + pz*pz);
          var spread = (_doTypeSep ? _sepSpacing : 50) * (0.5 + Math.random() * 0.5);
          if (pDist > 1) {
            nn.x = px + (px / pDist) * spread + (Math.random() - 0.5) * spread * 0.6;
            nn.y = py + (py / pDist) * spread + (Math.random() - 0.5) * spread * 0.6;
            nn.z = pz + (pz / pDist) * spread * 0.3 + (Math.random() - 0.5) * spread * 0.3;
          } else {
            var randA = Math.random() * Math.PI * 2;
            nn.x = Math.cos(randA) * spread;
            nn.y = Math.sin(randA) * spread;
            nn.z = (Math.random() - 0.5) * spread * 0.3;
          }
        } else {
          // 无父节点 → 按目标半径随机放置
          var trFallback = nodeTargetR > 0 ? nodeTargetR : 200;
          var rJitter = trFallback * (0.8 + Math.random() * 0.4);
          var aFallback = Math.random() * Math.PI * 2;
          var pFallback = (Math.random() - 0.5) * Math.PI * 0.3;
          nn.x = Math.cos(aFallback) * Math.cos(pFallback) * rJitter;
          nn.y = Math.sin(aFallback) * Math.cos(pFallback) * rJitter;
          nn.z = Math.sin(pFallback) * rJitter * 0.3;
        }
      }

      // ── 1) 更新邻接表 ──
      for (var ai = 0; ai < newLinks3d.length; ai++) {
        var al = newLinks3d[ai];
        var aSrcId = typeof al.source === 'object' ? al.source.id : al.source;
        var aTgtId = typeof al.target === 'object' ? al.target.id : al.target;
        if (!_3dNodeNeighbors[aSrcId]) _3dNodeNeighbors[aSrcId] = new Set();
        if (!_3dNodeNeighbors[aTgtId]) _3dNodeNeighbors[aTgtId] = new Set();
        _3dNodeNeighbors[aSrcId].add(aTgtId);
        _3dNodeNeighbors[aTgtId].add(aSrcId);
        if (!_3dNodeLinks[aSrcId]) _3dNodeLinks[aSrcId] = new Set();
        if (!_3dNodeLinks[aTgtId]) _3dNodeLinks[aTgtId] = new Set();
        _3dNodeLinks[aSrcId].add(al);
        _3dNodeLinks[aTgtId].add(al);
      }
      // ── 2) 合并到 graph3d 数据 ──
      var mNodes = curData.nodes.concat(newNodes3d);
      var mLinks = curData.links.concat(newLinks3d);
      graph3d.graphData({ nodes: mNodes, links: mLinks });
      // ── 3) reheat 让力模拟推动新节点到正确轨道/层 ──
      setTimeout(function() {
        try { graph3d.d3ReheatSimulation(); } catch(e) {}
      }, 100);
    },
    // Phase-75: 增量移除 (供折叠等操作使用)
    _removeData: function(removeNodeIds) {
      var removeSet = {};
      for (var ri = 0; ri < removeNodeIds.length; ri++) removeSet[removeNodeIds[ri]] = true;
      // 清理邻接表
      for (var ri = 0; ri < removeNodeIds.length; ri++) {
        delete _3dNodeNeighbors[removeNodeIds[ri]];
        delete _3dNodeLinks[removeNodeIds[ri]];
      }
      // 从图数据中移除
      var curData = graph3d.graphData();
      var fNodes = curData.nodes.filter(function(n) { return !removeSet[n.id]; });
      var fLinks = curData.links.filter(function(l) {
        var sId = typeof l.source === 'object' ? l.source.id : l.source;
        var tId = typeof l.target === 'object' ? l.target.id : l.target;
        return !removeSet[sId] && !removeSet[tId];
      });
      graph3d.graphData({ nodes: fNodes, links: fLinks });
    }
  };

  networkReusable = true; // Phase-75: 3D 模式支持增量更新 (via _addData)

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

/* handle3DNodeClick 已移除 — 3D 引擎现在使用共享的 showPanel() */



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
        html += '<li class="subtask-item" style="cursor:pointer;" onclick="navigateToPanel(\x27' + doc.id + '\x27)">';
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
        html += '<li class="subtask-item" style="cursor:pointer;" onclick="navigateToPanel(\x27' + task.id + '\x27)">';
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
    if (p.sourceRef && p.sourceRef.sourceId) {
      html += row('来源ID', p.sourceRef.sourceId);
      if (p.sourceRef.variant) html += row('来源变体', p.sourceRef.variant);
    }
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
  var lines = md.split('\n');
  var result = [];
  var pipeBlock = [];

  function flushBlock() {
    if (pipeBlock.length < 1) return;
    // 检查此块前方是否紧跟分隔行（说明已有表头）
    var prevIdx = result.length - 1;
    var hasSep = false;
    // 块内是否已有分隔行
    for (var k = 0; k < pipeBlock.length; k++) {
      if (/^\|[\s\-:|]+\|\s*$/.test(pipeBlock[k])) { hasSep = true; break; }
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
    if (/^\|.+\|\s*$/.test(line)) {
      pipeBlock.push(line);
    } else {
      if (pipeBlock.length > 0) flushBlock();
      result.push(line);
    }
  }
  if (pipeBlock.length > 0) flushBlock();
  return result.join('\n');
}

/** Markdown 渲染 — 优先使用 marked.js（CDN），降级到简易解析器 */
function renderMarkdown(md) {
  if (!md) return '';

  // 预处理：修复字面 \n 文本为真实换行符（部分文档存储时换行被转义）
  if (md.indexOf('\\n') !== -1) {
    md = md.replace(/\\n/g, '\n');
  }

  // 预处理：修复孤立管道行
  md = fixOrphanPipeRows(md);

  // 优先使用 marked.js（由 MD Viewer CDN 加载）
  if (typeof marked !== 'undefined') {
    try { return marked.parse(md); } catch(e) { console.warn('marked.parse fallback:', e); }
  }

  // 先处理代码块（防止内部被其他规则干扰）
  var codeBlocks = [];
  md = md.replace(/```(\w*)?\n([\s\S]*?)```/g, function(m, lang, code) {
    var idx = codeBlocks.length;
    codeBlocks.push('<pre><code>' + escHtml(code.replace(/\n$/, '')) + '</code></pre>');
    return '%%CODEBLOCK_' + idx + '%%';
  });

  // 按行处理
  var lines = md.split('\n');
  var html = '';
  var inTable = false;
  var inList = false;
  var listType = '';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // 代码块占位符
    var cbMatch = line.match(/^%%CODEBLOCK_(\d+)%%$/);
    if (cbMatch) {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      if (inTable) { html += '</table>'; inTable = false; }
      html += codeBlocks[parseInt(cbMatch[1])];
      continue;
    }

    // 表格行
    if (line.match(/^\|(.+)\|\s*$/)) {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      // 跳过分隔行
      if (line.match(/^\|[\s\-:|]+\|\s*$/)) continue;
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
    var hMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      var level = hMatch[1].length;
      html += '<h' + level + '>' + inlineFormat(hMatch[2]) + '</h' + level + '>';
      continue;
    }

    // 分隔线
    if (line.match(/^(\*{3,}|-{3,}|_{3,})\s*$/)) {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      html += '<hr>';
      continue;
    }

    // 引用
    if (line.match(/^>\s?/)) {
      if (inList) { html += '</' + listType + '>'; inList = false; }
      html += '<blockquote>' + inlineFormat(line.replace(/^>\s?/, '')) + '</blockquote>';
      continue;
    }

    // 无序列表
    var ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
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
    var olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
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
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 粗体
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // 斜体
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/_(.+?)_/g, '<em>$1</em>');
  // 链接
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  return text;
}



// ========== Stats Modal ==========
var _statsMainTaskMoreMenu = null;
var _statsMainTaskMoreBtn = null;

function closeMainTaskMoreMenu() {
  if (_statsMainTaskMoreMenu && _statsMainTaskMoreMenu.parentNode) {
    _statsMainTaskMoreMenu.parentNode.removeChild(_statsMainTaskMoreMenu);
  }
  _statsMainTaskMoreMenu = null;
  _statsMainTaskMoreBtn = null;
}

function ensureStatsMoreMenuGlobalClose() {
  if (window.__statsMoreMenuBound) return;
  window.__statsMoreMenuBound = true;
  document.addEventListener('click', function() { closeMainTaskMoreMenu(); });
}

function toggleMainTaskMoreMenu(btn, taskId, nodeId, status) {
  ensureStatsMoreMenuGlobalClose();
  if (!btn) return;
  var sameBtn = _statsMainTaskMoreBtn === btn;
  closeMainTaskMoreMenu();
  if (sameBtn) return;

  var safeNodeId = String(nodeId || '').replace(/'/g, "\\'");
  var safeTaskId = String(taskId || '').replace(/'/g, "\\'");
  var menu = document.createElement('div');
  menu.className = 'stats-modal-more-menu';
  var menuHtml = '';
  menuHtml += '<button class="stats-modal-more-item" onclick="event.stopPropagation();refreshSingleMainTask(\x27' + safeNodeId + '\x27,\x27' + safeTaskId + '\x27,event)">🔄 刷新</button>';
  if (status === 'pending') {
    menuHtml += '<button class="stats-modal-more-item" onclick="event.stopPropagation();markMainTaskStatus(\x27' + safeNodeId + '\x27,\x27' + safeTaskId + '\x27,\x27completed\x27,event)">✅ 标记为完成</button>';
    menuHtml += '<button class="stats-modal-more-item" onclick="event.stopPropagation();markMainTaskStatus(\x27' + safeNodeId + '\x27,\x27' + safeTaskId + '\x27,\x27cancelled\x27,event)">🚫 标记为废弃</button>';
  }
  menu.innerHTML = menuHtml;
  menu.addEventListener('click', function(e) { e.stopPropagation(); });
  btn.parentNode.appendChild(menu);
  _statsMainTaskMoreMenu = menu;
  _statsMainTaskMoreBtn = btn;
}

function findMainTaskNode(nodeId, taskId) {
  if (nodeId) {
    for (var i = 0; i < allNodes.length; i++) {
      if (allNodes[i].id === nodeId) return allNodes[i];
    }
  }
  if (taskId) {
    for (var j = 0; j < allNodes.length; j++) {
      var n = allNodes[j];
      if (n.type === 'main-task' && (n.properties || {}).taskId === taskId) return n;
    }
  }
  return null;
}

function refreshSingleMainTask(nodeId, taskId, e) {
  if (e) e.stopPropagation();
  closeMainTaskMoreMenu();
  if (!taskId) return;
  fetch('/api/main-task?taskId=' + encodeURIComponent(taskId))
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data) {
      var target = findMainTaskNode(nodeId, taskId);
      if (!target) return;

      target.label = data.title || target.label;
      var props = target.properties || {};
      props.taskId = data.taskId || props.taskId;
      props.status = data.status || props.status;
      props.totalSubtasks = data.totalSubtasks != null ? data.totalSubtasks : props.totalSubtasks;
      props.completedSubtasks = data.completedSubtasks != null ? data.completedSubtasks : props.completedSubtasks;
      props.completedAt = data.completedAt != null ? data.completedAt : props.completedAt;
      target.properties = props;

      if (nodesDataSet && typeof nodesDataSet.get === 'function' && nodesDataSet.get(target.id)) {
        nodesDataSet.update({
          id: target.id,
          label: target.label,
          properties: props,
          status: props.status,
        });
      }
      if (network && typeof network.redraw === 'function') {
        network.redraw();
      }

      showStatsModal('main-task');
      if (typeof log === 'function') log('主任务已刷新: ' + taskId, true);
    })
    .catch(function(err) {
      if (typeof log === 'function') log('刷新主任务失败: ' + err.message, false);
    });
}

function markMainTaskStatus(nodeId, taskId, status, e) {
  if (e) e.stopPropagation();
  closeMainTaskMoreMenu();
  if (!taskId || (status !== 'completed' && status !== 'cancelled')) return;
  fetch('/api/main-task/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: taskId, status: status })
  })
    .then(function(r) {
      return r.json().then(function(body) {
        if (!r.ok) throw new Error(body && body.error ? body.error : ('HTTP ' + r.status));
        return body;
      });
    })
    .then(function() {
      refreshSingleMainTask(nodeId, taskId, null);
      if (typeof log === 'function') {
        log('主任务状态已更新: ' + taskId + ' -> ' + status, true);
      }
    })
    .catch(function(err) {
      if (typeof log === 'function') log('更新主任务状态失败: ' + err.message, false);
    });
}

function showStatsModal(nodeType) {
  closeMainTaskMoreMenu();
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
    html += '<div class="stats-modal-item" onclick="statsModalGoToNode(\x27' + n.id + '\x27)">';
    html += '<span class="stats-modal-item-icon">' + icon + '</span>';
    html += '<span class="stats-modal-item-name-wrap">';
    html += '<span class="stats-modal-item-name" title="' + escHtml(n.label) + '">' + escHtml(n.label) + '</span>';
    html += '</span>';
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
    if (nodeType === 'main-task' && p.taskId) {
      html += '<span class="stats-modal-item-actions">';
      html += '<button class="stats-modal-item-more" title="更多操作" onclick="event.stopPropagation();toggleMainTaskMoreMenu(this,\x27' + String(p.taskId).replace(/'/g, "\\'") + '\x27,\x27' + String(n.id).replace(/'/g, "\\'") + '\x27,\x27' + String(st).replace(/'/g, "\\'") + '\x27)">⋯</button>';
      html += '</span>';
    }
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

/** 按文档 key 在当前图谱节点中查找对应 document 节点 ID */
function findGraphDocNodeIdByKey(docKey) {
  var parts = String(docKey || '').split('|');
  var section = parts[0] || '';
  var subSection = parts[1] || '';
  if (!section) return null;
  for (var i = 0; i < allNodes.length; i++) {
    var n = allNodes[i];
    if (!n || n.type !== 'document') continue;
    var p = n.properties || {};
    var s = p.section || '';
    var ss = p.subSection || '';
    if (s === section && ss === subSection) return n.id;
  }
  return null;
}

/** 从共享文档弹层选中文档：图谱页走右侧详情面板；文档页走完整文档详情 */
function globalDocSelect(docKey) {
  // 图谱页上下文：直接复用右侧共享详情面板显示文档（与任务详情一致）
  if (currentPage === 'graph') {
    var docNodeId = findGraphDocNodeIdByKey(docKey);
    if (docNodeId) {
      panelHistory = [];
      currentPanelNodeId = null;
      statsModalGoToNode(docNodeId);
      return;
    }
  }

  // 非图谱页（或图谱未命中节点）回退到文档库完整详情页
  closeStatsModal();
  navTo('docs');
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
        var chevronId = 'prompt-chevron-' + date + '-' + ii;
        // 用于复制的数据 ID
        var rawDataId = 'prompt-raw-' + date + '-' + ii;
        var aiDataId = 'prompt-ai-' + date + '-' + ii;

        html += '<div class="stats-modal-item" style="flex-direction:column;align-items:flex-start;gap:4px;padding:0;cursor:default;">';

        // 可点击的头部区域（点击 toggle 折叠/展开）
        html += '<div class="prompt-item-header" style="display:flex;flex-direction:column;gap:4px;width:100%;padding:10px 20px;cursor:pointer;" onclick="togglePromptExpand(\'' + expandId + '\',\'' + chevronId + '\')">';

        // 第一行：序号 + 摘要/预览 + 时间 + 折叠指示器
        html += '<div style="display:flex;align-items:center;gap:8px;width:100%;">';
        html += '<span style="font-size:12px;font-weight:700;color:#ec4899;flex-shrink:0;">#' + (p.promptIndex || (ii + 1)) + '</span>';
        html += '<span class="stats-modal-item-name" title="' + escHtml(summaryText || contentPreview) + '" style="font-size:13px;">' + escHtml(summaryText || contentPreview) + '</span>';
        html += '<span style="font-size:10px;color:#6b7280;flex-shrink:0;margin-left:auto;white-space:nowrap;">' + timeStr + '</span>';
        html += '<span id="' + chevronId + '" style="font-size:10px;color:#6b7280;flex-shrink:0;transition:transform 0.2s;display:inline-block;">▶</span>';
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

        html += '</div>'; // end header

        // 展开区域（默认隐藏）— 用户原始输入 + AI 理解（点击内容区域不折叠）
        html += '<div id="' + expandId + '" style="display:none;width:100%;padding:6px 20px 10px;border-top:1px solid rgba(75,85,99,0.3);">';

        // 用户原始输入
        html += '<div style="margin-bottom:8px;">';
        html += '<div style="font-size:10px;font-weight:600;color:#9ca3af;margin-bottom:3px;display:flex;align-items:center;gap:4px;">💬 用户原始输入';
        html += '<button class="prompt-copy-btn" onclick="event.stopPropagation();copyPromptText(\'' + rawDataId + '\')" title="复制原始输入" style="margin-left:auto;background:none;border:1px solid rgba(107,114,128,0.4);border-radius:4px;padding:1px 6px;cursor:pointer;color:#9ca3af;font-size:10px;display:flex;align-items:center;gap:3px;transition:all 0.15s;"><span style="font-size:11px;">📋</span> 复制</button>';
        html += '</div>';
        html += '<div id="' + rawDataId + '" style="font-size:12px;color:#d1d5db;background:rgba(31,41,55,0.5);padding:8px 10px;border-radius:6px;border:1px solid rgba(75,85,99,0.3);white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;line-height:1.5;">' + escHtml(rawContent || '(未记录)') + '</div>';
        html += '</div>';

        // AI 理解
        if (aiText) {
          html += '<div style="margin-bottom:4px;">';
          html += '<div style="font-size:10px;font-weight:600;color:#9ca3af;margin-bottom:3px;display:flex;align-items:center;gap:4px;">🤖 AI 理解';
          html += '<button class="prompt-copy-btn" onclick="event.stopPropagation();copyPromptText(\'' + aiDataId + '\')" title="复制 AI 理解" style="margin-left:auto;background:none;border:1px solid rgba(107,114,128,0.4);border-radius:4px;padding:1px 6px;cursor:pointer;color:#9ca3af;font-size:10px;display:flex;align-items:center;gap:3px;transition:all 0.15s;"><span style="font-size:11px;">📋</span> 复制</button>';
          html += '</div>';
          html += '<div id="' + aiDataId + '" style="font-size:12px;color:#a5b4fc;background:rgba(67,56,202,0.12);padding:8px 10px;border-radius:6px;border:1px solid rgba(99,102,241,0.2);white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;line-height:1.5;">' + escHtml(aiText) + '</div>';
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

/** 切换 Prompt 展开/折叠（带 chevron 旋转指示） */
function togglePromptExpand(expandId, chevronId) {
  var el = document.getElementById(expandId);
  if (!el) return;
  var chevron = chevronId ? document.getElementById(chevronId) : null;
  if (el.style.display === 'none') {
    el.style.display = 'block';
    if (chevron) chevron.style.transform = 'rotate(90deg)';
  } else {
    el.style.display = 'none';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }
}

/** 复制 Prompt 文本到剪贴板（用户原始输入 / AI 理解） */
function copyPromptText(elId) {
  var el = document.getElementById(elId);
  if (!el) return;
  var text = el.textContent || el.innerText || '';
  if (!text.trim()) return;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      showCopyFeedback(elId);
    }).catch(function() {
      fallbackCopy(text, elId);
    });
  } else {
    fallbackCopy(text, elId);
  }
}

/** 剪贴板 fallback（兼容旧浏览器） */
function fallbackCopy(text, elId) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showCopyFeedback(elId); } catch(e) {}
  document.body.removeChild(ta);
}

/** 复制成功提示：短暂高亮边框 */
function showCopyFeedback(elId) {
  var el = document.getElementById(elId);
  if (!el) return;
  var origBorder = el.style.borderColor;
  el.style.borderColor = '#34d399';
  el.style.boxShadow = '0 0 0 1px rgba(52,211,153,0.3)';
  setTimeout(function() {
    el.style.borderColor = origBorder;
    el.style.boxShadow = 'none';
  }, 800);
}

function closeStatsModal() {
  closeMainTaskMoreMenu();
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



// ========== Docs Browser ==========
var docsLoaded = false;
var docsData = [];       // 全部文档列表
var currentDocKey = '';  // 当前选中文档的 key (section|subSection)
var docsDataIsPartial = false; // true 表示当前 docsData 为分页子集
var docsPageState = { page: 0, limit: 50, total: 0, hasMore: false, loading: false };
var docsCacheUpdatedAt = 0;
var DOCS_CACHE_TTL_MS = 60000;
var docsSilentRefreshing = false;

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
  if (docsLoaded && docsData.length > 0 && !docsDataIsPartial) {
    if (callback) callback(docsData, null);
    return;
  }
  fetch('/api/docs').then(function(r) { return r.json(); }).then(function(data) {
    docsData = data.docs || [];
    docsLoaded = true;
    docsDataIsPartial = false;
    if (callback) callback(docsData, null);
  }).catch(function(err) {
    if (callback) callback(null, err);
  });
}

function fetchDocsPage(page, callback) {
  var url = '/api/docs/paged?page=' + page + '&limit=' + docsPageState.limit;
  fetch(url).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(data) {
    if (callback) callback(data, null);
  }).catch(function(err) {
    if (callback) callback(null, err);
  });
}

function hasFreshDocsCache() {
  return docsPageState.page > 0 &&
    docsData.length > 0 &&
    (Date.now() - docsCacheUpdatedAt) <= DOCS_CACHE_TTL_MS;
}

function applyFirstPageData(data) {
  docsData = (data && data.docs) ? data.docs : [];
  docsPageState.page = data.page || 1;
  docsPageState.limit = data.limit || docsPageState.limit;
  docsPageState.total = data.total || docsData.length;
  docsPageState.hasMore = !!data.hasMore;
  docsLoaded = true;
  docsDataIsPartial = true;
  docsCacheUpdatedAt = Date.now();
}

function silentRefreshDocsFirstPage() {
  if (docsSilentRefreshing) return;
  docsSilentRefreshing = true;
  fetchDocsPage(1, function(data, err) {
    docsSilentRefreshing = false;
    if (err) return; // 静默刷新失败不打断当前浏览

    applyFirstPageData(data);
    var searchInput = document.getElementById('docsSearch');
    var searching = !!(searchInput && (searchInput.value || '').trim());
    if (!searching) {
      renderDocsList(docsData);
    } else {
      filterDocs();
    }
    updateDocsLoadMoreUI(searching);
  });
}

function updateDocsLoadMoreUI(forceHide) {
  var bar = document.getElementById('docsPagingBar');
  var btn = document.getElementById('docsLoadMoreBtn');
  var info = document.getElementById('docsPagingInfo');
  if (!bar || !btn || !info) return;
  if (forceHide) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'block';
  var loaded = docsData.length;
  var total = docsPageState.total || loaded;
  info.textContent = '已加载 ' + loaded + ' / ' + total;

  if (docsPageState.loading) {
    btn.disabled = true;
    btn.textContent = '加载中...';
    return;
  }
  if (!docsPageState.hasMore) {
    btn.disabled = true;
    btn.textContent = '已全部加载';
    return;
  }
  btn.disabled = false;
  btn.textContent = '加载更多';
}

function loadMoreDocs() {
  if (docsPageState.loading || docsSilentRefreshing || !docsPageState.hasMore) return;
  docsPageState.loading = true;
  updateDocsLoadMoreUI(false);
  fetchDocsPage(docsPageState.page + 1, function(data, err) {
    docsPageState.loading = false;
    if (err) {
      var info = document.getElementById('docsPagingInfo');
      if (info) info.textContent = '加载失败: ' + err.message;
      updateDocsLoadMoreUI(false);
      return;
    }
    var pageDocs = (data && data.docs) ? data.docs : [];
    var keySet = {};
    for (var i = 0; i < docsData.length; i++) keySet[docItemKey(docsData[i])] = true;
    for (var j = 0; j < pageDocs.length; j++) {
      var k = docItemKey(pageDocs[j]);
      if (!keySet[k]) {
        docsData.push(pageDocs[j]);
        keySet[k] = true;
      }
    }

    docsPageState.page = data.page || (docsPageState.page + 1);
    docsPageState.limit = data.limit || docsPageState.limit;
    docsPageState.total = data.total || docsData.length;
    docsPageState.hasMore = !!data.hasMore;
    docsLoaded = true;
    docsDataIsPartial = true;
    docsCacheUpdatedAt = Date.now();

    var searchInput = document.getElementById('docsSearch');
    var searching = !!(searchInput && (searchInput.value || '').trim());
    if (!searching) {
      renderDocsList(docsData);
    } else {
      filterDocs();
    }
    updateDocsLoadMoreUI(searching);
  });
}

function loadDocsPage() {
  var list = document.getElementById('docsGroupList');
  if (hasFreshDocsCache()) {
    var searchInput = document.getElementById('docsSearch');
    var searching = !!(searchInput && (searchInput.value || '').trim());
    if (!searching) {
      renderDocsList(docsData);
    } else {
      filterDocs();
    }
    updateDocsLoadMoreUI(searching);
    silentRefreshDocsFirstPage();
    return;
  }

  docsData = [];
  docsLoaded = false;
  docsDataIsPartial = true;
  docsCacheUpdatedAt = 0;
  docsPageState = { page: 0, limit: 50, total: 0, hasMore: false, loading: true };
  if (list) list.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;font-size:12px;"><div class="spinner" style="margin:0 auto 12px;width:24px;height:24px;border-width:3px;"></div>加载文档列表...</div>';
  updateDocsLoadMoreUI(false);

  fetchDocsPage(1, function(data, err) {
    docsPageState.loading = false;
    if (err) {
      if (list) list.innerHTML = '<div style="text-align:center;padding:40px;color:#f87171;font-size:12px;">加载失败: ' + err.message + '<br><span style="cursor:pointer;color:#818cf8;text-decoration:underline;" onclick="docsLoaded=false;loadDocsPage();">重试</span></div>';
      updateDocsLoadMoreUI(true);
      return;
    }
    applyFirstPageData(data);
    renderDocsList(docsData);
    updateDocsLoadMoreUI(false);
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
  html += '<div class="docs-item' + isActive + '" data-key="' + escHtml(docKey) + '" onclick="' + selectFn + '(\x27' + docKey.replace(/'/g, "\\'") + '\x27)">';

  if (hasChildren) {
    var toggleIcon = isCollapsed ? '+' : '−';
    html += '<span class="docs-item-toggle" onclick="event.stopPropagation();toggleDocChildren(\x27' + docKey.replace(/'/g, "\\'") + '\x27)" title="' + (isCollapsed ? '展开子文档' : '收起子文档') + '">' + toggleIcon + '</span>';
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
  html += '<button class="docs-item-more" onclick="event.stopPropagation();openDocManageModal(\x27' + docKey.replace(/'/g, "\\'") + '\x27)" title="更多操作">⋯</button>';
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
  var isMainDocsSearch = !searchId || searchId === 'docsSearch';
  if (!query) {
    renderDocsList(docsData, targetId, selectFn);
    if (isMainDocsSearch) updateDocsLoadMoreUI(false);
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
  if (isMainDocsSearch) updateDocsLoadMoreUI(true);
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

  if (!confirm('确定要删除文档「' + (docTitle || _docManageKey) + '」吗？\n\n此操作不可恢复！')) return;

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
    metaHtml += '<span class="docs-content-tag docs-id-tag" title="点击复制 ID" style="cursor:pointer;font-family:monospace;font-size:10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" onclick="navigator.clipboard.writeText(\x27' + escHtml(doc.id) + '\x27).then(function(){var t=event.target;t.textContent=\x27✓ 已复制\x27;setTimeout(function(){t.textContent=\x27ID: ' + escHtml(doc.id.slice(0,8)) + '…\x27},1200)})">ID: ' + escHtml(doc.id.slice(0,8)) + '…</span>';
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
    contentHtml += '<div class="docs-related-item" style="cursor:pointer;" onclick="selectDoc(\x27' + doc.parentDoc.replace(/'/g, "\\'") + '\x27)">';
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
      contentHtml += '<div class="docs-related-item" style="cursor:pointer;" onclick="selectDoc(\x27' + childKey.replace(/'/g, "\\'") + '\x27)">';
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
          replyHtml += '<div class="chat-result-card" onclick="chatOpenDoc(\x27' + docKey.replace(/'/g, "\\'") + '\x27)">';
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
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#a5b4fc;">$1</strong>')
    .replace(/\n/g, '<br>');
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
  var lines = text ? text.split('\n').length : 0;
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
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
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
      if (confirm('已存在同名文档，是否覆盖更新？\n' + (resp.body.error || ''))) {
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
    // 刷新文档列表
    docsLoaded = false;
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
  if (!confirm('发现 ' + mdFiles.length + ' 个 .md 文件，确定批量导入吗？\n\n已存在的同名文档将被自动覆盖更新。')) return;

  // 隐藏添加表单，打开进度弹层
  hideAddDocForm();
  startBatchImport(mdFiles);
}

/** 从 Markdown 内容中提取标题（第一个 # 标题或文件名） */
function extractMdTitle(content, fileName) {
  // 匹配第一个 # 标题
  var match = content.match(/^#\s+(.+)/m);
  if (match && match[1].trim()) return match[1].trim();
  // 回退到文件名（去掉 .md 扩展名）
  return (fileName || 'untitled').replace(/\.md$/i, '');
}

/** 从相对路径推断 section 和 subSection */
function inferDocMeta(relativePath, fileName) {
  // relativePath 格式: "folder/subfolder/file.md" 或 "folder/file.md"
  var parts = relativePath.split('/');
  // 去掉最外层文件夹名和最后的文件名
  // e.g. "docs/api/auth.md" → parts = ["docs", "api", "auth.md"]
  var pathParts = parts.slice(1, -1); // 中间的子文件夹路径
  var baseName = (fileName || parts[parts.length - 1] || '').replace(/\.md$/i, '');

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
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60) || ('doc-' + Date.now());

  // 如果有多层子文件夹，将中间路径也加入 subSection 作前缀
  if (pathParts.length > 1) {
    var prefix = pathParts.slice(sectionMap[pathParts[0].toLowerCase().replace(/[^a-z0-9_]/g, '_')] ? 1 : 0)
      .join('-').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '');
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
  }, 4000);
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
    if (st === 'running' || st === 'compiling' || st === 'preparing_data') running++;
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
      '<td style="padding:8px;">' + Number(it.progress || 0) + '%</td>' +
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
    h += '<button class="mem-verify-single-btn" onclick="checkSingleMemoryIntegrity(\x27' + mem.id + '\x27)" title="检测此记忆的完整性">🔍 检测</button>';
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
  var systemPrompt = (_aiBatchConfig && _aiBatchConfig.systemPrompt) ? _aiBatchConfig.systemPrompt : '你是一个记忆构建助手。请根据以下文档/任务内容生成多级记忆。\n生成三个层级（必须以 JSON 返回）：\n- L1（触点摘要）：一句话概括（15~30字）\n- L2（详细记忆）：默认 3~8句话，包含关键技术细节\n- L3_index（结构索引）：列出主要组件、依赖关系\n- memoryType：从 decision/pattern/bugfix/insight/preference/summary 选择\n- importance：0~1\n- suggestedTags：标签数组\n- anchorName：触点名称\n- anchorType：触点类型（module/concept/api/architecture/feature/library/protocol）\n- anchorOverview：触点概览（3~5句话目录索引式摘要，列出关键子项、核心 Flow、主要组件）\n\n粒度策略（必须遵守）：\n- decision/bugfix：L2 必须保留决策/根因+修复思路+关键代码片段+文件路径（若原文存在）\n- summary：仅保留 2~3 句概要\n- pattern/insight/preference：保留 1~3 句结论 + 一个最小示例\n- 若输入包含原始材料入口（commit/diff/log），L2 与 L3_index 必须保留这些追溯线索\n- 不要沿用旧版 L1/L2/L3 定义\n\n请严格以 JSON 格式返回：\n{"L1": "...", "L2": "...", "L3_index": "...", "memoryType": "...", "importance": 0.7, "suggestedTags": [...], "anchorName": "...", "anchorType": "...", "anchorOverview": "..."}';

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
      streamArea.textContent = '⚡ 跳过 Phase A（使用 ' + preparedResults.length + ' 条缓存结果）\n🔄 切换到 Phase B: 保存记忆 + Embedding ...\n   （Ollama 将切换到 embedding 模型，请稍候）';
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
          streamArea.textContent = '📦 无需 Phase A（全部已缓存: ' + preparedResults.length + ' 条）\n🔄 切换到 Phase B: 保存记忆 + Embedding ...';
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
          streamArea.textContent = '✅ Phase A: 全部 ' + phaseACached + ' 条已在缓存中，无需重新生成\n🔄 切换到 Phase B: 保存记忆 + Embedding ...';
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
          ? rawContent.slice(0, 12000) + '\n\n[... 内容已截断，共 ' + rawContent.length + ' 字符]'
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
            retryHint = '\n\n【完整性修复要求】\n上一轮未通过项：' + reason.join('、') + '。\n请严格按 JSON 输出并修复上述问题。';
          }
          var userPrompt = '标题：' + candidateTitle + '\n\n' + truncated + retryHint;

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
            + (phaseACached > 0 ? '\n   （其中 ' + phaseACached + ' 条来自断点续传缓存）' : '')
            + (_aiBatchCancelled ? '\n⚠ 已取消，将保存已缓存的 ' + preparedResults.length + ' 条' : '')
            + '\n\n🔄 切换到 Phase B: 保存记忆 + Embedding ...\n   （Ollama 将切换到 embedding 模型，请稍候）';
        }

        if (preparedResults.length === 0) {
          finishAiBatch(totalCandidates);
          return;
        }

        // Phase-78B: Phase B 开始前，先 unload gemma3 释放 Ollama VRAM
        // 否则 qwen3-embedding:8b 无法加载，所有 embedding 会失败
        var unloadUrl = ollamaUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '') + '/api/chat';
        if (streamArea) {
          streamArea.textContent += '\n\n⏳ 正在卸载 ' + model + ' 释放 GPU 显存...';
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
            streamArea.textContent += '\n✅ ' + model + ' 已卸载，显存已释放';
            streamArea.textContent += '\n🔄 等待 Ollama 加载 embedding 模型...';
          }
          // 给 Ollama 2 秒时间完成模型卸载
          setTimeout(function() { processPhaseB(); }, 2000);
        }).catch(function() {
          // 卸载失败也继续，可能 Ollama 有足够 VRAM
          if (streamArea) {
            streamArea.textContent += '\n⚠️ 模型卸载失败，继续尝试 Phase B...';
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

    html += '<div style="text-align:right;margin-top:4px;"><button onclick="this.parentElement.parentElement.innerHTML=\x27\x27" style="background:transparent;border:none;color:#4b5563;font-size:10px;cursor:pointer;">收起 ✕</button></div>';
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
      html += '<button onclick="batchRepairAnchors()" style="background:#7c2d12;color:#fed7aa;border:1px solid #c2410c;border-radius:6px;padding:3px 12px;font-size:11px;font-weight:600;cursor:pointer;margin-left:8px;transition:all 0.2s;" onmouseover="this.style.background=\x279a3412\x27" onmouseout="this.style.background=\x277c2d12\x27">⚓ Anchor触点修复 (' + anchorFixableCount + ')</button>';
    }
    if (regenerateFixableCount > 0) {
      html += '<button onclick="repairByBatchRegenerate(\x27targeted_errors\x27)" style="background:#312e81;color:#a5b4fc;border:1px solid #6366f1;border-radius:6px;padding:3px 12px;font-size:11px;font-weight:600;cursor:pointer;margin-left:8px;transition:all 0.2s;" onmouseover="this.style.background=\x273731a3\x27" onmouseout="this.style.background=\x27312e81\x27">♻ 批量重新生成修复 (' + regenerateFixableCount + ')</button>';
    }
    html += '<button onclick="document.getElementById(\x27memoryVerifyResultArea\x27).style.display=\x27none\x27" style="background:transparent;border:1px solid #374151;border-radius:4px;padding:2px 8px;color:#6b7280;font-size:11px;cursor:pointer;margin-left:auto;">收起 ✕</button>';
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
          html += '<button onclick="scrollToMemCard(\x27memCard_' + r.memoryId + '\x27)" style="background:transparent;border:none;color:#6366f1;font-size:10px;cursor:pointer;margin-left:auto;" title="跳转到此记忆">📍 定位</button>';
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
      html += '<button onclick="document.getElementById(\x27memoryVerifyResultArea\x27).style.display=\x27none\x27" style="background:transparent;border:none;color:#4b5563;font-size:10px;cursor:pointer;margin-left:12px;">收起 ✕</button>';
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
  var nativeUrl = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '') + '/api/chat';

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
        var lines = buffer.split('\n');
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
        if (streamEl) streamEl.textContent += '\n❌ 流读取错误: ' + (err.message || err);
        callback(result);
      });
    }

    readChunk();
  }).catch(function(err) {
    if (streamEl) streamEl.textContent = '❌ 连接 Ollama 失败: ' + (err.message || err) + '\n请确认 Ollama 正在运行：' + baseUrl;
    callback('');
  });
}

/** 从 LLM 输出中解析 JSON */
function parseJsonFromLlmOutput(raw) {
  if (!raw) return null;
  var cleaned = raw;
  // 尝试从 json code block 中提取
  var tick3 = String.fromCharCode(96,96,96);
  var jsonMatch = cleaned.match(new RegExp(tick3 + '(?:json)?\\s*\\n?([\\s\\S]*?)\\n?' + tick3));
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




// ========== MD Viewer ==========
var mdvCdnLoaded = false;
var mdvCdnLoading = false;
var mdvTocVisible = false;
var mdvSearchTimeout = null;
var mdvInited = false;
var _mdvRawMarkdown = '';
var _mdvFileName = '';

/** 页面入口 — 由 navTo('md-viewer') 调用 */
function loadMdViewerPage() {
  if (!mdvInited) {
    mdvInitEvents();
    mdvInited = true;
  }
  mdvLoadCDN();
}

// ===== CDN Loading =====
var MDV_MARKED_URLS = [
  'https://cdn.jsdelivr.net/npm/marked@12.0.1/marked.min.js',
  'https://unpkg.com/marked@12.0.1/marked.min.js'
];
var MDV_HLJS_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/highlight.min.js'
];
var MDV_MERMAID_URLS = [
  'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js',
  'https://unpkg.com/mermaid@11/dist/mermaid.min.js'
];
var mdvMermaidReady = false;

function mdvLoadCDN() {
  if (mdvCdnLoaded || mdvCdnLoading) return;
  mdvCdnLoading = true;
  var statusEl = document.getElementById('mdvCdnStatus');
  if (statusEl) statusEl.textContent = '⏳ 加载渲染引擎...';

  mdvLoadScript(MDV_MARKED_URLS, 0, function(markedOk) {
    if (markedOk && typeof marked !== 'undefined') {
      marked.setOptions({ gfm: true, breaks: false });
    }
    mdvLoadScript(MDV_HLJS_URLS, 0, function(hljsOk) {
      mdvLoadScript(MDV_MERMAID_URLS, 0, function(mermaidOk) {
        if (mermaidOk && typeof mermaid !== 'undefined') {
          try {
            mermaid.initialize({
              startOnLoad: false,
              theme: 'dark',
              themeVariables: {
                darkMode: true,
                background: '#1a1f2e',
                primaryColor: '#4f46e5',
                primaryTextColor: '#e6edf3',
                primaryBorderColor: '#6366f1',
                lineColor: '#6b7280',
                secondaryColor: '#1e293b',
                tertiaryColor: '#334155',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                fontSize: '14px'
              },
              securityLevel: 'loose',
              flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
              sequence: { useMaxWidth: true },
              gantt: { useMaxWidth: true }
            });
            mdvMermaidReady = true;
          } catch(e) { console.warn('mermaid init error:', e); }
        }
        mdvCdnLoaded = true;
        mdvCdnLoading = false;
        if (statusEl) {
          if (markedOk) {
            var extra = [];
            if (hljsOk) extra.push('hljs');
            if (mermaidOk) extra.push('mermaid');
            statusEl.textContent = '✅ marked' + (extra.length ? ' + ' + extra.join(' + ') : '');
            statusEl.className = 'mdv-cdn-status loaded';
          } else {
            statusEl.textContent = '⚠️ CDN 加载失败，使用简易渲染';
            statusEl.className = 'mdv-cdn-status failed';
          }
        }
      });
    });
  });
}

function mdvLoadScript(urls, index, callback) {
  if (index >= urls.length) { callback(false); return; }
  var s = document.createElement('script');
  s.src = urls[index];
  s.onload = function() { callback(true); };
  s.onerror = function() { mdvLoadScript(urls, index + 1, callback); };
  document.head.appendChild(s);
}

// ===== Markdown Parsing =====
function mdvParseMd(text) {
  if (typeof marked !== 'undefined') {
    try { return marked.parse(text); } catch(e) { console.error('marked error:', e); }
  }
  // fallback: use existing simple renderMarkdown if available
  if (typeof renderMarkdown === 'function') return renderMarkdown(text);
  return '<pre style="white-space:pre-wrap;word-break:break-word;">' + mdvEscHtml(text) + '</pre>';
}

function mdvEscHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== 共享: Markdown 内容后处理（代码高亮、复制按钮、锚点、表格包裹） =====
function mdEnhanceContent(container) {
  if (!container) return;

  // 1. Code highlighting + language label + copy button
  var blocks = container.querySelectorAll('pre code');
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    if (typeof hljs !== 'undefined') {
      try { hljs.highlightElement(block); } catch(e) {}
    }
    var pre = block.parentElement;
    if (pre.querySelector('.mdv-code-header')) continue;
    var cls = null;
    for (var j = 0; j < block.classList.length; j++) {
      if (block.classList[j].indexOf('language-') === 0) { cls = block.classList[j]; break; }
    }
    var lang = cls ? cls.replace('language-', '') : 'text';
    var header = document.createElement('div');
    header.className = 'mdv-code-header';
    var langSpan = document.createElement('span');
    langSpan.textContent = lang;
    var copyBtn = document.createElement('button');
    copyBtn.className = 'mdv-copy-btn';
    copyBtn.textContent = '复制';
    copyBtn.onclick = (function(b, c) {
      return function() {
        navigator.clipboard.writeText(b.textContent).then(function() {
          c.textContent = '已复制 ✓'; c.classList.add('copied');
          setTimeout(function() { c.textContent = '复制'; c.classList.remove('copied'); }, 2000);
        });
      };
    })(block, copyBtn);
    header.appendChild(langSpan);
    header.appendChild(copyBtn);
    pre.insertBefore(header, pre.firstChild);
  }

  // 2. Heading anchors
  var counter = 0;
  var headings = container.querySelectorAll('h1,h2,h3,h4,h5,h6');
  for (var i = 0; i < headings.length; i++) {
    var h = headings[i];
    if (!h.id) {
      var slug = h.textContent.trim().toLowerCase()
        .replace(/[^\w\u4e00-\u9fff]+/g, '-')
        .replace(/(^-|-$)/g, '') || ('heading-' + (++counter));
      h.id = slug;
    }
  }

  // 3. Table wrapping
  var tables = container.querySelectorAll('table');
  for (var i = 0; i < tables.length; i++) {
    var table = tables[i];
    if (table.parentElement.classList.contains('mdv-table-wrap')) continue;
    var wrapper = document.createElement('div');
    wrapper.className = 'mdv-table-wrap';
    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  }

  // 4. Mermaid diagram rendering
  mdvRenderMermaidBlocks(container);
}

var _mdvMermaidCounter = 0;

function mdvRenderMermaidBlocks(container) {
  if (!container) return;
  if (!mdvMermaidReady || typeof mermaid === 'undefined') return;

  // Find all <pre><code class="language-mermaid"> blocks
  var codeBlocks = container.querySelectorAll('pre code.language-mermaid');
  var pending = [];
  for (var i = 0; i < codeBlocks.length; i++) {
    pending.push(codeBlocks[i]);
  }

  // Also check for <code class="mermaid"> (some marked versions)
  var altBlocks = container.querySelectorAll('pre code.mermaid');
  for (var i = 0; i < altBlocks.length; i++) {
    if (pending.indexOf(altBlocks[i]) === -1) pending.push(altBlocks[i]);
  }

  if (pending.length === 0) return;

  for (var i = 0; i < pending.length; i++) {
    (function(codeEl) {
      var pre = codeEl.parentElement;
      if (!pre || pre.tagName !== 'PRE') return;
      // Skip if already rendered
      if (pre.dataset.mermaidRendered) return;
      pre.dataset.mermaidRendered = '1';

      var source = codeEl.textContent || '';
      if (!source.trim()) return;

      var containerId = 'mermaid-graph-' + (++_mdvMermaidCounter);
      var wrapper = document.createElement('div');
      wrapper.className = 'mermaid-container';
      wrapper.id = containerId + '-wrap';

      try {
        mermaid.render(containerId, source.trim()).then(function(result) {
          wrapper.innerHTML = '<span class="mermaid-label">mermaid</span>' + result.svg;
          pre.parentNode.replaceChild(wrapper, pre);
        }).catch(function(err) {
          console.warn('Mermaid render error:', err);
          var errDiv = document.createElement('div');
          errDiv.className = 'mermaid-error';
          errDiv.textContent = '⚠️ Mermaid 渲染失败: ' + (err.message || err);
          pre.parentNode.insertBefore(errDiv, pre);
        });
      } catch(e) {
        console.warn('Mermaid sync error:', e);
      }
    })(pending[i]);
  }
}

/** MD Viewer 页面专用后处理（调用共享函数） */
function mdvPostProcess() {
  mdEnhanceContent(document.getElementById('mdvBody'));
}

// ===== Render =====
function mdvRender(md, name) {
  var home = document.getElementById('mdvHome');
  var result = document.getElementById('mdvResult');
  var body = document.getElementById('mdvBody');
  var fileNameEl = document.getElementById('mdvFileName');
  if (!home || !result || !body) return;

  _mdvRawMarkdown = md;
  _mdvFileName = name;

  home.style.display = 'none';
  result.style.display = 'block';
  body.innerHTML = mdvParseMd(md);
  mdvPostProcess();

  if (fileNameEl) fileNameEl.innerHTML = '<strong>' + mdvEscHtml(name) + '</strong>';

  mdvShowStats(md);
  mdvGenerateTOC();

  // Show toolbar buttons
  var els = ['mdvTocToggle', 'mdvPrintBtn', 'mdvSearchBox', 'mdvSaveBtn', 'mdvBackBtn'];
  for (var i = 0; i < els.length; i++) {
    var el = document.getElementById(els[i]);
    if (el) el.style.display = '';
  }

  // Show TOC if headings exist
  var tocList = document.getElementById('mdvTocList');
  if (tocList && tocList.children.length > 0) {
    mdvShowToc(true);
  }

  // Scroll to top
  var scrollArea = document.getElementById('mdvScrollArea');
  if (scrollArea) scrollArea.scrollTop = 0;
}

// ===== Render from paste =====
function mdvRenderFromPaste() {
  var ta = document.getElementById('mdvTextarea');
  if (!ta) return;
  var text = ta.value.trim();
  if (!text) { ta.focus(); return; }
  var heading = text.match(/^#\s+(.+)/m);
  mdvRender(text, heading ? heading[1].trim() : '粘贴的文档');
}

// ===== Read file =====
function mdvReadFile(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) { mdvRender(e.target.result, file.name); };
  reader.readAsText(file, 'UTF-8');
}

// ===== Go Home =====
function mdvGoHome() {
  var home = document.getElementById('mdvHome');
  var result = document.getElementById('mdvResult');
  var body = document.getElementById('mdvBody');
  var fileNameEl = document.getElementById('mdvFileName');
  var stats = document.getElementById('mdvStats');
  var progressBar = document.getElementById('mdvProgressBar');

  if (result) result.style.display = 'none';
  if (home) home.style.display = '';
  if (body) body.innerHTML = '';
  if (stats) stats.innerHTML = '';
  if (fileNameEl) fileNameEl.textContent = '';
  if (progressBar) progressBar.style.width = '0%';

  _mdvRawMarkdown = '';
  _mdvFileName = '';

  mdvShowToc(false);

  var els = ['mdvTocToggle', 'mdvPrintBtn', 'mdvSearchBox', 'mdvSaveBtn', 'mdvBackBtn'];
  for (var i = 0; i < els.length; i++) {
    var el = document.getElementById(els[i]);
    if (el) el.style.display = 'none';
  }

  var scrollArea = document.getElementById('mdvScrollArea');
  if (scrollArea) scrollArea.scrollTop = 0;
}

// ===== Statistics =====
function mdvShowStats(md) {
  var el = document.getElementById('mdvStats');
  if (!el) return;
  var lines = md.split('\n').length;
  var chars = md.length;
  var words = md.replace(/[^\w\u4e00-\u9fff]+/g, ' ').trim().split(/\s+/).length;
  var codeMatch = md.match(/\`\`\`/g);
  var codeBlocks = codeMatch ? Math.floor(codeMatch.length / 2) : 0;
  var tableMatch = md.match(/^\|[-:| ]+\|$/gm);
  var tables = tableMatch ? tableMatch.length : 0;
  var readTime = Math.max(1, Math.ceil(words / 250));
  el.innerHTML =
    '<span>📄 <strong>' + lines.toLocaleString() + '</strong> 行</span>' +
    '<span>📝 <strong>' + chars.toLocaleString() + '</strong> 字符</span>' +
    '<span>💬 <strong>' + words.toLocaleString() + '</strong> 词</span>' +
    '<span>🧩 <strong>' + codeBlocks + '</strong> 代码块</span>' +
    '<span>📊 <strong>' + tables + '</strong> 表格</span>' +
    '<span>⏱ 约 <strong>' + readTime + '</strong> 分钟</span>';
}

// ===== TOC =====
function mdvGenerateTOC() {
  var tocList = document.getElementById('mdvTocList');
  var body = document.getElementById('mdvBody');
  if (!tocList || !body) return;
  tocList.innerHTML = '';

  var headings = body.querySelectorAll('h1,h2,h3,h4,h5,h6');
  if (!headings.length) return;

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

  mdvSetupScrollSpy(headings);
}

function mdvSetupScrollSpy(headings) {
  var scrollArea = document.getElementById('mdvScrollArea');
  var tocList = document.getElementById('mdvTocList');
  var progressBar = document.getElementById('mdvProgressBar');
  var backToTop = document.getElementById('mdvBackToTop');
  if (!scrollArea || !tocList) return;

  var links = tocList.querySelectorAll('a');
  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function() {
      var st = scrollArea.scrollTop;
      var sh = scrollArea.scrollHeight - scrollArea.clientHeight;
      if (progressBar) progressBar.style.width = (sh > 0 ? st / sh * 100 : 0) + '%';
      if (backToTop) backToTop.classList.toggle('visible', st > 300);

      var cur = '';
      for (var i = 0; i < headings.length; i++) {
        var rect = headings[i].getBoundingClientRect();
        // Offset relative to scroll area top
        if (rect.top <= 100) cur = headings[i].id;
      }
      for (var i = 0; i < links.length; i++) {
        links[i].classList.toggle('active', links[i].dataset.tid === cur);
      }
      ticking = false;
    });
  }

  scrollArea.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function mdvShowToc(show) {
  var panel = document.getElementById('mdvTocPanel');
  if (!panel) return;
  mdvTocVisible = show;
  panel.style.display = show ? '' : 'none';
}

function mdvToggleToc() {
  mdvShowToc(!mdvTocVisible);
}

function mdvScrollToTop() {
  var scrollArea = document.getElementById('mdvScrollArea');
  if (scrollArea) scrollArea.scrollTop = 0;
}

// ===== Search =====
function mdvSearch(q) {
  var body = document.getElementById('mdvBody');
  if (!body) return;

  // Remove existing marks
  var marks = body.querySelectorAll('mark[data-mdvs]');
  for (var i = 0; i < marks.length; i++) {
    var m = marks[i];
    m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
    m.parentNode.normalize();
  }

  if (!q || q.length < 2) return;

  var w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  var matches = [];
  var lq = q.toLowerCase();
  while (w.nextNode()) {
    var n = w.currentNode;
    var tag = n.parentNode.tagName;
    if (tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'CODE' && tag !== 'PRE') {
      if (n.textContent.toLowerCase().indexOf(lq) >= 0) matches.push(n);
    }
  }

  var escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp(escaped, 'gi');
  for (var i = 0; i < matches.length; i++) {
    var n = matches[i];
    var txt = n.textContent;
    var p = n.parentNode;
    var f = document.createDocumentFragment();
    var last = 0;
    var m;
    while ((m = re.exec(txt)) !== null) {
      f.appendChild(document.createTextNode(txt.slice(last, m.index)));
      var mk = document.createElement('mark');
      mk.dataset.mdvs = '1';
      mk.textContent = m[0];
      f.appendChild(mk);
      last = re.lastIndex;
    }
    f.appendChild(document.createTextNode(txt.slice(last)));
    p.replaceChild(f, n);
  }

  var first = body.querySelector('mark[data-mdvs]');
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ===== Save as .md =====
function mdvSaveMd() {
  if (!_mdvRawMarkdown) return;
  var blob = new Blob([_mdvRawMarkdown], { type: 'text/markdown;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  var fn = _mdvFileName || 'document';
  if (!/\.(md|markdown)$/i.test(fn)) fn = fn.replace(/\.[^.]+$/, '') + '.md';
  a.download = fn;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== Clear =====
function mdvClear() {
  var ta = document.getElementById('mdvTextarea');
  if (ta) { ta.value = ''; ta.focus(); }
  mdvUpdateCharCount();
}

// ===== Char Count =====
function mdvUpdateCharCount() {
  var ta = document.getElementById('mdvTextarea');
  var el = document.getElementById('mdvCharCount');
  if (!ta || !el) return;
  var v = ta.value;
  el.textContent = v.length.toLocaleString() + ' 字符 · ' + (v ? v.split('\n').length : 0).toLocaleString() + ' 行';
}

// ===== Init Events (called once) =====
function mdvInitEvents() {
  var ta = document.getElementById('mdvTextarea');
  var fileInput = document.getElementById('mdvFileInput');
  var dropArea = document.getElementById('mdvDropArea');
  var searchInput = document.getElementById('mdvSearchInput');
  var scrollArea = document.getElementById('mdvScrollArea');

  // Textarea events
  if (ta) {
    ta.addEventListener('input', mdvUpdateCharCount);
    ta.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = ta.selectionStart;
        ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + 2;
        mdvUpdateCharCount();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        mdvRenderFromPaste();
      }
    });
  }

  // File input
  if (fileInput) {
    fileInput.addEventListener('change', function(e) {
      if (e.target.files && e.target.files[0]) mdvReadFile(e.target.files[0]);
      e.target.value = '';
    });
  }

  // Drag and drop on drop area
  if (dropArea) {
    dropArea.addEventListener('dragenter', function(e) { e.preventDefault(); dropArea.classList.add('drag-over'); });
    dropArea.addEventListener('dragover', function(e) { e.preventDefault(); dropArea.classList.add('drag-over'); });
    dropArea.addEventListener('dragleave', function(e) { e.preventDefault(); dropArea.classList.remove('drag-over'); });
    dropArea.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropArea.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        mdvReadFile(e.dataTransfer.files[0]);
      }
    });
  }

  // Also handle global drag/drop when MD viewer is active
  document.addEventListener('dragover', function(e) {
    if (currentPage === 'md-viewer') e.preventDefault();
  });
  document.addEventListener('drop', function(e) {
    if (currentPage !== 'md-viewer') return;
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      mdvReadFile(e.dataTransfer.files[0]);
    }
  });

  // Search
  if (searchInput) {
    searchInput.addEventListener('input', function(e) {
      clearTimeout(mdvSearchTimeout);
      mdvSearchTimeout = setTimeout(function() { mdvSearch(e.target.value); }, 300);
    });
  }

  // Global paste when on MD viewer page
  document.addEventListener('paste', function(e) {
    if (currentPage !== 'md-viewer') return;
    var a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return;
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text || !text.trim()) return;
    e.preventDefault();
    var home = document.getElementById('mdvHome');
    if (home && home.style.display !== 'none') {
      var ta2 = document.getElementById('mdvTextarea');
      if (ta2) { ta2.value = text; mdvUpdateCharCount(); }
      mdvRenderFromPaste();
    } else {
      var h = text.match(/^#\s+(.+)/m);
      mdvRender(text, h ? h[1].trim() : '粘贴的文档');
    }
  });

  // Keyboard shortcuts (only when MD viewer is active)
  document.addEventListener('keydown', function(e) {
    if (currentPage !== 'md-viewer') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
      e.preventDefault();
      var fi = document.getElementById('mdvFileInput');
      if (fi) fi.click();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      var searchBox = document.getElementById('mdvSearchBox');
      var si = document.getElementById('mdvSearchInput');
      if (searchBox && searchBox.style.display !== 'none' && si) {
        e.preventDefault();
        si.focus();
        si.select();
      }
    }
    if (e.key === 'Escape') {
      var si2 = document.getElementById('mdvSearchInput');
      if (si2) { si2.value = ''; mdvSearch(''); si2.blur(); }
    }
  });
}


// ========== App Start ==========
function startApp() {
  if (USE_3D) {
    log('3D Force Graph 引擎就绪 (Three.js WebGL), 开始加载数据...', true);
  } else {
    log('vis-network 就绪, 开始加载数据...', true);
  }
  loadData();
  // 预加载 Markdown 渲染引擎 (marked.js + hljs)，供文档库/详情面板使用
  if (typeof mdvLoadCDN === 'function') mdvLoadCDN();
}


// ========== Init: 动态加载渲染引擎 ==========
initRoutingFromLocation();
loadRenderEngine();

