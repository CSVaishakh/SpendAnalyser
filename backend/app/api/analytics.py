import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Account, Statement, Transaction
from ..parsing.extract import CHANNELS
from ..parsing.merchants import CATEGORIES
from ..parsing.payer_app import APPS
from ..services import analytics as A
from .deps import filters

router = APIRouter(prefix="/api", tags=["analytics"])

TXN_SORT = {"date", "entity", "category", "channel", "withdrawal", "deposit", "balance", "particulars"}


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/meta")
def meta(session: Session = Depends(get_session)):
    first, last = A.bounds(session)
    used_cats = set(session.scalars(select(Transaction.category).distinct()))
    return {
        "first_date": first.isoformat() if first else None,
        "last_date": last.isoformat() if last else None,
        "transactions": session.scalar(select(func.count(Transaction.id))) or 0,
        "statements": session.scalar(select(func.count(Statement.id))) or 0,
        "accounts": [{"id": i, "name": n} for i, n in session.execute(select(Account.id, Account.name).order_by(Account.id))],
        "categories": sorted(used_cats | set(CATEGORIES), key=lambda c: (c not in used_cats, c)),
        "used_categories": sorted(used_cats),
        "channels": [c for c in CHANNELS if c in set(session.scalars(select(Transaction.channel).distinct()))],
        "entities": sorted(set(session.scalars(select(Transaction.entity).distinct())), key=str.casefold),
        "apps": [a for a in APPS
                 if a in set(session.scalars(select(Transaction.payer_app).distinct()))],
    }


@router.get("/dashboard")
def dashboard(f: A.Filters = Depends(filters), session: Session = Depends(get_session)):
    return A.dashboard(session, f)


@router.get("/transactions")
def transactions(
    f: A.Filters = Depends(filters),
    sort: str = Query("date"), order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
    transfers: str = Query("exclude", pattern="^(include|exclude)$",
                           description="Own-account transfers in the all-accounts view; excluded by default to match the dashboard"),
    session: Session = Depends(get_session),
):
    every = A.query(session, f)
    # Asking for the "Self transfers" category is asking to see them.
    hide = transfers == "exclude" and f.combined and f.category != "Self transfers"
    rows = [t for t in every if not (hide and t.transfer_pair_id is not None)]
    hidden = [t for t in every if hide and t.transfer_pair_id is not None]
    rows = _sorted(rows, sort, order)
    page_rows = rows[(page - 1) * page_size: page * page_size]
    return {"total": len(rows), "page": page, "page_size": page_size,
            "sum_withdrawal": A.rupees(sum(t.withdrawal for t in rows)), "sum_deposit": A.rupees(sum(t.deposit for t in rows)),
            "transfers_hidden": len(hidden), "transfers_hidden_amount": A.rupees(sum(t.withdrawal for t in hidden)),
            "items": [A.txn_out(t) for t in page_rows]}


def _sorted(rows, sort, order):
    if sort not in TXN_SORT:
        raise HTTPException(422, f"sort must be one of {sorted(TXN_SORT)}")
    if sort == "date":
        rows = list(rows)  # already in chronological order
    else:
        key = (lambda t: (getattr(t, sort) or "").casefold()) if sort in ("entity", "category", "channel", "particulars") \
            else (lambda t: getattr(t, sort) if getattr(t, sort) is not None else -1)
        rows = sorted(rows, key=key)
    return rows[::-1] if order == "desc" else rows


@router.get("/transactions/export")
def export_transactions(f: A.Filters = Depends(filters), transfers: str = Query("exclude", pattern="^(include|exclude)$"),
                        session: Session = Depends(get_session)):
    rows = A.query(session, f, flows_only=transfers == "exclude" and f.category != "Self transfers")
    names = dict(session.execute(select(Account.id, Account.name)).all())
    header = ["Date", "Account", "Paid with", "Value Date", "Payee", "Category", "Channel", "Particulars", "Tran Type", "Cheque Details",
              "Withdrawal", "Deposit", "Balance", "Counterparty"]
    data = [[t.date.isoformat(), names.get(t.account_id, ""), t.payer_app or "", t.value_date.isoformat() if t.value_date else "", t.entity, t.category, t.channel,
             t.particulars, t.tran_type, t.cheque, A.rupees(t.withdrawal) or "", A.rupees(t.deposit) or "",
             A.rupees(t.balance) if t.balance is not None else "", t.counterparty or ""] for t in rows]
    return _csv("transactions.csv", header, data)


@router.get("/entities")
def entities(
    f: A.Filters = Depends(filters), sort: str | None = None,
    order: str = Query("desc", pattern="^(asc|desc)$"), session: Session = Depends(get_session),
):
    return A.entities(session, f, f.direction or "all", sort, order)


@router.get("/entities/export")
def export_entities(f: A.Filters = Depends(filters), session: Session = Depends(get_session)):
    rows = A.entities(session, f, f.direction or "all")
    header = ["Payee", "Category", "Paid", "Payments", "Avg payment", "Received", "Receipts", "Net",
              "Months active", "First", "Last", "Channels", "Counterparties"]
    data = [[e["name"], e["category"], e["paid"], e["payments"], e["avg_payment"], e["received"], e["receipts"], e["net"],
             e["months_active"], e["first_date"], e["last_date"], "; ".join(e["channels"]), "; ".join(e["counterparties"])] for e in rows]
    return _csv("payees.csv", header, data)


@router.get("/entities/detail")
def entity_detail(name: str, f: A.Filters = Depends(filters), session: Session = Depends(get_session)):
    d = A.entity_detail(session, name, f)
    if d is None:
        raise HTTPException(404, "No transactions for this payee in the selected range")
    return d


def _csv(filename: str, header: list[str], rows: list[list]) -> StreamingResponse:
    buf = io.StringIO()
    buf.write("﻿")
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
