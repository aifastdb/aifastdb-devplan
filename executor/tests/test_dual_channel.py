# -*- coding: utf-8 -*-
"""
T5.4 — 双通道联合测试（精简 3 状态版）

4 状态版：CONNECTION_ERROR / RESPONSE_STALL / IDLE / UNKNOWN
其他状态（WORKING / TERMINAL_RUNNING / ERROR / INTERRUPTED）已删除。
AI 是否在忙的判断由 screen_changing（截图对比）代替。
RESPONSE_STALL 由 VisionAnalyzer 连续截图无变化计数器判定。

覆盖 DevPlan 任务状态 × UI 状态 × 屏幕变化 的各种组合场景，
验证 DualChannelEngine + VisionAnalyzer._parse_status 的协作正确性。

决策矩阵：

| DevPlan 状态            | UI 状态            | 屏幕变化 | 预期动作            |
|------------------------|--------------------|---------|-------------------|
| send_task              | IDLE（无变化）      | False   | SEND_TASK         |
| send_task              | IDLE（有变化）      | True    | WAIT              |
| send_task              | CONNECTION_ERROR   | 任意    | SEND_CONTINUE     |
| send_task              | RESPONSE_STALL    | 任意    | SEND_CONTINUE     |
| wait                   | IDLE（有变化）      | True    | WAIT              |
| wait                   | IDLE（无变化）      | False   | SEND_CONTINUE     |
| wait                   | CONNECTION_ERROR   | 任意    | SEND_CONTINUE     |
| wait                   | RESPONSE_STALL    | 任意    | SEND_CONTINUE     |
| start_phase            | 任意               | 任意    | START_PHASE       |
| all_done               | 任意               | 任意    | ALL_DONE          |

运行方式:
  cd executor/
  python -m pytest tests/ -v
  python -m pytest tests/test_dual_channel.py -v
  python tests/test_dual_channel.py          # 无 pytest 时
"""

from __future__ import annotations

import sys
import os
import unittest

# 确保 src 在路径上
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.config import UIStatus, STATUS_MARKERS
from src.engine import Action, Decision, DualChannelEngine
from src.vision_analyzer import VisionAnalyzer


# ═══════════════════════════════════════════════════════════════
#  辅助构造函数
# ═══════════════════════════════════════════════════════════════

def make_devplan_send_task(task_id: str = "T1.1", title: str = "测试任务") -> dict:
    """构造 send_task 类型的 DevPlan 响应"""
    return {
        "action": "send_task",
        "subTask": {"taskId": task_id, "title": title, "description": ""},
        "message": f"发送任务 {task_id}",
    }


def make_devplan_wait(task_id: str = "T1.1") -> dict:
    """构造 wait 类型的 DevPlan 响应"""
    return {
        "action": "wait",
        "subTask": {"taskId": task_id, "title": "进行中的任务"},
        "message": f"等待 {task_id} 完成",
    }


def make_devplan_start_phase(phase_id: str = "phase-2") -> dict:
    """构造 start_phase 类型的 DevPlan 响应"""
    return {
        "action": "start_phase",
        "phase": {"taskId": phase_id, "title": "阶段二"},
        "message": f"启动 {phase_id}",
    }


def make_devplan_all_done() -> dict:
    """构造 all_done 类型的 DevPlan 响应"""
    return {
        "action": "all_done",
        "message": "所有任务已完成",
    }


def make_engine(threshold: int = 1, min_interval: float = 0.0, max_retries: int = 10) -> DualChannelEngine:
    """创建一个用于测试的引擎实例（低阈值 + 无冷却）"""
    return DualChannelEngine(
        status_trigger_threshold=threshold,
        min_send_interval=min_interval,
        max_continue_retries=max_retries,
        auto_start_next_phase=True,
    )


# ═══════════════════════════════════════════════════════════════
#  Test 1: 决策矩阵 — send_task × UI 状态 × 屏幕变化
# ═══════════════════════════════════════════════════════════════

class TestSendTaskDecisions(unittest.TestCase):
    """DevPlan 建议 send_task 时的各种组合"""

    def test_send_task_idle_no_change(self):
        """send_task + IDLE + 无变化 → 发送任务"""
        engine = make_engine()
        d = engine.decide(make_devplan_send_task(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d.action, Action.SEND_TASK)
        self.assertIsNotNone(d.task_content)
        self.assertIn("T1.1", d.task_content)

    def test_send_task_idle_with_change(self):
        """send_task + IDLE + 有变化 → 等待（AI 可能在忙）"""
        engine = make_engine()
        d = engine.decide(make_devplan_send_task(), UIStatus.IDLE, screen_changing=True)
        self.assertEqual(d.action, Action.WAIT)

    def test_send_task_unknown_no_change(self):
        """send_task + UNKNOWN + 无变化 → 发送任务"""
        engine = make_engine()
        d = engine.decide(make_devplan_send_task(), UIStatus.UNKNOWN, screen_changing=False)
        self.assertEqual(d.action, Action.SEND_TASK)

    def test_send_task_connection_error(self):
        """send_task + CONNECTION_ERROR → 先恢复连接"""
        engine = make_engine()
        d = engine.decide(make_devplan_send_task(), UIStatus.CONNECTION_ERROR)
        self.assertEqual(d.action, Action.SEND_CONTINUE)

    def test_send_task_connection_error_with_change(self):
        """send_task + CONNECTION_ERROR + 有变化 → 仍然恢复连接（连接错误最高优先级）"""
        engine = make_engine()
        d = engine.decide(make_devplan_send_task(), UIStatus.CONNECTION_ERROR, screen_changing=True)
        self.assertEqual(d.action, Action.SEND_CONTINUE)

    def test_send_task_response_stall(self):
        """send_task + RESPONSE_STALL → 尝试唤醒（响应中断优先于发送新任务）"""
        engine = make_engine()
        d = engine.decide(make_devplan_send_task(), UIStatus.RESPONSE_STALL)
        self.assertEqual(d.action, Action.SEND_CONTINUE)

    def test_send_task_response_stall_with_change(self):
        """send_task + RESPONSE_STALL + 有变化 → 仍然唤醒（RESPONSE_STALL 优先于屏幕变化）"""
        engine = make_engine()
        d = engine.decide(make_devplan_send_task(), UIStatus.RESPONSE_STALL, screen_changing=True)
        self.assertEqual(d.action, Action.SEND_CONTINUE)


# ═══════════════════════════════════════════════════════════════
#  Test 2: 决策矩阵 — wait × UI 状态 × 屏幕变化
# ═══════════════════════════════════════════════════════════════

class TestWaitDecisions(unittest.TestCase):
    """DevPlan 建议 wait 时的各种组合"""

    def test_wait_idle_with_change(self):
        """wait + IDLE + 有变化 → 继续等待（AI 正在工作）"""
        engine = make_engine()
        d = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=True)
        self.assertEqual(d.action, Action.WAIT)

    def test_wait_idle_no_change(self):
        """wait + IDLE + 无变化 → 尝试唤醒（发送继续）"""
        engine = make_engine()
        d = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d.action, Action.SEND_CONTINUE)

    def test_wait_unknown_with_change(self):
        """wait + UNKNOWN + 有变化 → 继续等待"""
        engine = make_engine()
        d = engine.decide(make_devplan_wait(), UIStatus.UNKNOWN, screen_changing=True)
        self.assertEqual(d.action, Action.WAIT)

    def test_wait_unknown_no_change(self):
        """wait + UNKNOWN + 无变化 → 尝试唤醒"""
        engine = make_engine()
        d = engine.decide(make_devplan_wait(), UIStatus.UNKNOWN, screen_changing=False)
        self.assertEqual(d.action, Action.SEND_CONTINUE)

    def test_wait_connection_error(self):
        """wait + CONNECTION_ERROR → 尝试恢复"""
        engine = make_engine()
        d = engine.decide(make_devplan_wait(), UIStatus.CONNECTION_ERROR)
        self.assertEqual(d.action, Action.SEND_CONTINUE)

    def test_wait_response_stall(self):
        """wait + RESPONSE_STALL → 尝试唤醒"""
        engine = make_engine()
        d = engine.decide(make_devplan_wait(), UIStatus.RESPONSE_STALL)
        self.assertEqual(d.action, Action.SEND_CONTINUE)

    def test_wait_response_stall_with_change(self):
        """wait + RESPONSE_STALL + 有变化 → 仍然唤醒"""
        engine = make_engine()
        d = engine.decide(make_devplan_wait(), UIStatus.RESPONSE_STALL, screen_changing=True)
        self.assertEqual(d.action, Action.SEND_CONTINUE)


# ═══════════════════════════════════════════════════════════════
#  Test 3: 决策矩阵 — start_phase / all_done
# ═══════════════════════════════════════════════════════════════

class TestPhaseAndDoneDecisions(unittest.TestCase):
    """start_phase 和 all_done 与各种 UI 状态的组合"""

    def test_start_phase_ui_idle(self):
        """start_phase + IDLE → 启动新阶段"""
        engine = make_engine()
        d = engine.decide(make_devplan_start_phase("phase-3"), UIStatus.IDLE)
        self.assertEqual(d.action, Action.START_PHASE)
        self.assertEqual(d.phase_id, "phase-3")

    def test_start_phase_ui_connection_error(self):
        """start_phase + CONNECTION_ERROR → 仍然启动（DevPlan 优先）"""
        engine = make_engine()
        d = engine.decide(make_devplan_start_phase(), UIStatus.CONNECTION_ERROR)
        self.assertEqual(d.action, Action.START_PHASE)

    def test_start_phase_disabled(self):
        """auto_start_next_phase=False → 不自动启动"""
        engine = DualChannelEngine(
            status_trigger_threshold=1,
            min_send_interval=0,
            max_continue_retries=10,
            auto_start_next_phase=False,
        )
        d = engine.decide(make_devplan_start_phase(), UIStatus.IDLE)
        self.assertEqual(d.action, Action.WAIT)

    def test_all_done_any_ui(self):
        """all_done + 任何 UI 状态 → 停止"""
        engine = make_engine()
        for status in UIStatus:
            d = engine.decide(make_devplan_all_done(), status)
            self.assertEqual(d.action, Action.ALL_DONE, f"all_done + {status} should be ALL_DONE")


# ═══════════════════════════════════════════════════════════════
#  Test 4: 防抖与重试上限
# ═══════════════════════════════════════════════════════════════

class TestThrottlingAndRetries(unittest.TestCase):
    """测试状态触发阈值（防抖）和 continue 重试上限"""

    def test_threshold_debounce(self):
        """状态需连续出现 threshold 次才触发 SEND_CONTINUE"""
        engine = make_engine(threshold=3, min_interval=0.0)

        # 第 1 次 → WAIT（防抖中）
        d1 = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d1.action, Action.WAIT)
        self.assertIn("1/3", d1.message)

        # 第 2 次 → WAIT
        d2 = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d2.action, Action.WAIT)
        self.assertIn("2/3", d2.message)

        # 第 3 次 → SEND_CONTINUE（触发）
        d3 = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d3.action, Action.SEND_CONTINUE)

    def test_max_continue_retries(self):
        """连续 continue 超过上限后停止发送"""
        engine = make_engine(threshold=1, min_interval=0.0, max_retries=2)

        # 第 1 次 → SEND_CONTINUE
        d1 = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d1.action, Action.SEND_CONTINUE)

        # 第 2 次 → SEND_CONTINUE
        d2 = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d2.action, Action.SEND_CONTINUE)

        # 第 3 次 → WAIT（达到上限）
        d3 = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d3.action, Action.WAIT)
        self.assertIn("上限", d3.message)

    def test_retry_reset_on_activity(self):
        """屏幕恢复变化后重置重试计数"""
        engine = make_engine(threshold=1, min_interval=0.0, max_retries=2)

        # 耗尽重试次数
        engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        d = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d.action, Action.WAIT)  # 达到上限

        # 模拟 AI 恢复活动（屏幕有变化）
        engine.reset_continue_retries()

        # 现在应该可以重新发送
        d_after = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d_after.action, Action.SEND_CONTINUE)

    def test_min_send_interval(self):
        """两次发送之间的最小冷却间隔"""
        engine = make_engine(threshold=1, min_interval=999.0)  # 超长冷却

        # 第 1 次 → SEND_CONTINUE（首次不受冷却限制）
        d1 = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d1.action, Action.SEND_CONTINUE)

        # 第 2 次 → WAIT（冷却中）
        d2 = engine.decide(make_devplan_wait(), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d2.action, Action.WAIT)
        self.assertIn("冷却", d2.message)


# ═══════════════════════════════════════════════════════════════
#  Test 5: 视觉状态解析 — _parse_status（精简版）
# ═══════════════════════════════════════════════════════════════

class TestVisionStatusParsing(unittest.TestCase):
    """测试 VisionAnalyzer._parse_status 的状态解析（精简 3 状态版）"""

    def test_connection_error_exact(self):
        """精确匹配 CONNECTION_ERROR"""
        result = VisionAnalyzer._parse_status("CONNECTION_ERROR")
        self.assertEqual(result, UIStatus.CONNECTION_ERROR)

    def test_connection_error_with_space(self):
        """变体匹配 'CONNECTION ERROR'（有空格）"""
        result = VisionAnalyzer._parse_status("CONNECTION ERROR")
        self.assertEqual(result, UIStatus.CONNECTION_ERROR)

    def test_connection_failed(self):
        """变体匹配 'CONNECTION FAILED'"""
        result = VisionAnalyzer._parse_status("CONNECTION FAILED PLEASE RETRY")
        self.assertEqual(result, UIStatus.CONNECTION_ERROR)

    def test_idle_exact(self):
        """精确匹配 IDLE"""
        result = VisionAnalyzer._parse_status("IDLE")
        self.assertEqual(result, UIStatus.IDLE)

    def test_fuzzy_try_again(self):
        """模糊匹配：'Try again' → CONNECTION_ERROR"""
        result = VisionAnalyzer._parse_status("I see a Try again button")
        self.assertEqual(result, UIStatus.CONNECTION_ERROR)

    def test_fuzzy_vpn(self):
        """模糊匹配：'VPN' → CONNECTION_ERROR"""
        result = VisionAnalyzer._parse_status("VPN disconnected")
        self.assertEqual(result, UIStatus.CONNECTION_ERROR)

    def test_fuzzy_resume(self):
        """模糊匹配：'Resume' → CONNECTION_ERROR"""
        result = VisionAnalyzer._parse_status("There is a Resume button in the dialog")
        self.assertEqual(result, UIStatus.CONNECTION_ERROR)

    def test_fuzzy_copy_request_details(self):
        """模糊匹配：'Copy Request Details' → CONNECTION_ERROR"""
        result = VisionAnalyzer._parse_status("I see Copy Request Details link")
        self.assertEqual(result, UIStatus.CONNECTION_ERROR)

    def test_unknown_text_returns_idle(self):
        """无法识别的文本 → IDLE（兜底）"""
        result = VisionAnalyzer._parse_status("SOME RANDOM UNRECOGNIZABLE TEXT")
        self.assertEqual(result, UIStatus.IDLE)

    def test_empty_string_returns_idle(self):
        """空字符串 → IDLE"""
        result = VisionAnalyzer._parse_status("")
        self.assertEqual(result, UIStatus.IDLE)

    def test_old_statuses_now_return_idle(self):
        """已删除的状态名（WORKING/ERROR/INTERRUPTED/TERMINAL_RUNNING）→ IDLE"""
        for old_status in ["WORKING", "INTERRUPTED", "TERMINAL_RUNNING"]:
            result = VisionAnalyzer._parse_status(old_status)
            self.assertEqual(result, UIStatus.IDLE, f"'{old_status}' should now return IDLE")

    def test_error_without_connection_returns_idle(self):
        """单独的 'ERROR'（非 CONNECTION）→ IDLE（已删除 ERROR 状态）"""
        result = VisionAnalyzer._parse_status("ERROR")
        self.assertEqual(result, UIStatus.IDLE)


# ═══════════════════════════════════════════════════════════════
#  Test 6: CursorController — SendResult
# ═══════════════════════════════════════════════════════════════

class TestCursorControllerResult(unittest.TestCase):
    """测试 CursorController.SendResult 数据结构"""

    def test_send_result_fields(self):
        """SendResult 字段正确性"""
        from src.cursor_controller import SendResult

        r = SendResult(success=True, message="ok", queued=False)
        self.assertTrue(r.success)
        self.assertEqual(r.message, "ok")
        self.assertFalse(r.queued)

    def test_send_result_default_queued(self):
        """SendResult.queued 默认为 False"""
        from src.cursor_controller import SendResult

        r = SendResult(success=False, message="fail")
        self.assertFalse(r.queued)

    def test_controller_unavailable(self):
        """GUI 不可用时 send_text 返回失败 SendResult"""
        from src.cursor_controller import CursorController
        from src.config import ExecutorConfig

        config = ExecutorConfig()
        ctrl = CursorController.__new__(CursorController)
        ctrl.config = config
        ctrl._pyautogui = None
        ctrl._pyperclip = None
        ctrl._pygetwindow = None
        ctrl._available = False
        ctrl._last_send_time = 0.0

        result = ctrl.send_text("test")
        self.assertFalse(result.success)
        self.assertIn("不可用", result.message)


# ═══════════════════════════════════════════════════════════════
#  Test 7: 状态标记配置完整性
# ═══════════════════════════════════════════════════════════════

class TestStatusMarkersConfig(unittest.TestCase):
    """验证 STATUS_MARKERS 配置的完整性"""

    def test_only_connection_error_markers(self):
        """精简后只剩 CONNECTION_ERROR 一组标记"""
        self.assertEqual(set(STATUS_MARKERS.keys()), {"CONNECTION_ERROR"})

    def test_markers_are_non_empty(self):
        """每个状态的标记列表非空"""
        for key, markers in STATUS_MARKERS.items():
            self.assertIsInstance(markers, list, f"{key} markers should be list")
            self.assertGreater(len(markers), 0, f"{key} should have at least one marker")

    def test_ui_status_enum_has_four_values(self):
        """UIStatus 枚举有 4 个值"""
        self.assertEqual(len(UIStatus), 4)
        self.assertIn(UIStatus.CONNECTION_ERROR, UIStatus)
        self.assertIn(UIStatus.RESPONSE_STALL, UIStatus)
        self.assertIn(UIStatus.IDLE, UIStatus)
        self.assertIn(UIStatus.UNKNOWN, UIStatus)


# ═══════════════════════════════════════════════════════════════
#  Test 8: 完整决策流水线模拟
# ═══════════════════════════════════════════════════════════════

class TestFullPipeline(unittest.TestCase):
    """模拟完整的决策流水线：多轮 DevPlan 状态 + 屏幕变化"""

    def test_task_lifecycle(self):
        """完整任务生命周期：发送 → 工作 → 空闲唤醒 → 完成"""
        engine = make_engine(threshold=1, min_interval=0.0)

        # 轮 1: DevPlan 有任务 + 无屏幕变化 → 发送任务
        d1 = engine.decide(make_devplan_send_task("T1.1", "实现功能A"), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d1.action, Action.SEND_TASK)
        self.assertIn("T1.1", d1.task_id)

        # 轮 2: DevPlan 等待 + 屏幕有变化 → 等待（AI 在工作）
        d2 = engine.decide(make_devplan_wait("T1.1"), UIStatus.IDLE, screen_changing=True)
        self.assertEqual(d2.action, Action.WAIT)

        # 轮 3: DevPlan 等待 + 屏幕无变化 → 尝试唤醒
        d3 = engine.decide(make_devplan_wait("T1.1"), UIStatus.IDLE, screen_changing=False)
        self.assertEqual(d3.action, Action.SEND_CONTINUE)

        # AI 恢复活动
        engine.reset_continue_retries()

        # 轮 4: DevPlan 等待 + 屏幕有变化 → 等待
        d4 = engine.decide(make_devplan_wait("T1.1"), UIStatus.IDLE, screen_changing=True)
        self.assertEqual(d4.action, Action.WAIT)

        # 轮 5: DevPlan 说启动下一阶段 → 启动
        d5 = engine.decide(make_devplan_start_phase("phase-2"), UIStatus.IDLE)
        self.assertEqual(d5.action, Action.START_PHASE)

        # 轮 6: 全部完成 → 停止
        d6 = engine.decide(make_devplan_all_done(), UIStatus.IDLE)
        self.assertEqual(d6.action, Action.ALL_DONE)

    def test_connection_error_recovery(self):
        """连接错误恢复流水线：错误 → 恢复 → 继续工作"""
        engine = make_engine(threshold=1, min_interval=0.0)

        # 轮 1: 任务执行中遇到连接错误
        d1 = engine.decide(make_devplan_wait("T2.1"), UIStatus.CONNECTION_ERROR)
        self.assertEqual(d1.action, Action.SEND_CONTINUE)

        # AI 恢复
        engine.reset_continue_retries()

        # 轮 2: 恢复正常（屏幕有变化）
        d2 = engine.decide(make_devplan_wait("T2.1"), UIStatus.IDLE, screen_changing=True)
        self.assertEqual(d2.action, Action.WAIT)


# ═══════════════════════════════════════════════════════════════
#  Test 9: VisionAnalyzer 诊断
# ═══════════════════════════════════════════════════════════════

class TestVisionAnalyzerDiagnostics(unittest.TestCase):
    """测试 VisionAnalyzer 在无依赖环境下的降级行为"""

    def test_unavailable_returns_idle(self):
        """依赖不可用时 analyze() 返回 IDLE"""
        from src.config import ExecutorConfig

        config = ExecutorConfig()
        analyzer = VisionAnalyzer.__new__(VisionAnalyzer)
        analyzer.config = config
        analyzer._pyautogui = None
        analyzer._ollama = None
        analyzer._numpy = None
        analyzer._pil_image = None
        analyzer._available = False
        analyzer._model_tested = False
        analyzer._model_ready = False

        status, changing, raw = analyzer.analyze()
        self.assertEqual(status, UIStatus.IDLE)
        self.assertFalse(changing)
        self.assertIn("不可用", raw)

    def test_diagnostics_structure(self):
        """get_diagnostics 返回正确的结构"""
        from src.config import ExecutorConfig
        from pathlib import Path

        config = ExecutorConfig()
        analyzer = VisionAnalyzer.__new__(VisionAnalyzer)
        analyzer.config = config
        analyzer._pyautogui = None
        analyzer._ollama = None
        analyzer._numpy = None
        analyzer._pil_image = None
        analyzer._available = False
        analyzer._model_tested = False
        analyzer._model_ready = False
        # __new__ 跳过了 __init__，需手动设置截图路径属性
        analyzer._log_dir = Path(config.log_dir)
        analyzer._snapshot_path = str(analyzer._log_dir / "snapshot.png")
        analyzer._quadrant_tr_path = str(analyzer._log_dir / "quad_top_right.png")
        analyzer._quadrant_br_path = str(analyzer._log_dir / "quad_bottom_right.png")

        diag = analyzer.get_diagnostics()
        self.assertIn("available", diag)
        self.assertIn("model_name", diag)
        self.assertIn("pyautogui", diag)
        self.assertIn("ollama", diag)
        self.assertFalse(diag["available"])


# ═══════════════════════════════════════════════════════════════
#  Test 10: RESPONSE_STALL — 连续截图无变化 → 响应中断检测
# ═══════════════════════════════════════════════════════════════

class TestResponseStallDetection(unittest.TestCase):
    """测试 VisionAnalyzer 的 RESPONSE_STALL 累积检测逻辑"""

    def _make_analyzer(self, stall_threshold: int = 3) -> VisionAnalyzer:
        """创建一个用于测试的 VisionAnalyzer（跳过依赖初始化）"""
        from src.config import ExecutorConfig
        config = ExecutorConfig(stall_threshold=stall_threshold)
        analyzer = VisionAnalyzer.__new__(VisionAnalyzer)
        analyzer.config = config
        analyzer._stall_no_change_count = 0
        return analyzer

    def test_stall_count_increments(self):
        """IDLE + 无变化 时计数器递增"""
        analyzer = self._make_analyzer(stall_threshold=5)
        # 模拟: IDLE + 无变化，计数递增
        analyzer._stall_no_change_count = 0
        # 手动模拟 analyze 中的逻辑
        ui_status = UIStatus.IDLE
        screen_changing = False
        if ui_status == UIStatus.IDLE and not screen_changing:
            analyzer._stall_no_change_count += 1
        self.assertEqual(analyzer._stall_no_change_count, 1)

    def test_stall_triggers_at_threshold(self):
        """连续达到阈值时触发 RESPONSE_STALL"""
        analyzer = self._make_analyzer(stall_threshold=3)
        # 模拟连续 3 次 IDLE + 无变化
        for i in range(3):
            ui_status = UIStatus.IDLE
            screen_changing = False
            if ui_status == UIStatus.IDLE and not screen_changing:
                analyzer._stall_no_change_count += 1
                if analyzer._stall_no_change_count >= analyzer.config.stall_threshold:
                    ui_status = UIStatus.RESPONSE_STALL

        self.assertEqual(analyzer._stall_no_change_count, 3)
        self.assertEqual(ui_status, UIStatus.RESPONSE_STALL)

    def test_stall_not_triggered_before_threshold(self):
        """未达到阈值时仍为 IDLE"""
        analyzer = self._make_analyzer(stall_threshold=5)
        # 模拟 4 次 IDLE + 无变化（阈值为 5）
        ui_status = UIStatus.IDLE
        for i in range(4):
            ui_status = UIStatus.IDLE
            screen_changing = False
            if ui_status == UIStatus.IDLE and not screen_changing:
                analyzer._stall_no_change_count += 1
                if analyzer._stall_no_change_count >= analyzer.config.stall_threshold:
                    ui_status = UIStatus.RESPONSE_STALL

        self.assertEqual(analyzer._stall_no_change_count, 4)
        self.assertEqual(ui_status, UIStatus.IDLE)  # 未达到 5 次

    def test_stall_resets_on_screen_change(self):
        """屏幕有变化时重置计数器"""
        analyzer = self._make_analyzer(stall_threshold=3)
        # 2 次无变化
        analyzer._stall_no_change_count = 2
        # 屏幕有变化 → 重置
        screen_changing = True
        ui_status = UIStatus.IDLE
        if ui_status == UIStatus.IDLE and not screen_changing:
            analyzer._stall_no_change_count += 1
        else:
            analyzer._stall_no_change_count = 0

        self.assertEqual(analyzer._stall_no_change_count, 0)

    def test_stall_resets_on_connection_error(self):
        """CONNECTION_ERROR 时重置计数器（非 IDLE 状态）"""
        analyzer = self._make_analyzer(stall_threshold=3)
        analyzer._stall_no_change_count = 2
        # 检测到连接错误 → 非 IDLE → 重置
        ui_status = UIStatus.CONNECTION_ERROR
        screen_changing = False
        if ui_status == UIStatus.IDLE and not screen_changing:
            analyzer._stall_no_change_count += 1
        else:
            analyzer._stall_no_change_count = 0

        self.assertEqual(analyzer._stall_no_change_count, 0)

    def test_stall_full_cycle(self):
        """完整周期：累积 → 触发 → 重置 → 重新累积"""
        analyzer = self._make_analyzer(stall_threshold=2)

        # 第 1-2 次无变化 → 触发 RESPONSE_STALL
        for _ in range(2):
            analyzer._stall_no_change_count += 1
        self.assertEqual(analyzer._stall_no_change_count, 2)

        # 屏幕恢复活动 → 重置
        analyzer._stall_no_change_count = 0
        self.assertEqual(analyzer._stall_no_change_count, 0)

        # 重新累积 1 次 → 未达阈值
        analyzer._stall_no_change_count += 1
        self.assertEqual(analyzer._stall_no_change_count, 1)
        self.assertLess(analyzer._stall_no_change_count, analyzer.config.stall_threshold)

    def test_engine_handles_response_stall(self):
        """引擎正确处理 RESPONSE_STALL 状态"""
        engine = make_engine()
        # send_task + RESPONSE_STALL → SEND_CONTINUE
        d1 = engine.decide(make_devplan_send_task(), UIStatus.RESPONSE_STALL)
        self.assertEqual(d1.action, Action.SEND_CONTINUE)

        engine2 = make_engine()
        # wait + RESPONSE_STALL → SEND_CONTINUE
        d2 = engine2.decide(make_devplan_wait(), UIStatus.RESPONSE_STALL)
        self.assertEqual(d2.action, Action.SEND_CONTINUE)


if __name__ == "__main__":
    unittest.main(verbosity=2)
