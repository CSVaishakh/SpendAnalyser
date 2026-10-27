"""Cashflow analytics over stored transactions. Amounts are paise internally and rupees in the output."""

from __future__ import annotations

import datetime as dt
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..models import Transaction

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


@dataclass
class Filters:
    start: dt.date | None = None
    end: dt.date | None = None
    q: str | None = None
    direction: str | None = None  # "in" | "out"
    category: str | None = None
    channel: str | None = None
    entity: str | None = None
    account_id: int | None = None
    kind: str | None = None  # person | business
    app: str | None = None   # UPI app used to pay

    @property
    def combined(self) -> bool:
        """Looking at all accounts together: money moved between them is neither income nor spending."""
        return self.account_id is None


def rupees(paise: int | float) -> float:
    return round(paise / 100, 2)


def query(session: Session, f: Filters, *, dates_only: bool = False, flows_only: bool = False) -> list[Transaction]:
    """flows_only drops own-account transfers when viewing all accounts together."""
    stmt = select(Transaction).order_by(Transaction.date, Transaction.statement_id, Transaction.seq)
    if f.account_id is not None:
        stmt = stmt.where(Transaction.account_id == f.account_id)
    if flows_only and f.combined:
        stmt = stmt.where(Transaction.transfer_pair_id.is_(None))
    if f.start:
        stmt = stmt.where(Transaction.date >= f.start)
    if f.end:
        stmt = stmt.where(Transaction.date <= f.end)
    if not dates_only:
        if f.q:
            like = f"%{f.q.strip()}%"
            stmt = stmt.where(or_(Transaction.particulars.ilike(like), Transaction.entity.ilike(like),
                                  Transaction.category.ilike(like), Transaction.channel.ilike(like),
                                  Transaction.counterparty.ilike(like)))
        if f.direction == "out":
            stmt = stmt.where(Transaction.withdrawal > 0)
        elif f.direction == "in":
            stmt = stmt.where(Transaction.deposit > 0)
        if f.category:
            stmt = stmt.where(Transaction.category == f.category)
        if f.channel:
            stmt = stmt.where(Transaction.channel == f.channel)
        if f.entity:
            stmt = stmt.where(Transaction.entity == f.entity)
        if f.kind:
            stmt = stmt.where(Transaction.kind == f.kind)
        if f.app:
            stmt = stmt.where(Transaction.payer_app == f.app)
    return list(session.scalars(stmt))


def txn_out(t: Transaction) -> dict:
    return {
        "id": t.id, "date": t.date.isoformat(), "value_date": t.value_date.isoformat() if t.value_date else None,
        "particulars": t.particulars, "tran_type": t.tran_type, "cheque": t.cheque,
        "withdrawal": rupees(t.withdrawal), "deposit": rupees(t.deposit),
        "balance": rupees(t.balance) if t.balance is not None else None,
        "channel": t.channel, "entity": t.entity, "category": t.category, "counterparty": t.counterparty,
        "auto_entity": t.auto_entity, "rule_id": t.rule_id, "statement_id": t.statement_id,
        "account_id": t.account_id, "is_transfer": t.transfer_pair_id is not None,
        "kind": t.kind or "unknown", "kind_reason": t.kind_reason, "payer_app": t.payer_app,
    }


def month_key(d: dt.date) -> str:
    return f"{d.year}-{d.month:02d}"


def months_between(a: dt.date, b: dt.date) -> list[str]:
    out, y, m = [], a.year, a.month
    while (y, m) <= (b.year, b.month):
        out.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def bounds(session: Session) -> tuple[dt.date | None, dt.date | None]:
    return session.execute(select(func.min(Transaction.date), func.max(Transaction.date))).one()


def _span(f: Filters, rows: list[Transaction]) -> tuple[dt.date, dt.date] | None:
    if not rows and not (f.start and f.end):
        return None
    start = f.start or rows[0].date
    end = f.end or rows[-1].date
    return start, end


def _group_amounts(rows, key, attr) -> list[dict]:
    total = sum(getattr(t, attr) for t in rows) or 1
    groups: dict[str, list[int]] = defaultdict(list)
    for t in rows:
        groups[key(t)].append(getattr(t, attr))
    out = [{"name": k, "amount": rupees(sum(v)), "count": len(v), "share": round(sum(v) / total, 4)} for k, v in groups.items()]
    return sorted(out, key=lambda x: -x["amount"])


# ---------------------------------------------------------------- dashboard

def dashboard(session: Session, f: Filters) -> dict:
    period_rows = query(session, f, dates_only=True)
    rows = query(session, f, flows_only=True)
    span = _span(f, period_rows if not rows else rows)
    outs = [t for t in rows if t.withdrawal > 0]
    ins = [t for t in rows if t.deposit > 0]
    income, spend = sum(t.deposit for t in ins), sum(t.withdrawal for t in outs)

    balances = _balances(period_rows)
    opening = sum(a["opening"] for a in balances["accounts"]) if balances["accounts"] else None
    closing = sum(a["closing"] for a in balances["accounts"]) if balances["accounts"] else None
    moved = sum(t.withdrawal for t in period_rows if t.transfer_pair_id is not None) if f.combined else 0
    days = ((span[1] - span[0]).days + 1) if span else 0
    months = max(days / 30.44, 1) if days else 0

    previous = None
    if f.start and f.end:
        length = (f.end - f.start).days + 1
        pf = Filters(start=f.start - dt.timedelta(days=length), end=f.start - dt.timedelta(days=1), q=f.q,
                     category=f.category, channel=f.channel, entity=f.entity, direction=f.direction, account_id=f.account_id)
        prev = query(session, pf, flows_only=True)
        if prev:
            pi, ps = sum(t.deposit for t in prev), sum(t.withdrawal for t in prev)
            previous = {"income": rupees(pi), "spend": rupees(ps), "net": rupees(pi - ps),
                        "start": pf.start.isoformat(), "end": pf.end.isoformat()}

    month_list = months_between(*span) if span else []
    by_month: dict[str, list[int]] = {m: [0, 0] for m in month_list}
    for t in rows:
        mk = month_key(t.date)
        if mk in by_month:
            by_month[mk][0] += t.deposit
            by_month[mk][1] += t.withdrawal

    weekday = [[0, 0] for _ in range(7)]
    for t in outs:
        weekday[t.date.weekday()][0] += t.withdrawal
        weekday[t.date.weekday()][1] += 1

    payees = _group_amounts(outs, lambda t: t.entity, "withdrawal")
    cat_of = _dominant(outs, "category")
    for p in payees:
        p["category"] = cat_of.get(p["name"], "")

    return {
        "range": {"start": span[0].isoformat() if span else None, "end": span[1].isoformat() if span else None, "days": days},
        "kpis": {
            "income": rupees(income), "spend": rupees(spend), "net": rupees(income - spend),
            "savings_rate": round((income - spend) / income, 4) if income else None,
            "opening_balance": rupees(opening) if opening is not None else None,
            "closing_balance": rupees(closing) if closing is not None else None,
            "avg_monthly_spend": rupees(spend / months) if months else 0,
            "avg_monthly_income": rupees(income / months) if months else 0,
            "credits": len(ins), "debits": len(outs), "transactions": len(rows),
            "payees": len({t.entity for t in outs}), "previous": previous,
            "moved_between_accounts": rupees(moved),
        },
        "monthly": [{"month": m, "income": rupees(v[0]), "spend": rupees(v[1]), "net": rupees(v[0] - v[1])} for m, v in by_month.items()],
        "balance": balances["series"],
        "accounts": [{**a, "opening": rupees(a["opening"]), "closing": rupees(a["closing"]),
                      "income": rupees(a["income"]), "spend": rupees(a["spend"])} for a in balances["accounts"]],
        "categories": _group_amounts(outs, lambda t: t.category, "withdrawal"),
        "income_categories": _group_amounts(ins, lambda t: t.category, "deposit"),
        "channels": _group_amounts(outs, lambda t: t.channel, "withdrawal"),
        "top_payees": payees[:12],
        "top_sources": _group_amounts(ins, lambda t: t.entity, "deposit")[:8],
        "weekday": [{"day": WEEKDAYS[i], "amount": rupees(a), "count": c} for i, (a, c) in enumerate(weekday)],
        "largest": [txn_out(t) for t in sorted(outs, key=lambda t: -t.withdrawal)[:10]],
        "recurring": recurring(outs),
        "kinds": _kind_split(outs),
        "apps": _group_amounts([t for t in outs if t.payer_app], lambda t: t.payer_app, "withdrawal"),
        "top_people": _group_amounts([t for t in outs if t.kind == "person"], lambda t: t.entity, "withdrawal")[:8],
        "top_businesses": _group_amounts([t for t in outs if t.kind == "business"], lambda t: t.entity, "withdrawal")[:8],
    }


def _kind_split(outs: list[Transaction]) -> list[dict]:
    total = sum(t.withdrawal for t in outs) or 1
    labels = {"business": "Businesses", "person": "People", "cash": "Cash", "bank": "Bank charges",
              "self": "Own accounts", "unknown": "Unclassified"}
    groups: dict[str, list[Transaction]] = defaultdict(list)
    for t in outs:
        groups[t.kind or "unknown"].append(t)
    return sorted(({"kind": k, "name": labels.get(k, k), "amount": rupees(sum(t.withdrawal for t in g)), "count": len(g),
                    "payees": len({t.entity for t in g}), "share": round(sum(t.withdrawal for t in g) / total, 4)}
                   for k, g in groups.items()), key=lambda x: -x["amount"])


def _balances(rows: list[Transaction]) -> dict:
    """Per-account opening/closing balances and a combined end-of-day balance series.
    Each account starts at its balance before its first transaction in range, so an account whose
    statements start later doesn't show up as a sudden jump in the total."""
    by_acct: dict[int | None, list[Transaction]] = defaultdict(list)
    for t in rows:
        by_acct[t.account_id].append(t)
    current: dict[int | None, int] = {}
    summary = []
    for acct, ts in by_acct.items():
        with_bal = [t for t in ts if t.balance is not None]
        if not with_bal:
            continue
        first = with_bal[0]
        current[acct] = first.balance - first.deposit + first.withdrawal
        summary.append({
            "account_id": acct, "opening": current[acct], "closing": with_bal[-1].balance,
            "income": sum(t.deposit for t in ts), "spend": sum(t.withdrawal for t in ts),
            "first_date": ts[0].date.isoformat(), "last_date": ts[-1].date.isoformat(), "transactions": len(ts),
        })
    series: dict[str, dict] = {}
    for t in rows:
        if t.balance is None or t.account_id not in current:
            continue
        current[t.account_id] = t.balance
        series[t.date.isoformat()] = {"date": t.date.isoformat(), "balance": rupees(sum(current.values())),
                                      "by_account": {str(k): rupees(v) for k, v in current.items()}}
    return {"series": list(series.values()), "accounts": summary}


def _by(rows, key) -> dict:
    out: dict = defaultdict(list)
    for t in rows:
        out[key(t)].append(t)
    return out


def _dominant(rows: list[Transaction], attr: str) -> dict[str, str]:
    counts: dict[str, Counter] = defaultdict(Counter)
    for t in rows:
        counts[t.entity][getattr(t, attr)] += 1
    return {k: c.most_common(1)[0][0] for k, c in counts.items()}


def recurring(outs: list[Transaction]) -> list[dict]:
    """Payees paid in most months of their active span at a fairly steady amount: rent, EMIs, SIPs, subscriptions."""
    by_entity: dict[str, list[Transaction]] = defaultdict(list)
    for t in outs:
        by_entity[t.entity].append(t)
    out = []
    for name, ts in by_entity.items():
        months = sorted({month_key(t.date) for t in ts})
        if len(months) < 3 or name in ("Cash withdrawal", "Bank charges"):
            continue
        span = len(months_between(ts[0].date, ts[-1].date))
        if len(months) / span < 0.75:
            continue
        monthly_totals = [sum(t.withdrawal for t in ts if month_key(t.date) == m) for m in months]
        mean = statistics.mean(monthly_totals)
        cv = statistics.pstdev(monthly_totals) / mean if mean else 1
        per_month = len(ts) / len(months)
        if cv > 0.35 or per_month > 3:
            continue
        days = [t.date.day for t in ts]
        typical_day = int(statistics.median(days))
        last = ts[-1].date
        nxt_month = dt.date(last.year + (last.month == 12), last.month % 12 + 1, 1)
        try:
            next_due = nxt_month.replace(day=typical_day)
        except ValueError:
            next_due = nxt_month.replace(day=28)
        out.append({
            "name": name, "category": Counter(t.category for t in ts).most_common(1)[0][0],
            "monthly_amount": rupees(statistics.median(monthly_totals)), "months": len(months),
            "variability": round(cv, 3), "typical_day": typical_day, "last_date": last.isoformat(),
            "last_amount": rupees(ts[-1].withdrawal), "next_expected": next_due.isoformat(),
        })
    return sorted(out, key=lambda x: -x["monthly_amount"])


# ---------------------------------------------------------------- entities

def entities(session: Session, f: Filters, direction: str = "out", sort: str | None = None, order: str = "desc") -> list[dict]:
    rows = query(session, Filters(f.start, f.end, f.q, None, None, f.channel, None, f.account_id, f.kind), flows_only=True)
    total_out = sum(t.withdrawal for t in rows) or 1
    total_in = sum(t.deposit for t in rows) or 1
    groups: dict[str, list[Transaction]] = defaultdict(list)
    for t in rows:
        groups[t.entity].append(t)

    out = []
    for name, ts in groups.items():
        o = [t for t in ts if t.withdrawal > 0]
        i = [t for t in ts if t.deposit > 0]
        so, si = sum(t.withdrawal for t in o), sum(t.deposit for t in i)
        cat = Counter(t.category for t in ts).most_common(1)[0][0]
        if f.category and cat != f.category and not any(t.category == f.category for t in ts):
            continue
        if direction == "out" and not o or direction == "in" and not i:
            continue
        out.append({
            "name": name, "category": cat,
            "paid": rupees(so), "payments": len(o), "avg_payment": rupees(so / len(o)) if o else 0,
            "received": rupees(si), "receipts": len(i), "net": rupees(si - so),
            "share_out": round(so / total_out, 4), "share_in": round(si / total_in, 4),
            "first_date": ts[0].date.isoformat(), "last_date": ts[-1].date.isoformat(),
            "months_active": len({month_key(t.date) for t in ts}),
            "channels": sorted({t.channel for t in ts}),
            "accounts": sorted({t.account_id for t in ts if t.account_id is not None}),
            "kind": ts[0].kind or "unknown", "kind_reason": ts[0].kind_reason,
            "counterparties": sorted({t.counterparty for t in ts if t.counterparty})[:5],
        })
    default = {"out": "paid", "in": "received"}.get(direction, "total")
    key = sort or default
    if key == "total":
        out.sort(key=lambda e: e["paid"] + e["received"], reverse=order != "asc")
    else:
        out.sort(key=lambda e: (e.get(key) is None, e.get(key)), reverse=order != "asc")
    return out


def entity_detail(session: Session, name: str, f: Filters) -> dict | None:
    period = query(session, Filters(f.start, f.end, account_id=f.account_id), dates_only=True)
    ts = [t for t in period if t.entity == name]
    if not ts:
        return None
    o = [t for t in ts if t.withdrawal > 0]
    i = [t for t in ts if t.deposit > 0]
    so, si = sum(t.withdrawal for t in o), sum(t.deposit for t in i)
    total_out = sum(t.withdrawal for t in period if not (f.combined and t.transfer_pair_id)) or 1
    gaps = [(b.date - a.date).days for a, b in zip(o, o[1:])]
    span = _span(f, period)
    month_list = months_between(*span)
    by_month = {m: [0, 0, 0] for m in month_list}
    for t in ts:
        mk = month_key(t.date)
        if mk in by_month:
            by_month[mk][0] += t.withdrawal
            by_month[mk][1] += t.deposit
            by_month[mk][2] += 1

    variants = Counter(re.sub(r"\d{5,}", "…", re.sub(r"(?i)\d*X{3,}\d*", "…", t.particulars)) for t in ts)
    rec = next((r for r in recurring(o) if r["name"] == name), None)
    return {
        "name": name,
        "category": Counter(t.category for t in ts).most_common(1)[0][0],
        "kind": Counter(t.kind or "unknown" for t in ts).most_common(1)[0][0],
        "kind_reason": next((t.kind_reason for t in ts if t.kind_reason), None),
        "categories": dict(Counter(t.category for t in ts)),
        "channels": dict(Counter(t.channel for t in ts)),
        "auto_names": sorted({t.auto_entity for t in ts}),
        "counterparties": sorted({t.counterparty for t in ts if t.counterparty}),
        "stats": {
            "paid": rupees(so), "payments": len(o), "avg_payment": rupees(so / len(o)) if o else 0,
            "median_payment": rupees(statistics.median([t.withdrawal for t in o])) if o else 0,
            "largest_payment": rupees(max((t.withdrawal for t in o), default=0)),
            "received": rupees(si), "receipts": len(i), "net": rupees(si - so),
            "share_of_spend": round(so / total_out, 4),
            "first_date": ts[0].date.isoformat(), "last_date": ts[-1].date.isoformat(),
            "typical_gap_days": statistics.median(gaps) if gaps else None,
            "months_active": len({month_key(t.date) for t in ts}),
        },
        "recurring": rec,
        "by_account": sorted(
            ({"account_id": acct, "paid": rupees(sum(t.withdrawal for t in g)), "received": rupees(sum(t.deposit for t in g)),
              "count": len(g)} for acct, g in _by(ts, lambda t: t.account_id).items()),
            key=lambda x: -(x["paid"] + x["received"])),
        "monthly": [{"month": m, "paid": rupees(v[0]), "received": rupees(v[1]), "count": v[2]} for m, v in by_month.items()],
        "variants": [{"text": k, "count": c} for k, c in variants.most_common(10)],
        "transactions": [txn_out(t) for t in reversed(ts)],
    }
