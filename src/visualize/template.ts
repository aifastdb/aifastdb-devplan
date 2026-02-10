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
    .panel-header.document { background: linear-gradient(135deg, #7c3aed, #a78bfa); }
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
    .legend-sep { width: 100%; height: 0; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-icon { width: 12px; height: 12px; }
    .legend-icon.star { background: #f59e0b; clip-path: polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%); }
    .legend-icon.diamond { background: #10b981; clip-path: polygon(50% 0%,100% 50%,50% 100%,0% 50%); }
    .legend-icon.circle { background: #6366f1; border-radius: 50%; }
    .legend-icon.dot { background: #8b5cf6; border-radius: 50%; width: 8px; height: 8px; }
    .legend-icon.square { background: #a78bfa; border-radius: 2px; width: 10px; height: 10px; }
    .legend-line { width: 24px; height: 2px; }
    .legend-line.solid { background: #6b7280; }
    .legend-line.thin { background: #6b7280; height: 1px; }
    .legend-line.dashed { border-top: 2px dashed #6b7280; background: none; height: 0; }
    .legend-line.dotted { border-top: 2px dotted #10b981; background: none; height: 0; }
    .legend-line.task-doc { border-top: 2px dashed #b45309; background: none; height: 0; }

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

    /* Debug bar */
    .debug { position: absolute; bottom: 0; left: 12px; background: rgba(31,41,55,0.9); border: 1px solid #374151; border-radius: 8px 8px 0 0; padding: 8px 12px; font-size: 11px; color: #9ca3af; z-index: 30; max-width: 400px; }
    .debug .ok { color: #10b981; }
    .debug .err { color: #f87171; }
  </style>
</head>
<body>
<div class="app-layout">
  <!-- Sidebar -->
  <div class="sidebar" id="sidebar">
    <div class="sidebar-header" onclick="toggleSidebar()" title="展开/收起导航">
      <span class="sidebar-logo sidebar-logo-short">Ai</span>
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
      <div class="nav-item disabled" data-page="docs" onclick="navTo('docs')">
        <span class="nav-item-icon">📄</span>
        <span class="nav-item-text">文档浏览</span>
        <span class="nav-item-badge">即将推出</span>
        <span class="nav-tooltip">文档浏览 (即将推出)</span>
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

<script>
// ========== Sidebar ==========
function toggleSidebar() {
  var sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('expanded');
  var isExpanded = sidebar.classList.contains('expanded');
  // 记住偏好
  try { localStorage.setItem('devplan_sidebar_expanded', isExpanded ? '1' : '0'); } catch(e) {}
  // 通知 vis-network 重新适配尺寸
  setTimeout(function() { if (network) network.redraw(); }, 300);
}

var currentPage = 'graph';
var pageMap = { graph: 'pageGraph', stats: 'pageStats' };

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

  // 按需加载页面数据
  if (page === 'stats') loadStatsPage();
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

// 监听 Ctrl 按键状态
document.addEventListener('keydown', function(e) { if (e.key === 'Control') ctrlPressed = true; });
document.addEventListener('keyup', function(e) { if (e.key === 'Control') ctrlPressed = false; });
window.addEventListener('blur', function() { ctrlPressed = false; });

// ========== Node Styles ==========
var STATUS_COLORS = {
  completed:   { bg: '#059669', border: '#047857', font: '#d1fae5' },
  in_progress: { bg: '#2563eb', border: '#1d4ed8', font: '#dbeafe' },
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
    return { shape: 'star', size: ns.size, color: { background: '#f59e0b', border: '#d97706', highlight: { background: '#fbbf24', border: '#d97706' } }, font: { size: ns.fontSize, color: '#fff' }, borderWidth: 3 };
  }
  if (t === 'module') {
    return { shape: 'diamond', size: ns.size, color: { background: '#059669', border: '#047857', highlight: { background: '#10b981', border: '#047857' } }, font: { size: ns.fontSize, color: '#d1fae5' }, borderWidth: 2 };
  }
  if (t === 'main-task') {
    return { shape: 'dot', size: ns.size, color: { background: sc.bg, border: sc.border, highlight: { background: sc.bg, border: '#fff' } }, font: { size: ns.fontSize, color: sc.font }, borderWidth: 2 };
  }
  if (t === 'sub-task') {
    return { shape: 'dot', size: ns.size, color: { background: sc.bg, border: sc.border, highlight: { background: sc.bg, border: '#fff' } }, font: { size: ns.fontSize, color: sc.font }, borderWidth: 1 };
  }
  if (t === 'document') {
    return { shape: 'box', size: ns.size, color: { background: '#7c3aed', border: '#6d28d9', highlight: { background: '#8b5cf6', border: '#6d28d9' } }, font: { size: ns.fontSize, color: '#ddd6fe' }, borderWidth: 1 };
  }
  return { shape: 'dot', size: ns.size, color: { background: '#6b7280', border: '#4b5563' }, font: { size: ns.fontSize, color: '#9ca3af' } };
}

function edgeStyle(edge) {
  var label = edge.label || '';
  if (label === 'has_main_task') return { width: 2, color: { color: '#6b7280', highlight: '#93c5fd' }, dashes: false, arrows: { to: { enabled: true, scaleFactor: 0.6 } } };
  if (label === 'has_sub_task') return { width: 1, color: { color: '#4b5563', highlight: '#818cf8' }, dashes: false, arrows: { to: { enabled: true, scaleFactor: 0.4 } } };
  if (label === 'has_document') return { width: 1, color: { color: '#4b5563', highlight: '#a78bfa' }, dashes: [5, 5], arrows: { to: { enabled: true, scaleFactor: 0.4 } } };
  if (label === 'module_has_task') return { width: 1.5, color: { color: '#065f46', highlight: '#34d399' }, dashes: [2, 4], arrows: { to: { enabled: true, scaleFactor: 0.5 } } };
  if (label === 'task_has_doc') return { width: 1.5, color: { color: '#b45309', highlight: '#f59e0b' }, dashes: [4, 3], arrows: { to: { enabled: true, scaleFactor: 0.5 } } };
  return { width: 1, color: { color: '#374151' }, dashes: false };
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
  for (var i = 0; i < graph.nodes.length; i++) {
    if (graph.nodes[i].type === 'module') moduleCount++;
  }
  bar.innerHTML =
    '<div class="stat"><span class="num amber">' + moduleCount + '</span> 模块</div>' +
    '<div class="stat"><span class="num blue">' + progress.mainTaskCount + '</span> 主任务</div>' +
    '<div class="stat"><span class="num purple">' + progress.subTaskCount + '</span> 子任务</div>' +
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
    for (var i = 0; i < allNodes.length; i++) {
      var n = allNodes[i];
      if (hiddenTypes[n.type]) continue;
      var deg = getNodeDegree(n);
      var s = nodeStyle(n, deg);
      visibleNodes.push({ id: n.id, label: n.label, title: n.label + ' (连接: ' + deg + ')', shape: s.shape, size: s.size, color: s.color, font: s.font, borderWidth: s.borderWidth, _type: n.type, _props: n.properties || {} });
    }

    var visibleIds = {};
    for (var i = 0; i < visibleNodes.length; i++) visibleIds[visibleNodes[i].id] = true;

    var visibleEdges = [];
    for (var i = 0; i < allEdges.length; i++) {
      var e = allEdges[i];
      if (!visibleIds[e.from] || !visibleIds[e.to]) continue;
      var es = edgeStyle(e);
      visibleEdges.push({ id: 'e' + i, from: e.from, to: e.to, width: es.width, color: es.color, dashes: es.dashes, arrows: es.arrows, _label: e.label });
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
      network.fit({ animation: { duration: 800, easingFunction: 'easeInOutQuad' } });
    });

    network.on('click', function(params) {
      if (params.nodes.length > 0) {
        // 直接点击图谱节点 → 清空历史栈，重新开始导航
        panelHistory = [];
        currentPanelNodeId = null;
        showPanel(params.nodes[0]);
      } else {
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
  showPanel(nodeId);
}

/** 返回上一个面板 */
function panelGoBack() {
  if (panelHistory.length === 0) return;
  var prevNodeId = panelHistory.pop();
  network.selectNodes([prevNodeId]);
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

// ========== Auto Refresh ==========
var autoRefreshTimer = null;
var AUTO_REFRESH_INTERVAL = 15000; // 15秒自动刷新

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(function() {
    log('自动刷新: 检查数据更新...', true);
    silentRefresh();
  }, AUTO_REFRESH_INTERVAL);
}

/** 静默刷新：只更新数据，不重建图谱（避免布局跳动） */
function silentRefresh() {
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
  }).catch(function(err) {
    log('自动刷新失败: ' + err.message, false);
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
  startAutoRefresh();
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
