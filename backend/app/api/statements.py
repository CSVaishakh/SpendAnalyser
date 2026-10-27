from dataclasses import asdict

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import MAX_UPLOAD_BYTES
from ..db import get_session
from ..models import Account, Statement, Transaction
from ..schemas import AccountIn
from ..services.accounts import link_transfers, relabel_transfers, unlink_transfers
from ..services.analytics import rupees
from ..services.entities import unify_entities
from ..services.ingest import ingest

router = APIRouter(prefix="/api", tags=["statements"])


def _out(s: Statement, names: dict[int, str]) -> dict:
    return {
        "id": s.id, "account_id": s.account_id, "account_name": names.get(s.account_id), "filename": s.filename,
        "uploaded_at": s.uploaded_at.isoformat() if s.uploaded_at else None,
        "period_start": s.period_start.isoformat() if s.period_start else None,
        "period_end": s.period_end.isoformat() if s.period_end else None,
        "rows_parsed": s.rows_parsed, "rows_inserted": s.rows_inserted, "rows_duplicate": s.rows_duplicate,
        "rows_skipped": s.rows_skipped, "balance_checked": s.balance_checked, "balance_mismatches": s.balance_mismatches,
        "reversed_order": s.reversed_order, "warnings": s.warnings or [],
    }


def _names(session: Session) -> dict[int, str]:
    return dict(session.execute(select(Account.id, Account.name)).all())


def _delete_transactions(session: Session, where) -> None:
    ids = set(session.scalars(select(Transaction.id).where(where)))
    unlink_transfers(session, ids)
    session.execute(delete(Transaction).where(where))


@router.post("/statements")
async def upload(
    files: list[UploadFile] = File(...),
    account_id: int | None = Form(None, description="Put every file into this account instead of auto-detecting"),
    password: str | None = Form(None, description="Password for encrypted Excel statements; used once, never stored"),
    session: Session = Depends(get_session),
):
    results = []
    for f in files:
        data = await f.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            results.append({"filename": f.filename, "status": "error", "message": "File is too large."})
            continue
        results.append(asdict(ingest(session, f.filename or "statement", data, account_id, password or None)))
    return {"results": results}


@router.get("/statements")
def list_statements(session: Session = Depends(get_session)):
    names = _names(session)
    return [_out(s, names) for s in session.scalars(select(Statement).order_by(Statement.account_id, Statement.period_start, Statement.id))]


@router.delete("/statements/{statement_id}", status_code=204)
def delete_statement(statement_id: int, session: Session = Depends(get_session)):
    s = session.get(Statement, statement_id)
    if not s:
        raise HTTPException(404, "Statement not found")
    _delete_transactions(session, Transaction.statement_id == statement_id)
    session.delete(s)
    session.flush()
    link_transfers(session)
    unify_entities(session)
    session.commit()


@router.delete("/data", status_code=204)
def wipe(session: Session = Depends(get_session)):
    """Remove all accounts, statements and transactions. Rules are kept."""
    session.execute(delete(Transaction))
    session.execute(delete(Statement))
    session.execute(delete(Account))
    session.commit()


# ------------------------------------------------------------------ accounts

def _account_out(a: Account, stats: dict) -> dict:
    s = stats.get(a.id, {})
    return {"id": a.id, "name": a.name, "bank": a.bank, "number": a.number, "last4": a.last4, "holder": a.holder,
            "kind": a.kind, **s}


def _account_stats(session: Session) -> dict[int, dict]:
    stats: dict[int, dict] = {}
    rows = session.execute(select(Transaction.account_id, func.count(), func.min(Transaction.date), func.max(Transaction.date))
                           .group_by(Transaction.account_id)).all()
    for acct, n, first, last in rows:
        latest = session.scalars(select(Transaction.balance).where(Transaction.account_id == acct, Transaction.balance.is_not(None))
                                 .order_by(Transaction.date.desc(), Transaction.statement_id.desc(), Transaction.seq.desc()).limit(1)).first()
        stats[acct] = {"transactions": n, "first_date": first.isoformat() if first else None,
                       "last_date": last.isoformat() if last else None,
                       "balance": rupees(latest) if latest is not None else None}
    for acct, n in session.execute(select(Statement.account_id, func.count()).group_by(Statement.account_id)).all():
        stats.setdefault(acct, {})["statements"] = n
    return stats


@router.get("/accounts")
def list_accounts(session: Session = Depends(get_session)):
    stats = _account_stats(session)
    return [_account_out(a, stats) for a in session.scalars(select(Account).order_by(Account.id))]


@router.post("/accounts", status_code=201)
def create_account(body: AccountIn, session: Session = Depends(get_session)):
    a = Account(name=body.name.strip(), bank=body.bank, number=body.number, last4=(body.number or "")[-4:] or None)
    session.add(a)
    session.commit()
    return _account_out(a, {})


@router.patch("/accounts/{account_id}")
def update_account(account_id: int, body: AccountIn, session: Session = Depends(get_session)):
    a = session.get(Account, account_id)
    if not a:
        raise HTTPException(404, "Account not found")
    a.name = body.name.strip()
    if body.bank is not None:
        a.bank = body.bank or None
    session.flush()
    relabel_transfers(session)
    session.commit()
    return _account_out(a, _account_stats(session))


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, session: Session = Depends(get_session)):
    a = session.get(Account, account_id)
    if not a:
        raise HTTPException(404, "Account not found")
    _delete_transactions(session, Transaction.account_id == account_id)
    session.execute(delete(Statement).where(Statement.account_id == account_id))
    session.delete(a)
    session.flush()
    link_transfers(session)
    unify_entities(session)
    session.commit()
