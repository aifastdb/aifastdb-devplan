# devplan 对 Cursor 开发的帮助与局限

> **项目**: `aifastdb-devplan`  
> **关联示例**: `ai_db` 项目 Phase-426  
> **最后更新**: 2026-06-04（Phase-435 follow-up：把本文档诊断的痛点固化为 MCP 工具，详见配套的 `devplan-cursor-sync-workflow.md` MCP 工具速查表）

---

## 结论先行

**devplan 对 Cursor 开发有帮助，但主要作为协调层——而非编码助手。**

它最适合**多会话、多 Phase、需要 Agent 交接**的长期项目；对一次性 bug 修复或快速迭代，维护成本可能超过收益。

---

## 一、有帮助的方面

### 1. 长期运行上下文（Long-running context）

对于像 `ai_db` 这样拥有 435 个 Phase 的大型仓库，devplan 让 Agent 无需每次重读整个代码库，就能结构化地了解：哪些已规划、哪些进行中、哪些近期完成。

### 2. Phase / 子任务粒度（Phase / subtask granularity）

将工作拆成 `T426.1`、`T426.4` 等子任务，比扁平 TODO 列表更适合跨会话交接。每个子任务对应一次 Cursor 会话的主要目标，边界清晰。

### 3. 跨会话记忆（Cross-session memory）

Completion notes 与关联 artifact（报告、matrix 分析文档等）能在代码与 git 历史本身不够明确时，回答「这到底做完了没有？」

### 4. 优先级与焦点（Priority / focus）

可快速识别当前重点（例如 Phase-435 进行中 vs Phase-426 卡在 15/18），避免 Agent 在 400+ Phase 的历史噪声中迷失方向。

### 5. AI 工作审计轨迹（Audit trail）

Agent 完成工作后，`memory_save` / completion 记录会在 devplan 任务与实际交付物之间建立可追溯的链接。

---

## 二、主要局限与风险

### 1. 状态漂移（Status drift）

**Phase-426 是最清晰的例子**：核心目标已通过 matrix 跑通达成，但 devplan 仍显示 `in_progress`，因为子任务未被更新。工具反映的是**被标记的状态**，不总是**实际完成的工作**。

### 2. 维护开销（Maintenance overhead）

必须有人（或 Agent）主动关闭任务、写 completion notes、将「在其他路径完成的工作」与 devplan 条目对齐。不做这些，数据会迅速过时。

### 3. 图谱范围膨胀（Scope creep in graph）

435 个 Phase 对历史追溯很有价值，但对「今天该做什么？」噪声很大，除非有良好的过滤策略（只维护活跃层）。

### 4. 目标 vs 子任务不一致（Goal vs subtask mismatch）

Phase-426 描述里写了「LLM-as-judge」，却从未拆成 T426.x 子任务——目标会静默丢失，下次会话无人记得。

### 5. 不是代码的真相来源（Not source of truth for code）

devplan 可以标「完成」而代码仍有问题，也可以标「pending」而代码已上线。仍需要测试、报告和仓库本身作为最终依据。

### 6. 依赖 MCP 质量（MCP dependency）

价值取决于工具 schema、查询体验，以及图谱是否与现实同步。**垃圾进，垃圾出**。

### 7. 虚假完成感（False sense of completion）

不验证交付物就标记 Phase 完成（如 T426.1 未勾选但 matrix 已覆盖），会让仪表盘看起来「全绿」，实际仍有缺口。

---

## 三、Phase-426 真实案例（ai_db）

| 层级 | ID | 官方状态 | 说明 |
|------|-----|----------|------|
| 主任务 | `phase-426` | `in_progress`（15/18） | LongMemEval-full chunked-path A/B + recall 调优 |
| 子任务 | T426.1 | `in_progress` | 50 case A/B 报告；**实质已被 matrix 分析覆盖** |
| 子任务 | T426.4 | `pending` | NAPI 未实现，约 0.5h 真活 |
| 子任务 | T426.5 | `pending` | 200+ case 全能力采样，**可选大项（12–24h）** |
| 描述目标 | LLM-as-judge | **无对应子任务** | 只在立项描述里提过，从未拆任务 |

**教训**：

- 核心目标（chunked A/B 结论、recall K 调优、matrix 基建）**已落地**，但 devplan 仍显示进行中。
- 未勾选的 T426.1 可被 matrix 结果替代收尾；T426.5 应迁出新 Phase 或 cancelled。
- 描述里的目标必须拆成子任务，否则会在图谱中静默消失。

---

## 四、实用取舍表

| 场景 | 是否值得用 devplan？ |
|------|----------------------|
| 长期项目、多 Phase、Agent 跨会话交接 | **高价值** |
| 单一功能 / 热修复 | **低价值** |
| 团队需要共享任务状态 + AI 上下文 | **高价值** |
| 个人开发、快速迭代、讨厌 bookkeeping | **摩擦可能大于收益** |

---

## 五、与 Cursor 协作的最佳实践

将 devplan 视为**规划与交接索引**，而非 ground truth：

1. 每次有意义的工作结束后，更新子任务状态。
2. 写简短 completion note，指向实际 artifact（报告、PR、文档路径）。
3. 只维护「活跃层」——当前 Phase + 近 2 周内动过的任务。
4. 发现「实质完成但 devplan 卡住」时，按 Phase-426 式快速修复流程处理（见 `devplan-cursor-sync-workflow.md`）。

Phase-426 同时展示了 devplan 的** upside**（matrix 分析可追溯）和 **downside**（状态滞后于现实）。关键不在工具本身，而在是否坚持轻量同步纪律。

---

## 六、Phase-435 follow-up：把痛点固化为 MCP 工具

为了让本文「问题诊断」不再只能靠人工纪律去贯彻，配套交付了一组 MCP 工具直接对应本文章节的核心痛点：

| 本文章节 | 痛点 | 对应 MCP 工具 |
|---|---|---|
| §二.1 状态漂移 | "Phase-426 显示 in_progress 但核心目标已经达成" | `devplan_audit_active_layer`（自动找僵尸 phase）+ `devplan_complete_task` 增强 `divergenceNote`（关闭时写清替代） |
| §二.4 目标 vs 子任务不一致 | "LLM-as-judge 只在描述里，从未拆子任务" | `devplan_phase_alignment_check`（扫描描述里没被任何子任务覆盖的目标） |
| §二.7 虚假完成感 | "不验证交付物就标 done" | `devplan_complete_task` 增强 4 字段 completion note（artifactPath + conclusion + divergenceNote + verification）；env `AIFASTDB_DEVPLAN_REQUIRE_COMPLETION_NOTE=1` 可硬性要求 |
| §三 教训：T426.5 12-24h 大项 | "可选大项不应挂在主 Phase 尾巴" | `devplan_audit_active_layer` / `devplan_session_close` 自动标识 estimatedHours ≥ 阈值的子任务并建议迁出 |
| §五.4 Phase-426 式快速修复 | "实质完成但 devplan 卡住" | `devplan_session_close`（按三种 sessionOutcome 输出具体修复脚本） |

具体调用范式 + 与 Cursor 生命周期 hook（T435.5/T435.9）的接线，见 `docs/devplan-cursor-sync-workflow.md` 顶部的「MCP 工具速查」表。

**核心理念没有变**：devplan 仍是索引、不是 ground truth；变化的是——以前要靠人记得维护纪律，现在 Agent 可以直接调工具拿到结构化的"该做什么"清单。
