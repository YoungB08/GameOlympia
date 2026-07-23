from __future__ import annotations

import threading
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from PySide6.QtCore import QObject, Signal

try:
    import socketio
except ImportError:  # pragma: no cover - handled in the UI at runtime
    socketio = None


def deep_merge(target: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    next_state = deepcopy(target) if isinstance(target, dict) else {}
    for key, value in (patch or {}).items():
        if (
            isinstance(value, dict)
            and isinstance(next_state.get(key), dict)
        ):
            next_state[key] = deep_merge(next_state[key], value)
        else:
            next_state[key] = deepcopy(value)
    return next_state


def parse_started_at(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    except ValueError:
        return None


def seconds_remaining(timer: dict[str, Any] | None) -> int:
    if not timer:
        return 0
    total = int(float(timer.get("seconds") or 0))
    fallback = int(float(timer.get("remaining") if timer.get("remaining") is not None else total))
    if not timer.get("running"):
        return max(0, fallback)
    started = parse_started_at(timer.get("startedAt"))
    if not started:
        return max(0, fallback)
    elapsed = int((datetime.now(UTC) - started).total_seconds())
    return max(0, total - elapsed)


class RealtimeClient(QObject):
    connected = Signal()
    disconnected = Signal()
    state_initialized = Signal(object)
    state_patched = Signal(object)
    login_ok = Signal(object)
    login_error = Signal(str)
    error_message = Signal(str)

    def __init__(self) -> None:
        super().__init__()
        self.server_url = ""
        self.room_code = ""
        self.state: dict[str, Any] = {}
        self.connected_flag = False
        self._sio: Any | None = None
        self._connect_thread: threading.Thread | None = None

    def connect_to(self, server_url: str, room_code: str) -> None:
        self.server_url = server_url.rstrip("/")
        self.room_code = room_code.strip()
        if not self.server_url or not self.room_code:
            self.error_message.emit("Vui lòng nhập địa chỉ admin và mã phòng thi.")
            return
        if socketio is None:
            self.error_message.emit(
                "Thiếu thư viện python-socketio. Hãy chạy: pip install -r requirements.txt"
            )
            return
        if self._sio and self._sio.connected:
            self._sio.emit("room:join", {"roomCode": self.room_code})
            return

        self._sio = socketio.Client(reconnection=True, logger=False, engineio_logger=False)
        self._register_handlers(self._sio)
        self._connect_thread = threading.Thread(target=self._connect_worker, daemon=True)
        self._connect_thread.start()

    def disconnect_from_server(self) -> None:
        if self._sio:
            try:
                self._sio.disconnect()
            except Exception:
                pass

    def login_candidate(self, login_code: str) -> None:
        code = str(login_code or "").strip()
        if not code:
            self.login_error.emit("Vui lòng nhập mã ID thí sinh.")
            return
        if not self._sio or not self._sio.connected:
            self.login_error.emit("Chưa kết nối phòng thi.")
            return
        self._sio.emit("candidate:login", {"loginCode": code})

    def submit_answer(self, contestant_id: int, answer_text: str, question_key: str | None = None) -> None:
        if not self._sio or not self._sio.connected:
            self.error_message.emit("Chưa kết nối phòng thi.")
            return
        self._sio.emit(
            "candidate:answer",
            {
                "contestantId": int(contestant_id),
                "answerText": answer_text,
                "questionKey": question_key,
            },
        )

    def buzz(self, contestant_id: int) -> None:
        if not self._sio or not self._sio.connected:
            self.error_message.emit("Chưa kết nối phòng thi.")
            return
        self._sio.emit("candidate:buzz", {"contestantId": int(contestant_id)})

    def submit_wall(self, contestant_id: int, cell_ids: list[int]) -> None:
        if not self._sio or not self._sio.connected:
            self.error_message.emit("Chưa kết nối phòng thi.")
            return
        self._sio.emit("wall:submit", {"contestantId": int(contestant_id), "cellIds": cell_ids})

    def _connect_worker(self) -> None:
        try:
            assert self._sio is not None
            self._sio.connect(self.server_url, transports=["websocket", "polling"])
        except Exception as exc:
            self.error_message.emit(f"Không kết nối được admin server: {exc}")

    def _register_handlers(self, sio: Any) -> None:
        @sio.event
        def connect() -> None:
            self.connected_flag = True
            sio.emit("room:join", {"roomCode": self.room_code})
            self.connected.emit()

        @sio.event
        def disconnect() -> None:
            self.connected_flag = False
            self.disconnected.emit()

        @sio.on("state:init")
        def on_state_init(next_state: dict[str, Any] | None = None) -> None:
            self.state = deepcopy(next_state or {})
            self.state_initialized.emit(self.state)

        @sio.on("state:patch")
        def on_state_patch(patch: dict[str, Any] | None = None) -> None:
            self.state = deep_merge(self.state, patch or {})
            self.state_patched.emit(self.state)

        @sio.on("candidate:login:ok")
        def on_login_ok(payload: dict[str, Any] | None = None) -> None:
            self.login_ok.emit(payload or {})

        @sio.on("candidate:login:error")
        def on_login_error(message: str = "") -> None:
            self.login_error.emit(str(message or "Mã ID không hợp lệ."))

        @sio.on("error:message")
        def on_error_message(message: str = "") -> None:
            self.error_message.emit(str(message or "Có lỗi từ admin server."))
