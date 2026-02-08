# aifastdb-devplan

AI-powered development plan management MCP server, powered by [aifastdb](https://github.com/aifastdb/aifastdb).

## 功能

- **11 种标准文档片段类型**：overview, api_design, technical_notes 等
- **两级任务层级**：主任务 (MainTask) + 子任务 (SubTask)
- **功能模块注册表**：按模块维度聚合任务和文档
- **Git Commit 锚定**：完成任务时记录 Git commit hash，支持回滚检测
- **自动进度统计**：完成子任务时自动更新主任务进度
- **Markdown 导出**：生成开发计划的 Markdown 文档

## 安装

```bash
npm install aifastdb-devplan
```

## 使用方式

### 方式 A：作为 MCP Server（推荐）

在 `.cursor/mcp.json` 或 `claude_desktop_config.json` 中配置：

```json
{
  "mcpServers": {
    "aifastdb-devplan": {
      "command": "npx",
      "args": ["aifastdb-devplan"]
    }
  }
}
```

### 方式 B：作为 npm 包编程使用

```typescript
import { DevPlanStore, createDevPlan } from 'aifastdb-devplan';

const plan = createDevPlan('my-project');

// 创建主任务
plan.createMainTask({
  projectName: 'my-project',
  taskId: 'phase-1',
  title: '阶段一：基础搭建',
  priority: 'P0',
});

// 添加子任务
plan.addSubTask({
  projectName: 'my-project',
  taskId: 'T1.1',
  parentTaskId: 'phase-1',
  title: '初始化项目结构',
});

// 完成任务（自动更新主任务进度 + Git commit 锚定）
plan.completeSubTask('T1.1');

// 查看进度
const progress = plan.getProgress();
console.log(progress);
```

## MCP 工具列表（18 个）

| 工具 | 说明 |
|------|------|
| `devplan_init` | 初始化开发计划 |
| `devplan_save_section` | 保存/更新文档片段 |
| `devplan_get_section` | 读取文档片段 |
| `devplan_list_sections` | 列出所有文档片段 |
| `devplan_create_main_task` | 创建主任务 |
| `devplan_add_sub_task` | 添加子任务 |
| `devplan_upsert_task` | 幂等导入任务（防重复） |
| `devplan_complete_task` | 完成任务（自动更新进度） |
| `devplan_list_tasks` | 列出任务（支持跨主任务查询） |
| `devplan_get_progress` | 获取项目进度概览 |
| `devplan_export_markdown` | 导出 Markdown 文档 |
| `devplan_sync_git` | 同步 Git 历史（回滚检测） |
| `devplan_create_module` | 创建功能模块 |
| `devplan_list_modules` | 列出功能模块 |
| `devplan_get_module` | 获取模块详情 |
| `devplan_update_module` | 更新模块信息 |

## 数据存储

数据以 JSONL 格式存储在项目内的 `.devplan/` 目录中：

```
.devplan/{projectName}/
├── documents.jsonl    # 文档片段
├── tasks.jsonl        # 主任务 + 子任务
└── modules.jsonl      # 功能模块
```

存储路径解析优先级：
1. `AIFASTDB_DEVPLAN_PATH` 环境变量
2. 项目内 `.devplan/` 目录（通过 `.git` / `package.json` 定位）
3. `~/.aifastdb/dev-plans/`（兜底）

## 依赖

- [aifastdb](https://github.com/aifastdb/aifastdb) — 存储引擎
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) — MCP 协议支持

## License

MIT
