# -*- coding: utf-8 -*-
"""
中断恢复管理器：
- 生成 last_n_turns 摘要（基于本地事件环形缓冲）
- 持久化 checkpoint_prompt（JSON 文件）
- 组装恢复提示（checkpoint + recall 结果）
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger("executor.recovery")


@dataclass
class RecoveryCheckpoint:
    timestamp: str
    project_name: str
    phase_id: str
    phase_title: str
    task_id: str
    task_title: str
    task_desc: str
    interrupt_reason: str
    last_n_turns_summary: str
    checkpoint_prompt: str
    template_version: str = "v2"
    completed_snapshot: str = "未知"
    pending_snapshot: str = "未知"


class RecoveryManager:
    # checkpoint_history.jsonl 最大保留行数
    MAX_HISTORY_LINES = 200

    def __init__(self, project_name: str, log_dir: str = "logs", max_events: int = 20):
        self.project_name = project_name
        self.max_events = max_events
        self.events: list[str] = []
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.checkpoint_file = self.log_dir / "checkpoint_prompt.json"
        self.checkpoint_prompt_file = self.log_dir / "checkpoint_prompt.txt"
        self.checkpoint_history_file = self.log_dir / "checkpoint_history.jsonl"

    def record_event(self, text: str) -> None:
        text = (text or "").strip()
        if not text:
            return
        self.events.append(text)
        if len(self.events) > self.max_events:
            self.events = self.events[-self.max_events:]

    def summarize_last_turns(self, n: int = 8) -> str:
        """
        生成 last_n_turns 自动摘要（1~3 段）：
        - 第 1 段：任务上下文快照（phase/task/interruption）
        - 第 2 段：最近关键过程（DevPlan/UI/Decision）
        - 第 3 段：下一步恢复建议
        """
        recent = self.events[-max(1, n):]
        if not recent:
            return "最近会话事件较少，暂无可用摘要。"

        phase_id, task_id, reason = self._extract_context_tokens(recent)
        p1 = (
            f"任务上下文快照：当前关注 {phase_id or '未知阶段'} / {task_id or '未知子任务'}，"
            f"本轮中断信号为 {reason or '未明确'}。"
        )

        timeline = self._build_timeline_summary(recent)
        p2 = f"最近关键过程：{timeline}"

        suggestion = self._build_recovery_suggestion(recent)
        p3 = f"恢复建议：{suggestion}"

        # 固定 3 段，便于后续模板稳定解析
        return "\n\n".join([p1, p2, p3])

    @staticmethod
    def _extract_context_tokens(events: list[str]) -> tuple[Optional[str], Optional[str], Optional[str]]:
        text = "\n".join(events)
        phase_match = re.findall(r"\bphase-[0-9]+[A-Za-z]?\b", text)
        task_match = re.findall(r"\bT[0-9]+(?:\.[0-9]+)+\b", text)
        reason_match = re.findall(
            r"\b(CONNECTION_ERROR|PROVIDER_ERROR|API_TIMEOUT|RATE_LIMIT|CONTEXT_OVERFLOW|RESPONSE_STALL|RESPONSE_INTERRUPTED)\b",
            text,
        )
        phase_id = phase_match[-1] if phase_match else None
        task_id = task_match[-1] if task_match else None
        reason = reason_match[-1] if reason_match else None
        return phase_id, task_id, reason

    @staticmethod
    def _compact(event: str, max_len: int = 96) -> str:
        evt = " ".join(event.split())
        if len(evt) <= max_len:
            return evt
        return evt[: max_len - 1] + "…"

    def _build_timeline_summary(self, events: list[str]) -> str:
        devplan = [self._compact(e.split("DevPlan:", 1)[1].strip()) for e in events if "DevPlan:" in e]
        ui = [self._compact(e.split("UI:", 1)[1].strip()) for e in events if "UI:" in e]
        decision = [self._compact(e.split("Decision:", 1)[1].strip()) for e in events if "Decision:" in e]

        chunks: list[str] = []
        if devplan:
            chunks.append(f"编排侧最近状态为「{devplan[-1]}」")
        if ui:
            chunks.append(f"界面侧最近信号为「{ui[-1]}」")
        if decision:
            chunks.append(f"执行决策落在「{decision[-1]}」")
        if not chunks:
            # 兼容非标准事件
            chunks.append("已记录若干运行事件，但缺少标准 DevPlan/UI/Decision 标记")
        return "；".join(chunks) + "。"

    def _build_recovery_suggestion(self, events: list[str]) -> str:
        joined = "\n".join(events)
        if "CONTEXT_OVERFLOW" in joined:
            return "优先使用 checkpoint_prompt 开新对话恢复，并补充 recall_unified(task+error) 结果后继续。"
        if any(x in joined for x in ("CONNECTION_ERROR", "PROVIDER_ERROR", "API_TIMEOUT", "RATE_LIMIT")):
            return "先遵循退避/熔断冷却窗口，冷却后从当前子任务继续；若再次超窗则转人工接管。"
        if "RESPONSE_STALL" in joined:
            return "先发送 continue 唤醒；连续无效时切到新对话恢复并写入 checkpoint。"
        return "先校验当前子任务状态，再按 checkpoint_prompt 的步骤继续开发并回写任务状态。"

    def build_checkpoint_prompt(
        self,
        phase_id: str,
        phase_title: str,
        task_id: str,
        task_title: str,
        task_desc: str,
        interrupt_reason: str,
        last_n_turns_summary: str,
        recalled_memories: Optional[list[str]] = None,
        completed_snapshot: str = "未知",
        pending_snapshot: str = "未知",
    ) -> str:
        recalled_memories = recalled_memories or []
        mem_lines = "\n".join(f"- {m}" for m in recalled_memories[:5]) or "- 暂无召回记忆"
        return (
            "[CHECKPOINT_PROMPT_V2]\n"
            "[CONTEXT]\n"
            f"项目: {self.project_name}\n"
            f"当前阶段: {phase_id} — {phase_title}\n"
            f"当前子任务: {task_id} — {task_title}\n"
            f"任务描述: {task_desc or '（无）'}\n"
            f"最近中断原因: {interrupt_reason}\n\n"
            "[PROGRESS_SNAPSHOT]\n"
            f"已完成: {completed_snapshot}\n"
            f"未完成: {pending_snapshot}\n\n"
            "[LAST_N_TURNS_SUMMARY]\n"
            f"{last_n_turns_summary}\n\n"
            "[RECALLED_MEMORIES]\n"
            f"{mem_lines}\n\n"
            "[RESUME_STEPS]\n"
            "1) 先用 DevPlan 工具确认当前子任务状态（是否已部分完成）；\n"
            "2) 仅补齐未完成部分并做最小验证；\n"
            "3) 完成后同步任务状态并继续下一个子任务。"
        )

    def save_checkpoint(self, checkpoint: RecoveryCheckpoint) -> None:
        try:
            self.checkpoint_file.write_text(
                json.dumps(asdict(checkpoint), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            self.checkpoint_prompt_file.write_text(
                checkpoint.checkpoint_prompt + "\n",
                encoding="utf-8",
            )
            with self.checkpoint_history_file.open("a", encoding="utf-8") as f:
                f.write(json.dumps(asdict(checkpoint), ensure_ascii=False) + "\n")
            # 轮转：超过 MAX_HISTORY_LINES 时截断为最近一半
            self._rotate_history_if_needed()
        except Exception as e:
            logger.error("保存 checkpoint 失败: %s", e)

    def _rotate_history_if_needed(self) -> None:
        """当 checkpoint_history.jsonl 超过 MAX_HISTORY_LINES 行时，保留最新一半"""
        try:
            if not self.checkpoint_history_file.exists():
                return
            lines = self.checkpoint_history_file.read_text(encoding="utf-8").splitlines()
            if len(lines) <= self.MAX_HISTORY_LINES:
                return
            keep = lines[-(self.MAX_HISTORY_LINES // 2):]
            self.checkpoint_history_file.write_text(
                "\n".join(keep) + "\n",
                encoding="utf-8",
            )
            logger.info(
                "checkpoint_history.jsonl 轮转: %d → %d 行",
                len(lines), len(keep),
            )
        except Exception as e:
            logger.error("checkpoint_history.jsonl 轮转失败: %s", e)

    def load_checkpoint(self) -> Optional[RecoveryCheckpoint]:
        if not self.checkpoint_file.exists():
            return None
        try:
            data = json.loads(self.checkpoint_file.read_text(encoding="utf-8"))
            return RecoveryCheckpoint(**data)
        except Exception as e:
            logger.error("读取 checkpoint 失败: %s", e)
            return None

    def load_latest_checkpoint_prompt(self) -> str:
        """
        加载最新 checkpoint_prompt（优先 TXT，回退 JSON）。
        用于恢复阶段“先拿到可直接注入的 prompt”。
        """
        try:
            if self.checkpoint_prompt_file.exists():
                text = self.checkpoint_prompt_file.read_text(encoding="utf-8").strip()
                if text:
                    return text
        except Exception as e:
            logger.warning("读取 checkpoint_prompt.txt 失败，回退 JSON: %s", e)

        cp = self.load_checkpoint()
        if cp and cp.checkpoint_prompt:
            return cp.checkpoint_prompt.strip()
        return ""

    def build_final_recovery_prompt(
        self,
        checkpoint: RecoveryCheckpoint,
        recalled_memories: Optional[list[str]] = None,
        base_checkpoint_prompt: str = "",
    ) -> str:
        """
        T88.3: 固定最终恢复模板（checkpoint + recall 融合）。
        """
        recalled_memories = recalled_memories or []
        dedup_mem: list[str] = []
        seen: set[str] = set()
        for m in recalled_memories:
            k = (m or "").strip()
            if not k or k in seen:
                continue
            seen.add(k)
            dedup_mem.append(k[:200])
            if len(dedup_mem) >= 5:
                break
        mem_lines = "\n".join(f"- {m}" for m in dedup_mem) if dedup_mem else "- 暂无新增关键记忆"
        base = (base_checkpoint_prompt or checkpoint.checkpoint_prompt or "").strip()
        return (
            "[FINAL_RECOVERY_PROMPT_V1]\n"
            "[CONTEXT]\n"
            f"项目: {checkpoint.project_name}\n"
            f"当前阶段: {checkpoint.phase_id} — {checkpoint.phase_title}\n"
            f"当前子任务: {checkpoint.task_id} — {checkpoint.task_title}\n"
            f"最近中断原因: {checkpoint.interrupt_reason}\n\n"
            "[PROGRESS_SNAPSHOT]\n"
            f"已完成: {checkpoint.completed_snapshot}\n"
            f"未完成: {checkpoint.pending_snapshot}\n\n"
            "[LAST_N_TURNS_SUMMARY]\n"
            f"{checkpoint.last_n_turns_summary}\n\n"
            "[RECALLED_MEMORIES]\n"
            f"{mem_lines}\n\n"
            "[CHECKPOINT_PROMPT_BASE]\n"
            f"{base}\n\n"
            "[RESUME_STEPS]\n"
            "1) 先确认子任务当前状态；\n"
            "2) 仅补齐未完成部分并验证；\n"
            "3) 完成后同步任务状态并继续。"
        )

    def create_and_persist_checkpoint(
        self,
        phase_id: str,
        phase_title: str,
        task_id: str,
        task_title: str,
        task_desc: str,
        interrupt_reason: str,
        recalled_memories: Optional[list[str]] = None,
    ) -> RecoveryCheckpoint:
        summary = self.summarize_last_turns()
        completed_snapshot, pending_snapshot = self._extract_progress_snapshot()
        prompt = self.build_checkpoint_prompt(
            phase_id=phase_id,
            phase_title=phase_title,
            task_id=task_id,
            task_title=task_title,
            task_desc=task_desc,
            interrupt_reason=interrupt_reason,
            last_n_turns_summary=summary,
            recalled_memories=recalled_memories,
            completed_snapshot=completed_snapshot,
            pending_snapshot=pending_snapshot,
        )
        cp = RecoveryCheckpoint(
            timestamp=datetime.now().isoformat(timespec="seconds"),
            project_name=self.project_name,
            phase_id=phase_id,
            phase_title=phase_title,
            task_id=task_id,
            task_title=task_title,
            task_desc=task_desc,
            interrupt_reason=interrupt_reason,
            last_n_turns_summary=summary,
            checkpoint_prompt=prompt,
            template_version="v2",
            completed_snapshot=completed_snapshot,
            pending_snapshot=pending_snapshot,
        )
        self.save_checkpoint(cp)
        return cp

    def _extract_progress_snapshot(self) -> tuple[str, str]:
        """
        从最近事件中提取「已完成/未完成」快照（弱结构，尽量可读）。
        """
        recent = self.events[-max(1, min(12, len(self.events))):]
        completed = [self._compact(e, 120) for e in recent if "completed" in e.lower() or "已完成" in e]
        pending = [
            self._compact(e, 120)
            for e in recent
            if any(k in e.lower() for k in ("pending", "send_task", "wait", "in_progress")) or "未完成" in e
        ]
        completed_text = "；".join(completed[-2:]) if completed else "暂无明确完成记录"
        pending_text = "；".join(pending[-2:]) if pending else "待确认（请以 DevPlan 查询结果为准）"
        return completed_text, pending_text
