from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - dependency is declared in requirements.txt
    load_dotenv = None


ROOT_DIR = Path(__file__).resolve().parents[2]
ASSET_DIR = Path(__file__).resolve().parent / "assets"
PICTURE_DIR = ROOT_DIR / "Resources"
SOUND_DIR = ROOT_DIR / "Sounds"
BRAND_ASSET_DIR = ROOT_DIR / "assets"
BRAND_LOGO_PATH = BRAND_ASSET_DIR / "logo.png"


if load_dotenv:
    load_dotenv(ROOT_DIR / ".env")


@dataclass(frozen=True)
class DbConfig:
    host: str = os.getenv("DB_HOST", "localhost")
    port: int = int(os.getenv("DB_PORT", "3306"))
    user: str = os.getenv("DB_USER", "root")
    password: str = os.getenv("DB_PASSWORD", "")
    database: str = os.getenv("DB_NAME", "game_olympia")


APP_WIDTH = int(os.getenv("APP_WIDTH", "1080"))
APP_HEIGHT = int(os.getenv("APP_HEIGHT", "720"))
ADMIN_SERVER_URL = os.getenv("ADMIN_SERVER_URL", f"http://localhost:{os.getenv('ADMIN_WEB_PORT', '3000')}")
CLIENT_ROOM_CODE = os.getenv("CLIENT_ROOM_CODE", "")
