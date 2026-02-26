# -*- coding: utf-8 -*-
"""
T87.1 — last_n_turns 自动摘要器回归测试
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

# 确保 src 在路径上
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.recovery_manager import RecoveryManager


class TestRecoveryManagerSummary(unittest.TestCase):
    def test_summarize_last_turns_generates_three_paragraphs(self):
        mgr = RecoveryManager(project_name="aifastdb-devplan", log_dir="logs", max_events=20)
        mgr.events = [
            "DevPlan: action=wait message=T87.1 正在执行",
            "UI: status=CONTEXT_OVERFLOW changing=False",
            "Decision: action=new_conversation message=上下文溢出，开新对话恢复 T87.1",
        ]
        summary = mgr.summarize_last_turns(n=8)
        parts = [p for p in summary.split("\n\n") if p.strip()]
        self.assertEqual(len(parts), 3)
        self.assertIn("任务上下文快照", parts[0])
        self.assertIn("最近关键过程", parts[1])
        self.assertIn("恢复建议", parts[2])

    def test_context_tokens_extraction(self):
        mgr = RecoveryManager(project_name="aifastdb-devplan", log_dir="logs", max_events=20)
        mgr.events = [
            "DevPlan: action=send_task message=phase-87 下一个 T87.2",
            "UI: status=CONNECTION_ERROR changing=False",
            "Decision: action=send_continue message=网络恢复",
        ]
        summary = mgr.summarize_last_turns(n=8)
        self.assertIn("phase-87", summary)
        self.assertIn("T87.2", summary)
        self.assertIn("CONNECTION_ERROR", summary)

    def test_empty_events_fallback(self):
        mgr = RecoveryManager(project_name="aifastdb-devplan", log_dir="logs", max_events=20)
        mgr.events = []
        summary = mgr.summarize_last_turns()
        self.assertIn("暂无可用摘要", summary)

    def test_checkpoint_prompt_has_structured_sections(self):
        mgr = RecoveryManager(project_name="aifastdb-devplan", log_dir="logs", max_events=20)
        prompt = mgr.build_checkpoint_prompt(
            phase_id="phase-87",
            phase_title="上下文溢出恢复增强",
            task_id="T87.2",
            task_title="checkpoint_prompt 结构化模板与持久化",
            task_desc="实现固定模板",
            interrupt_reason="CONTEXT_OVERFLOW",
            last_n_turns_summary="测试摘要",
            recalled_memories=["记忆A", "记忆B"],
            completed_snapshot="已完成片段X",
            pending_snapshot="待完成片段Y",
        )
        self.assertIn("[CHECKPOINT_PROMPT_V2]", prompt)
        self.assertIn("[CONTEXT]", prompt)
        self.assertIn("[PROGRESS_SNAPSHOT]", prompt)
        self.assertIn("[LAST_N_TURNS_SUMMARY]", prompt)
        self.assertIn("[RECALLED_MEMORIES]", prompt)
        self.assertIn("[RESUME_STEPS]", prompt)

    def test_checkpoint_persistence_writes_json_and_txt_and_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            mgr = RecoveryManager(project_name="aifastdb-devplan", log_dir=tmp, max_events=20)
            mgr.events = [
                "DevPlan: action=wait message=T87.2 in_progress",
                "Decision: action=new_conversation message=CONTEXT_OVERFLOW",
            ]
            cp = mgr.create_and_persist_checkpoint(
                phase_id="phase-87",
                phase_title="上下文溢出恢复增强",
                task_id="T87.2",
                task_title="checkpoint_prompt 结构化模板与持久化",
                task_desc="实现固定模板",
                interrupt_reason="CONTEXT_OVERFLOW",
                recalled_memories=["m1"],
            )
            self.assertEqual(cp.template_version, "v2")
            self.assertTrue((mgr.log_dir / "checkpoint_prompt.json").exists())
            self.assertTrue((mgr.log_dir / "checkpoint_prompt.txt").exists())
            self.assertTrue((mgr.log_dir / "checkpoint_history.jsonl").exists())

    def test_load_latest_checkpoint_prompt_prefers_txt_then_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            mgr = RecoveryManager(project_name="aifastdb-devplan", log_dir=tmp, max_events=20)

            # 仅 JSON 存在时，能从 JSON 回退读取
            mgr.checkpoint_file.write_text(
                '{"timestamp":"2026-02-25T12:00:00","project_name":"aifastdb-devplan","phase_id":"phase-88","phase_title":"记忆驱动恢复","task_id":"T88.1","task_title":"加载 checkpoint","task_desc":"","interrupt_reason":"CONTEXT_OVERFLOW","last_n_turns_summary":"x","checkpoint_prompt":"JSON_PROMPT","template_version":"v2","completed_snapshot":"x","pending_snapshot":"y"}',
                encoding="utf-8",
            )
            self.assertEqual(mgr.load_latest_checkpoint_prompt(), "JSON_PROMPT")

            # TXT 存在时，优先读取 TXT
            mgr.checkpoint_prompt_file.write_text("TXT_PROMPT\n", encoding="utf-8")
            self.assertEqual(mgr.load_latest_checkpoint_prompt(), "TXT_PROMPT")

    def test_build_final_recovery_prompt_has_fixed_sections(self):
        with tempfile.TemporaryDirectory() as tmp:
            mgr = RecoveryManager(project_name="aifastdb-devplan", log_dir=tmp, max_events=20)
            cp = mgr.create_and_persist_checkpoint(
                phase_id="phase-88",
                phase_title="记忆驱动恢复",
                task_id="T88.3",
                task_title="固定恢复模板",
                task_desc="模板收敛",
                interrupt_reason="CONTEXT_OVERFLOW",
                recalled_memories=["a", "b"],
            )
            prompt = mgr.build_final_recovery_prompt(
                checkpoint=cp,
                recalled_memories=["mem1", "mem1", "mem2"],
                base_checkpoint_prompt="BASE_PROMPT",
            )
            self.assertIn("[FINAL_RECOVERY_PROMPT_V1]", prompt)
            self.assertIn("[CONTEXT]", prompt)
            self.assertIn("[PROGRESS_SNAPSHOT]", prompt)
            self.assertIn("[LAST_N_TURNS_SUMMARY]", prompt)
            self.assertIn("[RECALLED_MEMORIES]", prompt)
            self.assertIn("[CHECKPOINT_PROMPT_BASE]", prompt)
            self.assertIn("[RESUME_STEPS]", prompt)
            self.assertIn("BASE_PROMPT", prompt)


if __name__ == "__main__":
    unittest.main(verbosity=2)

