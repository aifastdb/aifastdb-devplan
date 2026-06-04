# devplan × Cursor 轻量同步工作流

> **项目**: `aifastdb-devplan`  
> **目标**: 少维护、少漂移——让 devplan 成为「会话交接索引」，而不是第二套待办清单  
> **最后更新**: 2026-06-04（Phase-435 follow-up：配套 MCP 工具落地）

---

## MCP 工具速查（Phase-435 follow-up）

下面这些工具把本文档中的手动 SOP 变成可调用的 MCP 工具。本节是给 Agent / 工具调用方使用的速查表，可以直接对照查找。

| 本文档章节 | 对应 MCP 工具 | 行为 |
|---|---|---|
| §2.3 收尾 4 字段 completion note | `devplan_complete_task`（增强）传 `artifactPath` + `conclusion` (+ `divergenceNote` / `verification`) | 4 字段齐备时自动写一条 summary memory 关联本任务；缺字段进 `completionNoteWarnings`；env `AIFASTDB_DEVPLAN_REQUIRE_COMPLETION_NOTE=1` 可硬性要求 |
| §3 三种会话结束场景 + §2.4 关闭清单 | `devplan_session_close` | 列出 open subtasks / 对齐问题 / 大子任务，按 `sessionOutcome=completed/partial/diverged` 输出具体的 `nextActions` 脚本 |
| §4.1 每周 10 分钟活跃层审计 | `devplan_audit_active_layer` | 扫所有 in_progress phase，按 `staleDays` 标记僵尸 phase + `largeSubtaskHourThreshold` 标记可选大项 + 描述对齐缺失，输出 `suggestedActions` |
| §4.2 描述 vs 子任务对齐检查 | `devplan_phase_alignment_check` | 抽取 phase 描述里的"目标候选"，列出未被任何子任务覆盖的目标（即 "LLM-as-judge 静默丢失"那类） |
| §4.3 可选大项识别 | `devplan_audit_active_layer` / `devplan_session_close`（`largeSubtaskHourThreshold` 默认 8h） | 自动标识 estimatedHours ≥ 8h 的 pending/in_progress 子任务并建议迁出新 Phase |
| §5 Agent 专用规则 | 已嵌入 `cursor-rule-template.ts` 生成的项目 Cursor Rule | 新 init 的项目自动获得 5 条同步纪律 + Phase-426 漂移修复指引 |
| §6 Phase-426 式漂移快速修复 | `devplan_audit_active_layer` + `devplan_complete_task`（divergenceNote） + `devplan_update_task_status` (status=cancelled) | 三步组合：审计→按场景关闭→cancelled 迁出 |
| Cursor 生命周期 hook 接管 | `devplan_cursor_hooks_drain`（T435.9 已交付） | 消费 `.cursor/.hooks-autosave/` 下 dump，写 lifecycle marker memory；与 `devplan_session_close` 配合可形成完整收尾闭环 |

---

## 一、三条原则

1. **代码/报告是真相，devplan 是索引** — 完成与否以产物为准（PR、报告、测试），devplan 只负责指向它们。
2. **只维护「活跃层」** — 不必同步全部 400+ Phase；只关心当前 Phase + 最近 2 周内动过的任务。
3. **会话结束必做 3 件事** — 更新状态、写 completion note、链到 artifact。缺任何一项，下次会话就会像 Phase-426 一样「实质完成但显示进行中」。

---

## 二、Phase 生命周期

```
立项 → 拆子任务 → 开发中 → 收尾核对 → 标完成 → 归档
         ↑                              ↓
         └──────── 发现范围变化时迁出/取消 ←┘
```

### 1. 立项（约 5 分钟）

每个新 Phase 必须包含：

| 字段 | 要求 |
|------|------|
| 主目标 | 1–3 条，可验证（有数字或明确交付物） |
| 子任务 | 每条对应 ≤4h 工作量；**描述里的目标必须拆成子任务** |
| 优先级 | P0 / P1 / P2 |
| 完成标准 | 写清楚「什么叫 done」 |

**反例（Phase-426）**：「LLM-as-judge」写在描述里但没拆子任务 → 目标静默丢失。

**正例**：

```
Phase-436: LongMemEval LLM-as-judge 评分修正
  T436.1 实现 judge prompt + 评分脚本
  T436.2 50 case 对比 token-match vs judge
  T436.3 写报告 + memory_save
```

### 2. 开发中（Cursor 会话内）

**会话开始时**（Agent 或你）：

```
devplan 查询 → 当前 Phase 状态 → 只读 in_progress / pending 子任务
```

**会话进行中**：

- 一个子任务 = 一次 Cursor 会话的主要目标
- 不要在一个会话里跨 3 个以上子任务
- 若实际工作偏离子任务（如 matrix 替代了 T426.1），**当场记 note**，不要等收尾

### 3. 收尾（会话结束前约 2 分钟）

每个完成的子任务，写一条 **completion note** 模板：

```markdown
## T426.1 完成

- 交付物: docs/data/PHASE_428_LONGMEMEVAL_MATRIX_ANALYSIS.md
- 关键结论: chunked +2pp accuracy, recall 持平 72%
- 替代说明: 原 T426.1 独立 A/B 被 matrix 覆盖，见 analysis-summary.json
- 验证: matrix 24 combo 全部跑完
```

然后：**标 completed + memory_save**。

### 4. Phase 关闭

主 Phase 标 completed 前，过一遍 **关闭清单**：

- [ ] 所有「必做」子任务 completed 或 cancelled（附理由）
- [ ] 描述里的目标都有对应子任务或明确延期记录
- [ ] 无 in_progress 子任务（或已迁到新 Phase）
- [ ] 至少一条 completion memory 指向最终报告/PR

---

## 三、Cursor 会话 SOP

### 标准会话模板（复制给 Agent）

```markdown
## 会话目标
- Phase: phase-XXX
- 子任务: TXXX.Y — [标题]

## 开始前
1. devplan 查询 phase-XXX 及 TXXX.Y 当前状态
2. 读 completion notes / 关联 artifact

## 结束时（必须执行）
1. 更新 TXXX.Y 状态（completed / in_progress + 进度说明）
2. memory_save：交付物路径 + 关键结论 + 未完成项
3. 若主目标已达成但子任务未勾：写替代说明再标完成
```

### 三种结束场景

| 场景 | 动作 |
|------|------|
| 子任务完全完成 | 标 completed + note + memory_save |
| 部分完成 | 标 in_progress + note 写「已完成 X/Y，下次从 Z 继续」 |
| 工作做了但路径变了 | note 写「原 T426.1 被 matrix 替代」→ 标 completed 或 cancelled |

---

## 四、防漂移机制

### 1. 每周 10 分钟「活跃层审计」

只查：

- 所有 `in_progress` 的 Phase
- 最近 7 天有代码提交但 devplan 未更新的 Phase

对每个 in_progress 问一句：**「实质完成了吗？」**

- 是 → 补 note，标 completed
- 否 → note 写阻塞原因
- 不需要了 → cancelled + 迁出理由

### 2. 「描述 vs 子任务」对齐检查

立项后立刻核对：

```
描述里的目标 A、B、C
  ↓
子任务列表里是否都有对应项？
  ↓
没有的 → 立刻补子任务，或从描述里删掉
```

### 3. 可选大项单独 Phase

像 T426.5（200+ case 全能力采样）这种 12–24h 的大项：

- **不要**挂在当前 Phase 尾巴上当 pending
- **应该** cancelled + 新开 Phase，或标 `deferred`

否则主 Phase 永远完不成。

---

## 五、Agent 专用规则（可写入 Cursor Rule）

```markdown
## devplan 同步规则

1. 会话开始：devplan 查询当前 Phase/子任务，不假设状态
2. 会话结束：必须更新 devplan，禁止只改代码不更新状态
3. 完成子任务时 completion note 必须包含：
   - 交付物路径（报告/PR/文件）
   - 1–2 句关键结论
   - 若与原子任务描述不一致，写替代说明
4. 发现描述目标无子任务：提醒用户补子任务或延期
5. 不主动把 Phase 标 completed，除非所有必做子任务已 closed 且用户确认
```

---

## 六、Phase-426 式问题的快速修复流程

当你发现「实质完成但 devplan 卡住」：

```
1. 列出未完成子任务（如 T426.1, T426.4, T426.5）
2. 逐个判定：
   - 已有替代交付物？ → 补 note，标 completed
   - 还有真活？       → 保持 pending，估工时
   - 范围外/可选？    → cancelled 或迁新 Phase
3. 必做项全部 closed 后 → 主 Phase 标 completed
```

Phase-426 应用示例：

| 子任务 | 判定 | 动作 |
|--------|------|------|
| T426.1 | matrix 已覆盖 | completed + 指向 matrix 分析文档 |
| T426.4 | NAPI 未实现，约 0.5h | pending 或迁 phase-435 |
| T426.5 | 可选大项 | cancelled → 新开 Phase |

---

## 七、投入 vs 收益

| 动作 | 耗时 | 频率 |
|------|------|------|
| 会话结束更新 devplan | ~2 分钟 | 每次开发会话 |
| 活跃层周审计 | ~10 分钟 | 每周 |
| 新 Phase 立项对齐 | ~5 分钟 | 每个新 Phase |

**不做维护的成本**：像 Phase-426 一样，下次会话 Agent 会误判进度、重复劳动、或漏掉 T426.4 这种小尾巴。

---

## 八、一句话总结

> **开发时专注写代码，结束时用 2 分钟把 devplan 当成「书签」而不是「日记本」——只记录状态、结论、artifact 路径，不重复写设计文档。**
