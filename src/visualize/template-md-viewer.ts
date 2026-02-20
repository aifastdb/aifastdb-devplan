/**
 * DevPlan 图可视化 — Markdown 预览器模块
 *
 * 内置 .md 文件预览基础能力。
 * 支持: 文件拖放/选择、直接粘贴输入、Markdown 渲染（marked.js CDN）、
 * 代码语法高亮（highlight.js CDN）、目录导航、文档统计、搜索、打印。
 */

export function getMdViewerStyles(): string {
  return `
    /* ========== MD Viewer Page ========== */
    .mdv-page { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
    .mdv-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 20px; background: #0f172a; border-bottom: 1px solid #1e293b; flex-shrink: 0; z-index: 10; }
    .mdv-toolbar-left { display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1; }
    .mdv-toolbar-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .mdv-logo { font-size: 15px; font-weight: 700; color: #e2e8f0; white-space: nowrap; }
    .mdv-file-name { font-size: 13px; color: #8b949e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mdv-file-name strong { color: #e6edf3; font-weight: 600; }

    .mdv-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; font-size: 12px; font-weight: 500; color: #e2e8f0; background: #1e293b; border: 1px solid #334155; border-radius: 6px; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
    .mdv-btn:hover { background: #334155; border-color: #475569; }
    .mdv-btn-primary { background: #4f46e5; border-color: #4f46e5; }
    .mdv-btn-primary:hover { background: #6366f1; }
    .mdv-btn-success { background: #16a34a; border-color: #16a34a; }
    .mdv-btn-success:hover { background: #22c55e; }

    .mdv-search-box { position: relative; width: 200px; }
    .mdv-search-box input { width: 100%; padding: 6px 10px 6px 30px; font-size: 12px; color: #e2e8f0; background: #111827; border: 1px solid #334155; border-radius: 6px; outline: none; transition: border-color 0.2s; }
    .mdv-search-box input:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.15); }
    .mdv-search-box input::placeholder { color: #6b7280; }
    .mdv-search-box svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); width: 13px; height: 13px; color: #6b7280; pointer-events: none; }

    .mdv-content-wrap { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    .mdv-toc-panel { width: 260px; flex-shrink: 0; background: #0f172a; border-left: 1px solid #1e293b; overflow-y: auto; padding: 16px 0; }
    .mdv-toc-title { padding: 0 16px 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
    .mdv-toc-list { list-style: none; padding: 0; margin: 0; }
    .mdv-toc-list li a { display: block; padding: 5px 16px; font-size: 12px; color: #9ca3af; text-decoration: none; border-left: 2px solid transparent; transition: all 0.15s; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mdv-toc-list li a:hover { color: #e2e8f0; background: rgba(99,102,241,0.06); }
    .mdv-toc-list li a.active { color: #818cf8; border-left-color: #818cf8; background: rgba(99,102,241,0.1); }
    .mdv-toc-list li a.indent-1 { padding-left: 30px; }
    .mdv-toc-list li a.indent-2 { padding-left: 44px; }
    .mdv-toc-list li a.indent-3 { padding-left: 58px; }
    .mdv-toc-list li a.indent-4 { padding-left: 72px; }

    .mdv-scroll-area { flex: 1; overflow-y: auto; overflow-x: hidden; min-width: 0; scroll-behavior: smooth; }
    .mdv-scroll-area::-webkit-scrollbar { width: 8px; }
    .mdv-scroll-area::-webkit-scrollbar-track { background: #111827; }
    .mdv-scroll-area::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    .mdv-scroll-area::-webkit-scrollbar-thumb:hover { background: #475569; }
    .mdv-inner { max-width: 920px; margin: 0 auto; padding: 32px 48px 80px; }

    /* Home Page */
    .mdv-home { display: flex; flex-direction: column; gap: 0; }
    .mdv-drop-area { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px 32px; border: 2px dashed #334155; border-radius: 12px; text-align: center; cursor: pointer; transition: all 0.25s; }
    .mdv-drop-area:hover, .mdv-drop-area.drag-over { border-color: #6366f1; background: rgba(99,102,241,0.04); }
    .mdv-drop-area .drop-icon { width: 48px; height: 48px; color: #6b7280; transition: transform 0.25s; }
    .mdv-drop-area.drag-over .drop-icon { transform: scale(1.1); color: #818cf8; }
    .mdv-drop-area h3 { font-size: 16px; font-weight: 600; color: #e2e8f0; }
    .mdv-drop-area p { font-size: 13px; color: #9ca3af; }
    .mdv-drop-area kbd { padding: 1px 5px; font-size: 11px; background: #1e293b; border: 1px solid #334155; border-radius: 3px; color: #9ca3af; font-family: inherit; }

    .mdv-divider { display: flex; align-items: center; gap: 16px; padding: 20px 0; color: #6b7280; font-size: 13px; font-weight: 500; }
    .mdv-divider::before, .mdv-divider::after { content: ''; flex: 1; height: 1px; background: #1e293b; }

    .mdv-paste-section { display: flex; flex-direction: column; gap: 10px; }
    .mdv-paste-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
    .mdv-paste-label { font-size: 14px; font-weight: 600; color: #e2e8f0; display: flex; align-items: center; gap: 8px; }
    .mdv-paste-shortcuts { font-size: 12px; color: #6b7280; }
    .mdv-paste-shortcuts kbd { display: inline-block; padding: 1px 5px; font-size: 11px; background: #1e293b; border: 1px solid #334155; border-radius: 3px; color: #9ca3af; font-family: inherit; }
    .mdv-paste-textarea { min-height: 220px; padding: 14px 16px; font-size: 13px; font-family: 'Cascadia Code','Fira Code','JetBrains Mono',Consolas,monospace; line-height: 1.55; color: #e6edf3; background: #0d1117; border: 1px solid #334155; border-radius: 8px; resize: vertical; outline: none; tab-size: 4; transition: border-color 0.2s, box-shadow 0.2s; width: 100%; }
    .mdv-paste-textarea:focus { border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.15); }
    .mdv-paste-textarea::placeholder { color: #4b5563; }
    .mdv-paste-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .mdv-paste-footer .char-count { font-size: 12px; color: #6b7280; }
    .mdv-paste-footer .actions { display: flex; gap: 8px; }

    /* Result */
    .mdv-stats { display: flex; gap: 16px; margin-bottom: 24px; padding: 12px 16px; background: #1e293b; border-radius: 8px; border: 1px solid #334155; font-size: 12px; color: #9ca3af; flex-wrap: wrap; }
    .mdv-stats span { display: flex; align-items: center; gap: 5px; }
    .mdv-stats strong { color: #e2e8f0; font-weight: 600; }

    /* Markdown Body */
    .mdv-body { line-height: 1.7; font-size: 15px; color: #e6edf3; }
    .mdv-body h1,.mdv-body h2,.mdv-body h3,.mdv-body h4,.mdv-body h5,.mdv-body h6 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; line-height: 1.3; color: #e6edf3; scroll-margin-top: 20px; }
    .mdv-body h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid #1e293b; }
    .mdv-body h2 { font-size: 1.5em; padding-bottom: 0.25em; border-bottom: 1px solid rgba(30,41,59,0.6); }
    .mdv-body h3 { font-size: 1.25em; }
    .mdv-body h4 { font-size: 1.05em; }
    .mdv-body h5 { font-size: 0.95em; color: #9ca3af; }
    .mdv-body h6 { font-size: 0.9em; color: #6b7280; }
    .mdv-body p { margin: 0 0 16px; }
    .mdv-body a { color: #818cf8; text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.2s; }
    .mdv-body a:hover { border-bottom-color: #818cf8; }
    .mdv-body strong { font-weight: 600; color: #e6edf3; }
    .mdv-body em { font-style: italic; }
    .mdv-body img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; border: 1px solid #334155; }
    .mdv-body ul,.mdv-body ol { margin: 0 0 16px; padding-left: 2em; }
    .mdv-body li { margin: 4px 0; }
    .mdv-body li>ul,.mdv-body li>ol { margin-bottom: 0; }
    .mdv-body input[type="checkbox"] { margin-right: 8px; accent-color: #6366f1; }
    .mdv-body blockquote { margin: 0 0 16px; padding: 8px 16px; border-left: 4px solid #6366f1; background: rgba(99,102,241,0.06); border-radius: 0 8px 8px 0; color: #9ca3af; }
    .mdv-body blockquote>:last-child { margin-bottom: 0; }
    .mdv-body code:not(pre code) { padding: 2px 6px; font-size: 0.88em; font-family: 'Cascadia Code','Fira Code','JetBrains Mono',Consolas,monospace; background: rgba(99,102,241,0.12); border-radius: 4px; color: #fbbf24; }
    .mdv-body pre { position: relative; margin: 0 0 16px; border-radius: 8px; overflow: hidden; border: 1px solid #334155; }
    .mdv-body pre code { display: block; padding: 16px; font-size: 13px; font-family: 'Cascadia Code','Fira Code','JetBrains Mono',Consolas,monospace; line-height: 1.55; overflow-x: auto; background: #0d1117; color: #e6edf3; }
    .mdv-code-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: #161b22; border-bottom: 1px solid #334155; font-size: 11px; color: #6b7280; }
    .mdv-copy-btn { padding: 3px 8px; font-size: 11px; color: #6b7280; background: #1e293b; border: 1px solid #334155; border-radius: 4px; cursor: pointer; transition: all 0.2s; }
    .mdv-copy-btn:hover { color: #e2e8f0; border-color: #475569; }
    .mdv-copy-btn.copied { color: #22c55e; border-color: #22c55e; }
    .mdv-body table { width: 100%; margin: 0 0 16px; border-collapse: collapse; font-size: 14px; }
    .mdv-body thead { background: #1e293b; }
    .mdv-body th,.mdv-body td { padding: 8px 14px; border: 1px solid #334155; text-align: left; }
    .mdv-body th { font-weight: 600; color: #e6edf3; }
    .mdv-body tbody tr:nth-child(even) { background: rgba(99,102,241,0.03); }
    .mdv-body tbody tr:hover { background: rgba(99,102,241,0.06); }
    .mdv-body hr { margin: 24px 0; border: none; border-top: 1px solid #1e293b; }
    .mdv-table-wrap { overflow-x: auto; margin-bottom: 16px; }
    .mdv-body mark { background: rgba(251,191,36,0.25); color: inherit; border-radius: 2px; padding: 1px 2px; }

    /* Progress */
    .mdv-progress { position: absolute; bottom: 0; left: 0; right: 0; height: 2px; z-index: 5; pointer-events: none; }
    .mdv-progress-bar { height: 100%; width: 0%; background: linear-gradient(90deg, #6366f1, #a78bfa); transition: width 0.15s ease-out; }

    /* Back to top */
    .mdv-back-to-top { position: absolute; bottom: 24px; right: 24px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: #1e293b; border: 1px solid #334155; border-radius: 50%; color: #9ca3af; cursor: pointer; opacity: 0; transform: translateY(12px); transition: all 0.25s; z-index: 5; font-size: 16px; }
    .mdv-back-to-top.visible { opacity: 1; transform: translateY(0); }
    .mdv-back-to-top:hover { color: #818cf8; border-color: #818cf8; }

    /* CDN loading indicator */
    .mdv-cdn-status { font-size: 11px; color: #6b7280; padding: 0 4px; }
    .mdv-cdn-status.loaded { color: #22c55e; }
    .mdv-cdn-status.failed { color: #f59e0b; }

    /* Highlight.js minimal dark theme */
    .mdv-body .hljs { background: #0d1117; color: #e6edf3; }
    .mdv-body .hljs-keyword,.mdv-body .hljs-selector-tag,.mdv-body .hljs-type { color: #ff7b72; }
    .mdv-body .hljs-string,.mdv-body .hljs-attr { color: #a5d6ff; }
    .mdv-body .hljs-number,.mdv-body .hljs-literal { color: #79c0ff; }
    .mdv-body .hljs-comment,.mdv-body .hljs-meta { color: #8b949e; font-style: italic; }
    .mdv-body .hljs-function,.mdv-body .hljs-title { color: #d2a8ff; }
    .mdv-body .hljs-built_in,.mdv-body .hljs-variable,.mdv-body .hljs-template-variable { color: #ffa657; }
    .mdv-body .hljs-params { color: #e6edf3; }
    .mdv-body .hljs-name,.mdv-body .hljs-selector-class { color: #7ee787; }
    .mdv-body .hljs-attribute { color: #79c0ff; }
    .mdv-body .hljs-symbol { color: #79c0ff; }
    .mdv-body .hljs-addition { color: #aff5b4; background: rgba(63,185,80,0.15); }
    .mdv-body .hljs-deletion { color: #ffdcd7; background: rgba(248,81,73,0.15); }
    .mdv-body .hljs-section { color: #79c0ff; font-weight: bold; }
    .mdv-body .hljs-tag { color: #7ee787; }
    .mdv-body .hljs-regexp { color: #a5d6ff; }
    .mdv-body .hljs-bullet { color: #ffa657; }
    .mdv-body .hljs-link { color: #a5d6ff; text-decoration: underline; }

    /* mdv-body 在紧凑上下文中的适配（详情面板、文档库） */
    .panel-body .mdv-body { font-size: 13px; line-height: 1.65; }
    .panel-body .mdv-body h1 { font-size: 1.5em; }
    .panel-body .mdv-body h2 { font-size: 1.3em; }
    .panel-body .mdv-body h3 { font-size: 1.15em; }
    .panel-body .mdv-body pre code { font-size: 12px; }
    /* 文档库阅读布局 */
    .docs-reader-wrap { display: flex; flex: 1; min-height: 0; overflow: hidden; }
    .docs-reader-wrap .docs-content-body { flex: 1; overflow-y: auto; padding: 24px 32px 60px; scrollbar-width: thin; scrollbar-color: #374151 transparent; }
    .docs-reader-wrap .docs-content-body::-webkit-scrollbar { width: 6px; }
    .docs-reader-wrap .docs-content-body::-webkit-scrollbar-track { background: transparent; }
    .docs-reader-wrap .docs-content-body::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
    .docs-reader-inner { max-width: 900px; margin: 0 auto; }
    .docs-toc-panel { position: sticky; top: 0; max-height: 100%; }
    .docs-content-body .mdv-body { font-size: 14.5px; line-height: 1.75; }
    .docs-content-body .mdv-body h1 { font-size: 1.75em; }
    .docs-content-body .mdv-body h2 { font-size: 1.35em; }
    .docs-content-body .mdv-body h3 { font-size: 1.15em; }
    .docs-content-body .mdv-body pre code { font-size: 12.5px; }
    @media (max-width: 1100px) {
      .docs-toc-panel { display: none !important; }
    }

    /* Mermaid diagram container */
    .mermaid-container { margin: 16px 0; padding: 20px; background: #1a1f2e; border: 1px solid #334155; border-radius: 8px; overflow-x: auto; text-align: center; }
    .mermaid-container svg { max-width: 100%; height: auto; }
    .mermaid-container .mermaid-label { display: block; margin-bottom: 8px; font-size: 11px; color: #6b7280; text-align: right; }
    .mermaid-error { margin: 16px 0; padding: 12px 16px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; color: #f87171; font-size: 13px; white-space: pre-wrap; }

    /* Print */
    @media print {
      .mdv-toolbar,.mdv-toc-panel,.mdv-back-to-top,.mdv-home,.mdv-progress,.mdv-stats { display: none !important; }
      .mdv-page { overflow: visible !important; }
      .mdv-content-wrap { overflow: visible !important; }
      .mdv-scroll-area { overflow: visible !important; }
      .mdv-inner { max-width: 100%; padding: 20px; }
      .mdv-body { color: #1a1a1a; }
      .mdv-body h1,.mdv-body h2 { border-color: #ddd; }
      .mdv-body pre code { background: #f6f8fa; color: #24292f; }
      .mdv-body a { color: #0366d6; }
      .mdv-body code:not(pre code) { background: #eff1f3; color: #d63384; }
      .mdv-body th,.mdv-body td { border-color: #d0d7de; }
      .mdv-body thead { background: #f6f8fa; }
    }

    @media (max-width: 768px) {
      .mdv-inner { padding: 20px 16px 60px; }
      .mdv-toolbar { padding: 8px 12px; gap: 6px; }
      .mdv-search-box { width: 140px; }
      .mdv-toc-panel { width: 220px; }
      .mdv-paste-textarea { min-height: 160px; }
    }
  `;
}

export function getMdViewerPageHTML(): string {
  return `
    <!-- ===== PAGE: MD Viewer ===== -->
    <div class="page-view" id="pageMdViewer">
      <div class="mdv-page">
        <!-- Toolbar -->
        <div class="mdv-toolbar">
          <div class="mdv-toolbar-left">
            <span class="mdv-logo">📝 Markdown 预览</span>
            <span class="mdv-file-name" id="mdvFileName"></span>
            <span class="mdv-cdn-status" id="mdvCdnStatus"></span>
          </div>
          <div class="mdv-toolbar-right">
            <div class="mdv-search-box" id="mdvSearchBox" style="display:none;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" id="mdvSearchInput" placeholder="搜索内容..." />
            </div>
            <button class="mdv-btn" id="mdvTocToggle" style="display:none;" onclick="mdvToggleToc()">📑 目录</button>
            <button class="mdv-btn" id="mdvPrintBtn" style="display:none;" onclick="window.print()">🖨️ 打印</button>
            <button class="mdv-btn" id="mdvSaveBtn" style="display:none;" onclick="mdvSaveMd()">💾 保存</button>
            <button class="mdv-btn" id="mdvBackBtn" style="display:none;" onclick="mdvGoHome()">← 返回</button>
            <button class="mdv-btn mdv-btn-primary" onclick="document.getElementById('mdvFileInput').click()">📂 打开</button>
          </div>
        </div>

        <!-- Content -->
        <div class="mdv-content-wrap">
          <div class="mdv-scroll-area" id="mdvScrollArea">
            <div class="mdv-inner">
              <!-- Home -->
              <div class="mdv-home" id="mdvHome">
                <div class="mdv-drop-area" id="mdvDropArea" onclick="document.getElementById('mdvFileInput').click()">
                  <svg class="drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9,15 12,12 15,15"/></svg>
                  <h3>拖放 .md 文件到此处，或点击选择文件</h3>
                  <p>支持 .md / .markdown / .txt · 快捷键 <kbd>Ctrl+O</kbd></p>
                </div>

                <div class="mdv-divider">或直接在下方输入 / 粘贴 Markdown 内容</div>

                <div class="mdv-paste-section">
                  <div class="mdv-paste-header">
                    <div class="mdv-paste-label">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                      Markdown 输入框
                    </div>
                    <div class="mdv-paste-shortcuts"><kbd>Ctrl+Enter</kbd> 渲染 · <kbd>Tab</kbd> 缩进</div>
                  </div>
                  <textarea class="mdv-paste-textarea" id="mdvTextarea" placeholder="# 在此输入或粘贴 Markdown 内容&#10;&#10;## 二级标题&#10;&#10;正文内容，支持 **粗体**、*斜体*、\`行内代码\`&#10;&#10;- 列表项 1&#10;- 列表项 2&#10;&#10;> 引用文本&#10;&#10;| 列1 | 列2 |&#10;|-----|-----|&#10;| A   | B   |" spellcheck="false"></textarea>
                  <div class="mdv-paste-footer">
                    <span class="char-count" id="mdvCharCount">0 字符 · 0 行</span>
                    <div class="actions">
                      <button class="mdv-btn" onclick="mdvClear()">🗑️ 清空</button>
                      <button class="mdv-btn mdv-btn-success" onclick="mdvRenderFromPaste()">▶ 渲染预览</button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Result -->
              <div class="mdv-result" id="mdvResult" style="display:none;">
                <div class="mdv-stats" id="mdvStats"></div>
                <article class="mdv-body" id="mdvBody"></article>
              </div>
            </div>
          </div>
          <nav class="mdv-toc-panel" id="mdvTocPanel" style="display:none;">
            <div class="mdv-toc-title">📑 目录导航</div>
            <ul class="mdv-toc-list" id="mdvTocList"></ul>
          </nav>
        </div>

        <!-- Progress bar -->
        <div class="mdv-progress"><div class="mdv-progress-bar" id="mdvProgressBar"></div></div>

        <!-- Back to top -->
        <button class="mdv-back-to-top" id="mdvBackToTop" onclick="mdvScrollToTop()">↑</button>

        <!-- Hidden file input -->
        <input type="file" id="mdvFileInput" accept=".md,.markdown,.txt,.mdown,.mkd" style="display:none" />
      </div>
    </div>
  `;
}

export function getMdViewerScript(): string {
  return `
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
        .replace(/[^\\w\\u4e00-\\u9fff]+/g, '-')
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
  var heading = text.match(/^#\\s+(.+)/m);
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
  var lines = md.split('\\n').length;
  var chars = md.length;
  var words = md.replace(/[^\\w\\u4e00-\\u9fff]+/g, ' ').trim().split(/\\s+/).length;
  var codeMatch = md.match(/\\\`\\\`\\\`/g);
  var codeBlocks = codeMatch ? Math.floor(codeMatch.length / 2) : 0;
  var tableMatch = md.match(/^\\|[-:| ]+\\|$/gm);
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

  var escaped = q.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
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
  if (!/\\.(md|markdown)$/i.test(fn)) fn = fn.replace(/\\.[^.]+$/, '') + '.md';
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
  el.textContent = v.length.toLocaleString() + ' 字符 · ' + (v ? v.split('\\n').length : 0).toLocaleString() + ' 行';
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
      var h = text.match(/^#\\s+(.+)/m);
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
`;
}
