# -*- coding: utf-8 -*-
"""
DevPlan Executor — Cursor IDE 无人值守自动化引擎

双通道决策架构：
  - Channel 1: DevPlan HTTP API（任务编排状态）
  - Channel 2: 屏幕截图 + 视觉 AI（UI 运行状态）

联合判断后执行 GUI 自动化操作。
"""

__version__ = "1.0.0"

__all__ = [
    "config",
    "cursor_controller",
    "devplan_client",
    "engine",
    "ui_server",
    "vision_analyzer",
    "main",
]
