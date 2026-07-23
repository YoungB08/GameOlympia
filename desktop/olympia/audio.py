from __future__ import annotations

from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

from .config import SOUND_DIR

try:
    from PySide6.QtCore import QUrl
    from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer, QSoundEffect
except Exception:  # pragma: no cover - multimedia plugins vary by host
    QAudioOutput = None
    QMediaPlayer = None
    QSoundEffect = None
    QUrl = None


DEFAULT_VOLUME = 0.5

SOUND_PACK: dict[str, str] = {
    "starting.startRound": "Starting/StartRound.mp3",
    "starting.startTurn": "Starting/StartTurn.mp3",
    "starting.mainTime": "Starting/MainTime.mp3",
    "starting.claim": "Starting/Claim.mp3",
    "starting.correct": "Starting/CorrectAnswer.mp3",
    "starting.wrong": "Starting/WrongAnswer.mp3",
    "starting.finishTurn": "Starting/FinishTurn.mp3",
    "obstacle.startRound": "Obstacle/StartRound.mp3",
    "obstacle.rowQuestion": "Obstacle/RowQuestShow.mp3",
    "obstacle.15": "Obstacle/15Seconds.mp3",
    "obstacle.answers": "Obstacle/AnswersShowing.mp3",
    "obstacle.correctRow": "Obstacle/CorrectRow.mp3",
    "obstacle.wrongRow": "Obstacle/WrongRow.mp3",
    "obstacle.grant": "Obstacle/ObstacleGrant.mp3",
    "obstacle.correctObstacle": "Obstacle/CorrectObstacle.mp3",
    "obstacle.pictureReveal": "Obstacle/PictureReveal.mp3",
    "speed.startRound": "Acceleration/StartRound.mp3",
    "speed.question": "Acceleration/QuestionShowing.mp3",
    "speed.10": "Acceleration/10Seconds.mp3",
    "speed.20": "Acceleration/20Seconds.mp3",
    "speed.30": "Acceleration/30Seconds.mp3",
    "speed.40": "Acceleration/40Seconds.mp3",
    "speed.answers": "Acceleration/AnswersShowing.mp3",
    "speed.correct": "Acceleration/Correct.mp3",
    "finish.startRound": "Finish/StartRound.mp3",
    "finish.startTurn": "Finish/StartTurn.mp3",
    "finish.packageChoose": "Finish/PackageChoose.mp3",
    "finish.choiceChosen": "Finish/ChoiceChosen.mp3",
    "finish.starChoose": "Finish/StarChoose.mp3",
    "finish.5": "Finish/5Seconds.mp3",
    "finish.15": "Finish/15Seconds.mp3",
    "finish.20": "Finish/20Seconds.mp3",
    "finish.grant": "Finish/Grant.mp3",
    "finish.correct": "Finish/CorrectFinish.mp3",
    "finish.wrong": "Finish/WrongFinish.mp3",
    "finish.finishRound": "Finish/FinishRound.mp3",
    "subquestion.question": "SubQuestion/QuestionShowing.mp3",
    "subquestion.15": "SubQuestion/15Seconds.mp3",
    "subquestion.claim": "SubQuestion/Claim.mp3",
    "summary.points": "Main/PointSummary.mp3",
}


def normalized_volume(value: object = DEFAULT_VOLUME) -> float:
    try:
        parsed = float(value if value is not None else DEFAULT_VOLUME)
    except (TypeError, ValueError):
        parsed = DEFAULT_VOLUME
    return max(0.0, min(1.0, parsed))


def local_sound_path(media_url: str | None) -> Path | None:
    raw = str(media_url or "").strip()
    if not raw:
        return None
    if not raw.lower().split("?", 1)[0].split("#", 1)[0].endswith(".mp3"):
        return None
    parsed = urlparse(raw)
    resource_path = unquote(parsed.path if parsed.scheme else raw)
    resource_path = resource_path.lstrip("/")
    if not resource_path.lower().startswith("sounds/"):
        return None
    candidate = SOUND_DIR / resource_path[len("sounds/"):]
    return candidate if candidate.exists() else None


def absolute_media_url(media_url: str | None, base_url: str = "") -> str:
    raw = str(media_url or "").strip()
    if not raw:
        return ""
    if not raw.lower().split("?", 1)[0].split("#", 1)[0].endswith(".mp3"):
        return ""
    parsed = urlparse(raw)
    if parsed.scheme:
        return raw
    if not base_url:
        return raw
    return urljoin(f"{base_url.rstrip('/')}/", raw)


class SoundBank:
    def __init__(self) -> None:
        self._effects: dict[str, QSoundEffect] = {}
        self._players: dict[str, tuple[QMediaPlayer, QAudioOutput]] = {}
        if QSoundEffect is None and QMediaPlayer is None:
            return
        for name in ("correct", "wrong", "timeout", "click"):
            path = SOUND_DIR / f"{name}.wav"
            if path.exists() and QSoundEffect is not None:
                effect = QSoundEffect()
                effect.setSource(QUrl.fromLocalFile(str(path)))
                effect.setVolume(DEFAULT_VOLUME)
                self._effects[name] = effect
        if QMediaPlayer is not None and QAudioOutput is not None:
            for key, relative in SOUND_PACK.items():
                path = SOUND_DIR / relative
                if not path.exists():
                    continue
                output = QAudioOutput()
                output.setVolume(DEFAULT_VOLUME)
                player = QMediaPlayer()
                player.setAudioOutput(output)
                player.setSource(QUrl.fromLocalFile(str(path)))
                self._players[key] = (player, output)

    def play(self, name: str) -> None:
        player_bundle = self._players.get(name)
        if player_bundle:
            player, _output = player_bundle
            player.stop()
            player.setPosition(0)
            player.play()
            return
        effect = self._effects.get(name)
        if effect:
            effect.play()


class MediaPlayback:
    def __init__(self) -> None:
        self._output: QAudioOutput | None = None
        self._player: QMediaPlayer | None = None
        if QMediaPlayer is None or QAudioOutput is None:
            return
        self._output = QAudioOutput()
        self._output.setVolume(DEFAULT_VOLUME)
        self._player = QMediaPlayer()
        self._player.setAudioOutput(self._output)

    def play_media(self, media_url: str | None, base_url: str = "", volume: float = DEFAULT_VOLUME) -> None:
        if self._player is None or QUrl is None:
            return
        local_path = local_sound_path(media_url)
        if local_path:
            source = QUrl.fromLocalFile(str(local_path))
        else:
            resolved_url = absolute_media_url(media_url, base_url)
            if not resolved_url:
                return
            source = QUrl(resolved_url)
        self._player.stop()
        if self._output is not None:
            self._output.setVolume(normalized_volume(volume))
        self._player.setSource(source)
        self._player.setPosition(0)
        self._player.play()

    def stop(self) -> None:
        if self._player is not None:
            self._player.stop()


def known_sound_files() -> list[Path]:
    return sorted(SOUND_DIR.rglob("*.mp3"))
