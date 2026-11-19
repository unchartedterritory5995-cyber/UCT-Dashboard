"""MD-1 kind `analyst.actions` (owner: terminal-data, data wave 1) — analyst upgrades, downgrades and target changes.

A thin adapter over the morning wire's own list: `services/engine.get_analyst_actions()` (the read behind
`GET /api/analyst-actions`). No provider call, no write: the wire is PUSHED to this server and the service reads it.

WHICH MORNING (MD-1 §3: the data's own time)
  * The list is served unchanged until the next wire is pushed, so it is NEVER worded as "today's". `as_of` is the
    wire's own date (`wire_date`), as the start of that Eastern day; a date, not a time (a note says so).
  * No `wire_date` (a server that holds no dated wire) → `as_of` is null with a note, and the read is `stale`
    (unknown is never claimed fresh).
  * `stale` = the service's OWN verdict (`wire_status` from `engine.wire_freshness`), reused, never restated here.
  * freshness `periodic` (one list per morning wire).

MODEL-ISOLATED (ADR-005): the rows are third-party analyst calls (a broker's rating and price target, relayed by the
wire's vendors) whose AI-processing right is unresolved in the provider ledger, the same reason `catalysts.board`'s
stored headlines are isolated. Shown to the member only; the reading capability is local-only.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "analyst.actions"
SOURCE = "uct-morning-wire"
#: the service's three lists, by the payload's own keys; `all` is every one
BUCKETS = ("upgrades", "downgrades", "pt_changes")
SIDES = ("all",) + BUCKETS
ITEM_FIELDS = ("ticker", "action", "firm", "from_rating", "to_rating", "price_target")
_ET = ZoneInfo("America/New_York")

NOTE_NO_WIRE = "no morning wire with analyst actions is held on this server yet"
NOTE_FROM_WIRE = ("analyst actions from the {date} morning wire; the list is served unchanged until the next wire is "
                  "pushed, so it may not be today's")
NOTE_DATE_ONLY = "as_of is the morning wire's date (a date, not a time of day)"
NOTE_UNDATED = ("the wire this list came from carries no date, so as_of is not given and the list cannot be called "
                "current")
NOTE_BEHIND = "a newer morning wire is expected by now: this list is from {date}"
NOTE_EMPTY = "the {date} morning wire lists no analyst actions of this kind"
NOTE_FAILED = "the morning wire's analyst actions could not be read"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    side = params.get("side", "all")
    if side not in SIDES:
        return "`side` must be one of " + ", ".join(SIDES)
    return None


def _item(a: Any) -> Optional[dict]:
    if not isinstance(a, dict) or not str(a.get("ticker") or "").strip():
        return None
    return {k: a.get(k) for k in ITEM_FIELDS}


def _wire_day(wire_date: Any) -> Optional[str]:
    """`YYYY-MM-DD` when the wire's date is a real calendar day, else None."""
    try:
        return datetime.fromisoformat(str(wire_date)[:10]).date().isoformat()
    except (TypeError, ValueError):
        return None


def read_analyst_actions(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    side = params.get("side", "all")
    try:
        from api.services import engine
        payload = engine.get_analyst_actions()
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never a guess
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not isinstance(payload, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    lists = {b: [x for x in (_item(a) for a in (payload.get(b) or [])) if x] if side in ("all", b) else []
             for b in BUCKETS}
    total = sum(len(v) for v in lists.values())
    day = _wire_day(payload.get("wire_date"))
    status_word = str(payload.get("wire_status") or "unknown").lower()
    if day is None and not total:
        return env.unavailable(KIND, params, SOURCE, NOTE_NO_WIRE)

    notes: list[str] = []
    if day is None:
        as_of, stale = None, True
        notes.append(NOTE_UNDATED)
    else:
        y, m, d = (int(p) for p in day.split("-"))
        as_of = env.utc_iso(datetime(y, m, d, tzinfo=_ET))
        stale = status_word != "fresh"
        notes += [NOTE_FROM_WIRE.format(date=day), NOTE_DATE_ONLY]
        if stale:
            notes.append(NOTE_BEHIND.format(date=day))
        if not total:
            notes.append(NOTE_EMPTY.format(date=day))
    data = {**lists, "summary": {b: len(lists[b]) for b in BUCKETS}, "side": side, "wire_date": day,
            "wire_status": status_word if status_word in ("fresh", "stale", "unknown") else "unknown"}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=as_of, source=SOURCE, data=data,
                             stale=stale, notes=notes, provider_calls=0,
                             coverage={"evaluated": total, "answered": total, "dropped": 0, "not_computable": 0})
