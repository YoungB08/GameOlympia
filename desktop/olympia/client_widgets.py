from __future__ import annotations

import math
from typing import Any

from PySide6.QtCore import QPointF, QRectF, QTimer, Qt
from PySide6.QtGui import (
    QColor,
    QFont,
    QLinearGradient,
    QPainter,
    QPainterPath,
    QPen,
    QPixmap,
    QPolygonF,
    QRadialGradient,
)
from PySide6.QtWidgets import (
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from .resources import load_pixmap


GOLD = "#7dd3fc"
CYAN = "#38bdf8"
EMERALD = "#10b981"
CRIMSON = "#ef4444"
AMBER = "#f59e0b"

CLIENT_QSS = f"""
QWidget {{
    font-family: "Segoe UI", "Inter", "Roboto", sans-serif;
    color: #f8fafc;
}}
QFrame#glassPanel, QFrame#questionBox, QFrame#profileCard, QFrame#roundPanel {{
    background: rgba(15, 23, 42, 0.78);
    border: 2px solid {GOLD};
    border-radius: 14px;
}}
QLabel#smallCaption {{
    color: #cbd5e1;
    font-size: 13px;
    font-weight: 600;
}}
QLabel#roundBadge {{
    color: #0f172a;
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #fff7b0, stop:0.45 #f7c948, stop:1 #a16207);
    border: 1px solid #fde68a;
    border-radius: 10px;
    padding: 8px 14px;
    font-weight: 900;
    font-size: 18px;
}}
QLabel#roomCode, QLabel#statusText {{
    color: #cbd5e1;
    font-size: 15px;
    font-weight: 700;
}}
QLabel#statusText[foul="true"] {{
    color: {CRIMSON};
}}
QLineEdit, QComboBox {{
    background: rgba(2, 6, 23, 0.82);
    border: 1px solid rgba(247, 201, 72, 0.72);
    border-radius: 10px;
    padding: 11px 14px;
    color: #f8fafc;
    font-size: 17px;
    font-weight: 700;
    selection-background-color: {CYAN};
}}
QLineEdit:disabled {{
    color: #64748b;
    border-color: rgba(100, 116, 139, 0.65);
    background: rgba(15, 23, 42, 0.55);
}}
QPushButton {{
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 10px;
    padding: 10px 16px;
    color: white;
    font-size: 16px;
    font-weight: 800;
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #0ea5e9, stop:1 #0369a1);
}}
QPushButton:hover {{
    border-color: #bae6fd;
}}
QPushButton:disabled {{
    color: #94a3b8;
    background: rgba(51, 65, 85, 0.7);
    border-color: rgba(100,116,139,0.5);
}}
QPushButton#primaryButton {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 {CYAN}, stop:1 #2563eb);
}}
QPushButton#successButton {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 {EMERALD}, stop:1 #047857);
}}
QPushButton#dangerButton {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 {CRIMSON}, stop:1 #991b1b);
}}
QPushButton#ghostButton {{
    background: rgba(15, 23, 42, 0.55);
    border-color: rgba(247, 201, 72, 0.55);
}}
QPushButton#buzzButton {{
    min-height: 52px;
    font-size: 18px;
    background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 {EMERALD}, stop:1 #059669);
}}
QPushButton#submitButton {{
    min-height: 52px;
}}
QPushButton#wallCell {{
    min-height: 54px;
    background: rgba(15, 23, 42, 0.84);
    border-color: rgba(247, 201, 72, 0.72);
}}
QPushButton#wallCell[selected="true"] {{
    background: rgba(245, 158, 11, 0.85);
    color: #111827;
}}
QPushButton#wallCell[solved="true"] {{
    background: rgba(16, 185, 129, 0.82);
}}
"""


_PIXMAP_CACHE: dict[str, QPixmap] = {}


def cached_pixmap(path_or_url: str | None, fallback: str = "backgroundv4.jpg") -> QPixmap:
    key = path_or_url or f"fallback:{fallback}"
    if key not in _PIXMAP_CACHE:
        _PIXMAP_CACHE[key] = load_pixmap(path_or_url, fallback)
    return _PIXMAP_CACHE[key]


def set_label_text(label: QLabel, text: str) -> None:
    label.setText(text)
    label.setToolTip(text)


class StageBackground(QWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._phase = 0
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._advance)
        # Keep the contestant client visually stable during live contests.
        # The previous full-window repaint every 70ms made the UI feel jittery.

    def _advance(self) -> None:
        self._phase = (self._phase + 1) % 240
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        rect = self.rect()
        bg_pixmap = cached_pixmap(None, "backgroundv4.jpg")
        if not bg_pixmap.isNull():
            painter.drawPixmap(
                rect,
                bg_pixmap.scaled(
                    rect.size(),
                    Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                    Qt.TransformationMode.SmoothTransformation,
                ),
            )
        bg = QLinearGradient(rect.topLeft(), rect.bottomRight())
        bg.setColorAt(0, QColor(14, 165, 233, 40))
        bg.setColorAt(0.55, QColor(6, 17, 31, 70))
        bg.setColorAt(1, QColor(1, 4, 9, 110))
        painter.fillRect(rect, bg)

        sweep_x = (self._phase / 240) * (rect.width() + 320) - 160
        beam = QPainterPath()
        beam.moveTo(sweep_x, 0)
        beam.lineTo(sweep_x + 190, 0)
        beam.lineTo(sweep_x - 80, rect.height())
        beam.lineTo(sweep_x - 270, rect.height())
        beam.closeSubpath()
        painter.fillPath(beam, QColor(6, 182, 212, 25))

        for i in range(8):
            x = (i * 149 + self._phase * 2) % max(1, rect.width())
            y = 42 + (i * 73) % max(1, rect.height() - 84)
            glow = QRadialGradient(QPointF(x, y), 90)
            glow.setColorAt(0, QColor(6, 182, 212, 40))
            glow.setColorAt(1, QColor(6, 182, 212, 0))
            painter.fillRect(QRectF(x - 90, y - 90, 180, 180), glow)

        mountain = QPainterPath()
        h = rect.height()
        w = rect.width()
        mountain.moveTo(0, h)
        points = [
            (0.06, 0.72), (0.13, 0.48), (0.21, 0.76), (0.30, 0.42),
            (0.40, 0.72), (0.51, 0.44), (0.63, 0.75), (0.76, 0.50),
            (0.88, 0.70), (1.0, 0.46),
        ]
        for px, py in points:
            mountain.lineTo(w * px, h * py)
        mountain.lineTo(w, h)
        mountain.closeSubpath()
        painter.fillPath(mountain, QColor(15, 23, 42, 125))
        super().paintEvent(event)


class GoldTitle(QLabel):
    def __init__(self, text: str, size: int = 42, parent: QWidget | None = None) -> None:
        super().__init__(text, parent)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setMinimumHeight(size + 26)
        self.setFont(QFont("Segoe UI", size, QFont.Weight.Black))

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setFont(self.font())
        rect = self.rect()
        painter.setPen(QColor(40, 24, 2, 180))
        painter.drawText(rect.adjusted(3, 4, 3, 4), self.alignment(), self.text())
        painter.setPen(QColor("#fff7b0"))
        painter.drawText(rect.adjusted(-1, -1, -1, -1), self.alignment(), self.text())
        gradient = QLinearGradient(rect.topLeft(), rect.bottomLeft())
        gradient.setColorAt(0, QColor("#fff8c7"))
        gradient.setColorAt(0.35, QColor("#f7c948"))
        gradient.setColorAt(0.68, QColor("#b7791f"))
        gradient.setColorAt(1, QColor("#fff3a3"))
        painter.setPen(QPen(gradient, 1.2))
        painter.drawText(rect, self.alignment(), self.text())


class TimerBar(QWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.percent = 100.0
        self.setMinimumHeight(18)
        self.setMaximumHeight(22)

    def set_percent(self, percent: float) -> None:
        self.percent = max(0.0, min(100.0, float(percent)))
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        rect = QRectF(1, 1, self.width() - 2, self.height() - 2)
        painter.setPen(QPen(QColor(247, 201, 72, 180), 1.4))
        painter.setBrush(QColor(2, 6, 23, 180))
        painter.drawRoundedRect(rect, 7, 7)
        fill_width = rect.width() * self.percent / 100
        if fill_width <= 0:
            return
        fill = QRectF(rect.left(), rect.top(), fill_width, rect.height())
        gradient = QLinearGradient(fill.topLeft(), fill.topRight())
        gradient.setColorAt(0, QColor(EMERALD))
        gradient.setColorAt(0.56, QColor(AMBER))
        gradient.setColorAt(1, QColor(CRIMSON))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(gradient)
        painter.drawRoundedRect(fill, 7, 7)


class BuzzerIndicator(QWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.state = "locked"
        self._pulse = 0
        self.setFixedSize(86, 86)
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._animate)
        self._timer.start(60)

    def set_state(self, state: str) -> None:
        if state != self.state:
            self.state = state
            self._pulse = 0
            self.update()

    def _animate(self) -> None:
        if self.state in {"active", "triggered", "foul"}:
            self._pulse = (self._pulse + 1) % 40
            self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        center = QPointF(self.width() / 2, self.height() / 2)
        if self.state == "locked":
            main = QColor("#64748b")
            glow = QColor(100, 116, 139, 40)
        elif self.state == "active":
            main = QColor(CYAN)
            glow = QColor(6, 182, 212, 90)
        else:
            main = QColor(CRIMSON if self.state == "foul" else "#f97316")
            glow = QColor(239, 68, 68, 95)

        radius = 26 + (self._pulse % 18 if self.state in {"triggered", "foul"} else 0)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(glow)
        painter.drawEllipse(center, radius + 10, radius + 10)
        painter.setBrush(QColor(2, 6, 23, 220))
        painter.drawEllipse(center, 33, 33)
        painter.setBrush(main)
        painter.drawEllipse(center, 24, 24)
        painter.setPen(QPen(QColor("#f8fafc"), 4, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
        if self.state == "locked":
            painter.drawRoundedRect(QRectF(32, 39, 22, 18), 4, 4)
            painter.drawArc(QRectF(34, 24, 18, 24), 20 * 16, 140 * 16)
        else:
            painter.drawArc(QRectF(28, 24, 30, 30), 210 * 16, 120 * 16)
            painter.drawLine(QPointF(43, 54), QPointF(43, 61))
            painter.drawLine(QPointF(34, 62), QPointF(52, 62))


class AvatarWidget(QWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.pixmap = QPixmap()
        self.setFixedSize(74, 74)

    def set_avatar(self, path_or_url: str | None) -> None:
        self.pixmap = cached_pixmap(path_or_url, "backgroundv4.jpg") if path_or_url else QPixmap()
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        rect = QRectF(4, 4, self.width() - 8, self.height() - 8)
        painter.setPen(QPen(QColor(GOLD), 2))
        painter.setBrush(QColor(15, 23, 42, 230))
        painter.drawEllipse(rect)
        if not self.pixmap.isNull():
            path = QPainterPath()
            path.addEllipse(rect.adjusted(4, 4, -4, -4))
            painter.setClipPath(path)
            painter.drawPixmap(rect.toRect(), self.pixmap)
            painter.setClipping(False)
        else:
            painter.setPen(QColor("#cbd5e1"))
            painter.setFont(QFont("Segoe UI", 28, QFont.Weight.Bold))
            painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, "TS")


class HopeStar(QWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._angle = 0
        self.setFixedSize(70, 70)
        self.hide()
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)
        self._timer.start(70)

    def _tick(self) -> None:
        if self.isVisible():
            self._angle = (self._angle + 8) % 360
            self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.translate(self.width() / 2, self.height() / 2)
        painter.rotate(self._angle)
        points = []
        for i in range(10):
            radius = 30 if i % 2 == 0 else 13
            angle = math.radians(-90 + i * 36)
            points.append(QPointF(math.cos(angle) * radius, math.sin(angle) * radius))
        polygon = QPolygonF(points)
        gradient = QRadialGradient(QPointF(0, 0), 34)
        gradient.setColorAt(0, QColor("#fff7b0"))
        gradient.setColorAt(0.55, QColor(GOLD))
        gradient.setColorAt(1, QColor("#b45309"))
        painter.setBrush(gradient)
        painter.setPen(QPen(QColor("#fff3a3"), 2))
        painter.drawPolygon(polygon)


class ProfileCard(QFrame):
    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("profileCard")
        self.setMinimumSize(270, 130)
        self.avatar = AvatarWidget()
        self.name_label = QLabel("VIỆT THÁI")
        self.name_label.setStyleSheet("font-size: 22px; font-weight: 900; color: #f8fafc;")
        self.school_label = QLabel("Sảnh chờ")
        self.school_label.setObjectName("smallCaption")
        self.score_label = QLabel("0")
        self.score_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.score_label.setStyleSheet(
            f"background: rgba(247,201,72,0.16); border: 1px solid {GOLD}; border-radius: 8px; "
            "font-size: 28px; font-weight: 900; color: #fef3c7; padding: 4px 12px;"
        )
        layout = QHBoxLayout(self)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(12)
        layout.addWidget(self.avatar)
        copy = QVBoxLayout()
        copy.addWidget(self.name_label)
        copy.addWidget(self.school_label)
        copy.addWidget(self.score_label)
        layout.addLayout(copy)

    def set_candidate(self, candidate: dict[str, Any] | None) -> None:
        if candidate:
            set_label_text(self.name_label, str(candidate.get("display_name") or "Thí sinh"))
            set_label_text(self.school_label, str(candidate.get("school") or "Thí sinh"))
            self.score_label.setText(str(candidate.get("score") or 0))
            self.avatar.set_avatar(candidate.get("avatar_url"))
        else:
            self.name_label.setText("VIỆT THÁI")
            self.school_label.setText("Sảnh chờ")
            self.score_label.setText("0")
            self.avatar.set_avatar(None)


class QuestionBox(QFrame):
    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("questionBox")
        self.setMinimumHeight(300)
        self.hope_star = HopeStar(self)
        self.question_text = QLabel("Đang chờ kỹ thuật...")
        self.question_text.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.question_text.setWordWrap(True)
        self.question_text.setStyleSheet("font-size: 30px; font-weight: 900; color: #ffffff;")
        self.answer_text = QLabel("")
        self.answer_text.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.answer_text.setWordWrap(True)
        self.answer_text.setStyleSheet(f"font-size: 22px; font-weight: 800; color: {EMERALD};")
        self.timer_bar = TimerBar()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 22, 24, 20)
        layout.setSpacing(14)
        layout.addStretch(1)
        layout.addWidget(self.question_text)
        layout.addWidget(self.answer_text)
        layout.addStretch(1)
        layout.addWidget(self.timer_bar)

    def resizeEvent(self, event) -> None:  # noqa: N802
        self.hope_star.move(self.width() - 78, 10)
        super().resizeEvent(event)

    def set_state(self, state: dict[str, Any]) -> None:
        question = state.get("question") or {}
        visible = bool(question.get("visible"))
        timer = state.get("timer") or {}
        is_waiting = not visible or state.get("round") == "setup"
        question_text = str(question.get("text") or "Chờ kỹ thuật điều khiển phần thi") if visible else "Chờ kỹ thuật điều khiển phần thi"
        set_label_text(self.question_text, question_text)
        answer_visible = bool(question.get("answerVisible"))
        answer = str(question.get("answer") or "")
        self.answer_text.setVisible(answer_visible and bool(answer))
        self.answer_text.setText(f"Đáp án: {answer}" if answer_visible and answer else "")
        self.timer_bar.setVisible(not is_waiting and int(float(timer.get("seconds") or 0)) > 0)
        self.hope_star.setVisible(state.get("round") == "finish" and bool(question.get("starEnabled")))


class ObstacleVisual(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.revealed = [False, False, False, False]
        self.image_url = ""
        self.answer = ""
        self.answer_visible = False
        self.pixmap = QPixmap()
        self.setMinimumHeight(260)

    def set_state(self, revealed: list[Any], image_url: str | None, answer: str = "", answer_visible: bool = False) -> None:
        next_revealed = [bool(item) for item in (revealed or [])[:4]]
        while len(next_revealed) < 4:
            next_revealed.append(False)
        next_answer = str(answer or "")
        next_answer_visible = bool(answer_visible)
        changed = (
            next_revealed != self.revealed
            or str(image_url or "") != self.image_url
            or next_answer != self.answer
            or next_answer_visible != self.answer_visible
        )
        self.revealed = next_revealed
        self.answer = next_answer
        self.answer_visible = next_answer_visible
        if str(image_url or "") != self.image_url:
            self.image_url = str(image_url or "")
            self.pixmap = cached_pixmap(self.image_url, "backgroundv4.jpg") if self.image_url else QPixmap()
        if changed:
            self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        rect = QRectF(8, 8, self.width() - 16, self.height() - 16)
        painter.setPen(QPen(QColor("#bae6fd"), 2))
        painter.setBrush(QColor(8, 47, 105, 188))
        painter.drawRoundedRect(rect, 12, 12)

        left = QRectF(rect.left() + 12, rect.top() + 12, rect.width() * 0.43, rect.height() - 24)
        right = QRectF(left.right() + 12, rect.top() + 12, rect.right() - left.right() - 24, rect.height() - 24)

        if not self.pixmap.isNull():
            painter.save()
            path = QPainterPath()
            path.addRoundedRect(left, 8, 8)
            painter.setClipPath(path)
            scaled = self.pixmap.scaled(
                int(left.width()),
                int(left.height()),
                Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                Qt.TransformationMode.SmoothTransformation,
            )
            painter.drawPixmap(left.toRect(), scaled)
            painter.fillRect(left, QColor(2, 6, 23, 96))
            painter.restore()

        tile_w = left.width() / 2
        tile_h = left.height() / 2
        for index in range(4):
            col = index % 2
            row = index // 2
            tile = QRectF(left.left() + col * tile_w, left.top() + row * tile_h, tile_w, tile_h)
            grad = QLinearGradient(tile.topLeft(), tile.bottomRight())
            grad.setColorAt(0, QColor("#38bdf8"))
            grad.setColorAt(1, QColor("#1d4ed8"))
            painter.setPen(QPen(QColor("#0f2d64"), 1.4))
            painter.setBrush(grad if not self.revealed[index] else QColor(34, 211, 238, 48))
            painter.drawRect(tile)
            painter.setPen(QColor("#f8fafc"))
            painter.setFont(QFont("Segoe UI", 42, QFont.Weight.Light))
            painter.drawText(tile, Qt.AlignmentFlag.AlignCenter, str(index + 1))

        painter.setPen(QPen(QColor("#bae6fd"), 2))
        painter.setBrush(QColor(21, 84, 171, 156))
        painter.drawRoundedRect(right, 10, 10)
        letters = [ch for ch in self.answer.replace(" ", "")] or [""] * 7
        title = f"CHƯỚNG NGẠI VẬT CÓ {len(letters)} CHỮ CÁI"
        title_rect = QRectF(right.left() + 14, right.top() + 14, right.width() - 28, 42)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor("#38bdf8"))
        painter.drawRoundedRect(title_rect, 6, 6)
        painter.setPen(QColor("#e0f2fe"))
        painter.setFont(QFont("Segoe UI", 16, QFont.Weight.Black))
        painter.drawText(title_rect, Qt.AlignmentFlag.AlignCenter, title)

        cell = min(42.0, max(28.0, (right.width() - 54) / 8))
        gap = 8.0
        start_x = right.left() + 18
        start_y = title_rect.bottom() + 22
        for index, letter in enumerate(letters[:28]):
            row = index // 8
            col = index % 8
            x = start_x + col * (cell + gap)
            y = start_y + row * (cell + gap)
            circle = QRectF(x, y, cell, cell)
            fill = QLinearGradient(circle.topLeft(), circle.bottomRight())
            fill.setColorAt(0, QColor("#67e8f9"))
            fill.setColorAt(1, QColor("#2563eb"))
            painter.setPen(QPen(QColor("#bae6fd"), 1.4))
            painter.setBrush(fill)
            painter.drawEllipse(circle)
            if self.answer_visible and letter:
                painter.setPen(QColor("#06172f"))
                painter.setFont(QFont("Segoe UI", int(cell * 0.52), QFont.Weight.Black))
                painter.drawText(circle, Qt.AlignmentFlag.AlignCenter, letter.upper())

        for index in range(4):
            marker = QRectF(right.right() - 42, right.top() + 70 + index * 34, 28, 28)
            if self.revealed[index]:
                painter.setBrush(QColor(16, 185, 129, 180))
            else:
                painter.setBrush(QColor("#2563eb"))
            painter.setPen(QPen(QColor("#bfdbfe"), 1))
            painter.drawRoundedRect(marker, 5, 5)
            painter.setPen(QColor("#f8fafc"))
            painter.setFont(QFont("Segoe UI", 14, QFont.Weight.Black))
            painter.drawText(marker, Qt.AlignmentFlag.AlignCenter, str(index + 1))


class SpeedCard(QFrame):
    def __init__(self, index: int, title: str, caption: str) -> None:
        super().__init__()
        self.index = index
        self.active = False
        self.media_url = ""
        self.pixmap = QPixmap()
        self.title = title
        self.caption = caption
        self.setMinimumSize(150, 170)

    def set_active(self, active: bool) -> None:
        if self.active != active:
            self.active = active
            self.update()

    def set_media(self, url: str | None) -> None:
        url = str(url or "")
        if url == self.media_url:
            return
        self.media_url = url
        self.pixmap = cached_pixmap(url, "backgroundv4.jpg") if url else QPixmap()
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        rect = QRectF(4, 4, self.width() - 8, self.height() - 8)
        border = QColor(CYAN if self.active else GOLD)
        painter.setPen(QPen(border, 2.2 if self.active else 1.4))
        painter.setBrush(QColor(15, 23, 42, 220))
        painter.drawRoundedRect(rect, 12, 12)
        inner = rect.adjusted(10, 10, -10, -58)
        if not self.pixmap.isNull():
            painter.drawPixmap(inner.toRect(), self.pixmap.scaled(inner.size().toSize(), Qt.AspectRatioMode.KeepAspectRatioByExpanding, Qt.TransformationMode.SmoothTransformation))
            painter.fillRect(inner, QColor(2, 6, 23, 80))
        else:
            self._draw_placeholder(painter, inner)
        painter.setPen(QColor("#fef3c7"))
        painter.setFont(QFont("Segoe UI", 22, QFont.Weight.Black))
        painter.drawText(QRectF(rect.left(), rect.bottom() - 55, rect.width(), 24), Qt.AlignmentFlag.AlignCenter, self.title)
        painter.setPen(QColor("#cbd5e1"))
        painter.setFont(QFont("Segoe UI", 13, QFont.Weight.Bold))
        painter.drawText(QRectF(rect.left(), rect.bottom() - 29, rect.width(), 20), Qt.AlignmentFlag.AlignCenter, self.caption)

    def _draw_placeholder(self, painter: QPainter, rect: QRectF) -> None:
        painter.setPen(QPen(QColor(CYAN), 2))
        painter.setBrush(QColor(6, 182, 212, 24))
        if self.index == 0:
            for i in range(4):
                painter.drawLine(QPointF(rect.left() + 16, rect.top() + 20 + i * 18), QPointF(rect.right() - 16, rect.top() + 8 + i * 22))
            painter.drawEllipse(rect.center(), 8, 8)
        elif self.index == 1:
            painter.drawEllipse(QRectF(rect.center().x() - 24, rect.top() + 18, 48, 48))
            painter.drawRoundedRect(QRectF(rect.left() + 26, rect.bottom() - 38, rect.width() - 52, 30), 15, 15)
        elif self.index == 2:
            painter.setFont(QFont("Segoe UI", 23, QFont.Weight.Black))
            painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, "f(x)")
        else:
            path = QPainterPath()
            path.moveTo(rect.left() + 34, rect.top() + 18)
            path.lineTo(rect.right() - 34, rect.top() + 18)
            path.lineTo(rect.center().x(), rect.center().y())
            path.lineTo(rect.right() - 34, rect.bottom() - 18)
            path.lineTo(rect.left() + 34, rect.bottom() - 18)
            path.lineTo(rect.center().x(), rect.center().y())
            painter.drawPath(path)


class ResponseTimeline(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.answers: list[dict[str, Any]] = []
        self.candidates: list[dict[str, Any]] = []
        self.question_key = ""
        self.setMinimumHeight(260)

    def set_state(self, state: dict[str, Any]) -> None:
        question = state.get("question") or {}
        self.question_key = str(question.get("key") or "")
        answers = [
            answer for answer in (state.get("answers") or [])
            if not self.question_key or not answer.get("question_key") or str(answer.get("question_key")) == self.question_key
        ]
        self.answers = sorted(answers, key=lambda item: int(item.get("elapsed_ms") or 999999999))[:4]
        self.candidates = state.get("candidates") or []
        self.update()

    def _candidate_name(self, contestant_id: Any) -> str:
        for candidate in self.candidates:
            if int(candidate.get("id") or 0) == int(contestant_id or 0):
                return str(candidate.get("display_name") or "Empty")
        return "Empty"

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        rect = QRectF(8, 8, self.width() - 16, self.height() - 16)
        painter.setPen(QPen(QColor("#bae6fd"), 2))
        painter.setBrush(QColor(7, 47, 112, 190))
        painter.drawRoundedRect(rect, 12, 12)
        if not self.answers:
            painter.setPen(QColor("#bae6fd"))
            painter.setFont(QFont("Segoe UI", 22, QFont.Weight.Bold))
            painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, "Chưa có câu trả lời")
            return

        lane_h = min(64.0, (rect.height() - 42) / max(1, len(self.answers)))
        top = rect.top() + 20
        for index, answer in enumerate(self.answers):
            lane = QRectF(rect.left() + 34, top + index * (lane_h + 8), rect.width() - 68, lane_h)
            path = QPainterPath()
            path.moveTo(lane.left() + 18, lane.top())
            path.lineTo(lane.right() - 24, lane.top())
            path.lineTo(lane.right(), lane.center().y())
            path.lineTo(lane.right() - 24, lane.bottom())
            path.lineTo(lane.left() + 18, lane.bottom())
            path.lineTo(lane.left(), lane.center().y())
            path.closeSubpath()
            fill = QLinearGradient(lane.topLeft(), lane.topRight())
            fill.setColorAt(0, QColor("#08317a"))
            fill.setColorAt(1, QColor("#0b4fba"))
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(fill)
            painter.drawPath(path)

            dot = QRectF(lane.left() - 16, lane.center().y() - 16, 32, 32)
            painter.setBrush(QColor("#7dd3fc"))
            painter.drawEllipse(dot)
            painter.setPen(QColor("#082f49"))
            painter.setFont(QFont("Segoe UI", 14, QFont.Weight.Black))
            painter.drawText(dot, Qt.AlignmentFlag.AlignCenter, str(index + 1))

            name_rect = QRectF(lane.left() + 54, lane.top() + 8, 138, 24)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor("#0ea5e9"))
            painter.drawRect(name_rect)
            painter.setPen(QColor("#f8fafc"))
            painter.setFont(QFont("Segoe UI", 11, QFont.Weight.Black))
            painter.drawText(name_rect.adjusted(8, 0, -8, 0), Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft, self._candidate_name(answer.get("contestant_id")))

            painter.setFont(QFont("Segoe UI", 24, QFont.Weight.Black))
            painter.drawText(QRectF(lane.left() + 210, lane.top(), lane.width() - 300, lane.height()), Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft, str(answer.get("answer_text") or ""))
            seconds = "" if answer.get("elapsed_ms") is None else f"{float(answer.get('elapsed_ms') or 0) / 1000:.2f}"
            painter.drawText(QRectF(lane.right() - 112, lane.top(), 86, lane.height()), Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight, seconds)


class SpeedVisual(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.stack = QStackedWidget()
        cards_page = QWidget()
        layout = QGridLayout(cards_page)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setHorizontalSpacing(12)
        layout.setVerticalSpacing(12)
        labels = [
            ("10 giây", "Bản đồ"),
            ("20 giây", "Chân dung"),
            ("30 giây", "Công thức"),
            ("40 giây", "Đồng hồ cát"),
        ]
        self.cards = []
        for index, (title, caption) in enumerate(labels):
            card = SpeedCard(index, title, caption)
            self.cards.append(card)
            layout.addWidget(card, index // 2, index % 2)
        self.timeline = ResponseTimeline()
        self.stack.addWidget(cards_page)
        self.stack.addWidget(self.timeline)
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.addWidget(self.stack)

    def set_state(self, state: dict[str, Any], frame_index: int) -> None:
        if bool((state.get("ui") or {}).get("showCandidateAnswers")) and (state.get("answers") or []):
            self.timeline.set_state(state)
            self.stack.setCurrentWidget(self.timeline)
            return
        self.stack.setCurrentIndex(0)
        sequence = (state.get("speed") or {}).get("imageSequence") or []
        for index, card in enumerate(self.cards):
            card.set_active(index == frame_index)
            card.set_media(sequence[index] if index < len(sequence) else "")


class FinishPackageCard(QWidget):
    def __init__(self, point: int) -> None:
        super().__init__()
        self.point = point
        self.active = False
        self.enabled_card = True
        self.setMinimumSize(132, 176)

    def set_state(self, active: bool, enabled_card: bool) -> None:
        self.active = active
        self.enabled_card = enabled_card
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        rect = QRectF(8, 8, self.width() - 16, self.height() - 16)
        opacity = 1.0 if self.enabled_card else 0.35
        grad = QLinearGradient(rect.topLeft(), rect.bottomRight())
        grad.setColorAt(0, QColor(255, 248, 199, int(255 * opacity)))
        grad.setColorAt(0.45, QColor(247, 201, 72, int(255 * opacity)))
        grad.setColorAt(1, QColor(120, 53, 15, int(255 * opacity)))
        painter.setBrush(grad)
        painter.setPen(QPen(QColor(CYAN if self.active else GOLD), 3 if self.active else 1.6))
        painter.drawRoundedRect(rect, 12, 12)
        painter.setPen(QColor("#111827"))
        painter.setFont(QFont("Segoe UI", 42, QFont.Weight.Black))
        painter.drawText(rect.adjusted(0, 18, 0, -32), Qt.AlignmentFlag.AlignCenter, str(self.point))
        painter.setFont(QFont("Segoe UI", 13, QFont.Weight.Black))
        painter.drawText(rect.adjusted(0, rect.height() - 34, 0, 0), Qt.AlignmentFlag.AlignCenter, "ĐIỂM")


class FinishVisual(QWidget):
    def __init__(self) -> None:
        super().__init__()
        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 16, 8, 16)
        layout.setSpacing(18)
        self.cards: dict[int, FinishPackageCard] = {}
        for point in [20, 30, 40]:
            card = FinishPackageCard(point)
            self.cards[point] = card
            layout.addWidget(card)

    def set_state(self, state: dict[str, Any]) -> None:
        finish = state.get("finish") or {}
        question = state.get("question") or {}
        active = int(finish.get("activePackagePoints") or question.get("point") or 0)
        available = {int(point) for point in (finish.get("packagePoints") or [20, 40])}
        for point, card in self.cards.items():
            card.set_state(point == active, point in available or not available)


class WallVisual(QWidget):
    selection_changed: Any

    def __init__(self) -> None:
        super().__init__()
        self.selected: list[int] = []
        self.cells: list[dict[str, Any]] = []
        self.solved: set[int] = set()
        self.grid = QGridLayout(self)
        self.grid.setContentsMargins(4, 4, 4, 4)
        self.grid.setHorizontalSpacing(8)
        self.grid.setVerticalSpacing(8)

    def set_state(self, cells: list[dict[str, Any]], solved_groups: list[dict[str, Any]]) -> None:
        self.cells = cells or []
        self.solved = {
            int(cell_id)
            for group in (solved_groups or [])
            for cell_id in (group.get("cellIds") or [])
        }
        self._render()

    def _render(self) -> None:
        while self.grid.count():
            item = self.grid.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
        for index, cell in enumerate(self.cells[:16]):
            cell_id = int(cell.get("id") or index)
            button = QPushButton(str(cell.get("word_text") or cell.get("text") or ""))
            button.setObjectName("wallCell")
            button.setProperty("selected", str(cell_id in self.selected).lower())
            button.setProperty("solved", str(cell_id in self.solved).lower())
            button.setEnabled(cell_id not in self.solved)
            button.clicked.connect(lambda checked=False, cid=cell_id: self.toggle_cell(cid))
            button.style().unpolish(button)
            button.style().polish(button)
            self.grid.addWidget(button, index // 4, index % 4)

    def toggle_cell(self, cell_id: int) -> None:
        if cell_id in self.solved:
            return
        if cell_id in self.selected:
            self.selected = [item for item in self.selected if item != cell_id]
        else:
            self.selected = (self.selected + [cell_id])[-4:]
        self._render()


class RoundVisualPanel(QFrame):
    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("roundPanel")
        self.stack = QStackedWidget()
        self.obstacle = ObstacleVisual()
        self.speed = SpeedVisual()
        self.finish = FinishVisual()
        self.wall = WallVisual()
        self.stack.addWidget(self.obstacle)
        self.stack.addWidget(self.speed)
        self.stack.addWidget(self.finish)
        self.stack.addWidget(self.wall)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.addWidget(self.stack)

    def set_state(self, state: dict[str, Any], speed_frame: int) -> None:
        round_key = state.get("round") or "setup"
        if round_key == "obstacle":
            self.setVisible(True)
            puzzle = state.get("puzzle") or {}
            question = state.get("question") or {}
            self.obstacle.set_state(
                puzzle.get("revealed") or [],
                puzzle.get("imageUrl") or question.get("mediaUrl") or "",
                str(question.get("answer") or ""),
                bool(question.get("answerVisible")),
            )
            self.stack.setCurrentWidget(self.obstacle)
        elif round_key == "speed":
            self.setVisible(True)
            self.speed.set_state(state, speed_frame)
            self.stack.setCurrentWidget(self.speed)
        elif round_key == "finish":
            self.setVisible(True)
            self.finish.set_state(state)
            self.stack.setCurrentWidget(self.finish)
        elif round_key == "connecting_wall":
            self.setVisible(True)
            wall = state.get("connectingWall") or {}
            self.wall.set_state(wall.get("cells") or [], wall.get("solvedGroups") or [])
            self.stack.setCurrentWidget(self.wall)
        else:
            self.setVisible(False)
