from __future__ import annotations

from collections.abc import Callable

from PySide6.QtCore import QEasingCurve, Property, QPoint, QPropertyAnimation, QTimer, Qt, Signal
from PySide6.QtGui import QColor, QFont, QLinearGradient, QPainter, QPen
from PySide6.QtWidgets import (
    QFrame,
    QGraphicsOpacityEffect,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QProgressBar,
    QVBoxLayout,
    QWidget,
)


MAIN_BG = """
QWidget#gradientPage {
    background: qlineargradient(x1:1, y1:1, x2:0, y2:0, stop:0 #4F00BC, stop:1 #29ABE2);
}
"""

BUTTON_CSS = """
QPushButton#startButton {
    padding: 8px 15px 15px 15px;
    border-radius: 8px;
    color: white;
    font-size: 34px;
    font-weight: 700;
    background: qradialgradient(cx:0.5, cy:0.5, radius:0.8, fx:0.5, fy:0.5, stop:0 #d96e3a, stop:1 #c54e2c);
}
QPushButton#startButton:hover {
    background: qradialgradient(cx:0.5, cy:0.5, radius:0.8, fx:0.5, fy:0.5, stop:0 #ea7f4b, stop:1 #c54e2c);
}
QPushButton#lightButton {
    padding: 12px 18px;
    border-radius: 24px;
    color: #111;
    font-size: 26px;
    background: qradialgradient(cx:0.5, cy:-0.4, radius:1.4, stop:0 #ffffff, stop:0.7 #d6d6d6, stop:1 #c3c4c4);
}
QPushButton#answerButton {
    min-height: 72px;
    border-radius: 30px;
    color: #654b00;
    font-size: 22px;
    font-weight: 700;
    padding: 12px 18px;
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #ffe657, stop:0.5 #f8c202, stop:1 #eea10b);
}
QPushButton#greenButton {
    border-radius: 5px;
    color: white;
    font-size: 23px;
    font-weight: 700;
    padding: 14px;
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #41c487, stop:1 #2b8258);
}
QPushButton#blueButton {
    border-radius: 5px;
    color: white;
    font-size: 23px;
    font-weight: 700;
    padding: 14px;
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #49a0de, stop:1 #33709c);
}
QPushButton#redButton {
    border-radius: 5px;
    color: white;
    font-size: 20px;
    font-weight: 700;
    padding: 11px 16px;
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #de4976, stop:1 #9c3353);
}
QPushButton#rowButton {
    border-radius: 5px;
    color: #242d35;
    font-size: 23px;
    padding: 10px 30px;
    background: qlineargradient(x1:0, y1:0, x2:0, y2:1, stop:0 #e4fbff, stop:0.5 #a5d3fb, stop:1 #d5faff);
}
QProgressBar {
    border: 1px solid rgba(255,255,255,0.65);
    border-radius: 6px;
    height: 28px;
    background: rgba(255,255,255,0.2);
}
QProgressBar::chunk {
    border-radius: 6px;
    background: #f8c202;
}
"""


def styled_button(text: str, object_name: str, width: int | None = None) -> QPushButton:
    button = QPushButton(text)
    button.setObjectName(object_name)
    button.setCursor(Qt.CursorShape.PointingHandCursor)
    if width:
        button.setFixedWidth(width)
    return button


def title_label(text: str, size: int = 40) -> QLabel:
    label = QLabel(text)
    label.setAlignment(Qt.AlignmentFlag.AlignCenter)
    label.setStyleSheet("color: white;")
    label.setFont(QFont("Segoe UI", size))
    return label


def white_label(text: str = "", size: int = 24, align: Qt.AlignmentFlag = Qt.AlignmentFlag.AlignCenter) -> QLabel:
    label = QLabel(text)
    label.setWordWrap(True)
    label.setAlignment(align)
    label.setStyleSheet("color: white;")
    label.setFont(QFont("Segoe UI", size))
    return label


def fade_in(widget: QWidget, duration_ms: int = 500) -> None:
    effect = QGraphicsOpacityEffect(widget)
    widget.setGraphicsEffect(effect)
    animation = QPropertyAnimation(effect, b"opacity", widget)
    animation.setDuration(duration_ms)
    animation.setStartValue(0.0)
    animation.setEndValue(1.0)
    animation.setEasingCurve(QEasingCurve.Type.InOutQuad)
    animation.finished.connect(lambda: widget.setGraphicsEffect(None))
    widget._fade_animation = animation  # type: ignore[attr-defined]
    animation.start()


def fade_then(widget: QWidget, callback: Callable[[], None], duration_ms: int = 500) -> None:
    effect = QGraphicsOpacityEffect(widget)
    widget.setGraphicsEffect(effect)
    animation = QPropertyAnimation(effect, b"opacity", widget)
    animation.setDuration(duration_ms)
    animation.setStartValue(1.0)
    animation.setEndValue(0.0)
    animation.finished.connect(callback)
    widget._fade_animation = animation  # type: ignore[attr-defined]
    animation.start()


class Toast(QFrame):
    def __init__(self, parent: QWidget, message: str) -> None:
        super().__init__(parent)
        self.setObjectName("toast")
        self.setStyleSheet(
            "QFrame#toast { background: rgba(0,0,0,0.24); border-radius: 20px; padding: 18px; }"
            "QLabel { color: #ff2f51; font: 30px 'Verdana'; }"
        )
        layout = QHBoxLayout(self)
        layout.setContentsMargins(20, 14, 20, 14)
        layout.addWidget(QLabel(message))
        self.adjustSize()
        self.move(670, 600)
        self.show()
        fade_in(self, 250)
        QTimer.singleShot(1250, self.close)


class CountdownBar(QWidget):
    finished = Signal()
    ticked = Signal(int)

    def __init__(self, seconds: int, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.seconds = seconds
        self.remaining = seconds
        self.elapsed = 0
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._tick)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self.progress = QProgressBar()
        self.progress.setRange(0, seconds)
        self.progress.setValue(0)
        layout.addWidget(self.progress)

    def start(self) -> None:
        self.stop()
        self.remaining = self.seconds
        self.elapsed = 0
        self.progress.setValue(0)
        self.timer.start(1000)

    def stop(self) -> None:
        if self.timer.isActive():
            self.timer.stop()

    def pause(self) -> None:
        self.stop()

    def _tick(self) -> None:
        self.elapsed += 1
        self.remaining = max(0, self.seconds - self.elapsed)
        self.progress.setValue(self.elapsed)
        self.ticked.emit(self.remaining)
        if self.elapsed >= self.seconds:
            self.stop()
            self.finished.emit()


class PackageCircle(QWidget):
    clicked = Signal(int)

    def __init__(self, point: int, start: QColor, end: QColor) -> None:
        super().__init__()
        self.point = point
        self.start = start
        self.end = end
        self._angle = 0.0
        self.setFixedSize(150, 150)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.animation = QPropertyAnimation(self, b"angle", self)
        self.animation.setDuration(3000)
        self.animation.setStartValue(0.0)
        self.animation.setEndValue(360.0)
        self.animation.setLoopCount(-1)

    def get_angle(self) -> float:
        return self._angle

    def set_angle(self, angle: float) -> None:
        self._angle = angle
        self.update()

    angle = Property(float, get_angle, set_angle)

    def enterEvent(self, event) -> None:  # noqa: N802
        self.animation.start()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:  # noqa: N802
        self.animation.stop()
        self.set_angle(0.0)
        super().leaveEvent(event)

    def mousePressEvent(self, event) -> None:  # noqa: N802
        self.clicked.emit(self.point)
        super().mousePressEvent(event)

    def paintEvent(self, event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.translate(self.width() / 2, self.height() / 2)
        painter.rotate(self._angle)
        painter.translate(-self.width() / 2, -self.height() / 2)
        gradient = QLinearGradient(0, 0, self.width(), self.height())
        gradient.setColorAt(0, self.start)
        gradient.setColorAt(1, self.end)
        painter.setBrush(gradient)
        painter.setPen(QPen(QColor("#111"), 1))
        painter.drawEllipse(0, 0, 149, 149)
        painter.resetTransform()
        painter.setPen(QColor("white"))
        painter.setFont(QFont("Segoe UI", 48))
        painter.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, str(self.point))
