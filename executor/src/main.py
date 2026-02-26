# -*- coding: utf-8 -*-
"""
DevPlan Executor — 主循环

Autopilot 执行器入口，实现三通道智能检测：
  1. Channel 1: Cursor renderer.log 日志监控 → AI 活动/停止检测（毫秒级）
  2. Channel 2: DevPlan HTTP API → 任务编排状态（有无待发任务、阶段进度）
  3. Channel 3: 截图 + Ollama gemma3:27b 视觉 AI → 8 态 UI 状态分类
  4. 三通道决策引擎联合判断 + 差异化恢复策略
  5. GUI 自动化执行操作 + 心跳上报

启动方式：
  cd executor/
  python -m src.main                          # 默认配置
  python -m src.main --project ai_db          # 指定项目
  python -m src.main --port 3210 --interval 20  # 自定义参数
"""

from __future__ import annotations

import argparse
import gc
import io
import logging
import os
import signal
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Any


def _ensure_utf8_stdio() -> None:
    """确保 stdout/stderr 使用 UTF-8 编码（Windows 中文系统默认 GBK，无法输出 emoji）"""
    if sys.platform == "win32":
        # 设置控制台代码页为 UTF-8
        os.system("chcp 65001 > nul 2>&1")
        for stream_name in ("stdout", "stderr"):
            stream = getattr(sys, stream_name)
            if hasattr(stream, "reconfigure"):
                stream.reconfigure(encoding="utf-8", errors="replace")
            elif hasattr(stream, "buffer"):
                setattr(sys, stream_name, io.TextIOWrapper(
                    stream.buffer, encoding="utf-8", errors="replace",
                    line_buffering=stream.line_buffering,
                ))

from .config import ExecutorConfig, UIStatus, get_config
from .cursor_controller import CursorController
from .devplan_client import DevPlanClient
from .engine import Action, Decision, DualChannelEngine
from .log_monitor import CursorLogMonitor
from .recovery_manager import RecoveryManager
from .ui_server import image_to_base64, set_executor_refs, start_server_thread, ui_state
from .vision_analyzer import VisionAnalyzer

logger = logging.getLogger("executor")


# ── 主循环 ───────────────────────────────────────────────────

class ExecutorLoop:
    """
    Executor 主循环。

    职责：
      1. 轮询 DevPlan HTTP API 获取下一步动作
      2. 调用屏幕分析器获取 UI 状态
      3. 双通道决策引擎联合判断
      4. 执行 GUI 操作
      5. 定期上报心跳
    """

    def __init__(self, config: ExecutorConfig):
        self.config = config
        self.running = False

        # 核心组件
        self.client = DevPlanClient(config)
        self.engine = DualChannelEngine(
            status_trigger_threshold=config.status_trigger_threshold,
            min_send_interval=config.min_send_interval,
            max_continue_retries=config.max_continue_retries,
            auto_start_next_phase=config.auto_start_next_phase,
            fallback_no_change_timeout=config.fallback_no_change_timeout,
            rate_limit_wait=config.rate_limit_wait,
            api_timeout_wait=config.api_timeout_wait,
            context_overflow_wait=config.context_overflow_wait,
            stall_escalate_threshold=config.stall_escalate_threshold,
            network_backoff_base=config.network_backoff_base,
            network_backoff_max=config.network_backoff_max,
            network_backoff_jitter_ratio=config.network_backoff_jitter_ratio,
            circuit_breaker_failure_threshold=config.circuit_breaker_failure_threshold,
            circuit_breaker_open_seconds=config.circuit_breaker_open_seconds,
            network_recovery_window_seconds=config.network_recovery_window_seconds,
            network_recovery_window_cooldown=config.network_recovery_window_cooldown,
        )
        self.analyzer = VisionAnalyzer(config)
        self.gui = CursorController(config)
        self.vision_enabled: bool = not config.disable_vision

        # Channel 1: 日志监控（可选，启用后能跳过不必要的截图分析）
        self.log_monitor: Optional[CursorLogMonitor] = None
        if config.log_monitor_enabled:
            self.log_monitor = CursorLogMonitor(
                idle_threshold=config.log_monitor_idle_threshold,
            )

        # 心跳计时
        self._last_heartbeat_time: float = 0
        self._heartbeat_interval: float = config.poll_interval * 2  # 心跳频率 = 2 倍轮询间隔

        # 上一次的 UI 状态（用于检测状态变化）
        self._prev_ui_status: Optional[UIStatus] = None
        self._last_ui_status: Optional[UIStatus] = None
        self._last_devplan_data: dict = {}
        # 本进程内 dead-letter 去重，避免同一超窗事件在冷却期间重复写入
        self._last_dead_letter_fingerprint: str = ""
        # 本进程内恢复记忆写入去重，避免同一中断点重复写入 summary/insight
        self._last_recovery_memory_fingerprint: str = ""
        # 启动后 checkpoint 恢复去重（避免同一 checkpoint 重复注入）
        self._last_startup_restore_fingerprint: str = ""
        self._all_done_keepalive_logged: bool = False

        # 恢复管理器（checkpoint + last_n_turns 摘要）
        self.recovery = RecoveryManager(
            project_name=config.project_name,
            log_dir=config.log_dir,
        )

        # 周期性资源清理（每 CLEANUP_EVERY_TICKS 个 tick 执行一次）
        self._tick_count: int = 0
        self.CLEANUP_EVERY_TICKS: int = 50  # ~50 ticks ≈ 50*15s ≈ 12.5 分钟

    def start(self) -> None:
        """启动主循环"""
        self.running = True

        # 注册信号处理
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

        self._print_banner()

        # 启动 Web UI 监控面板
        self._ui_thread = None
        if not self.config.no_ui:
            set_executor_refs(gui=self.gui, client=self.client, executor=self)
            ui_state.update(
                running=True,
                executor_id=self.config.executor_id,
                project_name=self.config.project_name,
                poll_interval=self.config.poll_interval,
                split_quadrant=self.config.split_quadrant,
                screenshot_interval=self.config.screenshot_interval,
                vision_enabled=self.vision_enabled,
            )
            self._ui_thread = start_server_thread(
                host="127.0.0.1",
                port=self.config.ui_port,
            )
        else:
            logger.info("Web UI 已禁用 (--no-ui)")

        # 检查 DevPlan 服务可达性
        if not self.client.is_reachable():
            logger.error(
                "无法连接 DevPlan 服务 (%s)，请确认服务已启动",
                self.config.devplan_base_url,
            )
            logger.error("启动方式: 在 aifastdb-devplan 目录下运行 node dist/visualize/server.js --port %d", self.config.devplan_port)
            return

        logger.info("DevPlan 服务已连接: %s", self.config.devplan_base_url)
        if not self.vision_enabled:
            logger.warning("视觉分析已显式禁用（EXECUTOR_DISABLE_VISION=true），将仅依赖日志+DevPlan 通道")

        # 启动后优先尝试从 checkpoint 恢复（T87.4）
        self._attempt_startup_recovery()

        # 启动日志监控（Channel 1）
        if self.log_monitor:
            if self.log_monitor.start():
                logger.info("📊 日志监控已启动（Channel 1: renderer.log）")
            else:
                logger.warning("⚠️ 日志监控启动失败，将仅依赖截图分析")
                self.log_monitor = None

        # 显示初始状态
        self._log_initial_status()

        # 主循环
        logger.info("开始自动化轮询（间隔: %d 秒）...", self.config.poll_interval)
        while self.running:
            try:
                self._tick()
            except Exception as e:
                logger.error("主循环异常: %s", e, exc_info=True)
                time.sleep(10)

            # 等待下次轮询
            self._countdown_wait(self.config.poll_interval)

        # 停止
        self._shutdown()

    def stop(self) -> None:
        """停止主循环"""
        self.running = False

    # ── 主循环单步 ───────────────────────────────────────────

    def _tick(self) -> None:
        """主循环单个执行周期"""
        self._tick_count += 1
        if self._tick_count % self.CLEANUP_EVERY_TICKS == 0:
            self._periodic_cleanup()

        # ── Channel 1: DevPlan 任务状态 ──
        devplan_data = self.client.get_next_action()
        if devplan_data is None:
            logger.warning("DevPlan API 无响应，跳过本轮")
            self._send_heartbeat("active", "API_UNREACHABLE")
            ui_state.add_log("WARNING", "DevPlan API 无响应")
            return

        devplan_action = devplan_data.get("action", "unknown")
        devplan_message = devplan_data.get("message", "")
        if devplan_action != "all_done":
            self._all_done_keepalive_logged = False
        self._last_devplan_data = devplan_data
        self.recovery.record_event(f"DevPlan: action={devplan_action} message={devplan_message[:120]}")
        logger.info(
            "[DevPlan] action=%s | %s",
            devplan_action,
            devplan_message[:80],
        )

        # 提取 DevPlan 子任务/阶段信息用于 UI 更新
        sub_task = devplan_data.get("subTask") or {}
        phase_info = devplan_data.get("phase") or {}
        ui_update_devplan: dict = {
            "devplan_action": devplan_action,
            "devplan_message": devplan_message,
            "current_task_id": sub_task.get("taskId", ""),
            "current_task_title": sub_task.get("title", ""),
        }
        # 更新当前阶段信息（来自 next-action 返回的 phase 字段）
        if phase_info:
            completed = phase_info.get("completedSubtasks", 0)
            total = phase_info.get("totalSubtasks", 0)
            ui_update_devplan["current_phase"] = phase_info.get("taskId", "")
            ui_update_devplan["current_phase_title"] = phase_info.get("title", "")
            ui_update_devplan["phase_progress"] = f"{completed}/{total}"
        ui_state.update(**ui_update_devplan)

        # ── Channel 1.5: 日志监控（快速判断 AI 是否活跃）──
        log_ai_active = False
        if self.log_monitor:
            log_state = self.log_monitor.poll()
            log_ai_active = log_state.is_ai_active
            if log_state.log_file_found:
                logger.info(
                    "[LogMonitor] AI活跃=%s | 空闲%.0fs | pending=%d | 错误=%d",
                    log_ai_active,
                    log_state.idle_seconds if log_state.idle_seconds != float("inf") else -1,
                    log_state.pending_tool_calls,
                    len(log_state.recent_errors),
                )
                ui_state.update(
                    log_monitor_active=log_ai_active,
                    log_monitor_idle=log_state.idle_seconds if log_state.idle_seconds != float("inf") else -1,
                    log_monitor_pending=log_state.pending_tool_calls,
                )
                # 日志检测到网络错误 → 提前预警
                if log_state.recent_errors:
                    logger.warning(
                        "[LogMonitor] 检测到 %d 个近期网络错误",
                        len(log_state.recent_errors),
                    )

        # ── Channel 2: 屏幕 UI 状态 ──
        # 如果日志监控确认 AI 活跃，可以跳过昂贵的 Ollama 截图分析
        if log_ai_active and devplan_action == "wait":
            # AI 在活跃工作 → 跳过截图分析，直接用 IDLE + screen_changing=True
            ui_status = UIStatus.AI_GENERATING
            screen_changing = True
            raw_response = "[LogMonitor] AI 活跃，跳过截图分析"
            logger.info("[Screen] 日志监控确认 AI 活跃，跳过 Ollama 分析（节省 GPU）")
        else:
            if self.vision_enabled:
                ui_status, screen_changing, raw_response = self.analyzer.analyze()
            else:
                ui_status = UIStatus.UNKNOWN
                screen_changing = False
                raw_response = "[VisionDisabled] 已禁用截图分析（需要 ollama + gemma3:27b）"

        change_str = "有变化" if screen_changing else "无变化"
        logger.info(
            "[Screen] status=%s | 屏幕%s | %s",
            ui_status.value,
            change_str,
            raw_response[:60] if raw_response else "",
        )
        self._last_ui_status = ui_status
        self.recovery.record_event(f"UI: status={ui_status.value} changing={screen_changing}")

        # 更新 Web UI — 视觉通道状态 + 截图
        ui_update: dict = {
            "ui_status": ui_status.value,
            "screen_changing": screen_changing,
            "raw_response": raw_response or "[empty]",
            "screenshot_time_1": getattr(self.analyzer, "screenshot_time_1", ""),
            "screenshot_time_2": getattr(self.analyzer, "screenshot_time_2", ""),
            "split_quadrant": self.config.split_quadrant,
            "vision_enabled": self.vision_enabled,
            "top_right_changed": getattr(self.analyzer, "last_top_right_changed", None),
            "bottom_right_changed": getattr(self.analyzer, "last_bottom_right_changed", None),
        }
        # 截图 base64（如果文件存在）
        log_dir = Path(self.config.log_dir)
        ss1 = str(log_dir / "snapshot_1.png")
        ss2 = str(log_dir / "snapshot_2.png")
        if Path(ss1).exists():
            ui_update["screenshot_base64_1"] = image_to_base64(ss1)
        if Path(ss2).exists():
            ui_update["screenshot_base64_2"] = image_to_base64(ss2)
        # 四象限模式：附加四象限截图及各象限判断结果
        if self.config.split_quadrant:
            quad_tl = str(log_dir / "quad_top_left.png")
            quad_tr = str(log_dir / "quad_top_right.png")
            quad_bl = str(log_dir / "quad_bottom_left.png")
            quad_br = str(log_dir / "quad_bottom_right.png")
            if Path(quad_tl).exists():
                ui_update["quad_top_left_b64"] = image_to_base64(quad_tl)
            if Path(quad_tr).exists():
                ui_update["quad_top_right_b64"] = image_to_base64(quad_tr)
            if Path(quad_bl).exists():
                ui_update["quad_bottom_left_b64"] = image_to_base64(quad_bl)
            if Path(quad_br).exists():
                ui_update["quad_bottom_right_b64"] = image_to_base64(quad_br)
            ui_update["quad_top_right_status"] = getattr(self.analyzer, "last_quad_top_right_status", "")
            ui_update["quad_bottom_right_status"] = getattr(self.analyzer, "last_quad_bottom_right_status", "")
        ui_state.update(**ui_update)

        # 检测 AI 恢复工作状态 → 重置 continue 重试计数
        # UIStatus 没有 WORKING，使用 screen_changing 作为"AI 在工作"的信号：
        # 上轮屏幕无变化 + 本轮屏幕有变化 → AI 恢复活动
        prev_was_idle = (
            self._prev_ui_status is not None
            and self._prev_ui_status in (UIStatus.IDLE, UIStatus.UNKNOWN)
        )
        if prev_was_idle and screen_changing:
            self.engine.reset_continue_retries()
        self._prev_ui_status = ui_status

        # ── 获取右下角无变化时长（3 分钟兜底策略） ──
        br_no_change_seconds = self.analyzer.seconds_since_br_changed if self.vision_enabled else 0.0
        if br_no_change_seconds > 60:  # 超过 1 分钟才记录
            logger.info(
                "[兜底] 右下角截图已 %.0f 秒无变化（阈值: %d 秒）",
                br_no_change_seconds,
                self.config.fallback_no_change_timeout,
            )

        # ── 双通道决策 ──
        decision = self.engine.decide(devplan_data, ui_status, screen_changing, br_no_change_seconds)
        logger.info(
            "[Decision] action=%s | %s",
            decision.action.value,
            decision.message[:80],
        )
        self.recovery.record_event(f"Decision: action={decision.action.value} message={decision.message[:120]}")

        # 更新 Web UI — 决策结果
        ui_state.update(
            decision_action=decision.action.value,
            decision_message=decision.message,
            continue_retries=self.engine.tracker.continue_retries,
        )
        ui_state.add_log("INFO", f"[{devplan_action}|{ui_status.value}] → {decision.action.value}: {decision.message[:60]}")

        # ── 执行决策 ──
        self._execute(decision)

        # ── 心跳上报 ──
        self._send_heartbeat("active", ui_status.value)

    def _execute(self, decision: Decision) -> None:
        """执行决策动作"""

        if decision.action == Action.SEND_TASK:
            if decision.task_content and self.gui.available:
                result = self.gui.send_task(decision.task_content)
                if result.success:
                    logger.info("✅ 已发送子任务: %s%s", decision.task_id, " (排队)" if result.queued else "")
                    self._post_send_vision_check(source_label=f"task:{decision.task_id or ''}")
                else:
                    logger.error("❌ 发送子任务失败: %s — %s", decision.task_id, result.message)
            else:
                logger.warning("GUI 不可用或无任务内容，跳过发送")

        elif decision.action == Action.SEND_CONTINUE:
            if self.gui.available:
                result = self.gui.send_continue()
                if result.success:
                    logger.info("✅ 已发送继续指令")
                    self._post_send_vision_check(source_label="continue")
                else:
                    logger.error("❌ 发送继续指令失败: %s", result.message)

        elif decision.action == Action.START_PHASE:
            if decision.phase_id:
                result = self.client.start_phase(decision.phase_id)
                if result and result.get("success"):
                    logger.info("✅ 已启动阶段: %s", decision.phase_id)
                else:
                    logger.error("❌ 启动阶段失败: %s", decision.phase_id)

        elif decision.action == Action.ALL_DONE:
            if self.config.keep_alive_on_all_done:
                # Dev-only behavior: keep executor alive even when project reports all_done.
                if not self._all_done_keepalive_logged:
                    logger.warning("🧪 检测到 all_done，但已启用保活开关，Executor 将继续运行用于调试")
                    self._all_done_keepalive_logged = True
                ui_state.update(
                    decision_action="WAIT",
                    decision_message=f"all_done（调试保活开启）: {decision.message}",
                )
            else:
                logger.info("🎉 %s", decision.message)
                self.running = False

        elif decision.action == Action.WAIT:
            logger.debug("⏳ %s", decision.message)

        elif decision.action == Action.NEW_CONVERSATION:
            # 上下文溢出：先固化 checkpoint + 记忆，再 Ctrl+L 恢复
            logger.warning("🔴 执行新对话恢复流程（CONTEXT_OVERFLOW）")
            phase = self._last_devplan_data.get("phase", {}) if isinstance(self._last_devplan_data, dict) else {}
            sub_task = self._last_devplan_data.get("subTask", {}) if isinstance(self._last_devplan_data, dict) else {}
            phase_id = phase.get("taskId", "")
            phase_title = phase.get("title", "")
            task_id = sub_task.get("taskId", decision.task_id or "")
            task_title = sub_task.get("title", "")
            task_desc = sub_task.get("description", "")
            interrupt_reason = (self._last_ui_status.value if self._last_ui_status else "CONTEXT_OVERFLOW")

            # 1) recall_unified 补全关键记忆（中断时用于 checkpoint 组装）
            recalled_lines = self._recall_recovery_memories(
                phase_id=phase_id,
                task_id=task_id,
                interrupt_reason=interrupt_reason,
                limit=5,
            )

            # 2) 生成并持久化 checkpoint_prompt
            cp = self.recovery.create_and_persist_checkpoint(
                phase_id=phase_id,
                phase_title=phase_title,
                task_id=task_id,
                task_title=task_title,
                task_desc=task_desc,
                interrupt_reason=interrupt_reason,
                recalled_memories=recalled_lines,
            )

            # 3) 中断摘要写入长期记忆（summary + insight）
            self._save_recovery_memories(
                checkpoint=cp,
                phase_id=phase_id,
                task_id=task_id,
                interrupt_reason=interrupt_reason,
            )

            if self.gui.available:
                latest = self.recovery.load_checkpoint() or cp
                latest_recall_lines = self._recall_recovery_memories(
                    phase_id=phase_id,
                    task_id=task_id,
                    interrupt_reason=interrupt_reason,
                    limit=5,
                )

                base_prompt = self.recovery.load_latest_checkpoint_prompt() or latest.checkpoint_prompt
                final_prompt = self.recovery.build_final_recovery_prompt(
                    checkpoint=latest,
                    recalled_memories=latest_recall_lines,
                    base_checkpoint_prompt=base_prompt,
                )

                self._inject_recovery_prompt(
                    final_prompt=final_prompt,
                    wait_sec=decision.cooldown_seconds or 3,
                    source_label="new_conversation",
                    fallback_to_continue=True,
                )
            ui_state.add_log("WARNING", f"新对话恢复: {decision.message[:60]}")

        elif decision.action == Action.WAIT_COOLDOWN:
            # 限流/超时：等待冷却期
            wait_sec = decision.cooldown_seconds or 60
            logger.warning("⏳ 限流冷却等待 %d 秒...", wait_sec)
            ui_state.add_log("WARNING", f"限流等待 {wait_sec}s: {decision.message[:60]}")
            # 用 countdown 方式等待，允许中途停止
            self._countdown_wait(wait_sec)

        elif decision.action == Action.ERROR_RECOVERY:
            wait_sec = decision.cooldown_seconds or 120
            logger.error("🚨 错误恢复保护模式: %s", decision.message)
            ui_state.add_log("ERROR", f"错误恢复保护等待 {wait_sec}s: {decision.message[:80]}")
            # 写入 dead-letter，便于后续排障与人工接管
            phase = self._last_devplan_data.get("phase", {}) if isinstance(self._last_devplan_data, dict) else {}
            sub_task = self._last_devplan_data.get("subTask", {}) if isinstance(self._last_devplan_data, dict) else {}
            phase_id = phase.get("taskId", "")
            task_id = sub_task.get("taskId", "")
            reason = (self._last_ui_status.value if self._last_ui_status else "ERROR_RECOVERY")
            fingerprint = f"{phase_id}|{task_id}|{reason}|{decision.message[:120]}"
            if fingerprint != self._last_dead_letter_fingerprint:
                self._last_dead_letter_fingerprint = fingerprint
                self.client.save_dead_letter(
                    reason=reason,
                    message=decision.message,
                    phase_id=phase_id or None,
                    task_id=task_id or None,
                    retry_after_seconds=wait_sec,
                    metadata={
                        "decisionAction": decision.action.value,
                        "executorId": self.config.executor_id,
                    },
                )
            # 超窗后不再继续打 continue，进入保护性冷却，等待外部环境恢复
            self._countdown_wait(wait_sec)

    def _save_recovery_memories(
        self,
        checkpoint: Any,
        phase_id: str,
        task_id: str,
        interrupt_reason: str,
    ) -> None:
        """
        在中断恢复点同步写入 summary + insight 记忆。
        - 进程内按 fingerprint 去重
        - 单次失败自动重试 1 次（best effort，不阻塞主流程）
        """
        summary_text = str(getattr(checkpoint, "last_n_turns_summary", "") or "").strip()
        if not summary_text:
            return

        cp_ts = str(getattr(checkpoint, "timestamp", "") or "")
        fingerprint = f"{phase_id}|{task_id}|{interrupt_reason}|{cp_ts}"
        if fingerprint == self._last_recovery_memory_fingerprint:
            logger.debug("跳过重复恢复记忆写入: %s", fingerprint)
            return

        self._last_recovery_memory_fingerprint = fingerprint

        def _save_with_retry(payload: dict[str, Any], retries: int = 1) -> bool:
            for i in range(retries + 1):
                resp = self.client.save_memory(**payload)
                if resp:
                    return True
                if i < retries:
                    logger.warning("memory_save 失败，准备重试 (%d/%d)", i + 1, retries)
                    time.sleep(0.2)
            return False

        template_ver = str(getattr(checkpoint, "template_version", "v1") or "v1")
        compact_summary = summary_text[:1200]
        summary_payload = {
            "content": f"[{interrupt_reason}] {compact_summary}",
            "memory_type": "summary",
            "related_task_id": phase_id or None,
            "tags": ["autopilot", "recovery", "last_n_turns", f"template-{template_ver}"],
            "importance": 0.78,
        }
        insight_payload = {
            "content": (
                f"中断恢复检查点：phase={phase_id} task={task_id} reason={interrupt_reason}，"
                f"checkpoint_prompt({template_ver}) 已生成并准备恢复。"
            ),
            "memory_type": "insight",
            "related_task_id": phase_id or None,
            "tags": ["autopilot", "checkpoint", "context-overflow", f"template-{template_ver}"],
            "importance": 0.82,
        }

        ok1 = _save_with_retry(summary_payload, retries=1)
        ok2 = _save_with_retry(insight_payload, retries=1)
        if not (ok1 and ok2):
            logger.warning("恢复记忆写入存在失败（summary=%s insight=%s）", ok1, ok2)

    def _attempt_startup_recovery(self) -> None:
        """
        T87.4: Executor 重启后读取 checkpoint 并尝试恢复。
        条件：
        - GUI 可用
        - 存在 checkpoint
        - 当前存在活跃阶段（避免对 all_done 项目误注入）
        """
        if not self.gui.available:
            logger.info("跳过启动恢复：GUI 不可用")
            return

        cp = self.recovery.load_checkpoint()
        if not cp:
            return

        phase = self.client.get_current_phase() or {}
        if not phase.get("hasActivePhase"):
            logger.info("跳过启动恢复：当前无进行中阶段")
            return

        cp_ts = str(getattr(cp, "timestamp", "") or "")
        fp = f"{cp_ts}|{cp.phase_id}|{cp.task_id}|{cp.interrupt_reason}"
        if fp == self._last_startup_restore_fingerprint:
            logger.debug("跳过重复启动恢复: %s", fp)
            return
        self._last_startup_restore_fingerprint = fp

        latest_recall_lines = self._recall_recovery_memories(
            phase_id=cp.phase_id,
            task_id=cp.task_id,
            interrupt_reason=cp.interrupt_reason,
            limit=5,
        )

        base_prompt = self.recovery.load_latest_checkpoint_prompt() or cp.checkpoint_prompt or ""
        final_prompt = self.recovery.build_final_recovery_prompt(
            checkpoint=cp,
            recalled_memories=latest_recall_lines,
            base_checkpoint_prompt=base_prompt,
        )
        if not final_prompt.strip():
            return

        ok = self._inject_recovery_prompt(
            final_prompt=final_prompt,
            wait_sec=2,
            source_label="startup",
            fallback_to_continue=False,
        )
        if ok:
            logger.info("✅ 启动恢复已注入 checkpoint_prompt（task=%s）", cp.task_id)
            ui_state.add_log("WARNING", f"启动恢复已注入: {cp.phase_id}/{cp.task_id}")

    def _recall_recovery_memories(
        self,
        phase_id: str,
        task_id: str,
        interrupt_reason: str,
        limit: int = 5,
    ) -> list[str]:
        """
        T88.2: 统一恢复召回入口，按 task+error（附加 phase）构造查询并提取 2~5 条记忆文本。
        """
        parts = [phase_id.strip(), task_id.strip(), interrupt_reason.strip(), "recovery"]
        query = " ".join(p for p in parts if p)
        if not query:
            return []

        resp = self.client.recall_unified(query, limit=max(2, min(limit, 5)), depth="L1", min_score=0.0)
        lines: list[str] = []
        if resp and isinstance(resp, dict):
            for item in (resp.get("memories") or [])[: max(2, min(limit, 5))]:
                content = str(item.get("content", "")).strip()
                if content:
                    lines.append(content[:200])
        return lines

    def _inject_recovery_prompt(
        self,
        final_prompt: str,
        wait_sec: int,
        source_label: str,
        fallback_to_continue: bool,
    ) -> bool:
        """
        T88.4: 统一恢复提示注入流程（开新对话 -> 等待 -> 发送）。
        """
        if not self.gui.available:
            logger.warning("跳过恢复注入（%s）：GUI 不可用", source_label)
            return False
        if not final_prompt.strip():
            logger.warning("跳过恢复注入（%s）：prompt 为空", source_label)
            return False

        result = self.gui.new_conversation()
        if not result.success:
            logger.error("❌ 开新对话失败（%s）: %s", source_label, result.message)
            if fallback_to_continue:
                self.gui.send_continue()
            return False

        wait_sec = max(1, int(wait_sec or 1))
        logger.info("⏳ 恢复注入（%s）：等待 %d 秒让新对话就绪...", source_label, wait_sec)
        time.sleep(wait_sec)

        result2 = self.gui.send_task(final_prompt)
        if result2.success:
            logger.info("✅ 恢复提示已注入（%s）", source_label)
            self._post_send_vision_check(source_label=f"{source_label}:recovery-prompt")
            return True

        logger.error("❌ 发送恢复提示失败（%s）: %s", source_label, result2.message)
        return False

    def _post_send_vision_check(self, source_label: str) -> None:
        """
        发送后 1 秒快速右下象限检测：
        若识别到 queued/waiting，则补按一次 Enter。
        """
        if not self.vision_enabled:
            return
        if not getattr(self.analyzer, "available", False):
            return
        if not self.gui.available:
            return
        try:
            queued, detail = self.analyzer.check_send_queued_after_delay(delay_seconds=1.0)
            logger.info("[%s] 发送后快速检测: queued=%s | %s", source_label, queued, detail)
            if queued:
                if self.gui.press_key("enter"):
                    logger.warning("[%s] 检测到 queued/waiting，已补按 Enter", source_label)
                else:
                    logger.warning("[%s] 检测到 queued/waiting，但补按 Enter 失败", source_label)
        except Exception as e:
            logger.warning("[%s] 发送后快速视觉检测失败: %s", source_label, e)

    # ── 心跳 ─────────────────────────────────────────────────

    def _send_heartbeat(self, status: str, last_screen_state: str) -> None:
        """定期上报心跳"""
        now = time.time()
        if now - self._last_heartbeat_time < self._heartbeat_interval:
            return
        self._last_heartbeat_time = now

        result = self.client.heartbeat(
            executor_id=self.config.executor_id,
            status=status,
            last_screen_state=last_screen_state,
        )
        if result:
            logger.debug("心跳已上报: %s", status)
        else:
            logger.warning("心跳上报失败")

    # ── 辅助 ─────────────────────────────────────────────────

    def _log_initial_status(self) -> None:
        """显示初始项目状态，并同步更新 Web UI"""
        progress = self.client.get_progress()
        if progress:
            overall_pct = progress.get("overallPercent", 0)
            logger.info(
                "项目: %s | 总进度: %s%% | 主任务: %d | 子任务: %d/%d",
                progress.get("projectName", "?"),
                overall_pct,
                progress.get("mainTaskCount", 0),
                progress.get("completedSubTasks", 0),
                progress.get("subTaskCount", 0),
            )
            ui_state.update(overall_progress=f"{overall_pct}%")
            ui_state.add_log("INFO", f"项目总进度: {overall_pct}%")

        phase = self.client.get_current_phase()
        if phase and phase.get("hasActivePhase"):
            ap = phase.get("activePhase") or phase.get("phase", {})
            phase_id = ap.get("taskId", "?")
            phase_title = ap.get("title", "?")
            completed = ap.get("completedSubtasks", 0)
            total = ap.get("totalSubtasks", 0)
            logger.info(
                "当前阶段: %s — %s (%d/%d)",
                phase_id, phase_title, completed, total,
            )
            ui_state.update(
                current_phase=phase_id,
                current_phase_title=phase_title,
                phase_progress=f"{completed}/{total}",
            )
            ui_state.add_log("INFO", f"当前阶段: {phase_id} — {phase_title} ({completed}/{total})")
        else:
            logger.info("当前无进行中的阶段")
            ui_state.add_log("INFO", "当前无进行中的阶段")

    def _periodic_cleanup(self) -> None:
        """
        周期性资源清理：GC + 内存监控日志。
        每 CLEANUP_EVERY_TICKS 个 tick 调用一次，防止长时间运行后内存泄漏。
        """
        # 1) 强制垃圾回收
        collected = gc.collect()

        # 2) 记录进程内存使用（需要 psutil，可选）
        rss_mb = "N/A"
        try:
            import psutil
            proc = psutil.Process(os.getpid())
            rss_mb_val = proc.memory_info().rss / (1024 * 1024)
            rss_mb = f"{rss_mb_val:.1f}"
        except ImportError:
            pass
        except Exception:
            pass

        logger.info(
            "[Cleanup] tick=%d | GC collected=%d | RSS=%s MB",
            self._tick_count, collected, rss_mb,
        )

    def _countdown_wait(self, seconds: int) -> None:
        """倒计时等待，支持中断。通知前端开始客户端倒计时。"""
        # 通知前端：倒计时开始（前端用 JS 定时器本地倒计时）
        ui_state.update(next_tick_countdown=seconds)
        for remaining in range(seconds, 0, -1):
            if not self.running:
                break
            time.sleep(1)
        # 通知前端：倒计时结束，即将开始截图分析
        ui_state.update(next_tick_countdown=0)

    def _signal_handler(self, signum: int, frame: object) -> None:
        """信号处理器"""
        logger.info("收到停止信号 (%s)，正在退出...", signum)
        self.running = False

    def _shutdown(self) -> None:
        """清理退出"""
        logger.info("正在停止 Executor...")
        # 停止日志监控
        if self.log_monitor:
            self.log_monitor.stop()
        # 更新 Web UI 状态
        ui_state.update(running=False, decision_action="STOPPED", decision_message="Executor 已停止")
        ui_state.add_log("INFO", "Executor 正在停止...")
        # 发送停止心跳
        self.client.heartbeat(
            executor_id=self.config.executor_id,
            status="stopped",
        )
        self.client.close()
        logger.info("Executor 已停止")

    def set_vision_enabled(self, enabled: bool) -> tuple[bool, str]:
        """运行时切换视觉分析分支开关（用于 Web UI 配置开关）"""
        self.vision_enabled = bool(enabled)
        self.config.disable_vision = not self.vision_enabled
        ui_state.update(vision_enabled=self.vision_enabled)
        if self.vision_enabled:
            return True, "已启用截图分析（需要 ollama + gemma3:27b）"
        return True, "已关闭截图分析（降级为日志+DevPlan 通道）"

    def _print_banner(self) -> None:
        """打印启动横幅"""
        web_ui_info = f"http://127.0.0.1:{self.config.ui_port}" if not self.config.no_ui else "❌ 已禁用"
        banner = f"""
╔══════════════════════════════════════════════════════════════╗
║          DevPlan Executor — Autopilot v{__import__('src').__version__:<20s}║
║                                                              ║
║  项目:     {self.config.project_name:<49s}║
║  DevPlan:  {self.config.devplan_base_url:<49s}║
║  Executor: {self.config.executor_id:<49s}║
║  轮询间隔: {str(self.config.poll_interval) + ' 秒':<48s}║
║  all_done: {'🧪 调试保活开启' if self.config.keep_alive_on_all_done else '✅ 自动停机(默认)':<48s}║
║  视觉模型: {self.config.model_name:<49s}║
║  截图分析: {('🛑 已禁用(配置)' if not self.vision_enabled else ('✅ 可用' if self.analyzer.available else '❌ 不可用')):<48s}║
║  四象限:   {'✅ 右上+右下 (左' + str(int(self.config.quadrant_left_ratio*100)) + '%裁剪)' if self.config.split_quadrant else '❌ 全屏模式':<48s}║
║  GUI控制:  {'✅ 可用' if self.gui.available else '❌ 不可用':<48s}║
║  Web UI:   {web_ui_info:<49s}║
╚══════════════════════════════════════════════════════════════╝"""
        print(banner)


# ── 日志配置 ─────────────────────────────────────────────────

def setup_logging(config: ExecutorConfig) -> None:
    """配置日志系统（带轮转，防止日志文件无限增长）"""
    from logging.handlers import RotatingFileHandler

    log_dir = Path(config.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)

    handlers: list[logging.Handler] = [
        logging.StreamHandler(sys.stdout),
        RotatingFileHandler(
            str(config.log_file),
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=3,              # 保留 3 个备份：executor.log.1, .2, .3
            encoding="utf-8",
        ),
    ]

    logging.basicConfig(
        level=getattr(logging, config.log_level.upper(), logging.INFO),
        format="[%(asctime)s] [%(levelname)s] %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=handlers,
    )


# ── CLI 入口 ─────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description="DevPlan Executor — Cursor IDE 无人值守自动化引擎",
    )
    parser.add_argument(
        "--project", "-p",
        dest="project_name",
        help="目标项目名（默认: ai_db）",
    )
    parser.add_argument(
        "--host",
        dest="devplan_host",
        help="DevPlan 服务主机（默认: 127.0.0.1）",
    )
    parser.add_argument(
        "--port",
        dest="devplan_port",
        type=int,
        help="DevPlan 服务端口（默认: 3210）",
    )
    parser.add_argument(
        "--interval",
        dest="poll_interval",
        type=int,
        help="轮询间隔（秒，默认: 15）",
    )
    parser.add_argument(
        "--model",
        dest="model_name",
        help="Ollama 视觉模型名称（默认: gemma3:27b）",
    )
    parser.add_argument(
        "--executor-id",
        dest="executor_id",
        help="Executor 实例 ID（默认: executor-1）",
    )
    parser.add_argument(
        "--no-gui",
        action="store_true",
        help="禁用 GUI 自动化（仅监控模式）",
    )
    parser.add_argument(
        "--ui-port",
        dest="ui_port",
        type=int,
        help="Web UI 监控面板端口（默认: 5000）",
    )
    parser.add_argument(
        "--no-ui",
        action="store_true",
        dest="no_ui",
        help="禁用 Web UI 监控面板",
    )
    parser.add_argument(
        "--no-split",
        action="store_true",
        dest="no_split",
        help="禁用四象限分割（使用全屏截图模式）",
    )
    parser.add_argument(
        "--disable-vision",
        action="store_true",
        dest="disable_vision",
        help="显式禁用截图+视觉分析分支（无 Ollama 机器建议开启）",
    )
    parser.add_argument(
        "--keep-alive-on-all-done",
        action="store_true",
        dest="keep_alive_on_all_done",
        help="调试开关：收到 all_done 时保持运行（默认关闭，仍自动停机）",
    )
    parser.add_argument(
        "--left-ratio",
        dest="quadrant_left_ratio",
        type=float,
        help="左侧裁剪比例（默认: 0.35 表示左 35%% 为边栏）",
    )
    parser.add_argument(
        "--log-level",
        dest="log_level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="日志级别（默认: INFO）",
    )
    return parser.parse_args()


def main() -> None:
    """程序主入口"""
    _ensure_utf8_stdio()
    args = parse_args()

    # 加载配置：文件 → 环境变量 → 命令行参数
    config = get_config()

    # 命令行参数覆盖（布尔 flag 特殊处理：仅在为 True 时覆盖）
    bool_flags = {"no_gui", "no_ui", "no_split", "disable_vision", "keep_alive_on_all_done"}
    overrides = {}
    for k, v in vars(args).items():
        if k in bool_flags:
            if v:  # 仅当 flag 开启时才覆盖
                overrides[k] = v
        elif v is not None:
            overrides[k] = v
    # --no-split → split_quadrant=False
    if overrides.pop("no_split", False):
        overrides["split_quadrant"] = False
    if overrides:
        config = config.model_copy(update=overrides)

    # 设置日志
    setup_logging(config)

    # 启动主循环
    loop = ExecutorLoop(config)
    loop.start()


if __name__ == "__main__":
    main()
