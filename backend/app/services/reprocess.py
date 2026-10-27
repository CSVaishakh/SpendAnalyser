"""Re-derive everything computed from narrations, after the parser improves. Statements, rules and accounts stay."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AppMeta, Transaction
from ..parsing import PARSER_VERSION
from ..parsing.extract import extract
from ..parsing.payer_app import detect_payer_app
from .accounts import link_transfers
from .entities import unify_entities
from .rules import reapply_all


def needs_reprocess(session: Session) -> bool:
    row = session.get(AppMeta, "parser_version")
    has_data = session.scalar(select(Transaction.id).limit(1)) is not None
    return has_data and (row is None or row.value != str(PARSER_VERSION))


def mark_current(session: Session) -> None:
    row = session.get(AppMeta, "parser_version")
    if row is None:
        session.add(AppMeta(key="parser_version", value=str(PARSER_VERSION)))
    else:
        row.value = str(PARSER_VERSION)


def reprocess_all(session: Session) -> int:
    txns = list(session.scalars(select(Transaction)))
    for t in txns:
        ex = extract(t.particulars, t.tran_type, t.cheque, is_debit=t.withdrawal > 0)
        t.channel, t.counterparty = ex.channel, (ex.counterparty or None) and ex.counterparty[:128]
        t.auto_entity, t.auto_category = ex.entity[:160], ex.category
        t.payer_app = detect_payer_app(t.particulars, t.channel, t.withdrawal > 0)
        t.transfer_pair_id = None
    session.flush()
    link_transfers(session)
    unify_entities(session)
    reapply_all(session)
    mark_current(session)
    return len(txns)
