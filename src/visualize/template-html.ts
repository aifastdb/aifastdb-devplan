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
        <span class="nav-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="6" cy="6.5" r="2"></circle>
            <circle cx="18" cy="6.5" r="2"></circle>
            <circle cx="12" cy="17.5" r="2"></circle>
            <path d="M7.8 7.6L10.2 15.7"></path>
            <path d="M16.2 7.6L13.8 15.7"></path>
            <path d="M8.1 6.5H15.9"></path>
          </svg>
        </span>
        <span class="nav-item-text">项目图谱</span>
        <span class="nav-tooltip">项目图谱</span>
      </div>
      <div class="nav-item" data-page="docs" onclick="navTo('docs')">
        <span class="nav-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 7 20V5A1.5 1.5 0 0 1 8.5 3.5z"></path>
            <path d="M15 3.5V8h4"></path>
            <path d="M10 12h6"></path>
            <path d="M10 15.5h6"></path>
          </svg>
        </span>
        <span class="nav-item-text">文档库</span>
        <span class="nav-tooltip">文档库</span>
      </div>
      <div class="nav-item" data-page="test-tools" onclick="navTo('test-tools')">
        <span class="nav-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9.5 3.5h5l2 2v3h-2v-2h-5v2h-2v-3z"></path>
            <rect x="4" y="9" width="16" height="10.5" rx="2"></rect>
            <path d="M9 13.5h6"></path>
            <path d="M12 11v5"></path>
          </svg>
        </span>
        <span class="nav-item-text">测试工具</span>
        <span class="nav-tooltip">测试工具</span>
      </div>
      <div class="nav-item" data-page="memory" onclick="navTo('memory')">
        <span class="nav-item-icon">🧠</span>
        <span class="nav-item-text">记忆</span>
        <span class="nav-tooltip">长期记忆</span>
      </div>
      <div class="nav-item" data-page="md-viewer" onclick="navTo('md-viewer')">
        <span class="nav-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 7 20V5A1.5 1.5 0 0 1 8.5 3.5z"></path>
            <path d="M15 3.5V8h4"></path>
            <path d="M10 12h6"></path>
            <path d="M10 15.5h6"></path>
          </svg>
        </span>
        <span class="nav-item-text">MD 预览</span>
        <span class="nav-tooltip">Markdown 预览</span>
      </div>
      <div class="nav-item" data-page="stats" onclick="navTo('stats')">
        <span class="nav-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 20h16"></path>
            <path d="M7 20V12"></path>
            <path d="M12 20V9"></path>
            <path d="M17 20V6"></path>
            <path d="M6.2 10.8l5-3 5.1-2.2"></path>
          </svg>
        </span>
        <span class="nav-item-text">统计仪表盘</span>
        <span class="nav-tooltip">统计仪表盘</span>
      </div>
    </div>
    <div class="sidebar-footer">
      <div class="nav-item" data-page="settings" onclick="navTo('settings')">
        <span class="nav-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2"></circle>
            <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.3 1.3 0 0 1 0 1.8l-.7.7a1.3 1.3 0 0 1-1.8 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1.3 1.3 0 0 1-1.3 1.3h-1a1.3 1.3 0 0 1-1.3-1.3v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1.3 1.3 0 0 1-1.8 0l-.7-.7a1.3 1.3 0 0 1 0-1.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a1.3 1.3 0 0 1-1.3-1.3v-1A1.3 1.3 0 0 1 4 11.3h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1.3 1.3 0 0 1 0-1.8l.7-.7a1.3 1.3 0 0 1 1.8 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4A1.3 1.3 0 0 1 10.4 2.7h1A1.3 1.3 0 0 1 12.7 4v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.3 1.3 0 0 1 1.8 0l.7.7a1.3 1.3 0 0 1 0 1.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a1.3 1.3 0 0 1 1.3 1.3v1A1.3 1.3 0 0 1 20 14h-.2a1 1 0 0 0-.4 1z"></path>
          </svg>
        </span>
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
        <h1><span class="project-name">${projectName}</span> 项目图谱</h1>
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
        <div class="legend-item toggle" data-type="memory" onclick="toggleFilter('memory')" title="点击加载并显示记忆"><input type="checkbox" class="filter-cb" id="cb-memory"><div class="legend-icon hexagon"></div> 记忆</div>
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
            <div class="docs-sidebar-title-row">
              <h3>📄 文档库</h3>
              <button class="docs-add-btn" onclick="showAddDocForm()" title="添加新文档">＋ 添加</button>
            </div>
            <div class="docs-search-wrap">
              <input type="text" class="docs-search" id="docsSearch" placeholder="搜索文档标题..." oninput="filterDocs();toggleSearchClear()">
              <button class="docs-search-clear" id="docsSearchClear" onclick="clearDocsSearch()" title="清空搜索">✕</button>
            </div>
          </div>
          <div class="docs-group-list" id="docsGroupList">
            <div style="text-align:center;padding:40px;color:#6b7280;font-size:12px;">加载中...</div>
          </div>
          <div class="docs-paging-bar" id="docsPagingBar">
            <button class="docs-load-more-btn" id="docsLoadMoreBtn" onclick="loadMoreDocs()">加载更多</button>
            <div class="docs-paging-info" id="docsPagingInfo"></div>
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
      <!-- Add Document Overlay -->
      <div class="add-doc-overlay" id="addDocOverlay" style="display:none;">
        <div class="add-doc-panel">
          <div class="add-doc-header">
            <h3>📝 添加新文档</h3>
            <button class="add-doc-close" onclick="hideAddDocForm()" title="关闭">✕</button>
          </div>
          <div class="add-doc-form">
            <div class="add-doc-row">
              <div class="add-doc-field">
                <label>文档类型 <span class="required">*</span></label>
                <select id="addDocSection">
                  <option value="overview">概述 (overview)</option>
                  <option value="core_concepts">核心概念 (core_concepts)</option>
                  <option value="api_design">API 设计 (api_design)</option>
                  <option value="file_structure">文件结构 (file_structure)</option>
                  <option value="config">配置 (config)</option>
                  <option value="examples">使用示例 (examples)</option>
                  <option value="technical_notes" selected>技术笔记 (technical_notes)</option>
                  <option value="api_endpoints">API 端点 (api_endpoints)</option>
                  <option value="milestones">里程碑 (milestones)</option>
                  <option value="changelog">变更记录 (changelog)</option>
                  <option value="custom">自定义 (custom)</option>
                </select>
              </div>
              <div class="add-doc-field">
                <label>子分类 <span class="optional">(可选，用于 technical_notes/custom)</span></label>
                <input type="text" id="addDocSubSection" placeholder="例如: security, performance...">
              </div>
            </div>
            <div class="add-doc-field">
              <label>文档标题 <span class="required">*</span></label>
              <input type="text" id="addDocTitle" placeholder="输入文档标题...">
            </div>
            <div class="add-doc-field add-doc-content-field">
              <div class="add-doc-content-header">
                <label>Markdown 内容 <span class="required">*</span></label>
                <div class="add-doc-shortcuts"><kbd>Ctrl+Enter</kbd> 提交 · <kbd>Tab</kbd> 缩进</div>
              </div>
              <textarea class="add-doc-textarea" id="addDocContent" placeholder="# 在此粘贴或输入 Markdown 内容&#10;&#10;支持从 Cursor 直接复制粘贴 Markdown 格式内容&#10;&#10;## 二级标题&#10;&#10;正文内容，支持 **粗体**、*斜体*、\`行内代码\`&#10;&#10;- 列表项 1&#10;- 列表项 2" spellcheck="false"></textarea>
              <div class="add-doc-content-footer">
                <span class="add-doc-char-count" id="addDocCharCount">0 字符 · 0 行</span>
              </div>
            </div>
            <div class="add-doc-actions">
              <button class="add-doc-btn add-doc-btn-cancel" onclick="hideAddDocForm()">取消</button>
              <button class="add-doc-btn add-doc-btn-preview" onclick="previewAddDoc()">👁 预览</button>
              <button class="add-doc-btn add-doc-btn-batch" onclick="triggerBatchImport()">📂 批量导入</button>
              <button class="add-doc-btn add-doc-btn-submit" onclick="submitAddDoc()">📤 发布文档</button>
            </div>
            <input type="file" id="batchImportInput" webkitdirectory multiple style="display:none" onchange="handleBatchImportFiles(this.files)">
          </div>
        </div>
      </div>
    </div>

    <!-- ===== PAGE: Test Tools ===== -->
    <div class="page-view" id="pageTestTools">
      <div class="stats-page" style="padding-bottom:12px;">
        <div class="stats-header">
          <h2>🧪 测试工具中心 — ${projectName}</h2>
          <p>集中查看可视化测试工具状态与当前阶段进度（文档页下方入口）</p>
        </div>
        <div id="testToolsSummary" style="display:flex;gap:10px;flex-wrap:wrap;margin:0 0 12px 0;"></div>
        <div id="testToolsContent" style="background:#0f172a;border:1px solid #1f2a44;border-radius:10px;padding:12px;min-height:280px;">
          <div style="text-align:center;padding:60px;color:#6b7280;">加载中...</div>
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
            <!-- Phase-78: 独立完整性检测按钮 -->
            <button class="memory-verify-btn" onclick="checkAllMemoriesIntegrity()" title="检测所有记忆的完整性（Embedding / Anchor / 类型 / 重要性）">
              🔍 完整性检测
            </button>
            <!-- Phase-70: 精简为单按钮，直接触发 AI 批量生成 -->
            <button class="memory-generate-btn ai-batch-btn" onclick="startAiBatchGenerate()" title="AI 批量生成记忆（浏览器直连 Ollama）">
              ✨ 生成记忆
            </button>
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
        <!-- Phase-78: 全局完整性检测结果区域 -->
        <div id="memoryVerifyResultArea" style="display:none;margin-bottom:12px;"></div>
        <div class="memory-list" id="memoryList">
          <div style="text-align:center;padding:60px;color:#6b7280;font-size:13px;">加载中...</div>
        </div>
      </div>

      <!-- Phase-60: AI 批量生成覆盖层（浏览器直连 Ollama） -->
      <div class="mem-auto-import-overlay" id="aiBatchOverlay" style="display:none;">
        <div class="mem-auto-import-card" style="max-width:700px;width:90%;">
          <div class="mem-auto-import-icon">🚀</div>
          <div class="mem-auto-import-title" id="aiBatchTitle">AI 批量生成记忆</div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:12px;">浏览器直连 Ollama · 无超时限制 · 实时流式预览</div>
          <!-- 配置区 -->
          <div id="aiBatchConfigArea" style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
            <label style="font-size:11px;color:#9ca3af;">Ollama:</label>
            <input type="text" id="aiBatchOllamaUrl" value="http://localhost:11434" style="background:#111827;border:1px solid #374151;color:#e5e7eb;border-radius:4px;padding:3px 8px;font-size:11px;width:200px;" />
            <label style="font-size:11px;color:#9ca3af;">模型:</label>
            <input type="text" id="aiBatchModel" value="gemma3:27b" style="background:#111827;border:1px solid #374151;color:#e5e7eb;border-radius:4px;padding:3px 8px;font-size:11px;width:120px;" />
            <label style="font-size:11px;color:#9ca3af;">来源:</label>
            <select id="aiBatchSource" style="background:#111827;border:1px solid #374151;color:#e5e7eb;border-radius:4px;padding:3px 8px;font-size:11px;">
              <option value="both">全部</option>
              <option value="tasks">仅任务</option>
              <option value="docs">仅文档</option>
              <option value="modules">仅功能模块</option>
            </select>
            <label style="font-size:11px;color:#9ca3af;">批次:</label>
            <select id="aiBatchLimit" style="background:#111827;border:1px solid #374151;color:#e5e7eb;border-radius:4px;padding:3px 8px;font-size:11px;">
              <option value="all">全部</option>
              <option value="10">10 条</option>
              <option value="30">30 条</option>
              <option value="40">40 条</option>
              <option value="50">50 条</option>
              <option value="100">100 条</option>
            </select>
            <button onclick="startAiBatchProcess()" id="aiBatchStartBtn" style="background:linear-gradient(135deg,#8b5cf6,#6366f1);color:white;border:none;border-radius:6px;padding:5px 16px;font-size:12px;cursor:pointer;font-weight:600;">开始</button>
          </div>
          <!-- 进度条 -->
          <div class="mem-auto-import-progress-bar">
            <div class="mem-auto-import-progress-fill" id="aiBatchProgress" style="width:0%"></div>
          </div>
          <!-- 状态 -->
          <div class="mem-auto-import-status" id="aiBatchStatus" style="min-height:18px;">就绪</div>
          <div class="mem-auto-import-detail" id="aiBatchDetail" style="min-height:14px;"></div>
          <!-- LLM 输出流式预览 -->
          <div id="aiBatchStreamArea" style="display:none;margin-top:8px;background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:8px 10px;max-height:160px;overflow-y:auto;font-family:'Cascadia Code','Fira Code',monospace;font-size:11px;color:#8b949e;line-height:1.5;white-space:pre-wrap;word-break:break-all;"></div>
          <!-- 统计摘要 -->
          <div id="aiBatchSummary" style="display:none;margin-top:10px;padding:10px;background:#111827;border-radius:6px;font-size:12px;color:#9ca3af;"></div>
          <!-- Phase-69: 完整性检测结果区域 -->
          <div id="aiBatchVerifyArea" style="display:none;margin-top:10px;"></div>
          <button class="mem-auto-import-cancel" id="aiBatchCancelBtn" onclick="cancelAiBatch()">取消</button>
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

          <!-- Gateway 阈值告警 -->
          <div class="settings-section">
            <div class="settings-section-title">🚨 Recall 阈值告警（Gateway 回退率）</div>
            <div class="settings-3d-panel">
              <div id="gatewayAlertPanel">
                <div style="text-align:center;padding:12px;color:#6b7280;font-size:12px;">加载中...</div>
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
                      <span class="s3d-toggle-label">节点文字标签 <span style="font-size:10px;color:#6b7280;margin-left:4px;">(在节点下方显示名称)</span></span>
                      <label class="s3d-toggle"><input type="checkbox" id="s3dShowLabels" checked onchange="update3DSetting('showLabels',this.checked)"><span class="s3d-toggle-slider"></span></label>
                    </div>
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

<!-- Batch Import Progress Modal -->
<div class="batch-import-overlay" id="batchImportOverlay">
  <div class="batch-import-modal">
    <div class="batch-import-header">
      <h4 id="batchImportTitle">📂 批量导入文档</h4>
      <button class="batch-import-close" id="batchImportCloseBtn" onclick="closeBatchImport()" style="display:none">&times;</button>
    </div>
    <div class="batch-import-body">
      <div class="batch-import-progress-wrap">
        <div class="batch-import-progress-bar"><div class="batch-import-progress-fill" id="batchImportProgressFill" style="width:0%"></div></div>
        <div class="batch-import-progress-text" id="batchImportProgressText">准备中...</div>
      </div>
      <div class="batch-import-log" id="batchImportLog"></div>
      <div class="batch-import-summary" id="batchImportSummary" style="display:none"></div>
    </div>
  </div>
</div>

<!-- Document Management Modal -->
<div class="doc-manage-overlay" id="docManageOverlay" onclick="if(event.target===this)closeDocManageModal()">
  <div class="doc-manage-modal">
    <div class="doc-manage-header">
      <h4>📄 文档管理</h4>
      <button class="doc-manage-close" onclick="closeDocManageModal()">&times;</button>
    </div>
    <div class="doc-manage-body">
      <div class="doc-manage-info">
        <div class="doc-manage-info-title" id="docManageTitle"></div>
        <div class="doc-manage-info-meta" id="docManageMeta"></div>
      </div>
      <div class="doc-manage-actions">
        <button class="doc-manage-btn danger" id="docManageDeleteBtn" onclick="confirmDeleteDoc()">
          <span class="doc-manage-btn-icon">🗑️</span>
          <div>
            <div class="doc-manage-btn-text">删除文档</div>
            <div class="doc-manage-btn-desc">永久删除此文档，不可恢复</div>
          </div>
        </button>
      </div>
    </div>
  </div>
</div>

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
