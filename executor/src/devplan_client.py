# -*- coding: utf-8 -*-
"""
DevPlan Executor — DevPlan HTTP 客户端

封装 DevPlan 可视化服务的 /api/auto/* 端点，
为 Executor 提供类型安全的任务状态查询和操作接口。

所有方法返回 dict（解析后的 JSON），异常时返回 None 或抛出异常。
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from .config import ExecutorConfig

logger = logging.getLogger("executor.devplan_client")


class DevPlanClient:
    """DevPlan HTTP API 客户端

    封装的端点：
      GET  /api/auto/next-action     → 获取下一步推荐动作
      GET  /api/auto/current-phase   → 获取当前阶段及子任务状态
      GET  /api/auto/status          → 获取完整 autopilot 状态（含心跳）
      POST /api/auto/complete-task   → 标记子任务完成
      POST /api/auto/start-phase     → 启动新阶段
      POST /api/auto/heartbeat       → 心跳上报
      POST /api/auto/dead-letter     → 记录 dead-letter
      GET  /api/auto/dead-letters    → 查询 dead-letter
      GET  /api/progress             → 获取项目进度概览
    """

    def __init__(self, config: ExecutorConfig):
        self.config = config
        self.base_url = config.devplan_base_url
        self.project_name = config.project_name
        self.timeout = config.http_timeout
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=self.timeout,
            params={"project": self.project_name},
        )

    def close(self) -> None:
        """关闭 HTTP 客户端"""
        self._client.close()

    def __enter__(self) -> "DevPlanClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    # ── 内部辅助 ─────────────────────────────────────────────

    def _get(self, path: str, **kwargs: Any) -> Optional[dict]:
        """GET 请求，成功返回 JSON dict，失败返回 None"""
        try:
            resp = self._client.get(path, **kwargs)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error("HTTP %s %s → %d: %s", "GET", path, e.response.status_code, e.response.text[:200])
            return None
        except httpx.RequestError as e:
            logger.error("请求失败 GET %s: %s", path, e)
            return None

    def _post(self, path: str, json_data: dict, **kwargs: Any) -> Optional[dict]:
        """POST 请求，成功返回 JSON dict，失败返回 None"""
        try:
            resp = self._client.post(path, json=json_data, **kwargs)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.error("HTTP %s %s → %d: %s", "POST", path, e.response.status_code, e.response.text[:200])
            return None
        except httpx.RequestError as e:
            logger.error("请求失败 POST %s: %s", path, e)
            return None

    # ── 公共 API ─────────────────────────────────────────────

    def get_next_action(self) -> Optional[dict]:
        """
        获取下一步推荐动作。

        返回示例::

            {
                "action": "send_task" | "wait" | "start_phase" | "all_done",
                "phase": { "taskId": "phase-4", "title": "...", ... },
                "subTask": { "taskId": "T4.1", "title": "...", "description": "...", ... },
                "message": "..."
            }
        """
        return self._get("/api/auto/next-action")

    def get_current_phase(self) -> Optional[dict]:
        """
        获取当前进行中阶段的详细信息。

        返回示例::

            {
                "hasActivePhase": true,
                "activePhase": { "taskId": "phase-4", ... },
                "currentSubTask": { ... } | null,
                "nextPendingSubTask": { ... } | null,
                "subTasks": [ ... ]
            }
        """
        return self._get("/api/auto/current-phase")

    def get_status(self) -> Optional[dict]:
        """
        获取完整 autopilot 状态（含 executor 心跳信息）。

        返回示例::

            {
                "hasActivePhase": true,
                "activePhase": { ... },
                "currentSubTask": { ... },
                "executor": { "lastHeartbeat": {...}, "isAlive": true }
            }
        """
        return self._get("/api/auto/status")

    def get_progress(self) -> Optional[dict]:
        """
        获取项目进度概览。

        返回示例::

            {
                "projectName": "ai_db",
                "overallPercent": 58,
                "tasks": [ ... ]
            }
        """
        return self._get("/api/progress")

    def complete_task(self, task_id: str) -> Optional[dict]:
        """
        标记子任务完成。

        Args:
            task_id: 子任务 ID（如 "T4.1"）

        返回示例::

            {
                "success": true,
                "taskId": "T4.1",
                "mainTaskCompleted": false,
                "mainTask": { ... }
            }
        """
        return self._post("/api/auto/complete-task", {"taskId": task_id})

    def start_phase(self, task_id: str) -> Optional[dict]:
        """
        启动新阶段。

        Args:
            task_id: 主任务 ID（如 "phase-5"）

        返回示例::

            {
                "success": true,
                "phase": { "taskId": "phase-5", "status": "in_progress", ... },
                "subTasks": [ ... ]
            }
        """
        return self._post("/api/auto/start-phase", {"taskId": task_id})

    def heartbeat(
        self,
        executor_id: str,
        status: str = "active",
        last_screen_state: Optional[str] = None,
    ) -> Optional[dict]:
        """
        上报 executor 心跳。

        Args:
            executor_id: Executor 实例 ID
            status: 状态 "active" | "paused" | "stopped"
            last_screen_state: 最近一次 UI 状态识别结果

        返回示例::

            {
                "success": true,
                "receivedAt": 1771136508145,
                "message": "心跳已接收: executor=executor-1, status=active"
            }
        """
        payload: dict[str, Any] = {
            "executorId": executor_id,
            "status": status,
        }
        if last_screen_state:
            payload["lastScreenState"] = last_screen_state
        return self._post("/api/auto/heartbeat", payload)

    def save_dead_letter(
        self,
        reason: str,
        message: str,
        phase_id: Optional[str] = None,
        task_id: Optional[str] = None,
        retry_after_seconds: Optional[int] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> Optional[dict]:
        """
        写入一条 dead-letter 记录。
        """
        payload: dict[str, Any] = {
            "source": "executor",
            "reason": reason,
            "message": message,
        }
        if phase_id:
            payload["phaseId"] = phase_id
        if task_id:
            payload["taskId"] = task_id
        if retry_after_seconds is not None:
            payload["retryAfterSeconds"] = retry_after_seconds
        if metadata:
            payload["metadata"] = metadata
        return self._post("/api/auto/dead-letter", payload)

    def list_dead_letters(
        self,
        limit: int = 50,
        reason: Optional[str] = None,
        phase_id: Optional[str] = None,
        task_id: Optional[str] = None,
    ) -> Optional[dict]:
        """
        查询 dead-letter 列表。
        """
        params: dict[str, Any] = {
            "limit": max(1, min(limit, 200)),
        }
        if reason:
            params["reason"] = reason
        if phase_id:
            params["phaseId"] = phase_id
        if task_id:
            params["taskId"] = task_id
        return self._get("/api/auto/dead-letters", params=params)

    def save_memory(
        self,
        content: str,
        memory_type: str = "summary",
        related_task_id: Optional[str] = None,
        tags: Optional[list[str]] = None,
        importance: float = 0.7,
    ) -> Optional[dict]:
        """
        写入一条长期记忆（通过 visualize server /api/memories/save）。
        """
        payload: dict[str, Any] = {
            "content": content,
            "memoryType": memory_type,
            "importance": importance,
            "tags": tags or [],
        }
        if related_task_id:
            payload["relatedTaskId"] = related_task_id
        return self._post("/api/memories/save", payload)

    def recall_unified(
        self,
        query: str,
        limit: int = 5,
        depth: str = "L1",
        min_score: float = 0.0,
    ) -> Optional[dict]:
        """
        统一召回（通过 visualize server /api/memories/recall-unified）。
        """
        params = {
            "query": query,
            "limit": max(1, min(limit, 20)),
            "depth": depth,
            "minScore": min_score,
        }
        return self._get("/api/memories/recall-unified", params=params)

    def is_reachable(self) -> bool:
        """检查 DevPlan 服务是否可达"""
        try:
            resp = self._client.get("/api/progress")
            return resp.status_code == 200
        except Exception:
            return False
