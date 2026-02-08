# aifastdb-devplan

<p align="center">
  <strong>AI-Powered Development Plan Management — MCP Server</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/aifastdb-devplan"><img src="https://img.shields.io/npm/v/aifastdb-devplan.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/aifastdb-devplan"><img src="https://img.shields.io/npm/dm/aifastdb-devplan.svg" alt="npm downloads"></a>
  <a href="https://github.com/aifastdb/aifastdb-devplan/blob/main/LICENSE"><img src="https://img.shields.io/github/license/aifastdb/aifastdb-devplan" alt="license"></a>
  <a href="https://github.com/aifastdb/aifastdb-devplan"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node version"></a>
</p>

<p align="center">
  让 AI 助手（Cursor / Claude Desktop）直接管理你的开发计划、任务追踪和项目文档。<br/>
  基于 <a href="https://github.com/aifastdb/aifastdb">aifastdb</a> 高性能存储引擎，通过 <a href="https://modelcontextprotocol.io">MCP 协议</a> 与 AI 无缝集成。
</p>

---

## 为什么需要 aifastdb-devplan？

在 AI 辅助编程时代，开发者与 AI 助手的协作越来越密切。但 AI 助手缺乏**持久化的项目记忆**——每次对话都从零开始，无法了解项目的整体规划、当前进度和历史决策。

**aifastdb-devplan** 解决了这个问题：它为 AI 助手提供了一套**结构化的开发计划管理工具**，让 AI 能够：

- 📋 **了解项目全貌** — 读取项目概述、技术方案、API 设计等文档片段
- 🎯 **追踪任务进度** — 管理两级任务层级（主任务 → 子任务），实时更新进度
- 🔗 **锚定 Git 历史** — 完成任务时自动记录 Git commit hash，支持回滚检测
- 📦 **模块化管理** — 按功能模块组织任务和文档，清晰展示项目架构
- 📄 **导出文档** — 一键生成完整的 Markdown 格式开发计划文档

## 核心特性

| 特性 | 说明 |
|------|------|
| **11 种文档片段** | overview, requirements, api_design, technical_notes, architecture 等标准类型 |
| **两级任务层级** | 主任务 (MainTask) + 子任务 (SubTask)，支持优先级 (P0-P3) 和状态流转 |
| **功能模块注册表** | 按模块维度聚合任务和文档，直观展示项目架构 |
| **Git Commit 锚定** | 完成任务时自动记录 commit hash，`sync_git` 可检测代码回滚 |
| **自动进度统计** | 完成子任务时自动更新主任务进度百分比 |
| **幂等任务导入** | `upsert_task` 支持防重复导入，适合批量初始化 |
| **Markdown 导出** | 生成结构化的开发计划文档，方便分享和归档 |
| **零配置存储** | JSONL 格式本地存储，数据保存在项目 `.devplan/` 目录中 |

## 快速开始

### 安装

```bash
npm install -g aifastdb-devplan
```

### 方式 A：作为 MCP Server 使用（推荐）

在 Cursor IDE 中配置 `.cursor/mcp.json`：

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

或在 Claude Desktop 中配置 `claude_desktop_config.json`：

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

配置完成后，AI 助手即可使用 18 个 `devplan_*` 工具来管理你的开发计划。

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

## MCP 工具一览（18 个）

### 📋 文档管理

| 工具 | 说明 |
|------|------|
| `devplan_init` | 初始化开发计划 |
| `devplan_save_section` | 保存/更新文档片段（11 种标准类型） |
| `devplan_get_section` | 读取指定文档片段 |
| `devplan_list_sections` | 列出所有文档片段 |

### 🎯 任务管理

| 工具 | 说明 |
|------|------|
| `devplan_create_main_task` | 创建主任务（支持优先级 P0-P3） |
| `devplan_add_sub_task` | 添加子任务到主任务 |
| `devplan_upsert_task` | 幂等导入任务（防重复，适合批量初始化） |
| `devplan_complete_task` | 完成任务（自动更新进度 + Git 锚定） |
| `devplan_list_tasks` | 列出任务（支持按状态/优先级/主任务筛选） |
| `devplan_get_progress` | 获取项目整体进度概览 |

### 📦 模块管理

| 工具 | 说明 |
|------|------|
| `devplan_create_module` | 创建功能模块 |
| `devplan_list_modules` | 列出所有功能模块 |
| `devplan_get_module` | 获取模块详情（关联任务和文档） |
| `devplan_update_module` | 更新模块信息 |

### 🔧 工具

| 工具 | 说明 |
|------|------|
| `devplan_export_markdown` | 导出完整 Markdown 格式开发计划 |
| `devplan_sync_git` | 同步 Git 历史，检测代码回滚 |

## 数据存储

数据以 JSONL 格式存储在本地，**无需外部数据库**：

```
.devplan/{projectName}/
├── documents.jsonl    # 文档片段
├── tasks.jsonl        # 主任务 + 子任务
└── modules.jsonl      # 功能模块
```

存储路径解析优先级：

| 优先级 | 路径来源 | 说明 |
|--------|---------|------|
| 1 | `AIFASTDB_DEVPLAN_PATH` 环境变量 | 显式指定存储目录 |
| 2 | 项目内 `.devplan/` 目录 | 自动检测项目根目录（通过 `.git` / `package.json`） |
| 3 | `~/.aifastdb/dev-plans/` | 全局兜底路径 |

## 平台支持

`aifastdb-devplan` 是纯 TypeScript/JavaScript 项目，支持所有 Node.js ≥ 18 的平台：

| 平台 | 架构 | 支持 |
|------|------|------|
| Windows | x64 | ✅ |
| macOS | x64 / Apple Silicon (M1/M2/M3) | ✅ |
| Linux | x64 / ARM64 | ✅ |

> 注：底层存储引擎 [aifastdb](https://github.com/aifastdb/aifastdb) 包含 Rust 原生绑定，已为上述平台提供预编译二进制文件。

## 技术栈

- **存储引擎**: [aifastdb](https://github.com/aifastdb/aifastdb) — 高性能 JSONL 文档存储，基于 Rust + N-API
- **通信协议**: [MCP (Model Context Protocol)](https://modelcontextprotocol.io) — AI 助手工具调用标准协议
- **运行时**: Node.js ≥ 18
- **语言**: TypeScript (strict mode)

## 相关项目

- [aifastdb](https://github.com/aifastdb/aifastdb) — AI-friendly 高性能数据库引擎（向量搜索 + 语义索引 + Agent 记忆）
- [MCP Protocol](https://modelcontextprotocol.io) — Model Context Protocol 官方文档

## License

[MIT](LICENSE)
