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

    5 状态版 — 两种不同的检测机制：

    即时检测（视觉 AI 单次识别）：
      - CONNECTION_ERROR: 弹窗非常醒目，准确度 ⭐⭐⭐⭐⭐，单次识别立即判定
      - PROVIDER_ERROR: Provider 返回错误弹窗，准确度 ⭐⭐⭐⭐，单次识别即判定

    累积检测（连续截图对比）：
      - RESPONSE_STALL: 屏幕连续 N 次无变化（默认 10 次），判定为响应中断

    兜底：
      - IDLE: 非以上两种情况的兜底状态，准确度 ⭐⭐⭐⭐
      - UNKNOWN: 分析失败时的兜底
    """
    CONNECTION_ERROR = "CONNECTION_ERROR"    # 连接错误（弹窗 / Try again 按钮）— 单次识别
    PROVIDER_ERROR = "PROVIDER_ERROR"        # Provider 错误（Provider returned an error）— 单次识别
    RESPONSE_STALL = "RESPONSE_STALL"       # 响应中断（连续 N 次截图无变化）— 累积检测
    IDLE = "IDLE"                            # 空闲 / 其他所有非错误状态的兜底
    UNKNOWN = "UNKNOWN"                      # 视觉模型无法识别（分析失败时的兜底）


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
        default=15,
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
        default=1.5,
        description="连续截图间隔（秒），用于屏幕变化检测",
    )
    stall_threshold: int = Field(
        default=10,
        description="响应中断判定阈值：连续多少次截图无变化后判定为 RESPONSE_STALL",
    )
    fallback_no_change_timeout: int = Field(
        default=180,
        description="兜底策略超时（秒）：右下角截图连续无变化超过此时间且有待开发任务时，发送'请继续'（默认 180 秒 = 3 分钟）",
    )
    roi_region: Optional[tuple[int, int, int, int]] = Field(
        default=None,
        description="截图区域 (x, y, width, height)，None 表示全屏",
    )
    split_quadrant: bool = Field(
        default=True,
        description="截图四象限分割模式：全屏截图后裁剪为右上+右下两块分别发给视觉模型，跳过左侧边栏",
    )
    quadrant_left_ratio: float = Field(
        default=0.35,
        description="左侧边栏占屏幕宽度的比例（0.35 表示左 35%% 是边栏，右 65%% 是内容区）",
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
    # ── 高准确度的错误状态关键词 ──
    # 其他状态（WORKING / TERMINAL_RUNNING / ERROR / INTERRUPTED）
    # 在四象限截图模式下关键词误判率较高，已删除。
    # 它们的功能由 screen_changing（截图对比）和 DevPlan API 状态代替。

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
