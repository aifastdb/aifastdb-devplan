# -*- coding: utf-8 -*-
"""
T86.5 — 网络故障注入回归测试

覆盖：
1) 指数退避（backoff）冷却行为
2) circuit breaker 的 open/half-open/closed 状态流转
3) 最大恢复窗口超窗后的 ERROR_RECOVERY 保护模式
4) ERROR_RECOVERY 下 dead-letter 写入与去重
"""

from __future__ import annotations

import os
import sys
import time
import unittest

# 确保 src 在路径上
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.config import ExecutorConfig, UIStatus
from src.engine import Action, Decision, DualChannelEngine
from src.main import ExecutorLoop
import src.main as main_module


def make_devplan_wait(task_id: str = "T86.5") -> dict:
    return {
        "action": "wait",
        "subTask": {"taskId": task_id, "title": "网络恢复测试任务"},
        "message": f"等待 {task_id} 完成",
    }


def make_engine(**kwargs) -> DualChannelEngine:
    defaults = {
        "status_trigger_threshold": 1,
        "min_send_interval": 0.0,
        "max_continue_retries": 10,
        "auto_start_next_phase": True,
        "network_backoff_base": 1,
        "network_backoff_max": 4,
        "network_backoff_jitter_ratio": 0.0,
        "circuit_breaker_failure_threshold": 3,
        "circuit_breaker_open_seconds": 2,
        "network_recovery_window_seconds": 30,
        "network_recovery_window_cooldown": 5,
    }
    defaults.update(kwargs)
    return DualChannelEngine(**defaults)


class TestNetworkBackoffAndCircuitBreaker(unittest.TestCase):
    def test_backoff_cooldown_is_applied(self):
        engine = make_engine()

        # 第一次网络错误：应发送 continue，并调度 backoff
        d1 = engine.decide(make_devplan_wait(), UIStatus.CONNECTION_ERROR, screen_changing=False)
        self.assertEqual(d1.action, Action.SEND_CONTINUE)
        self.assertGreaterEqual(engine.tracker.network_backoff_attempts, 1)
        self.assertGreater(engine.tracker.get_network_backoff_remaining(), 0)

        # 紧接着再次触发：应命中退避冷却
        d2 = engine.decide(make_devplan_wait(), UIStatus.CONNECTION_ERROR, screen_changing=False)
        self.assertEqual(d2.action, Action.WAIT_COOLDOWN)
        self.assertIn("退避冷却", d2.message)

    def test_circuit_breaker_opens_after_threshold(self):
        engine = make_engine(circuit_breaker_failure_threshold=2, circuit_breaker_open_seconds=5)

        # 触发两次网络失败，达到阈值后进入 open
        engine.decide(make_devplan_wait(), UIStatus.CONNECTION_ERROR, screen_changing=False)
        d2 = engine.decide(make_devplan_wait(), UIStatus.CONNECTION_ERROR, screen_changing=False)

        self.assertEqual(engine.tracker.resolve_circuit_state(), "open")
        self.assertEqual(d2.action, Action.WAIT_COOLDOWN)
        self.assertIn("circuit breaker=open", d2.message)

    def test_half_open_probe_failure_reopens_breaker(self):
        engine = make_engine(circuit_breaker_failure_threshold=1, circuit_breaker_open_seconds=1)

        # 首次失败直接开路
        engine.decide(make_devplan_wait(), UIStatus.CONNECTION_ERROR, screen_changing=False)
        self.assertEqual(engine.tracker.resolve_circuit_state(), "open")

        # 强制 open 超时，下一次进入 half-open 探测；当前实现下网络仍报错会立即 reopen
        engine.tracker.circuit_open_until = time.time() - 1
        engine.tracker.network_backoff_until = 0.0
        d = engine.decide(make_devplan_wait(), UIStatus.CONNECTION_ERROR, screen_changing=False)

        self.assertEqual(d.action, Action.WAIT_COOLDOWN)
        self.assertEqual(engine.tracker.resolve_circuit_state(), "open")


class TestRecoveryWindow(unittest.TestCase):
    def test_recovery_window_exceeded_enters_error_recovery(self):
        engine = make_engine(
            network_recovery_window_seconds=30,
            network_recovery_window_cooldown=7,
            circuit_breaker_failure_threshold=10,
        )

        # 先制造一次网络失败，初始化 recovery_window_start
        engine.decide(make_devplan_wait(), UIStatus.CONNECTION_ERROR, screen_changing=False)

        # 注入“超窗”场景
        engine.tracker.recovery_window_start = time.time() - 40
        engine.tracker.network_backoff_until = 0.0

        d = engine.decide(make_devplan_wait(), UIStatus.CONNECTION_ERROR, screen_changing=False)
        self.assertEqual(d.action, Action.ERROR_RECOVERY)
        self.assertEqual(d.cooldown_seconds, 30)
        self.assertIn("恢复窗口已超时", d.message)


class _FakeClient:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.memory_calls: list[dict] = []
        self.recall_calls: list[tuple] = []
        self.current_phase_resp: dict = {
            "hasActivePhase": True,
            "activePhase": {"taskId": "phase-87", "title": "上下文溢出恢复增强"},
        }

    def save_dead_letter(self, **kwargs):
        self.calls.append(kwargs)
        return {"success": True}

    def save_memory(self, **kwargs):
        self.memory_calls.append(kwargs)
        return {"status": "saved"}

    def get_current_phase(self):
        return self.current_phase_resp

    def recall_unified(self, *args, **kwargs):
        self.recall_calls.append((args, kwargs))
        return {"memories": [{"content": "恢复记忆A"}]}


class _FakeConfig:
    executor_id = "executor-test"
    disable_vision = False


class TestDeadLetterIntegration(unittest.TestCase):
    def test_post_send_vision_check_queued_triggers_enter(self):
        loop = ExecutorLoop.__new__(ExecutorLoop)
        loop.vision_enabled = True

        class _A:
            available = True
            def check_send_queued_after_delay(self, delay_seconds=1.0):
                return True, "queued"

        class _G:
            available = True
            def __init__(self):
                self.enter_count = 0
            def press_key(self, key):
                if key == "enter":
                    self.enter_count += 1
                    return True
                return False

        loop.analyzer = _A()
        loop.gui = _G()
        loop._post_send_vision_check("test")
        self.assertEqual(loop.gui.enter_count, 1)

    def test_post_send_vision_check_disabled_no_enter(self):
        loop = ExecutorLoop.__new__(ExecutorLoop)
        loop.vision_enabled = False

        class _A:
            available = True
            def check_send_queued_after_delay(self, delay_seconds=1.0):
                return True, "queued"

        class _G:
            available = True
            def __init__(self):
                self.enter_count = 0
            def press_key(self, key):
                self.enter_count += 1
                return True

        loop.analyzer = _A()
        loop.gui = _G()
        loop._post_send_vision_check("test")
        self.assertEqual(loop.gui.enter_count, 0)

    def test_set_vision_enabled_runtime_switch(self):
        loop = ExecutorLoop.__new__(ExecutorLoop)
        loop.config = _FakeConfig()
        loop.vision_enabled = True

        ok1, msg1 = loop.set_vision_enabled(False)
        self.assertTrue(ok1)
        self.assertFalse(loop.vision_enabled)
        self.assertTrue(loop.config.disable_vision)
        self.assertIn("关闭", msg1)

        ok2, msg2 = loop.set_vision_enabled(True)
        self.assertTrue(ok2)
        self.assertTrue(loop.vision_enabled)
        self.assertFalse(loop.config.disable_vision)
        self.assertIn("启用", msg2)

    def test_error_recovery_saves_dead_letter_once_per_fingerprint(self):
        loop = ExecutorLoop.__new__(ExecutorLoop)
        loop.config = _FakeConfig()
        loop.client = _FakeClient()
        loop._last_dead_letter_fingerprint = ""
        loop._last_ui_status = UIStatus.CONNECTION_ERROR
        loop._last_devplan_data = {
            "phase": {"taskId": "phase-86"},
            "subTask": {"taskId": "T86.5"},
        }
        waited: list[int] = []
        loop._countdown_wait = lambda sec: waited.append(sec)

        decision = Decision(
            action=Action.ERROR_RECOVERY,
            message="网络恢复窗口已超时，进入保护等待",
            cooldown_seconds=9,
        )

        loop._execute(decision)
        loop._execute(decision)  # 同 fingerprint 再执行一次，应去重

        self.assertEqual(len(loop.client.calls), 1)
        self.assertEqual(loop.client.calls[0]["phase_id"], "phase-86")
        self.assertEqual(loop.client.calls[0]["task_id"], "T86.5")
        self.assertEqual(loop.client.calls[0]["retry_after_seconds"], 9)
        self.assertEqual(waited, [9, 9])

    def test_recovery_memories_saved_once_per_checkpoint(self):
        loop = ExecutorLoop.__new__(ExecutorLoop)
        loop.config = _FakeConfig()
        loop.client = _FakeClient()
        loop._last_recovery_memory_fingerprint = ""

        class _CP:
            last_n_turns_summary = "段落1\n\n段落2\n\n段落3"
            timestamp = "2026-02-25T12:00:00"
            template_version = "v2"

        cp = _CP()
        loop._save_recovery_memories(
            checkpoint=cp,
            phase_id="phase-87",
            task_id="T87.3",
            interrupt_reason="CONTEXT_OVERFLOW",
        )
        # 重复同一个 checkpoint，不应重复写入
        loop._save_recovery_memories(
            checkpoint=cp,
            phase_id="phase-87",
            task_id="T87.3",
            interrupt_reason="CONTEXT_OVERFLOW",
        )

        self.assertEqual(len(loop.client.memory_calls), 2)  # summary + insight
        tags0 = loop.client.memory_calls[0].get("tags", [])
        tags1 = loop.client.memory_calls[1].get("tags", [])
        self.assertIn("template-v2", tags0)
        self.assertIn("template-v2", tags1)

    def test_startup_recovery_injects_once(self):
        loop = ExecutorLoop.__new__(ExecutorLoop)
        loop.config = _FakeConfig()
        loop.client = _FakeClient()
        loop._last_startup_restore_fingerprint = ""

        class _CP:
            timestamp = "2026-02-25T13:00:00"
            phase_id = "phase-87"
            task_id = "T87.4"
            interrupt_reason = "CONTEXT_OVERFLOW"
            checkpoint_prompt = "[CHECKPOINT_PROMPT_V2]\n[CONTEXT]\n..."

        class _FakeRecovery:
            def load_checkpoint(self):
                return _CP()

            def load_latest_checkpoint_prompt(self):
                return _CP.checkpoint_prompt

            def build_final_recovery_prompt(self, checkpoint, recalled_memories=None, base_checkpoint_prompt=""):
                recalled_memories = recalled_memories or []
                extra = "\n".join(f"- {x}" for x in recalled_memories)
                return "[FINAL_RECOVERY_PROMPT_V1]\n" + (base_checkpoint_prompt or checkpoint.checkpoint_prompt) + "\n" + extra

        class _FakeResult:
            def __init__(self, success=True, message="ok", queued=False):
                self.success = success
                self.message = message
                self.queued = queued

        class _FakeGui:
            available = True

            def __init__(self):
                self.sent = []
                self.new_count = 0

            def new_conversation(self):
                self.new_count += 1
                return _FakeResult(True, "ok")

            def send_task(self, text):
                self.sent.append(text)
                return _FakeResult(True, "ok")

        loop.recovery = _FakeRecovery()
        loop.gui = _FakeGui()

        loop._attempt_startup_recovery()
        loop._attempt_startup_recovery()  # 第二次应跳过

        self.assertEqual(loop.gui.new_count, 1)
        self.assertEqual(len(loop.gui.sent), 1)
        self.assertIn("[FINAL_RECOVERY_PROMPT_V1]", loop.gui.sent[0])
        self.assertGreaterEqual(len(loop.client.recall_calls), 1)
        startup_query = loop.client.recall_calls[0][0][0]
        self.assertIn("phase-87", startup_query)
        self.assertIn("T87.4", startup_query)
        self.assertIn("CONTEXT_OVERFLOW", startup_query)

    def test_new_conversation_recovery_e2e(self):
        loop = ExecutorLoop.__new__(ExecutorLoop)
        loop.config = _FakeConfig()
        loop.client = _FakeClient()
        loop._last_recovery_memory_fingerprint = ""
        loop._last_ui_status = UIStatus.CONTEXT_OVERFLOW
        loop._last_devplan_data = {
            "phase": {"taskId": "phase-87", "title": "上下文溢出恢复增强"},
            "subTask": {"taskId": "T87.5", "title": "上下文溢出恢复回归测试", "description": "验证恢复链路"},
        }

        class _CP:
            timestamp = "2026-02-25T14:00:00"
            phase_id = "phase-87"
            phase_title = "上下文溢出恢复增强"
            task_id = "T87.5"
            task_title = "上下文溢出恢复回归测试"
            task_desc = "验证恢复链路"
            interrupt_reason = "CONTEXT_OVERFLOW"
            last_n_turns_summary = "s1\n\ns2\n\ns3"
            checkpoint_prompt = "[CHECKPOINT_PROMPT_V2]\n[CONTEXT]\n..."
            template_version = "v2"

        class _FakeRecovery:
            def __init__(self):
                self.cp = _CP()
                self.created = 0

            def create_and_persist_checkpoint(self, **kwargs):
                self.created += 1
                return self.cp

            def load_checkpoint(self):
                return self.cp

            def load_latest_checkpoint_prompt(self):
                return self.cp.checkpoint_prompt

            def build_final_recovery_prompt(self, checkpoint, recalled_memories=None, base_checkpoint_prompt=""):
                recalled_memories = recalled_memories or []
                extra = "\n".join(f"- {x}" for x in recalled_memories)
                return "[FINAL_RECOVERY_PROMPT_V1]\n" + (base_checkpoint_prompt or checkpoint.checkpoint_prompt) + "\n" + extra

        class _FakeResult:
            def __init__(self, success=True, message="ok", queued=False):
                self.success = success
                self.message = message
                self.queued = queued

        class _FakeGui:
            available = True

            def __init__(self):
                self.new_count = 0
                self.sent: list[str] = []
                self.continue_count = 0

            def new_conversation(self):
                self.new_count += 1
                return _FakeResult(True, "ok")

            def send_task(self, text):
                self.sent.append(text)
                return _FakeResult(True, "ok")

            def send_continue(self):
                self.continue_count += 1
                return _FakeResult(True, "ok")

        loop.recovery = _FakeRecovery()
        loop.gui = _FakeGui()

        original_sleep = main_module.time.sleep
        try:
            main_module.time.sleep = lambda *_args, **_kwargs: None
            decision = Decision(
                action=Action.NEW_CONVERSATION,
                message="上下文溢出，开新对话恢复 T87.5",
                task_id="T87.5",
                cooldown_seconds=1,
            )
            loop._execute(decision)
        finally:
            main_module.time.sleep = original_sleep

        self.assertEqual(loop.recovery.created, 1)
        self.assertGreaterEqual(len(loop.client.recall_calls), 2)  # 中断时 + 恢复前二次召回
        self.assertEqual(loop.gui.new_count, 1)
        self.assertEqual(loop.gui.continue_count, 0)
        self.assertEqual(len(loop.gui.sent), 1)
        self.assertIn("[FINAL_RECOVERY_PROMPT_V1]", loop.gui.sent[0])
        self.assertEqual(len(loop.client.memory_calls), 2)  # summary + insight
        self.assertGreaterEqual(len(loop.client.recall_calls), 2)
        first_query = loop.client.recall_calls[0][0][0]
        self.assertIn("phase-87", first_query)
        self.assertIn("T87.5", first_query)
        self.assertIn("CONTEXT_OVERFLOW", first_query)

    def test_inject_recovery_prompt_fallback_continue(self):
        loop = ExecutorLoop.__new__(ExecutorLoop)

        class _FakeResult:
            def __init__(self, success=True, message="ok", queued=False):
                self.success = success
                self.message = message
                self.queued = queued

        class _FakeGui:
            available = True

            def __init__(self):
                self.new_count = 0
                self.sent: list[str] = []
                self.continue_count = 0

            def new_conversation(self):
                self.new_count += 1
                return _FakeResult(False, "boom")

            def send_task(self, text):
                self.sent.append(text)
                return _FakeResult(True, "ok")

            def send_continue(self):
                self.continue_count += 1
                return _FakeResult(True, "ok")

        loop.gui = _FakeGui()
        ok = loop._inject_recovery_prompt(
            final_prompt="[FINAL_RECOVERY_PROMPT_V1]\n...",
            wait_sec=1,
            source_label="unit-test",
            fallback_to_continue=True,
        )
        self.assertFalse(ok)
        self.assertEqual(loop.gui.new_count, 1)
        self.assertEqual(loop.gui.continue_count, 1)
        self.assertEqual(len(loop.gui.sent), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)

