from __future__ import annotations

from .database import execute, fetch_all, fetch_one
from .models import (
    FinishQuestion,
    ObstacleKey,
    ObstacleRow,
    Score,
    SpeedQuestion,
    WarmupQuestion,
)


class WarmupRepository:
    @staticmethod
    def all() -> list[WarmupQuestion]:
        rows = fetch_all("SELECT stt, question, answer FROM warmup_questions ORDER BY stt")
        return [WarmupQuestion(row["stt"], row["question"], bool(row["answer"])) for row in rows]

    @staticmethod
    def by_id(stt: int) -> WarmupQuestion | None:
        row = fetch_one("SELECT stt, question, answer FROM warmup_questions WHERE stt = %s", (stt,))
        return WarmupQuestion(row["stt"], row["question"], bool(row["answer"])) if row else None


class ObstacleRepository:
    @staticmethod
    def keys() -> list[ObstacleKey]:
        rows = fetch_all(
            "SELECT stt, question, answer, cell_count, image_path FROM obstacle_keys ORDER BY stt"
        )
        return [
            ObstacleKey(row["stt"], row["question"], row["answer"], row["cell_count"], row["image_path"])
            for row in rows
        ]

    @staticmethod
    def key_by_id(stt: int) -> ObstacleKey | None:
        row = fetch_one(
            "SELECT stt, question, answer, cell_count, image_path FROM obstacle_keys WHERE stt = %s",
            (stt,),
        )
        return (
            ObstacleKey(row["stt"], row["question"], row["answer"], row["cell_count"], row["image_path"])
            if row
            else None
        )

    @staticmethod
    def row_by_id(stt: int, row_no: int) -> ObstacleRow | None:
        row = fetch_one(
            """
            SELECT stt, row_no, question, answer, cell_count
            FROM obstacle_rows
            WHERE stt = %s AND row_no = %s
            """,
            (stt, row_no),
        )
        return (
            ObstacleRow(row["stt"], row["row_no"], row["question"], row["answer"], row["cell_count"])
            if row
            else None
        )


class SpeedRepository:
    @staticmethod
    def all() -> list[SpeedQuestion]:
        rows = fetch_all(
            """
            SELECT stt, question, answer_a, answer_b, answer_c, answer_d, answer, media_path
            FROM speed_questions
            ORDER BY stt
            """
        )
        return [
            SpeedQuestion(
                row["stt"],
                row["question"],
                row["answer_a"] or "",
                row["answer_b"] or "",
                row["answer_c"] or "",
                row["answer_d"] or "",
                row["answer"],
                row["media_path"],
            )
            for row in rows
        ]


class FinishRepository:
    @staticmethod
    def all_by_point(point: int) -> list[FinishQuestion]:
        rows = fetch_all(
            """
            SELECT stt, question, answer_a, answer_b, answer_c, answer_d, answer, point
            FROM finish_questions
            WHERE point = %s
            ORDER BY stt
            """,
            (point,),
        )
        return [
            FinishQuestion(
                row["stt"],
                row["question"],
                row["answer_a"] or "",
                row["answer_b"] or "",
                row["answer_c"] or "",
                row["answer_d"] or "",
                row["answer"],
                row["point"],
            )
            for row in rows
        ]


class ScoreRepository:
    @staticmethod
    def all() -> list[Score]:
        rows = fetch_all("SELECT stt, name, score FROM scores ORDER BY score DESC, stt ASC")
        return [Score(row["stt"], row["name"], row["score"]) for row in rows]

    @staticmethod
    def name_exists(name: str) -> bool:
        row = fetch_one("SELECT stt FROM scores WHERE LOWER(name) = LOWER(%s)", (name,))
        return row is not None

    @staticmethod
    def insert(score: Score) -> None:
        execute("INSERT INTO scores (name, score) VALUES (%s, %s)", (score.name, score.score))
