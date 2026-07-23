from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "DBOlympiaGame.sql"
TARGET = Path(__file__).resolve().with_name("mysql_seed.sql")


TABLE_MAP = {
    "tblKhoiDong": (
        "warmup_questions",
        {
            "STT": "stt",
            "Question": "question",
            "Answer": "answer",
        },
    ),
    "KeyVCNV": (
        "obstacle_keys",
        {
            "STT": "stt",
            "Question": "question",
            "Answer": "answer",
            "SoOHN": "cell_count",
            "Path": "image_path",
        },
    ),
    "tblVuotChuongNgaiVat": (
        "obstacle_rows",
        {
            "STT": "stt",
            "STTHN": "row_no",
            "SoOHN": "cell_count",
            "Question": "question",
            "Answer": "answer",
        },
    ),
    "tblTangToc": (
        "speed_questions",
        {
            "STT": "stt",
            "Question": "question",
            "AnswerA": "answer_a",
            "AnswerB": "answer_b",
            "AnswerC": "answer_c",
            "AnswerD": "answer_d",
            "Answer": "answer",
        },
    ),
    "tblVeDick": (
        "finish_questions",
        {
            "STT": "stt",
            "Question": "question",
            "AnswerA": "answer_a",
            "AnswerB": "answer_b",
            "AnswerC": "answer_c",
            "AnswerD": "answer_d",
            "Answer": "answer",
            "Point": "point",
        },
    ),
    "tblKeyVeDich": (
        "finish_packages",
        {
            "STT": "stt",
            "Name": "name",
        },
    ),
    "tblPoint": (
        "scores",
        {
            "STT": "stt",
            "Name": "name",
            "Diem": "score",
        },
    ),
}


INSERT_RE = re.compile(
    r"INSERT\s+\[dbo\]\.\[(?P<table>[^\]]+)\]\s+\((?P<cols>.*?)\)\s+VALUES\s+\((?P<vals>.*)\)",
    re.IGNORECASE,
)


def parse_cols(raw: str) -> list[str]:
    return [part.strip().strip("[]") for part in raw.split(",")]


def parse_values(raw: str) -> list[object | None]:
    values: list[object | None] = []
    i = 0
    while i < len(raw):
        while i < len(raw) and raw[i].isspace():
            i += 1
        if i < len(raw) and raw[i] in {"N", "n"} and i + 1 < len(raw) and raw[i + 1] == "'":
            i += 1
        if i < len(raw) and raw[i] == "'":
            i += 1
            buf: list[str] = []
            while i < len(raw):
                ch = raw[i]
                if ch == "'":
                    if i + 1 < len(raw) and raw[i + 1] == "'":
                        buf.append("'")
                        i += 2
                        continue
                    i += 1
                    break
                buf.append(ch)
                i += 1
            values.append("".join(buf))
        else:
            start = i
            while i < len(raw) and raw[i] != ",":
                i += 1
            token = raw[start:i].strip()
            if token.upper() == "NULL":
                values.append(None)
            elif re.fullmatch(r"-?\d+", token):
                values.append(int(token))
            else:
                values.append(token)
        while i < len(raw) and raw[i].isspace():
            i += 1
        if i < len(raw) and raw[i] == ",":
            i += 1
    return values


def sql_value(value: object | None, column: str) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    text = str(value)
    if column == "answer":
        text = text.strip()
    text = text.replace("\\", "\\\\").replace("'", "''")
    return f"'{text}'"


def build_insert(table: str, cols: list[str], vals: list[object | None]) -> str | None:
    if table not in TABLE_MAP:
        return None
    target_table, col_map = TABLE_MAP[table]
    target_cols: list[str] = []
    target_vals: list[object | None] = []
    for col, val in zip(cols, vals):
        if col in col_map:
            target_cols.append(col_map[col])
            target_vals.append(val)
    if not target_cols:
        return None
    cols_sql = ", ".join(f"`{col}`" for col in target_cols)
    vals_sql = ", ".join(sql_value(val, col) for col, val in zip(target_cols, target_vals))
    update_cols = [col for col in target_cols if col != "stt"]
    update_sql = ", ".join(f"`{col}` = VALUES(`{col}`)" for col in update_cols)
    return (
        f"INSERT INTO `{target_table}` ({cols_sql}) VALUES ({vals_sql})\n"
        f"ON DUPLICATE KEY UPDATE {update_sql};"
    )


def main() -> None:
    lines = [
        "USE game_olympia;",
        "SET NAMES utf8mb4;",
        "",
        "INSERT INTO finish_packages (stt, name) VALUES",
        "  (1, 'Gói 40 điểm'),",
        "  (2, 'Gói 60 điểm'),",
        "  (3, 'Gói 80 điểm')",
        "ON DUPLICATE KEY UPDATE name = VALUES(name);",
        "",
    ]
    lines = "\n".join(lines).replace(")ON DUPLICATE", ")\nON DUPLICATE").splitlines()
    seen_package_rows = False
    for raw_line in SOURCE.read_text(encoding="utf-16").splitlines():
        match = INSERT_RE.search(raw_line.strip())
        if not match:
            continue
        table = match.group("table")
        if table == "tblKeyVeDich":
            seen_package_rows = True
            continue
        insert_sql = build_insert(table, parse_cols(match.group("cols")), parse_values(match.group("vals")))
        if insert_sql:
            lines.append(insert_sql)
    if not seen_package_rows:
        raise SystemExit("Did not find tblKeyVeDich seed rows.")
    lines.append("")
    TARGET.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
