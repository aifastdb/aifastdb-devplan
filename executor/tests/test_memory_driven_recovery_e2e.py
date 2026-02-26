# -*- coding: utf-8 -*-
"""
T88.5 — 记忆驱动恢复端到端测试

验证链路：
- checkpoint 加载（TXT/JSON）
- recall_unified(task+error+phase+recovery) 召回补全
- FINAL_RECOVERY_PROMPT_V1 注入发送
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import src.main as main_module
from src.config import UIStatus
from src.engine import Action, Decision
from src.main import ExecutorLoop
from src.recovery_manager import RecoveryManager


class _FakeClient:
    def __init__(self) -> None:
        self.recall_queries: list[str] = []
        self.memory_calls: list[dict] = []

    def get_current_phase(self):
        return {
            "hasActivePhase": True,
            "activePhase": {"taskId": "phase-88", "title": "记忆驱动恢复"},
        }

    def recall_unified(self, query: str, **_kwargs):
        self.recall_queries.append(query)
        return {
            "memories": [
                {"content": "关键记忆A：先读取 checkpoint 再恢复"},
                {"content": "关键记忆B：恢复前补二次 recall"},
                {"content": "关键记忆C：模板要固定化"},
            ]
        }

    def save_memory(self, **kwargs):
        self.memory_calls.append(kwargs)
        return {"status": "saved"}


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


class _FakeConfig:
    executor_id = "executor-e2e"


class TestMemoryDrivenRecoveryE2E(unittest.TestCase):
    def test_startup_recovery_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            loop = ExecutorLoop.__new__(ExecutorLoop)
            loop.config = _FakeConfig()
            loop.client = _FakeClient()
            loop.gui = _FakeGui()
            loop._last_startup_restore_fingerprint = ""
            loop.recovery = RecoveryManager("aifastdb-devplan", log_dir=tmp, max_events=20)

            cp = loop.recovery.create_and_persist_checkpoint(
                phase_id="phase-88",
                phase_title="记忆驱动恢复",
                task_id="T88.5",
                task_title="端到端测试",
                task_desc="验证链路",
                interrupt_reason="CONTEXT_OVERFLOW",
                recalled_memories=["checkpoint 记忆"],
            )
            self.assertTrue(cp.checkpoint_prompt)

            original_sleep = main_module.time.sleep
            try:
                main_module.time.sleep = lambda *_a, **_k: None
                loop._attempt_startup_recovery()
            finally:
                main_module.time.sleep = original_sleep

            self.assertEqual(loop.gui.new_count, 1)
            self.assertEqual(len(loop.gui.sent), 1)
            prompt = loop.gui.sent[0]
            self.assertIn("[FINAL_RECOVERY_PROMPT_V1]", prompt)
            self.assertIn("[RECALLED_MEMORIES]", prompt)
            self.assertIn("关键记忆A", prompt)
            self.assertGreaterEqual(len(loop.client.recall_queries), 1)
            self.assertIn("phase-88", loop.client.recall_queries[0])
            self.assertIn("T88.5", loop.client.recall_queries[0])
            self.assertIn("CONTEXT_OVERFLOW", loop.client.recall_queries[0])

    def test_new_conversation_recovery_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            loop = ExecutorLoop.__new__(ExecutorLoop)
            loop.config = _FakeConfig()
            loop.client = _FakeClient()
            loop.gui = _FakeGui()
            loop.recovery = RecoveryManager("aifastdb-devplan", log_dir=tmp, max_events=20)
            loop._last_recovery_memory_fingerprint = ""
            loop._last_ui_status = UIStatus.CONTEXT_OVERFLOW
            loop._last_devplan_data = {
                "phase": {"taskId": "phase-88", "title": "记忆驱动恢复"},
                "subTask": {"taskId": "T88.5", "title": "端到端测试", "description": "验证链路"},
            }

            original_sleep = main_module.time.sleep
            try:
                main_module.time.sleep = lambda *_a, **_k: None
                decision = Decision(
                    action=Action.NEW_CONVERSATION,
                    message="上下文溢出，开新对话恢复 T88.5",
                    task_id="T88.5",
                    cooldown_seconds=1,
                )
                loop._execute(decision)
            finally:
                main_module.time.sleep = original_sleep

            self.assertEqual(loop.gui.new_count, 1)
            self.assertEqual(len(loop.gui.sent), 1)
            self.assertIn("[FINAL_RECOVERY_PROMPT_V1]", loop.gui.sent[0])
            self.assertIn("关键记忆B", loop.gui.sent[0])
            # summary + insight
            self.assertEqual(len(loop.client.memory_calls), 2)
            # 中断时一次 + 恢复前一次
            self.assertGreaterEqual(len(loop.client.recall_queries), 2)
            self.assertTrue((loop.recovery.log_dir / "checkpoint_prompt.json").exists())
            self.assertTrue((loop.recovery.log_dir / "checkpoint_prompt.txt").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)

