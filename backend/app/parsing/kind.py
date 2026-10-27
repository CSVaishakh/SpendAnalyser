"""Is a counterparty a person or a business?

Evidence, strongest first: what kind of payment it was (card swipes, auto-debits and bill payments go to businesses;
cash and bank fees are neither), explicit UPI markers (P2M vs P2A), merchant-style UPI IDs, known merchants, and
finally whether the payee name reads like a business or a person. A payee is classified as a whole: one card
payment to "Ramesh Stores" makes every payment to it a business payment (see services/entities.py)."""

from __future__ import annotations

import re

from .merchants import MERCHANTS

KINDS = ("person", "business", "self", "cash", "bank", "unknown")

_BUSINESS_WORDS = re.compile(
    r"\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CORP(ORATION)?|CO|COMPANY|ENTERPRISES?|TRADERS?|TRADING|STORES?|SUPER ?MARKET|"
    r"HYPER ?MARKET|MART|BAZAAR|AGENC(Y|IES)|SERVICES?|SOLUTIONS?|TECHNOLOGIES|TECHNOLOGY|TECH|INDUSTRIES|HOSPITALS?|CLINICS?|"
    r"MEDICALS?|PHARMA(CY)?|CHEMISTS?|DRUGS|HOTELS?|RESTAURANTS?|BAKERY|BAKERS|CAFE|TEA ?STALL|CANTEEN|MESS|TEXTILES?|"
    r"JEWELL?(ERS?|ERY)|GOLD|MOTORS|AUTO(MOBILES?)?|GARAGE|ELECTRONICS?|ELECTRICALS?|FOODS?|ACADEMY|SCHOOL|COLLEGE|"
    r"INSTITUTE|CENTRE|CENTER|BANK|FINANCE|FINSERV|INSURANCE|ASSOCIATES|SONS|BROTHERS|BROS|TRUST|SOCIETY|FOUNDATION|"
    r"STUDIO|SALON|PARLOU?R|SPA|PETROL|FUELS?|PETROLEUM|PUMP|GAS|LABS?|DIAGNOSTICS?|INTERNATIONAL|GLOBAL|DIGITAL|SYSTEMS|"
    r"VENTURES|HOLDINGS|PAYMENTS|MOBILES?|STATION|TRAVELS?|TOURS|HARDWARES?|STEELS?|FURNITURES?|OPTICALS?|FASHIONS?|"
    r"BOUTIQUE|COLLECTIONS?|GROUP|CONSULT(ING|ANTS?|ANCY)|SUPPLIERS?|DISTRIBUTORS?|EXPORTS?|IMPORTS?|WORKS|CONSTRUCTIONS?|"
    r"BUILDERS|DEVELOPERS|REALTY|PROPERTIES|LOGISTICS|COURIERS?|CARGO|MILLS?|FARMS?|DAIRY|BOOKS?|PRINTERS?|XEROX|"
    r"COMMUNICATIONS?|NETWORKS?|CABLES?|BROADBAND|FITNESS|GYM|SPORTS|TOYS|GIFTS|FLOWERS?|FRUITS|VEGETABLES|PROVISIONS?|"
    r"GENERAL|KIRANA|CHICKEN|MUTTON|FISH|MEAT|SWEETS|BHAVAN|DHABA|BIRYANI|PIZZA|BURGER|KITCHEN|CATERERS?|EVENTS|"
    r"RESORTS?|LODGE|HOMESTAY|RESIDENCY|INN|TAILORS?|LAUNDRY|DRY ?CLEAN(ERS)?|PHOTO|STATIONERY|COMPUTERS?|"
    r"INFOTECH|SOFTWARE|LIMITED|RETAIL|WHOLESALE|EMPORIUM|DEPOT|OUTLET|SHOP(PE)?|HUB|POINT|CORNER|ZONE|WORLD|PLAZA|MALL)\b"
)
# UPI IDs issued to merchants by payment aggregators and merchant QR programmes.
_MERCHANT_HANDLE = re.compile(
    r"(paytmqr|^paytm-\d|bharatpe|^mab\.|razorpay|\.rzp@|rzp\.|\.payu@|payu|cashfree|pinelabs|ezetap|mswipe|^gpay-\d|"
    r"@okbiz|@yespay|@fbpe|@ikwik|@hdfcbankjd|@pineaxis|@axisb$|^q\d{6,}@ybl|^\d{3,}\.\d+@|merchant|\.mer@|@kmbl.*mer|"
    r"^vyapar\.|^bpe\.|^pos\.|@freecharge)",
    re.I,
)
_PERSON_HANDLE_DOMAIN = re.compile(r"@(ok(sbi|axis|icici|hdfcbank)|ybl|ibl|axl|paytm|pt(sbi|hdfc|axis|yes)|apl|upi|"
                                   r"sbi|icici|hdfcbank|axisbank|kotak|fbl|federal|indus|barodampay|naviaxis|superyes|"
                                   r"jupiteraxis|slc|oneyes|waaxis|wasbi|wahdfcbank|waicici)$", re.I)
_NAME_LIKE = re.compile(r"^[A-Za-z][A-Za-z.' ]{1,58}$")

BUSINESS_CHANNELS = {"Card", "Auto-debit", "Bill pay"}
FIXED = {"ATM / Cash": "cash", "Cash deposit": "cash", "Interest": "bank", "Bank charges": "bank"}


def _looks_like_person_name(name: str) -> bool:
    if not _NAME_LIKE.match(name) or _BUSINESS_WORDS.search(name.upper()):
        return False
    words = [w for w in re.split(r"[ .]+", name) if w]
    return 1 <= len(words) <= 5


def classify(particulars: str, channel: str, entity: str, counterparty: str | None, category: str) -> tuple[str, str]:
    """Returns (kind, reason)."""
    if channel in FIXED:
        return FIXED[channel], channel
    if category == "Self transfers" or entity == "Self transfer":
        return "self", "own account"
    u = particulars.upper()
    handle = (counterparty or "").lower() if counterparty and "@" in counterparty else ""

    # Merchant category code on the narration (Federal Bank style): 0000 = to a person, anything else = a merchant.
    if m := re.match(r"^UPI ?(?:OUT|IN)/\d+/[^/]+@[^/]+/(?:[^/]*/)?(\d{4})$", particulars.strip(), re.I):
        if m.group(1) != "0000":
            return "business", f"merchant code {m.group(1)}"
        if _BUSINESS_WORDS.search(entity.upper()):
            return "business", "business name"
        return "person", "UPI person-to-person"
    if channel in BUSINESS_CHANNELS:
        return "business", {"Card": "card payment", "Auto-debit": "auto-debit", "Bill pay": "bill payment"}[channel]
    if re.search(r"\bP2M\b|PAY TO MERCHANT|\bMERCHANT\b", u):
        return "business", "UPI merchant payment"
    if handle and _MERCHANT_HANDLE.search(handle):
        return "business", "merchant UPI ID"
    bare = re.sub(r"@[A-Za-z0-9]+", " ", entity).upper()  # "98950@paytm" is a person paying via Paytm
    if any(name and p.search(bare) for p, name, _ in MERCHANTS):
        return "business", "known merchant"
    if _BUSINESS_WORDS.search(entity.upper()):
        return "business", "business name"
    if category in ("Salary & income",) and channel in ("NEFT", "RTGS"):
        return "business", "employer"
    if re.search(r"\bP2[AP]\b", u):
        return "person", "UPI person-to-person"
    if _looks_like_person_name(entity):
        return "person", "personal name"
    if handle and (re.match(r"^[\d+]{8,}@", handle) or _PERSON_HANDLE_DOMAIN.search(handle)):
        return "person", "personal UPI ID"
    return "unknown", ""
