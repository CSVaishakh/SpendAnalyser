"""Which account a statement belongs to, and transfers between the user's own accounts."""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..migrate import account_fingerprint
from ..models import Account, Transaction
from ..parsing.extract import extract
from ..parsing.statement import ParsedStatement
from .rules import apply_rules, load_compiled

TRANSFER_WINDOW_DAYS = 3
# Only bank-to-bank movements can be transfers between your accounts; cash in or out never is.
TRANSFER_CHANNELS = {"UPI", "IMPS", "NEFT", "RTGS", "Account transfer", "Cheque", "Other"}


@dataclass
class Resolution:
    account: Account | None
    created: bool = False
    how: str = ""          # explanation shown to the user
    error: str | None = None


def _paise(d) -> int:
    return int((d * 100).to_integral_value())


def resolve_account(session: Session, parsed: ParsedStatement, account_id: int | None) -> Resolution:
    if account_id is not None:
        acct = session.get(Account, account_id)
        return Resolution(acct, how="chosen at upload") if acct else Resolution(None, error="That account no longer exists.")

    hint = parsed.account
    accounts = list(session.scalars(select(Account).order_by(Account.id)))

    if hint.found:
        same = [a for a in accounts if a.last4 == hint.last4]
        if hint.bank:
            same = [a for a in same if not a.bank or a.bank == hint.bank] or []
        if same:
            return Resolution(same[0], how=f"matched account number ending {hint.last4}")
        acct = Account(name=hint.label(), bank=hint.bank, number=hint.number, last4=hint.last4, holder=hint.holder, kind=hint.kind)
        session.add(acct)
        session.flush()
        return Resolution(acct, created=True, how=f"new account detected from the statement (number ending {hint.last4})")

    # No account number in the file: look for an account this statement continues or overlaps.
    if accounts:
        best = _match_by_overlap(session, parsed, accounts) or _match_by_balance(session, parsed, accounts)
        if best:
            return Resolution(best[0], how=best[1])
    if not accounts:
        acct = Account(name=hint.label() if hint.bank else "Account 1", bank=hint.bank, holder=hint.holder, kind=hint.kind)
        session.add(acct)
        session.flush()
        return Resolution(acct, created=True, how="first account")
    if len(accounts) == 1:
        return Resolution(accounts[0], how="only account (no account number found in the file)")
    return Resolution(None, error="Couldn't tell which account this statement is for: the file has no account number and "
                                  "doesn't continue any existing account. Pick the account in the upload box and upload it again.")


def _match_by_overlap(session, parsed, accounts) -> tuple[Account, str] | None:
    sample = [t.fingerprint for t in parsed.transactions[:200]]
    best, best_n = None, 0
    for a in accounts:
        fps = [account_fingerprint(a.id, f) for f in sample]
        n = session.scalar(select(func.count()).select_from(Transaction).where(Transaction.account_id == a.id, Transaction.fingerprint.in_(fps))) or 0
        if n > best_n:
            best, best_n = a, n
    return (best, "overlaps transactions already imported for this account") if best else None


def _match_by_balance(session, parsed, accounts) -> tuple[Account, str] | None:
    first = next((t for t in parsed.transactions if t.balance is not None), None)
    if first is None:
        return None
    opening = _paise(first.balance) - _paise(first.deposit) + _paise(first.withdrawal)
    for a in accounts:
        prev = session.scalars(
            select(Transaction).where(Transaction.account_id == a.id, Transaction.date <= first.date, Transaction.balance.is_not(None))
            .order_by(Transaction.date.desc(), Transaction.statement_id.desc(), Transaction.seq.desc()).limit(1)
        ).first()
        if prev is not None and prev.balance == opening:
            return a, "opening balance continues this account"
    return None


# ------------------------------------------------------------------ own-account transfers

def reset_auto(txn: Transaction) -> None:
    ex = extract(txn.particulars, txn.tran_type, txn.cheque, is_debit=txn.withdrawal > 0)
    txn.auto_entity, txn.auto_category = ex.entity[:160], ex.category


def link_transfers(session: Session) -> int:
    """Pair a debit in one account with a credit of the same amount in another of your accounts within a few days.
    Paired legs become "Self transfers" so combined totals don't count the money twice."""
    names = dict(session.execute(select(Account.id, Account.name)).all())
    if len(names) < 2:
        return 0
    open_ = list(session.scalars(select(Transaction).where(Transaction.transfer_pair_id.is_(None)).order_by(Transaction.date)))
    credits: dict[int, list[Transaction]] = defaultdict(list)
    open_ = [t for t in open_ if t.channel in TRANSFER_CHANNELS]
    for t in open_:
        if t.deposit > 0:
            credits[t.deposit].append(t)

    rules = load_compiled(session)
    linked = 0
    taken: set[int] = set()
    for d in open_:
        if d.withdrawal <= 0 or d.id in taken:
            continue
        window = dt.timedelta(days=TRANSFER_WINDOW_DAYS)
        cands = [c for c in credits.get(d.withdrawal, ())
                 if c.id not in taken and c.account_id != d.account_id and abs(c.date - d.date) <= window]
        if not cands:
            continue
        c = min(cands, key=lambda c: (abs((c.date - d.date).days), c.id))
        taken.update((c.id, d.id))
        d.transfer_pair_id, c.transfer_pair_id = c.id, d.id
        d.auto_entity, d.auto_category = f"To {names.get(c.account_id, 'own account')}"[:160], "Self transfers"
        c.auto_entity, c.auto_category = f"From {names.get(d.account_id, 'own account')}"[:160], "Self transfers"
        apply_rules(d, rules)
        apply_rules(c, rules)
        linked += 1
    return linked


def unlink_transfers(session: Session, txn_ids: set[int]) -> None:
    """Before deleting transactions, restore their partners in other accounts to ordinary transactions."""
    if not txn_ids:
        return
    rules = load_compiled(session)
    for p in session.scalars(select(Transaction).where(Transaction.transfer_pair_id.in_(txn_ids))):
        p.transfer_pair_id = None
        reset_auto(p)
        apply_rules(p, rules)


def relabel_transfers(session: Session) -> None:
    """Account renamed: refresh the "To/From <account>" names on paired legs."""
    names = dict(session.execute(select(Account.id, Account.name)).all())
    by_id = {t.id: t for t in session.scalars(select(Transaction).where(Transaction.transfer_pair_id.is_not(None)))}
    rules = load_compiled(session)
    for t in by_id.values():
        other = by_id.get(t.transfer_pair_id)
        if other is None:
            continue
        label = names.get(other.account_id, "own account")
        t.auto_entity = (f"To {label}" if t.withdrawal > 0 else f"From {label}")[:160]
        apply_rules(t, rules)
