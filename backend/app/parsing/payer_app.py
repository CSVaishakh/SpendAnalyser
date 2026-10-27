"""Which UPI app a payment was made with, read from the note the app leaves on the transaction.

Apps write a default note when you don't type one ("Paid via super.money", "Sent using Paytm", "Payment from
PhonePe"; Google Pay writes "UPI"). Banks often cut the note short ("Paid v", "Pai"), so prefixes count.
Only outgoing UPI payments get an app; card, ATM and bank transfers don't go through one."""

from __future__ import annotations

import re

APPS = ["Google Pay", "super.money", "PhonePe", "Paytm", "CRED", "Amazon Pay", "BHIM", "Autopay", "Unknown"]

# Federal Bank style: UPIOUT/<ref>/<upi-id>/[<note>/]<merchant code>
_FEDERAL = re.compile(r"^UPI ?(?:OUT|IN)/\d+/[^/]+@[^/]+/(?:([^/]*)/)?\d{4}$", re.I)
# SBI style: UPI/DR/<ref>/<name>/<bank>/<upi-id, often cut short and missing its @>/<note> <ref> AT <branch>
_SBI = re.compile(r"UPI/(?:DR|CR)/\d+/[^/]*/[^/]*/[^/]*/([^/]*)", re.I)
_IFSC = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$", re.I)
_BANK_CODES = {"SBIN", "HDFC", "ICIC", "UTIB", "KKBK", "YESB", "FDRL", "PUNB", "BARB", "CNRB", "UBIN", "IDFB", "INDB", "PYTM",
               "AIRP", "SIBL", "CSBK", "IOBA", "BKID", "CBIN", "UCBA", "KARB", "KVBL", "TMBL", "IBKL", "ESFB", "AUBL", "RATN"}


def upi_note(particulars: str) -> str:
    """The free-text note on a UPI narration, or "" when the bank didn't print one."""
    p = particulars.strip()
    if m := _FEDERAL.match(p):
        return (m.group(1) or "").strip()
    if m := _SBI.search(p):
        return re.sub(r"\s+\d{6,}.*$|\s+AT\s+\d+.*$", "", m.group(1)).strip()
    # Elsewhere the note follows the payee's UPI ID: ".../rahul@oksbi/Payment from Ph" or "-rahul@oksbi-SBIN0001-4123-dinner".
    sep = "-" if p.count("-") > p.count("/") else "/"
    parts = [t.strip() for t in p.split(sep)]
    at = next((i for i, t in enumerate(parts) if "@" in t.replace(" ", "")), None)
    if at is None:
        return ""
    for t in parts[at + 1:]:
        t = re.sub(r"\s+\d{6,}.*$|\s+AT\s+\d+.*$", "", t).strip()  # SBI appends a reference and branch
        if not t or _IFSC.match(t) or t.upper() in _BANK_CODES or re.fullmatch(r"[\d\s]+", t):
            continue
        return t
    return ""


def _prefix_of(note: str, phrase: str, min_len: int = 2) -> bool:
    return len(note) >= min_len and phrase.startswith(note)


def detect_payer_app(particulars: str, channel: str, is_debit: bool) -> str | None:
    if channel != "UPI" or not is_debit:
        return None
    note = re.sub(r"\s+", " ", upi_note(particulars)).upper().strip(" .")
    if not note:
        return "Unknown"
    if _prefix_of(note, "PAID VIA SUPER.MONEY") or note.startswith(("PAID VIA SUPER", "PAID VIA S")) or (
            note.startswith("PAID") and len(note) <= 8):
        return "super.money"
    if re.search(r"PAYTM|^SENT USING P", note):
        return "Paytm"
    if re.search(r"PHONEPE|^PAYMENT FROM PH", note):
        return "PhonePe"
    if re.search(r"\bCRED\b", note):
        return "CRED"
    if re.search(r"AMAZON ?PAY", note):
        return "Amazon Pay"
    if re.search(r"\bBHIM\b", note):
        return "BHIM"
    if _prefix_of(note, "MANDATE", 4) or note.startswith(("MANDATE", "AUTOPAY", "ATPAY")):
        return "Autopay"
    if note in ("UPI", "UP", "U"):
        return "Google Pay"  # Google Pay's default note; BHIM and a few banks' apps also use it
    return "Unknown"
