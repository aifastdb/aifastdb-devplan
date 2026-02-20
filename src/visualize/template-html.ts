/**
 * DevPlan 图可视化 — HTML 结构模块
 *
 * 从 template.ts 拆分出的全部 HTML 结构定义。
 * 包含: 侧边栏、图谱容器、详情面板、文档浏览、RAG 聊天、
 * 统计仪表盘、MD 预览器、项目设置、统计弹层等 HTML 结构。
 */

import { getMdViewerPageHTML } from './template-md-viewer';

export function getHTML(projectName: string): string {
  return `
<body>
<div class="app-layout">
  <!-- Sidebar -->
  <div class="sidebar" id="sidebar">
    <div class="sidebar-header" onclick="toggleSidebar()" title="展开/收起导航">
      <span class="sidebar-menu-icon sidebar-logo-short"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></span>
      <span class="sidebar-logo sidebar-logo-full">AiFastDb-DevPlan</span>
    </div>
    <div class="sidebar-nav">
      <div class="nav-item active" data-page="graph" onclick="navTo('graph')">
        <span class="nav-item-icon">🔗</span>
        <span class="nav-item-text">图谱可视化</span>
        <span class="nav-tooltip">图谱可视化</span>
      </div>
      <div class="nav-item disabled" data-page="tasks" onclick="navTo('tasks')">
        <span class="nav-item-icon">📋</span>
        <span class="nav-item-text">任务看板</span>
        <span class="nav-item-badge">即将推出</span>
        <span class="nav-tooltip">任务看板 (即将推出)</span>
      </div>
      <div class="nav-item" data-page="docs" onclick="navTo('docs')">
        <span class="nav-item-icon">📄</span>
        <span class="nav-item-text">文档库</span>
        <span class="nav-tooltip">文档库</span>
      </div>
      <div class="nav-item" data-page="memory" onclick="navTo('memory')">
        <span class="nav-item-icon">🧠</span>
        <span class="nav-item-text">记忆</span>
        <span class="nav-tooltip">长期记忆</span>
      </div>
      <div class="nav-item" data-page="md-viewer" onclick="navTo('md-viewer')">
        <span class="nav-item-icon">📝</span>
        <span class="nav-item-text">MD 预览</span>
        <span class="nav-tooltip">Markdown 预览</span>
      </div>
      <div class="nav-item" data-page="stats" onclick="navTo('stats')">
        <span class="nav-item-icon">📊</span>
        <span class="nav-item-text">统计仪表盘</span>
        <span class="nav-tooltip">统计仪表盘</span>
      </div>
    </div>
    <div class="sidebar-footer">
      <div class="nav-item" data-page="settings" onclick="navTo('settings')">
        <span class="nav-item-icon">⚙️</span>
        <span class="nav-item-text">项目设置</span>
        <span class="nav-tooltip">项目设置</span>
      </div>
    </div>
  </div>

  <!-- Main Content -->
  <div class="main-content">

    <!-- ===== PAGE: Graph ===== -->
    <div class="page-view page-graph active" id="pageGraph">
      <!-- Header -->
      <div class="header">
        <h1><span class="icon">🔗</span> DevPlan 图谱 <span class="project-name">${projectName}</span></h1>
        <div class="stats-bar" id="statsBar">
          <div class="stat"><span>加载中...</span></div>
        </div>
      </div>

      <!-- Graph -->
      <div class="graph-container">
        <div class="loading" id="loading"><div><div class="spinner"></div><p style="margin-top:12px;color:#9ca3af;">加载图谱数据...</p></div></div>
        <div id="graph"></div>
        <div class="panel" id="panel">
          <div class="panel-resize-handle" id="panelResizeHandle"></div>
          <div class="panel-header" id="panelHeader">
            <div class="panel-header-left">
              <button class="panel-back" id="panelBack" onclick="panelGoBack()" title="返回上一个详情">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <span class="panel-title" id="panelTitle">节点详情</span>
            </div>
            <button class="panel-close" onclick="closePanel()">✕</button>
          </div>
          <div class="panel-body" id="panelBody"></div>
        </div>
        <!-- Debug info -->
        <div class="debug" id="debug">状态: 正在加载 vis-network...</div>
      </div>

      <!-- Legend + Filters (merged) -->
      <div class="legend">
        <!-- 加载引擎标识 -->
        <div class="legend-engine-badge" id="engineBadge" onclick="navTo('settings')" title="点击前往项目设置切换加载引擎">
          ⚡ 加载引擎: <span class="engine-name" id="engineNameLabel">vis-network</span>
        </div>
        <div class="legend-divider"></div>
        <!-- 刷新按钮 -->
        <button class="legend-refresh-btn" id="legendRefreshBtn" onclick="manualRefresh()" title="刷新数据 (F5)">
          <svg class="legend-refresh-icon" id="legendRefreshIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        </button>
        <!-- Phase-10: Load All button (shown in tiered loading mode) -->
        <button class="legend-refresh-btn" id="loadAllBtn" onclick="loadAllNodes()" title="加载全部节点" style="display:none;font-size:11px;padding:2px 8px;">
          全部
        </button>
        <!-- Phase-10 T10.2: Overview mode toggle -->
        <button class="legend-refresh-btn" id="overviewBtn" onclick="toggleOverviewMode()" title="概览模式 — 每种类型一个超级节点" style="font-size:11px;padding:2px 8px;">
          概览
        </button>
        <!-- Phase-10: Tiered loading indicator -->
        <span id="tieredIndicator" style="display:none;font-size:10px;color:#60a5fa;margin-left:4px;"></span>
        <div class="legend-divider"></div>
        <!-- 节点类型筛选（复选框 + 图例） -->
        <div class="legend-item toggle active" data-type="module" onclick="toggleFilter('module')" title="点击切换模块显隐"><input type="checkbox" class="filter-cb" id="cb-module" checked><div class="legend-icon diamond"></div> 模块</div>
        <div class="legend-item toggle active" data-type="main-task" onclick="toggleFilter('main-task')" title="点击切换主任务显隐"><input type="checkbox" class="filter-cb" id="cb-main-task" checked><div class="legend-icon circle"></div> 主任务</div>
        <div class="legend-item toggle active" data-type="sub-task" onclick="toggleFilter('sub-task')" title="点击切换子任务显隐"><input type="checkbox" class="filter-cb" id="cb-sub-task" checked><div class="legend-icon dot"></div> 子任务</div>
        <div class="legend-item toggle active" data-type="document" onclick="toggleFilter('document')" title="点击切换文档显隐"><input type="checkbox" class="filter-cb" id="cb-document" checked><div class="legend-icon square"></div> 文档</div>
        <div class="legend-item toggle active" data-type="memory" onclick="toggleFilter('memory')" title="点击切换记忆显隐"><input type="checkbox" class="filter-cb" id="cb-memory" checked><div class="legend-icon hexagon"></div> 记忆</div>
        <div class="legend-divider"></div>
        <!-- 边类型图例 -->
        <div class="legend-item"><div class="legend-line solid"></div> 主任务</div>
        <div class="legend-item"><div class="legend-line thin"></div> 子任务</div>
        <div class="legend-item"><div class="legend-line dashed"></div> 文档</div>
        <div class="legend-item"><div class="legend-line dotted"></div> 模块关联</div>
      </div>
    </div>

    <!-- ===== PAGE: Docs Browser ===== -->
    <div class="page-view" id="pageDocs">
      <div class="docs-page">
        <!-- Left: Document List -->
        <div class="docs-sidebar">
          <div class="docs-sidebar-header">
            <h3>📄 文档库</h3>
            <div class="docs-search-wrap">
              <input type="text" class="docs-search" id="docsSearch" placeholder="搜索文档标题..." oninput="filterDocs();toggleSearchClear()">
              <button class="docs-search-clear" id="docsSearchClear" onclick="clearDocsSearch()" title="清空搜索">✕</button>
            </div>
          </div>
          <div class="docs-group-list" id="docsGroupList">
            <div style="text-align:center;padding:40px;color:#6b7280;font-size:12px;">加载中...</div>
          </div>
        </div>
        <!-- Right: Document Content / Chat -->
        <div class="docs-content">
          <!-- RAG Chat (default view) -->
          <div class="docs-content-empty" id="docsEmptyState">
            <div class="docs-chat-container">
              <div class="docs-chat-messages" id="docsChatMessages">
                <div class="docs-chat-welcome" id="docsChatWelcome">
                  <div class="welcome-icon">🔍</div>
                  <div class="welcome-title">文档智能搜索</div>
                  <div class="welcome-desc">输入问题，AI 将在文档库中搜索相关内容<br>支持语义搜索，理解你的意图而非仅匹配关键词</div>
                  <div class="welcome-tips">
                    <span class="tip-chip" onclick="chatSendTip(this)">有多少篇文档？</span>
                    <span class="tip-chip" onclick="chatSendTip(this)">项目进度</span>
                    <span class="tip-chip" onclick="chatSendTip(this)">有哪些阶段？</span>
                    <span class="tip-chip" onclick="chatSendTip(this)">最近更新</span>
                    <span class="tip-chip" onclick="chatSendTip(this)">帮助</span>
                  </div>
                  <div class="welcome-tips" style="margin-top:8px;">
                    <span class="tip-chip" onclick="chatSendTip(this)">向量搜索</span>
                    <span class="tip-chip" onclick="chatSendTip(this)">aifastdb vs LanceDB</span>
                    <span class="tip-chip" onclick="chatSendTip(this)">GPU 加速</span>
                    <span class="tip-chip" onclick="chatSendTip(this)">全文搜索</span>
                  </div>
                </div>
              </div>
              <div class="docs-chat-input-wrap">
                <textarea class="docs-chat-input" id="docsChatInput" placeholder="发送消息搜索文档数据库..." rows="1" onkeydown="chatInputKeydown(event)" oninput="chatAutoResize(this)"></textarea>
                <button class="docs-chat-send" id="docsChatSend" onclick="chatSend()" title="发送">↑</button>
              </div>
            </div>
          </div>
          <!-- Document Content View -->
          <div id="docsContentView" style="display:none;flex-direction:column;flex:1;min-height:0;">
            <div class="docs-content-header">
              <div style="flex:1;min-width:0;">
                <div class="docs-content-title" id="docsContentTitle">文档标题</div>
                <div class="docs-content-meta" id="docsContentMeta"></div>
              </div>
              <button style="flex-shrink:0;background:none;border:1px solid #374151;border-radius:6px;padding:4px 10px;color:#9ca3af;font-size:11px;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.borderColor='#6366f1';this.style.color='#a5b4fc'" onmouseout="this.style.borderColor='#374151';this.style.color='#9ca3af'" onclick="backToChat()" title="返回对话搜索">← 返回搜索</button>
            </div>
            <div class="docs-reader-wrap">
            <div class="docs-content-body" id="docsContentBody">
                <div class="docs-reader-inner">
                  <div class="mdv-body" id="docsContentInner"></div>
                </div>
              </div>
              <nav class="mdv-toc-panel docs-toc-panel" id="docsTocPanel" style="display:none;">
                <div class="mdv-toc-title">📑 目录导航</div>
                <ul class="mdv-toc-list" id="docsTocList"></ul>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== PAGE: Memory Browser ===== -->
    <div class="page-view" id="pageMemory">
      <div class="memory-page">
        <div class="memory-header">
          <div class="memory-header-left">
            <h2>🧠 长期记忆 — ${projectName}</h2>
            <p class="memory-header-desc">跨会话积累的开发知识：决策、模式、Bug 修复、洞察</p>
          </div>
          <div class="memory-header-right">
            <div class="memory-view-toggle">
              <button class="memory-view-btn active" data-view="list" onclick="switchMemoryView('list')" title="列表视图">
                <span>📋</span> 列表
              </button>
              <button class="memory-view-btn" data-view="graph" onclick="switchMemoryView('graph')" title="3D 图谱">
                <span>🌐</span> 图谱
              </button>
            </div>
            <div class="memory-generate-group">
              <button class="memory-generate-btn" onclick="generateMemories('both')" title="从文档和任务中提取记忆候选项">
                ✨ 生成记忆
              </button>
              <button class="memory-generate-dropdown-btn" id="memGenDropdownBtn" onclick="toggleMemGenDropdown(event)">▾</button>
              <div class="memory-generate-dropdown" id="memGenDropdown">
                <div class="memory-generate-dropdown-item" onclick="generateMemories('both')">
                  <span class="mg-icon">📦</span> 全部（文档 + 任务）
                </div>
                <div class="memory-generate-dropdown-item" onclick="generateMemories('tasks')">
                  <span class="mg-icon">✅</span> 仅从任务历史
                </div>
                <div class="memory-generate-dropdown-item" onclick="generateMemories('docs')">
                  <span class="mg-icon">📄</span> 仅从文档库
                </div>
                <div class="memory-generate-dropdown-sep"></div>
                <div class="memory-generate-dropdown-item" onclick="showPhasePickerForGenerate()">
                  <span class="mg-icon">🎯</span> 从指定阶段...
                </div>
                <div class="memory-generate-dropdown-sep"></div>
                <div class="memory-generate-dropdown-item auto-import" onclick="autoImportAllMemories()">
                  <span class="mg-icon">⚡</span> 一键全量导入
                  <span style="font-size:10px;color:#6b7280;margin-left:4px;">（自动保存全部）</span>
                </div>
              </div>
            </div>
            <span class="memory-count" id="memoryCount">0 条记忆</span>
          </div>
        </div>
        <div class="memory-filters" id="memoryFilters">
          <button class="memory-filter-btn active" data-type="all" onclick="filterMemories('all')">全部</button>
          <button class="memory-filter-btn" data-type="decision" onclick="filterMemories('decision')">🏗️ 决策</button>
          <button class="memory-filter-btn" data-type="bugfix" onclick="filterMemories('bugfix')">🐛 Bug 修复</button>
          <button class="memory-filter-btn" data-type="pattern" onclick="filterMemories('pattern')">📐 模式</button>
          <button class="memory-filter-btn" data-type="insight" onclick="filterMemories('insight')">💡 洞察</button>
          <button class="memory-filter-btn" data-type="preference" onclick="filterMemories('preference')">⚙️ 偏好</button>
          <button class="memory-filter-btn" data-type="summary" onclick="filterMemories('summary')">📝 摘要</button>
        </div>
        <div class="memory-list" id="memoryList">
          <div style="text-align:center;padding:60px;color:#6b7280;font-size:13px;">加载中...</div>
        </div>
        <!-- 3D Graph Container (hidden by default) -->
        <div class="memory-graph-container" id="memoryGraphContainer" style="display:none;">
          <div class="memory-graph-loading" id="memoryGraphLoading">
            <div class="spinner" style="width:32px;height:32px;border-width:3px;margin:0 auto 12px;"></div>
            <div>正在加载记忆网络...</div>
          </div>
          <div id="memoryGraph3D" style="width:100%;height:100%;"></div>
          <div class="memory-graph-legend">
            <div class="mg-legend-item"><span class="mg-legend-dot" style="background:#c026d3;"></span> 记忆</div>
            <div class="mg-legend-item"><span class="mg-legend-dot" style="background:#3b82f6;"></span> 任务</div>
            <div class="mg-legend-item"><span class="mg-legend-dot" style="background:#60a5fa;"></span> 文档</div>
            <div class="mg-legend-item"><span class="mg-legend-dot" style="background:#ff8533;"></span> 模块</div>
            <div class="mg-legend-item"><span class="mg-legend-dot" style="background:#6366f1;"></span> 项目</div>
          </div>
          <div class="memory-graph-stats" id="memoryGraphStats"></div>
        </div>
      </div>

      <!-- 记忆候选项预览弹层 -->
      <div class="mem-gen-overlay" id="memGenOverlay" style="display:none;">
        <div class="mem-gen-modal">
          <div class="mem-gen-modal-header">
            <h3>✨ 记忆候选项预览</h3>
            <div class="mem-gen-modal-stats" id="memGenStats"></div>
            <button class="mem-gen-close-btn" onclick="closeMemGenOverlay()">✕</button>
          </div>
          <div class="mem-gen-modal-actions">
            <button class="mem-gen-action-btn primary" onclick="saveSelectedCandidates()" id="memGenSaveBtn">
              💾 保存选中 (<span id="memGenSelectedCount">0</span>)
            </button>
            <button class="mem-gen-action-btn" onclick="toggleAllCandidates(true)">☑ 全选</button>
            <button class="mem-gen-action-btn" onclick="toggleAllCandidates(false)">☐ 全不选</button>
            <span class="mem-gen-sep"></span>
            <label class="mem-gen-limit-label">每批:
              <select id="memGenLimitSelect" class="mem-gen-limit-select" onchange="onMemGenLimitChange()">
                <option value="50" selected>50 条</option>
                <option value="100">100 条</option>
                <option value="200">200 条</option>
                <option value="0">不限制</option>
              </select>
            </label>
            <label class="mem-gen-limit-label" style="cursor:pointer;" title="保存完当前批次后自动加载下一批，直到全部处理完">
              <input type="checkbox" id="memGenAutoNext" checked /> 自动续载
            </label>
          </div>
          <div class="mem-gen-candidate-list" id="memGenCandidateList">
            <div style="text-align:center;padding:40px;color:#6b7280;">加载中...</div>
          </div>
        </div>
      </div>

      <!-- 一键全量导入进度覆盖层 -->
      <div class="mem-auto-import-overlay" id="memAutoImportOverlay" style="display:none;">
        <div class="mem-auto-import-card">
          <div class="mem-auto-import-icon">⚡</div>
          <div class="mem-auto-import-title" id="memAutoImportTitle">一键全量导入</div>
          <div class="mem-auto-import-progress-bar">
            <div class="mem-auto-import-progress-fill" id="memAutoImportProgress" style="width:0%"></div>
          </div>
          <div class="mem-auto-import-status" id="memAutoImportStatus">准备中...</div>
          <div class="mem-auto-import-detail" id="memAutoImportDetail"></div>
          <button class="mem-auto-import-cancel" id="memAutoImportCancelBtn" onclick="cancelAutoImport()">取消</button>
        </div>
      </div>
    </div>

    ${getMdViewerPageHTML()}

    <!-- ===== PAGE: Stats Dashboard ===== -->
    <div class="page-view" id="pageStats">
      <div class="stats-page" id="statsPageContent">
        <div class="stats-header">
          <h2>📊 项目仪表盘 — ${projectName}</h2>
          <p>项目开发进度总览与关键指标</p>
        </div>
        <!-- 内容由 JS 动态渲染 -->
        <div id="statsContent"><div style="text-align:center;padding:60px;color:#6b7280;">加载中...</div></div>
      </div>
    </div>

    <!-- ===== PAGE: Settings ===== -->
    <div class="page-view" id="pageSettings">
      <div class="settings-page">
        <h2>⚙️ 项目设置</h2>
        <p class="settings-subtitle">配置 ${projectName} 项目的可视化与交互选项</p>

        <div class="settings-grid">
          <!-- 左列: 节点颜色 -->
          <div class="settings-section">
            <div class="settings-section-title">🎨 节点颜色 <span style="font-size:11px;color:#94a3b8;font-weight:400;margin-left:6px;">适用于所有渲染引擎</span></div>
            <div class="settings-3d-panel" id="ncColors">
              <div class="s3d-body" style="margin-top:0;">
                <div class="s3d-group">
                  <div class="s3d-color-row">
                    <span class="s3d-color-label"><span class="s3d-dot" style="background:#f59e0b;border-radius:50%;"></span> 项目</span>
                    <input type="color" class="s3d-color-input" id="ncColorProject" value="#f59e0b" oninput="updateNodeColor('project',this.value)">
                    <span class="s3d-color-hex" id="ncColorProjectHex">#f59e0b</span>
                  </div>
                  <div class="s3d-color-row">
                    <span class="s3d-color-label"><span class="s3d-dot" style="background:#ff6600;"></span> 模块</span>
                    <input type="color" class="s3d-color-input" id="ncColorModule" value="#ff6600" oninput="updateNodeColor('module',this.value)">
                    <span class="s3d-color-hex" id="ncColorModuleHex">#ff6600</span>
                  </div>
                  <div class="s3d-color-row">
                    <span class="s3d-color-label"><span class="s3d-dot" style="background:#22c55e;border-radius:50%;"></span> 主任务</span>
                    <input type="color" class="s3d-color-input" id="ncColorMainTask" value="#22c55e" oninput="updateNodeColor('main-task',this.value)">
                    <span class="s3d-color-hex" id="ncColorMainTaskHex">#22c55e</span>
                  </div>
                  <div class="s3d-color-row">
                    <span class="s3d-color-label"><span class="s3d-dot" style="background:#047857;border-radius:50%;"></span> 子任务</span>
                    <input type="color" class="s3d-color-input" id="ncColorSubTask" value="#047857" oninput="updateNodeColor('sub-task',this.value)">
                    <span class="s3d-color-hex" id="ncColorSubTaskHex">#047857</span>
                  </div>
                  <div class="s3d-color-row">
                    <span class="s3d-color-label"><span class="s3d-dot" style="background:#3b82f6;"></span> 文档</span>
                    <input type="color" class="s3d-color-input" id="ncColorDocument" value="#3b82f6" oninput="updateNodeColor('document',this.value)">
                    <span class="s3d-color-hex" id="ncColorDocumentHex">#3b82f6</span>
                  </div>
                  <div class="s3d-color-row">
                    <span class="s3d-color-label"><span class="s3d-dot" style="background:#e879f9;border-radius:50%;"></span> 记忆</span>
                    <input type="color" class="s3d-color-input" id="ncColorMemory" value="#e879f9" oninput="updateNodeColor('memory',this.value)">
                    <span class="s3d-color-hex" id="ncColorMemoryHex">#e879f9</span>
                  </div>
                </div>
                <button class="s3d-reset-btn" style="margin-top:8px;font-size:11px;" onclick="resetNodeColors()">↩ 恢复默认颜色</button>
              </div>
            </div>
          </div>

          <!-- 加载引擎 -->
          <div class="settings-section">
            <div class="settings-section-title">🖥️ 加载引擎</div>
            <div class="settings-option-group" id="rendererOptions">
              <label class="settings-radio-card selected" data-value="vis" onclick="selectRenderer('vis')">
                <input type="radio" name="renderer" value="vis" checked>
                <div class="radio-content">
                  <div class="radio-label">vis-network <span class="default-badge">默认</span></div>
                  <div class="radio-desc">基于 vis.js 的成熟图可视化库。使用 Canvas 2D 渲染，内置物理引擎力导向布局，支持节点拖拽、缩放、选中高亮等完整交互。适合中小规模图谱（< 2000 节点），生态成熟、兼容性好。</div>
                </div>
              </label>
              <label class="settings-radio-card" data-value="3d" onclick="selectRenderer('3d')">
                <input type="radio" name="renderer" value="3d">
                <div class="radio-content">
                  <div class="radio-label">3D Force Graph <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:linear-gradient(135deg,#7c3aed,#3b82f6);color:#e0e7ff;font-weight:500;">Three.js</span></div>
                  <div class="radio-desc">基于 Three.js + d3-force-3d 的 3D 球体可视化引擎。节点在三维空间中浮动、旋转、缩放，整体呈球形分布。支持 WebGL 硬件加速渲染、轨道控制器旋转视角、节点拖拽固定、流动粒子特效。适合沉浸式图谱探索。</div>
                </div>
              </label>
            </div>
          </div>

          <!-- 通用图谱显示设置 (适用于所有引擎) -->
          <div class="settings-section">
            <div class="settings-section-title">🔗 图谱显示</div>
            <div class="settings-3d-panel">
              <div class="s3d-body" style="margin-top:0;">
                <div class="s3d-group">
                  <div class="s3d-toggle-row">
                    <span class="s3d-toggle-label">显示主节点连线 <span style="font-size:10px;color:#6b7280;margin-left:4px;">(项目节点 ↔ 周围节点的连线)</span></span>
                    <label class="s3d-toggle"><input type="checkbox" id="settingShowProjectEdges" onchange="updateGraphSetting('showProjectEdges',this.checked)"><span class="s3d-toggle-slider"></span></label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 3D Force Graph 自定义设置 (仅 3D 引擎时显示) -->
          <div class="settings-section" id="settings3dSection" style="display:none;">
            <div class="settings-section-title">🎛️ 3D Force Graph 参数</div>
            <div class="settings-3d-grid">

              <!-- 布局模式 -->
              <div class="settings-3d-panel" id="s3dLayout">
                <div class="s3d-header" onclick="toggle3DPanel('s3dLayout')">
                  <div class="s3d-header-title">🪐 布局模式</div>
                  <span class="s3d-header-arrow">▼</span>
                </div>
                <div class="s3d-body">
                  <div class="s3d-group">
                    <div class="s3d-layout-radios" style="display:flex;gap:8px;margin-bottom:10px;">
                      <label style="flex:1;display:flex;align-items:center;gap:6px;padding:8px 12px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;cursor:pointer;font-size:12px;color:#e2e8f0;transition:all 0.2s;">
                        <input type="radio" name="s3dLayoutMode" value="force" onchange="updateLayoutMode('force')" style="accent-color:#6366f1;">
                        <span>⚡ 力导向</span>
                      </label>
                      <label style="flex:1;display:flex;align-items:center;gap:6px;padding:8px 12px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;cursor:pointer;font-size:12px;color:#e2e8f0;transition:all 0.2s;">
                        <input type="radio" name="s3dLayoutMode" value="orbital" onchange="updateLayoutMode('orbital')" style="accent-color:#6366f1;">
                        <span>🪐 行星轨道</span>
                      </label>
                    </div>
                    <div class="s3d-desc" style="font-size:11px;color:#94a3b8;margin-bottom:10px;line-height:1.4;">
                      行星轨道模式：项目节点为中心（太阳），模块/主任务/子任务/文档按层级排列在固定间距的同心轨道上，类似太阳系行星排列。
                    </div>
                    <div id="s3dOrbitalSettings" style="display:none;">
                      <div class="s3d-row">
                        <span class="s3d-label">轨道间距</span>
                        <input type="range" class="s3d-slider" id="s3dOrbitSpacing" min="30" max="200" step="10" value="80" oninput="update3DSetting('orbitSpacing',this.value)">
                        <span class="s3d-value" id="s3dOrbitSpacingVal">80</span>
                      </div>
                      <div class="s3d-row">
                        <span class="s3d-label">轨道引力</span>
                        <input type="range" class="s3d-slider" id="s3dOrbitStrength" min="0.1" max="2.0" step="0.1" value="0.8" oninput="update3DSetting('orbitStrength',this.value)">
                        <span class="s3d-value" id="s3dOrbitStrengthVal">0.80</span>
                      </div>
                      <div class="s3d-row">
                        <span class="s3d-label">平面化</span>
                        <input type="range" class="s3d-slider" id="s3dOrbitFlatten" min="0" max="1.0" step="0.1" value="0.6" oninput="update3DSetting('orbitFlatten',this.value)">
                        <span class="s3d-value" id="s3dOrbitFlattenVal">0.60</span>
                      </div>
                      <div class="s3d-desc" style="font-size:10px;color:#64748b;margin:4px 0 8px;">平面化=0 → 3D 球壳布局；平面化=1 → 完全扁平太阳系圆盘</div>
                      <div class="s3d-toggle-row">
                        <span class="s3d-toggle-label">显示轨道环线</span>
                        <label class="s3d-toggle"><input type="checkbox" id="s3dShowOrbits" checked onchange="update3DSetting('showOrbits',this.checked)"><span class="s3d-toggle-slider"></span></label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 力导向物理参数 -->
              <div class="settings-3d-panel" id="s3dPhysics">
                <div class="s3d-header" onclick="toggle3DPanel('s3dPhysics')">
                  <div class="s3d-header-title">⚡ 力导向物理参数</div>
                  <span class="s3d-header-arrow">▼</span>
                </div>
                <div class="s3d-body">
                  <div class="s3d-group">
                    <div class="s3d-row">
                      <span class="s3d-label">中心引力</span>
                      <input type="range" class="s3d-slider" id="s3dGravity" min="0.01" max="0.30" step="0.01" value="0.05" oninput="update3DSetting('gravity',this.value)">
                      <span class="s3d-value" id="s3dGravityVal">0.05</span>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">排斥力</span>
                      <input type="range" class="s3d-slider" id="s3dRepulsion" min="-300" max="-5" step="5" value="-30" oninput="update3DSetting('repulsion',this.value)">
                      <span class="s3d-value" id="s3dRepulsionVal">-30</span>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">连接距离</span>
                      <input type="range" class="s3d-slider" id="s3dLinkDist" min="10" max="120" step="5" value="40" oninput="update3DSetting('linkDistance',this.value)">
                      <span class="s3d-value" id="s3dLinkDistVal">40</span>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">速度衰减</span>
                      <input type="range" class="s3d-slider" id="s3dVelocityDecay" min="0.1" max="0.8" step="0.05" value="0.30" oninput="update3DSetting('velocityDecay',this.value)">
                      <span class="s3d-value" id="s3dVelocityDecayVal">0.30</span>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">Alpha衰减</span>
                      <input type="range" class="s3d-slider" id="s3dAlphaDecay" min="0.005" max="0.05" step="0.005" value="0.020" oninput="update3DSetting('alphaDecay',this.value)">
                      <span class="s3d-value" id="s3dAlphaDecayVal">0.020</span>
                    </div>
                  </div>
                  <!-- 类型分层 (天体间距效果) -->
                  <div class="s3d-group" style="margin-top:8px; border-top:1px solid rgba(99,102,241,0.12); padding-top:8px;">
                    <div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">🌍 类型分层 — 不同类型节点保持空间距离（类似天体间距）</div>
                    <div class="s3d-toggle-row">
                      <span class="s3d-toggle-label">启用类型分层</span>
                      <label class="s3d-toggle"><input type="checkbox" id="s3dTypeSeparation" checked onchange="update3DSetting('typeSeparation',this.checked)"><span class="s3d-toggle-slider"></span></label>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">分层强度</span>
                      <input type="range" class="s3d-slider" id="s3dTypeSepStrength" min="0.1" max="2.0" step="0.1" value="0.8" oninput="update3DSetting('typeSepStrength',this.value)">
                      <span class="s3d-value" id="s3dTypeSepStrengthVal">0.80</span>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">层间间距</span>
                      <input type="range" class="s3d-slider" id="s3dTypeSepSpacing" min="30" max="200" step="10" value="80" oninput="update3DSetting('typeSepSpacing',this.value)">
                      <span class="s3d-value" id="s3dTypeSepSpacingVal">80</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 节点大小 -->
              <div class="settings-3d-panel" id="s3dSizes">
                <div class="s3d-header" onclick="toggle3DPanel('s3dSizes')">
                  <div class="s3d-header-title">📐 节点大小</div>
                  <span class="s3d-header-arrow">▼</span>
                </div>
                <div class="s3d-body">
                  <div class="s3d-group">
                    <div class="s3d-row">
                      <span class="s3d-label">项目</span>
                      <input type="range" class="s3d-slider" id="s3dSizeProject" min="10" max="100" step="5" value="50" oninput="update3DSetting('sizeProject',this.value)">
                      <span class="s3d-value" id="s3dSizeProjectVal">50</span>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">模块</span>
                      <input type="range" class="s3d-slider" id="s3dSizeModule" min="5" max="50" step="1" value="25" oninput="update3DSetting('sizeModule',this.value)">
                      <span class="s3d-value" id="s3dSizeModuleVal">25</span>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">主任务</span>
                      <input type="range" class="s3d-slider" id="s3dSizeMainTask" min="3" max="30" step="1" value="15" oninput="update3DSetting('sizeMainTask',this.value)">
                      <span class="s3d-value" id="s3dSizeMainTaskVal">15</span>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">子任务</span>
                      <input type="range" class="s3d-slider" id="s3dSizeSubTask" min="1" max="20" step="1" value="8" oninput="update3DSetting('sizeSubTask',this.value)">
                      <span class="s3d-value" id="s3dSizeSubTaskVal">8</span>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">文档</span>
                      <input type="range" class="s3d-slider" id="s3dSizeDocument" min="1" max="20" step="1" value="10" oninput="update3DSetting('sizeDocument',this.value)">
                      <span class="s3d-value" id="s3dSizeDocumentVal">10</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 视觉效果 -->
              <div class="settings-3d-panel" id="s3dVisual">
                <div class="s3d-header" onclick="toggle3DPanel('s3dVisual')">
                  <div class="s3d-header-title">✨ 视觉效果</div>
                  <span class="s3d-header-arrow">▼</span>
                </div>
                <div class="s3d-body">
                  <div class="s3d-group">
                    <div class="s3d-toggle-row">
                      <span class="s3d-toggle-label">流动粒子特效</span>
                      <label class="s3d-toggle"><input type="checkbox" id="s3dParticles" checked onchange="update3DSetting('particles',this.checked)"><span class="s3d-toggle-slider"></span></label>
                    </div>
                    <div class="s3d-toggle-row">
                      <span class="s3d-toggle-label">方向箭头</span>
                      <label class="s3d-toggle"><input type="checkbox" id="s3dArrows" onchange="update3DSetting('arrows',this.checked)"><span class="s3d-toggle-slider"></span></label>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">节点透明度</span>
                      <input type="range" class="s3d-slider" id="s3dNodeOpacity" min="0.3" max="1.0" step="0.05" value="0.90" oninput="update3DSetting('nodeOpacity',this.value)">
                      <span class="s3d-value" id="s3dNodeOpacityVal">0.92</span>
                    </div>
                    <div class="s3d-row">
                      <span class="s3d-label">边透明度</span>
                      <input type="range" class="s3d-slider" id="s3dLinkOpacity" min="0.05" max="1.0" step="0.05" value="0.25" oninput="update3DSetting('linkOpacity',this.value)">
                      <span class="s3d-value" id="s3dLinkOpacityVal">0.25</span>
                    </div>
                    <div class="s3d-color-row">
                      <span class="s3d-color-label">背景色</span>
                      <input type="color" class="s3d-color-input" id="s3dBgColor" value="#0a0e1a" oninput="update3DSetting('bgColor',this.value);document.getElementById('s3dBgColorHex').textContent=this.value;">
                      <span class="s3d-color-hex" id="s3dBgColorHex">#0a0e1a</span>
                    </div>
                  </div>
                </div>
              </div>

            </div><!-- /settings-3d-grid -->
            <button class="s3d-reset-btn" style="margin-top:16px;" onclick="reset3DSettings()">↩ 恢复默认设置</button>
          </div>

        </div><!-- /settings-grid -->
      </div>
    </div>

  </div>
</div>

<!-- Settings Toast -->
<div class="settings-saved-toast" id="settingsSavedToast">✅ 引擎修改成功，正在重新加载页面...</div>

<!-- Stats Modal -->
<div class="stats-modal-overlay" id="statsModalOverlay">
  <div class="stats-modal">
    <div class="stats-modal-header">
      <div><span class="stats-modal-title" id="statsModalTitle">列表</span><span class="stats-modal-count" id="statsModalCount"></span></div>
      <button class="stats-modal-close" onclick="closeStatsModal()">&times;</button>
    </div>
    <div class="stats-modal-body" id="statsModalBody"></div>
  </div>
</div>
`;
}
