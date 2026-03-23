"""Weekly earnings + economic events calendar endpoint.

Data priority:
  1. wire_data['weekly_calendar'] — AI-curated econ events + multi-source earnings (rich)
  2. EarningsWhispers live fetch for each weekday — earnings only, no econ events
  3. Empty structure — graceful fallback

POST /api/calendar/refresh — rebuild cache immediately (earnings + Claude econ events)
"""

from __future__ import annotations
import json
import logging
import os
import re
import threading
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
from fastapi import APIRouter
from api.services.cache import cache

_logger = logging.getLogger(__name__)
router = APIRouter()

_CACHE_TTL = 1800  # 30 min


# ── Helpers ───────────────────────────────────────────────────────────────────

def _today_et() -> date:
    return datetime.now(_ET).date()


def _week_dates() -> list[date]:
    today = _today_et()
    dow = today.weekday()  # Mon=0 … Sun=6
    # On weekends jump forward to next Monday; on weekdays anchor to this Monday
    if dow >= 5:
        monday = today + timedelta(days=7 - dow)
    else:
        monday = today - timedelta(days=dow)
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
    today      = _today_et()
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


# ── Refresh endpoint ──────────────────────────────────────────────────────────

def _curate_econ_events(week_start: str, week_end: str, days: dict) -> None:
    """Call Claude Haiku to generate economic events and inject them into days in-place."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        system = (
            "You are a senior market strategist. Return a JSON object (no markdown, no extra text) "
            "mapping each trading day YYYY-MM-DD to its curated events. "
            "INCLUDE only high-impact events: FOMC decisions/minutes/speeches by voting members, "
            "CPI, PPI, PCE, NFP/payrolls, retail sales, GDP, ISM Manufacturing/Services, "
            "consumer confidence, durable goods, major Treasury auctions ($10B+), ECB/BOE/BOJ decisions. "
            "EXCLUDE: MBA apps, Redbook, Challenger, import/export prices, minor housing data. "
            "Mark is_key:true for FOMC/CPI/NFP/PCE/GDP only. "
            "Also include Fed speaker events and any major company conferences. "
            'JSON schema: {"2026-03-24": {"econ": [{"time": "08:30", "event": "CPI Jan", '
            '"estimate": "+0.3%", "prior": "+0.4%", "is_key": true}], '
            '"fed": [{"time": "10:00", "event": "Waller speaks", "note": "voting member"}]}}'
        )
        user = (
            f"Build the weekly calendar for {week_start} through {week_end} (US trading days only). "
            "Times must be ET. Use your knowledge of the actual scheduled events for this specific week. "
            "Return only the JSON object."
        )
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1500,
            messages=[{"role": "user", "content": f"{system}\n\n{user}"}],
        )
        raw = msg.content[0].text.strip()
        cleaned = re.sub(r"```[a-z]*\n?", "", raw).replace("```", "").strip()
        try:
            curated = json.loads(cleaned)
        except Exception:
            m = re.search(r'\{.*\}', cleaned, re.DOTALL)
            curated = json.loads(m.group()) if m else {}

        for ds, day_events in curated.items():
            if ds in days:
                days[ds]["econ"] = day_events.get("econ", [])
                days[ds]["fed"]  = day_events.get("fed",  [])
    except Exception as exc:
        _logger.warning("Calendar: econ curation failed: %s", exc)


@router.post("/api/calendar/refresh")
def refresh_calendar():
    """Rebuild the calendar cache immediately — earnings from EW + econ from Claude."""
    cache.invalidate("calendar_weekly")

    week_dates = _week_dates()
    today      = _today_et()
    week_start = week_dates[0].isoformat()
    week_end   = week_dates[-1].isoformat()

    # Fetch earnings in parallel from EarningsWhispers
    days = _build_live(week_dates, today)
    for d in week_dates:
        ds = d.strftime("%Y-%m-%d")
        if ds not in days:
            days[ds] = _empty_day(d, today)

    # Curate econ events via Claude Haiku
    _curate_econ_events(week_start, week_end, days)

    result = {
        "week_start": week_start,
        "week_end":   week_end,
        "days":       days,
        "source":     "refresh",
    }
    cache.set("calendar_weekly", result, ttl=_CACHE_TTL)
    totals = {ds: {"bmo": len(d["bmo"]), "amc": len(d["amc"]), "econ": len(d["econ"])} for ds, d in days.items()}
    return {"ok": True, "totals": totals}
