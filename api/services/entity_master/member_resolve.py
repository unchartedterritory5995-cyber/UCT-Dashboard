"""TERM-023 (FB-S3-01) -- the Entity Master's MEMBER path.

The store, its dated alias list and `store.alias_candidates_as_of()` shipped
ADMIN-MOUNTED (`api/routers/entity_master_admin.py`). This module is the one
place a member-facing surface asks it a question, so the two member doors --
`GET /api/entity/resolve` and the ticker-search adoption hook -- cannot drift
into two resolution behaviours.

⛔ DARK. `ENTITY_MASTER_MEMBER_ENABLED` is an enablement gate: unset, "0",
"false", "no" or "off" is OFF. It is read PER CALL, never captured at import,
so unsetting it takes effect on the next request. While it is off the store is
never opened by either door -- nothing in this module is reached.

⛔ THE KILL SWITCH IS NEVER A DELETE. Turning this off stops the doors; every
row in `entity_master.db` stays exactly where it is.

⛔ A SYMBOL UNIVERSE DOES NOT SETTLE A TICKER MATCH. A query is resolved
exactly as typed (trimmed, upper-cased). It is never filtered through
`cap_universe`, a word list or a length rule -- GAP, RS, EMA, MA and PEG are
real tickers, and the store is the only authority on whether it knows one.

⛔ NO DEFAULTING. A malformed `as_of` is refused by the caller, never read as
"now"; a date in the gap between two owners resolves to nothing, never to the
nearest owner; an ambiguous alias keys to no one and names every candidate.

Observability: per-status counts of the member resolutions this process
answered, and the rows the search hook examined vs keyed -- published beside
the admin status route's numbers, each with its denominator. In-process, reset
on deploy, never persisted.
"""
from __future__ import annotations

import datetime
import logging
import os
import re
import threading
from collections import Counter
from typing import Optional

from api.services.entity_master import api as em_api

logger = logging.getLogger(__name__)

STATUSES = ("resolved", "not_found", "ambiguous")

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get("ENTITY_MASTER_MEMBER_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


# ── observability ───────────────────────────────────────────────────────────
_lock = threading.Lock()
_resolve_counts: Counter = Counter()
_search_rows = {"examined": 0, "keyed": 0}


def counts() -> dict:
    """Every status always present, so a 0 is a count and not an untracked
    status; `total` is the denominator the three are counted over."""
    with _lock:
        out = {s: int(_resolve_counts.get(s, 0)) for s in STATUSES}
        out["total"] = sum(out.values())
        return {"resolve": out, "search_rows": dict(_search_rows)}


def reset_counts() -> None:
    with _lock:
        _resolve_counts.clear()
        _search_rows["examined"] = 0
        _search_rows["keyed"] = 0


# ── the resolution door ─────────────────────────────────────────────────────

def parse_as_of(raw: Optional[str]) -> Optional[str]:
    """`None`/blank -> None ("now"). A real ISO calendar date -> itself.
    Anything else -> ValueError. Never guessed, never defaulted."""
    if raw is None or not str(raw).strip():
        return None
    s = str(raw).strip()
    if not _ISO_DATE.match(s):
        raise ValueError(f"as_of must be YYYY-MM-DD, got {s!r}")
    datetime.date.fromisoformat(s)  # raises on 2021-02-30
    return s


def normalize_query(q: str) -> str:
    return (q or "").strip().upper()


def resolve_for_member(q: str, as_of: Optional[str]) -> dict:
    """The member route's answer, keyed by ENTITY, never by the bare ticker.

    `as_of` must already be validated (`parse_as_of`). `aliases` is the full
    dated alias history of the resolved entity (closed rows included), so a
    renamed or reused ticker carries its own provenance."""
    alias = normalize_query(q)
    r = em_api.resolve(alias, as_of=as_of)
    body = {
        "query": alias,
        "asOf": as_of,
        "status": r.status,
        "entityId": None,
        "entity": None,
        "aliases": [],
        "candidates": [],
    }
    if r.status == "resolved" and r.entity is not None:
        e = r.entity
        body["entityId"] = e.entity_id
        body["entity"] = {
            "entityId": e.entity_id,
            "entityType": e.entity_type,
            "lifecycleState": e.lifecycle_state,
            "lifecycleSince": e.lifecycle_since,
        }
        body["aliases"] = [
            {"alias": a.alias, "validFrom": a.valid_from, "validTo": a.valid_to}
            for a in em_api.aliases(e.entity_id)
        ]
    elif r.status == "ambiguous":
        body["candidates"] = list(r.candidates)
    with _lock:
        _resolve_counts[r.status] += 1
    return body


# ── the search adoption hook ────────────────────────────────────────────────

def _is_instrument(row: dict) -> bool:
    """UCT breadth / indicator pseudo-tickers have no entity by construction."""
    return not (row.get("breadth") or row.get("indicator"))


def _row_as_of(row: dict) -> tuple[bool, Optional[str]]:
    """(resolvable, as_of). A delisted row names the DEAD company, so it is
    resolved at the start of the registry's own window for it -- the same
    `valid_from` the seed wrote. A live row is resolved as of now."""
    if not row.get("delisted"):
        return True, None
    try:
        from api.services import delisted_registry
        rec = delisted_registry.get(row.get("ticker") or "")
    except Exception:  # noqa: BLE001 -- the registry is best-effort here
        rec = None
    first = (rec or {}).get("first_date")
    return (bool(first), first or None)


def attach_entity_ids(rows: list) -> list:
    """Key every instrument row to the entity the store holds for it, at the
    row's own date. A ticker the store does not know is honestly null, and says
    so in `entity_status`. Returns new row dicts; never raises -- on any failure
    the rows come back exactly as they went in."""
    try:
        out = []
        examined = keyed = 0
        for row in rows:
            if not _is_instrument(row):
                out.append(row)
                continue
            new = dict(row)
            ok, as_of = _row_as_of(row)
            examined += 1
            if not ok:
                new["entity_id"] = None
                new["entity_status"] = "not_found"
            else:
                r = em_api.resolve(row.get("ticker") or "", as_of=as_of)
                new["entity_id"] = r.entity.entity_id if (r.status == "resolved" and r.entity) else None
                new["entity_status"] = r.status
                if new["entity_id"]:
                    keyed += 1
            out.append(new)
        with _lock:
            _search_rows["examined"] += examined
            _search_rows["keyed"] += keyed
        return out
    except Exception as exc:  # noqa: BLE001 -- search must keep answering
        logger.warning("[entity_master.member] attach_entity_ids failed: %s", exc)
        return rows
