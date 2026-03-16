export function generateCursorRuleTemplate(projectName: string): string {
  return `---
description: ${projectName} 项目的 DevPlan 配置。包含项目标识、文档层级、开发阶段。通用的 DevPlan 工作流规则由用户级全局规则提供。
globs: []
alwaysApply: true
mcpServers: aifastdb-devplan
---

# ${projectName} 项目 — DevPlan 配置

> **MCP Server**: \`aifastdb-devplan\`
> 通用的 DevPlan 工作流（触发词识别、阶段工作流、完成流程等）由用户级全局 Cursor Rule 提供。

## 项目标识

\`\`\`
projectName = "${projectName}"
\`\`\`

## 文档层级

| 层级 | 文件 | 用途 | 大小 |
|------|------|------|------|
| Layer 1 (鸟瞰) | \`docs/${projectName}-overview.md\` | AI 首选阅读，< 500 行 | — |
| Layer 2 (详细) | （项目完整设计文档） | 分段读取 | — |
| Layer 3 (实时) | \`.devplan/${projectName}/\` | MCP 工具查询任务状态 | — |

## 快捷操作

\`\`\`
devplan_get_progress(projectName: "${projectName}")
devplan_list_tasks(projectName: "${projectName}")
devplan_list_tasks(projectName: "${projectName}", status: "pending")
devplan_complete_task(projectName: "${projectName}", taskId: "T1.1")
devplan_sync_git(projectName: "${projectName}", dryRun: true)
devplan_list_sections(projectName: "${projectName}")
devplan_get_section(projectName: "${projectName}", section: "overview")
devplan_search_sections(projectName: "${projectName}", query: "171e9a18-c7e9-430b-9e3d-fa6d384a0b4e", searchBy: "id")
devplan_search_sections(projectName: "${projectName}", query: "向量存储", searchBy: "title")
devplan_search_sections(projectName: "${projectName}", query: "BM25 中文分词", searchBy: "content")
devplan_search_sections(projectName: "${projectName}", query: "文档搜索", searchBy: "auto", mode: "hybrid")
devplan_export_markdown(projectName: "${projectName}", scope: "tasks")
devplan_list_modules(projectName: "${projectName}")
\`\`\`

## 文档搜索约定

- 调用 \`devplan_search_sections\` 时，默认优先显式传入 \`searchBy\`，避免把 ID、标题、正文搜索混在一起。
- 当查询内容形如 UUID（例如 \`171e9a18-c7e9-430b-9e3d-fa6d384a0b4e\`）时，优先使用 \`searchBy: "id"\`。
- 当目标是文档标题时，优先使用 \`searchBy: "title"\`。
- 当目标是正文片段或术语时，优先使用 \`searchBy: "content"\`。
- 仅在无法提前判断目标字段，或希望保留字面/语义/混合自动搜索行为时，使用 \`searchBy: "auto"\`；此时可再配合 \`mode: "literal" | "semantic" | "hybrid"\`。

## 开发阶段概览

| 阶段 | 状态 | 说明 |
|------|------|------|
| （使用 devplan_list_tasks 查看最新状态） | | |

## 强制拆分阶段规则（Phase Guardrails）

| 场景 | 操作 |
|------|------|
| 当前 phase 子任务数超过 25 | → **必须**新建 phase（\`devplan_create_main_task\`） |
| 任务类型与当前 phase 主题不匹配（如依赖升级/运维/文档治理） | → **必须**新建 phase |
| 仅同一里程碑连续任务或同任务内容更新 | → 允许继续挂当前 phase |

### 任务 ID 命名规范

- 主任务：\`phase-{N}\` 或 \`phase-{N}{Letter}\`（如 \`phase-14B\`）
- 子任务：\`T{N}.{M}\`（如 \`T14B.1\`、\`T14B.2\`）

### 主任务标题格式（强制）

- 使用 \`devplan_create_main_task\` 新建主任务时，\`title\` **必须**显式包含对应的 phase 编号前缀，不能只写语义标题。
- \`title\` 的推荐格式：\`Phase-{N}: <主题>\`、\`Phase-{N}{Letter}: <主题>\`，例如 \`Phase-43: DevPlan phase title prefix rule alignment\`。
- 当 \`taskId = "phase-43"\` 时，\`title\` 必须写成带 \`phase-43\`/ \`Phase-43\` 前缀的形式，禁止只写不带编号的标题。
- 创建新 phase 时，需要同时保证：
  - \`taskId\` 使用 \`phase-{N}\` 或 \`phase-{N}{Letter}\`
  - \`title\` 复用同一个 phase 编号前缀

示例：

\`\`\`
devplan_create_main_task(
  projectName: "${projectName}",
  taskId: "phase-43",
  title: "Phase-43: DevPlan phase title prefix rule alignment",
  priority: "P1"
)
\`\`\`

## 注意事项

1. **优先读概览文件**：初次了解项目时，先读概览文件（< 500 行），再按需深入完整设计文档
2. **数据存储位置**：本项目的 devplan 数据存储在项目根目录的 \`.devplan/${projectName}/\` 下
3. **通过 MCP 操作任务**：任务状态管理使用 \`devplan_*\` 系列 MCP 工具，不要手动编辑数据文件
4. **完成任务后同步**：完成代码实现后，调用 \`devplan_complete_task\` 持久化状态（自动锚定 Git commit）
5. **Git 回滚后检查**：如果执行了 \`git reset\` 或切换分支，运行 \`devplan_sync_git\` 检查任务状态一致性
6. **概览文件需手动更新**：当有重大架构变更、新增阶段或新 API 时，同步更新概览文档

## Cursor 记忆默认工具

- 在 Cursor 场景保存记忆时，默认优先调用 \`devplan_memory_save_cursor_profile\`（支持双会话 ID + hook 语义）。
- 非 Cursor 或无需会话绑定时，继续使用 \`devplan_memory_save\`。
`;
}
