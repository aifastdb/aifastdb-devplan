# -*- coding: utf-8 -*-
"""
Web UI 服务器单元测试

测试内容：
  1. UIState 单例和线程安全
  2. Flask 路由 (/, /api/state, /api/stream, /api/logs)
  3. 手动控制 API (send_text, find_input, start_phase, complete_task)
  4. SSE 实时推送
  5. 截图 base64 转换工具
"""

import json
import os
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.ui_server import UIState, app, ui_state, image_to_base64, set_executor_refs


class TestUIStateSingleton(unittest.TestCase):
    """UIState 单例行为"""

    def setUp(self):
        # 重置单例以便测试
        UIState._instance = None
        UIState._UIState__initialized = False  # type: ignore[attr-defined]

    def tearDown(self):
        UIState._instance = None

    def test_singleton_same_instance(self):
        """多次创建应返回同一实例"""
        a = UIState()
        b = UIState()
        self.assertIs(a, b)

    def test_initial_state(self):
        """初始状态应有合理的默认值"""
        state = UIState()
        snapshot = state.get_state()
        self.assertFalse(snapshot["running"])
        self.assertEqual(snapshot["ui_status"], "IDLE")
        self.assertEqual(snapshot["executor_id"], "")
        self.assertEqual(snapshot["logs"], [])

    def test_update(self):
        """update() 应批量更新字段"""
        state = UIState()
        state.update(
            running=True,
            executor_id="ex-1",
            ui_status="WORKING",
            project_name="test-project",
        )
        snapshot = state.get_state()
        self.assertTrue(snapshot["running"])
        self.assertEqual(snapshot["executor_id"], "ex-1")
        self.assertEqual(snapshot["ui_status"], "WORKING")
        self.assertEqual(snapshot["project_name"], "test-project")

    def test_update_ignores_unknown_fields(self):
        """update() 应忽略不存在的字段"""
        state = UIState()
        state.update(nonexistent_field="should_be_ignored")
        snapshot = state.get_state()
        self.assertNotIn("nonexistent_field", snapshot)

    def test_add_log(self):
        """add_log() 应添加日志条目"""
        state = UIState()
        state.add_log("INFO", "测试消息")
        state.add_log("ERROR", "错误消息")
        snapshot = state.get_state()
        self.assertEqual(len(snapshot["logs"]), 2)
        self.assertEqual(snapshot["logs"][0]["level"], "INFO")
        self.assertEqual(snapshot["logs"][0]["message"], "测试消息")
        self.assertEqual(snapshot["logs"][1]["level"], "ERROR")

    def test_log_rotation(self):
        """日志应保持最近 50 条"""
        state = UIState()
        for i in range(60):
            state.add_log("INFO", f"msg-{i}")
        snapshot = state.get_state()
        # get_state 返回最后 20 条用于 UI 显示
        self.assertLessEqual(len(snapshot["logs"]), 20)
        # 内部应保持 50 条
        self.assertEqual(len(state.logs), 50)
        self.assertEqual(state.logs[0]["message"], "msg-10")  # 最早的是 msg-10

    def test_thread_safety(self):
        """多线程并发更新不应崩溃"""
        state = UIState()
        errors = []

        def writer(n):
            try:
                for i in range(50):
                    state.update(ui_status=f"STATUS_{n}_{i}")
                    state.add_log("INFO", f"thread-{n}-{i}")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(i,)) for i in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0)
        snapshot = state.get_state()
        self.assertIn("STATUS_", snapshot["ui_status"])

    def test_last_update_timestamp(self):
        """update() 应自动设置 last_update"""
        state = UIState()
        state.update(running=True)
        snapshot = state.get_state()
        self.assertNotEqual(snapshot["last_update"], "")
        # 时间格式: HH:MM:SS
        self.assertRegex(snapshot["last_update"], r"\d{2}:\d{2}:\d{2}")


class TestFlaskRoutes(unittest.TestCase):
    """Flask 路由测试"""

    def setUp(self):
        # 重置全局引用
        set_executor_refs(gui=None, client=None)
        app.testing = True
        self.client = app.test_client()
        # 直接更新模块级 ui_state（单例，不重置以避免引用分离）
        ui_state.update(running=True, project_name="test-proj", executor_id="ex-1")

    def test_index_returns_html(self):
        """GET / 应返回 HTML 页面"""
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"DevPlan Executor", resp.data)
        self.assertIn(b"<!DOCTYPE html>", resp.data)

    def test_api_state_returns_json(self):
        """GET /api/state 应返回 JSON 状态"""
        resp = self.client.get("/api/state")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["running"])
        self.assertEqual(data["project_name"], "test-proj")
        self.assertEqual(data["executor_id"], "ex-1")

    def test_api_state_contains_all_keys(self):
        """状态 JSON 应包含所有必需字段"""
        resp = self.client.get("/api/state")
        data = resp.get_json()
        required_keys = [
            "running", "executor_id", "project_name", "last_update",
            "devplan_action", "devplan_message",
            "current_phase", "current_phase_title", "phase_progress",
            "overall_progress", "current_task_id", "current_task_title",
            "ui_status", "screen_changing", "raw_response",
            "screenshot1", "screenshot2",
            "screenshot_time_1", "screenshot_time_2", "screenshot_interval",
            "decision_action", "decision_message", "continue_retries",
            "logs",
        ]
        for key in required_keys:
            self.assertIn(key, data, f"缺少字段: {key}")

    def test_api_logs(self):
        """GET /api/logs 应返回日志列表"""
        ui_state.add_log("INFO", "log-1")
        ui_state.add_log("WARNING", "log-2")
        resp = self.client.get("/api/logs")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertGreaterEqual(len(data), 2)

    def test_api_stream_sse(self):
        """GET /api/stream 应返回 SSE 流"""
        ui_state.update(ui_status="WORKING")

        resp = self.client.get("/api/stream")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/event-stream", resp.content_type)

    def test_send_text_no_gui(self):
        """POST /api/send_text 无 GUI 时应返回失败"""
        resp = self.client.post("/api/send_text",
                                json={"text": "hello"},
                                content_type="application/json")
        data = resp.get_json()
        self.assertFalse(data["success"])
        self.assertIn("不可用", data["message"])

    def test_send_text_with_mock_gui(self):
        """POST /api/send_text 有 GUI mock 时应调用 send_text"""
        mock_gui = MagicMock()
        mock_gui.available = True
        mock_result = MagicMock()
        mock_result.success = True
        mock_result.message = "发送成功"
        mock_gui.send_text.return_value = mock_result
        set_executor_refs(gui=mock_gui)

        resp = self.client.post("/api/send_text",
                                json={"text": "请继续"},
                                content_type="application/json")
        data = resp.get_json()
        self.assertTrue(data["success"])
        mock_gui.send_text.assert_called_once_with("请继续")

    def test_find_input_no_gui(self):
        """POST /api/find_input 无 GUI 时应返回失败"""
        resp = self.client.post("/api/find_input")
        data = resp.get_json()
        self.assertFalse(data["success"])

    def test_start_phase_missing_param(self):
        """POST /api/start_phase 缺少参数应报错"""
        resp = self.client.post("/api/start_phase",
                                json={},
                                content_type="application/json")
        data = resp.get_json()
        self.assertFalse(data["success"])
        self.assertIn("phaseId", data["message"])

    def test_start_phase_no_client(self):
        """POST /api/start_phase 无客户端应报错"""
        resp = self.client.post("/api/start_phase",
                                json={"phaseId": "phase-1"},
                                content_type="application/json")
        data = resp.get_json()
        self.assertFalse(data["success"])
        self.assertIn("不可用", data["message"])

    def test_start_phase_with_mock_client(self):
        """POST /api/start_phase 有 mock 客户端时应调用 start_phase"""
        mock_client = MagicMock()
        mock_client.start_phase.return_value = {"success": True}
        set_executor_refs(client=mock_client)

        resp = self.client.post("/api/start_phase",
                                json={"phaseId": "phase-6"},
                                content_type="application/json")
        data = resp.get_json()
        self.assertTrue(data["success"])
        mock_client.start_phase.assert_called_once_with("phase-6")

    def test_set_vision_with_mock_executor(self):
        """POST /api/set_vision 应调用 executor.set_vision_enabled"""
        mock_exec = MagicMock()
        mock_exec.set_vision_enabled.return_value = (True, "ok")
        set_executor_refs(executor=mock_exec)

        resp = self.client.post(
            "/api/set_vision",
            json={"enabled": False},
            content_type="application/json",
        )
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertFalse(data["enabled"])
        mock_exec.set_vision_enabled.assert_called_once_with(False)

    def test_complete_task_missing_param(self):
        """POST /api/complete_task 缺少 taskId 应报错"""
        resp = self.client.post("/api/complete_task",
                                json={},
                                content_type="application/json")
        data = resp.get_json()
        self.assertFalse(data["success"])

    def test_complete_task_with_mock_client(self):
        """POST /api/complete_task 有 mock 客户端应调用"""
        mock_client = MagicMock()
        mock_client.complete_task.return_value = {"success": True}
        set_executor_refs(client=mock_client)

        resp = self.client.post("/api/complete_task",
                                json={"taskId": "T6.1"},
                                content_type="application/json")
        data = resp.get_json()
        self.assertTrue(data["success"])
        mock_client.complete_task.assert_called_once_with("T6.1")

    def test_set_interval(self):
        """POST /api/set_interval 应设置截图间隔"""
        resp = self.client.post("/api/set_interval",
                                json={"interval": 3.0},
                                content_type="application/json")
        data = resp.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["interval"], 3.0)

    def test_set_interval_clamped(self):
        """截图间隔应被限制在 0.5-10.0"""
        resp = self.client.post("/api/set_interval",
                                json={"interval": 0.1},
                                content_type="application/json")
        data = resp.get_json()
        self.assertEqual(data["interval"], 0.5)

        resp = self.client.post("/api/set_interval",
                                json={"interval": 99},
                                content_type="application/json")
        data = resp.get_json()
        self.assertEqual(data["interval"], 10.0)

    def test_diagnostics(self):
        """GET /api/diagnostics 应返回诊断信息"""
        resp = self.client.get("/api/diagnostics")
        data = resp.get_json()
        self.assertIn("gui_available", data)
        self.assertIn("client_available", data)
        self.assertFalse(data["gui_available"])  # 未设置 GUI


class TestImageToBase64(unittest.TestCase):
    """截图转 base64 工具测试"""

    def test_valid_image(self):
        """有效图片应返回 base64 字符串"""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(b"\x89PNG\r\n\x1a\n")  # PNG magic bytes
            f.flush()
            result = image_to_base64(f.name)
        os.unlink(f.name)
        self.assertTrue(len(result) > 0)

    def test_nonexistent_file(self):
        """不存在的文件应返回空字符串"""
        result = image_to_base64("/nonexistent/path.png")
        self.assertEqual(result, "")

    def test_empty_path(self):
        """空路径应返回空字符串"""
        result = image_to_base64("")
        self.assertEqual(result, "")


class TestConfigUIFields(unittest.TestCase):
    """配置中 Web UI 相关字段测试"""

    def test_default_ui_port(self):
        """默认 UI 端口应为 5000"""
        from src.config import ExecutorConfig
        config = ExecutorConfig()
        self.assertEqual(config.ui_port, 5000)

    def test_default_no_ui(self):
        """默认不禁用 UI"""
        from src.config import ExecutorConfig
        config = ExecutorConfig()
        self.assertFalse(config.no_ui)

    def test_custom_ui_port(self):
        """可自定义 UI 端口"""
        from src.config import ExecutorConfig
        config = ExecutorConfig(ui_port=8080)
        self.assertEqual(config.ui_port, 8080)


if __name__ == "__main__":
    unittest.main()
