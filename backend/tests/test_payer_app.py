import pytest

from app.parsing.extract import extract
from app.parsing.payer_app import detect_payer_app, upi_note
from tests.test_accounts import stmt, up


@pytest.mark.parametrize("narration,app", [
    # Federal: UPIOUT/<ref>/<upi-id>/<note>/<merchant code>
    ("UPIOUT/601234567890/qr.mc1@sib/Paid via Supe/8299", "super.money"),
    ("UPIOUT/601234567891/bhqr.12345a@sib/Paid v/5812", "super.money"),
    ("UPIOUT/601234567892/q19928@ybl/Pai/5411", "super.money"),
    ("UPIOUT/601234567893/ibkpos.ep05@icici/Pa/5411", "super.money"),
    ("UPIOUT/601234567894/qr.mc1@sib/UPI/8299", "Google Pay"),
    ("UPIOUT/601234567895/tinsee007@oksbi/UP/0000", "Google Pay"),
    ("UPIOUT/601234567896/zerodha@hdfcbank/Manda/6211", "Autopay"),
    ("UPIOUT/601234567897/someone@okaxis/0000", "Unknown"),
    ("UPIOUT/601234567898/someone@okaxis/birthday cake/0000", "Unknown"),
    # SBI: .../UPI/DR/<ref>/<name>/<bank>/<upi-id>/<note> <ref> AT <branch>
    ("WDL TFR UPI/DR/412345678901/RAHUL K/SBIN/rahulk@oksbi/Paid 0097693162093 AT 70114 ETTUMANOOR", "super.money"),
    ("WDL TFR UPI/DR/412345678902/RAHUL K/SBIN/rahulk@oksbi/UPI 0097691162095 AT 70114 ETTUMANOOR", "Google Pay"),
    # SBI cuts long UPI IDs short and drops the @
    ("WDL TFR UPI/DR/412345678906/RAJU/PYTM/pay tmqr281/UPI 0097691162095 AT 70114 ETTUMANOOR", "Google Pay"),
    ("WDL TFR UPI/DR/412345678907/CAFE/SIBL/bh qr.21734/Paid 0097693162093 AT 70114 ETTUMANOOR", "super.money"),
    # Other banks' default notes
    ("UPI/DR/412345678903/RAHUL K/SBIN/rahulk@oksbi/Payment from Ph", "PhonePe"),
    ("UPI-SURESH-9876543210@ybl-YESB0YBLUPI-412345678904-Sent using Paytm U", "Paytm"),
    ("UPI/412345678905/CRED CLUB/cred.club@axisb/Payment on CRED", "CRED"),
])
def test_detect_payer_app(narration, app):
    e = extract(narration, "", "", True)
    assert detect_payer_app(narration, e.channel, True) == app


def test_only_outgoing_upi_has_an_app():
    assert detect_payer_app("UPI IN/601/someone@okaxis/UPI/0000", "UPI", is_debit=False) is None
    assert detect_payer_app("POS 4160XXXX1234 DECATHLON", "Card", is_debit=True) is None
    assert detect_payer_app("ATM WDL/123456/KAKKANAD", "ATM / Cash", is_debit=True) is None


def test_upi_note_extraction():
    assert upi_note("UPIOUT/6012/qr.mc1@sib/Paid via Supe/8299") == "Paid via Supe"
    assert upi_note("UPI IN/6012/someone@upi/0000") == ""
    assert upi_note("IMPS-412345678901-JOHN DOE-HDFC-XXXX1234-rent") == ""


def test_dashboard_and_filter_by_app(client):
    up(client, stmt("Federal A/C No: XXXX3636", [
        ("01-04-2026", "UPIOUT/601/qr.mc1@sib/Paid via Supe/8299", 30, None, 970),
        ("02-04-2026", "UPIOUT/602/qr.mc1@sib/UPI/8299", 50, None, 920),
        ("03-04-2026", "UPIOUT/603/qr.mc1@sib/UPI/8299", 20, None, 900),
        ("04-04-2026", "POS 4160XXXX1234 DECATHLON", 100, None, 800),
    ]))
    apps = {a["name"]: a["amount"] for a in client.get("/api/dashboard").json()["apps"]}
    assert apps == {"Google Pay": 70, "super.money": 30}
    gp = client.get("/api/transactions", params={"app": "Google Pay"}).json()
    assert gp["total"] == 2 and all(t["payer_app"] == "Google Pay" for t in gp["items"])
    assert client.get("/api/meta").json()["apps"] == ["Google Pay", "super.money"]
