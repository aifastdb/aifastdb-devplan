# -*- coding: utf-8 -*-
"""
DevPlan Executor — Web UI 监控面板服务

提供 Flask 轻量 HTTP 服务，包含：
  - GET  /              → 主页（渲染 templates/index.html）
  - GET  /api/state     → 返回当前状态 JSON（首次加载）
  - GET  /api/stream    → SSE 实时状态推送（不含截图 base64）
  - GET  /api/screenshots → 返回截图 base64（独立拉取，减少 SSE 带宽）
  - POST /api/find_input  → 触发 GUI 输入框定位
  - POST /api/send_text   → 通过 GUI 发送文本
  - POST /api/set_interval → 设置截图间隔
  - POST /api/start_phase  → 启动新阶段

所有 GUI 相关操作通过 set_executor_refs() 注入的 CursorController 和 DevPlanClient 引用执行。
"""

from __future__ import annotations

import base64
import json
import logging
import queue
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("executor.ui_server")


# ── 全局状态 ─────────────────────────────────────────────────

class UIState:
    """
    线程安全的 UI 状态容器。

    Executor 主循环通过 update() 写入状态，
    Web UI 通过 SSE 或 /api/state 读取状态。
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._data: dict[str, Any] = {
            "running": False,
            "executor_id": "",
            "project_name": "",
            "poll_interval": 15,
            "split_quadrant": True,
            "vision_enabled": True,
            "screenshot_interval": 3.0,
            "overall_progress": "--",
            "current_phase": "",
            "current_phase_title": "",
            "phase_progress": "0/0",
            "current_task_id": "",
            "current_task_title": "",
            "devplan_action": "",
            "devplan_message": "",
            "ui_status": "",
            "screen_changing": False,
            "raw_response": "",
            "decision_action": "",
            "decision_message": "",
            "continue_retries": 0,
            "next_tick_countdown": 0,
            "screenshot_base64_1": "",
            "screenshot_base64_2": "",
            "screenshot_time_1": "",
            "screenshot_time_2": "",
            "quad_top_left_b64": "",
            "quad_top_right_b64": "",
            "quad_bottom_left_b64": "",
            "quad_bottom_right_b64": "",
            "quad_top_right_status": "",
            "quad_bottom_right_status": "",
            "top_right_changed": None,
            "bottom_right_changed": None,
            "last_update": "",
            "logs": [],
        }
        # SSE 订阅者队列列表
        self._subscribers: list[queue.Queue] = []

    def update(self, **kwargs: Any) -> None:
        """更新状态字段并通知所有 SSE 订阅者"""
        with self._lock:
            self._data.update(kwargs)
            self._data["last_update"] = datetime.now().strftime("%H:%M:%S")

        # 发送 SSE 事件（不含截图 base64，减少带宽）
        self._notify_subscribers()

    def add_log(self, level: str, message: str) -> None:
        """添加日志条目（最多保留 100 条）"""
        entry = {
            "time": datetime.now().strftime("%H:%M:%S"),
            "level": level,
            "message": message,
        }
        with self._lock:
            logs = self._data.get("logs", [])
            logs.append(entry)
            if len(logs) > 100:
                logs = logs[-100:]
            self._data["logs"] = logs
            self._data["last_update"] = datetime.now().strftime("%H:%M:%S")

        self._notify_subscribers()

    def get_state(self) -> dict[str, Any]:
        """获取当前完整状态（含截图 base64）"""
        with self._lock:
            return dict(self._data)

    def get_state_lite(self) -> dict[str, Any]:
        """获取轻量状态（不含截图 base64，用于 SSE 推送）"""
        with self._lock:
            data = dict(self._data)
        # 排除截图 base64 字段
        for key in (
            "screenshot_base64_1", "screenshot_base64_2",
            "quad_top_left_b64", "quad_top_right_b64",
            "quad_bottom_left_b64", "quad_bottom_right_b64",
        ):
            data.pop(key, None)
        return data

    def get_screenshots(self) -> dict[str, str]:
        """获取截图 base64 数据"""
        with self._lock:
            return {
                "screenshot1": self._data.get("screenshot_base64_1", ""),
                "screenshot2": self._data.get("screenshot_base64_2", ""),
                "screenshot_time_1": self._data.get("screenshot_time_1", ""),
                "screenshot_time_2": self._data.get("screenshot_time_2", ""),
                "quad_top_left": self._data.get("quad_top_left_b64", ""),
                "quad_top_right": self._data.get("quad_top_right_b64", ""),
                "quad_bottom_left": self._data.get("quad_bottom_left_b64", ""),
                "quad_bottom_right": self._data.get("quad_bottom_right_b64", ""),
            }

    def subscribe(self) -> queue.Queue:
        """创建 SSE 订阅"""
        q: queue.Queue = queue.Queue(maxsize=50)
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        """取消 SSE 订阅"""
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def _notify_subscribers(self) -> None:
        """通知所有 SSE 订阅者（轻量数据）"""
        data = self.get_state_lite()
        dead_subs: list[queue.Queue] = []
        with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                # 非阻塞 put，队列满则丢弃旧数据
                if q.full():
                    try:
                        q.get_nowait()
                    except queue.Empty:
                        pass
                q.put_nowait(data)
            except Exception:
                dead_subs.append(q)
        # 清理已断开的订阅者
        if dead_subs:
            with self._lock:
                for q in dead_subs:
                    if q in self._subscribers:
                        self._subscribers.remove(q)


# ── 全局单例 ─────────────────────────────────────────────────

ui_state = UIState()

# Executor 组件引用（由 set_executor_refs 注入）
_gui_ref: Any = None
_client_ref: Any = None
_executor_ref: Any = None
_UNSET = object()


def set_executor_refs(gui: Any = _UNSET, client: Any = _UNSET, executor: Any = _UNSET) -> None:
    """注入 Executor 组件引用，供 Web UI API 调用"""
    global _gui_ref, _client_ref, _executor_ref
    if gui is not _UNSET:
        _gui_ref = gui
    if client is not _UNSET:
        _client_ref = client
    if executor is not _UNSET:
        _executor_ref = executor


# ── 工具函数 ─────────────────────────────────────────────────

def image_to_base64(image_path: str) -> str:
    """将图片文件转为 base64 字符串"""
    try:
        path = Path(image_path)
        if not path.exists():
            return ""
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
    except Exception as e:
        logger.warning("图片转 base64 失败 (%s): %s", image_path, e)
        return ""


# ── Flask 应用 ───────────────────────────────────────────────

def create_app():
    """创建 Flask 应用"""
    try:
        from flask import Flask, Response, jsonify, render_template, request
    except ImportError:
        logger.error("Flask 未安装，Web UI 不可用。请运行: pip install flask")
        return None

    # templates 目录在 executor/templates/
    template_dir = Path(__file__).parent.parent / "templates"
    app = Flask(
        __name__,
        template_folder=str(template_dir),
    )

    # 禁用 Flask 默认日志（太吵）
    werkzeug_log = logging.getLogger("werkzeug")
    werkzeug_log.setLevel(logging.WARNING)

    @app.route("/")
    def index():
        """主页"""
        return render_template("index.html")

    @app.route("/api/state")
    def api_state():
        """返回当前完整状态"""
        return jsonify(ui_state.get_state())

    @app.route("/api/stream")
    def api_stream():
        """SSE 实时状态推送"""
        def event_stream():
            sub = ui_state.subscribe()
            try:
                # 立即发送当前状态
                data = ui_state.get_state_lite()
                yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
                while True:
                    try:
                        data = sub.get(timeout=30)
                        yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
                    except queue.Empty:
                        # 心跳保活
                        yield ": heartbeat\n\n"
            except GeneratorExit:
                pass
            finally:
                ui_state.unsubscribe(sub)

        return Response(
            event_stream(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @app.route("/api/screenshots")
    def api_screenshots():
        """返回截图 base64 数据"""
        return jsonify(ui_state.get_screenshots())

    @app.route("/api/find_input", methods=["POST"])
    def api_find_input():
        """触发 GUI 输入框定位"""
        if _gui_ref is None or not _gui_ref.available:
            return jsonify({"success": False, "message": "GUI 控制不可用"})
        try:
            success = _gui_ref.click_input_area()
            return jsonify({
                "success": success,
                "message": "已定位输入框" if success else "定位失败",
            })
        except Exception as e:
            return jsonify({"success": False, "message": str(e)})

    @app.route("/api/send_text", methods=["POST"])
    def api_send_text():
        """通过 GUI 发送文本"""
        if _gui_ref is None or not _gui_ref.available:
            return jsonify({"success": False, "message": "GUI 控制不可用"})
        try:
            data = request.get_json() or {}
            text = data.get("text", "请继续")
            result = _gui_ref.send_text(text)
            return jsonify({
                "success": result.success,
                "message": result.message,
                "queued": result.queued,
            })
        except Exception as e:
            return jsonify({"success": False, "message": str(e)})

    @app.route("/api/set_interval", methods=["POST"])
    def api_set_interval():
        """设置截图间隔"""
        try:
            data = request.get_json() or {}
            interval = float(data.get("interval", 3.0))
            interval = max(0.5, min(10.0, interval))  # 限制范围
            ui_state.update(screenshot_interval=interval)
            return jsonify({"success": True, "interval": interval})
        except Exception as e:
            return jsonify({"success": False, "message": str(e)})

    @app.route("/api/set_vision", methods=["POST"])
    def api_set_vision():
        """运行时启用/禁用截图分析分支"""
        if _executor_ref is None or not hasattr(_executor_ref, "set_vision_enabled"):
            return jsonify({"success": False, "message": "Executor 不支持运行时切换截图分析"})
        try:
            data = request.get_json() or {}
            enabled = bool(data.get("enabled", True))
            ok, message = _executor_ref.set_vision_enabled(enabled)
            return jsonify({"success": bool(ok), "enabled": enabled, "message": message})
        except Exception as e:
            return jsonify({"success": False, "message": str(e)})

    @app.route("/api/start_phase", methods=["POST"])
    def api_start_phase():
        """启动新阶段"""
        if _client_ref is None:
            return jsonify({"success": False, "message": "DevPlan 客户端不可用"})
        try:
            data = request.get_json() or {}
            phase_id = data.get("phaseId", "")
            if not phase_id:
                return jsonify({"success": False, "message": "请提供阶段 ID"})
            result = _client_ref.start_phase(phase_id)
            if result and result.get("success"):
                ui_state.add_log("INFO", f"已通过 Web UI 启动阶段: {phase_id}")
                return jsonify({"success": True, "message": f"已启动 {phase_id}"})
            else:
                return jsonify({"success": False, "message": f"启动失败: {result}"})
        except Exception as e:
            return jsonify({"success": False, "message": str(e)})

    return app


# ── 服务器启动 ───────────────────────────────────────────────

def start_server_thread(host: str = "127.0.0.1", port: int = 5000) -> Optional[threading.Thread]:
    """
    在后台线程中启动 Flask Web UI 服务器。

    Args:
        host: 绑定地址
        port: 端口号

    Returns:
        服务器线程，启动失败返回 None
    """
    app = create_app()
    if app is None:
        logger.error("Web UI 创建失败，跳过启动")
        return None

    def _run():
        try:
            app.run(
                host=host,
                port=port,
                debug=False,
                use_reloader=False,
                threaded=True,
            )
        except Exception as e:
            logger.error("Web UI 服务异常退出: %s", e)

    thread = threading.Thread(target=_run, daemon=True, name="ui-server")
    thread.start()
    logger.info("Web UI 已启动: http://%s:%d", host, port)
    return thread


# 兼容测试：模块导入时提供 app 对象
app = create_app()
