"""Known merchants and keyword categories. Matched against the upper-cased narration
with UPI handle domains removed (so "98950@PAYTM" doesn't look like a Paytm payment)."""

from __future__ import annotations

import re

# (pattern, canonical name or None to keep the extracted name, category)
_RAW: list[tuple[str, str | None, str]] = [
    # Food & dining
    (r"SWIGGY(?!.*INSTAMART)", "Swiggy", "Food & dining"), (r"ZOMATO", "Zomato", "Food & dining"),
    (r"DOMINO", "Domino's", "Food & dining"), (r"MCDONALD", "McDonald's", "Food & dining"),
    (r"STARBUCKS", "Starbucks", "Food & dining"), (r"\bKFC\b", "KFC", "Food & dining"),
    (r"BURGER KING", "Burger King", "Food & dining"), (r"PIZZA HUT", "Pizza Hut", "Food & dining"),
    (r"EATSURE|REBEL FOODS|FAASOS|BEHROUZ", "EatSure", "Food & dining"), (r"CHAAYOS", "Chaayos", "Food & dining"),
    (r"RESTAURANT|HOTEL|CAFE\b|BAKERY|BIRYANI|DHABA", None, "Food & dining"),
    # Groceries
    (r"INSTAMART", "Swiggy Instamart", "Groceries"), (r"BLINKIT|GROFERS", "Blinkit", "Groceries"),
    (r"ZEPTO|KIRANAKART", "Zepto", "Groceries"), (r"BIG ?BASKET|INNOVATIVE RETAIL", "BigBasket", "Groceries"),
    (r"DMART|AVENUE SUPERMART", "DMart", "Groceries"), (r"JIOMART", "JioMart", "Groceries"),
    (r"RELIANCE (RETAIL|FRESH|SMART)", "Reliance Retail", "Groceries"), (r"MORE RETAIL", "More Retail", "Groceries"),
    (r"SUPERMARKET|HYPERMARKET|PROVISION|KIRANA|VEGETABLE|FRUITS|MILK|DAIRY|MILMA", None, "Groceries"),
    # Shopping
    (r"AMAZON ?PAY", "Amazon Pay", "Shopping"), (r"AMAZON|AMZN", "Amazon", "Shopping"), (r"FLIPKART", "Flipkart", "Shopping"),
    (r"MYNTRA", "Myntra", "Shopping"), (r"AJIO", "Ajio", "Shopping"), (r"NYKAA", "Nykaa", "Shopping"),
    (r"MEESHO", "Meesho", "Shopping"), (r"DECATHLON", "Decathlon", "Shopping"), (r"\bIKEA\b", "IKEA", "Shopping"),
    (r"CROMA", "Croma", "Shopping"), (r"RELIANCE DIGITAL", "Reliance Digital", "Shopping"), (r"LULU", "Lulu", "Shopping"),
    (r"TRENDS|LIFESTYLE|WESTSIDE|PANTALOONS|MAX FASHION|ZUDIO|H&M|UNIQLO", None, "Shopping"),
    # Travel
    (r"\bUBER\b", "Uber", "Travel & transport"), (r"\bOLA\b|ANI TECHNOLOGIES|OLACABS", "Ola", "Travel & transport"),
    (r"RAPIDO|ROPPEN", "Rapido", "Travel & transport"), (r"IRCTC", "IRCTC", "Travel & transport"),
    (r"MAKEMYTRIP|MAKE MY TRIP", "MakeMyTrip", "Travel & transport"), (r"GOIBIBO|IBIBO", "Goibibo", "Travel & transport"),
    (r"CLEARTRIP", "Cleartrip", "Travel & transport"), (r"INDIGO|INTERGLOBE", "IndiGo", "Travel & transport"),
    (r"AIR INDIA", "Air India", "Travel & transport"), (r"AKASA", "Akasa Air", "Travel & transport"),
    (r"REDBUS", "redBus", "Travel & transport"), (r"KSRTC", "KSRTC", "Travel & transport"),
    (r"FASTAG|\bNETC\b", "FASTag", "Travel & transport"), (r"METRO|BMRCL|DMRC|KMRL", None, "Travel & transport"),
    (r"PARKING|TOLL", None, "Travel & transport"),
    # Fuel
    (r"INDIAN OIL|IOCL|BHARAT PETROLEUM|BPCL|HINDUSTAN PETROLEUM|HPCL|\bSHELL\b|PETROL|FUEL|NAYARA|FILLING STATION", None, "Fuel"),
    # Telecom
    (r"AIRTEL(?! PAYMENTS)", "Airtel", "Telecom & internet"), (r"\bJIO\b|RELIANCE JIO", "Jio", "Telecom & internet"),
    (r"VODAFONE|VODAIDEA|\bVI\b", "Vi", "Telecom & internet"), (r"BSNL", "BSNL", "Telecom & internet"),
    (r"ACT FIBERNET|ATRIA CONVERGENCE", "ACT Fibernet", "Telecom & internet"), (r"ASIANET", "Asianet", "Telecom & internet"),
    (r"BROADBAND|FIBERNET|RECHARGE|PREPAID|POSTPAID|DTH|TATA ?PLAY|TATASKY", None, "Telecom & internet"),
    # Utilities
    (r"ELECTRICITY|BESCOM|KSEB|TNEB|TANGEDCO|MSEDCL|TATA POWER|ADANI ELEC|BSES|CESC|\bPOWER\b", None, "Utilities & bills"),
    (r"WATER|BWSSB|KWA\b", None, "Utilities & bills"),
    (r"\bGAS\b|INDANE|HP ?GAS|BHARAT ?GAS|MAHANAGAR GAS|\bIGL\b|LPG", None, "Utilities & bills"),
    (r"MUNICIPAL|PROPERTY TAX|PANCHAYAT", None, "Utilities & bills"),
    # Entertainment & subscriptions
    (r"NETFLIX", "Netflix", "Subscriptions"), (r"SPOTIFY", "Spotify", "Subscriptions"),
    (r"HOTSTAR|DISNEY", "JioHotstar", "Subscriptions"), (r"YOUTUBE", "YouTube", "Subscriptions"),
    (r"PRIME VIDEO|AMAZON PRIME", "Amazon Prime", "Subscriptions"), (r"APPLE\.COM|APPLE SERVICES|ITUNES", "Apple", "Subscriptions"),
    (r"GOOGLE ?PLAY|GOOGLE\s*\*|GOOGLEPLAY|GOOGLE ONE", "Google", "Subscriptions"), (r"MICROSOFT|MSFT", "Microsoft", "Subscriptions"),
    (r"OPENAI|CHATGPT", "OpenAI", "Subscriptions"), (r"ANTHROPIC|CLAUDE\.AI", "Anthropic", "Subscriptions"),
    (r"BOOKMYSHOW|BIGTREE", "BookMyShow", "Entertainment"), (r"PVR|INOX|CINEPOLIS", None, "Entertainment"),
    # Health
    (r"APOLLO", "Apollo", "Health"), (r"PHARMEASY", "PharmEasy", "Health"), (r"NETMEDS", "Netmeds", "Health"),
    (r"TATA ?1MG|\b1MG\b", "Tata 1mg", "Health"), (r"MEDPLUS", "MedPlus", "Health"),
    (r"CULT\.?FIT|CUREFIT", "Cult.fit", "Health"),
    (r"PHARMA|MEDICAL|HOSPITAL|CLINIC|DIAGNOSTIC|\bLABS?\b|DENTAL|HEALTH", None, "Health"),
    # Investments
    (r"ZERODHA", "Zerodha", "Investments"), (r"GROWW|NEXTBILLION", "Groww", "Investments"),
    (r"KUVERA", "Kuvera", "Investments"), (r"UPSTOX|RKSV", "Upstox", "Investments"),
    (r"COIN ?DCX|WAZIRX", None, "Investments"),
    (r"\bCAMS\b|KFIN|KARVY|MUTUAL ?FUND|\bMF\b|\bSIP\b|BSE ?STAR|ICCL|INDIAN CLEARING|NSE CLEARING|\bNSCCL\b", None, "Investments"),
    (r"\bPPF\b|\bNPS\b|\bRD\b|RECURRING DEP|FIXED DEP|\bFD\b|SUKANYA|SGB|GOLD BOND", None, "Investments"),
    # Insurance
    (r"\bLIC\b|LIFE INSURANCE CORP", "LIC", "Insurance"),
    (r"ICICI ?PRU", "ICICI Prudential", "Insurance"), (r"HDFC ?LIFE", "HDFC Life", "Insurance"), (r"SBI ?LIFE", "SBI Life", "Insurance"),
    (r"INSURANCE|POLICYBAZAAR|ERGO|LOMBARD|STAR HEALTH|ALLIANZ|MAX LIFE|TATA AIA|PRU ?LIFE|NIVA BUPA|CARE HEALTH|GO ?DIGIT|DIGIT INSURANCE", None, "Insurance"),
    # Loans & credit
    (r"\bEMI\b|LOAN|BAJAJ FIN|HOME FIN|\bHFC\b|\bHDFC LTD\b", None, "Loans & EMI"),
    (r"\bCRED\b|CREDIT ?CARD|\bCC ?PAY|CARD ?PAYMENT|\bCCBP\b|AUTOPAY.*CARD", None, "Credit card payments"),
    # Housing
    (r"\bRENT\b|NOBROKER|NESTAWAY|HOUSING\.COM|MAINTENANCE|SOCIETY|APARTMENT|ASSOCIATION", None, "Rent & housing"),
    # Income
    (r"SALARY|\bSAL\b|PAYROLL|\bSAL CR", None, "Salary & income"),
    (r"DIVIDEND|\bDIV\b", None, "Salary & income"),
    (r"REFUND|REVERSAL|CASHBACK|\bREV\b", None, "Refunds & cashback"),
    # Education
    (r"SCHOOL|COLLEGE|UNIVERSITY|TUITION|ACADEMY|COURSERA|UDEMY|BYJU|UNACADEMY", None, "Education"),
    # Wallets / gateways (only when nothing better matched)
    (r"PAYTM", "Paytm", "Wallets & payments"), (r"PHONEPE", "PhonePe", "Wallets & payments"),
    (r"MOBIKWIK", "MobiKwik", "Wallets & payments"),
    # Services
    (r"URBAN ?COMPANY|URBANCLAP", "Urban Company", "Services"), (r"SALON|SPA\b|LAUNDRY|DRY ?CLEAN", None, "Services"),
    # Tax & government
    (r"INCOME TAX|\bTDS\b|\bGST\b PAYMENT|CBDT|CHALLAN|\bTIN\b", None, "Taxes"),
]

MERCHANTS: list[tuple[re.Pattern[str], str | None, str]] = [(re.compile(p), n, c) for p, n, c in _RAW]

CATEGORIES = [
    "Salary & income", "Transfers in", "Refunds & cashback", "Interest",
    "Food & dining", "Groceries", "Shopping", "Travel & transport", "Fuel", "Telecom & internet",
    "Utilities & bills", "Subscriptions", "Entertainment", "Health", "Education", "Services",
    "Rent & housing", "Hotels & lodging", "Loans & EMI", "Credit card payments", "Insurance", "Investments", "Taxes",
    "Cash", "Bank charges", "Wallets & payments", "Transfers out", "Self transfers", "Cheques", "Auto-debits", "Other",
]
