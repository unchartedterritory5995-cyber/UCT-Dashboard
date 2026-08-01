"""The earnings wire — `GET /api/calendar/wire`.

A TABLE READ. Deliberately does no provider fan-out for the feed itself: the
detector job owns all provider work, so `first_seen_at` stays accurate when
nobody has the page open, alerts (Phase 3) fire unattended, and the request path
stays off the anyio threadpool — the 2026-07-01 524 class.

The only live call is the move overlay, which is a single cached full-market
snapshot shared across every row.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Query

from api.services.serve_stale import ServeStale
from api.services.wire import store
from api.services.wire.session import market_session_date

router = APIRouter()

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The move overlay hits one full-market snapshot. Served stale-while-revalidating
# so a burst of pollers during the 16:00 window collapses onto one provider call
# instead of one per request.
_MOVES_STALE = ServeStale("wire_moves", max_age_seconds=120)


def _snapshot() -> dict:
    from api.services.massive import _get_client
    return _get_client().get_full_market_snapshot()


def _live_moves(syms: list[str]) -> dict[str, float]:
    """Current move % per symbol, overlaid at read time — never stored.

    Storing it would freeze a row's reaction at whatever it was when the
    detector last ran; the move keeps developing after the print.
    """
    if not syms:
        return {}
    try:
        from api.services.wire.detect import move_pct
        snap = _MOVES_STALE.serve(
            "full",
            fresh=lambda: None,          # no separate TTL cache; the slot IS the cache
            build=_snapshot,
            good=bool,
        ) or {}
    except Exception:
        return {}
    out: dict[str, float] = {}
    for s in syms:
        mv = move_pct(snap.get(s) or {})
        if mv is not None:
            out[s] = round(mv, 2)
    return out


def _expected_count(market_date: str) -> int:
    """How many reporters are scheduled this session — drives the empty state."""
    try:
        from api.services.wire.detector import todays_reporters
        return len(todays_reporters(market_date))
    except Exception:
        return 0


@router.get("/api/calendar/wire")
def get_wire(date_str: str | None = Query(None, alias="date")):
    """The session's wire, oldest arrival first (the frontend reverses).

    The arg is `date_str` with `alias="date"`: naming it `date` would shadow
    `datetime.date`, which is exactly what 500ed calendar reactions on every
    past date for three weeks. The public `?date=` contract is unchanged.
    """
    if date_str and not _DATE_RE.match(date_str):
        md = market_session_date()
        return {"market_date": md, "rows": [], "expected": 0}

    md = date_str or market_session_date()
    rows = store.get_prints(md)
    moves = _live_moves([r["sym"] for r in rows])
    for r in rows:
        r["move_pct"] = moves.get(r["sym"])
    return {"market_date": md, "rows": rows, "expected": _expected_count(md)}


@router.get("/api/calendar/wire-status")
def wire_status(date_str: str | None = Query(None, alias="date")):
    """How the wire actually filled — the measurement Phase 2 is aimed by.

    `price_first` vs `actuals_first` answers the spec's open question: how much
    work the price trigger is really doing, i.e. how far behind the structured
    providers land after a print. If price_first dominates, the Twitter rung in
    Phase 2 is worth building; if actuals arrive first anyway, it is not.
    """
    md = date_str if (date_str and _DATE_RE.match(date_str)) else market_session_date()
    rows = store.get_prints(md)

    # Liveness. `enabled` is read from the LIVE process env, so this also proves
    # whether a WIRE_ENABLED change actually reached the running pod. A detector
    # that is enabled but has never ticked is the state worth catching.
    import os
    import time as _time
    from api.services.wire.detector import LAST_TICK
    last_at = LAST_TICK.get("at")

    return {
        "market_date":    md,
        "enabled":        os.environ.get("WIRE_ENABLED", "") == "1",
        "last_tick_age_s": round(_time.time() - last_at, 1) if last_at else None,
        "last_tick":      {k: LAST_TICK.get(k) for k in ("scanned", "written", "error")}
                          if last_at else None,
        "rows":           len(rows),
        "with_actuals":   sum(1 for r in rows if r.get("eps_act") is not None),
        "price_first":    sum(1 for r in rows if r.get("trigger") == "price"),
        "actuals_first":  sum(1 for r in rows if r.get("trigger") == "actuals"),
        "still_pending":  sum(1 for r in rows if r.get("eps_act") is None),
    }
