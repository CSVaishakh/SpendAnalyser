"""Store a parsed statement, skipping transactions already imported from an overlapping statement."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..migrate import account_fingerprint
from ..models import Statement, Transaction
from ..parsing.extract import extract
from ..parsing.payer_app import detect_payer_app
from ..parsing.statement import StatementError, StatementLocked, parse_statement
from .accounts import link_transfers, resolve_account
from .entities import unify_entities
from .rules import apply_rules, load_compiled


@dataclass
class IngestResult:
    filename: str
    status: str  # imported | duplicate | error | password_required
    message: str = ""
    statement_id: int | None = None
    parsed: int = 0
    inserted: int = 0
    duplicates: int = 0
    skipped: int = 0
    balance_checked: int = 0
    balance_mismatches: int = 0
    reversed_order: bool = False
    period_start: str | None = None
    period_end: str | None = None
    account_id: int | None = None
    account_name: str | None = None
    account_created: bool = False
    account_how: str = ""
    transfers_linked: int = 0
    wrong_password: bool = False
    warnings: list[str] = field(default_factory=list)


def _paise(d) -> int:
    return int((d * 100).to_integral_value())


def ingest(session: Session, filename: str, data: bytes, account_id: int | None = None,
           password: str | None = None) -> IngestResult:
    try:
        parsed = parse_statement(filename, data, password)
    except StatementLocked as e:
        r = IngestResult(filename, "password_required", str(e))
        r.wrong_password = e.wrong_password
        return r
    except StatementError as e:
        return IngestResult(filename, "error", str(e))

    start, end = parsed.period
    result = IngestResult(
        filename, "imported", parsed=len(parsed.transactions), skipped=parsed.skipped_rows,
        balance_checked=parsed.balance_checked, balance_mismatches=parsed.balance_mismatches,
        reversed_order=parsed.reversed_order, period_start=start.isoformat() if start else None,
        period_end=end.isoformat() if end else None, warnings=list(parsed.warnings),
    )

    res = resolve_account(session, parsed, account_id)
    if res.account is None:
        session.rollback()
        result.status, result.message = "error", res.error or "No account selected."
        return result
    acct = res.account
    result.account_id, result.account_name, result.account_created, result.account_how = acct.id, acct.name, res.created, res.how
    for t in parsed.transactions:
        t.fingerprint = account_fingerprint(acct.id, t.fingerprint)

    fps = [t.fingerprint for t in parsed.transactions]
    existing: set[str] = set()
    for i in range(0, len(fps), 500):
        existing.update(session.scalars(select(Transaction.fingerprint).where(
            Transaction.account_id == acct.id, Transaction.fingerprint.in_(fps[i:i + 500]))))

    fresh = [t for t in parsed.transactions if t.fingerprint not in existing]
    result.duplicates = len(parsed.transactions) - len(fresh)
    if not fresh:
        result.status = "duplicate"
        result.message = f"Every transaction in this file is already imported into {acct.name}."
        session.commit()  # keep a newly detected account even if its rows were already present elsewhere
        return result

    stmt = Statement(
        account_id=acct.id, filename=filename, sha256=hashlib.sha256(data).hexdigest(), period_start=start, period_end=end,
        rows_parsed=len(parsed.transactions), rows_inserted=len(fresh), rows_duplicate=result.duplicates,
        rows_skipped=parsed.skipped_rows, balance_checked=parsed.balance_checked,
        balance_mismatches=parsed.balance_mismatches, reversed_order=parsed.reversed_order, warnings=parsed.warnings,
    )
    session.add(stmt)
    session.flush()

    rules = load_compiled(session)
    for raw in fresh:
        ex = extract(raw.particulars, raw.tran_type, raw.cheque, is_debit=raw.withdrawal > 0)
        txn = Transaction(
            statement_id=stmt.id, account_id=acct.id, seq=raw.seq, fingerprint=raw.fingerprint, date=raw.date, value_date=raw.value_date,
            particulars=raw.particulars, tran_type=raw.tran_type[:32], cheque=raw.cheque[:64],
            withdrawal=_paise(raw.withdrawal), deposit=_paise(raw.deposit),
            balance=_paise(raw.balance) if raw.balance is not None else None,
            channel=ex.channel, counterparty=(ex.counterparty or None) and ex.counterparty[:128],
            auto_entity=ex.entity[:160], auto_category=ex.category, entity=ex.entity[:160], category=ex.category,
            payer_app=detect_payer_app(raw.particulars, ex.channel, raw.withdrawal > 0),
        )
        apply_rules(txn, rules)
        session.add(txn)

    session.flush()
    result.transfers_linked = link_transfers(session)
    unify_entities(session)
    from .reprocess import mark_current

    mark_current(session)
    session.commit()
    result.statement_id = stmt.id
    result.inserted = len(fresh)
    if result.duplicates:
        result.message = f"{result.duplicates} transactions were already imported from another statement and were skipped."
    return result
