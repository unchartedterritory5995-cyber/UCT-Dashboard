"""Per-trigger-type queue caps with a reserve (Alerts PRD AC-4, SPEC-S7 §16).

K7's named limitation: one GLOBAL cap per member means a flood of one trigger
type (catalyst-match on a hot tape) starves every other (position-risk) in the
same window. This replaces "one global cap" with three numbers per member and
rolling window:

  * TOTAL     -- the most S7 notifications one member is SENT per window.
  * CAP[t]    -- the most any one trigger type may take of that.
  * RESERVE[t] -- slots held back for type t: no OTHER type may consume them.

A fire of type t is admitted iff
    used[t] < CAP[t]  and
    ( used[t] < RESERVE[t]                                   -- inside its own reserve
      or total_used + sum_{u != t} max(0, RESERVE[u] - used[u]) < TOTAL )  -- shared pool

so a flood of t exhausts the shared pool and its own cap, and never the
reserve of any other type.

THE RULES.
  * ⛔ A CAPPED FIRE IS STILL RECORDED. `alert_fires` already holds it (the
    durable S7 record); its delivery outcome is `{"queue": "capped"}` and
    nothing is sent. Never a delete, never a silent drop.
  * The window counts fires that were actually SENT -- a capped or a
    routing-suspended fire consumes nothing.
  * Changes only what happens AFTER a condition is true (SPEC §16): no
    evaluation cycle's cadence moves.
  * DARK: `ALERT_QUEUE_CAPS_ENABLED` (default off, read per call). Off, every
    fire is admitted and delivery is byte-identical to before.
  * A store error ADMITS (fails to the pre-cap behaviour): a counting failure
    must never cost a member an alert.
"""
from __future__ import annotations

import json
import os
import time
from typing import Optional

from api.services.alert_taxonomy import db as _db

FLAG = "ALERT_QUEUE_CAPS_ENABLED"
WINDOW_S = 3600
TOTAL = 30
#: Default per-type ceiling (a type may not take more than this of TOTAL).
DEFAULT_CAP = 12
#: Default per-type reserve.
DEFAULT_RESERVE = 1
#: Per-type overrides. position-risk is about the member's own money: it gets
#: the deepest reserve. catalyst-match is the type that floods.
CAPS = {"catalyst-match": 8}
RESERVES = {"position-risk": 4, "price-level": 3, "document-arrival": 2,
            "rating-change": 2}
#: Every type the reserve arithmetic knows about (a type absent here still
#: gets DEFAULT_RESERVE once it has been seen in the window).
KNOWN_TYPES = ("catalyst-match", "document-arrival", "event-proximity",
               "indicator-condition", "position-risk", "price-level",
               "rating-change", "regime-change", "scan-membership-change")

CAPPED = {"queue": "capped"}


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def cap_for(t: str) -> int:
    return int(CAPS.get(t, DEFAULT_CAP))


def reserve_for(t: str) -> int:
    return int(RESERVES.get(t, DEFAULT_RESERVE))


def decide(trigger_type: str, used: dict[str, int], *, total: int = TOTAL) -> bool:
    """The pure admission rule. `used` = sent-in-window counts per type."""
    mine = int(used.get(trigger_type, 0))
    if mine >= cap_for(trigger_type):
        return False
    if mine < reserve_for(trigger_type):
        return True
    types = set(KNOWN_TYPES) | set(used)
    held = sum(max(0, reserve_for(u) - int(used.get(u, 0)))
               for u in types if u != trigger_type)
    return sum(int(v) for v in used.values()) + held < total


def _sent(channels_json: Optional[str]) -> bool:
    if not channels_json:
        return False
    try:
        ch = json.loads(channels_json)
    except (TypeError, ValueError):
        return False
    if not isinstance(ch, dict) or "queue" in ch or "routing" in ch:
        return False
    return any(v == "ok" for v in ch.values())


def used_in_window(user_id: str, *, now: float | None = None, exclude_fire_id: int | None = None,
                   db_path: str | None = None) -> dict[str, int]:
    now = time.time() if now is None else now
    c = _db.connect(db_path)
    try:
        _db.init_db(c)
        rows = c.execute(
            "SELECT id, trigger_type, delivery_channels FROM alert_fires"
            " WHERE user_id = ? AND fired_at >= ?", (str(user_id), now - WINDOW_S)).fetchall()
    finally:
        c.close()
    out: dict[str, int] = {}
    for r in rows:
        if exclude_fire_id is not None and r["id"] == exclude_fire_id:
            continue
        if _sent(r["delivery_channels"]):
            out[r["trigger_type"]] = out.get(r["trigger_type"], 0) + 1
    return out


def trigger_type_of(fire_id: int, *, db_path: str | None = None) -> Optional[str]:
    """The fire's own trigger type -- read from its row, the one authority."""
    c = _db.connect(db_path)
    try:
        _db.init_db(c)
        r = c.execute("SELECT trigger_type FROM alert_fires WHERE id = ?", (int(fire_id),)).fetchone()
    finally:
        c.close()
    return r["trigger_type"] if r else None


def admit(user_id: str, trigger_type: str, *, fire_id: int | None = None, now: float | None = None,
          db_path: str | None = None) -> bool:
    """True when this fire may be sent. Always True while dark or on error."""
    if not is_enabled() or not user_id:
        return True
    try:
        used = used_in_window(user_id, now=now, exclude_fire_id=fire_id, db_path=db_path)
    except Exception:  # noqa: BLE001 -- a counting failure never costs the alert
        return True
    return decide(trigger_type, used)


def published() -> dict:
    """What a member (and the ops monitor) is told the queue does."""
    return {"enabled": is_enabled(), "window_s": WINDOW_S, "total": TOTAL,
            "types": {t: {"cap": cap_for(t), "reserve": reserve_for(t)} for t in KNOWN_TYPES}}
