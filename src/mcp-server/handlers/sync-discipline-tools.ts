import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import type { ToolArgs } from '../tool-definitions';
import type { IDevPlanStore } from '../../dev-plan-interface';
import type { MainTask, SubTask } from '../../types';

/**
 * Phase-435 follow-up — devplan ↔ Cursor sync-discipline tools.
 *
 * This handler hosts the three tools that turn `docs/devplan-cursor-sync-workflow.md`
 * from "a doc people may forget to follow" into "MCP calls Agents can run":
 *
 *   1. `devplan_audit_active_layer`     — weekly active-layer audit (§4.1).
 *   2. `devplan_phase_alignment_check`  — description vs sub-task drift (§4.2).
 *   3. `devplan_session_close`          — end-of-session checklist (§3 + §2.4).
 *
 * All three are **read-only** (no mutations); they emit structured reports
 * with concrete next-action scripts the caller can run.
 *
 * Design rationale:
 *   - The Phase-435 / T435.5 cursor lifecycle hooks already give us a
 *     physical capture channel; these tools provide the *intent layer*
 *     that consumes the same task graph and produces the checklist
 *     the sync-workflow doc asks humans (or Agents) to maintain.
 *   - We avoid LLM calls — alignment uses light heuristics (list items,
 *     **bold** phrases, backticked terms) so the tool stays cheap and
 *     deterministic; LLM-quality detection can be layered later.
 */

type GetDevPlan = (projectName: string) => IDevPlanStore;

type Deps = {
  getDevPlan: GetDevPlan;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_DAYS = 7;
const DEFAULT_MAX_PHASES = 50;
const DEFAULT_LARGE_SUBTASK_HOURS = 8;

function asPositiveNumber(v: unknown, fallback: number, min = 0): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= min) return v;
  return fallback;
}

// ============================================================================
// devplan_audit_active_layer
// ============================================================================

interface PhaseAuditEntry {
  taskId: string;
  title: string;
  priority: string;
  totalSubtasks: number;
  completedSubtasks: number;
  pendingSubtasks: Array<{ taskId: string; title: string; estimatedHours?: number }>;
  inProgressSubtasks: Array<{ taskId: string; title: string; estimatedHours?: number }>;
  largeOptionalSubtasks: Array<{ taskId: string; title: string; estimatedHours?: number; status: string }>;
  lastActivityAt: number;
  lastActivityDaysAgo: number;
  stale: boolean;
  descriptionGoalsLikelyMissing: boolean;
  suggestedActions: string[];
}

function computePhaseLastActivity(mt: MainTask, subs: SubTask[]): number {
  let latest = mt.createdAt || 0;
  for (const s of subs) {
    if (s.updatedAt && s.updatedAt > latest) latest = s.updatedAt;
    if (s.completedAt && s.completedAt > latest) latest = s.completedAt;
  }
  return latest;
}

function buildAuditEntry(
  mt: MainTask,
  subs: SubTask[],
  staleDays: number,
  largeHourThreshold: number,
  now: number,
): PhaseAuditEntry {
  const pending = subs.filter(s => s.status === 'pending');
  const inProgress = subs.filter(s => s.status === 'in_progress');
  const lastActivityAt = computePhaseLastActivity(mt, subs);
  const lastActivityDaysAgo = lastActivityAt
    ? Math.floor((now - lastActivityAt) / DAY_MS)
    : Number.POSITIVE_INFINITY;
  const stale = lastActivityDaysAgo >= staleDays;
  const largeOptional = [...pending, ...inProgress].filter(
    s => typeof s.estimatedHours === 'number' && s.estimatedHours >= largeHourThreshold,
  );
  const descriptionGoals = extractGoalCandidates(mt.description || '');
  const subtaskHaystack = subs.map(s => `${s.title}\n${s.description || ''}`).join('\n').toLowerCase();
  const unmatched = descriptionGoals.filter(g => !goalCoveredBy(g, subtaskHaystack));
  const descriptionGoalsLikelyMissing = descriptionGoals.length > 0 && unmatched.length > 0;

  const suggestedActions: string[] = [];
  if (stale) {
    suggestedActions.push(
      `phase ${mt.taskId} stale ${lastActivityDaysAgo}d — sync-workflow §4.1: ask "实质完成了吗？" for each open sub-task.`,
    );
  }
  if (mt.totalSubtasks > 0 && mt.completedSubtasks >= mt.totalSubtasks - inProgress.length && pending.length === 0 && inProgress.length > 0) {
    suggestedActions.push(
      `phase ${mt.taskId} has only in_progress sub-tasks remaining (${inProgress.length}/${mt.totalSubtasks}) — Phase-426 pattern; verify against artifacts and consider devplan_complete_task with divergenceNote.`,
    );
  }
  for (const sub of largeOptional) {
    suggestedActions.push(
      `sub-task ${sub.taskId} estimatedHours=${sub.estimatedHours} ≥ ${largeHourThreshold}h — sync-workflow §4.3: migrate to a new Phase or mark cancelled instead of dragging this phase.`,
    );
  }
  if (descriptionGoalsLikelyMissing) {
    suggestedActions.push(
      `phase ${mt.taskId} description mentions ${unmatched.length} goal(s) not covered by any sub-task title/description — run devplan_phase_alignment_check taskId=${mt.taskId}.`,
    );
  }
  if (suggestedActions.length === 0) {
    suggestedActions.push(`phase ${mt.taskId} healthy — no drift signals; keep working.`);
  }

  return {
    taskId: mt.taskId,
    title: mt.title,
    priority: mt.priority,
    totalSubtasks: mt.totalSubtasks,
    completedSubtasks: mt.completedSubtasks,
    pendingSubtasks: pending.map(s => ({ taskId: s.taskId, title: s.title, estimatedHours: s.estimatedHours })),
    inProgressSubtasks: inProgress.map(s => ({ taskId: s.taskId, title: s.title, estimatedHours: s.estimatedHours })),
    largeOptionalSubtasks: largeOptional.map(s => ({
      taskId: s.taskId,
      title: s.title,
      estimatedHours: s.estimatedHours,
      status: s.status,
    })),
    lastActivityAt,
    lastActivityDaysAgo: Number.isFinite(lastActivityDaysAgo) ? lastActivityDaysAgo : -1,
    stale,
    descriptionGoalsLikelyMissing,
    suggestedActions,
  };
}

function handleAuditActiveLayer(args: ToolArgs, plan: IDevPlanStore): string {
  const staleDays = asPositiveNumber(args.staleDays, DEFAULT_STALE_DAYS, 0);
  const maxPhases = asPositiveNumber(args.maxPhases, DEFAULT_MAX_PHASES, 1);
  const largeHourThreshold = asPositiveNumber(
    args.largeSubtaskHourThreshold,
    DEFAULT_LARGE_SUBTASK_HOURS,
    0,
  );
  const now = Date.now();

  const allMain = plan.listMainTasks({ status: 'in_progress' });
  // Newest first so the user sees the active layer head; cap by maxPhases.
  const sorted = [...allMain].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const audited = sorted.slice(0, maxPhases);

  const entries: PhaseAuditEntry[] = audited.map(mt => {
    const subs = plan.listSubTasks(mt.taskId);
    return buildAuditEntry(mt, subs, staleDays, largeHourThreshold, now);
  });

  const staleCount = entries.filter(e => e.stale).length;
  const totalSuggestions = entries.reduce((acc, e) => acc + e.suggestedActions.length, 0);

  return JSON.stringify({
    status: 'audited',
    projectName: args.projectName,
    staleDays,
    largeSubtaskHourThreshold: largeHourThreshold,
    inProgressPhases: allMain.length,
    auditedPhases: entries.length,
    truncated: allMain.length > entries.length,
    staleCount,
    totalSuggestions,
    phases: entries,
  }, null, 2);
}

// ============================================================================
// devplan_phase_alignment_check
// ============================================================================

/**
 * Extracts "goal candidates" from a phase description using deterministic
 * heuristics. Goal candidates are short noun-phrases / proper nouns / terms
 * that a sub-task title would plausibly reference if the goal were honored.
 *
 * Sources (high → low confidence):
 *   1. Bullet / numbered list items beneath a "目标" / "Goals" header.
 *   2. Any bullet / numbered list items in the whole description.
 *   3. **bold** phrases (Markdown).
 *   4. `backticked` terms (Markdown / code).
 *
 * Output is de-duplicated (case-insensitive), trimmed, and short candidates
 * (<= 2 chars) are dropped.
 */
function extractGoalCandidates(description: string): string[] {
  if (!description || !description.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const cleaned = raw
      .replace(/[*_`]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\-\*\d\.\)\s:]+/, '')
      .replace(/[。.!?;；,，]+$/, '')
      .trim();
    if (cleaned.length < 3) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  };

  const lines = description.split(/\r?\n/);

  // Heuristic 1: explicit goals section
  const goalHeaderIdx = lines.findIndex(l => /^\s*#+\s*(目标|目的|Goals?|Objectives?)\b/i.test(l) || /^\s*(目标|Goals?|Objectives?)\s*[:：]/i.test(l));
  if (goalHeaderIdx >= 0) {
    for (let i = goalHeaderIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*#+\s/.test(l)) break;
      if (/^\s*[-*\d]+[.)]?\s+/.test(l)) {
        push(l);
      } else if (l.trim() === '') {
        // allow blank
      } else if (/^\s*\S/.test(l) && goalHeaderIdx + 1 === i) {
        // single-line goals follow header on same paragraph
        for (const seg of l.split(/[、,，;；]/)) push(seg);
        break;
      }
    }
  }

  // Heuristic 2: all list items
  for (const l of lines) {
    if (/^\s*[-*]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l)) {
      push(l);
    }
  }

  // Heuristic 3: **bold** phrases (max 5 to avoid noise from emphasis spam)
  const boldRe = /\*\*([^*\n]{3,80})\*\*/g;
  let m: RegExpExecArray | null;
  let boldCount = 0;
  while ((m = boldRe.exec(description)) !== null) {
    if (boldCount++ >= 5) break;
    push(m[1]);
  }

  // Heuristic 4: `backticked` terms (max 8)
  const tickRe = /`([^`\n]{3,80})`/g;
  let tickCount = 0;
  while ((m = tickRe.exec(description)) !== null) {
    if (tickCount++ >= 8) break;
    push(m[1]);
  }

  return out;
}

/**
 * Coarse-grained membership check used by alignment detection.
 *
 * We tokenize the goal into ≥2-char tokens (latin / CJK), then carve out
 * a "distinctive" subset — tokens that are ≥4 chars latin **or** any CJK
 * fragment. The goal is considered covered when **any** distinctive
 * token appears in the haystack. Rationale: the goal extraction itself
 * is heuristic and noisy; the alignment check should err on the side of
 * "found it" rather than nag the user with false positives.
 *
 * Phase-426 reference cases (must hold):
 *   - "LLM-as-judge 评分" vs haystack "implement judge scoring pipeline"
 *     → distinctive=[judge,评分]; "judge" hits → covered.
 *   - "chunked-path A/B" vs haystack "chunked-path switch" → covered.
 *   - "the cool thing" vs haystack "something else" → not covered (no
 *     distinctive token hits).
 *
 * If no distinctive token exists at all (e.g. all tokens are short
 * latin like "the cool" → ["the","cool"] post length-filter; cool is
 * length 4 so still distinctive — extreme edge case), we fall back to
 * "every token must appear" so we don't drown the user in noise.
 */
function goalCoveredBy(goal: string, lowerHaystack: string): boolean {
  if (!goal) return true;
  const goalLower = goal.toLowerCase();
  if (lowerHaystack.includes(goalLower)) return true;
  const tokens = goalLower
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(t => t.length >= 2);
  if (tokens.length === 0) return false;
  const distinctive = tokens.filter(
    t => t.length >= 4 || /[\u4e00-\u9fff]/.test(t),
  );
  if (distinctive.length > 0) {
    return distinctive.some(t => tokenInHaystack(t, lowerHaystack));
  }
  return tokens.every(t => tokenInHaystack(t, lowerHaystack));
}

/**
 * Token containment check tuned for bilingual goal matching.
 *
 *   - CJK tokens (any char in U+4E00..U+9FFF) use plain substring so
 *     "测试覆盖" still hits "完善测试覆盖率".
 *   - Latin tokens use word-boundary matching so "thing" does NOT match
 *     inside "something" — the Phase-426 alignment check must reject
 *     accidental sub-string overlaps that aren't actually semantic hits.
 */
function tokenInHaystack(tok: string, lowerHaystack: string): boolean {
  if (/[\u4e00-\u9fff]/.test(tok)) {
    return lowerHaystack.includes(tok);
  }
  const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
  return re.test(lowerHaystack);
}

function handleAlignmentCheck(args: ToolArgs, plan: IDevPlanStore): string {
  if (!args.taskId) {
    throw new McpError(ErrorCode.InvalidParams, 'Missing required: taskId');
  }
  const mt = plan.getMainTask(args.taskId);
  if (!mt) {
    throw new McpError(ErrorCode.InvalidParams, `Main task not found: ${args.taskId}`);
  }
  const description = mt.description || '';
  const subs = plan.listSubTasks(mt.taskId);
  const haystack = subs
    .map(s => `${s.title}\n${s.description || ''}`)
    .join('\n')
    .toLowerCase();

  const goalCandidates = extractGoalCandidates(description);
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const g of goalCandidates) {
    if (goalCoveredBy(g, haystack)) matched.push(g);
    else unmatched.push(g);
  }

  const suggestedActions: string[] = [];
  for (const g of unmatched) {
    suggestedActions.push(
      `goal "${g}" not covered by any sub-task — sync-workflow §4.2: ` +
        `either add a sub-task via devplan_add_sub_task or remove it from the description. ` +
        `(Phase-426 reference: "LLM-as-judge" was lost this way.)`,
    );
  }
  if (goalCandidates.length === 0) {
    suggestedActions.push(
      `no goal candidates extracted from ${mt.taskId} description — consider writing 1–3 verifiable goals (numbers / deliverables) per sync-workflow §2.1.`,
    );
  } else if (unmatched.length === 0) {
    suggestedActions.push(`all ${goalCandidates.length} extracted goals are covered by sub-tasks — alignment OK.`);
  }

  return JSON.stringify({
    status: 'checked',
    projectName: args.projectName,
    taskId: mt.taskId,
    title: mt.title,
    descriptionLength: description.length,
    subtaskCount: subs.length,
    goalCandidates,
    matchedGoals: matched,
    unmatchedGoals: unmatched,
    coverage: goalCandidates.length === 0
      ? null
      : Number((matched.length / goalCandidates.length).toFixed(3)),
    suggestedActions,
  }, null, 2);
}

// ============================================================================
// devplan_session_close
// ============================================================================

interface SessionTaskReport {
  taskId: string;
  taskType: 'main' | 'sub';
  title: string;
  status: string;
  openSubtasks?: Array<{ taskId: string; title: string; status: string; estimatedHours?: number }>;
  largeOptionalSubtasks?: Array<{ taskId: string; title: string; estimatedHours?: number }>;
  alignment?: {
    unmatchedGoals: string[];
    coverage: number | null;
  };
  closureChecklist?: {
    allRequiredSubtasksClosed: boolean;
    noInProgressSubtasks: boolean;
    descriptionGoalsAligned: boolean;
    hasCompletionMemory: boolean;
  };
  notes: string[];
}

function buildMainTaskReport(
  mt: MainTask,
  subs: SubTask[],
  largeHourThreshold: number,
): SessionTaskReport {
  const open = subs.filter(s => s.status === 'pending' || s.status === 'in_progress');
  const largeOptional = open.filter(
    s => typeof s.estimatedHours === 'number' && s.estimatedHours >= largeHourThreshold,
  );
  const description = mt.description || '';
  const goalCandidates = extractGoalCandidates(description);
  const haystack = subs.map(s => `${s.title}\n${s.description || ''}`).join('\n').toLowerCase();
  const unmatched = goalCandidates.filter(g => !goalCoveredBy(g, haystack));
  const notes: string[] = [];
  if (open.length > 0) {
    notes.push(`${open.length} open sub-task(s) remain (pending=${open.filter(s => s.status === 'pending').length}, in_progress=${open.filter(s => s.status === 'in_progress').length}).`);
  }
  if (largeOptional.length > 0) {
    notes.push(`${largeOptional.length} large optional sub-task(s) (≥${largeHourThreshold}h) — consider migrating to a new Phase.`);
  }
  if (unmatched.length > 0) {
    notes.push(`${unmatched.length} description goal(s) not covered by any sub-task — run devplan_phase_alignment_check.`);
  }
  return {
    taskId: mt.taskId,
    taskType: 'main',
    title: mt.title,
    status: mt.status,
    openSubtasks: open.map(s => ({
      taskId: s.taskId,
      title: s.title,
      status: s.status,
      estimatedHours: s.estimatedHours,
    })),
    largeOptionalSubtasks: largeOptional.map(s => ({
      taskId: s.taskId,
      title: s.title,
      estimatedHours: s.estimatedHours,
    })),
    alignment: {
      unmatchedGoals: unmatched,
      coverage: goalCandidates.length === 0
        ? null
        : Number(((goalCandidates.length - unmatched.length) / goalCandidates.length).toFixed(3)),
    },
    closureChecklist: {
      allRequiredSubtasksClosed: subs.length > 0 && subs.every(s => s.status === 'completed' || s.status === 'cancelled'),
      noInProgressSubtasks: !subs.some(s => s.status === 'in_progress'),
      descriptionGoalsAligned: unmatched.length === 0,
      hasCompletionMemory: false, // best-effort; population skipped to avoid recall cost
    },
    notes,
  };
}

function buildSubTaskReport(sub: SubTask): SessionTaskReport {
  return {
    taskId: sub.taskId,
    taskType: 'sub',
    title: sub.title,
    status: sub.status,
    notes: sub.status === 'completed'
      ? [`already completed at ${new Date(sub.completedAt || 0).toISOString()}`]
      : [`status: ${sub.status} — consider completing with completion-note (artifactPath + conclusion).`],
  };
}

function buildNextActions(
  reports: SessionTaskReport[],
  outcome: 'completed' | 'partial' | 'diverged' | undefined,
  conversationId: string | undefined,
  projectName: string,
): string[] {
  const lines: string[] = [];
  const header = (label: string) => lines.push(`# === ${label} ===`);
  const recordHooksHint = () => {
    lines.push(
      `# (Phase-435 T435.9) Cursor stop/sessionEnd hook will dump to .cursor/.hooks-autosave/; ` +
        `run devplan_cursor_hooks_drain(projectName="${projectName}"${conversationId ? `, defaultConversationId="${conversationId}"` : ''}) to consume.`,
    );
  };

  const subReports = reports.filter(r => r.taskType === 'sub');
  const mainReports = reports.filter(r => r.taskType === 'main');

  if (!outcome || outcome === 'completed') {
    header('IF the session FULLY COMPLETED the targeted sub-task');
    for (const r of subReports) {
      lines.push(
        `devplan_complete_task(projectName="${projectName}", taskId="${r.taskId}", taskType="sub", ` +
          `artifactPath="<报告/PR 路径>", conclusion="<1-2 句关键结论>", verification="<测试数/smoke/commit>")`,
      );
    }
    if (subReports.length === 0 && mainReports.length > 0) {
      for (const r of mainReports) {
        const firstOpen = r.openSubtasks && r.openSubtasks[0];
        if (firstOpen) {
          lines.push(
            `# phase ${r.taskId} still has ${r.openSubtasks?.length || 0} open sub-task(s); start with ${firstOpen.taskId}.`,
          );
        }
      }
    }
    recordHooksHint();
  }

  if (!outcome || outcome === 'partial') {
    header('IF the session ENDED PARTIALLY (more work needed in next session)');
    for (const r of subReports) {
      lines.push(
        `devplan_upsert_task(projectName="${projectName}", taskType="sub", taskId="${r.taskId}", ` +
          `title="${r.title.replace(/"/g, '\\"')}", status="in_progress", parentTaskId="<parent>")`,
      );
      lines.push(
        `devplan_memory_save(projectName="${projectName}", memoryType="summary", relatedTaskId="${r.taskId}", ` +
          `content="进度: 已完成 X/Y; 下次从 Z 继续; 阻塞: <若有>", importance=0.75)`,
      );
    }
    recordHooksHint();
  }

  if (!outcome || outcome === 'diverged') {
    header('IF the work DIVERGED from the original sub-task description');
    for (const r of subReports) {
      lines.push(
        `# Option A — replaced by another deliverable: keep the sub-task but close it with divergenceNote.`,
      );
      lines.push(
        `devplan_complete_task(projectName="${projectName}", taskId="${r.taskId}", taskType="sub", ` +
          `artifactPath="<实际交付物路径>", conclusion="<结论>", divergenceNote="原 ${r.taskId} 被 <X> 替代，详见 …")`,
      );
      lines.push(
        `# Option B — out of scope: cancel and migrate to a new Phase.`,
      );
      lines.push(
        `devplan_update_task_status(projectName="${projectName}", taskId="${r.taskId}", taskType="sub", status="cancelled")`,
      );
    }
    for (const r of mainReports) {
      const largeOptional = r.largeOptionalSubtasks || [];
      for (const sub of largeOptional) {
        lines.push(
          `# large optional sub-task ${sub.taskId} (${sub.estimatedHours}h) — sync-workflow §4.3: migrate to a new Phase.`,
        );
      }
    }
    recordHooksHint();
  }

  // Phase-close offer when EVERY main task is fully closeable
  const closeableMains = mainReports.filter(r =>
    r.closureChecklist &&
    r.closureChecklist.allRequiredSubtasksClosed &&
    r.closureChecklist.noInProgressSubtasks &&
    r.closureChecklist.descriptionGoalsAligned,
  );
  if (closeableMains.length > 0) {
    header('PHASE-CLOSE CANDIDATES (all checklist items met)');
    for (const r of closeableMains) {
      lines.push(
        `devplan_complete_task(projectName="${projectName}", taskId="${r.taskId}", taskType="main", ` +
          `artifactPath="<最终 PR/报告>", conclusion="<phase 最终结论>", verification="<整体测试结果>")`,
      );
    }
  }

  if (lines.length === 0) {
    lines.push('# no actionable next steps detected for this session — review reports above.');
  }
  return lines;
}

function handleSessionClose(args: ToolArgs, plan: IDevPlanStore): string {
  const outcome = args.sessionOutcome as 'completed' | 'partial' | 'diverged' | undefined;
  if (outcome && !['completed', 'partial', 'diverged'].includes(outcome)) {
    throw new McpError(ErrorCode.InvalidParams, 'sessionOutcome must be one of: completed, partial, diverged');
  }
  const largeHourThreshold = asPositiveNumber(
    args.largeSubtaskHourThreshold,
    DEFAULT_LARGE_SUBTASK_HOURS,
    0,
  );
  const preflight = args.preflight !== false; // default true

  const recentIds = Array.isArray(args.recentTaskIds) ? args.recentTaskIds.filter(s => typeof s === 'string' && s.trim()) : [];

  const reports: SessionTaskReport[] = [];

  if (recentIds.length > 0) {
    for (const taskId of recentIds) {
      const main = plan.getMainTask(taskId);
      if (main) {
        const subs = plan.listSubTasks(main.taskId);
        reports.push(buildMainTaskReport(main, subs, largeHourThreshold));
        continue;
      }
      // Sub-task lookup: search via the heuristic that sub task IDs are "T<N>.<M>"
      // We list across all phases until we find it (bounded by phases).
      const allMains = plan.listMainTasks();
      let found: SubTask | undefined;
      for (const m of allMains) {
        const subs = plan.listSubTasks(m.taskId);
        found = subs.find(s => s.taskId === taskId);
        if (found) {
          reports.push(buildSubTaskReport(found));
          break;
        }
      }
      if (!found) {
        reports.push({
          taskId,
          taskType: 'sub',
          title: '(not found)',
          status: 'unknown',
          notes: [`task ${taskId} not found in project — verify the id or pass an empty recentTaskIds to fall back to in_progress phases.`],
        });
      }
    }
  } else {
    // Fallback: every currently-active phase
    const inProgress = plan.listMainTasks({ status: 'in_progress' });
    for (const main of inProgress) {
      const subs = plan.listSubTasks(main.taskId);
      reports.push(buildMainTaskReport(main, subs, largeHourThreshold));
    }
  }

  const nextActions = buildNextActions(
    reports,
    outcome,
    args.conversationId,
    args.projectName!,
  );

  return JSON.stringify({
    status: 'session-close-checklist',
    projectName: args.projectName,
    conversationId: args.conversationId,
    sessionOutcome: outcome ?? 'unspecified',
    preflight,
    largeSubtaskHourThreshold: largeHourThreshold,
    reports,
    nextActions,
    notes: [
      'sync-workflow §3: pick the matching scenario (completed / partial / diverged) and run the corresponding next-action block.',
      preflight
        ? 'preflight=true (default): this call is read-only; nothing was mutated.'
        : 'preflight=false reserved for future auto-execution; currently behaves identically to preflight=true.',
    ],
  }, null, 2);
}

// ============================================================================
// Dispatcher
// ============================================================================

export async function handleSyncDisciplineToolCall(
  name: string,
  args: ToolArgs,
  deps: Deps,
): Promise<string | null> {
  if (!args.projectName) {
    if (
      name === 'devplan_audit_active_layer' ||
      name === 'devplan_phase_alignment_check' ||
      name === 'devplan_session_close'
    ) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing required: projectName');
    }
    return null;
  }

  switch (name) {
    case 'devplan_audit_active_layer':
      return handleAuditActiveLayer(args, deps.getDevPlan(args.projectName));
    case 'devplan_phase_alignment_check':
      return handleAlignmentCheck(args, deps.getDevPlan(args.projectName));
    case 'devplan_session_close':
      return handleSessionClose(args, deps.getDevPlan(args.projectName));
    default:
      return null;
  }
}

// Exposed for unit-testing — pure utilities.
export const __testables = {
  extractGoalCandidates,
  goalCoveredBy,
  buildAuditEntry,
  buildMainTaskReport,
  buildNextActions,
};
