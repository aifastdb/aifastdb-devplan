/**
 * DevPlan 图可视化 HTML 模板
 *
 * 自包含的 HTML 页面，通过 CDN 引入 vis-network standalone 版本。
 * 支持 5 种节点类型和 4 种边类型的视觉映射，暗色主题。
 */

export function getVisualizationHTML(projectName: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevPlan - ${projectName}</title>
  <style>
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
    .panel-header.module { background: linear-gradient(135deg, #059669, #10b981); }
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
    .legend-refresh-btn { display: flex; align-items: center; justify-content: center; background: none; border: 1px solid #374151; border-radius: 4px; padding: 3px 6px; cursor: pointer; color: #9ca3af; transition: color 0.2s, border-color 0.2s, background 0.2s; }
    .legend-refresh-btn:hover { color: #60a5fa; border-color: #60a5fa; background: rgba(96,165,250,0.08); }
    .legend-refresh-btn:active { color: #3b82f6; }
    .legend-refresh-btn.refreshing .legend-refresh-icon { animation: spin-refresh 0.8s linear infinite; }
    @keyframes spin-refresh { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .legend-sep { width: 100%; height: 0; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-icon { width: 12px; height: 12px; }
    .legend-icon.star { background: #f59e0b; clip-path: polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%); }
    .legend-icon.diamond { background: #10b981; clip-path: polygon(50% 0%,100% 50%,50% 100%,0% 50%); }
    .legend-icon.circle { background: #6366f1; border-radius: 50%; }
    .legend-icon.dot { background: #8b5cf6; border-radius: 50%; width: 8px; height: 8px; }
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
  </style>
</head>
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
        <span class="nav-item-text">文档浏览</span>
        <span class="nav-tooltip">文档浏览</span>
      </div>
      <div class="nav-item" data-page="stats" onclick="navTo('stats')">
        <span class="nav-item-icon">📊</span>
        <span class="nav-item-text">统计仪表盘</span>
        <span class="nav-tooltip">统计仪表盘</span>
      </div>
    </div>
    <div class="sidebar-footer">
      <div class="nav-item disabled" data-page="settings" onclick="navTo('settings')">
        <span class="nav-item-icon">⚙️</span>
        <span class="nav-item-text">项目设置</span>
        <span class="nav-item-badge">即将推出</span>
        <span class="nav-tooltip">项目设置 (即将推出)</span>
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
        <!-- 刷新按钮 -->
        <button class="legend-refresh-btn" id="legendRefreshBtn" onclick="manualRefresh()" title="刷新数据 (F5)">
          <svg class="legend-refresh-icon" id="legendRefreshIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        </button>
        <div class="legend-divider"></div>
        <!-- 筛选复选框 -->
        <label class="filter-check"><input type="checkbox" checked data-type="module" onchange="toggleFilter('module')"> 模块</label>
        <label class="filter-check"><input type="checkbox" checked data-type="main-task" onchange="toggleFilter('main-task')"> 主任务</label>
        <label class="filter-check"><input type="checkbox" checked data-type="sub-task" onchange="toggleFilter('sub-task')"> 子任务</label>
        <label class="filter-check"><input type="checkbox" checked data-type="document" onchange="toggleFilter('document')"> 文档</label>
        <div class="legend-divider"></div>
        <!-- 图例 -->
        <div class="legend-item"><div class="legend-icon star"></div> 项目</div>
        <div class="legend-item"><div class="legend-icon diamond"></div> 模块</div>
        <div class="legend-item"><div class="legend-icon circle"></div> 主任务</div>
        <div class="legend-item"><div class="legend-icon dot"></div> 子任务</div>
        <div class="legend-item"><div class="legend-icon square"></div> 文档</div>
        <div class="legend-divider"></div>
        <div class="legend-item"><div class="legend-line solid"></div> 主任务</div>
        <div class="legend-item"><div class="legend-line thin"></div> 子任务</div>
        <div class="legend-item"><div class="legend-line dashed"></div> 文档</div>
        <div class="legend-item"><div class="legend-line dotted"></div> 模块关联</div>
        <div class="legend-item"><div class="legend-line task-doc"></div> 任务-文档</div>
        <div class="legend-item"><div class="legend-line doc-child"></div> 文档层级</div>
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
            <div class="docs-content-body" id="docsContentBody">
              <div class="doc-content" id="docsContentInner"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

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

<script>
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
var pageMap = { graph: 'pageGraph', stats: 'pageStats', docs: 'pageDocs' };

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

// ========== Debug ==========
var dbg = document.getElementById('debug');
function log(msg, ok) {
  console.log('[DevPlan]', msg);
  dbg.innerHTML = (ok ? '<span class="ok">✓</span> ' : '<span class="err">✗</span> ') + msg;
}

// ========== 动态加载 vis-network ==========
var VIS_URLS = [
  'https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js',
  'https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/vis-network/9.1.9/standalone/umd/vis-network.min.js'
];

function loadVisNetwork(index) {
  if (index >= VIS_URLS.length) {
    log('所有 CDN 均加载失败，请检查网络连接', false);
    document.getElementById('loading').innerHTML = '<div style="text-align:center"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><p style="color:#f87171;">vis-network 库加载失败</p><p style="color:#9ca3af;margin-top:8px;font-size:13px;">所有 CDN 源均不可用，请检查网络连接</p><button class="refresh-btn" onclick="location.reload()" style="margin-top:12px;">刷新页面</button></div>';
    return;
  }
  var url = VIS_URLS[index];
  log('尝试加载 CDN #' + (index+1) + ': ' + url.split('/')[2], true);
  var s = document.createElement('script');
  s.src = url;
  s.onload = function() {
    if (typeof vis !== 'undefined' && vis.Network && vis.DataSet) {
      log('vis-network 加载成功 (CDN #' + (index+1) + ')', true);
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

// ========== 边高亮：选中节点时关联边变色，取消选中时恢复灰色 ==========
function highlightConnectedEdges(nodeId) {
  if (!edgesDataSet || !network) return;
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

// ========== Node Styles ==========
var STATUS_COLORS = {
  completed:   { bg: '#059669', border: '#047857', font: '#d1fae5' },
  in_progress: { bg: '#7c3aed', border: '#6d28d9', font: '#ddd6fe' },
  pending:     { bg: '#4b5563', border: '#374151', font: '#d1d5db' },
  cancelled:   { bg: '#92400e', border: '#78350f', font: '#fde68a' }
};

// ========== 节点动态大小规则 ==========
// 根据节点的连接数（度数）动态调整大小，连接越多节点越大
// min: 最小尺寸, max: 最大尺寸, baseFont: 基础字号, maxFont: 最大字号
// scale: 缩放系数 (越大增长越快)
var NODE_SIZE_RULES = {
  'project':   { min: 35, max: 65, baseFont: 16, maxFont: 22, scale: 3.5 },
  'module':    { min: 20, max: 45, baseFont: 12, maxFont: 16, scale: 2.8 },
  'main-task': { min: 14, max: 38, baseFont: 11, maxFont: 15, scale: 2.2 },
  'sub-task':  { min: 7,  max: 18, baseFont: 8,  maxFont: 11, scale: 1.5 },
  'document':  { min: 12, max: 30, baseFont: 9,  maxFont: 13, scale: 1.8 }
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
    return { shape: 'star', size: ns.size, color: { background: '#f59e0b', border: '#d97706', highlight: { background: '#fbbf24', border: '#fff' } }, font: { size: ns.fontSize, color: '#fff' }, borderWidth: 3 };
  }
  if (t === 'module') {
    return { shape: 'diamond', size: ns.size, color: { background: '#059669', border: '#047857', highlight: { background: '#10b981', border: '#fff' } }, font: { size: ns.fontSize, color: '#d1fae5' }, borderWidth: 2 };
  }
  if (t === 'main-task') {
    return { shape: 'dot', size: ns.size, color: { background: sc.bg, border: sc.border, highlight: { background: sc.bg, border: '#fff' } }, font: { size: ns.fontSize, color: sc.font }, borderWidth: 2 };
  }
  if (t === 'sub-task') {
    return { shape: 'dot', size: ns.size, color: { background: sc.bg, border: sc.border, highlight: { background: sc.bg, border: '#fff' } }, font: { size: ns.fontSize, color: sc.font }, borderWidth: 1 };
  }
  if (t === 'document') {
    return { shape: 'box', size: ns.size, color: { background: '#2563eb', border: '#1d4ed8', highlight: { background: '#3b82f6', border: '#fff' } }, font: { size: ns.fontSize, color: '#dbeafe' }, borderWidth: 1 };
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
  if (label === 'module_has_task') return { width: 1.5, color: { color: EDGE_GRAY, highlight: '#34d399', hover: '#34d399' }, dashes: [2, 4], arrows: { to: { enabled: true, scaleFactor: 0.5 } }, _highlightColor: '#34d399' };
  if (label === 'task_has_doc') return { width: 1.5, color: { color: EDGE_GRAY, highlight: '#f59e0b', hover: '#f59e0b' }, dashes: [4, 3], arrows: { to: { enabled: true, scaleFactor: 0.5 } }, _highlightColor: '#f59e0b' };
  if (label === 'doc_has_child') return { width: 1.5, color: { color: EDGE_GRAY, highlight: '#c084fc', hover: '#c084fc' }, dashes: [6, 3], arrows: { to: { enabled: true, scaleFactor: 0.5 } }, _highlightColor: '#c084fc' };
  return { width: 1, color: { color: EDGE_GRAY, highlight: '#9ca3af', hover: '#9ca3af' }, dashes: false, _highlightColor: '#9ca3af' };
}

// ========== Data Loading ==========
function loadData() {
  document.getElementById('loading').style.display = 'flex';
  log('正在获取图谱数据...', true);
  var graphApiUrl = '/api/graph?includeNodeDegree=' + (INCLUDE_NODE_DEGREE ? 'true' : 'false') +
    '&enableBackendDegreeFallback=' + (ENABLE_BACKEND_DEGREE_FALLBACK ? 'true' : 'false');

  Promise.all([
    fetch(graphApiUrl).then(function(r) { return r.json(); }),
    fetch('/api/progress').then(function(r) { return r.json(); })
  ]).then(function(results) {
    var graphRes = results[0];
    var progressRes = results[1];
    allNodes = graphRes.nodes || [];
    allEdges = graphRes.edges || [];
    log('数据获取成功: ' + allNodes.length + ' 节点, ' + allEdges.length + ' 边', true);
    renderStats(progressRes, graphRes);
    renderGraph();
  }).catch(function(err) {
    log('数据获取失败: ' + err.message, false);
    document.getElementById('loading').innerHTML = '<div style="text-align:center"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><p style="color:#f87171;">数据加载失败: ' + err.message + '</p><button class="refresh-btn" onclick="loadData()" style="margin-top:12px;">重试</button></div>';
  });
}

function renderStats(progress, graph) {
  var bar = document.getElementById('statsBar');
  var pct = progress.overallPercent || 0;
  var moduleCount = 0;
  var docCount = 0;
  for (var i = 0; i < graph.nodes.length; i++) {
    if (graph.nodes[i].type === 'module') moduleCount++;
    if (graph.nodes[i].type === 'document') docCount++;
  }
  bar.innerHTML =
    '<div class="stat clickable" onclick="showStatsModal(\\x27module\\x27)" title="查看所有模块"><span class="num amber">' + moduleCount + '</span> 模块</div>' +
    '<div class="stat clickable" onclick="showStatsModal(\\x27main-task\\x27)" title="查看所有主任务"><span class="num blue">' + progress.mainTaskCount + '</span> 主任务</div>' +
    '<div class="stat clickable" onclick="showStatsModal(\\x27sub-task\\x27)" title="查看所有子任务"><span class="num purple">' + progress.subTaskCount + '</span> 子任务</div>' +
    '<div class="stat clickable" onclick="showStatsModal(\\x27document\\x27)" title="查看所有文档"><span class="num" style="color:#3b82f6;">📄 ' + docCount + '</span> 文档</div>' +
    '<div class="stat"><span class="num green">' + progress.completedSubTasks + '/' + progress.subTaskCount + '</span> 已完成</div>' +
    '<div class="stat"><div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div><span>' + pct + '%</span></div>';
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
      visibleNodes.push({ id: n.id, label: label, _origLabel: n.label, title: n.label + ' (连接: ' + deg + ')', shape: s.shape, size: s.size, color: s.color, font: s.font, borderWidth: s.borderWidth, _type: n.type, _props: n.properties || {}, _isParentDoc: isParentDoc });
    }

    var visibleIds = {};
    for (var i = 0; i < visibleNodes.length; i++) visibleIds[visibleNodes[i].id] = true;

    var visibleEdges = [];
    for (var i = 0; i < allEdges.length; i++) {
      var e = allEdges[i];
      if (!visibleIds[e.from] || !visibleIds[e.to]) continue;
      var es = edgeStyle(e);
      visibleEdges.push({ id: 'e' + i, from: e.from, to: e.to, width: es.width, _origWidth: es.width, color: es.color, dashes: es.dashes, arrows: es.arrows, _label: e.label, _highlightColor: es._highlightColor || '#9ca3af' });
    }

    log('可见节点: ' + visibleNodes.length + ', 可见边: ' + visibleEdges.length, true);

    nodesDataSet = new vis.DataSet(visibleNodes);
    edgesDataSet = new vis.DataSet(visibleEdges);

    if (network) {
      network.destroy();
      network = null;
    }

    network = new vis.Network(container, { nodes: nodesDataSet, edges: edgesDataSet }, {
      nodes: {
        borderWidth: 2,
        shadow: { enabled: true, color: 'rgba(0,0,0,0.3)', size: 5, x: 0, y: 2 }
      },
      edges: {
        smooth: { enabled: true, type: 'continuous', roundness: 0.5 },
        shadow: false
      },
      physics: {
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
        stabilization: { enabled: true, iterations: 200, updateInterval: 25 }
      },
      interaction: {
        hover: true,
        tooltipDelay: 100,
        navigationButtons: false,
        keyboard: false,
        zoomView: true,
        dragView: true
      },
      layout: {
        improvedLayout: false,
        hierarchical: false
      }
    });

    log('Network 实例已创建, 等待物理稳定化...', true);

    network.on('stabilizationIterationsDone', function() {
      network.setOptions({ physics: { enabled: false } });
      document.getElementById('loading').style.display = 'none';
      log('图谱渲染完成! ' + visibleNodes.length + ' 节点, ' + visibleEdges.length + ' 边', true);
      // 稳定后将父文档-子文档按思维导图方式整齐排列
      arrangeAllDocMindMaps();
      network.fit({ animation: { duration: 800, easingFunction: 'easeInOutQuad' } });
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

// ========== Detail Panel ==========

/** 面板导航历史栈：存储节点 ID，用于"返回"功能 */
var panelHistory = [];
var currentPanelNodeId = null;

/** 从关联链接跳转到新面板（将当前节点压入历史栈） */
function navigateToPanel(nodeId) {
  if (currentPanelNodeId) {
    panelHistory.push(currentPanelNodeId);
  }
  network.selectNodes([nodeId]);
  highlightConnectedEdges(nodeId);
  showPanel(nodeId);
}

/** 返回上一个面板 */
function panelGoBack() {
  if (panelHistory.length === 0) return;
  var prevNodeId = panelHistory.pop();
  network.selectNodes([prevNodeId]);
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

function showPanel(nodeId) {
  var node = nodesDataSet.get(nodeId);
  if (!node) return;
  var panel = document.getElementById('panel');
  var header = document.getElementById('panelHeader');
  var title = document.getElementById('panelTitle');
  var body = document.getElementById('panelBody');

  header.className = 'panel-header ' + (node._type || '');
  var typeNames = { project: '项目', module: '模块', 'main-task': '主任务', 'sub-task': '子任务', document: '文档' };
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
    area.innerHTML = '<div class="doc-content">' + renderMarkdown(doc.content) + '</div>';
    docContentVisible = true;
    var btn = document.getElementById('docToggleBtn');
    if (btn) btn.textContent = '收起';
  }).catch(function(err) {
    area.innerHTML = '<div class="doc-error">加载失败: ' + escHtml(err.message) + '</div>';
  });
}

/** 简易 Markdown 渲染 — 支持标题、粗体、斜体、代码、列表、表格、引用、链接、分隔线 */
function renderMarkdown(md) {
  if (!md) return '';

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

// ========== Filters ==========
function toggleFilter(type) {
  var cb = document.querySelector('.filter-check input[data-type="' + type + '"]');
  if (cb && !cb.checked) {
    hiddenTypes[type] = true;
  } else {
    delete hiddenTypes[type];
  }
  renderGraph();
}

// ========== Stats Modal ==========
/** 记录文档弹层中各文档的折叠状态（docKey → true 表示已展开） */
var docModalExpandedState = {};

function showStatsModal(nodeType) {
  // 文档类型使用专用渲染
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
    html += '<div class="stats-modal-item" onclick="statsModalGoToNode(\\x27' + n.id + '\\x27)">';
    html += '<span class="stats-modal-item-icon">' + icon + '</span>';
    html += '<span class="stats-modal-item-name" title="' + escHtml(n.label) + '">' + escHtml(n.label) + '</span>';
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

/** 获取文档节点的 docKey (section|subSection) */
function getDocNodeKey(node) {
  var p = node.properties || {};
  return p.section + (p.subSection ? '|' + p.subSection : '');
}

/** 构建文档层级树：{ node, children: [...] } */
function buildDocTree() {
  var docNodes = [];
  for (var i = 0; i < allNodes.length; i++) {
    if (allNodes[i].type === 'document') docNodes.push(allNodes[i]);
  }

  // 建立 parentDoc → children 映射
  var childrenMap = {};  // parentDocKey → [nodes]
  var childKeySet = {};  // 属于子文档的 nodeId 集合
  for (var i = 0; i < docNodes.length; i++) {
    var p = docNodes[i].properties || {};
    if (p.parentDoc) {
      if (!childrenMap[p.parentDoc]) childrenMap[p.parentDoc] = [];
      childrenMap[p.parentDoc].push(docNodes[i]);
      childKeySet[docNodes[i].id] = true;
    }
  }

  // 按 section 分组顶级文档
  var groups = {};
  var groupOrder = [];
  for (var i = 0; i < docNodes.length; i++) {
    if (childKeySet[docNodes[i].id]) continue;
    var sec = (docNodes[i].properties || {}).section || 'custom';
    if (!groups[sec]) { groups[sec] = []; groupOrder.push(sec); }
    groups[sec].push(docNodes[i]);
  }

  return { groups: groups, groupOrder: groupOrder, childrenMap: childrenMap };
}

/** 显示文档弹层（左侧列表） */
function showDocModal() {
  var docNodes = [];
  for (var i = 0; i < allNodes.length; i++) {
    if (allNodes[i].type === 'document') docNodes.push(allNodes[i]);
  }

  document.getElementById('statsModalTitle').textContent = '📄 文档列表';
  document.getElementById('statsModalCount').textContent = '(' + docNodes.length + ')';

  var tree = buildDocTree();
  var html = renderDocTreeHTML(tree);

  if (docNodes.length === 0) {
    html = '<div style="text-align:center;padding:40px;color:#6b7280;">暂无文档</div>';
  }

  document.getElementById('statsModalBody').innerHTML = html;
  // 根据侧边栏状态调整弹层位置
  updateStatsModalPosition();
  document.getElementById('statsModalOverlay').classList.add('active');
}

/** 渲染文档层级树 HTML */
function renderDocTreeHTML(tree) {
  var SECTION_NAMES_MODAL = {
    overview: '概述', core_concepts: '核心概念', api_design: 'API 设计',
    file_structure: '文件结构', config: '配置', examples: '使用示例',
    technical_notes: '技术笔记', api_endpoints: 'API 端点',
    milestones: '里程碑', changelog: '变更记录', custom: '自定义'
  };
  var SECTION_ICONS_MODAL = {
    overview: '▸', core_concepts: '▸', api_design: '▸',
    file_structure: '▸', config: '▸', examples: '▸',
    technical_notes: '▸', api_endpoints: '▸',
    milestones: '▸', changelog: '▸', custom: '▸'
  };

  var html = '';
  for (var gi = 0; gi < tree.groupOrder.length; gi++) {
    var sec = tree.groupOrder[gi];
    var items = tree.groups[sec];
    var secName = SECTION_NAMES_MODAL[sec] || sec;
    var secIcon = SECTION_ICONS_MODAL[sec] || '▸';

    html += '<div style="margin-bottom:4px;">';
    html += '<div style="padding:8px 20px;font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;display:flex;align-items:center;gap:6px;">';
    html += '<span>' + secName + '</span>';
    html += '<span style="margin-left:auto;font-size:10px;color:#4b5563;">' + items.length + '</span>';
    html += '</div>';

    for (var ii = 0; ii < items.length; ii++) {
      html += renderDocTreeItem(items[ii], tree.childrenMap, 0);
    }
    html += '</div>';
  }
  return html;
}

/** 递归渲染单个文档节点及其子文档 */
function renderDocTreeItem(node, childrenMap, depth) {
  var docKey = getDocNodeKey(node);
  var p = node.properties || {};
  var children = childrenMap[docKey] || [];
  var hasChildren = children.length > 0;
  var isExpanded = docModalExpandedState[docKey] === true;
  var paddingLeft = 20 + depth * 20;

  var html = '';

  // 文档项
  html += '<div class="stats-modal-item" style="padding-left:' + paddingLeft + 'px;gap:6px;" onclick="docModalSelectDoc(\\x27' + escHtml(docKey).replace(/'/g, "\\\\'") + '\\x27,\\x27' + escHtml(node.id).replace(/'/g, "\\\\'") + '\\x27)">';

  // 展开/折叠按钮
  if (hasChildren) {
    html += '<span class="doc-modal-toggle" onclick="event.stopPropagation();toggleDocModalExpand(\\x27' + escHtml(docKey).replace(/'/g, "\\\\'") + '\\x27)" style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#818cf8;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;transition:all 0.15s;line-height:1;">' + (isExpanded ? '−' : '+') + '</span>';
  } else {
    html += '<span style="width:18px;flex-shrink:0;"></span>';
  }

  html += '<span class="stats-modal-item-icon" style="font-size:13px;color:#6b7280;">▸</span>';
  html += '<span class="stats-modal-item-name" title="' + escHtml(node.label) + '" style="font-size:' + (depth > 0 ? '12' : '13') + 'px;' + (depth > 0 ? 'opacity:0.85;' : '') + '">' + escHtml(node.label) + '</span>';

  if (hasChildren) {
    html += '<span style="font-size:10px;color:#818cf8;flex-shrink:0;">' + children.length + '</span>';
  }
  if (p.subSection) {
    html += '<span style="font-size:10px;color:#6b7280;flex-shrink:0;font-family:monospace;">' + escHtml(p.subSection) + '</span>';
  }

  html += '</div>';

  // 子文档列表（仅展开时显示）
  if (hasChildren && isExpanded) {
    for (var ci = 0; ci < children.length; ci++) {
      html += renderDocTreeItem(children[ci], childrenMap, depth + 1);
    }
  }

  return html;
}

/** 展开/折叠文档弹层中的子文档 */
function toggleDocModalExpand(docKey) {
  docModalExpandedState[docKey] = !docModalExpandedState[docKey];
  // 重新渲染文档列表
  var tree = buildDocTree();
  var html = renderDocTreeHTML(tree);
  document.getElementById('statsModalBody').innerHTML = html;
}

/** 在文档弹层中选中文档 — 复用右侧图谱详情面板显示内容 */
function docModalSelectDoc(docKey, nodeId) {
  // 直接复用 statsModalGoToNode，聚焦图谱节点并打开已有的右侧详情面板
  statsModalGoToNode(nodeId);
}

function closeStatsModal() {
  document.getElementById('statsModalOverlay').classList.remove('active');
}

function statsModalGoToNode(nodeId) {
  if (network && nodesDataSet && nodesDataSet.get(nodeId)) {
    network.selectNodes([nodeId]);
    highlightConnectedEdges(nodeId);
    network.focus(nodeId, { scale: 1.2, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
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
  var graphApiUrl = '/api/graph?includeNodeDegree=' + (INCLUDE_NODE_DEGREE ? 'true' : 'false') +
    '&enableBackendDegreeFallback=' + (ENABLE_BACKEND_DEGREE_FALLBACK ? 'true' : 'false');
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

// ========== App Start ==========
function startApp() {
  log('vis-network 就绪, 开始加载数据...', true);
  loadData();
}

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

function loadDocsPage() {
  if (docsLoaded && docsData.length > 0) return;
  var list = document.getElementById('docsGroupList');
  if (list) list.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280;font-size:12px;"><div class="spinner" style="margin:0 auto 12px;width:24px;height:24px;border-width:3px;"></div>加载文档列表...</div>';

  fetch('/api/docs').then(function(r) { return r.json(); }).then(function(data) {
    docsData = data.docs || [];
    docsLoaded = true;
    renderDocsList(docsData);
  }).catch(function(err) {
    if (list) list.innerHTML = '<div style="text-align:center;padding:40px;color:#f87171;font-size:12px;">加载失败: ' + err.message + '<br><span style="cursor:pointer;color:#818cf8;text-decoration:underline;" onclick="docsLoaded=false;loadDocsPage();">重试</span></div>';
  });
}

/** 获取文档的 key（唯一标识） */
function docItemKey(item) {
  return item.section + (item.subSection ? '|' + item.subSection : '');
}

/** 记录哪些父文档处于折叠状态（key → true 表示折叠） */
var docsCollapsedState = {};

/** 将文档列表按 section 分组渲染，支持 parentDoc 层级 */
function renderDocsList(docs) {
  var list = document.getElementById('docsGroupList');
  if (!list) return;

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
      html += renderDocItemWithChildren(items[ii], childrenMap, secIcon);
    }

    html += '</div></div>';
  }

  list.innerHTML = html;
}

/** 递归渲染文档项及其子文档 */
function renderDocItemWithChildren(item, childrenMap, secIcon) {
  var docKey = docItemKey(item);
  var isActive = docKey === currentDocKey ? ' active' : '';
  var children = childrenMap[docKey] || [];
  var hasChildren = children.length > 0;
  var isCollapsed = docsCollapsedState[docKey] === true;

  var html = '<div class="docs-item-wrapper">';

  // 文档项本身
  html += '<div class="docs-item' + isActive + '" data-key="' + escHtml(docKey) + '" onclick="selectDoc(\\x27' + docKey.replace(/'/g, "\\\\'") + '\\x27)">';

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
      html += renderDocItemWithChildren(children[ci], childrenMap, secIcon);
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

/** 控制搜索框清除按钮的显示/隐藏 */
function toggleSearchClear() {
  var input = document.getElementById('docsSearch');
  var btn = document.getElementById('docsSearchClear');
  if (input && btn) {
    if (input.value.length > 0) { btn.classList.add('show'); } else { btn.classList.remove('show'); }
  }
}

/** 清空搜索框并重置列表 */
function clearDocsSearch() {
  var input = document.getElementById('docsSearch');
  if (input) { input.value = ''; input.focus(); }
  toggleSearchClear();
  filterDocs();
}

/** 搜索过滤文档列表 */
function filterDocs() {
  var query = (document.getElementById('docsSearch').value || '').toLowerCase().trim();
  if (!query) {
    renderDocsList(docsData);
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
  renderDocsList(filtered);
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

  document.getElementById('docsContentInner').innerHTML = contentHtml;
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

// ========== Init: 动态加载 vis-network ==========
loadVisNetwork(0);
</script>
</body>
</html>`;
}
