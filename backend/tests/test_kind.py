import pytest

from app.parsing.extract import extract
from app.parsing.kind import classify
from tests.test_accounts import stmt, up


def kind_of(narration: str, debit: bool = True) -> str:
    e = extract(narration, "", "", debit)
    return classify(narration, e.channel, e.entity, e.counterparty, e.category)[0]


@pytest.mark.parametrize("narration,expected", [
    # People
    ("UPI/DR/412345678901/RAHUL K/SBIN/rahulk@oksbi/Payment from Ph", "person"),
    ("UPI-SURESH BABU-9876543210@ybl-YESB0YBLUPI-412345678901-PAYMENT", "person"),
    ("IMPS/P2A/412345678901/ANITHA R/HDFC/rent", "person"),
    ("UPI OUT/412345678901/9895012345@paytm/NA", "person"),
    ("MMT/IMPS/412345678901/JOHN DOE/SBIN0001234", "person"),
    # Businesses
    ("POS 416021XXXXXX1234 SREE KRISHNA STORES KOCHI", "business"),     # card swipe
    ("POS XXXXXXXX4821 LOCAL STORE THRISSUR", "business"),
    ("UPI/P2M/412345678901/CHAI POINT/Pay to merchant", "business"),
    ("UPI/412345678901/RAJU/paytmqr2810050501011abc@paytm/PYTM", "business"),   # merchant QR
    ("UPI/412345678901/MANOJ/bharatpe.9000123456@fbpe/FDRL", "business"),
    ("UPI/412345678901/Q123456789@ybl/PAYMENT/YESB", "business"),
    ("UPI/1/SWIGGY/swiggy@icici/HDFC/Payment", "business"),               # known merchant
    ("NEFT/N123456789/MEGHA TRADERS/KKBK0000123", "business"),            # business word
    ("UPI/412345678901/ST JOSEPHS HOSPITAL/sjh@sbi/SBIN", "business"),
    ("ACH/D- TP ACH ICICIPRULIFE-12345", "business"),                     # auto-debit
    ("BIL/ONL/12345678/KSEB/ELECTRICITY BILL", "business"),
    ("NEFT CR-SBIN0000123-ACME TECHNOLOGIES PRIVATE LIMITED-SALARY APR", "business"),
    # Neither
    ("ATM WDL/123456/KAKKANAD", "cash"),
    ("SMS ALERT CHRGS QTR INCL GST", "bank"),
    ("TO SELF/XXXX1234", "self"),
])
def test_classify(narration, expected):
    assert kind_of(narration) == expected


def test_payee_with_one_card_swipe_is_a_business(client):
    # Ramesh takes UPI on a personal ID but also has a card machine: the card payment decides it.
    up(client, stmt("A/C No: XXXX1111", [
        ("01-04-2026", "UPI/1/RAMESH STORES/ramesh123@okaxis/x", 200, None, 9800),
        ("02-04-2026", "UPI/2/RAMESH STORES/ramesh123@okaxis/x", 300, None, 9500),
        ("03-04-2026", "POS 416021XXXXXX1234 RAMESH STORES", 150, None, 9350),
        ("04-04-2026", "UPI/3/PRIYA NAIR/priya@okhdfcbank/dinner", 500, None, 8850),
    ]))
    ents = {e["name"]: e for e in client.get("/api/entities").json()}
    assert ents["Ramesh Stores"]["kind"] == "business" and ents["Priya Nair"]["kind"] == "person"
    kinds = {k["kind"]: k["amount"] for k in client.get("/api/dashboard").json()["kinds"]}
    assert kinds == {"business": 650, "person": 500}
    people = client.get("/api/entities", params={"kind": "person"}).json()
    assert [e["name"] for e in people] == ["Priya Nair"]


def test_mark_known_shop_as_business(client):
    up(client, stmt("A/C No: XXXX1111", [
        ("01-04-2026", "UPI/1/GOPALAN/gopalan55@okaxis/veg", 120, None, 9880),
        ("05-04-2026", "UPI/2/GOPALAN/gopalan55@okaxis/veg", 80, None, 9800),
    ]))
    assert client.get("/api/entities").json()[0]["kind"] == "person"
    client.post("/api/entities/rename", json={"name": "Gopalan", "new_name": "Gopalan Vegetables", "kind": "business"}).raise_for_status()
    e = client.get("/api/entities").json()[0]
    assert e["name"] == "Gopalan Vegetables" and e["kind"] == "business" and e["kind_reason"] == "set by you"
    # A plain rule works too, e.g. for a list of shops you know.
    client.post("/api/rules", json={"pattern": "priya@", "set_kind": "business"}).raise_for_status()
    up(client, stmt("A/C No: XXXX1111", [("06-04-2026", "UPI/3/PRIYA/priya@okhdfcbank/cake", 900, None, 8900)]))
    assert {e["name"]: e["kind"] for e in client.get("/api/entities").json()}["Priya"] == "business"


@pytest.mark.parametrize("narration,debit,entity,category,kind", [
    ("UPIOUT/601234567890/qr.mc1@sib/Paid via Supe/8299", True, "qr.mc1@sib", "Education", "business"),
    ("UPIOUT/601234567891/bhqr.1234567890a@sib/Paid v/5812", True, "bhqr.1234567890a@sib", "Food & dining", "business"),
    ("UPIOUT/601234567892/q199284223@ybl/Paid via /5411", True, "q199284223@ybl", "Groceries", "business"),
    ("UPIOUT/601234567893/ibkpos.ep051996@icici/Pa/5411", True, "ibkpos.ep051996@icici", "Groceries", "business"),
    ("UPIOUT/601234567894/sindhu.joy@cnrb/Pai/0000", True, "Sindhu Joy", "Transfers out", "person"),
    ("UPIOUT/601234567895/tinsee007@oksbi/UP/0000", True, "Tinsee", "Transfers out", "person"),
    ("UPI IN/601234567896/manideepa2003@okicici/UP/0000", False, "Manideepa", "Transfers in", "person"),
    ("UPI IN/601234567897/9876543210@upi/0000", False, "9876543210@upi", "Transfers in", "person"),
    ("UPIOUT/601234567898/hotel.mess@sbi/Paid via/7011", True, "Hotel Mess", "Hotels & lodging", "business"),
])
def test_federal_upi_format_with_merchant_codes(narration, debit, entity, category, kind):
    e = extract(narration, "", "", debit)
    assert (e.channel, e.entity, e.category) == ("UPI", entity, category)
    assert classify(narration, e.channel, e.entity, e.counterparty, e.category)[0] == kind


def test_truncated_notes_do_not_chain_unrelated_payees(client):
    # Regression: "Pa"/"UP" notes used to become the payee name and merge every UPI ID that shared them.
    up(client, stmt("Federal A/C No: XXXX3636", [
        ("01-04-2026", "UPIOUT/601/ibkpos.ep051996@icici/Pa/5411", 100, None, 9900),
        ("02-04-2026", "UPIOUT/602/ugm.64064807@hdfcbank/Pa/7832", 200, None, 9700),
        ("03-04-2026", "UPIOUT/603/tinsee007@oksbi/UP/0000", 300, None, 9400),
        ("04-04-2026", "UPIOUT/604/ars.rahul.san@oksbi/UPI/0000", 400, None, 9000),
        ("05-04-2026", "UPI IN/605/ars.rahul.san@okaxis/UPI/0000", None, 50, 9050),
    ]))
    names = {e["name"] for e in client.get("/api/entities", params={"direction": "out"}).json()}
    assert len(names) == 4, names


def test_reprocess_fixes_rows_parsed_by_an_older_parser(client):
    from sqlalchemy import select

    from app.db import get_session
    from app.main import app
    from app.models import AppMeta, Transaction
    from app.services.reprocess import needs_reprocess, reprocess_all

    up(client, stmt("Federal A/C No: XXXX3636", [("01-04-2026", "UPIOUT/601/qr.mc1@sib/Paid via Supe/8299", 35, None, 965)]))
    session = next(app.dependency_overrides[get_session]())
    t = session.scalars(select(Transaction)).one()
    t.auto_entity, t.auto_category = "Paid v", "Transfers out"   # what the old parser stored
    session.get(AppMeta, "parser_version").value = "1"
    session.commit()
    assert needs_reprocess(session)
    reprocess_all(session)
    session.commit()
    assert (t.entity, t.category, t.kind) == ("qr.mc1@sib", "Education", "business")
    assert not needs_reprocess(session)


def test_mark_unclassified_payee_as_cash(client):
    # e.g. a UPI payment to a cash agent or a friend who handed over cash
    up(client, stmt("A/C No: XXXX1111", [("01-04-2026", "UPI/1/X7K2/x7k2@upi/cash", 500, None, 9500)]))
    name = client.get("/api/entities").json()[0]["name"]
    r = client.post("/api/entities/rename", json={"name": name, "kind": "cash"}).json()
    assert r["name"] == "Cash withdrawal"   # the payee panel follows it there
    e = client.get("/api/entities").json()[0]
    assert (e["name"], e["category"], e["kind"]) == ("Cash withdrawal", "Cash", "cash")  # grouped with all cash
    assert {k["kind"]: k["name"] for k in client.get("/api/dashboard").json()["kinds"]} == {"cash": "Cash"}
    assert client.post("/api/rules", json={"pattern": "zz", "set_kind": "cash"}).status_code == 201
    assert client.post("/api/rules", json={"pattern": "zz", "set_kind": "bogus"}).status_code == 422


def test_cash_category_locks_type_to_cash(client):
    up(client, stmt("A/C No: XXXX1111", [("01-04-2026", "UPIOUT/601/q123456789@ybl/Paid via/5411", 500, None, 9500)]))
    name = client.get("/api/entities").json()[0]["name"]
    assert client.get("/api/entities").json()[0]["kind"] == "business"   # merchant code says so...
    client.post("/api/entities/rename", json={"name": name, "category": "Cash"}).raise_for_status()
    e = client.get("/api/entities").json()[0]
    # ...but you filed it as cash: it joins Cash withdrawal and its type is fixed.
    assert (e["name"], e["category"], e["kind"], e["kind_reason"]) == ("Cash withdrawal", "Cash", "cash", "category is Cash")
    r = client.post("/api/entities/rename", json={"name": "Cash withdrawal", "kind": "person"})
    assert r.status_code == 422 and "Change the category first" in r.json()["detail"]
    # Even a type rule can't change it.
    client.post("/api/rules", json={"pattern": "q123456789", "set_kind": "business"}).raise_for_status()
    assert client.get("/api/entities").json()[0]["kind"] == "cash"
    # Undo: delete the rule that filed it under Cash.
    cash_rule = next(r for r in client.get("/api/rules").json() if r["set_category"] == "Cash")
    client.delete(f"/api/rules/{cash_rule['id']}").raise_for_status()
    e = client.get("/api/entities").json()[0]
    assert (e["name"], e["kind"]) == (name, "business")


def test_rules_combine_per_field(client):
    up(client, stmt("A/C No: XXXX1111", [("01-04-2026", "UPI/1/GOPALAN/gopalan55@okaxis/veg", 120, None, 9880)]))
    client.post("/api/rules", json={"pattern": "gopalan55", "set_category": "Groceries"}).raise_for_status()
    client.post("/api/rules", json={"pattern": "gopalan55", "set_kind": "business"}).raise_for_status()  # newer, higher priority
    client.post("/api/rules", json={"pattern": "gopalan55", "set_category": "Fruit", "set_entity": "Gopalan Veg"}).raise_for_status()
    e = client.get("/api/entities").json()[0]
    # Newest rule wins for name and category; the type comes from the only rule that sets one.
    assert (e["name"], e["category"], e["kind"]) == ("Gopalan Veg", "Fruit", "business")


def test_all_cash_withdrawals_grouped_and_never_paired_as_transfers(client):
    up(client, stmt("SBI A/C No: XXXX9435", [
        ("01-04-2026", "ATM WDL ATM CASH 1234 SBT ETTUMANOOR", 2000, None, 8000),
        ("02-04-2026", "CASH Withdrawn at GCC AT 70114 ETTUMANOOR", 5000, None, 3000),
        ("03-04-2026", "UPI/1/KUMAR/kumar99@okaxis/x", 300, None, 2700),
    ]))
    # A family member happens to send the same amount to your other account on the same day.
    up(client, stmt("Federal A/C No: XXXX3636", [("01-04-2026", "UPI IN/602/deepa.sub-1@okaxis/0000", None, 2000, 2000)]))
    ents = {e["name"]: e for e in client.get("/api/entities", params={"direction": "out"}).json()}
    assert ents["Cash withdrawal"]["payments"] == 2 and ents["Cash withdrawal"]["paid"] == 7000
    assert not any(n.startswith("To ") for n in ents)
    # Marking another payee as cash moves it under Cash withdrawal too.
    client.post("/api/entities/rename", json={"name": "Kumar", "kind": "cash"}).raise_for_status()
    ents = {e["name"]: e for e in client.get("/api/entities", params={"direction": "out"}).json()}
    assert set(ents) == {"Cash withdrawal"} and ents["Cash withdrawal"]["paid"] == 7300
