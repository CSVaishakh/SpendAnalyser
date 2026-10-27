from __future__ import annotations

from pydantic import BaseModel, Field


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    bank: str | None = Field(default=None, max_length=80)
    number: str | None = Field(default=None, max_length=40)


class RuleIn(BaseModel):
    field: str = "any"
    match_mode: str = "contains"
    pattern: str = Field(min_length=1, max_length=500)
    set_entity: str | None = Field(default=None, max_length=160)
    set_category: str | None = Field(default=None, max_length=64)
    set_kind: str | None = Field(default=None, pattern="^(person|business|cash)?$")


class RuleOut(RuleIn):
    id: int
    position: int
    hits: int = 0


class ReorderIn(BaseModel):
    ids: list[int]


class RenameIn(BaseModel):
    name: str
    new_name: str | None = Field(default=None, max_length=160)
    category: str | None = Field(default=None, max_length=64)
    kind: str | None = Field(default=None, pattern="^(person|business|cash)?$")
