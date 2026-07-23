from __future__ import annotations

from pathlib import Path

import requests
from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap

from .config import PICTURE_DIR


def picture(name: str) -> Path:
    return PICTURE_DIR / name


def load_pixmap(path_or_url: str | None, fallback: str = "backgroundv4.jpg") -> QPixmap:
    if path_or_url:
        if path_or_url.startswith(("http://", "https://")):
            try:
                response = requests.get(path_or_url, timeout=8)
                response.raise_for_status()
                pixmap = QPixmap()
                if pixmap.loadFromData(response.content):
                    return pixmap
            except Exception:
                pass
        else:
            pixmap = QPixmap(path_or_url)
            if not pixmap.isNull():
                return pixmap
    return QPixmap(str(picture(fallback)))


def scaled_pixmap(path_or_url: str | None, width: int, height: int, fallback: str = "backgroundv4.jpg") -> QPixmap:
    return load_pixmap(path_or_url, fallback).scaled(
        width,
        height,
        Qt.AspectRatioMode.KeepAspectRatioByExpanding,
        Qt.TransformationMode.SmoothTransformation,
    )
