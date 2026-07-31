"""The wire's only network-touching module.

Runs on the WEB pod next to the catalyst engine — Phase 3 alerts need auth.db,
which is web-local — and is registered with `max_instances=1` so a slow tick can
never stack on the next one.

Restart-safe by construction: the store is the truth, so a redeploy mid-window
loses nothing. `existing` is re-read every tick, so a row already recorded is
recognised and upgraded rather than re-created with a fresh arrival time.

`run_wire_tick` NEVER raises. A scheduler job that dies on a provider blip would
silently stop the wire for the rest of the window, which is the failure mode
this whole design exists to avoid.
"""
from __future__ import annotations

import logging
import time

from api.services.wire import detect, store
from api.services.wire.session import market_session_date

_logger = logging.getLogger(__name__)


def _market_snapshot() -> dict:
    """One all-tickers call: extended-hours-aware `last_price`, `prev_close`,
    `today_vol` and `prev_vol` for every symbol.

    Deliberately the full-market endpoint rather than a per-symbol fan-out — one
    request covers all ~250 reporters AND carries the volume the liquidity gate
    needs, so a 250-name night costs exactly one call per tick.
    """
    from api.services.massive import _get_client
    return _get_client().get_full_market_snapshot()


def todays_reporters(market_date: str) -> list[dict]:
    """This session's reporters with whatever estimates/actuals exist so far.

    Reuses the calendar payload — the wire adds no second earnings schedule, so
    it can never disagree with the board about who is reporting.
    """
    from api.routers.calendar import get_calendar
    payload = get_calendar() or {}
    day = (payload.get("days") or {}).get(market_date) or {}
    out = []
    for timing in ("bmo", "amc", "tbd"):
        for e in day.get(timing) or []:
            if e.get("sym"):
                out.append({
                    "sym": e["sym"], "timing": timing,
                    "eps_est": e.get("eps_est"), "rev_est": e.get("rev_est"),
                    "eps_act": e.get("eps_act"), "rev_act": e.get("rev_act"),
                })
    return out


def run_wire_tick(now_ts: float | None = None) -> dict:
    """One detection pass. Returns a small summary; never raises."""
    ts = time.time() if now_ts is None else now_ts
    md = market_session_date()
    result: dict = {"market_date": md, "scanned": 0, "written": 0}
    try:
        reporters = todays_reporters(md)
        result["scanned"] = len(reporters)
        if not reporters:
            return result                      # holiday / Friday night — correct

        try:
            snapshot = _market_snapshot()
        except Exception as exc:               # price gone -> actuals still land
            _logger.warning("wire: snapshot failed: %s", exc)
            snapshot = {}

        existing = {r["sym"]: r for r in store.get_prints(md)}
        rows = detect.detect_rows(reporters, snapshot, existing, ts, md)
        for row in rows:
            store.upsert_print(row)
        result["written"] = len(rows)
    except Exception as exc:
        _logger.warning("wire: tick failed: %s", exc)
        result["error"] = str(exc)
    return result
