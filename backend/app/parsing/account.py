"""Read account identity (number, bank, holder) from the preamble banks print above the transaction table."""

from __future__ import annotations

import re
from dataclasses import dataclass

BANKS = [
    (r"STATE BANK OF INDIA|\bSBI\b", "SBI"), (r"\bHDFC\b", "HDFC Bank"), (r"\bICICI\b", "ICICI Bank"),
    (r"\bAXIS\b", "Axis Bank"), (r"\bKOTAK\b", "Kotak Mahindra Bank"), (r"FEDERAL BANK|\bFDRL\b", "Federal Bank"),
    (r"\bYES BANK\b", "Yes Bank"), (r"\bIDFC\b", "IDFC First Bank"), (r"INDUSIND", "IndusInd Bank"),
    (r"CANARA", "Canara Bank"), (r"BANK OF BARODA|\bBOB\b", "Bank of Baroda"), (r"PUNJAB NATIONAL|\bPNB\b", "Punjab National Bank"),
    (r"UNION BANK", "Union Bank of India"), (r"SOUTH INDIAN BANK", "South Indian Bank"), (r"\bCSB\b|CATHOLIC SYRIAN", "CSB Bank"),
    (r"\bAU SMALL\b", "AU Small Finance Bank"), (r"\bRBL\b", "RBL Bank"), (r"\bDBS\b", "DBS Bank"),
    (r"INDIAN OVERSEAS", "Indian Overseas Bank"), (r"\bINDIAN BANK\b", "Indian Bank"), (r"BANK OF INDIA", "Bank of India"),
    (r"\bIDBI\b", "IDBI Bank"), (r"KARNATAKA BANK", "Karnataka Bank"), (r"KARUR VYSYA|\bKVB\b", "Karur Vysya Bank"),
    (r"PAYTM PAYMENTS", "Paytm Payments Bank"), (r"AIRTEL PAYMENTS", "Airtel Payments Bank"), (r"\bESAF\b", "ESAF Bank"),
]

_ACCT_LABEL = re.compile(r"(?i)\b(?:a/?c|acct|account)\s*(?:no|number|num)?\.?\s*[:#.\-]?\s*$|\b(?:a/?c|acct|account)\s*(?:no|number|num)\.?\b")
_ACCT_INLINE = re.compile(r"(?i)\b(?:a/?c|acct|account)\s*(?:no|number|num)?\.?\s*[:#.\-]?\s*([X*xX\d][X*xX\d\s-]{5,}\d)")
_NUMBERISH = re.compile(r"^[X*x\d][X*x\d\s-]{5,}\d$")
_NAME_LABEL = re.compile(r"(?i)^(account\s*(holder)?\s*name|customer\s*name|name)\s*[:\-]?\s*(.*)$")
_TYPE = re.compile(r"(?i)\b(savings|current|salary|nre|nro|od|overdraft|cc|cash credit)\b")


@dataclass
class AccountHint:
    number: str | None = None   # as printed, e.g. "XXXXXXXX2231" or "50100123456789"
    last4: str | None = None
    bank: str | None = None
    holder: str | None = None
    kind: str | None = None     # Savings / Current / ...

    @property
    def found(self) -> bool:
        return bool(self.last4)

    def label(self) -> str:
        parts = [self.bank or "Account"]
        if self.kind:
            parts.append(self.kind)
        return " ".join(parts) + (f" ••{self.last4}" if self.last4 else "")


def _clean_number(s: str) -> str | None:
    s = re.sub(r"[\s-]", "", s).upper().replace("*", "X")
    digits = re.sub(r"\D", "", s)
    return s if len(s) >= 6 and len(digits) >= 4 else None


def detect_account(preamble: list[list[str]], filename: str = "") -> AccountHint:
    hint = AccountHint()
    cells = [c.strip() for row in preamble for c in row if c and c.strip()]
    text = " ".join(cells + [re.sub(r"[_.\-]+", " ", filename)]).upper()

    for i, row in enumerate(preamble):
        row = [c.strip() for c in row]
        for j, c in enumerate(row):
            if not c:
                continue
            if not hint.number:
                m = _ACCT_INLINE.search(c)
                if m and (n := _clean_number(m.group(1))):
                    hint.number = n
                elif _ACCT_LABEL.search(c):
                    # Label in one cell, value in the next non-empty cell on the row.
                    nxt = next((x for x in row[j + 1:] if x), "")
                    if _NUMBERISH.match(nxt) and (n := _clean_number(nxt)):
                        hint.number = n
            if not hint.holder and (m := _NAME_LABEL.match(c)):
                val = m.group(3).strip() or next((x for x in row[j + 1:] if x), "")
                if val and not re.search(r"\d{4,}", val) and len(val) <= 80:
                    hint.holder = " ".join(val.split()).title()

    if not hint.number:
        # Filenames like "Statement_XXXX2231_Apr.xls" or "1234567890123_statement.csv".
        m = re.search(r"(?:X{2,}|\*{2,})(\d{4})|(?<!\d)(\d{9,18})(?!\d)", filename, re.I)
        if m:
            hint.number = (m.group(0) or "").upper()

    if hint.number:
        digits = re.sub(r"\D", "", hint.number)
        hint.last4 = digits[-4:] if len(digits) >= 4 else None

    for pattern, name in BANKS:
        if re.search(pattern, text):
            hint.bank = name
            break
    if m := _TYPE.search(" ".join(cells)):
        hint.kind = m.group(1).title() if len(m.group(1)) > 3 else m.group(1).upper()
    return hint
