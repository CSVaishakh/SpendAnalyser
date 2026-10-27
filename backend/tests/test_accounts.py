import sqlite3

from sqlalchemy import create_engine, inspect

HEADER = "Date,Details,Ref No/Cheque No,Debit,Credit,Balance\n"


def stmt(acct_line: str | None, rows: list[tuple]) -> bytes:
    pre = f"{acct_line}\n\n" if acct_line else ""
    body = "".join(f"{d},{p},,{w or ''},{c or ''},{b}\n" for d, p, w, c, b in rows)
    return (pre + HEADER + body).encode()


HDFC = stmt("HDFC BANK - Savings Account No : XXXXXXXX1111", [
    ("01-04-2026", "NEFT-ACME TECH-SALARY", None, 100000, 100000),
    ("02-04-2026", "UPI/1/SWIGGY/swiggy@icici", 500, None, 99500),
    ("05-04-2026", "IMPS/TRANSFER TO OWN SBI", 20000, None, 79500),
])
SBI = stmt("State Bank of India  A/C No: 00000002222", [
    ("01-04-2026", "OPENING DEPOSIT", None, 1000, 1000),
    ("06-04-2026", "BY TRANSFER-IMPS-FROM HDFC", None, 20000, 21000),
    ("08-04-2026", "UPI/9/ZOMATO/zomato@paytm", 300, None, 20700),
])


def up(client, data, name="s.csv", account_id=None):
    r = client.post("/api/statements", files=[("files", (name, data, "text/csv"))],
                    data={"account_id": str(account_id)} if account_id else None)
    return r.json()["results"][0]


def test_two_accounts_detected_and_transfer_linked(client):
    a, b = up(client, HDFC, "hdfc.csv"), up(client, SBI, "sbi.csv")
    assert a["account_created"] and b["account_created"] and a["account_id"] != b["account_id"]
    assert a["account_name"] == "HDFC Bank Savings ••1111" and b["account_name"] == "SBI ••2222"
    assert b["transfers_linked"] == 1
    accounts = client.get("/api/accounts").json()
    assert {x["balance"] for x in accounts} == {79500, 20700}

    combined = client.get("/api/dashboard").json()["kpis"]
    # The ₹20,000 hop between accounts is neither income nor spending when viewed together.
    assert combined["income"] == 101000 and combined["spend"] == 800
    assert combined["moved_between_accounts"] == 20000
    assert combined["closing_balance"] == 79500 + 20700

    hdfc = client.get("/api/dashboard", params={"account": a["account_id"]}).json()["kpis"]
    assert hdfc["spend"] == 20500 and hdfc["closing_balance"] == 79500
    cats = {c["name"] for c in client.get("/api/dashboard", params={"account": a["account_id"]}).json()["categories"]}
    assert "Self transfers" in cats

    # Transactions page totals match the dashboard by default; transfers are listed only when asked for.
    page = client.get("/api/transactions").json()
    assert (page["sum_withdrawal"], page["sum_deposit"]) == (combined["spend"], combined["income"])
    assert page["transfers_hidden"] == 2 and page["transfers_hidden_amount"] == 20000
    selfs = client.get("/api/transactions", params={"category": "Self transfers"}).json()
    assert selfs["total"] == 2 and selfs["sum_withdrawal"] == 20000
    txns = client.get("/api/transactions", params={"q": "TRANSFER", "transfers": "include"}).json()["items"]
    assert all(t["is_transfer"] for t in txns) and {t["entity"] for t in txns} == {"To SBI ••2222", "From HDFC Bank Savings ••1111"}


def test_combined_balance_series_sums_accounts(client):
    up(client, HDFC), up(client, SBI)
    series = client.get("/api/dashboard").json()["balance"]
    last = series[-1]
    assert last["balance"] == 79500 + 20700 and len(last["by_account"]) == 2


def test_statement_without_account_number(client):
    up(client, HDFC), up(client, SBI)
    later = stmt(None, [("10-04-2026", "UPI/3/UBER/uber@axis", 200, None, 20500)])
    r = up(client, later)
    assert r["status"] == "imported" and r["account_name"] == "SBI ••2222"  # opening balance continues SBI
    orphan = stmt(None, [("10-04-2026", "UPI/3/UBER/uber@axis", 200, None, 5)])
    r = up(client, orphan)
    assert r["status"] == "error" and "Pick the account" in r["message"]
    hdfc_id = next(a["id"] for a in client.get("/api/accounts").json() if a["last4"] == "1111")
    assert up(client, orphan, account_id=hdfc_id)["account_id"] == hdfc_id


def test_same_rows_in_two_accounts_are_not_duplicates(client):
    rows = [("01-04-2026", "UPI/1/TEA", 10, None, 90)]
    assert up(client, stmt("A/C No: XXXX1234", rows))["inserted"] == 1
    assert up(client, stmt("A/C No: XXXX9876", rows))["inserted"] == 1
    assert up(client, stmt("A/C No: XXXX9876", rows))["status"] == "duplicate"


def test_rename_and_delete_account_unlinks_transfers(client):
    a, b = up(client, HDFC), up(client, SBI)
    client.patch(f"/api/accounts/{b['account_id']}", json={"name": "SBI Salary"}).raise_for_status()
    names = {t["entity"] for t in client.get("/api/transactions", params={"account": a["account_id"]}).json()["items"]}  # single account: transfers shown
    assert "To SBI Salary" in names
    assert client.delete(f"/api/accounts/{b['account_id']}").status_code == 204
    left = client.get("/api/transactions").json()["items"]
    assert len(left) == 3 and not any(t["is_transfer"] for t in left)
    assert client.get("/api/dashboard").json()["kpis"]["spend"] == 20500


def test_migrates_pre_accounts_database(tmp_path):
    from app.db import Base
    from app.migrate import migrate

    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE statements (id INTEGER PRIMARY KEY, filename TEXT, sha256 TEXT, uploaded_at TEXT, period_start DATE,
          period_end DATE, rows_parsed INT, rows_inserted INT, rows_duplicate INT, rows_skipped INT, balance_checked INT,
          balance_mismatches INT, reversed_order BOOLEAN, warnings JSON);
        CREATE TABLE transactions (id INTEGER PRIMARY KEY, statement_id INT, seq INT, fingerprint TEXT UNIQUE, date DATE,
          value_date DATE, particulars TEXT, tran_type TEXT, cheque TEXT, withdrawal INT, deposit INT, balance INT,
          channel TEXT, counterparty TEXT, auto_entity TEXT, auto_category TEXT, entity TEXT, category TEXT, rule_id INT);
        INSERT INTO statements (id, filename) VALUES (1, 'old.csv');
        INSERT INTO transactions (id, statement_id, seq, fingerprint, date, particulars, withdrawal, deposit, channel,
          auto_entity, auto_category, entity, category) VALUES (1, 1, 0, 'abc', '2026-04-01', 'X', 100, 0, 'UPI', 'X', 'Other', 'X', 'Other');
    """)
    con.commit()
    con.close()
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    migrate(engine)
    migrate(engine)  # idempotent
    assert "account_id" in {c["name"] for c in inspect(engine).get_columns("transactions")}
    with engine.connect() as c:
        assert c.exec_driver_sql("SELECT name FROM accounts").scalar() == "Account 1"
        acct, fp = c.exec_driver_sql("SELECT account_id, fingerprint FROM transactions").one()
        assert acct == 1 and fp != "abc"


def test_same_person_across_accounts_is_one_payee(client):
    hdfc = stmt("HDFC BANK A/C No: XXXX1111", [
        ("01-04-2026", "UPI-RAHUL KUMAR MENON-rahulkm@oksbi-SBIN0001-412345678901-rent", 15000, None, 85000),
    ])
    sbi = stmt("State Bank of India A/C No: XXXX2222", [
        ("03-04-2026", "TO TRANSFER-UPI/DR/412345678902/RAHUL K/SBIN/rahulkm@oksbi/rent--", 5000, None, 45000),
        ("04-04-2026", "UPI/DR/412345678903/rahul kumar menon/SBIN/rahulkm@oksbi/x", 100, None, 44900),
    ])
    up(client, hdfc), up(client, sbi)
    ents = client.get("/api/entities", params={"direction": "out"}).json()
    rahul = [e for e in ents if "Rahul" in e["name"]]
    assert len(rahul) == 1 and rahul[0]["name"] == "Rahul Kumar Menon"
    assert rahul[0]["paid"] == 20100 and len(rahul[0]["accounts"]) == 2
    det = client.get("/api/entities/detail", params={"name": "Rahul Kumar Menon"}).json()
    assert [a["paid"] for a in det["by_account"]] == [15000, 5100]
