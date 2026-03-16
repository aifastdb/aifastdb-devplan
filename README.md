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
  Let AI assistants (Cursor / Claude Desktop) manage your development plans, task tracking, and project documentation.<br/>
  Built on the <a href="https://github.com/aifastdb/aifastdb">aifastdb</a> high-performance storage engine, seamlessly integrated with AI via the <a href="https://modelcontextprotocol.io">MCP protocol</a>.
</p>

<p align="center">
  让 AI 助手（Cursor / Claude Desktop）直接管理你的开发计划、任务追踪和项目文档。<br/>
  基于 <a href="https://github.com/aifastdb/aifastdb">aifastdb</a> 高性能存储引擎，通过 <a href="https://modelcontextprotocol.io">MCP 协议</a> 与 AI 无缝集成。
</p>

<p align="center">
  <a href="#english">English</a> | <a href="#中文">中文</a>
</p>

---

<a id="english"></a>

## English

### Why aifastdb-devplan?

In the age of AI-assisted programming, developers collaborate with AI assistants more closely than ever. However, AI assistants lack **persistent project memory** — each conversation starts from scratch, with no knowledge of the overall project plan, current progress, or historical decisions.

**aifastdb-devplan** solves this problem by providing AI assistants with a set of **structured development plan management tools**, enabling AI to:

- 📋 **Understand the big picture** — Read project overviews, technical designs, API specifications, and more
- 🎯 **Track task progress** — Manage two-level task hierarchies (MainTask → SubTask) with real-time progress updates
- 🔗 **Anchor to Git history** — Automatically record Git commit hashes when completing tasks, with rollback detection
- 📦 **Modular management** — Organize tasks and docs by feature modules for a clear project architecture view
- 📄 **Export documentation** — Generate complete Markdown-formatted development plan documents in one click

### Key Features

| Feature | Description |
|---------|-------------|
| **Dual Storage Engine** | Choose between `graph` (SocialGraphV2, default) or `document` (JSONL) per project |
| **Project Graph Page** | Built-in HTTP server + vis-network page to visualize tasks/modules as an interactive graph |
| **11 Document Section Types** | overview, requirements, api_design, technical_notes, architecture, and more |
| **Two-Level Task Hierarchy** | MainTask + SubTask with priority levels (P0–P3) and status transitions |
| **Module Registry** | Aggregate tasks and docs by module for intuitive project architecture |
| **Git Commit Anchoring** | Auto-record commit hash on task completion; `sync_git` detects rollbacks |
| **Auto Progress Tracking** | Automatically update parent task progress when subtasks are completed |
| **Idempotent Task Import** | `upsert_task` prevents duplicates, ideal for batch initialization |
| **Data Migration** | Seamlessly migrate between `document` and `graph` engines with backup support |
| **Markdown Export** | Generate structured development plan documents for sharing and archiving |
| **Zero-Config Storage** | Local storage in the project's `.devplan/` directory — no external database needed |

### Quick Start

#### Installation

```bash
npm install -g aifastdb-devplan
```

#### Option A: As an MCP Server (Recommended)

Configure in Cursor IDE (`.cursor/mcp.json`):

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

Or in Claude Desktop (`claude_desktop_config.json`):

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

Once configured, your AI assistant can use the default `micro` MCP tool set (13 core `devplan_*` tools) to manage your development plans.

#### MCP Tool Exposure Modes

`aifastdb-devplan` now supports three MCP tool exposure modes:

- `micro` (default): expose 13 core tools for the most common DevPlan workflow
- `slim`: expose 25 commonly used tools
- `full`: expose the complete MCP tool catalog for advanced or low-frequency workflows

The exposed tools are organized into five groups:

- `project`
- `docs`
- `tasks`
- `memory`
- `batch`

By default, the server starts in `micro` mode, which means:

- MCP `ListTools` only returns those 13 tools
- only those 13 tools are exposed to the AI assistant
- tools outside that set are not just hidden; they are rejected at call time

To temporarily enable the full catalog:

```bash
export AIFASTDB_DEVPLAN_MCP_TOOL_MODE=full
npx aifastdb-devplan
```

PowerShell:

```powershell
$env:AIFASTDB_DEVPLAN_MCP_TOOL_MODE = "full"
npx aifastdb-devplan
```

To explicitly use slim mode:

```bash
export AIFASTDB_DEVPLAN_MCP_TOOL_MODE=slim
```

PowerShell:

```powershell
$env:AIFASTDB_DEVPLAN_MCP_TOOL_MODE = "slim"
```

To explicitly use micro mode:

```bash
export AIFASTDB_DEVPLAN_MCP_TOOL_MODE=micro
```

PowerShell:

```powershell
$env:AIFASTDB_DEVPLAN_MCP_TOOL_MODE = "micro"
```

#### Option B: As an npm Package (Programmatic)

```typescript
import { DevPlanStore, createDevPlan } from 'aifastdb-devplan';

const plan = createDevPlan('my-project');

// Create a main task
plan.createMainTask({
  projectName: 'my-project',
  taskId: 'phase-1',
  title: 'Phase 1: Foundation Setup',
  priority: 'P0',
});

// Add a subtask
plan.addSubTask({
  projectName: 'my-project',
  taskId: 'T1.1',
  parentTaskId: 'phase-1',
  title: 'Initialize project structure',
});

// Complete task (auto-updates progress + Git commit anchoring)
plan.completeSubTask('T1.1');

// Check progress
const progress = plan.getProgress();
console.log(progress);
```

### MCP Tools (default micro mode: 13 total, slim mode: 25 total)

#### Grouped Catalog

| Group | Tools |
|------|-------|
| `project` | `devplan_init`, `devplan_save_prompt`, `devplan_get_progress` |
| `docs` | `devplan_save_section`, `devplan_get_section`, `devplan_list_sections`, `devplan_search_sections`, `devplan_delete_section` |
| `tasks` | `devplan_create_main_task`, `devplan_add_sub_task`, `devplan_delete_task`, `devplan_update_task_status`, `devplan_complete_task`, `devplan_list_tasks`, `devplan_search_tasks`, `devplan_start_phase` |
| `memory` | `devplan_memory_save`, `devplan_recall_unified`, `devplan_memory_context`, `devplan_memory_list`, `devplan_memory_delete`, `devplan_memory_generate` |
| `batch` | `devplan_memory_batch_prepare`, `devplan_memory_batch_commit`, `devplan_memory_batch_status` |

#### Default `micro` Mode

`micro` keeps the shortest, highest-frequency workflow tools:

- `project`: `devplan_init`, `devplan_save_prompt`
- `docs`: `devplan_get_section`, `devplan_search_sections`, `devplan_save_section`
- `tasks`: `devplan_list_tasks`, `devplan_search_tasks`, `devplan_start_phase`, `devplan_create_main_task`, `devplan_add_sub_task`, `devplan_complete_task`
- `memory`: `devplan_memory_save`, `devplan_recall_unified`

`slim` expands that to the 25 commonly used tools above, and `full` exposes the entire catalog.

### Dual Storage Engine

Each project can independently choose its storage engine:

| Engine | Backend | Default | Features |
|--------|---------|---------|----------|
| `graph` | SocialGraphV2 (WAL + sharding) | ✅ New projects | Graph visualization, entity-relation model |
| `document` | EnhancedDocumentStore (JSONL) | Auto-detected for legacy | Lightweight, human-readable files |

Engine selection priority:
1. Explicit `engine` parameter in `createDevPlan()`
2. `.devplan/{project}/engine.json` configuration
3. Auto-detect existing JSONL files → `document`
4. New projects → `graph`

### Project Graph Page

Visualize your development plan as an interactive graph:

```bash
npm run visualize -- --project my-project --base-path /path/to/.devplan
# or
aifastdb-devplan-visual --project my-project --port 3210
```

The built-in HTTP server serves a self-contained HTML page with [vis-network](https://visjs.github.io/vis-network/), featuring:

- **5 node types**: project (star), module (diamond), main-task (circle), sub-task (dot), document (box)
- **Status-based coloring**: completed (green), in-progress (blue), pending (gray)
- **Interactive features**: click for details panel, filter by type, stats bar with progress
- **Dark theme**: consistent with modern development tools

### Enable DevPlan in Other Projects (Step-by-Step Guide)

Here's a complete guide to enable devplan in any project (e.g., `my-app`).

#### Method 1: npm Published Version (Recommended)

**Step 1: Install globally**

```bash
npm install -g aifastdb-devplan
```

**Step 2: Configure MCP Server in your project**

Create `.cursor/mcp.json` in your project root:

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

**Step 3: Start using with AI assistant**

Open Cursor in your project directory and tell the AI:

```
Initialize a development plan for my-app project
```

The AI will call `devplan_init` and data will be stored in `.devplan/my-app/` under your project root (auto-detected via `.git` or `package.json`).

If the project already has `.cursor/rules/dev-plan-management.mdc` and you want to upgrade it to the latest generated template, call:

```ts
devplan_init({
  projectName: "my-app",
  refreshCursorRule: true
})
```

For document search, prefer explicit field targeting when possible:

```ts
devplan_search_sections({ projectName: "my-app", query: "171e9a18-c7e9-430b-9e3d-fa6d384a0b4e", searchBy: "id" })
devplan_search_sections({ projectName: "my-app", query: "Vector Store", searchBy: "title" })
devplan_search_sections({ projectName: "my-app", query: "BM25 tokenization", searchBy: "content" })
```

For task search, you can also explicitly control which field to search:

```ts
devplan_search_tasks({ projectName: "my-app", query: "phase-14", searchBy: "taskId" })
devplan_search_tasks({ projectName: "my-app", query: "Vector Search Refactor", searchBy: "title" })
devplan_search_tasks({ projectName: "my-app", query: "refresh cursor rule template", searchBy: "description" })
devplan_search_tasks({ projectName: "my-app", query: "rebuild search ranking helper", searchBy: "subTask" })
devplan_search_tasks({ projectName: "my-app", query: "search ranking", includeSubTasks: true })
```

When a sub-task matches, `matchedSubTasks` returns the matched child items. If `includeSubTasks: true`, the response also includes all sub-tasks under each matched main task.

#### Method 2: Local Development Version

If you're working with a local clone of `aifastdb-devplan` (not yet published or testing changes):

**Step 1: Build locally**

```bash
cd /path/to/aifastdb-devplan
npm install
npm run build
```

**Step 2: Configure MCP Server with local path**

Create `.cursor/mcp.json` in your target project:

```json
{
  "mcpServers": {
    "aifastdb-devplan": {
      "command": "node",
      "args": ["/path/to/aifastdb-devplan/dist/mcp-server/index.js"]
    }
  }
}
```

Windows example:

```json
{
  "mcpServers": {
    "aifastdb-devplan": {
      "command": "node",
      "args": ["D:/Project/git/aifastdb-devplan/dist/mcp-server/index.js"]
    }
  }
}
```

#### Controlling Data Storage Location

By default, devplan auto-detects your project root and stores data in `.devplan/`. You can override this:

**Option A: Environment variable (global override)**

```bash
# All devplan data will be stored under this path
export AIFASTDB_DEVPLAN_PATH=/path/to/shared/devplans
```

**Option B: `--base-path` for visualization server**

```bash
# View another project's devplan graph
aifastdb-devplan-visual --project my-app --base-path /path/to/my-app/.devplan --port 3210
```

#### `--base-path` Parameter Details

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--project` | Project name (must match the name used in `devplan_init`) | **Required** |
| `--base-path` | Absolute path to the `.devplan` directory | Auto-detect via `.git` / `package.json`, fallback to `~/.aifastdb/dev-plans/` |
| `--port` | HTTP server port | `3210` |

**Data directory structure** under `--base-path`:

```
<base-path>/
└── <project-name>/
    ├── engine.json        # Engine config
    ├── graph-data/        # Graph engine data (WAL shards)
    ├── documents.jsonl    # Document engine data
    ├── tasks.jsonl
    └── modules.jsonl
```

#### Complete Example: Managing "my-app" from Scratch

```bash
# 1. Install devplan globally
npm install -g aifastdb-devplan

# 2. Go to your project
cd /path/to/my-app

# 3. Create MCP config
mkdir -p .cursor
echo '{"mcpServers":{"aifastdb-devplan":{"command":"npx","args":["aifastdb-devplan"]}}}' > .cursor/mcp.json

# 4. Open in Cursor and tell AI:
#    "Initialize devplan for my-app, create Phase 1 with 3 subtasks"

# 5. Visualize the plan graph
npx aifastdb-devplan-visual --project my-app --base-path .devplan --port 3210
```

### Data Storage

Data is stored locally — **no external database required**:

```
.devplan/{projectName}/
├── engine.json        # Engine configuration (graph or document)
├── documents.jsonl    # Document sections (document engine)
├── tasks.jsonl        # Main tasks + subtasks (document engine)
├── modules.jsonl      # Feature modules (document engine)
└── graph-data/        # WAL-based graph storage (graph engine)
    └── wal/           # Write-ahead log shards
```

Storage path resolution priority:

| Priority | Source | Description |
|----------|--------|-------------|
| 1 | `AIFASTDB_DEVPLAN_PATH` env var | Explicitly specify storage directory |
| 2 | `.devplan/` in project root | Auto-detect via `.git` / `package.json` |
| 3 | `~/.aifastdb/dev-plans/` | Global fallback path |

### Platform Support

`aifastdb-devplan` is a pure TypeScript/JavaScript project, supporting all platforms with Node.js ≥ 18:

| Platform | Architecture | Supported |
|----------|-------------|-----------|
| Windows | x64 | ✅ |
| macOS | x64 / Apple Silicon (M1/M2/M3/M4) | ✅ |
| Linux | x64 / ARM64 | ✅ |

> Note: The underlying storage engine [aifastdb](https://github.com/aifastdb/aifastdb) includes Rust native bindings with prebuilt binaries for all listed platforms.

---

<a id="中文"></a>

## 中文

### 为什么需要 aifastdb-devplan？

在 AI 辅助编程时代，开发者与 AI 助手的协作越来越密切。但 AI 助手缺乏**持久化的项目记忆**——每次对话都从零开始，无法了解项目的整体规划、当前进度和历史决策。

**aifastdb-devplan** 解决了这个问题：它为 AI 助手提供了一套**结构化的开发计划管理工具**，让 AI 能够：

- 📋 **了解项目全貌** — 读取项目概述、技术方案、API 设计等文档片段
- 🎯 **追踪任务进度** — 管理两级任务层级（主任务 → 子任务），实时更新进度
- 🔗 **锚定 Git 历史** — 完成任务时自动记录 Git commit hash，支持回滚检测
- 📦 **模块化管理** — 按功能模块组织任务和文档，清晰展示项目架构
- 📄 **导出文档** — 一键生成完整的 Markdown 格式开发计划文档

### 核心特性

| 特性 | 说明 |
|------|------|
| **双存储引擎** | 每个项目可独立选择 `graph`（SocialGraphV2，默认）或 `document`（JSONL）引擎 |
| **项目图谱** | 内置 HTTP 服务器 + vis-network 页面，将任务/模块以交互式图谱展示 |
| **11 种文档片段** | overview, requirements, api_design, technical_notes, architecture 等标准类型 |
| **两级任务层级** | 主任务 (MainTask) + 子任务 (SubTask)，支持优先级 (P0-P3) 和状态流转 |
| **功能模块注册表** | 按模块维度聚合任务和文档，直观展示项目架构 |
| **Git Commit 锚定** | 完成任务时自动记录 commit hash，`sync_git` 可检测代码回滚 |
| **自动进度统计** | 完成子任务时自动更新主任务进度百分比 |
| **幂等任务导入** | `upsert_task` 支持防重复导入，适合批量初始化 |
| **数据迁移** | 在 `document` 和 `graph` 引擎间无缝迁移，支持备份 |
| **Markdown 导出** | 生成结构化的开发计划文档，方便分享和归档 |
| **零配置存储** | 本地存储，数据保存在项目 `.devplan/` 目录中，无需外部数据库 |

### 快速开始

#### 安装

```bash
npm install -g aifastdb-devplan
```

#### 方式 A：作为 MCP Server 使用（推荐）

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

配置完成后，AI 助手默认即可使用 `micro` MCP 工具集（12 个核心 `devplan_*` 工具）来管理你的开发计划。

#### MCP 工具暴露模式

`aifastdb-devplan` 现在支持三种 MCP 工具暴露模式：

- `micro`（默认）：只暴露 12 个核心工具
- `slim`：暴露 24 个常用 DevPlan 工具
- `full`：暴露完整 MCP 工具目录，适合高级或低频工作流

工具同时按 5 组组织：

- `project`
- `docs`
- `tasks`
- `memory`
- `batch`

默认启动时使用 `micro` 模式，这意味着：

- MCP `ListTools` 只会返回这 12 个工具
- AI 助手上下文里也只会看到并使用这 12 个工具
- 白名单外工具不只是“隐藏”，而是调用时会被直接拒绝

临时开启全量工具目录：

```bash
export AIFASTDB_DEVPLAN_MCP_TOOL_MODE=full
npx aifastdb-devplan
```

PowerShell：

```powershell
$env:AIFASTDB_DEVPLAN_MCP_TOOL_MODE = "full"
npx aifastdb-devplan
```

如需显式切换到 `slim` 模式：

```bash
export AIFASTDB_DEVPLAN_MCP_TOOL_MODE=slim
```

PowerShell：

```powershell
$env:AIFASTDB_DEVPLAN_MCP_TOOL_MODE = "slim"
```

如需显式使用默认 `micro` 模式：

```bash
export AIFASTDB_DEVPLAN_MCP_TOOL_MODE=micro
```

PowerShell：

```powershell
$env:AIFASTDB_DEVPLAN_MCP_TOOL_MODE = "micro"
```

#### 方式 B：作为 npm 包编程使用

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

### MCP 工具一览（默认 micro 13 个，slim 25 个）

#### 分组目录

| 分组 | 工具 |
|------|------|
| `project` | `devplan_init`、`devplan_save_prompt`、`devplan_get_progress` |
| `docs` | `devplan_save_section`、`devplan_get_section`、`devplan_list_sections`、`devplan_search_sections`、`devplan_delete_section` |
| `tasks` | `devplan_create_main_task`、`devplan_add_sub_task`、`devplan_delete_task`、`devplan_update_task_status`、`devplan_complete_task`、`devplan_list_tasks`、`devplan_search_tasks`、`devplan_start_phase` |
| `memory` | `devplan_memory_save`、`devplan_recall_unified`、`devplan_memory_context`、`devplan_memory_list`、`devplan_memory_delete`、`devplan_memory_generate` |
| `batch` | `devplan_memory_batch_prepare`、`devplan_memory_batch_commit`、`devplan_memory_batch_status` |

#### 默认 `micro` 模式

`micro` 只保留最高频、最短链路的工具：

- `project`：`devplan_init`、`devplan_save_prompt`
- `docs`：`devplan_get_section`、`devplan_search_sections`、`devplan_save_section`
- `tasks`：`devplan_list_tasks`、`devplan_search_tasks`、`devplan_start_phase`、`devplan_create_main_task`、`devplan_add_sub_task`、`devplan_complete_task`
- `memory`：`devplan_memory_save`、`devplan_recall_unified`

当前默认 `micro` 的 13 个工具完整清单：

- `devplan_init`
- `devplan_save_prompt`
- `devplan_get_section`
- `devplan_search_sections`
- `devplan_save_section`
- `devplan_list_tasks`
- `devplan_search_tasks`
- `devplan_start_phase`
- `devplan_create_main_task`
- `devplan_add_sub_task`
- `devplan_complete_task`
- `devplan_memory_save`
- `devplan_recall_unified`

`slim` 扩展为上面的 25 个常用工具，`full` 则暴露全部工具目录。

### 双存储引擎

每个项目可独立选择存储引擎：

| 引擎 | 后端 | 默认 | 特点 |
|------|------|------|------|
| `graph` | SocialGraphV2（WAL + 分片） | ✅ 新项目 | 图可视化、实体-关系模型 |
| `document` | EnhancedDocumentStore（JSONL） | 旧项目自动检测 | 轻量、文件可读 |

引擎选择优先级：
1. `createDevPlan()` 显式传入 `engine` 参数
2. `.devplan/{project}/engine.json` 配置文件
3. 已有 JSONL 数据文件 → 自动识别为 `document`
4. 新项目 → 默认使用 `graph`

### 项目图谱

将开发计划以交互式图谱形式展示：

```bash
npm run visualize -- --project my-project --base-path /path/to/.devplan
# 或
aifastdb-devplan-visual --project my-project --port 3210
```

内置 HTTP 服务器提供自包含 HTML 页面，使用 [vis-network](https://visjs.github.io/vis-network/) 渲染：

- **5 种节点类型**：项目（星形）、模块（菱形）、主任务（圆形）、子任务（小圆点）、文档（方形）
- **状态着色**：已完成（绿色）、进行中（蓝色）、待开始（灰色）
- **交互功能**：点击查看详情面板、按类型过滤、顶部统计栏 + 进度条
- **暗色主题**：与现代开发工具风格一致

### 在其它项目中启用 DevPlan（实战指南）

以下是在任意项目（例如 `my-app`）中启用 devplan 的完整步骤。

#### 方式一：使用 npm 发布版本（推荐）

**第 1 步：全局安装**

```bash
npm install -g aifastdb-devplan
```

**第 2 步：在目标项目中配置 MCP Server**

在项目根目录创建 `.cursor/mcp.json`：

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

**第 3 步：通过 AI 助手开始使用**

在 Cursor 中打开你的项目目录，对 AI 说：

```
为 my-app 项目初始化开发计划
```

AI 会调用 `devplan_init`，数据自动存储在项目根目录下的 `.devplan/my-app/` 中（通过 `.git` 或 `package.json` 自动检测项目根目录）。

如果项目已经存在 `.cursor/rules/dev-plan-management.mdc`，但你想把它升级到最新模板，可显式调用：

```ts
devplan_init({
  projectName: "my-app",
  refreshCursorRule: true
})
```

在文档搜索时，推荐尽量显式指定目标字段：

```ts
devplan_search_sections({ projectName: "my-app", query: "171e9a18-c7e9-430b-9e3d-fa6d384a0b4e", searchBy: "id" })
devplan_search_sections({ projectName: "my-app", query: "向量存储", searchBy: "title" })
devplan_search_sections({ projectName: "my-app", query: "BM25 中文分词", searchBy: "content" })
```

在任务搜索时，也推荐尽量显式指定目标字段：

```ts
devplan_search_tasks({ projectName: "my-app", query: "phase-14", searchBy: "taskId" })
devplan_search_tasks({ projectName: "my-app", query: "向量搜索重构", searchBy: "title" })
devplan_search_tasks({ projectName: "my-app", query: "刷新 cursor rule 模板", searchBy: "description" })
devplan_search_tasks({ projectName: "my-app", query: "重建搜索排序 helper", searchBy: "subTask" })
devplan_search_tasks({ projectName: "my-app", query: "搜索排序", includeSubTasks: true })
```

当命中的是子任务时，返回结果中的 `matchedSubTasks` 会列出命中的子任务；如果传入 `includeSubTasks: true`，还会额外附带该主任务下的全部子任务。

#### 方式二：使用本地开发版本

如果你在使用本地克隆的 `aifastdb-devplan`（未发布到 npm 或正在测试修改）：

**第 1 步：本地构建**

```bash
cd /path/to/aifastdb-devplan
npm install
npm run build
```

**第 2 步：使用本地路径配置 MCP Server**

在目标项目中创建 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "aifastdb-devplan": {
      "command": "node",
      "args": ["/path/to/aifastdb-devplan/dist/mcp-server/index.js"]
    }
  }
}
```

Windows 示例：

```json
{
  "mcpServers": {
    "aifastdb-devplan": {
      "command": "node",
      "args": ["D:/Project/git/aifastdb-devplan/dist/mcp-server/index.js"]
    }
  }
}
```

#### 控制数据存储位置

默认情况下，devplan 会自动检测项目根目录并将数据存储在 `.devplan/` 下。你可以通过以下方式覆盖：

**方案 A：环境变量（全局覆盖）**

```bash
# 所有 devplan 数据将存储在此路径下
export AIFASTDB_DEVPLAN_PATH=/path/to/shared/devplans
```

Windows PowerShell：

```powershell
$env:AIFASTDB_DEVPLAN_PATH = "D:\shared\devplans"
```

**方案 B：可视化服务器使用 `--base-path`**

```bash
# 查看另一个项目的 devplan 图谱
aifastdb-devplan-visual --project my-app --base-path /path/to/my-app/.devplan --port 3210
```

#### `--base-path` 参数详解

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--project` | 项目名称（必须与 `devplan_init` 时使用的名称一致） | **必填** |
| `--base-path` | `.devplan` 目录的绝对路径 | 自动检测（通过 `.git` / `package.json`），兜底 `~/.aifastdb/dev-plans/` |
| `--port` | HTTP 服务器端口 | `3210` |

**`--base-path` 下的数据目录结构**：

```
<base-path>/
└── <project-name>/
    ├── engine.json        # 引擎配置
    ├── graph-data/        # Graph 引擎数据（WAL 分片）
    ├── documents.jsonl    # Document 引擎数据
    ├── tasks.jsonl
    └── modules.jsonl
```

#### 完整示例：从零管理 "my-app" 项目

```bash
# 1. 全局安装 devplan
npm install -g aifastdb-devplan

# 2. 进入你的项目目录
cd /path/to/my-app

# 3. 创建 MCP 配置
mkdir -p .cursor
echo '{"mcpServers":{"aifastdb-devplan":{"command":"npx","args":["aifastdb-devplan"]}}}' > .cursor/mcp.json

# 4. 在 Cursor 中打开项目，对 AI 说：
#    "为 my-app 初始化开发计划，创建阶段一并添加 3 个子任务"

# 5. 可视化查看计划图谱
npx aifastdb-devplan-visual --project my-app --base-path .devplan --port 3210
```

### 数据存储

数据存储在本地，**无需外部数据库**：

```
.devplan/{projectName}/
├── engine.json        # 引擎配置（graph 或 document）
├── documents.jsonl    # 文档片段（document 引擎）
├── tasks.jsonl        # 主任务 + 子任务（document 引擎）
├── modules.jsonl      # 功能模块（document 引擎）
└── graph-data/        # WAL 图存储（graph 引擎）
    └── wal/           # 预写日志分片
```

存储路径解析优先级：

| 优先级 | 路径来源 | 说明 |
|--------|---------|------|
| 1 | `AIFASTDB_DEVPLAN_PATH` 环境变量 | 显式指定存储目录 |
| 2 | 项目内 `.devplan/` 目录 | 自动检测项目根目录（通过 `.git` / `package.json`） |
| 3 | `~/.aifastdb/dev-plans/` | 全局兜底路径 |

### 平台支持

`aifastdb-devplan` 是纯 TypeScript/JavaScript 项目，支持所有 Node.js ≥ 18 的平台：

| 平台 | 架构 | 支持 |
|------|------|------|
| Windows | x64 | ✅ |
| macOS | x64 / Apple Silicon (M1/M2/M3/M4) | ✅ |
| Linux | x64 / ARM64 | ✅ |

> 注：底层存储引擎 [aifastdb](https://github.com/aifastdb/aifastdb) 包含 Rust 原生绑定，已为上述平台提供预编译二进制文件。

---

## Tech Stack / 技术栈

- **Storage Engine / 存储引擎**: [aifastdb](https://github.com/aifastdb/aifastdb) — Dual engine: SocialGraphV2 (graph) + EnhancedDocumentStore (JSONL), built with Rust + N-API
- **Protocol / 通信协议**: [MCP (Model Context Protocol)](https://modelcontextprotocol.io) — Standard protocol for AI assistant tool invocation
- **Visualization / 可视化**: [vis-network](https://visjs.github.io/vis-network/) — Interactive graph visualization (CDN, zero dependencies)
- **Runtime / 运行时**: Node.js ≥ 18
- **Language / 语言**: TypeScript (strict mode)

## Related Projects / 相关项目

- [aifastdb](https://github.com/aifastdb/aifastdb) — AI-friendly high-performance database engine (vector search + semantic indexing + agent memory)
- [MCP Protocol](https://modelcontextprotocol.io) — Model Context Protocol official documentation

## License

[MIT](LICENSE)
