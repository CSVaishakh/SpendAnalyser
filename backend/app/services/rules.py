"""User rules that rename payees and override categories and types. Per field, the first matching rule (by position) wins."""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Rule, Transaction

FIELDS = ("any", "particulars", "entity")
CASH_WITHDRAWAL = "Cash withdrawal"
MODES = ("contains", "exact", "regex")


@dataclass
class CompiledRule:
    id: int
    field: str
    mode: str
    pattern: str
    set_entity: str | None
    set_category: str | None
    set_kind: str | None
    regex: re.Pattern[str] | None

    def matches(self, particulars: str, auto_entity: str) -> bool:
        targets = {"any": (particulars, auto_entity), "particulars": (particulars,), "entity": (auto_entity,)}[self.field]
        if self.mode == "regex":
            return any(self.regex.search(t) for t in targets)
        if self.mode == "exact":
            return any(t.casefold() == self.pattern.casefold() for t in targets)
        needle = self.pattern.casefold()
        return any(needle in t.casefold() for t in targets)


def validate(field: str, mode: str, pattern: str) -> None:
    if field not in FIELDS:
        raise ValueError(f"field must be one of {', '.join(FIELDS)}")
    if mode not in MODES:
        raise ValueError(f"match_mode must be one of {', '.join(MODES)}")
    if not pattern.strip():
        raise ValueError("pattern can't be empty")
    if mode == "regex":
        try:
            re.compile(pattern)
        except re.error as e:
            raise ValueError(f"Invalid regular expression: {e}") from e


def load_compiled(session: Session) -> list[CompiledRule]:
    rules = session.scalars(select(Rule).order_by(Rule.position, Rule.id)).all()
    out = []
    for r in rules:
        if not (r.set_entity or r.set_category or r.set_kind):
            continue
        out.append(CompiledRule(r.id, r.field, r.match_mode, r.pattern, r.set_entity or None, r.set_category or None, r.set_kind or None,
                                re.compile(r.pattern, re.I) if r.match_mode == "regex" else None))
    return out


def apply_rules(txn: Transaction, rules: list[CompiledRule]) -> None:
    """Each field (payee, category, type) comes from the highest-priority matching rule that sets it, so a rule that
    only sets the type doesn't cancel another rule's category. rule_id records the top matching rule."""
    txn.entity, txn.category, txn.rule_id, txn.kind_override = txn.auto_entity, txn.auto_category, None, None
    entity = category = kind = None
    for r in rules:
        if not r.matches(txn.particulars, txn.auto_entity):
            continue
        if txn.rule_id is None:
            txn.rule_id = r.id
        entity = entity or r.set_entity
        category = category or r.set_category
        kind = kind or r.set_kind
        if entity and category and kind:
            break
    if entity:
        txn.entity = entity
    if category:
        txn.category = category
    if kind:
        txn.kind_override = kind
    # Every cash withdrawal lives under one payee, however it was detected or marked.
    if txn.withdrawal > 0 and (txn.category == "Cash" or txn.kind_override == "cash"):
        txn.entity, txn.category = CASH_WITHDRAWAL, "Cash"


def reapply_all(session: Session) -> int:
    from .entities import finalize_kinds

    rules = load_compiled(session)
    changed = 0
    txns = list(session.scalars(select(Transaction)))
    before = {t.id: (t.entity, t.category, t.kind) for t in txns}
    for txn in txns:
        apply_rules(txn, rules)
    finalize_kinds(session, txns)
    for t in txns:
        changed += before[t.id] != (t.entity, t.category, t.kind)
    return changed
