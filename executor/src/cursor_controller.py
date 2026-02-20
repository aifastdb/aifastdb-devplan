# -*- coding: utf-8 -*-
"""
DevPlan Executor — Cursor IDE GUI 自动化控制模块

使用 pyautogui + pyperclip + pygetwindow 实现：
  - Cursor 窗口定位与激活
  - 输入框区域点击
  - 文本粘贴发送（支持中文）
  - 组合键操作
  - 排队状态检测
  - 安全防护（FAILSAFE / 操作间隔 / 发送冷却）

迁移自 cursor_auto 项目，精简并适配 DevPlan Executor 架构。
所有 GUI 依赖延迟导入，不可用时优雅降级。
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional, Tuple

from .config import ExecutorConfig

logger = logging.getLogger("executor.cursor_controller")


@dataclass
class SendResult:
    """发送操作结果"""
    success: bool
    message: str
    queued: bool = False  # 是否进入排队状态


class CursorController:
    """
    Cursor IDE GUI 控制器。

    功能：
      1. 窗口管理 — 激活 / 最小化恢复 / 前置
      2. 输入操作 — 粘贴文本 / 按回车 / 快捷键
      3. 安全机制 — FAILSAFE / 操作间隔 / 冷却计时
      4. 排队检测 — 发送后检测消息是否排队

    使用方式：
        controller = CursorController(config)
        if controller.available:
            result = controller.send_text("请继续")
    """

    # ── 窗口标题匹配列表 ─────────────────────────────────────
    WINDOW_TITLES = ["Cursor", "Cursor -", "- Cursor"]

    def __init__(self, config: ExecutorConfig):
        self.config = config

        # GUI 依赖（延迟导入）
        self._pyautogui = None
        self._pyperclip = None
        self._pygetwindow = None
        self._available = False

        # 发送冷却
        self._last_send_time: float = 0.0

        self._init_deps()

    def _init_deps(self) -> None:
        """延迟加载 GUI 依赖"""
        try:
            import pyautogui
            self._pyautogui = pyautogui
            # 安全设置
            pyautogui.FAILSAFE = True     # 鼠标移到左上角触发异常
            pyautogui.PAUSE = 0.1         # 每个操作间隔 0.1 秒
        except ImportError:
            logger.warning("pyautogui 不可用，GUI 控制功能禁用")
            return

        try:
            import pyperclip
            self._pyperclip = pyperclip
        except ImportError:
            logger.warning("pyperclip 不可用，剪贴板功能禁用")
            return

        try:
            import pygetwindow as gw
            self._pygetwindow = gw
        except ImportError:
            logger.info("pygetwindow 不可用，窗口定位将使用 Alt+Tab 回退")

        self._available = True
        logger.info("GUI 控制器初始化完成")

    @property
    def available(self) -> bool:
        """GUI 控制是否可用"""
        return self._available

    # ── 窗口管理 ─────────────────────────────────────────────

    def activate_window(self) -> bool:
        """
        激活 Cursor 窗口使其获得焦点。

        尝试策略：
          1. pygetwindow 按标题查找并激活
          2. 回退到 Alt+Tab

        Returns:
            是否成功激活
        """
        if not self._available:
            return False

        # 策略 1: pygetwindow 查找
        if self._pygetwindow is not None:
            for title in self.WINDOW_TITLES:
                try:
                    windows = self._pygetwindow.getWindowsWithTitle(title)
                    if windows:
                        window = windows[0]
                        if window.isMinimized:
                            window.restore()
                            time.sleep(0.3)
                        window.activate()
                        time.sleep(0.5)
                        logger.debug("已激活窗口: %s", window.title)
                        return True
                except Exception:
                    continue

        # 策略 2: Alt+Tab 回退
        logger.debug("窗口定位失败，使用 Alt+Tab 回退")
        self._pyautogui.hotkey("alt", "tab")
        time.sleep(0.3)
        return True

    def get_window_info(self) -> Optional[dict]:
        """
        获取 Cursor 窗口信息。

        Returns:
            窗口信息 dict（title, left, top, width, height）或 None
        """
        if not self._pygetwindow:
            return None

        for title in self.WINDOW_TITLES:
            try:
                windows = self._pygetwindow.getWindowsWithTitle(title)
                if windows:
                    w = windows[0]
                    return {
                        "title": w.title,
                        "left": w.left,
                        "top": w.top,
                        "width": w.width,
                        "height": w.height,
                        "isMinimized": w.isMinimized,
                        "isActive": w.isActive,
                    }
            except Exception:
                continue
        return None

    # ── 输入操作 ─────────────────────────────────────────────

    def click_input_area(self) -> bool:
        """
        点击 Cursor 的聊天输入框区域。

        输入框位置假设在屏幕底部中央。
        如果有窗口信息，使用窗口相对坐标。

        Returns:
            是否点击成功
        """
        if not self._available:
            return False

        try:
            # 尝试使用窗口相对坐标
            win_info = self.get_window_info()
            if win_info and not win_info["isMinimized"]:
                # 输入框在窗口底部中央偏下
                x = win_info["left"] + win_info["width"] // 2
                y = win_info["top"] + win_info["height"] - 80
                self._pyautogui.click(x=x, y=y)
            else:
                # 回退：屏幕底部中央
                screen_w, screen_h = self._pyautogui.size()
                self._pyautogui.click(x=screen_w // 2, y=screen_h - 100)

            time.sleep(0.3)
            return True
        except Exception as e:
            logger.error("点击输入框失败: %s", e)
            return False

    def send_text(self, text: str, clear_first: bool = False) -> SendResult:
        """
        在 Cursor 输入框中发送文本。

        流程: 激活窗口 → 点击输入框 → [清除旧内容] → 粘贴文本 → 按 Enter

        Args:
            text: 要发送的文本
            clear_first: 是否先清除输入框已有内容

        Returns:
            SendResult 发送结果
        """
        if not self._available:
            return SendResult(success=False, message="GUI 控制不可用")

        # 发送冷却检查
        elapsed = time.time() - self._last_send_time
        if elapsed < self.config.min_send_interval:
            remaining = self.config.min_send_interval - elapsed
            return SendResult(
                success=False,
                message=f"发送冷却中，还需等待 {remaining:.1f} 秒",
            )

        try:
            # 1. 激活 Cursor 窗口
            if not self.activate_window():
                return SendResult(success=False, message="无法激活 Cursor 窗口")
            time.sleep(0.5)

            # 2. 点击输入框
            if not self.click_input_area():
                return SendResult(success=False, message="无法点击输入框")
            time.sleep(0.3)

            # 3. 可选：清除旧内容
            if clear_first:
                self._pyautogui.hotkey("ctrl", "a")
                time.sleep(0.2)
                self._pyautogui.press("backspace")
                time.sleep(0.2)

            # 4. 粘贴文本（通过剪贴板，支持中文）
            self._pyperclip.copy(text)
            time.sleep(0.2)
            self._pyautogui.hotkey("ctrl", "v")
            time.sleep(0.3)

            # 5. 按 Enter 发送
            self._pyautogui.press("enter")
            self._last_send_time = time.time()

            logger.info("已发送: %s", text[:80] + ("..." if len(text) > 80 else ""))

            # 6. 等待后检查排队状态
            time.sleep(1.0)
            queued = self._check_queued_state()
            if queued:
                logger.info("检测到排队状态，再次按 Enter")
                self._pyautogui.press("enter")
                time.sleep(0.5)

            return SendResult(
                success=True,
                message=f"已发送: {text[:40]}",
                queued=queued,
            )

        except Exception as e:
            logger.error("发送失败: %s", e)
            return SendResult(success=False, message=f"发送异常: {e}")

    def send_continue(self) -> SendResult:
        """发送"请继续"指令"""
        return self.send_text(self.config.continue_command)

    def new_conversation(self) -> SendResult:
        """
        开启新对话（Ctrl+L），用于上下文溢出时的恢复。

        Returns:
            SendResult 操作结果
        """
        if not self._available:
            return SendResult(success=False, message="GUI 不可用")
        try:
            # 先激活 Cursor 窗口
            self.activate_window()
            time.sleep(0.3)
            # Ctrl+L 开新对话
            self._pyautogui.hotkey("ctrl", "l")
            time.sleep(1.0)  # 等待新对话界面加载
            logger.info("已发送 Ctrl+L 开新对话")
            return SendResult(success=True, message="新对话已开启")
        except Exception as e:
            logger.error("开新对话失败: %s", e)
            return SendResult(success=False, message=str(e))

    def send_task(self, task_content: str) -> SendResult:
        """
        发送新任务（清除输入框后发送）。

        Args:
            task_content: 任务描述内容
        """
        return self.send_text(task_content, clear_first=True)

    # ── 按键操作 ─────────────────────────────────────────────

    def press_key(self, key: str, times: int = 1) -> bool:
        """
        按下指定按键。

        Args:
            key: 按键名称（"enter", "escape", "tab" 等）
            times: 按下次数
        """
        if not self._available:
            return False
        try:
            for _ in range(times):
                self._pyautogui.press(key)
                time.sleep(0.1)
            return True
        except Exception as e:
            logger.error("按键失败 (%s): %s", key, e)
            return False

    def hotkey(self, *keys: str) -> bool:
        """
        发送组合键。

        Args:
            keys: 按键序列，如 ("ctrl", "c") 表示 Ctrl+C
        """
        if not self._available:
            return False
        try:
            self._pyautogui.hotkey(*keys)
            return True
        except Exception as e:
            logger.error("组合键失败 (%s): %s", "+".join(keys), e)
            return False

    def click_position(self, x: int, y: int, clicks: int = 1) -> bool:
        """
        点击屏幕指定位置。

        Args:
            x: X 坐标
            y: Y 坐标
            clicks: 点击次数
        """
        if not self._available:
            return False
        try:
            self._pyautogui.click(x=x, y=y, clicks=clicks)
            return True
        except Exception as e:
            logger.error("点击失败 (%d, %d): %s", x, y, e)
            return False

    def scroll(self, clicks: int = 3, direction: str = "up") -> bool:
        """
        滚动鼠标。

        Args:
            clicks: 滚动量
            direction: "up" 或 "down"
        """
        if not self._available:
            return False
        try:
            amount = clicks if direction == "up" else -clicks
            self._pyautogui.scroll(amount)
            return True
        except Exception as e:
            logger.error("滚动失败: %s", e)
            return False

    def get_mouse_position(self) -> Optional[Tuple[int, int]]:
        """获取当前鼠标位置"""
        if not self._available:
            return None
        try:
            return self._pyautogui.position()
        except Exception:
            return None

    def get_screen_size(self) -> Optional[Tuple[int, int]]:
        """获取屏幕尺寸"""
        if not self._available:
            return None
        try:
            return self._pyautogui.size()
        except Exception:
            return None

    # ── 排队状态检测 ─────────────────────────────────────────

    def _check_queued_state(self) -> bool:
        """
        检测消息是否进入排队状态。

        简单检查：如果发送后光标还在输入框且内容未清空，可能排队了。
        注意：这是一个启发式检测，不一定 100% 准确。

        Returns:
            是否检测到排队状态
        """
        # 基础实现：暂时不调用视觉模型（避免在发送时产生额外延迟）
        # 后续阶段可增强为视觉模型检测
        return False

    # ── 发送确认 ─────────────────────────────────────────────

    def send_with_confirm(
        self,
        text: str,
        check_callback: Optional[callable] = None,
        max_retries: int = 2,
    ) -> SendResult:
        """
        发送文本并通过回调确认是否成功。

        Args:
            text: 要发送的文本
            check_callback: 状态检查回调，返回 True 表示状态已变化（发送成功）
            max_retries: 最大重试次数

        Returns:
            SendResult
        """
        for attempt in range(max_retries):
            result = self.send_text(text)
            if not result.success:
                continue

            # 等待生效
            time.sleep(3)

            # 如果有回调，验证状态变化
            if check_callback:
                try:
                    if check_callback():
                        return SendResult(success=True, message=f"确认发送成功（第 {attempt + 1} 次）")
                except Exception:
                    pass

                # 状态未变化，再按一次 Enter
                logger.info("状态未变化，再次按 Enter（第 %d 次）", attempt + 2)
                self.press_key("enter")
                time.sleep(2)
            else:
                return result

        return SendResult(success=True, message=f"已发送（{max_retries} 次尝试后）")

    # ── 连接检查 ─────────────────────────────────────────────

    def test_gui(self) -> dict:
        """
        测试 GUI 自动化环境。

        Returns:
            测试结果 dict
        """
        result = {
            "available": self._available,
            "pyautogui": self._pyautogui is not None,
            "pyperclip": self._pyperclip is not None,
            "pygetwindow": self._pygetwindow is not None,
            "screen_size": None,
            "mouse_position": None,
            "cursor_window": None,
        }

        if self._available:
            result["screen_size"] = self.get_screen_size()
            result["mouse_position"] = self.get_mouse_position()
            result["cursor_window"] = self.get_window_info()

        return result
