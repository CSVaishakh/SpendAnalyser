"""Minimal in-place schema upgrades for existing local databases (SQLite has no automatic column migrations)."""

from __future__ import annotations

import hashlib

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def account_fingerprint(account_id: int, statement_fingerprint: str) -> str:
    """Identical rows in two different accounts are different transactions."""
    return hashlib.sha1(f"{account_id}|{statement_fingerprint}".encode()).hexdigest()


# Columns added after the first release: (table, column, DDL). Applied when missing, so upgrades are repeatable.
ADDED_COLUMNS = [
    ("transactions", "auto_kind", "VARCHAR(16)"),
    ("transactions", "kind_override", "VARCHAR(16)"),
    ("transactions", "kind", "VARCHAR(16)"),
    ("transactions", "kind_reason", "VARCHAR(40)"),
    ("rules", "set_kind", "VARCHAR(16)"),
    ("transactions", "payer_app", "VARCHAR(24)"),
]


def migrate(engine: Engine) -> bool:
    """Returns True when derived fields need recomputing for existing rows."""
    insp = inspect(engine)
    if "transactions" not in insp.get_table_names():
        return False
    cols = {c["name"] for c in insp.get_columns("transactions")}
    if "account_id" not in cols:
        _add_accounts(engine)
    backfill = False
    with engine.begin() as conn:
        for table, col, ddl in ADDED_COLUMNS:
            if col not in {c["name"] for c in inspect(conn).get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
                backfill = backfill or table == "transactions"
        if not backfill:
            backfill = bool(conn.execute(text("SELECT 1 FROM transactions WHERE kind IS NULL LIMIT 1")).first())
    return backfill


def _add_accounts(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE statements ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE"))
        conn.execute(text("ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE"))
        conn.execute(text("ALTER TABLE transactions ADD COLUMN transfer_pair_id INTEGER"))
        if conn.execute(text("SELECT COUNT(*) FROM statements")).scalar():
            # Everything imported before accounts existed belonged to a single account.
            acct = conn.execute(text("INSERT INTO accounts (name) VALUES ('Account 1')")).lastrowid
            conn.execute(text("UPDATE statements SET account_id = :a"), {"a": acct})
            conn.execute(text("UPDATE transactions SET account_id = :a"), {"a": acct})
            for tid, fp in conn.execute(text("SELECT id, fingerprint FROM transactions")).all():
                conn.execute(text("UPDATE transactions SET fingerprint = :f WHERE id = :i"), {"f": account_fingerprint(acct, fp), "i": tid})
