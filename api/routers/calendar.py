"""Weekly earnings + economic events calendar endpoint.

Data priority:
  1. wire_data['weekly_calendar'] — AI-curated econ events + multi-source earnings (rich)
  2. EarningsWhispers live fetch for each weekday — earnings only, no econ events
  3. Empty structure — graceful fallback
"""

from __future__ import annotations
import logging
import threading
from datetime import date, timedelta
from fastapi import APIRouter
from api.services.cache import cache

_logger = logging.getLogger(__name__)
router = APIRouter()

_CACHE_TTL = 1800  # 30 min


# ── Helpers ───────────────────────────────────────────────────────────────────

def _week_dates() -> list[date]:
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    return [monday + timedelta(days=i) for i in range(5)]


def _empty_day(d: date, today: date) -> dict:
    return {
        "label":    d.strftime("%a %b ") + str(d.day),
        "day":      d.strftime("%A"),
        "is_today": d == today,
        "bmo":      [],
        "amc":      [],
        "econ":     [],
        "fed":      [],
    }


# ── Wire data path ─────────────────────────────────────────────────────────────

def _from_wire(wire_calendar: dict, week_dates: list[date], today: date) -> dict:
    """Normalize a wire_data['weekly_calendar'] dict into the calendar day structure."""
    days: dict[str, dict] = {}
    for d in week_dates:
        ds = d.strftime("%Y-%m-%d")
        wd = wire_calendar.get(ds, {})

        def _chip(c: dict) -> dict:
            rev = c.get("rev_est")
            # Wire chips store rev as raw dollars (millions × 1_000_000); convert back to millions.
            if rev is not None and rev > 1_000_000:
                rev = rev / 1_000_000
            return {
                "sym":     c.get("sym", ""),
                "eps_est": c.get("eps_est"),
                "eps_act": c.get("eps_act"),
                "rev_est": rev,
                "ew":      int(c.get("ew", c.get("ew_total", 0)) or 0),
            }

        days[ds] = {
            "label":    wd.get("label", d.strftime("%a %b ") + str(d.day)),
            "day":      wd.get("day",   d.strftime("%A")),
            "is_today": d == today,
            "bmo":      [_chip(c) for c in wd.get("bmo", [])],
            "amc":      [_chip(c) for c in wd.get("amc", [])],
            "econ":     wd.get("econ", []),
            "fed":      wd.get("fed",  []),
        }
    return days


# ── Live EarningsWhispers path ─────────────────────────────────────────────────

def _build_live(week_dates: list[date], today: date) -> dict:
    """Parallel EarningsWhispers fetch for each weekday. No econ events."""
    from api.services.engine import _fetch_ew_live

    results: dict[str, dict] = {}

    def _fetch(d: date) -> None:
        ds = d.strftime("%Y-%m-%d")
        try:
            raw = _fetch_ew_live(ds)
        except Exception as exc:
            _logger.warning("EW fetch failed for %s: %s", ds, exc)
            raw = []

        bmo: list[dict] = []
        amc: list[dict] = []
        for item in raw:
            entry = {
                "sym":     item["symbol"],
                "eps_est": item.get("eps_estimate"),
                "eps_act": item.get("eps_actual"),
                "rev_est": item.get("rev_estimate"),  # already in millions from _fetch_ew_live
                "ew":      int(item.get("ew_total", 0) or 0),
            }
            (bmo if item["hour"] == "bmo" else amc).append(entry)

        bmo.sort(key=lambda x: x["ew"], reverse=True)
        amc.sort(key=lambda x: x["ew"], reverse=True)

        results[ds] = {
            "label":    d.strftime("%a %b ") + str(d.day),
            "day":      d.strftime("%A"),
            "is_today": d == today,
            "bmo":      bmo[:40],
            "amc":      amc[:40],
            "econ":     [],
            "fed":      [],
        }

    threads = [threading.Thread(target=_fetch, args=(d,)) for d in week_dates]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    return results


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/api/calendar")
def get_calendar():
    cached = cache.get("calendar_weekly")
    if cached is not None:
        return cached

    week_dates = _week_dates()
    today      = date.today()
    week_start = week_dates[0].isoformat()
    week_end   = week_dates[-1].isoformat()

    # ── 1. Wire data (AI-curated econ + multi-source earnings) ────────────────
    try:
        from api.services.engine import _load_wire_data
        wire = _load_wire_data()
        if wire and wire.get("weekly_calendar"):
            days = _from_wire(wire["weekly_calendar"], week_dates, today)
            result = {
                "week_start": week_start,
                "week_end":   week_end,
                "days":       days,
                "source":     "wire",
            }
            cache.set("calendar_weekly", result, ttl=_CACHE_TTL)
            return result
    except Exception as exc:
        _logger.warning("Calendar: wire_data path error: %s", exc)

    # ── 2. Live EarningsWhispers (earnings only) ───────────────────────────────
    try:
        days = _build_live(week_dates, today)
        for d in week_dates:
            ds = d.strftime("%Y-%m-%d")
            if ds not in days:
                days[ds] = _empty_day(d, today)
        result = {
            "week_start": week_start,
            "week_end":   week_end,
            "days":       days,
            "source":     "live",
        }
        cache.set("calendar_weekly", result, ttl=_CACHE_TTL)
        return result
    except Exception as exc:
        _logger.warning("Calendar: live build error: %s", exc)

    # ── 3. Empty fallback ─────────────────────────────────────────────────────
    days = {d.strftime("%Y-%m-%d"): _empty_day(d, today) for d in week_dates}
    return {
        "week_start": week_start,
        "week_end":   week_end,
        "days":       days,
        "source":     "empty",
    }
