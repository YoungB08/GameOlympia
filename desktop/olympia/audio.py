from __future__ import annotations

from pathlib import Path

from .config import SOUND_DIR

try:
    from PySide6.QtCore import QUrl
    from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer, QSoundEffect
except Exception:  # pragma: no cover - multimedia plugins vary by host
    QAudioOutput = None
    QMediaPlayer = None
    QSoundEffect = None
    QUrl = None


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
                effect.setVolume(0.85)
                self._effects[name] = effect
        if QMediaPlayer is not None and QAudioOutput is not None:
            for key, relative in SOUND_PACK.items():
                path = SOUND_DIR / relative
                if not path.exists():
                    continue
                output = QAudioOutput()
                output.setVolume(0.85)
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


def known_sound_files() -> list[Path]:
    return sorted(SOUND_DIR.rglob("*.mp3")) + sorted(SOUND_DIR.glob("*.wav"))
