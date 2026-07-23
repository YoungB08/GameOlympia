from __future__ import annotations


class PointState:
    _instance: "PointState | None" = None

    def __init__(self) -> None:
        self.point = 0

    @classmethod
    def instance(cls) -> "PointState":
        if cls._instance is None:
            cls._instance = PointState()
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        cls._instance = None

    def add(self, value: int) -> None:
        self.point += value

    def minus(self, value: int) -> None:
        self.point -= value
