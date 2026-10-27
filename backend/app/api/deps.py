import datetime as dt

from fastapi import Query

from ..services.analytics import Filters


def filters(
    start: dt.date | None = Query(None, description="Inclusive start date (YYYY-MM-DD)"),
    end: dt.date | None = Query(None, description="Inclusive end date (YYYY-MM-DD)"),
    q: str | None = Query(None, max_length=200),
    direction: str | None = Query(None, pattern="^(in|out)$"),
    category: str | None = None,
    channel: str | None = None,
    entity: str | None = None,
    account: int | None = Query(None, description="Limit to one account; omit for all accounts combined"),
    kind: str | None = Query(None, pattern="^(person|business|self|cash|bank|unknown)$"),
    app: str | None = Query(None, max_length=24, description="UPI app used to pay, e.g. 'Google Pay' or 'super.money'"),
) -> Filters:
    return Filters(start, end, q or None, direction, category or None, channel or None, entity or None, account, kind, app or None)
