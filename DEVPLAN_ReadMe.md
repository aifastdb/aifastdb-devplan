# AiFastDb-DevPlan 完整功能文档

> 文档版本: 1.1.0  
> 创建日期: 2026-02-09  
> 最后更新: 2026-02-13  
> 项目仓库: https://github.com/aifastdb/aifastdb-devplan  
> npm 包: `aifastdb-devplan` v1.0.3  
> 关联项目: `aifastdb` (底层存储引擎)

---

## 1. 项目概述

### 1.1 背景与定位

**AiFastDb-DevPlan** 是一个基于 `aifastdb` 存储引擎的通用开发计划管理系统，作为独立的 **MCP Server** 发布，供 Cursor IDE 和 Claude Desktop 等 AI 工具使用。

核心能力：
- **文档管理**：将大型开发计划文档拆分为结构化的片段（11 种标准类型），AI 可按需读取
- **文档搜索**：支持字面匹配、语义搜索（VibeSynapse Candle MiniLM）和混合搜索（RRF 融合排序），自动降级
- **任务追踪**：主任务（开发阶段）→ 子任务（具体工作项）的两级任务体系，自动计数和进度统计
- **任务排序**：主任务和子任务支持 `order` 排序序号，自动分配、稳定排序
- **阶段自动执行**：通过"开始 phase-X"指令自动启动开发阶段，AI 自动创建 TodoList 并逐个执行子任务
- **模块聚合**：通过功能模块（Module）维度组织任务和文档，提供模块中心视图
- **Git 集成**：任务完成时锚定 Git commit，支持回滚检测和状态同步
- **可视化**：内置项目图谱和统计仪表盘，实时展示项目全貌

### 1.2 版本演进

```
v1.0.0 (2026-02-08)  从 ai_db 独立拆分，16 个 MCP 工具
  ↓
v2.0.0 (2026-02-09)  双引擎架构 — Graph (SocialGraphV2) + Document (JSONL)
  ↓
v2.1.0 (2026-02-09)  数据迁移工具 — document ↔ graph 双向迁移
  ↓
v3.0.0 (2026-02-09)  项目图谱服务 — vis-network 交互式图谱
  ↓
v3.x   (2026-02-09)  统计仪表盘、侧边栏导航、UI 增强
  ↓
v4.0.0 (2026-02-13)  任务排序 + 语义搜索 — order 字段、VibeSynapse 集成
  ↓
v4.2.0 (2026-02-13)  文档列表弹层 + 统计栏增强 — 层级展示、/api/docs 端点
  ↓
v5.0.0 (规划中)      Autopilot 模块 — cursor_auto 融合、/api/auto/* 端点、3 个新 MCP 工具
```

### 1.3 项目结构

```
aifastdb-devplan/
├── package.json                        # npm 包配置 (v1.0.3)
├── tsconfig.json                       # TypeScript 配置 (ES2020, CommonJS, strict)
├── README.md                           # 使用说明（中英双语）
├── DEVPLAN_ReadMe.md                   # 本文档
│
├── src/                                # TypeScript — DevPlan 核心 + MCP + 可视化
│   ├── types.ts                        # 所有类型定义（463 行 + Autopilot 类型）
│   ├── dev-plan-interface.ts           # IDevPlanStore 抽象接口（249 行，30+ 方法）
│   ├── dev-plan-document-store.ts      # Document 引擎实现（EnhancedDocumentStore/JSONL）
│   ├── dev-plan-graph-store.ts         # Graph 引擎实现（SocialGraphV2）
│   ├── dev-plan-factory.ts             # 工厂函数 + 引擎选择逻辑
│   ├── dev-plan-migrate.ts             # 数据迁移工具（document ↔ graph）
│   ├── index.ts                        # npm 包导出入口
│   ├── mcp-server/
│   │   └── index.ts                    # MCP Server — 23 个 devplan_* 工具（规划 +3 autopilot 工具）
│   └── visualize/
│       ├── template.ts                 # 自包含 HTML 模板（vis-network + 暗色主题）
│       └── server.ts                   # 轻量 HTTP 服务器（现有 API + 规划 /api/auto/* 端点）
│
├── executor/                           # Python — Autopilot 执行器（规划中，从 cursor_auto 迁入）
│   ├── pyproject.toml                  #   Python 依赖与项目元数据
│   ├── README.md                       #   executor 使用说明
│   ├── src/                            #   Python 源码
│   │   ├── engine.py                   #     主控引擎（双通道决策）
│   │   ├── devplan_client.py           #     DevPlan HTTP 客户端
│   │   ├── cursor_controller.py        #     GUI 自动化
│   │   ├── vision_analyzer.py          #     视觉分析（精简后）
│   │   ├── ui_server.py                #     Web UI 监控
│   │   └── config.py                   #     配置管理
│   ├── templates/                      #   Web UI 前端
│   └── tests/                          #   Python 测试
│
└── .cursor/
    └── rules/
        └── dev-plan-management.mdc     # Cursor Rules 配置
```

> **注意**：`executor/` 目录为规划中的 Autopilot 模块（v5.0.0），详见 [第 13 节](#13-autopilot-模块--cursor_auto-融合方案)。`tsconfig.json` 的 `include: ["src/**/*"]` 和 `package.json` 的 `files: ["dist"]` 天然排除 `executor/`，对 TypeScript 编译和 npm 发布零影响。

### 1.4 依赖关系

```
aifastdb-devplan (独立项目)
  │
  ├── [TypeScript] src/
  │   ├── aifastdb (^2.5.1)                 # 底层存储引擎
  │   │   ├── EnhancedDocumentStore         # Document 引擎的底层依赖
  │   │   ├── SocialGraphV2                 # Graph 引擎的底层依赖（含 HNSW 向量索引）
  │   │   ├── VibeSynapse                   # 感知引擎（Candle MiniLM Embedding 生成）
  │   │   └── ContentType / DocumentInput   # 类型依赖
  │   └── @modelcontextprotocol/sdk (^1.0.0) # MCP 协议 SDK
  │
  └── [Python] executor/ (规划中)
      ├── requests                          # HTTP 客户端（调用 /api/auto/* 端点）
      ├── pyautogui                         # GUI 自动化（鼠标、键盘、截图）
      ├── pygetwindow                       # 窗口管理
      ├── ollama                            # 视觉 AI 模型调用
      ├── Pillow                            # 图像处理
      ├── pyperclip                         # 剪贴板操作
      └── Flask                             # Web UI 监控后端
```

依赖方向始终是 `aifastdb-devplan → aifastdb`（单向依赖），`ai_db` 不知晓也不依赖 `aifastdb-devplan` 的存在。TypeScript 和 Python 之间通过 HTTP API 通信，无直接代码依赖。

---

## 2. 双引擎存储架构

### 2.1 概述

DevPlan 支持两种存储引擎，每个项目独立选择：

| 引擎 | 底层实现 | 数据格式 | 特点 | 适用场景 |
|------|---------|---------|------|---------|
| **graph** (默认) | `SocialGraphV2` | WAL + 分片文件 | 天然的实体-关系模型，支持图导出和可视化 | 新项目（推荐） |
| **document** | `EnhancedDocumentStore` | JSONL 追加写入 | 轻量、简单、天然跟随 Git 版本 | 旧项目兼容 |

### 2.2 引擎选择机制

引擎选择优先级（从高到低）：

| 优先级 | 条件 | 选择的引擎 |
|--------|------|-----------|
| 1 | `createDevPlan()` 显式传入 `engine` 参数 | 使用指定引擎 |
| 2 | `.devplan/{projectName}/engine.json` 已存在 | 使用配置的引擎 |
| 3 | 已有 JSONL 数据文件（`documents.jsonl` / `tasks.jsonl`） | `document`（向后兼容） |
| 4 | 全新项目 | `graph`（默认） |

`engine.json` 格式：

```json
{
  "engine": "graph",
  "version": "1.0.0"
}
```

### 2.3 Graph 引擎数据模型映射

DevPlan 的层级结构映射为 `SocialGraphV2` 的实体-关系模型：

**实体类型（5 种）：**

| DevPlan 概念 | Entity 类型 | 说明 |
|-------------|-------------|------|
| 项目 | `devplan-project` | 根节点 |
| 文档片段 | `devplan-doc` | section + subSection 唯一标识 |
| 主任务 | `devplan-main-task` | 对应开发阶段 |
| 子任务 | `devplan-sub-task` | 对应具体工作项 |
| 功能模块 | `devplan-module` | 独立功能区域 |

**关系类型（7 种）：**

| 关系类型 | 方向 | 说明 |
|---------|------|------|
| `has_document` | project → doc | 项目拥有文档 |
| `has_main_task` | project → main-task | 项目拥有主任务 |
| `has_sub_task` | main-task → sub-task | 主任务包含子任务 |
| `module_has_task` | module → main-task | 模块关联主任务 |
| `module_has_doc` | module → doc | 模块关联文档 |
| `task_has_doc` | main-task → doc | 主任务关联文档（双向） |
| `doc_has_child` | doc → doc | 文档包含子文档（文档层级关系） |

### 2.4 数据迁移

通过 `devplan_migrate_engine` MCP 工具或 `migrateEngine()` API 实现双向迁移：

```
源引擎实例 → 读取全部数据 → [可选] 备份源数据 → 写入目标引擎 → 更新 engine.json
```

数据写入顺序（尊重 graph 引擎的依赖关系）：
1. **模块** (modules) — 无依赖
2. **文档** (documents) — 无依赖
3. **主任务** (mainTasks) — 无依赖
4. **子任务** (subTasks) — 依赖主任务存在

迁移参数：

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `projectName` | string | 是 | 项目名称 |
| `targetEngine` | `"graph"` \| `"document"` | 是 | 目标引擎类型 |
| `dryRun` | boolean | 否 | 预览模式（默认 `false`） |
| `backup` | boolean | 否 | 迁移前备份（默认 `true`） |

---

## 3. 核心数据模型

### 3.1 文档片段 (DevPlanDoc)

将大型开发计划文档拆分为结构化片段，支持 **11 种标准 section 类型**：

| Section 类型 | 说明 | 支持子文档 |
|-------------|------|-----------|
| `overview` | 概述：项目背景、目标、架构图、版本说明 | 否 |
| `core_concepts` | 核心概念：术语定义、数据模型、关键抽象 | 否 |
| `api_design` | API 设计：接口定义、类型系统、使用方式 | 否 |
| `file_structure` | 文件结构：目录树、模块划分、代码组织 | 否 |
| `config` | 配置设计：配置文件格式、环境变量、示例 | 否 |
| `examples` | 使用示例：代码片段、调用演示、最佳实践 | 否 |
| `technical_notes` | 技术笔记：性能、安全、错误处理等 | **是**（通过 `subSection`） |
| `api_endpoints` | API 端点汇总：REST/RPC 端点列表 | 否 |
| `milestones` | 里程碑：版本目标、交付节点、时间线 | 否 |
| `changelog` | 变更记录：版本历史、修改内容 | 否 |
| `custom` | 自定义章节：用户自行扩展 | **是**（通过 `subSection`） |

**关键字段：**

```typescript
interface DevPlanDoc {
  id: string;                    // 文档 ID
  projectName: string;           // 项目名称
  section: DevPlanSection;       // 片段类型（11 种之一）
  title: string;                 // 文档标题
  content: string;               // Markdown 内容
  version: string;               // 文档版本
  subSection?: string;           // 子分类（用于 technical_notes / custom）
  moduleId?: string;             // 关联的功能模块 ID
  relatedTaskIds?: string[];     // 关联的主任务 ID 列表
  parentDoc?: string;            // 父文档标识（"section" 或 "section|subSection" 格式）
  childDocs?: string[];          // 子文档标识列表（自动计算，仅 Graph 引擎支持）
  createdAt: number;             // 创建时间（Unix 毫秒）
  updatedAt: number;             // 更新时间（Unix 毫秒）
}
```

### 3.2 主任务 (MainTask)

对应一个完整的**开发阶段**，下辖多个子任务。

```typescript
interface MainTask {
  id: string;                    // 文档 ID
  projectName: string;           // 项目名称
  taskId: string;                // 主任务标识（如 "phase-7"）
  title: string;                 // 任务标题
  priority: 'P0' | 'P1' | 'P2'; // 优先级
  description?: string;          // 任务描述
  estimatedHours?: number;       // 预计工时
  moduleId?: string;             // 关联的功能模块 ID
  relatedSections?: string[];    // 关联的文档片段（格式："section" 或 "section|subSection"）
  order?: number;                // 排序序号（数值越小越靠前，不填则自动分配）
  totalSubtasks: number;         // 子任务总数（自动计算）
  completedSubtasks: number;     // 已完成子任务数（自动计算）
  status: TaskStatus;            // pending | in_progress | completed | cancelled
  completedAt: number | null;    // 完成时间
  createdAt: number;
  updatedAt: number;
}
```

### 3.3 子任务 (SubTask)

与 Cursor IDE 的 TodoList 粒度一致，是最小的任务单元。

```typescript
interface SubTask {
  id: string;
  projectName: string;
  taskId: string;                // 子任务标识（如 "T7.2"）
  parentTaskId: string;          // 父主任务标识（如 "phase-7"）
  title: string;
  estimatedHours?: number;
  description?: string;
  relatedFiles?: string[];       // 涉及的代码文件
  order?: number;                // 排序序号（数值越小越靠前，不填则自动分配）
  status: TaskStatus;
  completedAt: number | null;
  completedAtCommit?: string;    // 完成时的 Git commit hash（短 SHA）
  revertReason?: string;         // 被 syncWithGit 自动回退的原因
  createdAt: number;
  updatedAt: number;
}
```

### 3.4 功能模块 (Module)

功能模块是一等实体，提供**模块维度**的聚合视图。一个模块可以关联多个主任务和多个文档。

```typescript
interface Module {
  id: string;
  projectName: string;
  moduleId: string;              // 模块标识（如 "vector-store"）
  name: string;                  // 模块名称（如 "向量存储模块"）
  description?: string;
  status: 'planning' | 'active' | 'completed' | 'deprecated';
  mainTaskCount: number;         // 关联的主任务数（自动计算）
  subTaskCount: number;          // 关联的子任务总数（自动计算）
  completedSubTaskCount: number; // 已完成子任务数（自动计算）
  docCount: number;              // 关联的文档数（自动计算）
  createdAt: number;
  updatedAt: number;
}
```

### 3.5 关系模型

```
Module ──1:N──▶ MainTask ──1:N──▶ SubTask
Module ──1:N──▶ DevPlanDoc
MainTask ◀──N:M──▶ DevPlanDoc   (通过 task_has_doc 关系双向关联)

一个模块可以关联多个主任务和多个文档。
主任务通过 moduleId 字段关联到一个模块。
文档通过 moduleId 字段关联到一个模块。
子任务通过父主任务间接关联到模块。

主任务可通过 relatedSections 字段记录关联的文档片段；
文档可通过 relatedTaskIds 字段记录关联的主任务。
在 Graph 引擎中，这种双向关系通过 task_has_doc 关系类型物理存储；
在 Document 引擎中，关系通过两侧的字段维护。
```

---

## 4. MCP 工具（23 个，规划扩展至 26 个）

`aifastdb-devplan` 作为 MCP Server 提供 23 个工具，工具名统一以 `devplan_` 为前缀。规划中的 v5.0.0 将新增 3 个 `devplan_auto_*` 工具（详见 [第 13.4.1 节](#1341-新增-mcp-工具3-个--共-26-个)）。

### 4.1 初始化（1 个）

| 工具名 | 说明 | 必需参数 | 可选参数 |
|--------|------|---------|---------|
| `devplan_init` | 初始化项目开发计划；不传 `projectName` 则列出已有计划 | — | `projectName`, `refreshCursorRule` |

返回值包含 `engine`（当前引擎类型）、`availableEngines`（可用引擎列表）、`availableSections`（11 种文档类型）。

**`devplan_init` 参数补充：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `projectName` | string | — | 项目名称；省略时列出已有项目 |
| `refreshCursorRule` | boolean | `false` | 若为 `true`，即使 `.cursor/rules/dev-plan-management.mdc` 已存在，也会用最新模板刷新覆盖；默认仅在文件不存在时生成 |

### 4.2 文档管理（3 个）

| 工具名 | 说明 | 必需参数 | 可选参数 |
|--------|------|---------|---------|
| `devplan_save_section` | 保存/更新文档片段（同 section+subSection 已存在则覆盖） | `projectName`, `section`, `title`, `content` | `version`, `subSection`, `moduleId`, `relatedTaskIds`, `parentDoc` |
| `devplan_get_section` | 读取指定文档片段 | `projectName`, `section` | `subSection` |
| `devplan_list_sections` | 列出项目的所有文档片段 | `projectName` | — |

`section` 可选值：`overview`, `core_concepts`, `api_design`, `file_structure`, `config`, `examples`, `technical_notes`, `api_endpoints`, `milestones`, `changelog`, `custom`

### 4.3 任务管理（7 个）

| 工具名 | 说明 | 必需参数 | 可选参数 |
|--------|------|---------|---------|
| `devplan_create_main_task` | 创建主任务（开发阶段） | `projectName`, `taskId`, `title`, `priority` | `description`, `estimatedHours`, `moduleId`, `relatedDocSections`, `order` |
| `devplan_add_sub_task` | 在主任务下添加子任务 | `projectName`, `taskId`, `parentTaskId`, `title` | `estimatedHours`, `description`, `order` |
| `devplan_upsert_task` | 幂等导入（upsert）主任务或子任务，防止重复 | `projectName`, `taskType`, `taskId`, `title` | `priority`, `parentTaskId`, `description`, `estimatedHours`, `status`, `preserveStatus`, `moduleId`, `relatedDocSections`, `order` |
| `devplan_complete_task` | 完成任务（自动更新主任务进度、锚定 Git commit） | `projectName`, `taskId` | `taskType`（默认 `"sub"`） |
| `devplan_list_tasks` | 列出任务（支持多种查询模式） | `projectName` | `parentTaskId`, `status`, `priority`, `moduleId` |
| `devplan_search_tasks` | 搜索任务（支持 taskId / 标题 / 描述 / 子任务字段控制） | `projectName`, `query` | `searchBy`, `scope`, `limit`, `includeSubTasks` |
| `devplan_start_phase` | 启动/恢复开发阶段（自动标记 in_progress，返回全部子任务） | `projectName`, `taskId` | — |

**`devplan_search_tasks` 参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | string | (必需) | 搜索文本，可匹配 taskId、标题、描述或子任务文本 |
| `searchBy` | `"auto"` \| `"taskId"` \| `"title"` \| `"description"` \| `"subTask"` | `"auto"` | 搜索字段控制；`auto` 会跨字段搜索，并优先排序 taskId/title 命中 |
| `scope` | `"all"` \| `"active"` \| `"completed"` | `"all"` | 搜索范围：全部、活跃任务（pending + in_progress）或已完成任务 |
| `limit` | number | 20 | 最大返回主任务数 |
| `includeSubTasks` | boolean | `false` | 若为 `true`，返回每个匹配主任务下的全部子任务；否则仅在命中子任务时返回 `matchedSubTasks` |

**任务搜索建议：**

- 已知阶段号时优先使用 `searchBy: "taskId"`，例如 `phase-14`、`T14.2`
- 按主任务标题找历史阶段时优先使用 `searchBy: "title"`
- 按任务说明中的术语或决策原因检索时优先使用 `searchBy: "description"`
- 已知要找的是子任务标题/说明时优先使用 `searchBy: "subTask"`
- 不确定字段时使用 `searchBy: "auto"`，让 taskId/title 命中优先排序

**返回值补充：**

- `matchedFields`：当前主任务命中的字段列表
- `matchScore`：内部排序分值，用于解释结果排序
- `matchedSubTasks`：仅返回真正命中的子任务摘要
- `subTasks`：仅在 `includeSubTasks: true` 时返回该主任务下的全部子任务摘要

**`devplan_list_tasks` 的三种查询模式：**

| 条件 | 行为 |
|------|------|
| 传了 `parentTaskId` | 列出指定主任务下的子任务 |
| 未传 `parentTaskId` 但传了 `status` | 跨所有主任务聚合匹配状态的子任务 |
| 两者都未传 | 列出主任务列表 |

**`order` 参数 — 任务排序：**

主任务和子任务均支持 `order` 排序序号，控制列表中的显示顺序：

| 规则 | 说明 |
|------|------|
| 数值越小越靠前 | `order: 1` 排在 `order: 2` 前面 |
| 不填则自动分配 | 自动取当前最大 order + 1，追加到末尾 |
| null 排最后 | 未设置 order 的任务排在所有有 order 的任务之后 |
| 相同 order 按创建时间 | order 相同时，按 `createdAt` 升序排列 |

排序生效于 `devplan_list_tasks`、`devplan_start_phase` 的返回结果，以及 `devplan_export_markdown` 的输出顺序。

**`devplan_upsert_task` 的状态保护：**

当 `preserveStatus` 为 `true`（默认）时，已有的更高优先级状态会被保留。例如已完成的任务不会被回退为 pending。状态优先级：`completed > in_progress > pending`。

**`devplan_start_phase` — 启动/恢复开发阶段（自动执行开发任务）：**

当用户说出"开始/继续/恢复 phase-X 开发"时，AI 自动调用此工具启动开发阶段。这是一个**幂等操作**：首次调用为启动，再次调用为恢复（已完成子任务保持 completed 状态）。

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `projectName` | string | 是 | 项目名称 |
| `taskId` | string | 是 | 主任务 ID（如 `"phase-23"`） |

**返回值结构：**

```typescript
{
  mainTask: {
    taskId: string;          // 主任务 ID
    title: string;           // 主任务标题
    priority: string;        // 优先级
    status: 'in_progress';   // 始终返回 in_progress
    description?: string;    // 描述
    estimatedHours?: number; // 预计工时
    moduleId?: string;       // 关联模块
    totalSubtasks: number;   // 子任务总数
    completedSubtasks: number; // 已完成子任务数
  };
  subTasks: [{               // 全部子任务列表
    taskId: string;
    title: string;
    status: TaskStatus;      // 保留实际状态（completed/pending/in_progress）
    description?: string;
    estimatedHours?: number;
  }];
  relatedDocSections: string[];  // 关联的文档片段标识列表
  message: string;               // 摘要信息
}
```

**自动执行工作流（AI 端行为）：**

```
用户: "开始 phase-23 开发"
  ↓
1. AI 调用 devplan_start_phase(projectName, taskId: "phase-23")
  ↓
2. 工具自动将主任务状态标记为 in_progress（已是 in_progress/completed 则跳过）
  ↓
3. 工具返回主任务信息 + 全部子任务列表（含已完成状态）
  ↓
4. AI 将子任务列表转为 Cursor TodoList（使用 TodoWrite）
   - completed 子任务 → 标记为 completed
   - pending 子任务 → 标记为 pending
  ↓
5. AI 输出阶段进度摘要（已完成 X/Y，剩余 Z 个）
  ↓
6. AI 自动定位第一个 pending 子任务，开始执行开发任务
  ↓
7. 每完成一个子任务 → devplan_complete_task 回写状态 → 更新 Todo → 继续下一个
  ↓
8. 所有子任务完成后，devplan 自动标记主任务为 completed
```

### 4.4 进度与导出（2 个）

| 工具名 | 说明 | 必需参数 | 可选参数 |
|--------|------|---------|---------|
| `devplan_get_progress` | 获取项目整体进度：文档片段数、主任务数、子任务完成率、各阶段进度条 | `projectName` | — |
| `devplan_export_markdown` | 导出开发计划为 Markdown 文档 | `projectName` | `scope`（`"full"` 或 `"tasks"`，默认 `"tasks"`） |

### 4.5 模块管理（4 个）

| 工具名 | 说明 | 必需参数 | 可选参数 |
|--------|------|---------|---------|
| `devplan_create_module` | 创建/注册功能模块 | `projectName`, `moduleId`, `name` | `description`, `status` |
| `devplan_list_modules` | 列出所有功能模块（含任务数、文档数统计） | `projectName` | `status` |
| `devplan_get_module` | 获取模块详情（含关联的主任务、子任务、文档） | `projectName`, `moduleId` | — |
| `devplan_update_module` | 更新模块信息 | `projectName`, `moduleId` | `name`, `description`, `status` |

模块状态（`status`）可选值：`planning`, `active`, `completed`, `deprecated`

### 4.6 文档搜索（2 个）

| 工具名 | 说明 | 必需参数 | 可选参数 |
|--------|------|---------|---------|
| `devplan_search_sections` | 搜索文档片段（支持按 ID / 标题 / 内容字段控制，以及字面/语义/混合三种模式） | `projectName`, `query` | `searchBy`, `mode`, `limit`, `minScore` |
| `devplan_rebuild_index` | 重建所有文档的向量 Embedding 索引 | `projectName` | — |

**`devplan_search_sections` — 三种搜索模式：**

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| `literal` | 纯字面匹配（标题/内容包含查询词） | 精确关键词搜索 |
| `semantic` | 纯语义向量搜索（embed(query) → 向量近邻） | 概念性搜索（如搜"安全"可匹配"权限控制"） |
| `hybrid`（默认） | 字面 + 语义 RRF 融合排序 | 推荐的日常搜索模式 |

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | string | (必需) | 搜索查询文本 |
| `searchBy` | `"auto"` \| `"id"` \| `"title"` \| `"content"` | `"auto"` | 搜索字段控制；推荐优先显式指定字段 |
| `mode` | `"literal"` \| `"semantic"` \| `"hybrid"` | `"hybrid"` | 搜索模式；仅在 `searchBy="auto"` 时生效 |
| `limit` | number | 10 | 最大返回结果数 |
| `minScore` | number | 0 | 最低相关性评分阈值（0~1） |

**字段搜索建议：**

- UUID 形态查询优先使用 `searchBy: "id"`
- 标题检索优先使用 `searchBy: "title"`
- 正文片段或术语检索优先使用 `searchBy: "content"`
- 无法确定字段时再使用 `searchBy: "auto"`，并按需要配合 `mode`

**语义搜索前置条件**：需要 graph 引擎 + `.devplan/config.json` 中启用 `enableSemanticSearch: true`。VibeSynapse（Candle MiniLM-L6-v2，384 维）自动初始化。语义搜索不可用时，`semantic`/`hybrid` 模式自动降级为 `literal`。

**返回值**包含 `score` 字段（0~1 相关性评分），`literal` 模式不提供评分。

**`devplan_rebuild_index`** 重建所有文档的向量 Embedding 索引。适用于：首次启用语义搜索、切换 Embedding 模型、修复损坏的索引。返回 `{ total, indexed, failed, durationMs }` 统计信息。

### 4.7 高级功能（5 个）

| 工具名 | 说明 | 必需参数 | 可选参数 |
|--------|------|---------|---------|
| `devplan_sync_git` | 同步 Git 历史与任务状态（检测回滚自动回退） | `projectName` | `dryRun` |
| `devplan_export_graph` | 导出图结构用于可视化（仅 graph 引擎） | `projectName` | `includeDocuments`, `includeModules` |
| `devplan_migrate_engine` | 在 document ↔ graph 引擎之间迁移数据 | `projectName`, `targetEngine` | `backup`, `dryRun` |
| `devplan_start_visual` | 启动项目图谱 HTTP 服务器（后台运行） | `projectName` | `port`（默认 3210） |

**`devplan_start_visual`** 会在后台启动一个轻量 HTTP 服务器，自动打开浏览器展示交互式项目图谱页面。仅支持使用 graph 引擎的项目。

---

## 5. 核心接口 (IDevPlanStore)

`IDevPlanStore` 定义了 DevPlan 的全部存储操作接口（30+ 方法），供两个引擎实现共用：
- `DevPlanDocumentStore` — 基于 `EnhancedDocumentStore`（JSONL 持久化）
- `DevPlanGraphStore` — 基于 `SocialGraphV2`（图结构存储 + 可视化）

### 5.1 文档操作（6 + 5 个方法）

| 方法 | 说明 |
|------|------|
| `saveSection(input)` | 保存文档片段（已存在则覆盖，启用语义搜索时自动索引，支持 `parentDoc` 建立文档层级） |
| `getSection(section, subSection?)` | 获取文档片段（返回含 `parentDoc` 和 `childDocs` 字段） |
| `listSections()` | 列出项目的所有文档片段（去重后，含 `parentDoc` 字段） |
| `updateSection(section, content, subSection?)` | 更新文档片段内容 |
| `searchSections(query, limit?)` | 搜索文档片段（基础版，启用语义搜索时自动使用 hybrid 模式） |
| `deleteSection(section, subSection?)` | 删除文档片段（同时清理向量索引和文档层级关系） |
| `getChildDocs?(section, subSection?)` | 获取文档的直接子文档列表（可选方法） |
| `getDocTree?(section, subSection?)` | 获取文档树（递归含所有后代，仅 Graph 引擎支持，可选方法） |
| `searchSectionsAdvanced?(query, options?)` | 高级搜索：支持 literal/semantic/hybrid 三种模式，返回带评分结果（可选方法） |
| `rebuildIndex?()` | 重建所有文档的向量 Embedding 索引（可选方法） |
| `isSemanticSearchEnabled?()` | 检查语义搜索是否可用（可选方法） |

### 5.2 主任务操作（5 个方法）

| 方法 | 说明 |
|------|------|
| `createMainTask(input)` | 创建主任务 |
| `upsertMainTask(input, options?)` | 幂等导入主任务（Upsert） |
| `getMainTask(taskId)` | 获取主任务 |
| `listMainTasks(filter?)` | 列出主任务（可按 status/priority/moduleId 过滤） |
| `updateMainTaskStatus(taskId, status)` | 更新主任务状态 |

### 5.3 子任务操作（5 个方法）

| 方法 | 说明 |
|------|------|
| `addSubTask(input)` | 添加子任务 |
| `upsertSubTask(input, options?)` | 幂等导入子任务（Upsert） |
| `getSubTask(taskId)` | 获取子任务 |
| `listSubTasks(parentTaskId, filter?)` | 列出某主任务下的所有子任务 |
| `updateSubTaskStatus(taskId, status, options?)` | 更新子任务状态 |

### 5.4 完成工作流（2 个方法）

| 方法 | 说明 |
|------|------|
| `completeSubTask(taskId)` | **核心自动化方法**：更新子任务状态 → 锚定 Git commit → 刷新主任务计数 → 全部完成时自动标记主任务 |
| `completeMainTask(taskId)` | 手动完成主任务（跳过子任务检查） |

### 5.5 进度与导出（3 个方法）

| 方法 | 说明 |
|------|------|
| `getProgress()` | 获取项目整体进度（返回 `ProjectProgress`） |
| `exportToMarkdown()` | 导出完整的 Markdown 文档 |
| `exportTaskSummary()` | 导出仅任务进度的简洁 Markdown |

### 5.6 模块操作（6 个方法）

| 方法 | 说明 |
|------|------|
| `createModule(input)` | 创建功能模块 |
| `getModule(moduleId)` | 获取功能模块（含自动计算的 taskCount/docCount） |
| `listModules(filter?)` | 列出所有功能模块 |
| `updateModule(moduleId, updates)` | 更新功能模块 |
| `deleteModule(moduleId)` | 删除功能模块 |
| `getModuleDetail(moduleId)` | 获取模块详情（含关联的任务和文档） |

### 5.7 工具方法（3 个方法）

| 方法 | 说明 |
|------|------|
| `sync()` | 将存储的更改刷到磁盘 |
| `getProjectName()` | 获取项目名称 |
| `syncWithGit(dryRun?)` | 同步检查已完成任务与 Git 历史的一致性 |

### 5.8 图导出（可选，1 个方法）

| 方法 | 说明 |
|------|------|
| `exportGraph?(options?)` | 导出图结构用于可视化（仅 `DevPlanGraphStore` 支持） |

返回 `{ nodes: DevPlanGraphNode[], edges: DevPlanGraphEdge[] }`，兼容 `vis-network`。

---

## 6. Git 集成

### 6.1 Commit 锚定

当通过 `completeSubTask(taskId)` 完成子任务时，系统自动：

1. 调用 `git rev-parse --short HEAD` 获取当前 commit 短 hash
2. 将 hash 写入子任务的 `completedAtCommit` 字段
3. 同时记录 `completedAt` 时间戳

这建立了**任务完成状态与代码版本的绑定关系**。

### 6.2 syncWithGit — Git 同步检查

`devplan_sync_git` 工具（或 `syncWithGit()` 方法）执行以下检查：

```
对每个 status=completed 且有 completedAtCommit 的子任务：
  1. 调用 git merge-base --is-ancestor {completedAtCommit} HEAD
  2. 如果该 commit 不是当前 HEAD 的祖先 → 说明代码已回滚
  3. 自动回退任务状态为 pending
  4. 记录 revertReason: "Commit xxx not found in current branch"
```

### 6.3 dryRun 模式

| `dryRun` 值 | 行为 |
|-------------|------|
| `true` | 只返回"哪些任务会被回退"的列表，**不实际修改数据** |
| `false`（默认） | 实际执行回退操作 |

建议：首次使用时先用 `dryRun: true` 检查影响范围。

### 6.4 Git 命令依赖

| 命令 | 用途 | 失败处理 |
|------|------|---------|
| `git rev-parse --short HEAD` | 获取当前 commit 短 hash | 返回 undefined，任务正常完成但不锚定 |
| `git merge-base --is-ancestor A B` | 检查 A 是否是 B 的祖先 | 返回 false（视为需要回退） |

### 6.5 向后兼容

- 已有的子任务数据没有 `completedAtCommit` 字段 → `syncWithGit()` 跳过这些任务
- 非 Git 仓库中 `getCurrentGitCommit()` 返回 undefined → 任务照常完成，只是不锚定

---

## 7. 可视化服务

### 7.1 架构概述

可视化服务是一个轻量级 HTTP 服务器，使用 Node.js 内置 `http` 模块，**无需 Express/React 等框架**，保持项目零额外依赖。

```
CLI: aifastdb-devplan-visual --project <name> [--port <port>] [--base-path <path>]
MCP: devplan_start_visual (projectName, port?)
  ↓
HTTP Server (Node.js http 模块)
  ├── GET  /                       → 自包含 HTML 页面（vis-network CDN + 内联 JS/CSS）
  ├── GET  /api/graph              → DevPlanGraphStore.exportGraph() → JSON
  ├── GET  /api/progress           → getProgress() → JSON
  ├── GET  /api/stats              → 详细统计数据 → JSON
  ├── GET  /api/doc                → 文档内容查询 → JSON
  ├── GET  /api/docs               → 文档列表（含层级信息） → JSON
  ├── GET  /api/auto/next-action   → Autopilot 下一步动作建议 → JSON (规划中)
  ├── GET  /api/auto/current-phase → 当前阶段详情 → JSON (规划中)
  ├── POST /api/auto/complete-task → 标记子任务完成 → JSON (规划中)
  ├── POST /api/auto/start-phase   → 启动新阶段 → JSON (规划中)
  ├── POST /api/auto/heartbeat     → executor 心跳上报 → JSON (规划中)
  └── GET  /favicon.ico            → 204 No Content
```

**核心设计决策**：每次 API 请求都创建新的 store 实例（`createFreshStore`），确保读取磁盘上最新的 WAL 数据。因为 MCP 工具在另一个进程中更新任务状态，复用启动时的 store 实例会导致数据过时。

### 7.2 API 端点

| 端点 | 方法 | 响应类型 | 说明 |
|------|------|---------|------|
| `/` | GET | text/html | 自包含可视化 HTML 页面 |
| `/api/graph` | GET | application/json | 图谱数据 `{ nodes, edges }`，支持 `?includeDocuments=false` 和 `?includeModules=false` 过滤 |
| `/api/progress` | GET | application/json | 项目进度统计（`ProjectProgress` 结构） |
| `/api/stats` | GET | application/json | 详细统计数据（含按优先级统计、按状态分组的阶段列表、各阶段子任务详情、模块统计、文档分布） |
| `/api/doc` | GET | application/json | 文档内容查询，参数 `?section=xxx&subSection=yyy` |
| `/api/docs` | GET | application/json | 文档列表（不含内容），返回 `{ docs: [...] }`，含 `parentDoc`/`childDocs` 层级信息 |
| `/favicon.ico` | GET | 204 | 避免浏览器 404 |
| `/api/auto/next-action` | GET | application/json | **(规划中)** Autopilot 下一步动作建议，详见 [第 13.4.2 节](#1342-可视化服务器新增-api-端点5-个) |
| `/api/auto/current-phase` | GET | application/json | **(规划中)** 当前进行中阶段及子任务状态 |
| `/api/auto/complete-task` | POST | application/json | **(规划中)** executor 回报子任务完成 |
| `/api/auto/start-phase` | POST | application/json | **(规划中)** executor 请求启动新阶段 |
| `/api/auto/heartbeat` | POST | application/json | **(规划中)** executor 心跳上报 |

**`/api/stats` 返回结构**（在 `/api/progress` 基础上扩展）：

```typescript
{
  // --- 继承自 ProjectProgress ---
  projectName, sectionCount, mainTaskCount, completedMainTasks,
  subTaskCount, completedSubTasks, overallPercent, tasks,
  // --- 扩展字段 ---
  docCount: number,               // 文档总数
  moduleCount: number,            // 模块总数
  byPriority: {                   // 按优先级统计
    P0: { total, completed },
    P1: { total, completed },
    P2: { total, completed },
  },
  mainTaskByStatus: {             // 主任务按状态统计
    completed: number,
    in_progress: number,
    pending: number,
  },
  completedPhases: [{             // 已完成的阶段（含子任务详情）
    taskId, title, total, completed, percent, completedAt,
    subTasks: [{ taskId, title, status, completedAt }]
  }],
  inProgressPhases: [...],        // 进行中的阶段（结构同上）
  pendingPhases: [...],           // 待开始的阶段（结构同上）
  moduleStats: [{                 // 模块统计
    moduleId, name, status, mainTaskCount, subTaskCount, completedSubTaskCount
  }],
  docBySection: {                 // 文档按类型分布
    overview: 1, api_design: 2, ...
  },
}
```

### 7.3 项目图谱页面

基于 **vis-network** 库的交互式图谱，通过 CDN 加载（依次尝试 unpkg → jsdelivr → cdnjs 三个源容错）。

#### 7.3.1 节点类型（5 种）

| 类型 | 形状 | 颜色 | 大小范围 | 说明 |
|------|------|------|----------|------|
| `project` | 星形 (star) | 金色 `#f59e0b` | 35 ~ 65 | 项目根节点，居中 |
| `module` | 菱形 (diamond) | 绿色 `#059669` | 20 ~ 45 | 功能模块 |
| `main-task` | 圆形 (dot) | 按状态着色 | 14 ~ 38 | 主任务/开发阶段 |
| `sub-task` | 小圆点 (dot) | 按状态着色 | 7 ~ 18 | 子任务/具体工作项 |
| `document` | 方形 (box) | 紫色 `#7c3aed` | 12 ~ 30 | 文档片段 |

**节点动态大小规则：**

节点大小根据连接数（度数）动态调整，连接越多的节点越大，帮助用户直观识别核心节点：

- **度数** = 该节点的入边 + 出边总数
- **缩放公式**：`size = min + scale × √degree`，使用平方根曲线，低度数时增长快、高度数时增长趋缓
- **字号联动**：节点标签字号随尺寸等比例缩放（`baseFont` ~ `maxFont`）
- 每种节点类型有独立的 `min/max/scale` 参数，保持类型间的视觉层级
- 鼠标悬停时 tooltip 会显示节点名称和连接数

**任务状态颜色映射：**

| 状态 | 颜色 | 含义 |
|------|------|------|
| `completed` | 绿色 `#059669` | 已完成 |
| `in_progress` | 蓝色 `#2563eb` | 进行中（主任务带呼吸灯脉冲动画） |
| `pending` | 灰色 `#4b5563` | 待开始 |
| `cancelled` | 棕色 `#92400e` | 已取消 |

#### 7.3.2 边类型（5 种）

| 类型 | 样式 | 颜色 | 说明 |
|------|------|------|------|
| `has_main_task` | 实线 + 箭头 | 灰色 | 项目 → 主任务 |
| `has_sub_task` | 细实线 + 箭头 | 深灰 | 主任务 → 子任务 |
| `has_document` | 虚线 + 箭头 | 深灰 | 项目 → 文档 |
| `module_has_task` | 点线 + 箭头 | 绿色 | 模块 → 主任务 |
| `task_has_doc` | 虚线 + 箭头 | 琥珀色 `#b45309` | 主任务 → 文档（双向关联） |

#### 7.3.3 交互功能

| 功能 | 说明 |
|------|------|
| **节点详情面板** | 点击节点弹出右侧详情面板，显示状态、优先级、子任务完成率、完成时间、关联文档/关联任务等 |
| **面板导航路由** | 面板内点击「关联文档」或「关联任务」可跳转到对应节点详情，标题栏左侧显示返回箭头按钮，支持多级深度导航逐级回退；直接点击图谱节点或关闭面板时清空历史栈 |
| **面板可调节** | 拖拽详情面板左边缘可调节宽度，双击面板标题栏可展开/折叠至双倍宽度 |
| **节点类型筛选** | 页面底部复选框筛选，按类型（模块/主任务/子任务/文档）显示/隐藏 |
| **Ctrl+拖拽** | 按住 Ctrl 拖拽节点可同时移动其连接的节点 |
| **文档内容查看** | 点击文档节点可查看完整的 Markdown 内容（带基础渲染） |
| **呼吸灯动画** | `in_progress` 状态的主任务节点带有 Canvas 脉冲光环效果：外圈蓝色描边环周期性扩张/收缩并渐隐，内圈径向渐变柔光随节奏明灭；通过 `requestAnimationFrame` + `afterDrawing` 事件驱动，无 in_progress 节点时自动停止以节省性能 |
| **物理引擎** | forceAtlas2Based 力导向布局，稳定化后自动关闭 |
| **呼吸灯动画** | 状态为 `in_progress` 的主任务节点带有脉冲呼吸光环效果（外圈蓝色脉冲环 + 内圈径向辉光），通过 Canvas `afterDrawing` 事件 + `requestAnimationFrame` 实现平滑动画，无进行中任务时自动停止以节省性能 |
| **状态栏** | 顶部透明状态栏显示模块数、主任务数、子任务数、**文档数**、完成率进度条；所有统计项均可点击打开对应的列表弹层 |
| **文档列表弹层** | 点击顶部状态栏「文档」数字，在左侧弹出文档列表面板（与模块/任务弹层复用同一 UI 框架）；文档按层级结构展示（支持 `parentDoc` 父子关系），主文档左侧显示展开/折叠按钮（`+`/`−`），点击可展开显示子文档；点击文档标题直接聚焦到图谱中对应的文档节点并打开右侧详情面板（复用已有的节点详情面板，避免重复弹层） |
| **图例** | 页面底部显示节点类型和边类型的图例，与筛选控件合并 |

#### 7.3.4 手动刷新

提供两种方式获取最新任务状态数据（已移除 15 秒自动轮询，改为按需手动刷新）：

| 刷新方式 | 操作 | 效果 |
|----------|------|------|
| **刷新按钮** | 点击底部筛选栏左侧的刷新图标 | 增量刷新：保持当前布局和缩放，仅更新节点颜色、大小、呼吸灯状态；按钮显示旋转动画反馈 |
| **浏览器 F5** | 按 F5 或浏览器刷新按钮 | 完整重载：重新获取所有数据并重建图谱（服务端响应头已设置 `Cache-Control: no-cache` 确保不使用缓存） |

**实现细节：**

- 点击刷新按钮调用 `manualRefresh()` → `silentRefresh(onDone)`，复用增量更新逻辑（`updateNodeStyles()`），不重建图谱布局
- 刷新期间按钮图标带旋转动画（`spin-refresh`），防止重复点击
- `silentRefresh()` 通过比较节点状态快照检测变化，仅在有变化时更新，无变化时仅输出日志

### 7.4 统计仪表盘页面

提供项目的全方位统计视图，数据来自 `/api/stats` 端点。

| 区域 | 内容 |
|------|------|
| **总进度环** | 大型 SVG 环形进度条，展示总体完成百分比 |
| **概览卡片** | 主任务数、已完成子任务/总子任务、文档数、模块数、剩余任务数 |
| **优先级统计** | P0/P1/P2 各自的进度条和完成数/总数 |
| **进行中阶段** | 展开式列表，每个主任务可展开显示其子任务（含状态图标）和关联文档 |
| **已完成里程碑** | 展开式列表，显示主任务和子任务的完成时间戳及关联文档 |
| **待开始任务** | 展开式列表，显示待开发的主任务及其子任务和关联文档 |
| **模块概览** | 卡片网格，每个模块显示名称、状态和子任务进度条 |
| **文档分布** | 按 section 类型分组的文档数量统计 |

**完成时间格式**：当年内显示 `MM-DD HH:mm`，超过当年显示 `YYYY-MM-DD HH:mm`。

### 7.5 侧边栏导航

左侧可折叠侧边栏，支持两种模式：

| 模式 | 宽度 | 显示内容 |
|------|------|---------|
| 折叠 | 48px | 仅图标 + 品牌缩写 "Ai" |
| 展开 | 200px | 图标 + 文字 + 品牌全称 "AiFastDb-DevPlan" |

**导航菜单项：**

| 图标 | 名称 | 状态 | 说明 |
|------|------|------|------|
| 🔗 | 项目图谱 | 可用 | 项目图谱页面 |
| 📋 | 任务看板 | 即将推出 | 占位 |
| 📄 | 文档浏览 | 即将推出 | 占位 |
| 📊 | 统计仪表盘 | 可用 | 仪表盘页面 |
| ⚙️ | 项目设置 | 即将推出 | 占位 |

侧边栏状态通过 `localStorage` 持久化，刷新页面后保持折叠/展开状态。

品牌 Logo 使用 CSS 渐变文字效果（`background-clip: text`），从蓝色到紫色的渐变，与 `aidb-viewer` 首页标题风格一致。

### 7.6 暗色主题

全局使用暗色主题，背景色 `#111827`，与 `aifastdb_admin` 风格一致。所有页面（图谱、仪表盘、侧边栏）共享统一的暗色调色板。

---

## 8. 使用方式

### 8.1 作为 MCP Server 使用（推荐）

在 Cursor IDE 或 Claude Desktop 中配置 MCP Server：

```json
// .cursor/mcp.json 或 claude_desktop_config.json
{
  "mcpServers": {
    "aifastdb-devplan": {
      "command": "npx",
      "args": ["aifastdb-devplan"]
    }
  }
}
```

配置后即可在 AI 对话中使用全部 23 个 `devplan_*` 工具。

### 8.2 作为 npm 包编程使用

```typescript
import { createDevPlan } from 'aifastdb-devplan';

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

// 完成任务（自动锚定 Git commit、刷新主任务计数）
plan.completeSubTask('T1.1');

// 查看进度
const progress = plan.getProgress();
console.log(`完成率: ${progress.overallPercent}%`);
```

### 8.3 CLI 命令

项目提供两个 bin 入口：

#### 8.3.1 MCP Server

```bash
aifastdb-devplan
# 通过 stdio 提供 MCP 协议服务，通常由 Cursor/Claude Desktop 自动启动
```

#### 8.3.2 可视化服务器

```bash
aifastdb-devplan-visual --project <项目名称> [--port <端口>] [--base-path <路径>]
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--project` | string | (必需) | 项目名称 |
| `--port` | number | 3210 | HTTP 监听端口 |
| `--base-path` | string | 自动解析 | DevPlan 数据存储路径 |

示例：

```bash
# 通过 npm script
npm run visualize -- --project ai_db --base-path D:/Project/git/ai_db/.devplan

# 通过 bin 入口
aifastdb-devplan-visual --project ai_db --port 3212
```

### 8.4 npm 包导出

`aifastdb-devplan` npm 包导出以下公共 API：

```typescript
export {
  // 工厂函数
  createDevPlan, listDevPlans, getProjectEngine,
  // 接口
  IDevPlanStore,
  // 实现类
  DevPlanDocumentStore, DevPlanGraphStore,
  // 迁移
  migrateEngine,
  // 类型
  DevPlanEngine, DevPlanSection, TaskStatus, TaskPriority, ModuleStatus,
  DevPlanDocInput, DevPlanDoc, DevPlanDocTree,
  MainTaskInput, MainTask, SubTaskInput, SubTask,
  CompleteSubTaskResult, SyncGitResult, RevertedTask,
  ModuleInput, Module, ModuleDetail,
  MainTaskProgress, ProjectProgress,
  DevPlanStoreConfig, DevPlanGraphStoreConfig,
  DevPlanGraphNode, DevPlanGraphEdge, DevPlanExportedGraph,
  // 搜索相关类型
  SearchMode, ScoredDevPlanDoc, RebuildIndexResult,
  // 常量
  ALL_SECTIONS, SECTION_DESCRIPTIONS,
};
```

---

## 9. 数据兼容性与存储

### 9.1 存储路径解析

路径解析优先级（从高到低）：

| 优先级 | 路径来源 | 说明 |
|--------|---------|------|
| 1 | `AIFASTDB_DEVPLAN_PATH` 环境变量 | 显式指定 |
| 2 | 项目内 `.devplan/` 目录 | 通过查找 `.git` / `package.json` 定位项目根目录 |
| 3 | `~/.aifastdb/dev-plans/` | 兜底路径 |

### 9.2 数据目录结构

```
.devplan/{projectName}/
├── engine.json                 # 引擎配置
├── documents.jsonl             # 文档片段（document 引擎）
├── tasks.jsonl                 # 主任务 + 子任务（document 引擎）
├── modules.jsonl               # 功能模块（document 引擎）
└── graph-data/                 # 图数据目录（graph 引擎）
    ├── wal.jsonl               # Write-Ahead Log
    └── shard_*.jsonl           # 分片数据文件
```

两种引擎的数据文件互不干扰，迁移后旧数据保留（可选备份）。

### 9.3 Append-Only JSONL 时间戳策略（Document 引擎）

Document 引擎底层使用 `EnhancedDocumentStore`（JSONL 格式），其关键特性是 **append-only**：

- **写入**：`put()` 在 JSONL 文件末尾追加一条新记录
- **删除**：`delete()` 在内存中标记删除，但 JSONL 文件中的旧记录**仍然保留**
- **重新加载**：所有历史版本都会被加载到内存

因此系统使用 **三个私有方法** 协作保障数据一致性：

| 方法 | 作用 |
|------|------|
| `getDocUpdatedAt(doc)` | 统一读取文档时间戳（优先取 `metadata.updatedAt`） |
| `ensureTimestampAfter(refTimestamp)` | 自旋等待直到 `Date.now()` 严格大于参考时间戳 |
| `deleteAndEnsureTimestampAdvance(store, id)` | 删除旧版本 + 等待时间戳递增（组合操作） |

**写入时**（更新操作）：

```
1. 获取当前版本
2. deleteAndEnsureTimestampAdvance → 删除旧版本 + 自旋等待
3. put(新版本, updatedAt: Date.now()) → 新版本的 updatedAt 一定严格大于旧版本
```

**读取时**（去重策略）：

```
单个实体: findByTag → 按 updatedAt 降序排序 → 取第一个（最新版本）
列表读取: Map<entityId, doc> → 遍历时只保留 updatedAt 更大的版本
```

### 9.4 向后兼容性

- JSONL 文件格式不变，已有数据可直接被新版本读取
- 旧数据无 `completedAtCommit` 字段 → `syncWithGit()` 跳过
- 旧数据无 `moduleId` 字段 → 不影响任何现有操作
- MCP 工具名称完全不变 → 用户无需修改任何工具调用

---

## 10. 技术细节

### 10.1 依赖关系图

```
ai_db (aifastdb npm 包)                          ← 不受 devplan 影响，无需修改
├── packages/node/ts/document-store.ts           ← 导出 EnhancedDocumentStore
├── packages/node/ts/social-graph-v2.ts          ← 导出 SocialGraphV2
├── packages/node/ts/social-types.ts             ← 导出 Entity, Relation 类型
├── packages/node/ts/index.ts                    ← 统一导出入口
└── packages/node/ts/mcp-server/index.ts         ← 8 个 Legacy 工具（独立运行）

aifastdb-devplan (独立项目，依赖 aifastdb npm 包)
├── [TypeScript] src/
│   ├── src/dev-plan-document-store.ts           ← import { EnhancedDocumentStore } from 'aifastdb'
│   ├── src/dev-plan-graph-store.ts              ← import { SocialGraphV2, VibeSynapse } from 'aifastdb'
│   ├── src/dev-plan-factory.ts                  ← 根据 engine.json 选择上述两个实现之一
│   ├── src/dev-plan-migrate.ts                  ← 数据迁移工具（document ↔ graph）
│   ├── src/visualize/template.ts                ← 项目图谱 HTML 模板（vis-network）
│   ├── src/visualize/server.ts                  ← 轻量 HTTP 可视化服务器 + /api/auto/* 端点 (规划中)
│   └── src/mcp-server/index.ts                  ← 23 + 3 个 devplan_* 工具 (3 个 autopilot 规划中)
│
└── [Python] executor/ (规划中，从 cursor_auto 重构迁入)
    ├── executor/src/devplan_client.py            ← HTTP 客户端，调用 /api/auto/* 端点
    ├── executor/src/engine.py                    ← 双通道决策引擎（DevPlan 状态 + UI 截图）
    ├── executor/src/cursor_controller.py         ← GUI 自动化（pyautogui）
    └── executor/src/vision_analyzer.py           ← 视觉分析（Ollama，精简后）
```

**通信关系**：

```
Cursor IDE 中的 AI
  ├→ [MCP stdio] aifastdb-devplan MCP Server (23+3 个工具)
  │     └→ devplan_complete_task() 更新任务状态
  │
  └→ [GUI 操作] cursor_controller.py 模拟键鼠操作

executor (Python 进程)
  ├→ [HTTP] GET/POST /api/auto/*  →  aifastdb-devplan-visual (Node.js HTTP 服务器)
  ├→ [截图] pyautogui.screenshot()  →  vision_analyzer.py → Ollama
  └→ [GUI] cursor_controller.py → pyautogui → Cursor IDE 窗口
```

`ai_db` 中保留的 8 个 Legacy 工具（`save_document`, `get_document`, `list_documents`, `search_documents`, `list_tasks`, `generate_task_id`, `save_architecture`, `get_architecture`）与 DevPlan 完全隔离：
- 独立存储引擎，数据路径为 `~/.aifastdb/cursor-planning/`
- 零 import 引用 `aifastdb-devplan`
- 工具名无交叉（Legacy 使用通用名，DevPlan 统一使用 `devplan_` 前缀）

### 10.2 SocialGraphV2 API 使用

`DevPlanGraphStore` 调用的 SocialGraphV2 API 方法（共 16 个）：

| 方法 | 用途 |
|------|------|
| `addEntity` | 创建实体（项目/任务/文档/模块） |
| `getEntity` | 获取单个实体 |
| `updateEntity` | 更新实体属性 |
| `deleteEntity` | 删除实体 |
| `putRelation` | 创建关系（父子、模块关联等） |
| `deleteRelation` | 删除关系 |
| `listEntitiesByType` | 按类型列出实体 |
| `listRelations` | 列出某实体的关系 |
| `getRelationBetween` | 获取两实体间的关系 |
| `exportGraph` | 导出完整图结构 |
| `indexEntity` | 将 Embedding 向量索引到 HNSW（语义搜索） |
| `searchEntitiesByVector` | 向量近邻搜索（语义搜索） |
| `removeEntityVector` | 删除文档对应的向量索引（文档删除时） |
| `flush` | 刷盘 |
| `recover` | 恢复（WAL 重放，含向量 WAL） |
| 构造函数 | 初始化分片存储（含 HNSW 向量索引配置） |

### 10.3 三层信息架构

DevPlan 设计了三层互补的信息架构，解决大型项目文档的 AI 可读性问题：

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1: overview 概览文档 (鸟瞰)                                │
│ • < 500 行，AI 一次读完                                         │
│ • "知道项目有什么、在哪里、大概怎样"                              │
│ • 通过 devplan_get_section(section: 'overview') 获取             │
└───────────────────────────┬──────────────────────────────────────┘
                            │ 深入 → 按 section 读取
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ Layer 2: DevPlan 文档片段 (详细)                                 │
│ • 按 section 类型拆分存储，按需加载                               │
│ • "知道具体怎么做、为什么这样做"                                  │
│ • 通过 devplan_get_section / devplan_list_sections 获取          │
└───────────────────────────┬──────────────────────────────────────┘
                            │ 实时查询 → MCP 工具
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ Layer 3: 任务与进度 (实时)                                       │
│ • 任务状态、进度百分比、完成时间、Git commit 锚定                 │
│ • "知道现在做到哪里了"                                           │
│ • 通过 devplan_get_progress / devplan_list_tasks 获取            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 11. 版本历史

### v1.0.0 — 独立项目拆分 (2026-02-08)

- 从 `ai_db` 项目中将 DevPlan 拆分为独立的 `aifastdb-devplan` 项目
- 核心逻辑迁移（仅改 3 行 import），2268 行代码零逻辑改动
- 16 个 MCP 工具：文档管理(4) + 任务管理(5) + 进度导出(2) + 模块管理(4) + Git 同步(1)
- `ai_db` 侧清理：删除 `dev-plan-store.ts`，MCP Server 从 1607 行精简至 583 行
- 发布 `aifastdb-devplan@1.0.0` npm 包

**拆分前的功能积累**（在 `ai_db` 内完成）：
- Git Commit 锚定 + `devplan_sync_git` 工具
- 跨主任务子任务查询（`devplan_list_tasks` 增强）
- 功能模块注册表（Module Registry）— 4 个新 MCP 工具
- Append-Only JSONL 时间戳策略

### v2.0.0 — 双引擎架构 (2026-02-09)

- 新增 `DevPlanGraphStore`（基于 `SocialGraphV2`）作为第二种存储引擎
- 抽取 `IDevPlanStore` 接口（30+ 方法），两个实现共用
- 提取 `types.ts` 类型定义文件（463 行）
- 新增 `dev-plan-factory.ts` 工厂函数 + `engine.json` 引擎选择机制
- 新增 `devplan_export_graph` MCP 工具
- MCP 工具从 16 个增加到 17 个

### v2.1.0 — 数据迁移工具 (2026-02-09)

- 新增 `dev-plan-migrate.ts` 迁移模块
- 新增 `devplan_migrate_engine` MCP 工具
- 支持 `document` ↔ `graph` 双向迁移
- 迁移前自动备份 + dryRun 预览模式
- MCP 工具从 17 个增加到 18 个

### v3.0.0 — 项目图谱服务 (2026-02-09)

- 新增 `src/visualize/` 目录（`template.ts` + `server.ts`）
- 轻量 HTTP 服务器（Node.js 内置 `http` 模块，无额外依赖）
- vis-network 交互式图谱（5 种节点 + 4 种边 + 力导向布局）
- 节点详情面板 + 统计栏 + 类型筛选 + 暗色主题
- 新增 `aifastdb-devplan-visual` CLI 命令
- 新增 `devplan_start_visual` MCP 工具
- MCP 工具从 18 个增加到 20 个（含 `devplan_sync_git` 从 ai_db 迁移后重新计数）

### v3.x — 可视化增强 (2026-02-09)

- **统计仪表盘页面**：总进度环、概览卡片、优先级统计、可展开里程碑（含子任务详情）、模块统计、文档分布
- **侧边栏导航**：可折叠侧边栏（48px/200px）、5 个菜单项、localStorage 持久化、品牌 Logo 渐变文字
- **新增 API 端点**：`/api/stats`（详细统计数据）、`/api/doc`（文档内容查询）、`/api/docs`（文档列表，含层级信息）
- **每次 API 请求创建新 store 实例**：确保跨进程数据实时同步
- **完成时间戳显示**：里程碑和图谱详情面板中显示主任务/子任务的完成时间
- **智能日期格式**：当年内省略年份（`MM-DD HH:mm`），跨年显示完整日期
- **UI 改进**：
  - 详情面板可拖拽调整宽度 + 双击标题栏展开/折叠
  - 筛选控件从顶部移至底部，与图例合并
  - 按钮筛选改为复选框筛选
  - 顶部状态栏改为透明背景
  - 15 秒静默自动刷新（不影响图谱布局）
  - CDN 三源容错（unpkg → jsdelivr → cdnjs）

### v3.x — 文档-任务双向关联 (2026-02-09)

- **新增关系类型 `task_has_doc`**：主任务与文档之间的双向关联
- **数据模型扩展**：
  - `DevPlanDoc` 新增 `relatedTaskIds` 字段（关联的主任务 ID 列表）
  - `MainTask` 新增 `relatedSections` 字段（关联的文档片段标识列表）
- **MCP 工具参数扩展**：
  - `devplan_save_section` 新增可选参数 `relatedTaskIds`（关联主任务）
  - `devplan_create_main_task` 新增可选参数 `relatedDocSections`（关联文档片段）
  - `devplan_upsert_task` 新增可选参数 `relatedDocSections`（关联文档片段）
- **Graph 引擎**：通过 `task_has_doc` 关系类型物理存储双向关联，支持 `getTaskRelatedDocs()` / `getDocRelatedTasks()` 查询
- **Document 引擎**：通过 `metadata.relatedTaskIds` 和 `data.relatedSections` 字段维护关联
- **可视化增强**：
  - 图谱中新增琥珀色虚线边表示任务-文档关联
  - 主任务详情面板显示「关联文档」列表（可点击跳转）
  - 文档详情面板显示「关联任务」列表（可点击跳转）
  - 统计仪表盘中主任务展开区显示关联文档
  - 底部图例新增「任务-文档」边类型
  - **节点动态大小**：根据连接数（度数）动态调整节点尺寸和字号，连接越多节点越大，核心枢纽节点一目了然；使用 `√degree` 平方根曲线平滑缩放，每种节点类型有独立的 min/max/scale 参数

### 阶段二十二验证记录（T22.7）

- **验证时间**：2026-02-10
- **Rust 功能测试**：
  - `cargo test -p aifastdb-core test_export_graph_node_degree_default_enabled -- --nocapture`
  - `cargo test -p aifastdb-core test_export_graph_node_degree_can_be_disabled -- --nocapture`
  - 结果：2 项测试均通过，验证默认下发 `node.degree`，并支持 `include_node_degree: false` 关闭透传
- **15s 刷新路径性能回归（微基准）**：
  - 300 nodes / 900 edges / 1500 rounds：53.16ms -> 2.32ms（95.64% 下降）
  - 800 nodes / 2400 edges / 1000 rounds：90.82ms -> 2.58ms（97.16% 下降）
  - 2000 nodes / 7000 edges / 400 rounds：115.14ms -> 1.26ms（98.91% 下降）
- **结论**：阶段二十二 `T22.7` 已完成，15 秒静默刷新场景中前端重复遍历开销显著下降

### v3.x — 面板导航路由 + 呼吸灯动画 (2026-02-10)

- **面板导航路由（返回按钮）**：
  - 新增 `panelHistory` 导航历史栈，追踪面板浏览轨迹
  - 面板内点击「关联文档」或「关联任务」链接时，当前节点 ID 压栈，跳转到目标节点详情
  - 标题栏左侧新增返回箭头按钮（SVG 图标），有历史时自动显示，点击可逐级回退
  - 支持多级深度导航（如：主任务 → 文档 → 关联任务 → 返回文档 → 返回主任务）
  - 直接点击图谱节点时清空历史栈，重新开始导航；关闭面板时同步清空
  - 新增函数：`navigateToPanel()`、`panelGoBack()`、`updateBackButton()`
  - 新增 CSS：`.panel-back`（返回按钮样式）、`.panel-header-left`（标题栏左侧布局）

- **呼吸灯动画（in_progress 主任务）**：
  - `in_progress` 状态的主任务节点在图谱 Canvas 上显示脉冲光环动画
  - **外圈脉冲光环**：蓝色描边环从节点向外扩张再收缩，透明度随扩张递减，营造呼吸感
  - **内圈柔光**：径向渐变在节点周围形成柔和辉光，大小和亮度随呼吸周期变化
  - 动画引擎：`requestAnimationFrame` 驱动 + vis-network `afterDrawing` 事件在 Canvas 上绘制
  - 动画相位通过 `Math.sin(breathPhase)` 产生 0→1→0 平滑循环，步进 0.03/帧
  - 性能优化：无 `in_progress` 主任务时自动调用 `stopBreathAnimation()` 停止动画循环
  - 增量更新兼容：静默刷新后自动检测，任务状态变化时动态启停呼吸灯
  - 新增函数：`startBreathAnimation()`、`stopBreathAnimation()`、`getInProgressMainTaskIds()`

### v3.x — 开发阶段自动执行 (2026-02-12)

- **新增 `devplan_start_phase` MCP 工具**：启动/恢复开发阶段的一站式入口
  - 自动将主任务标记为 `in_progress`（幂等操作：已是 in_progress/completed 则跳过）
  - 返回主任务信息 + 全部子任务列表（保留实际状态），输出格式适合直接创建 Cursor TodoList
  - 返回关联的文档片段标识列表，方便 AI 按需读取相关文档
- **AI 端自动执行开发任务工作流**：
  - 用户说出"开始/继续/恢复 phase-X 开发"时，AI 自动调用 `devplan_start_phase`
  - AI 将返回的子任务列表自动转为 Cursor TodoList（TodoWrite），保留已完成状态
  - AI 输出阶段进度摘要后，自动定位并开始执行第一个 pending 子任务
  - 每完成一个子任务，自动调用 `devplan_complete_task` 回写状态，然后继续下一个
  - 所有子任务完成后，系统自动标记主任务为 completed
- **Cursor Rules 配置更新**：在 `dev-plan-management.mdc` 中新增"启动/恢复开发阶段"章节，定义触发词和工作流
- MCP 工具从 20 个增加到 21 个

### v4.0.0 — 任务排序 + 语义搜索 (2026-02-13)

- **任务排序（`order` 字段）**：
  - `MainTaskInput`、`MainTask`、`SubTaskInput`、`SubTask` 类型均新增 `order?: number` 字段
  - MCP 工具 `devplan_create_main_task`、`devplan_add_sub_task`、`devplan_upsert_task` 新增 `order` 可选参数
  - 不指定 `order` 时自动分配（当前最大 order + 1），追加到列表末尾
  - `listMainTasks()` 和 `listSubTasks()` 返回结果按 `order` 升序排列（order 为空排最后，相同 order 按 `createdAt` 排序）
  - 排序逻辑在 Graph 引擎和 Document 引擎中均已实现（`sortByOrder()` + `getNextMainTaskOrder()` / `getNextSubTaskOrder()`）

- **文档语义搜索（VibeSynapse 集成）**：
  - 新增 MCP 工具 `devplan_search_sections`：支持 `literal`（字面匹配）、`semantic`（语义向量搜索）、`hybrid`（RRF 融合排序）三种搜索模式
  - 新增 MCP 工具 `devplan_rebuild_index`：重建所有文档的向量 Embedding 索引
  - 新增 `IDevPlanStore` 接口方法：`searchSectionsAdvanced()`、`rebuildIndex()`、`isSemanticSearchEnabled()`
  - 新增类型：`SearchMode`、`ScoredDevPlanDoc`（带评分的搜索结果）、`RebuildIndexResult`
  - **VibeSynapse Embedding 引擎**：使用 Candle MiniLM-L6-v2（384 维）离线生成 Embedding，零 API 依赖
  - **SocialGraphV2 向量索引**：配置 HNSW 索引（`vectorSearch` 配置），支持 `indexEntity()` / `searchEntitiesByVector()` / `removeEntityVector()`
  - **自动索引**：`saveSection()` 保存文档时自动调用 `autoIndexDocument()` 生成 Embedding 并索引
  - **RRF 融合算法**：`rrfFusion()` 将语义和字面搜索结果通过 Reciprocal Rank Fusion（k=60）融合排序
  - **优雅降级**：VibeSynapse 初始化失败时自动降级为纯字面搜索，不影响其他功能
  - **配置**：通过 `.devplan/config.json` 中的 `enableSemanticSearch: true` 启用
  - `DevPlanGraphStoreConfig` 新增 `enableSemanticSearch` 和 `embeddingDimension` 配置项

- MCP 工具从 21 个增加到 23 个

### v4.1.0 — 文档层级关系 (parentDoc) (2026-02-13)

- **文档层级关系（`parentDoc` 字段）**：
  - `DevPlanDocInput` 新增 `parentDoc?: string` 可选字段（格式："section" 或 "section|subSection"）
  - `DevPlanDoc` 新增 `parentDoc?: string` 和 `childDocs?: string[]` 字段（`childDocs` 为自动计算属性）
  - 新增 `DevPlanDocTree` 类型，支持递归文档树结构
  - MCP 工具 `devplan_save_section` 新增 `parentDoc` 可选参数
  - `devplan_get_section` 返回值自动包含 `parentDoc` 和 `childDocs`
  - `devplan_list_sections` 返回值自动包含 `parentDoc`

- **Graph 引擎实现**：
  - 新增关系类型 `doc_has_child`（parent doc → child doc），关系模型从 6 种扩展到 7 种
  - `saveSection()` 创建/更新时自动维护 `DOC_HAS_CHILD` 关系
  - `deleteSection()` 删除文档时自动断开父子关系，子文档的 `parentDoc` 属性清空
  - `exportGraph()` 导出 `doc_has_child` 边，可视化展示文档层级
  - 新增 `getChildDocs()` 方法：获取直接子文档列表
  - 新增 `getDocTree()` 方法：递归获取文档树
  - 新增 `updateParentDocRelation()` 私有方法：更新文档父子关系

- **Document 引擎实现**：
  - `saveSection()` 在 `metadata` 中存储 `parentDoc` 字段
  - `docToDevPlanDoc()` 从 `metadata.parentDoc` 读取
  - 新增 `getChildDocs()` 方法：通过扫描所有文档的 `parentDoc` 属性实现

- **IDevPlanStore 接口新增可选方法**：`getChildDocs()`、`getDocTree()`
- **数据迁移**：`migrateEngine()` 自动迁移 `parentDoc` 字段
- 工具数量保持 23 个不变（通过现有工具的参数扩展实现）

### v4.2.0 — 文档列表弹层与统计栏增强 (2026-02-13)

- **顶部统计栏新增文档数量**：
  - 状态栏新增可点击的「文档」统计项（绿色数字），与模块/主任务/子任务统一交互风格
  - 文档数量从图谱节点中实时统计（`type === 'document'`）

- **文档列表弹层（层级展示）**：
  - 点击顶部「文档」数字打开左侧文档列表弹层，通过 `/api/docs` 获取文档元信息
  - 文档按 `parentDoc` / `childDocs` 父子关系构建层级树结构
  - 顶层文档按 `section` 和 `title` 排序，子文档跟随父文档嵌套缩进展示
  - 有子文档的条目左侧显示展开/折叠按钮（`+`/`−`），可递归展开多级子文档
  - 折叠状态通过 `docModalCollapsedState` 全局对象持久化（会话内）

- **复用已有详情面板**：
  - 点击文档列表中的标题，直接调用 `statsModalGoToNode()` 聚焦图谱节点并打开右侧详情面板
  - 复用已有的节点详情面板显示文档内容、元信息、关联任务等，避免重复弹层

- **新增 API 端点 `/api/docs`**：
  - 返回所有文档片段的元信息列表（不含 `content` 内容，减少传输量）
  - 每条记录包含 `section`、`subSection`、`title`、`version`、`moduleId`、`parentDoc`、`childDocs`、`updatedAt`
  - 用于文档列表弹层的左侧文档树渲染

---

## 12. 路线图：文档层级关系 (parentDocId) ~~与搜索增强~~

> 规划日期: 2026-02-12  
> 更新日期: 2026-02-13  
> 状态: **全部已完成** — 搜索增强（v4.0.0）+ 文档层级关系（v4.1.0）

### 12.1 背景与问题

#### 12.1.1 文档层级问题 ✅ 已解决（v4.1.0）

> **此问题已在 v4.1.0 中解决**。以下为原始问题记录，保留供参考。

~~当前文档模型是**扁平结构**~~：~~所有文档通过 `section` + `subSection` 构成至多两级的分类体系~~。现已通过 `parentDoc` 字段和 `doc_has_child` 关系实现多级文档层级：

- ~~**文档树**：无法表达"章节 → 小节 → 段落"的多级文档结构~~ → `getDocTree()` 支持递归文档树
- ~~**父子导航**：无法从子文档上溯到父文档~~ → `parentDoc` 字段 + `childDocs` 自动计算属性
- ~~**批量操作**：无法按文档树批量删除/移动某个文档分支~~ → `deleteSection()` 自动断开父子关系

#### 12.1.2 搜索能力问题 ✅ 已解决（v4.0.0）

> **此问题已在 v4.0.0 中完全解决**。以下为原始问题记录，保留供参考。

~~当前 `searchSections()` 实现是**纯 JavaScript 暴力扫描**~~：

```typescript
// dev-plan-graph-store.ts — v4.0.0 之前的旧实现（已替换）
searchSections(query: string, limit: number = 10): DevPlanDoc[] {
  const queryLower = query.toLowerCase();
  return this.listSections()
    .filter(doc =>
      doc.content.toLowerCase().includes(queryLower) ||
      doc.title.toLowerCase().includes(queryLower)
    )
    .slice(0, limit);
}
```

~~问题~~（已全部解决）：
- ~~**全量加载**：每次搜索都要加载所有文档到内存~~ → 语义搜索通过 HNSW 向量索引实现，无需全量加载
- ~~**仅字面匹配**：不支持语义搜索~~ → 支持 `literal` / `semantic` / `hybrid` 三种模式
- ~~**无排序**：结果按存储顺序返回~~ → RRF 融合排序，返回带 `score` 评分的结果
- ~~**未利用 aifastdb 原生能力**~~ → 集成 VibeSynapse（Candle MiniLM）+ SocialGraphV2 向量索引

### 12.2 任务与子任务的父子关系机制（参考模型）

子任务与主任务的父子关系通过**双重机制**实现：

| 层级 | 机制 | 字段 / 关系 | 作用 |
|------|------|-------------|------|
| 属性层 | `SubTask.parentTaskId` | `parentTaskId: "phase-7"` | 快速属性查询 |
| 图层 | `HAS_SUB_TASK` 关系 | `main-task → sub-task` | 图遍历和可视化 |

文档层级将参照此模式设计。

### 12.3 文档层级方案设计

#### 12.3.1 类型变更

```typescript
// types.ts — 新增字段
interface DevPlanDocInput {
  // ... 现有字段 ...
  /** 父文档标识（section 或 section|subSection 格式，可选） */
  parentDoc?: string;
}

interface DevPlanDoc {
  // ... 现有字段 ...
  /** 父文档标识（section 或 section|subSection 格式） */
  parentDoc?: string;
  /** 子文档 ID 列表（自动计算，仅 Graph 引擎支持） */
  childDocs?: string[];
}
```

**设计决策：**

- 字段名使用 `parentDoc` 而非 `parentDocId`，因为文档的唯一标识是 `section|subSection` 组合而非数据库 ID
- `childDocs` 是计算属性（从图关系反向查询），不需要手动维护
- 向后兼容：`parentDoc` 为可选字段，现有文档无需修改

#### 12.3.2 新增关系类型

```typescript
// dev-plan-graph-store.ts
const RT = {
  // ... 现有关系 ...
  DOC_HAS_CHILD: 'doc_has_child',  // 新增：文档 → 子文档
} as const;
```

关系模型扩展后的完整图：

```
Module ──1:N──▶ MainTask ──1:N──▶ SubTask
Module ──1:N──▶ DevPlanDoc
MainTask ◀──N:M──▶ DevPlanDoc       (task_has_doc)
DevPlanDoc ──1:N──▶ DevPlanDoc       (doc_has_child) ← 新增
```

#### 12.3.3 存储层变更

**Graph 引擎 (`DevPlanGraphStore`)：**

| 操作 | 变更 |
|------|------|
| `saveSection()` | 新增：若 `input.parentDoc` 存在，解析父文档 Entity → 创建 `DOC_HAS_CHILD` 关系 |
| `getSection()` | 新增：查询 `DOC_HAS_CHILD` 入向关系获取 `parentDoc`，查询出向关系获取 `childDocs` |
| `listSections()` | 新增：返回结果中填充 `parentDoc` 字段 |
| `deleteSection()` | 新增：级联删除所有子文档（可选），或仅断开关系 |
| `exportGraph()` | 新增：导出 `doc_has_child` 边 |

**Document 引擎 (`DevPlanDocumentStore`)：**

| 操作 | 变更 |
|------|------|
| `saveSection()` | 新增：在 `metadata` 中存储 `parentDoc` 字段 |
| `getSection()` | 新增：从 `metadata.parentDoc` 读取 |
| `listSections()` | 新增：返回结果中填充 `parentDoc` 字段 |

#### 12.3.4 MCP 工具变更

| 工具 | 变更 |
|------|------|
| `devplan_save_section` | 新增可选参数 `parentDoc`（格式："section" 或 "section\|subSection"） |
| `devplan_get_section` | 返回值新增 `parentDoc` 和 `childDocs` 字段 |
| `devplan_list_sections` | 返回值新增 `parentDoc` 字段 |

**无需新增 MCP 工具**：文档层级通过现有工具的参数扩展实现，保持 23 个工具不变。

#### 12.3.5 可视化变更

| 组件 | 变更 |
|------|------|
| 图谱边 | 新增 `doc_has_child` 边类型（紫色虚线，表示文档包含关系） |
| 详情面板 | 文档节点显示"父文档"（可点击跳转）和"子文档列表"（可点击跳转） |
| 底部图例 | 新增"文档-子文档"边类型 |

#### 12.3.6 接口变更 (IDevPlanStore)

```typescript
// dev-plan-interface.ts — 新增方法（可选）
interface IDevPlanStore {
  // ... 现有方法 ...

  /**
   * 获取文档的子文档列表
   */
  getChildDocs?(section: DevPlanSection, subSection?: string): DevPlanDoc[];

  /**
   * 获取文档树（递归，含所有后代文档）
   */
  getDocTree?(section: DevPlanSection, subSection?: string): DevPlanDocTree;
}

interface DevPlanDocTree {
  doc: DevPlanDoc;
  children: DevPlanDocTree[];
}
```

### 12.4 搜索增强方案（三阶段） ✅ 已全部完成

> **以下三个阶段已在 v4.0.0 中一次性完成**，实际实现合并了短期/中期/长期方案。

#### 12.4.1 ✅ 短期：利用 SocialGraphV2 属性索引（已完成）

已实现 `literalSearch()` 方法，作为字面搜索的基础实现，同时作为语义搜索不可用时的降级方案。

#### 12.4.2 ✅ 中期：文档 Embedding + 向量索引（已完成）

已实现完整的语义搜索管线：

- `saveSection()` 保存文档时自动调用 `autoIndexDocument()` 生成 Embedding 并索引到 SocialGraphV2 HNSW
- `searchSectionsAdvanced()` 支持三种搜索模式：`literal` / `semantic` / `hybrid`
- `rebuildIndex()` 支持全量重建向量索引
- Embedding 提供者选择了 **Candle 本地**（MiniLM-L6-v2，384 维），零 API 依赖，离线可用

#### 12.4.3 ✅ 长期：接入 VibeSynapse（已完成）

已集成 VibeSynapse 作为 Embedding 引擎，使用 Candle MiniLM-L6-v2 本地模型：

- `VibeSynapse` 实例在 `DevPlanGraphStore` 构造时自动初始化
- 通过 `synapse.embed(text)` 生成 Embedding 向量
- 通过 `graph.searchEntitiesByVector(embedding, limit, entityType)` 进行向量近邻搜索
- `rrfFusion()` 使用 RRF（Reciprocal Rank Fusion, k=60）融合语义和字面搜索结果
- 优雅降级：`hasPerception` 检查 + dry-run 测试，初始化失败时自动降级为字面搜索

> **注意**：VibeSynapse 多模态搜索的更高级能力（跨文档关联推荐、上下文感知排序）可作为未来增强方向。

### 12.5 实施优先级

| 阶段 | 内容 | 优先级 | 预计工时 | 状态 |
|------|------|--------|----------|------|
| 1 | ~~文档层级 `parentDoc` 字段 + Graph 引擎实现~~ | ~~P1~~ | ~~4h~~ | ✅ v4.1.0 已完成 |
| 2 | ~~文档层级 Document 引擎实现~~ | ~~P2~~ | ~~2h~~ | ✅ v4.1.0 已完成 |
| 3 | ~~MCP 工具参数扩展（`parentDoc`）~~ | ~~P1~~ | ~~2h~~ | ✅ v4.1.0 已完成 |
| 4 | ~~可视化 `doc_has_child` 边 + 面板更新~~ | ~~P2~~ | ~~3h~~ | ✅ v4.1.0 已完成 |
| 5 | ~~搜索短期优化（属性索引）~~ | ~~P1~~ | ~~2h~~ | ✅ v4.0.0 已完成 |
| 6 | ~~搜索中期（Embedding + 向量索引）~~ | ~~P2~~ | ~~8h~~ | ✅ v4.0.0 已完成 |
| 7 | ~~搜索长期（VibeSynapse 集成）~~ | ~~P2~~ | ~~16h~~ | ✅ v4.0.0 已完成 |

---

## 13. Autopilot 模块 — cursor_auto 融合方案

> 规划日期: 2026-02-15  
> 状态: **规划中**  
> 关联项目: `cursor_auto`（`D:\Project\git\cursor_auto`）

### 13.1 背景与动机

#### 13.1.1 cursor_auto 项目概述

[cursor_auto](../cursor_auto/) 是一个 Cursor IDE 无人值守自动化工具，核心能力：

| 能力 | 实现方式 |
|------|---------|
| **屏幕状态感知** | 截图 + Ollama 视觉模型（Gemma 3:27b）识别 UI 状态 |
| **GUI 自动化** | pyautogui + pygetwindow + pyperclip 操作 Cursor 窗口 |
| **任务队列** | `tasks.txt` 纯文本文件，逐行发送给 Cursor AI |
| **Web 监控** | Flask + SSE 实时推送状态到浏览器 |

**cursor_auto 当前技术栈**：

```
Python 3.x
├── pyautogui >= 0.9.54      # GUI 自动化（鼠标、键盘、截图）
├── pygetwindow              # 窗口管理（激活、定位）
├── ollama >= 0.1.0          # 视觉 AI 模型调用
├── Pillow >= 10.0.0         # 图像处理（截图裁剪）
├── pyperclip >= 1.8.2       # 剪贴板操作
└── Flask >= 3.0.0           # Web UI 后端 + SSE
```

**cursor_auto 当前代码量**（约 2624 行）：

| 模块 | 行数 | 职责 |
|------|------|------|
| `automator.py` | 614 | 主控循环：截图→分析→决策→执行 |
| `cursor_controller.py` | 447 | GUI 操作：窗口激活、文本输入、快捷键 |
| `vision_analyzer.py` | 395 | 视觉分析：截图→Ollama→状态识别 |
| `ui_server.py` | 225 | Web UI：Flask + SSE 实时监控 |
| `task_manager.py` | 199 | 任务管理：从 tasks.txt 加载/切换任务 |
| `config.py` | 76 | 配置：模型、超时、坐标、状态标记 |
| `templates/index.html` | 668 | Web 前端页面 |

#### 13.1.2 核心问题：纯截图方案的缺陷

cursor_auto 当前的信息获取完全依赖"截图 → 视觉 AI 识别"，存在根本性缺陷：

| 问题 | 表现 | 影响 |
|------|------|------|
| **状态识别不准确** | Ollama 视觉模型对复杂 UI 的识别率不稳定 | 误判导致错误操作（如误发"请继续"） |
| **缺乏语义理解** | 只能识别 UI 视觉特征，无法理解"任务是否真正完成" | COMPLETED 状态可能只是 AI 生成了回复但未通过测试 |
| **无任务上下文** | 不知道当前 Cursor 在执行什么任务、属于哪个阶段 | 任务切换盲目，只能按 `tasks.txt` 顺序发送 |
| **状态不持久** | 重启后丢失所有进度，无法断点续传 | 长时间运行任务链时风险极高 |
| **资源浪费** | 每次轮询都要调用视觉模型，即使什么都没发生 | 增加 GPU/CPU 开销和延迟 |

#### 13.1.3 DevPlan 已经解决了任务感知

DevPlan 的任务系统天然提供了 cursor_auto 缺失的能力：

```
当前方案（截图驱动）:
  [截图] → [Ollama分析] → "这看起来像是完成了" → [发送下一个任务]
                                ↑ 不确定! 可能误判!

升级方案（MCP 任务感知）:
  [DevPlan API 轮询] → task.status === "completed" → [确定完成!] → [自动启动下一阶段]
  [截图分析] → "AI 停在等待确认/中断/报错" → [发送"请继续"]
```

**核心思路**：DevPlan 负责"做什么"（任务编排），截图分析负责"什么时候能操作"（UI 状态检测）。

### 13.2 融合方案选择：方案 C — Monorepo + 清晰分区

#### 13.2.1 三种方案对比

| | 方案 A：保持 2 个 repo | 方案 B：完全混合合并 | **方案 C：Monorepo + 清晰分区** ✅ |
|---|---|---|---|
| **结构** | 各自独立 | Python 代码混在 TypeScript 中 | Python 代码放 `executor/` 目录，TypeScript 不动 |
| **API 同步** | 改了 TS API 要跑到另一个 repo 改 Python 客户端 | 同 repo 一起改 | 同 repo 一起改 ✅ |
| **npm 发布** | 不受影响 | 需要小心排除 Python 文件 | `package.json` 的 `files: ["dist"]` 天然排除 ✅ |
| **TypeScript 编译** | 不受影响 | 可能冲突 | `tsconfig.json` 的 `include: ["src/**/*"]` 完全忽略 `executor/` ✅ |
| **Git 版本** | API 变更需两边协调 commit | 一个 commit 搞定 | 一个 commit 搞定 ✅ |
| **构建互不干扰** | 天然隔离 | 可能冲突 | `tsc` 只编译 `src/`，Python 无需编译 ✅ |

#### 13.2.2 方案 C 可行性论证

**构建隔离**已由现有配置天然保证：

```json
// package.json — npm 发布仅包含 dist/
"files": ["dist", "README.md", "LICENSE"]

// tsconfig.json — TypeScript 编译器仅处理 src/
"include": ["src/**/*"],
"exclude": ["node_modules", "dist"]
```

Python 代码放在 `executor/` 目录下，对 TypeScript 编译和 npm 发布**零影响**。

**技术栈差异分析**：

| 维度 | TypeScript (DevPlan) | Python (Executor) | 结论 |
|------|---------------------|-------------------|------|
| **职责** | 任务编排（大脑） | GUI 操作（双手） | 互补不重叠 |
| **运行时** | Node.js（MCP Server） | 桌面进程（需 GUI 访问） | 独立进程 |
| **构建** | `tsc` → `dist/` | 无需编译 | 互不干扰 |
| **依赖** | npm (`package.json`) | pip (`pyproject.toml`) | 各自管理 |
| **发布** | npm registry | 不发布（本地工具） | 无冲突 |

### 13.3 合并后的目录结构

```
aifastdb-devplan/                          # 项目根 (Git repo)
│
├── src/                                   # TypeScript — DevPlan 核心 + MCP + API
│   ├── types.ts                           #   类型定义（现有 + Autopilot 类型扩展）
│   ├── dev-plan-interface.ts              #   IDevPlanStore 接口（现有）
│   ├── dev-plan-graph-store.ts            #   Graph 引擎（现有）
│   ├── dev-plan-document-store.ts         #   Document 引擎（现有）
│   ├── dev-plan-factory.ts                #   工厂函数（现有）
│   ├── dev-plan-migrate.ts                #   引擎迁移（现有）
│   ├── index.ts                           #   npm 包导出入口（现有）
│   │
│   ├── mcp-server/
│   │   └── index.ts                       #   MCP Server（现有 23 个工具 + 新增 3 个 autopilot 工具）
│   │
│   └── visualize/
│       ├── server.ts                      #   HTTP 服务器（现有 API + 新增 /api/auto/* 端点）
│       └── template.ts                    #   可视化 HTML 模板（现有）
│
├── executor/                              # Python — Autopilot 执行器（从 cursor_auto 重构迁入）
│   ├── pyproject.toml                     #   Python 依赖与项目元数据
│   ├── README.md                          #   executor 使用说明
│   │
│   ├── src/
│   │   ├── __init__.py
│   │   ├── engine.py                      #   ★ 主控引擎（原 automator.py 重写）
│   │   ├── devplan_client.py              #   ★ DevPlan HTTP 客户端（新增）
│   │   ├── cursor_controller.py           #   GUI 自动化（从 cursor_auto 迁入）
│   │   ├── vision_analyzer.py             #   视觉分析（精简后，只判断 UI 状态）
│   │   ├── ui_server.py                   #   Web UI 监控（增强：集成 DevPlan 进度）
│   │   └── config.py                      #   配置管理（升级为 dataclass/pydantic）
│   │
│   ├── templates/
│   │   └── index.html                     #   Web UI 前端（增强版）
│   │
│   └── tests/
│       ├── test_devplan_client.py
│       └── test_engine.py
│
├── package.json                           # npm 配置（现有，不变）
├── tsconfig.json                          # TypeScript 配置（现有，不变）
├── package-lock.json
├── dist/                                  # TypeScript 编译产物
├── DEVPLAN_ReadMe.md                      # 本文档
├── LICENSE
└── README.md
```

**关键隔离点**：

| 文件/配置 | 范围 | executor/ 可见性 |
|-----------|------|-----------------|
| `tsconfig.json` → `include: ["src/**/*"]` | 仅编译 `src/` | ❌ 不可见 |
| `package.json` → `files: ["dist", ...]` | 仅发布 `dist/` | ❌ 不可见 |
| `.gitignore` | 全 repo | ✅ 共享（需新增 `executor/__pycache__/` 等） |
| `git commit` | 全 repo | ✅ TS + Python 变更一次提交 |

### 13.4 TypeScript 侧新增：Autopilot 模块

#### 13.4.1 新增 MCP 工具（3 个 → 共 26 个）

| 工具名 | 说明 | 必需参数 | 可选参数 |
|--------|------|---------|---------|
| `devplan_auto_status` | 查询自动化执行状态：是否有进行中阶段、当前子任务、阻塞原因 | `projectName` | — |
| `devplan_auto_next` | 智能推荐下一步动作：发送任务 / 请继续 / 启动新阶段 / 等待 / 全部完成 | `projectName` | — |
| `devplan_auto_config` | 配置自动化参数：轮询间隔、自动启动下一阶段、最大重试次数 | `projectName` | `config` |

**`devplan_auto_status` 返回值**：

```typescript
{
  hasActivePhase: boolean;           // 是否有进行中的阶段
  activePhase?: {
    taskId: string;
    title: string;
    totalSubtasks: number;
    completedSubtasks: number;
    percent: number;
  };
  currentSubTask?: {                 // 当前进行中的子任务
    taskId: string;
    title: string;
    status: TaskStatus;
  };
  nextPendingSubTask?: {             // 下一个待执行的子任务
    taskId: string;
    title: string;
  };
  nextPendingPhase?: {               // 下一个待启动的阶段
    taskId: string;
    title: string;
    priority: string;
  };
  remainingPhases: number;           // 剩余未完成阶段数
}
```

**`devplan_auto_next` 返回值**：

```typescript
{
  action: 'send_task' | 'send_continue' | 'start_phase' | 'wait' | 'all_done';
  phase?: { taskId, title, status, totalSubtasks, completedSubtasks };
  subTask?: { taskId, title, description, status };
  message: string;                   // 人类可读的行动建议
}
```

#### 13.4.2 可视化服务器新增 API 端点（5 个）

在 `src/visualize/server.ts` 的 `switch (url.pathname)` 中新增：

| 端点 | 方法 | 说明 | 调用者 |
|------|------|------|--------|
| `GET /api/auto/next-action` | GET | 获取下一步该执行什么动作（等效于 `devplan_auto_next`） | executor 轮询 |
| `GET /api/auto/current-phase` | GET | 获取当前进行中阶段及全部子任务状态 | executor 轮询 |
| `POST /api/auto/complete-task` | POST | 标记子任务完成（等效于 `devplan_complete_task`） | executor 回调 |
| `POST /api/auto/start-phase` | POST | 启动新阶段（等效于 `devplan_start_phase`） | executor 请求 |
| `POST /api/auto/heartbeat` | POST | executor 心跳上报（含 UI 状态信息） | executor 定时 |

**`GET /api/auto/next-action` 响应示例**：

```json
{
  "action": "send_task",
  "phase": {
    "taskId": "phase-17",
    "title": "阶段十七: 分布式查询优化",
    "status": "in_progress",
    "totalSubtasks": 8,
    "completedSubtasks": 3
  },
  "subTask": {
    "taskId": "T17.4",
    "title": "实现查询计划缓存",
    "description": "为跨库查询计划添加 LRU 缓存...",
    "status": "pending"
  },
  "message": "当前阶段有 5 个待完成子任务，下一个: T17.4 — 实现查询计划缓存"
}
```

**`POST /api/auto/heartbeat` 请求体**：

```json
{
  "executorId": "cursor-auto-001",
  "status": "active",
  "lastScreenState": "WORKING",
  "timestamp": 1739612345678
}
```

**设计决策 — 为什么通过 HTTP API 而不是直接读 JSONL/WAL**：

| 方案 | 优点 | 缺点 |
|------|------|------|
| 直接读取 `.devplan/` 数据文件 | 零延迟，无需网络 | 耦合存储格式，引擎切换时需适配；Python 需解析 WAL |
| MCP stdio 子进程 | 标准协议，完全解耦 | 需管理子进程生命周期，实现复杂 |
| **HTTP API** ✅ | 简单可靠，Python `requests` 即可；可视化服务器已有完整框架 | 需要可视化服务器在运行 |

选择 HTTP API 因为：
1. 可视化服务器已有 `createFreshStore()` 模式，每次请求读取最新数据
2. 已有 CORS 头、错误处理、CLI 参数解析等基础设施
3. Python 的 `requests` 调用 HTTP API 极其简单
4. 可视化服务器本就需要运行（提供仪表盘），不增加运维负担

#### 13.4.3 数据模型扩展

在 `src/types.ts` 中新增：

```typescript
// ============================================================================
// Autopilot 相关类型
// ============================================================================

/** Autopilot 自动化配置 */
export interface AutopilotConfig {
  /** 是否启用 autopilot */
  enabled: boolean;
  /** executor 轮询间隔（秒） */
  pollIntervalSeconds: number;
  /** 阶段完成后自动启动下一个 */
  autoStartNextPhase: boolean;
  /** 发送"请继续"的最大连续重试次数 */
  maxContinueRetries: number;
  /** 子任务卡住超时时间（分钟） */
  stuckTimeoutMinutes: number;
}

/** Autopilot 下一步动作类型 */
export type AutopilotAction = 
  | 'send_task'       // 发送新的子任务内容给 Cursor
  | 'send_continue'   // 发送"请继续"（AI 被中断/限速）
  | 'start_phase'     // 启动新阶段
  | 'wait'            // 等待（任务进行中，无需操作）
  | 'all_done';       // 全部任务完成

/** Autopilot 动作建议 */
export interface AutopilotNextAction {
  action: AutopilotAction;
  phase?: {
    taskId: string;
    title: string;
    status: TaskStatus;
    totalSubtasks: number;
    completedSubtasks: number;
  };
  subTask?: {
    taskId: string;
    title: string;
    description?: string;
    status: TaskStatus;
  };
  message: string;
}

/** Autopilot 执行状态 */
export interface AutopilotStatus {
  hasActivePhase: boolean;
  activePhase?: {
    taskId: string;
    title: string;
    totalSubtasks: number;
    completedSubtasks: number;
    percent: number;
  };
  currentSubTask?: {
    taskId: string;
    title: string;
    status: TaskStatus;
  };
  nextPendingSubTask?: {
    taskId: string;
    title: string;
  };
  nextPendingPhase?: {
    taskId: string;
    title: string;
    priority: string;
  };
  remainingPhases: number;
}

/** Executor 心跳数据 */
export interface ExecutorHeartbeat {
  executorId: string;
  status: 'active' | 'paused' | 'stopped';
  lastScreenState?: string;
  timestamp: number;
}
```

### 13.5 Python 侧：Autopilot Executor

#### 13.5.1 模块职责对比（重构前 → 重构后）

| 原模块 (cursor_auto) | 重构方向 | 新模块 (executor) |
|----------------------|---------|-------------------|
| `task_manager.py` | **删除**，由 DevPlan API 替代 | `devplan_client.py` ★ 新增 |
| `automator.py` | **重写**为双通道决策引擎 | `engine.py` |
| `vision_analyzer.py` | **精简** Prompt，不再判断"任务完成" | `vision_analyzer.py` |
| `cursor_controller.py` | **基本保留**，修复坐标硬编码 | `cursor_controller.py` |
| `config.py` | **升级**为 dataclass/pydantic | `config.py` |
| `ui_server.py` | **增强**：集成 DevPlan 进度信息 | `ui_server.py` |
| `tasks.txt` | **删除** | — |

#### 13.5.2 devplan_client.py — DevPlan HTTP 客户端

```python
"""
DevPlan HTTP 客户端 — 与 aifastdb-devplan 可视化服务器通信。

通过 /api/auto/* 端点获取任务状态、提交完成、启动新阶段。
"""
import requests
from dataclasses import dataclass
from typing import Optional

@dataclass
class DevPlanConfig:
    base_url: str = "http://localhost:3210"
    timeout: int = 10  # 秒

class DevPlanClient:
    def __init__(self, config: DevPlanConfig = None):
        self.config = config or DevPlanConfig()
        self.session = requests.Session()
    
    def get_next_action(self) -> dict:
        """GET /api/auto/next-action — 获取下一步动作建议"""
        resp = self.session.get(
            f"{self.config.base_url}/api/auto/next-action",
            timeout=self.config.timeout
        )
        resp.raise_for_status()
        return resp.json()
    
    def get_current_phase(self) -> dict:
        """GET /api/auto/current-phase — 获取当前阶段详情"""
        resp = self.session.get(
            f"{self.config.base_url}/api/auto/current-phase",
            timeout=self.config.timeout
        )
        resp.raise_for_status()
        return resp.json()
    
    def complete_task(self, task_id: str) -> dict:
        """POST /api/auto/complete-task — 标记子任务完成"""
        resp = self.session.post(
            f"{self.config.base_url}/api/auto/complete-task",
            json={"taskId": task_id},
            timeout=self.config.timeout
        )
        resp.raise_for_status()
        return resp.json()
    
    def start_phase(self, task_id: str) -> dict:
        """POST /api/auto/start-phase — 启动新阶段"""
        resp = self.session.post(
            f"{self.config.base_url}/api/auto/start-phase",
            json={"taskId": task_id},
            timeout=self.config.timeout
        )
        resp.raise_for_status()
        return resp.json()
    
    def heartbeat(self, executor_id: str, status: str, 
                  screen_state: Optional[str] = None) -> dict:
        """POST /api/auto/heartbeat — 心跳上报"""
        resp = self.session.post(
            f"{self.config.base_url}/api/auto/heartbeat",
            json={
                "executorId": executor_id,
                "status": status,
                "lastScreenState": screen_state,
            },
            timeout=self.config.timeout
        )
        resp.raise_for_status()
        return resp.json()
    
    def get_progress(self) -> dict:
        """GET /api/progress — 获取项目进度（现有端点）"""
        resp = self.session.get(
            f"{self.config.base_url}/api/progress",
            timeout=self.config.timeout
        )
        resp.raise_for_status()
        return resp.json()
```

#### 13.5.3 双通道决策引擎

executor 的核心创新是**双通道联合决策**：同时采集 DevPlan 任务状态和 UI 截图状态，综合判断下一步操作。

**决策矩阵**：

| DevPlan 任务状态 | 截图 UI 状态 | 联合判断 | 执行动作 |
|----------------|-------------|---------|---------|
| 有 pending 子任务 | IDLE（空闲） | ✅ 可以发送新任务 | 发送子任务内容到 Cursor |
| 子任务 in_progress | WORKING | 正常，等待 | 不操作 |
| 子任务 in_progress | INTERRUPTED / 中断 | AI 被中断 | 发送"请继续" |
| 子任务 in_progress | ERROR | AI 遇到错误 | 发送"请继续"或错误处理 |
| 子任务 in_progress | IDLE（超时） | AI 可能完成了但没回调 | 重新检查 DevPlan 状态 |
| 全部子任务 completed | 任意 | 阶段完成 | 自动 start_phase 下一阶段 |
| 无 pending 阶段 | 任意 | 全部完成 | 停止自动化 |

**关键改进**：

1. **不再依赖截图判断"任务是否完成"** — 由 Cursor 中的 AI 调用 `devplan_complete_task` 提供精确状态
2. **截图只负责判断 UI 层面的卡住/中断/报错** — 这是视觉分析真正擅长的事
3. **支持"任务完成 → 自动启动下一阶段"** — 全程自动，无需人工发送新任务

#### 13.5.4 精简后的 VisionAnalyzer Prompt

重构后，VisionAnalyzer 的 Prompt 大幅精简——不再需要判断"任务完成/下一步"：

```
原 Prompt（判断 8 种状态）：
  INTERRUPTED | WAITING_CONFIRMATION | TERMINAL_RUNNING | 
  ERROR | COMPLETED | WORKING | IDLE | UNKNOWN

精简后 Prompt（只判断 4 种 UI 状态）：
  WORKING    — AI 正在生成内容
  IDLE       — 输入框空闲，无活动
  INTERRUPTED — 出现"Continue"按钮或限速提示
  ERROR      — 出现错误信息
```

去掉了 `COMPLETED`（由 DevPlan 精确判断）和 `TERMINAL_RUNNING`/`WAITING_CONFIRMATION`（合并到 `WORKING`）。

### 13.6 完整工作流

```
┌─────────────────────────── Autopilot 全流程 ───────────────────────────────┐
│                                                                            │
│  1. 用户在 Cursor IDE 中说 "开始 phase-17 开发"                            │
│     ├→ AI 调用 devplan_start_phase("phase-17")                            │
│     ├→ AI 创建 TodoList，开始执行第一个子任务 T17.1                        │
│     └→ DevPlan 标记 phase-17 为 in_progress                               │
│                                                                            │
│  2. executor (Python) 后台自动运行中                                       │
│     ├→ 轮询 GET /api/auto/current-phase                                  │
│     │  → phase-17 in_progress, T17.1 in_progress                         │
│     ├→ 截图判断 UI 状态 = WORKING                                        │
│     └→ 联合决策: 任务进行中 + UI 正在工作 = 不操作，等待                   │
│                                                                            │
│  3. AI 遇到限速/中断                                                      │
│     ├→ Cursor 显示 "Continue" 按钮                                       │
│     ├→ executor 截图检测 UI = INTERRUPTED                                │
│     ├→ DevPlan 状态: T17.1 仍 in_progress（AI 没机会调 complete）         │
│     ├→ 联合决策: 任务未完成 + UI 中断 = 发送"请继续"                      │
│     └→ executor 通过 GUI 自动化发送"请继续"                               │
│                                                                            │
│  4. AI 完成子任务 T17.1                                                   │
│     ├→ AI 调用 devplan_complete_task("T17.1")                             │
│     ├→ DevPlan 标记 T17.1 completed，更新 phase-17 进度 (1/8)            │
│     ├→ AI 继续执行 T17.2                                                 │
│     └→ executor 下次轮询看到 T17.1 completed, T17.2 in_progress          │
│                                                                            │
│  5. phase-17 全部 8 个子任务完成                                          │
│     ├→ DevPlan 自动标记 phase-17 completed                               │
│     ├→ executor 轮询 GET /api/auto/next-action                           │
│     │  → { action: "start_phase", phase: { taskId: "phase-18" } }        │
│     ├→ executor POST /api/auto/start-phase { taskId: "phase-18" }        │
│     ├→ executor 在 Cursor IDE 中发送 "请开始 phase-18 的任务"             │
│     └→ AI 收到指令，调用 devplan_start_phase("phase-18")，继续开发       │
│                                                                            │
│  6. 循环直到所有阶段完成                                                  │
│     ├→ /api/auto/next-action 返回 { action: "all_done" }                 │
│     └→ executor 停止自动化，通知用户                                      │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 13.7 与现有功能的对比

| 维度 | cursor_auto 当前 | 融合后 (Autopilot) |
|------|----------------|-------------------|
| **任务感知** | 纯截图猜测 | DevPlan 精确状态 + 截图辅助 |
| **任务来源** | `tasks.txt` 手写 | DevPlan 结构化任务（优先级、排序、关联文档） |
| **进度追踪** | 无（重启丢失） | Git 锚定 + 可视化仪表盘 |
| **断点续传** | 不支持 | DevPlan 完美支持（任务状态持久化） |
| **多项目** | 一次只能跑一个 `tasks.txt` | DevPlan 多项目管理 |
| **可视化** | 简陋 Web UI | DevPlan 项目图谱 + 统计仪表盘 |
| **准确性** | Ollama 视觉模型判断 | DevPlan 精确状态（100%）+ 截图辅助（UI 层） |
| **AI 上下文** | AI 不知道有自动化工具在运行 | AI 通过 MCP 工具感知 autopilot 状态 |

### 13.8 实施路线图

#### 阶段一（P0）：cursor_auto 基础重构

> 目标：解决当前代码质量问题，为 MCP 集成做准备。

| 子任务 | 说明 |
|--------|------|
| 引入策略模式统一状态处理 | 将重复的 `_handle_*` 方法抽象为状态处理策略 |
| 分离关注点 | CursorController 不应包含 AI 模型调用 |
| 使用标准 logging 模块 | 替换自制日志系统 |
| 配置系统升级 | 引入 dataclass 或 pydantic，支持 YAML/TOML |
| 异步架构改造 | 使用 `asyncio` 替换阻塞式 `time.sleep()` |

#### 阶段二（P0）：DevPlan Autopilot API

> 目标：在可视化服务器中新增自动化 API 端点，在 MCP Server 中新增 3 个工具。

| 子任务 | 涉及文件 |
|--------|---------|
| 设计并实现 `/api/auto/next-action` 端点 | `src/visualize/server.ts` |
| 实现 `/api/auto/current-phase` 端点 | `src/visualize/server.ts` |
| 实现 `/api/auto/complete-task` 和 `/api/auto/start-phase` 端点 | `src/visualize/server.ts` |
| 实现 `/api/auto/heartbeat` 端点 | `src/visualize/server.ts` |
| 新增 `devplan_auto_status` MCP 工具 | `src/mcp-server/index.ts` |
| 新增 `devplan_auto_next` MCP 工具 | `src/mcp-server/index.ts` |
| 新增 `devplan_auto_config` MCP 工具 | `src/mcp-server/index.ts` |
| 新增 Autopilot 类型定义 | `src/types.ts` |

#### 阶段三（P1）：executor 迁入 + 接入 DevPlan

> 目标：将 cursor_auto 重构为 executor，迁入 devplan 项目，接入 HTTP API。

| 子任务 | 说明 |
|--------|------|
| 创建 `executor/` 目录结构 | `pyproject.toml`、`src/`、`tests/` |
| 实现 `devplan_client.py` | HTTP 客户端，封装 `/api/auto/*` 调用 |
| 重写 `engine.py` | 双通道决策引擎（DevPlan 状态 + UI 截图） |
| 精简 `vision_analyzer.py` | Prompt 精简为 4 种 UI 状态 |
| 迁入 `cursor_controller.py` | GUI 自动化（基本保留） |
| 删除 `tasks.txt` 依赖 | 所有任务从 DevPlan 获取 |
| 实现自动阶段切换 | 阶段完成后自动 `start_phase` 下一阶段 |

#### 阶段四（P2）：增强与优化

| 子任务 | 说明 |
|--------|------|
| 输入框定位改进 | 使用 UI Automation API 替代坐标硬编码 |
| AI 模型层抽象 | 支持 Ollama / OpenAI 等多后端 |
| Web UI 集成 DevPlan 进度 | 在 executor 的 Web UI 中展示阶段进度 |
| 可视化集成 | 在 DevPlan 图谱中展示 autopilot 状态 |
| 测试覆盖 | 单元测试和集成测试 |

### 13.9 cursor_auto 原 repo 处理

合并完成后：

1. `D:\Project\git\cursor_auto` 归档（保留但不再更新）
2. 在 cursor_auto 的 README 中标注："本项目已迁移至 `aifastdb-devplan/executor/`"
3. 后续所有开发在 `aifastdb-devplan` 项目中进行

---

> **文档维护说明**：本文档是 `aifastdb-devplan` 项目的完整功能文档。当项目有重大功能变更时，请同步更新本文档对应章节。

