# -*- coding: utf-8 -*-
"""
DevPlan Executor — 主循环

Autopilot 执行器入口，实现：
  1. 轮询 DevPlan HTTP API 获取任务状态
  2. 截图 + 视觉 AI 识别 UI 状态
  3. 双通道决策引擎联合判断
  4. GUI 自动化执行操作
  5. 心跳上报

启动方式：
  cd executor/
  python -m src.main                          # 默认配置
  python -m src.main --project ai_db          # 指定项目
  python -m src.main --port 3210 --interval 20  # 自定义参数
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import signal
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional


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
        )
        self.analyzer = VisionAnalyzer(config)
        self.gui = CursorController(config)

        # 心跳计时
        self._last_heartbeat_time: float = 0
        self._heartbeat_interval: float = config.poll_interval * 2  # 心跳频率 = 2 倍轮询间隔

        # 上一次的 UI 状态（用于检测状态变化）
        self._prev_ui_status: Optional[UIStatus] = None

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
            set_executor_refs(gui=self.gui, client=self.client)
            ui_state.update(
                running=True,
                executor_id=self.config.executor_id,
                project_name=self.config.project_name,
                poll_interval=self.config.poll_interval,
                split_quadrant=self.config.split_quadrant,
                screenshot_interval=self.config.screenshot_interval,
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

        # ── Channel 1: DevPlan 任务状态 ──
        devplan_data = self.client.get_next_action()
        if devplan_data is None:
            logger.warning("DevPlan API 无响应，跳过本轮")
            self._send_heartbeat("active", "API_UNREACHABLE")
            ui_state.add_log("WARNING", "DevPlan API 无响应")
            return

        devplan_action = devplan_data.get("action", "unknown")
        devplan_message = devplan_data.get("message", "")
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

        # ── Channel 2: 屏幕 UI 状态 ──
        ui_status, screen_changing, raw_response = self.analyzer.analyze()
        change_str = "有变化" if screen_changing else "无变化"
        logger.info(
            "[Screen] status=%s | 屏幕%s | %s",
            ui_status.value,
            change_str,
            raw_response[:60] if raw_response else "",
        )

        # 更新 Web UI — 视觉通道状态 + 截图
        ui_update: dict = {
            "ui_status": ui_status.value,
            "screen_changing": screen_changing,
            "raw_response": raw_response,
            "screenshot_time_1": getattr(self.analyzer, "screenshot_time_1", ""),
            "screenshot_time_2": getattr(self.analyzer, "screenshot_time_2", ""),
            "split_quadrant": self.config.split_quadrant,
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
        br_no_change_seconds = self.analyzer.seconds_since_br_changed
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
                else:
                    logger.error("❌ 发送子任务失败: %s — %s", decision.task_id, result.message)
            else:
                logger.warning("GUI 不可用或无任务内容，跳过发送")

        elif decision.action == Action.SEND_CONTINUE:
            if self.gui.available:
                result = self.gui.send_continue()
                if result.success:
                    logger.info("✅ 已发送继续指令")
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
            logger.info("🎉 %s", decision.message)
            self.running = False

        elif decision.action == Action.WAIT:
            logger.debug("⏳ %s", decision.message)

        elif decision.action == Action.ERROR_RECOVERY:
            if self.gui.available:
                result = self.gui.send_continue()
                logger.info("🔧 错误恢复: %s", result.message if result.success else f"失败 — {result.message}")

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
║  视觉模型: {self.config.model_name:<49s}║
║  截图分析: {'✅ 可用' if self.analyzer.available else '❌ 不可用':<48s}║
║  四象限:   {'✅ 右上+右下 (左' + str(int(self.config.quadrant_left_ratio*100)) + '%裁剪)' if self.config.split_quadrant else '❌ 全屏模式':<48s}║
║  GUI控制:  {'✅ 可用' if self.gui.available else '❌ 不可用':<48s}║
║  Web UI:   {web_ui_info:<49s}║
╚══════════════════════════════════════════════════════════════╝"""
        print(banner)


# ── 日志配置 ─────────────────────────────────────────────────

def setup_logging(config: ExecutorConfig) -> None:
    """配置日志系统"""
    log_dir = Path(config.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)

    handlers: list[logging.Handler] = [
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(
            str(config.log_file),
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
    bool_flags = {"no_gui", "no_ui", "no_split"}
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
