# graph-load bench

本目录是 **aifastdb-devplan `/graph` 页面加载性能的实验工作台**，方法论照搬
`D:\Project\git\autoresearch` 的 `program.md`，但目标从 LLM 训练换成了
HTTP/JSON 数据传输路径优化。

## 单一指标（越低越好）

`ready_ms_p50` — 客户端从发起 `/api/graph` + `/api/progress`（并行）到
**两份响应完成 body 下载 + JSON 解析完成** 的总耗时中位数。

> 不测 `vis-network` 的物理稳定时间——那段是确定性的客户端工作，与
> 我们想验证的服务端/传输层改动无关。前端可见的改善 = `ready_ms` 的改善 +
> 渲染管线的常数。

副指标（不能比 baseline 显著变差，否则即使 `ready_ms` 降也判 discard）：

| 指标 | 含义 | 容忍变差幅度 |
|---|---|---|
| `nodes` | 节点总数 | **必须等于 baseline**（防"少加载点东西就更快"作弊） |
| `edges` | 边总数 | **必须等于 baseline** |
| `payload_bytes` | 实际下行字节数（含压缩） | 无硬约束，仅展示 |
| `parse_ms_p50` | 客户端 JSON.parse / DataView 解码耗时 | 可上升，但不能让 `ready_ms` 净劣化 |
| `server_cpu_hint` | 通过 `process.cpuUsage` 估的服务端 CPU 增量 | 不超 baseline 的 1.5× |

## 唯一可改文件白名单

agent 在一次实验里只能动以下文件中**与 graph 加载路径相关**的代码：

- `src/visualize/server.ts` — 仅 `/api/graph`、`/api/graph/binary`、`/api/progress`
  这三条分支以及其上的 helper（如 store 缓存）
- `src/visualize/template-data-loading.ts` — 整个文件
- `src/visualize/template-graph-vis.ts` — 仅 `renderGraph` 之前的数据准备段、
  `silentRefresh`、`loadTierDataByType`、`loadMemoryNodesLazy`
- `src/dev-plan-graph-store.visualize.ts` — 仅 `exportGraph`、`exportGraphPaginated`、
  `exportGraphCompact` 这三个函数

**绝不允许动**：

- `benches/graph-load/measure.mjs`、`prepare.mjs`、`BENCH.md`、`results.tsv`
- 测试数据：`.devplan/pythontoolbox/**`
- `src/mcp-server/**`
- 任何 vis-network / 3d-force-graph 第三方库内部

## TSV 列定义

`results.tsv` 用 **Tab 分隔**，列顺序：

```
ts	commit	label	encoding	repeats	nodes	edges	payload_bytes	cold_ms	ready_ms_p50	ready_ms_p95	parse_ms_p50	status	desc
```

- `ts` — ISO8601，本地时区
- `commit` — `git rev-parse --short HEAD`，未提交时取 `<short>+dirty`
- `label` — 实验标签，agent 自己命名，如 `baseline-json`、`E2-gzip`、`E1-binary`
- `encoding` — `identity` / `gzip` / `br` / `binary`
- `repeats` — 测量轮数（默认 5）
- `nodes`、`edges` — 节点/边总数，**必须等于 baseline**
- `payload_bytes` — 单次请求实际下行字节数（取冷启动那次为准）
- `cold_ms` — 第一次（冷启动）总耗时
- `ready_ms_p50`、`ready_ms_p95` — 去掉冷启动后剩余轮次的 p50/p95
- `parse_ms_p50` — JSON.parse / DataView 解码 p50
- `status` — `keep` / `discard` / `crash`
- `desc` — 一句话说明改了什么

## 实验循环（autoresearch 风格）

```
LOOP:
  1. 想一个改动思路（看 README 的"实验候选清单"）
  2. 改白名单内代码 + git commit
  3. npm run build  # 必须，server 跑的是 dist/
  4. node benches/graph-load/measure.mjs --label <tag> --repeats 5
  5. grep "^READY_MS_P50" run.log  # 或直接看 stdout
  6. 如果 ready_ms_p50 < 上次最佳: status=keep, advance 分支
     否则: git reset --hard, status=discard
  7. 把结果追加进 results.tsv
  8. 回到 1
```

**永不停机**：一旦 baseline 录入，agent 自行循环试 E1–E6，**不要中途询问**。
卡住时回读 `BENCH.md` 和 `README.md` 的实验候选清单。

## 实验候选清单（agent 自由选取顺序）

| ID | 思路 | 预期 |
|---|---|---|
| E1 | 客户端切到 `/api/graph/binary` + DataView 解码 | payload ↓ 5×、parse 接近零 |
| E2 | 服务端 `/api/graph`、`/api/progress` 加 gzip/br | payload ↓ 5–10×，CPU 略升 |
| E3 | 服务端 graph payload TTL 缓存（与 store 缓存共享 5s） | warm ready_ms ↓ |
| E4 | payload 字段裁剪（去掉 `properties` 中渲染期不用的字段） | bytes ↓ 30% |
| E5 | `/api/graph` + `/api/progress` 合并为单端点 | RTT ↓ 1 个 |
| E6 | "骨架渲染 + 边后注入" 拆两批渲染（仅 template-data-loading） | first-paint ↓，ready_ms 持平 |

## 不算优化的"作弊"行为

- 减少 `nodes` / `edges` 总数（必须严格等于 baseline）
- 关掉 `includeNodeDegree`（默认 baseline 是 true）
- 关掉 `includeMemories` 之外的过滤位（baseline 已经是 memories=false）
- 调测量脚本的 `repeats` 或预热轮次
- 把测量时间从墙钟换成别的

---

## 第 1 轮实验结论（commit 096eb72+dirty，2026-05-20）

数据集：`ai_db` 项目（**真实大数据集 = 用户截图那种规模**），2643 节点 / 2651 边 / 1.02 MB JSON。

| 实验 | 结论 | 决议 |
|---|---|---|
| **baseline JSON identity** | `ready_ms_p50 = 26.8s`，`cold = 16.8s`，server 端 `exportGraph()` Node 层组装 ≈ 全部耗时 | `keep` 作为锚点 |
| **E2 gzip** | wire 1020 → 249 KB（4.1× 压缩），但 `ready_ms_p50 = 26.5s` 与 baseline 持平 | `discard` |
| **E1 `/api/graph/binary`** | `ready_ms_p50 = 16.9s`（-37%），但 **返回 6961 个 entity** vs JSON 端点的 2643 — 数据语义不一致，不能直接替换 | `defer`（先补齐过滤再测） |

### 三个最重要的发现

1. **真正的瓶颈在服务端组装**，而非传输/解析。
   - download 仅 2-3 ms，parse 仅 5 ms — 加起来不到总耗时的 0.03%
   - 17-36 秒里 99% 都是 server 端在 Rust + Node 层重新扫描 + 组装 graph payload

2. **`store` 5s TTL 缓存没在大数据集生效**。
   - 因为每次响应本身就 17-36 秒，远超 TTL → 每次都重 build store
   - warm 反而比 cold 还慢（GC + disk pressure 累积）

3. **E1 binary 端点跳过了 Node 层应用过滤**，所以 `nodes` 多出 4.4×。
   - Rust 层 `exportGraphCompact()` 输出全部 entity（含 memory 等）
   - JSON 端点 `exportGraph()` 在 Node 层做了 `includeMemories=false` 等业务过滤
   - 这正解释了 cold E1 减半的部分原因 — 它干的活就少了

### 第 2 轮实验候选（按预期收益排序）

| 优先 | 实验 | 思路 | 预估 ready_ms_p50 收益 |
|---|---|---|---|
| **P0** | E3 — Node 层 graph payload TTL 缓存 | 把 `exportGraph(options)` 的结果按 `JSON.stringify(options)` 当 key 存 5-60s | 27s → < 1s（warm 命中） |
| **P0** | E7 — 延长 store cache TTL + 监听 WAL mtime 失效 | store TTL 从 5s 调到 60s，监听 `.devplan/<project>/graph-data/wal/*` mtime 变化主动失效 | 配合 E3，让生产环境刷新场景接近瞬时 |
| **P1** | E4 — payload 字段裁剪 | 移除 `properties.childDocs`、`completedAt` 等渲染期不用字段，并把 `properties` 移到 `/api/node/:id` 懒加载 | wire ↓ 30-50%，server-side stringify ↓ 20% |
| **P1** | E8 — Rust 层一次性导出 `exportGraph` 路径 | 给 NAPI 增加 `exportGraphFiltered(opts)`，把 Node 层 N+1 改成 Rust 层 1+0 | 27s → 5s 量级（一次性结构性消除） |
| **P2** | E1' — binary 端点加过滤参数 | 给 `exportGraphCompact(opts)` 加 `includeMemories` 等过滤位，使其与 JSON 端点语义对齐，然后再做客户端 DataView 解码 | 与 E2 类似——网络省了但 server-side 没省 |

### 实验工作台对方法论的修正

- 实验前的假设是 "E1+E2 收益最大"，**实验数据驳掉了这个假设**。
- 反过来印证了 autoresearch 方法论的价值：**不实测就不知道瓶颈在哪**。
- 后续严格执行 BENCH.md 流程：先用 measure.mjs 量出基线，再做改动。

---

## 第 2 轮实验结论（commit 096eb72+dirty，2026-05-20）

**结论：找到 root cause，单点修复后 warm ready_ms_p50 从 26.8s 降到 12.9ms（-99.95%）。**

### 关键过程

1. **第 1 次 E3+E7 尝试失败**：用 WAL `.gwal` mtime 做 store / payload 缓存失效，bench 显示 cache 几乎不命中（warm p50 = 18.7s vs baseline 26.8s）。
2. **写两个 probe 反查原因**（[`probe-side-effects.mjs`](./probe-side-effects.mjs)、[`probe-idle-wal.mjs`](./probe-idle-wal.mjs)）：
   - `/api/progress`、`/api/graph` 每次调用都让 `.gwal` +1100~2500 字节
   - server idle 12 秒也增长 +384 字节（≈ 一个 entry）
   - 一度怀疑 ai_db NAPI 层在 read 路径暗写 WAL
3. **直接 dump WAL 末尾 12 条 entry**：全是同一种 op：
   ```
   op=PutEntity  entity_type="devplan-project"  id=63ba12d0-…  间隔 8–11 秒
   ```
   `devplan-project` 是 **aifastdb-devplan 自己定义的类型**，ai_db core 不知道这种东西。
4. **追到源头 `src/dev-plan-graph-store.ts:806`**：`DevPlanGraphStore` 每次构造都无条件调 `ensureProjectEntity()` → `upsertEntityByProp` + `flush()`；而 ai_db 的 `upsert_entity_by_prop`（[`federation.rs:77`](../../../ai_db/packages/core/src/social/store_v2/federation.rs)）即使 entity 已存在也强制 `entity.updated_at = chrono_now(); put_entity()`，每次产生一条 ~400 字节的 PutEntity WAL entry。
5. **MCP server / visualize server 多个 TTL 缓存（5–60s）都会反复重建 store** ⇒ idle 期间也持续每 ~10s 写一条 WAL，污染了所有基于 mtime 的失效策略。

### 修复

**aifastdb-devplan 端**（治本，必修）：

```typescript
private ensureProjectEntity(): void {
  const existing = this.findProjectEntity();
  if (existing) {
    this.projectEntityId = existing.id;
    return;   // ← 已存在直接返回，不再 PUT
  }
  const entity = this.graph.upsertEntityByProp(
    ET.PROJECT, 'projectName', this.projectName, this.projectName, {
      projectName: this.projectName,
      createdAt: Date.now(),
    }
  );
  this.projectEntityId = entity.id;
  this.graph.flush();
}
```

副产品 bug 修复：原来 `createdAt: Date.now()` 每次都被刷成"现在"，本应固定。

**ai_db 端**（可选，更深层防御）：`upsert_entity_by_prop` 对 properties 做 dirty check，相同则短路不写 WAL。但 aifastdb-devplan 改对了，ai_db 改不改都行。

### 然后顺势完成 E3：

- **store TTL** 60s（从 5s 提升）
- **graph payload TTL 缓存**：按 `JSON.stringify(options)` + `_cachedStoreAt` 作为 key，存 `exportGraph()` 的返回
- **`/api/progress` 也加 TTL 缓存**（这是发现的第二个瓶颈）：原本它做 4 次串行 NAPI 调用（`getProgress` + `listSections` + `listModules` + `listPrompts`），ai_db 数据集上单次 1.7s；因为 `/graph` 页面 `loadDataFull` 并行 fetch `/api/graph` + `/api/progress`，而 Node HTTP server 单线程，总耗时 ≈ `max(graph, progress) ≈ progress`

### 最终基线（label = `E3-progress-cache`）

| 指标 | baseline (修复前) | 最终 | 变化 |
|---|---|---|---|
| `cold_ms` | 28864 ms | **1667 ms** | **-94%** |
| `ready_ms_p50` (warm) | 18705 ms | **12.9 ms** | **-99.93%** |
| `ready_ms_p95` (warm) | 26794 ms | 17.8 ms | -99.93% |
| `nodes` / `edges` | 2643 / 2651 | 2643 / 2651 | 同 |
| `payload_bytes` | 1020841 | 1020841 | 同 |
| `parse_ms_p50` | 5.6 | 4.3 | 持平 |

`nodes` / `edges` / `payload_bytes` 严格不变 ⇒ 不是少加载数据作弊。

### Cold 路径还能怎么再降

剩下的 1667 ms 几乎都是 **首次 `createDevPlan` 里的 `SocialStoreV2::open()` 跑 `recover()` 从 19 MB `.gwal` 重建内存状态**。后续优化方向（暂不做）：

- 由 NAPI 提供"按需 lazy recover"：先建空 store，访问 entity 时按需 demand-load
- 减少 WAL 体积：定期 checkpoint + 老 entry 压缩（ai_db 工作）

但 cold 是用户进入 `/graph` 页面的"一次性税"，warm 才是真正高频路径，目前 12.9 ms 已经接近 HTTP loopback 的物理下限。

