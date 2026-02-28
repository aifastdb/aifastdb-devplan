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
devplan_export_markdown(projectName: "${projectName}", scope: "tasks")
devplan_list_modules(projectName: "${projectName}")
\`\`\`

## 开发阶段概览

| 阶段 | 状态 | 说明 |
|------|------|------|
| （使用 devplan_list_tasks 查看最新状态） | | |

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
