/**
 * DevPlan 图可视化 — 核心脚本模块
 *
 * 从 template.ts 拆分出的核心 JavaScript 代码。
 * 包含: 侧边栏导航、设置页、通用图谱显示设置、3D Force Graph 自定义设置、
 * Debug 日志、渲染引擎选择与加载、SimpleDataSet shim、全局状态变量。
 */

export function getCoreScript(): string {
  return `
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
var pageMap = { graph: 'pageGraph', stats: 'pageStats', docs: 'pageDocs', settings: 'pageSettings' };

function navTo(page) {
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

  // 离开图谱页面时关闭左侧弹层
  if (page !== 'graph') closeStatsModal();

  // 按需加载页面数据
  if (page === 'stats') loadStatsPage();
  if (page === 'docs') loadDocsPage();
  if (page === 'graph' && network) {
    setTimeout(function() { network.redraw(); network.fit(); }, 100);
  }
}

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
  showSettingsToast('✅ 显示设置已保存，刷新图谱页面生效');
}

// Initialize general graph settings UI
(function() {
  var s = getGraphSettings();
  var el = document.getElementById('settingShowProjectEdges');
  if (el) el.checked = !!s.showProjectEdges;
})();

// ========== 3D Force Graph 自定义设置 ==========
var S3D_DEFAULTS = {
  gravity: 0.05,
  repulsion: -30,
  linkDistance: 40,
  velocityDecay: 0.30,
  alphaDecay: 0.020,
  colorProject: '#fbbf24',
  colorModule: '#ff6600',
  colorMainTask: '#15803d',
  colorSubTask: '#22c55e',
  colorDocument: '#38bdf8',
  sizeProject: 40,
  sizeModule: 18,
  sizeMainTask: 10,
  sizeSubTask: 3,
  sizeDocument: 4,
  particles: true,
  arrows: false,
  nodeOpacity: 0.92,
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
  showSettingsToast('✅ 3D 参数已保存，刷新图谱页面生效');
}

function update3DColor(nodeType, colorValue) {
  var keyMap = { 'project': 'colorProject', 'module': 'colorModule', 'main-task': 'colorMainTask', 'sub-task': 'colorSubTask', 'document': 'colorDocument' };
  var key = keyMap[nodeType];
  if (!key) return;
  var settings = get3DSettings();
  settings[key] = colorValue;
  save3DSettings(settings);
  // Update hex display
  var hexMap = { 'project': 's3dColorProjectHex', 'module': 's3dColorModuleHex', 'main-task': 's3dColorMainTaskHex', 'sub-task': 's3dColorSubTaskHex', 'document': 's3dColorDocumentHex' };
  var hexEl = document.getElementById(hexMap[nodeType]);
  if (hexEl) hexEl.textContent = colorValue;
  // Update dot color
  var dotMap = { 'project': 's3dColorProject', 'module': 's3dColorModule', 'main-task': 's3dColorMainTask', 'sub-task': 's3dColorSubTask', 'document': 's3dColorDocument' };
  var input = document.getElementById(dotMap[nodeType]);
  if (input) {
    var dot = input.parentElement.querySelector('.s3d-dot');
    if (dot) dot.style.background = colorValue;
  }
  showSettingsToast('✅ 节点颜色已保存，刷新图谱页面生效');
}

function reset3DSettings() {
  try { localStorage.removeItem(S3D_KEY); } catch(e) {}
  init3DSettingsUI();
  showSettingsToast('↩ 已恢复 3D 默认设置，刷新图谱页面生效');
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
    's3dLinkOpacity': { key: 'linkOpacity', fmt: 2 }
  };
  for (var id in sliderMap) {
    var el = document.getElementById(id);
    var valEl = document.getElementById(id + 'Val');
    var cfg = sliderMap[id];
    var v = s[cfg.key];
    if (el) el.value = v;
    if (valEl) valEl.textContent = cfg.fmt > 0 ? parseFloat(v).toFixed(cfg.fmt) : Math.round(v);
  }

  // Colors
  var colorMap = {
    's3dColorProject': 'colorProject',
    's3dColorModule': 'colorModule',
    's3dColorMainTask': 'colorMainTask',
    's3dColorSubTask': 'colorSubTask',
    's3dColorDocument': 'colorDocument',
    's3dBgColor': 'bgColor'
  };
  for (var id in colorMap) {
    var el = document.getElementById(id);
    var hexEl = document.getElementById(id + 'Hex');
    var v = s[colorMap[id]];
    if (el) el.value = v;
    if (hexEl) hexEl.textContent = v;
    if (el) {
      var dot = el.parentElement.querySelector('.s3d-dot');
      if (dot) dot.style.background = v;
    }
  }

  // Toggles
  var toggleMap = { 's3dParticles': 'particles', 's3dArrows': 'arrows' };
  for (var id in toggleMap) {
    var el = document.getElementById(id);
    if (el) el.checked = !!s[toggleMap[id]];
  }
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
var hiddenTypes = {};
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
  expandedPhases: {},    // phase-X -> true: which main-tasks have been expanded
  totalNodes: 0,         // total node count from server
};
// Phase-10 T10.3: Track if network instance should be reused
var networkReusable = false;
`;
}
