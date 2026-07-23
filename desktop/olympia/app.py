from __future__ import annotations

import sys
from copy import deepcopy
from typing import Any

from PySide6.QtCore import QSettings, QTimer, Qt
from PySide6.QtGui import QFont, QKeyEvent, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QSizePolicy,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from .audio import MediaPlayback
from .client_widgets import (
    CLIENT_QSS,
    BuzzerIndicator,
    GoldTitle,
    ProfileCard,
    QuestionBox,
    RoundVisualPanel,
    StageBackground,
)
from .config import ADMIN_SERVER_URL, APP_HEIGHT, APP_WIDTH, BRAND_LOGO_PATH
from .realtime_client import RealtimeClient, remaining_milliseconds, seconds_remaining


def round_label(round_key: str | None) -> str:
    return {
        "setup": "SẢNH CHỜ",
        "warmup": "KHỞI ĐỘNG",
        "obstacle": "VƯỢT CHƯỚNG NGẠI VẬT",
        "speed": "TĂNG TỐC",
        "finish": "VỀ ĐÍCH",
        "tie_breaker": "CÂU HỎI PHỤ",
        "jeopardy": "MVT JEOPARDY",
        "connecting_wall": "TƯỜNG LIÊN KẾT",
        "summary": "TỔNG KẾT",
    }.get(str(round_key or "setup"), str(round_key or "setup").upper())


def deep_get(data: dict[str, Any], key: str, default: Any = None) -> Any:
    current: Any = data
    for part in key.split("."):
        if not isinstance(current, dict):
            return default
        current = current.get(part)
    return current if current is not None else default


def selected_candidate(state: dict[str, Any], contestant_id: int | None) -> dict[str, Any] | None:
    if not contestant_id:
        return None
    for candidate in state.get("candidates") or []:
        is_active = candidate.get("is_active", 1)
        if int(candidate.get("id") or 0) == int(contestant_id) and str(is_active).lower() not in {"0", "false"}:
            return candidate
    return None


def is_buzz_round(state: dict[str, Any]) -> bool:
    round_key = state.get("round")
    return round_key in {"obstacle", "finish", "tie_breaker", "jeopardy"} or (
        round_key == "warmup" and deep_get(state, "warmup.mode") == "common"
    )


def buzzer_status(state: dict[str, Any], contestant_id: int | None) -> dict[str, Any]:
    selected_id = int(contestant_id or 0)
    last_status = deep_get(state, f"ring.lastStatus.{selected_id}") if selected_id else None
    first_id = int(deep_get(state, "ring.firstContestantId", 0) or 0)
    has_triggered = bool(selected_id and (last_status == "accepted" or first_id == selected_id))
    is_foul = state.get("round") == "tie_breaker" and last_status == "foul"
    is_locked = bool(deep_get(state, "ring.locked", True)) and not has_triggered and not is_foul
    if is_foul:
        icon_state = "foul"
        label = "PHẠM QUY"
        detail = "Mất quyền trả lời câu này"
    elif has_triggered:
        icon_state = "triggered"
        label = "ĐÃ BẤM"
        detail = "Đã giành quyền trả lời"
    elif is_locked:
        icon_state = "locked"
        label = "ĐÃ KHÓA"
        detail = "Chờ kỹ thuật mở quyền"
    else:
        icon_state = "active"
        label = "SẴN SÀNG"
        detail = "Có thể bấm chuông bằng Enter"
    return {
        "lastStatus": last_status,
        "hasTriggered": has_triggered,
        "isFoul": is_foul,
        "isLocked": is_locked,
        "iconState": icon_state,
        "label": label,
        "detail": detail,
    }


def can_buzz(state: dict[str, Any], contestant: dict[str, Any] | None) -> bool:
    if not contestant or not is_buzz_round(state):
        return False
    contestant_id = int(contestant.get("id") or 0)
    status = deep_get(state, f"ring.lastStatus.{contestant_id}")
    first_id = int(deep_get(state, "ring.firstContestantId", 0) or 0)
    if status in {"foul", "accepted"} or first_id == contestant_id:
        return False
    if state.get("round") == "tie_breaker" and deep_get(state, "tieBreaker.armed") is False:
        return True
    if deep_get(state, "ring.locked", True):
        return False
    if first_id and first_id != contestant_id:
        return False
    return True


def can_answer(state: dict[str, Any], contestant: dict[str, Any] | None, buzzer: dict[str, Any]) -> bool:
    if not contestant or not deep_get(state, "question.visible") or buzzer.get("isFoul"):
        return False
    if not deep_get(state, "timer.running"):
        return False
    contestant_id = int(contestant.get("id") or 0)
    first_id = int(deep_get(state, "ring.firstContestantId", 0) or 0)
    round_key = state.get("round")
    if round_key == "warmup":
        if deep_get(state, "warmup.mode") == "common":
            return first_id == contestant_id
        active_id = int(deep_get(state, "warmup.activeContestantId", 0) or 0)
        return not active_id or active_id == contestant_id
    if round_key in {"speed", "obstacle"}:
        return True
    if round_key == "finish":
        active_id = int(deep_get(state, "finish.activeContestantId", 0) or 0)
        is_main = active_id == contestant_id and not deep_get(state, "finish.stealMode")
        is_steal = first_id == contestant_id and contestant_id != active_id
        return is_main or is_steal
    if round_key in {"tie_breaker", "jeopardy"}:
        return first_id == contestant_id
    return round_key == "connecting_wall"


def timer_percent(state: dict[str, Any]) -> float:
    timer = state.get("timer") or {}
    total = float(timer.get("durationMs") or float(timer.get("seconds") or 0) * 1000)
    remaining = float(timer.get("remainingMs") if timer.get("remainingMs") is not None else float(timer.get("remaining") or 0) * 1000)
    if total <= 0:
        return 100.0
    return max(0.0, min(100.0, remaining / total * 100))


def speed_frame_index(state: dict[str, Any]) -> int:
    timer = state.get("timer") or {}
    total = int(timer.get("durationMs") or int(float(timer.get("seconds") or 0) * 1000))
    remaining = int(timer.get("remainingMs") if timer.get("remainingMs") is not None else total)
    if total > 0:
        elapsed = max(0, total - remaining)
        durations = [
            max(0, int(float(value) * 1000))
            for value in ((state.get("speed") or {}).get("imageDurations") or [])
            if str(value or "").strip()
        ]
        if durations:
            cursor = 0
            for index, duration in enumerate(durations):
                cursor += duration
                if elapsed < cursor:
                    return max(0, min(index, 3))
            return max(0, min(len(durations) - 1, 3))
        return min(3, int(elapsed / max(1, total / 4)))
    return max(0, min(3, int(deep_get(state, "speed.questionIndex", 1) or 1) - 1))


class WindowControls(QWidget):
    def __init__(self, window: "MainWindow") -> None:
        super().__init__()
        self.window = window
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)
        full_btn = QPushButton("Toàn màn hình")
        full_btn.setObjectName("ghostButton")
        mini_btn = QPushButton("Mini")
        mini_btn.setObjectName("ghostButton")
        min_btn = QPushButton("Thu nhỏ")
        min_btn.setObjectName("ghostButton")
        full_btn.clicked.connect(window.toggle_fullscreen)
        mini_btn.clicked.connect(window.toggle_mini_mode)
        min_btn.clicked.connect(window.showMinimized)
        layout.addWidget(full_btn)
        layout.addWidget(mini_btn)
        layout.addWidget(min_btn)


class MainWindow(StageBackground):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Olympia Client - KNTech")
        self.setMinimumSize(520, 360)
        self.resize(APP_WIDTH, APP_HEIGHT)
        self.setStyleSheet(CLIENT_QSS)
        self.settings = QSettings("KNTech", "OlympiaClient")
        self.realtime = RealtimeClient()
        self.state: dict[str, Any] = {}
        self.contestant: dict[str, Any] | None = None
        self.pending_login_code = ""
        self.mini_mode = False
        self.media_player = MediaPlayback()
        self._last_media_token = ""

        self.stack = QStackedWidget()
        self.login_page = LoginPage(self)
        self.client_page = ClientPage(self)
        self.stack.addWidget(self.login_page)
        self.stack.addWidget(self.client_page)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.stack)

        self.realtime.connected.connect(self.login_page.on_connected)
        self.realtime.disconnected.connect(self.on_disconnected)
        self.realtime.state_initialized.connect(self.on_state_initialized)
        self.realtime.state_patched.connect(self.on_state_patched)
        self.realtime.login_ok.connect(self.on_login_ok)
        self.realtime.login_error.connect(self.on_login_error)
        self.realtime.error_message.connect(self.show_error)

    @property
    def contestant_id(self) -> int:
        return int((self.contestant or {}).get("id") or 0)

    def connect_room(self, server_url: str, room_code: str = "") -> None:
        self.settings.setValue("server_url", server_url)
        if room_code:
            self.settings.setValue("room_code", room_code)
        self.realtime.connect_to(server_url, room_code)

    def login_candidate(self, login_code: str) -> None:
        self.pending_login_code = login_code.strip()
        self.settings.setValue("login_code", self.pending_login_code)
        if not self.realtime.connected_flag:
            self.login_page.connect_and_login()
            return
        self.realtime.login_candidate(self.pending_login_code)

    def on_state_initialized(self, state: object) -> None:
        self.state = deepcopy(state if isinstance(state, dict) else {})
        self.state["timer"] = {
            **(self.state.get("timer") or {}),
            "remaining": seconds_remaining(self.state.get("timer")),
            "remainingMs": remaining_milliseconds(self.state.get("timer")),
        }
        self.sync_media_playback()
        self.login_page.populate_candidates(self.state.get("candidates") or [])
        self.client_page.render(self.state)

    def on_state_patched(self, state: object) -> None:
        self.state = deepcopy(state if isinstance(state, dict) else {})
        self.state["timer"] = {
            **(self.state.get("timer") or {}),
            "remaining": seconds_remaining(self.state.get("timer")),
            "remainingMs": remaining_milliseconds(self.state.get("timer")),
        }
        self.sync_media_playback()
        self.login_page.populate_candidates(self.state.get("candidates") or [])
        self.client_page.render(self.state)

    def sync_media_playback(self) -> None:
        media = self.state.get("media") or {}
        media_url = str(media.get("url") or "")
        token = f"{media_url}|{media.get('startedAt') or ''}" if media.get("playing") and media_url else ""
        if not token:
            if self._last_media_token:
                self.media_player.stop()
            self._last_media_token = ""
            return
        if token == self._last_media_token:
            return
        self._last_media_token = token
        self.media_player.play_media(media_url, self.realtime.server_url, media.get("volume", 0.5))

    def on_login_ok(self, payload: object) -> None:
        data = payload if isinstance(payload, dict) else {}
        self.contestant = data.get("contestant") or {}
        room = data.get("room") if isinstance(data.get("room"), dict) else {}
        if room.get("room_code"):
            self.settings.setValue("room_code", str(room.get("room_code") or ""))
        if self.contestant:
            self.settings.setValue("contestant_id", int(self.contestant.get("id") or 0))
        self.stack.setCurrentWidget(self.client_page)
        self.client_page.render(self.state)
        self.client_page.answer_input.setFocus()

    def on_login_error(self, message: str) -> None:
        self.contestant = None
        self.stack.setCurrentWidget(self.login_page)
        self.login_page.set_status(message or "Mã ID không hợp lệ.", error=True)

    def return_to_login(self) -> None:
        self.contestant = None
        self.pending_login_code = ""
        self.stack.setCurrentWidget(self.login_page)
        self.login_page.set_status("Nhập mã ID thí sinh do admin cấp.", error=False)
        self.login_page.code_input.selectAll()
        self.login_page.code_input.setFocus()

    def on_disconnected(self) -> None:
        self.client_page.set_status("Mất kết nối admin server.", error=True)
        self.login_page.set_status("Mất kết nối admin server.", error=True)

    def show_error(self, message: str) -> None:
        current = self.stack.currentWidget()
        if hasattr(current, "set_status"):
            current.set_status(message, error=True)
        else:
            QMessageBox.warning(self, "Thông báo", message)

    def toggle_fullscreen(self) -> None:
        if self.isFullScreen():
            self.showNormal()
            if self.mini_mode:
                self.resize(520, 360)
        else:
            self.showFullScreen()

    def toggle_mini_mode(self) -> None:
        self.mini_mode = not self.mini_mode
        self.client_page.set_compact(self.mini_mode)
        self.login_page.set_compact(self.mini_mode)
        self.showNormal()
        self.resize(520, 360) if self.mini_mode else self.resize(APP_WIDTH, APP_HEIGHT)

    def keyPressEvent(self, event: QKeyEvent) -> None:  # noqa: N802
        if event.key() == Qt.Key.Key_F11:
            self.toggle_fullscreen()
            event.accept()
            return
        if event.key() == Qt.Key.Key_Escape and self.isFullScreen():
            self.showNormal()
            event.accept()
            return
        super().keyPressEvent(event)


class LoginPage(QWidget):
    def __init__(self, window: MainWindow) -> None:
        super().__init__()
        self.window = window
        self._last_candidates: list[dict[str, Any]] = []
        self.compact = False

        root = QVBoxLayout(self)
        root.setContentsMargins(22, 18, 22, 18)
        root.setSpacing(16)
        top = QHBoxLayout()
        self.status_label = QLabel("Nhập mã ID thí sinh do admin cấp.")
        self.status_label.setObjectName("statusText")
        top.addWidget(self.status_label, 1)
        top.addWidget(WindowControls(window))
        root.addLayout(top)

        root.addStretch(1)
        self.panel = QFrame()
        self.panel.setObjectName("glassPanel")
        self.panel.setMaximumWidth(760)
        panel_layout = QVBoxLayout(self.panel)
        panel_layout.setContentsMargins(34, 26, 34, 26)
        panel_layout.setSpacing(15)

        self.logo = QLabel()
        self.logo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.logo.setFixedHeight(92)
        if BRAND_LOGO_PATH.exists():
            self.logo.setPixmap(
                QPixmap(str(BRAND_LOGO_PATH)).scaledToHeight(
                    86,
                    Qt.TransformationMode.SmoothTransformation,
                )
            )
        panel_layout.addWidget(self.logo)

        self.title = GoldTitle("OLYMPIA ACADEMIC CHALLENGE", 36)
        panel_layout.addWidget(self.title)

        self.server_input = QLineEdit()
        self.server_input.setPlaceholderText("Địa chỉ admin server")
        saved_server_url = str(window.settings.value("server_url", ADMIN_SERVER_URL) or "").strip() or ADMIN_SERVER_URL
        self.server_input.setText(saved_server_url)
        self.code_input = QLineEdit()
        self.code_input.setPlaceholderText("Mã ID thí sinh")
        self.code_input.setText(str(window.settings.value("login_code", "")))
        self.code_input.returnPressed.connect(self.connect_and_login)

        panel_layout.addWidget(self.caption("Mã ID thí sinh"))
        panel_layout.addWidget(self.code_input)

        buttons = QHBoxLayout()
        buttons.setSpacing(12)
        login_btn = QPushButton("Vào sảnh thi")
        login_btn.setObjectName("primaryButton")
        login_btn.clicked.connect(self.connect_and_login)
        buttons.addWidget(login_btn)
        panel_layout.addLayout(buttons)

        copyright_label = QLabel(
            "© 2026 Bản quyền thuộc về KNTech - https://www.facebook.com/it.knz/"
        )
        copyright_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        copyright_label.setStyleSheet("color: #cbd5e1; font-size: 13px; font-weight: 600;")
        panel_layout.addWidget(copyright_label)

        center = QHBoxLayout()
        center.addStretch(1)
        center.addWidget(self.panel)
        center.addStretch(1)
        root.addLayout(center)
        root.addStretch(1)

    def caption(self, text: str) -> QLabel:
        label = QLabel(text)
        label.setObjectName("smallCaption")
        return label

    def connect_only(self) -> None:
        self.set_status("Đang kết nối backend...", error=False)
        self.window.pending_login_code = ""
        self.window.connect_room(self.server_input.text().strip(), "")

    def connect_and_login(self) -> None:
        code = self.code_input.text().strip()
        if not code:
            self.set_status("Vui lòng nhập mã ID thí sinh.", error=True)
            self.code_input.setFocus()
            return
        self.set_status("Đang kết nối và đăng nhập...", error=False)
        self.window.pending_login_code = code
        if self.window.realtime.connected_flag:
            self.window.login_candidate(code)
        else:
            self.window.connect_room(self.server_input.text().strip(), "")

    def on_connected(self) -> None:
        self.set_status("Đã kết nối backend. Đang tìm server theo mã ID...", error=False)
        if self.window.pending_login_code:
            self.window.realtime.login_candidate(self.window.pending_login_code)

    def populate_candidates(self, candidates: list[dict[str, Any]]) -> None:
        self._last_candidates = deepcopy(candidates)

    def fill_candidate_code(self) -> None:
        self.code_input.setFocus()

    def set_status(self, message: str, error: bool = False) -> None:
        self.status_label.setText(message)
        self.status_label.setProperty("foul", str(error).lower())
        self.status_label.style().unpolish(self.status_label)
        self.status_label.style().polish(self.status_label)

    def set_compact(self, compact: bool) -> None:
        self.compact = compact
        self.logo.setVisible(not compact)
        self.title.setVisible(not compact)
        self.panel.setMaximumWidth(520 if compact else 760)


class ClientPage(QWidget):
    def __init__(self, window: MainWindow) -> None:
        super().__init__()
        self.window = window
        self.compact = False

        self.timer_tick = QTimer(self)
        self.timer_tick.timeout.connect(self.render_timer_tick)
        self.timer_tick.start(50)

        root = QVBoxLayout(self)
        root.setContentsMargins(18, 14, 18, 12)
        root.setSpacing(12)

        top = QHBoxLayout()
        left = QVBoxLayout()
        self.round_badge = QPushButton("SẢNH CHỜ")
        self.round_badge.setObjectName("roundBadge")
        self.round_badge.setCursor(Qt.CursorShape.PointingHandCursor)
        self.round_badge.setToolTip("Đổi mã thí sinh")
        self.round_badge.clicked.connect(window.return_to_login)
        self.room_code = QLabel("")
        self.room_code.setObjectName("roomCode")
        left.addWidget(self.round_badge, alignment=Qt.AlignmentFlag.AlignLeft)
        left.addWidget(self.room_code)
        top.addLayout(left)
        top.addStretch(1)
        top.addWidget(WindowControls(window))
        root.addLayout(top)

        header = QHBoxLayout()
        header.setSpacing(14)
        self.profile_card = ProfileCard()
        header.addWidget(self.profile_card, 2)

        buzzer_frame = QFrame()
        buzzer_frame.setObjectName("glassPanel")
        buzzer_layout = QHBoxLayout(buzzer_frame)
        buzzer_layout.setContentsMargins(14, 12, 14, 12)
        self.buzzer_icon = BuzzerIndicator()
        self.buzzer_label = QLabel("ĐÃ KHÓA")
        self.buzzer_label.setStyleSheet("font-size: 22px; font-weight: 900;")
        self.buzzer_sub = QLabel("Chờ kỹ thuật mở quyền")
        self.buzzer_sub.setObjectName("smallCaption")
        buzzer_copy = QVBoxLayout()
        buzzer_copy.addWidget(self.buzzer_label)
        buzzer_copy.addWidget(self.buzzer_sub)
        buzzer_layout.addWidget(self.buzzer_icon)
        buzzer_layout.addLayout(buzzer_copy)
        header.addWidget(buzzer_frame, 2)
        root.addLayout(header)

        main = QHBoxLayout()
        main.setSpacing(14)
        self.round_visuals = RoundVisualPanel()
        self.round_visuals.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.question_box = QuestionBox()
        self.question_box.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        main.addWidget(self.round_visuals, 4)
        main.addWidget(self.question_box, 5)
        root.addLayout(main, 1)

        answer_row = QHBoxLayout()
        answer_row.setSpacing(10)
        self.answer_input = QLineEdit()
        self.answer_input.setPlaceholderText("NHẬP ĐÁP ÁN")
        self.answer_input.returnPressed.connect(self.handle_enter_from_input)
        self.submit_btn = QPushButton("Gửi đáp án")
        self.submit_btn.setObjectName("submitButton")
        self.submit_btn.clicked.connect(self.submit_answer)
        self.buzz_btn = QPushButton("Bấm chuông")
        self.buzz_btn.setObjectName("buzzButton")
        self.buzz_btn.clicked.connect(self.buzz)
        self.wall_btn = QPushButton("Gửi nhóm 4 ô")
        self.wall_btn.setObjectName("submitButton")
        self.wall_btn.clicked.connect(self.submit_wall)
        answer_row.addWidget(self.answer_input, 1)
        answer_row.addWidget(self.submit_btn)
        answer_row.addWidget(self.buzz_btn)
        answer_row.addWidget(self.wall_btn)
        root.addLayout(answer_row)

        bottom = QHBoxLayout()
        self.status_label = QLabel("Đã vào sảnh. Chờ kỹ thuật điều khiển.")
        self.status_label.setObjectName("statusText")
        self.copyright_label = QLabel(
            "© 2026 Bản quyền thuộc về KNTech - https://www.facebook.com/it.knz/"
        )
        self.copyright_label.setStyleSheet("color: #cbd5e1; font-size: 12px; font-weight: 600;")
        bottom.addWidget(self.status_label, 1)
        bottom.addWidget(self.copyright_label)
        root.addLayout(bottom)

    def render_timer_tick(self) -> None:
        if not self.window.state:
            return
        self.window.state["timer"] = {
            **(self.window.state.get("timer") or {}),
            "remaining": seconds_remaining(self.window.state.get("timer")),
            "remainingMs": remaining_milliseconds(self.window.state.get("timer")),
        }
        self.render(self.window.state, from_timer=True)

    def render(self, state: dict[str, Any], from_timer: bool = False) -> None:
        contestant = selected_candidate(state, self.window.contestant_id)
        if contestant:
            self.window.contestant = {**(self.window.contestant or {}), **contestant}

        self.round_badge.setText(round_label(state.get("round")))
        self.room_code.setText(f"Phòng: {self.window.realtime.room_code or 'chưa kết nối'}")
        self.profile_card.set_candidate(contestant or self.window.contestant)
        self.question_box.set_state(state)
        self.question_box.timer_bar.set_percent(timer_percent(state))
        self.round_visuals.set_state(state, speed_frame_index(state))
        if self.compact:
            self.round_visuals.setVisible(False)

        buzzer = buzzer_status(state, self.window.contestant_id)
        self.buzzer_icon.set_state(buzzer["iconState"])
        self.buzzer_label.setText(buzzer["label"])
        self.buzzer_sub.setText(buzzer["detail"])

        answer_open = can_answer(state, contestant or self.window.contestant, buzzer)
        buzz_open = can_buzz(state, contestant or self.window.contestant)
        self.answer_input.setEnabled(answer_open)
        self.submit_btn.setEnabled(answer_open)
        self.buzz_btn.setVisible(is_buzz_round(state))
        self.buzz_btn.setEnabled(buzz_open)
        self.buzz_btn.setText(self.buzz_label_for_round(state.get("round")))
        wall_open = (
            state.get("round") == "connecting_wall"
            and bool(deep_get(state, "timer.running"))
            and bool(self.window.contestant_id)
        )
        self.wall_btn.setVisible(state.get("round") == "connecting_wall")
        self.wall_btn.setEnabled(wall_open)

        status, is_error = self.status_for_state(state, contestant, buzzer, answer_open, buzz_open)
        self.set_status(status, is_error)
        if answer_open and not from_timer and self.window.stack.currentWidget() is self:
            self.answer_input.setFocus()

    def buzz_label_for_round(self, round_key: str | None) -> str:
        return {
            "warmup": "Bấm chuông Khởi động",
            "obstacle": "Trả lời chướng ngại vật",
            "finish": "Giành quyền cướp điểm",
            "tie_breaker": "Bấm chuông câu hỏi phụ",
            "jeopardy": "Bấm chuông MVT",
        }.get(str(round_key or ""), "Bấm chuông")

    def status_for_state(
        self,
        state: dict[str, Any],
        contestant: dict[str, Any] | None,
        buzzer: dict[str, Any],
        answer_open: bool,
        buzz_open: bool,
    ) -> tuple[str, bool]:
        if not contestant and not self.window.contestant:
            return "Chưa đăng nhập mã ID thí sinh.", True
        if buzzer.get("isFoul"):
            return "PHẠM QUY - mất quyền trả lời câu này.", True
        if answer_open:
            if state.get("round") == "finish" and int(deep_get(state, "finish.activeContestantId", 0) or 0) == self.window.contestant_id:
                return "Lượt thi chính: hệ thống ghi nhận đáp án cuối cùng.", False
            return "Đang mở quyền trả lời. Nhập đáp án rồi nhấn Enter.", False
        if buzz_open:
            return "Chuông đã sẵn sàng. Nhấn Enter để giành quyền.", False
        if buzzer.get("hasTriggered"):
            return "Đã giành quyền. Chờ admin mở thời gian trả lời.", False
        notice = str(state.get("notice") or "").strip()
        if notice:
            return notice, False
        return "Chờ kỹ thuật điều khiển.", False

    def set_status(self, message: str, error: bool = False) -> None:
        self.status_label.setText(message)
        self.status_label.setProperty("foul", str(error).lower())
        self.status_label.style().unpolish(self.status_label)
        self.status_label.style().polish(self.status_label)

    def handle_enter_from_input(self) -> None:
        state = self.window.state
        contestant = selected_candidate(state, self.window.contestant_id) or self.window.contestant
        if self.answer_input.text().strip():
            self.submit_answer()
            return
        if can_buzz(state, contestant):
            self.buzz()

    def submit_answer(self) -> None:
        contestant_id = self.window.contestant_id
        answer_text = self.answer_input.text().strip()
        if not contestant_id or not answer_text:
            return
        state = self.window.state
        contestant = selected_candidate(state, contestant_id) or self.window.contestant
        buzzer = buzzer_status(state, contestant_id)
        if not can_answer(state, contestant, buzzer):
            self.set_status("Admin chưa mở quyền trả lời cho thí sinh này.", error=True)
            return
        self.window.realtime.submit_answer(contestant_id, answer_text, deep_get(state, "question.key"))
        is_finish_main = (
            state.get("round") == "finish"
            and int(deep_get(state, "finish.activeContestantId", 0) or 0) == contestant_id
            and not deep_get(state, "finish.stealMode")
        )
        if not is_finish_main:
            self.answer_input.clear()

    def buzz(self) -> None:
        contestant_id = self.window.contestant_id
        if not contestant_id:
            self.set_status("Chưa đăng nhập mã ID thí sinh.", error=True)
            return
        contestant = selected_candidate(self.window.state, contestant_id) or self.window.contestant
        if not can_buzz(self.window.state, contestant):
            self.set_status("Chuông chưa được admin mở hoặc đã có người bấm trước.", error=True)
            return
        self.window.realtime.buzz(contestant_id)

    def submit_wall(self) -> None:
        contestant_id = self.window.contestant_id
        selected = list(self.round_visuals.wall.selected)
        if not contestant_id:
            self.set_status("Chưa đăng nhập mã ID thí sinh.", error=True)
            return
        if self.window.state.get("round") != "connecting_wall" or not deep_get(self.window.state, "timer.running"):
            self.set_status("Admin chưa mở quyền Tường liên kết.", error=True)
            return
        if len(selected) != 4:
            self.set_status("Cần chọn đúng 4 ô trước khi gửi nhóm.", error=True)
            return
        self.window.realtime.submit_wall(contestant_id, selected)
        self.round_visuals.wall.selected = []
        self.round_visuals.wall._render()

    def keyPressEvent(self, event: QKeyEvent) -> None:  # noqa: N802
        if event.key() == Qt.Key.Key_Return or event.key() == Qt.Key.Key_Enter:
            if self.answer_input.hasFocus() and self.answer_input.text().strip():
                super().keyPressEvent(event)
                return
            contestant = selected_candidate(self.window.state, self.window.contestant_id) or self.window.contestant
            if can_buzz(self.window.state, contestant):
                self.buzz()
                event.accept()
                return
        super().keyPressEvent(event)

    def set_compact(self, compact: bool) -> None:
        self.compact = compact
        self.round_visuals.setVisible(not compact)
        self.copyright_label.setVisible(not compact)
        self.question_box.question_text.setStyleSheet(
            "font-size: 22px; font-weight: 900; color: #ffffff;"
            if compact
            else "font-size: 30px; font-weight: 900; color: #ffffff;"
        )


def main() -> int:
    app = QApplication(sys.argv)
    app.setFont(QFont("Segoe UI", 10))
    window = MainWindow()
    window.show()
    return app.exec()
