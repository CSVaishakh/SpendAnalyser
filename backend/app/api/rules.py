from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Rule, Transaction
from ..schemas import ReorderIn, RenameIn, RuleIn
from ..services.rules import reapply_all, validate

router = APIRouter(prefix="/api", tags=["rules"])


def _out(r: Rule, hits: dict[int, int]) -> dict:
    return {"id": r.id, "position": r.position, "field": r.field, "match_mode": r.match_mode, "pattern": r.pattern,
            "set_entity": r.set_entity, "set_category": r.set_category, "set_kind": r.set_kind, "hits": hits.get(r.id, 0)}


def _hits(session: Session) -> dict[int, int]:
    return dict(session.execute(select(Transaction.rule_id, func.count()).where(Transaction.rule_id.is_not(None)).group_by(Transaction.rule_id)).all())


def _check(body: RuleIn) -> None:
    try:
        validate(body.field, body.match_mode, body.pattern)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    if not (body.set_entity or body.set_category or body.set_kind):
        raise HTTPException(422, "A rule must set a payee name, a category or person/business.")


def _clean(body: RuleIn) -> dict:
    d = body.model_dump()
    d["pattern"] = d["pattern"].strip()
    d["set_entity"] = (d["set_entity"] or "").strip() or None
    d["set_category"] = (d["set_category"] or "").strip() or None
    d["set_kind"] = d.get("set_kind") or None
    return d


@router.get("/rules")
def list_rules(session: Session = Depends(get_session)):
    hits = _hits(session)
    return [_out(r, hits) for r in session.scalars(select(Rule).order_by(Rule.position, Rule.id))]


@router.post("/rules", status_code=201)
def create_rule(body: RuleIn, session: Session = Depends(get_session)):
    _check(body)
    top = session.scalar(select(func.min(Rule.position))) or 0
    r = Rule(**_clean(body), position=top - 1)  # new rules take precedence
    session.add(r)
    session.flush()
    reapply_all(session)
    session.commit()
    return _out(r, _hits(session))


@router.put("/rules/{rule_id}")
def update_rule(rule_id: int, body: RuleIn, session: Session = Depends(get_session)):
    _check(body)
    r = session.get(Rule, rule_id)
    if not r:
        raise HTTPException(404, "Rule not found")
    for k, v in _clean(body).items():
        setattr(r, k, v)
    reapply_all(session)
    session.commit()
    return _out(r, _hits(session))


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: int, session: Session = Depends(get_session)):
    r = session.get(Rule, rule_id)
    if not r:
        raise HTTPException(404, "Rule not found")
    session.delete(r)
    session.flush()
    reapply_all(session)
    session.commit()


@router.post("/rules/reorder")
def reorder(body: ReorderIn, session: Session = Depends(get_session)):
    rules = {r.id: r for r in session.scalars(select(Rule))}
    for pos, rid in enumerate(body.ids):
        if rid in rules:
            rules[rid].position = pos
    reapply_all(session)
    session.commit()
    return list_rules(session)


@router.post("/rules/import")
def import_rules(body: list[RuleIn], session: Session = Depends(get_session)):
    for b in body:
        _check(b)
    base = (session.scalar(select(func.max(Rule.position))) or 0) + 1
    for i, b in enumerate(body):
        session.add(Rule(**_clean(b), position=base + i))
    session.flush()
    reapply_all(session)
    session.commit()
    return list_rules(session)


@router.post("/entities/rename")
def rename_entity(body: RenameIn, session: Session = Depends(get_session)):
    """Rename / merge / recategorise a payee by pinning exact-match rules on every auto-detected name grouped under it."""
    new_name = (body.new_name or "").strip() or None
    category = (body.category or "").strip() or None
    kind = body.kind or None
    if not (new_name or category or kind):
        raise HTTPException(422, "Provide a new name, a category or person/business.")
    autos = sorted(set(session.scalars(select(Transaction.auto_entity).where(Transaction.entity == body.name))))
    if not autos:
        raise HTTPException(404, "Payee not found")
    from ..services.entities import is_cash_category

    stays_cash = category == "Cash" or (category is None and is_cash_category(
        list(session.scalars(select(Transaction).where(Transaction.entity == body.name)))))
    if kind and kind != "cash" and stays_cash:
        raise HTTPException(422, "Payees in the Cash category are always type Cash. Change the category first.")
    top = session.scalar(select(func.min(Rule.position))) or 0
    for auto in autos:
        existing = session.scalars(select(Rule).where(Rule.field == "entity", Rule.match_mode == "exact", Rule.pattern == auto)).first()
        prior_cat = existing.set_category if existing else None
        prior_kind = existing.set_kind if existing else None
        if existing:
            session.delete(existing)
        top -= 1
        session.add(Rule(field="entity", match_mode="exact", pattern=auto, position=top,
                         set_entity=new_name or body.name, set_category=category or prior_cat,
                         set_kind=kind or prior_kind))
    session.flush()
    changed = reapply_all(session)
    session.commit()
    # Report where the payee ended up (marking it as cash moves it under "Cash withdrawal").
    landed = session.scalars(select(Transaction.entity).where(Transaction.auto_entity.in_(autos))).first()
    return {"name": landed or new_name or body.name, "rules": len(autos), "transactions_changed": changed}
