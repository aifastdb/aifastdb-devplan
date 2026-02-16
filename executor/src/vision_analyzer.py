# -*- coding: utf-8 -*-
"""
DevPlan Executor — 视觉分析器（精简 3 状态版）

通过截图 + Ollama 视觉模型分析 Cursor IDE 当前 UI 状态。

四象限分割策略：
  - 全屏截图 → 按 quadrant_left_ratio 分割为左右两列、上下两行
  - 只发送右上（代码编辑区）和右下（聊天输入框+弹窗）给视觉模型
  - 左侧（侧边栏/文件树）不发送，减少干扰和 token 消耗

精简 3 状态：
  CONNECTION_ERROR — 连接错误弹窗，仅右下象限识别（高准确度 ⭐⭐⭐⭐⭐）
  PROVIDER_ERROR  — Provider错误弹窗，仅右下象限识别（高准确度 ⭐⭐⭐⭐）
  IDLE            — 兜底/无错误（高准确度 ⭐⭐⭐⭐）
  UNKNOWN         — 分析失败时的兜底

其他状态（WORKING / TERMINAL_RUNNING 等）的判断由截图对比的
screen_changing 参数代替，比视觉模型关键词匹配更可靠。

依赖（可选，缺失时降级为 IDLE）：
  - pyautogui: 截图
  - ollama: 视觉模型推理
  - Pillow: 图片处理
  - numpy: 截图对比
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

from .config import ExecutorConfig, UIStatus, STATUS_MARKERS

logger = logging.getLogger("executor.vision")


# ── 视觉 AI Prompts ─────────────────────────────────────────

PROMPT_BOTTOM_RIGHT = """Analyze this screenshot (this is the **bottom-right** area of Cursor IDE — the chat panel, input box, and any popup dialogs).

Is there an **error popup or dialog** visible?

**Look for these signs of CONNECTION_ERROR:**
- A popup/dialog with "Connection Error" or "Connection failed" text
- A "Try again" button in a dialog overlay
- A "Resume" button in a dialog
- Text mentioning "problem persists", "check your internet", "Copy Request Details"
- A dark overlay/modal with error message

**Look for these signs of PROVIDER_ERROR:**
- A warning icon (⚠) with "Provider Error" header text
- Text saying "We're having trouble connecting to the model provider"
- Text saying "This might be temporary - please try again in a moment"
- A "Copy Request Details" link with a UUID
- A dark popup/banner with "Provider" in the title

If CONNECTION_ERROR signs are visible → reply: CONNECTION_ERROR
If PROVIDER_ERROR signs are visible → reply: PROVIDER_ERROR
If NONE of the above → reply: IDLE

Reply with ONLY one word: CONNECTION_ERROR or PROVIDER_ERROR or IDLE"""

PROMPT_TOP_RIGHT = """Analyze this screenshot (this is the **top-right** area of Cursor IDE — the code editor and tabs).

This area shows the code editor, file tabs, and task/progress information.
It does NOT show error popups — error dialogs appear in other areas.

**IMPORTANT**: Do NOT look for Provider Error or Connection Error here.
Even if you see words like "Provider" or "Connection" in code, comments, or task descriptions,
those are normal text content, NOT error dialogs.

Always reply: IDLE

Reply with ONLY one word: IDLE"""

ANALYSIS_PROMPT = """Analyze this screenshot of Cursor IDE.

Is there an **error popup or dialog** visible?

**Look for these signs of CONNECTION_ERROR:**
- A popup/dialog with "Connection Error" or "Connection failed" text
- A "Try again" button in a dialog overlay
- A "Resume" button in a dialog
- Text mentioning "problem persists", "check your internet"

**Look for these signs of PROVIDER_ERROR:**
- A warning icon (⚠) with "Provider Error" header text
- Text saying "We're having trouble connecting to the model provider"
- Text saying "This might be temporary - please try again in a moment"
- A "Copy Request Details" link with a UUID

If CONNECTION_ERROR signs are visible → reply: CONNECTION_ERROR
If PROVIDER_ERROR signs are visible → reply: PROVIDER_ERROR
If NONE of the above → reply: IDLE

Reply with ONLY one word: CONNECTION_ERROR or PROVIDER_ERROR or IDLE"""


# ── 视觉分析器 ──────────────────────────────────────────────

class VisionAnalyzer:
    """
    截图 + 视觉 AI 分析 Cursor IDE UI 状态。

    功能：
      1. 连续截图并对比像素变化（检测屏幕是否在变化）
      2. 四象限分割 → 右上+右下发送给 Ollama 视觉模型
      3. 合并两个象限的判断结果：
         - CONNECTION_ERROR / PROVIDER_ERROR 仅从右下象限识别（聊天面板/弹窗区域）
         - 右上象限（代码编辑区）不参与错误判定，避免正常文字被误判
      4. 返回最终 UIStatus
    """

    def __init__(self, config: ExecutorConfig):
        self.config = config
        self._stall_no_change_count: int = 0  # 连续无变化计数（用于 RESPONSE_STALL 判定）
        self._last_br_change_time: float = time.time()  # 右下角截图最后变化时间
        self._prev_br_pixels = None  # 上一次右下角截图的像素数据（用于时间兜底对比）
        self._init_deps()

    def _init_deps(self) -> None:
        """延迟导入可选依赖"""
        self._log_dir = Path(self.config.log_dir)
        self._log_dir.mkdir(parents=True, exist_ok=True)

        # 截图文件路径
        self._snapshot_path = str(self._log_dir / "snapshot.png")
        self._snapshot_1_path = str(self._log_dir / "snapshot_1.png")
        self._snapshot_2_path = str(self._log_dir / "snapshot_2.png")

        # 四象限文件路径
        self._quadrant_tl_path = str(self._log_dir / "quad_top_left.png")
        self._quadrant_tr_path = str(self._log_dir / "quad_top_right.png")
        self._quadrant_bl_path = str(self._log_dir / "quad_bottom_left.png")
        self._quadrant_br_path = str(self._log_dir / "quad_bottom_right.png")

        # 各象限最近判断结果（供 Web UI 展示）
        self.last_quad_top_right_status: str = ""
        self.last_quad_bottom_right_status: str = ""

        # 截图时间戳（供 Web UI 展示）
        self.screenshot_time_1: str = ""
        self.screenshot_time_2: str = ""

        # 尝试导入可选依赖
        try:
            import pyautogui
            self._pyautogui = pyautogui
        except ImportError:
            self._pyautogui = None
            logger.warning("pyautogui 未安装，截图功能不可用")

        try:
            import ollama
            self._ollama = ollama
        except ImportError:
            self._ollama = None
            logger.warning("ollama 未安装，视觉 AI 分析不可用")

        try:
            import numpy as np
            self._numpy = np
        except ImportError:
            self._numpy = None
            logger.warning("numpy 未安装，截图对比功能不可用")

        try:
            from PIL import Image
            self._pil_image = Image
        except ImportError:
            self._pil_image = None
            logger.warning("Pillow 未安装，图片处理功能不可用")

        # 可用性判断
        self._available = bool(self._pyautogui and self._ollama)

        # 模型就绪状态
        self._model_tested = False
        self._model_ready = False

    @property
    def available(self) -> bool:
        """截图 + 视觉 AI 是否可用"""
        return self._available

    @property
    def seconds_since_br_changed(self) -> float:
        """距离右下角截图最后一次变化过去了多少秒"""
        return time.time() - self._last_br_change_time

    # ── 主分析入口 ───────────────────────────────────────────

    def analyze(self) -> tuple[UIStatus, bool, str]:
        """
        执行一次完整的屏幕分析。

        Returns:
            (ui_status, screen_changing, raw_response)
            - ui_status: 识别的 UI 状态
            - screen_changing: 连续两次截图是否有像素变化
            - raw_response: 视觉模型的原始响应文本
        """
        if not self._available:
            return UIStatus.IDLE, False, "视觉分析器不可用"

        # 确保模型可用
        if not self._ensure_model_ready():
            return UIStatus.IDLE, False, "视觉模型不可用"

        # ── 截图 1 ──
        ss1 = self._take_screenshot(self._snapshot_1_path)
        if ss1 is None:
            return UIStatus.IDLE, False, "截图失败"
        from datetime import datetime
        self.screenshot_time_1 = datetime.now().strftime("%H:%M:%S")

        # ── 等待间隔 ──
        time.sleep(self.config.screenshot_interval)

        # ── 截图 2 ──
        ss2 = self._take_screenshot(self._snapshot_2_path)
        if ss2 is None:
            return UIStatus.IDLE, False, "第二次截图失败"
        self.screenshot_time_2 = datetime.now().strftime("%H:%M:%S")

        # ── 对比截图 ──
        screen_changing = self._compare_screenshots(ss1, ss2)

        # ── 视觉 AI 分析 ──
        if self.config.split_quadrant:
            ui_status, raw_response = self._analyze_quadrants(ss2)
        else:
            ui_status, raw_response = self._analyze_fullscreen(ss2)

        # ── 响应中断检测（累积型判断） ──
        # 当视觉 AI 判定为 IDLE 且截图无变化时，累加计数器。
        # 连续达到 stall_threshold 次 → 判定为 RESPONSE_STALL（AI 卡住了）。
        # 任何屏幕变化或非 IDLE 状态都会重置计数器。
        if ui_status == UIStatus.IDLE and not screen_changing:
            self._stall_no_change_count += 1
            if self._stall_no_change_count >= self.config.stall_threshold:
                logger.warning(
                    "连续 %d 次截图无变化，判定为 RESPONSE_STALL",
                    self._stall_no_change_count,
                )
                ui_status = UIStatus.RESPONSE_STALL
                raw_response = f"响应中断: 连续 {self._stall_no_change_count} 次截图无变化"
            else:
                logger.debug(
                    "截图无变化计数: %d/%d",
                    self._stall_no_change_count,
                    self.config.stall_threshold,
                )
        else:
            # 屏幕有变化或非 IDLE 状态 → 重置计数
            if self._stall_no_change_count > 0:
                logger.info(
                    "屏幕恢复活动，重置无变化计数（之前: %d）",
                    self._stall_no_change_count,
                )
            self._stall_no_change_count = 0

        return ui_status, screen_changing, raw_response

    # ── 四象限分析 ───────────────────────────────────────────

    def _analyze_quadrants(self, screenshot) -> tuple[UIStatus, str]:
        """四象限模式：分割截图 → 右上+右下分别分析 → 合并结果"""
        self._split_into_quadrants(screenshot)

        # ── 追踪右下角截图变化时间（3 分钟兜底策略） ──
        self._track_br_change()

        # 先分析右下（最重要：聊天输入框+弹窗+最新回复）
        br_status, br_raw = self._call_vision_model(
            self._quadrant_br_path,
            prompt=PROMPT_BOTTOM_RIGHT,
        )
        self.last_quad_bottom_right_status = br_status.value
        logger.info("[右下] %s | %s", br_status.value, br_raw[:50])

        # 再分析右上（辅助：代码编辑区）
        tr_status, tr_raw = self._call_vision_model(
            self._quadrant_tr_path,
            prompt=PROMPT_TOP_RIGHT,
        )
        self.last_quad_top_right_status = tr_status.value
        logger.info("[右上] %s | %s", tr_status.value, tr_raw[:50])

        # ── 合并规则（CONNECTION_ERROR 和 PROVIDER_ERROR 仅从右下象限识别） ──
        # 右上区域是代码编辑器，其中可能出现 "Provider"、"Connection" 等正常文字，
        # 不能用于判断错误弹窗。错误弹窗只会出现在右下区域（聊天面板/弹窗区域）。
        #
        # 规则 1: 右下检测到 CONNECTION_ERROR → 最高优先级
        if br_status == UIStatus.CONNECTION_ERROR:
            final = UIStatus.CONNECTION_ERROR
            raw = f"[合并:连接错误] 右下={br_status.value} 右上={tr_status.value}"
            return final, raw

        # 规则 2: 右下检测到 PROVIDER_ERROR → 次高优先级
        if br_status == UIStatus.PROVIDER_ERROR:
            final = UIStatus.PROVIDER_ERROR
            raw = f"[合并:Provider错误] 右下={br_status.value} 右上={tr_status.value}"
            return final, raw

        # 规则 3: 忽略右上的错误误判（右上只用于辅助参考，不影响错误判定）
        if tr_status in (UIStatus.CONNECTION_ERROR, UIStatus.PROVIDER_ERROR):
            logger.warning(
                "[合并] 右上误判为 %s，已忽略（错误仅从右下识别）",
                tr_status.value,
            )

        # 其他情况 → IDLE（是否在工作由 screen_changing 截图对比决定）
        final = UIStatus.IDLE
        raw = f"[合并] 右下={br_status.value} 右上={tr_status.value} → {final.value}"
        return final, raw

    def _track_br_change(self) -> None:
        """追踪右下角截图的像素变化时间（用于 3 分钟兜底策略）"""
        if not self._numpy or not self._pil_image:
            return

        try:
            br_path = Path(self._quadrant_br_path)
            if not br_path.exists():
                return

            current_img = self._pil_image.open(str(br_path))
            current_pixels = self._numpy.array(current_img)

            if self._prev_br_pixels is not None:
                # 对比当前右下角与上一次的右下角
                if current_pixels.shape == self._prev_br_pixels.shape:
                    diff = self._numpy.mean(
                        self._numpy.abs(current_pixels.astype(float) - self._prev_br_pixels.astype(float))
                    )
                    if diff > 2.0:  # 像素均值差异阈值
                        self._last_br_change_time = time.time()
                        logger.debug("右下角截图有变化 (diff=%.2f)，更新变化时间", diff)
                    else:
                        elapsed = time.time() - self._last_br_change_time
                        logger.debug(
                            "右下角截图无变化 (diff=%.2f)，已持续 %.0f 秒",
                            diff, elapsed,
                        )
                else:
                    # 尺寸不同 = 有变化
                    self._last_br_change_time = time.time()
            else:
                # 首次运行，设为当前时间
                self._last_br_change_time = time.time()

            self._prev_br_pixels = current_pixels
        except Exception as e:
            logger.error("追踪右下角变化失败: %s", e)

    def _analyze_fullscreen(self, screenshot) -> tuple[UIStatus, str]:
        """全屏模式：整张截图发给视觉模型"""
        # 保存全屏截图
        if self._pil_image:
            screenshot.save(self._snapshot_path)

        status, raw = self._call_vision_model(
            self._snapshot_path,
            prompt=ANALYSIS_PROMPT,
        )
        return status, raw

    def _split_into_quadrants(self, screenshot) -> None:
        """将全屏截图按比例分割为四个象限并保存"""
        if not self._pil_image:
            return

        w, h = screenshot.size
        left_cut = int(w * self.config.quadrant_left_ratio)
        mid_y = h // 2

        # 四个象限裁剪
        tl = screenshot.crop((0, 0, left_cut, mid_y))
        tr = screenshot.crop((left_cut, 0, w, mid_y))
        bl = screenshot.crop((0, mid_y, left_cut, h))
        br = screenshot.crop((left_cut, mid_y, w, h))

        tl.save(self._quadrant_tl_path)
        tr.save(self._quadrant_tr_path)
        bl.save(self._quadrant_bl_path)
        br.save(self._quadrant_br_path)

    # ── 视觉模型调用 ─────────────────────────────────────────

    def _call_vision_model(
        self,
        image_path: str,
        prompt: Optional[str] = None,
    ) -> tuple[UIStatus, str]:
        """
        调用 Ollama 视觉模型分析截图。

        Args:
            image_path: 图片文件路径
            prompt: 自定义 prompt（None 则用全屏默认 prompt）

        Returns:
            (UIStatus, raw_response)
        """
        if not self._ollama:
            return UIStatus.IDLE, "ollama 不可用"

        if not Path(image_path).exists():
            return UIStatus.IDLE, f"图片不存在: {image_path}"

        use_prompt = prompt or ANALYSIS_PROMPT

        try:
            response = self._ollama.chat(
                model=self.config.model_name,
                messages=[{
                    "role": "user",
                    "content": use_prompt,
                    "images": [image_path],
                }],
                options={"timeout": self.config.model_timeout},
            )
            # 兼容新版 ollama SDK（返回 Pydantic 对象）和旧版（返回 dict）
            raw_text = self._extract_chat_content(response)
            status = self._parse_status(raw_text)
            return status, raw_text
        except Exception as e:
            logger.error("视觉模型调用失败: %s", e)
            return UIStatus.UNKNOWN, f"模型调用异常: {e}"

    @staticmethod
    def _extract_chat_content(response) -> str:
        """从 ollama.chat() 响应中提取文本内容（兼容新旧 SDK 版本）"""
        try:
            # 新版 SDK: Pydantic 对象 → response.message.content
            if hasattr(response, "message") and hasattr(response.message, "content"):
                return response.message.content or ""
        except Exception:
            pass
        try:
            # 旧版 SDK: dict → response["message"]["content"]
            if isinstance(response, dict):
                return response.get("message", {}).get("content", "")
        except Exception:
            pass
        return ""

    # ── 状态解析（双层匹配） ──────────────────────────────────

    @staticmethod
    def _parse_status(raw_text: str) -> UIStatus:
        """
        从视觉模型的原始文本中解析 UI 状态。

        判断三种错误结果：CONNECTION_ERROR / PROVIDER_ERROR / IDLE。
        双层匹配：
          Layer 1: 精确匹配关键词（优先级：CONNECTION_ERROR > PROVIDER_ERROR）
          Layer 2: 模糊匹配 STATUS_MARKERS 中的关键词
        """
        if not raw_text:
            return UIStatus.IDLE

        text_upper = raw_text.upper()

        # Layer 1a: 精确匹配 CONNECTION_ERROR 关键词（最高优先级）
        connection_keywords = [
            "CONNECTION_ERROR",
            "CONNECTION FAILED",
            "CONNECTION ERROR",
        ]
        for keyword in connection_keywords:
            if keyword in text_upper:
                return UIStatus.CONNECTION_ERROR

        # Layer 1b: 精确匹配 PROVIDER_ERROR 关键词
        provider_keywords = [
            "PROVIDER_ERROR",
            "PROVIDER ERROR",
            "PROVIDER RETURNED AN ERROR",
            "PROVIDER RETURNED",
        ]
        for keyword in provider_keywords:
            if keyword in text_upper:
                return UIStatus.PROVIDER_ERROR

        # Layer 2: 模糊匹配 STATUS_MARKERS（CONNECTION_ERROR + PROVIDER_ERROR）
        for status_name, markers in STATUS_MARKERS.items():
            for marker in markers:
                if marker.upper() in text_upper:
                    try:
                        return UIStatus(status_name)
                    except ValueError:
                        pass

        # 兜底 → IDLE
        return UIStatus.IDLE

    # ── 截图 & 对比 ──────────────────────────────────────────

    def _take_screenshot(self, save_path: str):
        """截取屏幕截图"""
        if not self._pyautogui:
            return None

        try:
            if self.config.roi_region:
                screenshot = self._pyautogui.screenshot(region=self.config.roi_region)
            else:
                screenshot = self._pyautogui.screenshot()
            screenshot.save(save_path)
            return screenshot
        except Exception as e:
            logger.error("截图失败: %s", e)
            return None

    def _compare_screenshots(self, ss1, ss2) -> bool:
        """
        对比两张截图是否有像素变化。

        Returns:
            True 表示屏幕有变化
        """
        if not self._numpy or ss1 is None or ss2 is None:
            return False

        try:
            arr1 = self._numpy.array(ss1)
            arr2 = self._numpy.array(ss2)
            if arr1.shape != arr2.shape:
                return True  # 尺寸不同 = 有变化
            diff = self._numpy.mean(self._numpy.abs(arr1.astype(float) - arr2.astype(float)))
            threshold = 2.0  # 像素均值差异阈值
            return diff > threshold
        except Exception as e:
            logger.error("截图对比失败: %s", e)
            return False

    # ── 模型就绪检查 ─────────────────────────────────────────

    def _ensure_model_ready(self) -> bool:
        """检查 Ollama 模型是否可用（仅检查一次）"""
        if self._model_tested:
            return self._model_ready

        self._model_tested = True

        if not self._ollama:
            self._model_ready = False
            return False

        try:
            result = self._ollama.list()
            # 兼容新版 SDK（Pydantic 对象: result.models[i].model）
            # 和旧版 SDK（dict: result["models"][i]["name"]）
            model_names = self._extract_model_names(result)
            # 检查模型名是否存在（支持 tag 匹配）
            model_base = self.config.model_name.split(":")[0]
            self._model_ready = any(
                model_base in name for name in model_names
            )
            if self._model_ready:
                logger.info("视觉模型已就绪: %s", self.config.model_name)
            else:
                logger.warning(
                    "视觉模型 %s 未找到，可用模型: %s",
                    self.config.model_name,
                    ", ".join(model_names[:5]),
                )
            return self._model_ready
        except Exception as e:
            logger.error("检查 Ollama 模型失败: %s", e)
            self._model_ready = False
            return False

    @staticmethod
    def _extract_model_names(result) -> list[str]:
        """从 ollama.list() 结果中提取模型名列表（兼容新旧 SDK 版本）"""
        try:
            # 新版 SDK: Pydantic 对象 → result.models[i].model
            if hasattr(result, "models") and not isinstance(result, dict):
                return [m.model for m in result.models if hasattr(m, "model")]
        except Exception:
            pass
        try:
            # 旧版 SDK: dict → result["models"][i]["name"]
            if isinstance(result, dict):
                return [m.get("name", "") for m in result.get("models", [])]
        except Exception:
            pass
        return []

    # ── 诊断 ─────────────────────────────────────────────────

    def get_diagnostics(self) -> dict:
        """返回视觉分析器的诊断信息"""
        diag = {
            "available": self._available,
            "model_name": self.config.model_name,
            "model_ready": self._model_ready,
            "pyautogui": self._pyautogui is not None,
            "ollama": self._ollama is not None,
            "numpy": self._numpy is not None,
            "pillow": self._pil_image is not None,
            "split_quadrant": self.config.split_quadrant,
            "quadrant_left_ratio": self.config.quadrant_left_ratio,
            "roi_region": self.config.roi_region,
            "snapshot_path": self._snapshot_path,
        }
        if self.config.split_quadrant:
            diag["quadrant_tr_path"] = self._quadrant_tr_path
            diag["quadrant_br_path"] = self._quadrant_br_path
        return diag
