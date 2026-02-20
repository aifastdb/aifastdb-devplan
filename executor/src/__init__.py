# -*- coding: utf-8 -*-
"""
DevPlan Executor — Cursor IDE 无人值守自动化引擎

三通道智能检测架构：
  - Channel 1: Cursor renderer.log 日志监控（AI 活动状态）
  - Channel 2: DevPlan HTTP API（任务编排状态）
  - Channel 3: 屏幕截图 + Ollama gemma3:27b 视觉 AI（8 态 UI 分类）

联合判断 + 差异化恢复策略 → GUI 自动化操作。
"""

__version__ = "1.1.0"

__all__ = [
    "config",
    "cursor_controller",
    "devplan_client",
    "engine",
    "log_monitor",
    "ui_server",
    "vision_analyzer",
    "main",
]
