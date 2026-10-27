import pytest

from app.parsing.extract import extract


@pytest.mark.parametrize("narration,debit,channel,entity,category", [
    ("UPI/DR/412345678901/RAHUL K/SBIN/rahulk@oksbi/Payment from Ph", True, "UPI", "Rahul K", "Transfers out"),
    ("UPI-SURESH BABU-9876543210@ybl-YESB0YBLUPI-412345678901-PAYMENT", True, "UPI", "Suresh Babu", "Transfers out"),
    ("IMPS-412345678901-JOHN DOE-HDFC-XXXXXXX1234-rent", True, "IMPS", "John Doe", "Rent & housing"),
    ("NEFT/N123456789/MEGHA STORES PVT LTD/KKBK0000123", True, "NEFT", "Megha Stores", "Transfers out"),
    ("MMT/IMPS/412345678901/ANITHA R/SBIN0001234", True, "IMPS", "Anitha R", "Transfers out"),
    ("UPI OUT/412345678901/9895012345@paytm/NA", True, "UPI", "9895012345@paytm", "Transfers out"),
    ("UPI/412345678901/PAYMENT/rahul.menon99@okicici/ICIC", True, "UPI", "Rahul Menon", "Transfers out"),
    ("UPI/1/SWIGGY/swiggy@icici/HDFC/Payment", True, "UPI", "Swiggy", "Food & dining"),
    ("POS 416021XXXXXX1234 DECATHLON SPORTS KOCHI", True, "Card", "Decathlon", "Shopping"),
    ("ACH/D- TP ACH ICICIPRULIFE-12345", True, "Auto-debit", "ICICI Prudential", "Insurance"),
    ("NACH-10-DR-BAJAJ FINANCE LTD-12345", True, "Auto-debit", "Bajaj Finance", "Loans & EMI"),
    ("BIL/ONL/12345678/KSEB/ELECTRICITY BILL", True, "Bill pay", "KSEB", "Utilities & bills"),
    ("ATM WDL/123456/KAKKANAD", True, "ATM / Cash", "Cash withdrawal", "Cash"),
    ("SB INT PAID TILL 30-06-2026", False, "Interest", "Bank interest", "Interest"),
    ("TO SELF/XXXX1234", True, "Other", "Self transfer", "Self transfers"),
    ("UPI/CR/412345678901/PRIYA NAIR/HDFC/priya@okhdfcbank/dinner", False, "UPI", "Priya Nair", "Transfers in"),
    ("NEFT CR-SBIN0000123-ACME TECHNOLOGIES PRIVATE LIMITED-SALARY APR", False, "NEFT", "Acme Technologies", "Salary & income"),
    ("BY CLG/CHQ 000123/RAMESH", False, "Cheque", "Ramesh", "Transfers in"),
])
def test_extract(narration, debit, channel, entity, category):
    e = extract(narration, "", "", debit)
    assert (e.channel, e.entity, e.category) == (channel, entity, category)


@pytest.mark.parametrize("narration,handle", [
    ("UPI/1/ZOMATO/zomato-order@paytm/ICIC/Payment", "zomato-order@paytm"),
    ("UPI-SURESH BABU-9876543210@ybl-YESB0YBLUPI-412345678901-PAYMENT", "9876543210@ybl"),
    ("UPI/412345678901/PAYMENT/rahul.menon99@okicici/ICIC", "rahul.menon99@okicici"),
])
def test_upi_handle(narration, handle):
    assert extract(narration, "", "", True).counterparty == handle
