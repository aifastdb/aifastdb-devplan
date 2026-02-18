/**
 * DevPlan 图可视化 — CSS 样式模块
 *
 * 从 template.ts 拆分出的全部 CSS 样式定义。
 * 包含: 布局、侧边栏、头部、统计栏、图谱容器、详情面板、图例、
 * 设置页、统计仪表盘、文档浏览、RAG 聊天、统计弹层等样式。
 */

export function getStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #111827; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; overflow: hidden; }

    /* App Layout */
    .app-layout { display: flex; height: 100vh; overflow: hidden; }
    .main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }

    /* Sidebar */
    .sidebar { width: 48px; background: #0f172a; border-right: 1px solid #1e293b; flex-shrink: 0; display: flex; flex-direction: column; transition: width 0.25s ease; overflow: hidden; z-index: 40; }
    .sidebar.expanded { width: 200px; }
    .sidebar-header { height: 56px; display: flex; align-items: center; justify-content: center; border-bottom: 1px solid #1e293b; cursor: pointer; flex-shrink: 0; overflow: hidden; transition: all 0.2s; padding: 0 8px; }
    .sidebar-header:hover { background: #1e293b; }
    .sidebar-logo { font-size: 18px; font-weight: 900; background: linear-gradient(90deg, #38bdf8, #818cf8, #a78bfa, #f472b6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; white-space: nowrap; line-height: 1; }
    .sidebar-menu-icon { display: flex; align-items: center; justify-content: center; color: #9ca3af; transition: color 0.2s; }
    .sidebar-header:hover .sidebar-menu-icon { color: #e2e8f0; }
    .sidebar-logo-full { display: none; }
    .sidebar-logo-short { display: block; }
    .sidebar.expanded .sidebar-header { justify-content: flex-start; padding: 0 16px; }
    .sidebar.expanded .sidebar-logo-full { display: block; }
    .sidebar.expanded .sidebar-logo-short { display: none; }
    .sidebar-nav { flex: 1; padding: 8px 0; display: flex; flex-direction: column; gap: 2px; }
    .sidebar-footer { padding: 8px 0; border-top: 1px solid #1e293b; }
    .nav-item { position: relative; display: flex; align-items: center; height: 40px; padding: 0 12px; cursor: pointer; color: #6b7280; transition: all 0.2s; white-space: nowrap; overflow: hidden; gap: 12px; border-left: 3px solid transparent; }
    .nav-item:hover { background: #1e293b; color: #d1d5db; }
    .nav-item.active { color: #a5b4fc; background: rgba(99,102,241,0.1); border-left-color: #6366f1; }
    .nav-item.disabled { cursor: default; opacity: 0.5; }
    .nav-item.disabled:hover { background: #1e293b; }
    .nav-item-icon { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
    .nav-item-text { font-size: 13px; font-weight: 500; opacity: 0; transition: opacity 0.2s; }
    .sidebar.expanded .nav-item-text { opacity: 1; }
    .nav-item-badge { font-size: 9px; padding: 1px 6px; border-radius: 4px; background: #374151; color: #6b7280; margin-left: auto; opacity: 0; transition: opacity 0.2s; }
    .sidebar.expanded .nav-item-badge { opacity: 1; }

    /* Sidebar tooltip (collapsed mode) */
    .nav-item .nav-tooltip { position: absolute; left: 52px; top: 50%; transform: translateY(-50%); background: #1f2937; border: 1px solid #374151; color: #e5e7eb; padding: 4px 10px; border-radius: 6px; font-size: 12px; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity 0.15s; z-index: 50; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    .sidebar:not(.expanded) .nav-item:hover .nav-tooltip { opacity: 1; }

    /* Header */
    .header { background: transparent; border-bottom: none; padding: 8px 24px; display: flex; align-items: center; justify-content: space-between; height: 44px; position: absolute; top: 0; left: 0; right: 0; z-index: 10; pointer-events: none; }
    .header * { pointer-events: auto; }
    .header h1 { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 10px; }
    .header h1 .icon { font-size: 24px; }
    .header .project-name { color: #818cf8; }

    /* Stats Bar */
    .stats-bar { display: flex; gap: 24px; align-items: center; }
    .stat { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #9ca3af; }
    .stat .num { font-weight: 700; font-size: 16px; }
    .stat .num.green { color: #10b981; }
    .stat .num.blue { color: #3b82f6; }
    .stat .num.purple { color: #8b5cf6; }
    .stat .num.amber { color: #f59e0b; }
    .stat.clickable { cursor: pointer; border-radius: 6px; padding: 2px 8px; margin: -2px -8px; transition: background 0.15s; }
    .stat.clickable:hover { background: rgba(99,102,241,0.12); }
    .progress-bar { width: 120px; height: 8px; background: #374151; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #10b981, #3b82f6); border-radius: 4px; transition: width 0.5s; }

    /* Controls */
    .controls { display: none; }
    .filter-check { display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 12px; color: #9ca3af; user-select: none; }
    .filter-check input { accent-color: #6366f1; width: 13px; height: 13px; cursor: pointer; }
    .filter-check:hover { color: #d1d5db; }
    /* Interactive legend toggle items (merged filter + legend) */
    .legend-item.toggle { cursor: pointer; padding: 2px 8px; border-radius: 4px; transition: opacity 0.2s, background 0.2s; user-select: none; position: relative; }
    .legend-item.toggle:hover { background: rgba(99,102,241,0.15); color: #e5e7eb; }
    .legend-item.toggle:not(.active) { opacity: 0.3; }
    .legend-item.toggle:not(.active):hover { opacity: 0.5; }
    .legend-item.toggle.loading::after { content: ' ⏳'; font-size: 10px; }
    .legend-item.toggle.not-loaded { opacity: 0.45; border: 1px dashed rgba(99,102,241,0.35); }
    .legend-item.toggle.not-loaded::after { content: ' ↓'; font-size: 9px; color: #60a5fa; }
    /* Checkbox inside toggle legend items */
    .legend-item.toggle .filter-cb { width: 14px; height: 14px; accent-color: #6366f1; cursor: pointer; margin: 0; pointer-events: none; }

    /* Graph — flex 自适应高度 */
    .graph-container { position: relative; flex: 1; background: #111827; min-height: 0; }
    #graph { width: 100%; height: 100%; }

    .loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(17,24,39,0.9); z-index: 20; }
    .spinner { width: 40px; height: 40px; border: 4px solid #4f46e5; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Detail Panel */
    .panel { position: absolute; top: 12px; right: 12px; width: 340px; max-height: calc(100vh - 180px); background: #1f2937; border: 1px solid #374151; border-radius: 12px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); z-index: 10; display: none; overflow: hidden; min-width: 280px; max-width: calc(100vw - 40px); transition: none; }
    .panel.show { display: flex; flex-direction: column; }
    .panel-resize-handle { position: absolute; top: 0; left: -4px; width: 8px; height: 100%; cursor: col-resize; z-index: 15; background: transparent; }
    .panel-resize-handle:hover, .panel-resize-handle.active { background: linear-gradient(90deg, transparent, rgba(99,102,241,0.4), transparent); }
    .panel-resize-handle::after { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 3px; height: 32px; background: #4b5563; border-radius: 2px; opacity: 0; transition: opacity 0.2s; }
    .panel-resize-handle:hover::after, .panel-resize-handle.active::after { opacity: 1; background: #6366f1; }
    .panel-header { padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; cursor: default; user-select: none; }
    .panel-header.project { background: linear-gradient(135deg, #d97706, #f59e0b); }
    .panel-header.module { background: linear-gradient(135deg, #cc5200, #ff6600); }
    .panel-header.main-task { background: linear-gradient(135deg, #4f46e5, #6366f1); }
    .panel-header.sub-task { background: linear-gradient(135deg, #7c3aed, #8b5cf6); }
    .panel-header.document { background: linear-gradient(135deg, #1d4ed8, #3b82f6); }
    .panel-title { font-weight: 600; font-size: 14px; color: #fff; pointer-events: none; }
    .panel-close { background: rgba(255,255,255,0.2); border: none; color: #fff; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; }
    .panel-close:hover { background: rgba(255,255,255,0.3); }
    .panel-back { background: rgba(255,255,255,0.2); border: none; color: #fff; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 16px; display: none; align-items: center; justify-content: center; margin-right: 8px; flex-shrink: 0; transition: background 0.15s, transform 0.15s; }
    .panel-back:hover { background: rgba(255,255,255,0.3); transform: translateX(-1px); }
    .panel-back.visible { display: flex; }
    .panel-header-left { display: flex; align-items: center; min-width: 0; flex: 1; }
    .panel-body { padding: 16px; overflow-y: auto; flex: 1; }
    .panel-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid #374151; }
    .panel-row:last-child { border-bottom: none; }
    .panel-label { color: #9ca3af; }
    .panel-value { color: #e5e7eb; font-weight: 500; }
    .status-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .status-completed { background: #064e3b; color: #6ee7b7; }
    .status-in_progress { background: #1e3a5f; color: #93c5fd; }
    .status-pending { background: #374151; color: #9ca3af; }
    .status-cancelled { background: #451a03; color: #fbbf24; }
    .priority-P0 { background: #7f1d1d; color: #fca5a5; }
    .priority-P1 { background: #78350f; color: #fde68a; }
    .priority-P2 { background: #1e3a5f; color: #93c5fd; }
    .panel-progress { margin-top: 8px; }
    .panel-progress-bar { width: 100%; height: 6px; background: #374151; border-radius: 3px; overflow: hidden; margin-top: 4px; }
    .panel-progress-fill { height: 100%; background: #10b981; border-radius: 3px; }

    /* Sub-task List in Panel */
    .subtask-section { margin-top: 12px; border-top: 1px solid #374151; padding-top: 10px; }
    .subtask-section-title { font-size: 12px; color: #9ca3af; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
    .subtask-list { list-style: none; padding: 0; margin: 0; }
    .subtask-item { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid rgba(55,65,81,0.5); font-size: 12px; }
    .subtask-item:last-child { border-bottom: none; }
    .subtask-icon { width: 16px; height: 16px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 10px; }
    .subtask-icon.completed { background: #064e3b; color: #6ee7b7; }
    .subtask-icon.in_progress { background: #1e3a5f; color: #93c5fd; }
    .subtask-icon.pending { background: #374151; color: #6b7280; }
    .subtask-icon.cancelled { background: #451a03; color: #fbbf24; }
    .subtask-name { color: #d1d5db; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .subtask-name.completed { color: #6ee7b7; text-decoration: line-through; text-decoration-color: rgba(110,231,183,0.3); }
    .subtask-name.cancelled { color: #9ca3af; text-decoration: line-through; }
    .subtask-id { color: #6b7280; font-size: 10px; flex-shrink: 0; font-family: monospace; }
    .subtask-time { color: #6ee7b7; font-size: 10px; flex-shrink: 0; opacity: 0.75; margin-left: auto; }

    /* Legend */
    .legend { background: #1f2937; border-top: 1px solid #374151; padding: 6px 24px; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 20px; font-size: 12px; color: #9ca3af; }
    .legend-filters { display: flex; align-items: center; gap: 8px; }
    .legend-divider { width: 1px; height: 18px; background: #374151; }
    .legend-engine-badge { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #6b7280; padding: 2px 8px; border-radius: 4px; background: rgba(99,102,241,0.08); border: 1px solid #1e293b; white-space: nowrap; cursor: pointer; transition: all 0.2s; }
    .legend-engine-badge:hover { border-color: #4b5563; color: #a5b4fc; background: rgba(99,102,241,0.15); }
    .legend-engine-badge .engine-name { font-weight: 600; color: #818cf8; }
    .legend-refresh-btn { display: flex; align-items: center; justify-content: center; background: none; border: 1px solid #374151; border-radius: 4px; padding: 3px 6px; cursor: pointer; color: #9ca3af; transition: color 0.2s, border-color 0.2s, background 0.2s; }
    .legend-refresh-btn:hover { color: #60a5fa; border-color: #60a5fa; background: rgba(96,165,250,0.08); }
    .legend-refresh-btn:active { color: #3b82f6; }
    .legend-refresh-btn.refreshing .legend-refresh-icon { animation: spin-refresh 0.8s linear infinite; }
    @keyframes spin-refresh { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .legend-sep { width: 100%; height: 0; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-icon { width: 12px; height: 12px; }
    .legend-icon.star { background: #f59e0b; clip-path: polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%); }
    .legend-icon.diamond { background: #ff6600; clip-path: polygon(50% 0%,100% 50%,50% 100%,0% 50%); }
    .legend-icon.circle { background: #22c55e; border-radius: 50%; }
    .legend-icon.dot { background: #047857; border-radius: 50%; width: 8px; height: 8px; }
    .legend-icon.square { background: #3b82f6; border-radius: 2px; width: 10px; height: 10px; }
    .legend-line { width: 24px; height: 2px; }
    .legend-line.solid { background: #6b7280; }
    .legend-line.thin { background: #6b7280; height: 1px; }
    .legend-line.dashed { border-top: 2px dashed #6b7280; background: none; height: 0; }
    .legend-line.dotted { border-top: 2px dotted #10b981; background: none; height: 0; }
    .legend-line.task-doc { border-top: 2px dashed #6b7280; background: none; height: 0; }
    .legend-line.doc-child { border-top: 2px dashed #6b7280; background: none; height: 0; }

    /* Document Content in Panel */
    .doc-section { margin-top: 12px; border-top: 1px solid #374151; padding-top: 10px; }
    .doc-section-title { font-size: 12px; color: #9ca3af; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
    .doc-content { background: #111827; border: 1px solid #374151; border-radius: 8px; padding: 12px; font-size: 12px; line-height: 1.7; color: #d1d5db; overflow-x: auto; }
    .doc-content h1, .doc-content h2, .doc-content h3, .doc-content h4 { color: #f3f4f6; margin: 12px 0 6px 0; }
    .doc-content h1 { font-size: 16px; border-bottom: 1px solid #374151; padding-bottom: 4px; }
    .doc-content h2 { font-size: 14px; border-bottom: 1px solid rgba(55,65,81,0.5); padding-bottom: 3px; }
    .doc-content h3 { font-size: 13px; }
    .doc-content h4 { font-size: 12px; color: #d1d5db; }
    .doc-content p { margin: 6px 0; }
    .doc-content code { background: #1e293b; color: #a5b4fc; padding: 1px 5px; border-radius: 3px; font-size: 11px; font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; }
    .doc-content pre { background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 10px; overflow-x: auto; margin: 8px 0; }
    .doc-content pre code { background: none; padding: 0; color: #e2e8f0; display: block; white-space: pre; }
    .doc-content ul, .doc-content ol { padding-left: 20px; margin: 6px 0; }
    .doc-content li { margin: 2px 0; }
    .doc-content blockquote { border-left: 3px solid #4f46e5; padding-left: 10px; color: #9ca3af; margin: 8px 0; font-style: italic; }
    .doc-content table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 11px; }
    .doc-content th { background: #1e293b; color: #a5b4fc; padding: 5px 8px; text-align: left; border: 1px solid #374151; font-weight: 600; }
    .doc-content td { padding: 4px 8px; border: 1px solid #374151; }
    .doc-content tr:nth-child(even) { background: rgba(30,41,59,0.3); }
    .doc-content a { color: #818cf8; text-decoration: none; }
    .doc-content a:hover { text-decoration: underline; }
    .doc-content hr { border: none; border-top: 1px solid #374151; margin: 10px 0; }
    .doc-content strong { color: #f3f4f6; }
    .doc-content em { color: #c4b5fd; }
    .doc-loading { text-align: center; color: #6b7280; padding: 16px; font-size: 12px; }
    .doc-error { text-align: center; color: #f87171; padding: 12px; font-size: 12px; }
    .doc-toggle { background: none; border: 1px solid #4b5563; color: #9ca3af; padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; }
    .doc-toggle:hover { border-color: #6b7280; color: #d1d5db; }

    /* Page Views */
    .page-view { display: none; }
    .page-view.active { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .page-graph.active { display: flex; flex-direction: column; flex: 1; min-height: 0; }

    /* Settings Page */
    .settings-page { padding: 32px 48px; overflow-y: auto; background: #111827; flex: 1; width: 100%; display: flex; flex-direction: column; align-items: center; }
    .settings-page > h2, .settings-page > p, .settings-page > .settings-grid { width: 800px; max-width: 100%; }
    .settings-page h2 { font-size: 22px; font-weight: 700; color: #f3f4f6; margin-bottom: 4px; }
    .settings-page .settings-subtitle { font-size: 13px; color: #6b7280; margin-bottom: 28px; }
    .settings-grid { display: flex; flex-direction: column; gap: 28px; }
    .settings-section { margin-bottom: 0; }
    .settings-section-title { font-size: 14px; font-weight: 600; color: #d1d5db; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; gap: 8px; }
    .settings-3d-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 4px; }
    @media (max-width: 960px) { .settings-3d-grid { grid-template-columns: 1fr; } }
    .settings-option-group { display: flex; flex-direction: column; gap: 10px; }
    .settings-radio-card { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border-radius: 10px; border: 2px solid #1e293b; background: #0f172a; cursor: pointer; transition: all 0.2s; }
    .settings-radio-card:hover { border-color: #374151; background: #1e293b; }
    .settings-radio-card.selected { border-color: #6366f1; background: rgba(99,102,241,0.08); }
    .settings-radio-card input[type="radio"] { margin-top: 3px; accent-color: #6366f1; flex-shrink: 0; width: 16px; height: 16px; cursor: pointer; }
    .settings-radio-card .radio-content { flex: 1; min-width: 0; }
    .settings-radio-card .radio-label { font-size: 14px; font-weight: 600; color: #e5e7eb; display: flex; align-items: center; gap: 8px; }
    .settings-radio-card .radio-label .default-badge { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: #374151; color: #9ca3af; font-weight: 500; }
    .settings-radio-card .radio-desc { font-size: 12px; color: #6b7280; margin-top: 4px; line-height: 1.5; }
    .settings-radio-card.selected .radio-label { color: #a5b4fc; }
    .settings-radio-card.selected .radio-desc { color: #818cf8; }
    .settings-saved-toast { position: fixed; bottom: 24px; right: 24px; background: #059669; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500; box-shadow: 0 4px 16px rgba(0,0,0,0.4); z-index: 100; opacity: 0; transform: translateY(10px); transition: all 0.3s ease; pointer-events: none; }
    .settings-saved-toast.show { opacity: 1; transform: translateY(0); }
    /* 3D Settings Panel */
    .settings-3d-panel { margin-top: 0; padding: 16px; border-radius: 10px; border: 1px solid #1e293b; background: #0f172a; }
    .settings-section > .settings-3d-panel { margin-top: 16px; }
    .settings-3d-panel.collapsed .s3d-body { display: none; }
    .s3d-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; padding: 4px 0; }
    .s3d-header-title { font-size: 13px; font-weight: 600; color: #c7d2fe; display: flex; align-items: center; gap: 6px; }
    .s3d-header-arrow { font-size: 11px; color: #6b7280; transition: transform 0.2s; }
    .settings-3d-panel.collapsed .s3d-header-arrow { transform: rotate(-90deg); }
    .s3d-body { margin-top: 14px; display: flex; flex-direction: column; gap: 14px; }
    .s3d-group { display: flex; flex-direction: column; gap: 10px; }
    .s3d-group-title { font-size: 12px; font-weight: 600; color: #94a3b8; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
    .s3d-row { display: flex; align-items: center; gap: 10px; }
    .s3d-label { font-size: 12px; color: #9ca3af; min-width: 80px; flex-shrink: 0; }
    .s3d-slider { flex: 1; -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px; background: #374151; outline: none; cursor: pointer; }
    .s3d-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #6366f1; cursor: pointer; border: 2px solid #1e1b4b; }
    .s3d-slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #6366f1; cursor: pointer; border: 2px solid #1e1b4b; }
    .s3d-value { font-size: 11px; color: #6366f1; font-weight: 600; min-width: 36px; text-align: right; font-family: monospace; }
    .s3d-color-row { display: flex; align-items: center; gap: 10px; }
    .s3d-color-label { font-size: 12px; color: #9ca3af; flex: 1; display: flex; align-items: center; gap: 6px; }
    .s3d-color-label .s3d-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
    .s3d-color-input { width: 32px; height: 24px; border: 1px solid #374151; border-radius: 4px; background: transparent; cursor: pointer; padding: 0; }
    .s3d-color-hex { font-size: 11px; color: #6b7280; font-family: monospace; min-width: 60px; }
    .s3d-toggle-row { display: flex; align-items: center; justify-content: space-between; }
    .s3d-toggle-label { font-size: 12px; color: #9ca3af; }
    .s3d-toggle { position: relative; width: 36px; height: 20px; cursor: pointer; }
    .s3d-toggle input { opacity: 0; width: 0; height: 0; }
    .s3d-toggle-slider { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #374151; border-radius: 10px; transition: 0.2s; }
    .s3d-toggle-slider:before { content: ''; position: absolute; height: 14px; width: 14px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: 0.2s; }
    .s3d-toggle input:checked + .s3d-toggle-slider { background: #6366f1; }
    .s3d-toggle input:checked + .s3d-toggle-slider:before { transform: translateX(16px); }
    .s3d-reset-btn { margin-top: 8px; padding: 6px 14px; border: 1px solid #374151; border-radius: 6px; background: transparent; color: #9ca3af; font-size: 11px; cursor: pointer; transition: all 0.2s; align-self: flex-start; }
    .s3d-reset-btn:hover { background: #1e293b; color: #e5e7eb; border-color: #4b5563; }

    /* Stats Dashboard */
    .stats-page { padding: 24px; overflow-y: auto; background: #111827; flex: 1; }
    .stats-header { margin-bottom: 24px; }
    .stats-header h2 { font-size: 22px; font-weight: 700; color: #f3f4f6; margin-bottom: 4px; }
    .stats-header p { font-size: 13px; color: #6b7280; }

    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
    .stat-card { background: #1f2937; border: 1px solid #374151; border-radius: 12px; padding: 20px; position: relative; overflow: hidden; }
    .stat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; }
    .stat-card.purple::before { background: linear-gradient(90deg, #6366f1, #8b5cf6); }
    .stat-card.green::before { background: linear-gradient(90deg, #059669, #10b981); }
    .stat-card.blue::before { background: linear-gradient(90deg, #2563eb, #3b82f6); }
    .stat-card.amber::before { background: linear-gradient(90deg, #d97706, #f59e0b); }
    .stat-card.rose::before { background: linear-gradient(90deg, #e11d48, #f43f5e); }
    .stat-card-icon { font-size: 28px; margin-bottom: 8px; }
    .stat-card-value { font-size: 32px; font-weight: 800; color: #f3f4f6; line-height: 1; }
    .stat-card-label { font-size: 12px; color: #9ca3af; margin-top: 6px; }
    .stat-card-sub { font-size: 11px; color: #6b7280; margin-top: 4px; }

    .stats-section { margin-bottom: 28px; }
    .stats-section-title { font-size: 15px; font-weight: 600; color: #e5e7eb; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
    .stats-section-title .sec-icon { font-size: 18px; }

    /* Overall Progress Ring */
    .progress-ring-wrap { display: flex; align-items: center; gap: 24px; background: #1f2937; border: 1px solid #374151; border-radius: 12px; padding: 24px; margin-bottom: 28px; }
    .progress-ring-info { flex: 1; }
    .progress-ring-info h3 { font-size: 18px; font-weight: 700; color: #f3f4f6; margin-bottom: 4px; }
    .progress-ring-info p { font-size: 13px; color: #9ca3af; margin-bottom: 12px; }
    .progress-ring-info .motivate { font-size: 14px; color: #fbbf24; font-weight: 600; }
    .ring-svg { flex-shrink: 0; }

    /* Priority Bars */
    .priority-bars { display: flex; flex-direction: column; gap: 12px; background: #1f2937; border: 1px solid #374151; border-radius: 12px; padding: 20px; }
    .priority-row { display: flex; align-items: center; gap: 12px; }
    .priority-label { width: 32px; font-size: 12px; font-weight: 700; text-align: center; padding: 2px 0; border-radius: 4px; flex-shrink: 0; }
    .priority-label.P0 { background: #7f1d1d; color: #fca5a5; }
    .priority-label.P1 { background: #78350f; color: #fde68a; }
    .priority-label.P2 { background: #1e3a5f; color: #93c5fd; }
    .priority-bar-track { flex: 1; height: 10px; background: #374151; border-radius: 5px; overflow: hidden; }
    .priority-bar-fill { height: 100%; border-radius: 5px; transition: width 0.5s; }
    .priority-bar-fill.P0 { background: linear-gradient(90deg, #dc2626, #f87171); }
    .priority-bar-fill.P1 { background: linear-gradient(90deg, #d97706, #fbbf24); }
    .priority-bar-fill.P2 { background: linear-gradient(90deg, #2563eb, #60a5fa); }
    .priority-nums { font-size: 11px; color: #9ca3af; width: 70px; text-align: right; flex-shrink: 0; }

    /* Phase List */
    .phase-list { display: flex; flex-direction: column; gap: 8px; }
    .phase-item { background: #1f2937; border: 1px solid #374151; border-radius: 10px; padding: 14px 16px; display: flex; align-items: center; gap: 14px; }
    .phase-status-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
    .phase-status-icon.completed { background: #064e3b; color: #6ee7b7; }
    .phase-status-icon.in_progress { background: #1e3a5f; color: #93c5fd; }
    .phase-status-icon.pending { background: #374151; color: #6b7280; }
    .phase-info { flex: 1; min-width: 0; }
    .phase-info-title { font-size: 13px; font-weight: 600; color: #e5e7eb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .phase-info-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
    .phase-bar-mini { width: 80px; height: 6px; background: #374151; border-radius: 3px; overflow: hidden; flex-shrink: 0; }
    .phase-bar-mini-fill { height: 100%; background: #10b981; border-radius: 3px; }
    .phase-pct { font-size: 12px; font-weight: 700; color: #9ca3af; width: 40px; text-align: right; flex-shrink: 0; }
    .phase-item-wrap { background: #1f2937; border: 1px solid #374151; border-radius: 10px; overflow: hidden; }
    .phase-item-main { display: flex; align-items: center; gap: 14px; padding: 14px 16px; cursor: pointer; transition: background 0.15s; }
    .phase-item-main:hover { background: rgba(55,65,81,0.3); }
    .phase-expand-icon { width: 16px; font-size: 10px; color: #6b7280; flex-shrink: 0; transition: transform 0.2s; text-align: center; }
    .phase-item-wrap.expanded .phase-expand-icon { transform: rotate(90deg); }
    .phase-subtasks { display: none; border-top: 1px solid #374151; padding: 6px 0; }
    .phase-item-wrap.expanded .phase-subtasks { display: block; }
    .phase-sub-item { display: flex; align-items: center; gap: 8px; padding: 4px 16px 4px 62px; font-size: 12px; }
    .phase-sub-icon { width: 14px; height: 14px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; flex-shrink: 0; }
    .phase-sub-icon.completed { background: #064e3b; color: #6ee7b7; }
    .phase-sub-icon.in_progress { background: #1e3a5f; color: #93c5fd; }
    .phase-sub-icon.pending { background: #374151; color: #6b7280; }
    .phase-sub-icon.cancelled { background: #451a03; color: #fbbf24; }
    .phase-sub-name { color: #d1d5db; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .phase-sub-name.completed { color: #6ee7b7; text-decoration: line-through; text-decoration-color: rgba(110,231,183,0.3); }
    .phase-sub-id { color: #4b5563; font-size: 10px; font-family: monospace; flex-shrink: 0; }
    .phase-time { color: #6ee7b7; font-size: 10px; opacity: 0.8; }
    .phase-sub-time { color: #6ee7b7; font-size: 10px; opacity: 0.7; flex-shrink: 0; margin-left: auto; }
    .phase-time { color: #6ee7b7; font-size: 10px; }
    .phase-sub-time { color: #6ee7b7; font-size: 10px; flex-shrink: 0; margin-left: auto; }

    /* Module Cards */
    .module-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .module-card { background: #1f2937; border: 1px solid #374151; border-radius: 10px; padding: 16px; }
    .module-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .module-card-dot { width: 10px; height: 10px; border-radius: 50%; background: #10b981; flex-shrink: 0; }
    .module-card-name { font-size: 13px; font-weight: 600; color: #e5e7eb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .module-card-bar { width: 100%; height: 6px; background: #374151; border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
    .module-card-bar-fill { height: 100%; background: linear-gradient(90deg, #059669, #10b981); border-radius: 3px; }
    .module-card-stats { display: flex; justify-content: space-between; font-size: 11px; color: #6b7280; }

    /* ===== Docs Browser Page ===== */
    .docs-page { display: flex; flex: 1; min-height: 0; overflow: hidden; background: #111827; }
    .docs-sidebar { width: 280px; background: #1f2937; border-right: 1px solid #374151; display: flex; flex-direction: column; flex-shrink: 0; overflow: hidden; }
    .docs-sidebar-header { padding: 16px 20px 12px; border-bottom: 1px solid #374151; flex-shrink: 0; }
    .docs-sidebar-header h3 { font-size: 15px; font-weight: 700; color: #f3f4f6; margin-bottom: 8px; }
    .docs-search-wrap { position: relative; }
    .docs-search { width: 100%; background: #111827; border: 1px solid #374151; border-radius: 6px; padding: 7px 30px 7px 10px; color: #e5e7eb; font-size: 12px; outline: none; transition: border-color 0.2s; box-sizing: border-box; }
    .docs-search:focus { border-color: #6366f1; }
    .docs-search::placeholder { color: #6b7280; }
    .docs-search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; border: none; background: none; color: #6b7280; font-size: 14px; cursor: pointer; display: none; align-items: center; justify-content: center; border-radius: 4px; padding: 0; line-height: 1; }
    .docs-search-clear:hover { color: #e5e7eb; background: #374151; }
    .docs-search-clear.show { display: flex; }
    .docs-group-list { overflow-y: auto; flex: 1; padding: 8px 0; scrollbar-width: thin; scrollbar-color: #374151 transparent; }
    .docs-group-list::-webkit-scrollbar { width: 6px; }
    .docs-group-list::-webkit-scrollbar-track { background: transparent; }
    .docs-group-list::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
    .docs-group { margin-bottom: 4px; }
    .docs-group-title { display: flex; align-items: center; gap: 8px; padding: 8px 20px; font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; user-select: none; transition: color 0.15s; }
    .docs-group-title:hover { color: #d1d5db; }
    .docs-group-title .docs-group-arrow { font-size: 9px; transition: transform 0.2s; color: #6b7280; }
    .docs-group.collapsed .docs-group-arrow { transform: rotate(-90deg); }
    .docs-group.collapsed .docs-group-items { display: none; }
    .docs-group-count { font-size: 10px; color: #4b5563; font-weight: 500; margin-left: auto; }
    .docs-item { display: flex; align-items: center; gap: 8px; padding: 7px 20px 7px 28px; cursor: pointer; transition: background 0.15s; font-size: 13px; color: #d1d5db; border-left: 3px solid transparent; }
    .docs-item:hover { background: rgba(55,65,81,0.4); }
    .docs-item.active { background: rgba(99,102,241,0.12); border-left-color: #6366f1; color: #a5b4fc; }
    .docs-item-icon { font-size: 14px; flex-shrink: 0; opacity: 0.7; }
    .docs-item-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .docs-item-sub { font-size: 10px; color: #6b7280; flex-shrink: 0; }
    .docs-item-toggle { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 4px; background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3); color: #818cf8; font-size: 12px; font-weight: 700; cursor: pointer; flex-shrink: 0; transition: all 0.15s; line-height: 1; }
    .docs-item-toggle:hover { background: rgba(99,102,241,0.3); color: #a5b4fc; }
    .docs-children { overflow: hidden; transition: max-height 0.25s ease; }
    .docs-children.collapsed { max-height: 0 !important; }
    .docs-children .docs-item { padding-left: 44px; font-size: 12px; opacity: 0.85; }
    .docs-children .docs-children .docs-item { padding-left: 60px; font-size: 11px; opacity: 0.75; }
    .docs-child-line { position: absolute; left: 35px; top: 0; bottom: 0; width: 1px; background: #374151; }
    .docs-item-wrapper { position: relative; }

    .docs-content { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
    .docs-content-header { padding: 16px 28px 12px; border-bottom: 1px solid #374151; flex-shrink: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .docs-content-title { font-size: 20px; font-weight: 700; color: #f3f4f6; }
    .docs-content-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 4px; }
    .docs-content-tag { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #374151; color: #9ca3af; }
    .docs-content-tag.section { background: rgba(99,102,241,0.15); color: #a5b4fc; }
    .docs-content-tag.version { background: rgba(16,185,129,0.15); color: #6ee7b7; }
    .docs-content-body { flex: 1; overflow-y: auto; padding: 20px 28px 40px; scrollbar-width: thin; scrollbar-color: #374151 transparent; }
    .docs-content-body::-webkit-scrollbar { width: 6px; }
    .docs-content-body::-webkit-scrollbar-track { background: transparent; }
    .docs-content-body::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
    .docs-content-empty { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .docs-content-empty .empty-icon { font-size: 48px; opacity: 0.4; }

    /* RAG Chat UI */
    .docs-chat-container { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .docs-chat-messages { flex: 1; overflow-y: auto; padding: 20px 28px; scrollbar-width: thin; scrollbar-color: #374151 transparent; }
    .docs-chat-messages::-webkit-scrollbar { width: 6px; }
    .docs-chat-messages::-webkit-scrollbar-track { background: transparent; }
    .docs-chat-messages::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
    .docs-chat-welcome { text-align: center; padding: 60px 40px 30px; color: #6b7280; }
    .docs-chat-welcome .welcome-icon { font-size: 48px; opacity: 0.4; margin-bottom: 12px; }
    .docs-chat-welcome .welcome-title { font-size: 16px; font-weight: 600; color: #9ca3af; margin-bottom: 6px; }
    .docs-chat-welcome .welcome-desc { font-size: 13px; color: #6b7280; line-height: 1.6; }
    .docs-chat-welcome .welcome-tips { margin-top: 20px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
    .docs-chat-welcome .tip-chip { font-size: 12px; padding: 6px 14px; border-radius: 16px; background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2); color: #a5b4fc; cursor: pointer; transition: all 0.15s; }
    .docs-chat-welcome .tip-chip:hover { background: rgba(99,102,241,0.2); border-color: rgba(99,102,241,0.4); }

    .chat-bubble { margin-bottom: 16px; max-width: 90%; animation: chatFadeIn 0.25s ease; }
    .chat-bubble.user { margin-left: auto; }
    .chat-bubble.assistant { margin-right: auto; }
    .chat-bubble-inner { padding: 10px 16px; border-radius: 12px; font-size: 13px; line-height: 1.6; }
    .chat-bubble.user .chat-bubble-inner { background: rgba(99,102,241,0.2); color: #c7d2fe; border-bottom-right-radius: 4px; }
    .chat-bubble.assistant .chat-bubble-inner { background: #1f2937; color: #d1d5db; border: 1px solid #374151; border-bottom-left-radius: 4px; }
    .chat-result-card { margin-top: 8px; padding: 10px 14px; border-radius: 8px; background: rgba(55,65,81,0.4); border: 1px solid #374151; cursor: pointer; transition: all 0.15s; }
    .chat-result-card:hover { background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.3); }
    .chat-result-title { font-size: 13px; font-weight: 600; color: #a5b4fc; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
    .chat-result-score { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(16,185,129,0.15); color: #6ee7b7; font-weight: 500; }
    .chat-result-snippet { font-size: 11px; color: #9ca3af; line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
    .chat-result-meta { font-size: 10px; color: #6b7280; margin-top: 4px; display: flex; gap: 8px; }
    .chat-no-result { color: #6b7280; font-size: 12px; margin-top: 8px; }
    .chat-typing { display: flex; gap: 4px; padding: 12px 16px; }
    .chat-typing-dot { width: 6px; height: 6px; border-radius: 50%; background: #6b7280; animation: chatTyping 1.2s infinite; }
    .chat-typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .chat-typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes chatTyping { 0%,60%,100% { opacity: 0.3; transform: scale(0.8); } 30% { opacity: 1; transform: scale(1); } }
    @keyframes chatFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    .docs-chat-input-wrap { padding: 12px 20px 16px; border-top: 1px solid #374151; flex-shrink: 0; display: flex; gap: 8px; align-items: flex-end; background: #111827; }
    .docs-chat-input { flex: 1; background: #1f2937; border: 1px solid #374151; border-radius: 12px; padding: 10px 16px; color: #e5e7eb; font-size: 13px; outline: none; resize: none; min-height: 20px; max-height: 120px; line-height: 1.5; font-family: inherit; transition: border-color 0.2s; }
    .docs-chat-input:focus { border-color: #6366f1; }
    .docs-chat-input::placeholder { color: #6b7280; }
    .docs-chat-send { width: 36px; height: 36px; border-radius: 10px; border: none; background: #6366f1; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; font-size: 16px; }
    .docs-chat-send:hover { background: #818cf8; }
    .docs-chat-send:disabled { background: #374151; color: #6b7280; cursor: not-allowed; }
    .docs-related { margin-top: 20px; border-top: 1px solid #374151; padding-top: 16px; }
    .docs-related-title { font-size: 13px; font-weight: 600; color: #9ca3af; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
    .docs-related-item { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12px; color: #d1d5db; }
    .docs-related-item .rel-icon { width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; flex-shrink: 0; }

    /* Debug bar */
    .debug { position: absolute; bottom: 0; left: 12px; background: rgba(31,41,55,0.9); border: 1px solid #374151; border-radius: 8px 8px 0 0; padding: 8px 12px; font-size: 11px; color: #9ca3af; z-index: 30; max-width: 400px; }
    .debug .ok { color: #10b981; }
    .debug .err { color: #f87171; }

    /* Stats Modal — left side panel */
    .stats-modal-overlay { display: none; position: fixed; inset: 0; z-index: 200; pointer-events: none; }
    .stats-modal-overlay.active { display: block; }
    .stats-modal { position: fixed; top: 0; bottom: 0; left: 48px; width: 300px; background: #1f2937; border-right: 1px solid #374151; display: flex; flex-direction: column; box-shadow: 4px 0 24px rgba(0,0,0,0.4); animation: modal-slide-in 0.2s ease; z-index: 201; pointer-events: auto; transition: left 0.25s ease; }
    @keyframes modal-slide-in { from { opacity: 0; transform: translateX(-16px); } to { opacity: 1; transform: translateX(0); } }
    .stats-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #374151; }
    .stats-modal-title { font-size: 15px; font-weight: 700; color: #f3f4f6; }
    .stats-modal-count { font-size: 12px; color: #6b7280; margin-left: 8px; }
    .stats-modal-close { background: none; border: none; color: #6b7280; font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 4px; line-height: 1; }
    .stats-modal-close:hover { background: #374151; color: #e5e7eb; }
    .stats-modal-body { overflow-y: auto; padding: 8px 0; flex: 1; min-height: 0; scrollbar-width: thin; scrollbar-color: #374151 transparent; }
    .stats-modal-body::-webkit-scrollbar { width: 6px; }
    .stats-modal-body::-webkit-scrollbar-track { background: transparent; }
    .stats-modal-body::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
    .stats-modal-body::-webkit-scrollbar-thumb:hover { background: #4b5563; }
    .doc-modal-search-sticky { position: sticky; top: 0; z-index: 2; background: #1f2937; padding: 12px 16px 8px; border-bottom: 1px solid #374151; }
    .stats-modal-item { display: flex; align-items: center; gap: 10px; padding: 10px 20px; cursor: pointer; transition: background 0.15s; }
    .stats-modal-item:hover { background: #283344; }
    .stats-modal-item-icon { font-size: 14px; flex-shrink: 0; width: 22px; text-align: center; }
    .stats-modal-item-name { flex: 1; font-size: 13px; color: #e5e7eb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .stats-modal-item-badge { font-size: 11px; padding: 2px 8px; border-radius: 9999px; flex-shrink: 0; }
    .stats-modal-item-badge.completed { background: rgba(16,185,129,0.15); color: #6ee7b7; }
    .stats-modal-item-badge.in_progress { background: rgba(59,130,246,0.15); color: #93c5fd; }
    .stats-modal-item-badge.pending { background: rgba(107,114,128,0.15); color: #9ca3af; }
    .stats-modal-item-badge.cancelled { background: rgba(146,64,14,0.15); color: #fbbf24; }
    .stats-modal-item-badge.active { background: rgba(16,185,129,0.15); color: #6ee7b7; }
    .stats-modal-item-sub { font-size: 11px; color: #6b7280; flex-shrink: 0; font-family: monospace; }
`;
}
