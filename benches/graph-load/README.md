# benches/graph-load

`http://localhost:3215/graph` 页面数据加载性能的实验工作台。

> 方法论照搬 `D:\Project\git\autoresearch` 的 `program.md` —— 固定指标、唯一可改文件白名单、TSV 记录、keep/discard 二选一。
> 详见 [`BENCH.md`](./BENCH.md)。

## 必备前置

```powershell
# 1. 先编译，server 跑的是 dist/
cd D:\Project\git\aifastdb-devplan
npm run build

# 2. 确认 .devplan/pythontoolbox/ 数据存在
Test-Path .devplan/pythontoolbox/graph-data
```

## 快速测一轮

```powershell
node benches/graph-load/measure.mjs --label baseline-json --repeats 5
```

输出末尾会打印 `READY_MS_P50` 等指标，并追加一行到 `results.tsv`。

## 常用参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--label` | `baseline-json` | 实验标签（写进 TSV） |
| `--repeats` | `5` | 测量轮数；第 1 次是 cold，剩下做 p50/p95 |
| `--port` | `3998` | 临时端口，避开常用 3210/3215 |
| `--project` | `pythontoolbox` | DevPlan 项目名 |
| `--base-path` | `<repo>/.devplan` | DevPlan 数据根目录 |
| `--encoding` | `identity` | 请求头 `Accept-Encoding`，可选 `identity` / `gzip` / `br` |
| `--endpoint` | `json` | `json` 走 `/api/graph`；`binary` 走 `/api/graph/binary` |
| `--server-bin` | `dist/visualize/server.js` | server 入口 |
| `--no-tsv` | off | 不追加 `results.tsv` |
| `--out-json <p>` | — | 同时把 summary+samples 落盘 |
| `--desc` | `''` | 一句话描述本次实验 |
| `--warmup` | off | 在 cold 之前先打一次预热（默认不打，让 cold 反映真实首屏） |

环境变量：`BENCH_VERBOSE=1` 实时打印 server stdout/stderr。

## 三类典型实验

```powershell
# baseline：JSON 路径 + 无压缩
node benches/graph-load/measure.mjs --label baseline-json --desc "baseline: /api/graph JSON identity"

# E2：JSON 路径 + gzip
node benches/graph-load/measure.mjs --label E2-gzip --encoding gzip --desc "E2: /api/graph with gzip"

# E1：binary 路径
node benches/graph-load/measure.mjs --label E1-binary --endpoint binary --desc "E1: /api/graph/binary"
```

## 不变量（防作弊）

- 每次实验的 `nodes` / `edges` 字段必须与 baseline 完全一致。
- `payload_bytes` 可以变小；如果比 baseline **大且 ready_ms 没改善**，判 discard。
- 物理稳定时间不计入指标；本 bench 只测数据传输 + 解析阶段。

## results.tsv 阅读姿势

TSV 用 Tab 分隔，第一行是表头。VS Code 可装 "Excel Viewer" 或直接：

```powershell
Get-Content benches/graph-load/results.tsv | ConvertFrom-Csv -Delimiter "`t" | Format-Table
```
