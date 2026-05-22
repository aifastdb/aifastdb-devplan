const { createDevPlan } = require('../dist');
const { handleSectionToolCall } = require('../dist/mcp-server/handlers/section-tools');
const { handleTaskToolCall } = require('../dist/mcp-server/handlers/task-tools');

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((acc, v) => acc + v, 0);
  return {
    count: samples.length,
    min: Number(sorted[0].toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)),
    mean: Number((sum / samples.length).toFixed(3)),
    p50: Number(percentile(sorted, 50).toFixed(3)),
    p95: Number(percentile(sorted, 95).toFixed(3)),
  };
}

async function main() {
  const rounds = 50;
  const warmup = 5;
  const projectName = `bench-milestones-${Date.now()}`;
  const plan = createDevPlan(projectName);
  const taskWriteMutex = { acquire: async () => {}, release: () => {} };
  const deps = { getDevPlan: () => plan, taskWriteMutex };

  // 初始化 milestones 文档
  await handleSectionToolCall(
    'devplan_save_section',
    {
      projectName,
      section: 'milestones',
      title: 'Bench Milestones',
      content: '# Bench Milestones\n\n| phase | title | date | status |\n|---|---|---|---|',
      version: '1.0.0',
    },
    deps
  );

  const baseMilestones = plan.getSection('milestones');
  const baseContent = baseMilestones?.content || '';
  const title = baseMilestones?.title || 'Bench Milestones';
  const version = baseMilestones?.version || '1.0.0';

  const saveSectionSamples = [];
  for (let i = 0; i < rounds + warmup; i++) {
    const content = `${baseContent}\n<!-- save-bench-${i}-${Date.now()} -->`;
    const t0 = nowMs();
    await handleSectionToolCall(
      'devplan_save_section',
      {
        projectName,
        section: 'milestones',
        title,
        content,
        version,
      },
      deps
    );
    const dt = nowMs() - t0;
    if (i >= warmup) saveSectionSamples.push(dt);
  }

  const autoUpdateSamples = [];
  for (let i = 0; i < rounds + warmup; i++) {
    const suffix = `${Date.now()}-${i}`;
    const phaseId = `phase-bench-${suffix}`;
    const sub1 = `T-bench.${suffix}.1`;
    const sub2 = `T-bench.${suffix}.2`;

    await handleTaskToolCall(
      'devplan_create_main_task',
      { projectName, taskId: phaseId, title: `Phase-bench-${suffix}`, priority: 'P2' },
      deps
    );
    await handleTaskToolCall(
      'devplan_add_sub_task',
      { projectName, taskId: sub1, parentTaskId: phaseId, title: 'bench-sub-1', order: 1 },
      deps
    );
    await handleTaskToolCall(
      'devplan_add_sub_task',
      { projectName, taskId: sub2, parentTaskId: phaseId, title: 'bench-sub-2', order: 2 },
      deps
    );
    await handleTaskToolCall(
      'devplan_complete_task',
      { projectName, taskId: sub1, taskType: 'sub' },
      deps
    );

    // 只测“完成第二个子任务触发 autoUpdateMilestones”这一步
    const t0 = nowMs();
    await handleTaskToolCall(
      'devplan_complete_task',
      { projectName, taskId: sub2, taskType: 'sub' },
      deps
    );
    const dt = nowMs() - t0;
    if (i >= warmup) autoUpdateSamples.push(dt);
  }

  const result = {
    config: { projectName, rounds, warmup },
    saveSectionMilestones: summarize(saveSectionSamples),
    autoUpdateMilestonesViaSecondSubtask: summarize(autoUpdateSamples),
    note: 'autoUpdate path includes completeSubTask business logic, not pure doc write only',
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

