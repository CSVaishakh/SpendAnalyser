"""Locate the header row of a statement and map its columns to canonical fields."""

from __future__ import annotations

import re
from dataclasses import dataclass

# Order matters: more specific fields are matched first so "Value Date" isn't taken as the transaction date.
FIELD_PATTERNS: list[tuple[str, list[str]]] = [
    ("value_date", [r"^value\s*d(a)?te?$", r"^value\s*dt$"]),
    ("date", [r"^tran(saction)?\.?\s*date$", r"^txn\.?\s*date$", r"^date$", r"^posting\s*date$", r"^trans(action)?\s*dt$", r"^tran\s*dt$", r"^date\s*of\s*transaction$"]),
    ("sl", [r"^s(l|r|\.)\.?\s*no\.?$", r"^serial", r"^#$", r"^no\.?$"]),
    ("tran_type", [r"^tran(saction)?\.?\s*type$", r"^txn\.?\s*type$", r"^type$"]),
    ("cheque", [r"cheque|chq|^ref(erence)?\.?\s*(no|number)?\.?$|^instrument"]),
    ("withdrawal", [r"withdrawal", r"^debit(s)?(\s*amount)?$", r"^dr\.?(\s*amount)?$", r"^paid\s*out"]),
    ("deposit", [r"deposit", r"^credit(s)?(\s*amount)?$", r"^cr\.?(\s*amount)?$", r"^paid\s*in"]),
    ("balance", [r"balance"]),
    ("amount", [r"^(transaction\s*)?amount$", r"^amt$"]),
    ("drcr", [r"^(dr|cr)\s*/\s*(cr|dr)$", r"^debit\s*/\s*credit$", r"^dr/cr\s*indicator$"]),
    ("particulars", [r"particular", r"narration", r"description", r"^remarks?$", r"^details$", r"transaction\s*details"]),
]


@dataclass
class HeaderMap:
    row_index: int
    columns: dict[str, int]
    labels: list[str]

    def has(self, field: str) -> bool:
        return field in self.columns


def _norm(cell: str) -> str:
    c = cell.lower().replace("(₹)", "").replace("(inr)", "").replace("(rs.)", "").replace("(rs)", "")
    return re.sub(r"\s+", " ", re.sub(r"[()\[\]:]", " ", c)).strip()


def map_header(cells: list[str]) -> dict[str, int]:
    norm = [_norm(c) for c in cells]
    used: set[int] = set()
    out: dict[str, int] = {}
    for field, patterns in FIELD_PATTERNS:
        for i, label in enumerate(norm):
            if i in used or not label:
                continue
            if any(re.search(p, label) for p in patterns):
                out[field] = i
                used.add(i)
                break
    return out


def find_header(grid: list[list[str]], scan: int = 80) -> HeaderMap | None:
    for i, row in enumerate(grid[:scan]):
        cols = map_header(row)
        has_money = ("withdrawal" in cols or "deposit" in cols) or "amount" in cols
        if "date" in cols and "particulars" in cols and has_money:
            return HeaderMap(i, cols, row)
    return None
