# -*- coding: utf-8 -*-
"""
DevPlan Executor — 三通道决策引擎

融合三个信息通道做出执行决策：
  - Channel 1: Cursor renderer.log 日志监控 → AI 活动状态（ToolCall 事件、网络错误）
  - Channel 2: DevPlan HTTP API → 任务编排状态（有无待发任务、阶段进度等）
  - Channel 3: 屏幕截图 + Ollama gemma3:27b 视觉 AI → UI 运行时状态（8 态分类）

决策矩阵（8 状态版 + 差异化恢复策略）：

| UI 状态              | 恢复动作              | 说明                          |
|---------------------|----------------------|------------------------------|
| AI_GENERATING       | WAIT                 | AI 在工作，跳过                |
| CONNECTION_ERROR    | SEND_CONTINUE        | 连接错误，发"请继续"            |
| PROVIDER_ERROR      | SEND_CONTINUE        | Provider 错误，发"请继续"       |
| CONTEXT_OVERFLOW    | NEW_CONVERSATION     | 上下文溢出，Ctrl+L 开新对话恢复  |
| RATE_LIMIT          | WAIT_COOLDOWN(60s)   | 限流，等冷却期                  |
| API_TIMEOUT         | SEND_CONTINUE        | API 超时，即时重试              |
| RESPONSE_INTERRUPTED| SEND_CONTINUE        | 响应被截断，发"请继续"           |
| RESPONSE_STALL      | SEND_CONTINUE/升级    | 累积型中断，N 次无效→开新对话     |
| IDLE + 无变化        | SEND_TASK/唤醒        | 空闲，发新任务或唤醒             |
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from .config import UIStatus

logger = logging.getLogger("executor.engine")


# ── 引擎输出动作 ─────────────────────────────────────────────

class Action(str, Enum):
    """决策引擎输出的执行动作"""
    SEND_TASK = "send_task"               # 发送新的子任务给 Cursor
    SEND_CONTINUE = "send_continue"       # 发送"请继续"
    START_PHASE = "start_phase"           # 启动新阶段
    WAIT = "wait"                         # 等待，本轮不操作
    ALL_DONE = "all_done"                 # 全部完成，停止
    ERROR_RECOVERY = "error_recovery"     # 错误恢复
    NEW_CONVERSATION = "new_conversation" # 开新对话（上下文溢出时 Ctrl+L）
    WAIT_COOLDOWN = "wait_cooldown"       # 等待冷却期（限流时）


@dataclass
class Decision:
    """决策结果"""
    action: Action
    message: str
    # send_task 时携带的任务内容
    task_content: Optional[str] = None
    task_id: Optional[str] = None
    # start_phase 时携带的阶段 ID
    phase_id: Optional[str] = None
    # wait_cooldown 时的等待秒数
    cooldown_seconds: int = 0


# ── 状态追踪器 ───────────────────────────────────────────────

@dataclass
class StateTracker:
    """状态连续出现计数器，用于防抖和确认"""

    # 各 UI 状态连续出现次数
    status_counts: dict[str, int] = field(default_factory=dict)
    # 上次发送操作的时间戳
    last_send_time: float = 0.0
    # 终端命令开始运行的时间戳
    terminal_start_time: float = 0.0
    # 连续 continue 重试次数
    continue_retries: int = 0
    # 上次 DevPlan 动作
    last_devplan_action: str = ""
    # 上次 UI 状态
    last_ui_status: str = ""
    # RESPONSE_STALL 连续无效 continue 发送次数（用于升级到 CONTEXT_OVERFLOW）
    stall_continue_count: int = 0

    def increment_status(self, status: str) -> int:
        """
        增加指定状态的连续计数，重置其他状态的计数。

        Returns:
            该状态的连续出现次数
        """
        # 重置其他状态
        for key in list(self.status_counts.keys()):
            if key != status:
                self.status_counts[key] = 0
        # 累加当前状态
        self.status_counts[status] = self.status_counts.get(status, 0) + 1
        return self.status_counts[status]

    def reset_all(self) -> None:
        """重置所有状态计数"""
        self.status_counts.clear()
        self.continue_retries = 0
        self.terminal_start_time = 0.0

    def can_send(self, min_interval: float) -> bool:
        """
        检查是否已过最小发送间隔。

        Args:
            min_interval: 最小间隔（秒）

        Returns:
            是否可以发送
        """
        return (time.time() - self.last_send_time) >= min_interval

    def record_send(self) -> None:
        """记录发送时间"""
        self.last_send_time = time.time()


# ── 双通道决策引擎 ───────────────────────────────────────────

class DualChannelEngine:
    """
    双通道决策引擎。

    每个决策周期接收两路输入：
      1. devplan_action: DevPlan HTTP API 返回的 next-action
      2. ui_status: 视觉 AI 识别的当前 UI 状态

    输出 Decision，由主循环执行。
    """

    def __init__(
        self,
        status_trigger_threshold: int = 3,
        min_send_interval: float = 5.0,
        max_continue_retries: int = 5,
        auto_start_next_phase: bool = True,
        fallback_no_change_timeout: int = 90,
        rate_limit_wait: int = 60,
        api_timeout_wait: int = 5,
        context_overflow_wait: int = 3,
        stall_escalate_threshold: int = 3,
    ):
        self.threshold = status_trigger_threshold
        self.min_send_interval = min_send_interval
        self.max_continue_retries = max_continue_retries
        self.auto_start_next_phase = auto_start_next_phase
        self.fallback_no_change_timeout = fallback_no_change_timeout
        self.rate_limit_wait = rate_limit_wait
        self.api_timeout_wait = api_timeout_wait
        self.context_overflow_wait = context_overflow_wait
        self.stall_escalate_threshold = stall_escalate_threshold
        self.tracker = StateTracker()

    def decide(
        self,
        devplan_data: dict,
        ui_status: UIStatus,
        screen_changing: bool = False,
        br_no_change_seconds: float = 0.0,
    ) -> Decision:
        """
        双通道联合决策。

        Args:
            devplan_data: DevPlan /api/auto/next-action 返回的完整 JSON
            ui_status: 视觉 AI 识别的当前 UI 状态
            screen_changing: 连续截图是否检测到屏幕变化
            br_no_change_seconds: 右下角截图持续无变化的秒数（用于 3 分钟兜底）

        Returns:
            Decision 决策结果
        """
        devplan_action = devplan_data.get("action", "wait")
        self.tracker.last_devplan_action = devplan_action
        self.tracker.last_ui_status = ui_status.value

        # ── Case 1: 全部完成 ──
        if devplan_action == "all_done":
            return Decision(
                action=Action.ALL_DONE,
                message=devplan_data.get("message", "所有任务已完成"),
            )

        # ── Case 2: 启动新阶段 ──
        if devplan_action == "start_phase":
            phase_info = devplan_data.get("phase", {})
            phase_id = phase_info.get("taskId", "")
            if self.auto_start_next_phase and phase_id:
                self.tracker.reset_all()
                return Decision(
                    action=Action.START_PHASE,
                    message=f"启动新阶段: {phase_id} — {phase_info.get('title', '')}",
                    phase_id=phase_id,
                )
            else:
                return Decision(
                    action=Action.WAIT,
                    message=f"有待启动阶段 {phase_id}，但自动启动已禁用",
                )

        # ── Case 3: 有待发送的子任务 (send_task) ──
        if devplan_action == "send_task":
            decision = self._decide_send_task(devplan_data, ui_status, screen_changing)
            # 如果常规决策是 WAIT，再检查兜底策略
            if decision.action == Action.WAIT:
                fallback = self._check_fallback(devplan_data, br_no_change_seconds)
                if fallback is not None:
                    return fallback
            return decision

        # ── Case 4: 等待中 (wait) — AI 正在工作 ──
        if devplan_action == "wait":
            decision = self._decide_wait(devplan_data, ui_status, screen_changing)
            # 如果常规决策是 WAIT，再检查兜底策略
            if decision.action == Action.WAIT:
                fallback = self._check_fallback(devplan_data, br_no_change_seconds)
                if fallback is not None:
                    return fallback
            return decision

        # ── Case 5: 未知 devplan_action，检查兜底策略 ──
        fallback = self._check_fallback(devplan_data, br_no_change_seconds)
        if fallback is not None:
            return fallback

        # ── 未知的 devplan_action ──
        return Decision(
            action=Action.WAIT,
            message=f"未知的 DevPlan 动作: {devplan_action}",
        )

    # ── 内部决策分支 ─────────────────────────────────────────

    def _decide_send_task(
        self,
        devplan_data: dict,
        ui_status: UIStatus,
        screen_changing: bool,
    ) -> Decision:
        """DevPlan 说"有待发任务"时的决策（8 状态版）

        判断逻辑（按优先级）：
        1. AI_GENERATING → AI 正在工作，等待
        2. CONNECTION_ERROR → 发送"请继续"恢复连接
        3. PROVIDER_ERROR → 发送"请继续"恢复
        4. CONTEXT_OVERFLOW → 开新对话 (Ctrl+L) + 恢复 prompt
        5. RATE_LIMIT → 等待冷却期
        6. API_TIMEOUT → 即时重试
        7. RESPONSE_INTERRUPTED → 发送"请继续"
        8. RESPONSE_STALL → 发送"请继续"唤醒，连续无效→升级
        9. 屏幕有变化 → AI 可能在忙，等待
        10. 屏幕无变化 + IDLE/UNKNOWN → 发送新任务
        """
        sub_task = devplan_data.get("subTask", {})
        task_id = sub_task.get("taskId", "")
        title = sub_task.get("title", "")
        description = sub_task.get("description", "")

        # AI 正在生成 → 等待
        if ui_status == UIStatus.AI_GENERATING:
            return Decision(
                action=Action.WAIT,
                message=f"DevPlan 有待发任务 {task_id}，AI 正在生成中，等待",
            )

        # 连接错误 → 尝试恢复
        if ui_status == UIStatus.CONNECTION_ERROR:
            return self._maybe_send_continue(
                f"DevPlan 有待发任务 {task_id}，但 UI 检测到连接错误，尝试恢复"
            )

        # Provider 错误 → 尝试恢复
        if ui_status == UIStatus.PROVIDER_ERROR:
            return self._maybe_send_continue(
                f"DevPlan 有待发任务 {task_id}，但 UI 检测到 Provider Error，尝试恢复"
            )

        # 上下文溢出 → 开新对话
        if ui_status == UIStatus.CONTEXT_OVERFLOW:
            return self._handle_context_overflow(devplan_data, task_id)

        # 限流 → 等待冷却
        if ui_status == UIStatus.RATE_LIMIT:
            return Decision(
                action=Action.WAIT_COOLDOWN,
                message=f"DevPlan 有待发任务 {task_id}，但检测到限流，等待 {self.rate_limit_wait} 秒",
                cooldown_seconds=self.rate_limit_wait,
            )

        # API 超时 → 即时重试
        if ui_status == UIStatus.API_TIMEOUT:
            return self._maybe_send_continue(
                f"DevPlan 有待发任务 {task_id}，API 超时，即时重试"
            )

        # 响应被中断 → 发送"请继续"
        if ui_status == UIStatus.RESPONSE_INTERRUPTED:
            return self._maybe_send_continue(
                f"DevPlan 有待发任务 {task_id}，AI 响应被中断，发送继续"
            )

        # 响应中断（累积型）→ 唤醒，多次无效则升级
        if ui_status == UIStatus.RESPONSE_STALL:
            return self._handle_response_stall(devplan_data, task_id)

        # 屏幕有变化 → AI 可能正在工作，等一等
        if screen_changing:
            return Decision(
                action=Action.WAIT,
                message=f"DevPlan 有待发任务 {task_id}，但屏幕有变化（AI 可能在忙），等待中",
            )

        # 屏幕无变化 + IDLE/UNKNOWN → 发送新任务
        task_content = self._format_task_content(task_id, title, description)
        self.tracker.reset_all()
        return Decision(
            action=Action.SEND_TASK,
            message=f"发送子任务: {task_id} — {title}",
            task_content=task_content,
            task_id=task_id,
        )

    def _decide_wait(
        self,
        devplan_data: dict,
        ui_status: UIStatus,
        screen_changing: bool,
    ) -> Decision:
        """DevPlan 说"等待中（AI 正在工作）"时的决策（5 状态版）

        判断逻辑（8 状态版）：
        1. AI_GENERATING → AI 正在工作，等待
        2. CONNECTION_ERROR → 发送"请继续"恢复连接
        3. PROVIDER_ERROR → 发送"请继续"恢复
        4. CONTEXT_OVERFLOW → 开新对话 + 恢复
        5. RATE_LIMIT → 等待冷却
        6. API_TIMEOUT → 即时重试
        7. RESPONSE_INTERRUPTED → 发送"请继续"
        8. RESPONSE_STALL → 唤醒，连续无效→升级
        9. 屏幕有变化 → AI 正在工作，继续等待
        10. 屏幕无变化 → AI 可能已停止，尝试唤醒
        """
        sub_task = devplan_data.get("subTask", {})
        task_id = sub_task.get("taskId", "")

        # AI 正在生成 → 等待
        if ui_status == UIStatus.AI_GENERATING:
            return Decision(
                action=Action.WAIT,
                message=f"{task_id} 执行中，AI 正在生成，继续等待",
            )

        # 连接错误 → 尝试恢复
        if ui_status == UIStatus.CONNECTION_ERROR:
            return self._maybe_send_continue(
                f"{task_id} 执行中但 UI 检测到连接错误，尝试恢复"
            )

        # Provider 错误 → 尝试恢复
        if ui_status == UIStatus.PROVIDER_ERROR:
            return self._maybe_send_continue(
                f"{task_id} 执行中但 UI 检测到 Provider Error，尝试恢复"
            )

        # 上下文溢出 → 开新对话
        if ui_status == UIStatus.CONTEXT_OVERFLOW:
            return self._handle_context_overflow(devplan_data, task_id)

        # 限流 → 等待冷却
        if ui_status == UIStatus.RATE_LIMIT:
            return Decision(
                action=Action.WAIT_COOLDOWN,
                message=f"{task_id} 执行中但检测到限流，等待 {self.rate_limit_wait} 秒",
                cooldown_seconds=self.rate_limit_wait,
            )

        # API 超时 → 即时重试
        if ui_status == UIStatus.API_TIMEOUT:
            return self._maybe_send_continue(
                f"{task_id} 执行中，API 超时，即时重试"
            )

        # 响应被中断 → 发送"请继续"
        if ui_status == UIStatus.RESPONSE_INTERRUPTED:
            return self._maybe_send_continue(
                f"{task_id} 执行中，AI 响应被中断，发送继续"
            )

        # 响应中断（累积型）→ 唤醒，多次无效则升级
        if ui_status == UIStatus.RESPONSE_STALL:
            return self._handle_response_stall(devplan_data, task_id)

        # 屏幕有变化 → AI 正在工作（代替原 WORKING / TERMINAL_RUNNING 判断）
        if screen_changing:
            return Decision(
                action=Action.WAIT,
                message=f"{task_id} 执行中，屏幕有变化（AI 在工作），继续等待",
            )

        # 屏幕无变化 + IDLE/UNKNOWN → AI 可能已停止，尝试唤醒
        return self._maybe_send_continue(
            f"{task_id} 执行中但屏幕无变化且 UI 空闲，尝试唤醒"
        )

    # ── 3 分钟兜底策略 ─────────────────────────────────────────

    def _check_fallback(
        self,
        devplan_data: dict,
        br_no_change_seconds: float,
    ) -> Optional[Decision]:
        """
        3 分钟兜底策略：右下角截图持续无变化超过阈值时触发。

        规则：
          1. 右下角截图持续无变化超过 fallback_no_change_timeout（默认 180 秒）
          2. DevPlan 还有待开发任务（action != "all_done"）→ 发送"请继续"
          3. DevPlan 无待开发任务（action == "all_done"）→ 不发送
          4. 受 min_send_interval 冷却限制

        Returns:
            Decision 或 None（未触发兜底时）
        """
        if br_no_change_seconds < self.fallback_no_change_timeout:
            return None

        devplan_action = devplan_data.get("action", "wait")

        # 所有任务已完成 → 不触发兜底
        if devplan_action == "all_done":
            logger.info(
                "右下角 %.0f 秒无变化，但所有任务已完成，不触发兜底",
                br_no_change_seconds,
            )
            return None

        # 有待开发任务 → 触发兜底发送"请继续"
        logger.warning(
            '🛡️ 兜底策略触发: 右下角截图 %.0f 秒无变化（阈值 %d 秒），发送"请继续"',
            br_no_change_seconds,
            self.fallback_no_change_timeout,
        )

        # 检查发送间隔冷却
        if not self.tracker.can_send(self.min_send_interval):
            return Decision(
                action=Action.WAIT,
                message=f"兜底策略已触发（{br_no_change_seconds:.0f}s 无变化），但发送冷却中",
            )

        self.tracker.record_send()
        return Decision(
            action=Action.SEND_CONTINUE,
            message=f'兜底策略: 右下角 {br_no_change_seconds:.0f} 秒无变化，发送"请继续"唤醒',
        )

    # ── 辅助方法 ─────────────────────────────────────────────

    def _handle_context_overflow(self, devplan_data: dict, task_id: str) -> Decision:
        """
        处理上下文溢出：需要开新对话。

        策略：
        1. Ctrl+L 开新对话
        2. 构建恢复 prompt，包含当前任务上下文
        3. 重置所有状态计数
        """
        logger.warning("🔴 检测到上下文溢出 (CONTEXT_OVERFLOW)，准备开新对话恢复")

        # 构建恢复 prompt
        sub_task = devplan_data.get("subTask", {})
        phase = devplan_data.get("phase", {})
        phase_id = phase.get("taskId", "")
        phase_title = phase.get("title", "")
        sub_title = sub_task.get("title", "")
        sub_desc = sub_task.get("description", "")

        # 恢复 prompt 告诉新对话从哪里继续
        restore_prompt = f"请继续 {phase_id} 的开发任务。"
        if task_id:
            restore_prompt += f"\n当前子任务: {task_id} — {sub_title}"
        if sub_desc:
            restore_prompt += f"\n任务描述: {sub_desc}"
        restore_prompt += "\n\n上下文过长导致中断，请使用 devplan 工具查询任务状态后继续开发。"

        self.tracker.reset_all()
        return Decision(
            action=Action.NEW_CONVERSATION,
            message=f"上下文溢出，开新对话恢复 {task_id}",
            task_content=restore_prompt,
            task_id=task_id,
            cooldown_seconds=self.context_overflow_wait,
        )

    def _handle_response_stall(self, devplan_data: dict, task_id: str) -> Decision:
        """
        处理 RESPONSE_STALL：累积型中断检测。

        策略：
        1. 先发送"请继续"尝试唤醒
        2. 连续 stall_escalate_threshold 次无效后，升级为 CONTEXT_OVERFLOW 策略
        """
        self.tracker.stall_continue_count += 1

        # 检查是否需要升级
        if self.tracker.stall_continue_count >= self.stall_escalate_threshold:
            logger.warning(
                "🔴 RESPONSE_STALL 连续 %d 次无效（阈值 %d），升级为 CONTEXT_OVERFLOW 策略",
                self.tracker.stall_continue_count,
                self.stall_escalate_threshold,
            )
            self.tracker.stall_continue_count = 0
            return self._handle_context_overflow(devplan_data, task_id)

        # 常规处理：发送"请继续"
        return self._maybe_send_continue(
            f"{task_id} 响应中断（STALL {self.tracker.stall_continue_count}/{self.stall_escalate_threshold}），尝试唤醒"
        )

    def _maybe_send_continue(self, message: str) -> Decision:
        """
        带防抖和重试上限的"发送继续"判断。

        规则：
        1. 同一状态需连续出现 threshold 次才触发
        2. 两次发送之间需满足最小间隔
        3. 连续重试不超过 max_continue_retries 次
        """
        status_key = "CONTINUE_TRIGGER"
        count = self.tracker.increment_status(status_key)

        # 未达到触发阈值
        if count < self.threshold:
            return Decision(
                action=Action.WAIT,
                message=f"{message}（{count}/{self.threshold} 次，等待确认）",
            )

        # 检查重试上限
        if self.tracker.continue_retries >= self.max_continue_retries:
            return Decision(
                action=Action.WAIT,
                message=f"已达到连续重试上限 ({self.max_continue_retries})，暂停发送",
            )

        # 检查发送间隔
        if not self.tracker.can_send(self.min_send_interval):
            return Decision(
                action=Action.WAIT,
                message=f"{message}（发送冷却中）",
            )

        # 执行发送
        self.tracker.continue_retries += 1
        self.tracker.record_send()
        return Decision(
            action=Action.SEND_CONTINUE,
            message=message,
        )

    @staticmethod
    def _format_task_content(task_id: str, title: str, description: str = "") -> str:
        """格式化子任务内容，用于发送给 Cursor"""
        content = f"请开始 {task_id}: {title}"
        if description:
            content += f"\n\n详细要求：{description}"
        return content

    def reset_continue_retries(self) -> None:
        """
        当检测到 AI 恢复活动时重置重试计数和 stall 升级计数。
        应在主循环检测到屏幕从无变化变为有变化时调用。
        """
        if self.tracker.continue_retries > 0 or self.tracker.stall_continue_count > 0:
            logger.info(
                "AI 已恢复活动，重置计数（continue: %d, stall: %d）",
                self.tracker.continue_retries,
                self.tracker.stall_continue_count,
            )
        self.tracker.continue_retries = 0
        self.tracker.stall_continue_count = 0