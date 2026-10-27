"""Date and amount parsing for Indian bank statements."""

from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal, InvalidOperation

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
MONTHS["sept"] = 9

_ISO = re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$")
_NUMERIC = re.compile(r"^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$")
_NAMED = re.compile(r"^(\d{1,2})[-/ ]?([A-Za-z]{3,9})[-/ ,]*(\d{2,4})$")
_NAMED_US = re.compile(r"^([A-Za-z]{3,9})[ -](\d{1,2}),?[ -](\d{2,4})$")


def _year(y: int) -> int:
    return y + 2000 if y < 100 else y


def _make(y: int, m: int, d: int) -> dt.date | None:
    try:
        return dt.date(_year(y), m, d)
    except ValueError:
        return None


def parse_date(value: str, day_first: bool = True) -> dt.date | None:
    if not value:
        return None
    s = value.strip()
    s = re.split(r"[ T](?=\d{1,2}:\d{2})", s)[0].strip()  # drop time-of-day
    if m := _ISO.match(s):
        return _make(int(m[1]), int(m[2]), int(m[3]))
    if m := _NUMERIC.match(s):
        a, b, y = int(m[1]), int(m[2]), int(m[3])
        return _make(y, b, a) if day_first else _make(y, a, b)
    if m := _NAMED.match(s):
        mon = MONTHS.get(m[2][:4].lower()) or MONTHS.get(m[2][:3].lower())
        return _make(int(m[3]), mon, int(m[1])) if mon else None
    if m := _NAMED_US.match(s):
        mon = MONTHS.get(m[1][:4].lower()) or MONTHS.get(m[1][:3].lower())
        return _make(int(m[3]), mon, int(m[2])) if mon else None
    return None


def detect_day_first(samples: list[str]) -> bool:
    """Indian statements are day-first, but fall back to month-first if that parses strictly more rows."""
    samples = [s for s in samples if s][:500]
    df = sum(parse_date(s, True) is not None for s in samples)
    mf = sum(parse_date(s, False) is not None for s in samples)
    return not (mf > df)


_AMOUNT_JUNK = re.compile(r"(?i)[₹,\s]|INR|Rs\.?")


def parse_amount(value: str) -> Decimal | None:
    """Returns a signed Decimal, or None when the cell holds no amount. 'Dr' suffix / parentheses mean negative."""
    if value is None:
        return None
    s = _AMOUNT_JUNK.sub("", str(value))
    if s in ("", "-", "--", "0.00-", "NA", "N/A"):
        return None
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg, s = True, s[1:-1]
    low = s.lower()
    if low.endswith("dr"):
        neg, s = True, s[:-2]
    elif low.endswith("cr"):
        s = s[:-2]
    if s.endswith("-"):
        neg, s = True, s[:-1]
    if s.startswith("-"):
        neg, s = not neg, s[1:]
    s = s.lstrip("+")
    try:
        d = Decimal(s)
    except InvalidOperation:
        return None
    return -d if neg else d
