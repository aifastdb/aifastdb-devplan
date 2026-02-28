# Test Visualization Framework (DevPlan Test Hub)

## Goal

Provide one reusable monitoring entry for all test/benchmark visualizers across projects:

- centralized in `aifastdb-devplan`
- can aggregate tools from `ai_db`, `workagent`, `chat_api`, etc.
- can be embedded by `aifastdb_admin` to show "all running tests"

## What Is Implemented Now

Initial framework is now extracted as an independent package:

- `packages/test-tools-hub/` (npm package name: `@aifastdb/test-tools-hub`)

- `src/types.ts`: common tool and status schema
- `src/registry.ts`: default registry + external registry file loading
- `src/monitor.ts`: HTTP JSON poller + local log/process monitor + optional phase provider callback
- `src/server.ts`: Test Hub HTTP service
  - `GET /` dashboard page
  - `GET /api/tools`
  - `GET /api/status/all`
  - `GET /api/status/:toolId`

Default registered tool:

- `ai_db-bench-progress` → `http://localhost:3999/api/status`
  (backed by `ai_db/scripts/bench-progress-viewer.js`)

Package entrypoints:

- CLI bin: `aifastdb-test-tools-hub`
- In `aifastdb-devplan`, wrapper script: `npm run test-hub`

Install into any project:

```bash
npm i @aifastdb/test-tools-hub
```

## Registry Model

Tool registry is file-driven and project-agnostic:

```json
{
  "updatedAt": "2026-02-28T00:00:00.000Z",
  "tools": [
    {
      "id": "ai_db-bench-progress",
      "name": "ai_db multimodal dedup benchmark",
      "projectName": "ai_db",
      "kind": "http_json_status",
      "endpoint": "http://localhost:3999/api/status",
      "enabled": true,
      "timeoutMs": 3000,
      "tags": ["benchmark", "dedup"]
    }
  ]
}
```

Run with custom registry:

```bash
aifastdb-test-tools-hub --port 3321 --registry D:/path/test-tools.registry.json
```

## Integration With DevPlan Toolset

Current integration:

- each tool status is enriched with current phase snapshot from `createDevPlan(projectName).getProgress()`
- provides unified "test state + phase progress" in one payload

Recommended next integration steps:

1. Add MCP tools:
   - `devplan_test_tools_list`
   - `devplan_test_tools_status`
   - `devplan_test_tools_start_hub`
2. Store registry in `.devplan/<project>/test-tools.json`
3. Link tool runs to tasks (e.g. `T165.4`) with optional metadata:
   - `relatedTaskId`
   - `runId`
   - `startedAt`
   - `owner`

## Can It Be Added To Admin Backend?

Yes, and this is the recommended architecture:

1. `aifastdb_admin` adds a lightweight proxy endpoint:
   - `GET /api/test-hub/status` → forwards to Test Hub `/api/status/all`
2. Frontend adds a page:
   - "Test Tools"
   - table/cards for all tools
   - filters by project/state
3. Dashboard home adds summary cards:
   - total tools
   - running count
   - stalled count
   - failed/unreachable count

Why proxy via admin server:

- avoid browser CORS issues
- allow auth and permission control
- one frontend API origin

## Data Contract For Admin

Admin can consume:

```json
{
  "updatedAt": "...",
  "count": 3,
  "items": [
    {
      "tool": { "id": "...", "name": "...", "projectName": "...", "endpoint": "..." },
      "reachable": true,
      "checkedAt": "...",
      "state": "running",
      "progress": 85,
      "phase": {
        "taskId": "phase-165",
        "title": "...",
        "status": "in_progress",
        "completed": 4,
        "total": 6,
        "percent": 66
      },
      "raw": { }
    }
  ]
}
```

## Evolution Plan

Phase A (done):

- reusable Test Hub core + ai_db tool registration

Phase B:

- MCP test-tools APIs + project-scoped registry persistence

Phase C:

- `aifastdb_admin` integration page + dashboard summary cards

Phase D:

- start/stop actions per tool
- run history and flaky/stability trend charts
