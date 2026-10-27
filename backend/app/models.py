from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class AppMeta(Base):
    __tablename__ = "app_meta"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    bank: Mapped[str | None] = mapped_column(String(80))
    number: Mapped[str | None] = mapped_column(String(40))  # as printed on the statement, often masked
    last4: Mapped[str | None] = mapped_column(String(4), index=True)
    holder: Mapped[str | None] = mapped_column(String(120))
    kind: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())


class Statement(Base):
    __tablename__ = "statements"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    uploaded_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    period_start: Mapped[dt.date | None] = mapped_column(Date)
    period_end: Mapped[dt.date | None] = mapped_column(Date)
    rows_parsed: Mapped[int] = mapped_column(Integer, default=0)
    rows_inserted: Mapped[int] = mapped_column(Integer, default=0)
    rows_duplicate: Mapped[int] = mapped_column(Integer, default=0)
    rows_skipped: Mapped[int] = mapped_column(Integer, default=0)
    balance_checked: Mapped[int] = mapped_column(Integer, default=0)
    balance_mismatches: Mapped[int] = mapped_column(Integer, default=0)
    reversed_order: Mapped[bool] = mapped_column(Boolean, default=False)
    warnings: Mapped[list] = mapped_column(JSON, default=list)

    transactions: Mapped[list[Transaction]] = relationship(back_populates="statement", cascade="all, delete-orphan", passive_deletes=True)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (Index("ix_txn_order", "date", "statement_id", "seq"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    statement_id: Mapped[int] = mapped_column(ForeignKey("statements.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    # The matching leg when money moved between two of your own accounts.
    transfer_pair_id: Mapped[int | None] = mapped_column(Integer, index=True)
    seq: Mapped[int] = mapped_column(Integer)
    fingerprint: Mapped[str] = mapped_column(String(40), unique=True)

    date: Mapped[dt.date] = mapped_column(Date, index=True)
    value_date: Mapped[dt.date | None] = mapped_column(Date)
    particulars: Mapped[str] = mapped_column(Text)
    tran_type: Mapped[str] = mapped_column(String(32), default="")
    cheque: Mapped[str] = mapped_column(String(64), default="")
    # Money is stored in paise to keep sums exact.
    withdrawal: Mapped[int] = mapped_column(Integer, default=0)
    deposit: Mapped[int] = mapped_column(Integer, default=0)
    balance: Mapped[int | None] = mapped_column(Integer)

    channel: Mapped[str] = mapped_column(String(32))
    counterparty: Mapped[str | None] = mapped_column(String(128))
    auto_entity: Mapped[str] = mapped_column(String(160))
    auto_category: Mapped[str] = mapped_column(String(64))
    entity: Mapped[str] = mapped_column(String(160), index=True)
    category: Mapped[str] = mapped_column(String(64), index=True)
    rule_id: Mapped[int | None] = mapped_column(ForeignKey("rules.id", ondelete="SET NULL"))
    # person / business / self / cash / bank / unknown. auto_kind is this row's own evidence; kind is the payee-level
    # verdict (see services/entities.finalize_kinds); kind_override comes from a user rule.
    auto_kind: Mapped[str | None] = mapped_column(String(16))
    kind_override: Mapped[str | None] = mapped_column(String(16))
    kind: Mapped[str | None] = mapped_column(String(16), index=True)
    kind_reason: Mapped[str | None] = mapped_column(String(40))
    payer_app: Mapped[str | None] = mapped_column(String(24), index=True)  # UPI app used for an outgoing payment

    statement: Mapped[Statement] = relationship(back_populates="transactions")


class Rule(Base):
    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    position: Mapped[int] = mapped_column(Integer, default=0, index=True)
    field: Mapped[str] = mapped_column(String(16), default="any")        # any | particulars | entity
    match_mode: Mapped[str] = mapped_column(String(16), default="contains")  # contains | exact | regex
    pattern: Mapped[str] = mapped_column(String(500))
    set_entity: Mapped[str | None] = mapped_column(String(160))
    set_category: Mapped[str | None] = mapped_column(String(64))
    set_kind: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
