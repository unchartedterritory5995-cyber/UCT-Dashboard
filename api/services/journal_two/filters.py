"""Versioned server-side filter contract (FilterSpec v1) — spec §6.

One pydantic model, one WHERE-fragment compiler for j2_trades. Calendar/
options adapters arrive in P3; this module is the single place filter
params are parsed — endpoints never read filter query params directly.
"""
from __future__ import annotations

from pydantic import BaseModel, field_validator


class FilterSpec(BaseModel):
    version: int = 1
    date_from: str | None = None
    date_to: str | None = None
    symbol: str | None = None
    sides: list[str] = []
    setups: list[str] = []
    tags: list[str] = []
    limit: int | None = None
    offset: int | None = None

    @field_validator("limit")
    @classmethod
    def _clamp_limit(cls, v: int | None) -> int | None:
        # None = "no paging requested" → stays None so list_trades_for_user
        # emits NO SQL LIMIT (fully unbounded — the pre-regression contract).
        # A concrete value clamps to 1..2000 (community_trades bound); an
        # explicit 0 clamps to the floor.
        if v is None:
            return None
        return max(1, min(int(v), 2000))

    @field_validator("offset")
    @classmethod
    def _clamp_offset(cls, v: int | None) -> int | None:
        if v is None:
            return None
        return max(0, int(v))


# Date spine: prefer the ET trading day; fall back to the exit-date prefix for
# rows written before the trading_day_et backfill.
_DAY = "COALESCE(trading_day_et, substr(exit_date, 1, 10))"


def trades_where(spec: FilterSpec) -> tuple[str, list]:
    """Compile a WHERE fragment (each clause prefixed with AND) + its params.

    Callers splice the fragment after their own base predicate, e.g.
    `SELECT ... WHERE user_id = ? {frag}`.
    """
    frag, params = [], []
    if spec.date_from:
        frag.append(f"AND {_DAY} >= ?")
        params.append(spec.date_from)
    if spec.date_to:
        frag.append(f"AND {_DAY} <= ?")
        params.append(spec.date_to)
    if spec.symbol:
        frag.append("AND UPPER(symbol) LIKE ? || '%'")
        params.append(spec.symbol.strip().upper())
    if spec.sides:
        frag.append(f"AND side IN ({','.join('?' * len(spec.sides))})")
        params.extend(spec.sides)
    if spec.setups:
        frag.append(f"AND setup IN ({','.join('?' * len(spec.setups))})")
        params.extend(spec.setups)
    if spec.tags:
        # A trade matches if ANY selected tag is present in EITHER the
        # mistake_tags OR emotion_tags JSON-array TEXT column. Both are
        # nullable → COALESCE to an empty array. Empty tags emits no fragment.
        ph = ",".join("?" * len(spec.tags))
        frag.append(
            "AND (EXISTS (SELECT 1 FROM json_each(COALESCE(mistake_tags,'[]'))"
            " WHERE value IN (%s))"
            " OR EXISTS (SELECT 1 FROM json_each(COALESCE(emotion_tags,'[]'))"
            " WHERE value IN (%s)))" % (ph, ph)
        )
        params.extend(spec.tags)
        params.extend(spec.tags)
    return (" ".join(frag), params)


def parse_filter_query(
    date_from: str | None = None, date_to: str | None = None,
    symbol: str | None = None, sides: str | None = None,
    setups: str | None = None, tags: str | None = None,
    limit: int | None = None, offset: int | None = None,
) -> FilterSpec:
    """FastAPI dependency: comma-joined sets, URL-decoded members.

    A comma inside a member (e.g. a setup name) is expected on the wire as
    %2C so it survives the comma split, then unquote() restores the literal.

    An UNSET limit/offset query param stays None (no paging requested → the
    query is unbounded, matching the pre-Phase-6 route). Paging is opt-in.
    """
    from urllib.parse import unquote

    def split(s: str | None) -> list[str]:
        return [unquote(x) for x in s.split(",") if x] if s else []

    return FilterSpec(
        date_from=date_from, date_to=date_to, symbol=symbol,
        sides=split(sides), setups=split(setups), tags=split(tags),
        limit=limit, offset=offset,
    )
