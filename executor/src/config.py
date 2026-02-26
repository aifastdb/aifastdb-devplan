# -*- coding: utf-8 -*-
"""
DevPlan Executor — 配置管理模块

支持三级配置加载优先级：
  1. 环境变量（最高优先级）
  2. 配置文件 executor.json
  3. 默认值（兜底）

使用 Pydantic Settings 实现，字段名与环境变量自动映射。
环境变量前缀: EXECUTOR_
"""

from __future__ import annotations

import json
import os
from enum import Enum
from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class UIStatus(str, Enum):
    """屏幕 UI 状态枚举（视觉 AI 识别结果）

    10 状态版 — 三层检测机制：

    即时检测（Ollama gemma3:27b 视觉模型单次识别）：
      - CONNECTION_ERROR: 连接错误弹窗，准确度 ⭐⭐⭐⭐⭐
      - PROVIDER_ERROR: Provider 返回错误弹窗，准确度 ⭐⭐⭐⭐
      - CONTEXT_OVERFLOW: 上下文/对话过长提示，准确度 ⭐⭐⭐⭐
      - RATE_LIMIT: 模型限流/请求频率限制，准确度 ⭐⭐⭐⭐
      - API_TIMEOUT: API 请求超时，准确度 ⭐⭐⭐
      - RESPONSE_INTERRUPTED: AI 响应中途被中断，准确度 ⭐⭐⭐
      - AI_GENERATING: AI 正在生成中（Stop 按钮可见），准确度 ⭐⭐⭐⭐⭐

    累积检测（连续截图对比）：
      - RESPONSE_STALL: 屏幕连续 N 次无变化（默认 4 次），判定为响应中断

    兜底：
      - IDLE: 非以上状态的兜底，准确度 ⭐⭐⭐⭐
      - UNKNOWN: 分析失败时的兜底
    """
    CONNECTION_ERROR = "CONNECTION_ERROR"          # 连接错误（弹窗 / Try again 按钮）— 单次识别
    PROVIDER_ERROR = "PROVIDER_ERROR"              # Provider 错误（Provider returned an error）— 单次识别
    CONTEXT_OVERFLOW = "CONTEXT_OVERFLOW"          # 上下文过长（对话太长/token 超限）— 单次识别
    RATE_LIMIT = "RATE_LIMIT"                      # 模型限流（请求过于频繁/配额用尽）— 单次识别
    API_TIMEOUT = "API_TIMEOUT"                    # API 超时（请求超时/响应太慢）— 单次识别
    RESPONSE_INTERRUPTED = "RESPONSE_INTERRUPTED"  # AI 响应被中断（输出中途停止）— 单次识别
    AI_GENERATING = "AI_GENERATING"                # AI 正在生成（Stop 按钮可见/文字流动）— 单次识别
    RESPONSE_STALL = "RESPONSE_STALL"              # 响应中断（连续 N 次截图无变化）— 累积检测
    IDLE = "IDLE"                                  # 空闲 / 其他所有非错误状态的兜底
    UNKNOWN = "UNKNOWN"                            # 视觉模型无法识别（分析失败时的兜底）


class ExecutorConfig(BaseSettings):
    """Executor 全局配置"""

    # ── DevPlan HTTP API ──────────────────────────────────────
    devplan_host: str = Field(
        default="127.0.0.1",
        description="DevPlan 可视化服务主机",
    )
    devplan_port: int = Field(
        default=3210,
        description="DevPlan 可视化服务端口",
    )
    project_name: str = Field(
        default="ai_db",
        description="目标项目名（对应 devplan projectName）",
    )

    # ── 轮询 & 超时 ──────────────────────────────────────────
    poll_interval: int = Field(
        default=10,
        description="主循环轮询间隔（秒）",
    )
    http_timeout: int = Field(
        default=10,
        description="HTTP 请求超时时间（秒）",
    )
    stuck_timeout_minutes: int = Field(
        default=30,
        description="子任务卡住超时（分钟），超时后触发恢复操作",
    )

    # ── 重试策略 ─────────────────────────────────────────────
    max_continue_retries: int = Field(
        default=5,
        description="连续发送'请继续'的最大重试次数",
    )
    status_trigger_threshold: int = Field(
        default=3,
        description="同一 UI 状态连续出现几次才触发操作",
    )
    min_send_interval: float = Field(
        default=5.0,
        description="两次 GUI 操作之间最小间隔（秒），防止重复发送",
    )

    # ── 视觉 AI ──────────────────────────────────────────────
    model_name: str = Field(
        default="gemma3:27b",
        description="Ollama 视觉模型名称",
    )
    model_timeout: int = Field(
        default=120,
        description="视觉模型调用超时（秒）",
    )
    screenshot_interval: float = Field(
        default=3.0,
        description="连续截图间隔（秒），用于屏幕变化检测",
    )
    stall_threshold: int = Field(
        default=4,
        description="响应中断判定阈值：连续多少次截图无变化后判定为 RESPONSE_STALL（4 × 10s = 40s）",
    )
    fallback_no_change_timeout: int = Field(
        default=90,
        description="兜底策略超时（秒）：右下角截图连续无变化超过此时间且有待开发任务时，发送'请继续'（默认 90 秒）",
    )
    roi_region: Optional[tuple[int, int, int, int]] = Field(
        default=None,
        description="截图区域 (x, y, width, height)，None 表示全屏",
    )
    split_quadrant: bool = Field(
        default=True,
        description="截图四象限分割模式：全屏截图后裁剪为右上+右下两块分别发给视觉模型，跳过左侧边栏",
    )
    disable_vision: bool = Field(
        default=False,
        description="显式禁用截图+视觉分析分支（无 Ollama 机器建议开启）",
    )
    quadrant_left_ratio: float = Field(
        default=0.35,
        description="左侧边栏占屏幕宽度的比例（0.35 表示左 35%% 是边栏，右 65%% 是内容区）",
    )

    # ── 日志监控（Channel 1）─────────────────────────────────
    log_monitor_enabled: bool = Field(
        default=True,
        description="是否启用 Cursor renderer.log 日志监控（Channel 1）",
    )
    log_monitor_idle_threshold: int = Field(
        default=30,
        description="日志无新 ToolCall 事件超过此秒数后，判定 AI 停止工作并触发截图分析",
    )

    # ── 恢复策略 ──────────────────────────────────────────────
    rate_limit_wait: int = Field(
        default=60,
        description="RATE_LIMIT 检测到限流后等待秒数（默认 60 秒）",
    )
    api_timeout_wait: int = Field(
        default=5,
        description="API_TIMEOUT 检测到超时后等待秒数（默认 5 秒）",
    )
    context_overflow_wait: int = Field(
        default=3,
        description="CONTEXT_OVERFLOW 检测到上下文溢出后，开新对话前等待秒数",
    )
    stall_escalate_threshold: int = Field(
        default=3,
        description="RESPONSE_STALL 连续发送'请继续'多少次无效后，升级为 CONTEXT_OVERFLOW 策略（开新对话）",
    )
    network_backoff_base: int = Field(
        default=5,
        description="网络中断恢复的指数退避基线秒数（attempt=1 时的基础等待）",
    )
    network_backoff_max: int = Field(
        default=120,
        description="网络中断恢复的指数退避最大秒数",
    )
    network_backoff_jitter_ratio: float = Field(
        default=0.25,
        description="网络中断恢复退避抖动比例（0~1），用于错峰重试",
    )
    circuit_breaker_failure_threshold: int = Field(
        default=4,
        description="circuit breaker 失败阈值：连续网络失败达到该值后进入 open",
    )
    circuit_breaker_open_seconds: int = Field(
        default=90,
        description="circuit breaker open 状态持续秒数（到期后进入 half-open）",
    )
    network_recovery_window_seconds: int = Field(
        default=900,
        description="网络恢复最大窗口（秒）：超过后不再继续重试，进入保护性恢复流程",
    )
    network_recovery_window_cooldown: int = Field(
        default=300,
        description="网络恢复超窗后的保护冷却时长（秒）",
    )

    # ── Executor 标识 ────────────────────────────────────────
    executor_id: str = Field(
        default="executor-1",
        description="Executor 实例 ID（心跳上报标识）",
    )

    # ── 自动化行为 ───────────────────────────────────────────
    auto_start_next_phase: bool = Field(
        default=True,
        description="阶段完成后是否自动启动下一阶段",
    )
    continue_command: str = Field(
        default="请继续",
        description="发送给 Cursor 的继续指令文本",
    )
    keep_alive_on_all_done: bool = Field(
        default=False,
        description="调试开关：收到 all_done 时保持 executor 运行（默认 false，自动停机）",
    )

    # ── Web UI ───────────────────────────────────────────────
    ui_port: int = Field(
        default=5000,
        description="Web UI 监控面板端口",
    )
    no_ui: bool = Field(
        default=False,
        description="禁用 Web UI 监控面板",
    )

    # ── 日志 ─────────────────────────────────────────────────
    log_dir: str = Field(
        default="logs",
        description="日志目录路径（相对于 executor/ 目录）",
    )
    log_level: str = Field(
        default="INFO",
        description="日志级别",
    )

    model_config = {
        "env_prefix": "EXECUTOR_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }

    # ── 计算属性 ─────────────────────────────────────────────

    @property
    def devplan_base_url(self) -> str:
        """DevPlan HTTP API 基础 URL"""
        return f"http://{self.devplan_host}:{self.devplan_port}"

    @property
    def log_file(self) -> Path:
        """日志文件路径"""
        log_dir = Path(self.log_dir)
        log_dir.mkdir(parents=True, exist_ok=True)
        return log_dir / "executor.log"

    # ── 持久化 ───────────────────────────────────────────────

    def save_to_file(self, path: str | Path = "executor.json") -> None:
        """将当前配置写入 JSON 文件"""
        data = self.model_dump()
        # roi_region 是 tuple，JSON 不直接支持
        if data.get("roi_region"):
            data["roi_region"] = list(data["roi_region"])
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    @classmethod
    def load_from_file(cls, path: str | Path = "executor.json") -> "ExecutorConfig":
        """从 JSON 文件加载配置（合并环境变量优先）"""
        file_path = Path(path)
        if file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            # roi_region 从 list 转 tuple
            if data.get("roi_region"):
                data["roi_region"] = tuple(data["roi_region"])
            # 环境变量会覆盖文件中的值（Pydantic Settings 默认行为）
            return cls(**data)
        return cls()


# ── 状态标记配置（用于视觉 AI 模糊匹配） ─────────────────────

STATUS_MARKERS: dict[str, list[str]] = {
    # ── 高准确度的错误状态关键词（用于 _parse_status 兜底匹配）──

    "CONNECTION_ERROR": [
        "Connection failed", "Connection Error", "connection error",
        "连接失败", "网络错误", "VPN",
        "Try again", "Resume", "拒绝连接",
        "problem persists", "check your internet",
        "Copy Request Details",
    ],

    "PROVIDER_ERROR": [
        "Provider Error", "provider error", "Provider returned an error",
        "provider returned", "Provider error",
        "ProviderError", "PROVIDER_ERROR",
        "trouble connecting to the model provider",
        "try again in a moment",
        "Provider 错误", "服务商错误",
    ],

    "CONTEXT_OVERFLOW": [
        "conversation is getting long", "context length",
        "token limit", "max tokens", "too long",
        "start a new", "new conversation",
        "上下文过长", "对话太长", "token 超限",
        "context_length_exceeded",
    ],

    "RATE_LIMIT": [
        "rate limit", "Rate limit", "too many requests",
        "usage limit", "request limit", "slow down",
        "try again in", "限流", "请求过于频繁",
        "quota", "429",
    ],

    "API_TIMEOUT": [
        "timed out", "timeout", "request timeout",
        "took too long", "request failed",
        "超时", "响应超时",
    ],

    "RESPONSE_INTERRUPTED": [
        "interrupted", "Response interrupted",
        "stopped", "no result from tool",
        "响应被中断", "已中断",
    ],

    "AI_GENERATING": [
        "Stop generating", "stop generating",
        "Generating", "AI_GENERATING",
    ],
}


def get_config() -> ExecutorConfig:
    """
    获取 Executor 配置实例。

    加载优先级：
      1. 环境变量 EXECUTOR_*
      2. executor.json 文件
      3. 默认值
    """
    config_path = Path("executor.json")
    if config_path.exists():
        return ExecutorConfig.load_from_file(config_path)
    return ExecutorConfig()
