"""Parse a statement file into ordered, validated raw transactions."""

from __future__ import annotations

import datetime as dt
import hashlib
import re
from dataclasses import dataclass, field
from decimal import Decimal

from .account import AccountHint, detect_account
from .columns import HeaderMap, find_header, map_header
from .normalize import detect_day_first, parse_amount, parse_date
from .reader import PasswordRequired, UnsupportedFile, read_grid

FOOTER = re.compile(r"(?i)^(opening|closing|total|grand total|statement|page\s*\d|\*+|end of|this is a computer|unless|legend|b/f|c/f|balance (b/f|c/f|forward))")
BALANCE_TOLERANCE = Decimal("0.05")


class StatementError(ValueError):
    pass


class StatementLocked(StatementError):
    def __init__(self, message: str, wrong_password: bool):
        super().__init__(message)
        self.wrong_password = wrong_password


@dataclass
class RawTxn:
    seq: int
    date: dt.date
    value_date: dt.date | None
    particulars: str
    tran_type: str
    cheque: str
    withdrawal: Decimal
    deposit: Decimal
    balance: Decimal | None
    source_sl: str
    fingerprint: str = ""


@dataclass
class ParsedStatement:
    transactions: list[RawTxn]
    columns: list[str]
    skipped_rows: int
    reversed_order: bool
    balance_checked: int
    balance_mismatches: int
    warnings: list[str] = field(default_factory=list)
    account: AccountHint = field(default_factory=AccountHint)

    @property
    def period(self) -> tuple[dt.date | None, dt.date | None]:
        if not self.transactions:
            return None, None
        return self.transactions[0].date, self.transactions[-1].date


def _cell(row: list[str], h: HeaderMap, key: str) -> str:
    i = h.columns.get(key)
    return row[i].strip() if i is not None and i < len(row) else ""


def _join_wrapped(prev: str, extra: str) -> str:
    # Fixed-width exports split mid-token ("reliancefresh@ax" + "isbank/UTIB"); join those without a space.
    hard_wrap = (len(prev) >= 25 and re.search(r"[\w@.]$", prev) and re.match(r"[\w@.]", extra)
                 and " " not in extra.split("/")[0])
    return prev + ("" if hard_wrap else " ") + extra


def parse_statement(filename: str, data: bytes, password: str | None = None) -> ParsedStatement:
    try:
        grid = read_grid(filename, data, password)
    except PasswordRequired as e:
        raise StatementLocked(str(e), e.wrong) from e
    except UnsupportedFile as e:
        raise StatementError(str(e)) from e
    except Exception as e:  # corrupt workbook etc.
        raise StatementError(f"Couldn't read {filename}: {e}") from e

    header = find_header(grid)
    if header is None:
        raise StatementError(
            "Couldn't find the column header row. Expected columns like Tran Date, Particulars, Withdrawal, Deposit and Balance.")

    body = grid[header.row_index + 1:]
    day_first = detect_day_first([_cell(r, header, "date") for r in body])
    header_sig = [c.strip().lower() for c in header.labels]

    txns: list[RawTxn] = []
    skipped = 0
    for row in body:
        if not any(c.strip() for c in row):
            continue
        if [c.strip().lower() for c in row[:len(header_sig)]] == header_sig or map_header(row).keys() >= {"date", "particulars"}:
            continue  # header repeated on every page
        date = parse_date(_cell(row, header, "date"), day_first)
        particulars = _cell(row, header, "particulars")
        wd, dp = _amounts(row, header)

        if date is None:
            if txns and particulars and wd is None and dp is None and not FOOTER.match(particulars) and not _cell(row, header, "balance"):
                txns[-1].particulars = _join_wrapped(txns[-1].particulars, particulars)
            elif particulars or wd or dp:
                skipped += 1
            continue
        if not wd and not dp:
            skipped += 1
            continue

        bal_raw = _cell(row, header, "balance")
        txns.append(RawTxn(
            seq=len(txns),
            date=date,
            value_date=parse_date(_cell(row, header, "value_date"), day_first),
            particulars=" ".join(particulars.split()),
            tran_type=_cell(row, header, "tran_type"),
            cheque=_cell(row, header, "cheque"),
            withdrawal=abs(wd or Decimal(0)),
            deposit=abs(dp or Decimal(0)),
            balance=parse_amount(bal_raw) if bal_raw else None,
            source_sl=_cell(row, header, "sl"),
        ))

    if not txns:
        raise StatementError("Found the header row but no transactions under it.")

    reversed_order = _is_newest_first(txns)
    if reversed_order:
        txns.reverse()
    for i, t in enumerate(txns):
        t.seq = i

    checked, mismatches = _reconcile(txns)
    warnings = []
    if mismatches:
        warnings.append(f"Running balance doesn't reconcile on {mismatches} of {checked} rows; some rows may be missing or mis-parsed.")
    if skipped:
        warnings.append(f"Skipped {skipped} rows that had no date or no amount.")
    _fingerprint(txns)

    return ParsedStatement(
        transactions=txns,
        columns=[f for f in header.columns],
        skipped_rows=skipped,
        reversed_order=reversed_order,
        balance_checked=checked,
        balance_mismatches=mismatches,
        warnings=warnings,
        account=detect_account(grid[:header.row_index], filename),
    )


def _amounts(row: list[str], h: HeaderMap) -> tuple[Decimal | None, Decimal | None]:
    if h.has("withdrawal") or h.has("deposit"):
        return parse_amount(_cell(row, h, "withdrawal")), parse_amount(_cell(row, h, "deposit"))
    amt = parse_amount(_cell(row, h, "amount"))
    if amt is None:
        return None, None
    flag = _cell(row, h, "drcr").lower()
    if flag.startswith("d") or (not flag and amt < 0):
        return abs(amt), None
    return None, abs(amt)


def _is_newest_first(txns: list[RawTxn]) -> bool:
    if txns[0].date != txns[-1].date:
        return txns[0].date > txns[-1].date
    # Single-day statement: decide by which ordering makes the running balance add up.
    return _count_ok(list(reversed(txns))) > _count_ok(txns)


def _count_ok(txns: list[RawTxn]) -> int:
    ok = 0
    for a, b in zip(txns, txns[1:]):
        if a.balance is not None and b.balance is not None and abs(a.balance + b.deposit - b.withdrawal - b.balance) <= BALANCE_TOLERANCE:
            ok += 1
    return ok


def _reconcile(txns: list[RawTxn]) -> tuple[int, int]:
    checked = mismatches = 0
    for a, b in zip(txns, txns[1:]):
        if a.balance is None or b.balance is None:
            continue
        checked += 1
        if abs(a.balance + b.deposit - b.withdrawal - b.balance) > BALANCE_TOLERANCE:
            mismatches += 1
    return checked, mismatches


def _fingerprint(txns: list[RawTxn]) -> None:
    """Stable identity so overlapping or re-uploaded statements don't double count.
    Identical rows within one file get an occurrence counter so genuine repeats survive."""
    seen: dict[str, int] = {}
    for t in txns:
        key = "|".join([
            t.date.isoformat(), re.sub(r"\s+", "", t.particulars.lower()),
            f"{t.withdrawal:.2f}", f"{t.deposit:.2f}", f"{t.balance:.2f}" if t.balance is not None else "",
        ])
        n = seen.get(key, 0)
        seen[key] = n + 1
        t.fingerprint = hashlib.sha1(f"{key}#{n}".encode()).hexdigest()
