# -*- coding: utf-8 -*-
"""
DevPlan Executor — Cursor 日志监控模块 (Channel 1)

监控 Cursor 的 renderer.log，实时追踪 AI 活动状态：
  - ToolCall start/end 事件 → 判断 AI 是否在工作
  - 网络错误日志 → 提前发现 ECONNRESET / TLS / Socket 错误
  - 空闲时间统计 → AI 停止工作后经过的秒数

日志路径: %APPDATA%/Cursor/logs/{latest_session}/window1/renderer.log

与截图分析形成互补：
  - 日志监控 = 快速（毫秒级）、精确、低资源
  - 截图分析 = 慢（秒级）、视觉感知、高 GPU
  - AI 活跃时跳过截图 → 节省 80% GPU 调用
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class LogEventType(str, Enum):
    """日志事件类型"""
    TOOL_CALL_START = "TOOL_CALL_START"        # AI 发起了工具调用
    TOOL_CALL_END = "TOOL_CALL_END"            # 工具调用完成
    TOOL_CALL_FAILED = "TOOL_CALL_FAILED"      # 工具调用传输失败
    NETWORK_ERROR = "NETWORK_ERROR"            # 网络级错误 (ECONNRESET / TLS / socket)
    UNKNOWN = "UNKNOWN"


@dataclass
class LogEvent:
    """一条解析后的日志事件"""
    event_type: LogEventType
    timestamp: float           # 事件时间 (time.time())
    raw_line: str              # 原始日志行
    detail: str = ""           # 额外信息（如工具名、错误类型）


@dataclass
class LogMonitorState:
    """日志监控器的实时状态快照"""
    is_ai_active: bool = False            # AI 是否正在工作
    idle_seconds: float = 0.0             # AI 停止工作已经过的秒数
    last_tool_call_time: float = 0.0      # 最后一次 ToolCall 事件时间
    pending_tool_calls: int = 0           # 正在进行中的 ToolCall 数量
    recent_errors: list[LogEvent] = field(default_factory=list)  # 最近 60s 内的网络错误
    total_tool_calls: int = 0             # 累计 ToolCall 数量
    total_errors: int = 0                 # 累计错误数量
    log_file_found: bool = False          # 是否找到了日志文件


# ── 日志解析正则 ──────────────────────────────────────────────

# ToolCallEventService: Tracked tool call start - {id} ({tool_name})
RE_TOOL_CALL_START = re.compile(
    r"Tracked tool call start - (\S+)\s+\(([^)]+)\)"
)

# ToolCallEventService: Tracked tool call end - {id}
RE_TOOL_CALL_END = re.compile(
    r"Tracked tool call end - (\S+)"
)

# ToolCallEventService: Failed to send tool call event
RE_TOOL_CALL_FAILED = re.compile(
    r"Failed to send tool call"
)

# [error] [aborted] read ECONNRESET / socket hang up / TLS connection
RE_NETWORK_ERROR = re.compile(
    r"\[error\].*(?:ECONNRESET|socket hang up|TLS connection|ETIMEDOUT|ENOTFOUND)",
    re.IGNORECASE,
)


class CursorLogMonitor:
    """
    Cursor renderer.log 日志监控器。

    通过 tail 方式增量读取 renderer.log，解析 ToolCall 事件和网络错误，
    提供 AI 活动状态的实时判断。

    用法:
        monitor = CursorLogMonitor()
        monitor.start()  # 查找日志文件
        state = monitor.poll()  # 每轮循环调用
        if state.is_ai_active:
            # AI 在工作，跳过截图分析
        elif state.idle_seconds > 30:
            # AI 停了 30 秒，触发截图分析
    """

    def __init__(self, idle_threshold: float = 30.0):
        """
        Args:
            idle_threshold: AI 无新事件超过此秒数后判定为「停止工作」
        """
        self.idle_threshold = idle_threshold
        self._log_path: Optional[Path] = None
        self._file_handle = None
        self._file_position: int = 0
        self._file_inode: Optional[int] = None  # 用于检测日志文件轮转
        self._pending_calls: dict[str, float] = {}  # call_id → start_time
        self._last_event_time: float = 0.0
        self._recent_errors: list[LogEvent] = []
        self._total_tool_calls: int = 0
        self._total_errors: int = 0
        self._started: bool = False

    def start(self) -> bool:
        """
        初始化监控器：查找最新的 Cursor 日志文件。

        Returns:
            True 如果成功找到日志文件，False 如果未找到
        """
        log_path = self._find_latest_renderer_log()
        if log_path:
            self._log_path = log_path
            # 跳到文件末尾（只监控新事件）
            try:
                file_stat = os.stat(log_path)
                self._file_position = file_stat.st_size
                self._file_inode = file_stat.st_ino
                self._started = True
                logger.info("CursorLogMonitor 启动成功: %s (跳到 offset %d)",
                            log_path, self._file_position)
                return True
            except OSError as e:
                logger.warning("无法读取日志文件: %s", e)
                return False
        else:
            logger.warning("未找到 Cursor renderer.log，日志监控通道不可用")
            return False

    def poll(self) -> LogMonitorState:
        """
        轮询一次：读取新日志行，更新内部状态，返回快照。

        应在主循环中每次迭代调用。
        """
        if not self._started or not self._log_path:
            return LogMonitorState(is_ai_active=False, log_file_found=False)

        # 检查日志文件是否被轮转（新 session 会创建新目录）
        self._check_log_rotation()

        # 增量读取新行
        new_lines = self._read_new_lines()

        # 解析事件
        for line in new_lines:
            event = self._parse_line(line)
            if event:
                self._process_event(event)

        # 构建状态快照
        return self._build_state()

    def stop(self):
        """停止监控，关闭文件句柄"""
        if self._file_handle:
            try:
                self._file_handle.close()
            except Exception:
                pass
            self._file_handle = None
        self._started = False
        logger.info("CursorLogMonitor 已停止")

    # ── 内部方法 ──────────────────────────────────────────────

    @staticmethod
    def _find_latest_renderer_log() -> Optional[Path]:
        """查找最新的 Cursor session 的 renderer.log"""
        appdata = os.environ.get("APPDATA", "")
        if not appdata:
            # 尝试 Windows 默认路径
            appdata = os.path.expandvars(r"%APPDATA%")

        logs_dir = Path(appdata) / "Cursor" / "logs"
        if not logs_dir.exists():
            logger.debug("Cursor logs 目录不存在: %s", logs_dir)
            return None

        # 找到最新的 session 目录（按名称排序，格式: 20260219T151323）
        session_dirs = sorted(
            [d for d in logs_dir.iterdir() if d.is_dir()],
            key=lambda d: d.name,
            reverse=True,
        )

        for session_dir in session_dirs:
            renderer_log = session_dir / "window1" / "renderer.log"
            if renderer_log.exists():
                return renderer_log

        logger.debug("未在 %s 中找到 renderer.log", logs_dir)
        return None

    def _check_log_rotation(self):
        """检测日志文件是否被轮转（Cursor 重启会创建新 session）"""
        if not self._log_path:
            return

        try:
            file_stat = os.stat(self._log_path)
            # 文件被截断（大小变小了）或 inode 变了 → 重新打开
            if file_stat.st_size < self._file_position:
                logger.info("检测到日志文件被截断或轮转，重置读取位置")
                self._file_position = 0
                if self._file_handle:
                    self._file_handle.close()
                    self._file_handle = None
        except OSError:
            # 文件可能被删除 → 尝试重新查找
            new_log = self._find_latest_renderer_log()
            if new_log and new_log != self._log_path:
                logger.info("检测到新的日志文件: %s", new_log)
                self._log_path = new_log
                self._file_position = 0
                if self._file_handle:
                    self._file_handle.close()
                    self._file_handle = None

    def _read_new_lines(self) -> list[str]:
        """增量读取日志文件的新行"""
        if not self._log_path:
            return []

        try:
            with open(self._log_path, "r", encoding="utf-8", errors="replace") as f:
                f.seek(self._file_position)
                new_content = f.read()
                self._file_position = f.tell()

            if not new_content:
                return []

            lines = new_content.splitlines()
            return lines

        except OSError as e:
            logger.debug("读取日志失败: %s", e)
            return []

    def _parse_line(self, line: str) -> Optional[LogEvent]:
        """解析单行日志，返回事件或 None"""
        now = time.time()

        # ToolCall start
        m = RE_TOOL_CALL_START.search(line)
        if m:
            call_id, tool_name = m.group(1), m.group(2)
            return LogEvent(
                event_type=LogEventType.TOOL_CALL_START,
                timestamp=now,
                raw_line=line,
                detail=f"{call_id}:{tool_name}",
            )

        # ToolCall end
        m = RE_TOOL_CALL_END.search(line)
        if m:
            call_id = m.group(1)
            return LogEvent(
                event_type=LogEventType.TOOL_CALL_END,
                timestamp=now,
                raw_line=line,
                detail=call_id,
            )

        # ToolCall failed
        if RE_TOOL_CALL_FAILED.search(line):
            return LogEvent(
                event_type=LogEventType.TOOL_CALL_FAILED,
                timestamp=now,
                raw_line=line,
                detail="tool_call_send_failure",
            )

        # Network error
        if RE_NETWORK_ERROR.search(line):
            return LogEvent(
                event_type=LogEventType.NETWORK_ERROR,
                timestamp=now,
                raw_line=line,
                detail=self._extract_error_type(line),
            )

        return None

    def _process_event(self, event: LogEvent):
        """处理解析后的事件，更新内部状态"""
        self._last_event_time = event.timestamp

        if event.event_type == LogEventType.TOOL_CALL_START:
            # 提取 call_id
            call_id = event.detail.split(":")[0] if ":" in event.detail else event.detail
            self._pending_calls[call_id] = event.timestamp
            self._total_tool_calls += 1
            logger.debug("ToolCall 开始: %s", event.detail)

        elif event.event_type == LogEventType.TOOL_CALL_END:
            call_id = event.detail
            self._pending_calls.pop(call_id, None)
            logger.debug("ToolCall 结束: %s", call_id)

        elif event.event_type == LogEventType.TOOL_CALL_FAILED:
            self._total_errors += 1
            self._recent_errors.append(event)
            logger.warning("ToolCall 传输失败")

        elif event.event_type == LogEventType.NETWORK_ERROR:
            self._total_errors += 1
            self._recent_errors.append(event)
            logger.warning("网络错误: %s", event.detail)

        # 清理过期的 recent_errors（只保留 60 秒内的）
        cutoff = time.time() - 60
        self._recent_errors = [e for e in self._recent_errors if e.timestamp > cutoff]

        # 清理超时的 pending_calls（超过 5 分钟认为已丢失）
        timeout_cutoff = time.time() - 300
        expired = [cid for cid, t in self._pending_calls.items() if t < timeout_cutoff]
        for cid in expired:
            self._pending_calls.pop(cid, None)
            logger.debug("ToolCall 超时清理: %s", cid)

    def _build_state(self) -> LogMonitorState:
        """构建当前状态快照"""
        now = time.time()

        # 计算空闲时间
        if self._last_event_time > 0:
            idle_seconds = now - self._last_event_time
        else:
            idle_seconds = float("inf")  # 从未检测到事件

        # AI 是否活跃 = 有 pending calls 或者最近有事件
        is_active = (
            len(self._pending_calls) > 0
            or idle_seconds < self.idle_threshold
        )

        return LogMonitorState(
            is_ai_active=is_active,
            idle_seconds=idle_seconds,
            last_tool_call_time=self._last_event_time,
            pending_tool_calls=len(self._pending_calls),
            recent_errors=list(self._recent_errors),
            total_tool_calls=self._total_tool_calls,
            total_errors=self._total_errors,
            log_file_found=True,
        )

    @staticmethod
    def _extract_error_type(line: str) -> str:
        """从错误日志行中提取错误类型关键词"""
        lower = line.lower()
        if "econnreset" in lower:
            return "ECONNRESET"
        if "tls" in lower:
            return "TLS_ERROR"
        if "socket hang up" in lower:
            return "SOCKET_HANGUP"
        if "etimedout" in lower:
            return "ETIMEDOUT"
        if "enotfound" in lower:
            return "ENOTFOUND"
        return "UNKNOWN_NETWORK_ERROR"
