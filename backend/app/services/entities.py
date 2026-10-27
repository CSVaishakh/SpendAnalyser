"""Make one payee look like one payee across accounts and banks.

Banks print the same counterparty differently ("RAHUL KUMAR" at HDFC, "RAHUL K" at SBI), but the UPI ID is the
same. Detected names are unified by UPI ID first, then by a case/spacing-insensitive key."""

from __future__ import annotations

import re
from collections import Counter, defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Transaction
from ..parsing.extract import extract
from ..parsing.kind import classify
from .rules import apply_rules, load_compiled


def _name_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.casefold())


def _is_handle_like(name: str) -> bool:
    return "@" in name


def _best(names: Counter) -> str:
    # Prefer a real name over a raw UPI ID, then the longest (least truncated), then the most frequent.
    return max(names, key=lambda n: (not _is_handle_like(n), len(n.split()), names[n], len(n)))


def unify_entities(session: Session) -> int:
    txns = [t for t in session.scalars(select(Transaction).where(Transaction.transfer_pair_id.is_(None)))]
    # Start from what the narration says on its own, so unification is repeatable after deletes.
    original = {t.id: extract(t.particulars, t.tran_type, t.cheque, is_debit=t.withdrawal > 0).entity[:160] for t in txns}

    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        parent[find(a)] = find(b)

    # A name seen with many different UPI IDs is generic ("Payment", a truncated note): linking through it would
    # chain unrelated payees together, so only link handles through names that look specific.
    handles_per_name: dict[str, set[str]] = defaultdict(set)
    for t in txns:
        cp = (t.counterparty or "").lower()
        if "@" in cp:
            handles_per_name[_name_key(original[t.id])].add(cp)
    for t in txns:
        key = _name_key(original[t.id])
        name_node = "n:" + key
        find(name_node)
        cp = (t.counterparty or "").lower()
        specific = len(key) >= 4 and len(handles_per_name[key]) <= 3 and "@" not in original[t.id]
        if "@" in cp and specific:
            union(name_node, "h:" + cp)

    groups: dict[str, Counter] = defaultdict(Counter)
    for t in txns:
        groups[find("n:" + _name_key(original[t.id]))][original[t.id]] += 1
    canonical = {root: _best(c) for root, c in groups.items()}

    rules = load_compiled(session)
    changed = 0
    for t in txns:
        target = canonical[find("n:" + _name_key(original[t.id]))]
        if t.auto_entity != target:
            t.auto_entity = target
            before = (t.entity, t.category)
            apply_rules(t, rules)
            changed += before != (t.entity, t.category)
    finalize_kinds(session)
    return changed


def row_kind(t: Transaction) -> None:
    t.auto_kind, t.kind_reason = classify(t.particulars, t.channel, t.auto_entity, t.counterparty, t.auto_category)


def is_cash_category(ts: list[Transaction]) -> bool:
    return sum(t.category == "Cash" for t in ts) * 2 > len(ts)


def finalize_kinds(session: Session, txns: list[Transaction] | None = None) -> None:
    """Classify each payee as a whole. One card swipe or merchant UPI payment to a payee is strong evidence it's a
    shop, so business evidence on any row wins over person-looking rows; a user rule wins over everything."""
    if txns is None:
        txns = list(session.scalars(select(Transaction)))
    by_entity: dict[str, list[Transaction]] = defaultdict(list)
    for t in txns:
        row_kind(t)  # cheap, and its inputs change after merges and transfer pairing
        by_entity[t.entity].append(t)
    for ts in by_entity.values():
        override = next((t.kind_override for t in ts if t.kind_override), None)
        kinds = Counter(t.auto_kind for t in ts)
        if is_cash_category(ts):
            verdict, reason = "cash", "category is Cash"  # fixed: the Cash category always means a cash payee
        elif override:
            verdict, reason = override, "set by you"
        elif kinds["business"]:
            verdict, reason = "business", next(t.kind_reason for t in ts if t.auto_kind == "business")
        elif kinds["person"]:
            verdict, reason = "person", next(t.kind_reason for t in ts if t.auto_kind == "person")
        else:
            verdict, reason = None, None
        for t in ts:
            if t.auto_kind in ("cash", "bank", "self") and not override:
                t.kind = t.auto_kind  # never roll these up into a payee verdict
            else:
                t.kind = verdict or t.auto_kind or "unknown"
                if verdict:
                    t.kind_reason = reason
