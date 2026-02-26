# AiFastDb-DevPlan — 项目概览

> **项目名 (DevPlan)**: `aifastdb-devplan`  
> 本文件是 `DEVPLAN_ReadMe.md`（2100+ 行）的鸟瞰图，< 500 行。  
> 目的：让 AI / 新成员一次性读完即可理解项目全貌。  
> 深入细节请查阅完整文档 `DEVPLAN_ReadMe.md`。  
> 最后更新: 2026-02-15 | 文档版本: v1.0.0

---

## 1. 项目简介

**AiFastDb-DevPlan** 是一个基于 `aifastdb` 存储引擎的通用开发计划管理系统，作为独立的 **MCP Server** 发布，供 Cursor IDE 和 Claude Desktop 等 AI 工具使用。

**版本演进：**
```
v1.0.0  16 个 MCP 工具，从 ai_db 独立拆分
  ↓
v2.0.0  双引擎架构 — Graph (SocialGraphV2) + Document (JSONL)
  ↓
v3.0.0  项目图谱服务 — vis-network 交互式图谱 + 统计仪表盘
  ↓
v4.0.0  任务排序 + 语义搜索 — order 字段、VibeSynapse MiniLM 集成
  ↓
v4.2.0  文档列表弹层 + 统计栏增强
  ↓
v5.0.0  (规划) 多项目路由 + Autopilot 模块 — cursor_auto 融合
```

**当前状态：**
- ✅ 双引擎存储（Graph + Document）+ 数据迁移
- ✅ 23 个 MCP 工具（文档/任务/模块/可视化/搜索）
- ✅ 项目图谱 + 统计仪表盘 HTTP 服务
- ✅ 语义搜索（VibeSynapse Candle MiniLM + HNSW）
- ✅ 多项目路由（项目注册表 + 自动发现）
- ⬜ Autopilot 模块（cursor_auto 融合，HTTP API + Python Executor）

---

## 2. 架构总览

### 2.1 核心架构

```
┌─────────────────────────────────────────────────────────┐
│            AI 工具层 (Cursor IDE / Claude Desktop)       │
├─────────────────────────────────────────────────────────┤
│          MCP Server (23 个 devplan_* 工具)               │
├─────────────────────────────────────────────────────────┤
│           IDevPlanStore 抽象接口 (30+ 方法)              │
├──────────────────────┬──────────────────────────────────┤
│  Graph 引擎 (默认)    │  Document 引擎 (兼容)            │
│  SocialGraphV2       │  EnhancedDocumentStore            │
│  WAL + 分片文件       │  JSONL 追加写入                   │
│  实体-关系模型        │  轻量, 跟随 Git                   │
│  + HNSW 向量索引      │                                  │
└──────────────────────┴──────────────────────────────────┘
          ↓                       ↓
   .devplan/{project}/      .devplan/{project}/
     graph-data/              *.jsonl
```

### 2.2 多项目路由架构

```
工作区级 config.json（路由器）
  D:\xxx\ai_db\.devplan\config.json
  {
    "projects": {
      "ai_db":            { "rootPath": "D:\\xxx\\ai_db" },
      "aifastdb-devplan": { "rootPath": "D:\\xxx\\aifastdb-devplan" },
      "cursor_auto":      { "rootPath": "D:\\xxx\\cursor_auto" }
    }
  }
           ↓ resolveBasePathForProject(projectName)
  ┌──────────────────────────────────────────────┐
  │ ai_db         → D:\xxx\ai_db\.devplan\       │
  │ aifastdb-devplan → D:\xxx\aifastdb-devplan\.devplan\ │
  │ cursor_auto   → D:\xxx\cursor_auto\.devplan\ │
  └──────────────────────────────────────────────┘
```

**关键特性：**
- 项目路径注册表 + 自动发现（devplan_init 时自动注册）
- 注册路径不存在时优雅降级到默认 basePath
- Git 操作在正确的项目目录下执行（gitCwd 传递）
- 每个项目有独立的 config.json（项目级配置）

### 2.3 数据模型

| 概念 | 说明 | 标识 |
|------|------|------|
| **文档片段** | 11 种类型的结构化 Markdown 内容 | section + subSection |
| **主任务** | 开发阶段，下辖多个子任务 | `phase-X` |
| **子任务** | 最小工作单元，对应 TodoList 项 | `TX.Y` |
| **功能模块** | 独立功能区域，聚合任务和文档 | moduleId |

**文档 11 种 section 类型：**
`overview` · `core_concepts` · `api_design` · `file_structure` · `config` · `examples` · `technical_notes`(多子文档) · `api_endpoints` · `milestones` · `changelog` · `custom`(多子文档)

**Graph 引擎映射：**
- 5 种实体类型：project / doc / main-task / sub-task / module
- 7 种关系类型：has_document / has_main_task / has_sub_task / module_has_task / module_has_doc / task_has_doc / doc_has_child

---

## 3. 核心组件索引

### 3.1 源代码目录

| 文件 | 职责 | 行数 |
|------|------|------|
| `src/types.ts` | 所有类型定义 | ~460 |
| `src/dev-plan-interface.ts` | IDevPlanStore 抽象接口（30+ 方法） | ~250 |
| `src/dev-plan-graph-store.ts` | Graph 引擎实现 (SocialGraphV2) | ~1980 |
| `src/dev-plan-document-store.ts` | Document 引擎实现 (JSONL) | ~1920 |
| `src/dev-plan-factory.ts` | 工厂函数 + 引擎选择 + 多项目路由 | ~440 |
| `src/dev-plan-migrate.ts` | 数据迁移工具（document ↔ graph） | ~390 |
| `src/mcp-server/index.ts` | MCP Server（23 个工具入口） | ~1800 |
| `src/visualize/server.ts` | HTTP 服务器（可视化 + API） | ~430 |
| `src/visualize/template.ts` | 自包含 HTML 模板（vis-network） | ~2600 |
| `src/index.ts` | npm 包导出入口 | ~80 |

### 3.2 依赖关系

```
aifastdb-devplan
  ├── aifastdb (^2.5.1)                 # 底层存储引擎
  │   ├── EnhancedDocumentStore         # Document 引擎底层
  │   ├── SocialGraphV2                 # Graph 引擎底层（含 HNSW）
  │   ├── VibeSynapse                   # Candle MiniLM Embedding
  │   └── ContentType / DocumentInput   # 类型
  └── @modelcontextprotocol/sdk (^1.0.0) # MCP 协议 SDK
```

---

## 4. MCP 工具速查 (23 个)

| 类别 | 工具 | 说明 |
|------|------|------|
| **初始化** | `devplan_init` | 初始化项目 / 列出已有计划 / 自动注册 |
| **文档** | `devplan_save_section` | 保存/更新文档片段（含层级、模块关联） |
| | `devplan_get_section` | 获取文档片段内容 |
| | `devplan_list_sections` | 列出全部文档片段（含预览） |
| | `devplan_search_sections` | 搜索文档（literal / semantic / hybrid） |
| | `devplan_rebuild_index` | 重建语义搜索向量索引 |
| **任务** | `devplan_create_main_task` | 创建主任务（开发阶段） |
| | `devplan_add_sub_task` | 添加子任务 |
| | `devplan_upsert_task` | 幂等导入（批量推荐） |
| | `devplan_complete_task` | 完成任务（锚定 Git commit） |
| | `devplan_list_tasks` | 查询任务（支持状态/模块/阶段过滤） |
| | `devplan_start_phase` | 启动/恢复开发阶段（→ TodoList） |
| **进度** | `devplan_get_progress` | 项目进度概览（进度条） |
| | `devplan_export_markdown` | 导出 Markdown 报告 |
| **Git** | `devplan_sync_git` | 检查已完成任务与 Git 一致性 |
| **模块** | `devplan_create_module` | 创建功能模块 |
| | `devplan_list_modules` | 列出所有模块 |
| | `devplan_get_module` | 模块详情（含关联任务/文档） |
| | `devplan_update_module` | 更新模块信息 |
| **引擎** | `devplan_migrate_engine` | 双向数据迁移 (graph ↔ document) |
| **可视化** | `devplan_start_visual` | 启动项目图谱 HTTP 服务 |
| | `devplan_export_graph` | 导出图结构（vis-network 兼容） |

---

## 5. HTTP API 端点

### 5.1 可视化服务 (已实现)

```
GET  /                    # 项目图谱页面 (vis-network)
GET  /dashboard           # 统计仪表盘页面
GET  /api/graph           # 图谱数据（节点+边）
GET  /api/progress        # 项目进度 JSON
GET  /api/stats           # 详细统计数据
GET  /api/docs            # 文档列表
GET  /api/doc?section=X   # 文档内容
```

### 5.2 Autopilot 端点 (规划中)

```
GET  /api/auto/next-task        # 获取下一个待执行任务
POST /api/auto/complete-task    # 标记任务完成
POST /api/auto/session          # 创建/更新 Autopilot 会话
GET  /api/auto/session          # 查询会话状态
POST /api/auto/heartbeat        # 心跳上报
```

---

## 6. 开发阶段总览

| 阶段 | 描述 | 任务数 | 状态 |
|------|------|--------|------|
| 一 | 多项目路由完善与测试 | 5 | 🔄 80% |
| 二 | Autopilot HTTP API 开发 | 6 | ⬜ |
| 三 | Autopilot MCP 工具 | 4 | ⬜ |
| 四 | Python Executor 核心 | 5 | ⬜ |
| 五 | Executor GUI 自动化与视觉分析 | 4 | ⬜ P1 |
| 六 | Executor Web UI 与集成测试 | 2 | ⬜ P1 |

---

## 7. 关键设计决策

| 决策 | 原因 | 详见 |
|------|------|------|
| **双引擎存储** | Graph 适合新项目（图可视化），Document 兼容旧项目（JSONL + Git 友好） | §2 |
| **多项目路由** | 多项目工作区中每个项目的 devplan 数据存储在各自的 `.devplan/` 下 | §2.2 |
| **自动注册** | `devplan_init` 时自动发现同级目录并注册到 projects 表，降低配置门槛 | §2.2 |
| **gitCwd 传递** | syncWithGit 在项目根目录执行 git 命令，而非 process.cwd()，确保多项目正确 | §2.2 |
| **语义搜索降级** | 使用 VibeSynapse Candle MiniLM，不可用时自动降级到字面匹配 | §3 |
| **IDevPlanStore 接口** | 30+ 方法的抽象接口，两种引擎实现互换透明 | §3.1 |
| **Monorepo 分区** (规划) | cursor_auto (Python) 融入 `executor/` 目录，TypeScript 和 Python 通过 HTTP API 通信 | §13 |

---

## 8. 配置要点

### 8.1 两级配置体系

```
工作区级 config.json（位于 process.cwd() 解析的 .devplan/ 下）
├── defaultProject: "ai_db"        # 默认项目名
├── enableSemanticSearch: true      # 全局语义搜索开关
└── projects:                       # 项目路径注册表（路由核心）
    ├── "ai_db":            { rootPath: "..." }
    ├── "aifastdb-devplan": { rootPath: "..." }
    └── "cursor_auto":      { rootPath: "..." }

项目级 config.json（位于各项目 .devplan/ 下）
├── defaultProject: "aifastdb-devplan"  # 本项目标识
└── enableSemanticSearch: true           # 项目级配置优先
```

### 8.2 引擎配置

每个项目的 `.devplan/{projectName}/engine.json`：
```json
{ "engine": "graph", "version": "1.0.0" }
```

---

## 9. 数据存储位置

```
{project_root}/.devplan/
├── config.json                     # 项目级配置
└── {projectName}/
    ├── engine.json                 # 引擎类型
    └── graph-data/                 # Graph 引擎数据（WAL + 4 分片）
        └── wal/
            ├── shard_0_entities/
            ├── shard_1_relations/
            ├── shard_2_index/
            └── shard_3_meta/
```

或（Document 引擎）：
```
{project_root}/.devplan/
├── config.json
└── {projectName}/
    ├── engine.json
    ├── documents.jsonl
    ├── tasks.jsonl
    └── modules.jsonl
```

---

## 10. 文档指引

| 需要了解... | 查阅位置 |
|------------|---------|
| 项目全貌 | 本文件 (`docs/aifastdb-devplan-overview.md`) |
| 双引擎存储设计 | `DEVPLAN_ReadMe.md` §2 |
| 数据模型详情 | `DEVPLAN_ReadMe.md` §3 |
| MCP 工具参数详情 | `DEVPLAN_ReadMe.md` §4 |
| HTTP API 细节 | `DEVPLAN_ReadMe.md` §7 |
| Autopilot 融合方案 | `DEVPLAN_ReadMe.md` §13 |
| 多项目路由实现 | DevPlan `technical_notes|multi-project-routing` |
| 开发任务实时状态 | `devplan_get_progress(projectName: "aifastdb-devplan")` |
| 源码类型定义 | `src/types.ts` |
| 接口规范 | `src/dev-plan-interface.ts` |

---

## 11. DevPlan 系统

任务状态管理使用 DevPlan MCP 工具，而非直接编辑文件。

```
项目名: aifastdb-devplan

# 查看进度
devplan_get_progress(projectName: "aifastdb-devplan")

# 查看任务
devplan_list_tasks(projectName: "aifastdb-devplan")

# 完成任务
devplan_complete_task(projectName: "aifastdb-devplan", taskId: "T1.1")

# 启动/恢复阶段
devplan_start_phase(projectName: "aifastdb-devplan", taskId: "phase-1")
```

**三层信息架构：**

| 层级 | 文件 | 用途 | 大小 |
|------|------|------|------|
| Layer 1 (鸟瞰) | `docs/aifastdb-devplan-overview.md` | AI 首选阅读，一次读完 | ~400 行 |
| Layer 2 (详细) | `DEVPLAN_ReadMe.md` | 完整设计文档，按需分段读 | 2100+ 行 |
| Layer 3 (实时) | `.devplan/aifastdb-devplan/` | MCP 工具查询任务状态 | — |
