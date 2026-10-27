"""Derive payment channel, counterparty (entity) and category from a transaction narration."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .merchants import MERCHANTS

CHANNELS = ["UPI", "IMPS", "NEFT", "RTGS", "Card", "ATM / Cash", "Cash deposit", "Auto-debit", "Cheque",
            "Bill pay", "Account transfer", "Interest", "Bank charges", "Other"]

_IFSC = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
_BANK_CODES = set("""SBIN HDFC ICIC UTIB KKBK YESB FDRL PUNB BARB CNRB UBIN IDFB INDB PYTM AIRP JIOP FINO AUBL SIBL CSBK
DBSS RATN IDIB IOBA BKID CBIN UCBA KARB KVBL TMBL CIUB IBKL ESFB UJVN BDBL SBI ICICI AXIS KOTAK YBL OKSBI OKAXIS OKICICI
OKHDFCBANK PAYTM APL IBL AXL YESBANK""".split())
_BANK_NAMES = re.compile(r"^(STATE BANK OF INDIA|HDFC BANK( LTD)?|ICICI BANK( LTD)?|AXIS BANK( LTD)?|KOTAK( MAHINDRA)?( BANK)?|YES BANK|"
                         r"FEDERAL BANK|FEDERAL|CANARA( BANK)?|BANK OF BARODA|PUNJAB NATIONAL BANK|UNION BANK( OF INDIA)?|"
                         r"IDFC( FIRST)?( BANK)?|INDUSIND( BANK)?|PAYTM PAYMENTS BANK|AIRTEL PAYMENTS BANK|FINO PAYMENTS BANK|"
                         r"AU SMALL FINANCE BANK|SOUTH INDIAN BANK|CSB BANK|DBS BANK|RBL BANK|INDIAN BANK|INDIAN OVERSEAS BANK|"
                         r"BANK OF INDIA|CENTRAL BANK OF INDIA|UCO BANK|KARNATAKA BANK|KARUR VYSYA BANK|CITY UNION BANK|"
                         r"JIO PAYMENTS BANK|IDBI( BANK)?|EQUITAS|UJJIVAN|BANDHAN( BANK)?)$")
_STOP = set("""UPI UPIOUT UPIIN UPIAR UPIAB IMPS NEFT RTGS P2A P2M P2P DR CR TO FROM BY TRANSFER TRF TFR PAYMENT PAY PAID OUT IN SENT
RECEIVED MOB MMT INB IB NA NULL NONE REF REFNO TXN TRAN COLLECT REQUEST INWARD OUTWARD INFT INF CMS ACH NACH ECS DEBIT CREDIT POS
IMPSIN IMPSOUT NEFTIN NEFTOUT RTGSIN RTGSOUT MB NETBANKING BIL ONL ECOM VPS IPS PCD VIN MPS BILLPAY BBPS CLG CHQ CHEQUE CLEARING
DEP DEPOSIT WDL WITHDRAWAL FT IFT OFT NFT INSTA FUND FUNDS TRANSFERRED VIA APP ATD ATW NWD EBA RET INTL QR UPIQR MANDATE AUTOPAY
EXECUTE EXECUTED SUCCESS SUCCESSFUL ONLINE OTHERS OTHER MISC FAILED TXNS""".split())
_NOISE = re.compile(r"^(PAYMENT( FROM| TO| FOR)?( PHONE(PE)?)?|PAY TO.*|PAID (VIA|TO|USING).*|SENT (USING|FROM|VIA|BY).*|NO ?REMARKS?|"
                    r"UPI (PAYMENT|TRANSACTION|INTENT)|COLLECT ?REQ.*|OID\w*|VERIFY|PAYMENT ON CRED|AUTO ?PAY.*|MANDATE.*|"
                    r"REMARKS?.*|SMS|MONTHLY|QR.*|TRANSFER (TO|FROM).*|FUND TRANSFER|IMPS (P2A|P2P).*|ON .*APP|"
                    r"PAYMENT SUCCESSFUL|MONEY TRANSFER|THANK YOU|PAYTM PAYMENT|BHIM.*|GPAY|GOOGLE ?PAY|PHONE ?PE|WHATSAPP.*)$")
_LEADING = re.compile(r"^(?:(?:UPI ?(?:OUT|IN|DR|CR)?|IMPS|NEFT|RTGS|TRF|TRANSFER|TO|BY|FROM|INB|MOB|D|TP|ACH|NACH|ECS|"
                      r"CLG|CHQ|CHEQUE|DEP|NO\.?)\b\s*\d*\s*)+", re.I)
_ACRONYM = {"HP", "KSEB", "BSNL", "IRCTC", "BESCOM", "TNEB", "KFC", "LLP", "NRI", "GST", "LIC", "ATM", "EMI", "SBI", "HDFC",
            "ICICI", "UPI", "NEFT", "IMPS", "KSRTC", "MRF", "TVS", "BMW", "IKEA", "DTH", "PVR", "LG", "IT", "HR", "BPCL", "HPCL",
            "IOCL", "ACT", "NPS", "PPF", "SIP", "MF", "UK", "US", "USA", "PVT", "AC", "TCS", "HCL", "IBM", "EY", "KPMG", "PWC"}
_KEEP_LOWER = {"of", "and", "the", "for", "&"}


@dataclass
class Extracted:
    channel: str
    entity: str
    category: str
    counterparty: str | None  # UPI handle or masked account, when present
    mcc: str | None = None     # merchant category code on UPI rows; "0000" means person-to-person


# Card-network merchant category codes, as printed at the end of some banks' UPI narrations (e.g. Federal Bank).
MCC_CATEGORY = {
    **dict.fromkeys(["5411", "5422", "5499", "5451", "5300", "5331"], "Groceries"),
    **dict.fromkeys(["5812", "5813", "5814", "5462", "5441"], "Food & dining"),
    **dict.fromkeys(["8211", "8220", "8241", "8244", "8249", "8299", "8351"], "Education"),
    **dict.fromkeys(["7011", "7012", "7032", "7033"], "Hotels & lodging"),
    **dict.fromkeys(["4111", "4112", "4121", "4131", "4411", "4511", "4722", "4784", "4789", "7512", "7523"], "Travel & transport"),
    **dict.fromkeys(["5541", "5542", "5983"], "Fuel"),
    **dict.fromkeys(["5912", "8011", "8021", "8031", "8041", "8042", "8043", "8049", "8050", "8062", "8071", "8099", "5975", "5976"], "Health"),
    **dict.fromkeys(["4812", "4814", "4816"], "Telecom & internet"),
    **dict.fromkeys(["4899", "5815", "5816", "5817", "5818"], "Subscriptions"),
    **dict.fromkeys(["4900"], "Utilities & bills"),
    **dict.fromkeys(["7832", "7841", "7922", "7929", "7991", "7994", "7996", "7999"], "Entertainment"),
    **dict.fromkeys(["6211", "6051"], "Investments"),
    **dict.fromkeys(["6300", "6381", "6399"], "Insurance"),
    **dict.fromkeys(["7210", "7211", "7216", "7230", "7297", "7298", "7299", "7349", "7392", "7399", "7538", "7542", "8999"], "Services"),
    **dict.fromkeys(["9311", "9222", "9399", "9211"], "Taxes"),
    **dict.fromkeys(["6513"], "Rent & housing"),
    **dict.fromkeys(["5310", "5311", "5399", "5611", "5621", "5631", "5641", "5651", "5655", "5661", "5691", "5699", "5712", "5719",
                     "5722", "5732", "5733", "5734", "5735", "5940", "5941", "5942", "5943", "5944", "5945", "5946", "5947",
                     "5948", "5949", "5950", "5964", "5965", "5969", "5970", "5977", "5992", "5993", "5994", "5995", "5999",
                     "5200", "5211", "5231", "5251", "5261", "5045", "5065", "5094", "5122", "5137", "5139"], "Shopping"),
}

# Federal Bank style: UPIOUT/<ref>/<upi-id>/<note>/<mcc> and UPI IN/<ref>/<upi-id>/[<note>/]<mcc>. No payee name.
_UPI_MCC = re.compile(r"^UPI ?(?:OUT|IN)/\d+/([^/]+@[^/]+)/(?:([^/]*)/)?(\d{4})$", re.I)
_AGGREGATOR_HANDLE = re.compile(r"^(q\d{5,}|bhqr\.|ibkpos\.|qr\.|vyapar\.|ugm\.|paytmqr|bharatpe|mab\.|\d{6,})", re.I)


def title_case(s: str) -> str:
    words = []
    for i, w in enumerate(s.split()):
        up = w.upper().strip(".,")
        if up in _ACRONYM or (len(up) <= 4 and up.isalpha() and not re.search(r"[AEIOU]", up)):
            words.append(w.upper())
        elif i and w.lower() in _KEEP_LOWER:
            words.append(w.lower())
        else:
            words.append("-".join(p[:1].upper() + p[1:].lower() for p in w.split("-")))
    return " ".join(words)


def strip_handles(upper: str) -> str:
    """'98950@PAYTM' names the payee's app, not the payee, so drop handle domains before keyword matching."""
    return re.sub(r"@[A-Z0-9]+\b", " ", upper)


def detect_channel(u: str, tran_type: str = "", cheque: str = "") -> str:
    tt = tran_type.upper()
    if re.search(r"\bUPI|UPIOUT|UPIIN|UPIAR", u):
        return "UPI"
    if re.search(r"\bIMPS|\bMMT\b", u):
        return "IMPS"
    if re.search(r"\bNEFT", u):
        return "NEFT"
    if re.search(r"\bRTGS", u):
        return "RTGS"
    if re.search(r"\bATM\b|\bATW\b|\bNWD\b|\bEBA\b|CASH\s*WDL|CASH WITHDRAW(AL|N)|\bAWB\b|\bATD\b|ATM WDL|CASH PAID|"
                 r"WITHDRAWAL BY CASH|BY SELF\b|SELF CHQ|CARDLESS CASH|\bICCW\b|UPI ?ATM", u):
        return "ATM / Cash"
    if re.search(r"\b(NACH|ACH|ECS)\b|\bSI\b|MANDATE|AUTOPAY|STANDING INSTR|\bENACH\b", u):
        return "Auto-debit"
    if re.search(r"\bPOS\b|\bPCD\b|\bVPS\b|\bIPS\b|DEBIT CARD|\bVIN/|\bECOM\b|\bMPS\b|\bPRCR\b|CARD (NO\.? )?\d{4}", u):
        return "Card"
    if re.search(r"\bINT(EREST)?\.?\s*(PD|PAID|CR|CREDIT|ON)\b|\bINTEREST\b|\bSB ?INT\b|\bINT\.COLL", u):
        return "Interest"
    if re.search(r"CHRG|CHARGES|\bFEE\b|\bGST\b|\bAMC\b|SMS ALERT|PENAL|\bCHGS?\b|MIN ?BAL|NON[- ]MAINT|DEBIT CARD ANNUAL", u):
        return "Bank charges"
    if re.search(r"\bCLG\b|CLEARING|\bCHQ\b|CHEQUE|\bCTS\b", u) or tt in ("CLG", "CHQ") or (
            re.search(r"\d{5,}", cheque or "") and not re.search(r"UPI|NEFT|IMPS|RTGS", u)):
        return "Cheque"
    if re.search(r"^BY CASH|\bCASH DEP|CASH DEPOSIT|\bCDM\b", u) or (tt == "CASH" and "WDL" not in u):
        return "Cash deposit"
    if re.search(r"\bBIL/|BILLPAY|BILL PAY|\bBBPS\b|BILLDESK", u):
        return "Bill pay"
    if re.search(r"\b(TRF|TRANSFER|TO A/C|FROM A/C|BY TRANSFER|TO TRANSFER|INB|NETBANKING|MOB|FT|IFT)\b", u) or tt.startswith(("TFR", "TRF")):
        return "Account transfer"
    return "Other"


_TRUNCATABLE = ("PAID VIA SUPER.MONEY", "PAID VIA", "PAYMENT", "UPI", "SENT VIA", "PAY TO")


def _is_junk(tok: str) -> bool:
    u = tok.upper().strip(" .")
    if 2 <= len(u) and any(p.startswith(u) for p in _TRUNCATABLE):
        return True  # narrations cut notes short: "Pa", "Pai", "Paid v", "UP"
    if len(u) < 2 or u in _STOP or u in _BANK_CODES or _BANK_NAMES.match(u) or _NOISE.match(u):
        return True
    if _IFSC.match(u) or re.match(r"^[A-Z]{4}0\w*$", u) and len(u) <= 11 and re.search(r"\d", u):
        return True
    letters = len(re.findall(r"[A-Z]", u))
    digits = len(re.findall(r"\d", u))
    if letters < 2 or digits >= letters or re.search(r"\d{6,}", u):
        return True
    if re.match(r"^X+\d*$", u) or re.match(r"^\d*X{3,}\d*$", u):
        return True  # masked account/card numbers
    if all(w in _STOP for w in u.split()):
        return True
    return False


def _find_handle(raw: str) -> str | None:
    """UPI handles may contain hyphens ("zomato-order@paytm"), but some banks also use '-' as the field
    separator ("UPI-SURESH-98765@ybl-..."). Allow hyphens only when the narration is '/'-separated."""
    hyphen_sep = raw.count("-") > raw.count("/")
    m = re.search(r"[\w.]+@[A-Za-z0-9]+" if hyphen_sep else r"[\w.\-]+@[A-Za-z0-9]+", raw)
    return m.group(0).strip("-.") if m else None


def _name_from_handle(vpa: str) -> str:
    local = vpa.split("@")[0]
    if re.fullmatch(r"[\d.+\-]{8,}", local):
        return vpa.lower()  # phone-number handle; nothing better to show
    words = re.sub(r"\d+", " ", re.sub(r"[._\-]+", " ", local)).strip()
    return title_case(words) if len(words) >= 3 else vpa.lower()


def _clean_name(name: str) -> str:
    name = re.sub(r"[^\w &.'()-]", " ", name)
    name = re.sub(r"\s+(PVT|PRIVATE)\.?\s*(LTD|LIMITED)\.?$|\s+(LTD|LIMITED|LLP|INC|CORP)\.?$", "", name, flags=re.I)
    name = re.sub(r"\s+", " ", name).strip(" .-&")
    if name.isupper() or name.islower():
        name = title_case(name)
    return name


def extract_entity(particulars: str, channel: str) -> tuple[str, str | None]:
    raw = particulars.strip()
    tokens = [t.strip() for t in re.split(r"[/|\\:;*~]+|-+", raw) if t.strip()]
    handle = _find_handle(raw)
    account = next((t for t in tokens if re.fullmatch(r"X{3,}\d{3,}|\d*X{4,}\d{3,}", t.upper())), None)

    if channel == "Card":
        # "POS 416021XXXXXX1234 SOME MERCHANT BANGALORE" — drop the prefix and card number.
        body = re.sub(r"(?i)^(POS|PCD|VPS|IPS|MPS|ECOM|VIN|PRCR)\b[\s/]*", "", raw)
        body = re.sub(r"\b\d*X{3,}\d*\b|\b\d{4,}\b", " ", body, flags=re.I)
        tokens = [t.strip() for t in re.split(r"[/|]+", body) if t.strip()] or tokens

    for t in tokens:
        if "@" in t:
            continue
        t = _LEADING.sub("", t).strip()
        if re.fullmatch(r"(?i)self|to self|own a/?c|own account", t):
            return "Self transfer", account
        if not _is_junk(t):
            return _clean_name(t), handle or account

    if handle:
        return _name_from_handle(handle), handle
    fallback = re.sub(r"\d{5,}|[/|\\:;*~-]+", " ", raw)
    fallback = " ".join(w for w in fallback.split() if w.upper() not in _STOP)
    return (_clean_name(fallback) if fallback else "Unknown"), account


def extract(particulars: str, tran_type: str, cheque: str, is_debit: bool) -> Extracted:
    u_full = particulars.upper()
    u = strip_handles(u_full)
    channel = detect_channel(u_full, tran_type, cheque)

    fixed = {
        "ATM / Cash": ("Cash withdrawal", "Cash"),
        "Interest": ("Bank interest", "Interest"),
        "Bank charges": ("Bank charges", "Bank charges"),
        "Cash deposit": ("Cash deposit", "Cash"),
    }
    if channel in fixed:
        name, cat = fixed[channel]
        return Extracted(channel, name, cat, None)

    mcc = None
    if m := _UPI_MCC.match(particulars.strip()):
        # No name in this format: name the payee after its UPI ID. Merchant QR IDs (q123@ybl, bhqr...) stay as-is.
        counterparty, mcc = m.group(1).strip(), m.group(3)
        local = counterparty.split("@")[0]
        entity = counterparty.lower() if _AGGREGATOR_HANDLE.match(local) else _name_from_handle(counterparty)
    else:
        entity, counterparty = extract_entity(particulars, channel)
    category = None
    named_merchant = False
    for pattern, name, cat in MERCHANTS:
        if pattern.search(u):
            if name:
                entity, named_merchant = name, True
            category = cat
            break
    if not named_merchant and mcc and MCC_CATEGORY.get(mcc):
        category = MCC_CATEGORY[mcc]  # the card network's code beats a keyword guess

    if category is None and mcc and mcc != "0000":
        category = MCC_CATEGORY.get(mcc)
        if category is None and is_debit:
            category = "Shopping"  # some merchant we have no code mapping for
    if entity == "Self transfer":
        category = "Self transfers"
    if category is None or (not is_debit and category in ("Wallets & payments",)):
        if channel == "Auto-debit":
            category = "Auto-debits" if is_debit else "Transfers in"
        elif channel == "Cheque":
            category = "Cheques" if is_debit else "Transfers in"
        elif channel == "Bill pay":
            category = "Utilities & bills"
        elif channel == "Card":
            category = "Shopping"
        elif channel in ("UPI", "IMPS", "NEFT", "RTGS", "Account transfer"):
            category = "Transfers out" if is_debit else "Transfers in"
        else:
            category = "Other"
    return Extracted(channel, entity, category, counterparty, mcc)
