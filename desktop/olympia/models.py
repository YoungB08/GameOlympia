from __future__ import annotations

from dataclasses import dataclass


@dataclass
class WarmupQuestion:
    stt: int
    question: str
    answer: bool

    def is_correct(self, answer: bool) -> bool:
        return self.answer is answer


@dataclass
class ObstacleKey:
    stt: int
    question: str
    answer: str
    cell_count: int
    image_path: str | None = None

    def is_correct(self, answer: str) -> bool:
        return self.answer.strip().lower() == answer.strip().lower()


@dataclass
class ObstacleRow:
    stt: int
    row_no: int
    question: str
    answer: str
    cell_count: int

    def is_correct(self, answer: str) -> bool:
        return self.answer.strip().lower() == answer.strip().lower()


@dataclass
class SpeedQuestion:
    stt: int
    question: str
    answer_a: str
    answer_b: str
    answer_c: str
    answer_d: str
    answer: str
    media_path: str | None = None

    def is_correct(self, answer: str) -> bool:
        return self.answer.strip().lower() == answer.strip().lower()


@dataclass
class FinishQuestion:
    stt: int
    question: str
    answer_a: str
    answer_b: str
    answer_c: str
    answer_d: str
    answer: str
    point: int

    def is_correct(self, answer: str) -> bool:
        return self.answer.strip().lower() == answer.strip().lower()


@dataclass
class Score:
    stt: int | None
    name: str
    score: int
